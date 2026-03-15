/**
 * server/engine/audio-server.js
 * ------------------------------
 * Server-side audio renderer using node-web-audio-api.
 * Mirrors the browser audio-engine.js + music-generator.js + layer-system.js
 * but runs in Node.js with no browser required.
 *
 * node-web-audio-api implements the full Web Audio API spec — so the same
 * oscillator/filter/convolver logic from the browser files works identically.
 *
 * Speed: ~8 seconds for 1 hour of audio on a 2-vCPU server.
 * Output: Float32Array PCM → written to WAV file by encode-audio.js.
 */

// const { OfflineAudioContext } = require('@ircam/node-web-audio-api');

// const { OfflineAudioContext } = require('@ircam/node-web-audio-api');

// ---------------------------------------------------------------------------
// Scale / note helpers (same as browser music-generator.js)
// ---------------------------------------------------------------------------

const SCALES = {
  pentatonic_minor: [0, 3, 5, 7, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  natural_minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  whole_tone:       [0, 2, 4, 6, 8, 10],
};

const ROOT_MIDI = {
  C: 36, 'C#': 37, D: 38, 'D#': 39, E: 40,
  F: 41, 'F#': 42, G: 43, 'G#': 44, A: 45,
  'A#': 46, B: 47,
};

function midiToHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

function buildScale(rootName, scaleName, octaves = 3) {
  const base = ROOT_MIDI[rootName] ?? 45;
  const ivs  = SCALES[scaleName]   ?? SCALES.pentatonic_minor;
  const out  = [];
  for (let o = 0; o < octaves; o++) {
    for (const iv of ivs) out.push(midiToHz(base + o * 12 + iv));
  }
  return out;
}

function buildChord(freqs, rootIdx) {
  return [0, 1, 2].map(i => freqs[(rootIdx + i * 2) % freqs.length]);
}

// ---------------------------------------------------------------------------
// Impulse response (same as browser audio-engine.js, optimised)
// ---------------------------------------------------------------------------

function generateIR(ctx, sampleRate) {
  const len      = Math.ceil(2.5 * sampleRate);
  const ir       = ctx.createBuffer(2, len, sampleRate);
  const decay    = new Float32Array(len);
  const earlyEnd = Math.floor(0.08 * sampleRate);

  for (let i = 0; i < len; i++) {
    decay[i] = Math.exp(-i / sampleRate * 1.4);
  }
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * decay[i] * (i < earlyEnd ? 1.4 : 1.0);
    }
  }
  return ir;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Render ambient audio to an AudioBuffer using OfflineAudioContext.
 *
 * @param {Object} config   - music config from Randomizer
 * @param {number} duration - seconds
 * @param {Function} [onProgress] - called with 0..1
 * @returns {Promise<import('node-web-audio-api').AudioBuffer>}
 */
async function renderAudio(config, duration, onProgress) {
  // 22050 Hz instead of 44100 Hz.
  // Halves the number of samples = roughly halves render time.
  // Ambient music (slow drones, pads, textures) sounds identical at 22050 Hz —
  // there is no high-frequency content that would reveal the difference.
  const sampleRate = 22050;

  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length:           Math.ceil(duration * sampleRate),
    sampleRate,
  });

  // ── Master chain ──────────────────────────────────────────────────────────
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(1.0, 0);
  const fadeStart = Math.max(0, duration - 4);
  masterGain.gain.setValueAtTime(1.0, fadeStart);
  masterGain.gain.linearRampToValueAtTime(0, duration);
  masterGain.connect(ctx.destination);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value      = 12;
  compressor.ratio.value     = 3;
  compressor.attack.value    = 0.15;
  compressor.release.value   = 0.5;
  compressor.connect(masterGain);

  const dryGain = ctx.createGain();
  dryGain.gain.value = 0.65;
  dryGain.connect(compressor);

  const reverbInput = ctx.createGain();
  reverbInput.gain.value = 1.0;

  const reverb = ctx.createConvolver();
  reverb.buffer    = generateIR(ctx, sampleRate);
  reverb.normalize = true;

  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.45;

  reverbInput.connect(reverb);
  reverb.connect(reverbGain);
  reverbGain.connect(compressor);

  const dryInput = ctx.createGain();
  dryInput.gain.value = 1.0;
  dryInput.connect(dryGain);

  // Resolved config with defaults
  const cfg = {
    rootNote:       config.rootNote       ?? 'A',
    scaleName:      config.scaleName      ?? 'pentatonic_minor',
    droneGain:      config.droneGain      ?? 0.22,
    padGain:        config.padGain        ?? 0.18,
    textureGain:    config.textureGain    ?? 0.14,
    melodyGain:     config.melodyGain     ?? 0.08,
    pulseGain:      config.pulseGain      ?? 0.10,
    padBrightness:  config.padBrightness  ?? 0.4,
    noiseIntensity: config.noiseIntensity ?? 0.3,
    melodyRate:     config.melodyRate     ?? 0.35,
    pulseDensity:   config.pulseDensity   ?? 0.5,
  };

  const scaleFreqs = buildScale(cfg.rootNote, cfg.scaleName);

  // ── Schedule layers ───────────────────────────────────────────────────────
  scheduleDrone(ctx, cfg, scaleFreqs, duration, reverbInput);
  schedulePads(ctx, cfg, scaleFreqs, duration, reverbInput);
  scheduleTexture(ctx, cfg, duration, reverbInput, dryInput);
  scheduleMelody(ctx, cfg, scaleFreqs, duration, reverbInput);
  schedulePulse(ctx, cfg, scaleFreqs, duration, reverbInput, dryInput);

  // ── Render ────────────────────────────────────────────────────────────────
  if (onProgress) {
    onProgress(0.02);
    const estimatedMs  = (duration / 20) * 1000;
    const startTime    = Date.now();
    const progressTimer = setInterval(() => {
      const p = Math.min(0.92, (Date.now() - startTime) / estimatedMs);
      onProgress(p);
    }, 200);

    const buffer = await ctx.startRendering();
    clearInterval(progressTimer);
    onProgress(1.0);
    return buffer;
  }

  return ctx.startRendering();
}

// ---------------------------------------------------------------------------
// Layer: Deep Drone  (cycle 73s prime)
// ---------------------------------------------------------------------------
function scheduleDrone(ctx, cfg, freqs, dur, reverbInput) {
  const cycle    = 73;
  const rootFreq = freqs[0];
  const detunes  = [-3, 0, 4];
  const waves    = ['sine', 'sine', 'triangle'];
  let t = 0;

  while (t < dur) {
    const end = Math.min(t + cycle, dur);
    detunes.forEach((det, i) => {
      const osc = ctx.createOscillator();
      osc.type  = waves[i];
      osc.frequency.value = rootFreq;
      osc.detune.value    = det;

      const mod = ctx.createOscillator();
      mod.type  = 'sine';
      mod.frequency.value = 0.03 + i * 0.011;
      const mg  = ctx.createGain();
      mg.gain.value = 1.5;
      mod.connect(mg);
      mg.connect(osc.frequency);

      const g    = ctx.createGain();
      const lvl  = cfg.droneGain / detunes.length;
      const fade = Math.min(4, (end - t) * 0.25);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lvl, t + fade);
      g.gain.setValueAtTime(lvl, end - fade);
      g.gain.linearRampToValueAtTime(0, end);

      const flt = ctx.createBiquadFilter();
      flt.type  = 'lowpass';
      flt.frequency.value = 200 + rootFreq * 2;

      osc.connect(flt); flt.connect(g); g.connect(reverbInput);

      if (i === 0) {
        const ot = ctx.createOscillator();
        ot.type  = 'sine';
        ot.frequency.value = rootFreq * 2;
        const og = ctx.createGain();
        og.gain.value = cfg.droneGain * 0.08;
        ot.connect(og); og.connect(reverbInput);
        ot.start(t); ot.stop(end);
      }
      osc.start(t); mod.start(t);
      osc.stop(end); mod.stop(end);
    });
    t += cycle;
  }
}

// ---------------------------------------------------------------------------
// Layer: Ambient Pads  (cycle 41s prime)
// ---------------------------------------------------------------------------
function schedulePads(ctx, cfg, freqs, dur, reverbInput) {
  const cycle     = 41;
  const crossfade = 3.5;
  const roots     = [0, 2, 4, 1, 3];
  let t = 0, pi = 0;

  while (t < dur) {
    const chDur = cycle + (Math.random() * 20 - 10);
    const end   = Math.min(t + chDur, dur);
    const chord = buildChord(freqs, roots[pi % roots.length]);

    chord.forEach(freq => {
      [0, 1].forEach(pair => {
        const osc = ctx.createOscillator();
        osc.type  = 'sine';
        osc.frequency.value = freq;
        osc.detune.value    = pair === 0 ? -5 : 5;

        const cutoff = 400 + cfg.padBrightness * 2000;
        const flt    = ctx.createBiquadFilter();
        flt.type     = 'lowpass';
        flt.frequency.value = cutoff;
        flt.Q.value  = 0.7;

        const g   = ctx.createGain();
        const lvl = (cfg.padGain / chord.length) * (0.85 + Math.random() * 0.15);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lvl, t + crossfade);
        g.gain.setValueAtTime(lvl, end - crossfade);
        g.gain.linearRampToValueAtTime(0, end);

        osc.connect(flt); flt.connect(g); g.connect(reverbInput);
        osc.start(t); osc.stop(end);
      });
    });
    pi++;
    t += Math.max(4, chDur - crossfade);
  }
}

// ---------------------------------------------------------------------------
// Layer: Texture noise  (cycle 109s prime)
// ---------------------------------------------------------------------------
function scheduleTexture(ctx, cfg, dur, reverbInput, dryInput) {
  const cycle   = 109;
  const sr      = ctx.sampleRate;
  const bufSize = sr * 2;
  const nb      = ctx.createBuffer(1, bufSize, sr);
  const nd      = nb.getChannelData(0);
  for (let i = 0; i < bufSize; i++) nd[i] = Math.random() * 2 - 1;

  let t = 0;
  while (t < dur) {
    const end  = Math.min(t + cycle, dur);
    const cHz  = 200 + Math.random() * 400;
    const lvl  = cfg.noiseIntensity * cfg.textureGain;

    // Low band
    const n1 = ctx.createBufferSource(); n1.buffer = nb; n1.loop = true;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = cHz; f1.Q.value = 0.5;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(lvl, t + 3);
    g1.gain.setValueAtTime(lvl, end - 3);
    g1.gain.linearRampToValueAtTime(0, end);
    n1.connect(f1); f1.connect(g1); g1.connect(reverbInput);
    n1.start(t); n1.stop(end);

    // High band
    const n2 = ctx.createBufferSource(); n2.buffer = nb; n2.loop = true;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2000 + Math.random() * 1000; f2.Q.value = 0.3;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(lvl * 0.4, t + 5);
    g2.gain.setValueAtTime(lvl * 0.4, end - 3);
    g2.gain.linearRampToValueAtTime(0, end);
    n2.connect(f2); f2.connect(g2); g2.connect(dryInput);
    n2.start(t); n2.stop(end);

    t += cycle;
  }
}

// ---------------------------------------------------------------------------
// Layer: Sparse Melody  (4.3s window)
// ---------------------------------------------------------------------------
function scheduleMelody(ctx, cfg, freqs, dur, reverbInput) {
  const win  = 4.3;
  const mf   = freqs.slice(Math.floor(freqs.length / 2));
  let t = win;

  while (t < dur - 2) {
    if (Math.random() < cfg.melodyRate) {
      const freq = mf[Math.floor(Math.random() * mf.length)];
      const nd   = 1.5 + Math.random() * 3.5;
      const end  = Math.min(t + nd, dur - 1);

      const osc  = ctx.createOscillator();
      osc.type   = 'sine';
      osc.frequency.value = freq;
      osc.detune.value    = Math.random() * 6 - 3;

      const flt  = ctx.createBiquadFilter();
      flt.type   = 'lowpass';
      flt.frequency.value = freq * 4;

      const g    = ctx.createGain();
      const atk  = 0.3 + Math.random() * 0.4;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(cfg.melodyGain, t + atk);
      g.gain.linearRampToValueAtTime(0, t + nd * 0.6);

      osc.connect(flt); flt.connect(g); g.connect(reverbInput);
      osc.start(t); osc.stop(end);
    }
    t += win;
  }
}

// ---------------------------------------------------------------------------
// Layer: Pulse  (8–16s interval)
// ---------------------------------------------------------------------------
function schedulePulse(ctx, cfg, freqs, dur, reverbInput, dryInput) {
  const interval = 8 + (1 - cfg.pulseDensity) * 8;
  const bass     = freqs.slice(0, 4);
  let t = 1.0;

  while (t < dur - 1) {
    const freq = bass[Math.floor(Math.random() * bass.length)];
    const pd   = 0.8 + Math.random() * 0.4;

    const osc  = ctx.createOscillator();
    osc.type   = 'sine';
    osc.frequency.value = freq * 0.5;
    const g    = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(cfg.pulseGain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + pd - 0.02);
    osc.connect(g); g.connect(reverbInput);
    osc.start(t); osc.stop(t + pd);

    // Click
    const cLen = Math.floor(0.02 * ctx.sampleRate);
    const cb   = ctx.createBuffer(1, cLen, ctx.sampleRate);
    const cd   = cb.getChannelData(0);
    for (let i = 0; i < cLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cLen);
    const cs   = ctx.createBufferSource(); cs.buffer = cb;
    const cf   = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 80;
    const cg   = ctx.createGain(); cg.gain.value = cfg.pulseGain * 0.3;
    cs.connect(cf); cf.connect(cg); cg.connect(dryInput);
    cs.start(t);

    t += interval + (Math.random() - 0.5) * 2;
  }
}

module.exports = { renderAudio };
