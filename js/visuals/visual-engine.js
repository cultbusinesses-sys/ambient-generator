/**
 * visual-engine.js
 * ----------------
 * Three.js scene manager for the Ambient Generator.
 * Manages the WebGL context, animation loop, and visual module registry.
 *
 * Responsibilities:
 *   - Load Three.js from CDN
 *   - Create WebGLRenderer, Scene, Camera
 *   - Run a requestAnimationFrame loop with delta time
 *   - Hot-swap visual modules without restarting the renderer
 *   - Expose audio data (amplitude array) so visuals can react to sound
 *   - Handle canvas resize (window resize or resolution change)
 *   - Provide a frame-capture method for video-export.js
 *
 * Visual Module Contract:
 *   Every visual module must export a class with:
 *     constructor(engine)       — receives the VisualEngine instance
 *     start()                   — called when the module becomes active
 *     stop()                    — called when the module is replaced / paused
 *     update(delta, audioData)  — called every frame (delta in seconds)
 *     dispose()                 — release all GPU resources
 *
 *   The module gets access to:
 *     engine.scene              — Three.js Scene
 *     engine.camera             — PerspectiveCamera
 *     engine.THREE              — the Three.js namespace
 *
 * Usage:
 *   const ve = new VisualEngine(canvasElement);
 *   await ve.init();
 *   await ve.loadModule(WaveVisual);
 *   ve.start();
 *   // Later:
 *   await ve.loadModule(ParticleVisual);  // hot-swap, no restart
 *   ve.stop();
 */

export class VisualEngine {

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object}            [options]
   * @param {number}            [options.fov]         - Camera FOV (default 60)
   * @param {boolean}           [options.antialias]   - (default true)
   * @param {number}            [options.pixelRatio]  - Override devicePixelRatio
   */
  constructor(canvas, options = {}) {
    this.canvas      = canvas;
    this.options     = {
      fov:        options.fov        ?? 60,
      antialias:  options.antialias  ?? true,
      // Cap at 1 — ambient visuals at devicePixelRatio 2+ cost double GPU work
      // with zero visible benefit on slow-moving content.
      pixelRatio: options.pixelRatio ?? 1,
    };

    // Three.js core objects (populated by init())
    this.THREE    = null;
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;
    this.clock    = null;

    // Active visual module
    this._activeModule = null;

    // Animation loop state
    this._running    = false;
    this._rafHandle  = null;

    // Audio data: Float32Array updated each frame by the caller
    // Index 0 = overall amplitude 0..1
    // Indices 1..N = frequency bins (if provided)
    this._audioData  = new Float32Array(128).fill(0);

    // Resize observer
    this._resizeObserver = null;

    this._initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  /**
   * Loads Three.js and sets up the full render stack.
   * Must be called before loadModule() or start().
   */
  async init() {
    this.THREE = await this._loadThree();

    const THREE = this.THREE;
    const w = this.canvas.clientWidth  || this.canvas.width  || 1280;
    const h = this.canvas.clientHeight || this.canvas.height || 720;

    // Renderer
    // preserveDrawingBuffer: true is required for captureFrame() / toDataURL()
    // Without it the canvas is cleared immediately after each render call.
    this.renderer = new THREE.WebGLRenderer({
      canvas:               this.canvas,
      antialias:            this.options.antialias,
      alpha:                false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(this.options.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000000, 1);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      this.options.fov,
      w / h,
      0.1,
      2000
    );
    this.camera.position.set(0, 0, 5);

    // Clock for delta time
    this.clock = new THREE.Clock(false);

    // Resize handling
    this._setupResize();

    this._initialized = true;
  }

  // ---------------------------------------------------------------------------
  // Three.js loader
  // ---------------------------------------------------------------------------

  /**
   * Loads Three.js r128 from CDN.
   * Returns the THREE namespace.
   * If already on window, returns immediately.
   */
  _loadThree() {
    return new Promise((resolve, reject) => {
      if (window.THREE) { resolve(window.THREE); return; }

      const script = document.createElement('script');
      script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload  = () => resolve(window.THREE);
      script.onerror = () => reject(new Error('VisualEngine: failed to load Three.js from CDN'));
      document.head.appendChild(script);
    });
  }

  // ---------------------------------------------------------------------------
  // Visual module management
  // ---------------------------------------------------------------------------

  /**
   * Loads and activates a visual module.
   * If a module is already active, it is cleanly stopped and disposed first.
   *
   * @param {class} ModuleClass  - A class satisfying the Visual Module Contract
   */
  async loadModule(ModuleClass) {
    if (!this._initialized) throw new Error('VisualEngine: call init() first');

    // Stop and dispose existing module
    if (this._activeModule) {
      this._activeModule.stop();
      this._activeModule.dispose();
      // Clear the scene of all objects from the old module
      this._clearScene();
    }

    // Instantiate and start the new module
    const module = new ModuleClass(this);
    await module.start();
    this._activeModule = module;
  }

  /**
   * Returns the currently active module name, or null.
   */
  get activeModuleName() {
    return this._activeModule?.name ?? null;
  }

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  /**
   * Start the render loop.
   * Call after init() and loadModule().
   */
  start() {
    if (this._running) return;
    this._running = true;
    this.clock.start();
    this._loop();
  }

  /**
   * Stop the render loop (does not dispose).
   */
  stop() {
    this._running = false;
    if (this._rafHandle) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
    this.clock.stop();
  }

  _loop() {
    if (!this._running) return;

    this._rafHandle = requestAnimationFrame(() => this._loop());

    // Throttle to ~24fps — matches video export fps, halves GPU load vs 60fps.
    // Ambient visuals are slow-moving so the difference is imperceptible.
    const now   = performance.now();
    const since = now - (this._lastFrameTime ?? 0);
    if (since < 40) return;   // 40ms = 25fps ceiling
    this._lastFrameTime = now;

    const delta = Math.min(this.clock.getDelta(), 0.05);

    if (this._activeModule) {
      this._activeModule.update(delta, this._audioData);
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // Audio data injection
  // ---------------------------------------------------------------------------

  /**
   * Feed live audio analysis data into the engine.
   * Call this every frame from your AudioContext AnalyserNode.
   *
   * @param {Float32Array} data  - Amplitude + frequency bins, all 0..1
   */
  setAudioData(data) {
    this._audioData = data;
  }

  /**
   * Set a single overall amplitude value (0..1).
   * Simpler alternative to setAudioData for visuals that only need one number.
   * @param {number} amplitude
   */
  setAmplitude(amplitude) {
    this._audioData[0] = Math.max(0, Math.min(1, amplitude));
  }

  // ---------------------------------------------------------------------------
  // Resolution control
  // ---------------------------------------------------------------------------

  /**
   * Change the render resolution.
   * @param {'1080p'|'2k'|'4k'|number} resolution
   *   - String presets set the canvas size directly
   *   - Number sets the pixelRatio multiplier
   */
  setResolution(resolution) {
    const PRESETS = {
      '1080p': [1920, 1080],
      '2k':    [2560, 1440],
      '4k':    [3840, 2160],
    };

    if (typeof resolution === 'string' && PRESETS[resolution]) {
      const [w, h] = PRESETS[resolution];
      this.canvas.width  = w;
      this.canvas.height = h;
      this.renderer.setSize(w, h, false);
      this.renderer.setPixelRatio(1);  // explicit size, no scaling
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    } else if (typeof resolution === 'number') {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.renderer.setPixelRatio(resolution);
      this.renderer.setSize(w, h, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Frame capture (for video-export.js)
  // ---------------------------------------------------------------------------

  /**
   * Captures the current frame as a data URL.
   * Call this AFTER renderer.render() in the same frame.
   *
   * @param {'image/png'|'image/jpeg'} [format]
   * @param {number} [quality]  - 0..1, only for jpeg
   * @returns {string} data URL
   */
  captureFrame(format = 'image/jpeg', quality = 0.95) {
    // Ensure the renderer has preserveDrawingBuffer = true for capture
    // (set via _setupCapture() if needed)
    return this.canvas.toDataURL(format, quality);
  }

  /**
   * Renders a single frame and returns its data URL.
   * Used by video-export.js to capture frames at a fixed time step.
   *
   * @param {number} time        - simulation time in seconds
   * @param {Float32Array} [audioData]
   * @returns {string}
   */
  renderFrameAt(time, audioData) {
    if (audioData) this._audioData = audioData;
    if (this._activeModule) {
      this._activeModule.update(time, this._audioData);
    }
    this.renderer.render(this.scene, this.camera);
    return this.captureFrame();
  }

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  _setupResize() {
    if (typeof ResizeObserver === 'undefined') return;

    this._resizeObserver = new ResizeObserver(() => {
      this._handleResize();
    });
    this._resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
  }

  _handleResize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;

    if (w === 0 || h === 0) return;

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------
  // Scene cleanup
  // ---------------------------------------------------------------------------

  /**
   * Removes all objects from the scene and disposes their GPU resources.
   * Called during hot-swap to avoid memory leaks.
   */
  _clearScene() {
    const toRemove = [];
    this.scene.traverse(obj => {
      if (obj !== this.scene) toRemove.push(obj);
    });

    for (const obj of toRemove) {
      // Dispose geometry
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      // Dispose material(s)
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          // Dispose any textures on the material
          for (const key of Object.keys(mat)) {
            const val = mat[key];
            if (val && typeof val.dispose === 'function' && val.isTexture) {
              val.dispose();
            }
          }
          mat.dispose();
        }
      }
      this.scene.remove(obj);
    }
  }

  // ---------------------------------------------------------------------------
  // Full dispose
  // ---------------------------------------------------------------------------

  /**
   * Stops the loop, disposes the active module, and destroys the renderer.
   * Call when the app unmounts or the canvas is removed.
   */
  dispose() {
    this.stop();

    if (this._activeModule) {
      this._activeModule.stop();
      this._activeModule.dispose();
      this._activeModule = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    this._clearScene();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Utility helpers exposed to visual modules
  // ---------------------------------------------------------------------------

  /**
   * Creates a full-screen quad with a ShaderMaterial.
   * Common pattern for post-processing and background effects.
   *
   * @param {string} vertexShader
   * @param {string} fragmentShader
   * @param {Object} uniforms
   * @returns {THREE.Mesh}
   */
  createFullscreenQuad(vertexShader, fragmentShader, uniforms = {}) {
    const THREE = this.THREE;
    const geo   = new THREE.PlaneGeometry(2, 2);
    const mat   = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      depthWrite: false,
      depthTest:  false,
    });
    const mesh        = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Returns a normalized time value (0..1) looping every `period` seconds.
   * Useful for seamless visual loops.
   *
   * @param {number} elapsed  - seconds from clock
   * @param {number} period   - loop period in seconds
   * @returns {number} 0..1
   */
  static loopT(elapsed, period) {
    return (elapsed % period) / period;
  }

  /**
   * Returns the current canvas aspect ratio.
   */
  get aspect() {
    return this.canvas.width / this.canvas.height;
  }

  /**
   * Returns the current canvas dimensions.
   * @returns {{ width: number, height: number }}
   */
  get size() {
    return {
      width:  this.canvas.width  || this.canvas.clientWidth,
      height: this.canvas.height || this.canvas.clientHeight,
    };
  }
}

// ---------------------------------------------------------------------------
// VisualModuleBase — optional base class for visual modules
// ---------------------------------------------------------------------------

/**
 * Optional base class for visual modules.
 * Provides default no-op implementations of all required methods.
 * Extend this instead of implementing the contract from scratch.
 *
 * @example
 *   export class MyVisual extends VisualModuleBase {
 *     constructor(engine) {
 *       super(engine, 'my-visual');
 *     }
 *     async start() {
 *       // build geometry, add to this.scene
 *     }
 *     update(delta, audioData) {
 *       // animate
 *     }
 *     dispose() {
 *       // release custom resources
 *     }
 *   }
 */
export class VisualModuleBase {

  /**
   * @param {VisualEngine} engine
   * @param {string}       name    - Unique identifier, e.g. 'wave'
   */
  constructor(engine, name = 'base') {
    this.engine = engine;
    this.name   = name;
    this.scene  = engine.scene;
    this.camera = engine.camera;
    this.THREE  = engine.THREE;

    // Track objects added to the scene so dispose() can clean up
    this._objects = [];
  }

  /** Called when the module becomes active. Override to build the scene. */
  async start() {}

  /** Called when the module is replaced. Override to pause animations. */
  stop() {}

  /**
   * Called every frame.
   * @param {number}      delta      - seconds since last frame
   * @param {Float32Array} audioData - amplitude + frequency data
   */
  update(delta, audioData) {}

  /**
   * Called after stop() when the module is being removed.
   * Default implementation removes all tracked objects from the scene.
   * Override to add extra cleanup (textures, render targets, etc.).
   */
  dispose() {
    for (const obj of this._objects) {
      this.scene.remove(obj);
    }
    this._objects = [];
  }

  // ---------------------------------------------------------------------------
  // Helpers for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Add an object to the scene and track it for auto-cleanup.
   * @param {THREE.Object3D} obj
   */
  addToScene(obj) {
    this.scene.add(obj);
    this._objects.push(obj);
    return obj;
  }

  /**
   * Overall amplitude (index 0 of audioData), safe default 0.
   * @param {Float32Array} audioData
   * @returns {number} 0..1
   */
  amplitude(audioData) {
    return audioData?.[0] ?? 0;
  }

  /**
   * Returns a normalized time loop value (0..1) over a given period.
   * @param {number} elapsed
   * @param {number} period
   */
  loopT(elapsed, period) {
    return VisualEngine.loopT(elapsed, period);
  }
}
