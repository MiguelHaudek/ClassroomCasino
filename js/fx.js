/*
 * Classroom Casino — particle effects (confetti, chips, sparks) on one overlay canvas.
 */
(function (root) {
  'use strict';

  const PALETTES = {
    gold: ['#d9a62e', '#e8c15c', '#b8861a', '#d2384b'],
    party: ['#a5141f', '#e2c06a', '#f3ecdd', '#151312', '#d6a933', '#c8354a'],
    red: ['#d2384b', '#a82536', '#e6707f'],
  };

  let canvas, ctx, dpr = 1, w = 0, h = 0;
  const parts = [];
  let raf = 0;
  const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    canvas = document.getElementById('fx-canvas');
    ctx = canvas.getContext('2d');
    resize();
    root.addEventListener('resize', resize);
  }

  function resize() {
    dpr = Math.min(2, root.devicePixelRatio || 1);
    w = root.innerWidth;
    h = root.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function spawn(p) {
    parts.push(p);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function burst(o) {
    if (reduced) return;
    const x = o.x == null ? w / 2 : o.x;
    const y = o.y == null ? h / 2 : o.y;
    const colors = PALETTES[o.palette || 'party'];
    const n = o.count || 120;
    const power = o.power || 14;
    for (let i = 0; i < n; i++) {
      const a = o.angle == null ? rnd(0, Math.PI * 2) : o.angle + rnd(-(o.spread || 0.8), o.spread || 0.8);
      const v = rnd(power * 0.35, power);
      const shape = o.shapes ? o.shapes[i % o.shapes.length] : (Math.random() < 0.75 ? 'rect' : 'circle');
      spawn({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (o.lift || 4),
        g: o.gravity == null ? 0.32 : o.gravity,
        drag: 0.985,
        size: shape === 'chip' ? rnd(14, 22) : rnd(6, 12),
        rot: rnd(0, Math.PI * 2),
        vr: rnd(-0.25, 0.25),
        flip: rnd(0, Math.PI * 2),
        vf: rnd(0.08, 0.2),
        color: colors[(Math.random() * colors.length) | 0],
        shape,
        life: 0,
        max: o.life || rnd(140, 220),
      });
    }
  }

  function rain(o) {
    if (reduced) return;
    const colors = PALETTES[(o && o.palette) || 'party'];
    const n = (o && o.count) || 160;
    for (let i = 0; i < n; i++) {
      spawn({
        x: rnd(0, w), y: rnd(-h * 0.6, -10),
        vx: rnd(-1.5, 1.5), vy: rnd(1, 4),
        g: 0.06, drag: 0.995,
        size: rnd(7, 13), rot: rnd(0, 6.28), vr: rnd(-0.15, 0.15),
        flip: rnd(0, 6.28), vf: rnd(0.05, 0.15),
        color: colors[(Math.random() * colors.length) | 0],
        shape: Math.random() < 0.8 ? 'rect' : 'circle',
        life: 0, max: 420,
      });
    }
  }

  function sparkle(x, y, n) {
    if (reduced) return;
    for (let i = 0; i < (n || 26); i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(1, 6);
      spawn({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.02, drag: 0.94,
        size: rnd(2, 4.5), rot: 0, vr: 0, flip: 0, vf: 0,
        color: PALETTES.gold[(Math.random() * 4) | 0], shape: 'spark', life: 0, max: rnd(30, 60),
      });
    }
  }

  function drawChip(p, s) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * Math.abs(Math.cos(p.flip)) + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = s * 0.22;
    ctx.setLineDash([s * 0.35, s * 0.35]);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.78, (s * Math.abs(Math.cos(p.flip)) + 1) * 0.78, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function loop() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.flip += p.vf;
      p.life++;
      if (p.life > p.max || p.y > h + 40) {
        parts.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, (p.max - p.life) / 30);
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const s = p.size;
      if (p.shape === 'rect') {
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      } else if (p.shape === 'circle') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, s / 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'chip') {
        drawChip(p, s / 2);
      } else {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(loop) : 0;
    if (!raf) ctx.clearRect(0, 0, w, h);
  }

  root.FX = { init, burst, rain, sparkle, get reduced() { return reduced; } };
})(window);
