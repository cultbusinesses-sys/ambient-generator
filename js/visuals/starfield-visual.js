/**
 * starfield-visual.js
 * 3D starfield flying through space.
 * Star count, speed, color, and density randomized on every load.
 */

import { VisualModuleBase } from './visual-engine.js';

export class StarfieldVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'starfield');
    this._elapsed = 0;
    this._points  = null;
    this._posAttr = null;
    this._data    = null;
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    const COUNT      = 2500;
    const SPREAD     = 90;
    const DEPTH      = 110;
    const hue        = Math.random();
    this._speed      = 10 + Math.random() * 15;
    this._DEPTH      = DEPTH;
    this._SPREAD     = SPREAD;
    this._COUNT      = COUNT;

    this._data = {
      x:     new Float32Array(COUNT),
      y:     new Float32Array(COUNT),
      z:     new Float32Array(COUNT),
      speed: new Float32Array(COUNT),
      size:  new Float32Array(COUNT),
    };

    const positions = new Float32Array(COUNT * 3);
    const colors    = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      this._data.x[i]     = (Math.random() - 0.5) * SPREAD;
      this._data.y[i]     = (Math.random() - 0.5) * SPREAD;
      this._data.z[i]     = -(Math.random() * DEPTH);
      this._data.speed[i] = 0.4 + Math.random() * 1.6;
      this._data.size[i]  = 0.08 + Math.random() * 0.18;

      positions[i*3]     = this._data.x[i];
      positions[i*3 + 1] = this._data.y[i];
      positions[i*3 + 2] = this._data.z[i];

      // Each star slightly different hue for depth feel
      const starHue = (hue + (Math.random() - 0.5) * 0.15 + 1) % 1;
      const c = new THREE.Color().setHSL(starHue, 0.2, 0.7 + Math.random() * 0.3);
      colors[i*3]     = c.r;
      colors[i*3 + 1] = c.g;
      colors[i*3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(positions, 3);
    this._posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size:            0.14,
      vertexColors:    true,
      transparent:     true,
      opacity:         0.88,
      sizeAttenuation: true,
    });

    this._points = new THREE.Points(geo, mat);
    scene.add(this._points);
    this._objects.push(this._points);
  }

  update(delta, audioData) {
    this._elapsed += delta;
    const t     = this._elapsed;
    const amp   = Math.min(1, (audioData?.[0] ?? 0) * 0.5 + 0.08);
    const speed = (this._speed + amp * 12) * delta;
    const pos   = this._posAttr.array;

    for (let i = 0; i < this._COUNT; i++) {
      this._data.z[i] += speed * this._data.speed[i];

      if (this._data.z[i] > 1.5) {
        // Reset to far back
        this._data.x[i]     = (Math.random() - 0.5) * this._SPREAD;
        this._data.y[i]     = (Math.random() - 0.5) * this._SPREAD;
        this._data.z[i]     = -this._DEPTH;
        this._data.speed[i] = 0.4 + Math.random() * 1.6;
      }

      pos[i*3]     = this._data.x[i];
      pos[i*3 + 1] = this._data.y[i];
      pos[i*3 + 2] = this._data.z[i];
    }

    this._posAttr.needsUpdate = true;

    // Gentle camera drift
    this.camera.rotation.z = Math.sin(t * 0.05) * 0.08;
    this.camera.rotation.x = Math.cos(t * 0.03) * 0.04;
  }

  dispose() {
    super.dispose();
    this._points  = null;
    this._posAttr = null;
    this._data    = null;
  }
}
