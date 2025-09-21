// audio.js - Centralized audio manager for music and SFX
// Uses Vite-friendly URLs so assets in ../SFX get bundled correctly

const urls = {
  menu: new URL('../SFX/Dysmn.mp3', import.meta.url).href,
  startup: new URL('../SFX/startup.mp3', import.meta.url).href,
  engine: new URL('../SFX/HydrogenClipped.mp3', import.meta.url).href,
  pew: new URL('../SFX/pew.mp3', import.meta.url).href,
  coin: new URL('../SFX/coin.mp3', import.meta.url).href,
};

class AudioManager {
  constructor() {
    this.menu = null;
    this.engine = null;
    this._unlocked = false;
    this.ctx = null;
    this.buffers = new Map(); // name -> AudioBuffer
    this.masterGain = null;
    // Attempt to unlock audio on first user interaction
    const unlock = () => {
      this._unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      // Resume any pending loops
      if (this.menu && this.menu.paused) this.menu.play().catch(()=>{});
      if (this.engine && this.engine.paused) this.engine.play().catch(()=>{});
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async _getCtx() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.ctx.destination);
      } catch (e) {
        // WebAudio not available
      }
    }
    return this.ctx;
  }

  async preloadSfx() {
    const ctx = await this._getCtx();
    if (!ctx) return;
    const load = async (key, href) => {
      if (this.buffers.has(key)) return;
      const res = await fetch(href);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr.slice(0));
      this.buffers.set(key, buf);
    };
    try { await Promise.all([
      load('pew', urls.pew),
      load('coin', urls.coin)
    ]); } catch {}
  }

  playMenu(volume = 0.5) {
    if (!this.menu) {
      this.menu = new Audio(urls.menu);
      this.menu.loop = true;
      this.menu.volume = volume;
    }
    this.menu.currentTime = 0;
    this.menu.play().catch(()=>{});
  }

  // Best-effort autoplay without click: start muted, then ramp up; retry periodically if blocked
  playMenuAuto(volume = 0.5) {
    if (!this.menu) {
      this.menu = new Audio(urls.menu);
      this.menu.loop = true;
      this.menu.volume = 0.0;
      this.menu.muted = true;
    }
    const tryPlay = () => {
      this.menu.play().then(() => {
        // Unmute and ramp over ~0.5s
        this.menu.muted = false;
        const target = volume;
        let v = 0.0;
        const step = () => {
          v = Math.min(target, v + 0.08);
          this.menu.volume = v;
          if (v < target && !this.menu.paused) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }).catch(() => {
        // Retry shortly; some browsers require user activation
        setTimeout(tryPlay, 2000);
      });
    };
    tryPlay();
  }

  stopMenu() {
    if (this.menu) {
      try { this.menu.pause(); } catch {}
    }
  }

  playStartup(volume = 0.8) {
    const a = new Audio(urls.startup);
    a.volume = volume;
    a.play().catch(()=>{});
  }

  playEngineLoop(volume = 0.4) {
    if (!this.engine) {
      this.engine = new Audio(urls.engine);
      this.engine.loop = true;
      this.engine.volume = volume;
    }
    this.engine.currentTime = 0;
    this.engine.play().catch(()=>{});
  }

  stopEngineLoop() {
    if (this.engine) {
      try { this.engine.pause(); } catch {}
    }
  }

  playPew(volume = 0.8) {
    const ctx = this.ctx;
    const buf = this.buffers.get('pew');
    if (ctx && buf) {
      try {
        ctx.resume().catch(()=>{});
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = volume;
        src.buffer = buf;
        src.connect(gain).connect(this.masterGain || ctx.destination);
        src.start(0);
        return;
      } catch {}
    }
    // Fallback to HTMLAudio
    try {
      const a = new Audio(urls.pew);
      a.volume = volume;
      a.play().catch(()=>{});
    } catch {}
  }

  playCoin(volume = 0.7) {
    const ctx = this.ctx;
    const buf = this.buffers.get('coin');
    if (ctx && buf) {
      try {
        ctx.resume().catch(()=>{});
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = volume;
        src.buffer = buf;
        src.connect(gain).connect(this.masterGain || ctx.destination);
        src.start(0);
        return;
      } catch {}
    }
    try {
      const a = new Audio(urls.coin);
      a.volume = volume;
      a.play().catch(()=>{});
    } catch {}
  }
}

export const audio = new AudioManager();
