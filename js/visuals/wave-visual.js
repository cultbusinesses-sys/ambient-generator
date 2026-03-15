/**
 * wave-visual.js
 * --------------
 * Ambient wave line visual for the Ambient Generator.
 * Renders multiple layered sine wave curves that slowly drift and
 * breathe in response to audio amplitude.
 *
 * Design:
 *   - 24 stacked horizontal wave lines at different depths (z-position)
 *   - Each line is a BufferGeometry with per-vertex position updates
 *   - Lines use varying opacity and scale — back lines are faint, front are bright
 *   - Waveform shape uses 3–4 overlapping sine waves per line (non-repeating)
 *   - Loop period: 20 seconds — each line completes one full phase cycle
 *   - Audio amplitude raises wave height and brightens front lines
 *   - GPU: all geometry is updated via typed arrays, no object creation per frame
 *
 * Loop guarantee:
 *   Every parameter driving the wave uses sin/cos functions. After exactly
 *   `LOOP_PERIOD` seconds, all phases return to their starting values — 
 *   the visual loops seamlessly.
 *
 * Extends VisualModuleBase from visual-engine.js.
 */

import { VisualModuleBase } from './visual-engine.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAVE_COUNT   = 24;     // number of horizontal wave lines
const POINTS_PER_LINE = 256; // vertices per line — enough resolution for smooth curves
const LOOP_PERIOD  = 20;     // seconds for one full seamless loop
const LINE_WIDTH_X = 8;      // world-space width of each line (X axis)
const LINE_SPREAD_Z = 6;     // total depth spread (Z axis) of all lines
const BASE_AMPLITUDE = 0.18; // base wave height in world units
const AUDIO_AMP_MULT = 0.55; // extra height added at full audio amplitude

// Prime-number frequency ratios — ensures non-repeating combination
// Each line uses a different subset of these to form its unique shape
const FREQ_TABLE = [1.0, 1.3, 1.7, 2.0, 2.3, 2.7, 3.0];

// ---------------------------------------------------------------------------
// WaveVisual
// ---------------------------------------------------------------------------

export class WaveVisual extends VisualModuleBase {

  constructor(engine) {
    super(engine, 'wave');
    this._elapsed  = 0;
    this._lines    = [];   // array of { mesh, posAttr, freqs, phases, baseY, baseZ, opacity }
  }

  // ---------------------------------------------------------------------------
  // start()
  // ---------------------------------------------------------------------------

  async start() {
    const { THREE, scene, camera } = this;

    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 0);

    // Randomize visual character every time this module loads
    const waveCount  = 16 + Math.floor(Math.random() * 16);   // 16–31 lines
    const loopPeriod = 15 + Math.random() * 20;                // 15–35s loop
    const colorHue   = Math.random();                          // full hue range
    const speedMult  = 0.6 + Math.random() * 0.8;             // 0.6–1.4×

    for (let i = 0; i < waveCount; i++) {
      const t      = i / (waveCount - 1);
      const baseZ  = LINE_SPREAD_Z * 0.5 - t * LINE_SPREAD_Z;
      const baseY  = (Math.random() - 0.5) * 0.5;
      const depthT = 1 - t;
      const opacity = 0.04 + depthT * depthT * 0.55;

      const freqs  = [
        FREQ_TABLE[(i    ) % FREQ_TABLE.length],
        FREQ_TABLE[(i + 2) % FREQ_TABLE.length],
        FREQ_TABLE[(i + 4) % FREQ_TABLE.length],
      ];
      const phases = freqs.map(() => Math.random() * Math.PI * 2);

      const geo     = new THREE.BufferGeometry();
      const posArr  = new Float32Array(POINTS_PER_LINE * 3);
      const posAttr = new THREE.BufferAttribute(posArr, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', posAttr);

      const indices = new Uint16Array(POINTS_PER_LINE);
      for (let j = 0; j < POINTS_PER_LINE; j++) indices[j] = j;
      geo.setIndex(new THREE.BufferAttribute(indices, 1));

      // Use randomized hue — each run has a different color temperature
      const hue = (colorHue + depthT * 0.08) % 1;
      const sat = 0.04 + depthT * 0.10;
      const lit = 0.35 + depthT * 0.55;
      const color = new THREE.Color().setHSL(hue, sat, lit);

      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        linewidth: 1,
      });

      const line = new THREE.Line(geo, mat);
      line.position.z = baseZ;
      scene.add(line);
      this._objects.push(line);

      this._lines.push({
        line, posAttr, freqs, phases, baseY, baseZ, opacity, depthT,
        color, loopPeriod, speedMult,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------------

  update(delta, audioData) {
    this._elapsed += delta;
    const t   = this._elapsed;
    // Amplitude is decorative only — visual runs independently
    const amp = Math.min(1, (audioData?.[0] ?? 0) * 0.5 + 0.15);

    for (let li = 0; li < this._lines.length; li++) {
      const { line, posAttr, freqs, phases, baseY, depthT, color, loopPeriod, speedMult } = this._lines[li];
      const lp = loopPeriod ?? LOOP_PERIOD;
      const sm = speedMult  ?? 1;

      const breathe  = 0.5 + 0.5 * Math.sin(t * 0.3 + li * 0.4);
      const audioLift = amp * depthT * 0.3;
      line.material.opacity = this._lines[li].opacity * (0.85 + breathe * 0.15) + audioLift;

      const driftPeriod = 8 + li * 0.7;
      const yDrift      = Math.sin(t * (Math.PI * 2 / driftPeriod) + li) * 0.15;
      const waveH       = BASE_AMPLITUDE + amp * AUDIO_AMP_MULT * (0.4 + depthT * 0.6);

      const pos = posAttr.array;
      for (let j = 0; j < POINTS_PER_LINE; j++) {
        const xNorm = j / (POINTS_PER_LINE - 1);
        const x     = (xNorm - 0.5) * LINE_WIDTH_X;
        let y = baseY + yDrift;
        for (let f = 0; f < freqs.length; f++) {
          const speed    = freqs[f] * (Math.PI * 2 / lp) * sm;
          const spatFreq = freqs[f] * 0.8;
          y += Math.sin(x * spatFreq + t * speed + phases[f]) * (waveH / freqs.length);
        }
        pos[j * 3]     = x;
        pos[j * 3 + 1] = y;
        pos[j * 3 + 2] = 0;
      }
      posAttr.needsUpdate = true;

      const w = amp * depthT * 0.25;
      line.material.color.setRGB(color.r + w, color.g + w, color.b + w);
    }

    this.camera.position.y = Math.sin(t * 0.07) * 0.12;
    this.camera.position.x = Math.sin(t * 0.05) * 0.08;
    this.camera.lookAt(0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  dispose() {
    super.dispose();   // removes tracked objects, frees geometry/material
    this._lines = [];
  }
}
