/**
 * music-generator.js
 * ------------------
 * Schedules all 5 ambient music layers across the full audio duration.
 * Uses prime-number cycle lengths so the pattern takes many hours to repeat.
 *
 * Layers:
 *   1. Deep Drone      — sustained low-frequency foundation
 *   2. Ambient Pads    — slow chord progressions from a chosen scale
 *   3. Texture         — filtered noise / granular atmosphere
 *   4. Sparse Melody   — occasional soft notes from the scale
 *   5. Pulse           — slow, soft rhythmic hits
 *
 * Usage:
 *   const gen = new MusicGenerator(engine, config);
 *   gen.schedule();   // writes all events to the OfflineAudioContext
 */

// AudioEngine is referenced only in JSDoc @param annotations below.
// ---------------------------------------------------------------------------
// Scale Definitions
// ---------------------------------------------------------------------------

/** All scales as semitone intervals above root */
const SCALES = {
  pentatonic_minor: [0, 3, 5, 7, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  natural_minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  whole_tone:       [0, 2, 4, 6, 8, 10],
};

/** Root note names → MIDI note number (octave 2) */
const ROOT_NOTES = {
  C: 36, 'C#': 37, D: 38, 'D#': 39,
  E: 40, F: 41,   'F#': 42, G: 43,
  'G#': 44, A: 45, 'A#': 46, B: 47,
};

/** Convert MIDI note number to frequency in Hz */
function midiToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Build a list of frequencies for a scale across multiple octaves.
 * @param {string} rootName  - e.g. 'A', 'C#'
 * @param {string} scaleName - key in SCALES
 * @param {number} octaves   - how many octaves to span (default 3)
 * @returns {number[]} array of Hz values
 */
function buildScale(rootName, scaleName, octaves = 3) {
  const rootMidi   = ROOT_NOTES[rootName] ?? 45;
  const intervals  = SCALES[scaleName]   ?? SCALES.pentatonic_minor;
  const freqs      = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of intervals) {
      freqs.push(midiToHz(rootMidi + oct * 12 + interval));
    }
  }
  return freqs;
}

// ---------------------------------------------------------------------------
// Chord Builder
// ---------------------------------------------------------------------------

/**
 * Returns a chord (array of frequencies) from a scale.
 * Picks a root from the scale, then stacks 3 notes at diatonic intervals.
 */
function buildChord(scaleFreqs, rootIndex) {
  const chord = [];
  // Pick root, third, fifth from the scale (every 2 steps)
  for (let i = 0; i < 3; i++) {
    const idx = (rootIndex + i * 2) % scaleFreqs.length;
    chord.push(scaleFreqs[idx]);
  }
  return chord;
}

// ---------------------------------------------------------------------------
// MusicGenerator
// ---------------------------------------------------------------------------

export class MusicGenerator {

  /**
   * @param {AudioEngine} engine
   * @param {Object} config  - from randomizer or defaults
   */
  constructor(engine, config) {
    this.engine   = engine;
    this.config   = this._resolveConfig(config);
    this.duration = engine.duration;
    this.ctx      = engine.context;
  }

  // ---------------------------------------------------------------------------
  // Config resolution
  // ---------------------------------------------------------------------------

  _resolveConfig(cfg = {}) {
    return {
      rootNote:       cfg.rootNote       ?? 'A',
      scaleName:      cfg.scaleName      ?? 'pentatonic_minor',
      reverbDepth:    cfg.reverbDepth    ?? 0.5,     // 0–1
      padBrightness:  cfg.padBrightness  ?? 0.4,     // 0–1  (filter cutoff mod)
      noiseIntensity: cfg.noiseIntensity ?? 0.3,     // 0–1
      pulseDensity:   cfg.pulseDensity   ?? 0.5,     // 0–1  (affects pulse interval)
      melodyRate:     cfg.melodyRate     ?? 0.35,    // probability per check window
      droneGain:      cfg.droneGain      ?? 0.22,
      padGain:        cfg.padGain        ?? 0.18,
      textureGain:    cfg.textureGain    ?? 0.14,
      melodyGain:     cfg.melodyGain     ?? 0.08,
      pulseGain:      cfg.pulseGain      ?? 0.10,
    };
  }

  // ---------------------------------------------------------------------------
  // Main entry — schedule all layers
  // ---------------------------------------------------------------------------

  schedule() {
    const scaleFreqs = buildScale(
      this.config.rootNote,
      this.config.scaleName,
      3
    );

    this._scheduleDrone(scaleFreqs);
    this._schedulePads(scaleFreqs);
    this._scheduleTexture();
    this._scheduleMelody(scaleFreqs);
    this._schedulePulse(scaleFreqs);
  }

  // ---------------------------------------------------------------------------
  // Layer 1 — Deep Drone
  // ---------------------------------------------------------------------------
  /**
   * A slowly evolving low drone built from 3 detuned oscillators.
   * Cycle length: 73 seconds (prime).
   * Harmonic distortion simulated with overtone oscillators.
   */
  _scheduleDrone(scaleFreqs) {
    const ctx      = this.ctx;
    const cycle    = 73;   // prime
    const rootFreq = scaleFreqs[0];  // lowest note of scale

    let t = 0;
    while (t < this.duration) {
      const segEnd = Math.min(t + cycle, this.duration);

      // Three slightly detuned oscillators
      const detunes  = [-3, 0, 4];
      const waveforms = ['sine', 'sine', 'triangle'];

      detunes.forEach((detune, i) => {
        const osc = ctx.createOscillator();
        osc.type  = waveforms[i];
        osc.frequency.value = rootFreq;
        osc.detune.value    = detune;

        // Slow frequency modulation — different LFO rate per oscillator
        const lfoRate = 0.03 + i * 0.011;
        const lfoDepth = 1.5;
        const modOsc = ctx.createOscillator();
        modOsc.type = 'sine';
        modOsc.frequency.value = lfoRate;
        const modGain = ctx.createGain();
        modGain.gain.value = lfoDepth;
        modOsc.connect(modGain);
        modGain.connect(osc.frequency);

        const gain  = ctx.createGain();
        const level = this.config.droneGain / detunes.length;

        // Amplitude envelope: fade in, sustain, fade out
        const fadeLen = Math.min(4, (segEnd - t) * 0.25);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + fadeLen);
        gain.gain.setValueAtTime(level, segEnd - fadeLen);
        gain.gain.linearRampToValueAtTime(0, segEnd);

        // Low-pass filter — cutoff slowly breathes
        const filter = this.engine.createFilter('lowpass', 200 + rootFreq * 2);
        const filterMod = Math.sin(t / cycle * Math.PI);
        filter.frequency.setValueAtTime(
          200 + rootFreq * 2 * (0.5 + filterMod * 0.5),
          t
        );
        filter.frequency.linearRampToValueAtTime(
          200 + rootFreq * 2,
          segEnd
        );

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engine.reverbInput);

        // Add a quiet overtone at 2× frequency
        if (i === 0) {
          const overtone = ctx.createOscillator();
          overtone.type = 'sine';
          overtone.frequency.value = rootFreq * 2;
          const overtoneGain = ctx.createGain();
          overtoneGain.gain.value = this.config.droneGain * 0.08;
          overtone.connect(overtoneGain);
          overtoneGain.connect(this.engine.reverbInput);
          overtone.start(t);
          overtone.stop(segEnd);
        }

        osc.start(t);
        modOsc.start(t);
        osc.stop(segEnd);
        modOsc.stop(segEnd);
      });

      t += cycle;
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 2 — Ambient Pads
  // ---------------------------------------------------------------------------
  /**
   * Long, overlapping chords. Each chord crossfades into the next.
   * Cycle length: 41 seconds (prime).
   * Chord duration: 20–60 seconds (randomised per chord).
   */
  _schedulePads(scaleFreqs) {
    const ctx   = this.ctx;
    const cycle = 41;  // prime — chord changes don't align with drone cycle

    // Chord root indices — pick a progression around the scale
    const progressionRoots = [0, 2, 4, 1, 3];

    let t          = 0;
    let progIndex  = 0;
    const crossfade = 3.5;   // seconds of overlap between chords

    while (t < this.duration) {
      const chordDuration = cycle + (Math.random() * 20 - 10); // 31–61 sec
      const segEnd        = Math.min(t + chordDuration, this.duration);
      const rootIdx       = progressionRoots[progIndex % progressionRoots.length];
      const chord         = buildChord(scaleFreqs, rootIdx);

      chord.forEach((freq, voiceIdx) => {
        // Each voice: 2 detuned oscillators for warmth
        [0, 1].forEach(pair => {
          const osc   = ctx.createOscillator();
          osc.type    = 'sine';
          osc.frequency.value = freq;
          osc.detune.value    = pair === 0 ? -5 : 5;  // subtle chorus

          // Brightness filter (padBrightness config)
          const cutoff = 400 + this.config.padBrightness * 2000;
          const filter = this.engine.createFilter('lowpass', cutoff, 0.7);

          // Slowly modulate filter cutoff
          filter.frequency.setValueAtTime(cutoff * 0.8, t);
          filter.frequency.linearRampToValueAtTime(cutoff * 1.1, t + chordDuration * 0.5);
          filter.frequency.linearRampToValueAtTime(cutoff * 0.9, segEnd);

          const gain  = ctx.createGain();
          const level = (this.config.padGain / chord.length) * (0.85 + Math.random() * 0.15);

          // Envelope: crossfade in and out
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
      // Overlap chords — start next chord before current ends
      t += Math.max(4, chordDuration - crossfade);
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 3 — Texture (filtered noise)
  // ---------------------------------------------------------------------------
  /**
   * Slowly breathing noise layer.
   * Cycle length: 109 seconds (prime).
   * Creates atmosphere — wind-like, granular.
   */
  _scheduleTexture() {
    const ctx   = this.ctx;
    const cycle = 109;  // prime
    const bufferSize = this.ctx.sampleRate * 2;  // 2-sec white noise buffer

    // Generate white noise buffer once
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const noiseData   = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    let t = 0;
    while (t < this.duration) {
      const segEnd = Math.min(t + cycle, this.duration);

      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop   = true;

      // Band-pass filter — centre freq slowly sweeps
      const centreFreq = 200 + Math.random() * 400;
      const filter     = this.engine.createFilter('bandpass', centreFreq, 0.5);

      // Sweep filter cutoff across the segment
      const sweepTarget = centreFreq * (0.6 + Math.random() * 0.8);
      filter.frequency.setValueAtTime(centreFreq, t);
      filter.frequency.linearRampToValueAtTime(sweepTarget, t + cycle * 0.5);
      filter.frequency.linearRampToValueAtTime(centreFreq, segEnd);

      // A second, higher band for air
      const filterHigh = this.engine.createFilter('bandpass', 2000 + Math.random() * 1000, 0.3);

      const noiseNode2 = ctx.createBufferSource();
      noiseNode2.buffer = noiseBuffer;
      noiseNode2.loop   = true;

      const gainLow  = ctx.createGain();
      const gainHigh = ctx.createGain();
      const level    = this.config.noiseIntensity * this.config.textureGain;

      gainLow.gain.setValueAtTime(0, t);
      gainLow.gain.linearRampToValueAtTime(level, t + 3);
      gainLow.gain.setValueAtTime(level, segEnd - 3);
      gainLow.gain.linearRampToValueAtTime(0, segEnd);

      gainHigh.gain.setValueAtTime(0, t);
      gainHigh.gain.linearRampToValueAtTime(level * 0.4, t + 5);
      gainHigh.gain.setValueAtTime(level * 0.4, segEnd - 3);
      gainHigh.gain.linearRampToValueAtTime(0, segEnd);

      noiseNode.connect(filter);
      filter.connect(gainLow);
      gainLow.connect(this.engine.reverbInput);

      noiseNode2.connect(filterHigh);
      filterHigh.connect(gainHigh);
      gainHigh.connect(this.engine.dryInput);

      noiseNode.start(t);
      noiseNode2.start(t);
      noiseNode.stop(segEnd);
      noiseNode2.stop(segEnd);

      t += cycle;
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 4 — Sparse Melody
  // ---------------------------------------------------------------------------
  /**
   * Occasional single notes from the scale.
   * Trigger probability checked every 4 seconds (prime-offset: 4.3 sec window).
   * Cycle reference: 29 seconds (prime).
   */
  _scheduleMelody(scaleFreqs) {
    const ctx      = this.ctx;
    const window   = 4.3;     // seconds between probability checks
    const prob     = this.config.melodyRate;

    // Use upper octave notes only (index 5 onwards) for delicacy
    const melodyFreqs = scaleFreqs.slice(Math.floor(scaleFreqs.length / 2));

    let t = window;
    while (t < this.duration - 2) {
      if (Math.random() < prob) {
        const freq     = melodyFreqs[Math.floor(Math.random() * melodyFreqs.length)];
        const noteDur  = 1.5 + Math.random() * 3.5;  // 1.5–5 sec
        const segEnd   = Math.min(t + noteDur, this.duration - 1);

        const osc      = ctx.createOscillator();
        osc.type       = 'sine';
        osc.frequency.value = freq;
        osc.detune.value    = Math.random() * 6 - 3;  // tiny pitch humanity

        const filter = this.engine.createFilter('lowpass', freq * 4, 0.6);

        const gain   = ctx.createGain();
        const attack = 0.3 + Math.random() * 0.4;
        const decay  = noteDur * 0.6;

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(this.config.melodyGain, t + attack);
        gain.gain.linearRampToValueAtTime(0, t + decay);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engine.reverbInput);  // heavy reverb for melody

        osc.start(t);
        osc.stop(segEnd);
      }

      t += window;
    }
  }

  // ---------------------------------------------------------------------------
  // Layer 5 — Pulse
  // ---------------------------------------------------------------------------
  /**
   * Soft, slow rhythmic hits. Sine burst + slight click.
   * Interval: 8–16 seconds, modulated by pulseDensity config.
   * Cycle reference: 17 seconds (prime).
   */
  _schedulePulse(scaleFreqs) {
    const ctx     = this.ctx;
    const baseInterval = 8 + (1 - this.config.pulseDensity) * 8; // 8–16 sec

    // Pulse uses bass notes
    const bassFreqs = scaleFreqs.slice(0, 4);

    let t = 1.0;
    while (t < this.duration - 1) {
      const freq    = bassFreqs[Math.floor(Math.random() * bassFreqs.length)];
      const pulseDur = 0.8 + Math.random() * 0.4;  // 0.8–1.2 sec

      // Sine burst
      const osc      = ctx.createOscillator();
      osc.type       = 'sine';
      osc.frequency.value = freq * 0.5;  // sub-octave for depth

      const gain     = ctx.createGain();
      const attack   = 0.02;
      const release  = pulseDur - attack;

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(this.config.pulseGain, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, t + release);

      // Subtle click (noise transient)
      const clickBuffer = this.ctx.createBuffer(1, Math.floor(0.02 * ctx.sampleRate), ctx.sampleRate);
      const clickData   = clickBuffer.getChannelData(0);
      for (let i = 0; i < clickData.length; i++) {
        clickData[i] = (Math.random() * 2 - 1) * (1 - i / clickData.length);
      }

      const clickSrc  = ctx.createBufferSource();
      clickSrc.buffer = clickBuffer;

      const clickFilter = this.engine.createFilter('bandpass', 80, 0.5);
      const clickGain   = ctx.createGain();
      clickGain.gain.value = this.config.pulseGain * 0.3;

      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(this.engine.dryInput);

      osc.connect(gain);
      gain.connect(this.engine.reverbInput);

      osc.start(t);
      clickSrc.start(t);
      osc.stop(t + pulseDur);

      // Slight jitter on interval for organic feel
      const jitter   = (Math.random() - 0.5) * 2;  // ±1 sec
      t += baseInterval + jitter;
    }
  }
}
