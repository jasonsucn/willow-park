(function (global) {
  "use strict";

  const SCALE = [0, 2, 4, 7, 9];
  const STEP_SECONDS = 60 / 68 / 2;
  const MEASURE_SECONDS = STEP_SECONDS * 8;
  const MIX_LEVELS = {
    balanced: { nature: 0.68, music: 0.76 },
    nature: { nature: 0.94, music: 0 },
    music: { nature: 0.15, music: 0.94 }
  };
  const MELODY_PATTERNS = [
    [3, null, 4, 2, 3, null, 1, null],
    [2, 4, null, 3, null, 2, 0, null],
    [4, null, 2, null, 3, 1, null, 2],
    [3, 2, null, 4, 3, null, 1, null]
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(label + " must be a finite number");
    }
    return number;
  }

  class ParkAudio {
    constructor() {
      this._context = null;
      this._enabled = false;
      this._volume = 0.72;
      this._timeOfDay = 0.5;
      this._mix = "balanced";
      this._masterRamp = {
        startTime: 0,
        endTime: 0,
        startValue: 0,
        endValue: 0
      };
      this._musicTimer = null;
      this._birdTimer = null;
      this._suspendTimer = null;
      this._pendingSuspendResolve = null;
      this._pendingSuspendPromise = null;
      this._transition = 0;
      this._isFadingOut = false;
      this._voiceGroups = new Set();
      this._stepIndex = 0;
      this._nextStepTime = 0;
      this._activeMelody = MELODY_PATTERNS[0];
    }

    get enabled() {
      return this._enabled;
    }

    async setEnabled(enabled) {
      const shouldEnable = Boolean(enabled);
      if (!shouldEnable) {
        if (!this._context) {
          this._enabled = false;
          return;
        }
        if (!this._enabled && this._suspendTimer) {
          await this._pendingSuspendPromise;
          return;
        }
        if (!this._enabled && this._context.state === "suspended") {
          return;
        }

        this._enabled = false;
        this._isFadingOut = true;
        const transition = ++this._transition;
        this._stopSchedulers();
        const context = this._context;
        if (context.state !== "running") {
          this._stopActiveVoices();
          this._master.gain.cancelScheduledValues(context.currentTime);
          this._master.gain.setValueAtTime(0, context.currentTime);
          this._masterRamp = {
            startTime: context.currentTime,
            endTime: context.currentTime,
            startValue: 0,
            endValue: 0
          };
          this._isFadingOut = false;
          return;
        }
        this._rampMaster(0, 0.30);

        this._pendingSuspendPromise = new Promise((resolve) => {
          this._pendingSuspendResolve = resolve;
          this._suspendTimer = global.setTimeout(async () => {
            this._suspendTimer = null;
            if (transition === this._transition && !this._enabled) {
              this._stopActiveVoices();
              try {
                if (context.state === "running") {
                  await context.suspend();
                }
              } catch (_) {
                // A browser may suspend the context independently.
              }
              this._isFadingOut = false;
            }
            this._resolvePendingSuspend();
          }, 360);
        });
        await this._pendingSuspendPromise;
        return;
      }

      if (this._enabled && this._context && this._context.state === "running") {
        return;
      }

      const wasFadingOut = this._isFadingOut;
      this._assertUserActivation();
      const transition = ++this._transition;
      this._cancelPendingSuspend();
      this._isFadingOut = false;

      if (!this._context) {
        this._createGraph();
      } else if (wasFadingOut) {
        if (this._context.state === "running") {
          this._rampMaster(0, 0.09);
          await new Promise((resolve) => global.setTimeout(resolve, 110));
          if (transition !== this._transition) {
            return;
          }
        }
        this._stopActiveVoices();
        if (this._context.state !== "running") {
          const now = this._context.currentTime;
          this._master.gain.cancelScheduledValues(now);
          this._master.gain.setValueAtTime(0, now);
          this._masterRamp = {
            startTime: now,
            endTime: now,
            startValue: 0,
            endValue: 0
          };
        }
      }

      this._enabled = true;
      try {
        if (this._context.state !== "running") {
          await this._context.resume();
        }
        if (transition !== this._transition || !this._enabled) {
          return;
        }
        this._startSchedulers();
        this._rampMaster(this._volume * 0.68, 0.85);
      } catch (error) {
        if (transition === this._transition) {
          this._enabled = false;
          this._stopSchedulers();
        }
        throw error;
      }
    }

    setMix(mix) {
      if (!Object.prototype.hasOwnProperty.call(MIX_LEVELS, mix)) {
        throw new RangeError("mix must be 'balanced', 'nature', or 'music'");
      }
      this._mix = mix;
      this._applyMix();
      return this;
    }

    setVolume(volume) {
      this._volume = clamp(finiteNumber(volume, "volume"), 0, 1);
      if (this._context && this._enabled) {
        this._rampMaster(this._volume * 0.68, 0.16);
      }
      return this;
    }

    setTimeOfDay(timeOfDay) {
      this._timeOfDay = clamp(finiteNumber(timeOfDay, "timeOfDay"), 0, 1);
      this._applyTimeOfDay();
      return this;
    }

    _assertUserActivation() {
      const activation = global.navigator && global.navigator.userActivation;
      if (activation && !activation.isActive) {
        throw new Error("Enable park audio from a user gesture.");
      }
    }

    _createGraph() {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Web Audio is not supported by this browser.");
      }

      const context = new AudioContextClass();
      this._context = context;

      this._master = context.createGain();
      this._master.gain.value = 0;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -23;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.012;
      compressor.release.value = 0.24;
      this._master.connect(compressor);
      compressor.connect(context.destination);

      this._musicBus = context.createGain();
      this._natureBus = context.createGain();
      this._musicBus.connect(this._master);
      this._natureBus.connect(this._master);

      const impulseLength = Math.floor(context.sampleRate * 1.85);
      const impulse = context.createBuffer(2, impulseLength, context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < impulseLength; i += 1) {
          const decay = Math.pow(1 - i / impulseLength, 2.7);
          data[i] = (Math.random() * 2 - 1) * decay;
        }
      }
      this._reverb = context.createConvolver();
      this._reverb.buffer = impulse;
      this._reverbReturn = context.createGain();
      this._reverbReturn.gain.value = 0.18;
      this._musicSend = context.createGain();
      this._musicSend.gain.value = 0.21;
      this._musicSend.connect(this._reverb);
      this._reverb.connect(this._reverbReturn);
      this._reverbReturn.connect(this._master);

      const real = new Float32Array(8);
      const imaginary = new Float32Array(8);
      [0, 1, 0.46, 0.23, 0.12, 0.065, 0.035, 0.018].forEach((value, index) => {
        imaginary[index] = value;
      });
      this._pianoWave = context.createPeriodicWave(real, imaginary);

      const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i += 1) {
        noiseData[i] = Math.random() * 2 - 1;
      }
      this._noiseSource = context.createBufferSource();
      this._noiseSource.buffer = noiseBuffer;
      this._noiseSource.loop = true;

      this._waterHigh = context.createBiquadFilter();
      this._waterHigh.type = "highpass";
      this._waterHigh.frequency.value = 190;
      this._waterLow = context.createBiquadFilter();
      this._waterLow.type = "lowpass";
      this._waterLow.frequency.value = 1900;
      this._waterLow.Q.value = 0.55;
      this._waterGain = context.createGain();
      this._waterGain.gain.value = 0.135;
      this._waterPan = this._createPanner(-0.28);
      this._noiseSource.connect(this._waterHigh);
      this._waterHigh.connect(this._waterLow);
      this._waterLow.connect(this._waterGain);
      this._waterGain.connect(this._waterPan);
      this._waterPan.connect(this._natureBus);

      this._windHigh = context.createBiquadFilter();
      this._windHigh.type = "highpass";
      this._windHigh.frequency.value = 65;
      this._windLow = context.createBiquadFilter();
      this._windLow.type = "lowpass";
      this._windLow.frequency.value = 500;
      this._windLow.Q.value = 0.38;
      this._windGain = context.createGain();
      this._windGain.gain.value = 0.078;
      this._windPan = this._createPanner(0.25);
      this._noiseSource.connect(this._windHigh);
      this._windHigh.connect(this._windLow);
      this._windLow.connect(this._windGain);
      this._windGain.connect(this._windPan);
      this._windPan.connect(this._natureBus);
      this._noiseSource.start();

      this._startModulator(0.11, 0.023, this._waterGain.gain);
      this._startModulator(0.047, 0.036, this._windGain.gain);
      this._applyMix(true);
      this._applyTimeOfDay(true);
    }

    _createPanner(pan) {
      const context = this._context;
      if (context.createStereoPanner) {
        const panner = context.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        return panner;
      }
      const panner = context.createPanner();
      panner.panningModel = "equalpower";
      panner.setPosition(pan, 0, 1);
      return panner;
    }

    _startModulator(frequency, depth, parameter) {
      const oscillator = this._context.createOscillator();
      const amount = this._context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      amount.gain.value = depth;
      oscillator.connect(amount);
      amount.connect(parameter);
      oscillator.start();
    }

    _applyMix(immediate) {
      if (!this._context || !this._musicBus || !this._natureBus) {
        return;
      }
      const levels = MIX_LEVELS[this._mix];
      const now = this._context.currentTime;
      const timeConstant = immediate ? 0.01 : 0.38;
      this._setTarget(this._musicBus.gain, levels.music, now, timeConstant);
      this._setTarget(this._natureBus.gain, levels.nature, now, timeConstant);
    }

    _applyTimeOfDay(immediate) {
      if (!this._context || !this._waterLow || !this._windGain) {
        return;
      }
      const daylight = 0.5 - 0.5 * Math.cos(this._timeOfDay * Math.PI * 2);
      const now = this._context.currentTime;
      const timeConstant = immediate ? 0.01 : 0.72;
      const waterBrightness = 1550 + daylight * 650;
      const windLevel = 0.075 + (1 - daylight) * 0.022;
      this._setTarget(this._waterLow.frequency, waterBrightness, now, timeConstant);
      this._setTarget(this._windGain.gain, windLevel, now, timeConstant);
    }

    _setTarget(parameter, value, time, timeConstant) {
      parameter.cancelScheduledValues(time);
      parameter.setTargetAtTime(value, time, timeConstant);
    }

    _gainAt(time) {
      const ramp = this._masterRamp;
      if (time <= ramp.startTime) {
        return ramp.startValue;
      }
      if (time >= ramp.endTime || ramp.endTime <= ramp.startTime) {
        return ramp.endValue;
      }
      const progress = (time - ramp.startTime) / (ramp.endTime - ramp.startTime);
      return ramp.startValue + (ramp.endValue - ramp.startValue) * progress;
    }

    _rampMaster(target, duration) {
      if (!this._context || !this._master) {
        return;
      }
      const now = this._context.currentTime;
      const startValue = this._gainAt(now);
      const endTime = now + Math.max(0.01, duration);
      const parameter = this._master.gain;
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(startValue, now);
      parameter.linearRampToValueAtTime(target, endTime);
      this._masterRamp = {
        startTime: now,
        endTime: endTime,
        startValue: startValue,
        endValue: target
      };
    }

    _startSchedulers() {
      if (!this._enabled || !this._context || this._musicTimer) {
        return;
      }
      this._nextStepTime = this._context.currentTime + 0.28;
      this._musicTimer = global.setInterval(() => this._scheduleMusic(), 220);
      this._scheduleNextBird(4200 + Math.random() * 4200);
    }

    _stopSchedulers() {
      if (this._musicTimer) {
        global.clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
      if (this._birdTimer) {
        global.clearTimeout(this._birdTimer);
        this._birdTimer = null;
      }
    }

    _scheduleMusic() {
      if (!this._enabled || !this._context) {
        return;
      }
      const now = this._context.currentTime;
      if (this._nextStepTime < now - STEP_SECONDS * 1.5) {
        const missedSteps = Math.floor((now - this._nextStepTime) / STEP_SECONDS) + 1;
        this._stepIndex += missedSteps;
        this._nextStepTime += missedSteps * STEP_SECONDS;
      }
      const horizon = now + 1.25;
      let guard = 0;
      while (this._nextStepTime < horizon && guard < 12) {
        this._scheduleMusicStep(this._stepIndex, this._nextStepTime);
        this._stepIndex += 1;
        this._nextStepTime += STEP_SECONDS;
        guard += 1;
      }
    }

    _scheduleMusicStep(step, time) {
      const slot = step % 8;
      const measure = Math.floor(step / 8);
      const chordRoot = [0, 3, 4, 2][measure % 4];

      if (slot === 0) {
        this._activeMelody = MELODY_PATTERNS[measure % MELODY_PATTERNS.length];
        this._playPadChord(chordRoot, time);
        this._playBass(38 + SCALE[chordRoot], time, 0.82);
      } else if (slot === 4) {
        const bassDegree = chordRoot + 2;
        this._playBass(38 + SCALE[bassDegree % 5] + 12 * Math.floor(bassDegree / 5), time, 0.55);
      }

      const degree = this._activeMelody[slot];
      if (degree !== null && degree !== undefined) {
        const octave = Math.random() < 0.13 ? 12 : 0;
        const midi = 62 + SCALE[degree] + octave;
        const velocity = 0.67 + Math.random() * 0.20;
        const pan = (Math.random() - 0.5) * 0.54;
        this._playPiano(midi, time, velocity, pan);
      }
    }

    _playPadChord(root, time) {
      const context = this._context;
      const notePans = [-0.16, 0, 0.16];
      const duration = MEASURE_SECONDS * 0.98;
      for (let tone = 0; tone < 3; tone += 1) {
        const degree = root + tone * 2;
        const midi = 62 + SCALE[degree % 5] + 12 * Math.floor(degree / 5);
        const frequency = this._frequency(midi);
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, time);
        envelope.gain.exponentialRampToValueAtTime(0.012, time + 0.52);
        envelope.gain.setValueAtTime(0.0105, time + duration - 0.62);
        envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        const panner = this._routeMusicVoice(envelope, notePans[tone]);
        const voices = [];
        [-4, 4].forEach((detune) => {
          const oscillator = context.createOscillator();
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          oscillator.detune.value = detune;
          oscillator.connect(envelope);
          oscillator.start(time);
          oscillator.stop(time + duration + 0.025);
          voices.push(oscillator);
        });
        this._registerVoice(voices, [envelope, panner]);
      }
    }

    _playPiano(midi, time, velocity, pan) {
      const context = this._context;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const panner = this._routeMusicVoice(envelope, pan);
      const peak = 0.145 * velocity;
      const duration = 0.92 + Math.random() * 0.24;
      oscillator.setPeriodicWave(this._pianoWave);
      oscillator.frequency.value = this._frequency(midi);
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(peak, time + 0.014);
      envelope.gain.exponentialRampToValueAtTime(peak * 0.42, time + 0.15);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      oscillator.connect(envelope);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.025);
      this._registerVoice([oscillator], [envelope, panner]);
    }

    _playBass(midi, time, velocity) {
      const context = this._context;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const panner = this._routeMusicVoice(envelope, -0.06);
      const duration = 0.86;
      oscillator.type = "sine";
      oscillator.frequency.value = this._frequency(midi);
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(0.105 * velocity, time + 0.04);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      oscillator.connect(envelope);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.025);
      this._registerVoice([oscillator], [envelope, panner]);
    }

    _routeMusicVoice(source, pan) {
      const panner = this._createPanner(pan);
      source.connect(panner);
      panner.connect(this._musicBus);
      panner.connect(this._musicSend);
      return panner;
    }

    _scheduleNextBird(delay) {
      if (!this._enabled) {
        return;
      }
      if (this._birdTimer) {
        global.clearTimeout(this._birdTimer);
      }
      this._birdTimer = global.setTimeout(() => {
        this._birdTimer = null;
        if (!this._enabled || !this._context) {
          return;
        }
        this._playBirdPhrase();
        const daylight = 0.5 - 0.5 * Math.cos(this._timeOfDay * Math.PI * 2);
        const nightFactor = 1 + (1 - daylight) * 0.58;
        const natureLevel = MIX_LEVELS[this._mix].nature;
        const mixFactor = 1 / Math.sqrt(natureLevel);
        const nextDelay = clamp((7600 + Math.random() * 9000) * nightFactor * mixFactor, 8500, 30000);
        this._scheduleNextBird(nextDelay);
      }, delay);
    }

    _playBirdPhrase() {
      const count = 2 + Math.floor(Math.random() * 3);
      let offset = 0.06;
      for (let i = 0; i < count; i += 1) {
        const daylight = 0.5 - 0.5 * Math.cos(this._timeOfDay * Math.PI * 2);
        const start = this._context.currentTime + offset;
        const baseFrequency = 1950 + Math.random() * 1050;
        const rising = Math.random() < 0.58;
        const endFrequency = baseFrequency * (rising ? 1.18 + Math.random() * 0.12 : 0.79 + Math.random() * 0.11);
        const duration = 0.085 + Math.random() * 0.075;
        const oscillator = this._context.createOscillator();
        const envelope = this._context.createGain();
        const pan = (Math.random() - 0.5) * 0.7;
        const panner = this._createPanner(pan);
        const peak = (0.095 + Math.random() * 0.035) * (0.42 + daylight * 0.58);
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(baseFrequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.04);
        oscillator.connect(envelope);
        envelope.connect(panner);
        panner.connect(this._natureBus);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.055);
        this._registerVoice([oscillator], [envelope, panner]);
        offset += duration + 0.045 + Math.random() * 0.075;
      }
    }

    _registerVoice(sources, extraNodes) {
      const group = {
        sources: sources,
        nodes: sources.concat(extraNodes),
        remaining: sources.length,
        closed: false
      };
      this._voiceGroups.add(group);
      sources.forEach((source) => {
        source.onended = () => {
          try {
            source.disconnect();
          } catch (_) {
            // Disconnect may already have happened during a toggle.
          }
          if (group.closed) {
            return;
          }
          group.remaining -= 1;
          if (group.remaining <= 0) {
            this._disconnectVoiceGroup(group);
          }
        };
      });
    }

    _disconnectVoiceGroup(group) {
      if (group.closed) {
        return;
      }
      group.closed = true;
      this._voiceGroups.delete(group);
      group.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch (_) {
          // Nodes may have been disconnected by the browser already.
        }
      });
    }

    _stopActiveVoices() {
      const now = this._context ? this._context.currentTime : 0;
      Array.from(this._voiceGroups).forEach((group) => {
        group.sources.forEach((source) => {
          try {
            source.stop(now);
          } catch (_) {
            // The source may already have ended.
          }
        });
        this._disconnectVoiceGroup(group);
      });
    }

    _resolvePendingSuspend() {
      const resolve = this._pendingSuspendResolve;
      this._pendingSuspendResolve = null;
      this._pendingSuspendPromise = null;
      if (resolve) {
        resolve();
      }
    }

    _cancelPendingSuspend() {
      if (this._suspendTimer) {
        global.clearTimeout(this._suspendTimer);
        this._suspendTimer = null;
      }
      this._resolvePendingSuspend();
    }

    splash() {
      if (!this._enabled || !this._context || this._context.state !== 'running') return;
      const context = this._context, now = context.currentTime;
      if (this._lastSplash && now - this._lastSplash < 0.18) return;
      this._lastSplash = now;
      const tone = context.createOscillator(), gain = context.createGain();
      tone.type = 'sine'; tone.frequency.setValueAtTime(690, now); tone.frequency.exponentialRampToValueAtTime(195, now + 0.21);
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.09, now + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      tone.connect(gain); gain.connect(this._natureBus); tone.start(now); tone.stop(now + 0.45);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    }

    _frequency(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }
  }

  global.ParkAudio = ParkAudio;
})(window);
