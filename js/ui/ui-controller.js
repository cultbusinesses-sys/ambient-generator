/**
 * ui-controller.js
 * ----------------
 * Application root. Wires all systems together.
 *
 * Key features in this version:
 *   - 6 randomized visual styles (wave, particle, illusion, tunnel, plasma, starfield, fractal, nebula)
 *   - Seamless looping music: each segment is 3–5 min, crossfades into next before it ends
 *   - Parallel generation: audio render + visual init happen at the same time
 *   - Video export: server renders audio, browser records canvas (fast, no frame overhead)
 *   - All visuals randomize color/speed/geometry on every generate
 */

import { AudioEngine }    from '../core/audio-engine.js';
import { LayerSystem }    from '../core/layer-system.js';
import { Randomizer }     from '../core/randomizer.js';
import { AudioExporter }  from '../export/audio-export.js';
import { VideoExporter }  from '../export/video-export.js';
import { VisualEngine }   from '../visuals/visual-engine.js';
import { WaveVisual }     from '../visuals/wave-visual.js';
import { ParticleVisual } from '../visuals/particle-visual.js';
import { IllusionVisual } from '../visuals/illusion-visual.js';
import { TunnelVisual }   from '../visuals/tunnel-visual.js';
import { PlasmaVisual }   from '../visuals/plasma-visual.js';
import { StarfieldVisual }from '../visuals/starfield-visual.js';
import { FractalVisual }  from '../visuals/fractal-visual.js';
import { NebulaVisual }   from '../visuals/nebula-visual.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATES = {
  IDLE:       'idle',
  GENERATING: 'generating',
  READY:      'ready',
  EXPORTING:  'exporting',
};

const SERVER_URL = window.AMBIENT_SERVER_URL ?? '';

const DURATION_PRESETS = {
  '5m':   5   * 60,
  '15m':  15  * 60,
  '30m':  30  * 60,
  '1hr':  60  * 60,
  '3hr':  180 * 60,
  '5hr':  300 * 60,
};

// All 8 visual modules — picked randomly on every generate
const VISUAL_MODULES = {
  wave:      WaveVisual,
  particle:  ParticleVisual,
  illusion:  IllusionVisual,
  tunnel:    TunnelVisual,
  plasma:    PlasmaVisual,
  starfield: StarfieldVisual,
  fractal:   FractalVisual,
  nebula:    NebulaVisual,
};

// Crossfade duration between music segments (seconds)
const CROSSFADE_SECS = 8;

// Music segment length: random between 3–5 minutes
const SEG_MIN = 3 * 60;
const SEG_MAX = 5 * 60;

// Scale builder (local copy — avoids circular import)
const _SCALES = {
  pentatonic_minor:[0,3,5,7,10], pentatonic_major:[0,2,4,7,9],
  natural_minor:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10],
  lydian:[0,2,4,6,7,9,11], mixolydian:[0,2,4,5,7,9,10],
  whole_tone:[0,2,4,6,8,10],
};
const _ROOT_MIDI = {C:36,'C#':37,D:38,'D#':39,E:40,F:41,'F#':42,G:43,'G#':44,A:45,'A#':46,B:47};
function _midiToHz(n) { return 440*Math.pow(2,(n-69)/12); }
function _buildScale(root,sn,oct=3) {
  const b=_ROOT_MIDI[root]??45, iv=_SCALES[sn]??_SCALES.pentatonic_minor, out=[];
  for(let o=0;o<oct;o++) for(const v of iv) out.push(_midiToHz(b+o*12+v));
  return out;
}

// ---------------------------------------------------------------------------
// UIController
// ---------------------------------------------------------------------------

export class UIController {

  constructor() {
    this._state       = STATES.IDLE;
    this._duration    = DURATION_PRESETS['5m'];
    this._resolution  = '720p';
    this._selectedVis = 'wave';

    // Audio
    this._randomizer  = new Randomizer();
    this._config      = this._randomizer.generate();
    this._audioBuffer = null;

    // Looping playback system
    this._loopCtx        = null;   // AudioContext for live playback
    this._loopNodes      = [];     // active BufferSourceNodes
    this._loopAnalyser   = null;
    this._loopRafHandle  = null;
    this._loopActive     = false;
    this._segmentTimer   = null;   // setTimeout for next segment crossfade

    // Visual
    this._ve         = null;
    this._veRunning  = false;

    // Export
    this._audioExp   = new AudioExporter();
    this._videoExp   = null;
    this._ampData    = new Float32Array(128);

    // DOM cache
    this._el = {};

    // Preview blob URL
    this._previewBlobUrl = null;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  init() {
    this._cacheElements();
    this._bindDurationSelector();
    this._bindVisualSelector();
    this._bindResolutionSelector();
    this._bindGenerateButtons();
    this._bindDownloadButtons();
    this._showState(STATES.IDLE);
    this._updateConfigDisplay();
  }

  // ---------------------------------------------------------------------------
  // DOM cache
  // ---------------------------------------------------------------------------

  _cacheElements() {
    const $ = id => document.getElementById(id);
    this._el = {
      btnGenerate:    $('btn-generate'),
      btnRandom:      $('btn-random'),
      durBtns:        document.querySelectorAll('[data-duration]'),
      durCustomInput: $('dur-custom'),
      visBtns:        document.querySelectorAll('[data-visual]'),
      visDropdown:    $('vis-dropdown'),
      resBtns:        document.querySelectorAll('[data-resolution]'),
      btnDlAudio:     $('btn-dl-audio'),
      btnDlAudioMp3:  $('btn-dl-audio-mp3'),
      btnDlVideo:     $('btn-dl-video'),
      canvas:         $('main-canvas'),
      progressBar:    $('progress-bar'),
      progressFill:   $('progress-fill'),
      progressLabel:  $('progress-label'),
      statusText:     $('status-text'),
      configDesc:     $('config-desc'),
      audioPreview:   $('audio-preview'),
    };
  }

  // ---------------------------------------------------------------------------
  // Duration selector
  // ---------------------------------------------------------------------------

  _bindDurationSelector() {
    this._el.durBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.durBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const key = btn.dataset.duration;
        if (key === 'custom') {
          if (this._el.durCustomInput) this._el.durCustomInput.style.display = 'block';
        } else {
          this._duration = DURATION_PRESETS[key] ?? 300;
          if (this._el.durCustomInput) this._el.durCustomInput.style.display = 'none';
        }
      });
    });
    if (this._el.durCustomInput) {
      this._el.durCustomInput.addEventListener('change', e => {
        const m = parseFloat(e.target.value);
        if (!isNaN(m) && m > 0) this._duration = Math.floor(m * 60);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Visual selector
  // ---------------------------------------------------------------------------

  _bindVisualSelector() {
    this._el.visBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.visBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedVis = btn.dataset.visual;
        this._switchVisual(this._selectedVis);
      });
    });
    if (this._el.visDropdown) {
      this._el.visDropdown.addEventListener('change', e => {
        this._selectedVis = e.target.value;
        this._switchVisual(this._selectedVis);
      });
    }
  }

  async _switchVisual(name) {
    if (!this._ve) return;
    const M = VISUAL_MODULES[name];
    if (!M) return;
    try { await this._ve.loadModule(M); } catch(e) { console.error(e); }
  }

  // ---------------------------------------------------------------------------
  // Resolution selector
  // ---------------------------------------------------------------------------

  _bindResolutionSelector() {
    this._el.resBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.resBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._resolution = btn.dataset.resolution;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Generate buttons
  // ---------------------------------------------------------------------------

  _bindGenerateButtons() {
    if (this._el.btnGenerate) this._el.btnGenerate.addEventListener('click', () => this._generate());
    if (this._el.btnRandom)   this._el.btnRandom.addEventListener('click',   () => this._randomize());
  }

  // ---------------------------------------------------------------------------
  // GENERATE — parallel audio render + visual init
  // ---------------------------------------------------------------------------

  async _generate() {
    if (this._state === STATES.GENERATING || this._state === STATES.EXPORTING) return;
    this._showState(STATES.GENERATING);
    this._stopLoop();

    try {
      this._setStatus('Generating audio + visuals in parallel...');

      // ── Pick random visual BEFORE starting ──────────────────────────────
      const visKeys   = Object.keys(VISUAL_MODULES);
      const randomVis = visKeys[Math.floor(Math.random() * visKeys.length)];
      this._selectedVis = randomVis;
      document.querySelectorAll('[data-visual]').forEach(b => {
        b.classList.toggle('active', b.dataset.visual === randomVis);
      });

      // ── PARALLEL: render audio segment + init/swap visual ─────────────
      // Both start at the same time. Audio render is the slow part (~2–5s).
      // Visual init is nearly instant. They overlap completely.
      const [audioBuffer] = await Promise.all([

        // Task A: render first music segment
        this._renderSegment(this._config, (p) => {
          this._setProgress(p * 0.92);
        }),

        // Task B: init visual engine (or swap module if already running)
        (async () => {
          if (!this._ve && this._el.canvas) {
            const canvas = this._el.canvas;
            canvas.width  = canvas.clientWidth  || canvas.offsetWidth  || 1280;
            canvas.height = canvas.clientHeight || canvas.offsetHeight || 720;
            this._ve = new VisualEngine(canvas, { antialias: true, pixelRatio: 1 });
            await this._ve.init();
            this._videoExp = new VideoExporter(this._ve, this._audioExp);
          }
          await this._ve.loadModule(VISUAL_MODULES[randomVis]);
          if (!this._veRunning) {
            this._ve.start();
            this._veRunning = true;
          }
        })(),

      ]);

      this._audioBuffer = audioBuffer;
      this._setProgress(0.96);

      // ── Start seamless looping playback ──────────────────────────────
      await this._startLoop(audioBuffer);

      this._setProgress(1.0);
      this._showState(STATES.READY);
      this._log(`Ready — ${this._formatDuration(this._duration)} · ${this._randomizer.describe()}`);

    } catch(err) {
      console.error('Generate error:', err);
      this._setStatus(`Error: ${err.message}`);
      this._showState(STATES.IDLE);
    }
  }

  // ---------------------------------------------------------------------------
  // Render a single audio segment
  // ---------------------------------------------------------------------------

  async _renderSegment(config, onProgress) {
    // Segment length: 3–5 minutes (or full duration if shorter)
    const segDur = Math.min(
      this._duration,
      SEG_MIN + Math.random() * (SEG_MAX - SEG_MIN)
    );

    const engine = new AudioEngine({
      duration:   segDur,
      sampleRate: 44100,
      fadeOut:    CROSSFADE_SECS,   // fade out = crossfade length
    });
    await engine.init();

    const scaleFreqs = _buildScale(config.rootNote, config.scaleName);
    const system     = new LayerSystem(engine, config);
    system.build(scaleFreqs);
    system.scheduleAll();

    return engine.render(onProgress);
  }

  // ---------------------------------------------------------------------------
  // Seamless loop system
  // Plays segments back to back with crossfade overlap.
  // Generates next segment in background while current one plays.
  // Music never stops or glitches between segments.
  // ---------------------------------------------------------------------------

  async _startLoop(firstBuffer) {
    this._stopLoop();

    // Create a single AudioContext that lives for the whole session
    this._loopCtx     = new AudioContext();
    this._loopAnalyser = this._loopCtx.createAnalyser();
    this._loopAnalyser.fftSize = 256;
    this._loopAnalyser.connect(this._loopCtx.destination);
    this._loopActive  = true;

    // Set audio element src for the visible player
    this._setAudioPreviewSrc(firstBuffer);

    // Start amplitude loop for visual reactivity
    this._startAmpLoop();

    // Schedule the first segment
    await this._scheduleSegment(firstBuffer, this._loopCtx.currentTime);
  }

  async _scheduleSegment(audioBuffer, startAt) {
    if (!this._loopActive || !this._loopCtx) return;

    // Create buffer source
    const src = this._loopCtx.createBufferSource();
    src.buffer = audioBuffer;

    // Create per-segment gain for crossfade
    const gainNode = this._loopCtx.createGain();
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(1, startAt + CROSSFADE_SECS);
    src.connect(gainNode);
    gainNode.connect(this._loopAnalyser);

    src.start(startAt);
    this._loopNodes.push({ src, gainNode });

    const segDur = audioBuffer.duration;

    // Schedule crossfade out + next segment render
    // Start generating next segment CROSSFADE_SECS before current ends
    const genStartDelay = Math.max(0, (startAt + segDur - CROSSFADE_SECS * 2 - this._loopCtx.currentTime)) * 1000;

    this._segmentTimer = setTimeout(async () => {
      if (!this._loopActive) return;

      // Fade out current segment
      const now = this._loopCtx.currentTime;
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECS);

      // Generate next segment with new random config (seamless musical transition)
      const nextConfig = this._randomizer.generate();
      this._config     = nextConfig;
      this._updateConfigDisplay();

      try {
        this._setStatus('Preparing next segment...');
        const nextBuffer = await this._renderSegment(nextConfig, () => {});

        // Schedule next segment to start exactly when crossfade begins
        const scheduleAt = this._loopCtx.currentTime + CROSSFADE_SECS * 0.5;
        await this._scheduleSegment(nextBuffer, scheduleAt);

        // Update audio preview
        this._setAudioPreviewSrc(nextBuffer);
        this._setStatus('Playing');

        // Swap to a new random visual for variety
        const visKeys   = Object.keys(VISUAL_MODULES);
        const nextVis   = visKeys[Math.floor(Math.random() * visKeys.length)];
        this._selectedVis = nextVis;
        document.querySelectorAll('[data-visual]').forEach(b => {
          b.classList.toggle('active', b.dataset.visual === nextVis);
        });
        if (this._ve) {
          await this._ve.loadModule(VISUAL_MODULES[nextVis]).catch(() => {});
        }

        // Clean up old nodes
        this._loopNodes = this._loopNodes.filter(n => n.gainNode !== gainNode);

      } catch(e) {
        console.error('Segment render error:', e);
        // Retry with same config
        if (this._loopActive) {
          setTimeout(() => this._scheduleSegment(this._audioBuffer, this._loopCtx?.currentTime ?? 0), 1000);
        }
      }
    }, genStartDelay);
  }

  _stopLoop() {
    this._loopActive = false;

    if (this._segmentTimer) {
      clearTimeout(this._segmentTimer);
      this._segmentTimer = null;
    }
    if (this._loopRafHandle) {
      cancelAnimationFrame(this._loopRafHandle);
      this._loopRafHandle = null;
    }

    for (const { src } of this._loopNodes) {
      try { src.stop(); } catch(_) {}
    }
    this._loopNodes = [];

    if (this._loopCtx) {
      this._loopCtx.close().catch(() => {});
      this._loopCtx     = null;
      this._loopAnalyser = null;
    }
  }

  _startAmpLoop() {
    if (!this._loopAnalyser) return;
    const arr  = new Uint8Array(this._loopAnalyser.frequencyBinCount);
    const loop = () => {
      if (!this._loopAnalyser) return;
      this._loopAnalyser.getByteFrequencyData(arr);
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += (arr[i] / 255) ** 2;
      this._ampData[0] = Math.min(1, Math.sqrt(sum / arr.length) * 3.5);
      if (this._ve) this._ve.setAudioData(this._ampData);
      this._loopRafHandle = requestAnimationFrame(loop);
    };
    this._loopRafHandle = requestAnimationFrame(loop);
  }

  _setAudioPreviewSrc(audioBuffer) {
    if (!this._el.audioPreview) return;
    try {
      const blob = this._audioExp._encodeWAV(audioBuffer);
      const url  = URL.createObjectURL(blob);
      if (this._previewBlobUrl) URL.revokeObjectURL(this._previewBlobUrl);
      this._previewBlobUrl = url;
      this._el.audioPreview.src = url;
      this._el.audioPreview.style.display = 'block';
    } catch(e) {}
  }

  // ---------------------------------------------------------------------------
  // Randomize
  // ---------------------------------------------------------------------------

  _randomize() {
    this._config = this._randomizer.generate();
    this._updateConfigDisplay();
    this._log(`Randomized → ${this._randomizer.describe()}`);
    if (this._state === STATES.READY) this._generate();
  }

  // ---------------------------------------------------------------------------
  // Download buttons
  // ---------------------------------------------------------------------------

  _bindDownloadButtons() {
    if (this._el.btnDlAudio)    this._el.btnDlAudio.addEventListener('click',    () => this._downloadAudio('wav'));
    if (this._el.btnDlAudioMp3) this._el.btnDlAudioMp3.addEventListener('click', () => this._downloadAudio('mp3'));
    if (this._el.btnDlVideo)    this._el.btnDlVideo.addEventListener('click',    () => this._downloadVideo());
  }

  async _downloadAudio(format) {
    if (this._state === STATES.EXPORTING) return;
    this._showState(STATES.EXPORTING);

    try {
      if (SERVER_URL) {
        await this._serverDownload(format, 'audio');
      } else {
        if (!this._audioBuffer) { this._setStatus('Generate first'); this._showState(STATES.IDLE); return; }
        const filename = AudioExporter.buildFilename(this._config, this._duration);
        if (format === 'mp3') {
          await this._audioExp.downloadMP3(this._audioBuffer, filename, p => this._setProgress(p), 128);
        } else {
          await this._audioExp.downloadWAV(this._audioBuffer, filename, p => this._setProgress(p));
        }
        this._log(`Downloaded ${format.toUpperCase()}`);
      }
    } catch(err) {
      this._setStatus(`Export error: ${err.message}`);
    }
    this._showState(STATES.READY);
  }

  async _downloadVideo() {
    if (this._state === STATES.EXPORTING) return;
    this._showState(STATES.EXPORTING);

    try {
      if (SERVER_URL) {
        // SERVER: render audio fast, then browser records canvas with that audio
        await this._serverVideoDownload();
      } else {
        // LOCAL fallback
        if (!this._audioBuffer || !this._ve || !this._videoExp) {
          this._setStatus('Generate first');
          this._showState(STATES.IDLE);
          return;
        }
        const filename = AudioExporter.buildFilename(this._config, this._duration);
        await this._videoExp.recordRealtime(this._audioBuffer, {
          resolution:     this._resolution,
          filename,
          onProgress:     p => this._setProgress(p),
          onStatusChange: s => this._setStatus(s),
        });
        this._log('Video downloaded (local)');
      }
    } catch(err) {
      console.error('Video export error:', err);
      this._setStatus(`Error: ${err.message}`);
    }
    this._showState(STATES.READY);
  }

  // ---------------------------------------------------------------------------
  // Server audio download
  // ---------------------------------------------------------------------------

  async _serverDownload(format, type) {
    const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

    const evtSource = new EventSource(`${SERVER_URL}/api/render/progress/${id}`);
    evtSource.onmessage = (e) => {
      try {
        const { progress, message } = JSON.parse(e.data);
        this._setProgress(progress);
        if (message) this._setStatus(message);
      } catch(_) {}
    };
    evtSource.onerror = () => evtSource.close();

    const endpoint = type === 'video'
      ? `${SERVER_URL}/api/render/video`
      : `${SERVER_URL}/api/render/audio`;

    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id,
        config:      this._config,
        duration:    this._duration,
        format,
        resolution:  this._resolution,
        visualStyle: 'auto',
      }),
    });

    evtSource.close();

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error ?? `Server error ${response.status}`);
    }

    this._setStatus('Downloading...');
    const blob     = await response.blob();
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const filename = AudioExporter.buildFilename(this._config, this._duration);
    const ext      = format === 'mp3' ? 'mp3' : format === 'mp4' ? 'mp4' : 'wav';
    a.href         = url;
    a.download     = `${filename}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    this._log(`Downloaded ${ext.toUpperCase()} via server`);
  }

  // ---------------------------------------------------------------------------
  // Server video: server renders audio fast, browser records canvas
  // This avoids server-side frame generation entirely
  // ---------------------------------------------------------------------------

  async _serverVideoDownload() {
    const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

    // Step 1: Get audio WAV from server
    this._setStatus('Server rendering audio...');
    const evtSource = new EventSource(`${SERVER_URL}/api/render/progress/${id}`);
    evtSource.onmessage = (e) => {
      try {
        const { progress, message } = JSON.parse(e.data);
        this._setProgress(progress * 0.35);
        if (message) this._setStatus(message);
      } catch(_) {}
    };
    evtSource.onerror = () => evtSource.close();

    const audioResponse = await fetch(`${SERVER_URL}/api/render/audio`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id,
        config:   this._config,
        duration: this._duration,
        format:   'wav',
      }),
    });

    evtSource.close();
    if (!audioResponse.ok) throw new Error('Server audio render failed');

    const audioBlob = await audioResponse.blob();
    const audioUrl  = URL.createObjectURL(audioBlob);

    // Step 2: Play audio through AudioContext + record canvas with MediaRecorder
    this._setStatus('Recording video (browser)...');
    this._setProgress(0.37);

    const audioEl     = new Audio(audioUrl);
    audioEl.crossOrigin = 'anonymous';

    const audioCtx    = new AudioContext();
    const mediaSrc    = audioCtx.createMediaElementSource(audioEl);
    const analyser    = audioCtx.createAnalyser();
    const mediaDest   = audioCtx.createMediaStreamDestination();
    mediaSrc.connect(analyser);
    mediaSrc.connect(mediaDest);
    analyser.connect(audioCtx.destination);

    // Feed amplitude to visual during recording
    const ampArr  = new Uint8Array(analyser.frequencyBinCount);
    let   ampRaf  = null;
    const ampLoop = () => {
      if (!audioEl.paused && !audioEl.ended) {
        analyser.getByteFrequencyData(ampArr);
        let sum = 0;
        for (let i = 0; i < ampArr.length; i++) sum += (ampArr[i]/255)**2;
        this._ampData[0] = Math.min(1, Math.sqrt(sum/ampArr.length)*3.5);
        if (this._ve) this._ve.setAudioData(this._ampData);
        ampRaf = requestAnimationFrame(ampLoop);
      }
    };

    // Canvas stream + audio stream → MediaRecorder
    const canvas        = this._el.canvas;
    const canvasStream  = canvas.captureStream(24);
    const combined      = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...mediaDest.stream.getAudioTracks(),
    ]);

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 1_200_000,
    });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const done = new Promise(resolve => { recorder.onstop = resolve; });

    recorder.start(2000);
    audioEl.play();
    ampLoop();

    const totalDur    = this._duration;
    const progInterval = setInterval(() => {
      const p = audioEl.currentTime / totalDur;
      this._setProgress(0.37 + p * 0.6);
      this._setStatus(`Recording ${Math.round(p * 100)}%...`);
    }, 1000);

    audioEl.onended = () => {
      clearInterval(progInterval);
      if (ampRaf) cancelAnimationFrame(ampRaf);
      recorder.stop();
    };

    await done;

    URL.revokeObjectURL(audioUrl);
    audioCtx.close();

    this._setProgress(0.98);
    this._setStatus('Saving video...');

    const blob     = new Blob(chunks, { type: mimeType });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const filename = AudioExporter.buildFilename(this._config, this._duration);
    a.href         = url;
    a.download     = `${filename}.webm`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15000);

    this._log(`Video downloaded — ${this._resolution}`);
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  _showState(state) {
    this._state = state;
    const busy  = state === STATES.GENERATING || state === STATES.EXPORTING;

    if (this._el.btnGenerate)   this._el.btnGenerate.disabled   = busy;
    if (this._el.btnRandom)     this._el.btnRandom.disabled     = busy;
    if (this._el.btnDlAudio)    this._el.btnDlAudio.disabled    = state !== STATES.READY;
    if (this._el.btnDlAudioMp3) this._el.btnDlAudioMp3.disabled = state !== STATES.READY;
    if (this._el.btnDlVideo)    this._el.btnDlVideo.disabled    = state !== STATES.READY;
    const labels = {
      [STATES.IDLE]:       'Ready to generate',
      [STATES.GENERATING]: 'Generating...',
      [STATES.READY]:      'Playing',
      [STATES.EXPORTING]:  'Exporting...',
    };
    this._setStatus(labels[state] ?? state);

    if (this._el.progressBar) {
      this._el.progressBar.style.display = busy ? 'block' : 'none';
    }
    if (!busy) this._setProgress(0);
  }

  _setProgress(p) {
    if (this._el.progressFill) {
      this._el.progressFill.style.width = `${(p * 100).toFixed(1)}%`;
    }
  }

  _setStatus(text) {
    if (this._el.statusText) this._el.statusText.textContent = text;
  }

  _log(msg) {
    console.log(`[App] ${msg}`);
    const logEl = document.getElementById('app-log-display');
    if (!logEl) return;
    const line  = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-inf">${msg}</span>`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 20) logEl.firstChild.remove();
  }

  _updateConfigDisplay() {
    if (this._el.configDesc) {
      this._el.configDesc.textContent = this._randomizer.describe();
    }
  }

  _formatDuration(seconds) {
    if (seconds < 60)   return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds/60)}m`;
    return `${(seconds/3600).toFixed(1)}hr`;
  }

  // Public API
  setDuration(s)    { this._duration = s; }
  setConfig(cfg)    { this._config = {...this._config, ...cfg}; this._updateConfigDisplay(); }
  get audioBuffer() { return this._audioBuffer; }
  get config()      { return {...this._config}; }
  get state()       { return this._state; }
}
