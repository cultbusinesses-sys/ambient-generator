/**
 * illusion-visual.js
 * ------------------
 * Geometric illusion visual for the Ambient Generator.
 * Renders a series of nested, counter-rotating geometric rings and
 * Lissajous-style mesh grids that create a hypnotic, meditative depth effect.
 *
 * Design:
 *   - 3 layers of nested geometry: outer rings, middle mesh, inner core
 *   - Outer rings: 8 wireframe icosahedra at different scales, rotating
 *   - Middle layer: a flat grid of intersecting lines forming Moiré patterns
 *   - Inner core: slowly pulsing torus knot
 *   - All rotation speeds are irrational multiples of each other (never align)
 *   - Audio amplitude: expands scale, brightens edges, speeds up rotation
 *   - Loop period: 24 seconds for outer rings (all phases coherent at t=24)
 *   - Color palette: near-black background, white-to-silver lines, no color
 *
 * GPU approach:
 *   - All geometry is static (no per-frame buffer updates)
 *   - Animation is driven entirely by rotation transforms — zero allocation per frame
 *   - This makes it the lightest of the three visuals
 *
 * Extends VisualModuleBase from visual-engine.js.
 */

import { VisualModuleBase } from './visual-engine.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RING_COUNT    = 8;      // outer wireframe rings
const LOOP_PERIOD   = 24;     // seconds — outer ring loop
const BASE_ROT_SPEED = 0.22;  // radians/sec base rotation speed

// Rotation speed multipliers — irrational numbers ensure non-repeating patterns
const ROT_SPEEDS = [1.0, 1.618, 0.618, 2.414, 0.414, 1.732, 0.577, 2.236];

// ---------------------------------------------------------------------------
// IllusionVisual
// ---------------------------------------------------------------------------

export class IllusionVisual extends VisualModuleBase {

  constructor(engine) {
    super(engine, 'illusion');
    this._elapsed    = 0;
    this._rings      = [];   // outer wireframe objects
    this._gridLines  = [];   // middle layer lines
    this._core       = null; // inner torus knot
    this._moireGroup = null; // container for grid
    this._outerGroup = null; // container for rings
  }

  // ---------------------------------------------------------------------------
  // start()
  // ---------------------------------------------------------------------------

  async start() {
    const { THREE, scene, camera } = this;

    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    // Randomize every load — different geometry, speed, and arrangement
    const ringCount   = 5 + Math.floor(Math.random() * 6);    // 5–10 rings
    const speedBase   = 0.1 + Math.random() * 0.25;           // 0.1–0.35 rad/s
    const colorHue    = Math.random();                          // full wheel
    const useKnot     = Math.random() > 0.4;                   // 60% chance of knot
    // Random knot parameters
    const knotP = [2, 3, 2, 5, 3][Math.floor(Math.random() * 5)];
    const knotQ = [3, 2, 5, 2, 7][Math.floor(Math.random() * 5)];

    // ── Outer group ──────────────────────────────────────────────────────────
    this._outerGroup = new THREE.Group();
    scene.add(this._outerGroup);
    this._objects.push(this._outerGroup);

    const geoTypes = ['icosa', 'octa', 'tetra', 'dodeca'];
    const rotSpeeds = [];

    for (let i = 0; i < ringCount; i++) {
      const t       = i / (ringCount - 1);
      const scale   = 0.4 + t * 3.2;
      const opacity = 0.05 + (1 - t) * 0.25;
      const gt      = geoTypes[i % geoTypes.length];

      let geo;
      if (gt === 'icosa')  geo = new THREE.IcosahedronGeometry(1, 1);
      else if (gt === 'octa')  geo = new THREE.OctahedronGeometry(1, 1);
      else if (gt === 'tetra') geo = new THREE.TetrahedronGeometry(1, 1);
      else                     geo = new THREE.IcosahedronGeometry(1, 0);

      const hue = (colorHue + t * 0.15) % 1;
      const color = new THREE.Color().setHSL(hue, 0.15, 0.55 + (1-t) * 0.35);

      const mat  = new THREE.MeshBasicMaterial({
        color, wireframe: true, transparent: true, opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(scale);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

      this._outerGroup.add(mesh);
      this._rings.push({
        mesh,
        speed: ROT_SPEEDS[i % ROT_SPEEDS.length] * speedBase,
        scale, opacity, index: i,
      });
      rotSpeeds.push(ROT_SPEEDS[i % ROT_SPEEDS.length] * speedBase);
    }

    // ── Moiré grid ───────────────────────────────────────────────────────────
    this._moireGroup = new THREE.Group();
    scene.add(this._moireGroup);
    this._objects.push(this._moireGroup);

    const gridLines = 16 + Math.floor(Math.random() * 8);
    const gridSize  = 4.5 + Math.random() * 2;
    const gridOp    = 0.06 + Math.random() * 0.06;
    const moireRot  = 0.05 + Math.random() * 0.08;

    for (const [dx, dy] of [[0, 1], [1, 0]]) {
      const grp = new THREE.Group();
      if (dy === 1) grp.rotation.z = moireRot;
      for (let i = 0; i <= gridLines; i++) {
        const v = (i / gridLines - 0.5) * gridSize * 2;
        const pts = [
          new THREE.Vector3(dx ? v : -gridSize, dy ? v : -gridSize, 0),
          new THREE.Vector3(dx ? v :  gridSize, dy ? v :  gridSize, 0),
        ];
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        const lm = new THREE.LineBasicMaterial({
          color: new THREE.Color().setHSL(colorHue, 0.1, 0.6),
          transparent: true, opacity: gridOp,
        });
        const ln = new THREE.Line(lg, lm);
        grp.add(ln);
        this._gridLines.push(ln);
      }
      this._moireGroup.add(grp);
    }
    this._moireGroup.position.z = -0.5;

    // ── Inner core ───────────────────────────────────────────────────────────
    if (useKnot) {
      const coreGeo = new THREE.TorusKnotGeometry(0.55, 0.05, 120, 12, knotP, knotQ);
      const coreMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(colorHue, 0.3, 0.7),
        wireframe: true, transparent: true, opacity: 0.4,
      });
      this._core = new THREE.Mesh(coreGeo, coreMat);
    } else {
      const coreGeo = new THREE.TorusGeometry(0.6, 0.08, 16, 80);
      const coreMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(colorHue, 0.2, 0.7),
        wireframe: true, transparent: true, opacity: 0.35,
      });
      this._core = new THREE.Mesh(coreGeo, coreMat);
    }
    scene.add(this._core);
    this._objects.push(this._core);
  }

  // ---------------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------------

  update(delta, audioData) {
    this._elapsed += delta;
    const t   = this._elapsed;
    const amp = audioData?.[0] ?? 0;

    // Audio-driven scale pulse
    const scalePulse = 1.0 + amp * 0.18;

    // ── Outer rings ──────────────────────────────────────────────────────────
    for (let i = 0; i < this._rings.length; i++) {
      const { mesh, speed, opacity } = this._rings[i];

      // Each ring rotates at its own irrational speed on all three axes,
      // but with different axis weightings for visual variety
      mesh.rotation.x += delta * speed * 0.4;
      mesh.rotation.y += delta * speed * 0.7;
      mesh.rotation.z += delta * speed * 0.2;

      // Scale: breathe slowly + audio pulse
      const breathe = 1 + 0.04 * Math.sin(t * 0.3 + i * 0.8);
      mesh.scale.setScalar(this._rings[i].scale * breathe * scalePulse);

      // Opacity: audio brightens inner rings
      const audioBoost = amp * (1 - i / RING_COUNT) * 0.3;
      mesh.material.opacity = opacity + audioBoost;
    }

    // ── Outer group slow rotation ────────────────────────────────────────────
    if (this._outerGroup) {
      this._outerGroup.rotation.y = Math.sin(t * 0.04) * 0.2;
      this._outerGroup.rotation.x = Math.cos(t * 0.03) * 0.15;
      this._outerGroup.scale.setScalar(scalePulse);
    }

    // ── Moiré grid slow rotation ─────────────────────────────────────────────
    if (this._moireGroup) {
      this._moireGroup.rotation.z += delta * 0.006;
      this._moireGroup.scale.setScalar(1.0 + amp * 0.12);

      // Slightly modulate opacity of all grid lines with audio
      this._gridLines.forEach((line, i) => {
        line.material.opacity = 0.05 + amp * 0.08 + Math.sin(t * 0.2 + i * 0.15) * 0.02;
      });
    }

    // ── Inner core ───────────────────────────────────────────────────────────
    if (this._core) {
      this._core.rotation.x += delta * 0.31;  // √2 / 4 — irrational
      this._core.rotation.y += delta * 0.19;  // 1/√(2π) approx
      this._core.rotation.z += delta * 0.41;

      // Core pulses with audio
      const coreScale = 1.0 + amp * 0.35;
      this._core.scale.setScalar(coreScale);
      this._core.material.opacity = 0.25 + amp * 0.45;
    }

    // ── Camera gentle sway ───────────────────────────────────────────────────
    this.camera.position.x = Math.sin(t * 0.05) * 0.15;
    this.camera.position.y = Math.cos(t * 0.04) * 0.12;
    this.camera.lookAt(0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  dispose() {
    super.dispose();
    this._rings     = [];
    this._gridLines = [];
    this._core      = null;
    this._moireGroup = null;
    this._outerGroup = null;
  }
}
