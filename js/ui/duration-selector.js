/**
 * duration-selector.js
 * --------------------
 * Standalone duration picker component.
 * Renders preset buttons (5m / 15m / 30m / 1hr / 3hr / 5hr) plus
 * a custom minutes input, and exposes a clean onChange callback.
 *
 * Can be used standalone or is wired automatically by UIController.
 *
 * Usage (standalone):
 *   import { DurationSelector } from './duration-selector.js';
 *   const sel = new DurationSelector('#duration-container', {
 *     defaultKey: '5m',
 *     onChange: (seconds) => console.log('Duration:', seconds),
 *   });
 *
 * Usage (UIController wires it automatically from [data-duration] buttons
 * already present in the HTML — this class is for direct instantiation).
 */

import { SETTINGS } from '../config/settings.js';

// ---------------------------------------------------------------------------
// DurationSelector
// ---------------------------------------------------------------------------

export class DurationSelector {

  /**
   * @param {string|HTMLElement} container  - CSS selector or DOM element
   * @param {Object}             [opts]
   * @param {string}             [opts.defaultKey]  - preset key e.g. '5m'
   * @param {Function}           [opts.onChange]    - called with seconds
   */
  constructor(container, opts = {}) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._container) {
      throw new Error(`DurationSelector: container not found — "${container}"`);
    }

    this._presets   = SETTINGS.DURATION_PRESETS;
    this._activeKey = opts.defaultKey ?? '5m';
    this._onChange  = opts.onChange   ?? (() => {});
    this._value     = this._presets[this._activeKey] ?? SETTINGS.DEFAULT_DURATION;

    this._render();
    this._bind();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render() {
    const presetHTML = Object.entries(this._presets)
      .map(([key]) => {
        const active = key === this._activeKey ? 'active' : '';
        return `<button class="dur-btn ${active}" data-dur-key="${key}">${this._labelFor(key)}</button>`;
      })
      .join('');

    this._container.innerHTML = `
      <div class="dur-selector">
        <div class="dur-presets">${presetHTML}</div>
        <button class="dur-btn" data-dur-key="custom">Custom</button>
        <input
          class="dur-custom-input"
          type="number"
          min="${Math.ceil(SETTINGS.DURATION_MIN_CUSTOM / 60)}"
          max="${Math.floor(SETTINGS.DURATION_MAX_CUSTOM / 60)}"
          placeholder="min"
          style="display:none"
          aria-label="Custom duration in minutes"
        >
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Bind events
  // ---------------------------------------------------------------------------

  _bind() {
    const btns       = this._container.querySelectorAll('[data-dur-key]');
    const customInput = this._container.querySelector('.dur-custom-input');

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.durKey;

        if (key === 'custom') {
          customInput.style.display = 'inline-block';
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          customInput.focus();
          return;
        }

        customInput.style.display = 'none';
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._activeKey = key;
        this._value     = this._presets[key];
        this._onChange(this._value);
      });
    });

    customInput.addEventListener('change', (e) => {
      const minutes = parseFloat(e.target.value);
      if (isNaN(minutes) || minutes <= 0) return;
      const seconds = Math.max(
        SETTINGS.DURATION_MIN_CUSTOM,
        Math.min(SETTINGS.DURATION_MAX_CUSTOM, Math.floor(minutes * 60))
      );
      this._value     = seconds;
      this._activeKey = 'custom';
      this._onChange(seconds);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _labelFor(key) {
    const labels = {
      '5m': '5 min', '15m': '15 min', '30m': '30 min',
      '1hr': '1 hr', '3hr': '3 hr',   '5hr': '5 hr',
    };
    return labels[key] ?? key;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current selected duration in seconds. */
  get value() { return this._value; }

  /** Set the active preset programmatically. */
  setKey(key) {
    const btn = this._container.querySelector(`[data-dur-key="${key}"]`);
    if (btn) btn.click();
  }
}
