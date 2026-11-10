/*
 * Classroom Casino — blackjack engine.
 *
 * Pure game logic, no DOM. Runs in the browser (window.BJ) and in Node
 * (require('./blackjack.js')) so the odds can be simulated from tools/simulate.js.
 *
 * How the "tempered" odds work
 * ----------------------------
 * Every card still comes out of a real, shuffled shoe of N decks: no card is ever
 * invented or duplicated, and the rules are standard blackjack. When the teacher
 * tempers a hand, each draw is *tilted*: for every rank still in the shoe we work out
 * how likely the favoured side is to win if that rank comes next, and then pick the
 * next card with weight  count(rank) * exp(beta * P(favoured side wins)).
 * beta = 0 is a perfectly fair draw; larger beta leans harder towards the target.
 * The dealer's face-down card is only fixed when it is needed (peek or reveal), which
 * keeps the tilt effective without breaking any rule the class can see.
 */
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  // Tuned with tools/simulate.js.
  const TUNE = {
    K_STEER: 4,         // tilt strength at strength = 1
    INITIAL_DAMP: 0.4,  // the opening cards are tilted more gently (looks natural)
  };

  // Measured with tools/simulate.js (20k hands per row, average of a basic-strategy
  // player and a "hit below 17" player):
  // s = strength, a = P(student wins | steering for the student),
  // b = P(student wins | steering for the bank). A fair game sits around 42 %.
  let CALIBRATION = [
    { s: 0.0, a: 0.421, b: 0.421 },
    { s: 0.25, a: 0.634, b: 0.261 },
    { s: 0.5, a: 0.801, b: 0.140 },
    { s: 0.75, a: 0.903, b: 0.077 },
    { s: 1.0, a: 0.954, b: 0.041 },
  ];

  function cryptoRandom() {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || root.crypto;
    if (c && c.getRandomValues) {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  function classOf(rank) {
    if (rank === 'A') return 1;
    if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
    return Number(rank);
  }

  function isRed(card) {
    return card.suit === '♥' || card.suit === '♦';
  }

  /* ------------------------------------------------------------------ Shoe */

  class Shoe {
    constructor(decks, rand) {
      this.decks = Math.max(1, Math.min(8, decks | 0 || 6));
      this.rand = rand || cryptoRandom;
      this.generation = 0;
      this.shuffle();
    }

    shuffle() {
      const cards = [];
      this.generation++;
      for (let d = 0; d < this.decks; d++) {
        for (const s of SUITS) {
          for (const r of RANKS) {
            cards.push({ rank: r, suit: s, cls: classOf(r), id: `${this.generation}-${d}-${r}${s}` });
          }
        }
      }
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        const t = cards[i];
        cards[i] = cards[j];
        cards[j] = t;
      }
      this.cards = cards;
      this.total = cards.length;
      this.counts = new Array(11).fill(0);
      for (const c of cards) this.counts[c.cls]++;
      // Cut card at 70–80 % penetration, always leaving enough for a full round.
      const penetration = 0.7 + this.rand() * 0.1;
      this.cutAt = Math.max(16, Math.floor(this.total * (1 - penetration)));
    }

    get remaining() {
      return this.cards.length;
    }

    get needsShuffle() {
      return this.cards.length <= this.cutAt;
    }

    probabilities() {
      const p = new Array(11).fill(0);
      const n = this.cards.length || 1;
      for (let c = 1; c <= 10; c++) p[c] = this.counts[c] / n;
      return p;
    }

    _take(index) {
      const last = this.cards.length - 1;
      const t = this.cards[index];
      this.cards[index] = this.cards[last];
      this.cards[last] = t;
      const card = this.cards.pop();
      this.counts[card.cls]--;
      return card;
    }

    drawTop() {
      if (!this.cards.length) this.shuffle();
      return this._take(this.cards.length - 1);
    }

    drawClass(cls) {
      if (!this.cards.length) this.shuffle();
      const idx = [];
      for (let i = 0; i < this.cards.length; i++) if (this.cards[i].cls === cls) idx.push(i);
      if (!idx.length) return this.drawTop();
      return this._take(idx[Math.floor(this.rand() * idx.length)]);
    }

    /** weights[1..10] (already include the card counts) */
    drawWeighted(weights) {
      let sum = 0;
      for (let c = 1; c <= 10; c++) if (weights[c] > 0 && this.counts[c] > 0) sum += weights[c];
      if (!(sum > 0) || !isFinite(sum)) return this.drawTop();
      let r = this.rand() * sum;
      let lastOk = 0;
      for (let c = 1; c <= 10; c++) {
        if (!(weights[c] > 0) || this.counts[c] <= 0) continue;
        lastOk = c;
        r -= weights[c];
        if (r < 0) return this.drawClass(c);
      }
      return this.drawClass(lastOk);
    }
  }

  /* ------------------------------------------------------------ Hand maths */

  function handValue(cards) {
    let hard = 0;
    let aces = 0;
    for (const c of cards) {
      if (!c) continue;
      hard += c.cls;
      if (c.cls === 1) aces++;
    }
    const soft = aces > 0 && hard + 10 <= 21;
    return { total: soft ? hard + 10 : hard, soft, hard, hasAce: aces > 0 };
  }

  function isBlackjack(hand) {
    return !hand.fromSplit && hand.cards.length === 2 && hand.cards[0] && hand.cards[1] &&
      handValue(hand.cards).total === 21;
  }

  /* ------------------------------------------------------------- Evaluator */
  // Infinite-deck approximation using the shoe's current composition.
  // Dealer final totals are stored as [17, 18, 19, 20, 21, bust].

  function standVs(total, d) {
    let w = d[5];
    let p = 0;
    let l = 0;
    for (let t = 17; t <= 21; t++) {
      const q = d[t - 17];
      if (total > t) w += q;
      else if (total === t) p += q;
      else l += q;
    }
    return { w, p, l };
  }

  // A simple hit/stand policy, close to basic strategy, used to imagine how the hand goes on.
  function policyStands(total, soft, up) {
    if (total >= 19) return true;
    if (soft) return total === 18 ? up >= 2 && up <= 8 : false;
    if (total >= 17) return true;
    if (total >= 13) return up >= 2 && up <= 6;
    if (total === 12) return up >= 4 && up <= 6;
    return false;
  }

  class Evaluator {
    constructor(p, h17) {
      this.p = p;
      this.h17 = !!h17;
      this.dMemo = new Map();
      this.upMemo = new Map();
      this.pMemo = new Map();
    }

    dealerFrom(hard, ace) {
      const key = hard * 2 + (ace ? 1 : 0);
      let out = this.dMemo.get(key);
      if (out) return out;
      out = [0, 0, 0, 0, 0, 0];
      if (hard > 21) {
        out[5] = 1;
      } else {
        const soft = ace && hard + 10 <= 21;
        const total = soft ? hard + 10 : hard;
        if (total >= 17 && !(this.h17 && soft && total === 17)) {
          out[total - 17] = 1;
        } else {
          for (let c = 1; c <= 10; c++) {
            const pc = this.p[c];
            if (!pc) continue;
            const sub = this.dealerFrom(hard + c, ace || c === 1);
            for (let k = 0; k < 6; k++) out[k] += pc * sub[k];
          }
        }
      }
      this.dMemo.set(key, out);
      return out;
    }

    /** Dealer showing `up`, hole card unknown, already known NOT to be blackjack. */
    dealerFromUp(up) {
      let out = this.upMemo.get(up);
      if (out) return out;
      const ex = up === 1 ? 10 : up === 10 ? 1 : 0;
      let norm = 0;
      for (let c = 1; c <= 10; c++) if (c !== ex) norm += this.p[c];
      out = [0, 0, 0, 0, 0, 0];
      if (norm <= 0) {
        out = this.dealerFrom(up, up === 1);
      } else {
        for (let c = 1; c <= 10; c++) {
          if (c === ex || !this.p[c]) continue;
          const q = this.p[c] / norm;
          const sub = this.dealerFrom(up + c, up === 1 || c === 1);
          for (let k = 0; k < 6; k++) out[k] += q * sub[k];
        }
      }
      this.upMemo.set(up, out);
      return out;
    }

    playerStand(hard, ace, up) {
      if (hard > 21) return { w: 0, p: 0, l: 1 };
      const soft = ace && hard + 10 <= 21;
      return standVs(soft ? hard + 10 : hard, this.dealerFromUp(up));
    }

    playerFrom(hard, ace, up) {
      const key = (up * 64 + hard) * 2 + (ace ? 1 : 0);
      let out = this.pMemo.get(key);
      if (out) return out;
      if (hard > 21) {
        out = { w: 0, p: 0, l: 1 };
      } else {
        const soft = ace && hard + 10 <= 21;
        const total = soft ? hard + 10 : hard;
        if (total === 21 || policyStands(total, soft, up)) {
          out = standVs(total, this.dealerFromUp(up));
        } else {
          out = { w: 0, p: 0, l: 0 };
          for (let c = 1; c <= 10; c++) {
            const pc = this.p[c];
            if (!pc) continue;
            const sub = this.playerFrom(hard + c, ace || c === 1, up);
            out.w += pc * sub.w;
            out.p += pc * sub.p;
            out.l += pc * sub.l;
          }
        }
      }
      this.pMemo.set(key, out);
      return out;
    }

    /** Two-card start vs dealer up card, before the dealer has peeked. */
    initial(c1, c2, up) {
      const bjMaker = up === 1 ? 10 : up === 10 ? 1 : 0;
      const pDBJ = bjMaker ? this.p[bjMaker] : 0;
      const playerBJ = (c1 === 1 && c2 === 10) || (c1 === 10 && c2 === 1);
      if (playerBJ) return { w: 1 - pDBJ, p: pDBJ, l: 0 };
      const r = this.playerFrom(c1 + c2, c1 === 1 || c2 === 1, up);
      return { w: (1 - pDBJ) * r.w, p: (1 - pDBJ) * r.p, l: pDBJ + (1 - pDBJ) * r.l };
    }
  }

  function vsHands(dist, hands) {
    let W = 0, P = 0, L = 0, B = 0;
    for (const h of hands) {
      const r = standVs(h.total, dist);
      W += h.bet * r.w;
      P += h.bet * r.p;
      L += h.bet * r.l;
      B += h.bet;
    }
    if (!B) return { w: 0, p: 1, l: 0 };
    return { w: W / B, p: P / B, l: L / B };
  }

  /* ------------------------------------------------------------------ Game */

  const NOOP = async () => {};
  const DEFAULT_RULES = { h17: false, allowDouble: true, allowSplit: true, das: true, maxHands: 4 };

  function newHand(cards, bet) {
    return { cards: cards || [], bet: bet || 1, fromSplit: false, splitAces: false, doubled: false,
      done: false, bust: false, result: null, payout: 0 };
  }

  class Game {
    /**
     * @param {object} o
     * @param {Shoe} o.shoe
     * @param {object} o.rules
     * @param {object} o.hooks async UI callbacks (all optional except getAction)
     * @param {function} o.getSteer () => ({ target: 'player'|'bank'|null, strength: 0..1 })
     */
    constructor(o) {
      this.shoe = o.shoe;
      this.rules = Object.assign({}, DEFAULT_RULES, o.rules || {});
      this.hooks = Object.assign({
        shuffle: NOOP, deal: NOOP, peek: NOOP, revealHole: NOOP, activeHand: NOOP,
        double: NOOP, split: NOOP, handDone: NOOP,
        getAction: async () => 'stand',
      }, o.hooks || {});
      this.getSteer = o.getSteer || (() => ({ target: null, strength: 0 }));
      this.round = null;
    }

    steer() {
      const s = this.getSteer() || {};
      const strength = Math.max(0, Math.min(1, Number(s.strength) || 0));
      const target = s.target === 'player' || s.target === 'bank' ? s.target : null;
      return { target: strength > 0 ? target : null, strength };
    }

    async playRound() {
      const R = this.round = {
        hands: [newHand()],
        dealer: { cards: [], holeExclude: 0, peeked: false },
        active: 0,
        outcome: null,
      };
      if (this.shoe.needsShuffle) {
        this.shoe.shuffle();
        await this.hooks.shuffle(this.shoe);
      }
      const H = R.hands[0];
      const D = R.dealer;

      await this.dealPlayer(0, 'p1');
      const up = this.draw({ kind: 'up' });
      D.cards.push(up);
      await this.hooks.deal({ who: 'dealer', handIndex: 0, index: 0, card: up, faceDown: false });
      await this.dealPlayer(0, 'p2');
      await this.dealHole();

      const upCls = D.cards[0].cls;
      if (upCls === 1 || upCls === 10) {
        D.peeked = true;
        const dealerBJ = this.resolvePeek();
        await this.hooks.peek(dealerBJ);
        if (dealerBJ) {
          await this.revealHole();
          return this.finish();
        }
      }
      if (isBlackjack(H)) {
        await this.revealHole();
        return this.finish();
      }
      await this.playerTurn();
      await this.dealerTurn();
      return this.finish();
    }

    async dealPlayer(i, kind) {
      const hand = this.round.hands[i];
      const card = this.draw({ kind, handIndex: i });
      hand.cards.push(card);
      await this.hooks.deal({ who: 'player', handIndex: i, index: hand.cards.length - 1, card, faceDown: false });
      return card;
    }

    async dealHole() {
      const D = this.round.dealer;
      const s = this.steer();
      // Fair hands fix the hole card right away; tempered hands decide it when needed.
      const card = s.target ? null : this.shoe.drawTop();
      D.cards[1] = card;
      await this.hooks.deal({ who: 'dealer', handIndex: 0, index: 1, card, faceDown: true });
    }

    resolvePeek() {
      const D = this.round.dealer;
      const upCls = D.cards[0].cls;
      const bjCls = upCls === 1 ? 10 : 1;
      if (D.cards[1]) return D.cards[1].cls === bjCls;
      const remaining = this.shoe.remaining || 1;
      let pBJ = this.shoe.counts[bjCls] / remaining;
      const s = this.steer();
      // Only lean *away* from a dealer blackjack; leaning towards it would look suspicious.
      if (s.target === 'player') {
        const ev = new Evaluator(this.shoe.probabilities(), this.rules.h17);
        const H = this.round.hands[0];
        const v = handValue(H.cards);
        const winIfNo = isBlackjack(H) ? 1 : ev.playerFrom(v.hard, v.hasAce, upCls).w;
        const beta = TUNE.K_STEER * s.strength;
        const wYes = pBJ;
        const wNo = (1 - pBJ) * Math.exp(beta * winIfNo);
        pBJ = wYes / (wYes + wNo);
      }
      if (this.shoe.rand() < pBJ && this.shoe.counts[bjCls] > 0) {
        D.cards[1] = this.shoe.drawClass(bjCls);
        return true;
      }
      D.holeExclude = bjCls;
      return false;
    }

    async revealHole() {
      const D = this.round.dealer;
      if (!D.cards[1]) D.cards[1] = this.draw({ kind: 'hole' });
      await this.hooks.revealHole(D.cards[1]);
    }

    allowed(hand) {
      const R = this.round;
      const two = hand.cards.length === 2;
      return {
        hit: true,
        stand: true,
        double: !!(this.rules.allowDouble && two && !hand.splitAces && (!hand.fromSplit || this.rules.das)),
        split: !!(this.rules.allowSplit && two && hand.cards[0].cls === hand.cards[1].cls &&
          R.hands.length < this.rules.maxHands && !hand.splitAces),
      };
    }

    async playerTurn() {
      const R = this.round;
      for (let i = 0; i < R.hands.length; i++) {
        R.active = i;
        const hand = R.hands[i];
        await this.hooks.activeHand(i);
        if (hand.cards.length === 1) {
          await this.dealPlayer(i, 'player');
          if (hand.splitAces) {
            hand.done = true;
            await this.hooks.handDone(i, handValue(hand.cards).total === 21 ? '21' : 'stand');
            continue;
          }
        }
        while (!hand.done) {
          const v = handValue(hand.cards);
          if (v.total > 21) {
            hand.bust = true;
            hand.done = true;
            await this.hooks.handDone(i, 'bust');
            break;
          }
          if (v.total === 21) {
            hand.done = true;
            await this.hooks.handDone(i, '21');
            break;
          }
          const allowed = this.allowed(hand);
          const action = await this.hooks.getAction(i, allowed, hand);
          if (action === 'hit') {
            await this.dealPlayer(i, 'player');
          } else if (action === 'double' && allowed.double) {
            hand.bet *= 2;
            hand.doubled = true;
            await this.hooks.double(i);
            await this.dealPlayer(i, 'player');
            hand.done = true;
            hand.bust = handValue(hand.cards).total > 21;
            await this.hooks.handDone(i, hand.bust ? 'bust' : 'double');
          } else if (action === 'split' && allowed.split) {
            const moved = hand.cards.pop();
            const aces = moved.cls === 1;
            hand.fromSplit = true;
            hand.splitAces = aces;
            const nh = newHand([moved], hand.bet);
            nh.fromSplit = true;
            nh.splitAces = aces;
            R.hands.splice(i + 1, 0, nh);
            await this.hooks.split(i);
            await this.dealPlayer(i, 'player');
            if (aces) {
              hand.done = true;
              await this.hooks.handDone(i, handValue(hand.cards).total === 21 ? '21' : 'stand');
            }
          } else {
            hand.done = true;
            await this.hooks.handDone(i, 'stand');
          }
        }
      }
      R.active = -1;
      await this.hooks.activeHand(-1);
    }

    dealerMustHit() {
      const v = handValue(this.round.dealer.cards);
      if (v.total < 17) return true;
      return v.total === 17 && v.soft && this.rules.h17;
    }

    async dealerTurn() {
      const R = this.round;
      const D = R.dealer;
      await this.revealHole();
      if (!R.hands.some((h) => !h.bust)) return;
      while (this.dealerMustHit()) {
        const card = this.draw({ kind: 'dealer' });
        D.cards.push(card);
        await this.hooks.deal({ who: 'dealer', handIndex: 0, index: D.cards.length - 1, card, faceDown: false });
      }
    }

    finish() {
      const R = this.round;
      const D = R.dealer;
      const dv = handValue(D.cards);
      const dealerBJ = D.cards.length === 2 && dv.total === 21;
      let net = 0;
      for (const h of R.hands) {
        const v = handValue(h.cards);
        let res;
        let pay;
        if (h.bust || v.total > 21) { res = 'bust'; pay = -h.bet; }
        else if (isBlackjack(h)) {
          if (dealerBJ) { res = 'push'; pay = 0; } else { res = 'blackjack'; pay = 1.5 * h.bet; }
        } else if (dealerBJ) { res = 'lose'; pay = -h.bet; }
        else if (dv.total > 21) { res = 'win'; pay = h.bet; }
        else if (v.total > dv.total) { res = 'win'; pay = h.bet; }
        else if (v.total < dv.total) { res = 'lose'; pay = -h.bet; }
        else { res = 'push'; pay = 0; }
        h.result = res;
        h.payout = pay;
        net += pay;
      }
      R.net = net;
      R.outcome = net > 0 ? 'player' : net < 0 ? 'bank' : 'push';
      R.dealerBJ = dealerBJ;
      R.dealerBust = dv.total > 21;
      R.dealerTotal = dv.total;
      R.playerBJ = R.hands.length === 1 && R.hands[0].result === 'blackjack';
      return R;
    }

    /* ----------------------------------------------------- steered drawing */

    draw(ctx) {
      const shoe = this.shoe;
      if (!shoe.remaining) shoe.shuffle();
      const exclude = ctx.kind === 'hole' ? this.round.dealer.holeExclude : 0;
      const s = this.steer();
      const scores = s.target ? this.score(ctx, exclude) : null;
      if (!scores) {
        if (!exclude) return shoe.drawTop();
        const w = shoe.counts.slice();
        w[exclude] = 0;
        return shoe.drawWeighted(w);
      }
      const initial = ctx.kind === 'p1' || ctx.kind === 'up' || ctx.kind === 'p2';
      const beta = TUNE.K_STEER * s.strength * (initial ? TUNE.INITIAL_DAMP : 1);
      const key = s.target === 'player' ? 'w' : 'l';
      let max = -Infinity;
      for (let c = 1; c <= 10; c++) if (scores[c] && scores[c][key] > max) max = scores[c][key];
      const weights = new Array(11).fill(0);
      for (let c = 1; c <= 10; c++) {
        if (c === exclude || !shoe.counts[c] || !scores[c]) continue;
        weights[c] = shoe.counts[c] * Math.exp(beta * (scores[c][key] - max));
      }
      return shoe.drawWeighted(weights);
    }

    score(ctx, exclude) {
      const R = this.round;
      const p = this.shoe.probabilities();
      const ev = new Evaluator(p, this.rules.h17);
      const out = new Array(11).fill(null);
      const has = (c) => this.shoe.counts[c] > 0 && c !== exclude;
      const D = R.dealer;

      if (ctx.kind === 'p1') {
        for (let c1 = 1; c1 <= 10; c1++) {
          if (!has(c1)) continue;
          const acc = { w: 0, p: 0, l: 0 };
          for (let c2 = 1; c2 <= 10; c2++) {
            if (!p[c2]) continue;
            for (let u = 1; u <= 10; u++) {
              if (!p[u]) continue;
              const r = ev.initial(c1, c2, u);
              const q = p[c2] * p[u];
              acc.w += q * r.w; acc.p += q * r.p; acc.l += q * r.l;
            }
          }
          out[c1] = acc;
        }
        return out;
      }

      if (ctx.kind === 'up') {
        const c1 = R.hands[0].cards[0].cls;
        for (let u = 1; u <= 10; u++) {
          if (!has(u)) continue;
          const acc = { w: 0, p: 0, l: 0 };
          for (let c2 = 1; c2 <= 10; c2++) {
            if (!p[c2]) continue;
            const r = ev.initial(c1, c2, u);
            acc.w += p[c2] * r.w; acc.p += p[c2] * r.p; acc.l += p[c2] * r.l;
          }
          out[u] = acc;
        }
        return out;
      }

      if (ctx.kind === 'p2') {
        const c1 = R.hands[0].cards[0].cls;
        const u = D.cards[0].cls;
        for (let c = 1; c <= 10; c++) if (has(c)) out[c] = ev.initial(c1, c, u);
        return out;
      }

      const up = D.cards[0].cls;

      if (ctx.kind === 'player') {
        const hand = R.hands[ctx.handIndex];
        const v = handValue(hand.cards);
        const lastCard = hand.doubled || hand.splitAces;
        for (let c = 1; c <= 10; c++) {
          if (!has(c)) continue;
          const nh = v.hard + c;
          const na = v.hasAce || c === 1;
          out[c] = lastCard ? ev.playerStand(nh, na, up) : ev.playerFrom(nh, na, up);
        }
        return out;
      }

      // Dealer cards (hole or hits): judged against every hand still alive.
      const live = R.hands.filter((h) => !h.bust).map((h) => ({ total: handValue(h.cards).total, bet: h.bet }));
      if (!live.length) return null;
      const dv = handValue(ctx.kind === 'hole' ? [D.cards[0]] : D.cards);
      for (let c = 1; c <= 10; c++) {
        if (!has(c)) continue;
        out[c] = vsHands(ev.dealerFrom(dv.hard + c, dv.hasAce || c === 1), live);
      }
      return out;
    }
  }

  /* ------------------------------------------------------------ Calibration */

  function calibrationAt(strength) {
    const t = CALIBRATION;
    if (strength <= t[0].s) return t[0];
    for (let i = 1; i < t.length; i++) {
      if (strength <= t[i].s) {
        const a = t[i - 1];
        const b = t[i];
        const f = (strength - a.s) / (b.s - a.s);
        return { s: strength, a: a.a + (b.a - a.a) * f, b: a.b + (b.b - a.b) * f };
      }
    }
    return t[t.length - 1];
  }

  /**
   * How often to steer for the student so that, overall, the student wins about
   * `desired` of the hands at the given strength.
   */
  function targetProbability(desired, strength) {
    const c = calibrationAt(strength);
    if (c.a - c.b < 0.01) return 0.5;
    return Math.max(0, Math.min(1, (desired - c.b) / (c.a - c.b)));
  }

  /** Range of overall student win rates reachable at this strength. */
  function achievableRange(strength) {
    const c = calibrationAt(strength);
    return { min: c.b, max: c.a };
  }

  /**
   * Plan one hand: given the wanted student win chance and the teacher's preferred
   * strength, return { target, strength }. If the wish is outside what that strength
   * can reach (e.g. "wins almost always"), strength is raised just enough.
   */
  function planHand(desired, strength, rand) {
    const r = rand || cryptoRandom;
    let s = Math.max(0.05, Math.min(1, strength));
    for (let i = 0; i < 40; i++) {
      const range = achievableRange(s);
      if ((desired <= range.max && desired >= range.min) || s >= 1) break;
      s = Math.min(1, s + 0.025);
    }
    const q = targetProbability(desired, s);
    return { target: r() < q ? 'player' : 'bank', strength: s };
  }

  const API = {
    SUITS, RANKS, Shoe, Game, Evaluator, handValue, isBlackjack, classOf, isRed,
    targetProbability, achievableRange, calibrationAt, planHand, TUNE,
    get CALIBRATION() { return CALIBRATION; },
    set CALIBRATION(v) { CALIBRATION = v; },
    FAIR_WIN_RATE: 0.42,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.BJ = API;
})(typeof window !== 'undefined' ? window : globalThis);
