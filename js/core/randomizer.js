/**
 * randomizer.js
 * -------------
 * Generates randomized music configurations for the Ambient Generator.
 * Called when the user presses "Random Generate".
 *
 * Responsibilities:
 *   - Randomize all musical parameters (root note, scale, brightness, etc.)
 *   - Provide preset-quality randomization (not fully chaotic — weighted ranges)
 *   - Expose the resulting config so MusicGenerator / LayerSystem can consume it
 *   - Support "locked" parameters (user can pin certain values before randomizing)
 *   - Log what changed so the UI can describe the new sound
 *
 * Usage:
 *   const r = new Randomizer();
 *   const config = r.generate();             // fully random
 *   const config = r.generate({ rootNote: 'A' }); // keep root, randomize rest
 *   console.log(r.describe());               // "Dorian in F# — dark, sparse"
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES = [
  { name: 'pentatonic_minor', label: 'Pentatonic Minor', mood: 'melancholic' },
  { name: 'pentatonic_major', label: 'Pentatonic Major', mood: 'open'        },
  { name: 'natural_minor',    label: 'Natural Minor',    mood: 'dark'        },
  { name: 'dorian',           label: 'Dorian',           mood: 'meditative'  },
  { name: 'lydian',           label: 'Lydian',           mood: 'ethereal'    },
  { name: 'mixolydian',       label: 'Mixolydian',       mood: 'warm'        },
  { name: 'whole_tone',       label: 'Whole Tone',       mood: 'dreamlike'   },
];

/**
 * Density descriptors — used to build human-readable descriptions.
 * Each range maps a 0–1 value to a word.
 */
const DENSITY_WORDS = {
  sparse:  [0,    0.35],
  moderate:[0.35, 0.65],
  rich:    [0.65, 1.0 ],
};

const BRIGHTNESS_WORDS = {
  dark:    [0,    0.3 ],
  warm:    [0.3,  0.6 ],
  bright:  [0.6,  1.0 ],
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Random float between min and max, rounded to dp decimal places. */
function rand(min, max, dp = 2) {
  const v = min + Math.random() * (max - min);
  return parseFloat(v.toFixed(dp));
}

/** Pick a random element from an array. */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Weighted random pick.
 * @param {Array<{value: any, weight: number}>} items
 */
function weightedPick(items) {
  const total  = items.reduce((s, i) => s + i.weight, 0);
  let   cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

/** Clamp a value between min and max. */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Map a 0–1 value to its descriptor word. */
function describeRange(value, ranges) {
  for (const [word, [lo, hi]] of Object.entries(ranges)) {
    if (value >= lo && value < hi) return word;
  }
  return Object.keys(ranges)[Object.keys(ranges).length - 1];
}

// ---------------------------------------------------------------------------
// Randomizer
// ---------------------------------------------------------------------------

export class Randomizer {

  constructor() {
    this._lastConfig      = null;   // most recently generated config
    this._lastScaleMeta   = null;   // scale metadata for describe()
    this._lastRoot        = null;
  }

  // ---------------------------------------------------------------------------
  // Core generate method
  // ---------------------------------------------------------------------------

  /**
   * Generates a full music config.
   * Any keys passed in `locks` will be used as-is instead of randomized.
   *
   * @param {Partial<Object>} [locks] - parameters to keep fixed
   * @returns {Object} full config object ready for MusicGenerator / LayerSystem
   */
  generate(locks = {}) {

    // --- Root note ---
    const rootNote = locks.rootNote ?? pick(ROOT_NOTES);

    // --- Scale — weighted: atmospheric scales more likely ---
    const scaleMeta = locks.scaleName
      ? SCALES.find(s => s.name === locks.scaleName) ?? pick(SCALES)
      : weightedPick([
          { value: SCALES[0], weight: 3 }, // pentatonic minor — most ambient-friendly
          { value: SCALES[1], weight: 2 }, // pentatonic major
          { value: SCALES[2], weight: 2 }, // natural minor
          { value: SCALES[3], weight: 3 }, // dorian — great for ambient
          { value: SCALES[4], weight: 2 }, // lydian
          { value: SCALES[5], weight: 1 }, // mixolydian
          { value: SCALES[6], weight: 2 }, // whole tone — otherworldly
        ]);

    // --- Pad brightness — affects filter cutoff on pad layer ---
    // Weighted toward darker/warmer sounds — avoids harsh bright results
    const padBrightness = locks.padBrightness ?? weightedPick([
      { value: rand(0.1, 0.3), weight: 3 },   // dark
      { value: rand(0.3, 0.6), weight: 4 },   // warm (most common)
      { value: rand(0.6, 0.85),weight: 2 },   // bright
    ]);

    // --- Reverb depth — how spacious the sound feels ---
    const reverbDepth = locks.reverbDepth ?? rand(0.3, 0.85);

    // --- Noise intensity — texture layer presence ---
    const noiseIntensity = locks.noiseIntensity ?? weightedPick([
      { value: rand(0.05, 0.2), weight: 2 },  // subtle
      { value: rand(0.2,  0.45),weight: 4 },  // moderate
      { value: rand(0.45, 0.7), weight: 2 },  // present
    ]);

    // --- Melody rate — probability of a note triggering per 4.3-sec window ---
    const melodyRate = locks.melodyRate ?? weightedPick([
      { value: rand(0.1, 0.2), weight: 3 },   // sparse
      { value: rand(0.2, 0.4), weight: 4 },   // occasional
      { value: rand(0.4, 0.6), weight: 2 },   // active
    ]);

    // --- Pulse density — how frequent the rhythmic hits are ---
    const pulseDensity = locks.pulseDensity ?? rand(0.2, 0.8);

    // --- Per-layer gain values — small random variation around defaults ---
    const droneGain   = locks.droneGain   ?? rand(0.16, 0.28);
    const padGain     = locks.padGain     ?? rand(0.14, 0.22);
    const textureGain = locks.textureGain ?? rand(0.10, 0.18);
    const melodyGain  = locks.melodyGain  ?? rand(0.06, 0.12);
    const pulseGain   = locks.pulseGain   ?? rand(0.07, 0.14);

    // --- Assemble ---
    const config = {
      rootNote,
      scaleName:      scaleMeta.name,
      padBrightness:  clamp(padBrightness,  0, 1),
      reverbDepth:    clamp(reverbDepth,    0, 1),
      noiseIntensity: clamp(noiseIntensity, 0, 1),
      melodyRate:     clamp(melodyRate,     0, 1),
      pulseDensity:   clamp(pulseDensity,   0, 1),
      droneGain,
      padGain,
      textureGain,
      melodyGain,
      pulseGain,
    };

    this._lastConfig    = config;
    this._lastScaleMeta = scaleMeta;
    this._lastRoot      = rootNote;

    return config;
  }

  // ---------------------------------------------------------------------------
  // Partial re-randomize — keep some parameters, re-roll others
  // ---------------------------------------------------------------------------

  /**
   * Re-randomizes only the "feel" parameters (brightness, reverb, noise,
   * density) while keeping the musical key and scale unchanged.
   * Useful for finding a different texture with the same harmonic character.
   *
   * @returns {Object} patched config
   */
  varyTexture() {
    if (!this._lastConfig) return this.generate();
    const patch = this.generate({
      rootNote:  this._lastConfig.rootNote,
      scaleName: this._lastConfig.scaleName,
    });
    this._lastConfig = { ...this._lastConfig, ...patch };
    return this._lastConfig;
  }

  /**
   * Re-randomizes only the musical key (root + scale) while keeping
   * all texture parameters the same.
   *
   * @returns {Object} patched config
   */
  varyKey() {
    if (!this._lastConfig) return this.generate();
    return this.generate({
      padBrightness:  this._lastConfig.padBrightness,
      reverbDepth:    this._lastConfig.reverbDepth,
      noiseIntensity: this._lastConfig.noiseIntensity,
      melodyRate:     this._lastConfig.melodyRate,
      pulseDensity:   this._lastConfig.pulseDensity,
    });
  }

  // ---------------------------------------------------------------------------
  // Describe — human-readable summary for UI feedback
  // ---------------------------------------------------------------------------

  /**
   * Returns a short human-readable description of the last generated config.
   * Example: "Dorian in A — warm, sparse"
   * @returns {string}
   */
  describe() {
    if (!this._lastConfig) return 'No config generated yet';
    const { padBrightness, melodyRate, noiseIntensity } = this._lastConfig;
    const scaleName   = this._lastScaleMeta?.label ?? this._lastConfig.scaleName;
    const brightWord  = describeRange(padBrightness, BRIGHTNESS_WORDS);
    const melodyWord  = describeRange(melodyRate,    DENSITY_WORDS);
    const textureWord = describeRange(noiseIntensity,DENSITY_WORDS);

    return `${scaleName} in ${this._lastRoot} — ${brightWord}, ${melodyWord} melody, ${textureWord} texture`;
  }

  /**
   * Returns a structured summary object — more detailed than describe().
   * @returns {Object}
   */
  summarize() {
    if (!this._lastConfig) return null;
    const c = this._lastConfig;
    return {
      key:        `${this._lastRoot} ${this._lastScaleMeta?.label}`,
      mood:       this._lastScaleMeta?.mood ?? 'ambient',
      brightness: describeRange(c.padBrightness,  BRIGHTNESS_WORDS),
      melody:     describeRange(c.melodyRate,      DENSITY_WORDS),
      texture:    describeRange(c.noiseIntensity,  DENSITY_WORDS),
      pulse:      describeRange(c.pulseDensity,    DENSITY_WORDS),
      config:     { ...c },
    };
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /** The most recently generated config, or null if none generated yet. */
  get lastConfig() {
    return this._lastConfig ? { ...this._lastConfig } : null;
  }

  // ---------------------------------------------------------------------------
  // Static convenience
  // ---------------------------------------------------------------------------

  /**
   * One-line random config — no instance needed.
   * @param {Partial<Object>} [locks]
   * @returns {Object}
   */
  static quick(locks = {}) {
    return new Randomizer().generate(locks);
  }

  /**
   * Returns the full list of available scales with metadata.
   * Use this to populate a scale picker UI.
   * @returns {Array<{name, label, mood}>}
   */
  static scaleList() {
    return SCALES.map(s => ({ ...s }));
  }

  /**
   * Returns the list of valid root note names.
   * @returns {string[]}
   */
  static rootNoteList() {
    return [...ROOT_NOTES];
  }
}
