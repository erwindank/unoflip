# ¡VOLTEA! build plan (2026-11-22)

A two-sided card game ("flip" style) built to the same standard as UNO Fiesta, UNO Mentiroso
and VIRUS!, with its own name and look (not the Mattel product's name or art).

- ☀️ **Day side**: red / yellow / green / blue — +1, Reverse, Skip, Volteo, Wild, Wild +2
- 🌙 **Night side**: magenta / cyan / orange / violet — +5, Reverse, Skip Everyone, Volteo,
  Wild, Wild Draw Colour
- A **Volteo** card turns the whole game over: hands, draw pile and the table card
  (which then shows the Volteo card's other face). You always see the *other* face of
  everybody else's cards — and of the top card of the draw pile.
- **¡ÚLTIMA!** — shout it when you're down to one card, or get caught (+2).
- Wild +2 / Wild Draw Colour are only fair with no card of the colour in play; the next
  player can accept or challenge. Rounds score points; optional match to 500.

## How it's built (what's better than the other three games)
- `engine.js` — **all rules in one place**, no screen/Firebase code. Every move (players, bots,
  guided game, timer) goes through `Engine.apply(state, move, actor)`.
- app.js saves each move in **one Firestore transaction** (no half-overwritten rooms).
- Effects/stats read **events** the engine writes (`state.ev`), not log text.
- Log entries are `{k, p}` and translated at display time (ES/EN), never regex-translated.
- `node test-engine.js` checks each card by hand and plays thousands of bot games
  (no lost/copied cards, games always end, state always saveable to Firestore).
- Rooms are tagged `game: 'voltea'` (the games share the Firestore 'rooms' collection).

## Steps
1. [x] Rules engine + tests
2. [ ] App shell: index.html, style (two-sided cards, Day/Night table), landing, lobby
3. [ ] Game screen on the engine: hand, table, opponents' visible other faces, draw pile,
       colour picker, challenge panel, ¡ÚLTIMA!, log; chat/voice/music/Spotify/Last.fm from Fiesta
4. [ ] Bots (personalities + levels) and practice mode
5. [ ] fx.js (flying cards, the big flip animation, stamps, sounds) + extras.js (faces, timer,
       zoom, menu, awards, stats, badges, invites/QR, throws, reconnect)
6. [ ] Guided first game, ES/EN, rules window
7. [ ] Icons, manifest, service worker, browser tests
