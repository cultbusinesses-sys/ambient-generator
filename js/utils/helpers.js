/**
 * helpers.js
 * ----------
 * Shared utility functions for the Ambient Generator.
 * No external dependencies. No side effects.
 *
 * Import only what you need:
 *   import { noteToHz, formatTime, lerp } from '../utils/helpers.js';
 */

// ---------------------------------------------------------------------------
// Audio math
// ---------------------------------------------------------------------------

/**
 * Convert a MIDI note number to frequency in Hz.
 * Middle A = MIDI 69 = 440 Hz.
 *
 * @param {number} note - MIDI note number (0–127)
 * @returns {number} frequency in Hz
 *
 * @example
 *   noteToHz(69)  // 440
 *   noteToHz(60)  // 261.63 (middle C)
 */
export function noteToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Convert a frequency in Hz to the nearest MIDI note number.
 * @param {number} hz
 * @returns {number} MIDI note number (float — not rounded)
 */
export function hzToNote(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Build an array of frequencies for a named scale across multiple octaves.
 *
 * @param {string} rootName  - Root note name: 'A', 'C#', etc.
 * @param {string} scaleName - Scale key: 'pentatonic_minor', 'dorian', etc.
 * @param {number} [octaves] - Number of octaves to span (default 3)
 * @returns {number[]} Sorted array of frequencies in Hz
 *
 * @example
 *   scaleToFreqs('A', 'pentatonic_minor', 2)
 *   // [110, 130.81, 146.83, 164.81, 196, 220, 261.63, ...]
 */
export function scaleToFreqs(rootName, scaleName, octaves = 3) {
  const ROOT_MIDI = {
    C: 36, 'C#': 37, D: 38, 'D#': 39, E: 40,
    F: 41, 'F#': 42, G: 43, 'G#': 44, A: 45,
    'A#': 46, B: 47,
  };
  const SCALE_INTERVALS = {
    pentatonic_minor: [0, 3, 5, 7, 10],
    pentatonic_major: [0, 2, 4, 7, 9],
    natural_minor:    [0, 2, 3, 5, 7, 8, 10],
    dorian:           [0, 2, 3, 5, 7, 9, 10],
    lydian:           [0, 2, 4, 6, 7, 9, 11],
    mixolydian:       [0, 2, 4, 5, 7, 9, 10],
    whole_tone:       [0, 2, 4, 6, 8, 10],
  };

  const rootMidi  = ROOT_MIDI[rootName] ?? 45;
  const intervals = SCALE_INTERVALS[scaleName] ?? SCALE_INTERVALS.pentatonic_minor;
  const freqs     = [];

  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of intervals) {
      freqs.push(noteToHz(rootMidi + oct * 12 + interval));
    }
  }

  return freqs;
}

/**
 * Compute RMS (Root Mean Square) amplitude of an audio buffer window.
 * Returns a 0..1 value.
 *
 * @param {Float32Array} channelData  - raw PCM samples from AudioBuffer.getChannelData(0)
 * @param {number}       startSample
 * @param {number}       windowSize
 * @returns {number} 0..1
 */
export function rmsAmplitude(channelData, startSample, windowSize) {
  const end   = Math.min(startSample + windowSize, channelData.length);
  let   sum   = 0;
  let   count = 0;
  for (let i = startSample; i < end; i++) {
    sum += channelData[i] * channelData[i];
    count++;
  }
  if (count === 0) return 0;
  return Math.min(1, Math.sqrt(sum / count) * 4);
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

/**
 * Linear interpolation between a and b by t.
 * @param {number} a
 * @param {number} b
 * @param {number} t  - 0..1
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a value from one range to another.
 * @param {number} value
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @returns {number}
 */
export function remap(value, inMin, inMax, outMin, outMax) {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, t);
}

/**
 * Smooth step (ease in/out) for t in [0, 1].
 * @param {number} t
 * @returns {number}
 */
export function smoothstep(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Returns a random float between min (inclusive) and max (exclusive).
 * @param {number} min
 * @param {number} max
 * @param {number} [dp]  - decimal places to round to (default: no rounding)
 * @returns {number}
 */
export function randFloat(min, max, dp) {
  const v = min + Math.random() * (max - min);
  return dp !== undefined ? parseFloat(v.toFixed(dp)) : v;
}

/**
 * Returns a random integer between min and max (both inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * Format a duration in seconds as a human-readable string.
 *
 * @param {number} seconds
 * @returns {string}
 *
 * @example
 *   formatTime(30)    // "30s"
 *   formatTime(90)    // "1m 30s"
 *   formatTime(3600)  // "1hr"
 *   formatTime(5400)  // "1hr 30m"
 */
export function formatTime(seconds) {
  const s = Math.round(seconds);
  if (s < 60)   return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r > 0 ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}hr ${m}m` : `${h}hr`;
}

/**
 * Format a duration compactly (no seconds when over 1 minute).
 * Used for button labels and filenames.
 *
 * @param {number} seconds
 * @returns {string}
 *
 * @example
 *   formatTimeShort(300)   // "5m"
 *   formatTimeShort(3600)  // "1hr"
 */
export function formatTimeShort(seconds) {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600 % 1 === 0
    ? seconds / 3600
    : (seconds / 3600).toFixed(1))}hr`;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Shorthand for document.getElementById with a type assertion.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function byId(id) {
  return document.getElementById(id);
}

/**
 * Shorthand for document.querySelector.
 * @param {string} selector
 * @param {HTMLElement} [scope]
 * @returns {HTMLElement|null}
 */
export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

/**
 * Shorthand for document.querySelectorAll, returns an array.
 * @param {string} selector
 * @param {HTMLElement} [scope]
 * @returns {HTMLElement[]}
 */
export function qsa(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}

/**
 * Activate one button in a group, deactivate all others.
 * All elements must have the same parent or share a container.
 *
 * @param {HTMLElement}   target     - the button to activate
 * @param {HTMLElement[]} group      - all buttons in the group
 * @param {string}        [cls]      - active class name (default 'active')
 */
export function activateBtn(target, group, cls = 'active') {
  group.forEach(b => b.classList.remove(cls));
  target.classList.add(cls);
}
