/**
 * drift-visual.js
 * Slow drifting organic noise — like watching smoke or clouds in total darkness.
 * Muted teal and dark blue-green. Extremely slow movement.
 * Loop: 90 seconds (very slow FBM drift).
 */

import { VisualModuleBase } from './visual-engine.js';

export class DriftVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'drift');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    // Random teal/blue-green or soft purple
    const palettes = [
      { h1: [170, 0.4, 0.12], h2: [200, 0.35, 0.08], h3: [150, 0.3, 0.05] },
      { h1: [240, 0.3, 0.10], h2: [260, 0.35, 0.07], h3: [220, 0.25, 0.04] },
      { h1: [280, 0.3, 0.10], h2: [300, 0.25, 0.07], h3: [260, 0.2, 0.04] },
    ];
    const pal = palettes[Math.floor(Math.random() * palettes.length)];

    const hslToVec3 = ([h, s, l]) => {
      const c = new THREE.Color().setHSL(h/360, s, l);
      return new THREE.Vector3(c.r, c.g, c.b);
    };

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uC1:   { value: hslToVec3(pal.h1) },
        uC2:   { value: hslToVec3(pal.h2) },
        uC3:   { value: hslToVec3(pal.h3) },
        uAmp:  { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float   uTime;
        uniform vec3    uC1;
        uniform vec3    uC2;
        uniform vec3    uC3;
        uniform float   uAmp;
        varying vec2    vUv;

        float hash(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(
            mix(hash(i), hash(i+vec2(1,0)), f.x),
            mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x),
            f.y
          );
        }

        float fbm(vec2 p, int oct) {
          float v=0.0, a=0.5;
          mat2 m = mat2(1.6,1.2,-1.2,1.6);
          for(int i=0;i<6;i++) {
            if(i>=oct) break;
            v += a*noise(p); p=m*p; a*=0.5;
          }
          return v;
        }

        void main() {
          // Very slow drift — time scaled way down
          float t = uTime * 0.018;
          vec2  p = (vUv - 0.5) * 2.5;

          // Two layers of slow-drifting FBM
          vec2 q = vec2(fbm(p + t, 5), fbm(p + vec2(1.7, 9.2), 5));
          vec2 r = vec2(
            fbm(p + 0.8*q + vec2(1.7, 9.2) + t*0.4, 5),
            fbm(p + 0.8*q + vec2(8.3, 2.8) + t*0.3, 5)
          );

          float f = fbm(p + r, 5);
          f = clamp(f, 0.0, 1.0);

          // Very dim output — max brightness ~0.18
          vec3 col = mix(uC3, uC2, clamp(f*2.0, 0.0, 1.0));
          col      = mix(col, uC1, clamp(f*f*3.5, 0.0, 1.0));
          col     *= (0.85 + uAmp * 0.15);

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
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.35);
  }

  dispose() {
    super.dispose();
    this._mesh = null; this._uniforms = null;
  }
}
