// ============================================================
// I18N — Spanish / English text
//
// t('key', { name: 'Ana' }) returns the text in the chosen language, with {name}
// replaced. Missing English keys fall back to Spanish, missing keys show the key.
// Loaded before every other script so all of them can use t().
//
// The game log is saved as { k: 'log.play', p: {...} } (see engine.js), so every
// player reads it in their own language — no translating of saved sentences needed.
// ============================================================

const I18N = { es: {}, en: {} };

// The chosen language: saved per device, Spanish by default
let LANG = (() => {
  try { return localStorage.getItem('volteaLang') === 'en' ? 'en' : 'es'; } catch (_) { return 'es'; }
})();
try { document.documentElement.lang = LANG; } catch (_) {}

function t(key, params) {
  let s = I18N[LANG]?.[key] ?? I18N.es[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}

// Adds a block of strings: addStrings({ key: ['español', 'English'], ... })
function addStrings(map) {
  for (const [k, [es, en]] of Object.entries(map)) {
    I18N.es[k] = es;
    I18N.en[k] = en ?? es;
  }
}

// English only: for fixed text in index.html, whose Spanish is written in the page
function addEnglish(map) { Object.assign(I18N.en, map); }

// Switches language, saves it, and tells the page to redraw ('langchange' event)
function setLanguage(lang) {
  LANG = lang === 'en' ? 'en' : 'es';
  try { localStorage.setItem('volteaLang', LANG); } catch (_) {}
  document.documentElement.lang = LANG;
  applyStaticI18n();
  document.dispatchEvent(new Event('langchange'));
}

// Fixed text in index.html: elements with data-i18n="key" (text) or
// data-i18n-ph="key" (placeholder) / data-i18n-title="key" (tooltip).
// The Spanish text written in the HTML is kept as the fallback.
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18nEs === undefined) el.dataset.i18nEs = el.innerHTML;
    const k = el.dataset.i18n;
    el.innerHTML = (LANG === 'es' || !I18N.en[k]) ? (I18N.es[k] ?? el.dataset.i18nEs) : I18N.en[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    if (el.dataset.i18nPhEs === undefined) el.dataset.i18nPhEs = el.placeholder;
    el.placeholder = I18N[LANG][el.dataset.i18nPh] ?? el.dataset.i18nPhEs;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    if (el.dataset.i18nTitleEs === undefined) el.dataset.i18nTitleEs = el.title;
    el.title = I18N[LANG][el.dataset.i18nTitle] ?? el.dataset.i18nTitleEs;
  });
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('selected', b.dataset.lang === LANG));
}

const colorLabel = c => t('color.' + c);

// ---- Cards and sides ----
addStrings({
  'side.L': ['Lado Día', 'Day side'], 'side.D': ['Lado Noche', 'Night side'],
  'color.red': ['Rojo', 'Red'], 'color.yellow': ['Amarillo', 'Yellow'], 'color.green': ['Verde', 'Green'], 'color.blue': ['Azul', 'Blue'],
  'color.magenta': ['Magenta', 'Magenta'], 'color.cyan': ['Cian', 'Cyan'], 'color.orange': ['Naranja', 'Orange'], 'color.violet': ['Violeta', 'Violet'],
  'color.wild': ['Comodín', 'Wild'],
  'card.draw1': ['+1', '+1'], 'card.draw5': ['+5', '+5'], 'card.reverse': ['Reversa', 'Reverse'],
  'card.skip': ['Salto', 'Skip'], 'card.skipAll': ['Salta a todos', 'Skip Everyone'], 'card.flip': ['Volteo', 'Flip'],
  'card.wild': ['Comodín', 'Wild'], 'card.wild2': ['Comodín +2', 'Wild +2'], 'card.wildColor': ['Comodín Roba Color', 'Wild Draw Colour']
});

// ---- The game log (engine.js writes {k, p}) ----
// {name}/{target} are players, {card} the card played, {color} a colour, {side} a side
addStrings({
  'log.start':        ['¡Partida iniciada en el ☀️ Lado Día! Empieza {name}.', 'Game on, ☀️ Day side up! {name} starts.'],
  'log.play':         ['{name} jugó {card}.', '{name} played {card}.'],
  'log.playWild':     ['{name} jugó {card} y eligió {color}.', '{name} played {card} and chose {color}.'],
  'log.drawSkip':     ['{name} roba {n} y pierde su turno.', '{name} draws {n} and loses their turn.'],
  'log.skip':         ['{name} pierde su turno.', '{name} loses their turn.'],
  'log.skipAll':      ['¡{name} salta a todos y vuelve a jugar!', '{name} skips everyone and plays again!'],
  'log.reverse':      ['¡Cambio de sentido!', 'Direction reversed!'],
  'log.flip':         ['🔄 ¡{name} VOLTEÓ el juego! Ahora: {side} — sale {card}.', '🔄 {name} FLIPPED the game! Now: {side} — up comes {card}.'],
  'log.color':        ['{name} eligió {color}.', '{name} chose {color}.'],
  'log.wildDraw':     ['{name} jugó {what} ({color}). {target}: ¿aceptar o desafiar?', '{name} played {what} ({color}). {target}: accept or challenge?'],
  'log.accept':       ['{name} aceptó y robó {n}.', '{name} accepted and drew {n}.'],
  'log.challengeWon': ['⚖️ ¡{name} ganó el desafío! {by} tenía el color y roba {n}.', '⚖️ {name} won the challenge! {by} had the colour and draws {n}.'],
  'log.challengeLost':['⚖️ El juego de {by} era limpio: {name} roba {n} y pierde su turno.', "⚖️ {by}'s play was fair: {name} draws {n} and loses their turn."],
  'log.drewPass':     ['{name} robó una carta y pasó.', '{name} drew a card and passed.'],
  'log.pass':         ['{name} pasó (no quedan cartas para robar).', '{name} passed (no cards left to draw).'],
  'log.shout':        ['📣 ¡{name} grita ¡ÚLTIMA!', '📣 {name} shouts LAST CARD!'],
  'log.caught':       ['🚨 {name} pilló a {target} sin gritar: {target} roba 2.', "🚨 {name} caught {target} not shouting: {target} draws 2."],
  'log.reshuffle':    ['Se acabó el mazo: se barajó el descarte.', 'The deck ran out: the discard pile was shuffled.'],
  'log.win':          ['🏆 ¡{name} se quedó sin cartas! +{pts} puntos.', '🏆 {name} is out of cards! +{pts} points.'],
  'log.timeout':      ['⏰ {name} se quedó sin tiempo.', '⏰ {name} ran out of time.'],
  'log.skipGone':     ['Se saltó el turno de {name} (desconectado).', "{name}'s turn was skipped (disconnected)."],
  'log.gone':         ['{name} se desconectó.', '{name} disconnected.'],
  'log.back':         ['{name} se reconectó.', '{name} reconnected.'],
  'log.joined':       ['{name} se unió a la partida.', '{name} joined the game.'],
  'log.left':         ['{name} salió de la partida.', '{name} left the game.'],
  'log.vote':         ['{name} propone terminar ({n}/{t}).', '{name} wants to end the game ({n}/{t}).'],
  'log.unvote':       ['{name} retiró su voto para terminar.', '{name} withdrew their vote to end.']
});

// ---- Game words (app.js) ----
addStrings({
  'ui.copy': ['Copiar', 'Copy'], 'ui.copied': ['¡Copiado!', 'Copied!'], 'ui.cancel': ['Cancelar', 'Cancel'],
  'ui.close': ['Cerrar', 'Close'], 'ui.retry': ['Reintentar', 'Try again'], 'ui.disconnect': ['Desconectar', 'Disconnect'],
  'ui.someone': ['Alguien', 'Someone'], 'chat.me': ['(yo)', '(me)'],
  'err.name': ['Escribe tu nombre primero', 'Type your name first'],
  'err.connecting': ['Aún conectando… intenta de nuevo', 'Still connecting… try again'],
  'err.code': ['Introduce el código de sala de 6 caracteres', 'Enter the 6-character room code'],
  'err.notFound': ['Sala no encontrada', 'Room not found'],
  'err.ended': ['La partida ya terminó', 'That game has already ended'],
  'err.started': ['La partida ya comenzó', 'That game has already started'],
  'err.full': ['Sala llena (máximo {n})', 'Room full (max {n})'],
  'lob.removeBot': ['Quitar bot', 'Remove bot'], 'lob.back': ['vuelve', 'back'], 'lob.readyBadge': ['✓ listo', '✓ ready'],
  'lob.dc': ['desconectado', 'disconnected'], 'lob.ready': ['✓ Estás listo para jugar', "✓ You're ready to play"],
  'lob.again': ['¡Quiero jugar de nuevo!', 'I want to play again!'], 'lob.start': ['Iniciar partida', 'Start game'],
  'lob.waitingPlayers': ['Esperando jugadores…', 'Waiting for players…'], 'lob.addBot': ['+ Añadir bot', '+ Add bot'],
  'vc.title': ['Chat de voz', 'Voice chat'], 'vc.opened': ['{name} abrió el micrófono', '{name} turned their mic on'],
  'vc.left': ['{name} dejó el chat de voz', '{name} left voice chat'], 'vc.muted': ['{name} silenció el micrófono', '{name} muted their mic'],
  'vc.unmuted': ['{name} activó el micrófono', '{name} unmuted their mic'], 'vc.noMic': ['No se pudo acceder al micrófono', 'Could not use the microphone'],
  'vc.join': ['Unirse al chat de voz', 'Join voice chat'], 'vc.mute': ['Silenciar micrófono', 'Mute microphone'], 'vc.leave': ['Salir del chat de voz', 'Leave voice chat'],
  'uno.mine': ['¡Solo te queda 1 carta!', 'You only have 1 card left!'], 'uno.shout': ['¡ÚLTIMA!', 'LAST CARD!'],
  'uno.other': ['¡{name} tiene 1 carta y no ha gritado!', "{name} has 1 card and hasn't shouted!"],
  'uno.callOn': ['¡PILLAR A {name}!', 'CATCH {name}!'],
  'st.yourTurn': ['✨ ¡Tu turno! Elige una carta.', '✨ Your turn! Pick a card.'],
  'st.turnOf': ['Turno de {name}', "{name}'s turn"],
  'st.youDecide': ['⚖️ ¿Aceptas o desafías?', '⚖️ Accept or challenge?'],
  'st.decides': ['⚖️ {name} decide si desafiar…', '⚖️ {name} is deciding whether to challenge…'],
  'st.youColor': ['🎨 Elige el color', '🎨 Pick the colour'],
  'st.picksColor': ['🎨 {name} elige el color…', '🎨 {name} is picking the colour…'],
  'hand.drawnOk': ['¡Robaste una carta que sirve! Juégala o pasa.', 'You drew a card you can play! Play it or pass.'],
  'hand.pick': ['Tu turno — toca una carta para jugarla', 'Your turn — tap a card to play it'],
  'hand.count': ['Tu mano ({n})', 'Your hand ({n})'],
  'toi.you': ['tu turno', 'your turn'], 'toi.prev': ['anterior', 'previous'], 'toi.next': ['siguiente', 'next'],
  'opp.otherSide': ['Ves el otro lado de sus cartas', 'You see the other side of their cards'],
  'nt.on': ['🔔 Notificaciones activadas', '🔔 Notifications on'], 'nt.onBody': ['Recibirás avisos del juego.', "You'll get game alerts."],
  'nt.disable': ['Desactivar notificaciones', 'Turn off notifications'], 'nt.enable': ['Activar notificaciones', 'Turn on notifications'],
  'nt.started': ['¡La partida comenzó!', 'The game has started!'], 'nt.first': ['{name} va primero.', '{name} goes first.'],
  'nt.won': ['🏆 ¡Ganaste!', '🏆 You won!'], 'nt.over': ['🎉 Ronda terminada', '🎉 Round over'],
  'nt.congrats': ['¡Felicidades!', 'Congratulations!'], 'nt.whoWon': ['Ganó {name}', '{name} won'],
  'nt.yourTurn': ['¡Es tu turno!', "It's your turn!"], 'nt.yourTurnBody': ['Elige una carta para jugar.', 'Pick a card to play.'],
  'nt.challenge': ['Te jugaron un comodín que roba: ¿aceptas o desafías?', 'Someone played a wild draw on you: accept or challenge?'],
  'nt.uno': ['¡Solo te queda 1 carta! Grita ¡ÚLTIMA! antes de que te pillen.', 'Only 1 card left! Shout LAST CARD before someone catches you.'],
  'mu.mute': ['Silenciar música', 'Mute music'], 'mu.play': ['Activar música', 'Play music'],
  'claim.wildTitle': ['Elige el color del Comodín', 'Pick the Wild colour'],
  'claim.drawTitle': ['{card}: elige el color', '{card}: pick the colour'],
  'claim.phaseTitle': ['El Volteo dejó un comodín arriba: tú eliges el color', 'The flip turned up a wild: you pick the colour'],
  'claim.unfair': ['⚠️ Ojo: tienes cartas de {color}. Si te desafían, robas tú.', '⚠️ Careful: you hold {color} cards. If you get challenged, you draw.'],
  'draw.ok': ['Sí, robar', 'Yes, draw'],
  'draw.haveTitle': ['Tienes cartas jugables', 'You have playable cards'],
  'draw.haveBody': ['Tienes cartas que puedes jugar. ¿Quieres robar una de todas formas?', 'You have cards you can play. Draw one anyway?'],
  'notice.ok': ['Entendido', 'Got it'],
  'notice.cantTitle': ['No puedes jugar esta carta', "You can't play this card"],
  'notice.cantBody': ['Tiene que coincidir en color ({color}), número o símbolo con la carta de la mesa. Elige otra o roba.', 'It must match the colour ({color}), number or symbol of the table card. Pick another or draw.'],
  'notice.onlyDrawnTitle': ['Solo la carta que robaste', 'Only the card you drew'],
  'notice.onlyDrawnBody': ['Después de robar solo puedes jugar esa carta (la que brilla) o pasar.', 'After drawing you can only play that card (the glowing one) or pass.'],
  'ch.title': ['{c} te jugó un <b>{card}</b> y eligió {color}.', '{c} played a <b>{card}</b> on you and chose {color}.'],
  'ch.rule': ['Solo es limpio si no tenía ninguna carta de {prev}. Le quedan {n} cartas.', 'It is only fair if they held no {prev} card. They have {n} cards left.'],
  'ch.acceptT': ['Aceptar', 'Accept'], 'ch.challengeT': ['Desafiar', 'Challenge'],
  'ch.take2': ['Robas 2 y pierdes el turno.', 'You draw 2 and lose your turn.'],
  'ch.takeColor': ['Robas hasta que salga {color} y pierdes el turno.', 'You draw until {color} shows up and lose your turn.'],
  'ch.challengeWhy2': ['Si {c} tenía el color, roba 2 él. Si no, robas 4.', 'If {c} had the colour, they draw 2. If not, you draw 4.'],
  'ch.challengeWhyC': ['Si {c} tenía el color, roba él hasta el color. Si no, robas hasta el color + 2.', 'If {c} had the colour, they draw until the colour. If not, you draw until it + 2.'],
  'ch.accept': ['Aceptar', 'Accept'], 'ch.challenge': ['Desafiar', 'Challenge'],
  'ch.waitMine': ['{t} decide si desafiar tu {card}…', '{t} is deciding whether to challenge your {card}…'],
  'ch.waitOther': ['{t} decide si desafiar el {card} de {c}…', "{t} is deciding whether to challenge {c}'s {card}…"],
  'g.leaveQ': ['¿Seguro que quieres salir?', 'Are you sure you want to leave?'],
  'g.leaveBody': ['Si sales ahora tus cartas vuelven al mazo y no saldrás en la puntuación. Si quieres terminar la partida y ver los resultados, vota para finalizar.', "If you leave now your cards go back into the deck and you won't be in the score. To end the game and see the results, vote to end instead."],
  'g.leave': ['Salir', 'Leave'], 'g.stay': ['Quedarme', 'Stay'], 'g.voteEnd': ['Votar terminar', 'Vote to end'],
  'g.votes': ['{n}/{t} quieren terminar', '{n}/{t} want to end'], 'g.withdraw': ['Retirar voto', 'Withdraw vote'], 'g.end': ['Terminar', 'End game'],
  'w.vote': ['🤝 ¡Partida terminada!', '🤝 Game over!'], 'w.last': ['🏆 ¡Último en pie!', '🏆 Last one standing!'],
  'w.winner': ['🎉 ¡Ganador!', '🎉 Winner!'], 'w.roundWin': ['🎉 Ronda {n}', '🎉 Round {n}'],
  'w.champion': ['👑 ¡Campeón de la partida!', '👑 Match champion!'],
  'w.pts': ['+{n} puntos (cartas de los demás, en el {side})', '+{n} points (everyone else\'s cards, on the {side})'],
  'w.ptsMatch': ['+{n} puntos en esta ronda · se juega a {target}', '+{n} points this round · playing to {target}'],
  'w.table': ['Cartas que quedaron', 'Cards left'], 'w.tableMatch': ['Cartas que quedaron · puntos totales', 'Cards left · total points'],
  'w.standing': ['{c} cartas · {p} pts', '{c} cards · {p} pts'],
  'w.again': ['Jugar de nuevo', 'Play again'], 'w.toLobby': ['Volver a la sala', 'Back to the room'],
  'rc.label': ['Reconectando…', 'Reconnecting…'],
  'sp.cancel': ['Cancelaste la conexión con Spotify.', 'You cancelled the Spotify connection.'],
  'sp.session': ['Error de sesión Spotify. Intenta de nuevo.', 'Spotify session error. Try again.'],
  'sp.fetch': ['No se pudo contactar Spotify. Revisa tu conexión.', "Couldn't reach Spotify. Check your connection."],
  'sp.other': ['Error de Spotify: {e}', 'Spotify error: {e}'], 'sp.nothing': ['Sin reproducción activa ahora mismo.', 'Nothing playing right now.'],
  'sp.connected': ['Conectado a Spotify', 'Connected to Spotify'], 'sp.on': ['Spotify conectado', 'Spotify connected'],
  'sp.connectTitle': ['Conectar Spotify', 'Connect Spotify'],
  'sp.desc': ['Comparte lo que estás escuchando con los demás jugadores. Aparecerá en la barra superior.', "Share what you're listening to with the other players. It shows in the top bar."],
  'sp.connectBtn': ['Conectar cuenta', 'Connect account'], 'sp.errTitle': ['Error de Spotify', 'Spotify error'],
  'lf.notFound': ['Usuario no encontrado en Last.fm.', 'User not found on Last.fm.'], 'lf.netError': ['Error de conexión. Intenta de nuevo.', 'Connection error. Try again.'],
  'lf.now': ['Escuchando ahora', 'Listening now'], 'lf.last': ['Última escuchada', 'Last played'], 'lf.none': ['Sin historial de Last.fm.', 'No Last.fm history.'],
  'lf.as': ['Conectado como {name}', 'Connected as {name}'], 'lf.connectTitle': ['Conectar Last.fm', 'Connect Last.fm'],
  'lf.desc': ['Introduce tu usuario de Last.fm para compartir lo que escuchas (funciona con Spotify, Apple Music, Tidal y más).', 'Enter your Last.fm username to share what you listen to (works with Spotify, Apple Music, Tidal and more).'],
  'lf.placeholder': ['Tu usuario de Last.fm', 'Your Last.fm username'], 'lf.connect': ['Conectar', 'Connect']
});

// ---- Fixed text in index.html (its Spanish is written in the page) ----
addEnglish({
  'land.tagline':  'One deck, two sides. When someone flips, everything changes.',
  'land.howTitle': 'How to play',
  'land.how1':     'Play a card that matches the table card\'s <strong>colour, number or symbol</strong>, or a wild. Can\'t? Draw one. Down to one card? Shout <strong>LAST CARD!</strong>',
  'land.how2':     'Every card has two sides. You start on the <strong>☀️ Day side</strong>; a <strong>◐ Flip</strong> card turns the whole game over to the <strong>🌙 Night side</strong> — hands, deck and table — and back again. You can always see the other side of your rivals\' cards.',
  'land.how3':     '<li><strong>☀️ Day</strong>: +1, Reverse, Skip, Flip, Wild and <strong>Wild +2</strong>.</li><li><strong>🌙 Night</strong> is harsher: <strong>+5</strong>, <strong>Skip Everyone</strong> (you play again), Flip, Wild and <strong>Wild Draw Colour</strong> (draw until that colour appears).</li><li>Wild draws are only fair when you hold nothing of the colour in play — the next player can <strong>challenge</strong>.</li>',
  'land.how4':     'Empty your hand to win the round and score the cards everyone else holds. Play a single round or a match to 500.',
  'land.allRules': 'See all the rules →',
  'land.emoji': 'Pick an emoji', 'land.name': 'Your name', 'land.create': 'Create room', 'land.joinCode': 'Join with a code',
  'land.codePh': 'Room code (e.g. XK7M2P)', 'land.join': 'Join', 'land.players': 'Up to 10 players · No account needed',
  'lob.title': 'Waiting room', 'lob.code': 'Code:', 'lob.waitHost': 'Waiting for the host…', 'lob.leave': 'Leave room',
  'lob.share': 'Share the code with friends so they can join',
  'g.copyCode': 'Copy code', 'g.rules': 'Rules', 'g.chat': 'Chat', 'g.drawPile': 'Draw', 'g.discardPile': 'Table',
  'g.pass': 'Pass turn', 'g.playCard': 'Play card', 'g.otherSide': 'other side',
  'w.other': 'Join another room', 'w.next': 'Next round ▶', 'w.nextWait': 'Waiting for the host to deal the next round…',
  'chat.ph': 'Message…',
  'mp.title': 'Background music?', 'mp.desc': 'Adds some atmosphere to the game', 'mp.yes': 'Yes, with music', 'mp.no': 'No music',
  'rules.title': '📖 ¡VOLTEA! rules',
  'rules.goalT': 'Goal', 'rules.goal': 'Be the first to run out of cards. Each card must match the table card\'s <strong>colour</strong> or <strong>number/symbol</strong>, or be a wild. If you can\'t play, draw one: if it fits you may play it straight away, otherwise your turn passes.',
  'rules.sidesT': 'Two sides', 'rules.sides': 'Every card has a <strong>☀️ Day</strong> face (red, yellow, green, blue) and a <strong>🌙 Night</strong> face (magenta, cyan, orange, violet). Everyone plays the same side. You see your own cards\' face and the <strong>other side</strong> of everybody else\'s cards — and of the top card of the deck.',
  'rules.flipT': '◐ Flip', 'rules.flip': 'Turns everything over: hands, deck and the table card, which now shows the Flip card\'s other face (its action doesn\'t count). If that face is a wild, the player who flipped picks the colour. Play continues with the next player.',
  'rules.dayT': '☀️ Day cards', 'rules.day': '<strong>+1</strong> next player draws 1 and loses their turn · <strong>⊘</strong> skip · <strong>⇄</strong> reverse (with 2 players it works like a skip) · <strong>Wild</strong> pick a colour · <strong>Wild +2</strong> pick a colour, the next player draws 2 and loses their turn.',
  'rules.nightT': '🌙 Night cards', 'rules.night': '<strong>+5</strong> next player draws 5 and loses their turn · <strong>⊘⊘ Skip Everyone</strong> everyone else is skipped and you play again · <strong>⇄</strong> reverse · <strong>Wild</strong> · <strong>Wild Draw Colour</strong> pick a colour, the next player draws until that colour appears and loses their turn.',
  'rules.chT': '⚖️ Challenge', 'rules.ch': 'Wild +2 and Wild Draw Colour are only fair if you hold no card of the colour in play. The next player can <strong>accept</strong> or <strong>challenge</strong>. Caught out? You take the cards and they keep their turn. Fair? They take the cards plus 2 more.',
  'rules.unoT': '📣 LAST CARD!', 'rules.uno': 'When you have one card left, shout <strong>LAST CARD!</strong>. If someone catches you first, you draw 2.',
  'rules.ptsT': '🏆 Points', 'rules.pts': 'The round winner scores everyone else\'s cards (on the side that is up): numbers = their value, +1 = 10, Reverse/Skip/Flip/+5 = 20, Skip Everyone = 30, Wild = 40, Wild +2 = 50, Wild Draw Colour = 60. In a match, the first to 500 wins.',
  'rules.hereT': 'How to play here', 'rules.here': 'On your turn each card shows <strong>✓</strong> if you can play it and <strong>✕</strong> if not. Hold a card to see it big with its rule (like at a real table, you can\'t see the back of your own cards). Tap another player to throw something at them.',
  'rules.ok': 'Got it'
});
