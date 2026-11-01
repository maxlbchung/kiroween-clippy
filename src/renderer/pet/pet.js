import { PET, MENU } from '../../shared/layout.js';
import { clippyMarkup, applyCostume, blink, createGaze } from '../common/clippy.js';
import { icon } from '../common/icons.js';
import { api, $, $$, installClickThrough, sfx, applyPrefs, reducedMotion } from '../common/ui.js';

const stage = $('#stage');
const hit = $('#clippy-hit');
const tiltEl = $('#clippy-tilt');
const squashEl = $('#clippy-squash');
const ring = $('#ring');
const caption = $('#ring-caption');
const sayEl = $('#say');
const sayText = $('.say-text', sayEl);

let settings = await api.getSettings();
applyPrefs(settings);

// ---------------------------------------------------------------- setup
const fit = () => stage.style.setProperty('--pet-scale', String(window.innerWidth / PET.width));
fit();
window.addEventListener('resize', fit);

$('#clippy-bob').innerHTML = clippyMarkup({ uid: 'pet', costume: settings.costume });
const svg = $('#clippy-bob svg');
const gaze = createGaze(svg);

// ---------------------------------------------------------------- state
const mood = { external: null, flash: null, hover: false, drag: false, sleep: false };
let flashTimer = null;
let menuOpen = false;
let activePanel = null;
let panelSide = null;
let closingTimer = null;
let press = null;
let lastInteract = performance.now();

// ---------------------------------------------------------------- moods

function renderMood() {
  const m = mood.drag ? 'drag'
    : mood.flash || mood.external || (mood.sleep ? 'sleep' : mood.hover || menuOpen ? 'hover' : 'idle');
  for (const c of [...stage.classList]) if (c.startsWith('mood-')) stage.classList.remove(c);
  stage.classList.add(`mood-${m}`);
  kick();
}

function flash(m, ms = 900) {
  mood.flash = m;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { mood.flash = null; renderMood(); }, ms);
  renderMood();
}

function squash(strength = 1) {
  if (reducedMotion()) return;
  const s = strength;
  squashEl.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: `scale(${1 + 0.1 * s}, ${1 - 0.14 * s})`, offset: 0.22 },
      { transform: `scale(${1 - 0.06 * s}, ${1 + 0.09 * s})`, offset: 0.5 },
      { transform: `scale(${1 + 0.02 * s}, ${1 - 0.02 * s})`, offset: 0.78 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 520, easing: 'ease-out' },
  );
}

api.onMood((m) => {
  mood.external = m || null;
  if (m) wake();
  renderMood();
});

// ---------------------------------------------------------------- radial menu

MENU.forEach((item, i) => {
  const rad = (item.angle * Math.PI) / 180;
  const b = document.createElement('button');
  b.className = 'ring-btn';
  b.dataset.hit = '';
  b.dataset.id = item.id;
  b.setAttribute('aria-label', item.label);
  b.tabIndex = -1;
  b.style.cssText = `--x:${(Math.cos(rad) * PET.ring.rx).toFixed(1)}px;--y:${(Math.sin(rad) * PET.ring.ry).toFixed(1)}px;--i:${i};--c:${item.color}`;
  b.innerHTML = icon(item.id, 32);
  b.addEventListener('mouseenter', () => { showCaption(item.label); sfx.hover(); });
  b.addEventListener('focus', () => showCaption(item.label));
  b.addEventListener('mouseleave', hideCaption);
  b.addEventListener('blur', hideCaption);
  b.addEventListener('click', () => {
    sfx.select();
    closeMenu({ silent: true });
    squash(0.5);
    if (item.id === 'quit') api.quit();
    else api.openPanel(item.id);
  });
  ring.appendChild(b);
});
const ringButtons = $$('.ring-btn', ring);

function showCaption(text) {
  caption.textContent = text;
  caption.classList.add('show');
}
function hideCaption() {
  caption.classList.remove('show');
}

function openMenu() {
  if (menuOpen) return;
  menuOpen = true;
  clearTimeout(closingTimer);
  stage.classList.remove('menu-closing');
  stage.classList.add('menu-open');
  ringButtons.forEach((b) => { b.tabIndex = 0; });
  hideSay();
  sfx.open();
  api.menuChanged(true);
  renderMood();
}

function closeMenu({ silent = false } = {}) {
  if (!menuOpen) return;
  menuOpen = false;
  stage.classList.remove('menu-open');
  stage.classList.add('menu-closing');
  ringButtons.forEach((b) => { b.tabIndex = -1; });
  closingTimer = setTimeout(() => stage.classList.remove('menu-closing'), 450);
  hideCaption();
  if (!silent) sfx.close();
  api.menuChanged(false);
  renderMood();
}

const toggleMenu = () => (menuOpen ? closeMenu() : openMenu());

// A click closes whatever is open; the menu only opens when nothing else is.
function clickPet() {
  if (activePanel && !menuOpen) {
    sfx.close();
    api.closePanel();
  } else toggleMenu();
}

api.onBlur(() => closeMenu({ silent: true }));
api.onToggleMenu(() => { toggleMenu(); squash(0.6); });
api.onPetPanel(({ name, side }) => {
  activePanel = name;
  panelSide = side || null;
  ringButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.id === name));
  if (name) { wake(); hideSay(); }
  kick();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeMenu();
  if (!menuOpen || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const idx = ringButtons.indexOf(document.activeElement);
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
  ringButtons[(idx + step + ringButtons.length) % ringButtons.length].focus();
});

// ---------------------------------------------------------------- pointer: click vs drag

hit.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  hit.setPointerCapture(e.pointerId);
  press = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, dragging: false };
});

hit.addEventListener('pointermove', (e) => {
  if (!press || press.dragging) return;
  if (Math.hypot(e.screenX - press.sx, e.screenY - press.sy) < 5) return;
  press.dragging = true;
  // Pivot the wobble around the grab point.
  const r = tiltEl.getBoundingClientRect();
  const k = r.width / tiltEl.offsetWidth || 1;
  tiltEl.style.transformOrigin = `${((press.cx - r.left) / k).toFixed(1)}px ${((press.cy - r.top) / k).toFixed(1)}px`;
  closeMenu({ silent: true });
  hideSay();
  mood.drag = true;
  stage.classList.add('dragging');
  wake();
  renderMood();
  api.dragStart(press.cx, press.cy);
});

function finishPress(cancelled) {
  if (!press) return;
  const p = press;
  press = null;
  if (p.dragging) {
    api.dragEnd();
    mood.drag = false;
    stage.classList.remove('dragging');
    renderMood();
    squash(0.6);
  } else if (!cancelled) {
    squash(0.8);
    clickPet();
  }
}
hit.addEventListener('pointerup', () => finishPress(false));
hit.addEventListener('pointercancel', () => finishPress(true));
hit.addEventListener('lostpointercapture', () => finishPress(true));
hit.addEventListener('click', (e) => { if (e.detail === 0) clickPet(); }); // keyboard
hit.addEventListener('contextmenu', (e) => { e.preventDefault(); closeMenu({ silent: true }); api.petContextMenu(); });
hit.addEventListener('pointerenter', () => { mood.hover = true; renderMood(); });
hit.addEventListener('pointerleave', () => { mood.hover = false; renderMood(); });

installClickThrough({ isLocked: () => !!press });

// ---------------------------------------------------------------- motion loop (gaze + wobble)
let cursor = null;
let lastCursorAt = 0;
let wander = { x: 0, y: 0, until: 0 };
let tilt = 0;
let tiltV = 0;
let vx = 0;
let lastMove = null;
let lastMoveAt = 0;
let raf = 0;
let lastT = 0;
let idleTimer = 0;

api.onCursor((p) => {
  cursor = p;
  lastCursorAt = performance.now();
  if (mood.sleep) wake(true);
  kick();
});

api.onMoved(({ x, t }) => {
  if (lastMove) {
    const dt = Math.max(8, t - lastMove.t);
    const v = ((x - lastMove.x) / dt) * 1000;
    vx = vx * 0.55 + v * 0.45;
  }
  lastMove = { x, t };
  lastMoveAt = performance.now();
  kick();
});

function kick() {
  if (!raf) {
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function chooseGaze(now) {
  const ext = mood.external;
  if (mood.sleep) return gaze.lookDir(0, 0.3);
  if (ext === 'thinking') return gaze.lookDir(-0.75, -0.85);
  if (ext === 'listening') return gaze.lookDir(0, -0.15);
  const tracking = settings.behavior.eyeTracking !== false;
  if (tracking && cursor && now - lastCursorAt < 5000) {
    return gaze.lookAt(cursor.x, cursor.y);
  }
  if (activePanel && panelSide) return gaze.lookDir(panelSide === 'right' ? 0.85 : -0.85, 0.1);
  if (now > wander.until) {
    const r = Math.random();
    wander = r < 0.45 ? { x: 0, y: 0.05 } : { x: Math.random() * 1.6 - 0.8, y: Math.random() * 1.2 - 0.6 };
    wander.until = now + 1500 + Math.random() * 3500;
  }
  return gaze.lookDir(wander.x, wander.y);
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  chooseGaze(now);
  const eyesMoving = gaze.tick(dt);

  // Inertial wobble while dragged: lean against the motion, then spring back.
  if (!mood.drag || now - lastMoveAt > 90) vx *= Math.pow(0.02, dt);
  const target = reducedMotion() ? 0 : Math.max(-24, Math.min(24, vx * 0.02));
  const acc = (target - tilt) * 170 - tiltV * 11;
  tiltV += acc * dt;
  tilt += tiltV * dt;
  tiltEl.style.transform = `rotate(${tilt.toFixed(2)}deg)`;
  svg.style.setProperty('--cape-lean', `${Math.max(-14, Math.min(14, -vx * 0.012)).toFixed(1)}deg`);

  const wobbling = Math.abs(tilt) > 0.03 || Math.abs(tiltV) > 0.03 || Math.abs(vx) > 1;
  if (eyesMoving || wobbling || mood.drag) {
    raf = requestAnimationFrame(frame);
  } else {
    // Settled: sleep the loop, but wake periodically so idle glances happen.
    raf = 0;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(kick, 1000);
  }
}
kick();

// ---------------------------------------------------------------- blinking + sleep
function scheduleBlink() {
  setTimeout(() => {
    if (!mood.sleep && mood.flash !== 'happy' && !document.hidden) blink(svg, { double: Math.random() < 0.18 });
    scheduleBlink();
  }, 2200 + Math.random() * 4200);
}
scheduleBlink();

const SLEEP_AFTER = 3 * 60 * 1000;
setInterval(() => {
  const idle = performance.now() - Math.max(lastCursorAt, lastMoveAt, lastInteract);
  if (!mood.sleep && idle > SLEEP_AFTER && !menuOpen && !activePanel && !mood.external) {
    mood.sleep = true;
    hideSay();
    renderMood();
  }
}, 10000);

function wake(startle = false) {
  lastInteract = performance.now();
  if (!mood.sleep) return;
  mood.sleep = false;
  if (startle) {
    flash('drag', 700);
    squash(1);
  } else renderMood();
}

// ---------------------------------------------------------------- speech bubble
const LINES = {
  intro: "Hi! I'm Clippy. Drag me anywhere, or click me to see what I can do.",
  hello: ["Hi again! Click me if you need anything.", "Back at it? I'm right here.", 'Reporting for duty!'],
  again: "Still here! Click me if you need anything.",
  tips: [
    'Tip: press Ctrl+Alt+Space and just tell me what to do.',
    'It looks like you are working hard. Want me to hold your hat?',
    'Psst. The witch hat is very in this season.',
    'Click me for chat, voice commands, costumes and more.',
    'I bend, but I never break. Mostly.',
    'Right-click me for a quick menu.',
  ],
};
let sayTimer = null;
let typeTimer = null;
let lastSayAt = performance.now();

function say(text, ms = 6500) {
  if (menuOpen) return;
  clearTimeout(sayTimer);
  clearInterval(typeTimer);
  lastSayAt = performance.now();
  sayEl.classList.add('show');
  flash('talking', Math.min(2600, 400 + text.length * 28));
  if (reducedMotion()) {
    sayText.textContent = text;
  } else {
    let i = 0;
    sayText.innerHTML = '<span class="caret"></span>';
    typeTimer = setInterval(() => {
      i += 1;
      sayText.textContent = text.slice(0, i);
      if (i < text.length) sayText.insertAdjacentHTML('beforeend', '<span class="caret"></span>');
      else clearInterval(typeTimer);
    }, 24);
  }
  sayTimer = setTimeout(hideSay, ms + text.length * 24);
}

function hideSay() {
  clearTimeout(sayTimer);
  clearInterval(typeTimer);
  sayEl.classList.remove('show');
}

const pick = (v) => (Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v);
$('.say-close', sayEl).addEventListener('click', hideSay);
sayEl.addEventListener('click', (e) => { if (e.target === sayEl || e.target === sayText) hideSay(); });

api.onSay(({ kind, text }) => {
  wake();
  setTimeout(() => say(text || pick(LINES[kind] || LINES.hello)), kind === 'again' ? 0 : 900);
});

setInterval(() => {
  if (!settings.behavior.idleChatter || menuOpen || activePanel || mood.sleep || mood.external || press) return;
  const since = performance.now() - lastSayAt;
  if (since > (7 + Math.random() * 6) * 60 * 1000) say(pick(LINES.tips));
}, 60 * 1000);

// ---------------------------------------------------------------- settings + lifecycle
api.onSettings((next) => {
  const prev = settings;
  settings = next;
  applyPrefs(next);
  if (JSON.stringify(prev.costume) !== JSON.stringify(next.costume)) {
    applyCostume(svg, next.costume, prev.costume, { uid: 'pet', animate: !reducedMotion() });
    flash('happy', 1000);
    squash(0.7);
    sfx.pop();
  }
});

api.onGoodbye(() => {
  closeMenu({ silent: true });
  hideSay();
  stage.classList.add('leaving');
  sfx.close();
});

stage.classList.add('entering');
setTimeout(() => stage.classList.remove('entering'), 1000);
renderMood();
api.petReady();
