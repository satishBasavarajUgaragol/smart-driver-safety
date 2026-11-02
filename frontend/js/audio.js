/**
 * Web Audio Alarm Synthesizer & Speech Synthesis Engine
 * Provides guaranteed in-cabin and mobile alarms without depending on external media assets.
 */

class AudioSynthesizer {
  constructor() {
    this.audioCtx = null;
    this.isAlarmPlaying = false;
    this.alarmOscillators = [];
    this.alarmGain = null;
    this.speechSynth = window.speechSynthesis || null;
    this.lastSpeechTime = 0;
    this.speechCooldown = 4000; // 4 seconds between voice prompts
    this.soundEnabled = true;
    this.voiceEnabled = true;
    this.volume = 0.8;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  }

  playBeep(frequency = 880, duration = 0.15, type = "sine") {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(this.volume * 0.4, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {
      console.warn("Audio playBeep error:", e);
    }
  }

  startEmergencySiren() {
    if (!this.soundEnabled || this.isAlarmPlaying) return;
    this.init();
    if (!this.audioCtx) return;

    this.isAlarmPlaying = true;

    try {
      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc1.type = "sawtooth";
      osc2.type = "square";

      // Dual-tone modulating siren (900Hz <-> 1400Hz)
      const now = this.audioCtx.currentTime;
      osc1.frequency.setValueAtTime(900, now);
      osc2.frequency.setValueAtTime(905, now);

      // Low frequency oscillator (LFO) for siren pitch modulation
      const lfo = this.audioCtx.createOscillator();
      const lfoGain = this.audioCtx.createGain();
      lfo.frequency.setValueAtTime(3.5, now); // 3.5Hz siren modulation
      lfoGain.gain.setValueAtTime(350, now);

      lfo.connect(osc1.frequency);
      lfo.connect(osc2.frequency);

      gain.gain.setValueAtTime(this.volume * 0.7, now);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      lfo.start(now);

      this.alarmOscillators = [osc1, osc2, lfo];
      this.alarmGain = gain;
    } catch (e) {
      console.warn("Error starting emergency siren:", e);
    }
  }

  stopEmergencySiren() {
    if (!this.isAlarmPlaying) return;
    this.isAlarmPlaying = false;

    if (this.alarmGain && this.audioCtx) {
      try {
        this.alarmGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      } catch (e) {}
    }

    this.alarmOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
    this.alarmOscillators = [];
  }

  playYawnWarningChime() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.2);
      osc.frequency.exponentialRampToValueAtTime(650, now + 0.4);

      gain.gain.setValueAtTime(this.volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {
      console.warn("Error playing yawn chime:", e);
    }
  }

  speakAlert(text) {
    if (!this.voiceEnabled || !this.speechSynth) return;

    const now = Date.now();
    if (now - this.lastSpeechTime < this.speechCooldown) {
      return; // Prevent speech overlap
    }
    this.lastSpeechTime = now;

    try {
      this.speechSynth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      utterance.pitch = 1.05;
      utterance.volume = this.volume;
      this.speechSynth.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error:", e);
    }
  }
}

// Global instance
window.audioEngine = new AudioSynthesizer();
