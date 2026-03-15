/**
 * audio-engine.js
 * ---------------
 * Core audio rendering engine for the Ambient Generator.
 * Uses OfflineAudioContext for fast (faster-than-realtime) rendering.
 *
 * Responsibilities:
 *   - Create and manage the OfflineAudioContext
 *   - Build the master effects chain (reverb → compressor → master gain)
 *   - Expose connection points for all layers
 *   - Render the full buffer and return it
 *   - Report render progress via callback
 *
 * Usage:
 *   const engine = new AudioEngine({ duration: 600, sampleRate: 44100 });
 *   await engine.init();
 *   // connect layers to engine.reverbInput or engine.dryInput
 *   const buffer = await engine.render((progress) => console.log(progress));
 */

export class AudioEngine {

  /**
   * @param {Object} options
   * @param {number} options.duration      - Duration in seconds
   * @param {number} [options.sampleRate]  - Sample rate (default 44100)
   * @param {number} [options.fadeOut]     - Fade-out duration in seconds (default 4)
   */
  constructor(options = {}) {
    this.duration   = options.duration   ?? 600;
    this.sampleRate = options.sampleRate ?? 44100;
    this.fadeOut    = options.fadeOut    ?? 4;

    this.ctx              = null;   // OfflineAudioContext
    this.masterGain       = null;   // Final output gain node
    this.compressor       = null;   // DynamicsCompressorNode
    this.reverbNode       = null;   // ConvolverNode (wet reverb)
    this.reverbGain       = null;   // Gain for reverb send level
    this.dryGain          = null;   // Gain for dry (direct) signal
    this.reverbInput      = null;   // GainNode — layers connect here for reverb
    this.dryInput         = null;   // GainNode — layers connect here for dry
    this._isInitialized   = false;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Build the full audio graph.
   * Must be called before any layers are connected.
   */
  async init() {
    const totalSamples = Math.ceil(this.duration * this.sampleRate);

    this.ctx = new OfflineAudioContext({
      numberOfChannels: 2,
      length:           totalSamples,
      sampleRate:       this.sampleRate,
    });

    await this._buildMasterChain();
    this._isInitialized = true;
  }

  // ---------------------------------------------------------------------------
  // Master Effects Chain
  // ---------------------------------------------------------------------------

  /**
   * Signal flow:
   *
   *  [reverbInput] ──► [reverbNode] ──► [reverbGain] ─┐
   *                                                     ├──► [compressor] ──► [masterGain] ──► destination
   *  [dryInput]    ──────────────────► [dryGain]    ─┘
   */
  async _buildMasterChain() {
    const ctx = this.ctx;

    // --- Master gain (controls overall output level + fade-out) ---
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(1.0, 0);
    this._scheduleFadeOut();
    this.masterGain.connect(ctx.destination);

    // --- Compressor (gentle mastering glue) ---
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value      = 12;
    this.compressor.ratio.value     = 3;
    this.compressor.attack.value    = 0.15;
    this.compressor.release.value   = 0.5;
    this.compressor.connect(this.masterGain);

    // --- Dry path ---
    this.dryInput = ctx.createGain();
    this.dryInput.gain.value = 1.0;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.65;

    this.dryInput.connect(this.dryGain);
    this.dryGain.connect(this.compressor);

    // --- Wet reverb path ---
    this.reverbInput = ctx.createGain();
    this.reverbInput.gain.value = 1.0;

    const irBuffer = await this._generateImpulseResponse();
    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = irBuffer;
    this.reverbNode.normalize = true;

    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.45;

    this.reverbInput.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain);
    this.reverbGain.connect(this.compressor);
  }

  // ---------------------------------------------------------------------------
  // Impulse Response Generator
  // ---------------------------------------------------------------------------

  /**
   * Generates a synthetic reverb impulse response.
   * Simulates a large hall with slow decay (~6 seconds).
   * No external IR files needed — fully algorithmic.
   *
   * @returns {AudioBuffer}
   */
  async _generateImpulseResponse() {
    const ctx = this.ctx;
    // 2.5 sec IR — shorter = faster init, still lush for ambient.
    // Decay of 1.4 (was 0.9) gives a tighter tail that costs less CPU
    // during the OfflineAudioContext convolution pass.
    const irDuration = 2.5;
    const irLength   = Math.ceil(irDuration * this.sampleRate);
    const irBuffer   = ctx.createBuffer(2, irLength, this.sampleRate);

    // Pre-compute decay curve once instead of calling Math.exp per sample
    const decayArr = new Float32Array(irLength);
    const earlyEnd = Math.floor(0.08 * this.sampleRate);
    for (let i = 0; i < irLength; i++) {
      decayArr[i] = Math.exp(-i / this.sampleRate * 1.4);
    }

    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < irLength; i++) {
        data[i] = (Math.random() * 2 - 1) * decayArr[i] * (i < earlyEnd ? 1.4 : 1.0);
      }
    }

    return irBuffer;
  }

  // ---------------------------------------------------------------------------
  // Fade Out
  // ---------------------------------------------------------------------------

  _scheduleFadeOut() {
    const startFade = Math.max(0, this.duration - this.fadeOut);
    this.masterGain.gain.setValueAtTime(1.0, startFade);
    this.masterGain.gain.linearRampToValueAtTime(0.0, this.duration);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Renders the full audio buffer.
   * Fast — 10 min audio ~3 sec, 1 hr ~10 sec.
   *
   * @param {Function} [onProgress] - Called with (0..1) during render
   * @returns {Promise<AudioBuffer>}
   */
  async render(onProgress) {
    if (!this._isInitialized) {
      throw new Error('AudioEngine: call init() before render()');
    }

    // OfflineAudioContext doesn't natively support progress events,
    // so we use oncomplete and simulate progress via a timer.
    let progressTimer = null;
    let startTime     = Date.now();

    if (onProgress) {
      onProgress(0.01);
      // Estimate render duration (roughly: audio duration / 20 = render time)
      const estimatedMs = (this.duration / 20) * 1000;
      progressTimer = setInterval(() => {
        const elapsed  = Date.now() - startTime;
        const progress = Math.min(0.95, elapsed / estimatedMs);
        onProgress(progress);
      }, 100);
    }

    const buffer = await this.ctx.startRendering();

    if (progressTimer) clearInterval(progressTimer);
    if (onProgress)    onProgress(1.0);

    return buffer;
  }

  // ---------------------------------------------------------------------------
  // Utility: Create nodes on the engine's context
  // ---------------------------------------------------------------------------

  /**
   * Helper for layers to create oscillators, gain nodes, filters etc.
   * on the same OfflineAudioContext.
   */
  get context() {
    return this.ctx;
  }

  /**
   * Create a BiquadFilterNode on the engine context.
   * @param {string} type   - 'lowpass' | 'highpass' | 'bandpass' etc.
   * @param {number} freq   - Frequency in Hz
   * @param {number} [Q]    - Q factor (default 1)
   */
  createFilter(type, freq, Q = 1) {
    const filter      = this.ctx.createBiquadFilter();
    filter.type       = type;
    filter.frequency.value = freq;
    filter.Q.value    = Q;
    return filter;
  }

  /**
   * Create a GainNode on the engine context.
   * @param {number} value - Initial gain value (default 1)
   */
  createGain(value = 1) {
    const gain       = this.ctx.createGain();
    gain.gain.value  = value;
    return gain;
  }

  /**
   * Create a StereoPannerNode.
   * @param {number} pan - -1 (left) to 1 (right)
   */
  createPanner(pan = 0) {
    const panner     = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  }

  /**
   * Schedule a linear ramp on an AudioParam.
   * @param {AudioParam} param
   * @param {number} from
   * @param {number} to
   * @param {number} startTime
   * @param {number} endTime
   */
  ramp(param, from, to, startTime, endTime) {
    param.setValueAtTime(from, startTime);
    param.linearRampToValueAtTime(to, endTime);
  }

  /**
   * Schedule a smooth exponential curve on an AudioParam.
   * Useful for filter sweeps, slow volume modulation.
   */
  smoothRamp(param, from, to, startTime, endTime) {
    const safeFrom = from === 0 ? 0.0001 : from;
    const safeTo   = to   === 0 ? 0.0001 : to;
    param.setValueAtTime(safeFrom, startTime);
    param.exponentialRampToValueAtTime(safeTo, endTime);
  }
}
