// ============================================================
// VOLTEO — rules engine
//
// Every card has two faces: a ☀️ Day face (side 'L') and a 🌙 Night face (side 'D').
// Everybody plays on the same side; a Volteo (flip) card turns the whole game over —
// hands, draw pile and the card on the table.
//
// This file has NO screen and NO Firebase code. Every move — mine, the bots', the guided
// game's, a timeout — goes through Engine.apply(state, move, actorId), which returns the
// new game state (or an error). app.js saves that result in one Firestore transaction,
// so two players can never half-overwrite each other. Because it is plain logic it runs
// in Node too: `node test-engine.js` plays thousands of bot games to check the rules.
//
// Room fields this engine owns are listed in GAME_KEYS; anything else in the room
// (chat, music, votes…) is left alone.
// ============================================================

(function (root) {
  'use strict';

  // ---------- The two sides ----------
  // Day side: classic bright colours. Night side: neon colours and harsher cards.
  const SIDES = {
    L: { colors: ['red', 'yellow', 'green', 'blue'],
         actions: ['draw1', 'reverse', 'skip', 'flip'],
         wilds: ['wild', 'wild2'] },
    D: { colors: ['magenta', 'cyan', 'orange', 'violet'],
         actions: ['draw5', 'reverse', 'skipAll', 'flip'],
         wilds: ['wild', 'wildColor'] }
  };
  const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const WILD_COLOR = 'wild';            // colour name stored on wild faces
  const isWildValue = v => v === 'wild' || v === 'wild2' || v === 'wildColor';

  // Points left in a loser's hand go to the round winner (counted on the side in play)
  const POINTS = {
    L: { draw1: 10, reverse: 20, skip: 20, flip: 20, wild: 40, wild2: 50 },
    D: { draw5: 20, reverse: 20, skipAll: 30, flip: 20, wild: 40, wildColor: 60 }
  };
  const cardPoints = (face, side) => NUMBERS.includes(face.v) ? Number(face.v) : (POINTS[side][face.v] || 0);

  const HAND_SIZE = 7;
  const MATCH_TARGET = 500;
  const LOG_MAX = 24;

  // Every room field this engine writes (app.js copies exactly these into Firestore)
  const GAME_KEYS = ['status', 'side', 'players', 'hands', 'drawPile', 'discard', 'topColor', 'topValue',
    'currentPlayerIndex', 'direction', 'phase', 'drawn', 'uno', 'ev', 'log', 'stats', 'seq',
    'winner', 'winnerName', 'winnerReason', 'roundPoints', 'points', 'matchWinner', 'matchTarget', 'roundNo'];

  // ---------- Deck: 112 cards, Day and Night faces paired at random ----------
  function faceList(side) {
    const s = SIDES[side], out = [];
    for (const c of s.colors) {
      for (const n of NUMBERS) { out.push({ c, v: n }); out.push({ c, v: n }); }
      for (const a of s.actions) { out.push({ c, v: a }); out.push({ c, v: a }); }
    }
    for (const w of s.wilds) for (let i = 0; i < 4; i++) out.push({ c: WILD_COLOR, v: w });
    return out;   // 4 × 26 + 8 = 112
  }
  function shuffle(arr, rnd = Math.random) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function createDeck(rnd = Math.random) {
    const day = shuffle(faceList('L'), rnd), night = shuffle(faceList('D'), rnd);
    return shuffle(day.map((L, i) => ({ id: i, L, D: night[i] })), rnd);
  }

  // ---------- Small helpers ----------
  const other = side => (side === 'L' ? 'D' : 'L');
  const face = (card, side) => card[side];
  const clone = o => JSON.parse(JSON.stringify(o));
  const ci = card => (card ? { id: card.id, L: card.L, D: card.D } : null);   // card as stored in events

  function nextActive(state, fromIdx, dir = state.direction, steps = 1) {
    const n = state.players.length;
    let idx = fromIdx;
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < n; k++) {
        idx = ((idx + dir) % n + n) % n;
        if (!state.players[idx].disconnected) break;
      }
    }
    return idx;
  }
  const activeCount = state => state.players.filter(p => !p.disconnected).length;
  const indexOf = (state, pid) => state.players.findIndex(p => p.id === pid);
  const nameOf = (state, pid) => state.players.find(p => p.id === pid)?.name || '?';
  const currentId = state => state.players[state.currentPlayerIndex]?.id;

  // Can this card go on the table right now?
  function isPlayable(card, state) {
    if (!card) return false;
    const f = face(card, state.side);
    if (f.c === WILD_COLOR) return true;
    return f.c === state.topColor || f.v === state.topValue;
  }
  // Which cards in this player's hand may be played (indexes)
  function legalPlays(state, pid) {
    if (state.status !== 'playing' || state.phase || currentId(state) !== pid) return [];
    const hand = state.hands[pid] || [];
    if (state.drawn) {
      if (state.drawn.pid !== pid) return [];
      const i = hand.findIndex(c => c.id === state.drawn.id);
      return i >= 0 && isPlayable(hand[i], state) ? [i] : [];
    }
    return hand.map((c, i) => (isPlayable(c, state) ? i : -1)).filter(i => i >= 0);
  }
  // A Wild +2 / Wild Draw Colour is only fair when you hold nothing of the colour in play
  function hadColor(hand, side, color) {
    return hand.some(c => face(c, side).c === color);
  }

  // ---------- Drawing (the discard pile is reshuffled when the deck runs out) ----------
  function refill(st) {
    if (st.drawPile.length || st.discard.length <= 1) return;
    const top = st.discard[st.discard.length - 1];
    st.drawPile = shuffle(st.discard.slice(0, -1));
    st.discard = [top];
    addLog(st, 'log.reshuffle', {});
  }
  function take(st, pid, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      refill(st);
      if (!st.drawPile.length) break;
      got.push(st.drawPile.shift());
    }
    st.hands[pid] = [...(st.hands[pid] || []), ...got];
    return got;
  }
  // Night-side Wild Draw Colour: keep drawing until a card of that colour shows up
  function takeUntilColor(st, pid, color) {
    const got = [];
    for (let guard = 0; guard < 120; guard++) {
      refill(st);
      if (!st.drawPile.length) break;
      const c = st.drawPile.shift();
      got.push(c);
      if (face(c, st.side).c === color) break;
    }
    st.hands[pid] = [...(st.hands[pid] || []), ...got];
    return got;
  }

  // ---------- Log, events, stats ----------
  function addLog(st, k, p) {
    st.log = [...(st.log || []), { k, p }].slice(-LOG_MAX);
  }
  function emit(st, e) { st.ev.list.push(e); }
  function stat(st, pid, key, n = 1) {
    if (!pid) return;
    st.stats = st.stats || {};
    const s = st.stats[pid] || (st.stats[pid] = {});
    s[key] = (s[key] || 0) + n;
  }
  function syncCounts(st) {
    st.players = st.players.map(p => ({ ...p, cardCount: (st.hands[p.id] || []).length }));
  }
  // Someone is forced to take cards: hand + event + stats in one place
  function forceDraw(st, pid, n, by, why) {
    const got = n === 'color' ? takeUntilColor(st, pid, st.topColor) : take(st, pid, n);
    emit(st, { t: 'draw', pid, n: got.length, why });
    stat(st, pid, 'taken', got.length);
    if (by && by !== pid) stat(st, by, 'dealt', got.length);
    return got.length;
  }

  // ---------- New round ----------
  // players: [{id, name, …}] (seat order). opts: { matchTarget, points, roundNo, rnd }
  function newRound(players, opts = {}) {
    const rnd = opts.rnd || Math.random;
    let deck = createDeck(rnd);
    const hands = {};
    for (const p of players) hands[p.id] = deck.splice(0, HAND_SIZE);
    // The first table card is a Day number card (others go back into the deck)
    let at = deck.findIndex(c => NUMBERS.includes(c.L.v));
    const start = deck.splice(at, 1)[0];
    const st = {
      status: 'playing',
      side: 'L',
      players: players.map(p => ({ ...p, cardCount: HAND_SIZE, disconnected: !!p.disconnected })),
      hands,
      drawPile: deck,
      discard: [start],
      topColor: start.L.c,
      topValue: start.L.v,
      currentPlayerIndex: 0,
      direction: 1,
      phase: null,
      drawn: null,
      uno: null,
      ev: { n: 1, list: [{ t: 'start' }] },
      log: [],
      stats: {},
      seq: 1,
      winner: null, winnerName: null, winnerReason: null, roundPoints: 0,
      points: opts.points || {},
      matchWinner: null,
      matchTarget: opts.matchTarget || 0,
      roundNo: (opts.roundNo || 0) + 1
    };
    // who starts moves round the table from game to game; never a disconnected player
    st.currentPlayerIndex = (opts.first || 0) % st.players.length;
    if (st.players[st.currentPlayerIndex].disconnected) st.currentPlayerIndex = nextActive(st, st.currentPlayerIndex, 1);
    addLog(st, 'log.start', { name: st.players[st.currentPlayerIndex].name });
    return st;
  }

  // ---------- Ending a round ----------
  function endRound(st, winnerId, reason = 'out') {
    let pts = 0;
    for (const p of st.players) {
      if (p.id === winnerId) continue;
      pts += (st.hands[p.id] || []).reduce((s, c) => s + cardPoints(face(c, st.side), st.side), 0);
    }
    st.status = 'ended';
    st.winner = winnerId;
    st.winnerName = nameOf(st, winnerId);
    st.winnerReason = reason;
    st.roundPoints = pts;
    st.points = { ...(st.points || {}) };
    st.points[winnerId] = (st.points[winnerId] || 0) + pts;
    st.phase = null; st.drawn = null; st.uno = null;
    if (st.matchTarget && st.points[winnerId] >= st.matchTarget) st.matchWinner = winnerId;
    emit(st, { t: 'win', pid: winnerId, pts });
    addLog(st, 'log.win', { name: st.winnerName, pts });
  }

  // Standings for "end by vote" / last player standing: fewest cards, then fewest points
  function leader(st) {
    return st.players
      .filter(p => !p.disconnected)
      .map(p => {
        const hand = st.hands[p.id] || [];
        return { id: p.id, n: hand.length, pts: hand.reduce((s, c) => s + cardPoints(face(c, st.side), st.side), 0) };
      })
      .sort((a, b) => a.n - b.n || a.pts - b.pts)[0]?.id || null;
  }

  // ---------- Applying a move ----------
  // move.t: play {i, color?} · draw · pass · color {color} · accept · challenge ·
  //         shout · catch · timeout {seq} · vote-end · leave (system)
  function apply(state, move, actor) {
    if (!state || state.status !== 'playing') return { error: 'notPlaying' };
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    const err = run(st, move, actor);
    if (err) return { error: err };
    syncCounts(st);
    return { state: st };
  }

  function run(st, move, actor) {
    const me = actor;
    const myIdx = indexOf(st, me);
    const isTurn = currentId(st) === me;

    // The last-card window closes as soon as someone else does something
    const closeUno = () => { if (st.uno && st.uno.pid !== me) st.uno = null; };

    switch (move.t) {
      case 'play': {
        if (!isTurn) return 'notYourTurn';
        if (st.phase) return 'busy';
        const hand = st.hands[me] || [];
        // cards are chosen by id (safe if the hand changed meanwhile); index still works
        if (move.id != null) move = { ...move, i: hand.findIndex(c => c.id === move.id) };
        const card = hand[move.i];
        if (!card) return 'noCard';
        if (st.drawn && card.id !== st.drawn.id) return 'onlyDrawn';
        if (!isPlayable(card, st)) return 'cantPlay';
        const f = face(card, st.side);
        const wild = f.c === WILD_COLOR;
        const sideColors = SIDES[st.side].colors;
        if (wild && !sideColors.includes(move.color)) return 'needColor';
        closeUno();
        const prevColor = st.topColor;
        const handBefore = hand.filter((_, i) => i !== move.i);
        st.hands[me] = handBefore;
        st.discard = [...st.discard, card];
        st.drawn = null;
        st.topColor = wild ? move.color : f.c;
        st.topValue = f.v;
        emit(st, { t: 'play', pid: me, card: ci(card), side: st.side, color: st.topColor });
        stat(st, me, 'plays');
        if (wild) stat(st, me, 'wilds');
        addLog(st, wild ? 'log.playWild' : 'log.play', { name: nameOf(st, me), side: st.side, c: f.c, v: f.v, color: st.topColor });

        const left = handBefore.length;
        const nxt = nextActive(st, myIdx);
        const nxtId = st.players[nxt].id;
        const won = left === 0;

        // ---- what the card does ----
        let goTo = nxt;
        switch (f.v) {
          case 'draw1': case 'draw5': {
            const n = f.v === 'draw1' ? 1 : 5;
            forceDraw(st, nxtId, n, me, f.v);
            emit(st, { t: 'skip', pid: nxtId });
            addLog(st, 'log.drawSkip', { name: nameOf(st, nxtId), n });
            goTo = nextActive(st, nxt);
            break;
          }
          case 'skip':
            emit(st, { t: 'skip', pid: nxtId });
            stat(st, me, 'skips');
            addLog(st, 'log.skip', { name: nameOf(st, nxtId) });
            goTo = nextActive(st, nxt);
            break;
          case 'skipAll':
            emit(st, { t: 'skipAll', pid: me });
            stat(st, me, 'skips', activeCount(st) - 1);
            addLog(st, 'log.skipAll', { name: nameOf(st, me) });
            goTo = myIdx;
            break;
          case 'reverse':
            st.direction = -st.direction;
            emit(st, { t: 'reverse', dir: st.direction });
            if (activeCount(st) === 2) {
              emit(st, { t: 'skip', pid: nxtId });
              addLog(st, 'log.skip', { name: nameOf(st, nxtId) });
              goTo = myIdx;
            } else {
              addLog(st, 'log.reverse', {});
              goTo = nextActive(st, myIdx);
            }
            break;
          case 'flip': {
            st.side = other(st.side);
            const shown = face(card, st.side);
            st.topColor = shown.c;
            st.topValue = shown.v;
            emit(st, { t: 'flip', side: st.side, pid: me, shown });
            stat(st, me, 'flips');
            addLog(st, 'log.flip', { name: nameOf(st, me), side: st.side, c: shown.c, v: shown.v });
            // Turned over onto a wild face: the player who flipped names the colour
            if (shown.c === WILD_COLOR && !won) {
              setUno(st, me, left);
              st.phase = { k: 'color', pid: me, after: st.players[nxt].id };
              return null;
            }
            break;
          }
          case 'wild2': case 'wildColor': {
            if (won) {
              // last card: no challenge, the next player simply takes the cards
              forceDraw(st, nxtId, f.v === 'wild2' ? 2 : 'color', me, f.v);
              break;
            }
            st.phase = {
              k: 'challenge', kind: f.v, by: me, target: nxtId,
              // was it fair? (any card of the colour that was in play)
              guilty: hadColor(handBefore, st.side, prevColor),
              prevColor, handAtPlay: handBefore.map(c => face(c, st.side))
            };
            st.currentPlayerIndex = nxt;
            emit(st, { t: 'challengeOpen', by: me, target: nxtId, kind: f.v });
            addLog(st, 'log.wildDraw', { name: nameOf(st, me), target: nameOf(st, nxtId), v: f.v, color: st.topColor });
            setUno(st, me, left);
            return null;
          }
        }
        if (won) { endRound(st, me); return null; }
        setUno(st, me, left);
        st.currentPlayerIndex = goTo;
        return null;
      }

      case 'draw': {
        if (!isTurn) return 'notYourTurn';
        if (st.phase) return 'busy';
        if (st.drawn) return 'alreadyDrew';
        closeUno();
        const got = take(st, me, 1);
        if (!got.length) {          // no cards anywhere: just pass
          addLog(st, 'log.pass', { name: nameOf(st, me) });
          st.currentPlayerIndex = nextActive(st, myIdx);
          return null;
        }
        emit(st, { t: 'draw', pid: me, n: 1, why: 'self' });
        stat(st, me, 'drew');
        if (isPlayable(got[0], st)) {
          st.drawn = { pid: me, id: got[0].id };   // may play it now, or pass
        } else {
          addLog(st, 'log.drewPass', { name: nameOf(st, me) });
          st.currentPlayerIndex = nextActive(st, myIdx);
        }
        return null;
      }

      case 'pass': {
        if (!isTurn) return 'notYourTurn';
        if (!st.drawn) return 'drawFirst';
        st.drawn = null;
        addLog(st, 'log.drewPass', { name: nameOf(st, me) });
        st.currentPlayerIndex = nextActive(st, myIdx);
        return null;
      }

      case 'color': {
        const ph = st.phase;
        if (!ph || ph.k !== 'color' || ph.pid !== me) return 'noColorPick';
        if (!SIDES[st.side].colors.includes(move.color)) return 'needColor';
        st.topColor = move.color;
        st.phase = null;
        emit(st, { t: 'color', color: move.color, pid: me });
        addLog(st, 'log.color', { name: nameOf(st, me), color: move.color });
        const after = indexOf(st, ph.after);
        st.currentPlayerIndex = after >= 0 && !st.players[after].disconnected ? after : nextActive(st, myIdx);
        return null;
      }

      case 'accept': case 'challenge': {
        const ph = st.phase;
        if (!ph || ph.k !== 'challenge' || ph.target !== me) return 'noChallenge';
        st.phase = null;
        const tIdx = indexOf(st, me);
        const byName = nameOf(st, ph.by), tName = nameOf(st, me);
        const amount = ph.kind === 'wild2' ? 2 : 'color';
        if (move.t === 'accept') {
          const n = forceDraw(st, me, amount, ph.by, ph.kind);
          emit(st, { t: 'skip', pid: me });
          addLog(st, 'log.accept', { name: tName, n });
          st.currentPlayerIndex = nextActive(st, tIdx);
        } else if (ph.guilty) {
          // Caught: the player who bluffed takes the cards, the target keeps their turn
          const n = forceDraw(st, ph.by, amount, me, 'penalty');
          emit(st, { t: 'challengeResult', ok: true, by: ph.by, target: me, hand: ph.handAtPlay, prevColor: ph.prevColor });
          stat(st, me, 'challengesWon');
          stat(st, ph.by, 'bluffsCaught');
          addLog(st, 'log.challengeWon', { name: tName, by: byName, n });
          if (st.uno?.pid === ph.by) st.uno = null;
          st.currentPlayerIndex = tIdx;
        } else {
          // Fair play: the challenger takes the cards plus 2 more and loses the turn
          let n = forceDraw(st, me, amount, ph.by, ph.kind);
          n += forceDraw(st, me, 2, ph.by, 'penalty');
          emit(st, { t: 'challengeResult', ok: false, by: ph.by, target: me, hand: ph.handAtPlay, prevColor: ph.prevColor });
          emit(st, { t: 'skip', pid: me });
          stat(st, ph.by, 'challengesWon');
          addLog(st, 'log.challengeLost', { name: tName, by: byName, n });
          st.currentPlayerIndex = nextActive(st, tIdx);
        }
        return null;
      }

      case 'shout': {
        if (!st.uno || st.uno.pid !== me) return 'noUno';
        st.uno = null;
        emit(st, { t: 'uno', pid: me });
        stat(st, me, 'shouts');
        addLog(st, 'log.shout', { name: nameOf(st, me) });
        return null;
      }

      case 'catch': {
        const u = st.uno;
        if (!u || u.pid === me || myIdx < 0) return 'noUno';
        if ((st.hands[u.pid] || []).length !== 1) { st.uno = null; return null; }
        st.uno = null;
        forceDraw(st, u.pid, 2, me, 'caught');
        emit(st, { t: 'caught', pid: u.pid, by: me });
        stat(st, me, 'catches');
        addLog(st, 'log.caught', { name: nameOf(st, me), target: nameOf(st, u.pid) });
        return null;
      }

      // The default move for whoever is holding the game up (turn timer, a player who
      // left). move.seq must match, so two clients firing at once only count once.
      case 'timeout': {
        if (move.seq !== (st.seq - 1)) return 'stale';
        const ph = st.phase;
        if (ph?.k === 'challenge') return run(st, { t: 'accept' }, ph.target);
        if (ph?.k === 'color') return run(st, { t: 'color', color: bestColor(st.hands[ph.pid] || [], st.side) }, ph.pid);
        const cur = currentId(st);
        if (st.drawn) return run(st, { t: 'pass' }, cur);
        if (st.players[st.currentPlayerIndex].disconnected) {
          addLog(st, 'log.skipGone', { name: nameOf(st, cur) });
          st.currentPlayerIndex = nextActive(st, st.currentPlayerIndex);
          return null;
        }
        addLog(st, 'log.timeout', { name: nameOf(st, cur) });
        const e = run(st, { t: 'draw' }, cur);
        if (e) return e;
        if (st.drawn) return run(st, { t: 'pass' }, cur);
        return null;
      }

      // Everybody voted to stop: the player with the fewest cards wins the round
      case 'endVote': {
        const w = leader(st);
        if (!w) return 'nobody';
        endRound(st, w, 'vote');
        return null;
      }
      // Only one player still connected
      case 'lastPlayer': {
        const alive = st.players.filter(p => !p.disconnected);
        if (alive.length !== 1) return 'notLast';
        endRound(st, alive[0].id, 'lastPlayer');
        return null;
      }
    }
    return 'unknownMove';
  }

  // ---------- Someone joins / leaves in the middle of a round ----------
  // A late joiner gets 7 cards and sits last in the order
  function addPlayer(state, player) {
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    st.players = [...st.players, { ...player, cardCount: 0, disconnected: false }];
    const got = take(st, player.id, HAND_SIZE);
    emit(st, { t: 'draw', pid: player.id, n: got.length, why: 'join' });
    addLog(st, 'log.joined', { name: player.name });
    syncCounts(st);
    return st;
  }
  // A player who leaves: their cards go back under the deck and the turn moves on
  function removePlayer(state, pid) {
    const idx = indexOf(state, pid);
    if (idx < 0) return state;
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    const name = nameOf(st, pid);
    st.drawPile = [...st.drawPile, ...(st.hands[pid] || [])];
    delete st.hands[pid];
    if (st.stats) delete st.stats[pid];
    const wasCur = st.currentPlayerIndex === idx;
    const ph = st.phase;
    st.players = st.players.filter(p => p.id !== pid);
    addLog(st, 'log.left', { name });
    if (st.status !== 'playing') { syncCounts(st); return st; }
    const n = st.players.length;
    if (!n) { st.status = 'ended'; return st; }
    // keep pointing at the same "next" person
    let cur = st.currentPlayerIndex;
    if (idx < cur) cur--;
    else if (wasCur) cur = st.direction === 1 ? idx % n : (idx - 1 + n) % n;
    st.currentPlayerIndex = cur;
    if (st.players[cur]?.disconnected) st.currentPlayerIndex = nextActive(st, cur);
    // anything that was waiting on them is dropped
    if (ph && (ph.target === pid || ph.by === pid || ph.pid === pid)) {
      if (ph.k === 'color') {
        st.topColor = SIDES[st.side].colors[Math.floor(Math.random() * 4)];
        const a = indexOf(st, ph.after);
        if (a >= 0) st.currentPlayerIndex = a;
      }
      st.phase = null;
    }
    if (st.drawn?.pid === pid) st.drawn = null;
    if (st.uno?.pid === pid) st.uno = null;
    syncCounts(st);
    const alive = st.players.filter(p => !p.disconnected);
    if (alive.length === 1) endRound(st, alive[0].id, 'lastPlayer');
    return st;
  }

  // After a play: one card left means the player must shout (others may catch them)
  function setUno(st, pid, left) {
    if (left === 1) st.uno = { pid, at: st.seq };
    else if (st.uno?.pid === pid) st.uno = null;
  }

  // The colour you hold most of (on the side in play) — bots and timeouts use it
  function bestColor(hand, side) {
    const cols = SIDES[side].colors;
    const n = Object.fromEntries(cols.map(c => [c, 0]));
    for (const c of hand) { const f = face(c, side); if (n[f.c] != null) n[f.c] += NUMBERS.includes(f.v) ? 1 : 1.3; }
    return cols.reduce((a, b) => (n[b] > n[a] ? b : a), cols[Math.floor(Math.random() * 4)]);
  }

  // ============================================================
  // BOTS — choose a move for a bot (no peeking at hidden cards: a bot only uses its own
  // hand, card counts and the faces everyone can see — the other side of rivals' cards)
  // ============================================================
  // persona: attacker · flipper · saver · bluffer · balanced
  // level:   { challenge: how well it reads a bluff, fair: plays wild draws only when fair }
  function botMove(state, pid, persona = 'balanced', level = {}) {
    const st = state;
    const ph = st.phase;
    const hand = st.hands[pid] || [];
    const side = st.side;
    const rnd = level.rnd || Math.random;

    if (ph?.k === 'color' && ph.pid === pid) return { t: 'color', color: bestColor(hand, side) };
    if (ph?.k === 'challenge') {
      if (ph.target !== pid) return null;
      // Guess: the more cards the player had, the likelier they held the colour
      const byHand = (st.hands[ph.by] || []).length;
      let p = Math.min(0.85, 0.12 + byHand * 0.07);
      if (persona === 'bluffer') p += 0.15;
      if (persona === 'saver') p -= 0.1;
      const sharp = level.challenge ?? 0.5;               // 0 = coin flip, 1 = very good guesser
      const guess = rnd() < p;
      const read = rnd() < sharp * 0.55 ? ph.guilty : guess;  // good bots "read the table" more often
      return { t: read ? 'challenge' : 'accept' };
    }
    if (currentId(st) !== pid || st.status !== 'playing') return null;

    const legal = legalPlays(st, pid);
    if (!legal.length) return st.drawn ? { t: 'pass' } : { t: 'draw' };
    // easy bots sometimes just play any card they can
    if (level.random && rnd() < level.random) {
      const i = legal[Math.floor(rnd() * legal.length)];
      const f = face(hand[i], side);
      return f.c === WILD_COLOR ? { t: 'play', i, color: bestColor(hand.filter((_, k) => k !== i), side) } : { t: 'play', i };
    }

    const nxt = st.players[nextActive(st, indexOf(st, pid))];
    const threat = Math.min(...st.players.filter(p => p.id !== pid && !p.disconnected).map(p => p.cardCount));
    const nextIsClose = nxt && nxt.cardCount <= 2;
    const colorCount = c => hand.filter(h => face(h, side).c === c).length;

    const score = i => {
      const f = face(hand[i], side);
      let s = 0;
      const action = !NUMBERS.includes(f.v);
      if (NUMBERS.includes(f.v)) s += 10 + Number(f.v) * 0.3;            // shed high numbers first
      if (f.c !== WILD_COLOR) s += colorCount(f.c) * 1.5;                  // keep a colour you are long in
      if (['draw1', 'draw5', 'skip', 'skipAll', 'wild2', 'wildColor'].includes(f.v)) s += nextIsClose ? 14 : 6;
      if (f.v === 'skipAll') s += 4;
      if (f.v === 'reverse') s += 7;
      if (f.v === 'flip') {
        // Flipping turns the rivals' visible faces into their real hands. Night is harsher,
        // so a player who is behind likes to flip; one who is ahead is careful.
        s += threat <= 2 ? 12 : 5;
      }
      if (f.c === WILD_COLOR) {
        s -= 8;                                                             // keep wilds for later
        if (hand.length <= 2) s += 20;                                      // …unless it wins soon
      }
      // Wild draw cards are only fair with nothing of the colour in play
      if ((f.v === 'wild2' || f.v === 'wildColor') && hadColor(hand.filter((_, k) => k !== i), side, st.topColor)) {
        if (level.fair) s -= 100;
        else s -= persona === 'bluffer' ? -2 : 6;
      }
      if (persona === 'attacker' && action) s += 6;
      if (persona === 'flipper' && f.v === 'flip') s += 12;
      if (persona === 'saver' && f.c === WILD_COLOR) s -= 12;
      if (persona === 'bluffer' && (f.v === 'wild2' || f.v === 'wildColor')) s += 6;
      return s + rnd() * 3;
    };
    const pick = legal.reduce((a, b) => (score(b) > score(a) ? b : a), legal[0]);
    const f = face(hand[pick], side);
    const move = { t: 'play', i: pick };
    if (f.c === WILD_COLOR) move.color = bestColor(hand.filter((_, k) => k !== pick), side);
    return move;
  }

  const Engine = {
    SIDES, NUMBERS, POINTS, WILD_COLOR, HAND_SIZE, MATCH_TARGET, GAME_KEYS,
    createDeck, shuffle, newRound, apply, legalPlays, addPlayer, removePlayer, isPlayable, isWildValue,
    face, other, nextActive, cardPoints, bestColor, botMove, leader, hadColor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
