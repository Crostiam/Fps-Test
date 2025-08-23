export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.muted = false;
    this.lastStepTime = 0;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    if (!this.master) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.8, this.ctx.currentTime + 0.05);
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  // Helpers
  _env(duration = 0.15, gain = 0.7) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const t = this.ctx.currentTime;
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    return g;
  }

  _osc(type, freq, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start();
    return o;
  }

  _noise(dest, color = 'white') {
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'white') data[i] = white;
      else if (color === 'pink') {
        lastOut = 0.98 * lastOut + 0.02 * white;
        data[i] = lastOut;
      } else if (color === 'brown') {
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 3.5;
      }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    return src;
  }

  playShot() {
    if (!this.ctx || this.muted) return;
    const env = this._env(0.12, 0.8);
    const o1 = this._osc('square', 280, env);
    const o2 = this._osc('triangle', 140, env);
    const t = this.ctx.currentTime;
    o1.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    o2.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const nEnv = this._env(0.06, 0.4);
    const n = this._noise(nEnv, 'white');
    n.start();
    o1.stop(t + 0.13); o2.stop(t + 0.13); n.stop(t + 0.07);
  }

  playEnemyShot() {
    if (!this.ctx || this.muted) return;
    const env = this._env(0.18, 0.6);
    const o = this._osc('sawtooth', 600, env);
    const t = this.ctx.currentTime;
    o.frequency.exponentialRampToValueAtTime(240, t + 0.18);
    o.stop(t + 0.19);
  }

  playHit() {
    if (!this.ctx || this.muted) return;
    const env = this._env(0.2, 0.7);
    const n = this._noise(env, 'pink');
    n.start();
    n.stop(this.ctx.currentTime + 0.2);
  }

  playStep() {
    if (!this.ctx || this.muted) return;
    const env = this._env(0.08, 0.5);
    const o = this._osc('sine', 70, env);
    const t = this.ctx.currentTime;
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    o.stop(t + 0.09);
  }

  startAmbient() {
    if (!this.ctx || this.muted) return;
    if (this.ambient) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.08;
    g.connect(this.master);
    const n = this._noise(g, 'brown');
    n.loop = true;
    n.start();
    this.ambient = n;
  }

  stopAmbient() {
    if (this.ambient) {
      try { this.ambient.stop(); } catch {}
      this.ambient.disconnect();
      this.ambient = null;
    }
  }
}
