/**
 * nebula-visual.js
 * Drifting cosmic nebula using layered noise shader.
 * Color, density, and drift speed randomized on every load.
 */

import { VisualModuleBase } from './visual-engine.js';

export class NebulaVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'nebula');
    this._mesh     = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const hue1  = Math.random();
    const hue2  = (hue1 + 0.15 + Math.random() * 0.35) % 1;
    const hue3  = (hue1 + 0.5) % 1;
    const speed = 0.04 + Math.random() * 0.1;
    const dens  = 0.6 + Math.random() * 1.2;

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uSpeed: { value: speed },
        uDens:  { value: dens },
        uC1:    { value: new THREE.Color().setHSL(hue1, 0.8, 0.45) },
        uC2:    { value: new THREE.Color().setHSL(hue2, 0.7, 0.35) },
        uC3:    { value: new THREE.Color().setHSL(hue3, 0.5, 0.20) },
        uAmp:   { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSpeed;
        uniform float uDens;
        uniform vec3  uC1;
        uniform vec3  uC2;
        uniform vec3  uC3;
        uniform float uAmp;
        varying vec2  vUv;

        // Smooth value noise
        float hash2(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash2(i), hash2(i + vec2(1,0)), f.x),
            mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), f.x),
            f.y
          );
        }

        // Fractal brownian motion — 5 octaves
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          mat2  m = mat2(1.6, 1.2, -1.2, 1.6);
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p  = m * p;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 p = (vUv - 0.5) * 3.0;
          float t = uTime * uSpeed;

          // Two drifting noise layers
          vec2 q = vec2(fbm(p + t * 0.5), fbm(p + vec2(1.7, 9.2)));
          vec2 r = vec2(fbm(p + 1.0 * q + vec2(1.7, 9.2) + t * 0.3),
                        fbm(p + 1.0 * q + vec2(8.3, 2.8) + t * 0.2));

          float f = fbm(p + r) * uDens;
          f = clamp(f, 0.0, 1.0);
          f = pow(f, 1.2 - uAmp * 0.3);

          vec3 col = mix(uC3, uC2, clamp(f * 2.0, 0.0, 1.0));
          col      = mix(col, uC1,  clamp(f * f * 4.0, 0.0, 1.0));
          col     *= 0.85 + uAmp * 0.2;

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
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.6 + 0.04);
  }

  dispose() {
    super.dispose();
    this._mesh     = null;
    this._uniforms = null;
  }
}
