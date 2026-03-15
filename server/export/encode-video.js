/**
 * server/export/encode-video.js
 * ------------------------------
 * Muxes raw RGB video frames + WAV audio into an MP4 file using ffmpeg.
 *
 * PERFORMANCE CHANGE:
 *   Old: -f image2pipe  reads PNG-compressed frames (~6KB each to decompress)
 *   New: -f rawvideo    reads raw RGB bytes directly (zero decompression)
 *
 *   Raw RGB = width * height * 3 bytes per frame, no encoding overhead.
 *   FFmpeg reads it as: -f rawvideo -pix_fmt rgb24 -s WxH -r FPS
 *
 *   This is the fastest possible input format for ffmpeg.
 *   Combined with 12fps and 720p defaults it makes the mux step trivial.
 *
 * Bitrates tuned for ambient content (low motion compresses extremely well):
 *   720p  → 800 Kbps  ≈ 360 MB/hr   ← default (free tier)
 *   1080p → 1200 Kbps ≈ 540 MB/hr
 *   2k    → 2000 Kbps ≈ 900 MB/hr
 *   4k    → 4000 Kbps ≈ 1.8 GB/hr
 *
 * Codec: libx264 with veryfast preset + crf 26.
 *   crf 26 (was 23) = slightly more compression, invisible on slow visuals.
 *   veryfast = fastest encode with acceptable quality.
 */

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');

const TEMP_DIR = process.env.TEMP_DIR ?? '/tmp';

const BITRATE_MAP = {
  '720p':  '800k',
  '1080p': '1200k',
  '2k':    '2000k',
  '4k':    '4000k',
};

const RESOLUTION_MAP = {
  '720p':  { width: 1280, height: 720  },
  '1080p': { width: 1920, height: 1080 },
  '2k':    { width: 2560, height: 1440 },
  '4k':    { width: 3840, height: 2160 },
};

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * @param {object}          opts
 * @param {AsyncGenerator}  opts.frames       — yields raw RGB Buffers
 * @param {string}          opts.audioPath    — path to WAV file
 * @param {string}          opts.resolution   — '720p'|'1080p'|'2k'|'4k'
 * @param {number}          opts.fps          — must match what visual-server used
 * @param {number}          opts.width        — pixel width (must match frames)
 * @param {number}          opts.height       — pixel height (must match frames)
 * @param {string}          opts.id
 * @param {Function}        [opts.onProgress]
 * @returns {Promise<string>} path to output MP4
 */
async function encodeVideo(opts) {
  const {
    frames,
    audioPath,
    resolution = '720p',
    fps        = 12,
    width,
    height,
    id,
    onProgress,
  } = opts;

  // Dimensions come from the caller (visual-server chooses them)
  // Fall back to resolution preset if width/height not provided
  const res     = RESOLUTION_MAP[resolution] ?? RESOLUTION_MAP['720p'];
  const vw      = width  ?? res.width;
  const vh      = height ?? res.height;
  const bitrate = BITRATE_MAP[resolution] ?? BITRATE_MAP['720p'];
  const outPath = path.join(TEMP_DIR, `${id}.mp4`);

  // ffmpeg args — raw video input:
  //
  //   -f rawvideo        — input is raw pixel data (no container, no compression)
  //   -pix_fmt rgb24     — 3 bytes per pixel: R, G, B
  //   -s WxH             — frame dimensions (MUST match the actual data)
  //   -r FPS             — input frame rate
  //   -i pipe:0          — read from stdin
  //   -i audioPath       — audio track
  //   -c:v libx264       — H.264 encoder
  //   -preset veryfast   — fastest encode, good quality for ambient
  //   -crf 26            — constant quality (lower = better, 26 is fine for slow visuals)
  //   -b:v bitrate       — target bitrate (keeps file size predictable)
  //   -vf scale=WxH      — resize output (same as input here but ensures even dims)
  //   -c:a aac -b:a 96k  — AAC audio at 96 kbps (fine for ambient)
  //   -pix_fmt yuv420p   — required for broad MP4 compatibility
  //   -movflags +faststart — move moov atom to file start (enables streaming)
  //   -shortest          — stop when shortest stream (audio) ends

  const args = [
    '-y',
    // Raw video input
    '-f',        'rawvideo',
    '-pix_fmt',  'rgb24',
    '-s',        `${vw}x${vh}`,
    '-r',        String(fps),
    '-i',        'pipe:0',
    // Audio input
    '-i',        audioPath,
    // Video output
    '-c:v',      'libx264',
    '-preset',   'veryfast',
    '-crf',      '26',
    '-b:v',      bitrate,
    '-vf',       `scale=${vw}:${vh}`,
    // Audio output
    '-c:a',      'aac',
    '-b:a',      '96k',
    // Container
    '-pix_fmt',  'yuv420p',
    '-movflags', '+faststart',
    '-shortest',
    outPath,
  ];

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    let lastProgressUpdate = 0;

    ff.stderr.on('data', chunk => {
      stderr += chunk.toString();

      // Parse ffmpeg time progress — throttle to avoid flooding SSE
      const now = Date.now();
      if (onProgress && now - lastProgressUpdate > 1000) {
        const tm = stderr.match(/time=(\d+):(\d+):([\d.]+)/g);
        if (tm && tm.length > 0) {
          const last = tm[tm.length - 1].match(/time=(\d+):(\d+):([\d.]+)/);
          if (last) {
            const secs = parseInt(last[1]) * 3600 + parseInt(last[2]) * 60 + parseFloat(last[3]);
            // We don't have total duration here — report as clamped proxy
            onProgress(Math.min(0.95, secs / 3600));
            lastProgressUpdate = now;
          }
        }
      }
    });

    ff.on('close', code => {
      if (code === 0) {
        if (onProgress) onProgress(1.0);
        resolve(outPath);
      } else {
        reject(new Error(
          `ffmpeg exited ${code}.\nLast stderr: ${stderr.slice(-400)}`
        ));
      }
    });

    ff.on('error', err => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}\nIs ffmpeg installed?`));
    });

    // Stream raw RGB frames into ffmpeg stdin
    ;(async () => {
      try {
        for await (const rgbBuf of frames) {
          const ok = ff.stdin.write(rgbBuf);
          if (!ok) {
            // Back-pressure — wait for drain before sending more
            await new Promise(r => ff.stdin.once('drain', r));
          }
        }
        ff.stdin.end();
      } catch (err) {
        ff.stdin.destroy(err);
        reject(err);
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanUp(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

module.exports = { encodeVideo, cleanUp, RESOLUTION_MAP };
