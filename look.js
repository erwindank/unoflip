// ============================================================
// VOLTEO — NEW LOOK (the 7 ideas of the UNO Fiesta new look, made for both sides, 2026-11-23)
//
// Loaded BEFORE app.js. app.js asks these helpers for the card faces when they exist:
//   lookIconHTML(value)              — drawn centre picture (reverse, skip, skip all, flip) or ''
//   lookCornerHTML(value, side, pos) — small corner label / picture
//   lookWildCenterHTML(value, side)  — disc in the side's four colours + "+2" / "+?"
// Later steps add the table ring, seats, title screen and movement below.
// ============================================================

// ---- 1. Card pictures ----------------------------------------------------
// Every picture is drawn in the card's colour (currentColor) with a dark outline,
// so the same drawing works on all eight colours, on the white sun disc and on the night ring.
const LOOK_OUT = '#120a1f';
const _S = `stroke="${LOOK_OUT}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"`;
// one ⊘ (ring with a bar), used once for Salto and twice for Salta a todos
const _skipRing = (cx, cy, r, w) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${LOOK_OUT}" stroke-width="${w + 10}"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"/>` +
  `<path d="M${cx - r * .68} ${cy + r * .68} L${cx + r * .68} ${cy - r * .68}" stroke="${LOOK_OUT}" stroke-width="${w + 10}" stroke-linecap="round"/>` +
  `<path d="M${cx - r * .68} ${cy + r * .68} L${cx + r * .68} ${cy - r * .68}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/>`;
const LOOK_ICONS = {
  // ⊘ Salto
  skip: `<svg viewBox="0 0 100 100" aria-hidden="true">${_skipRing(50, 50, 34, 12)}</svg>`,
  // ⊘⊘ Salta a todos: two rings, one behind the other
  skipAll: `<svg viewBox="0 0 100 100" aria-hidden="true">${_skipRing(36, 38, 24, 9)}${_skipRing(64, 62, 24, 9)}</svg>`,
  // ⇄ Reversa: two arrows pointing opposite ways
  reverse: `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-45 50 50)"><path d="M14 28 H56 V14 L84 33 L56 52 V38 H14 Z" fill="currentColor" ${_S}/><path d="M86 62 H44 V48 L16 67 L44 86 V72 H86 Z" fill="currentColor" ${_S}/></g></svg>`,
  // ◐ Volteo: a disc that is half sun, half moon, with two arrows turning round it
  flip: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 22 A28 28 0 0 0 50 78 Z" fill="#ffd24a" ${_S}/>
    <path d="M50 22 A28 28 0 0 1 50 78 Z" fill="#7c3aed" ${_S}/>
    <path d="M58 36 A12 12 0 1 0 58 64 A16 16 0 0 1 58 36 Z" fill="#f3eeff"/>
    <path d="M20 30 A38 38 0 0 1 70 14" fill="none" stroke="${LOOK_OUT}" stroke-width="14" stroke-linecap="round"/>
    <path d="M20 30 A38 38 0 0 1 70 14" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    <path d="M64 4 L82 16 L62 26 Z" fill="currentColor" ${_S} stroke-width="4"/>
    <path d="M80 70 A38 38 0 0 1 30 86" fill="none" stroke="${LOOK_OUT}" stroke-width="14" stroke-linecap="round"/>
    <path d="M80 70 A38 38 0 0 1 30 86" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    <path d="M36 96 L18 84 L38 74 Z" fill="currentColor" ${_S} stroke-width="4"/>
  </svg>`
};

function lookIconHTML(value) {
  const svg = LOOK_ICONS[value];
  return svg ? `<span class="card-icon">${svg}</span>` : '';
}

// The four colours of a side as a conic gradient (Day: red/blue/green/yellow, Night: magenta/violet/cyan/orange)
function lookQuadBG(side) {
  const c = Engine.SIDES[side].colors.map(x => CARD_HEX[x]);
  return `conic-gradient(${c[0]} 0 25%, ${c[3]} 0 50%, ${c[2]} 0 75%, ${c[1]} 0)`;
}

function lookCornerHTML(value, side, pos) {
  // plain wild: a tiny four-colour square instead of a star
  if (value === 'wild') return `<span class="card-label ${pos} has-icon"><span class="corner-quad" style="background:${lookQuadBG(side)}"></span></span>`;
  const svg = LOOK_ICONS[value];
  if (svg) return `<span class="card-label ${pos} has-icon">${svg}</span>`;
  return `<span class="card-label ${pos}">${symbolOf(value)}</span>`;
}

function lookWildCenterHTML(value, side) {
  // the disc keeps the side's four colours even after a colour was picked (the ring shows the pick)
  const lbl = symbolOf(value);
  return `<span class="wild-disc" style="background:${lookQuadBG(side)}"></span>${lbl ? `<span class="card-label center">${lbl}</span>` : ''}`;
}

// Card that flies out of the deck: a clean badge (half sun, half moon) and the name
function lookBackHTML(side) {
  return `<div class="card card-back-generic lk-back s-${side}"><span class="lk-back-disc"></span><span class="lk-back-name">VOLTEO</span></div>`;
}

// ---- 2. Table: direction ring around the piles ----------------------------
// Called from renderStatus() in app.js on every render. Keeps one SVG ring inside
// .pile-area; the dashes march clockwise (direction 1) or the other way (-1).
let _lookDir = null;
function lookDirectionRing(direction) {
  const area = document.querySelector('#screen-game .pile-area');
  if (!area) return;
  let ring = area.querySelector('.dir-ring');
  if (!ring) {
    ring = document.createElement('div');
    ring.className = 'dir-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="48" ry="46" vector-effect="non-scaling-stroke"/></svg>
      <span class="dir-arrow dir-arrow-r"></span><span class="dir-arrow dir-arrow-l"></span>`;
    area.prepend(ring);
  }
  ring.classList.toggle('ccw', direction !== 1);
  // a quick flash when a Reverse changes the direction
  if (_lookDir !== null && _lookDir !== direction) {
    ring.classList.remove('flip'); void ring.offsetWidth; ring.classList.add('flip');
  }
  _lookDir = direction;
}
