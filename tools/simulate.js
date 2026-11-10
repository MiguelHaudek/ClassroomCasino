#!/usr/bin/env node
/*
 * Plays thousands of hands with a computer "student" to measure how the tempered
 * odds behave. Run:  node tools/simulate.js [handsPerRow]
 * The printed calibration table is what js/blackjack.js uses to turn
 * "student wins 70 % of the time" into steering decisions.
 */
'use strict';
const BJ = require('../js/blackjack.js');

const N = Number(process.argv[2]) || 20000;

// Textbook basic strategy (multi-deck, dealer stands on soft 17, double after split).
function basicStrategy(hand, allowed, up) {
  const v = BJ.handValue(hand.cards);
  const u = up; // 1 = ace
  const between = (a, b) => u >= a && u <= b;
  if (allowed.split) {
    const c = hand.cards[0].cls;
    if (c === 1 || c === 8) return 'split';
    if (c === 9 && (between(2, 6) || u === 8 || u === 9)) return 'split';
    if (c === 7 && between(2, 7)) return 'split';
    if (c === 6 && between(2, 6)) return 'split';
    if (c === 4 && between(5, 6)) return 'split';
    if ((c === 2 || c === 3) && between(2, 7)) return 'split';
  }
  if (v.soft) {
    const t = v.total;
    if (t >= 19) return 'stand';
    if (t === 18) {
      if (allowed.double && between(3, 6)) return 'double';
      return between(2, 8) ? 'stand' : 'hit';
    }
    if (t === 17 && allowed.double && between(3, 6)) return 'double';
    if ((t === 15 || t === 16) && allowed.double && between(4, 6)) return 'double';
    if ((t === 13 || t === 14) && allowed.double && between(5, 6)) return 'double';
    return 'hit';
  }
  const t = v.total;
  if (t >= 17) return 'stand';
  if (t >= 13) return between(2, 6) ? 'stand' : 'hit';
  if (t === 12) return between(4, 6) ? 'stand' : 'hit';
  if (t === 11) return allowed.double && u !== 1 ? 'double' : 'hit';
  if (t === 10) return allowed.double && between(2, 9) ? 'double' : 'hit';
  if (t === 9) return allowed.double && between(3, 6) ? 'double' : 'hit';
  return 'hit';
}

// A typical kid: hits below 17, never doubles or splits.
function naive(hand) {
  return BJ.handValue(hand.cards).total < 17 ? 'hit' : 'stand';
}

async function run(strategy, target, strength) {
  const shoe = new BJ.Shoe(6);
  let win = 0, lose = 0, push = 0, pbj = 0, dbj = 0, dbust = 0, tens = 0, cards = 0;
  let game;
  game = new BJ.Game({
    shoe,
    rules: {},
    getSteer: () => ({ target, strength }),
    hooks: {
      getAction: async (i, allowed, hand) =>
        strategy === 'basic' ? basicStrategy(hand, allowed, game.round.dealer.cards[0].cls) : naive(hand),
    },
  });
  for (let i = 0; i < N; i++) {
    const R = await game.playRound();
    if (R.outcome === 'player') win++;
    else if (R.outcome === 'bank') lose++;
    else push++;
    if (R.playerBJ) pbj++;
    if (R.dealerBJ) dbj++;
    if (R.dealerBust) dbust++;
    const all = R.hands.flatMap((h) => h.cards).concat(R.dealer.cards);
    for (const c of all) { cards++; if (c.cls === 10) tens++; }
  }
  const pct = (x) => (100 * x / N).toFixed(1).padStart(5);
  return { win: win / N, lose: lose / N, push: push / N,
    line: `win ${pct(win)}  lose ${pct(lose)}  push ${pct(push)} | playerBJ ${pct(pbj)}  dealerBJ ${pct(dbj)}  dealerBust ${pct(dbust)}  tens ${(100 * tens / cards).toFixed(1)}%` };
}

(async () => {
  const t0 = Date.now();
  console.log(`Hands per row: ${N}  (K=${BJ.TUNE.K_STEER}, initialDamp=${BJ.TUNE.INITIAL_DAMP})\n`);
  for (const strategy of ['basic', 'naive']) {
    const fair = await run(strategy, null, 0);
    console.log(`[${strategy}] fair              ${fair.line}`);
    const cal = [{ s: 0, a: fair.win, b: fair.win }];
    for (const s of [0.25, 0.5, 0.75, 1]) {
      const a = await run(strategy, 'player', s);
      const b = await run(strategy, 'bank', s);
      console.log(`[${strategy}] s=${s.toFixed(2)} for student ${a.line}`);
      console.log(`[${strategy}] s=${s.toFixed(2)} for bank    ${b.line}`);
      cal.push({ s, a: +a.win.toFixed(3), b: +b.win.toFixed(3) });
    }
    console.log(`\n[${strategy}] CALIBRATION = ${JSON.stringify(cal.map((c) => ({ s: c.s, a: +c.a.toFixed(3), b: +c.b.toFixed(3) })))}\n`);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
