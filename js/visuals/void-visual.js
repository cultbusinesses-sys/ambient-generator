/**
 * void-visual.js
 * Infinite zooming void — slow concentric rings pulling inward.
 * Deep indigo on black. Like falling into a dark well forever.
 * Loop: 40 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class VoidVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'void');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const ringCount = 18 + Math.floor(Math.random() * 12);
    const twist     = 0.3 + Math.random() * 0.8;
    const hue       = 200 + Math.random() * 60; // blue-indigo range

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:      { value: 0 },
        uRings:     { value: ringCount },
        uTwist:     { value: twist },
        uHue:       { value: hue },
        uAmp:       { value: 0 },
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
        uniform float uRings;
        uniform float uTwist;
        uniform float uHue;
        uniform float uAmp;
        varying vec2  vUv;

        vec3 hsv2rgb(float h, float s, float v) {
          h = mod(h, 360.0);
          float c = v * s;
          float x = c * (1.0 - abs(mod(h/60.0, 2.0) - 1.0));
          float m = v - c;
          vec3 rgb;
          if      (h < 60.0)  rgb = vec3(c,x,0);
          else if (h < 120.0) rgb = vec3(x,c,0);
          else if (h < 180.0) rgb = vec3(0,c,x);
          else if (h < 240.0) rgb = vec3(0,x,c);
          else if (h < 300.0) rgb = vec3(x,0,c);
          else                rgb = vec3(c,0,x);
          return rgb + m;
        }

        void main() {
          vec2  p    = (vUv - 0.5) * 2.2;
          float dist = length(p);
          float angle = atan(p.y, p.x);

          // Slow inward zoom — rings appear to pull toward center
          float speed = 0.06;
          float zoom  = mod(dist * uRings - uTime * speed, 1.0);

          // Twist angle by distance and time
          float twisted = angle + dist * uTwist + uTime * 0.04;

          // Ring brightness — sharp bright edges, dark interior
          float ring = pow(abs(sin(zoom * 3.14159)), 3.0);

          // Angular modulation — subtle spiral arms
          float arms  = 0.5 + 0.5 * sin(twisted * 3.0 + uTime * 0.02);
          ring *= (0.7 + arms * 0.3);

          // Depth fade — center is darkest
          float fade  = smoothstep(0.0, 0.6, dist);
          ring       *= fade;

          // Edge fade
          ring *= (1.0 - smoothstep(0.85, 1.0, dist));

          // Color — dim indigo/blue, very low saturation and value
          float brightness = ring * (0.18 + uAmp * 0.06);
          vec3  col = hsv2rgb(uHue + dist * 20.0, 0.45, brightness);

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
