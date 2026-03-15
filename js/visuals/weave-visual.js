/**
 * weave-visual.js
 * Slowly morphing geometric lattice — like looking through ancient carved stone
 * at dim light. Moire weave patterns shift imperceptibly.
 * Dim silver-white on black.
 * Loop: 45 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class WeaveVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'weave');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const freq1 = 4.0 + Math.random() * 4.0;
    const freq2 = freq1 * (0.9 + Math.random() * 0.2); // near-same = Moiré
    const angle = Math.random() * Math.PI * 0.25;

    const palettes = [
      new THREE.Vector3(0.16, 0.18, 0.20),  // cool silver
      new THREE.Vector3(0.14, 0.18, 0.16),  // silver-teal
      new THREE.Vector3(0.20, 0.17, 0.14),  // warm silver
    ];
    const col = palettes[Math.floor(Math.random() * palettes.length)];

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uFreq1: { value: freq1 },
        uFreq2: { value: freq2 },
        uAngle: { value: angle },
        uColor: { value: col },
        uAmp:   { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFreq1, uFreq2;
        uniform float uAngle;
        uniform vec3  uColor;
        uniform float uAmp;
        varying vec2  vUv;

        #define PI 3.14159265358979

        float grid(vec2 p, float freq, float lineWidth) {
          vec2 g = abs(fract(p * freq) - 0.5);
          float line = min(g.x, g.y);
          return 1.0 - smoothstep(0.0, lineWidth, line);
        }

        void main() {
          vec2 p = (vUv - 0.5) * 3.0;

          // Very slow rotation of two grids against each other
          float rot1 = uAngle + uTime * 0.006;
          float rot2 = -uAngle - uTime * 0.005;

          // Rotate first grid
          vec2 p1 = vec2(
            p.x*cos(rot1) - p.y*sin(rot1),
            p.x*sin(rot1) + p.y*cos(rot1)
          );
          // Rotate second grid
          vec2 p2 = vec2(
            p.x*cos(rot2) - p.y*sin(rot2),
            p.x*sin(rot2) + p.y*cos(rot2)
          );

          // Two grids at slightly different frequencies = Moiré
          float g1 = grid(p1, uFreq1, 0.04);
          float g2 = grid(p2, uFreq2, 0.04);

          // Interference — bright where both grids have lines
          float moire = g1 * g2;

          // Single grid glow
          float glow  = (g1 + g2) * 0.12;

          float v = moire + glow;

          // Vignette
          float vig = 1.0 - smoothstep(0.7, 1.1, length(p));
          v *= vig;

          // Very dim output
          float brightness = clamp(v * 0.18 + uAmp * 0.04, 0.0, 0.24);
          vec3  col = uColor * brightness;

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
