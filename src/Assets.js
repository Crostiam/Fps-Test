import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

export class Assets {
  constructor(audioContext = null) {
    this.gltf = new GLTFLoader();
    this.tex = new THREE.TextureLoader();
    this.audioCtx = audioContext || (window.AudioContext ? new AudioContext() : null);

    this.models = {};   // key -> GLTF
    this.textures = {}; // key -> THREE.Texture
    this.audio = {};    // key -> AudioBuffer
  }

  async loadAll(manifest = { models: {}, textures: {}, audio: {} }) {
    const jobs = [];

    // Models
    if (manifest.models) {
      for (const [key, url] of Object.entries(manifest.models)) {
        if (!url) continue;
        jobs.push(new Promise((res, rej) => {
          this.gltf.load(url, (g) => { this.models[key] = g; res(); }, undefined, () => res()); // don't hard fail
        }));
      }
    }

    // Textures
    if (manifest.textures) {
      for (const [key, url] of Object.entries(manifest.textures)) {
        if (!url) continue;
        jobs.push(new Promise((res, rej) => {
          this.tex.load(url, (t) => {
            // Make sRGB default-friendly for color maps
            if (t && t.colorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
            this.textures[key] = t; res();
          }, undefined, () => res());
        }));
      }
    }

    // Audio
    if (manifest.audio && this.audioCtx) {
      for (const [key, url] of Object.entries(manifest.audio)) {
        if (!url) continue;
        jobs.push(fetch(url)
          .then(r => r.ok ? r.arrayBuffer() : null)
          .then(buf => buf ? this.audioCtx.decodeAudioData(buf) : null)
          .then(decoded => { if (decoded) this.audio[key] = decoded; })
          .catch(() => {}));
      }
    }

    await Promise.all(jobs);
  }

  cloneModel(key, { scale = 1 } = {}) {
    const gltf = this.models[key];
    if (!gltf) return null;
    const root = gltf.scene.clone(true);
    root.traverse((n) => {
      if (n.isMesh) {
        // isolate mats/geo so we can tweak per-instance
        n.material = n.material && n.material.isMaterial ? n.material.clone() : n.material;
        n.geometry = n.geometry && n.geometry.isBufferGeometry ? n.geometry.clone() : n.geometry;
        if (n.material && 'toneMapped' in n.material) n.material.toneMapped = true;
      }
    });
    if (scale !== 1) root.scale.setScalar(scale);
    return root;
  }

  getTexture(key) {
    return this.textures[key] || null;
  }

  playAudio(key, destinationNode, gain = 0.8) {
    if (!this.audioCtx) return;
    const buf = this.audio[key]; if (!buf) return;
    const src = this.audioCtx.createBufferSource();
    src.buffer = buf;
    const g = this.audioCtx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(destinationNode || this.audioCtx.destination);
    src.start();
    return src;
  }
}
