'use strict';
/* Garuda Senja — Island Ring Run.
   Original arcade flight game: chase view behind a bush plane over a
   procedurally drawn Indonesian archipelago at golden hour. Fly through
   six glowing rings, then land on the island runway. Pure canvas 2D,
   no network, no libraries. Sounds are synthesised with WebAudio. */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;
const TAU = Math.PI * 2;

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = parseInt(params.get('seed') || '1', 10) || 1;

/* Deterministic RNG so screenshots are reproducible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

/* ---------------- world ---------------- */
/* x: east, y: up (metres), z: south (heading 0 = north = -z). Sea level y = 0. */
const ISLANDS = [
  { x: 0,    z: -420, r: 280, peak: 74, volcano: true  }, /* main island, Gunung Senja */
  { x: -380, z: -180, r: 150, peak: 30, volcano: false },
  { x: 340,  z: -260, r: 175, peak: 36, volcano: false },
  { x: -190, z: -780, r: 135, peak: 24, volcano: false },
  { x: 400,  z: -720, r: 115, peak: 20, volcano: false },
  { x: 120,  z: -950, r: 90,  peak: 14, volcano: false },
  { x: -520, z: -620, r: 80,  peak: 12, volcano: false },
];
const RUNWAY = { x: 60, z: -260, len: 130, wid: 15, padY: 30, hdg: 0 };
const RINGS = [
  { x: 60,   y: 80, z: -470, r: 10 },
  { x: -180, y: 56, z: -620, r: 10 },
  { x: -330, y: 44, z: -330, r: 10 },
  { x: 60,   y: 88, z: -420, r: 10 }, /* over the volcano crater */
  { x: 300,  y: 50, z: -430, r: 10 },
  { x: 180,  y: 46, z: -180, r: 10 },
];
const TIME_LIMIT = 300;

function smoothstep(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}
function terrainHeight(x, z) {
  let h = 0;
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d2 = dx * dx + dz * dz;
    const s = isl.r / 2.2;
    h = Math.max(h, isl.peak * Math.exp(-d2 / (2 * s * s)));
  }
  /* Flatten a plateau for the runway pad. */
  const dzr = Math.abs(z - RUNWAY.z), dxr = Math.abs(x - RUNWAY.x);
  const dPad = Math.max(dzr - RUNWAY.len / 2, dxr - RUNWAY.wid / 2, 0);
  const w = 1 - smoothstep(18, 75, dPad);
  return h * (1 - w) + RUNWAY.padY * w;
}
/* Island silhouette radius at sea level (gaussian falls below ~0.4 m). */
function islandCoastR(isl) { return (isl.r / 2.2) * Math.sqrt(2 * Math.log(Math.max(isl.peak / 0.4, 1.01))); }

/* Clouds and birds, placed deterministically. */
const CLOUDS = [];
for (let i = 0; i < 16; i++) {
  CLOUDS.push({
    x: (rng() - 0.5) * 2200, y: 120 + rng() * 90, z: -1400 + rng() * 1300,
    s: 30 + rng() * 50, a: 0.4 + rng() * 0.3,
  });
}
const BIRDS = [];
for (let i = 0; i < 7; i++) {
  BIRDS.push({ x: (rng() - 0.5) * 900, y: 55 + rng() * 35, z: -700 + rng() * 500, ph: rng() * TAU, s: 1 + rng() * 0.8 });
}

/* ---------------- state ---------------- */
const START_POS = { x: RUNWAY.x, y: RUNWAY.padY + 1.6, z: -195 };
const state = {
  mode: 'title',            /* title | playing | paused | won | lost */
  frozen: false,            /* screenshot poses: render but do not advance physics */
  pos: { ...START_POS }, hdg: 0, pitch: 0, roll: 0,
  speed: 0, throttle: 0.55,
  ringIdx: 0, score: 0, timeLeft: TIME_LIMIT,
  crashReason: '', muted: false, elapsed: 0,
  toast: '', toastUntil: 0,
};
const keys = {};
let drag = null; /* {x, y, roll, pitch} while mouse steering */

function showToast(msg, secs) {
  state.toast = msg; state.toastUntil = state.elapsed + secs;
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
}
function hideToast() { document.getElementById('toast').classList.add('hidden'); }

const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ov-title');
const ovSub = document.getElementById('ov-sub');
const ovBody = document.getElementById('ov-body');
const ovStats = document.getElementById('ov-stats');
const ovBtn = document.getElementById('ov-btn');
const hud = document.getElementById('hud');

function setOverlay(title, sub, body, statsHtml, btnLabel) {
  ovTitle.textContent = title;
  ovSub.textContent = sub;
  ovBody.innerHTML = body;
  if (statsHtml) { ovStats.innerHTML = statsHtml; ovStats.classList.remove('hidden'); }
  else ovStats.classList.add('hidden');
  ovBtn.textContent = btnLabel;
  overlay.classList.remove('hidden');
}
function hideOverlay() { overlay.classList.add('hidden'); }

function resetGame() {
  state.pos = { ...START_POS };
  state.hdg = 0; state.pitch = 0; state.roll = 0;
  state.speed = 0; state.throttle = 0.55;
  state.ringIdx = 0; state.score = 0; state.timeLeft = TIME_LIMIT;
  state.crashReason = ''; state.elapsed = 0; state.toast = '';
  hideToast();
}
function startGame() {
  resetGame();
  state.mode = 'playing';
  hideOverlay(); hud.classList.remove('hidden');
  showToast('Ring 1 ahead — throttle up and climb!', 4);
  ensureAudio();
}
function endGame(won, reason) {
  state.mode = won ? 'won' : 'lost';
  const mins = Math.max(0, Math.floor(state.timeLeft / 60));
  const secs = Math.max(0, Math.floor(state.timeLeft % 60));
  const timeStr = mins + ':' + String(secs).padStart(2, '0');
  if (won) {
    const bonus = Math.floor(state.timeLeft) * 5 + 200;
    state.score += bonus;
    setOverlay('LANDED!', 'Delivery complete — Garuda Senja',
      'All six rings flown and a perfect touchdown on the island runway. The archipelago is yours.',
      'Rings <b>6 / 6</b> &nbsp;&middot;&nbsp; Time left <b>' + timeStr + '</b><br>' +
      'Landing bonus <b>+' + bonus + '</b> &nbsp;&middot;&nbsp; Final score <b>' + state.score + '</b>',
      'Fly Again');
    playChime(true);
  } else {
    setOverlay('FLIGHT OVER', reason, 'The Garuda rests. Refuel, breathe, and try the ring run again.',
      'Rings <b>' + state.ringIdx + ' / 6</b> &nbsp;&middot;&nbsp; Score <b>' + state.score + '</b>',
      'Try Again');
    playThud();
  }
  hud.classList.add('hidden');
}
function togglePause() {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    setOverlay('PAUSED', 'Garuda Senja — holding pattern',
      'Take a breath. The rings will wait.',
      '', 'Resume Flight');
  } else if (state.mode === 'paused') {
    state.mode = 'playing'; hideOverlay();
  }
}

ovBtn.addEventListener('click', () => {
  if (state.mode === 'paused') { togglePause(); return; }
  startGame();
});

/* ---------------- input ---------------- */
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
  if (e.key === 'r' || e.key === 'R') startGame();
  if (e.key === 'm' || e.key === 'M') { state.muted = !state.muted; if (audio) audio.gain.gain.value = state.muted ? 0 : 0.9; }
  if (e.key === 'Enter' && state.mode !== 'playing') startGame();
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousedown', (e) => {
  drag = { x: e.clientX, y: e.clientY, roll: 0, pitch: 0 };
  canvas.classList.add('dragging');
});
addEventListener('mousemove', (e) => {
  if (!drag) return;
  drag.roll = Math.max(-1, Math.min(1, (e.clientX - drag.x) / 160));
  drag.pitch = Math.max(-1, Math.min(1, (drag.y - e.clientY) / 160));
});
addEventListener('mouseup', () => { drag = null; canvas.classList.remove('dragging'); });

/* ---------------- audio (synthesised only) ---------------- */
let audio = null;
function ensureAudio() {
  if (audio || SHOT) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const gain = ac.createGain(); gain.gain.value = state.muted ? 0 : 0.9; gain.connect(ac.destination);
    const osc1 = ac.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 55;
    const osc2 = ac.createOscillator(); osc2.type = 'triangle'; osc2.frequency.value = 110;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const og = ac.createGain(); og.gain.value = 0.05;
    osc1.connect(lp); osc2.connect(lp); lp.connect(og); og.connect(gain);
    osc1.start(); osc2.start();
    /* Wind: looped filtered noise. */
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    const ng = ac.createGain(); ng.gain.value = 0.0;
    noise.connect(bp); bp.connect(ng); ng.connect(gain); noise.start();
    audio = { ac, gain, osc1, osc2, og, ng };
  } catch (err) { audio = null; }
}
function playChime(win) {
  if (!audio || state.muted) return;
  try {
    const t0 = audio.ac.currentTime;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [880, 1174.66];
    notes.forEach((f, i) => {
      const o = audio.ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = audio.ac.createGain();
      g.gain.setValueAtTime(0, t0 + i * 0.09);
      g.gain.linearRampToValueAtTime(0.22, t0 + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.09 + 0.5);
      o.connect(g); g.connect(audio.gain); o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.55);
    });
  } catch (err) { /* audio is best-effort */ }
}
function playThud() {
  if (!audio || state.muted) return;
  try {
    const t0 = audio.ac.currentTime;
    const o = audio.ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(35, t0 + 0.35);
    const g = audio.ac.createGain();
    g.gain.setValueAtTime(0.5, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    o.connect(g); g.connect(audio.gain); o.start(t0); o.stop(t0 + 0.45);
  } catch (err) { /* audio is best-effort */ }
}
function updateAudio() {
  if (!audio) return;
  try {
    const th = state.throttle, sp = state.speed;
    audio.osc1.frequency.value = 42 + th * 55 + sp * 0.35;
    audio.osc2.frequency.value = 84 + th * 110 + sp * 0.7;
    audio.og.gain.value = state.mode === 'playing' ? 0.03 + th * 0.05 : 0.015;
    audio.ng.gain.value = state.mode === 'playing' ? Math.min(0.12, sp * 0.0016) : 0;
  } catch (err) { /* ignore */ }
}

/* ---------------- physics ---------------- */
function forwardVec(hdg, pitch) {
  return { x: Math.sin(hdg) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(hdg) * Math.cos(pitch) };
}
function update(dt) {
  if (state.mode !== 'playing' || state.frozen) return;
  state.elapsed += dt;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) { state.timeLeft = 0; endGame(false, 'Out of time — the sun set on the ring run.'); return; }

  /* Throttle: W/S or Shift/Ctrl. */
  if (keys['w']) state.throttle = Math.min(1, state.throttle + dt * 0.7);
  if (keys['s']) state.throttle = Math.max(0, state.throttle - dt * 0.7);
  /* Pitch: ArrowUp climbs (arcade), ArrowDown dives; drag up climbs too. */
  let pitchIn = 0, rollIn = 0;
  if (keys['arrowup']) pitchIn += 1;
  if (keys['arrowdown']) pitchIn -= 1;
  if (keys['arrowleft'] || keys['a']) rollIn -= 1;
  if (keys['arrowright'] || keys['d']) rollIn += 1;
  if (drag) { pitchIn += drag.pitch; rollIn += drag.roll; }
  pitchIn = Math.max(-1, Math.min(1, pitchIn));
  rollIn = Math.max(-1, Math.min(1, rollIn));

  const onGround = state.pos.y <= terrainHeight(state.pos.x, state.pos.z) + 1.7;
  state.pitch += pitchIn * dt * 0.85;
  state.pitch = Math.max(-0.62, Math.min(0.62, state.pitch));
  if (!pitchIn) state.pitch *= Math.max(0, 1 - dt * 0.35);
  state.roll += rollIn * dt * 1.5;
  state.roll = Math.max(-1.15, Math.min(1.15, state.roll));
  if (!rollIn) state.roll *= Math.max(0, 1 - dt * 1.1);

  const targetSpeed = onGround ? 8 + 62 * state.throttle : 18 + 62 * state.throttle;
  state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 0.55);

  /* Coordinated turn from bank. */
  const turnRate = (9.81 * Math.tan(state.roll) / Math.max(18, state.speed)) * 0.85;
  state.hdg -= turnRate * dt;

  const fwd = forwardVec(state.hdg, state.pitch);
  let vy = fwd.y * state.speed;
  if (state.speed < 22 && !onGround) vy -= (22 - state.speed) * 0.35; /* sink when slow */
  state.pos.x += fwd.x * state.speed * dt;
  state.pos.z += fwd.z * state.speed * dt;
  state.pos.y += vy * dt;

  /* World bounds: gentle push back toward the archipelago. */
  const dc = Math.hypot(state.pos.x, state.pos.z + 500);
  if (dc > 1150) {
    const home = Math.atan2(-state.pos.x, state.pos.z + 500);
    let dh = home - state.hdg;
    while (dh > Math.PI) dh -= TAU; while (dh < -Math.PI) dh += TAU;
    state.hdg += dh * dt * 0.6;
    showToast('Turn back — the open sea is empty out there', 2);
  }

  /* Rings. */
  if (state.ringIdx < RINGS.length) {
    const ring = RINGS[state.ringIdx];
    const d = Math.hypot(state.pos.x - ring.x, state.pos.y - ring.y, state.pos.z - ring.z);
    if (d < ring.r + 2) {
      state.ringIdx++; state.score += 150;
      playChime(false);
      if (state.ringIdx < RINGS.length) showToast('Ring ' + state.ringIdx + ' of 6 — +' + 150 + ' pts!', 2.5);
      else showToast('All rings flown! Land on the runway!', 4);
    }
  }

  /* Terrain / water collision and landing. */
  const ground = terrainHeight(state.pos.x, state.pos.z);
  const overRunway = Math.abs(state.pos.x - RUNWAY.x) < RUNWAY.wid / 2 + 3 &&
    Math.abs(state.pos.z - RUNWAY.z) < RUNWAY.len / 2 + 3;
  if (state.pos.y <= ground + 1.2) {
    const landingOk = state.ringIdx >= RINGS.length && overRunway &&
      state.speed < 40 && Math.abs(state.pitch) < 0.3 && Math.abs(state.roll) < 0.4;
    if (landingOk && state.speed > 4) { state.pos.y = ground + 1.2; endGame(true, ''); return; }
    if (onGround && state.speed < 6 && state.ringIdx >= RINGS.length && overRunway) { endGame(true, ''); return; }
    state.pos.y = ground + 1.2;
    endGame(false, ground <= 0.5 ? 'Ditched in the sea — the Garuda is a plane, not a boat.' : 'Crashed into the island — watch the terrain, pilot.');
    return;
  }
  updateAudio();
}

/* ---------------- camera & projection ---------------- */
const CAM = { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, f: 620 };
function computeCamera() {
  const fwd = forwardVec(state.hdg, state.pitch * 0.45);
  const back = { x: -fwd.x, y: -fwd.y, z: -fwd.z };
  CAM.pos = {
    x: state.pos.x + back.x * 15,
    y: Math.max(2.5, state.pos.y + back.y * 15 + 4.2),
    z: state.pos.z + back.z * 15,
  };
  const look = {
    x: state.pos.x + fwd.x * 40,
    y: state.pos.y + fwd.y * 40 - 1.5,
    z: state.pos.z + fwd.z * 40,
  };
  let f = { x: look.x - CAM.pos.x, y: look.y - CAM.pos.y, z: look.z - CAM.pos.z };
  const fl = Math.hypot(f.x, f.y, f.z) || 1; f = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  let r = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(r.x, r.z) || 1; r = { x: r.x / rl, y: 0, z: r.z / rl };
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  CAM.fwd = f; CAM.right = r; CAM.up = u;
}
function project(p) {
  const dx = p.x - CAM.pos.x, dy = p.y - CAM.pos.y, dz = p.z - CAM.pos.z;
  const cx = dx * CAM.right.x + dy * CAM.right.y + dz * CAM.right.z;
  const cy = dx * CAM.up.x + dy * CAM.up.y + dz * CAM.up.z;
  const cz = dx * CAM.fwd.x + dy * CAM.fwd.y + dz * CAM.fwd.z;
  if (cz < 1.5) return null;
  const s = CAM.f / cz;
  return { x: W / 2 + cx * s, y: H * 0.46 - cy * s, z: cz, s };
}
function poly(points, fill) {
  const pts = [];
  for (const p of points) { const q = project(p); if (!q) return; pts.push(q); }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}

/* ---------------- sky, sea, islands ---------------- */
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b1b52');
  g.addColorStop(0.32, '#7a3d7e');
  g.addColorStop(0.46, '#e2603f');
  g.addColorStop(0.55, '#ffb347');
  g.addColorStop(0.62, '#ffd98a');
  g.addColorStop(1, '#1d3a4a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  /* Sun low on the horizon, ahead-left. */
  const sunDir = { x: -0.55, y: 0.06, z: -1 };
  const sp = project({ x: CAM.pos.x + sunDir.x * 900, y: CAM.pos.y + sunDir.y * 900 + 30, z: CAM.pos.z + sunDir.z * 900 });
  if (sp) {
    const sg = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 90);
    sg.addColorStop(0, 'rgba(255,240,190,0.95)');
    sg.addColorStop(0.25, 'rgba(255,200,110,0.75)');
    sg.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 90, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 26, 0, TAU); ctx.fill();
  }
}
function horizonY() {
  /* Screen y of the eye-level horizon. */
  const p = project({ x: CAM.pos.x + CAM.fwd.x * 500, y: CAM.pos.y, z: CAM.pos.z + CAM.fwd.z * 500 });
  return p ? p.y : H * 0.46;
}
function drawSea() {
  const hy = horizonY();
  const g = ctx.createLinearGradient(0, hy, 0, H);
  g.addColorStop(0, '#ff9d4d');
  g.addColorStop(0.18, '#c96a5a');
  g.addColorStop(0.45, '#2e6b7a');
  g.addColorStop(1, '#0d2f42');
  ctx.fillStyle = g; ctx.fillRect(0, Math.max(0, hy), W, H - Math.max(0, hy));
  /* Sun glitter on the water. */
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#ffd98a';
  for (let i = 0; i < 26; i++) {
    const yy = hy + 12 + ((i * 53) % Math.max(40, H - hy - 20));
    const xx = W * 0.32 + Math.sin(i * 2.7) * 130 + ((i * 37) % 60);
    const ww = 26 + (i % 5) * 14;
    ctx.fillRect(xx, yy, ww, 2.5);
  }
  ctx.restore();
}
function shadeForHeight(h, peak, volcano) {
  if (h < 1.2) return '#e8c97e';          /* beach sand */
  if (h < 5) return '#d9b96a';
  if (h < peak * 0.45) return '#4d8a3f';  /* jungle green */
  if (h < peak * 0.75) return '#2f6b2e';
  if (volcano && h > peak * 0.82) return '#5a4a42'; /* ash rock */
  return '#6b5a44';
}
function drawIslands() {
  /* Painter's order: farthest first. */
  const sorted = ISLANDS.map((isl) => ({
    isl, d: Math.hypot(isl.x - CAM.pos.x, isl.z - CAM.pos.z),
  })).sort((a, b) => b.d - a.d);
  for (const { isl } of sorted) {
    const coastR = islandCoastR(isl);
    const rings = 6;
    const innerK = isl.volcano ? 3 : 1; /* leave the crater clear for the cone */
    for (let k = rings; k >= innerK; k--) {
      const f = k / rings;
      const rr = coastR * f;
      const h = isl.peak * Math.pow(1 - f * f, 1.35);
      const pts = [];
      const steps = 26;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * TAU;
        const wob = 1 + 0.1 * Math.sin(a * 3 + isl.x) + 0.06 * Math.sin(a * 5 + isl.z);
        pts.push({ x: isl.x + Math.cos(a) * rr * wob, y: Math.max(0.4, h), z: isl.z + Math.sin(a) * rr * wob });
      }
      poly(pts, shadeForHeight(h, isl.peak, isl.volcano));
    }
    if (isl.volcano) drawVolcano(isl);
  }
}
function drawVolcano(isl) {
  /* Shaded cone + crater + lazy smoke above Gunung Senja. */
  const base = isl.peak * 0.30;
  const apex = { x: isl.x, y: isl.peak + 10, z: isl.z };
  const left = { x: isl.x - 70, y: base, z: isl.z + 40 };
  const right = { x: isl.x + 70, y: base, z: isl.z + 40 };
  const mid = { x: isl.x + 10, y: base + 10, z: isl.z + 48 };
  poly([apex, left, mid], '#7a5a48');
  poly([apex, mid, right], '#4a352c');
  /* Crater: a dark notch right at the apex's screen position. */
  const ap = project(apex);
  if (ap) {
    ctx.save();
    ctx.fillStyle = '#2e2018';
    ctx.beginPath(); ctx.ellipse(ap.x, ap.y + 1, Math.max(6, 5 * ap.s * 0.02), Math.max(3, 2.5 * ap.s * 0.02), 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  /* Smoke puffs. */
  const t = state.elapsed;
  for (let i = 0; i < 3; i++) {
    const p = project({ x: isl.x + Math.sin(t * 0.3 + i * 2.1) * 8, y: isl.peak + 26 + i * 9 + (t * 2 % 6), z: isl.z });
    if (!p) continue;
    ctx.save();
    ctx.globalAlpha = 0.35 - i * 0.08;
    ctx.fillStyle = '#cfc4bb';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 16 * p.s * 0.02 + 8, 7, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
function drawRunway() {
  const y = RUNWAY.padY + 0.4;
  const hw = RUNWAY.wid / 2, hl = RUNWAY.len / 2;
  poly([
    { x: RUNWAY.x - hw, y, z: RUNWAY.z - hl },
    { x: RUNWAY.x + hw, y, z: RUNWAY.z - hl },
    { x: RUNWAY.x + hw, y, z: RUNWAY.z + hl },
    { x: RUNWAY.x - hw, y, z: RUNWAY.z + hl },
  ], '#3a3f4a');
  /* Centreline dashes. */
  for (let d = -hl + 8; d < hl - 4; d += 16) {
    poly([
      { x: RUNWAY.x - 0.7, y: y + 0.05, z: RUNWAY.z + d },
      { x: RUNWAY.x + 0.7, y: y + 0.05, z: RUNWAY.z + d },
      { x: RUNWAY.x + 0.7, y: y + 0.05, z: RUNWAY.z + d + 8 },
      { x: RUNWAY.x - 0.7, y: y + 0.05, z: RUNWAY.z + d + 8 },
    ], '#f5f0dc');
  }
  /* Threshold bars + runway number. */
  for (const zz of [RUNWAY.z - hl + 5, RUNWAY.z + hl - 5]) {
    poly([
      { x: RUNWAY.x - hw + 1.5, y: y + 0.05, z: zz - 1.2 },
      { x: RUNWAY.x + hw - 1.5, y: y + 0.05, z: zz - 1.2 },
      { x: RUNWAY.x + hw - 1.5, y: y + 0.05, z: zz + 1.2 },
      { x: RUNWAY.x - hw + 1.5, y: y + 0.05, z: zz + 1.2 },
    ], '#f5f0dc');
  }
  /* Small windsock pole beside the strip. */
  const sock = project({ x: RUNWAY.x + hw + 6, y: RUNWAY.padY + 9, z: RUNWAY.z + hl - 8 });
  const baseP = project({ x: RUNWAY.x + hw + 6, y: RUNWAY.padY, z: RUNWAY.z + hl - 8 });
  if (sock && baseP) {
    ctx.strokeStyle = '#e8e0cc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(baseP.x, baseP.y); ctx.lineTo(sock.x, sock.y); ctx.stroke();
    ctx.fillStyle = '#ff7a2e';
    ctx.beginPath(); ctx.moveTo(sock.x, sock.y); ctx.lineTo(sock.x + 14, sock.y + 3); ctx.lineTo(sock.x, sock.y + 6); ctx.closePath(); ctx.fill();
  }
}
function drawRings() {
  for (let i = state.ringIdx; i < RINGS.length; i++) {
    const ring = RINGS[i];
    const isNext = i === state.ringIdx;
    /* Ring faces along the route: normal from previous ring / plane heading. */
    const prev = i === 0 ? state.pos : RINGS[i - 1];
    let nx = ring.x - prev.x, ny = ring.y - prev.y, nz = ring.z - prev.z;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    /* Local axes perpendicular to the normal. */
    let ax = -nz, ay = 0, az = nx;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
    const pts = [];
    let ok = true;
    for (let k = 0; k <= 28; k++) {
      const a = (k / 28) * TAU;
      const p = project({
        x: ring.x + (Math.cos(a) * ax + Math.sin(a) * bx) * ring.r,
        y: ring.y + (Math.cos(a) * ay + Math.sin(a) * by) * ring.r,
        z: ring.z + (Math.cos(a) * az + Math.sin(a) * bz) * ring.r,
      });
      if (!p) { ok = false; break; }
      pts.push(p);
    }
    if (!ok) continue;
    ctx.save();
    ctx.globalAlpha = isNext ? 0.95 : 0.55;
    ctx.strokeStyle = isNext ? '#ffd24a' : '#9fd8ff';
    ctx.lineWidth = isNext ? 7 : 4;
    ctx.shadowColor = isNext ? '#ffb52e' : '#66c2ff';
    ctx.shadowBlur = isNext ? 22 : 10;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.closePath(); ctx.stroke();
    if (isNext) {
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#ffd24a';
      ctx.fill();
    }
    ctx.restore();
    if (isNext) {
      const c = project(ring);
      if (c) {
        ctx.save();
        ctx.font = '700 17px "Segoe UI", Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffe9b0';
        ctx.shadowColor = '#ff9d2e'; ctx.shadowBlur = 10;
        ctx.fillText('RING ' + (i + 1), c.x, c.y - 26 - ring.r * c.s * 0.4);
        ctx.restore();
      }
    }
  }
}
function drawCloudsAndBirds() {
  for (const c of CLOUDS) {
    const p = project(c);
    if (!p || p.z > 1600) continue;
    const s = Math.max(0.2, Math.min(2.2, c.s * p.s * 0.012));
    ctx.save();
    ctx.globalAlpha = c.a * 0.85;
    ctx.fillStyle = '#ffe3c2';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 46 * s, 13 * s, 0, 0, TAU);
    ctx.ellipse(p.x - 26 * s, p.y + 4 * s, 28 * s, 10 * s, 0, 0, TAU);
    ctx.ellipse(p.x + 28 * s, p.y + 4 * s, 30 * s, 10 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(40,20,40,0.85)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const b of BIRDS) {
    const flap = Math.sin(state.elapsed * 6 + b.ph) * 4;
    const p = project({ x: b.x + Math.sin(state.elapsed * 0.1 + b.ph) * 20, y: b.y, z: b.z });
    if (!p || p.z > 900) continue;
    const s = b.s * Math.max(0.4, p.s * 0.02);
    ctx.beginPath();
    ctx.moveTo(p.x - 7 * s, p.y - flap * s * 0.4);
    ctx.quadraticCurveTo(p.x, p.y + 2 * s, p.x + 7 * s, p.y - flap * s * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------- the plane (chase view) ---------------- */
function drawPlane() {
  const px = W / 2, py = H * 0.60;
  const sc = 1.05;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(state.roll * 0.9);
  ctx.scale(sc, sc);
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
  /* Main wing (seen from behind, slight dihedral). */
  ctx.fillStyle = '#f7ead0';
  ctx.beginPath();
  ctx.moveTo(-150, 6); ctx.lineTo(-24, -6); ctx.lineTo(24, -6); ctx.lineTo(150, 6);
  ctx.lineTo(146, 16); ctx.lineTo(20, 8); ctx.lineTo(-20, 8); ctx.lineTo(-146, 16);
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  /* Wing tips: red left, green right (nav lights). */
  ctx.fillStyle = '#d63a2e'; ctx.fillRect(-150, 6, 12, 9);
  ctx.fillStyle = '#2fae5f'; ctx.fillRect(138, 6, 12, 9);
  /* Tailplane. */
  ctx.fillStyle = '#e8d5ae';
  ctx.beginPath();
  ctx.moveTo(-52, -34); ctx.lineTo(-12, -40); ctx.lineTo(12, -40); ctx.lineTo(52, -34);
  ctx.lineTo(48, -26); ctx.lineTo(-48, -26); ctx.closePath(); ctx.fill();
  /* Vertical fin with a golden Garuda stripe. */
  ctx.fillStyle = '#c9402e';
  ctx.beginPath();
  ctx.moveTo(-8, -38); ctx.lineTo(0, -78); ctx.lineTo(10, -38); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.moveTo(-3, -52); ctx.lineTo(0, -70); ctx.lineTo(4, -52); ctx.closePath(); ctx.fill();
  /* Fuselage: warm cream, sunlit top, shaded belly. */
  const fg = ctx.createLinearGradient(0, -46, 0, 34);
  fg.addColorStop(0, '#fff6dd'); fg.addColorStop(0.55, '#f3dfae'); fg.addColorStop(1, '#b98d4f');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-16, -42); ctx.quadraticCurveTo(0, -50, 16, -42);
  ctx.lineTo(20, 18); ctx.quadraticCurveTo(0, 34, -20, 18);
  ctx.closePath(); ctx.fill();
  /* Red cheatline + tail number. */
  ctx.fillStyle = '#c9402e';
  ctx.fillRect(-18, -6, 36, 7);
  ctx.fillStyle = '#5a3a12';
  ctx.font = '700 11px Verdana, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PK-GSJ', 0, 26);
  /* Cockpit roof glint (pilot's headrest + window hint from behind). */
  ctx.fillStyle = '#7fb6c9';
  ctx.beginPath(); ctx.ellipse(0, -38, 10, 5, 0, 0, TAU); ctx.fill();
  /* Propeller hint: faint disc above the nose is hidden from behind; draw spinner glow at top. */
  ctx.fillStyle = 'rgba(255,210,90,0.9)';
  ctx.beginPath(); ctx.ellipse(0, -46, 5, 2.5, 0, 0, TAU); ctx.fill();
  ctx.restore();
  /* Soft shadow on the ground far below when low. */
  const ground = terrainHeight(state.pos.x, state.pos.z);
  const hAbove = state.pos.y - ground;
  if (hAbove < 60) {
    const sh = project({ x: state.pos.x, y: ground + 0.5, z: state.pos.z });
    if (sh) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, 0.35 - hAbove * 0.005);
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 46 * sh.s * 0.02, 10 * sh.s * 0.02, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

/* ---------------- instruments & HUD ---------------- */
function drawArtificialHorizon(x, y, r) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(-state.roll);
  const pitchPx = Math.max(-r, Math.min(r, state.pitch * r * 1.4));
  ctx.fillStyle = '#2f6fb4'; ctx.fillRect(-r, -r - pitchPx, r * 2, r + pitchPx);
  ctx.fillStyle = '#8a5a2e'; ctx.fillRect(-r, -pitchPx, r * 2, r + pitchPx);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(-r, -pitchPx - 1.5, r * 2, 3);
  ctx.fillStyle = '#ffd24a';
  ctx.fillRect(-r * 0.55, -pitchPx - 14, r * 0.28, 3);
  ctx.fillRect(r * 0.27, -pitchPx - 14, r * 0.28, 3);
  ctx.fillRect(-r * 0.55, -pitchPx + 11, r * 0.28, 3);
  ctx.fillRect(r * 0.27, -pitchPx + 11, r * 0.28, 3);
  ctx.restore();
  /* Fixed wings + bezel. */
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ffe9b0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-r * 0.62, 0); ctx.lineTo(-r * 0.18, 0); ctx.moveTo(r * 0.18, 0); ctx.lineTo(r * 0.62, 0); ctx.stroke();
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffcf7d'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffcf7d'; ctx.font = '700 11px Verdana, sans-serif'; ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(10,10,30,0.9)'; ctx.lineWidth = 3;
  ctx.strokeText('ATTITUDE', x, y + r + 15);
  ctx.fillText('ATTITUDE', x, y + r + 15);
}
function drawCompass(x, y, w) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,34,0.72)';
  ctx.strokeStyle = 'rgba(255,190,90,0.6)'; ctx.lineWidth = 1.5;
  roundRect(x - w / 2, y - 16, w, 32, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.rect(x - w / 2, y - 16, w, 32); ctx.clip();
  const hdgDeg = ((state.hdg * 180 / Math.PI) % 360 + 360) % 360;
  ctx.font = '700 13px Verdana, sans-serif'; ctx.textAlign = 'center';
  for (let d = -180; d <= 180; d += 15) {
    const deg = ((Math.round(hdgDeg / 15) * 15 + d) % 360 + 360) % 360;
    const dx = (d - (hdgDeg - Math.round(hdgDeg / 15) * 15)) * (w / 180);
    const label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg).padStart(3, '0');
    ctx.fillStyle = deg % 90 === 0 ? '#ffd24a' : '#e8e0cc';
    ctx.fillText(label, x + dx, y + 5);
    ctx.fillRect(x + dx - 0.5, y - 12, 1, 5);
  }
  ctx.restore();
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath(); ctx.moveTo(x - 6, y - 18); ctx.lineTo(x + 6, y - 18); ctx.lineTo(x, y - 8); ctx.closePath(); ctx.fill();
}
function drawTape(x, y, w, h, value, max, label, unit, format, min) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,34,0.72)';
  ctx.strokeStyle = 'rgba(255,190,90,0.6)'; ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const mid = y + h / 2;
  ctx.font = '700 12px Verdana, sans-serif'; ctx.textAlign = 'left';
  const step = max > 400 ? 100 : 10;
  const span = max > 400 ? 400 : 40;
  const lo = min === undefined ? -Infinity : min;
  for (let v = Math.floor((value - span) / step) * step; v <= value + span; v += step) {
    if (v < lo) continue;
    const dy = mid - (v - value) * (h / (span * 2));
    if (dy < y + 4 || dy > y + h - 4) continue;
    ctx.fillStyle = '#e8e0cc';
    ctx.fillRect(x + 4, dy - 0.5, 8, 1);
    ctx.fillText(String(v), x + 16, dy + 4);
  }
  ctx.restore();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.moveTo(x + w, mid - 8); ctx.lineTo(x + w + 10, mid); ctx.lineTo(x + w, mid + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0a0e26';
  ctx.font = '700 13px Verdana, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(format(value), x + w / 2, y - 8);
  ctx.fillStyle = '#ffcf7d'; ctx.font = '700 11px Verdana, sans-serif';
  ctx.strokeStyle = 'rgba(10,10,30,0.9)'; ctx.lineWidth = 3;
  ctx.strokeText(label + ' ' + unit, x + w / 2, y + h + 15);
  ctx.fillText(label + ' ' + unit, x + w / 2, y + h + 15);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawThrottle(x, y, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,34,0.72)';
  ctx.strokeStyle = 'rgba(255,190,90,0.6)'; ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  const fh = (h - 12) * state.throttle;
  ctx.fillStyle = '#ff9d2e';
  roundRect(x + 5, y + h - 6 - fh, w - 10, fh, 4); ctx.fill();
  ctx.fillStyle = '#ffcf7d'; ctx.font = '700 11px Verdana, sans-serif'; ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(10,10,30,0.9)'; ctx.lineWidth = 3;
  ctx.strokeText('THR ' + Math.round(state.throttle * 100) + '%', x + w / 2, y + h + 15);
  ctx.fillText('THR ' + Math.round(state.throttle * 100) + '%', x + w / 2, y + h + 15);
  ctx.restore();
}
function drawInstruments() {
  const panelY = H - 118;
  drawArtificialHorizon(96, panelY + 44, 46);
  drawCompass(W / 2, panelY + 44, 330);
  const altFt = state.pos.y * 3.28084;
  const spdKt = state.speed * 1.94384;
  drawTape(W - 250, panelY + 8, 96, 84, Math.round(altFt), 5000, 'ALT', 'ft', (v) => String(Math.round(v)), 0);
  drawTape(W - 140, panelY + 8, 96, 84, Math.round(spdKt), 200, 'SPD', 'kt', (v) => String(Math.round(v)), 0);
  drawThrottle(170, panelY + 8, 34, 84);
  /* Next-ring guidance. */
  if (state.mode === 'playing' && state.ringIdx < RINGS.length) {
    const ring = RINGS[state.ringIdx];
    const d = Math.hypot(state.pos.x - ring.x, state.pos.y - ring.y, state.pos.z - ring.z);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = '700 16px "Segoe UI", Verdana, sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#ff9d2e'; ctx.shadowBlur = 8;
    ctx.fillText('NEXT RING ' + Math.round(d) + ' m', W / 2, 132);
    ctx.shadowBlur = 0;
    /* Off-screen arrow toward the ring. */
    const c = project(ring);
    if (c && (c.x < 40 || c.x > W - 40 || c.y < 80 || c.y > H - 140)) {
      const ax = Math.max(50, Math.min(W - 50, c.x));
      const ay = Math.max(110, Math.min(H - 160, c.y));
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(Math.atan2(c.y - ay, c.x - ax));
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-10, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  } else if (state.mode === 'playing' && state.ringIdx >= RINGS.length) {
    ctx.fillStyle = '#b8ff9d';
    ctx.font = '700 17px "Segoe UI", Verdana, sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#5fae3f'; ctx.shadowBlur = 8;
    ctx.fillText('ALL RINGS CLEAR — LAND ON THE RUNWAY', W / 2, 132);
    ctx.shadowBlur = 0;
  }
}
function updateHud() {
  const altFt = Math.round(state.pos.y * 3.28084);
  const spdKt = Math.round(state.speed * 1.94384);
  const hdgDeg = Math.round(((state.hdg * 180 / Math.PI) % 360 + 360) % 360);
  document.getElementById('hud-alt').textContent = altFt.toLocaleString('en-US') + ' ft';
  document.getElementById('hud-spd').textContent = spdKt + ' kt';
  document.getElementById('hud-hdg').textContent = String(hdgDeg).padStart(3, '0') + '°';
  document.getElementById('hud-rings').textContent = state.ringIdx + '/6';
  const t = Math.max(0, state.timeLeft);
  document.getElementById('hud-time').textContent = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  document.getElementById('hud-score').textContent = String(state.score);
}

/* ---------------- frame ---------------- */
function render() {
  computeCamera();
  drawSky();
  drawSea();
  drawCloudsAndBirds();
  drawIslands();
  drawRunway();
  drawRings();
  drawPlane();
  if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'title' || state.mode === 'won' || state.mode === 'lost') drawInstruments();
  if (state.toast && state.elapsed > state.toastUntil) { state.toast = ''; hideToast(); }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  update(dt);
  render();
  if (state.mode === 'playing' || state.mode === 'paused') updateHud();
  requestAnimationFrame(frame);
}

/* ---------------- screenshot poses ---------------- */
function applyShot() {
  if (!SHOT) return;
  state.frozen = true;
  if (SHOT === 'start') {
    state.mode = 'title';
    state.pos = { ...START_POS };
    state.hdg = 0; state.pitch = 0.02; state.roll = 0; state.speed = 0; state.throttle = 0.55;
    setOverlay('GARUDA SENJA', 'Island Ring Run · Nusantara at golden hour',
      'Fly your bush plane through all six golden rings over the archipelago, then bring her home and land on the island runway before the clock runs out. Mind the volcano — and the sea.',
      '', 'Take Off');
    hud.classList.add('hidden');
  } else if (SHOT === 'play') {
    /* Mid-flight, ring 6 dead ahead with the main island and runway beyond. */
    state.mode = 'playing';
    state.pos = { x: 180, y: 55, z: -40 };
    state.hdg = 0.02; state.pitch = 0.02; state.roll = -0.1;
    state.speed = 52; state.throttle = 0.8;
    state.ringIdx = 5; state.score = 750; state.timeLeft = 118;
    hideOverlay(); hud.classList.remove('hidden');
  } else if (SHOT === 'runway') {
    /* Low pass over the runway, all rings done, gear-down approach. */
    state.mode = 'playing';
    state.pos = { x: RUNWAY.x, y: RUNWAY.padY + 9, z: -120 };
    state.hdg = 0; state.pitch = -0.06; state.roll = 0.03;
    state.speed = 34; state.throttle = 0.35;
    state.ringIdx = 6; state.score = 900; state.timeLeft = 96;
    hideOverlay(); hud.classList.remove('hidden');
  } else if (SHOT === 'end') {
    /* Landed — win screen over the parked plane. */
    state.mode = 'won';
    state.pos = { x: RUNWAY.x, y: RUNWAY.padY + 1.6, z: -230 };
    state.hdg = 0; state.pitch = 0; state.roll = 0; state.speed = 0;
    state.ringIdx = 6; state.score = 900 + 200 + 480; state.timeLeft = 96;
    setOverlay('LANDED!', 'Delivery complete — Garuda Senja',
      'All six rings flown and a perfect touchdown on the island runway. The archipelago is yours.',
      'Rings <b>6 / 6</b> &nbsp;·&nbsp; Time left <b>1:36</b><br>' +
      'Landing bonus <b>+680</b> &nbsp;·&nbsp; Final score <b>1580</b>',
      'Fly Again');
    hud.classList.add('hidden');
  }
  updateHud();
}

/* Expose a small handle for scripted testing (headless checks). */
window.__garuda = {
  state,
  terrainHeight,
  resetGame,
  startGame,
  applyShot,
  version: '1.0.0',
};

applyShot();
requestAnimationFrame(frame);
