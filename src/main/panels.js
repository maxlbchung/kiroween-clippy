// One reusable transparent window hosts every panel (chat, direct, wardrobe,
// arcade, settings). It is anchored beside Clippy and follows him around.
import { BrowserWindow, screen } from 'electron';
import { PANELS } from '../shared/layout.js';
import { placePanel } from './placement.js';

export class Panels {
  constructor({ pet, settings, preload, url }) {
    this.pet = pet;
    this.settings = settings;
    this.preload = preload;
    this.url = url;
    this.win = null;
    this.current = null;
    this.visible = false;
    this.place = null;
    this.queue = Promise.resolve();
    this.pending = new Map();
    this.token = 0;
    this.loaded = null;
  }

  create() {
    this.win = new BrowserWindow({
      width: 400,
      height: 400,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      thickFrame: false,
      roundedCorners: false,
      alwaysOnTop: this.settings.data.behavior.alwaysOnTop,
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      title: 'Clippy',
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: true,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    if (this.settings.data.behavior.alwaysOnTop) this.win.setAlwaysOnTop(true, 'pop-up-menu');
    this.loaded = new Promise((res) => this.win.webContents.once('did-finish-load', res));
    this.win.loadURL(this.url);
    this.win.on('closed', () => { this.win = null; });
    return this.win;
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  /** Send a message and wait for the renderer to ack it (or time out). */
  request(channel, payload, timeout = 700) {
    const token = ++this.token;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(token); resolve(false); }, timeout);
      this.pending.set(token, () => { clearTimeout(timer); resolve(true); });
      this.send(channel, { ...payload, token });
    });
  }

  ack(token) {
    const fn = this.pending.get(token);
    if (fn) { this.pending.delete(token); fn(); }
  }

  open(name, data) {
    this.queue = this.queue.then(() => this._open(name, data)).catch((e) => console.error('[panels]', e));
    return this.queue;
  }

  toggle(name) {
    if (this.visible && this.current === name) return this.close();
    return this.open(name);
  }

  close() {
    this.queue = this.queue.then(() => this._close()).catch((e) => console.error('[panels]', e));
    return this.queue;
  }

  computePlacement(name, preferSide) {
    const petBounds = this.pet.bounds;
    const scale = this.pet.scale;
    const center = { x: Math.round(petBounds.x + petBounds.width / 2), y: Math.round(petBounds.y + petBounds.height / 2) };
    const workArea = screen.getDisplayNearestPoint(center).workArea;
    return placePanel({ petBounds, scale, panel: PANELS[name], workArea, preferSide });
  }

  async _open(name, data) {
    if (!PANELS[name] || !this.win || !this.pet.win) return;
    if (this.visible && this.current === name) {
      if (PANELS[name].focus !== false) this.win.focus();
      this.send('panel:focus', { name, data });
      return;
    }
    if (this.visible) await this._close({ silentPet: true });
    await this.loaded;
    if (!this.pet.visible) this.pet.show();

    const place = this.computePlacement(name);
    this.place = place;
    this.current = name;
    this.win.setBounds(place.bounds);
    await this.request('panel:open', {
      name,
      panel: PANELS[name],
      side: place.side,
      tailY: place.tailY,
      originX: place.originX,
      originY: place.originY,
      data,
    });
    if (PANELS[name].focus === false) {
      this.win.showInactive();
    } else {
      this.win.show();
      this.win.focus();
    }
    this.visible = true;
    this.send('panel:enter', { name });
    this.pet.send('pet:panel', { name, side: place.side });
  }

  async _close({ silentPet = false } = {}) {
    if (!this.visible || !this.win) return;
    await this.request('panel:leave', { name: this.current }, 600);
    this.win.hide();
    this.visible = false;
    const was = this.current;
    this.current = null;
    if (!silentPet) this.pet.send('pet:panel', { name: null, was });
  }

  /** Re-anchor while Clippy is dragged. */
  follow() {
    if (!this.visible || !this.win || !this.current) return;
    const place = this.computePlacement(this.current, this.place?.side);
    const b = this.win.getBounds();
    if (b.x !== place.bounds.x || b.y !== place.bounds.y) this.win.setBounds(place.bounds);
    if (!this.place || place.side !== this.place.side || place.tailY !== this.place.tailY) {
      this.send('panel:anchor', { side: place.side, tailY: place.tailY, originX: place.originX, originY: place.originY });
      if (place.side !== this.place?.side) this.pet.send('pet:panel', { name: this.current, side: place.side });
    }
    this.place = place;
  }

  setAlwaysOnTop(on) {
    if (!this.win) return;
    this.win.setAlwaysOnTop(on, 'pop-up-menu');
  }
}
