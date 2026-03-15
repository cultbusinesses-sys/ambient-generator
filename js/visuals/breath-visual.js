
/**
 * breath-visual.js
 * Slowly breathing mandala — like watching something alive and ancient.
 * Warm dim amber/copper on black. Symmetry that evolves imperceptibly.
 * Loop: 60 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class BreathVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'breath');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const symmetry = [6, 8, 10, 12][Math.floor(Math.random() * 4)];
    const layers   = 4 + Math.floor(Math.random() * 4);
    const hue      = Math.random() > 0.5
      ? 28 + Math.random() * 20   // amber/copper
      : 260 + Math.random() * 30; // dim violet

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uSymmetry: { value: symmetry },
        uLayers:   { value: layers },
        uHue:      { value: hue },
        uAmp:      { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSymmetry;
        uniform float uLayers;
        uniform float uHue;
        uniform float uAmp;
        varying vec2  vUv;

        #define PI 3.14159265358979
        #define TAU 6.28318530717959

        vec3 hsl2rgb(float h, float s, float l) {
          h = mod(h, 360.0) / 360.0;
          float q = l < 0.5 ? l*(1.0+s) : l+s-l*s;
          float p = 2.0*l - q;
          vec3 c;
          c.r = (h+1.0/3.0); c.g = h; c.b = (h-1.0/3.0);
          c = fract(c + 1.0);
          c = mix(vec3(p), vec3(q), clamp(vec3(
            c.r<1.0/6.0 ? p+(q-p)*6.0*c.r :
            c.r<1.0/2.0 ? q :
            c.r<2.0/3.0 ? p+(q-p)*(2.0/3.0-c.r)*6.0 : p,
            c.g<1.0/6.0 ? p+(q-p)*6.0*c.g :
            c.g<1.0/2.0 ? q :
            c.g<2.0/3.0 ? p+(q-p)*(2.0/3.0-c.g)*6.0 : p,
            c.b<1.0/6.0 ? p+(q-p)*6.0*c.b :
            c.b<1.0/2.0 ? q :
            c.b<2.0/3.0 ? p+(q-p)*(2.0/3.0-c.b)*6.0 : p
          ), 0.0, 1.0));
          return c;
        }

        float mandala(vec2 p, float sym, float t) {
          float angle = atan(p.y, p.x);
          float dist  = length(p);

          // Fold into one symmetry slice
          angle = mod(angle, TAU / sym);
          angle = abs(angle - PI / sym);

          // Rebuild point in folded space
          vec2 q = vec2(cos(angle), sin(angle)) * dist;

          float v = 0.0;
          for (float i = 0.0; i < 8.0; i++) {
            if (i >= 4.0) break; // uLayers check workaround
            float r  = 0.15 + i * 0.18;
            float th = t * (0.015 + i * 0.005) * (mod(i, 2.0) == 0.0 ? 1.0 : -1.0);
            vec2  c  = vec2(cos(th), sin(th)) * r;
            float d  = length(q - c);
            v += 0.018 / (d + 0.015);
          }
          return v;
        }

        void main() {
          vec2  p    = (vUv - 0.5) * 2.4;
          float dist = length(p);

          // Very slow breath — scale pulsing
          float breathe = 1.0 + 0.04 * sin(uTime * 0.08);
          p *= breathe;

          // Slow rotation of entire mandala
          float rot = uTime * 0.012;
          vec2  rp  = vec2(p.x*cos(rot)-p.y*sin(rot), p.x*sin(rot)+p.y*cos(rot));

          float v = mandala(rp, uSymmetry, uTime);

          // Radial fade
          v *= (1.0 - smoothstep(0.7, 1.0, dist));
          v *= smoothstep(0.0, 0.12, dist);

          // Very dim — brightness 0.0 to 0.20 max
          float brightness = clamp(v * 0.16 + uAmp * 0.04, 0.0, 0.22);
          vec3  col = hsl2rgb(uHue, 0.5, brightness);

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
