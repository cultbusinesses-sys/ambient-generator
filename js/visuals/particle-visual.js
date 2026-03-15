/**
 * particle-visual.js
 * ------------------
 * Ambient particle field visual for the Ambient Generator.
 * Renders up to 4000 particles drifting slowly through 3D space
 * with audio-reactive glow and GPU instancing for performance.
 *
 * Design:
 *   - 4000 particles in a spherical cloud, radius ~6 world units
 *   - Each particle has a unique drift vector and phase offset
 *   - Particles are rendered as THREE.Points (single draw call — GPU efficient)
 *   - Audio amplitude: particles expand outward, increase in size and brightness
 *   - Loop period: 30 seconds — drift vectors complete one full cycle
 *   - Depth fog: particles farther from camera are dimmer
 *   - Subtle rotation of the entire field on Y and X axes
 *
 * No per-frame object creation. All updates go through typed Float32Arrays
 * stored in the BufferGeometry attributes.
 *
 * Extends VisualModuleBase from visual-engine.js.
 */

import { VisualModuleBase } from './visual-engine.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 4000;
const FIELD_RADIUS   = 5.5;    // initial cloud radius
const DRIFT_SPEED    = 0.28;   // max drift displacement per cycle
const LOOP_PERIOD    = 30;     // seconds — drift completes one full cycle
const BASE_SIZE      = 0.032;  // particle point size (world units)
const AUDIO_SIZE_MAX = 0.08;   // additional size at full amplitude

// ---------------------------------------------------------------------------
// ParticleVisual
// ---------------------------------------------------------------------------

export class ParticleVisual extends VisualModuleBase {

  constructor(engine) {
    super(engine, 'particle');
    this._elapsed   = 0;
    this._points    = null;   // THREE.Points mesh
    this._posAttr   = null;   // BufferAttribute for positions
    this._alphaAttr = null;   // BufferAttribute for per-particle alpha

    // Per-particle data stored in typed arrays (no GC pressure)
    this._origin = null;      // Float32Array [x,y,z] * PARTICLE_COUNT
    this._drift  = null;      // Float32Array [dx,dy,dz] * PARTICLE_COUNT — normalized drift dir
    this._phase  = null;      // Float32Array — random phase offset per particle
    this._speed  = null;      // Float32Array — individual drift speed multiplier
  }

  // ---------------------------------------------------------------------------
  // start()
  // ---------------------------------------------------------------------------

  async start() {
    const { THREE, scene, camera } = this;

    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    // Randomize character every load
    const count       = 1500 + Math.floor(Math.random() * 2500);  // 1500–4000
    const fieldR      = 4 + Math.random() * 3;                    // 4–7
    const driftSpeed  = 0.15 + Math.random() * 0.3;               // 0.15–0.45
    const loopPeriod  = 20 + Math.random() * 20;                   // 20–40s
    const baseSize    = 0.025 + Math.random() * 0.02;             // 0.025–0.045
    // Random tint: 0=white, 0.5=cyan, 0.6=blue, 0.15=warm
    const tintR = 0.8 + Math.random() * 0.2;
    const tintG = 0.8 + Math.random() * 0.2;
    const tintB = 0.8 + Math.random() * 0.2;

    this._particleCount = count;
    this._fieldRadius   = fieldR;
    this._loopPeriod    = loopPeriod;
    this._baseSize      = baseSize;

    this._origin = new Float32Array(count * 3);
    this._drift  = new Float32Array(count * 3);
    this._phase  = new Float32Array(count);
    this._speed  = new Float32Array(count);

    const positions = new Float32Array(count * 3);
    const alphas    = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = fieldR * Math.cbrt(Math.random());

      const ox = r * Math.sin(phi) * Math.cos(theta);
      const oy = r * Math.sin(phi) * Math.sin(theta);
      const oz = r * Math.cos(phi);

      this._origin[i * 3]     = ox;
      this._origin[i * 3 + 1] = oy;
      this._origin[i * 3 + 2] = oz;

      const dtheta = Math.random() * Math.PI * 2;
      const dphi   = Math.random() * Math.PI;
      this._drift[i * 3]     = Math.sin(dphi) * Math.cos(dtheta) * driftSpeed;
      this._drift[i * 3 + 1] = Math.sin(dphi) * Math.sin(dtheta) * driftSpeed;
      this._drift[i * 3 + 2] = Math.cos(dphi) * driftSpeed;

      this._phase[i] = Math.random() * Math.PI * 2;
      this._speed[i] = 0.5 + Math.random() * 0.5;

      positions[i * 3]     = ox;
      positions[i * 3 + 1] = oy;
      positions[i * 3 + 2] = oz;
      alphas[i] = 0.2 + (1 - (oz + fieldR) / (2 * fieldR)) * 0.5;
    }

    const geo = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(positions, 3);
    this._posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._posAttr);

    this._alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this._alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('alpha', this._alphaAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize:        { value: baseSize },
        uGlobalAlpha: { value: 0 },
        uTint:        { value: new THREE.Vector3(tintR, tintG, tintB) },
      },
      vertexShader: `
        attribute float alpha;
        uniform float uSize;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (300.0 / -mvPos.z);
          gl_Position  = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uGlobalAlpha;
        uniform vec3  uTint;
        varying float vAlpha;
        void main() {
          vec2  uv   = gl_PointCoord - 0.5;
          float dist = length(uv);
          if (dist > 0.5) discard;
          float alpha = (1.0 - smoothstep(0.3, 0.5, dist)) * vAlpha * uGlobalAlpha;
          gl_FragColor = vec4(uTint, alpha);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(geo, mat);
    scene.add(this._points);
    this._objects.push(this._points);
    this._uniforms = mat.uniforms;
  }

  // ---------------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------------

  update(delta, audioData) {
    this._elapsed += delta;
    const t          = this._elapsed;
    const amp        = Math.min(1, (audioData?.[0] ?? 0) * 0.5 + 0.1);
    const count      = this._particleCount ?? PARTICLE_COUNT;
    const fieldR     = this._fieldRadius   ?? FIELD_RADIUS;
    const loopPeriod = this._loopPeriod    ?? LOOP_PERIOD;
    const baseSize   = this._baseSize      ?? BASE_SIZE;

    const loopAngle    = (t % loopPeriod) / loopPeriod * Math.PI * 2;
    const expandFactor = 1.0 + amp * 0.3;
    const pos          = this._posAttr.array;
    const alphas       = this._alphaAttr.array;

    for (let i = 0; i < count; i++) {
      const i3     = i * 3;
      const phase  = this._phase[i];
      const speed  = this._speed[i];
      const driftT = Math.sin(loopAngle * speed + phase);

      pos[i3]     = (this._origin[i3]     + this._drift[i3]     * driftT) * expandFactor;
      pos[i3 + 1] = (this._origin[i3 + 1] + this._drift[i3 + 1] * driftT) * expandFactor;
      pos[i3 + 2] = (this._origin[i3 + 2] + this._drift[i3 + 2] * driftT) * expandFactor;

      const z       = pos[i3 + 2];
      const depth   = 1 - (z + fieldR * expandFactor) / (2 * fieldR * expandFactor);
      const flicker = 0.85 + 0.15 * Math.sin(t * 1.1 + phase * 3.3);
      alphas[i] = (0.15 + depth * 0.45 + amp * 0.2) * flicker;
    }

    this._posAttr.needsUpdate   = true;
    this._alphaAttr.needsUpdate = true;

    this._uniforms.uSize.value        = baseSize + amp * AUDIO_SIZE_MAX;
    this._uniforms.uGlobalAlpha.value = Math.min(1, t / 2.0);

    if (this._points) {
      this._points.rotation.y += delta * (0.018 + amp * 0.02);
      this._points.rotation.x  = Math.sin(t * 0.04) * 0.12;
      this._points.rotation.z += delta * 0.004;
    }

    this.camera.position.z = 10 - amp * 1.2;
    this.camera.position.y = Math.sin(t * 0.06) * 0.3;
    this.camera.lookAt(0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  dispose() {
    super.dispose();
    this._points    = null;
    this._posAttr   = null;
    this._alphaAttr = null;
    this._origin    = null;
    this._drift     = null;
    this._phase     = null;
    this._speed     = null;
  }
}
