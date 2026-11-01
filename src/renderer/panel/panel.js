import { PANEL_PAD } from '../../shared/layout.js';
import { icon } from '../common/icons.js';
import { api, $, esc, installClickThrough, applyPrefs, reducedMotion, nextFrame, sfx } from '../common/ui.js';
import * as chat from './views/chat.js';
import * as direct from './views/direct.js';
import * as customize from './views/customize.js';
import * as games from './views/games.js';
import * as settingsView from './views/settings.js';

const VIEWS = { chat, direct, customize, games, settings: settingsView };
const TITLE_ICONS = { customize: 'customize', games: 'games', settings: 'settings' };

const root = $('#root');
const frame = $('#frame');

let settings = await api.getSettings();
applyPrefs(settings);
document.documentElement.style.setProperty('--pad', `${PANEL_PAD}px`);

let current = null; // { name, kind, handle }

const ctx = {
  api,
  get settings() { return settings; },
  close: () => api.closePanel(),
  setMood: (m) => api.setMood(m),
};

function buildFrame(name, panel) {
  frame.className = '';
  if (panel.kind === 'bubble') {
    frame.classList.add('frame-bubble');
    frame.innerHTML = `
      <svg class="bubble-tail" viewBox="0 0 20 34" aria-hidden="true"><path d="M20 3 Q12 14 1 19 Q11 22 20 30"/></svg>
      <div class="bubble-body"></div>`;
    return $('.bubble-body', frame);
  }
  frame.classList.add('frame-window');
  frame.innerHTML = `
    <div class="titlebar">
      ${icon(TITLE_ICONS[name] || 'info', 16)}
      <div class="titlebar-text">${esc(panel.title)}</div>
      <button class="icon-btn" data-close aria-label="Close"><span class="x-glyph"></span></button>
    </div>
    <div class="win-body"></div>`;
  $('[data-close]', frame).addEventListener('click', () => { sfx.close(); ctx.close(); });
  return $('.win-body', frame);
}

function setAnchor({ side, tailY, originX, originY }) {
  frame.classList.toggle('side-right', side === 'right');
  frame.classList.toggle('side-left', side === 'left');
  root.style.setProperty('--tail-y', `${tailY}px`);
  frame.style.transformOrigin = `${originX}px ${originY}px`;
}

function stopAnimations() {
  frame.getAnimations().forEach((a) => a.cancel());
}

async function animateIn() {
  stopAnimations();
  if (reducedMotion()) {
    frame.style.opacity = 1;
    return;
  }
  if (current.kind === 'bubble') {
    frame.animate(
      [
        { transform: 'scale(.15)', opacity: 0 },
        { transform: 'scale(1.035)', opacity: 1, offset: 0.62 },
        { transform: 'scale(.995)', opacity: 1, offset: 0.85 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
    );
  } else {
    frame.animate(
      [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 170, easing: 'ease-out', fill: 'both' },
    );
    frame.classList.add('entered');
  }
  frame.style.opacity = 1;
}

async function animateOut() {
  if (reducedMotion()) {
    frame.style.opacity = 0;
    return;
  }
  stopAnimations();
  if (current?.kind === 'bubble') {
    await frame.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.2)', opacity: 0 }],
      { duration: 190, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
    ).finished.catch(() => {});
  } else {
    await frame.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }],
      { duration: 110, easing: 'ease-in', fill: 'forwards' },
    ).finished.catch(() => {});
  }
  frame.style.opacity = 0;
}

api.onPanelOpen(async (msg) => {
  try { current?.handle?.unmount?.(); } catch (e) { console.error(e); }
  stopAnimations();
  frame.style.opacity = 0;
  root.style.setProperty('--w', `${msg.panel.width}px`);
  root.style.setProperty('--h', `${msg.panel.height}px`);
  const body = buildFrame(msg.name, msg.panel);
  current = { name: msg.name, kind: msg.panel.kind, handle: null };
  setAnchor(msg);
  try {
    current.handle = VIEWS[msg.name].mount(body, ctx, msg.data) || {};
  } catch (e) {
    console.error(e);
    body.innerHTML = `<p style="padding:16px">Something went wrong: ${esc(e.message)}</p>`;
  }
  await nextFrame();
  api.panelAck(msg.token);
});

api.onPanelEnter(() => {
  if (!current) return;
  animateIn();
  sfx.open();
  current.handle?.onEnter?.();
});

api.onPanelLeave(async ({ token }) => {
  try { current?.handle?.onLeave?.(); } catch (e) { console.error(e); }
  await animateOut();
  frame.classList.remove('entered');
  api.panelAck(token);
});

api.onPanelAnchor(setAnchor);
api.onPanelFocus(({ data }) => current?.handle?.onFocus?.(data));
api.onDirectToggle(() => current?.name === 'direct' && current.handle?.onToggle?.());

api.onSettings((s) => {
  settings = s;
  applyPrefs(s);
  current?.handle?.onSettings?.(s);
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !current) return;
  if (current.handle?.onEscape?.()) return;
  sfx.close();
  ctx.close();
});

// Dragging a panel's header moves Clippy, and the panel follows him.
frame.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.target.closest('.titlebar, .chat-head, .direct-top') || e.target.closest('button')) return;
  frame.setPointerCapture(e.pointerId);
  ctx.setMood('drag');
  api.panelDragStart();
  frame.addEventListener('lostpointercapture', () => {
    api.dragEnd();
    ctx.setMood(null);
  }, { once: true });
});

let pointerDown = false;
window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
window.addEventListener('pointerup', () => { pointerDown = false; }, true);
installClickThrough({ isLocked: () => pointerDown });
