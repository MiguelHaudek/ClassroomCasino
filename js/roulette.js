/*
 * Classroom Casino — European roulette wheel.
 *
 * A standard single-zero wheel: 37 pockets in the real order with the real colours.
 * Each student's number is their place in the class list (1–36). The student is chosen
 * before the spin; the ball's path is scripted so it rolls, drops, rattles and settles
 * in that student's pocket, while the rotor keeps turning like a real wheel.
 *
 * Layers:
 *   plane  – tilted with CSS 3D like a table seen from a seat; holds the static bowl
 *            and the spinning wheelhead (rotated with CSS)
 *   ball   – an untilted canvas on top; the ball is projected into the tilted plane so
 *            it stays round and can jump when it bounces
 * Angles are measured clockwise from 12 o'clock.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const EU = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const COL = { red: '#a5141f', black: '#151312', green: '#0c6a3b' };
  // radii as a fraction of the wheel radius
  const RAD = { head: 0.785, numbers: 0.70, pockets: 0.595, turret: 0.18, track: 0.878, pocketBall: 0.648 };
  const TILT = (30 * Math.PI) / 180;

  const mod = (a, n) => ((a % n) + n) % n;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function seeded(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Pockets in wheel order. Up to 36 students: a real European wheel. More: one pocket each. */
  function pocketsFor(count) {
    if (count <= 36) return EU.map((n) => ({ number: n, color: n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black' }));
    const list = [{ number: 0, color: 'green' }];
    for (let n = 1; n <= count; n++) list.push({ number: n, color: n % 2 ? 'red' : 'black' });
    return list;
  }

  class Roulette {
    constructor(o) {
      this.box = o.wrap;
      this.plane = o.plane;
      this.bowl = o.bowl;
      this.head = o.head;
      this.ballCanvas = o.ball;
      this.onEvent = o.onEvent || (() => {});
      this.bctx = this.bowl.getContext('2d');
      this.hctx = this.head.getContext('2d');
      this.kctx = this.ballCanvas.getContext('2d');
      this.reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.idle = this.reduced ? 0 : TAU / 40;
      this.pockets = pocketsFor(0);
      this.angle = 0;
      this.omega = this.idle;
      this.highlight = -1;
      this.ball = { mode: 'pocket', psi: (0.5 * TAU) / 37 }; // resting in the zero
      this.spin = null;
      this.running = false;
      this.resize();
      if (root.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.box);
      else root.addEventListener('resize', () => this.resize());
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.renderHead());
    }

    /* --------------------------------------------------------------- state */

    setPockets(pockets) {
      this.pockets = pockets;
      this.highlight = -1;
      this.renderHead();
      this.draw();
    }

    setHighlight(i) {
      this.highlight = i;
      this.renderHead();
    }

    start() {
      if (this.running) return;
      this.running = true;
      let last = performance.now();
      const step = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        this.tick(now, dt);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }

    tick(now, dt) {
      if (this.spin) {
        this.stepSpin(now, dt);
      } else {
        this.omega += (this.idle - this.omega) * (1 - Math.exp(-dt / 2.5));
        this.angle = mod(this.angle + this.omega * dt, TAU);
      }
      this.draw();
    }

    draw() {
      this.head.style.transform = `rotate(${this.angle}rad)`;
      this.drawBall();
    }

    ballAbs() {
      return this.ball.mode === 'pocket' ? this.angle + this.ball.psi : this.ball.abs;
    }

    ballR() {
      return this.ball.mode === 'pocket' ? RAD.pocketBall : this.ball.r;
    }

    /* --------------------------------------------------------- projection */

    project(x, y, h) {
      const yr = y * Math.cos(TILT) - h * Math.sin(TILT);
      const zr = y * Math.sin(TILT) + h * Math.cos(TILT);
      const s = this.persp / (this.persp - zr);
      return { x: x * s, y: yr * s, s };
    }

    resize() {
      const W = Math.round(this.box.clientWidth);
      if (!W) return;
      this.dpr = Math.min(2, root.devicePixelRatio || 1);
      this.size = W;
      this.persp = W * 2.4;
      for (const cv of [this.bowl, this.head]) {
        cv.width = W * this.dpr;
        cv.height = W * this.dpr;
      }
      // centre the tilted wheel inside its box
      const R = W / 2;
      const top = this.project(0, -R, 0).y;
      const bottom = this.project(0, R, 0).y;
      this.shift = -(top + bottom) / 2;
      const H = this.box.clientHeight;
      this.plane.style.width = W + 'px';
      this.plane.style.height = W + 'px';
      this.plane.style.top = (H / 2 - W / 2 + this.shift) + 'px';
      this.plane.style.transform = `perspective(${this.persp}px) rotateX(${TILT}rad)`;
      const br = this.box.getBoundingClientRect();
      const cr = this.ballCanvas.getBoundingClientRect();
      this.bw = cr.width;
      this.bh = cr.height;
      this.ballCanvas.width = Math.round(cr.width * this.dpr);
      this.ballCanvas.height = Math.round(cr.height * this.dpr);
      this.cx = br.left - cr.left + br.width / 2;
      this.cy = br.top - cr.top + br.height / 2 + this.shift;
      this.renderBowl();
      this.renderHead();
      this.drawBall();
    }

    /* ------------------------------------------------------------- drawing */

    ring(c, cx, cy, outer, inner) {
      c.beginPath();
      c.arc(cx, cy, outer, 0, TAU);
      c.arc(cx, cy, inner, 0, TAU, true);
      c.closePath();
    }

    renderBowl() {
      const c = this.bctx;
      const S = this.size;
      if (!S) return;
      const R = S / 2;
      const cx = R;
      const cy = R;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, S, S);

      c.save();
      c.shadowColor = 'rgba(0,0,0,0.6)';
      c.shadowBlur = R * 0.06;
      c.shadowOffsetY = R * 0.04;
      c.fillStyle = '#2a1209';
      c.beginPath();
      c.arc(cx, cy, R * 0.985, 0, TAU);
      c.fill();
      c.restore();

      // outer wooden rim with grain
      let g = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 0.99);
      g.addColorStop(0, '#4a200e');
      g.addColorStop(0.5, '#7e3c1c');
      g.addColorStop(1, '#3a180a');
      c.fillStyle = g;
      this.ring(c, cx, cy, R * 0.985, R * 0.925);
      c.fill();
      const rnd = seeded(7);
      c.save();
      this.ring(c, cx, cy, R * 0.985, R * 0.925);
      c.clip();
      for (let k = 0; k < 110; k++) {
        const r = R * (0.926 + rnd() * 0.058);
        const a0 = rnd() * TAU;
        c.strokeStyle = rnd() < 0.55 ? `rgba(20,6,2,${0.08 + rnd() * 0.14})` : `rgba(255,190,140,${0.03 + rnd() * 0.06})`;
        c.lineWidth = 0.5 + rnd() * 1.3;
        c.beginPath();
        c.arc(cx, cy, r, a0, a0 + 0.3 + rnd() * 2.2);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = 'rgba(255,220,180,0.25)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, R * 0.982, 0, TAU);
      c.stroke();

      // brass bead
      c.strokeStyle = '#b8913f';
      c.lineWidth = Math.max(1.5, R * 0.009);
      c.beginPath();
      c.arc(cx, cy, R * 0.925, 0, TAU);
      c.stroke();

      // ball track
      g = c.createRadialGradient(cx, cy, R * 0.835, cx, cy, R * 0.921);
      g.addColorStop(0, '#2a1207');
      g.addColorStop(0.45, '#5b2911');
      g.addColorStop(1, '#8e4824');
      c.fillStyle = g;
      this.ring(c, cx, cy, R * 0.921, R * 0.835);
      c.fill();

      // lower apron
      g = c.createRadialGradient(cx, cy, R * 0.79, cx, cy, R * 0.835);
      g.addColorStop(0, '#160803');
      g.addColorStop(1, '#3c1a0a');
      c.fillStyle = g;
      this.ring(c, cx, cy, R * 0.835, R * 0.788);
      c.fill();

      // eight diamonds, alternating upright and flat
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + TAU / 16;
        const upright = i % 2 === 0;
        const x = cx + Math.sin(a) * R * 0.812;
        const y = cy - Math.cos(a) * R * 0.812;
        const long = R * (upright ? 0.05 : 0.038);
        const short = R * 0.02;
        c.save();
        c.translate(x, y);
        c.rotate(a + (upright ? 0 : Math.PI / 2));
        const dg = c.createLinearGradient(-short, 0, short, 0);
        dg.addColorStop(0, '#8d8d8d');
        dg.addColorStop(0.5, '#ffffff');
        dg.addColorStop(1, '#9a9a9a');
        c.fillStyle = dg;
        c.strokeStyle = 'rgba(0,0,0,0.5)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, -long / 2);
        c.lineTo(short / 2, 0);
        c.lineTo(0, long / 2);
        c.lineTo(-short / 2, 0);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }

      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.lineWidth = R * 0.012;
      c.beginPath();
      c.arc(cx, cy, R * 0.79, 0, TAU);
      c.stroke();
    }

    renderHead() {
      const c = this.hctx;
      const S = this.size;
      if (!S) return;
      const R = S / 2;
      const cx = R;
      const cy = R;
      const r0 = R * RAD.head;
      const r1 = R * RAD.numbers;
      const r2 = R * RAD.pockets;
      const r3 = R * RAD.turret;
      const P = this.pockets.length;
      const w = TAU / P;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, S, S);

      const sector = (ra, rb, a0, a1) => {
        c.beginPath();
        c.arc(cx, cy, ra, a0, a1);
        c.arc(cx, cy, rb, a1, a0, true);
        c.closePath();
      };
      const circle = (r, color, width) => {
        c.strokeStyle = color;
        c.lineWidth = width;
        c.beginPath();
        c.arc(cx, cy, r, 0, TAU);
        c.stroke();
      };

      c.fillStyle = '#120c09';
      c.beginPath();
      c.arc(cx, cy, r0, 0, TAU);
      c.fill();

      // number ring and pockets
      this.pockets.forEach((pk, i) => {
        const a0 = i * w - Math.PI / 2;
        const a1 = a0 + w + 0.002;
        c.fillStyle = COL[pk.color];
        sector(r0, r1, a0, a1);
        c.fill();
        sector(r1, r2, a0, a1);
        c.fill();
      });
      let g = c.createRadialGradient(cx, cy, r1, cx, cy, r0);
      g.addColorStop(0, 'rgba(0,0,0,0.2)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.25)');
      c.fillStyle = g;
      this.ring(c, cx, cy, r0, r1);
      c.fill();
      g = c.createRadialGradient(cx, cy, r2, cx, cy, r1);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(0.25, 'rgba(0,0,0,0.1)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.14)');
      g.addColorStop(1, 'rgba(0,0,0,0.65)');
      c.fillStyle = g;
      this.ring(c, cx, cy, r1, r2);
      c.fill();

      // cone: book-matched wood veneer
      g = c.createRadialGradient(cx, cy, r3, cx, cy, r2);
      g.addColorStop(0, '#4e220d');
      g.addColorStop(0.45, '#7c3b1b');
      g.addColorStop(1, '#5a2810');
      c.fillStyle = g;
      this.ring(c, cx, cy, r2, r3);
      c.fill();
      const segs = 8;
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * TAU;
        c.fillStyle = k % 2 ? 'rgba(255,200,150,0.05)' : 'rgba(30,10,2,0.08)';
        sector(r2, r3, a0, a0 + TAU / segs);
        c.fill();
      }
      const rnd = seeded(11);
      c.save();
      this.ring(c, cx, cy, r2, r3);
      c.clip();
      for (let k = 0; k < 90; k++) {
        const r = r3 + rnd() * (r2 - r3);
        const a0 = rnd() * TAU;
        c.strokeStyle = `rgba(25,8,2,${0.05 + rnd() * 0.1})`;
        c.lineWidth = 0.5 + rnd();
        c.beginPath();
        c.arc(cx, cy, r, a0, a0 + 0.2 + rnd() * 1.4);
        c.stroke();
      }
      c.restore();
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        c.strokeStyle = 'rgba(15,5,1,0.45)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r3, cy + Math.sin(a) * r3);
        c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        c.stroke();
      }
      circle(R * 0.43, 'rgba(201,162,74,0.55)', Math.max(1, R * 0.004));

      // dividers: brass in the number ring, chrome frets between pockets
      for (let i = 0; i < P; i++) {
        const a = i * w - Math.PI / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        c.strokeStyle = '#c9a24a';
        c.lineWidth = Math.max(1, R * 0.0035);
        c.beginPath();
        c.moveTo(cx + cos * r1, cy + sin * r1);
        c.lineTo(cx + cos * r0, cy + sin * r0);
        c.stroke();
        c.strokeStyle = '#6f6f6f';
        c.lineWidth = Math.max(2, R * 0.01);
        c.beginPath();
        c.moveTo(cx + cos * r2, cy + sin * r2);
        c.lineTo(cx + cos * r1, cy + sin * r1);
        c.stroke();
        c.strokeStyle = '#f0f0f0';
        c.lineWidth = Math.max(1, R * 0.004);
        c.stroke();
      }
      circle(r0 - R * 0.004, '#c9a24a', Math.max(1.5, R * 0.008));
      circle(r1, '#cfcfcf', Math.max(1.5, R * 0.006));
      circle(r2, '#9a9a9a', Math.max(2, R * 0.012));
      circle(r2, '#f2f2f2', Math.max(1, R * 0.004));

      if (this.highlight >= 0) {
        const a0 = this.highlight * w - Math.PI / 2;
        sector(r0 - R * 0.006, r2 + R * 0.006, a0 + 0.004, a0 + w - 0.004);
        c.strokeStyle = '#f3d98c';
        c.lineWidth = Math.max(2, R * 0.009);
        c.stroke();
      }

      // numbers, upright with their tops to the rim, as on a real wheel
      const numSize = Math.min(R * 0.058, 2 * ((r0 + r1) / 2) * Math.sin(w / 2) * 0.66);
      c.fillStyle = '#ffffff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `500 ${numSize}px Oswald, "Arial Narrow", sans-serif`;
      this.pockets.forEach((pk, i) => {
        c.save();
        c.translate(cx, cy);
        c.rotate((i + 0.5) * w);
        c.fillText(String(pk.number), 0, -(r0 + r1) / 2 + numSize * 0.04);
        c.restore();
      });

      // turret: chrome base, four long arms with ball ends, centre knob
      g = c.createRadialGradient(cx, cy, 0, cx, cy, r3);
      g.addColorStop(0, '#f2f2f2');
      g.addColorStop(0.55, '#b5b5b5');
      g.addColorStop(0.85, '#858585');
      g.addColorStop(1, '#4a4a4a');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, r3, 0, TAU);
      c.fill();
      for (let k = 0; k < 4; k++) {
        c.save();
        c.translate(cx, cy);
        c.rotate((k * Math.PI) / 2 + Math.PI / 4);
        c.save();
        c.shadowColor = 'rgba(0,0,0,0.45)';
        c.shadowBlur = R * 0.012;
        c.shadowOffsetY = R * 0.006;
        const ag = c.createLinearGradient(-R * 0.022, 0, R * 0.022, 0);
        ag.addColorStop(0, '#7f7f7f');
        ag.addColorStop(0.45, '#ffffff');
        ag.addColorStop(1, '#6f6f6f');
        c.fillStyle = ag;
        c.beginPath();
        c.moveTo(-R * 0.024, -R * 0.06);
        c.lineTo(-R * 0.011, -R * 0.4);
        c.lineTo(R * 0.011, -R * 0.4);
        c.lineTo(R * 0.024, -R * 0.06);
        c.closePath();
        c.fill();
        c.restore();
        const kg = c.createRadialGradient(-R * 0.01, -R * 0.418, 0, 0, -R * 0.41, R * 0.034);
        kg.addColorStop(0, '#ffffff');
        kg.addColorStop(0.55, '#a8a8a8');
        kg.addColorStop(1, '#4f4f4f');
        c.fillStyle = kg;
        c.beginPath();
        c.arc(0, -R * 0.41, R * 0.03, 0, TAU);
        c.fill();
        c.restore();
      }
      g = c.createRadialGradient(cx - R * 0.025, cy - R * 0.03, 0, cx, cy, R * 0.085);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, '#b0b0b0');
      g.addColorStop(1, '#565656');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, R * 0.08, 0, TAU);
      c.fill();
      g = c.createRadialGradient(cx - R * 0.012, cy - R * 0.014, 0, cx, cy, R * 0.035);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#8a8a8a');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, R * 0.032, 0, TAU);
      c.fill();
    }

    drawBall() {
      const c = this.kctx;
      if (!this.bw || !this.size) return;
      const R = this.size / 2;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.bw, this.bh);
      const abs = this.ballAbs();
      const rf = this.ballR();
      const h = this.ball.h || 0;
      const x = Math.sin(abs) * rf * R;
      const y = -Math.cos(abs) * rf * R;
      const br = R * 0.026;

      // shadow on the wheel, further away and softer while the ball is in the air
      const sp = this.project(x + h * 0.25, y + h * 0.45, 0);
      const sr = br * sp.s * (1.25 + h / (R * 0.12));
      c.save();
      c.translate(this.cx + sp.x, this.cy + sp.y);
      c.scale(1, Math.cos(TILT));
      const sg = c.createRadialGradient(0, 0, 0, 0, 0, sr);
      const dark = Math.max(0.12, 0.55 - h / (R * 0.2));
      sg.addColorStop(0, `rgba(0,0,0,${dark})`);
      sg.addColorStop(0.55, `rgba(0,0,0,${dark * 0.45})`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = sg;
      c.beginPath();
      c.arc(0, 0, sr, 0, TAU);
      c.fill();
      c.restore();

      const p = this.project(x, y, h + br);
      const rad = br * p.s;
      const bx = this.cx + p.x;
      const by = this.cy + p.y;
      const g = c.createRadialGradient(bx - rad * 0.35, by - rad * 0.45, rad * 0.05, bx, by, rad);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#eeebe2');
      g.addColorStop(1, '#a29c90');
      c.fillStyle = g;
      c.beginPath();
      c.arc(bx, by, rad, 0, TAU);
      c.fill();
    }

    /* ---------------------------------------------------------------- spin */

    /** Launch the ball so it lands on `number`. Resolves once it has settled. */
    spinToNumber(number, seconds) {
      const idx = this.pockets.findIndex((p) => p.number === number);
      if (idx < 0 || this.spin) return Promise.resolve();
      this.setHighlight(-1);
      const P = this.pockets.length;
      const w = TAU / P;
      const T = this.reduced ? 2.5 : Math.max(5, seconds || 8);
      const tSettle = 0.8 * T;
      const psiLand = (idx + 0.5) * w + (Math.random() - 0.5) * 0.3 * w;
      const abs0 = this.ballAbs();
      const K0 = TAU * (this.reduced ? 1 : 3.5 + T * 0.4);
      const K = K0 + mod(abs0 - this.angle - psiLand - K0, TAU);
      this.spin = {
        t0: performance.now(), T, tSettle, psiLand, K, p: 2.6, w, idx,
        r0: this.ballR(), omega0: this.omega, omegaPush: this.reduced ? 0.6 : 2.3, tau: 9,
        nomore: false, diamond: false, bounces: 0, settledAt: 0, resolve: null,
      };
      this.onEvent('roll', 0.55 * tSettle);
      return new Promise((resolve) => {
        this.spin.resolve = resolve;
        this.start();
      });
    }

    stepSpin(now, dt) {
      const S = this.spin;
      const t = (now - S.t0) / 1000;
      const R = this.size / 2;

      // the croupier gives the rotor a push, then it slowly runs down
      this.omega = t < 0.6
        ? S.omega0 + (S.omegaPush - S.omega0) * easeOutCubic(t / 0.6)
        : this.idle + (S.omegaPush - this.idle) * Math.exp(-(t - 0.6) / S.tau);
      this.angle = mod(this.angle + this.omega * dt, TAU);

      const rTrack = RAD.track;
      const rPocket = RAD.pocketBall;
      if (t < S.tSettle) {
        const u = t / S.tSettle;
        const uDrop = 0.55;
        const uHit = 0.72;
        let psi = S.psiLand + S.K * Math.pow(1 - u, S.p);
        let r;
        let h = 0;
        if (u < uDrop) {
          r = rTrack + 0.0025 * Math.sin(t * 9);
          if (t < 0.35) {
            // picked out of the pocket and launched onto the track
            r = S.r0 + (rTrack - S.r0) * easeOutCubic(t / 0.35);
            h = R * 0.06 * Math.sin((Math.PI * t) / 0.35);
          }
          if (!S.nomore && u >= 0.42) {
            S.nomore = true;
            this.onEvent('nomore');
          }
        } else if (u < uHit) {
          const s = (u - uDrop) / (uHit - uDrop);
          r = rTrack - (rTrack - rPocket) * s * s;
          if (s > 0.35 && s < 0.55) h = R * 0.05 * Math.sin((Math.PI * (s - 0.35)) / 0.2);
          if (!S.diamond && s >= 0.35) {
            S.diamond = true;
            this.onEvent('clack', 0.8);
          }
        } else {
          const v = (u - uHit) / (1 - uHit);
          const bounce = Math.abs(Math.sin(3 * Math.PI * v)) * Math.pow(1 - v, 1.4);
          h = R * 0.065 * bounce;
          r = rPocket + 0.045 * bounce;
          psi += S.w * 1.2 * Math.sin(3 * Math.PI * v) * Math.pow(1 - v, 2);
          const k = Math.floor(v * 3);
          if (k < 3 && S.bounces <= k) {
            S.bounces = k + 1;
            this.onEvent('clack', 1 - k * 0.25);
          }
        }
        this.ball = { mode: 'free', abs: this.angle + psi, r, h };
      } else {
        if (!S.settledAt) {
          S.settledAt = now;
          this.onEvent('clack', 0.35);
          this.setHighlight(S.idx);
        }
        const s = (now - S.settledAt) / 1000;
        this.ball = { mode: 'pocket', psi: S.psiLand, h: R * 0.008 * Math.exp(-6 * s) * Math.abs(Math.sin(25 * s)) };
        if (s > 0.7) {
          const resolve = S.resolve;
          this.spin = null;
          this.ball.h = 0;
          resolve();
        }
      }
    }
  }

  Roulette.pockets = pocketsFor;
  Roulette.isRed = (n) => REDS.has(n);
  root.Roulette = Roulette;
})(window);
