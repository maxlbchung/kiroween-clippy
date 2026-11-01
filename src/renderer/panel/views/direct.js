// Direct: push-to-talk quick actions. Captures a spoken command and hands it to
// the action agent, which answers in Clippy's speech bubble.
import { icon } from '../../common/icons.js';
import { $, $$, esc, sfx } from '../../common/ui.js';

const BARS = 30;
const NO_SPEECH_MS = 9000;
const SILENCE_AFTER_SPEECH_MS = 1300;
const MAX_RECORD_MS = 30000;

const STATUS = {
  starting: 'Warming up…',
  listening: 'Listening…',
  finishing: 'Got it…',
  transcribing: 'Transcribing…',
  sent: 'Sent!',
  empty: "Didn't catch that",
  error: 'Hmm, a problem',
};

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="direct" data-state="starting">
      <div class="direct-top">
        <span class="rec-dot"></span>
        <span class="direct-label px">Direct</span>
        <span class="direct-status px">${STATUS.starting}</span>
        <button class="icon-btn" data-act="close" aria-label="Cancel"><span class="x-glyph"></span></button>
      </div>
      <div class="direct-stage">
        <div class="wave">${'<i></i>'.repeat(BARS)}</div>
        <div class="sent-badge">${icon('check', 28)}</div>
      </div>
      <div class="transcript"><span class="final"></span> <span class="partial"></span></div>
      <div class="direct-foot">
        <span class="hint direct-hint">Say a command — I'll just do it, no chit-chat.</span>
        <button class="btn btn-sm" data-act="stop"><span class="stop-sq"></span>Done</button>
        <button class="btn btn-sm" data-act="retry" hidden>Try again</button>
      </div>
    </div>`;

  const root = $('.direct', el);
  const statusEl = $('.direct-status', el);
  const finalEl = $('.final', el);
  const partialEl = $('.partial', el);
  const hintEl = $('.direct-hint', el);
  const bars = $$('.wave i', el);
  const stopBtn = $('[data-act="stop"]', el);
  const retryBtn = $('[data-act="retry"]', el);

  let state = 'starting';
  let finals = [];
  let partial = '';
  let levels = new Array(BARS).fill(0);
  let engine = null;
  let timers = [];
  let rec = null; // cloud recorder bits
  let alive = true;
  let off = null;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function setState(s, hint) {
    state = s;
    root.dataset.state = s;
    statusEl.textContent = STATUS[s] || s;
    if (hint !== undefined) hintEl.innerHTML = hint;
    stopBtn.hidden = !['starting', 'listening'].includes(s);
    retryBtn.hidden = !['empty', 'error'].includes(s);
  }

  function pushLevel(v) {
    levels.push(Math.max(0, Math.min(1, v)));
    levels = levels.slice(-BARS);
    bars.forEach((b, i) => {
      const l = levels[i];
      b.style.transform = `scaleY(${(0.08 + l * 0.92).toFixed(3)})`;
    });
  }

  function renderText() {
    finalEl.textContent = finals.join(' ');
    partialEl.textContent = partial;
  }

  const fullText = () => [...finals, partial].join(' ').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- lifecycle
  async function start() {
    clearTimers();
    finals = [];
    partial = '';
    renderText();
    levels.fill(0);
    pushLevel(0);
    setState('starting', "Say a command — I'll just do it, no chit-chat.");
    const res = await ctx.api.dictationStart();
    if (!alive) return;
    engine = res.engine;
    if (!res.ok) return; // error event explains why
    if (engine === 'openai') await startRecorder();
    later(() => { if (state === 'listening' && !fullText()) finish(); }, NO_SPEECH_MS);
  }

  function onListening() {
    if (state !== 'starting') return;
    setState('listening');
    sfx.start();
  }

  function scheduleAutoFinish() {
    if (!ctx.settings.voice.autoSend) return;
    clearTimeout(scheduleAutoFinish.t);
    scheduleAutoFinish.t = later(() => { if (state === 'listening') finish(); }, SILENCE_AFTER_SPEECH_MS);
  }

  async function finish() {
    if (!['listening', 'starting'].includes(state)) return;
    clearTimers();
    sfx.stop();
    if (engine === 'openai') return stopRecorder();
    setState('finishing');
    ctx.api.dictationStop();
    // Wait for the engine to flush its last phrase ("stopped" event), with a cap.
    later(() => { if (state === 'finishing') dispatch(); }, 1500);
  }

  async function dispatch() {
    if (!alive || ['sent', 'empty', 'error'].includes(state)) return;
    clearTimers();
    partial = partial && !finals.length ? partial : '';
    const text = fullText();
    renderText();
    if (!text) {
      setState('empty', 'Try again, a little closer to the mic.');
      ctx.setMood('sad');
      later(() => ctx.setMood(null), 1400);
      sfx.error();
      return;
    }
    const res = await ctx.api.directDispatch(text);
    if (!alive) return;
    if (!res.ok) return fail(res.error);
    setState('sent', 'On it. Ctrl+Alt+Backspace stops me.');
    sfx.select();
    later(() => alive && ctx.close(), 2400);
  }

  function fail(message) {
    clearTimers();
    setState('error', esc(message));
    sfx.error();
    ctx.setMood('sad');
    later(() => ctx.setMood(null), 1600);
  }

  // ---------------------------------------------------------------- engine events
  off = ctx.api.onDictation((evt) => {
    if (!alive) return;
    switch (evt.type) {
      case 'started': onListening(); break;
      case 'level': onListening(); pushLevel(evt.value / 100); break;
      case 'speech': onListening(); break;
      case 'partial':
        onListening();
        partial = evt.text;
        renderText();
        clearTimeout(scheduleAutoFinish.t);
        break;
      case 'final':
        onListening();
        if (evt.text) finals.push(evt.text);
        partial = '';
        renderText();
        scheduleAutoFinish();
        break;
      case 'error': fail(evt.message || 'Dictation failed.'); break;
      case 'stopped': if (state === 'finishing') dispatch(); break;
      default: break;
    }
  });

  // ---------------------------------------------------------------- cloud recorder
  async function startRecorder() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      ac.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      rec = { stream, recorder, chunks, ac, analyser, mime, raf: 0, heard: false, quietSince: 0, floor: 0.01, t0: performance.now() };
      recorder.start(250);
      onListening();
      const loop = () => {
        if (!rec) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (now - rec.t0 < 350) rec.floor = Math.max(rec.floor, rms);
        const threshold = Math.max(0.02, rec.floor * 2.2);
        pushLevel(Math.min(1, rms * 9));
        if (rms > threshold) { rec.heard = true; rec.quietSince = 0; }
        else if (rec.heard && !rec.quietSince) rec.quietSince = now;
        if (ctx.settings.voice.autoSend && rec.heard && rec.quietSince && now - rec.quietSince > SILENCE_AFTER_SPEECH_MS) return finish();
        if (now - rec.t0 > MAX_RECORD_MS) return finish();
        rec.raf = requestAnimationFrame(loop);
      };
      loop();
      later(() => { if (rec && !rec.heard && state === 'listening') { teardownRecorder(); dispatch(); } }, NO_SPEECH_MS);
    } catch (err) {
      fail(err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in Windows privacy settings.' : `Microphone error: ${err.message}`);
    }
  }

  function teardownRecorder() {
    if (!rec) return null;
    const r = rec;
    rec = null;
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ac.close().catch(() => {});
    return r;
  }

  async function stopRecorder() {
    const r = rec;
    if (!r) return;
    setState('transcribing');
    const stopped = new Promise((res) => { r.recorder.onstop = res; });
    r.recorder.stop();
    await stopped;
    teardownRecorder();
    ctx.api.dictationStop();
    const blob = new Blob(r.chunks, { type: r.mime });
    if (!r.heard || blob.size < 2000) return dispatch();
    const res = await ctx.api.transcribe(await blob.arrayBuffer(), r.mime);
    if (!alive) return;
    if (!res.ok) return fail(res.error);
    finals = res.text ? [res.text] : [];
    dispatch();
  }

  // ---------------------------------------------------------------- UI
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'stop') finish();
    if (act === 'retry') start();
    if (act === 'close') { cancel(); ctx.close(); }
  });

  function cancel() {
    clearTimers();
    if (rec) { try { rec.recorder.stop(); } catch { /* ignore */ } teardownRecorder(); }
    if (['starting', 'listening', 'finishing'].includes(state)) ctx.api.dictationCancel();
  }

  start();

  return {
    onToggle() {
      if (['starting', 'listening'].includes(state)) finish();
      else if (['empty', 'error', 'sent'].includes(state)) start();
    },
    onFocus() { if (['empty', 'error', 'sent'].includes(state)) start(); },
    onEscape() { cancel(); return false; },
    onLeave() { cancel(); },
    unmount() { alive = false; cancel(); off?.(); },
  };
}

