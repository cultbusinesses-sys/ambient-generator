/**
 * server/routes/render.js
 * ------------------------
 * Express router — audio and video render API.
 *
 * KEY CHANGE vs previous version:
 *   Video route now runs audio rendering and frame generation IN PARALLEL
 *   using Promise.all(). Both tasks start at the same time. FFmpeg only
 *   starts muxing once both are ready. This cuts total video time roughly
 *   in half because the two heaviest tasks overlap completely.
 *
 * Pipeline (old — sequential):
 *   Audio render → WAV write → Frame gen → FFmpeg mux
 *   All steps wait for the previous one to finish.
 *
 * Pipeline (new — parallel):
 *   Audio render  ─┐
 *                   ├─ Promise.all → FFmpeg mux
 *   Frame gen     ─┘
 *   Audio render and frame generation happen simultaneously.
 *   Only the final mux step has to wait.
 *
 * Routes:
 *   POST /api/render/audio           → WAV or MP3 download
 *   POST /api/render/video           → MP4 download
 *   GET  /api/render/progress/:id    → SSE progress stream
 */

const express        = require('express');
const path           = require('path');
const fs             = require('fs');
const { v4: uuidv4 } = require('uuid');

const { renderAudio }    = require('../engine/audio-server');
const { generateFrames } = require('../engine/visual-server');
const { encodeWAV, encodeMP3, cleanUp: cleanAudio } = require('../export/encode-audio');
const { encodeVideo, cleanUp: cleanVideo }           = require('../export/encode-video');

const router   = express.Router();
const TEMP_DIR = process.env.TEMP_DIR ?? '/tmp';
const MAX_DUR  = parseInt(process.env.MAX_DURATION_SECONDS ?? '21600', 10);

const RESOLUTIONS = {
  '720p':  [1280, 720],    // default — fastest, best for free tier
  '1080p': [1920, 1080],
  '2k':    [2560, 1440],
  '4k':    [3840, 2160],
};

// Free-tier safe defaults
const DEFAULT_RESOLUTION = '720p';
const DEFAULT_FPS        = 12;    // ambient visuals look identical at 12fps vs 24fps

// ---------------------------------------------------------------------------
// SSE progress store
// ---------------------------------------------------------------------------

const progressStore = new Map();

function setProgress(id, value, message = '') {
  const entry = progressStore.get(id);
  if (!entry) return;
  entry.progress = value;
  entry.message  = message;
  const payload  = JSON.stringify({ progress: value, message });
  entry.clients.forEach(res => {
    try { res.write(`data: ${payload}\n\n`); } catch (_) {}
  });
  if (value >= 1) {
    entry.clients.forEach(res => { try { res.end(); } catch (_) {} });
    setTimeout(() => progressStore.delete(id), 30000);
  }
}

function initProgress(id) {
  if (!progressStore.has(id)) {
    progressStore.set(id, { progress: 0, message: '', clients: new Set() });
  }
}

// ---------------------------------------------------------------------------
// GET /api/render/progress/:id  — SSE
// ---------------------------------------------------------------------------

router.get('/render/progress/:id', (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type',       'text/event-stream');
  res.setHeader('Cache-Control',      'no-cache');
  res.setHeader('Connection',         'keep-alive');
  res.setHeader('X-Accel-Buffering',  'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ progress: 0, message: 'Connected' })}\n\n`);

  initProgress(id);
  progressStore.get(id).clients.add(res);

  req.on('close', () => {
    const entry = progressStore.get(id);
    if (entry) entry.clients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateCommon(body) {
  const { config, duration } = body;
  if (!config)                      return 'Missing config';
  if (typeof duration !== 'number') return 'duration must be a number';
  if (duration < 10)                return 'duration must be at least 10 seconds';
  if (duration > MAX_DUR)           return `duration exceeds maximum (${MAX_DUR}s)`;
  return null;
}

function validateAudio(body) {
  const base = validateCommon(body);
  if (base) return base;
  if (!['wav','mp3'].includes(body.format)) return 'format must be wav or mp3';
  return null;
}

function validateVideo(body) {
  return validateCommon(body);
}

// ---------------------------------------------------------------------------
// POST /api/render/audio  — WAV or MP3
// ---------------------------------------------------------------------------

router.post('/render/audio', async (req, res) => {
  const err = validateAudio(req.body);
  if (err) return res.status(400).json({ error: err });

  const { config, duration, format, id: clientId } = req.body;
  const id = clientId ?? uuidv4();
  initProgress(id);

  let audioPath = null;

  try {
    setProgress(id, 0.02, 'Starting audio render...');

    const audioBuffer = await renderAudio(config, duration, p => {
      setProgress(id, 0.04 + p * 0.72, 'Rendering audio...');
    });

    setProgress(id, 0.78, 'Encoding...');

    audioPath = format === 'mp3'
      ? await encodeMP3(audioBuffer, id, 128)
      : encodeWAV(audioBuffer, id);

    setProgress(id, 0.95, 'Sending file...');

    const ext      = format === 'mp3' ? 'mp3' : 'wav';
    const filename = buildFilename(config, duration, ext);
    const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

    res.setHeader('Content-Type',        mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      fs.statSync(audioPath).size);

    const stream = fs.createReadStream(audioPath);
    stream.pipe(res);
    stream.on('end', () => {
      cleanAudio(audioPath);
      setProgress(id, 1.0, 'Done');
    });

  } catch (e) {
    console.error('[render/audio]', e.message);
    if (audioPath) cleanAudio(audioPath);
    setProgress(id, 1.0, `Error: ${e.message}`);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/render/video  — MP4  (PARALLEL pipeline)
// ---------------------------------------------------------------------------

router.post('/render/video', async (req, res) => {
  const err = validateVideo(req.body);
  if (err) return res.status(400).json({ error: err });

  const {
    config,
    duration,
    resolution  = DEFAULT_RESOLUTION,
    visualStyle = 'auto',
    id: clientId,
  } = req.body;

  const id = clientId ?? uuidv4();
  initProgress(id);

  let audioPath = null;
  let videoPath = null;

  let audioP = 0;
  let frameP = 0;

  function blend() {
    const combined = (audioP * 0.35 + frameP * 0.65) * 0.88;
    setProgress(id, combined);
  }

  try {
    setProgress(id, 0.01, 'Starting parallel render...');

    const [vw, vh] = RESOLUTIONS[resolution] ?? RESOLUTIONS[DEFAULT_RESOLUTION];

    const [audioBuffer, frameBuffers] = await Promise.all([

      renderAudio(config, duration, p => {
        audioP = p;
        blend();
      }).then(buf => {
        audioP = 1;
        blend();
        return buf;
      }),

      (async () => {
        const frames      = [];
        const totalFrames = Math.floor(duration * DEFAULT_FPS);
        let   count       = 0;

        const gen = generateFrames({
          width:    vw,
          height:   vh,
          fps:      DEFAULT_FPS,
          duration,
          style:    visualStyle,
        });

        for await (const rgbBuf of gen) {
          frames.push(rgbBuf);
          count++;
          frameP = count / totalFrames;
          if (count % DEFAULT_FPS === 0) blend();
        }

        frameP = 1;
        blend();
        return frames;
      })(),

    ]);

    setProgress(id, 0.89, 'Writing audio track...');
    audioPath = encodeWAV(audioBuffer, `${id}_audio`);

    setProgress(id, 0.90, 'Muxing video (ffmpeg)...');

    async function* framesFromArray(arr) {
      for (const buf of arr) yield buf;
    }

    videoPath = await encodeVideo({
      frames:     framesFromArray(frameBuffers),
      audioPath,
      resolution,
      fps:        DEFAULT_FPS,
      width:      vw,
      height:     vh,
      id,
      onProgress: p => {
        setProgress(id, 0.90 + p * 0.07, 'Encoding MP4...');
      },
    });

    setProgress(id, 0.98, 'Sending file...');

    // ── Stream MP4 to client ─────────────────────────────────────────────
    const filename = buildFilename(config, duration, 'mp4');
    const stat     = fs.statSync(videoPath);

    res.setHeader('Content-Type',        'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      stat.size);

    const stream = fs.createReadStream(videoPath);
    stream.pipe(res);
    stream.on('end', () => {
      cleanAudio(audioPath);
      cleanVideo(videoPath);
      setProgress(id, 1.0, 'Done');
    });

  } catch (e) {
    console.error('[render/video]', e.message);
    if (audioPath) cleanAudio(audioPath);
    if (videoPath) cleanVideo(videoPath);
    setProgress(id, 1.0, `Error: ${e.message}`);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------

function buildFilename(config, duration, ext) {
  const root  = (config?.rootNote  ?? 'A').replace('#', 's');
  const scale = (config?.scaleName ?? 'ambient').split('_')[0];
  const dur   = duration < 60   ? `${duration}s`
              : duration < 3600 ? `${Math.round(duration / 60)}m`
              : `${Math.round(duration / 3600)}hr`;
  return `ambient-${root}-${scale}-${dur}.${ext}`;
}

module.exports = router;
