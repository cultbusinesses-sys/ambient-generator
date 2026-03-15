/**
 * pulse-visual.js
 * Slow radial energy pulses from center — like a heartbeat in total darkness.
 * Multiple overlapping pulse frequencies create Moiré interference patterns.
 * Dim warm charcoal-amber. Deeply meditative.
 * Loop: 24 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class PulseVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'pulse');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    // Slightly different pulse frequencies for interference
    const f1 = 0.8 + Math.random() * 0.4;
    const f2 = 1.1 + Math.random() * 0.5;
    const f3 = 1.4 + Math.random() * 0.4;

    // Dim amber, soft rose, or cool charcoal
    const palettes = [
      new THREE.Vector3(0.20, 0.14, 0.06),  // amber
      new THREE.Vector3(0.18, 0.10, 0.12),  // soft rose
      new THREE.Vector3(0.10, 0.14, 0.18),  // cool charcoal
    ];
    const col = palettes[Math.floor(Math.random() * palettes.length)];

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uF1:   { value: f1 },
        uF2:   { value: f2 },
        uF3:   { value: f3 },
        uColor: { value: col },
        uAmp:  { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uF1, uF2, uF3;
        uniform vec3  uColor;
        uniform float uAmp;
        varying vec2  vUv;

        #define PI 3.14159265358979

        void main() {
          vec2  p    = (vUv - 0.5) * 2.4;
          float r    = length(p);
          float angle = atan(p.y, p.x);

          // Very slow pulses outward
          float speed = 0.15;

          // Three pulse frequencies interfering
          float p1 = sin(r * 6.0 * uF1 - uTime * speed);
          float p2 = sin(r * 6.0 * uF2 - uTime * speed * 1.05);
          float p3 = sin(r * 6.0 * uF3 - uTime * speed * 0.95);

          // Interference pattern
          float v = (p1 + p2 * 0.7 + p3 * 0.5) / 2.2;

          // Angular breathing — very subtle
          float ang = sin(angle * 2.0 + uTime * 0.03) * 0.08;
          v += ang;

          // Convert to positive and extract bright crests
          v = v * 0.5 + 0.5;
          float crest = pow(v, 5.0);

          // Radial fade — bright near center, fades outward
          float fade = exp(-r * 1.2);
          crest *= fade;

          // Outer vignette
          crest *= (1.0 - smoothstep(0.75, 1.0, r));

          // Center glow
          float glow = exp(-r * r * 12.0) * 0.15;

          float brightness = (crest * 0.20 + glow) * (1.0 + uAmp * 0.15);
          brightness = clamp(brightness, 0.0, 0.28);

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
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.5);
  }

  dispose() {
    super.dispose();
    this._mesh = null; this._uniforms = null;
  }
}
