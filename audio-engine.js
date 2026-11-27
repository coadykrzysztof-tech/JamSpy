// JamSpy - Microphone Key Listener & Warm Acoustic Piano Synthesizer

import { midiToFreq, detectKeyStable } from './music-theory.js?v=7';

export class AudioEngine {
  constructor() {
    // Dedicated context for playing piano notes/chords
    this.audioCtx = null;
    this.masterGain = null;

    // Separate fresh context created per microphone scan so playing chords
    // or switching apps on iPhone never leaves the mic muted/interrupted!
    this.listenCtx = null;
    this.micStream = null;
    this.micSource = null;
    this.micBoost = null;
    this.silentSink = null;
    this.analyser = null;
    this.freqBuffer = null;

    this.isListening = false;
    this.rafId = null;
    this.chromaSum = new Float64Array(12);
    this.bassChromaSum = new Float64Array(12);
    this.windowChromas = [];
    this.windowBasses = [];
    this.musicalFrames = 0;
    this.totalFrames = 0;
  }

  ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (this.audioCtx && this.audioCtx.state === 'closed') {
      this.audioCtx = null;
    }
    if (!this.audioCtx) {
      this.audioCtx = new AudioContextClass();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended' || this.audioCtx.state === 'interrupted') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Plays a warm, realistic piano-style note using layered harmonics
   * and a soft hammer-felt lowpass envelope (no external audio files needed).
   */
  playPianoNote(midi, duration = 1.15, velocity = 0.75, startDelay = 0) {
    const ctx = this.ensureContext();
    // Use 'auto' (never 'playback', which disables subsequent mic capture on iOS WebKit!)
    if (navigator.audioSession && !this.isListening) {
      try { navigator.audioSession.type = 'auto'; } catch (_) { /* ignore */ }
    }

    const now = ctx.currentTime + startDelay;
    const freq = midiToFreq(midi);

    const registerScale = Math.max(0.45, Math.min(1.05, 1.15 - (midi - 48) * 0.012));
    const peakGain = 0.26 * velocity * registerScale;

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.012);
    voiceGain.gain.exponentialRampToValueAtTime(peakGain * 0.42, now + 0.22);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(6500, freq * 7.5), now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(600, freq * 2.4), now + 0.38);
    filter.Q.value = 0.7;

    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq, now);
    osc2.detune.setValueAtTime(2.2, now);

    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 2, now);
    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.28, now);
    overtoneGain.gain.exponentialRampToValueAtTime(0.02, now + 0.35);

    osc1.connect(filter);
    osc2.connect(filter);
    osc3.connect(overtoneGain);
    overtoneGain.connect(filter);

    filter.connect(voiceGain);
    voiceGain.connect(this.masterGain);

    const stopTime = now + duration + 0.05;
    osc1.start(now);
    osc2.start(now);
    osc3.start(now);
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);
  }

  playChord(midiNotes, bassMidi = null) {
    this.ensureContext();
    if (bassMidi !== null) {
      this.playPianoNote(bassMidi, 1.55, 0.68, 0);
    }
    midiNotes.forEach((midi, idx) => {
      this.playPianoNote(midi, 1.45, 0.72, 0.022 * (idx + (bassMidi ? 1 : 0)));
    });
  }

  playScalePreview(midiList, onStep = null) {
    this.ensureContext();
    const stepSeconds = 0.16;
    midiList.forEach((midi, idx) => {
      const isLast = idx === midiList.length - 1;
      this.playPianoNote(midi, isLast ? 0.95 : 0.42, isLast ? 0.82 : 0.68, idx * stepSeconds);
      if (onStep) {
        setTimeout(() => onStep(midi, idx), Math.round(idx * stepSeconds * 1000));
      }
    });
    if (onStep) {
      setTimeout(() => onStep(null, -1), Math.round((midiList.length * stepSeconds + 0.45) * 1000));
    }
  }

  /**
   * Starts listening to the room microphone using a brand-new dedicated AudioContext
   * and clean pre-amp boost so iPhone app-switching or chord playback never mutes the mic,
   * and softer 1950s/60s Jazz & Classical recordings register clearly from across the room.
   */
  async startListening({ durationMs = 12000, onProgress, onComplete, onError }) {
    if (this.isListening) {
      this.cleanupStream();
    }

    try {
      if (navigator.audioSession) {
        try { navigator.audioSession.type = 'play-and-record'; } catch (_) { /* ignore */ }
      }

      // Create a fresh AudioContext inside the tap gesture before awaiting getUserMedia
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const listenCtx = new AudioContextClass();
      this.listenCtx = listenCtx;

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true
          }
        });
      } catch (_) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      if (listenCtx.state !== 'running') {
        await listenCtx.resume();
      }

      this.micStream = stream;
      this.micSource = listenCtx.createMediaStreamSource(stream);

      // +8 dB clean digital pre-amp boost for softer vintage Jazz/Classical tracks at 10+ feet
      this.micBoost = listenCtx.createGain();
      this.micBoost.gain.value = 2.5;

      this.analyser = listenCtx.createAnalyser();
      this.analyser.fftSize = 16384;
      this.analyser.smoothingTimeConstant = 0.35;
      this.freqBuffer = new Float32Array(this.analyser.frequencyBinCount);

      // Connect through a zero-gain sink to destination so iOS Safari actively pulls mic audio frames
      this.silentSink = listenCtx.createGain();
      this.silentSink.gain.value = 0;

      this.micSource.connect(this.micBoost);
      this.micBoost.connect(this.analyser);
      this.analyser.connect(this.silentSink);
      this.silentSink.connect(listenCtx.destination);

      this.chromaSum.fill(0);
      this.bassChromaSum.fill(0);
      this.windowChromas = [];
      this.windowBasses = [];
      this.musicalFrames = 0;
      this.totalFrames = 0;
      this.isListening = true;

      const startTime = performance.now();
      let lastWindowTime = startTime;
      const currentSliceChroma = new Float64Array(12);
      const currentSliceBass = new Float64Array(12);
      let currentSliceFrames = 0;

      const sampleRate = listenCtx.sampleRate;
      const binHz = sampleRate / this.analyser.fftSize;

      const minSpecBin = Math.max(2, Math.floor(44 / binHz));
      const maxSpecBin = Math.min(this.freqBuffer.length - 4, Math.ceil(2700 / binHz));
      const linMag = new Float32Array(maxSpecBin + 20);
      const cleanMag = new Float32Array(maxSpecBin + 20);

      // Strictly symmetric 4-octave pitch span: MIDI 31 (G1) through MIDI 78 (F#5) = 48 notes
      const MIN_MIDI = 31;
      const MAX_MIDI = 78;
      const NUM_MIDI = MAX_MIDI - MIN_MIDI + 1;
      const noteSalience = new Float64Array(NUM_MIDI);

      const sampleHarmonicPeak = (freqHz) => {
        const centerBin = freqHz / binHz;
        const radius = Math.max(1, Math.round(centerBin * 0.0185));
        const lo = Math.max(minSpecBin, Math.floor(centerBin) - radius);
        const hi = Math.min(maxSpecBin, Math.ceil(centerBin) + radius);
        let best = 0;
        for (let b = lo; b <= hi; b++) {
          if (cleanMag[b] > best) best = cleanMag[b];
        }
        return best;
      };

      const flushSliceIfReady = (nowTime, force = false) => {
        if (currentSliceFrames >= 3 && (force || nowTime - lastWindowTime >= 260)) {
          let sliceTotal = 0;
          for (let i = 0; i < 12; i++) sliceTotal += currentSliceChroma[i];

          if (sliceTotal > 1e-6) {
            const normSlice = new Array(12);
            for (let i = 0; i < 12; i++) {
              normSlice[i] = currentSliceChroma[i] / sliceTotal;
              this.chromaSum[i] += normSlice[i];
            }
            this.windowChromas.push(normSlice);

            let bassTotal = 0;
            for (let i = 0; i < 12; i++) bassTotal += currentSliceBass[i];
            const normBassSlice = new Array(12).fill(0);
            if (bassTotal > 1e-6) {
              for (let i = 0; i < 12; i++) {
                normBassSlice[i] = currentSliceBass[i] / bassTotal;
                this.bassChromaSum[i] += normBassSlice[i];
              }
            }
            this.windowBasses.push(normBassSlice);
          }

          currentSliceChroma.fill(0);
          currentSliceBass.fill(0);
          currentSliceFrames = 0;
          lastWindowTime = nowTime;
        }
      };

      const analyzeFrame = () => {
        if (!this.isListening) return;

        // Auto-recover if iOS briefly interrupts the context mid-listen
        if (listenCtx.state === 'suspended' || listenCtx.state === 'interrupted') {
          listenCtx.resume().catch(() => {});
        }

        const nowTime = performance.now();
        const elapsed = nowTime - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        this.analyser.getFloatFrequencyData(this.freqBuffer);
        this.totalFrames++;

        let maxDb = -120;
        const upperLimit = Math.min(this.freqBuffer.length - 1, maxSpecBin + 16);
        for (let b = Math.max(0, minSpecBin - 16); b <= upperLimit; b++) {
          const db = this.freqBuffer[b];
          if (db > maxDb && b * binHz <= 1400) maxDb = db;
          linMag[b] = db > -98 ? Math.pow(10, db / 20) : 0;
        }

        // Running-sum spectral whitening
        cleanMag.fill(0);
        const halfWin = 12;
        let winSum = 0;
        let winCount = 0;
        for (let k = Math.max(0, minSpecBin - halfWin); k <= minSpecBin + halfWin && k <= upperLimit; k++) {
          winSum += linMag[k];
          winCount++;
        }

        for (let b = minSpecBin; b <= maxSpecBin; b++) {
          const localMean = winCount > 0 ? winSum / winCount : 0;
          const mag = linMag[b];
          if (mag > linMag[b - 1] && mag >= linMag[b + 1]) {
            const prom = mag - localMean * 1.34;
            if (prom > 0) cleanMag[b] = prom;
          }
          const removeIdx = b - halfWin;
          const addIdx = b + halfWin + 1;
          if (removeIdx >= 0) {
            winSum -= linMag[removeIdx];
            winCount--;
          }
          if (addIdx <= upperLimit) {
            winSum += linMag[addIdx];
            winCount++;
          }
        }

        noteSalience.fill(0);
        for (let idx = 0; idx < NUM_MIDI; idx++) {
          const midi = MIN_MIDI + idx;
          const f0 = midiToFreq(midi);
          const h1 = sampleHarmonicPeak(f0);
          const h2 = sampleHarmonicPeak(f0 * 2);
          const h3 = sampleHarmonicPeak(f0 * 3);
          const h4 = f0 * 4 <= 2680 ? sampleHarmonicPeak(f0 * 4) : 0;

          const hasFundamental = h1 > 0;
          const hasMissingFundBass = midi < 52 && h2 > 0 && h3 > 0;

          if (!hasFundamental && !hasMissingFundBass) continue;

          const speakerBassComp = f0 < 165 ? Math.min(2.1, Math.pow(165 / f0, 0.72)) : 1.0;
          noteSalience[idx] = (h1 * 1.0 + h2 * 0.68 + h3 * 0.42 + h4 * 0.25) * speakerBassComp;
        }

        for (let idx = 0; idx < NUM_MIDI; idx++) {
          const s = noteSalience[idx];
          if (s <= 0) continue;
          if (idx + 12 < NUM_MIDI) {
            noteSalience[idx + 12] = Math.max(0, noteSalience[idx + 12] - 0.55 * s);
          }
          if (idx + 19 < NUM_MIDI) {
            noteSalience[idx + 19] = Math.max(0, noteSalience[idx + 19] - 0.52 * s);
          }
          if (idx + 24 < NUM_MIDI) {
            noteSalience[idx + 24] = Math.max(0, noteSalience[idx + 24] - 0.30 * s);
          }
          if (idx + 28 < NUM_MIDI) {
            noteSalience[idx + 28] = Math.max(0, noteSalience[idx + 28] - 0.14 * s);
          }
        }

        const frameChroma = new Float64Array(12);
        const frameBass = new Float64Array(12);
        let frameTotal = 0;

        for (let idx = 0; idx < NUM_MIDI; idx++) {
          const s = noteSalience[idx];
          if (s <= 0) continue;
          const midi = MIN_MIDI + idx;
          const pc = midi % 12;
          const energy = Math.pow(s, 0.78);
          frameChroma[pc] += energy;
          frameTotal += energy;

          if (midi <= 54) {
            frameBass[pc] += energy;
          }
        }

        const hearingMusic = frameTotal > 1e-5 && maxDb > -88;
        if (hearingMusic) {
          this.musicalFrames++;
          currentSliceFrames++;
          for (let i = 0; i < 12; i++) {
            currentSliceChroma[i] += frameChroma[i];
            currentSliceBass[i] += frameBass[i];
          }
        }

        flushSliceIfReady(nowTime, false);

        const level = Math.max(0, Math.min(1, (maxDb + 84) / 50));
        const liveGuess = this.windowChromas.length >= 6
          ? detectKeyStable(
              Array.from(this.chromaSum),
              Array.from(this.bassChromaSum),
              this.windowChromas,
              this.windowBasses
            )
          : null;

        if (onProgress) {
          onProgress({
            progress,
            remainingSeconds: Math.max(0, Math.ceil((durationMs - elapsed) / 1000)),
            level,
            hearingMusic,
            liveKeyName: liveGuess ? liveGuess.key.name : null
          });
        }

        if (progress >= 1) {
          flushSliceIfReady(nowTime, true);
          this.finishListening(onComplete);
        } else {
          this.rafId = requestAnimationFrame(analyzeFrame);
        }
      };

      this.rafId = requestAnimationFrame(analyzeFrame);
    } catch (err) {
      this.cleanupStream();
      if (onError) {
        onError(err);
      }
    }
  }

  finishListening(onComplete) {
    const hadEnoughMusic = this.musicalFrames >= 8 && this.windowChromas.length >= 2;
    const chromaArr = Array.from(this.chromaSum);
    const bassArr = Array.from(this.bassChromaSum);
    const slices = this.windowChromas.slice();
    const bassSlices = this.windowBasses.slice();

    this.cleanupStream();

    if (!hadEnoughMusic) {
      if (onComplete) {
        onComplete({ tooQuiet: true, result: null });
      }
      return;
    }

    const result = detectKeyStable(chromaArr, bassArr, slices, bassSlices);
    if (onComplete) {
      onComplete({ tooQuiet: !result, result });
    }
  }

  stopListening(onComplete = null) {
    if (!this.isListening) return;
    if (onComplete) {
      this.finishListening(onComplete);
    } else {
      this.cleanupStream();
    }
  }

  cleanupStream() {
    this.isListening = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch (_) { /* ignore */ }
      this.micSource = null;
    }
    if (this.micBoost) {
      try { this.micBoost.disconnect(); } catch (_) { /* ignore */ }
      this.micBoost = null;
    }
    if (this.silentSink) {
      try { this.silentSink.disconnect(); } catch (_) { /* ignore */ }
      this.silentSink = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.analyser = null;
    if (this.listenCtx) {
      try { this.listenCtx.close(); } catch (_) { /* ignore */ }
      this.listenCtx = null;
    }
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'auto'; } catch (_) { /* ignore */ }
    }
  }
}
