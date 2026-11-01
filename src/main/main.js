// Clippy — an agentic desktop pet. Main process entry.
import { app, BrowserWindow, Menu, globalShortcut, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Settings } from './settings.js';
import { Pet } from './pet.js';
import { Panels } from './panels.js';
import { WindowsSpeech, FakeSpeech, transcribeOpenAI } from './speech.js';
import { createAgent } from './agent.js';
import { createTools } from './tools.js';
import { Uia } from './uia.js';
import { createTray } from './tray.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '..');
const NATIVE = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(ROOT, 'native');
const ICONS = path.join(SRC, 'renderer', 'assets', 'icons');
const PRELOAD = path.join(SRC, 'preload', 'preload.cjs');
const APP_ORIGIN = 'app://clippy';
const STOP_HOTKEY = 'Control+Alt+Backspace';

app.setAppUserModelId('com.kiroween.clippy');
if (process.env.CLIPPY_USER_DATA) app.setPath('userData', process.env.CLIPPY_USER_DATA);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Serve renderer files from a privileged custom scheme instead of file://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

function serveAppProtocol() {
  const allowed = [path.join(SRC, 'renderer'), path.join(SRC, 'shared')];
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url);
    const file = path.normalize(path.join(SRC, decodeURIComponent(pathname)));
    if (host !== 'clippy' || !allowed.some((dir) => file.startsWith(dir + path.sep))) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

let settings, pet, panels, agent, speech, trayCtl, uia;
let quitting = false;
const chats = new Map();

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  globalShortcut.register(STOP_HOTKEY, () => agent.stop());
  if (!accelerator) return { ok: true };
  try {
    const ok = globalShortcut.register(accelerator, () => {
      if (panels.visible && panels.current === 'direct') panels.send('direct:toggle');
      else panels.open('direct');
    });
    return ok ? { ok: true } : { ok: false, error: 'That shortcut is already taken by another app.' };
  } catch (err) {
    return { ok: false, error: `Invalid shortcut: ${err.message}` };
  }
}

function applyLoginItem(on) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!on });
}

function speechEngine() {
  if (process.env.CLIPPY_FAKE_SPEECH) return (speech.fake ??= new FakeSpeech().on('event', relayDictation));
  return speech.windows;
}

function relayDictation(evt) {
  panels.send('dictation:event', evt);
  if (evt.type === 'started') pet.send('pet:mood', 'listening');
  if (evt.type === 'stopped') pet.send('pet:mood', null);
}

/** Spoken commands run in the background and answer in Clippy's speech bubble. */
async function runDirect(command) {
  pet.send('pet:mood', 'thinking');
  let reply = '';
  try {
    for await (const evt of agent.direct(command)) {
      if (evt.type === 'delta') reply += evt.text;
    }
  } catch (err) {
    reply = err.name === 'AbortError' ? 'Stopped.' : err.message;
  }
  pet.send('pet:mood', null);
  pet.send('pet:say', { text: reply.trim().split('\n\n').at(-1) || 'Done!' });
}

async function quitWithGoodbye() {
  if (quitting) return;
  quitting = true;
  await panels?.close();
  pet?.send('pet:goodbye');
  setTimeout(() => app.quit(), 520);
}

function wireIpc() {
  const fromSender = (e) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle('settings:get', () => settings.public);
  ipcMain.handle('settings:patch', (_e, patch) => settings.patch(patch));
  ipcMain.handle('settings:reset', () => settings.reset());
  ipcMain.handle('settings:set-secret', (_e, name, value) => settings.setSecret(name, value));
  ipcMain.handle('hotkey:set', (_e, accel) => {
    const res = registerHotkey(accel);
    if (res.ok) settings.patch({ voice: { hotkey: accel || '' } });
    else registerHotkey(settings.data.voice.hotkey);
    return res;
  });

  ipcMain.on('win:interactive', (e, on) => {
    const w = fromSender(e);
    if (!w) return;
    if (on) w.setIgnoreMouseEvents(false);
    else w.setIgnoreMouseEvents(true, { forward: true });
  });

  // pet
  ipcMain.on('pet:drag-start', (_e, p) => pet.beginDrag(p));
  ipcMain.on('pet:drag-end', () => pet.endDrag());
  ipcMain.on('pet:menu', (_e, open) => { if (open) pet.ensureRingVisible(); });
  ipcMain.on('pet:mood', (_e, mood) => pet.send('pet:mood', mood));
  ipcMain.on('pet:ready', () => {
    pet.send('pet:say', { kind: settings.data.pet.greeted ? 'hello' : 'intro' });
    if (!settings.data.pet.greeted) settings.patch({ pet: { greeted: true } });
  });
  ipcMain.on('pet:context-menu', () => {
    Menu.buildFromTemplate([
      { label: 'Chat', click: () => panels.open('chat') },
      { label: 'Direct', click: () => panels.open('direct') },
      { label: 'Wardrobe', click: () => panels.open('customize') },
      { label: 'Arcade', click: () => panels.open('games') },
      { label: 'Settings', click: () => panels.open('settings') },
      { type: 'separator' },
      { label: 'Hide Clippy', click: () => trayCtl.hidePet() },
      { label: 'Quit Clippy', click: quitWithGoodbye },
    ]).popup({ window: pet.win });
  });

  // panels
  ipcMain.on('panel:open', (_e, name) => panels.toggle(name));
  ipcMain.on('panel:close', () => panels.close());
  ipcMain.on('panel:ack', (_e, token) => panels.ack(token));
  ipcMain.on('panel:drag-start', () => pet.beginDragFromCursor());

  // chat
  ipcMain.on('chat:send', async (e, { id, messages }) => {
    const ctrl = new AbortController();
    chats.set(id, ctrl);
    const send = (evt) => !e.sender.isDestroyed() && e.sender.send('chat:event', { id, ...evt });
    pet.send('pet:mood', 'thinking');
    let talking = false;
    try {
      const clean = (Array.isArray(messages) ? messages : [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 20000) }));
      for await (const evt of agent.chat(clean, ctrl.signal)) {
        if (evt.type === 'delta' && !talking) { talking = true; pet.send('pet:mood', 'talking'); }
        send(evt);
      }
      send({ type: 'done' });
    } catch (err) {
      send(err.name === 'AbortError' ? { type: 'done', aborted: true } : { type: 'error', message: err.message });
    } finally {
      chats.delete(id);
      pet.send('pet:mood', null);
    }
  });
  ipcMain.on('chat:cancel', (_e, id) => chats.get(id)?.abort());

  // dictation / direct
  ipcMain.handle('dictation:start', () => {
    const engine = settings.data.voice.engine;
    if (engine === 'openai') {
      pet.send('pet:mood', 'listening');
      return { ok: true, engine: 'openai' };
    }
    const ok = speechEngine().start(settings.data.voice.language);
    return { ok, engine: process.env.CLIPPY_FAKE_SPEECH ? 'fake' : 'windows' };
  });
  ipcMain.on('dictation:stop', () => {
    if (settings.data.voice.engine === 'openai') pet.send('pet:mood', null);
    else speechEngine().stop();
  });
  ipcMain.on('dictation:cancel', () => {
    pet.send('pet:mood', null);
    if (settings.data.voice.engine !== 'openai') speechEngine().cancel();
  });
  ipcMain.handle('dictation:transcribe', async (_e, { audio, mime }) => {
    try {
      const text = await transcribeOpenAI({
        audio: Buffer.from(audio),
        mime,
        apiKey: await settings.getSecret('openai'),
        model: settings.data.voice.transcribeModel,
        language: settings.data.voice.language,
      });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('direct:dispatch', (_e, text) => {
    if (!agent.hasKey()) return { ok: false, error: 'Add an API key in Settings → AI so I can get to work.' };
    runDirect(String(text).slice(0, 20000));
    return { ok: true };
  });

  // app
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    userData: app.getPath('userData'),
  }));
  ipcMain.on('app:hide', () => trayCtl.hidePet());
  ipcMain.on('app:quit', quitWithGoodbye);
}

function onSettingsChange(data, prev, patch) {
  broadcast('settings:changed', settings.public);
  if (patch.behavior && data.behavior.alwaysOnTop !== prev.behavior.alwaysOnTop) {
    pet.win?.setAlwaysOnTop(data.behavior.alwaysOnTop, 'screen-saver');
    panels.setAlwaysOnTop(data.behavior.alwaysOnTop);
  }
  if (patch.behavior && data.behavior.launchAtLogin !== prev.behavior.launchAtLogin) applyLoginItem(data.behavior.launchAtLogin);
  if (patch.pet && data.pet.scale !== prev.pet.scale) {
    pet.applyScale();
    panels.follow();
  }
  if (patch.voice && (data.voice.language !== prev.voice.language || data.voice.engine !== prev.voice.engine)) {
    if (data.voice.engine === 'windows') speech.windows.warm(data.voice.language);
    else speech.windows.dispose();
  }
}

app.whenReady().then(async () => {
  serveAppProtocol();
  Menu.setApplicationMenu(null);

  // Microphone for cloud dictation + mic test; deny everything else.
  const ses = session.defaultSession;
  const allow = (wc, permission) => permission === 'media' && wc.getURL().startsWith(APP_ORIGIN);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(allow(wc, permission)));
  ses.setPermissionCheckHandler((wc, permission) => !!wc && allow(wc, permission));

  settings = await new Settings(app.getPath('userData')).init();
  speech = { windows: new WindowsSpeech(NATIVE) };
  speech.windows.on('event', relayDictation);

  pet = new Pet({ settings, preload: PRELOAD, url: `${APP_ORIGIN}/renderer/pet/index.html` });
  panels = new Panels({ pet, settings, preload: PRELOAD, url: `${APP_ORIGIN}/renderer/panel/index.html` });
  pet.create();
  panels.create();
  pet.on('moved', () => panels.follow());
  uia = new Uia(NATIVE, process.pid);
  agent = createAgent({
    settings,
    tools: createTools({ uia, pet }),
    logFile: path.join(app.getPath('userData'), 'agent.log'),
  });

  trayCtl = createTray({ iconDir: ICONS, pet, panels, settings, onQuit: quitWithGoodbye });
  settings.on('change', onSettingsChange);
  wireIpc();
  registerHotkey(settings.data.voice.hotkey);
  applyLoginItem(settings.data.behavior.launchAtLogin);

  // Warm the offline recognizer so the first "Direct" is instant.
  if (settings.data.voice.engine === 'windows') setTimeout(() => speech.windows.warm(settings.data.voice.language), 2500);
});

// Never let renderers open new windows or navigate away.
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(APP_ORIGIN)) e.preventDefault(); });
});

app.on('second-instance', () => {
  if (!pet) return;
  pet.show();
  pet.send('pet:say', { kind: 'again' });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  speech?.windows.dispose();
  speech?.fake?.dispose();
  uia?.dispose();
  settings?.flush();
});
