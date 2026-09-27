/**
 * @file sound_synth.js
 * @description Zero-asset procedural chiptune sound synthesizer using the WebAudio API.
 *
 * Features:
 *  - playLaser(freqStart, freqEnd, duration)
 *  - playImpact(duration)
 *  - playExplosion(duration)
 *  - playThruster(active, throttle)
 *  - Automatic user-gesture AudioContext resume handling
 *  - Global mute/unmute toggle [X]
 *  - Headless/Node.js safety fallback (never throws if AudioContext is missing)
 */

export class SoundSynth {
  constructor() {
    this._ctx        = null;
    this._masterGain = null;
    this.isMuted     = false;
    this._initialized = false;

    // Thruster engine drone state
    this._thrusterOsc   = null;
    this._thrusterGain  = null;
    this._thrusterNoise = null;

    // Pre-bind gesture handler
    this._onUserGesture = this._unlockAudioContext.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this._onUserGesture, { once: true });
      window.addEventListener('keydown',     this._onUserGesture, { once: true });
    }
  }

  /**
   * Lazily initialize or resume AudioContext on first interaction.
   */
  _unlockAudioContext() {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') {
        this._ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this._ctx = new AudioCtx();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.28, this._ctx.currentTime);
      this._masterGain.connect(this._ctx.destination);
      this._initialized = true;

      // Start continuous thruster rumble node
      this._setupThrusterDrone();
    } catch {
      // Audio unsupported or restricted
    }
  }

  /**
   * Toggle mute state.
   * @returns {boolean} current muted state
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this._masterGain && this._ctx) {
      const targetGain = this.isMuted ? 0 : 0.28;
      this._masterGain.gain.setValueAtTime(targetGain, this._ctx.currentTime);
    }
    return this.isMuted;
  }

  /**
   * Downward frequency sweep laser blast.
   *
   * @param {number} [freqStart=880] - Start frequency in Hz
   * @param {number} [freqEnd=220]   - End frequency in Hz
   * @param {number} [duration=0.12] - Duration in seconds
   */
  playLaser(freqStart = 880, freqEnd = 220, duration = 0.12) {
    if (this.isMuted || !this._ctx) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();

    const t = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(this._masterGain);

    osc.start(t);
    osc.stop(t + duration);
  }

  /**
   * Filtered white-noise pulse for kinetic shield and projectile impacts.
   *
   * @param {number} [duration=0.08]
   */
  playImpact(duration = 0.08) {
    if (this.isMuted || !this._ctx) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();

    const t = this._ctx.currentTime;
    const bufferSize = Math.floor(this._ctx.sampleRate * duration);
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.9;
    }

    const whiteNoise = this._ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    // Bandpass filter for metallic clack
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.Q.setValueAtTime(3.0, t);

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain);

    whiteNoise.start(t);
  }

  /**
   * Deep resonant low-pass rumble with exponential decay.
   *
   * @param {number} [duration=0.45]
   */
  playExplosion(duration = 0.45) {
    if (this.isMuted || !this._ctx) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();

    const t = this._ctx.currentTime;

    // 1. Noise burst
    const bufferSize = Math.floor(this._ctx.sampleRate * duration);
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noise = this._ctx.createBufferSource();
    noise.buffer = buffer;

    // Lowpass filter for deep explosion rumble
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, t);
    filter.frequency.exponentialRampToValueAtTime(40, t + duration);

    const noiseGain = this._ctx.createGain();
    noiseGain.gain.setValueAtTime(0.85, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this._masterGain);

    // 2. Sub-bass punch oscillator
    const subOsc = this._ctx.createOscillator();
    const subGain = this._ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(120, t);
    subOsc.frequency.exponentialRampToValueAtTime(25, t + duration);

    subGain.gain.setValueAtTime(0.7, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    subOsc.connect(subGain);
    subGain.connect(this._masterGain);

    noise.start(t);
    subOsc.start(t);
    subOsc.stop(t + duration);
  }

  /**
   * Continuous thruster hum drone setup.
   */
  _setupThrusterDrone() {
    if (!this._ctx) return;
    try {
      const t = this._ctx.currentTime;
      this._thrusterOsc = this._ctx.createOscillator();
      this._thrusterGain = this._ctx.createGain();

      this._thrusterOsc.type = 'triangle';
      this._thrusterOsc.frequency.setValueAtTime(55, t);

      this._thrusterGain.gain.setValueAtTime(0.0, t);

      this._thrusterOsc.connect(this._thrusterGain);
      this._thrusterGain.connect(this._masterGain);
      this._thrusterOsc.start(t);
    } catch {
      // Fallback
    }
  }

  /**
   * Modulate continuous thruster audio depending on ship velocity/throttle.
   *
   * @param {boolean} active
   * @param {number} [throttle=1.0] - [0..1]
   */
  playThruster(active, throttle = 1.0) {
    if (!this._thrusterGain || !this._ctx || this.isMuted) return;

    const t = this._ctx.currentTime;
    const targetGain = active ? 0.22 * Math.min(1, Math.max(0, throttle)) : 0.0;
    this._thrusterGain.gain.setTargetAtTime(targetGain, t, 0.08);

    if (this._thrusterOsc && active) {
      const targetFreq = 50 + throttle * 45;
      this._thrusterOsc.frequency.setTargetAtTime(targetFreq, t, 0.08);
    }
  }
}
