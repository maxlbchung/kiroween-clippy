// Chat: speech-bubble conversation with Clippy. The agent lives in the main
// process; this view handles streaming, tool steps, history and polish.
import { icon } from '../../common/icons.js';
import { $, esc, sfx, reducedMotion } from '../../common/ui.js';

const SUGGESTIONS = ['What can you do?', "What's using my disk space?", 'Show me how to change my wallpaper'];

// Survives panel close/re-open (the panel window stays alive).
const state = { messages: [], streamId: null, error: null, draft: '' };

function format(text) {
  // minimal, safe formatting: **bold**, `code`, line breaks
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="chat">
      <header class="chat-head">
        <div class="chat-title px"><span class="live-dot"></span>Clippy <span class="chat-sub">chat</span></div>
        <div class="chat-actions">
          <button class="icon-btn" data-act="new" title="New chat" aria-label="New chat">${icon('reset', 14)}</button>
          <button class="icon-btn" data-act="close" title="Close" aria-label="Close"><span class="x-glyph"></span></button>
        </div>
      </header>
      <div class="chat-log" role="log" aria-live="polite"></div>
      <form class="chat-input">
        <textarea class="field" rows="1" placeholder="Ask me anything…" aria-label="Message"></textarea>
        <button class="btn btn-primary send-btn" type="submit" aria-label="Send">${icon('send', 16)}</button>
      </form>
      <div class="chat-hint">Enter to send · Shift+Enter for a new line</div>
    </div>`;

  const log = $('.chat-log', el);
  const form = $('.chat-input', el);
  const input = $('textarea', el);
  const sendBtn = $('.send-btn', el);
  let offChat = null;

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const scrollDown = (smooth = true) =>
    log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });

  function emptyState() {
    return `
      <div class="chat-empty">
        <div class="chat-empty-title px">What can I help with?</div>
        <p>I can use your apps, run commands and look things up. Ctrl+Alt+Backspace stops me at any time.</p>
        <div class="chips">${SUGGESTIONS.map((s) => `<button class="btn btn-sm chip-btn" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      </div>`;
  }

  function msgHtml(m, i) {
    const streaming = state.streamId && i === state.messages.length - 1 && m.role === 'assistant';
    if (m.role === 'user') return `<div class="msg msg-me" data-i="${i}"><div class="msg-card">${format(m.content)}</div></div>`;
    const steps = m.steps?.length ? `<div class="msg-steps">${m.steps.map((s) => `<div>${esc(s)}</div>`).join('')}</div>` : '';
    const body = m.content
      ? `${format(m.content)}${streaming ? '<span class="stream-caret"></span>' : ''}`
      : '<span class="typing"><i></i><i></i><i></i></span>';
    return `<div class="msg msg-clippy" data-i="${i}"><div class="msg-text">${steps}${body}</div></div>`;
  }

  function render() {
    if (!state.messages.length) {
      log.innerHTML = emptyState();
    } else {
      log.innerHTML = state.messages.map(msgHtml).join('') +
        (state.error ? `<div class="msg-error">${esc(state.error)} <button class="btn btn-sm" data-act="retry">Retry</button></div>` : '');
    }
    syncSend();
  }

  function syncSend() {
    sendBtn.innerHTML = state.streamId ? '<span class="stop-sq"></span>' : icon('send', 16);
    sendBtn.setAttribute('aria-label', state.streamId ? 'Stop' : 'Send');
  }

  function updateLast() {
    const i = state.messages.length - 1;
    const node = log.querySelector(`[data-i="${i}"]`);
    if (!node) return render();
    const stick = nearBottom();
    node.outerHTML = msgHtml(state.messages[i], i);
    if (stick) scrollDown(false);
  }

  function appendNode(i) {
    log.querySelector('.chat-empty')?.remove();
    log.insertAdjacentHTML('beforeend', msgHtml(state.messages[i], i));
    const node = log.lastElementChild;
    if (!reducedMotion()) {
      node.animate(
        [{ opacity: 0, transform: 'translateY(10px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' },
      );
    }
    scrollDown();
  }

  function ask() {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    state.streamId = id;
    state.error = null;
    state.messages.push({ role: 'assistant', content: '' });
    appendNode(state.messages.length - 1);
    syncSend();
    const history = state.messages.slice(0, -1).filter((m) => m.content);
    ctx.api.chatSend(id, history);
  }

  function send(text) {
    const t = text.trim();
    if (!t || state.streamId) return;
    sfx.send();
    state.messages.push({ role: 'user', content: t });
    appendNode(state.messages.length - 1);
    input.value = '';
    state.draft = '';
    autosize();
    ask();
  }

  offChat = ctx.api.onChat((evt) => {
    if (evt.id !== state.streamId) return;
    const last = state.messages[state.messages.length - 1];
    if (evt.type === 'delta') {
      last.content += evt.text;
      updateLast();
    } else if (evt.type === 'step') {
      (last.steps ??= []).push(evt.label);
      updateLast();
    } else {
      state.streamId = null;
      if (evt.type === 'error') {
        state.error = evt.message || 'Something went wrong.';
        if (!last.content && !last.steps) state.messages.pop();
        sfx.error();
        render();
        scrollDown();
      } else {
        if (!last.content && !last.steps) state.messages.pop();
        render();
        sfx.boop();
      }
      syncSend();
    }
  });

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(96, input.scrollHeight)}px`;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.streamId) ctx.api.chatCancel(state.streamId);
    else send(input.value);
  });
  input.addEventListener('input', () => { state.draft = input.value; autosize(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    } else if (e.key === 'ArrowUp' && !input.value) {
      const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
      if (lastUser) { input.value = lastUser.content; autosize(); e.preventDefault(); }
    }
  });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.suggest) send(b.dataset.suggest);
    else if (b.dataset.act === 'close') { sfx.close(); ctx.close(); }
    else if (b.dataset.act === 'new') {
      if (state.streamId) ctx.api.chatCancel(state.streamId);
      state.messages = [];
      state.streamId = null;
      state.error = null;
      render();
      input.focus();
    } else if (b.dataset.act === 'retry') {
      state.error = null;
      render();
      ask();
    }
  });

  input.value = state.draft;
  render();
  autosize();
  scrollDown(false);

  return {
    onEnter() { setTimeout(() => input.focus(), 60); },
    onFocus() { input.focus(); },
    unmount() { offChat?.(); },
  };
}
