/**
 * plasma-visual.js
 * Animated shader-based plasma. Pure GPU — zero CPU math per frame.
 * Colors, speed, scale fully randomized on every load.
 */

import { VisualModuleBase } from './visual-engine.js';

export class PlasmaVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'plasma');
    this._mesh     = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const hue1  = Math.random();
    const hue2  = (hue1 + 0.25 + Math.random() * 0.5) % 1;
    const hue3  = (hue1 + 0.6) % 1;
    const speed = 0.25 + Math.random() * 0.6;
    const scale = 1.8 + Math.random() * 3.0;
    const twist = Math.random() * 2.0;

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:   { value: 0 },
        uSpeed:  { value: speed },
        uScale:  { value: scale },
        uTwist:  { value: twist },
        uC1:     { value: new THREE.Color().setHSL(hue1, 0.75, 0.35) },
        uC2:     { value: new THREE.Color().setHSL(hue2, 0.65, 0.30) },
        uC3:     { value: new THREE.Color().setHSL(hue3, 0.55, 0.18) },
        uAmp:    { value: 0 },
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
        uniform float uScale;
        uniform float uTwist;
        uniform vec3  uC1;
        uniform vec3  uC2;
        uniform vec3  uC3;
        uniform float uAmp;
        varying vec2  vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec2  p = (vUv - 0.5) * uScale;
          float t = uTime * uSpeed;

          // Multi-layer plasma
          float v = 0.0;
          v += sin(p.x * 1.8 + t);
          v += sin(p.y * 1.6 + t * 0.8);
          v += sin((p.x + p.y) * 1.4 + t * 1.1);
          v += sin(sqrt(p.x*p.x + p.y*p.y) * 2.2 - t * 0.9);
          v += sin(p.x * cos(t * 0.3) * uTwist + p.y * sin(t * 0.2) * uTwist);
          v = v * 0.2 + 0.5;  // normalize to 0..1
          v = pow(clamp(v, 0.0, 1.0), 1.0 + uAmp * 0.6);

          // Three-way color mix
          vec3 col = mix(uC1, uC2, v);
          col      = mix(col, uC3, abs(sin(v * 6.28318)));
          col     *= 0.8 + uAmp * 0.25;

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
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.8 + 0.05);
  }

  dispose() {
    super.dispose();
    this._mesh     = null;
    this._uniforms = null;
  }
}
