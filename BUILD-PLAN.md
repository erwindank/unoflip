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
2. [x] App shell: index.html, style (two-sided cards, Day/Night table), landing, lobby
3. [x] Game screen on the engine: hand, table, opponents' visible other faces, draw pile,
       colour picker, challenge panel, ¡ÚLTIMA!, log; chat/voice/music/Spotify/Last.fm from Fiesta
4. [x] Bots (5 personalities + 3 levels) and one-tap "play against bots"
5. [x] fx.js (flying cards, the big flip animation, stamps, sounds) + extras.js (faces, timer,
       zoom, menu, awards, stats, badges, invites/QR, throws, reconnect)
6. [x] Guided first game, ES/EN, rules window
7. [x] Icons, manifest, service worker, browser tests

## Testing notes
- `node test-engine.js [games]` — rules by hand + thousands of bot games (2–10 players,
  joins/leaves/disconnects, shouts/catches); checks no card is lost or copied, cardCount stays
  in sync, every game ends, and every state can be saved to Firestore.
- Browser checks (2026-11-22) ran with Playwright against an in-memory stand-in for Firebase,
  so no test rooms were written to the live database: guided game to the end, a full game
  against 3 bots (Day → Night flips, winner screen, badge), English, the challenge panel +
  stamp, and a match to 500 into round 2 with points kept. No page errors.
- Not yet tried: two real devices in the same online room.

## Before going live
- GitHub Pages: Settings → Pages → deploy from `master`, root. The game will then be at
  erwindank.github.io/unoflip/.
- Spotify sharing sends people back to this page after logging in: add
  `https://erwindank.github.io/unoflip/` to the Spotify app's Redirect URIs.
