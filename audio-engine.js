// JamSpy - Microphone Key Listener & Warm Acoustic Piano Synthesizer

import { midiToFreq, detectKeyFromChroma } from './music-theory.js?v=4';

export class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.micStream = null;
    this.micSource = null;
    this.analyser = null;
    this.freqBuffer = null;

    this.isListening = false;
    this.rafId = null;
    this.chromaSum = new Float64Array(12);
    this.bassChromaSum = new Float64Array(12);
    this.windowChromas = [];
    this.musicalFrames = 0;
    this.totalFrames = 0;
  }

  ensureContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Plays a warm, realistic piano-style note using layered harmonics
   * and a soft hammer-felt lowpass envelope (no external audio files needed).
   */
  playPianoNote(midi, duration = 1.15, velocity = 0.75, startDelay = 0) {
    const ctx = this.ensureContext();
    if (navigator.audioSession && !this.isListening) {
      try { navigator.audioSession.type = 'playback'; } catch (_) { /* ignore */ }
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
   * Starts listening to the room microphone to detect the song's key.
   * Uses harmonic overtone unmixing + normalized 250ms chord slices so small
   * phone/laptop speakers and loud vocal spikes don't skew the key toward the 5th.
   */
  async startListening({ durationMs = 12000, onProgress, onComplete, onError }) {
    if (this.isListening) {
      this.stopListening();
    }

    try {
      const ctx = this.ensureContext();
      if (navigator.audioSession) {
        try { navigator.audioSession.type = 'play-and-record'; } catch (_) { /* ignore */ }
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true // Boosts quiet chords when phone is 10-15 ft across the room
          }
        });
      } catch (_) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      await ctx.resume();

      this.micStream = stream;
      this.micSource = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 16384;
      this.analyser.smoothingTimeConstant = 0.35;
      this.freqBuffer = new Float32Array(this.analyser.frequencyBinCount);

      this.micSource.connect(this.analyser);

      this.chromaSum.fill(0);
      this.bassChromaSum.fill(0);
      this.windowChromas = [];
      this.musicalFrames = 0;
      this.totalFrames = 0;
      this.isListening = true;

      const startTime = performance.now();
      let lastWindowTime = startTime;
      const currentSliceChroma = new Float64Array(12);
      const currentSliceBass = new Float64Array(12);
      let currentSliceFrames = 0;

      const sampleRate = ctx.sampleRate;
      const binHz = sampleRate / this.analyser.fftSize;

      // Spectrum from ~44 Hz up to ~2700 Hz so low A1/B1 bass notes & upper harmonics are captured
      const minSpecBin = Math.max(2, Math.floor(44 / binHz));
      const maxSpecBin = Math.min(this.freqBuffer.length - 4, Math.ceil(2700 / binHz));
      const linMag = new Float32Array(maxSpecBin + 20);
      const cleanMag = new Float32Array(maxSpecBin + 20);

      // Strictly symmetric 4-octave pitch span: MIDI 31 (G1 = 49.0 Hz) through MIDI 78 (F#5 = 740 Hz) = 48 notes!
      // Every single pitch class (C..B, including A and B) gets the exact same 4 octaves (2 octaves in bass: 31..54).
      const MIN_MIDI = 31;
      const MAX_MIDI = 78;
      const NUM_MIDI = MAX_MIDI - MIN_MIDI + 1; // 48
      const noteSalience = new Float64Array(NUM_MIDI);

      // Helper to sample narrow harmonic peak around target Hz (within ±32 cents)
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
        if (currentSliceFrames >= 4 && (force || nowTime - lastWindowTime >= 260)) {
          let sliceTotal = 0;
          for (let i = 0; i < 12; i++) sliceTotal += currentSliceChroma[i];

          if (sliceTotal > 1e-6) {
            // Normalize each 260ms slice so one loud vocal belt doesn't overpower 3 quieter bars!
            const normSlice = new Array(12);
            for (let i = 0; i < 12; i++) {
              normSlice[i] = currentSliceChroma[i] / sliceTotal;
              this.chromaSum[i] += normSlice[i];
            }
            this.windowChromas.push(normSlice);

            let bassTotal = 0;
            for (let i = 0; i < 12; i++) bassTotal += currentSliceBass[i];
            if (bassTotal > 1e-6) {
              for (let i = 0; i < 12; i++) {
                this.bassChromaSum[i] += currentSliceBass[i] / bassTotal;
              }
            }
          }

          currentSliceChroma.fill(0);
          currentSliceBass.fill(0);
          currentSliceFrames = 0;
          lastWindowTime = nowTime;
        }
      };

      const analyzeFrame = () => {
        if (!this.isListening) return;

        const nowTime = performance.now();
        const elapsed = nowTime - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        this.analyser.getFloatFrequencyData(this.freqBuffer);
        this.totalFrames++;

        // 1. Convert dB spectrum to linear magnitude
        let maxDb = -120;
        const upperLimit = Math.min(this.freqBuffer.length - 1, maxSpecBin + 16);
        for (let b = Math.max(0, minSpecBin - 16); b <= upperLimit; b++) {
          const db = this.freqBuffer[b];
          if (db > maxDb && b * binHz <= 1200) maxDb = db;
          linMag[b] = db > -94 ? Math.pow(10, db / 20) : 0;
        }

        // 2. Running-sum spectral whitening to strip out drums, vocal breath, and speaker hiss
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
          // Keep sharp harmonic peaks standing clearly above local broadband noise floor
          if (mag > linMag[b - 1] && mag >= linMag[b + 1]) {
            const prom = mag - localMean * 1.42;
            if (prom > 0) cleanMag[b] = prom;
          }
          // Slide window by 1 bin
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

        // 3. Harmonic Pitch Salience per MIDI note (recovers small-speaker bass & removes 3rd-harmonic 5th ghosts)
        noteSalience.fill(0);
        for (let idx = 0; idx < NUM_MIDI; idx++) {
          const midi = MIN_MIDI + idx;
          const f0 = midiToFreq(midi);
          const h1 = sampleHarmonicPeak(f0);
          const h2 = sampleHarmonicPeak(f0 * 2);
          const h3 = sampleHarmonicPeak(f0 * 3);
          const h4 = f0 * 4 <= 2680 ? sampleHarmonicPeak(f0 * 4) : 0;

          // Require true fundamental OR (for low notes on small speakers) clear 2nd + odd 3rd harmonic
          const hasFundamental = h1 > 0;
          const hasMissingFundBass = midi < 52 && h2 > 0 && h3 > 0;

          if (!hasFundamental && !hasMissingFundBass) continue;

          // Compensate gently for small phone/laptop speaker bass roll-off below 165 Hz (E3)
          const speakerBassComp = f0 < 165 ? Math.min(2.1, Math.pow(165 / f0, 0.72)) : 1.0;
          noteSalience[idx] = (h1 * 1.0 + h2 * 0.68 + h3 * 0.42 + h4 * 0.25) * speakerBassComp;
        }

        // Subtract octave (m+12) and 3rd-harmonic Perfect 5th (m+19) ghosts from upper notes!
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
            // Gently trim 5th-harmonic overtone without erasing real Major 3rd chord tones 2 octaves up
            noteSalience[idx + 28] = Math.max(0, noteSalience[idx + 28] - 0.14 * s);
          }
        }

        // Fold clean note salience into 12 pitch classes
        const frameChroma = new Float64Array(12);
        const frameBass = new Float64Array(12);
        let frameTotal = 0;

        for (let idx = 0; idx < NUM_MIDI; idx++) {
          const s = noteSalience[idx];
          if (s <= 0) continue;
          const midi = MIN_MIDI + idx;
          const pc = midi % 12;
          // Mild compression within a single frame
          const energy = Math.pow(s, 0.78);
          frameChroma[pc] += energy;
          frameTotal += energy;

          if (midi <= 54) { // Symmetric 2-octave bass & low-guitar root zone (MIDI 31..54 = 24 notes)
            frameBass[pc] += energy;
          }
        }

        const hearingMusic = frameTotal > 3e-5 && maxDb > -82;
        if (hearingMusic) {
          this.musicalFrames++;
          currentSliceFrames++;
          for (let i = 0; i < 12; i++) {
            currentSliceChroma[i] += frameChroma[i];
            currentSliceBass[i] += frameBass[i];
          }
        }

        flushSliceIfReady(nowTime, false);

        const level = Math.max(0, Math.min(1, (maxDb + 78) / 48));
        const liveGuess = this.windowChromas.length >= 6
          ? detectKeyFromChroma(
              Array.from(this.chromaSum),
              Array.from(this.bassChromaSum),
              this.windowChromas
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
    const hadEnoughMusic = this.musicalFrames >= 12 && this.windowChromas.length >= 2;
    const chromaArr = Array.from(this.chromaSum);
    const bassArr = Array.from(this.bassChromaSum);
    const slices = this.windowChromas.slice();

    this.cleanupStream();

    if (!hadEnoughMusic) {
      if (onComplete) {
        onComplete({ tooQuiet: true, result: null });
      }
      return;
    }

    const result = detectKeyFromChroma(chromaArr, bassArr, slices);
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
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.analyser = null;
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch (_) { /* ignore */ }
    }
  }
}
