/**
 * depth-visual.js
 * Infinite receding grid — like floating above an endless dark floor.
 * Soft blue-white lines on black. Very slow forward movement.
 * Classic depth illusion that tricks the eye into perceiving 3D.
 * Loop: 30 seconds.
 */

import { VisualModuleBase } from './visual-engine.js';

export class DepthVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'depth');
    this._mesh = null;
    this._uniforms = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    // Color options: cool white, soft teal, dim violet
    const colors = [
      new THREE.Vector3(0.12, 0.16, 0.22),  // cool blue-white
      new THREE.Vector3(0.08, 0.18, 0.18),  // soft teal
      new THREE.Vector3(0.14, 0.10, 0.20),  // dim violet
    ];
    const col = colors[Math.floor(Math.random() * colors.length)];
    const gridScale = 3 + Math.floor(Math.random() * 4);
    const vanishY   = -0.1 + (Math.random() - 0.5) * 0.3;

    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:      { value: 0 },
        uColor:     { value: col },
        uGridScale: { value: gridScale },
        uVanishY:   { value: vanishY },
        uAmp:       { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3  uColor;
        uniform float uGridScale;
        uniform float uVanishY;
        uniform float uAmp;
        varying vec2  vUv;

        void main() {
          vec2 p = vUv - vec2(0.5, 0.5 + uVanishY);

          // Perspective projection — closer at bottom, recedes to top
          float perspective = 1.0 / max(abs(p.y) + 0.02, 0.001);
          perspective = clamp(perspective, 0.0, 80.0);

          // Horizontal and vertical grid lines in perspective space
          float speed = 0.05;
          float xGrid = p.x * perspective * uGridScale;
          float zGrid = (perspective + uTime * speed) * uGridScale;

          // Line width varies with distance (thin far, thick near)
          float lineWidth = 0.02;

          float hLine = abs(fract(zGrid + 0.5) - 0.5);
          float vLine = abs(fract(xGrid + 0.5) - 0.5);

          float grid = min(hLine, vLine);
          float line = 1.0 - smoothstep(0.0, lineWidth, grid);

          // Distance fog — far lines fade to black
          float fog = clamp(1.0 - length(p) * 1.4, 0.0, 1.0);
          fog = pow(fog, 1.8);

          // Very dim output
          float brightness = line * fog * (0.20 + uAmp * 0.06);

          // Only show lower half (floor effect)
          brightness *= step(0.0, -p.y + 0.05);

          // Horizon glow
          float horizon = exp(-abs(p.y) * 18.0) * 0.06;
          brightness = max(brightness, horizon);

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
