/**
 * settings.js
 * -----------
 * Single source of truth for all configuration constants.
 * Import from here — never hardcode values elsewhere.
 *
 * Usage:
 *   import { SETTINGS } from '../config/settings.js';
 *   const { DEFAULT_DURATION, PARTICLE_LIMIT } = SETTINGS;
 */

export const SETTINGS = Object.freeze({

  // ---------------------------------------------------------------------------
  // Audio engine defaults
  // ---------------------------------------------------------------------------
  DEFAULT_DURATION:    300,        // seconds (5 minutes)
  DEFAULT_SAMPLE_RATE: 44100,
  DEFAULT_FADE_OUT:    4,          // seconds of fade-out at end

  // ---------------------------------------------------------------------------
  // Duration presets
  // ---------------------------------------------------------------------------
  DURATION_PRESETS: Object.freeze({
    '5m':   5   * 60,
    '15m':  15  * 60,
    '30m':  30  * 60,
    '1hr':  60  * 60,
    '3hr':  180 * 60,
    '5hr':  300 * 60,
  }),

  DURATION_MIN_CUSTOM: 60,         // minimum seconds for custom duration
  DURATION_MAX_CUSTOM: 21600,      // maximum seconds (6 hours)

  // ---------------------------------------------------------------------------
  // Music layer defaults
  // ---------------------------------------------------------------------------
  DRONE_GAIN:    0.22,
  PAD_GAIN:      0.18,
  TEXTURE_GAIN:  0.14,
  MELODY_GAIN:   0.08,
  PULSE_GAIN:    0.10,

  DRONE_CYCLE:   73,               // prime seconds
  PAD_CYCLE:     41,               // prime seconds
  TEXTURE_CYCLE: 109,              // prime seconds
  MELODY_WINDOW: 4.3,              // probability check interval (seconds)
  PULSE_INTERVAL_MIN: 8,           // minimum pulse interval (seconds)
  PULSE_INTERVAL_MAX: 16,          // maximum pulse interval (seconds)

  // ---------------------------------------------------------------------------
  // Reverb
  // ---------------------------------------------------------------------------
  REVERB_IR_DURATION: 6.0,         // impulse response length in seconds
  REVERB_DECAY:       0.9,         // exponential decay rate
  DEFAULT_REVERB_GAIN: 0.45,
  DEFAULT_DRY_GAIN:    0.65,

  // ---------------------------------------------------------------------------
  // Scales and roots
  // ---------------------------------------------------------------------------
  ROOT_NOTES: Object.freeze(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']),

  SCALES: Object.freeze([
    { name: 'pentatonic_minor', label: 'Pentatonic Minor', mood: 'melancholic' },
    { name: 'pentatonic_major', label: 'Pentatonic Major', mood: 'open'        },
    { name: 'natural_minor',    label: 'Natural Minor',    mood: 'dark'        },
    { name: 'dorian',           label: 'Dorian',           mood: 'meditative'  },
    { name: 'lydian',           label: 'Lydian',           mood: 'ethereal'    },
    { name: 'mixolydian',       label: 'Mixolydian',       mood: 'warm'        },
    { name: 'whole_tone',       label: 'Whole Tone',       mood: 'dreamlike'   },
  ]),

  // ---------------------------------------------------------------------------
  // Visual engine
  // ---------------------------------------------------------------------------
  VISUAL_MODULES: Object.freeze(['wave', 'particle', 'illusion']),
  VISUAL_LABELS:  Object.freeze({
    wave:     'Wave Flow',
    particle: 'Particle Field',
    illusion: 'Illusion Field',
  }),
  DEFAULT_VISUAL:     'wave',
  VISUAL_FOV:         60,
  VISUAL_ANTIALIAS:   true,
  VISUAL_PIXEL_RATIO: 2,           // cap at 2× — 4K screens don't need full ratio

  // ---------------------------------------------------------------------------
  // Particle limits (performance safety)
  // ---------------------------------------------------------------------------
  PARTICLE_COUNT:     4000,        // maximum particles in particle-visual
  PARTICLE_FIELD_R:   5.5,         // sphere radius
  WAVE_LINE_COUNT:    24,          // lines in wave-visual
  WAVE_POINTS:        256,         // vertices per wave line

  // ---------------------------------------------------------------------------
  // Video export
  // ---------------------------------------------------------------------------
  RESOLUTIONS: Object.freeze({
    '1080p': { width: 1920, height: 1080 },
    '2k':    { width: 2560, height: 1440 },
    '4k':    { width: 3840, height: 2160 },
  }),
  DEFAULT_RESOLUTION:   '1080p',
  DEFAULT_VIDEO_BITRATE: 8_000_000,  // 8 Mbps
  DEFAULT_AUDIO_BITRATE: 128,        // kbps
  VIDEO_FPS:             30,

  // ---------------------------------------------------------------------------
  // Export filenames
  // ---------------------------------------------------------------------------
  DEFAULT_FILENAME: 'ambient',

  // ---------------------------------------------------------------------------
  // App UI
  // ---------------------------------------------------------------------------
  APP_NAME:    'Ambient Generator',
  APP_VERSION: '1.0.0',
});
