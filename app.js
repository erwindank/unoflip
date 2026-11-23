// ============================================================
// ¡VOLTEA! — online card game with a two-sided deck
//
// Same family as UNO Fiesta, UNO Mentiroso and VIRUS! (same Firebase project; rooms
// are tagged game:'voltea'). What is different here:
//   • every rule lives in engine.js — app.js only shows the game and sends moves
//   • every move is saved with ONE Firestore transaction (sendMove → mutateRoom)
//   • fx.js / extras.js read the events the engine writes (state.ev), not log text
//   • log lines are saved as {k, p} and turned into words when shown (ES/EN)
//
// SETUP (one-time) — already done for this Firebase project:
//   Firestore + Realtime Database + Anonymous sign-in enabled.
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDD88huoZNmnG8HKPb0aYYFUl5L_-tjVzQ",
  authDomain:        "unomentiroso-b5742.firebaseapp.com",
  projectId:         "unomentiroso-b5742",
  storageBucket:     "unomentiroso-b5742.firebasestorage.app",
  messagingSenderId: "771588309649",
  appId:             "1:771588309649:web:f2e1f4450a2975f1d7f530"
};

// ============================================================
// CONSTANTS
// ============================================================

const GAME_TAG    = 'voltea';   // all the card games share the 'rooms' collection
const MAX_PLAYERS = 10;
const { SIDES, NUMBERS, WILD_COLOR } = Engine;

// Card colours on screen (Day side, then Night side)
const CARD_HEX = {
  red: '#D92B2B', yellow: '#F2B90C', green: '#1F9D4C', blue: '#1E5BD8',
  magenta: '#E0249A', cyan: '#12B5C9', orange: '#F26B0F', violet: '#7B3FE4'
};
// Symbol printed on each kind of card
const SYMBOL = {
  draw1: '+1', draw5: '+5', reverse: '⇄', skip: '⊘', skipAll: '⊘⊘', flip: '◐',
  wild: '', wild2: '+2', wildColor: '+?'
};
// Shape per colour for the colour-blind option (menu → Pantalla)
const CB_GLYPH = {
  red: '▲', yellow: '●', green: '■', blue: '◆',
  magenta: '★', cyan: '✚', orange: '⬟', violet: '☾'
};

// Spotify sends people back to this page after they log in.
// (The address must also be listed in the Spotify app's settings.)
const SPOTIFY_CLIENT_ID    = '3b539ada3a4b43f48efdb4a790ced26c';
const SPOTIFY_REDIRECT_URI = location.origin + location.pathname;
const SPOTIFY_SCOPES       = 'user-read-currently-playing user-read-playback-state';

// ============================================================
// DRAWING CARDS
// ============================================================

const isNumber = v => NUMBERS.includes(v);
const symbolOf = v => isNumber(v) ? v : (SYMBOL[v] ?? '?');

// The four little squares on a wild, in the colours of the side it belongs to
function wildQuadHTML(side) {
  const c = SIDES[side].colors;
  return `<span class="wild-quad">${c.map(x => `<span class="wq" style="background:${CARD_HEX[x]}"></span>`).join('')}</span>`;
}

// One face of a card. face = {c, v}; side 'L' (Day) or 'D' (Night)
//   opts.cls    extra classes        opts.attrs  extra attributes
//   opts.chosen colour picked for a wild on the table (draws a coloured ring)
function faceHTML(face, side, opts = {}) {
  if (!face) return '';
  const wild = face.c === WILD_COLOR;
  const lbl = symbolOf(face.v);
  const center = wild
    ? `${wildQuadHTML(side)}${lbl ? `<span class="wild-extra-label">${lbl}</span>` : ''}`
    : face.v === 'flip' ? `<span class="card-label center flip-mark">${side === 'L' ? '☀' : '☾'}<i>◐</i></span>`
    : `<span class="card-label center">${lbl}</span>`;
  const chosen = opts.chosen ? ` chosen" style="--chosen:${CARD_HEX[opts.chosen]}` : '';
  return `<div class="card s-${side} c-${face.c}${opts.cls ? ' ' + opts.cls : ''}${chosen}" data-v="${face.v}"${opts.attrs || ''}>
    <span class="card-oval"></span>
    <span class="card-label tl">${lbl || '★'}</span>${center}<span class="card-label br">${lbl || '★'}</span>
    ${wild ? '' : `<span class="cb-glyph">${CB_GLYPH[face.c] || ''}</span>`}
  </div>`;
}
// A whole card shown on a given side
const cardHTML = (card, side, opts) => card ? faceHTML(card[side], side, opts) : '';
// Tiny face (rivals' cards show you their OTHER side)
function miniHTML(face, side) {
  const lbl = symbolOf(face.v);
  return `<span class="mini-face s-${side} c-${face.c}" data-v="${face.v}" title="${esc(faceName(face, side))}">${face.c === WILD_COLOR ? '✦' : lbl}</span>`;
}
// "Rojo 5", "Magenta Salta a todos", "Comodín +2"…
function faceName(face, side) {
  if (!face) return '?';
  if (face.c === WILD_COLOR) return t('card.' + face.v);
  return `${t('color.' + face.c)} ${isNumber(face.v) ? face.v : t('card.' + face.v)}`;
}
// Same as a coloured chip for the log and captions
function faceChip(face, side) {
  if (!face) return '?';
  const name = esc(faceName(face, side));
  if (face.c === WILD_COLOR) return `<span class="lc lc-wild">${name}</span>`;
  return `<span class="lc" style="--lc:${CARD_HEX[face.c]}">${name}</span>`;
}
const colorChip = c => c ? `<span class="lc" style="--lc:${CARD_HEX[c]}">${esc(t('color.' + c))}</span>` : '?';
const sideChip  = s => `<span class="lc-side lc-side-${s}">${s === 'L' ? '☀️ ' + esc(t('side.L')) : '🌙 ' + esc(t('side.D'))}</span>`;

// ============================================================
// FIREBASE INIT
// ============================================================

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();
const rtdb = firebase.database();

let localUid  = null;
let localName = null;
let currentRoomId = null;
let selectedEmoji = '';
let _emojiPicker  = null;
let roomUnsub     = null;
let roomState     = null;

// Presence state
let presenceRef    = null;
let rtdbRoomRef    = null;
const disconnectTimers = {};

// Re-establish RTDB presence when the tab becomes visible again (mobile bg/fg)
function refreshPresence() {
  if (presenceRef && localUid) {
    presenceRef.set({ name: localName, t: firebase.database.ServerValue.TIMESTAMP });
    presenceRef.onDisconnect().remove();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshPresence();
});
window.addEventListener('focus', refreshPresence);
// iOS/Android page lifecycle freeze/resume
window.addEventListener('resume', refreshPresence);

// Things only this screen needs (never saved)
let pendingPlayId = null;      // a wild waiting for its colour (card id)
let colorDialogFor = null;     // 'play' or 'phase'
let pickedColor = null;
let moveBusy = false;          // a move of mine is being saved

// Chat state
let chatOpen = false;
let chatUnreadCount = 0;
const seenMessageIds = new Set();

// Notification state
let notifEnabled = localStorage.getItem('notifEnabled') === 'true';
let prevNotifState = null;
let notifAudioCtx = null;

function ensureNotifAudioCtx() {
  if (notifAudioCtx) return;
  try { notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
}
document.addEventListener('click', ensureNotifAudioCtx, { once: true });

// Music state
const _savedMusicPref = localStorage.getItem('musicEnabled');
let musicEnabled = _savedMusicPref === null ? null : _savedMusicPref === 'true';
let musicMasterGain = null;
let musicPlaying = false;
let musicLoopTimer = null;

// ============================================================
// INIT — sign in anonymously, restore session
// ============================================================

async function init() {
  await handleSpotifyCallback();

  try {
    await auth.signInAnonymously();
    localUid = auth.currentUser.uid;
  } catch (e) {
    console.error('Auth failed:', e);
  }

  const savedRoom  = sessionStorage.getItem('roomId');
  const savedName  = sessionStorage.getItem('playerName');
  const savedEmoji = sessionStorage.getItem('playerEmoji');
  if (savedEmoji) {
    selectedEmoji = savedEmoji;
    const btn = document.getElementById('emoji-trigger-btn');
    if (btn) {
      btn.querySelector('.emoji-face').textContent = savedEmoji;
      btn.classList.add('has-emoji');
    }
  }
  if (savedRoom && savedName && localUid) {
    localName = savedName;
    await tryRejoin(savedRoom);
  }

  if (musicEnabled === true) {
    document.addEventListener('click', function startMusicOnInteraction() {
      ensureNotifAudioCtx();
      if (!musicPlaying) startMusic();
    }, { once: true });
  } else if (musicEnabled === null && !savedRoom) {
    setTimeout(showMusicPrompt, 700);
  }

  // Invite links (?sala=CODE) — extras.js
  if (typeof handleInviteParam === 'function') handleInviteParam();
}

// ============================================================
// HELPERS
// ============================================================

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stripLeadingEmoji(s) {
  return s.replace(/^\p{Emoji_Presentation}\s*/u, '').trim();
}


function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function showScreen(id) {
  if (id !== 'game') {
    if (chatOpen) {
      chatOpen = false;
      document.getElementById('chat-panel')?.classList.add('hidden');
    }
    leaveVoice();
    stopSpotifyPolling();
    stopLastfmPolling();
    stopListeningSpotifyTracks();
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  const gameCodeText = document.getElementById('game-room-code-text');
  if (gameCodeText) gameCodeText.textContent = currentRoomId || '';
  if (id === 'game') {
    listenSpotifyTracks();
    if (isSpotifyConnected()) startSpotifyPolling();
    if (isLastfmConnected()) startLastfmPolling();
    updateSpotifyButton();
    updateLastfmButton();
    const cbOk  = sessionStorage.getItem('spotify_callback_ok');
    const cbErr = sessionStorage.getItem('spotify_callback_error');
    if (cbOk) {
      sessionStorage.removeItem('spotify_callback_ok');
      setTimeout(openSpotifyModal, 400);
    } else if (cbErr) {
      sessionStorage.removeItem('spotify_callback_error');
      const msg = cbErr === 'access_denied'   ? t('sp.cancel')
                : cbErr === 'verifier_missing' ? t('sp.session')
                : cbErr === 'fetch_failed'     ? t('sp.fetch')
                :                               `Error de Spotify: ${cbErr}`;
      setTimeout(() => showSpotifyError(msg), 400);
    }
  }
}

function showLandingError(msg) {
  const el = document.getElementById('landing-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ============================================================
// EMOJI PICKER
// ============================================================

function toggleEmojiPicker(e) {
  e && e.stopPropagation();
  if (selectedEmoji) {
    clearEmoji();
    return;
  }
  const wrap = document.getElementById('emoji-picker-wrap');
  if (!wrap.classList.contains('hidden')) {
    wrap.classList.add('hidden');
    return;
  }
  if (!_emojiPicker) {
    EmojiMart.init({
      data: async () => {
        const r = await fetch('https://cdn.jsdelivr.net/npm/@emoji-mart/data');
        return r.json();
      }
    });
    _emojiPicker = new EmojiMart.Picker({
      theme: 'dark',
      locale: 'en',
      set: 'native',
      onEmojiSelect(emoji) {
        selectedEmoji = emoji.native;
        const btn = document.getElementById('emoji-trigger-btn');
        btn.querySelector('.emoji-face').textContent = emoji.native;
        btn.classList.add('has-emoji');
        sessionStorage.setItem('playerEmoji', selectedEmoji);
        document.getElementById('emoji-picker-wrap').classList.add('hidden');
      }
    });
    wrap.appendChild(_emojiPicker);
  }
  wrap.classList.remove('hidden');
}

function clearEmoji() {
  selectedEmoji = '';
  sessionStorage.removeItem('playerEmoji');
  const btn = document.getElementById('emoji-trigger-btn');
  btn.querySelector('.emoji-face').textContent = '🙂';
  btn.classList.remove('has-emoji');
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('emoji-picker-wrap');
  if (!wrap || wrap.classList.contains('hidden')) return;
  const btn = document.getElementById('emoji-trigger-btn');
  if (!wrap.contains(e.target) && !btn.contains(e.target)) {
    wrap.classList.add('hidden');
  }
});

// Who the game is waiting for right now (a challenge or colour pick comes first)
function whoActs(state) {
  if (!state || state.status !== 'playing') return null;
  const ph = state.phase;
  if (ph?.k === 'challenge') return ph.target;
  if (ph?.k === 'color') return ph.pid;
  return state.players[state.currentPlayerIndex]?.id || null;
}
function isMyTurn(state) {
  if (!state?.players?.length || state.status !== 'playing') return false;
  return !state.phase && state.players[state.currentPlayerIndex]?.id === localUid;
}
function nextPlayerIndex(state) {
  return Engine.nextActive(state, state.currentPlayerIndex);
}

// A log line saved by app.js itself (moves log through the engine)
function pushLog(log, k, p = {}) {
  return [...(log || []), { k, p }].slice(-24);
}

// ============================================================
// SAVING — every change to a room goes through here
//
// mutateRoom(fn): reads the room, fn(current) returns the fields to change (or null to
// do nothing), and the change is saved in one transaction — so two players acting at
// the same moment can never overwrite each other. In the guided game (LOCAL_GAME) the
// same thing happens on the in-memory room in tutorial.js.
// ============================================================

async function mutateRoom(fn) {
  if (typeof LOCAL_GAME !== 'undefined' && LOCAL_GAME) return localMutate(fn);
  if (!currentRoomId) return 'noRoom';
  const ref = db.collection('rooms').doc(currentRoomId);
  let result = null;
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) { result = 'noRoom'; return; }
      const patch = fn(snap.data());
      if (!patch || typeof patch === 'string') { result = patch || 'noChange'; return; }
      tx.update(ref, { ...patch, lastActivity: firebase.firestore.FieldValue.serverTimestamp() });
    });
  } catch (e) {
    console.warn('[save]', e);
    return 'network';
  }
  return result;
}

// The engine's game fields, ready to save (Firestore can't store `undefined`)
function gamePatch(st) {
  const out = {};
  for (const k of Engine.GAME_KEYS) out[k] = st[k] === undefined ? null : st[k];
  return out;
}

// Play a move through the rules engine. actor = who is moving (me, or a bot the
// host runs). Returns null when saved, or the engine's reason it wasn't allowed.
async function sendMove(move, actor = localUid) {
  let why = null;
  const res = await mutateRoom(cur => {
    const r = Engine.apply(cur, move, actor);
    if (r.error) { why = r.error; return null; }
    return gamePatch(r.state);
  });
  return why || (res === 'noChange' ? null : res);
}

// ============================================================
// LANDING
// ============================================================

function showJoin() {
  document.getElementById('join-form').classList.toggle('hidden');
}

// What a new room looks like
function newRoomDoc(name) {
  return {
    game: GAME_TAG,
    status: 'lobby',
    hostId: localUid,
    players: [{ id: localUid, name, cardCount: 0 }],
    hands: {},
    drawPile: [],
    discard: [],
    log: [],
    matchMode: 'round',     // 'round' = one round · 'match' = first to 500 points
    winner: null,
    winnerName: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastActivity: firebase.firestore.FieldValue.serverTimestamp()
  };
}

async function handleCreate() {
  const rawName = document.getElementById('player-name').value.trim();
  if (!rawName) { showLandingError(t('err.name')); return; }
  if (!localUid) { showLandingError(t('err.connecting')); return; }
  const name = selectedEmoji ? selectedEmoji + ' ' + rawName : rawName;
  localName = name;

  const roomId = genRoomCode();
  await db.collection('rooms').doc(roomId).set(newRoomDoc(name));

  currentRoomId = roomId;
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('playerName', name);
  sessionStorage.setItem('playerEmoji', selectedEmoji);
  subscribeToRoom(roomId);
  showScreen('lobby');
}

function getUniqueName(desiredName, players) {
  if (!players.some(p => p.name === desiredName)) return desiredName;
  let n = 2;
  while (players.some(p => p.name === desiredName + n)) n++;
  return desiredName + n;
}

// Rooms of the other games never open here
const isOurRoom = data => !!data && data.game === GAME_TAG;

async function handleJoin() {
  const rawName = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!rawName) { showLandingError(t('err.name')); return; }
  if (code.length !== 6) { showLandingError(t('err.code')); return; }
  if (!localUid) { showLandingError(t('err.connecting')); return; }
  const name = selectedEmoji ? selectedEmoji + ' ' + rawName : rawName;

  const snap = await db.collection('rooms').doc(code).get();
  if (!snap.exists || !isOurRoom(snap.data())) { showLandingError(t('err.notFound')); return; }
  const data = snap.data();
  if (data.status === 'ended' && !data.matchTarget) { showLandingError(t('err.ended')); return; }

  currentRoomId = code;
  let err = null;
  await mutateRoom(cur => {
    const players = cur.players || [];
    const mine = players.find(p => p.id === localUid);
    if (mine) { localName = mine.name; return null; }

    if (cur.status === 'lobby') {
      if (players.length >= MAX_PLAYERS) { err = t('err.full', { n: MAX_PLAYERS }); return null; }
      localName = getUniqueName(name, players);
      return { players: [...players, { id: localUid, name: localName, cardCount: 0 }] };
    }

    // In a game already: take back my seat (same name, maybe from another device)…
    const seat = players.find(p => p.name === name || p.name === rawName || stripLeadingEmoji(p.name) === rawName);
    if (seat) {
      localName = seat.name;
      const oldUid = seat.id;
      const patch = {
        players: players.map(p => p.id === oldUid ? { ...p, id: localUid, disconnected: false } : p),
        log: pushLog(cur.log, 'log.back', { name: seat.name })
      };
      if (oldUid !== localUid) {
        const hands = { ...(cur.hands || {}) };
        hands[localUid] = hands[oldUid] || [];
        delete hands[oldUid];
        patch.hands = hands;
        // the game may be waiting on me under my old id
        const swap = id => id === oldUid ? localUid : id;
        if (cur.phase) patch.phase = { ...cur.phase, target: swap(cur.phase.target), by: swap(cur.phase.by), pid: swap(cur.phase.pid) };
        if (cur.uno) patch.uno = { ...cur.uno, pid: swap(cur.uno.pid) };
        if (cur.drawn) patch.drawn = { ...cur.drawn, pid: swap(cur.drawn.pid) };
        if (cur.points?.[oldUid] != null) { patch.points = { ...cur.points, [localUid]: cur.points[oldUid] }; delete patch.points[oldUid]; }
      }
      return patch;
    }
    // …or sit down as a new player with 7 cards
    if (cur.status !== 'playing') { err = t('err.started'); return null; }
    if (players.length >= MAX_PLAYERS) { err = t('err.full', { n: MAX_PLAYERS }); return null; }
    localName = getUniqueName(name, players);
    return gamePatch(Engine.addPlayer(cur, { id: localUid, name: localName }));
  });
  if (err) { currentRoomId = null; showLandingError(err); return; }

  sessionStorage.setItem('roomId', code);
  sessionStorage.setItem('playerName', localName);
  sessionStorage.setItem('playerEmoji', selectedEmoji);
  subscribeToRoom(code);
  showScreen(data.status === 'lobby' ? 'lobby' : data.status === 'ended' ? 'winner' : 'game');
}

async function tryRejoin(roomId) {
  try {
    const snap = await db.collection('rooms').doc(roomId).get();
    // (sessionStorage is shared with the other games on the same site)
    if (!snap.exists || !isOurRoom(snap.data())) { sessionStorage.clear(); return; }
    const data = snap.data();
    const player = data.players.find(p => p.id === localUid);
    if (!player) { sessionStorage.clear(); return; }

    currentRoomId = roomId;
    if (player.disconnected) {
      await mutateRoom(cur => ({
        players: cur.players.map(p => p.id === localUid ? { ...p, disconnected: false } : p),
        log: pushLog(cur.log, 'log.back', { name: player.name })
      }));
    }
    subscribeToRoom(roomId);
    if (data.status === 'lobby') showScreen('lobby');
    else if (data.status === 'playing') showScreen('game');
    else if (data.status === 'ended') showScreen('winner');
  } catch (_) { sessionStorage.clear(); }
}

function copyCode() {
  navigator.clipboard.writeText(currentRoomId).catch(() => {});
  const btn = document.querySelector('.btn-copy');
  btn.textContent = t('ui.copied');
  setTimeout(() => { btn.textContent = t('ui.copy'); }, 1500);
}

function copyGameCode(el) {
  navigator.clipboard.writeText(currentRoomId).catch(() => {});
  const textEl = el.querySelector('#game-room-code-text');
  const original = textEl.textContent;
  textEl.textContent = t('ui.copied');
  el.querySelector('svg').style.display = 'none';
  setTimeout(() => {
    textEl.textContent = original;
    el.querySelector('svg').style.display = '';
  }, 1500);
}

// ============================================================
// PRESENCE — disconnect detection via RTDB + beforeunload
// ============================================================

function setupPresence(roomId) {
  teardownPresence();

  presenceRef  = rtdb.ref(`presence/${roomId}/${localUid}`);
  rtdbRoomRef  = rtdb.ref(`presence/${roomId}`);

  presenceRef.set({ name: localName, t: firebase.database.ServerValue.TIMESTAMP });
  presenceRef.onDisconnect().remove();

  rtdbRoomRef.on('value', snap => {
    if (!roomState || !currentRoomId) return;
    const present = snap.val() || {};

    for (const player of roomState.players) {
      if (player.id === localUid) continue;
      if (isBot(player.id)) continue; // bots have no RTDB presence — never treat as disconnected

      if (!present[player.id]) {
        // Y5: remember since when they're gone, so their seat can say "Reconectando…"
        if (!presenceMissingSince[player.id]) presenceMissingSince[player.id] = Date.now();
        if (!disconnectTimers[player.id]) {
          const pid  = player.id;
          const pname = player.name;
          disconnectTimers[pid] = setTimeout(async () => {
            delete disconnectTimers[pid];
            if (roomState?.players.find(p => p.id === pid)) {
              await markPlayerDisconnected(pid, pname);
            }
          }, 180000);
        }
      } else {
        delete presenceMissingSince[player.id];
        if (disconnectTimers[player.id]) {
          clearTimeout(disconnectTimers[player.id]);
          delete disconnectTimers[player.id];
        }
      }
    }
    if (roomState?.status === 'playing') renderOpponents(roomState);
  });
}

// Y5 — reconnect grace time. pid -> when their presence disappeared (my clock).
// On their own turn they get RECONNECT_TURN_GRACE before being marked disconnected
// (which skips them); otherwise the 3-minute timer above.
const presenceMissingSince = {};
const RECONNECT_TURN_GRACE = 30000;
function checkReconnectGrace(state) {
  const cur = state.players[state.currentPlayerIndex];
  if (!cur || isBot(cur.id) || cur.disconnected || cur.id === localUid) return;
  const since = presenceMissingSince[cur.id];
  if (since && Date.now() - since > RECONNECT_TURN_GRACE) markPlayerDisconnected(cur.id, cur.name);
}

function teardownPresence() {
  if (presenceRef) {
    presenceRef.onDisconnect().cancel();
    presenceRef.remove();
    presenceRef = null;
  }
  if (rtdbRoomRef) {
    rtdbRoomRef.off();
    rtdbRoomRef = null;
  }
  Object.keys(disconnectTimers).forEach(uid => {
    clearTimeout(disconnectTimers[uid]);
    delete disconnectTimers[uid];
  });
  Object.keys(presenceMissingSince).forEach(uid => delete presenceMissingSince[uid]);
  if (voiceActivityRef) { voiceActivityRef.off(); voiceActivityRef = null; }
  voiceActivityLoaded = false;
}

function setupVoiceActivityListener(roomId) {
  if (voiceActivityRef) { voiceActivityRef.off(); voiceActivityRef = null; }
  voiceActivityLoaded = false;
  const ref = rtdb.ref(`voice/${roomId}/active`);
  voiceActivityRef = ref;
  ref.on('child_added', snap => {
    if (!voiceActivityLoaded) return;
    const uid = snap.key;
    if (uid === localUid) return;
    const player = roomState?.players?.find(p => p.id === uid);
    const name = player?.name || t('ui.someone');
    notify('🎤 ' + t('vc.title'), t('vc.opened', { name }) + '.');
    showVoiceJoinToast('🎤 ' + t('vc.opened', { name }));
  });
  ref.on('child_removed', snap => {
    const uid = snap.key;
    if (uid === localUid) return;
    const player = roomState?.players?.find(p => p.id === uid);
    const name = player?.name || t('ui.someone');
    showVoiceJoinToast('📵 ' + t('vc.left', { name }));
  });
  ref.on('child_changed', snap => {
    const uid = snap.key;
    if (uid === localUid) return;
    const player = roomState?.players?.find(p => p.id === uid);
    const name = player?.name || t('ui.someone');
    if (snap.val()?.muted) {
      showVoiceJoinToast('🔇 ' + t('vc.muted', { name }));
    } else {
      showVoiceJoinToast('🎤 ' + t('vc.unmuted', { name }));
    }
  });
  ref.once('value', () => { voiceActivityLoaded = true; });
}

function removeDisconnectedFromLobby(state) {
  const newPlayers = state.players.filter(p => !p.disconnected);
  if (newPlayers.length === 0) {
    db.collection('rooms').doc(currentRoomId).delete().catch(() => {});
    return;
  }
  const removedIds = state.players.filter(p => p.disconnected).map(p => p.id);
  const update = {
    players: newPlayers,
    lastActivity: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (removedIds.includes(state.hostId)) update.hostId = newPlayers[0].id;
  db.collection('rooms').doc(currentRoomId).update(update).catch(() => {});
}

async function markPlayerDisconnected(uid, name) {
  if (!currentRoomId) return;
  await mutateRoom(cur => {
    const player = cur.players.find(p => p.id === uid);
    if (!player || player.disconnected) return null;   // gone already, or marked
    return {
      players: cur.players.map(p => p.id === uid ? { ...p, disconnected: true } : p),
      log: pushLog(cur.log, 'log.gone', { name })
    };
  });
}

// ============================================================
// ROOM SUBSCRIPTION
// ============================================================

function subscribeToRoom(roomId) {
  if (roomUnsub) roomUnsub();
  prevNotifState = null;
  fxPrevState = null;
  roomUnsub = db.collection('rooms').doc(roomId).onSnapshot(snap => {
    if (!snap.exists) return;
    roomState = snap.data();
    onRoomUpdate(roomState);
  });
  setupPresence(roomId);
  setupVoiceActivityListener(roomId);
}

// The connected person who looks after the table (moves the game on when someone is
// gone, ends it by vote…): the host, or the first connected human if the host is away
function isCaretaker(state) {
  const humans = state.players.filter(p => !p.disconnected && !isBot(p.id));
  const host = humans.find(p => p.id === state.hostId);
  return (host || humans[0])?.id === localUid;
}

function onRoomUpdate(state) {
  checkNotifications(state);
  document.body.classList.toggle('side-D', state.status !== 'lobby' && state.side === 'D');
  document.body.classList.toggle('side-L', !(state.status !== 'lobby' && state.side === 'D'));
  if (state.status === 'lobby') {
    if (state.players.some(p => p.disconnected)) removeDisconnectedFromLobby(state);
    showScreen('lobby');
    renderLobby(state);
  } else if (state.status === 'playing') {
    const connected = state.players.filter(p => !p.disconnected);
    const voters = connected.filter(p => !isBot(p.id));   // bots never vote
    const votes = state.endVotes || [];
    if (isCaretaker(state)) {
      if (voters.length > 0 && voters.every(p => votes.includes(p.id))) {
        sendMove({ t: 'endVote' }, 'system');
      } else if (connected.length === 0) {
        db.collection('rooms').doc(currentRoomId).delete().catch(() => {});
        return;
      } else if (connected.length === 1) {
        sendMove({ t: 'lastPlayer' }, 'system');
      } else {
        // whoever the game waits for is gone: their default move (draw/pass, accept…)
        const waiting = state.players.find(p => p.id === whoActs(state));
        if (waiting?.disconnected) sendMove({ t: 'timeout', seq: state.seq }, 'system');
      }
    }
    showScreen('game');
    renderGame(state);
    scheduleBotTick(state);
  } else if (state.status === 'ended') {
    // R6: when the round ends while I'm watching, let the last card land on the table
    // first, then show the winner screen
    const onGame = document.getElementById('screen-game').classList.contains('active');
    if (onGame && fxPrevState?.status === 'playing') {
      renderGame(state);
      winnerHoldUntil = Date.now() + 2600;
    }
    if (Date.now() < winnerHoldUntil) {
      clearTimeout(winnerHoldTimer);
      winnerHoldTimer = setTimeout(() => {
        if (roomState?.status === 'ended') { showScreen('winner'); renderWinner(roomState); }
      }, winnerHoldUntil - Date.now());
      return;
    }
    showScreen('winner');
    renderWinner(state);
  }
}
let winnerHoldUntil = 0, winnerHoldTimer = null;

// ============================================================
// LOBBY
// ============================================================

function renderLobby(state) {
  document.getElementById('lobby-code').textContent = currentRoomId;

  const prevNames  = state.prevPlayerNames || [];
  const readyVotes = state.readyVotes || [];
  const isRematch  = prevNames.length > 0;
  const isHost = state.hostId === localUid;

  document.getElementById('player-list').innerHTML = state.players.map(p => {
    const isReady   = readyVotes.includes(p.id);
    const wasHere   = isRematch && prevNames.includes(p.name);
    const removeBtn = isHost && isBot(p.id)
      ? `<button class="btn-remove-bot" onclick="handleRemoveBot('${p.id}')" title="${t('lob.removeBot')}">✕</button>`
      : '';
    return `<div class="player-item ${p.id === localUid ? 'me' : ''} ${p.disconnected ? 'player-disconnected' : ''} ${isBot(p.id) ? 'is-bot' : ''}">
      ${p.id === state.hostId ? '👑 ' : ''}${esc(p.name)}
      ${wasHere ? `<span class="prev-badge">${t('lob.back')}</span>` : ''}
      ${isReady  ? `<span class="ready-badge">${t('lob.readyBadge')}</span>` : ''}
      ${p.disconnected ? ` <span class="dc-badge">${t('lob.dc')}</span>` : ''}
      ${removeBtn}
    </div>`;
  }).join('');

  // Ready-up button (only shown in rematch lobbies)
  let readyArea = document.getElementById('lobby-ready-area');
  if (!readyArea) {
    readyArea = document.createElement('div');
    readyArea.id = 'lobby-ready-area';
    document.querySelector('.lobby-actions').prepend(readyArea);
  }
  if (isRematch) {
    readyArea.innerHTML = readyVotes.includes(localUid)
      ? `<p class="muted ready-confirmed">${t('lob.ready')}</p>`
      : `<button class="btn btn-primary" onclick="handleReadyVote()">${t('lob.again')}</button>`;
  } else {
    readyArea.innerHTML = '';
  }

  const canStart = state.players.length >= 2;
  const startBtn = document.getElementById('start-btn');
  startBtn.classList.toggle('hidden', !isHost);
  document.getElementById('waiting-msg').classList.toggle('hidden', isHost);

  // Bot button (host only)
  let botArea = document.getElementById('lobby-bot-area');
  if (!botArea) {
    botArea = document.createElement('div');
    botArea.id = 'lobby-bot-area';
    document.querySelector('.lobby-actions').appendChild(botArea);
  }
  botArea.innerHTML = isHost && state.players.length < MAX_PLAYERS
    ? `<button class="btn btn-sm btn-add-bot" onclick="handleAddBot()">${t('lob.addBot')}</button>`
    : '';

  if (isHost) {
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? t('lob.start') : t('lob.waitingPlayers');
  }

  // Invite link, match length, turn timer, bot level (extras.js)
  if (typeof renderLobbyExtras === 'function') renderLobbyExtras(state, isHost);
}

// ============================================================
// START — the host deals a new round
// ============================================================

async function handleStart() {
  if (!roomState || roomState.players.length < 2 || roomState.hostId !== localUid) return;
  await mutateRoom(cur => {
    if (cur.status === 'playing' || cur.players.length < 2) return null;
    const gameNo = (cur.gameNo || 0) + 1;
    const st = Engine.newRound(cur.players.map(p => ({ ...p, disconnected: false })), {
      matchTarget: cur.matchMode === 'match' ? Engine.MATCH_TARGET : 0,
      first: gameNo - 1
    });
    return { ...gamePatch(st), endVotes: [], readyVotes: [], gameNo, seriesDone: false };
  });
}

// Next round of a match to 500 (points carry on)
async function handleNextRound() {
  if (!roomState || roomState.hostId !== localUid) return;
  await mutateRoom(cur => {
    if (cur.status !== 'ended' || !cur.matchTarget || cur.matchWinner) return null;
    const players = cur.players.filter(p => !p.disconnected);
    if (players.length < 2) return null;
    const st = Engine.newRound(players, {
      matchTarget: cur.matchTarget, points: cur.points, roundNo: cur.roundNo, first: cur.roundNo || 0
    });
    return { ...gamePatch(st), endVotes: [] };
  });
}

// ============================================================
// GAME SCREEN
// ============================================================

// The state drawn last time; fx.js compares it with the new one to animate what changed
let fxPrevState = null;

function renderGame(state) {
  const firstDraw = !fxPrevState;   // first draw after (re)joining: show, don't animate
  // A wild whose colour I was picking can't be played any more
  if (colorDialogFor === 'play' && !isMyTurn(state)) closeColorDialog();
  renderTopCard(state);
  renderDrawPile(state);
  renderOpponents(state);
  renderStatus(state);
  renderHand(state);
  renderLog(state);
  renderLastCardOverlay(state);
  renderTurnActions(state);
  renderEndVoteStatus(state);
  renderChallengePanel(state);
  renderColorPhase(state);
  renderChatPanel(state);
  renderSpeechBubbles(state);

  // Flying cards, the big flip, stamps, sounds for whatever changed (fx.js)
  if (fxPrevState && fxPrevState !== state) FX.onState(fxPrevState, state);
  fxPrevState = state;
  // Faces, turn banner, timer, 2-card alert, hand badges… (extras.js)
  if (typeof afterGameRender === 'function') afterGameRender(state, firstDraw);
}

// The table card: the face on top, with a ring in the colour picked for a wild
function renderTopCard(state) {
  const el = document.getElementById('top-card');
  const top = state.discard?.[state.discard.length - 1];
  if (!top) { el.innerHTML = ''; return; }
  const f = top[state.side];
  const chosen = f.c === WILD_COLOR ? state.topColor : null;
  el.innerHTML = faceHTML(f, state.side, { cls: 'top', chosen: chosen && chosen !== WILD_COLOR ? chosen : null });
  el.dataset.color = state.topColor || '';
}

// The draw pile shows the OTHER side of its top card — everyone can see it
function renderDrawPile(state) {
  const area = document.getElementById('draw-pile-area');
  const top = state.drawPile?.[0];
  const other = Engine.other(state.side);
  const slot = document.getElementById('draw-pile-card');
  slot.innerHTML = top ? faceHTML(top[other], other, { cls: 'pile-face' }) : `<div class="card empty-pile"></div>`;
  document.getElementById('draw-count').textContent = state.drawPile?.length || 0;
  const canDraw = isMyTurn(state) && !state.drawn && !moveBusy;
  const hand = state.hands?.[localUid] || [];
  const hasPlayable = hand.some(c => Engine.isPlayable(c, state));
  area.classList.toggle('can-draw', canDraw);
  area.classList.toggle('must-draw', canDraw && !hasPlayable);
  area.style.opacity = canDraw || !isMyTurn(state) ? '1' : '.55';
}

function renderOpponents(state) {
  const row = document.getElementById('opponents-row');
  const others = state.players.filter(p => p.id !== localUid);
  const acting = whoActs(state);
  const nextId = state.players[nextPlayerIndex(state)]?.id;
  const other = Engine.other(state.side);
  row.innerHTML = others.map(p => {
    const isCurrent = acting === p.id;
    const isDisconnected = !!p.disconnected;
    const isSpeaking = !!speakingStates[p.id];
    const hasVoice = !!peerConns[p.id];
    // You can see the other side of everyone else's cards
    const hand = state.hands?.[p.id] || [];
    const shown = hand.slice(0, 14).map(c => miniHTML(c[other], other)).join('');
    const more = hand.length > 14 ? `<span class="mini-more">+${hand.length - 14}</span>` : '';
    const nearWin = p.cardCount > 0 && p.cardCount <= 2;
    const reconnecting = !isDisconnected && !isBot(p.id) && presenceMissingSince[p.id];
    const pts = state.matchTarget ? `<span class="opp-points">${state.points?.[p.id] || 0} pts</span>` : '';
    return `<div class="opponent ${isCurrent ? 'active-player' : ''} ${p.id === nextId && !isCurrent ? 'next-player' : ''} ${nearWin ? 'near-win' : ''}
                                ${isDisconnected ? 'player-disconnected' : ''} ${isSpeaking ? 'voice-speaking' : ''}"
               data-uid="${esc(p.id)}">
      ${typeof seatFaceHTML === 'function' ? seatFaceHTML(state, p) : ''}
      <div class="opponent-name">${esc(p.name)}${isDisconnected ? ` <span class="dc-badge">${t('lob.dc')}</span>` : ''}${hasVoice ? ' <span class="voice-mic-icon">🎤</span>' : ''}</div>
      ${reconnecting ? `<span class="rc-badge" data-since="${presenceMissingSince[p.id]}" data-turn="${isCurrent ? 1 : 0}">${t('rc.label')}</span>` : ''}
      <div class="opponent-cards" title="${esc(t('opp.otherSide'))}">${shown}${more}</div>
      <div class="opponent-count">${p.cardCount}🃏${pts}</div>
    </div>`;
  }).join('');
}

function renderStatus(state) {
  const el = document.getElementById('game-status');
  const acting = whoActs(state);
  const mine = acting === localUid;
  el.classList.toggle('my-turn', mine);
  el.classList.toggle('other-turn', !mine);
  const name = state.players.find(p => p.id === acting)?.name || '?';
  const ph = state.phase;
  if (ph?.k === 'challenge') el.textContent = mine ? t('st.youDecide') : t('st.decides', { name });
  else if (ph?.k === 'color') el.textContent = mine ? t('st.youColor') : t('st.picksColor', { name });
  else el.textContent = mine ? t('st.yourTurn') : t('st.turnOf', { name });

  const dirEl = document.getElementById('direction-indicator');
  if (dirEl) dirEl.innerHTML = `<span class="dir-arrow">${state.direction === 1 ? '↻' : '↺'}</span>`;
  // Which side is up (and the colour to match)
  const sideEl = document.getElementById('side-indicator');
  if (sideEl) {
    sideEl.innerHTML = `${state.side === 'L' ? '☀️' : '🌙'} <b>${esc(t('side.' + state.side))}</b>` +
      (state.topColor && state.topColor !== WILD_COLOR ? ` · ${colorChip(state.topColor)}` : '');
  }
}

function renderHand(state) {
  const handEl = document.getElementById('player-hand');
  const myHand = state.hands?.[localUid] || [];
  const myTurn = isMyTurn(state);
  const legal = new Set(Engine.legalPlays(state, localUid));
  handEl.innerHTML = myHand.map((card, i) => {
    const fresh = state.drawn?.pid === localUid && state.drawn.id === card.id;
    const cls = [myTurn ? 'playable' : '', fresh ? 'drawn-fresh' : '', myTurn && !legal.has(i) ? 'cant' : ''].filter(Boolean).join(' ');
    return faceHTML(card[state.side], state.side, { cls, attrs: ` data-index="${i}" data-id="${card.id}" onclick="selectCard(${card.id})"` });
  }).join('');

  const label = document.getElementById('hand-label');
  if (state.drawn?.pid === localUid) label.textContent = t('hand.drawnOk');
  else label.textContent = myTurn ? t('hand.pick') : t('hand.count', { n: myHand.length });

  handEl.closest('.hand-area').classList.toggle('my-turn', myTurn);
  renderTurnOrder(state, myTurn);
}

// "← previous · current · next →" line above the hand
function renderTurnOrder(state, myTurn) {
  const toiEl = document.getElementById('turn-order-info');
  const n = state?.players?.length || 0;
  if (n < 2) { toiEl.classList.add('hidden'); return; }
  const curIdx = state.currentPlayerIndex;
  const dir = state.direction ?? 1;
  const prevIdx = Engine.nextActive(state, curIdx, -dir);
  const nextIdx = Engine.nextActive(state, curIdx, dir);
  const prevName = esc(state.players[prevIdx]?.name || '—');
  const nextName = esc(state.players[nextIdx]?.name || '—');
  const curName  = esc(state.players[curIdx]?.name  || '—');
  const center = myTurn
    ? `<span class="toi-label toi-you">${t('toi.you')}</span>`
    : `<span class="toi-current">${curName}</span>`;
  toiEl.innerHTML =
    `<span class="toi-item"><span class="toi-arrow">←</span><span class="toi-label toi-prev-label">${t('toi.prev')}</span><span class="toi-name toi-prev-name">${prevName}</span></span>` +
    center +
    `<span class="toi-item"><span class="toi-name toi-next-name">${nextName}</span><span class="toi-label toi-next-label">${t('toi.next')}</span><span class="toi-arrow">→</span></span>`;
  toiEl.classList.remove('hidden');
}

function renderTurnActions(state) {
  const passBtn = document.getElementById('pass-btn');
  const canPass = isMyTurn(state) && state.drawn?.pid === localUid;
  passBtn.classList.toggle('hidden', !canPass);
}

// Log lines are {k, p}: the words come from i18n, names are escaped, cards coloured
function logText(e) {
  if (typeof e === 'string') return esc(e);   // (never written by this game, but safe)
  const p = e.p || {};
  const out = {};
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'string' ? esc(v) : v;
  if (p.v) out.card = faceChip({ c: p.c, v: p.v }, p.side);
  if (p.color) out.color = colorChip(p.color);
  if (p.side) out.side = sideChip(p.side);
  if (p.v) out.what = esc(t('card.' + p.v));
  return t(e.k, out);
}
const LOG_CLASS = {
  'log.caught': 'log-uno', 'log.shout': 'log-uno-call', 'log.challengeWon': 'log-truth',
  'log.challengeLost': 'log-lie', 'log.flip': 'log-flip', 'log.win': 'log-uno-call'
};
function renderLog(state) {
  const el = document.getElementById('game-log');
  el.innerHTML = [...(state.log || [])].reverse()
    .map(e => `<div class="log-entry ${LOG_CLASS[e?.k] || ''}">${logText(e)}</div>`).join('');
  el.scrollTop = 0;
}

// ============================================================
// PLAYING A CARD
// ============================================================

async function selectCard(cardId) {
  const state = roomState;
  if (!state || moveBusy) return;
  FX.noteHand();   // where my cards are, so the played one flies from its real spot
  const hand = state.hands?.[localUid] || [];
  const i = hand.findIndex(c => c.id === cardId);
  const card = hand[i];
  if (!card) return;
  // Guided first game: only the card the lesson asks for (tutorial.js)
  if (LOCAL_GAME && !tutorialAllowsCard(card)) return;
  if (!isMyTurn(state)) {
    if (state.phase && whoActs(state) === localUid) return;   // the panel is asking something
    FX.shake(document.querySelector(`#player-hand .card[data-id="${cardId}"]`));
    return;
  }
  if (!Engine.legalPlays(state, localUid).includes(i)) {
    if (state.drawn?.pid === localUid) showNotice('✋', t('notice.onlyDrawnTitle'), t('notice.onlyDrawnBody'));
    else showNotice('✋', t('notice.cantTitle'), t('notice.cantBody', { color: colorChip(state.topColor) }));
    return;
  }
  const f = card[state.side];
  if (f.c === WILD_COLOR) { openColorDialog('play', card); return; }
  await doMove({ t: 'play', id: card.id });
}

// Send my move; while it is saving the hand can't be clicked twice
async function doMove(move) {
  if (moveBusy) return;
  moveBusy = true;
  try {
    const err = await sendMove(move);
    if (err && err !== 'noChange') console.info('[move]', move.t, err);
    return err;
  } finally {
    moveBusy = false;
    if (roomState?.status === 'playing') renderDrawPile(roomState);
  }
}

// ---- Colour picker: for a wild I play, or after a Volteo turns up a wild face ----
function openColorDialog(kind, card) {
  const state = roomState;
  colorDialogFor = kind;
  pendingPlayId = card ? card.id : null;
  const side = state.side;
  const hand = (state.hands?.[localUid] || []).filter(c => !card || c.id !== card.id);
  pickedColor = Engine.bestColor(hand, side);
  const title = document.getElementById('claim-dialog-title');
  const preview = document.getElementById('actual-card-preview');
  const warn = document.getElementById('claim-warning');
  if (kind === 'play') {
    const f = card[side];
    title.textContent = f.v === 'wild' ? t('claim.wildTitle') : t('claim.drawTitle', { card: faceName(f, side) });
    preview.innerHTML = faceHTML(f, side, { cls: 'preview' });
    // A wild draw card is only fair with nothing of the colour in play — say so
    const unfair = (f.v === 'wild2' || f.v === 'wildColor') && Engine.hadColor(hand, side, state.topColor);
    warn.innerHTML = unfair ? t('claim.unfair', { color: colorChip(state.topColor) }) : '';
    warn.classList.toggle('hidden', !unfair);
    document.getElementById('claim-cancel').classList.remove('hidden');
  } else {
    title.textContent = t('claim.phaseTitle');
    const top = state.discard[state.discard.length - 1];
    preview.innerHTML = cardHTML(top, side, { cls: 'preview' });
    warn.classList.add('hidden');
    document.getElementById('claim-cancel').classList.add('hidden');   // must pick one
  }
  renderClaimPicker();
  document.getElementById('claim-dialog').classList.remove('hidden');
}
function renderClaimPicker() {
  const side = roomState?.side || 'L';
  document.getElementById('claim-color-picker').innerHTML = SIDES[side].colors.map(c =>
    `<button class="color-btn ${pickedColor === c ? 'selected' : ''}" style="--btn:${CARD_HEX[c]}"
      onclick="setClaimColor('${c}')" title="${esc(t('color.' + c))}" aria-label="${esc(t('color.' + c))}"><span>${CB_GLYPH[c]}</span></button>`
  ).join('');
}
function setClaimColor(color) { pickedColor = color; renderClaimPicker(); FX.play('select'); }
function closeColorDialog() {
  colorDialogFor = null; pendingPlayId = null;
  document.getElementById('claim-dialog').classList.add('hidden');
}
function cancelPlay() { if (colorDialogFor === 'play') closeColorDialog(); }
async function confirmPlay() {
  if (!pickedColor) return;
  const kind = colorDialogFor, id = pendingPlayId;
  const color = LOCAL_GAME && typeof tutorialColor === 'function' ? tutorialColor(pickedColor) : pickedColor;
  closeColorDialog();
  if (kind === 'play') await doMove({ t: 'play', id, color });
  else if (kind === 'phase') await doMove({ t: 'color', color });
}
// After a Volteo lands on a wild face, the one who flipped picks the colour
function renderColorPhase(state) {
  const ph = state.phase;
  if (ph?.k === 'color' && ph.pid === localUid) {
    if (colorDialogFor !== 'phase') openColorDialog('phase', null);
  } else if (colorDialogFor === 'phase') closeColorDialog();
}

// ============================================================
// DRAWING
// ============================================================

function showDrawConfirm(accent, icon, title, message, okLabel, cancelLabel, thirdLabel) {
  return new Promise(resolve => {
    const card   = document.getElementById('draw-confirm-card');
    card.className = `draw-confirm-card accent-${accent}`;
    document.getElementById('draw-confirm-icon').textContent  = icon;
    document.getElementById('draw-confirm-title').textContent = title;
    document.getElementById('draw-confirm-msg').innerHTML     = message;
    const modal    = document.getElementById('draw-confirm-modal');
    const okBtn    = document.getElementById('draw-confirm-ok');
    const canBtn   = document.getElementById('draw-confirm-cancel');
    const thirdBtn = document.getElementById('draw-confirm-third');
    okBtn.textContent  = okLabel     || t('draw.ok');
    canBtn.textContent = cancelLabel || t('ui.cancel');
    if (thirdLabel) {
      thirdBtn.textContent = thirdLabel;
      thirdBtn.classList.remove('hidden');
    } else {
      thirdBtn.classList.add('hidden');
    }
    modal.classList.remove('hidden');
    function done(result) {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      canBtn.removeEventListener('click', onCancel);
      thirdBtn.removeEventListener('click', onThird);
      resolve(result);
    }
    function onOk()     { done(true);    }
    function onCancel() { done(false);   }
    function onThird()  { done('third'); }
    okBtn.addEventListener('click', onOk);
    canBtn.addEventListener('click', onCancel);
    thirdBtn.addEventListener('click', onThird);
  });
}

async function handleDraw() {
  const state = roomState;
  if (!isMyTurn(state) || state.drawn || moveBusy) return;
  if (LOCAL_GAME && typeof tutorialAllowsDraw === 'function' && !tutorialAllowsDraw()) return;
  const hand = state.hands?.[localUid] || [];
  if (hand.some(c => Engine.isPlayable(c, state)) && !LOCAL_GAME) {
    const ok = await showDrawConfirm('white', '✋', t('draw.haveTitle'), t('draw.haveBody'));
    if (!ok) return;
  }
  await doMove({ t: 'draw' });
}

async function handlePassTurn() {
  if (!isMyTurn(roomState) || roomState.drawn?.pid !== localUid) return;
  await doMove({ t: 'pass' });
}

// ============================================================
// WILD +2 / WILD DRAW COLOUR — accept or challenge
// ============================================================

function renderChallengePanel(state) {
  const el = document.getElementById('challenge-area');
  const ph = state.phase;
  if (ph?.k !== 'challenge') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const content = document.getElementById('challenge-content');
  const byName = state.players.find(p => p.id === ph.by)?.name || '?';
  const tName = state.players.find(p => p.id === ph.target)?.name || '?';
  const what = t('card.' + ph.kind);
  const amount = ph.kind === 'wild2' ? t('ch.take2') : t('ch.takeColor', { color: colorChip(state.topColor) });
  if (ph.target !== localUid) {
    content.innerHTML = `<p class="w4c-wait">⏳ ${ph.by === localUid
      ? t('ch.waitMine', { t: esc(tName), card: esc(what) })
      : t('ch.waitOther', { t: esc(tName), c: esc(byName), card: esc(what) })}</p>`;
    return;
  }
  const byCards = state.players.find(p => p.id === ph.by)?.cardCount ?? '?';
  content.innerHTML = `
    <p class="w4c-title">${t('ch.title', { c: esc(byName), card: esc(what), color: colorChip(state.topColor) })}</p>
    <p class="w4c-subtitle">${t('ch.rule', { prev: colorChip(ph.prevColor), n: byCards })}</p>
    <div class="ch-options">
      <div class="ch-opt"><b>${t('ch.acceptT')}</b><span>${amount}</span></div>
      <div class="ch-opt"><b>${t('ch.challengeT')}</b><span>${t(ph.kind === 'wild2' ? 'ch.challengeWhy2' : 'ch.challengeWhyC', { c: esc(byName) })}</span></div>
    </div>
    <div class="w4c-btns">
      <button class="btn btn-ghost" onclick="doMove({t:'accept'})">${t('ch.accept')}</button>
      <button class="btn btn-secondary btn-challenge" onclick="doMove({t:'challenge'})">⚖️ ${t('ch.challenge')}</button>
    </div>`;
}

// ============================================================
// ¡ÚLTIMA! — shout when you're down to one card, or get caught (+2)
// ============================================================

let botShoutTimer = null, botShoutFor = null;
function renderLastCardOverlay(state) {
  const overlay = document.getElementById('uno-call-overlay');
  const u = state.uno;
  if (!u || state.status !== 'playing') {
    overlay.classList.add('hidden');
    return;
  }
  const who = state.players.find(p => p.id === u.pid);
  if (!who) { overlay.classList.add('hidden'); return; }
  const label = document.getElementById('uno-call-label');
  const btn   = document.getElementById('uno-call-btn');
  if (u.pid === localUid) {
    label.textContent = t('uno.mine');
    btn.textContent   = t('uno.shout');
    btn.dataset.kind = 'shout';
  } else if (state.players.some(p => p.id === localUid)) {
    label.textContent = t('uno.other', { name: who.name });
    btn.textContent   = t('uno.callOn', { name: who.name.toUpperCase() });
    btn.dataset.kind = 'catch';
  }
  overlay.classList.remove('hidden');
}
async function handleUnoCallBtn() {
  const kind = document.getElementById('uno-call-btn').dataset.kind;
  document.getElementById('uno-call-overlay').classList.add('hidden');
  if (LOCAL_GAME && typeof tutorialAllowsShout === 'function' && !tutorialAllowsShout(kind)) return;
  await sendMove({ t: kind === 'shout' ? 'shout' : 'catch' });
}

// ============================================================
// CHAT
// ============================================================

function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('chat-panel');
  panel.classList.toggle('hidden', !chatOpen);
  if (chatOpen) {
    chatUnreadCount = 0;
    updateChatBadge();
    if (roomState) renderChatPanel(roomState);
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
  }
}

function updateChatBadge() {
  const badge = document.getElementById('chat-unread');
  if (!badge) return;
  if (chatUnreadCount > 0) {
    badge.textContent = chatUnreadCount > 9 ? '9+' : String(chatUnreadCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function sendChatMessage(text) {
  if (!text || !text.trim() || !currentRoomId) return;
  const trimmed = text.trim();
  await db.runTransaction(async tx => {
    const ref  = db.collection('rooms').doc(currentRoomId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const msgs = snap.data().messages || [];
    const msg  = {
      id:   Date.now().toString(36) + Math.random().toString(36).slice(2),
      pid:  localUid,
      name: localName,
      text: trimmed,
      ts:   Date.now()
    };
    tx.update(ref, { messages: [...msgs, msg].slice(-50) });
  });
}

function sendEmote(emoji) {
  sendChatMessage(emoji).catch(() => {});
}

async function handleChatSend() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await sendChatMessage(text);
}

function handleChatKeydown(e) {
  if (e.key === 'Enter') handleChatSend();
}

function renderChatPanel(state) {
  const msgs = state.messages || [];

  // Count new messages from others and mark all as seen
  let newCount = 0;
  for (const msg of msgs) {
    if (!seenMessageIds.has(msg.id) && msg.pid !== localUid) newCount++;
    seenMessageIds.add(msg.id);
  }
  if (!chatOpen && newCount > 0) {
    chatUnreadCount += newCount;
    updateChatBadge();
    playChatSound();
  }

  if (!chatOpen) return;

  chatUnreadCount = 0;
  updateChatBadge();

  const playersEl = document.getElementById('chat-players');
  if (playersEl) {
    const players = state.players || [];
    playersEl.innerHTML = players.map(p => {
      const isMe = p.id === localUid;
      const dc = p.disconnected;
      return `<span class="chat-player-chip ${dc ? 'dc' : ''}">${esc(p.name)}${isMe ? ' ' + t('chat.me') : ''}</span>`;
    }).join('');
  }

  const el = document.getElementById('chat-messages');
  if (!el) return;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  el.innerHTML = msgs.map(msg => {
    const mine = msg.pid === localUid;
    const time = msg.ts ? new Date(msg.ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
    return `<div class="chat-msg ${mine ? 'mine' : ''}">
      ${!mine ? `<span class="chat-msg-name">${esc(msg.name)}</span>` : ''}
      <div class="chat-msg-bubble">${esc(msg.text)}</div>
      ${time ? `<span class="chat-msg-time">${time}</span>` : ''}
    </div>`;
  }).join('');
  if (wasAtBottom || msgs.length <= 3) el.scrollTop = el.scrollHeight;
}

function renderSpeechBubbles(state) {
  if (chatOpen) return;
  const msgs = state.messages || [];
  const container = document.getElementById('speech-bubbles');
  if (!container) return;
  const now = Date.now();
  for (const msg of msgs) {
    const bubbleKey = 'b_' + msg.id;
    if (seenMessageIds.has(bubbleKey)) continue;
    seenMessageIds.add(bubbleKey);
    if (msg.pid === localUid) continue;
    if (now - msg.ts > 6000) continue;
    const bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.innerHTML = `<strong>${esc(msg.name)}:</strong> ${esc(msg.text)}`;
    container.appendChild(bubble);
    setTimeout(() => bubble.remove(), 4000);
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function toggleNotifications() {
  if (!('Notification' in window)) return;
  if (!notifEnabled) {
    Notification.requestPermission().then(perm => {
      notifEnabled = perm === 'granted';
      localStorage.setItem('notifEnabled', notifEnabled ? 'true' : 'false');
      updateNotifButton();
      if (notifEnabled) {
        try {
          notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
          notifAudioCtx.resume();
        } catch (_) {}
        try { new Notification(t('nt.on'), { body: t('nt.onBody'), tag: 'notif-test' }); } catch (_) {}
        showVoiceToast(t('nt.on'));
      }
    });
  } else {
    notifEnabled = false;
    localStorage.setItem('notifEnabled', 'false');
    updateNotifButton();
  }
}

function updateNotifButton() {
  const btn = document.getElementById('notif-toggle-btn');
  if (!btn) return;
  const active = notifEnabled && Notification.permission === 'granted';
  btn.classList.toggle('notif-active', active);
  btn.title = active ? 'Desactivar notificaciones' : 'Activar notificaciones';
  btn.textContent = active ? '🔔' : '🔕';
}

function playChatSound() {
  ensureNotifAudioCtx();
  if (!notifAudioCtx) return;
  try {
    notifAudioCtx.resume().then(() => {
      const ctx = notifAudioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = 520;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch (_) {}
}

function playNotifSound() {
  ensureNotifAudioCtx();
  if (!notifAudioCtx) return;
  try {
    notifAudioCtx.resume().then(() => {
      const ctx = notifAudioCtx;
      const notes = [880, 1108];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
      });
    });
  } catch (_) {}
}

// ============================================================
// BACKGROUND MUSIC
// ============================================================

// 4-bar loop in D major at 104 BPM
// Each entry: [beat_offset, duration_beats, freq_Hz, volume, osc_type]
const MUSIC_BPM = 104;
const MUSIC_BEAT = 60 / MUSIC_BPM;
const MUSIC_TOTAL_BEATS = 16;
const MUSIC_SCORE = [
  // Melody (triangle wave)
  [0,    1.0, 293.7, 0.18, 'triangle'], // D4
  [1,    0.5, 329.6, 0.14, 'triangle'], // E4
  [1.5,  0.5, 392.0, 0.16, 'triangle'], // G4
  [2,    1.5, 440.0, 0.20, 'triangle'], // A4
  [3.5,  0.5, 493.9, 0.16, 'triangle'], // B4
  [4,    1.0, 440.0, 0.18, 'triangle'], // A4
  [5,    0.5, 392.0, 0.14, 'triangle'], // G4
  [5.5,  0.5, 369.9, 0.13, 'triangle'], // F#4
  [6,    1.0, 329.6, 0.16, 'triangle'], // E4
  [7,    1.0, 293.7, 0.18, 'triangle'], // D4
  [8,    1.0, 392.0, 0.18, 'triangle'], // G4
  [9,    0.5, 440.0, 0.14, 'triangle'], // A4
  [9.5,  0.5, 493.9, 0.14, 'triangle'], // B4
  [10,   1.0, 587.3, 0.20, 'triangle'], // D5
  [11,   1.0, 554.4, 0.18, 'triangle'], // C#5
  [12,   0.5, 493.9, 0.14, 'triangle'], // B4
  [12.5, 0.5, 440.0, 0.14, 'triangle'], // A4
  [13,   1.0, 392.0, 0.16, 'triangle'], // G4
  [14,   1.0, 369.9, 0.15, 'triangle'], // F#4
  [15,   1.0, 293.7, 0.22, 'triangle'], // D4
  // Bass (sine wave)
  [0,    2,   146.8, 0.14, 'sine'],     // D3
  [2,    2,   110.0, 0.12, 'sine'],     // A2
  [4,    2,   110.0, 0.13, 'sine'],     // A2
  [6,    1,   164.8, 0.11, 'sine'],     // E3
  [7,    1,   146.8, 0.11, 'sine'],     // D3
  [8,    1,   196.0, 0.12, 'sine'],     // G3
  [9,    1,   196.0, 0.11, 'sine'],     // G3
  [10,   2,   146.8, 0.12, 'sine'],     // D3
  [12,   2,   110.0, 0.13, 'sine'],     // A2
  [14,   2,   146.8, 0.12, 'sine'],     // D3
];

function scheduleMusicNote(ctx, startTime, durationBeats, freq, vol, oscType) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(musicMasterGain);
  osc.type = oscType;
  osc.frequency.value = freq;
  const dur = durationBeats * MUSIC_BEAT;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
  gain.gain.setValueAtTime(vol, startTime + dur - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + 0.04);
  osc.start(startTime);
  osc.stop(startTime + dur + 0.06);
}

function scheduleMusicLoop(loopStartTime) {
  const ctx = notifAudioCtx;
  if (!ctx || !musicPlaying) return;
  MUSIC_SCORE.forEach(([beat, dur, freq, vol, type]) => {
    scheduleMusicNote(ctx, loopStartTime + beat * MUSIC_BEAT, dur, freq, vol, type);
  });
  const loopDuration = MUSIC_TOTAL_BEATS * MUSIC_BEAT;
  musicLoopTimer = setTimeout(() => {
    if (musicPlaying) scheduleMusicLoop(loopStartTime + loopDuration);
  }, (loopDuration - 0.5) * 1000);
}

function startMusic() {
  if (musicPlaying || !notifAudioCtx) return;
  musicPlaying = true;
  notifAudioCtx.resume().then(() => {
    musicMasterGain = notifAudioCtx.createGain();
    musicMasterGain.gain.setValueAtTime(0, notifAudioCtx.currentTime);
    musicMasterGain.gain.linearRampToValueAtTime(0.5, notifAudioCtx.currentTime + 2.0);
    musicMasterGain.connect(notifAudioCtx.destination);
    scheduleMusicLoop(notifAudioCtx.currentTime + 0.15);
    updateMusicButton();
  });
}

function stopMusic() {
  musicPlaying = false;
  clearTimeout(musicLoopTimer);
  if (musicMasterGain && notifAudioCtx) {
    const oldGain = musicMasterGain;
    musicMasterGain = null;
    oldGain.gain.cancelScheduledValues(notifAudioCtx.currentTime);
    oldGain.gain.setTargetAtTime(0, notifAudioCtx.currentTime, 0.2);
    setTimeout(() => { try { oldGain.disconnect(); } catch (_) {} }, 1200);
  }
  updateMusicButton();
}

function toggleMusic() {
  if (musicPlaying) {
    musicEnabled = false;
    localStorage.setItem('musicEnabled', 'false');
    stopMusic();
  } else {
    musicEnabled = true;
    localStorage.setItem('musicEnabled', 'true');
    ensureNotifAudioCtx();
    startMusic();
  }
}

function enableMusic() {
  musicEnabled = true;
  localStorage.setItem('musicEnabled', 'true');
  document.getElementById('music-prompt')?.classList.add('hidden');
  ensureNotifAudioCtx();
  startMusic();
  updateMusicButton();
}

function disableMusic() {
  musicEnabled = false;
  localStorage.setItem('musicEnabled', 'false');
  document.getElementById('music-prompt')?.classList.add('hidden');
  updateMusicButton();
}

function showMusicPrompt() {
  document.getElementById('music-prompt')?.classList.remove('hidden');
}

function updateMusicButton() {
  const btn = document.getElementById('music-toggle-btn');
  if (!btn) return;
  btn.textContent = musicPlaying ? '🎵' : '🔇';
  btn.title = musicPlaying ? t('mu.mute') : t('mu.play');
  btn.classList.toggle('music-active', musicPlaying);
}

// ============================================================
// SPOTIFY INTEGRATION
// ============================================================

const SPOTIFY_SVG_SMALL    = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;
const SPOTIFY_SVG_LARGE    = `<svg class="spotify-modal-logo" viewBox="0 0 24 24" width="36" height="36" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;

let spotifyPollTimer      = null;
let spotifyTracksRef      = null;
let spotifyTracksData     = {};

// ----- PKCE helpers -----

function generateCodeVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

// ----- Auth -----

async function initiateSpotifyAuth() {
  const verifier   = generateCodeVerifier();
  const challenge  = await generateCodeChallenge(verifier);
  localStorage.setItem('spotify_code_verifier', verifier);
  const params = new URLSearchParams({
    client_id:             SPOTIFY_CLIENT_ID,
    response_type:         'code',
    redirect_uri:          SPOTIFY_REDIRECT_URI,
    scope:                 SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const error  = params.get('error');
  const code   = params.get('code');
  if (!code && !error) return;
  window.history.replaceState({}, '', window.location.pathname);
  if (error) {
    localStorage.removeItem('spotify_code_verifier');
    sessionStorage.setItem('spotify_callback_error', error);
    return;
  }
  const verifier = localStorage.getItem('spotify_code_verifier');
  if (!verifier) {
    sessionStorage.setItem('spotify_callback_error', 'verifier_missing');
    return;
  }
  try {
    const res  = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     SPOTIFY_CLIENT_ID,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  SPOTIFY_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem('spotify_access_token',  data.access_token);
      localStorage.setItem('spotify_refresh_token', data.refresh_token);
      localStorage.setItem('spotify_expires_at',    Date.now() + data.expires_in * 1000);
      sessionStorage.setItem('spotify_callback_ok', '1');
    } else {
      console.error('Spotify token error:', data);
      sessionStorage.setItem('spotify_callback_error', data.error || 'unknown');
    }
  } catch (e) {
    console.error('Spotify fetch error:', e);
    sessionStorage.setItem('spotify_callback_error', 'fetch_failed');
  }
  localStorage.removeItem('spotify_code_verifier');
}

async function refreshSpotifyToken() {
  const rt = localStorage.getItem('spotify_refresh_token');
  if (!rt) return false;
  try {
    const res  = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: rt,
        client_id:     SPOTIFY_CLIENT_ID,
      }),
    });
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem('spotify_access_token', data.access_token);
      localStorage.setItem('spotify_expires_at',   Date.now() + data.expires_in * 1000);
      if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
      return true;
    }
  } catch (_) {}
  return false;
}

async function getSpotifyToken() {
  const exp = parseInt(localStorage.getItem('spotify_expires_at') || '0');
  if (Date.now() > exp - 60000) {
    const ok = await refreshSpotifyToken();
    if (!ok) return null;
  }
  return localStorage.getItem('spotify_access_token');
}

function isSpotifyConnected() {
  return !!localStorage.getItem('spotify_access_token');
}

function disconnectSpotify() {
  stopSpotifyPolling();
  clearSpotifyTrackFromRoom();
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_expires_at');
  updateSpotifyButton();
  closeSpotifyModal();
}

// ----- Now Playing -----

async function fetchNowPlaying() {
  const token = await getSpotifyToken();
  if (!token) return;
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 204 || res.status === 404) { updateSpotifyTrackInRoom(null); return; }
    if (!res.ok) return;
    const data = await res.json();
    if (!data.is_playing || !data.item) { updateSpotifyTrackInRoom(null); return; }
    updateSpotifyTrackInRoom({
      title:    data.item.name,
      artist:   data.item.artists.map(a => a.name).join(', '),
      albumArt: data.item.album.images.at(-1)?.url || null,
      source:   'spotify',
    });
  } catch (_) {}
}

function startSpotifyPolling() {
  stopSpotifyPolling();
  fetchNowPlaying();
  spotifyPollTimer = setInterval(fetchNowPlaying, 30000);
}

function stopSpotifyPolling() {
  clearInterval(spotifyPollTimer);
  spotifyPollTimer = null;
}

// ----- RTDB track sharing -----

function updateSpotifyTrackInRoom(track) {
  if (!currentRoomId || !localUid) return;
  const ref = rtdb.ref(`rooms/${currentRoomId}/spotifyTracks/${localUid}`);
  if (track) {
    ref.set(track);
    ref.onDisconnect().remove();
  } else {
    ref.remove();
  }
}

function clearSpotifyTrackFromRoom() {
  if (!currentRoomId || !localUid) return;
  rtdb.ref(`rooms/${currentRoomId}/spotifyTracks/${localUid}`).remove();
}

// ----- Carousel -----

function listenSpotifyTracks() {
  stopListeningSpotifyTracks();
  if (!currentRoomId) return;
  spotifyTracksRef = rtdb.ref(`rooms/${currentRoomId}/spotifyTracks`);
  spotifyTracksRef.on('value', snap => {
    spotifyTracksData = snap.val() || {};
    renderNowPlayingCarousel();
  });
}

function stopListeningSpotifyTracks() {
  if (spotifyTracksRef) { spotifyTracksRef.off('value'); spotifyTracksRef = null; }
  spotifyTracksData = {};
  renderNowPlayingCarousel();
}

function renderNowPlayingCarousel() {
  const container = document.getElementById('now-playing-carousel');
  if (!container) return;
  const entries = Object.entries(spotifyTracksData);
  if (!entries.length) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  container.innerHTML = entries.map(([uid, track]) => {
    const player    = roomState?.players?.find(p => p.id === uid);
    const name      = player ? esc(player.name) : '';
    const artHTML   = track.albumArt
      ? `<img class="now-playing-art" src="${esc(track.albumArt)}" alt="" loading="lazy">`
      : `<div class="now-playing-art-placeholder">♪</div>`;
    const sourceLogo = track.source === 'lastfm'
      ? `<svg class="now-playing-service-logo" viewBox="0 0 24 24" width="11" height="11" fill="#d51007"><path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/></svg>`
      : `<svg class="now-playing-service-logo" viewBox="0 0 24 24" width="10" height="10" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;
    return `<div class="now-playing-item">
      ${artHTML}
      <div class="now-playing-text">
        <span class="now-playing-player">${name}</span>
        <span class="now-playing-title">${esc(track.title)}</span>
        <span class="now-playing-artist">${esc(track.artist)}</span>
      </div>
      ${sourceLogo}
    </div>`;
  }).join('');
}

// ----- Modal -----

function openSpotifyModal() {
  const card = document.getElementById('spotify-modal-card');
  if (!card) return;
  if (isSpotifyConnected()) {
    const raw   = spotifyTracksData[localUid];
    const track = raw?.source === 'lastfm' ? null : raw;
    const trackHTML = track
      ? `<div class="spotify-modal-track">
          ${track.albumArt ? `<img class="spotify-modal-art" src="${esc(track.albumArt)}" alt="">` : ''}
          <div style="min-width:0">
            <div class="spotify-modal-track-title">${esc(track.title)}</div>
            <div class="spotify-modal-track-artist">${esc(track.artist)}</div>
          </div>
        </div>`
      : `<p class="spotify-modal-desc">${t('sp.nothing')}</p>`;
    card.innerHTML = `
      ${SPOTIFY_SVG_LARGE}
      <div class="spotify-modal-connected">● ${t('sp.connected')}</div>
      ${trackHTML}
      <div class="spotify-modal-btns">
        <button class="btn btn-ghost btn-sm" onclick="disconnectSpotify()">${t('ui.disconnect')}</button>
        <button class="btn btn-primary btn-sm" onclick="closeSpotifyModal()">Cerrar</button>
      </div>`;
  } else {
    card.innerHTML = `
      ${SPOTIFY_SVG_LARGE}
      <h3 class="spotify-modal-title">${t('sp.connectTitle')}</h3>
      <p class="spotify-modal-desc">${t('sp.desc')}</p>
      <div class="spotify-modal-btns">
        <button class="btn spotify-connect-btn btn-sm" onclick="initiateSpotifyAuth()">${t('sp.connectBtn')}</button>
        <button class="btn btn-ghost btn-sm" onclick="closeSpotifyModal()">${t('ui.cancel')}</button>
      </div>`;
  }
  document.getElementById('spotify-modal').classList.remove('hidden');
}

function closeSpotifyModal() {
  document.getElementById('spotify-modal')?.classList.add('hidden');
}

function spotifyModalBackdropClick(e) {
  if (e.target === document.getElementById('spotify-modal')) closeSpotifyModal();
}

function updateSpotifyButton() {
  const btn = document.getElementById('spotify-btn');
  if (!btn) return;
  btn.classList.toggle('spotify-active', isSpotifyConnected());
  btn.title = isSpotifyConnected() ? t('sp.on') : t('sp.connectTitle');
}

function showSpotifyError(msg) {
  const card = document.getElementById('spotify-modal-card');
  if (!card) return;
  card.innerHTML = `
    ${SPOTIFY_SVG_LARGE}
    <h3 class="spotify-modal-title">Error de Spotify</h3>
    <p class="spotify-modal-desc" style="color:var(--color-danger,#e55)">${esc(msg)}</p>
    <div class="spotify-modal-btns">
      <button class="btn spotify-connect-btn btn-sm" onclick="initiateSpotifyAuth()">Reintentar</button>
      <button class="btn btn-ghost btn-sm" onclick="closeSpotifyModal()">Cerrar</button>
    </div>`;
  document.getElementById('spotify-modal').classList.remove('hidden');
}

// ============================================================
// LAST.FM INTEGRATION
// Polls user.getrecenttracks every 30s. Always shows the most recent track;
// uses @attr.nowplaying to distinguish "now playing" from "last played".
// Works with any service the user has connected to Last.fm (Spotify,
// Apple Music, Tidal, etc.) via scrobbling.
// ============================================================

const LASTFM_API_KEY  = '80b47bbd69a91cddc6d615d8078a86d2';
const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_SVG_SMALL = `<svg viewBox="0 0 24 24" width="12" height="12" fill="#d51007"><path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/></svg>`;
const LASTFM_SVG_LARGE = `<svg class="lastfm-modal-logo" viewBox="0 0 24 24" width="40" height="40" fill="#d51007"><path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/></svg>`;

let lastfmPollTimer = null;

function isLastfmConnected() {
  return !!localStorage.getItem('lastfm_username');
}

function disconnectLastfm() {
  stopLastfmPolling();
  clearSpotifyTrackFromRoom();
  localStorage.removeItem('lastfm_username');
  updateLastfmButton();
  closeLastfmModal();
}

async function connectLastfm() {
  const input    = document.getElementById('lastfm-username-input');
  const errEl    = document.getElementById('lastfm-input-error');
  const username = input?.value.trim();
  if (!username) return;
  if (errEl) errEl.textContent = '';
  try {
    const res  = await fetch(`${LASTFM_API_BASE}?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${LASTFM_API_KEY}&format=json`);
    const data = await res.json();
    if (data.error) {
      if (errEl) errEl.textContent = t('lf.notFound');
      return;
    }
    localStorage.setItem('lastfm_username', data.user.name);
    startLastfmPolling();
    updateLastfmButton();
    openLastfmModal();
  } catch (e) {
    if (errEl) errEl.textContent = t('lf.netError');
  }
}

async function fetchLastfmNowPlaying() {
  const username = localStorage.getItem('lastfm_username');
  if (!username) return;
  try {
    const res  = await fetch(`${LASTFM_API_BASE}?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${LASTFM_API_KEY}&format=json&limit=1`);
    const data = await res.json();
    if (data.error) {
      if (data.error === 6) {
        localStorage.removeItem('lastfm_username');
        updateLastfmButton();
      }
      clearSpotifyTrackFromRoom();
      return;
    }
    const tracks = data.recenttracks?.track;
    const track  = Array.isArray(tracks) ? tracks[0] : tracks;
    if (track) {
      const img       = track.image?.find(i => i.size === 'medium')?.['#text'] || '';
      const isPlaying = track?.['@attr']?.nowplaying === 'true';
      updateSpotifyTrackInRoom({
        title:     track.name,
        artist:    track.artist['#text'],
        albumArt:  img.startsWith('http') ? img : null,
        source:    'lastfm',
        isPlaying,
      });
    } else {
      clearSpotifyTrackFromRoom();
    }
  } catch (e) {
    console.error('Last.fm fetch error:', e);
  }
}

function startLastfmPolling() {
  stopLastfmPolling();
  fetchLastfmNowPlaying();
  lastfmPollTimer = setInterval(fetchLastfmNowPlaying, 30000);
}

function stopLastfmPolling() {
  clearInterval(lastfmPollTimer);
  lastfmPollTimer = null;
}

function openLastfmModal() {
  const card = document.getElementById('lastfm-modal-card');
  if (!card) return;
  const username = localStorage.getItem('lastfm_username');
  if (username) {
    const raw   = spotifyTracksData[localUid];
    const track = raw?.source === 'lastfm' ? raw : null;
    const trackLabel = track?.isPlaying ? t('lf.now') : t('lf.last');
    const trackHTML = track
      ? `<div class="lastfm-modal-track">
          ${track.albumArt ? `<img class="lastfm-modal-art" src="${esc(track.albumArt)}" alt="">` : ''}
          <div style="min-width:0">
            <div class="lastfm-modal-track-label">${trackLabel}</div>
            <div class="lastfm-modal-track-title">${esc(track.title)}</div>
            <div class="lastfm-modal-track-artist">${esc(track.artist)}</div>
          </div>
        </div>`
      : `<p class="lastfm-modal-desc">Sin historial de Last.fm.</p>`;
    card.innerHTML = `
      ${LASTFM_SVG_LARGE}
      <div class="lastfm-modal-connected">● ${t('lf.as', { name: esc(username) })}</div>
      ${trackHTML}
      <div class="lastfm-modal-btns">
        <button class="btn btn-ghost btn-sm" onclick="disconnectLastfm()">${t('ui.disconnect')}</button>
        <button class="btn btn-primary btn-sm" onclick="closeLastfmModal()">Cerrar</button>
      </div>`;
  } else {
    card.innerHTML = `
      ${LASTFM_SVG_LARGE}
      <h3 class="lastfm-modal-title">${t('lf.connectTitle')}</h3>
      <p class="lastfm-modal-desc">${t('lf.desc')}</p>
      <input id="lastfm-username-input" class="lastfm-username-input" type="text" placeholder="${t('lf.placeholder')}" autocomplete="off" onkeydown="if(event.key==='Enter')connectLastfm()">
      <span id="lastfm-input-error" class="lastfm-input-error"></span>
      <div class="lastfm-modal-btns">
        <button class="btn lastfm-connect-btn btn-sm" onclick="connectLastfm()">${t('lf.connect')}</button>
        <button class="btn btn-ghost btn-sm" onclick="closeLastfmModal()">${t('ui.cancel')}</button>
      </div>`;
    setTimeout(() => document.getElementById('lastfm-username-input')?.focus(), 50);
  }
  document.getElementById('lastfm-modal').classList.remove('hidden');
}

function closeLastfmModal() {
  document.getElementById('lastfm-modal')?.classList.add('hidden');
}

function lastfmModalBackdropClick(e) {
  if (e.target === document.getElementById('lastfm-modal')) closeLastfmModal();
}

function updateLastfmButton() {
  const btn = document.getElementById('lastfm-btn');
  if (!btn) return;
  btn.classList.toggle('lastfm-active', isLastfmConnected());
  btn.title = isLastfmConnected()
    ? `Last.fm: ${localStorage.getItem('lastfm_username')}`
    : t('lf.connectTitle');
}


function notify(title, body) {
  if (!notifEnabled || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  playNotifSound();
  try { new Notification(title, { body, tag: 'voltea' }); } catch (_) {}
}

function checkNotifications(state) {
  const prev = prevNotifState;
  prevNotifState = {
    status: state.status,
    acting: whoActs(state),
    unoFor: state.uno?.pid || null
  };
  if (!prev) return;

  if (prev.status !== 'playing' && state.status === 'playing') {
    const first = state.players[state.currentPlayerIndex];
    notify(t('nt.started'), t('nt.first', { name: first?.name || '?' }));
    return;
  }
  if (prev.status !== 'ended' && state.status === 'ended') {
    const won = state.winner === localUid;
    notify(won ? t('nt.won') : t('nt.over'),
           won ? t('nt.congrats') : t('nt.whoWon', { name: state.winnerName || '?' }));
    return;
  }
  if (state.status !== 'playing') return;
  if (prev.acting !== localUid && whoActs(state) === localUid) {
    notify(t('nt.yourTurn'), state.phase?.k === 'challenge' ? t('nt.challenge') : t('nt.yourTurnBody'));
    return;
  }
  if (!prev.unoFor && state.uno?.pid === localUid) notify(t('uno.shout'), t('nt.uno'));
}

// ============================================================
// BACK TO LOBBY
// ============================================================

async function backToLobby() {
  if (!roomState) return;
  await mutateRoom(cur => ({
    status: 'lobby',
    winner: null, winnerName: null, winnerReason: null, matchWinner: null,
    endVotes: [],
    hands: {}, drawPile: [], discard: [], log: [],
    phase: null, drawn: null, uno: null, points: {},
    prevPlayerNames: cur.players.map(p => p.name),
    readyVotes: [],
    players: cur.players.filter(p => !p.disconnected).map(p => ({ ...p, cardCount: 0 }))
  }));
}

async function handleReadyVote() {
  if (!currentRoomId || !localUid) return;
  await db.collection('rooms').doc(currentRoomId).update({
    readyVotes: firebase.firestore.FieldValue.arrayUnion(localUid)
  });
}

// ============================================================
// LEAVING
// ============================================================

function leaveRoomLocally() {
  clearSpotifyTrackFromRoom();
  teardownPresence();
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
  sessionStorage.clear();
  closeColorDialog();
  const roomId = currentRoomId;
  currentRoomId = null;
  roomState = null;
  fxPrevState = null;
  document.body.classList.remove('side-D');
  showScreen('landing');
  return roomId;
}

async function handleLeaveLobby() {
  if (!roomState || !currentRoomId) { showScreen('landing'); return; }
  const roomId = currentRoomId;
  await mutateRoom(cur => {
    const players = cur.players.filter(p => p.id !== localUid);
    if (!players.length || players.every(p => isBot(p.id))) return 'delete';
    const update = { players, readyVotes: (cur.readyVotes || []).filter(id => id !== localUid) };
    if (cur.hostId === localUid) update.hostId = players.find(p => !isBot(p.id))?.id || players[0].id;
    return update;
  }).then(r => { if (r === 'delete') db.collection('rooms').doc(roomId).delete().catch(() => {}); });
  leaveRoomLocally();
}

async function handleLeaveGame() {
  if (LOCAL_GAME) { endTutorial(); return; }
  if (!roomState || !currentRoomId) { showScreen('landing'); return; }
  const ok = await showDrawConfirm('red', '🚪', t('g.leaveQ'), t('g.leaveBody'), t('g.leave'), t('g.stay'), t('g.voteEnd'));
  if (ok === 'third') { handleEndGameVote(); return; }
  if (!ok) return;

  const roomId = currentRoomId;
  // My cards go back under the deck and the turn moves on (engine.removePlayer)
  const r = await mutateRoom(cur => {
    const left = cur.players.filter(p => p.id !== localUid);
    if (!left.some(p => !isBot(p.id))) return 'delete';   // only bots would be left
    const st = Engine.removePlayer(cur, localUid);
    const update = { ...gamePatch(st), endVotes: (cur.endVotes || []).filter(id => id !== localUid) };
    if (cur.hostId === localUid) update.hostId = left.find(p => !isBot(p.id) && !p.disconnected)?.id || left.find(p => !isBot(p.id)).id;
    return update;
  });
  if (r === 'delete') db.collection('rooms').doc(roomId).delete().catch(() => {});
  leaveRoomLocally();
}

// ============================================================
// END GAME VOTE
// ============================================================

async function handleEndGameVote() {
  const state = roomState;
  if (!state || state.status !== 'playing') return;
  const voted = (state.endVotes || []).includes(localUid);
  await mutateRoom(cur => {
    const votes = cur.endVotes || [];
    const humans = cur.players.filter(p => !p.disconnected && !isBot(p.id)).length;
    return voted
      ? { endVotes: votes.filter(id => id !== localUid), log: pushLog(cur.log, 'log.unvote', { name: localName }) }
      : { endVotes: [...new Set([...votes, localUid])], log: pushLog(cur.log, 'log.vote', { name: localName, n: votes.length + 1, t: humans }) };
  });
}

function renderEndVoteStatus(state) {
  const votes = state.endVotes || [];
  const statusEl = document.getElementById('end-vote-status');
  const btn = document.getElementById('end-game-btn');
  const hasVoted = votes.includes(localUid);
  statusEl.textContent = votes.length > 0
    ? t('g.votes', { n: votes.length, t: state.players.filter(p => !p.disconnected && !isBot(p.id)).length })
    : '';
  if (btn) {
    btn.textContent = hasVoted ? t('g.withdraw') : t('g.end');
    btn.classList.toggle('btn-voted', hasVoted);
  }
}

// ============================================================
// WINNER SCREEN
// ============================================================

// Everyone's cards left and points in hand, best first (on the side that was up)
function computeStandings(state) {
  return (state.players || [])
    .map(p => {
      const hand = state.hands?.[p.id] || [];
      const pts = hand.reduce((s, c) => s + Engine.cardPoints(c[state.side], state.side), 0);
      return { id: p.id, name: p.name, cards: hand.length, points: pts, total: state.points?.[p.id] || 0, hand };
    })
    .sort((a, b) => (b.id === state.winner) - (a.id === state.winner) || a.cards - b.cards || a.points - b.points);
}

function renderWinner(state) {
  const reason = state.winnerReason;
  const titleEl = document.getElementById('winner-title');
  const nameEl  = document.getElementById('winner-name');
  const subEl   = document.getElementById('winner-sub');
  const standingsEl = document.getElementById('winner-standings');
  document.getElementById('join-another-form')?.classList.add('hidden');
  document.getElementById('winner-error')?.classList.add('hidden');

  const match = !!state.matchTarget;
  const champion = state.matchWinner ? state.players.find(p => p.id === state.matchWinner) : null;
  if (champion) titleEl.textContent = t('w.champion');
  else if (reason === 'vote') titleEl.textContent = t('w.vote');
  else if (reason === 'lastPlayer') titleEl.textContent = t('w.last');
  else titleEl.textContent = match ? t('w.roundWin', { n: state.roundNo || 1 }) : t('w.winner');
  nameEl.textContent = champion ? champion.name : (state.winnerName || '?');
  subEl.innerHTML = state.roundPoints
    ? t(match ? 'w.ptsMatch' : 'w.pts', { n: state.roundPoints, side: sideChip(state.side), target: state.matchTarget })
    : '';

  // Who had what left — the cards are shown on the side that was up at the end
  standingsEl.innerHTML = `<div class="standing-head">${t(match ? 'w.tableMatch' : 'w.table')}</div>` +
    computeStandings(state).map((s, i) => `<div class="standing-row ${s.id === state.winner ? 'winner-row' : ''} ${s.id === state.matchWinner ? 'champ-row' : ''}">
      <span class="standing-rank">#${i + 1}</span>
      <span class="standing-name">${esc(s.name)}
        <span class="standing-hand">${s.hand.slice(0, 12).map(c => miniHTML(c[state.side], state.side)).join('')}${s.hand.length > 12 ? '…' : ''}</span></span>
      <span class="standing-stats">${s.id === state.winner ? '🏆' : t('w.standing', { c: s.cards, p: s.points })}${match ? `<b class="standing-total">${s.total}</b>` : ''}</span>
    </div>`).join('');
  standingsEl.classList.remove('hidden');

  // Buttons: next round of the match (host), or back to the room
  const isHost = state.hostId === localUid;
  const moreRounds = match && !state.matchWinner;
  document.getElementById('next-round-btn').classList.toggle('hidden', !(moreRounds && isHost));
  document.getElementById('next-round-wait').classList.toggle('hidden', !(moreRounds && !isHost));
  document.getElementById('again-btn').textContent = moreRounds ? t('w.toLobby') : t('w.again');

  // Confetti, awards, room score, my stats + badges (extras.js)
  if (typeof afterWinnerRender === 'function') afterWinnerRender(state);
}

function showJoinAnother() {
  document.getElementById('join-another-form').classList.toggle('hidden');
}

async function handleJoinAnother() {
  const code = document.getElementById('winner-room-code').value.trim().toUpperCase();
  if (code.length !== 6) { showWinnerError(t('err.code')); return; }
  if (!localUid) { showWinnerError(t('err.connecting')); return; }

  const snap = await db.collection('rooms').doc(code).get();
  if (!snap.exists || !isOurRoom(snap.data())) { showWinnerError(t('err.notFound')); return; }
  const data = snap.data();
  if (data.status !== 'lobby') { showWinnerError(t('err.started')); return; }
  if (data.players.length >= MAX_PLAYERS) { showWinnerError(t('err.full', { n: MAX_PLAYERS })); return; }

  leaveRoomLocally();
  if (!data.players.find(p => p.id === localUid)) {
    await db.collection('rooms').doc(code).update({
      players: firebase.firestore.FieldValue.arrayUnion({ id: localUid, name: localName, cardCount: 0 })
    });
  }
  currentRoomId = code;
  sessionStorage.setItem('roomId', code);
  sessionStorage.setItem('playerName', localName);
  sessionStorage.setItem('playerEmoji', selectedEmoji);
  subscribeToRoom(code);
  showScreen('lobby');
}

function showWinnerError(msg) {
  const el = document.getElementById('winner-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

function returnToMain() {
  if (LOCAL_GAME) { endTutorial(); return; }
  leaveRoomLocally();
}

window.addEventListener('beforeunload', () => {
  if (presenceRef) {
    presenceRef.onDisconnect().cancel();
    presenceRef.remove();
  }
  if (voiceActiveRef) {
    voiceActiveRef.onDisconnect().cancel();
    voiceActiveRef.remove();
  }
});

// ============================================================
// VOICE CHAT (WebRTC mesh, Firebase RTDB signaling)
// ============================================================

const STUN_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// voiceState cycles: 'off' → 'on' (unmuted) → 'muted' → 'off'
let voiceState = 'off';
let localStream = null;
const peerConns = {};
const voiceIceRefs = {};
let voiceActiveRef = null;
let voiceActiveRtdb = null;
let voiceSignalRtdb = null;
let voiceActivityRef = null;
let voiceActivityLoaded = false;
let audioCtx = null;
const voiceAnalysers = {};
const speakingStates = {};

async function toggleVoice() {
  if (voiceState === 'off') {
    await joinVoice();
  } else if (voiceState === 'on') {
    muteVoice();
  } else {
    unmuteVoice();
  }
}

// Modify SDP to prefer Opus with FEC, DTX, and higher bitrate for better voice quality
function preferOpus(sdp) {
  const lines = sdp.split('\r\n');
  let opusPt = null;
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+) opus\/48000\/2/i);
    if (m) { opusPt = m[1]; break; }
  }
  if (!opusPt) return sdp;

  const fmtpLine = `a=fmtp:${opusPt} minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=64000`;
  let hasFmtp = false;
  const result = lines.map(line => {
    if (line.startsWith('m=audio ')) {
      const parts = line.split(' ');
      const others = parts.slice(3).filter(p => p !== opusPt);
      return [...parts.slice(0, 3), opusPt, ...others].join(' ');
    }
    if (line.startsWith(`a=fmtp:${opusPt} `)) {
      hasFmtp = true;
      return fmtpLine;
    }
    return line;
  });
  if (!hasFmtp) {
    const idx = result.findIndex(l => l.startsWith(`a=rtpmap:${opusPt} `));
    if (idx >= 0) result.splice(idx + 1, 0, fmtpLine);
  }
  return result.join('\r\n');
}

async function joinVoice() {
  if (!currentRoomId) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: 48000 },
      },
      video: false,
    });
  } catch (e) {
    showVoiceToast(t('vc.noMic'));
    return;
  }

  voiceState = 'on';
  updateVoiceButton();
  startSpeakingMonitor(localUid, localStream);

  voiceActiveRef = rtdb.ref(`voice/${currentRoomId}/active/${localUid}`);
  voiceActiveRef.set({ muted: false });
  voiceActiveRef.onDisconnect().remove();

  voiceActiveRtdb = rtdb.ref(`voice/${currentRoomId}/active`);
  voiceActiveRtdb.on('child_added', snap => {
    const uid = snap.key;
    if (uid === localUid || peerConns[uid]) return;
    if (localUid > uid) initiateVoiceCall(uid);
    // else: the other peer (with higher uid) will initiate to us
  });
  voiceActiveRtdb.on('child_removed', snap => closePeerConn(snap.key));

  voiceSignalRtdb = rtdb.ref(`voice/${currentRoomId}/signals/${localUid}`);
  voiceSignalRtdb.on('child_added', snap => {
    const fromUid = snap.key;
    const data = snap.val();
    snap.ref.remove();
    if (!data) return;
    if (data.type === 'offer') handleVoiceOffer(fromUid, data.sdp);
    else if (data.type === 'answer') handleVoiceAnswer(fromUid, data.sdp);
  });
}

async function initiateVoiceCall(targetUid) {
  const pc = createPeerConn(targetUid);
  try {
    const offer = await pc.createOffer({ voiceActivityDetection: true });
    const offerSdp = preferOpus(offer.sdp);
    await pc.setLocalDescription({ type: offer.type, sdp: offerSdp });
    rtdb.ref(`voice/${currentRoomId}/signals/${targetUid}/${localUid}`)
      .set({ type: 'offer', sdp: offerSdp, ts: firebase.database.ServerValue.TIMESTAMP });
  } catch (e) {
    console.error('voice initiateCall:', e);
    closePeerConn(targetUid);
  }
}

async function handleVoiceOffer(fromUid, sdp) {
  const pc = createPeerConn(fromUid);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    pc._flushCandidates();
    const answer = await pc.createAnswer({ voiceActivityDetection: true });
    const answerSdp = preferOpus(answer.sdp);
    await pc.setLocalDescription({ type: answer.type, sdp: answerSdp });
    rtdb.ref(`voice/${currentRoomId}/signals/${fromUid}/${localUid}`)
      .set({ type: 'answer', sdp: answerSdp, ts: firebase.database.ServerValue.TIMESTAMP });
  } catch (e) {
    console.error('voice handleOffer:', e);
    closePeerConn(fromUid);
  }
}

async function handleVoiceAnswer(fromUid, sdp) {
  const pc = peerConns[fromUid];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    pc._flushCandidates();
  } catch (e) {
    console.error('voice handleAnswer:', e);
  }
}

function createPeerConn(remoteUid) {
  if (peerConns[remoteUid]) peerConns[remoteUid].close();

  const pc = new RTCPeerConnection(STUN_CONFIG);
  peerConns[remoteUid] = pc;

  // Queue ICE candidates received before setRemoteDescription completes
  const pending = [];
  pc._flushCandidates = () => {
    pending.splice(0).forEach(c =>
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    );
  };

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.ontrack = e => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    let audio = document.getElementById('voice-audio-' + remoteUid);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'voice-audio-' + remoteUid;
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    // Tune jitter buffer: 60ms balances latency vs. choppiness from network jitter
    pc.getReceivers().forEach(recv => {
      if (recv.track.kind === 'audio' && recv.jitterBufferTarget !== undefined) {
        recv.jitterBufferTarget = 60;
      }
    });
    startSpeakingMonitor(remoteUid, stream);
  };

  pc.onicecandidate = e => {
    if (e.candidate && currentRoomId) {
      rtdb.ref(`voice/${currentRoomId}/ice/${remoteUid}/${localUid}`)
        .push(e.candidate.toJSON());
    }
  };

  const iceRef = rtdb.ref(`voice/${currentRoomId}/ice/${localUid}/${remoteUid}`);
  iceRef.on('child_added', snap => {
    const candidate = snap.val();
    snap.ref.remove();
    if (pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      pending.push(candidate);
    }
  });
  voiceIceRefs[remoteUid] = iceRef;

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') closePeerConn(remoteUid);
  };

  return pc;
}

function closePeerConn(uid) {
  if (voiceIceRefs[uid]) { voiceIceRefs[uid].off(); delete voiceIceRefs[uid]; }
  if (peerConns[uid]) { peerConns[uid].close(); delete peerConns[uid]; }
  const a = document.getElementById('voice-audio-' + uid);
  if (a) a.remove();
  stopSpeakingMonitor(uid);
  updateVoiceSpeaking(uid, false);
}

function muteVoice() {
  voiceState = 'muted';
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = false; });
  if (voiceActiveRef) voiceActiveRef.set({ muted: true });
  updateVoiceButton();
}

function unmuteVoice() {
  voiceState = 'on';
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = true; });
  if (voiceActiveRef) voiceActiveRef.set({ muted: false });
  updateVoiceButton();
}

function leaveVoice() {
  if (voiceState === 'off') return;
  const roomId = currentRoomId;
  voiceState = 'off';

  if (voiceActiveRef) {
    voiceActiveRef.onDisconnect().cancel();
    voiceActiveRef.remove();
    voiceActiveRef = null;
  }
  if (voiceActiveRtdb) { voiceActiveRtdb.off(); voiceActiveRtdb = null; }
  if (voiceSignalRtdb) { voiceSignalRtdb.off(); voiceSignalRtdb = null; }

  Object.keys(peerConns).forEach(closePeerConn);

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  stopSpeakingMonitor(localUid);
  Object.keys(speakingStates).forEach(uid => {
    delete speakingStates[uid];
    updateVoiceSpeaking(uid, false);
  });

  if (roomId) {
    rtdb.ref(`voice/${roomId}/signals/${localUid}`).remove().catch(() => {});
    rtdb.ref(`voice/${roomId}/ice/${localUid}`).remove().catch(() => {});
  }
  updateVoiceButton();
}

function startSpeakingMonitor(uid, stream) {
  stopSpeakingMonitor(uid);
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const timer = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const speaking = avg > 8;
      if (speaking !== speakingStates[uid]) {
        speakingStates[uid] = speaking;
        updateVoiceSpeaking(uid, speaking);
      }
    }, 100);
    voiceAnalysers[uid] = { source, analyser, timer };
  } catch (_) {}
}

function stopSpeakingMonitor(uid) {
  const e = voiceAnalysers[uid];
  if (!e) return;
  clearInterval(e.timer);
  try { e.source.disconnect(); } catch (_) {}
  delete voiceAnalysers[uid];
}

function updateVoiceSpeaking(uid, speaking) {
  if (uid === localUid) {
    document.getElementById('voice-toggle-btn')
      ?.classList.toggle('voice-self-speaking', speaking && voiceState === 'on');
  } else {
    document.querySelector(`.opponent[data-uid="${uid}"]`)
      ?.classList.toggle('voice-speaking', speaking);
  }
}

function updateVoiceButton() {
  const btn = document.getElementById('voice-toggle-btn');
  if (!btn) return;
  btn.classList.remove('voice-active', 'voice-muted', 'voice-self-speaking');
  if (voiceState === 'off') {
    btn.textContent = '🎤';
    btn.title = t('vc.join');
  } else if (voiceState === 'on') {
    btn.textContent = '🎤';
    btn.title = t('vc.mute');
    btn.classList.add('voice-active');
  } else {
    btn.textContent = '🔇';
    btn.title = t('vc.leave');
    btn.classList.add('voice-muted');
  }
}

function showVoiceToast(msg) {
  const el = document.getElementById('voice-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden', 'voice-join');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function showVoiceJoinToast(msg) {
  const el = document.getElementById('voice-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('voice-join');
  setTimeout(() => { el.classList.add('hidden'); el.classList.remove('voice-join'); }, 3500);
}


// ============================================================
// BOTS
// Only the host's device runs them. Bots sit in the players list with ids that start
// with 'bot_'. Their choices come from Engine.botMove (they only "see" what a person
// at the table would: their own cards, card counts and the other side of rivals' cards),
// and their moves are saved through sendMove like anyone else's.
// ============================================================

function isBot(uid) { return typeof uid === 'string' && uid.startsWith('bot_'); }
function botGenUid() { return 'bot_' + Math.random().toString(36).slice(2, 10); }

// Personalities: each bot gets the next free one; its name shows who it is
const BOT_PERSONAS = {
  attacker: { name: 'Petardo',   icon: '💥' },   // loves +1/+5, skips and wild draws
  flipper:  { name: 'Giros',     icon: '🌗' },   // flips the game whenever it can
  saver:    { name: 'Ahorrador', icon: '🧐' },   // hoards wilds, sheds numbers
  bluffer:  { name: 'Farolero',  icon: '🃏' },   // plays wild draws even when it shouldn't
  balanced: { name: 'Robo',      icon: '🤖' }
};
const BOT_ORDER = ['attacker', 'flipper', 'saver', 'bluffer', 'balanced'];
// Levels (host picks in the lobby):
//   random    chance of just playing any card it can
//   challenge how well it reads a wild draw bluff (0 = guesses, 1 = sharp)
//   shoutMs   how long it takes to shout ¡ÚLTIMA! for itself
//   catch     chance it catches a person who forgot to shout, after catchMs
const BOT_LEVELS = {
  easy:   { random: .4, challenge: .1,  shoutMs: 4500, catch: .25, catchMs: 5500 },
  normal: { random: 0,  challenge: .5,  shoutMs: 2800, catch: .55, catchMs: 3800 },
  hard:   { random: 0,  challenge: .85, shoutMs: 900,  catch: .9,  catchMs: 2200 }
};
const botLevel = state => BOT_LEVELS[state?.botLevel] || BOT_LEVELS.normal;

function pickBotPersona(players) {
  const used = new Set(players.filter(p => isBot(p.id)).map(p => p.persona));
  return BOT_ORDER.find(k => !used.has(k)) || BOT_ORDER[players.length % BOT_ORDER.length];
}
function makeBot(players) {
  const persona = pickBotPersona(players);
  const P = BOT_PERSONAS[persona];
  return { id: botGenUid(), name: getUniqueName(`${P.icon} ${P.name}`, players), cardCount: 0, isBot: true, persona };
}

async function handleAddBot() {
  if (!roomState || roomState.hostId !== localUid) return;
  await mutateRoom(cur => cur.players.length >= MAX_PLAYERS || cur.status !== 'lobby'
    ? null : { players: [...cur.players, makeBot(cur.players)] });
}
async function handleRemoveBot(botId) {
  if (!roomState || roomState.hostId !== localUid || !isBot(botId)) return;
  await mutateRoom(cur => ({ players: cur.players.filter(p => p.id !== botId) }));
}

// ----- Bot timing -----
let botTickTimer = null;
let botTickRunning = false;
let botUnoTimer = null, botUnoKey = null;

function scheduleBotTick(state) {
  if (!state || state.hostId !== localUid || state.status !== 'playing') return;
  if (!state.players.some(p => isBot(p.id))) return;
  scheduleBotLastCard(state);
  const acting = whoActs(state);
  if (!isBot(acting)) return;
  clearTimeout(botTickTimer);
  // a bot "thinks" a little; a colour pick or challenge answer comes a bit slower
  const delay = (state.phase ? 1500 : 1100) + Math.random() * 900;
  botTickTimer = setTimeout(() => doBotTick(), delay);
}

async function doBotTick() {
  if (botTickRunning) return;
  const state = roomState;
  if (!state || state.status !== 'playing' || state.hostId !== localUid || !currentRoomId) return;
  botTickRunning = true;
  try {
    // Guided first game: the Profe follows the lesson script (tutorial.js)
    if (LOCAL_GAME) { await tutorialBotTick(state); return; }
    const botId = whoActs(state);
    if (!isBot(botId)) return;
    const bot = state.players.find(p => p.id === botId);
    const lvl = botLevel(state);
    const move = Engine.botMove(state, botId, bot?.persona || 'balanced', {
      random: lvl.random, challenge: lvl.challenge, fair: bot?.persona !== 'bluffer'
    });
    if (!move) return;
    const err = await sendMove(move, botId);
    // a refused move (the table changed meanwhile) is simply tried again next update
    if (err && err !== 'noChange') console.info('[bot]', move.t, err);
  } finally {
    botTickRunning = false;
    // the move may not have changed whose turn it is (e.g. Skip Everyone): go again
    if (roomState && isBot(whoActs(roomState))) scheduleBotTick(roomState);
  }
}

// ¡ÚLTIMA!: bots shout for themselves, and may catch a person who forgot
function scheduleBotLastCard(state) {
  if (LOCAL_GAME) return;   // in the guided game nobody catches you
  const u = state.uno;
  const key = u ? `${u.pid}|${u.at}` : null;
  if (key === botUnoKey) return;
  clearTimeout(botUnoTimer);
  botUnoKey = key;
  if (!u) return;
  const lvl = botLevel(state);
  if (isBot(u.pid)) {
    botUnoTimer = setTimeout(() => {
      if (roomState?.uno?.pid === u.pid && roomState.uno.at === u.at) sendMove({ t: 'shout' }, u.pid);
    }, lvl.shoutMs * (0.7 + Math.random() * 0.6));
    return;
  }
  // a person: a bot may catch them if they haven't shouted in time
  const catchers = state.players.filter(p => isBot(p.id) && !p.disconnected);
  if (!catchers.length || Math.random() > lvl.catch) return;
  const by = catchers[Math.floor(Math.random() * catchers.length)];
  botUnoTimer = setTimeout(() => {
    if (roomState?.uno?.pid === u.pid && roomState.uno.at === u.at) sendMove({ t: 'catch' }, by.id);
  }, lvl.catchMs * (0.8 + Math.random() * 0.5));
}

// ============================================================
// START
// ============================================================
init();
updateNotifButton();
updateMusicButton();
