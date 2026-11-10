/*
 * Classroom Casino — app controller: roster, wheel, reveal, table flow, settings, hotkeys.
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'classroomCasino.v1';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => root.escapeHTML(s);

  const SAMPLE_NAMES = ['Anna', 'Ben', 'Clara', 'David', 'Elif', 'Felix', 'Greta', 'Hamza', 'Ida', 'Jonas', 'Lea', 'Mateo'];

  const DEFAULT_SETTINGS = {
    // blackjack odds
    fairGame: false,
    winChance: 0.5,
    strength: 0.6,
    showDot: true,
    // roulette
    avoidRepeats: false,
    recoverySpins: 3,
    spinSeconds: 8,
    // table
    dealerName: 'The Bank',
    decks: 6,
    h17: false,
    allowDouble: true,
    allowSplit: true,
    das: true,
    stakeWin: 'You may pass the question on',
    stakeLose: 'You answer the question',
    stakePush: 'Answer it with a helper of your choice',
    speed: 1,
    sound: true,
    volume: 0.8,
  };

  const LUCK = [
    { v: 'default', label: 'Default' },
    { v: 'fair', label: 'Fair deck' },
    { v: '0.95', label: 'Wins almost always' },
    { v: '0.75', label: 'Lucky · 75%' },
    { v: '0.5', label: 'Even · 50%' },
    { v: '0.25', label: 'Unlucky · 25%' },
    { v: '0.05', label: 'Loses almost always' },
  ];

  // How much more often a student is called. Everyone starts at 1 (the same chance).
  const BOOSTS = [1, 2, 3, 5];

  let uid = Date.now();
  const newId = () => 's' + (uid++).toString(36);

  function newStudent(name) {
    return { id: newId(), name: name.trim(), present: true, boost: 1, luck: 'default',
      called: 0, wins: 0, losses: 0, pushes: 0, lastSpin: null };
  }

  /* ---------------------------------------------------------------- store */

  function load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) { data = null; }
    if (!data || !Array.isArray(data.students)) {
      data = { version: 2, students: SAMPLE_NAMES.map(newStudent), sample: true, score: { bank: 0, cls: 0, push: 0 }, spinCount: 0, history: [] };
    }
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    data.score = Object.assign({ bank: 0, cls: 0, push: 0 }, data.score || {});
    data.history = data.history || [];
    data.spinCount = data.spinCount || 0;
    // Version 1 used a 0–10 slider (5 = normal) and gave just-called students a break.
    // Version 2: everyone has the same chance unless the teacher boosts someone.
    if ((data.version || 1) < 2) {
      data.students.forEach((s) => {
        const w = Number(s.weight);
        s.boost = w >= 9 ? 5 : w >= 7 ? 3 : w >= 6 ? 2 : 1;
        delete s.weight;
      });
      data.settings.avoidRepeats = false;
      delete data.settings.equalSlices;
      data.version = 2;
    }
    data.students.forEach((s) => {
      Object.assign(s, Object.assign({ present: true, boost: 1, luck: 'default', called: 0, wins: 0, losses: 0, pushes: 0, lastSpin: null }, s));
      if (!BOOSTS.includes(Number(s.boost))) s.boost = 1;
      if (!s.id) s.id = newId();
    });
    return data;
  }

  let saveTimer = 0;
  function save(state) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    }, 150);
  }

  /* ------------------------------------------------------------------ App */

  class App {
    constructor() {
      this.state = load();
      this.settings = this.state.settings;
      this.scene = 'wheel';
      this.override = null;     // secret per-hand override
      this.roundPlan = { target: null, strength: 0 };
      this.forceNextId = '';    // rig the next spin (not saved)
      this.current = null;      // student at the table
      this.setPhase('wheel');

      FX.init();
      Sound.setEnabled(this.settings.sound);
      Sound.setVolume(this.settings.volume);

      this.wheel = new Roulette({
        wrap: $('#roulette'),
        plane: $('#r-plane'),
        bowl: $('#r-bowl'),
        head: $('#r-head'),
        ball: $('#r-ball'),
        onEvent: (type, v) => {
          if (type === 'roll') Sound.roll(v);
          else if (type === 'clack') Sound.clack(v);
          else if (type === 'nomore') $('#d-call').textContent = 'No more bets';
        },
      });
      this.pocketKey = '';
      this.colorByNumber = new Map();
      this.lastWinnerId = null;
      this.table = new TableUI(this);

      this.bind();
      this.buildSettings();
      this.refreshAll();
      this.showScene('wheel');
    }

    save() { save(this.state); }

    setPhase(p) {
      this.phase = p;
      document.body.dataset.phase = p;
    }

    /* ------------------------------------------------------------ roster */

    present() {
      return this.state.students.filter((s) => s.present && s.name);
    }

    /** Weight each present student would have on the next spin. */
    effectiveWeights(list) {
      const S = this.settings;
      const n = this.state.spinCount;
      let w = list.map((s) => {
        let x = Number(s.boost) || 1;
        if (S.avoidRepeats && s.lastSpin != null && list.length > 1) {
          const since = n - s.lastSpin;
          x *= Math.max(0, Math.min(1, since / Math.max(1, S.recoverySpins)));
        }
        return x;
      });
      if (!(w.reduce((a, b) => a + b, 0) > 0)) w = list.map((s) => Number(s.boost) || 1);
      return w;
    }

    chances() {
      const list = this.present();
      const w = this.effectiveWeights(list);
      const total = w.reduce((a, b) => a + b, 0) || 1;
      const map = new Map();
      list.forEach((s, i) => map.set(s.id, w[i] / total));
      return map;
    }

    pickStudent() {
      const list = this.present();
      if (!list.length) return null;
      if (this.forceNextId) {
        const forced = list.find((s) => s.id === this.forceNextId);
        this.forceNextId = '';
        this.syncForceSelect();
        if (forced) return forced;
      }
      const w = this.effectiveWeights(list);
      const total = w.reduce((a, b) => a + b, 0);
      let r = cryptoRandom() * total;
      for (let i = 0; i < list.length; i++) {
        r -= w[i];
        if (r < 0) return list[i];
      }
      return list[list.length - 1];
    }

    desiredWinChance(student) {
      const S = this.settings;
      const luck = student ? student.luck : 'default';
      if (luck === 'fair') return null;
      if (luck && luck !== 'default') return Number(luck);
      if (S.fairGame) return null;
      return S.winChance;
    }

    /* ------------------------------------------------------------- wheel */

    numberOf(student) {
      return this.state.students.indexOf(student) + 1;
    }

    colorOf(n) {
      return this.colorByNumber.get(n) || 'black';
    }

    renderWheel() {
      const count = this.state.students.length;
      const key = count <= 36 ? 'european' : 'n' + count;
      if (key !== this.pocketKey) {
        this.pocketKey = key;
        const pockets = Roulette.pockets(count);
        this.colorByNumber = new Map(pockets.map((p) => [p.number, p.color]));
        this.wheel.setPockets(pockets);
      }
      const list = this.present();
      $('#wheel-empty').hidden = list.length > 0;
      $('#btn-spin').disabled = list.length === 0;
      $('#sample-hint').hidden = !this.state.sample;
      this.renderBoard();
      this.renderHistory();
    }

    /**
     * The betting layout, seen from the croupier's end: zero on top, twelve rows of three,
     * dozens and even-money bets down the side. Each student has a chip on their number.
     */
    renderBoard() {
      const el = $('#board');
      const students = this.state.students;
      const real = students.length <= 36;
      const cell = (n, row, col) => {
        const st = students[n - 1];
        const named = st && st.name;
        const won = named && st.id === this.lastWinnerId;
        const cls = ['bz', 'num', this.colorOf(n)];
        if (named) cls.push('taken');
        if (named && !st.present) cls.push('absent');
        if (won) cls.push('won');
        const attrs = named ? ` data-id="${st.id}" title="${n}: ${esc(st.name)}${st.present ? '' : ' (not here today)'}"` : '';
        return `<div class="${cls.join(' ')}" style="grid-row:${row};grid-column:${col}"${attrs}><b>${n}</b>` +
          (named ? `<span><i class="mini-chip"></i>${esc(st.name)}</span>` : '') + (won ? '<i class="dolly"></i>' : '') + '</div>';
      };
      let html = '';
      if (real) {
        el.className = 'board real';
        html += '<div class="bz zero" style="grid-row:1;grid-column:3/6"><b>0</b></div>';
        html += '<div class="bz blank" style="grid-row:1;grid-column:1/3"></div><div class="bz blank" style="grid-row:14;grid-column:1/3"></div>';
        for (let n = 1; n <= 36; n++) html += cell(n, 2 + Math.floor((n - 1) / 3), 3 + ((n - 1) % 3));
        ['1st 12', '2nd 12', '3rd 12'].forEach((t, i) => {
          html += `<div class="bz side" style="grid-row:${2 + i * 4}/${6 + i * 4};grid-column:2"><span>${t}</span></div>`;
        });
        ['1–18', 'Even', '<i class="dia red"></i>', '<i class="dia black"></i>', 'Odd', '19–36'].forEach((t, i) => {
          html += `<div class="bz side" style="grid-row:${2 + i * 2}/${4 + i * 2};grid-column:1"><span>${t}</span></div>`;
        });
        [3, 4, 5].forEach((c) => { html += `<div class="bz foot" style="grid-row:14;grid-column:${c}"><span>2 to 1</span></div>`; });
      } else {
        el.className = 'board compact';
        el.style.setProperty('--rows', Math.ceil(students.length / 3));
        html += '<div class="bz zero" style="grid-column:1/4"><b>0</b></div>';
        for (let n = 1; n <= students.length; n++) html += cell(n, 'auto', 'auto');
      }
      el.innerHTML = html;
    }

    /** Put the croupier's marker (the "dolly") on the winning number. */
    markWinner(id) {
      this.lastWinnerId = id;
      $$('#board .dolly').forEach((d) => d.parentNode.removeChild(d));
      $$('#board .num').forEach((c) => c.classList.toggle('won', !!id && c.dataset.id === id));
      const cell = id && $(`#board .num[data-id="${id}"]`);
      if (cell) {
        const dolly = document.createElement('i');
        dolly.className = 'dolly drop';
        cell.appendChild(dolly);
      }
    }

    renderHistory() {
      const h = this.state.history.slice(-8).reverse();
      const verdict = { player: 'beat the bank', bank: 'lost to the bank', push: 'push' };
      $('#history').innerHTML = h.length ? h.map((x) => {
        const st = this.state.students.find((s) => s.id === x.id);
        const number = x.number != null ? x.number : (st ? this.numberOf(st) : '–');
        const color = typeof number === 'number' ? this.colorOf(number) : 'black';
        return `<span class="hist ${color}" title="${esc(x.name)}${x.r ? ': ' + verdict[x.r] : ''}"><b>${number}</b>${esc(x.name)}</span>`;
      }).join('') : '<span class="hist-empty">No spins yet</span>';
    }

    setSide(state) {
      $('#roulette-side').dataset.state = state;
    }

    async spin() {
      if (this.phase !== 'wheel') return;
      const student = this.pickStudent();
      if (!student) return;
      const number = this.numberOf(student);
      this.setPhase('spinning');
      this.setSide('spinning');
      $('#d-call').textContent = 'Place your bets';
      document.body.classList.add('is-spinning');
      this.markWinner(null);
      this.state.spinCount++;
      await this.wheel.spinToNumber(number, this.settings.spinSeconds);
      student.called++;
      student.lastSpin = this.state.spinCount;
      this.state.history.push({ id: student.id, name: student.name, number, r: '' });
      if (this.state.history.length > 50) this.state.history.shift();
      this.save();
      document.body.classList.remove('is-spinning');
      this.current = student;
      this.markWinner(student.id);
      this.showResult(student, number);
    }

    /** The croupier calls the number; the display shows who plays. */
    showResult(student, number) {
      this.setPhase('reveal');
      const color = this.colorOf(number);
      const num = $('#d-number');
      num.textContent = number;
      num.className = 'd-number ' + color;
      $('#d-color').textContent = number === 0 ? 'Zero' : `${number} ${color === 'red' ? 'red' : 'black'}`;
      $('#d-name').textContent = student.name;
      $('#d-dealer').textContent = this.settings.dealerName || 'The Bank';
      this.setSide('result');
      Sound.ding();
      const r = $('.display').getBoundingClientRect();
      FX.burst({ x: r.left + r.width * 0.3, y: r.top + r.height / 2, palette: 'gold', count: 90, power: 13 });
      setTimeout(() => $('#btn-deal').focus({ preventScroll: true }), 60);
      this.renderHistory();
      this.refreshRoster();
    }

    toRoulette(autoSpin) {
      this.setPhase('wheel');
      this.setSide('idle');
      this.showScene('wheel');
      this.renderWheel();
      if (autoSpin) setTimeout(() => this.spin(), 650);
    }

    respin() {
      if (this.phase !== 'reveal') return;
      this.toRoulette(false);
      setTimeout(() => this.spin(), 250);
    }

    /** The called student isn't in class: mark them absent for today and spin again. */
    notHere() {
      if (this.phase !== 'reveal' || !this.current) return;
      const st = this.current;
      st.present = false;
      st.called = Math.max(0, st.called - 1);
      st.lastSpin = null;
      const last = this.state.history[this.state.history.length - 1];
      if (last && last.id === st.id && !last.r) this.state.history.pop();
      this.current = null;
      this.save();
      this.refreshRoster();
      this.respin();
    }

    /* ------------------------------------------------------------- table */

    async deal(student) {
      student = student || this.current;
      if (!student) return;
      this.current = student;
      this.setPhase('table-busy');
      this.showScene('table');
      $('#player-name').textContent = student.name;
      $('#dealer-name').textContent = this.settings.dealerName || 'The Bank';
      this.renderRulesLine();
      $('#post-actions').classList.remove('show');
      const desired = this.desiredWinChance(student);
      this.roundPlan = desired == null ? { target: null, strength: 0 } : BJ.planHand(desired, this.settings.strength);
      await wait(this.scene === 'table' ? 450 : 0);
      const S = this.settings;
      const token = (this.roundToken = (this.roundToken || 0) + 1);
      const R = await this.table.play(student, {
        decks: Number(S.decks) || 6,
        speed: Number(S.speed) || 1,
        rules: { h17: S.h17, allowDouble: S.allowDouble, allowSplit: S.allowSplit, das: S.das },
        getSteer: () => this.override || this.roundPlan,
      });
      if (token !== this.roundToken) return;
      this.recordResult(student, R);
      this.override = null;
      this.renderDot();
      this.setPhase('table-done');
      $('#post-actions').classList.add('show');
      setTimeout(() => $('#btn-next').focus({ preventScroll: true }), 50);
    }

    onPlayerTurn() {
      this.setPhase('table-turn');
    }

    recordResult(student, R) {
      const sc = this.state.score;
      if (R.outcome === 'player') { student.wins++; sc.cls++; }
      else if (R.outcome === 'bank') { student.losses++; sc.bank++; }
      else { student.pushes++; sc.push++; }
      const last = this.state.history[this.state.history.length - 1];
      if (last && last.id === student.id && !last.r) last.r = R.outcome;
      else this.state.history.push({ id: student.id, name: student.name, number: this.numberOf(student), r: R.outcome });
      this.save();
      this.renderScore(R.outcome);
      this.refreshRoster();
    }

    /** Back to the roulette and straight into the next spin. */
    nextStudent() {
      if (this.phase !== 'table-done') return;
      this.toRoulette(true);
    }

    /** Back to the roulette without spinning. */
    backToRoulette() {
      if (this.phase !== 'table-done') return;
      this.toRoulette(false);
    }

    rematch() {
      if (this.phase !== 'table-done') return;
      this.deal(this.current);
    }

    renderRulesLine() {
      const S = this.settings;
      $('#rules-line').textContent = S.h17 ? 'DEALER MUST HIT SOFT 17 AND STAND ON HARD 17s' : 'DEALER MUST DRAW TO 16 AND STAND ON ALL 17s';
    }

    /* ------------------------------------------------------------ scenes */

    showScene(name) {
      this.scene = name;
      document.body.dataset.scene = name;
      if (name === 'wheel') this.wheel.start();
      else this.wheel.stop();
      $$('.scene').forEach((s) => s.classList.toggle('is-active', s.id === 'scene-' + name));
    }

    renderScore(changed) {
      const sc = this.state.score;
      $('#sb-bank').textContent = sc.bank;
      $('#sb-class').textContent = sc.cls;
      $('#sb-bank-label').textContent = this.settings.dealerName || 'The Bank';
      const el = changed === 'player' ? $('#sb-class') : changed === 'bank' ? $('#sb-bank') : null;
      if (el && el.animate) el.animate([{ transform: 'scale(1.8)', color: '#e2c06a' }, { transform: 'scale(1)' }], { duration: 600, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    }

    renderDot() {
      const dot = $('#secret-dot');
      const o = this.override;
      dot.className = 'secret-dot' + (this.settings.showDot && o ? ' on ' + (o.target || 'fair') : '');
    }

    /* ------------------------------------------------------------- input */

    bind() {
      $('#btn-spin').addEventListener('click', () => this.spin());
      $('#roulette').addEventListener('click', () => this.spin());
      $('#btn-deal').addEventListener('click', () => this.deal());
      $('#btn-respin').addEventListener('click', () => this.respin());
      $('#btn-absent').addEventListener('click', () => this.notHere());
      $('#btn-next').addEventListener('click', () => this.nextStudent());
      $('#btn-rematch').addEventListener('click', () => this.rematch());
      $('#btn-back').addEventListener('click', () => this.backToRoulette());
      $('#btn-settings').addEventListener('click', () => this.openSettings());
      $('#btn-sound').addEventListener('click', () => this.toggleSound());
      $('#btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
      $('#sample-hint button').addEventListener('click', () => this.openSettings('students'));
      $('#wheel-empty button').addEventListener('click', () => this.openSettings('students'));
      $('#drawer-close').addEventListener('click', () => this.closeSettings());
      $('#drawer-backdrop').addEventListener('click', () => this.closeSettings());

      const unlock = () => Sound.unlock();
      root.addEventListener('pointerdown', unlock, { once: true });
      root.addEventListener('keydown', unlock, { once: true });

      root.addEventListener('keydown', (e) => this.onKey(e));
    }

    onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
      const drawerOpen = document.body.classList.contains('drawer-open');
      if (e.key === 'Escape') {
        if (drawerOpen) this.closeSettings();
        return;
      }
      if (typing || drawerOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();

      // secret controls for the current (or next) hand
      if (k === '1' || k === '2' || k === '3' || k === '0') {
        this.override = k === '1' ? { target: 'player', strength: 1 }
          : k === '2' ? { target: 'bank', strength: 1 }
            : k === '3' ? { target: null, strength: 0 } : null;
        this.renderDot();
        e.preventDefault();
        return;
      }
      if (k === ',') { this.openSettings(); e.preventDefault(); return; }
      if (k === 'm') { this.toggleSound(); return; }
      if (k === 'f') { this.toggleFullscreen(); return; }

      if (this.phase === 'wheel' && (k === ' ' || k === 'enter')) {
        if (document.activeElement && document.activeElement.tagName === 'BUTTON' && k === 'enter') return;
        e.preventDefault();
        this.spin();
      } else if (this.phase === 'reveal') {
        const focused = document.activeElement && document.activeElement.tagName === 'BUTTON' ? document.activeElement.id : '';
        if (k === 'enter' || k === ' ' || k === 'd') {
          if (focused === 'btn-respin' || focused === 'btn-absent') return;
          e.preventDefault();
          this.deal();
        } else if (k === 'r') {
          this.respin();
        } else if (k === 'a') {
          this.notHere();
        }
      } else if (this.phase === 'table-turn') {
        const map = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
        if (map[k] && this.table.act(map[k])) {
          this.setPhase('table-busy');
          e.preventDefault();
        }
      } else if (this.phase === 'table-done') {
        if (k === 'n') { e.preventDefault(); this.nextStudent(); }
        else if (k === 'b') { e.preventDefault(); this.backToRoulette(); }
        else if (k === 'r') { e.preventDefault(); this.rematch(); }
        else if ((k === 'enter' || k === ' ') && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) {
          e.preventDefault();
          this.nextStudent();
        }
      }
    }

    toggleSound() {
      this.settings.sound = !this.settings.sound;
      Sound.setEnabled(this.settings.sound);
      this.save();
      this.syncSoundButton();
      const cb = $('#set-sound');
      if (cb) cb.checked = this.settings.sound;
    }

    syncSoundButton() {
      const b = $('#btn-sound');
      b.classList.toggle('off', !this.settings.sound);
      b.setAttribute('aria-pressed', String(this.settings.sound));
      b.title = this.settings.sound ? 'Sound on (M)' : 'Sound off (M)';
    }

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        const el = document.documentElement;
        (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
      }
    }

    /* ---------------------------------------------------------- settings */

    openSettings(tab) {
      document.body.classList.add('drawer-open');
      $('#drawer').setAttribute('aria-hidden', 'false');
      if (tab) this.selectTab(tab);
      this.refreshRoster();
      this.refreshOdds();
      setTimeout(() => $('#drawer-close').focus({ preventScroll: true }), 50);
    }

    closeSettings() {
      document.body.classList.remove('drawer-open');
      $('#drawer').setAttribute('aria-hidden', 'true');
      if (this.phase === 'wheel') this.renderWheel();
      this.renderScore();
      $('#btn-settings').focus({ preventScroll: true });
    }

    selectTab(name) {
      $$('.tab').forEach((t) => {
        const on = t.dataset.tab === name;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', String(on));
      });
      $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    }

    buildSettings() {
      $$('.tab').forEach((t) => t.addEventListener('click', () => this.selectTab(t.dataset.tab)));
      this.selectTab('students');

      // add students
      $('#add-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const ta = $('#add-names');
        const names = ta.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        if (!names.length) return;
        if (this.state.sample) {
          const replace = root.confirm('Replace the 12 sample names with your students?');
          if (replace) this.state.students = [];
          this.state.sample = false;
        }
        const have = new Set(this.state.students.map((s) => s.name.toLowerCase()));
        names.forEach((n) => {
          if (!have.has(n.toLowerCase())) {
            this.state.students.push(newStudent(n));
            have.add(n.toLowerCase());
          }
        });
        ta.value = '';
        this.changed(true);
      });

      $('#roster').addEventListener('input', (e) => this.onRosterInput(e));
      $('#roster').addEventListener('change', (e) => this.onRosterInput(e));
      $('#roster').addEventListener('click', (e) => {
        const boostBtn = e.target.closest('[data-boost]');
        if (boostBtn) {
          const row = boostBtn.closest('.srow');
          const st = this.state.students.find((x) => x.id === row.dataset.id);
          if (!st) return;
          st.boost = Number(boostBtn.dataset.boost);
          row.querySelectorAll('[data-boost]').forEach((b) => {
            const on = b === boostBtn;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(on));
          });
          this.updateChances();
          this.save();
          return;
        }
        const del = e.target.closest('.sdel');
        if (!del) return;
        const row = del.closest('.srow');
        const s = this.state.students.find((x) => x.id === row.dataset.id);
        if (s && root.confirm(`Remove ${s.name} from the class list?`)) {
          this.state.students = this.state.students.filter((x) => x !== s);
          this.changed(true);
        }
      });

      $('#all-present').addEventListener('click', () => {
        this.state.students.forEach((s) => { s.present = true; });
        this.changed(true);
      });
      $('#reset-weights').addEventListener('click', () => {
        this.state.students.forEach((s) => { s.boost = 1; s.luck = 'default'; });
        this.changed(true);
      });
      $('#sort-az').addEventListener('click', () => {
        this.state.students.sort((a, b) => a.name.localeCompare(b.name));
        this.changed(true);
      });

      // simple bound controls: data-set="key" with data-type
      $$('[data-set]').forEach((el) => {
        const key = el.dataset.set;
        const v = this.settings[key];
        if (el.type === 'checkbox') el.checked = !!v;
        else if (el.dataset.scale) el.value = Math.round(v * Number(el.dataset.scale));
        else el.value = v;
        const handler = () => {
          let val;
          if (el.type === 'checkbox') val = el.checked;
          else if (el.dataset.scale) val = Number(el.value) / Number(el.dataset.scale);
          else if (el.type === 'range' || el.type === 'number' || el.dataset.num) val = Number(el.value);
          else val = el.value;
          this.settings[key] = val;
          if (key === 'sound') { Sound.setEnabled(val); this.syncSoundButton(); }
          if (key === 'volume') Sound.setVolume(val);
          this.refreshOdds();
          this.changed(key === 'avoidRepeats' || key === 'recoverySpins');
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      });

      $('#force-next').addEventListener('change', (e) => { this.forceNextId = e.target.value; });

      // data
      $('#export-data').addEventListener('click', () => this.exportData());
      $('#import-file').addEventListener('change', (e) => this.importData(e.target.files[0]));
      $('#reset-stats').addEventListener('click', () => {
        if (!root.confirm('Clear the score, the call history and every student\'s wins and losses?')) return;
        this.state.score = { bank: 0, cls: 0, push: 0 };
        this.state.history = [];
        this.state.spinCount = 0;
        this.state.students.forEach((s) => Object.assign(s, { called: 0, wins: 0, losses: 0, pushes: 0, lastSpin: null }));
        this.changed(true);
        this.renderScore();
      });
      $('#reset-all').addEventListener('click', () => {
        if (!root.confirm('Delete your class list and all settings? This cannot be undone.')) return;
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
        root.location.reload();
      });
    }

    onRosterInput(e) {
      const row = e.target.closest('.srow');
      if (!row) return;
      const s = this.state.students.find((x) => x.id === row.dataset.id);
      if (!s) return;
      const t = e.target;
      if (t.classList.contains('sname')) { s.name = t.value; this.state.sample = false; }
      else if (t.classList.contains('spresent')) s.present = t.checked;
      else if (t.classList.contains('sluck')) s.luck = t.value;
      row.classList.toggle('absent', !s.present);
      this.updateChances();
      this.save();
      if (this.phase === 'wheel' && !t.classList.contains('sluck')) this.debouncedWheel();
    }

    debouncedWheel() {
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => this.renderWheel(), 200);
    }

    changed(rebuildRoster) {
      this.save();
      if (rebuildRoster) this.refreshRoster();
      else this.updateChances();
      if (this.phase === 'wheel') this.renderWheel();
      this.syncForceSelect();
    }

    refreshAll() {
      this.renderWheel();
      this.renderScore();
      this.renderDot();
      this.syncSoundButton();
      this.refreshRoster();
      this.refreshOdds();
    }

    refreshRoster() {
      const list = $('#roster');
      const ch = this.chances();
      const luckOpts = (cur) => LUCK.map((o) => `<option value="${o.v}"${String(cur) === o.v ? ' selected' : ''}>${o.label}</option>`).join('');
      list.innerHTML = this.state.students.map((s) => {
        const p = ch.get(s.id);
        const rec = s.called ? `${s.called}× called · ${s.wins}–${s.losses}${s.pushes ? ` · ${s.pushes} push` : ''}` : 'Not called yet';
        return `<div class="srow${s.present ? '' : ' absent'}" data-id="${s.id}">
          <label class="present-toggle" title="Here today"><input type="checkbox" class="spresent"${s.present ? ' checked' : ''}><span></span></label>
          <input type="text" class="sname" value="${esc(s.name)}" aria-label="Name" spellcheck="false">
          <div class="boost" role="radiogroup" aria-label="How often ${esc(s.name)} is called">${BOOSTS.map((b) =>
            `<button type="button" role="radio" data-boost="${b}" class="${Number(s.boost) === b ? 'on' : ''}" aria-checked="${Number(s.boost) === b}">${b === 1 ? 'Normal' : b + '×'}</button>`).join('')}</div>
          <output class="schance">${p == null ? '–' : fmtPct(p)}</output>
          <select class="sluck" aria-label="Blackjack luck for ${esc(s.name)}">${luckOpts(s.luck)}</select>
          <span class="sstats">${rec}</span>
          <button class="sdel" type="button" aria-label="Remove ${esc(s.name)}">×</button>
        </div>`;
      }).join('');
      $('#roster-count').textContent = `${this.present().length} of ${this.state.students.length} here today`;
      this.syncForceSelect();
    }

    updateChances() {
      const ch = this.chances();
      $$('#roster .srow').forEach((row) => {
        const p = ch.get(row.dataset.id);
        row.querySelector('.schance').textContent = p == null ? '–' : fmtPct(p);
      });
      $('#roster-count').textContent = `${this.present().length} of ${this.state.students.length} here today`;
    }

    syncForceSelect() {
      const sel = $('#force-next');
      if (!sel) return;
      const list = this.present();
      sel.innerHTML = '<option value="">Nobody: use the chances</option>' +
        list.map((s) => `<option value="${s.id}"${s.id === this.forceNextId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    }

    refreshOdds() {
      const S = this.settings;
      const range = BJ.achievableRange(S.strength);
      $('#win-chance-out').textContent = `${Math.round(S.winChance * 100)}%`;
      $('#strength-out').textContent = S.strength < 0.35 ? 'Subtle' : S.strength < 0.7 ? 'Medium' : 'Strong';
      $('#strength-note').textContent = `At this strength a hand can be steered so the student wins anywhere from about ${Math.round(range.min * 100)}% to ${Math.round(range.max * 100)}% of the time. Wishes outside that range use more strength automatically.`;
      $('#odds-controls').classList.toggle('disabled', !!S.fairGame);
      $('#spin-out').textContent = `${S.spinSeconds} s`;
      $('#recovery-out').textContent = `${S.recoverySpins} spin${S.recoverySpins === 1 ? '' : 's'}`;
      $('#volume-out').textContent = `${Math.round(S.volume * 100)}%`;
      const sc = this.state.score;
      const played = sc.bank + sc.cls + sc.push;
      $('#session-stats').textContent = played
        ? `So far: students won ${sc.cls} of ${played} hands (${Math.round((sc.cls / played) * 100)}%), the bank won ${sc.bank}, ${sc.push} pushes.`
        : 'No hands played yet.';
    }

    exportData() {
      const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `classroom-casino-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    importData(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.students)) throw new Error('No class list in this file.');
          localStorage.setItem(STORE_KEY, JSON.stringify(data));
          root.location.reload();
        } catch (err) {
          root.alert('That file could not be loaded. Choose a file saved with "Save class list".');
        }
      };
      reader.readAsText(file);
    }
  }

  function fmtPct(p) {
    if (p <= 0) return '0%';
    if (p < 0.01) return '<1%';
    return Math.round(p * 100) + '%';
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function cryptoRandom() {
    if (root.crypto && root.crypto.getRandomValues) {
      const a = new Uint32Array(1);
      root.crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  root.addEventListener('DOMContentLoaded', () => { root.app = new App(); });
})(window);
