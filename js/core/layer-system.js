/**
 * layer-system.js
 * ---------------
 * Abstracts each of the 5 audio layers into independent, manageable objects.
 *
 * Why this exists:
 *   music-generator.js schedules everything in one pass. layer-system.js
 *   wraps that concept so each layer can be individually:
 *     - enabled / disabled before a render
 *     - given its own volume, pan, and filter
 *     - registered / unregistered from the engine without touching other layers
 *     - inspected (name, type, parameters) by the UI
 *
 * Architecture:
 *
 *   LayerSystem                    — registry: holds all 5 layers
 *     └─ Layer (base class)        — common interface: volume, pan, filter, mute
 *         ├─ DroneLayer
 *         ├─ PadLayer
 *         ├─ TextureLayer
 *         ├─ MelodyLayer
 *         └─ PulseLayer
 *
 * Usage:
 *   const system = new LayerSystem(engine, config);
 *   system.build(scaleFreqs);                // creates all 5 layer objects
 *   system.getLayer('drone').setVolume(0.5); // tweak individual layers
 *   system.scheduleAll();                    // writes audio events to context
 */

// AudioEngine is referenced only in JSDoc @param annotations below.
// No runtime import needed — avoids a circular-style coupling at load time.

// ---------------------------------------------------------------------------
// Layer — Base Class
// ---------------------------------------------------------------------------

export class Layer {
  /**
   * @param {string}      name    - 'drone' | 'pads' | 'texture' | 'melody' | 'pulse'
   * @param {string}      label   - Display name: 'Deep Drone' etc.
   * @param {AudioEngine} engine
   */
  constructor(name, label, engine) {
    this.name   = name;
    this.label  = label;
    this.engine = engine;
    this.ctx    = engine.context;

    this._volume = 1.0;   // 0–1 multiplier on all gain nodes
    this._pan    = 0;     // -1 to 1
    this._muted  = false;
  }

  // ---------------------------------------------------------------------------
  // Public API — set before scheduleAll()
  // ---------------------------------------------------------------------------

  setVolume(v) { this._volume = Math.max(0, Math.min(1, v)); return this; }
  setPan(p)    { this._pan    = Math.max(-1, Math.min(1, p)); return this; }
  mute()       { this._muted  = true;  return this; }
  unmute()     { this._muted  = false; return this; }
  toggle()     { this._muted  = !this._muted; return this; }

  get isMuted() { return this._muted; }
  get volume()  { return this._volume; }
  get pan()     { return this._pan; }

  describe() {
    return {
      name:   this.name,
      label:  this.label,
      volume: this._volume,
      pan:    this._pan,
      muted:  this._muted,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Returns gain value * layer volume, or 0 if muted. */
  _effectiveGain(baseGain) {
    if (this._muted) return 0;
    return baseGain * this._volume;
  }

  // ---------------------------------------------------------------------------
  // Override in subclasses
  // ---------------------------------------------------------------------------

  /**
   * @param {Object}   config     - resolved music config
   * @param {number[]} scaleFreqs - prebuilt frequency array
   */
  schedule(config, scaleFreqs) {
    throw new Error(`Layer "${this.name}": schedule() must be implemented`);
  }
}

// ---------------------------------------------------------------------------
// DroneLayer — Layer 1
// ---------------------------------------------------------------------------

export class DroneLayer extends Layer {
  constructor(engine) { super('drone', 'Deep Drone', engine); }

  schedule(config, scaleFreqs) {
    const ctx      = this.ctx;
    const cycle    = 73;                      // prime seconds
    const rootFreq = scaleFreqs[0];
    const baseGain = this._effectiveGain(config.droneGain);
    if (baseGain === 0) return;

    let t = 0;
    while (t < this.engine.duration) {
      const segEnd  = Math.min(t + cycle, this.engine.duration);
      const detunes = [-3, 0, 4];
      const waves   = ['sine', 'sine', 'triangle'];

      detunes.forEach((detune, i) => {
        // Main oscillator
        const osc = ctx.createOscillator();
        osc.type  = waves[i];
        osc.frequency.value = rootFreq;
        osc.detune.value    = detune;

        // LFO pitch modulation — different rate per oscillator
        const modOsc = ctx.createOscillator();
        modOsc.type  = 'sine';
        modOsc.frequency.value = 0.03 + i * 0.011;
        const modGain = ctx.createGain();
        modGain.gain.value = 1.5;
        modOsc.connect(modGain);
        modGain.connect(osc.frequency);

        // Amplitude envelope
        const gain    = ctx.createGain();
        const level   = baseGain / detunes.length;
        const fadeLen = Math.min(4, (segEnd - t) * 0.25);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + fadeLen);
        gain.gain.setValueAtTime(level, segEnd - fadeLen);
        gain.gain.linearRampToValueAtTime(0, segEnd);

        // Breathing low-pass filter
        const filter = this.engine.createFilter('lowpass', 200 + rootFreq * 2);
        const mod    = Math.sin(t / cycle * Math.PI);
        filter.frequency.setValueAtTime(200 + rootFreq * 2 * (0.5 + mod * 0.5), t);
        filter.frequency.linearRampToValueAtTime(200 + rootFreq * 2, segEnd);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engine.reverbInput);

        // Quiet overtone at 2× on first oscillator
        if (i === 0) {
          const ot     = ctx.createOscillator();
          ot.type      = 'sine';
          ot.frequency.value = rootFreq * 2;
          const otGain = ctx.createGain();
          otGain.gain.value = baseGain * 0.08;
          ot.connect(otGain);
          otGain.connect(this.engine.reverbInput);
          ot.start(t);
          ot.stop(segEnd);
        }

        osc.start(t);
        modOsc.start(t);
        osc.stop(segEnd);
        modOsc.stop(segEnd);
      });

      t += cycle;
    }
  }
}

// ---------------------------------------------------------------------------
// PadLayer — Layer 2
// ---------------------------------------------------------------------------

export class PadLayer extends Layer {
  constructor(engine) { super('pads', 'Ambient Pads', engine); }

  schedule(config, scaleFreqs) {
    const ctx       = this.ctx;
    const cycle     = 41;          // prime seconds
    const crossfade = 3.5;
    const baseGain  = this._effectiveGain(config.padGain);
    if (baseGain === 0) return;

    const progressionRoots = [0, 2, 4, 1, 3];
    let t         = 0;
    let progIndex = 0;

    while (t < this.engine.duration) {
      const dur    = cycle + (Math.random() * 20 - 10);      // 31–61 sec
      const segEnd = Math.min(t + dur, this.engine.duration);
      const rootIdx = progressionRoots[progIndex % progressionRoots.length];

      // Build triad from scale
      const chord = [];
      for (let i = 0; i < 3; i++) {
        chord.push(scaleFreqs[(rootIdx + i * 2) % scaleFreqs.length]);
      }

      chord.forEach(freq => {
        // Two detuned oscillators per voice for chorus width
        [0, 1].forEach(pair => {
          const osc = ctx.createOscillator();
          osc.type  = 'sine';
          osc.frequency.value = freq;
          osc.detune.value    = pair === 0 ? -5 : 5;

          const cutoff = 400 + config.padBrightness * 2000;
          const filter = this.engine.createFilter('lowpass', cutoff, 0.7);
          filter.frequency.setValueAtTime(cutoff * 0.8, t);
          filter.frequency.linearRampToValueAtTime(cutoff * 1.1, t + dur * 0.5);
          filter.frequency.linearRampToValueAtTime(cutoff * 0.9, segEnd);

          const gain  = ctx.createGain();
          const level = (baseGain / chord.length) * (0.85 + Math.random() * 0.15);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(level, t + crossfade);
          gain.gain.setValueAtTime(level, segEnd - crossfade);
          gain.gain.linearRampToValueAtTime(0, segEnd);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.engine.reverbInput);
          osc.start(t);
          osc.stop(segEnd);
        });
      });

      progIndex++;
      t += Math.max(4, dur - crossfade);
    }
  }
}

// ---------------------------------------------------------------------------
// TextureLayer — Layer 3
// ---------------------------------------------------------------------------

export class TextureLayer extends Layer {
  constructor(engine) { super('texture', 'Texture', engine); }

  schedule(config, scaleFreqs) {
    const ctx      = this.ctx;
    const cycle    = 109;          // prime seconds
    const baseGain = this._effectiveGain(config.noiseIntensity * config.textureGain);
    if (baseGain === 0) return;

    // Build noise buffer once and reuse (loop = true)
    const bufSize     = ctx.sampleRate * 2;
    const noiseBuf    = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const noiseData   = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) noiseData[i] = Math.random() * 2 - 1;

    let t = 0;
    while (t < this.engine.duration) {
      const segEnd    = Math.min(t + cycle, this.engine.duration);
      const centreHz  = 200 + Math.random() * 400;
      const sweepTo   = centreHz * (0.6 + Math.random() * 0.8);

      // Low band — reverb send
      const nLow  = ctx.createBufferSource();
      nLow.buffer = noiseBuf;
      nLow.loop   = true;
      const fLow  = this.engine.createFilter('bandpass', centreHz, 0.5);
      fLow.frequency.setValueAtTime(centreHz, t);
      fLow.frequency.linearRampToValueAtTime(sweepTo, t + cycle * 0.5);
      fLow.frequency.linearRampToValueAtTime(centreHz, segEnd);
      const gLow  = ctx.createGain();
      gLow.gain.setValueAtTime(0, t);
      gLow.gain.linearRampToValueAtTime(baseGain, t + 3);
      gLow.gain.setValueAtTime(baseGain, segEnd - 3);
      gLow.gain.linearRampToValueAtTime(0, segEnd);
      nLow.connect(fLow);
      fLow.connect(gLow);
      gLow.connect(this.engine.reverbInput);
      nLow.start(t);
      nLow.stop(segEnd);

      // High band — dry send (air presence)
      const nHigh  = ctx.createBufferSource();
      nHigh.buffer = noiseBuf;
      nHigh.loop   = true;
      const fHigh  = this.engine.createFilter('bandpass', 2000 + Math.random() * 1000, 0.3);
      const gHigh  = ctx.createGain();
      gHigh.gain.setValueAtTime(0, t);
      gHigh.gain.linearRampToValueAtTime(baseGain * 0.4, t + 5);
      gHigh.gain.setValueAtTime(baseGain * 0.4, segEnd - 3);
      gHigh.gain.linearRampToValueAtTime(0, segEnd);
      nHigh.connect(fHigh);
      fHigh.connect(gHigh);
      gHigh.connect(this.engine.dryInput);
      nHigh.start(t);
      nHigh.stop(segEnd);

      t += cycle;
    }
  }
}

// ---------------------------------------------------------------------------
// MelodyLayer — Layer 4
// ---------------------------------------------------------------------------

export class MelodyLayer extends Layer {
  constructor(engine) { super('melody', 'Sparse Melody', engine); }

  schedule(config, scaleFreqs) {
    const ctx      = this.ctx;
    const window   = 4.3;           // seconds between probability checks
    const prob     = config.melodyRate;
    const baseGain = this._effectiveGain(config.melodyGain);
    if (baseGain === 0) return;

    // Upper octave notes only — more delicate
    const freqs = scaleFreqs.slice(Math.floor(scaleFreqs.length / 2));
    let t = window;

    while (t < this.engine.duration - 2) {
      if (Math.random() < prob) {
        const freq   = freqs[Math.floor(Math.random() * freqs.length)];
        const dur    = 1.5 + Math.random() * 3.5;
        const segEnd = Math.min(t + dur, this.engine.duration - 1);

        const osc    = ctx.createOscillator();
        osc.type     = 'sine';
        osc.frequency.value = freq;
        osc.detune.value    = Math.random() * 6 - 3;     // subtle pitch humanity

        const filter  = this.engine.createFilter('lowpass', freq * 4, 0.6);
        const gain    = ctx.createGain();
        const attack  = 0.3 + Math.random() * 0.4;

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(baseGain, t + attack);
        gain.gain.linearRampToValueAtTime(0, t + dur * 0.6);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engine.reverbInput);
        osc.start(t);
        osc.stop(segEnd);
      }
      t += window;
    }
  }
}

// ---------------------------------------------------------------------------
// PulseLayer — Layer 5
// ---------------------------------------------------------------------------

export class PulseLayer extends Layer {
  constructor(engine) { super('pulse', 'Pulse', engine); }

  schedule(config, scaleFreqs) {
    const ctx          = this.ctx;
    const baseInterval = 8 + (1 - config.pulseDensity) * 8;   // 8–16 sec
    const baseGain     = this._effectiveGain(config.pulseGain);
    if (baseGain === 0) return;

    const bassFreqs = scaleFreqs.slice(0, 4);
    let t = 1.0;

    while (t < this.engine.duration - 1) {
      const freq     = bassFreqs[Math.floor(Math.random() * bassFreqs.length)];
      const pulseDur = 0.8 + Math.random() * 0.4;

      // Sine body
      const osc = ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = freq * 0.5;   // sub-octave
      const gain    = ctx.createGain();
      const attack  = 0.02;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(baseGain, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, t + pulseDur - attack);
      osc.connect(gain);
      gain.connect(this.engine.reverbInput);
      osc.start(t);
      osc.stop(t + pulseDur);

      // Click transient (noise burst)
      const clickLen  = Math.floor(0.02 * ctx.sampleRate);
      const clickBuf  = ctx.createBuffer(1, clickLen, ctx.sampleRate);
      const clickData = clickBuf.getChannelData(0);
      for (let i = 0; i < clickLen; i++) {
        clickData[i] = (Math.random() * 2 - 1) * (1 - i / clickLen);
      }
      const clickSrc    = ctx.createBufferSource();
      clickSrc.buffer   = clickBuf;
      const clickFilter = this.engine.createFilter('bandpass', 80, 0.5);
      const clickGain   = ctx.createGain();
      clickGain.gain.value = baseGain * 0.3;
      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(this.engine.dryInput);
      clickSrc.start(t);

      t += baseInterval + (Math.random() - 0.5) * 2;   // ±1 sec jitter
    }
  }
}

// ---------------------------------------------------------------------------
// LayerSystem — Registry and Orchestrator
// ---------------------------------------------------------------------------

export class LayerSystem {

  /**
   * @param {AudioEngine} engine
   * @param {Object}      config  - resolved music config
   */
  constructor(engine, config) {
    this.engine      = engine;
    this.config      = config;
    this._layers     = new Map();   // name → Layer
    this._scaleFreqs = [];
    this._built      = false;
  }

  // ---------------------------------------------------------------------------
  // Build — must call once after engine.init()
  // ---------------------------------------------------------------------------

  /**
   * Instantiates all 5 layers and registers them.
   * @param {number[]} scaleFreqs - prebuilt scale frequencies
   */
  build(scaleFreqs) {
    this._scaleFreqs = scaleFreqs;

    const layers = [
      new DroneLayer(this.engine),
      new PadLayer(this.engine),
      new TextureLayer(this.engine),
      new MelodyLayer(this.engine),
      new PulseLayer(this.engine),
    ];

    for (const layer of layers) {
      this._layers.set(layer.name, layer);
    }

    this._built = true;
  }

  // ---------------------------------------------------------------------------
  // Layer access
  // ---------------------------------------------------------------------------

  /**
   * Get a single layer by name.
   * @param {'drone'|'pads'|'texture'|'melody'|'pulse'} name
   * @returns {Layer}
   */
  getLayer(name) {
    const layer = this._layers.get(name);
    if (!layer) throw new Error(`LayerSystem: unknown layer "${name}"`);
    return layer;
  }

  /**
   * Returns descriptor objects for all layers — use to build UI.
   * @returns {Array<{name, label, volume, pan, muted}>}
   */
  describeAll() {
    return [...this._layers.values()].map(l => l.describe());
  }

  // ---------------------------------------------------------------------------
  // Schedule all layers
  // ---------------------------------------------------------------------------

  /**
   * Calls schedule() on every layer, writing all events into the context.
   * Must be called before engine.render().
   */
  scheduleAll() {
    if (!this._built) throw new Error('LayerSystem: call build() first');
    for (const layer of this._layers.values()) {
      layer.schedule(this.config, this._scaleFreqs);
    }
  }

  // ---------------------------------------------------------------------------
  // Config update (after randomization)
  // ---------------------------------------------------------------------------

  /**
   * Replaces config values without rebuilding layers.
   * Re-run scheduleAll() on a fresh engine to apply.
   * @param {Partial<Object>} patch
   */
  updateConfig(patch) {
    this.config = { ...this.config, ...patch };
  }
}
