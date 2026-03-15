/**
 * ripple-visual.js
 * Slow concentric ripples — like a stone dropped in perfectly still dark water.
 * Multiple ripple sources at different positions, interfering with each other.
 * Dim blue-silver on black.
 * Loop: 20 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class RippleVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'ripple');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    // 3-5 ripple centers, randomized
    const centers = [];
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < 5; i++) {
      centers.push(new THREE.Vector2(
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4
      ));
    }

    // Dim blue-silver or soft gold
    const colorChoice = Math.random();
    let baseColor;
    if (colorChoice < 0.4) {
      baseColor = new THREE.Vector3(0.10, 0.14, 0.22); // blue-silver
    } else if (colorChoice < 0.7) {
      baseColor = new THREE.Vector3(0.16, 0.13, 0.08); // dim warm gold
    } else {
      baseColor = new THREE.Vector3(0.08, 0.16, 0.16); // teal
    }

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:    { value: 0 },
        uColor:   { value: baseColor },
        uCount:   { value: count },
        uC0: { value: centers[0] }, uC1: { value: centers[1] },
        uC2: { value: centers[2] }, uC3: { value: centers[3] },
        uC4: { value: centers[4] },
        uAmp:     { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3  uColor;
        uniform int   uCount;
        uniform vec2  uC0, uC1, uC2, uC3, uC4;
        uniform float uAmp;
        varying vec2  vUv;

        float ripple(vec2 p, vec2 center, float speed, float freq) {
          float dist = length(p - center);
          // Outward expanding wave
          float wave = sin(dist * freq - uTime * speed);
          // Envelope — fade with distance
          float env  = exp(-dist * 1.8);
          return wave * env;
        }

        void main() {
          vec2  p = (vUv - 0.5) * 2.8;
          float v = 0.0;

          // Slow ripples — speed ~0.4, slightly different per source
          v += ripple(p, uC0, 0.38, 8.0);
          v += ripple(p, uC1, 0.41, 7.5);
          if (uCount > 2) v += ripple(p, uC2, 0.36, 9.0) * 0.8;
          if (uCount > 3) v += ripple(p, uC3, 0.43, 8.5) * 0.6;
          if (uCount > 4) v += ripple(p, uC4, 0.39, 7.0) * 0.5;

          // Normalize and apply very dim brightness
          v = v * 0.25 + 0.5;
          v = clamp(v, 0.0, 1.0);

          // Edge crest highlighting — bright at crests, dark in troughs
          float crest = pow(v, 4.0);

          // Overall dim
          float brightness = crest * (0.18 + uAmp * 0.05);

          // Vignette
          float vig = 1.0 - smoothstep(0.8, 1.2, length(p));
          brightness *= vig;

          vec3 col = uColor * brightness;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthWrite: false,
    });

    this._mesh     = new THREE.Mesh(geo, mat);
    this._uniforms = mat.uniforms;
    scene.add(this._mesh);
    this._objects.push(this._mesh);
  }

  update(delta, audioData) {
    if (!this._uniforms) return;
    this._uniforms.uTime.value += delta;
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.4);
  }

  dispose() {
    super.dispose();
    this._mesh = null; this._uniforms = null;
  }
}
