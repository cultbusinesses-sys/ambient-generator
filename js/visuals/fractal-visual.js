/**
 * fractal-visual.js
 * Animated recursive geometric fractal using shader math.
 * Pattern, color, and animation fully randomized on every load.
 */

import { VisualModuleBase } from './visual-engine.js';

export class FractalVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'fractal');
    this._mesh     = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const hue1   = Math.random();
    const hue2   = (hue1 + 0.4 + Math.random() * 0.3) % 1;
    const speed  = 0.08 + Math.random() * 0.15;
    const zoom   = 0.8 + Math.random() * 1.4;
    const iter   = 48 + Math.floor(Math.random() * 32);   // 48–80 iterations
    const cx     = -0.5 + (Math.random() - 0.5) * 0.8;
    const cy     = (Math.random() - 0.5) * 0.6;

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:   { value: 0 },
        uSpeed:  { value: speed },
        uZoom:   { value: zoom },
        uCenter: { value: new THREE.Vector2(cx, cy) },
        uIter:   { value: iter },
        uC1:     { value: new THREE.Color().setHSL(hue1, 0.7, 0.45) },
        uC2:     { value: new THREE.Color().setHSL(hue2, 0.6, 0.25) },
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
        uniform float    uTime;
        uniform float    uSpeed;
        uniform float    uZoom;
        uniform vec2     uCenter;
        uniform int      uIter;
        uniform vec3     uC1;
        uniform vec3     uC2;
        uniform float    uAmp;
        varying vec2     vUv;

        void main() {
          // Mandelbrot-style iteration in screen space
          vec2 uv = (vUv - 0.5) * 3.5 / uZoom + uCenter;

          // Animate center drift
          uv += vec2(
            sin(uTime * uSpeed * 0.7) * 0.04,
            cos(uTime * uSpeed * 0.5) * 0.04
          );

          vec2  z   = vec2(0.0);
          float n   = 0.0;
          float mag = 0.0;

          for (int i = 0; i < 128; i++) {
            if (i >= uIter) break;
            z    = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + uv;
            mag  = dot(z, z);
            if (mag > 4.0) { n = float(i); break; }
          }

          if (mag <= 4.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          // Smooth coloring
          float smooth_n = n - log2(log2(mag)) + 4.0;
          float t        = smooth_n / float(uIter);
          t              = pow(clamp(t, 0.0, 1.0), 0.5);
          t             *= 1.0 + uAmp * 0.3;

          vec3 col = mix(uC2, uC1, t);
          // Color cycling animation
          float cycle = sin(t * 6.28318 + uTime * uSpeed * 2.0) * 0.5 + 0.5;
          col = mix(col, uC2 * 0.5, cycle * 0.3);

          gl_FragColor = vec4(col * 0.9, 1.0);
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
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.7 + 0.05);

    // Audio pulses zoom
    const amp = this._uniforms.uAmp.value;
    this._uniforms.uZoom.value = (this._uniforms.uZoom.value * 0.99) + (0.8 + amp * 0.4) * 0.01;
  }

  dispose() {
    super.dispose();
    this._mesh     = null;
    this._uniforms = null;
  }
}
