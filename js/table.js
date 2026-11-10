/*
 * Classroom Casino — the blackjack table: cards, chips and all table animations.
 * Talks to the engine (window.BJ) through the Game hooks.
 */
(function (root) {
  'use strict';

  const VS = '︎'; // force text (not emoji) rendering of suit glyphs
  const FACE = { J: '♞', Q: '♛', K: '♚' };
  const PIPS = {
    2: [[50, 0], [50, 100]],
    3: [[50, 0], [50, 50], [50, 100]],
    4: [[0, 0], [100, 0], [0, 100], [100, 100]],
    5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
    6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
    7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
    8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
    9: [[0, 0], [100, 0], [0, 33.3], [100, 33.3], [50, 50], [0, 66.7], [100, 66.7], [0, 100], [100, 100]],
    10: [[0, 0], [100, 0], [50, 16.7], [0, 33.3], [100, 33.3], [0, 66.7], [100, 66.7], [50, 83.3], [0, 100], [100, 100]],
  };

  let SPEED = 1;
  const reducedMotion = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));
  const $ = (sel, el) => (el || document).querySelector(sel);

  function cardFrontHTML(card) {
    const s = card.suit + VS;
    let center;
    if (card.rank === 'A') {
      center = `<div class="ace${card.suit === '♠' ? ' ace-spades' : ''}">${s}</div>`;
    } else if (FACE[card.rank]) {
      center = courtSVG(card);
    } else {
      center = '<div class="pips">' + PIPS[Number(card.rank)].map(([x, y]) =>
        `<span class="pip${y > 50 ? ' flip' : ''}" style="left:${x}%;top:${y}%">${s}</span>`).join('') + '</div>';
    }
    return `<div class="idx tl"><b>${card.rank}</b><i>${s}</i></div>${center}<div class="idx br"><b>${card.rank}</b><i>${s}</i></div>`;
  }

  // Court cards: a framed, double-ended panel split on the diagonal, like a real deck.
  const CROWN = {
    K: 'M2 13V5l4 3.5L10 2l4 6.5L18 5v8z',
    Q: 'M2 13l1-7 3 3.5 2-5 2 5 2-5 2 5 3-3.5 1 7z',
    J: 'M3 13c0-5.5 3-8 7-8s7 2.5 7 8zM10 5c1.2-2.6 4-3.6 6.5-2.6-2.2.2-4 1.1-5 2.8',
  };
  function courtSVG(card) {
    const ink = BJ.isRed(card) ? '#a5141f' : '#151312';
    const half = `<path d="${CROWN[card.rank]}" transform="translate(7 8)" fill="#d6a933" stroke="${ink}" stroke-width=".9" stroke-linejoin="round"/>` +
      `<text x="37" y="31" text-anchor="middle" font-family="'Bodoni Moda', Didot, Georgia, serif" font-weight="700" font-size="24" fill="${ink}">${card.rank}</text>` +
      `<text x="15" y="40" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="${ink}">${card.suit}${VS}</text>`;
    return `<svg class="court" viewBox="0 0 60 90" aria-hidden="true">` +
      `<rect x="1" y="1" width="58" height="88" rx="3" fill="#fbf8ef" stroke="${ink}" stroke-width="1.3"/>` +
      `<rect x="4.5" y="4.5" width="51" height="81" rx="1.5" fill="none" stroke="#c9a23a" stroke-width=".8"/>` +
      `<path d="M4.5 85.5 55.5 4.5" stroke="${ink}" stroke-width=".7" opacity=".45"/>` +
      `<g>${half}</g><g transform="rotate(180 30 45)">${half}</g></svg>`;
  }

  function makeCard(card, i) {
    const el = document.createElement('div');
    el.className = 'card down';
    el.style.setProperty('--i', i);
    el.style.setProperty('--rot', ((Math.random() - 0.5) * 4).toFixed(2) + 'deg');
    el.innerHTML = '<div class="card-tilt"><div class="card-inner"><div class="card-face card-front"></div><div class="card-face card-back"></div></div></div>';
    if (card) setFront(el, card);
    return el;
  }

  function setFront(el, card) {
    const front = el.querySelector('.card-front');
    front.className = 'card-face card-front ' + (BJ.isRed(card) ? 'red' : 'black');
    front.innerHTML = cardFrontHTML(card);
    el.setAttribute('aria-label', `${card.rank} of ${{ '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' }[card.suit]}`);
  }

  function makeHand(kind) {
    const el = document.createElement('div');
    el.className = 'hand ' + kind;
    el.innerHTML = '<div class="total" aria-live="polite"></div><div class="cards"></div><div class="bet"></div><div class="tag"></div>';
    el.style.setProperty('--k', 0);
    return el;
  }

  // Casino chip values: red 5, pink 2.50 (used for blackjack payouts on a 5 bet).
  const CHIP_VALUE = { red: '5', pink: '2½', green: '25', black: '100' };
  function makeChip(kind) {
    const k = kind || 'red';
    const c = document.createElement('div');
    c.className = 'chip ' + k;
    c.innerHTML = `<span>${CHIP_VALUE[k] || ''}</span>`;
    return c;
  }
  function chipKind(el) {
    return ['pink', 'green', 'black'].find((k) => el.classList.contains(k)) || 'red';
  }

  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  class TableUI {
    constructor(app) {
      this.app = app;
      this.felt = $('#felt');
      this.shoeEl = $('#shoe');
      this.shoeCount = $('#shoe-count');
      this.discardEl = $('#discard');
      this.rackEl = $('#chip-rack');
      this.dealerRow = $('#dealer-row');
      this.playerRow = $('#player-row');
      this.banner = $('#banner');
      this.toastEl = $('#table-toast');
      this.actions = $('#actions');
      this.ghosts = $('#ghost-layer');
      this.playerPlate = $('#player-plate');
      this.shoe = null;
      this.pending = null;
      this.discarded = 0;
      this.busy = false;
      this.actions.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (b && !b.disabled) this.act(b.dataset.act);
      });
      this.setActions(null);
    }

    setSpeed(s) { SPEED = s; }

    ensureShoe(decks) {
      if (!this.shoe || this.shoe.decks !== decks) {
        this.shoe = new BJ.Shoe(decks);
        this.discarded = 0;
        this.updateShoe();
      }
    }

    updateShoe() {
      if (!this.shoe) return;
      const left = this.shoe.remaining;
      this.shoeCount.textContent = `${left} cards`;
      this.shoeEl.style.setProperty('--fill', (left / this.shoe.total).toFixed(3));
      this.discardEl.style.setProperty('--pile', Math.min(1, this.discarded / (this.shoe.total * 0.8)).toFixed(3));
    }

    toast(text, ms) {
      const t = this.toastEl;
      t.textContent = text;
      t.classList.remove('show');
      void t.offsetWidth;
      t.classList.add('show');
      clearTimeout(this.toastTimer);
      if (ms !== 0) this.toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1600);
    }

    hideToast() {
      this.toastEl.classList.remove('show');
    }

    /* ------------------------------------------------------------- actions */

    setActions(allowed) {
      this.actions.querySelectorAll('button[data-act]').forEach((b) => {
        b.disabled = !allowed || !allowed[b.dataset.act];
      });
      this.actions.classList.toggle('live', !!allowed);
    }

    /** Light up the player's name plate while it's their move. */
    setTurn(on) {
      this.playerPlate.classList.toggle('turn', on);
      this.playerPlate.querySelector('.plate-role').textContent = on ? 'Your move' : 'Player';
    }

    act(name) {
      if (!this.pending) return false;
      const { resolve, allowed } = this.pending;
      if (!allowed[name]) return false;
      this.pending = null;
      this.setActions(null);
      this.setTurn(false);
      Sound.click();
      const btn = this.actions.querySelector(`button[data-act="${name}"]`);
      if (btn && btn.animate) btn.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      resolve(name);
      return true;
    }

    /* ------------------------------------------------------------ ghosts */

    /** Fly a copy of `node` from rect `from` to rect `to` (viewport coords). */
    async ghostFly(node, from, to, o) {
      o = o || {};
      const g = node;
      g.classList.add('ghost');
      g.style.left = from.left + 'px';
      g.style.top = from.top + 'px';
      g.style.width = from.width + 'px';
      g.style.height = from.height + 'px';
      this.ghosts.appendChild(g);
      const a = center(from);
      const b = center(to);
      const sx = to.width / from.width;
      const anim = g.animate([
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(${sx}) rotate(${o.rotate || 0}deg)`, opacity: o.fade ? 0 : 1 },
      ], { duration: (o.duration || 520) * SPEED, easing: o.easing || 'cubic-bezier(.2,.7,.2,1)', delay: (o.delay || 0) * SPEED, fill: 'both' });
      await anim.finished.catch(() => {});
      g.remove();
    }

    /* ------------------------------------------------------------- layout */

    playerHand(i) {
      return this.playerRow.children[i];
    }

    dealerHand() {
      return this.dealerRow.firstElementChild;
    }

    setCount(handEl) {
      const n = handEl.querySelector('.cards').children.length;
      handEl.style.setProperty('--k', Math.max(0, n - 1));
    }

    renderTotals() {
      const g = this.game;
      if (!g || !g.round) return;
      const R = g.round;
      R.hands.forEach((h, i) => {
        const el = this.playerHand(i);
        if (el) this.setTotal(el, h.cards, !h.fromSplit);
      });
      const D = R.dealer;
      const visible = this.holeShown ? D.cards : [D.cards[0]];
      const del = this.dealerHand();
      if (del) this.setTotal(del, visible.filter(Boolean), this.holeShown);
    }

    setTotal(el, cards, canBJ) {
      const t = el.querySelector('.total');
      if (!cards.length) {
        t.textContent = '';
        t.className = 'total';
        return;
      }
      const v = BJ.handValue(cards);
      let text;
      let cls = 'total show';
      if (canBJ && cards.length === 2 && v.total === 21) { text = 'Blackjack'; cls += ' bj'; }
      else if (v.total > 21) { text = `${v.total} · bust`; cls += ' bust'; }
      else if (v.total === 21) { text = '21'; cls += ' gold'; }
      else if (v.soft) text = `${v.total - 10} or ${v.total}`;
      else text = String(v.total);
      if (t.textContent !== text) {
        t.textContent = text;
        t.className = cls;
        if (t.animate && !reducedMotion()) t.animate([{ scale: '1.35' }, { scale: '1' }], { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      } else {
        t.className = cls;
      }
    }

    /* -------------------------------------------------------------- round */

    async clear() {
      this.banner.className = 'banner';
      this.felt.classList.remove('result-player', 'result-bank', 'result-push');
      const cards = Array.from(this.felt.querySelectorAll('.hand .card'));
      const chips = Array.from(this.felt.querySelectorAll('.hand .chip'));
      if (cards.length) {
        const to = this.discardEl.getBoundingClientRect();
        const flights = cards.map((c, i) => {
          const from = c.getBoundingClientRect();
          const ghost = c.cloneNode(true);
          ghost.classList.add('down');
          c.style.visibility = 'hidden';
          return this.ghostFly(ghost, from, to, { duration: 480, delay: i * 45, rotate: 90 + Math.random() * 20, easing: 'cubic-bezier(.5,0,.3,1)' });
        });
        chips.forEach((c) => c.animate && c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }));
        if (cards.length) Sound.deal();
        await Promise.all(flights);
        this.discarded += cards.length;
      }
      this.dealerRow.innerHTML = '';
      this.playerRow.innerHTML = '';
      this.playerRow.classList.remove('many');
      this.updateShoe();
    }

    async play(student, opts) {
      this.student = student;
      this.holeShown = false;
      SPEED = opts.speed || 1;
      await this.clear();
      this.ensureShoe(opts.decks);
      this.dealerRow.appendChild(makeHand('dealer'));
      const first = makeHand('player');
      this.playerRow.appendChild(first);
      this.game = new BJ.Game({
        shoe: this.shoe,
        rules: opts.rules,
        getSteer: opts.getSteer,
        hooks: this.hooks(),
      });
      await this.placeBet(first, 'red');
      const R = await this.game.playRound();
      await this.showResult(R);
      return R;
    }

    async placeBet(handEl, kind) {
      const chip = makeChip(kind);
      handEl.querySelector('.bet').appendChild(chip);
      const to = chip.getBoundingClientRect();
      const from = this.playerPlate.getBoundingClientRect();
      chip.style.visibility = 'hidden';
      const ghost = makeChip(kind);
      Sound.chip();
      await this.ghostFly(ghost, { left: from.left + from.width / 2 - to.width / 2, top: from.top, width: to.width, height: to.height }, to, { duration: 420 });
      chip.style.visibility = '';
    }

    hooks() {
      return {
        shuffle: async () => {
          this.toast('Shuffling a fresh shoe…', 1500);
          Sound.shuffle();
          this.discarded = 0;
          if (this.shoeEl.animate) {
            this.shoeEl.animate([
              { transform: 'rotate(0)' }, { transform: 'rotate(-4deg) translateY(-4px)' },
              { transform: 'rotate(3deg)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(0)' },
            ], { duration: 900 * SPEED });
          }
          this.updateShoe();
          await wait(1100);
        },

        deal: async ({ who, handIndex, index, card, faceDown }) => {
          const handEl = who === 'dealer' ? this.dealerHand() : this.playerHand(handIndex);
          const cardEl = makeCard(card, index);
          if (who === 'dealer' && index === 1) cardEl.classList.add('hole');
          handEl.querySelector('.cards').appendChild(cardEl);
          this.setCount(handEl);
          this.updateShoe();
          const to = cardEl.getBoundingClientRect();
          const from = this.shoeEl.querySelector('.shoe-mouth').getBoundingClientRect();
          const dx = from.left + from.width / 2 - (to.left + to.width / 2);
          const dy = from.top + from.height / 2 - (to.top + to.height / 2);
          Sound.deal();
          const dur = (reducedMotion() ? 150 : 480) * SPEED;
          const anim = cardEl.animate([
            { transform: `translate(${dx}px, ${dy}px) rotate(-62deg) scale(.7)`, opacity: 0 },
            { opacity: 1, offset: 0.1 },
            { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
          ], { duration: dur, easing: 'cubic-bezier(.16,.8,.26,1)' });
          if (!faceDown) setTimeout(() => this.flipUp(cardEl), dur * 0.3);
          await anim.finished.catch(() => {});
          if (!faceDown) await wait(120);
          this.renderTotals();
          await wait(who === 'dealer' && index > 1 ? 380 : 90);
        },

        peek: async (dealerBJ) => {
          const hole = this.dealerHand().querySelector('.card.hole');
          this.toast('The bank checks for blackjack…', 1300);
          Sound.peek();
          if (hole && hole.animate && !reducedMotion()) {
            await hole.animate([
              { transform: 'none' },
              { transform: 'translateY(-16px) rotateX(32deg)', offset: 0.3 },
              { transform: 'translateY(-16px) rotateX(32deg)', offset: 0.7 },
              { transform: 'none' },
            ], { duration: 1200 * SPEED, easing: 'ease-in-out' }).finished.catch(() => {});
          } else {
            await wait(800);
          }
          if (!dealerBJ) this.toast('No blackjack. Play on!', 1100);
          await wait(dealerBJ ? 200 : 500);
        },

        revealHole: async (card) => {
          const hole = this.dealerHand().querySelector('.card.hole');
          if (hole) {
            setFront(hole, card);
            this.flipUp(hole);
          }
          this.holeShown = true;
          await wait(420);
          this.renderTotals();
          await wait(380);
        },

        activeHand: async (i) => {
          Array.from(this.playerRow.children).forEach((h, k) => h.classList.toggle('active', k === i && this.playerRow.children.length > 1));
          if (i >= 0 && this.playerRow.children.length > 1) {
            this.toast(`Hand ${i + 1} of ${this.playerRow.children.length}`, 1000);
            await wait(250);
          }
        },

        getAction: (i, allowed) => new Promise((resolve) => {
          this.pending = { resolve, allowed };
          this.setActions(allowed);
          this.setTurn(true);
          this.app.onPlayerTurn();
        }),

        double: async (i) => {
          this.toast('Double down! One more card.', 1300);
          await this.placeBet(this.playerHand(i), 'red');
        },

        split: async (i) => {
          const src = this.playerHand(i);
          const moving = src.querySelector('.cards').lastElementChild;
          const nh = makeHand('player');
          const hands = Array.from(this.playerRow.children);
          const before = hands.map((h) => h.getBoundingClientRect());
          const fromRect = moving.getBoundingClientRect();
          src.after(nh);
          if (this.playerRow.children.length >= 3) this.playerRow.classList.add('many');
          moving.style.setProperty('--i', 0);
          nh.querySelector('.cards').appendChild(moving);
          this.setCount(src);
          this.setCount(nh);
          hands.forEach((h, k) => {
            const r = h.getBoundingClientRect();
            const dx = before[k].left - r.left;
            if (dx && h.animate) h.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 380 * SPEED, easing: 'cubic-bezier(.2,.8,.2,1)' });
          });
          const toRect = moving.getBoundingClientRect();
          if (moving.animate) {
            moving.animate([
              { transform: `translate(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px)` },
              { transform: 'none' },
            ], { duration: 420 * SPEED, easing: 'cubic-bezier(.2,.8,.2,1)' });
          }
          this.toast('Split! Two hands.', 1200);
          await wait(440);
          await this.placeBet(nh, 'red');
          this.renderTotals();
        },

        handDone: async (i, reason) => {
          const el = this.playerHand(i);
          this.renderTotals();
          if (reason === 'bust') {
            el.classList.add('bust');
            Sound.bust();
            if (el.animate && !reducedMotion()) {
              el.animate([
                { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' },
                { transform: 'translateX(-6px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' },
              ], { duration: 420 });
            }
            this.setTag(el, 'Bust', 'bust');
            await wait(750);
          } else if (reason === '21') {
            el.classList.add('glow');
            const r = el.querySelector('.cards').getBoundingClientRect();
            FX.sparkle(r.left + r.width / 2, r.top + r.height / 2, 30);
            await wait(450);
          } else {
            await wait(200);
          }
        },
      };
    }

    flipUp(cardEl) {
      if (!cardEl.classList.contains('down')) return;
      cardEl.classList.remove('down');
      const inner = cardEl.querySelector('.card-inner');
      Sound.flip();
      if (inner.animate && !reducedMotion()) {
        inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: 420 * SPEED, easing: 'cubic-bezier(.3,.7,.3,1)' });
      }
    }

    setTag(handEl, text, cls) {
      const tag = handEl.querySelector('.tag');
      tag.textContent = text;
      tag.className = 'tag show ' + cls;
    }

    /* ------------------------------------------------------------- result */

    async settleChips(R) {
      const rack = this.rackEl.getBoundingClientRect();
      const plate = this.playerPlate.getBoundingClientRect();
      const flights = [];
      R.hands.forEach((h, i) => {
        const el = this.playerHand(i);
        if (!el) return;
        const bet = el.querySelector('.bet');
        const chips = Array.from(bet.children);
        if (h.payout < 0) {
          chips.forEach((c, k) => {
            const r = c.getBoundingClientRect();
            c.style.visibility = 'hidden';
            const ghost = makeChip(chipKind(c));
            flights.push(this.ghostFly(ghost, r, { left: rack.left + rack.width / 2 - r.width / 2, top: rack.top, width: r.width, height: r.height }, { duration: 560, delay: i * 120 + k * 80, fade: true }));
          });
        } else if (h.payout > 0) {
          const n = h.result === 'blackjack' ? 2 : chips.length;
          for (let k = 0; k < n; k++) {
            const kind = h.result === 'blackjack' && k === 1 ? 'pink' : (chips[k] ? chipKind(chips[k]) : 'red');
            const chip = makeChip(kind);
            chip.classList.add('won');
            bet.appendChild(chip);
            const to = chip.getBoundingClientRect();
            chip.style.visibility = 'hidden';
            const ghost = makeChip(kind);
            flights.push(this.ghostFly(ghost, { left: rack.left + rack.width / 2 - to.width / 2, top: rack.top, width: to.width, height: to.height }, to, { duration: 560, delay: i * 120 + k * 110 })
              .then(() => { chip.style.visibility = ''; Sound.chip(); }));
          }
        }
      });
      await Promise.all(flights);
      // the student scoops up the winnings
      const won = R.hands.some((h) => h.payout > 0);
      if (won) {
        await wait(350);
        const gathered = [];
        R.hands.forEach((h, i) => {
          if (h.payout <= 0) return;
          const el = this.playerHand(i);
          Array.from(el.querySelector('.bet').children).forEach((c, k) => {
            const r = c.getBoundingClientRect();
            const ghost = c.cloneNode(true);
            c.style.visibility = 'hidden';
            gathered.push(this.ghostFly(ghost, r, { left: plate.left + plate.width / 2 - r.width / 2, top: plate.top, width: r.width, height: r.height }, { duration: 520, delay: k * 60, fade: true }));
          });
        });
        await Promise.all(gathered);
      }
    }

    async showResult(R) {
      this.setActions(null);
      this.hideToast();
      this.renderTotals();
      const name = this.student ? this.student.name : 'The student';
      R.hands.forEach((h, i) => {
        const el = this.playerHand(i);
        if (!el) return;
        el.classList.remove('active');
        const label = { blackjack: 'Blackjack', win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust' }[h.result];
        this.setTag(el, label, h.result);
      });
      if (R.dealerBust) this.setTag(this.dealerHand(), 'Bank busts', 'bust');
      await wait(250);
      await this.settleChips(R);

      const s = this.app.settings;
      let kind;
      let title;
      let line;
      if (R.outcome === 'player') {
        kind = R.playerBJ ? 'blackjack' : 'win';
        title = R.playerBJ ? 'Blackjack!' : `${name} wins!`;
        line = R.playerBJ ? `${name} beats the bank` : (R.dealerBust ? 'The bank went bust' : 'Beat the bank');
      } else if (R.outcome === 'bank') {
        kind = 'lose';
        title = 'The bank wins';
        line = R.dealerBJ ? 'The bank had blackjack' : (R.hands.every((h) => h.result === 'bust') ? `${name} went bust` : 'Better luck next time');
      } else {
        kind = 'push';
        title = 'Push';
        line = 'A tie. Nobody wins';
      }
      const stake = kind === 'push' ? s.stakePush : (R.outcome === 'player' ? s.stakeWin : s.stakeLose);
      this.banner.innerHTML = `<div class="banner-inner"><div class="banner-title">${escapeHTML(title)}</div><div class="banner-line">${escapeHTML(line)}</div>${stake ? `<div class="banner-stake">${escapeHTML(stake)}</div>` : ''}</div>`;
      this.banner.className = 'banner show ' + kind;
      // after a moment the banner shrinks so the class can see the cards again
      clearTimeout(this.dockTimer);
      this.dockTimer = setTimeout(() => {
        if (this.banner.classList.contains('show')) this.banner.classList.add('docked');
      }, 2600 * SPEED);
      this.felt.classList.add('result-' + R.outcome);

      if (kind === 'blackjack') {
        Sound.blackjack();
        FX.burst({ palette: 'gold', count: 160, power: 18, shapes: ['rect', 'circle', 'chip'] });
        setTimeout(() => FX.rain({ palette: 'party', count: 120 }), 300);
      } else if (kind === 'win') {
        Sound.win();
        const r = this.banner.getBoundingClientRect();
        FX.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, palette: 'party', count: 150, power: 16 });
      } else if (kind === 'lose') {
        Sound.lose();
      } else {
        Sound.push();
      }
      await wait(400);
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  root.TableUI = TableUI;
  root.escapeHTML = escapeHTML;
})(window);
