// ============================================================
// Rules check for engine.js — run with:  node test-engine.js
// Hand-made situations for each card, then thousands of full bot games that check the
// game always ends, no card is lost or copied, and every state can be saved to Firestore.
// ============================================================
const E = require('./engine.js');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };
const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));

// Build a round, then set hands / table by hand
function setup(n, hands, top, opts = {}) {
  const st = E.newRound(P(n));
  let id = 1000;
  const mk = (L, D) => ({ id: id++, L: { c: L[0], v: L[1] }, D: { c: D[0], v: D[1] } });
  const filler = () => [['blue', '9'], ['cyan', '9']];
  st.hands = {};
  st.players.forEach((p, i) => { st.hands[p.id] = (hands[i] || [filler(), filler()]).map(c => mk(c[0], c[1])); });
  st.players = st.players.map(p => ({ ...p, cardCount: st.hands[p.id].length }));
  st.discard = [mk(top[0], top[1])];
  st.side = opts.side || 'L';
  const f = st.discard[0][st.side];
  st.topColor = f.c; st.topValue = f.v;
  st.drawPile = Array.from({ length: 40 }, (_, i) => mk(['green', String(1 + i % 9)], [i % 7 ? 'cyan' : 'orange', String(1 + i % 9)]));
  return st;
}
const R = ['red', '5'], NI = ['magenta', '5'];

console.log('Hand-made situations');
{ // Day +1: next draws 1 and is skipped
  let st = setup(3, [[[['red', 'draw1'], NI], [R, NI]]], [R, NI]);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state && r.state.hands.p1.length === 3 && r.state.currentPlayerIndex === 2, '+1 draws one and skips');
}
{ // Night +5 and Skip Everyone
  let st = setup(3, [[[R, ['magenta', 'draw5']], [R, NI]]], [R, NI], { side: 'D' });
  let r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.hands.p1.length === 7 && r.state.currentPlayerIndex === 2, '+5 draws five and skips');
  st = setup(4, [[[R, ['magenta', 'skipAll']], [R, NI]]], [R, NI], { side: 'D' });
  r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.currentPlayerIndex === 0, 'skip everyone: same player again');
}
{ // Reverse with two players works as a skip
  const st = setup(2, [[[['red', 'reverse'], NI], [R, NI]]], [R, NI]);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.currentPlayerIndex === 0 && r.state.direction === -1, 'reverse with 2 = skip');
}
{ // Flip turns the game over; the table shows the flip card's other face
  const st = setup(3, [[[['red', 'flip'], ['violet', '7']], [R, NI]]], [R, NI]);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.side === 'D' && r.state.topColor === 'violet' && r.state.topValue === '7' && r.state.currentPlayerIndex === 1, 'flip');
  ok(E.isPlayable(r.state.hands.p1[0], r.state) === false, 'after flip, hands use night faces');
}
{ // Flip onto a wild face: the flipper names the colour, then the next player goes
  const st = setup(3, [[[['red', 'flip'], ['wild', 'wild']], [R, NI]]], [R, NI]);
  let r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.phase?.k === 'color', 'flip onto wild asks for colour');
  ok(E.apply(r.state, { t: 'draw' }, 'p1').error, 'nobody plays while colour is open');
  r = E.apply(r.state, { t: 'color', color: 'cyan' }, 'p0');
  ok(r.state.topColor === 'cyan' && r.state.currentPlayerIndex === 1 && !r.state.phase, 'colour picked, next player');
}
{ // Wild +2 played fairly; challenge fails → target takes 4 and loses the turn
  const st = setup(3, [[[['wild', 'wild2'], NI], [['blue', '3'], NI], [['green', '1'], NI]]], [R, NI]);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.phase?.k === 'challenge' && r.state.phase.guilty === false, 'wild +2 opens a fair challenge');
  r = E.apply(r.state, { t: 'challenge' }, 'p1');
  ok(r.state.hands.p1.length === 6 && r.state.currentPlayerIndex === 2, 'lost challenge: +4, skipped');
}
{ // Wild +2 bluff caught → player who bluffed takes 2, target keeps turn
  const st = setup(3, [[[['wild', 'wild2'], NI], [['red', '3'], NI], [['red', '1'], NI]]], [R, NI]);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.phase.guilty === true, 'bluff detected');
  r = E.apply(r.state, { t: 'challenge' }, 'p1');
  ok(r.state.hands.p0.length === 4 && r.state.currentPlayerIndex === 1, 'won challenge: bluffer +2, target plays');
}
{ // Night Wild Draw Colour: accept → draw until that colour
  const st = setup(3, [[[R, ['wild', 'wildColor']], [R, NI]]], [R, ['cyan', '3']], { side: 'D' });
  let r = E.apply(st, { t: 'play', i: 0, color: 'orange' }, 'p0');
  r = E.apply(r.state, { t: 'accept' }, 'p1');
  const h = r.state.hands.p1;
  ok(h[h.length - 1].D.c === 'orange' && r.state.currentPlayerIndex === 2, 'draw until colour');
}
{ // Last card: shout or be caught
  const st = setup(3, [[[R, NI], [['red', '7'], NI]]], [R, NI]);
  let r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.uno?.pid === 'p0', 'one card → must shout');
  const caught = E.apply(r.state, { t: 'catch' }, 'p2');
  ok(caught.state.hands.p0.length === 3, 'caught → +2');
  const safe = E.apply(r.state, { t: 'shout' }, 'p0');
  ok(!safe.state.uno && E.apply(safe.state, { t: 'catch' }, 'p2').error, 'shouted → safe');
}
{ // Drawing: unplayable card passes by itself; playable one can be played or passed
  const st = setup(3, [[[['blue', '1'], NI]]], [R, NI]);
  st.drawPile[0].L = { c: 'green', v: '2' };
  let r = E.apply(st, { t: 'draw' }, 'p0');
  ok(r.state.currentPlayerIndex === 1 && !r.state.drawn, 'unplayable draw passes');
  const st2 = setup(3, [[[['blue', '1'], NI]]], [R, NI]);
  st2.drawPile[0].L = { c: 'red', v: '2' };
  r = E.apply(st2, { t: 'draw' }, 'p0');
  ok(r.state.drawn && r.state.currentPlayerIndex === 0, 'playable draw waits');
  ok(E.apply(r.state, { t: 'play', i: 0 }, 'p0').error === 'onlyDrawn', 'only the drawn card');
  ok(E.apply(r.state, { t: 'play', i: 1 }, 'p0').state, 'drawn card playable');
}
{ // Winning scores the other hands on the side in play
  const st = setup(2, [[[R, NI]], [[['red', 'skip'], NI], [['wild', 'wild'], NI]]], [R, NI]);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.status === 'ended' && r.state.winner === 'p0' && r.state.roundPoints === 60, 'score 20+40');
}
{ // Timeout only counts once
  const st = setup(3, [], [R, NI]);
  const r = E.apply(st, { t: 'timeout', seq: st.seq }, 'sys');
  ok(r.state && r.state.currentPlayerIndex !== 0, 'timeout moves on');
  ok(E.apply(r.state, { t: 'timeout', seq: st.seq }, 'sys').error === 'stale', 'stale timeout ignored');
}

{ // Joining and leaving mid-round keeps every card
  let st = E.newRound(P(4));
  st = E.addPlayer(st, { id: 'late', name: 'Late' });
  ok(st.hands.late.length === 7 && st.players.length === 5, 'late joiner gets 7');
  st.currentPlayerIndex = 2;
  st = E.removePlayer(st, 'p2');
  ok(st.players[st.currentPlayerIndex].id === 'p3', 'turn passes on when the current player leaves');
  const all = [...st.drawPile, ...st.discard, ...Object.values(st.hands).flat()];
  ok(all.length === 112, 'no cards lost when leaving');
  st = E.removePlayer(E.removePlayer(E.removePlayer(st, 'p0'), 'p1'), 'p3');
  ok(st.status === 'ended' && st.winner === 'late', 'last one left wins');
}

// ---------- Many full bot games ----------
const PERSONAS = ['attacker', 'flipper', 'saver', 'bluffer', 'balanced'];
function nested(v, depth = 0) {   // Firestore forbids arrays directly inside arrays
  if (Array.isArray(v)) return v.some(x => Array.isArray(x) || nested(x, depth + 1));
  if (v && typeof v === 'object') return Object.values(v).some(x => nested(x, depth + 1));
  return v === undefined;
}
let games = 0, moves = 0, flips = 0, longest = 0, matchDone = 0;
const N = Number(process.argv[2] || 3000);
for (let g = 0; g < N; g++) {
  const n = 2 + (g % 9);
  let st = E.newRound(P(n), { matchTarget: g % 3 ? 0 : 500 });
  let steps = 0;
  while (st.status === 'playing' && steps < 4000) {
    steps++;
    // sometimes a player drops out, sometimes people shout / catch
    if (Math.random() < 0.002 && n > 2) {
      const p = st.players[Math.floor(Math.random() * st.players.length)];
      if (!p.disconnected && st.players.filter(x => !x.disconnected).length > 2) {
        st = { ...st, players: st.players.map(x => x.id === p.id ? { ...x, disconnected: true } : x) };
      }
    }
    if (Math.random() < 0.003 && st.players.length > 2) st = E.removePlayer(st, st.players[Math.floor(Math.random() * st.players.length)].id);
    else if (Math.random() < 0.002 && st.players.length < 10) st = E.addPlayer(st, { id: 'j' + steps, name: 'J' + steps });
    if (st.status !== 'playing') break;
    if (st.uno && Math.random() < 0.5) {
      const r = Math.random() < 0.6 ? E.apply(st, { t: 'shout' }, st.uno.pid)
        : E.apply(st, { t: 'catch' }, st.players.find(p => p.id !== st.uno.pid).id);
      if (r.state) st = r.state;
    }
    let actor = st.phase?.k === 'challenge' ? st.phase.target : st.phase?.k === 'color' ? st.phase.pid : st.players[st.currentPlayerIndex].id;
    let move;
    if (st.players.find(p => p.id === actor)?.disconnected) move = { t: 'timeout', seq: st.seq };
    else move = E.botMove(st, actor, PERSONAS[g % 5], { fair: g % 2 === 0, challenge: 0.5 });
    if (!move) { ok(false, 'bot found no move'); break; }
    const r = E.apply(st, move, actor);
    if (r.error) { ok(false, `move error ${r.error} ${JSON.stringify(move)} phase=${JSON.stringify(st.phase)}`); break; }
    st = r.state;
    moves++;
    if (st.ev.list.some(e => e.t === 'flip')) flips++;
    // every card is somewhere, exactly once
    const all = [...st.drawPile, ...st.discard, ...Object.values(st.hands).flat()];
    if (all.length !== 112 || new Set(all.map(c => c.id)).size !== 112) { ok(false, `card count ${all.length}`); break; }
    if (st.players.some(p => p.cardCount !== st.hands[p.id].length)) { ok(false, 'cardCount out of sync'); break; }
    if (st.phase === undefined || nested(st)) { ok(false, 'not saveable to Firestore'); break; }
  }
  if (st.status !== 'ended') ok(false, `game ${g} did not end (${steps} steps, ${n} players)`);
  if (st.matchWinner) matchDone++;
  longest = Math.max(longest, steps);
  games++;
}
console.log(`${games} bot games, ${moves} moves, ${flips} flips, longest ${longest} moves`);
console.log(fails ? `${fails} FAILED` : 'All good ✓');
process.exit(fails ? 1 : 0);
