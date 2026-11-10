/*
 * Classroom Casino — sound effects, synthesised live with the Web Audio API
 * (no audio files needed, works offline).
 */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;
  let volume = 0.8;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(o) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.dur || 0.2));
    if (o.detune) osc.detune.value = o.detune;
    const peak = o.gain == null ? 0.2 : o.gain;
    const atk = o.attack || 0.004;
    const dur = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(o) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 3000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.dur || 0.1));
    f.Q.value = o.q == null ? 1 : o.q;
    const g = c.createGain();
    const peak = o.gain == null ? 0.2 : o.gain;
    const dur = o.dur || 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function arpeggio(notes, step, o) {
    notes.forEach((n, i) => tone(Object.assign({ freq: NOTE(n), at: i * step }, o)));
  }

  const Sound = {
    unlock() { ensure(); },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled && ctx) ctx.suspend();
      if (enabled) ensure();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
    get enabled() { return enabled; },

    tick() {
      tone({ freq: 2100, type: 'triangle', dur: 0.035, gain: 0.12 });
      noise({ freq: 5200, q: 2, dur: 0.02, gain: 0.08 });
    },
    click() {
      tone({ freq: 900, type: 'triangle', dur: 0.06, gain: 0.08 });
    },
    spin() {
      noise({ freq: 400, to: 2400, q: 0.8, dur: 0.5, gain: 0.12, attack: 0.08 });
    },
    deal() {
      noise({ freq: 1800, to: 6500, q: 0.7, dur: 0.16, gain: 0.22, attack: 0.02 });
      noise({ at: 0.15, freq: 2500, q: 1.5, dur: 0.04, gain: 0.16 });
    },
    flip() {
      noise({ freq: 3200, to: 1600, q: 1.2, dur: 0.09, gain: 0.2 });
    },
    chip() {
      const base = 2600 + Math.random() * 300;
      [1, 1.47, 2.09].forEach((m, i) =>
        tone({ freq: base * m, dur: 0.16 - i * 0.03, gain: 0.07 / (i + 1) }));
      [1, 1.52].forEach((m) => tone({ at: 0.06, freq: base * 1.08 * m, dur: 0.12, gain: 0.05 }));
    },
    shuffle() {
      for (let i = 0; i < 18; i++) {
        noise({ at: i * 0.035 + Math.random() * 0.01, freq: 2500 + Math.random() * 2500, q: 2, dur: 0.03, gain: 0.12 });
      }
      noise({ at: 0.7, freq: 1500, q: 0.8, dur: 0.18, gain: 0.18 });
    },
    /** The ball rolling round the wooden track, fading as it slows. */
    roll(seconds) {
      const d = Math.max(0.5, seconds || 3);
      noise({ freq: 1500, to: 520, q: 0.7, dur: d, gain: 0.11, attack: 0.12 });
      noise({ freq: 260, to: 140, q: 0.9, dur: d * 0.9, gain: 0.07, attack: 0.2 });
    },
    /** The ball hitting a diamond or a fret. */
    clack(intensity) {
      const v = intensity == null ? 1 : intensity;
      noise({ freq: 3800 + Math.random() * 1200, q: 2.5, dur: 0.035, gain: 0.26 * v });
      tone({ freq: 2300 + Math.random() * 700, type: 'triangle', dur: 0.05, gain: 0.07 * v });
    },
    /** The croupier's bell when the number is called. */
    ding() {
      [[1568, 0], [2093, 0.14]].forEach(([f, at]) => {
        tone({ at, freq: f, type: 'sine', dur: 1.1, gain: 0.12 });
        tone({ at, freq: f * 2.76, type: 'sine', dur: 0.5, gain: 0.025 });
      });
    },
    peek() {
      noise({ freq: 2000, to: 3000, q: 1, dur: 0.12, gain: 0.1 });
    },
    win() {
      arpeggio([72, 76, 79, 84], 0.09, { type: 'triangle', dur: 0.35, gain: 0.16 });
      arpeggio([60, 64, 67], 0, { at: 0.36, type: 'sine', dur: 0.9, gain: 0.08 });
      tone({ at: 0.36, freq: NOTE(84), type: 'triangle', dur: 0.9, gain: 0.1 });
    },
    blackjack() {
      arpeggio([72, 76, 79, 84, 88, 91, 96], 0.06, { type: 'triangle', dur: 0.3, gain: 0.14 });
      arpeggio([60, 64, 67, 72], 0, { at: 0.45, type: 'sawtooth', lowpass: 2400, dur: 1.4, gain: 0.05 });
      for (let i = 0; i < 10; i++) tone({ at: 0.5 + i * 0.07, freq: NOTE(96 + (i % 3) * 4), dur: 0.12, gain: 0.04 });
    },
    lose() {
      tone({ freq: NOTE(62), to: NOTE(61), type: 'sawtooth', lowpass: 1200, dur: 0.38, gain: 0.12 });
      tone({ at: 0.36, freq: NOTE(61), to: NOTE(60), type: 'sawtooth', lowpass: 1100, dur: 0.38, gain: 0.12 });
      tone({ at: 0.72, freq: NOTE(60), to: NOTE(55), type: 'sawtooth', lowpass: 900, dur: 0.9, gain: 0.12 });
    },
    push() {
      tone({ freq: NOTE(67), type: 'triangle', dur: 0.25, gain: 0.12 });
      tone({ at: 0.18, freq: NOTE(67), type: 'triangle', dur: 0.35, gain: 0.1 });
    },
    bust() {
      tone({ freq: 160, to: 55, type: 'sine', dur: 0.4, gain: 0.35 });
      noise({ freq: 300, filter: 'lowpass', dur: 0.25, gain: 0.25 });
    },
    reveal() {
      // drum roll into a cymbal and a bright chord
      for (let i = 0; i < 16; i++) noise({ at: i * 0.045, freq: 900, q: 0.7, dur: 0.05, gain: 0.05 + i * 0.008 });
      noise({ at: 0.75, freq: 7000, filter: 'highpass', q: 0.5, dur: 1.4, gain: 0.16 });
      tone({ at: 0.75, freq: 70, to: 45, dur: 0.4, gain: 0.35 });
      arpeggio([67, 72, 76, 79], 0.0, { at: 0.75, type: 'triangle', dur: 1.2, gain: 0.08 });
    },
  };

  root.Sound = Sound;
})(window);
