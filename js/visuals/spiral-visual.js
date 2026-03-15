/**
 * spiral-visual.js
 * Deep logarithmic spiral — like staring into a galaxy far away.
 * Arms rotate so slowly you barely notice movement.
 * Dim blue-white star dust on black.
 * Loop: 120 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class SpiralVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'spiral');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const arms    = 2 + Math.floor(Math.random() * 3); // 2-4 arms
    const tight   = 0.3 + Math.random() * 0.5;
    const hues    = [
      new THREE.Vector3(0.08, 0.12, 0.22),  // cold blue
      new THREE.Vector3(0.14, 0.10, 0.20),  // violet
      new THREE.Vector3(0.20, 0.16, 0.10),  // warm dim gold
    ];
    const col = hues[Math.floor(Math.random() * hues.length)];

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uArms:  { value: arms },
        uTight: { value: tight },
        uColor: { value: col },
        uAmp:   { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uArms;
        uniform float uTight;
        uniform vec3  uColor;
        uniform float uAmp;
        varying vec2  vUv;

        #define PI  3.14159265358979
        #define TAU 6.28318530717959

        float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

        float noise(vec2 p) {
          vec2 i=floor(p), f=fract(p);
          f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
        }

        void main() {
          vec2  p     = (vUv - 0.5) * 2.6;
          float r     = length(p);
          float theta = atan(p.y, p.x);

          // Very slow rotation
          float rot   = uTime * 0.008;

          // Logarithmic spiral arm function
          // For each arm, compute how close this point is to the spiral
          float armWidth = 0.35 + uTight * 0.2;
          float bright   = 0.0;

          for (float i = 0.0; i < 4.0; i++) {
            if (i >= uArms) break;
            float armAngle = theta + rot - (i / uArms) * TAU;
            // Logarithmic spiral: theta = (1/tightness) * ln(r)
            float spiralAngle = log(max(r, 0.001)) / uTight;
            float diff = mod(armAngle - spiralAngle + PI, TAU) - PI;
            // Distance from spiral arm
            float d = abs(diff) * r;
            bright += exp(-d * d / armWidth);
          }

          // Add subtle noise for star-field texture
          float starNoise = noise(p * 8.0 + uTime * 0.01);
          bright += starNoise * 0.04 * exp(-r * 2.0);

          // Central bulge
          float bulge = exp(-r * r * 8.0) * 0.3;
          bright = max(bright, bulge);

          // Outer fade
          bright *= (1.0 - smoothstep(0.5, 1.0, r));

          // Very dim
          float luminance = clamp(bright * 0.15 + uAmp * 0.04, 0.0, 0.25);
          vec3  col = uColor * luminance;

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
    this._uniforms.uAmp.value   = Math.min(1, (audioData?.[0] ?? 0) * 0.3);
  }

  dispose() {
    super.dispose();
    this._mesh = null; this._uniforms = null;
  }
}
