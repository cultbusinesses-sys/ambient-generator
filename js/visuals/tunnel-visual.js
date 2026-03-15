/**
 * tunnel-visual.js
 * Hypnotic zooming geometric tunnel.
 * Color, speed, sides, and twist fully randomized on every load.
 */

import { VisualModuleBase } from './visual-engine.js';

export class TunnelVisual extends VisualModuleBase {
  constructor(engine) {
    super(engine, 'tunnel');
    this._elapsed = 0;
    this._rings   = [];
  }

  async start() {
    const { THREE, scene, camera } = this;
    camera.position.set(0, 0, 0.1);
    camera.lookAt(0, 0, -1);

    this._hue    = Math.random();
    this._speed  = 0.5 + Math.random() * 1.2;
    this._sides  = [3, 4, 5, 6, 8, 12][Math.floor(Math.random() * 6)];
    this._twist  = (Math.random() - 0.5) * 0.12;
    this._pulseA = Math.random() * Math.PI * 2;

    const RING_COUNT = 64;
    const DEPTH      = 120;

    for (let i = 0; i < RING_COUNT; i++) {
      const t       = i / RING_COUNT;
      const z       = -(i / RING_COUNT) * DEPTH;
      const radius  = 1.2 + Math.sin(i * 0.5) * 0.4;
      const hShift  = (this._hue + t * 0.25) % 1;
      const sat     = 0.5 + Math.random() * 0.4;
      const lit     = 0.3 + (1 - t) * 0.45;
      const opacity = 0.06 + (1 - t) * 0.3;

      // Outer ring
      const geo = new THREE.RingGeometry(radius - 0.035, radius, this._sides);
      const mat = new THREE.MeshBasicMaterial({
        color:       new THREE.Color().setHSL(hShift, sat, lit),
        side:        THREE.DoubleSide,
        transparent: true,
        opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = z;
      mesh.rotation.z = i * this._twist;
      scene.add(mesh);
      this._objects.push(mesh);
      this._rings.push({ mesh, baseZ: z, idx: i, radius });

      // Inner decorative ring (alternating)
      if (i % 3 === 0) {
        const geo2 = new THREE.RingGeometry(radius * 0.55, radius * 0.6, this._sides);
        const mat2 = new THREE.MeshBasicMaterial({
          color:       new THREE.Color().setHSL((hShift + 0.5) % 1, sat, lit),
          side:        THREE.DoubleSide,
          transparent: true,
          opacity:     opacity * 0.6,
        });
        const mesh2 = new THREE.Mesh(geo2, mat2);
        mesh2.position.z = z;
        mesh2.rotation.z = -i * this._twist;
        scene.add(mesh2);
        this._objects.push(mesh2);
        this._rings.push({ mesh: mesh2, baseZ: z, idx: i, radius: radius * 0.575, inner: true });
      }
    }
  }

  update(delta, audioData) {
    this._elapsed += delta;
    const t     = this._elapsed;
    const amp   = Math.min(1, (audioData?.[0] ?? 0) * 0.5 + 0.08);
    const speed = (this._speed + amp * 1.2) * delta * 28;
    const DEPTH = 120;

    for (const ring of this._rings) {
      // Move toward camera and wrap
      let z = ring.baseZ + (t * speed * this._speed) % DEPTH;
      if (z > 2) z -= DEPTH;
      ring.mesh.position.z = z;

      // Pulse radius with audio
      const pulsed = ring.radius * (1 + amp * 0.12 * Math.sin(t * 2 + ring.idx));
      ring.mesh.scale.setScalar(pulsed / ring.radius);

      // Rotate
      const dir = ring.inner ? -1 : 1;
      ring.mesh.rotation.z = ring.idx * this._twist + t * 0.1 * dir;

      // Fade opacity based on z proximity
      const proximity = 1 - Math.abs(z) / DEPTH;
      ring.mesh.material.opacity = (0.05 + proximity * 0.35) * (1 + amp * 0.3);
    }

    // Subtle camera drift
    this.camera.rotation.z = Math.sin(t * 0.06) * 0.08;
    this.camera.rotation.x = Math.sin(t * 0.04) * 0.04;
  }

  dispose() {
    super.dispose();
    this._rings = [];
  }
}
