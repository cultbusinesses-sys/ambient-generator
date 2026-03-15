/**
 * video-export.js
 * ---------------
 * Combines rendered visual frames and an audio track into a downloadable
 * MP4 / WebM video file.
 *
 * Two export strategies, chosen automatically based on browser support:
 *
 *   Strategy A — MediaRecorder (preferred, all modern browsers)
 *     - Sets the VisualEngine to target resolution
 *     - Plays the audio through an AudioContext
 *     - Records the canvas + audio together using MediaRecorder
 *     - Output: WebM/VP9 (Chrome) or WebM/VP8 (Firefox) — widely supported
 *     - Speed: real-time capture (1 hr video = 1 hr record time)
 *     - Use this for the full app export flow
 *
 *   Strategy B — Frame-by-frame (fallback / offline pipeline)
 *     - Calls visualEngine.renderFrameAt(t) in a tight loop
 *     - Encodes frames to JPEG data URLs
 *     - Muxes with audio using a simple WebM writer (no FFmpeg needed)
 *     - Speed: faster-than-realtime (no audio playback required)
 *     - Use this when real-time recording is not acceptable
 *
 * Resolution presets:
 *   1080p → 1920×1080
 *   2k    → 2560×1440
 *   4k    → 3840×2160
 *
 * Usage:
 *   const exporter = new VideoExporter(visualEngine, audioExporter);
 *
 *   // Record in real-time:
 *   await exporter.recordRealtime(audioBuffer, {
 *     resolution: '1080p',
 *     filename: 'ambient-video',
 *     onProgress: (p) => console.log(p),
 *   });
 *
 *   // Frame-by-frame (faster, no audio during capture):
 *   await exporter.exportFrames(audioBuffer, {
 *     resolution: '1080p',
 *     fps: 30,
 *     filename: 'ambient-video',
 *     onProgress: (p) => console.log(p),
 *   });
 */

import { AudioExporter } from './audio-export.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESOLUTION_PRESETS = {
  '1080p': { width: 1920, height: 1080 },
  '2k':    { width: 2560, height: 1440 },
  '4k':    { width: 3840, height: 2160 },
};

// Bitrates tuned for ambient content (low motion = VP9 compresses extremely well).
// These produce files ~10–30× smaller than general-purpose bitrates with
// no visible quality loss on slow-moving visuals.
const BITRATE_MAP = {
  '1080p': 1_200_000,   // 1.2 Mbps  — ~540 MB/hr  (was 8 Mbps = 3.6 GB/hr)
  '2k':    2_000_000,   // 2.0 Mbps  — ~900 MB/hr
  '4k':    4_000_000,   // 4.0 Mbps  — ~1.8 GB/hr
};

// VP9 first — far better compression than VP8 for ambient/low-motion content.
// opus audio codec gives excellent quality at 96kbps.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
];

// Record at 24fps — visually smooth for ambient, significantly smaller than 30fps.
const RECORD_FPS = 24;

// ---------------------------------------------------------------------------
// VideoExporter
// ---------------------------------------------------------------------------

export class VideoExporter {

  /**
   * @param {import('../visuals/visual-engine.js').VisualEngine} visualEngine
   * @param {AudioExporter} audioExporter
   */
  constructor(visualEngine, audioExporter) {
    this.ve            = visualEngine;
    this.audioExporter = audioExporter;
    this._isRecording  = false;
    this._recorder     = null;
    this._stopRequested = false;
  }

  // ---------------------------------------------------------------------------
  // Strategy A — Real-time MediaRecorder
  // ---------------------------------------------------------------------------

  /**
   * Records the visual + audio in real-time using MediaRecorder.
   * The audio plays through a hidden AudioContext while the canvas is recorded.
   * Duration is determined by the audioBuffer length.
   *
   * @param {AudioBuffer} audioBuffer  - the rendered audio
   * @param {Object}      opts
   * @param {'1080p'|'2k'|'4k'} [opts.resolution]  - default '1080p'
   * @param {string}      [opts.filename]           - without extension
   * @param {number}      [opts.videoBitrate]       - bps, default 8_000_000
   * @param {Function}    [opts.onProgress]         - called with 0..1
   * @param {Function}    [opts.onStatusChange]     - called with status string
   * @returns {Promise<Blob>} the recorded video blob
   */
  async recordRealtime(audioBuffer, opts = {}) {
    const {
      resolution   = '1080p',
      filename     = 'ambient-video',
      onProgress,
      onStatusChange,
    } = opts;

    if (this._isRecording) throw new Error('VideoExporter: already recording');
    this._isRecording   = true;
    this._stopRequested = false;

    const status = (msg) => { if (onStatusChange) onStatusChange(msg); };

    // Step 1 — Set visual resolution
    status('Setting resolution...');
    const res = RESOLUTION_PRESETS[resolution] ?? RESOLUTION_PRESETS['1080p'];
    this.ve.setResolution(resolution);
    if (onProgress) onProgress(0.02);

    // Step 2 — Get canvas stream at locked fps
    const canvas       = this.ve.canvas;
    const canvasStream = canvas.captureStream(RECORD_FPS);

    // Step 3 — Pipe audio buffer through AudioContext → MediaStream
    status('Preparing audio stream...');
    const audioCtx    = new AudioContext({ sampleRate: audioBuffer.sampleRate });
    const audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;

    const streamDest = audioCtx.createMediaStreamDestination();
    audioSource.connect(streamDest);

    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...streamDest.stream.getAudioTracks(),
    ]);

    // Step 4 — Choose MIME type and bitrate
    const mimeType   = this._getBestMimeType();
    const videoBps   = BITRATE_MAP[resolution] ?? BITRATE_MAP['1080p'];
    const audioBps   = 96_000;  // 96 kbps opus — excellent quality for ambient

    status(`Recording ${resolution} at ${Math.round(videoBps / 1000)}kbps...`);

    // Step 5 — Create MediaRecorder
    const chunks   = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: videoBps,
      audioBitsPerSecond: audioBps,
    });

    this._recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const duration      = audioBuffer.duration;
    let   progressTimer = null;

    const recordingPromise = new Promise((resolve, reject) => {
      recorder.onstop = () => {
        clearInterval(progressTimer);
        audioCtx.close();
        const blob = new Blob(chunks, { type: mimeType });
        resolve(blob);
      };
      recorder.onerror = (e) => {
        clearInterval(progressTimer);
        audioCtx.close();
        reject(new Error(`MediaRecorder error: ${e.error?.message ?? 'unknown'}`));
      };
    });

    // Step 6 — Start
    recorder.start(2000);  // collect in 2-sec chunks (reduces memory pressure)
    audioSource.start(0);

    const startTime = audioCtx.currentTime;
    progressTimer = setInterval(() => {
      const elapsed  = audioCtx.currentTime - startTime;
      const progress = Math.min(0.98, elapsed / duration);
      if (onProgress) onProgress(0.05 + progress * 0.88);
      if (elapsed >= duration - 0.1 || this._stopRequested) {
        clearInterval(progressTimer);
        recorder.stop();
        audioSource.stop();
      }
    }, 500);

    audioSource.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };

    status('Recording...');
    const blob = await recordingPromise;
    if (onProgress) onProgress(0.95);

    // Step 7 — Download
    status('Saving file...');
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    this._triggerDownload(blob, `${filename}.${ext}`);
    if (onProgress) onProgress(1.0);

    this._isRecording = false;
    this._recorder    = null;

    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    status(`Done — ${sizeMB} MB`);
    return blob;
  }

  // ---------------------------------------------------------------------------
  // Strategy B — Frame-by-frame export (faster than real-time)
  // ---------------------------------------------------------------------------

  /**
   * Exports video by rendering frames offline and muxing with audio.
   * Faster than real-time because no audio playback is needed during capture.
   * Uses a lightweight WebM muxer.
   *
   * @param {AudioBuffer} audioBuffer
   * @param {Object}      opts
   * @param {'1080p'|'2k'|'4k'} [opts.resolution]
   * @param {number}      [opts.fps]           - frames per second (default 30)
   * @param {string}      [opts.filename]
   * @param {Function}    [opts.onProgress]
   * @param {Function}    [opts.onStatusChange]
   * @returns {Promise<Blob>}
   */
  async exportFrames(audioBuffer, opts = {}) {
    const {
      resolution     = '1080p',
      fps            = 30,
      filename       = 'ambient-video',
      onProgress,
      onStatusChange,
    } = opts;

    const status = (msg) => { if (onStatusChange) onStatusChange(msg); };
    const duration = audioBuffer.duration;
    const totalFrames = Math.floor(duration * fps);
    const res = RESOLUTION_PRESETS[resolution] ?? RESOLUTION_PRESETS['1080p'];

    // Set canvas to target resolution
    status('Setting resolution...');
    this.ve.setResolution(resolution);
    if (onProgress) onProgress(0.01);

    // Encode audio to WAV blob URL
    status('Encoding audio...');
    const audioUrl = await this.audioExporter.toBlobURL(audioBuffer, 'wav',
      p => { if (onProgress) onProgress(0.01 + p * 0.1); }
    );

    // Capture frames
    status('Capturing frames...');
    const frameDataURLs = [];
    const audioData     = new Float32Array(128);

    for (let f = 0; f < totalFrames; f++) {
      const t = f / fps;   // time in seconds

      // Simulate amplitude from the audio buffer (RMS of a short window)
      const sampleStart = Math.floor(t * audioBuffer.sampleRate);
      const windowSize  = Math.floor(audioBuffer.sampleRate / fps);
      audioData[0]      = this._computeRMS(audioBuffer, sampleStart, windowSize);

      // Render the frame
      const dataUrl = this.ve.renderFrameAt(t, audioData);
      frameDataURLs.push(dataUrl);

      // Yield every 10 frames to keep UI responsive
      if (f % 10 === 0) {
        const progress = 0.1 + (f / totalFrames) * 0.75;
        if (onProgress) onProgress(progress);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    status('Muxing video...');
    if (onProgress) onProgress(0.86);

    // Mux frames into a WebM using a canvas-based approach
    const blob = await this._muxToWebM(frameDataURLs, fps, audioUrl, res, onProgress);

    // Revoke audio URL
    URL.revokeObjectURL(audioUrl);

    status('Saving file...');
    this._triggerDownload(blob, `${filename}.webm`);
    if (onProgress) onProgress(1.0);

    status('Done');
    return blob;
  }

  // ---------------------------------------------------------------------------
  // Stop (cancel an in-progress recording)
  // ---------------------------------------------------------------------------

  /**
   * Requests the current recording to stop early.
   * The download will trigger with whatever has been recorded so far.
   */
  stop() {
    this._stopRequested = true;
    if (this._recorder && this._recorder.state !== 'inactive') {
      this._recorder.stop();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the best supported MIME type for MediaRecorder.
   */
  _getBestMimeType() {
    for (const mime of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return 'video/webm'; // fallback
  }

  /**
   * Computes RMS (Root Mean Square) amplitude for a short window of audio.
   * Returns a 0..1 value suitable for audioData[0].
   *
   * @param {AudioBuffer} audioBuffer
   * @param {number}      startSample
   * @param {number}      windowSize
   * @returns {number}
   */
  _computeRMS(audioBuffer, startSample, windowSize) {
    const ch   = audioBuffer.getChannelData(0);
    const end  = Math.min(startSample + windowSize, ch.length);
    let   sum  = 0;
    let   count = 0;
    for (let i = startSample; i < end; i++) {
      sum += ch[i] * ch[i];
      count++;
    }
    if (count === 0) return 0;
    return Math.min(1, Math.sqrt(sum / count) * 4);  // ×4 to scale to visible range
  }

  /**
   * Lightweight WebM muxer using MediaRecorder on a temporary canvas.
   * Records frame images into a video by drawing them one-by-one and
   * recording with MediaRecorder at the target fps.
   *
   * This is the cleanest approach that works without FFmpeg or external libs.
   *
   * @param {string[]} frameDataURLs
   * @param {number}   fps
   * @param {string}   audioUrl
   * @param {{width, height}} res
   * @param {Function} [onProgress]
   * @returns {Promise<Blob>}
   */
  async _muxToWebM(frameDataURLs, fps, audioUrl, res, onProgress) {
    // Create offscreen canvas at target resolution
    const offCanvas = document.createElement('canvas');
    offCanvas.width  = res.width;
    offCanvas.height = res.height;
    const ctx = offCanvas.getContext('2d');

    const mimeType = this._getBestMimeType();
    const stream   = offCanvas.captureStream(fps);
    const chunks   = [];

    // Add audio track from the WAV blob
    const audioEl  = new Audio(audioUrl);
    audioEl.muted  = true;   // prevent audible playback during mux
    const audioCtx = new AudioContext();
    const src      = audioCtx.createMediaElementSource(audioEl);
    const dest     = audioCtx.createMediaStreamDestination();
    src.connect(dest);

    const fullStream = new MediaStream([
      ...stream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(fullStream, {
      mimeType,
      videoBitsPerSecond: 6_000_000,
    });

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise(async (resolve) => {
      recorder.onstop = () => {
        audioCtx.close();
        resolve(new Blob(chunks, { type: mimeType }));
      };

      recorder.start();
      audioEl.play().catch(() => {});

      const frameMs = 1000 / fps;

      for (let i = 0; i < frameDataURLs.length; i++) {
        const img = await this._loadImage(frameDataURLs[i]);
        ctx.drawImage(img, 0, 0, res.width, res.height);

        // Wait one frame interval
        await new Promise(r => setTimeout(r, frameMs));

        if (i % 30 === 0 && onProgress) {
          onProgress(0.86 + (i / frameDataURLs.length) * 0.12);
        }
      }

      recorder.stop();
    });
  }

  /**
   * Loads an image from a data URL.
   * @param {string} dataUrl
   * @returns {Promise<HTMLImageElement>}
   */
  _loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src     = dataUrl;
    });
  }

  /**
   * Triggers a browser file download from a Blob.
   * @param {Blob}   blob
   * @param {string} filename
   */
  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the list of supported resolution labels.
   * @returns {string[]}
   */
  static resolutionOptions() {
    return Object.keys(RESOLUTION_PRESETS);
  }

  /**
   * Returns the pixel dimensions for a resolution label.
   * @param {string} label  - '1080p' | '2k' | '4k'
   * @returns {{ width: number, height: number }}
   */
  static resolutionDimensions(label) {
    return { ...RESOLUTION_PRESETS[label] };
  }
}
