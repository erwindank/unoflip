// ============================================================
// Guided first game (¡VOLTEA!)
//
// A short game on this device only, against "Profe Volteo", with a fixed deck so every
// lesson works:
//   1 match the colour            5 play a wild and pick a colour
//   2 play a +1                   6 play down to one card
//   3 play ◐ Volteo (to Night)    7 shout ¡ÚLTIMA!
//   4 play Skip Everyone           8 play your last card and win
//
// While LOCAL_GAME is on, mutateRoom() (app.js) sends every change to localMutate()
// below instead of Firestore: the same rules engine runs on an in-memory room and the
// game is redrawn through onRoomUpdate(). Nothing is saved and it doesn't count in
// your stats.
// ============================================================

let LOCAL_GAME = false;
const TUT_BOT = 'bot_profe', TUT_ME_FALLBACK = 'tut-me';

addStrings({
  'tut.open':  ['🎓 ¿Primera vez? Aprende jugando (2 min)', '🎓 First time? Learn by playing (2 min)'],
  'tut.bot':   ['Profe Volteo', 'Prof. Flip'],
  'tut.step':  ['Paso {n} de 8', 'Step {n} of 8'],
  'tut.skip':  ['Salir del tutorial', 'Leave tutorial'],
  'tut.s1': ['Juega una carta que coincida en <b>color o número</b> con la de la mesa. Toca el <b>Rojo 5</b>.', 'Play a card that matches the table card\'s <b>colour or number</b>. Tap the <b>Red 5</b>.'],
  'tut.s2': ['¡Ataca! El <b>Rojo +1</b> hace que el Profe robe 1 y pierda su turno — así vuelves a jugar tú. Tócalo.', 'Attack! The <b>Red +1</b> makes the Prof draw 1 and lose his turn — so you play again. Tap it.'],
  'tut.s3': ['Mira las cartas pequeñas del Profe: es <b>el otro lado</b> de lo que tiene. Ahora toca el <b>◐ Volteo</b>: ¡todo el juego se da la vuelta al 🌙 Lado Noche!', 'Look at the Prof\'s small cards: that\'s <b>the other side</b> of what he holds. Now tap the <b>◐ Flip</b>: the whole game turns over to the 🌙 Night side!'],
  'tut.s4': ['🌙 ¡Noche! Tus cartas cambiaron y las de Noche son más duras. Juega <b>Cian Salta a todos</b>: todos pierden el turno y vuelves a jugar.', '🌙 Night! Your cards changed, and Night cards are harsher. Play <b>Cyan Skip Everyone</b>: everyone loses their turn and you play again.'],
  'tut.s5': ['Un <b>Comodín</b> va sobre cualquier carta y eliges el color. Tócalo y elige <b>Violeta</b>.', 'A <b>Wild</b> goes on any card and you pick the colour. Tap it and pick <b>Violet</b>.'],
  'tut.s6': ['Juega el <b>Violeta 8</b>. Te quedará una sola carta…', 'Play the <b>Violet 8</b>. You\'ll have just one card left…'],
  'tut.s7': ['¡Grita <b>¡ÚLTIMA!</b> antes de que te pillen (si te pillan, robas 2).', 'Shout <b>LAST CARD!</b> before someone catches you (if they do, you draw 2).'],
  'tut.s8': ['Juega tu última carta, el <b>Violeta 3</b>, y gana.', 'Play your last card, the <b>Violet 3</b>, and win.'],
  'tut.wait':  ['Turno del Profe… mira lo que hace.', "The Prof's turn… watch what he does."],
  'tut.doneT': ['¡Ganaste tu primera ronda!', 'You won your first round!'],
  'tut.done':  ['Ya sabes lo básico. Aún te quedan sorpresas: el <b>Comodín +2</b>, el <b>+5</b> y el <b>Comodín Roba Color</b> de la Noche, y los <b>⚖️ desafíos</b>. Míralos en las reglas o mantén pulsada una carta.',
                'You know the basics. More surprises are waiting: the <b>Wild +2</b>, Night\'s <b>+5</b> and <b>Wild Draw Colour</b>, and <b>⚖️ challenges</b>. See the rules or hold a card.'],
  'tut.again': ['Jugar contra bots', 'Play against bots'],
  'tut.home':  ['Volver al inicio', 'Back to start']
});
// This file loads after extras.js already filled in the page text, so fill it in again
// for the keys added just above (e.g. the winner screen's "Back to start")
applyStaticI18n();

// ---------- In-memory room (used by mutateRoom in app.js) ----------
const LocalRoom = { data: null };
const tutClone = o => JSON.parse(JSON.stringify(o));
let _localTimer = null;
function localMutate(fn) {
  if (!LocalRoom.data) return 'noRoom';
  const patch = fn(tutClone(LocalRoom.data));
  if (!patch || typeof patch === 'string') return patch || 'noChange';
  Object.assign(LocalRoom.data, tutClone(patch));
  // redraw on the next tick, like a database update arriving
  clearTimeout(_localTimer);
  _localTimer = setTimeout(() => {
    if (!LOCAL_GAME || !LocalRoom.data) return;
    roomState = tutClone(LocalRoom.data);
    onRoomUpdate(roomState);
  }, 0);
  return null;
}

// ---------- The lesson's cards (Day face / Night face) ----------
let _tid = 500;
const tc = (L, D) => ({ id: _tid++, L: { c: L[0], v: L[1] }, D: { c: D[0], v: D[1] } });
// my hand, in the order the lesson plays it (step number = position + 1, step 7 = shout)
const TUT_MINE = () => [
  tc(['red', '5'],      ['orange', '6']),
  tc(['red', 'draw1'],  ['magenta', '2']),
  tc(['red', 'flip'],   ['cyan', '7']),        // after flipping, Cyan 7 ends up on the table
  tc(['blue', '8'],     ['cyan', 'skipAll']),
  tc(['green', '2'],    ['wild', 'wild']),
  tc(['yellow', '4'],   ['violet', '8']),
  tc(['blue', '1'],     ['violet', '3'])
];
const TUT_STEPS = [1, 2, 3, 4, 5, 6, 8];   // step shown for each of my cards above
const TUT_BOT_HAND = () => [
  tc(['red', '8'],     ['orange', '9']),       // Day: answers my Red 5
  tc(['green', '7'],   ['cyan', '2']),         // Night: answers the Cyan 7
  tc(['blue', '2'],    ['violet', '4']),       // Night: answers my Violet wild
  tc(['yellow', '9'],  ['violet', '1']),       // Night: answers my Violet 8
  tc(['yellow', '6'],  ['orange', '4']),
  tc(['green', '9'],   ['magenta', '5']),
  tc(['blue', '6'],    ['magenta', '6'])
];
let _tutMine = [];

function startTutorial() {
  closeRules();
  LOCAL_GAME = true;
  if (!localUid) localUid = TUT_ME_FALLBACK;
  const me = localUid;
  const raw = document.getElementById('player-name').value.trim() || t('land.defaultName');
  localName = selectedEmoji ? `${selectedEmoji} ${raw}` : raw;
  currentRoomId = 'TUTORIAL';
  _tid = 500;
  _tutMine = TUT_MINE();
  const st = Engine.newRound([
    { id: me, name: localName },
    { id: TUT_BOT, name: `🌗 ${t('tut.bot')}`, isBot: true, persona: 'balanced' }
  ], { matchTarget: 0 });
  st.hands = { [me]: tutClone(_tutMine), [TUT_BOT]: TUT_BOT_HAND() };
  st.discard = [tc(['red', '3'], ['orange', '1'])];
  st.topColor = 'red'; st.topValue = '3';
  // the Profe's +1 card comes from here
  st.drawPile = [tc(['yellow', '2'], ['magenta', '9']), ...Array.from({ length: 30 }, (_, i) =>
    tc([['green', 'yellow', 'blue'][i % 3], String(1 + i % 9)], [['orange', 'magenta'][i % 2], String(1 + (i + 4) % 9)]))];
  st.players = st.players.map(p => ({ ...p, cardCount: st.hands[p.id].length }));
  st.currentPlayerIndex = 0;
  st.log = [];
  LocalRoom.data = { ...st, game: GAME_TAG, hostId: me, endVotes: [], botLevel: 'easy' };
  document.body.classList.add('tutorial');
  fxPrevState = null;
  roomState = tutClone(LocalRoom.data);
  onRoomUpdate(roomState);
}

// Which lesson we're on, read from the game itself
function tutorialStep(state) {
  const me = localUid;
  if (state.uno?.pid === me) return 7;
  if (!isMyTurn(state)) return 0;
  const hand = state.hands?.[me] || [];
  const k = _tutMine.findIndex(c => hand.some(h => h.id === c.id));
  return k >= 0 ? TUT_STEPS[k] : 0;
}
function tutorialWantId(step) {
  const k = TUT_STEPS.indexOf(step);
  return k >= 0 && step !== 7 ? _tutMine[k].id : null;
}
function tutorialAllowsCard(card) { return card.id === tutorialWantId(tutorialStep(roomState)); }
function tutorialAllowsDraw() { return false; }
function tutorialAllowsShout(kind) { return kind === 'shout'; }
// The lesson needs Violet after the wild (the Profe answers with Violet cards)
function tutorialColor() { return 'violet'; }

function tutorialRender(state) {
  let coach = document.getElementById('coach');
  if (!coach) {
    coach = document.createElement('div');
    coach.id = 'coach';
    coach.className = 'coach';
    document.querySelector('.hand-area')?.before(coach);
  }
  const step = tutorialStep(state);
  coach.innerHTML = `
    <div class="coach-head"><span class="coach-step">${step ? t('tut.step', { n: step }) : ''}</span>
      <button type="button" class="link-btn coach-skip" onclick="endTutorial()">${t('tut.skip')}</button></div>
    <div class="coach-text">${step ? t('tut.s' + step) : t('tut.wait')}</div>`;
  coach.classList.toggle('waiting', !step);
  const want = tutorialWantId(step);
  document.querySelectorAll('#player-hand .card[data-id]').forEach(el => {
    el.classList.toggle('coach-pulse', +el.dataset.id === want);
  });
}

// The Profe plays whatever fits (his hand is built so the fitting card is the scripted
// one); called from doBotTick instead of the normal bot brain
async function tutorialBotTick(state) {
  if (state.status !== 'playing' || whoActs(state) !== TUT_BOT) return;
  if (state.uno?.pid === localUid) return;   // waiting for me to shout first
  const move = Engine.botMove(state, TUT_BOT, 'balanced', { fair: true, challenge: 0 });
  if (move) await sendMove(move, TUT_BOT);
}

function tutorialOutro() {
  document.getElementById('coach')?.remove();
  let m = document.getElementById('tut-outro');
  if (!m) {
    m = document.createElement('div');
    m.id = 'tut-outro';
    m.className = 'spotify-modal';
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="spotify-modal-card tut-card">
    <div class="tut-trophy">🏆</div>
    <h3 class="spotify-modal-title">${t('tut.doneT')}</h3>
    <p class="spotify-modal-desc">${t('tut.done')}</p>
    <div class="spotify-modal-btns">
      <button class="btn btn-primary" onclick="endTutorial(); handleQuickBots();">🤖 ${t('tut.again')}</button>
      <button class="btn btn-ghost" onclick="endTutorial()">${t('tut.home')}</button>
    </div>
  </div>`;
  m.classList.remove('hidden');
  try { localStorage.setItem('volteaTutorialDone', '1'); } catch (_) {}
  updateTutorialLink();
}

function endTutorial() {
  LOCAL_GAME = false;
  LocalRoom.data = null;
  if (localUid === TUT_ME_FALLBACK) localUid = auth.currentUser?.uid || null;
  _celebrated = null;
  roomState = null;
  currentRoomId = null;
  fxPrevState = null;
  document.body.classList.remove('tutorial', 'side-D');
  document.getElementById('coach')?.remove();
  document.getElementById('tut-outro')?.remove();
  ['uno-call-overlay', 'claim-dialog', 'challenge-area'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  FX.layer().innerHTML = '';
  showScreen('landing');
}

function updateTutorialLink() {
  const el = document.getElementById('tutorial-link');
  if (!el) return;
  el.innerHTML = t('tut.open');
  let seen = false;
  try { seen = !!localStorage.getItem('volteaTutorialDone') || loadMyStats().games > 0; } catch (_) {}
  el.classList.toggle('first-time', !seen);
}
document.addEventListener('langchange', updateTutorialLink);
updateTutorialLink();
