// The always-on-top, transparent, click-through window Clippy lives in.

import { EventEmitter } from "node:events";
import { BrowserWindow, screen } from "electron";
import { PET, PET_SCALES } from "../shared/layout.js";
import type { Point } from "../shared/types.js";
import { clampPet, clampRing, defaultPetPosition } from "./placement.js";
import type { Settings } from "./settings.js";

const FRAME_MS = 1000 / 60;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export class Pet extends EventEmitter {
	settings: Settings;
	preload: string;
	url: string;
	win: BrowserWindow | null = null;
	drag: { ox: number; oy: number } | null = null;
	anim: ReturnType<typeof setInterval> | null = null;
	animDone: (() => void) | null = null;
	lastCursor: Point | null = null;
	cursorTimer: ReturnType<typeof setInterval> | null = null;
	dragTimer: ReturnType<typeof setInterval> | null = null;

	constructor({
		settings,
		preload,
		url,
	}: { settings: Settings; preload: string; url: string }) {
		super();
		this.settings = settings;
		this.preload = preload;
		this.url = url;
		this.win = null;
		this.drag = null;
		this.anim = null;
		this.lastCursor = null;
	}

	get scale() {
		const s = this.settings.data.pet.scale;
		return PET_SCALES.includes(s) ? s : 1;
	}

	size(scale = this.scale) {
		return {
			width: Math.round(PET.width * scale),
			height: Math.round(PET.height * scale),
		};
	}

	get bounds(): Electron.Rectangle | undefined {
		return this.win?.getBounds();
	}

	create() {
		const scale = this.scale;
		const pos = this.initialPosition(scale);
		const { alwaysOnTop } = this.settings.data.behavior;
		const win = new BrowserWindow({
			...pos,
			...this.size(scale),
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			maximizable: false,
			minimizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			hasShadow: false,
			thickFrame: false,
			roundedCorners: false,
			alwaysOnTop,
			type: process.platform === "win32" ? "toolbar" : undefined,
			title: "Clippy",
			webPreferences: {
				preload: this.preload,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				spellcheck: false,
				autoplayPolicy: "no-user-gesture-required",
			},
		});
		this.win = win;
		if (alwaysOnTop) win.setAlwaysOnTop(true, "screen-saver");
		win.setIgnoreMouseEvents(true, { forward: true });
		win.loadURL(this.url);
		win.once("ready-to-show", () => {
			if (this.settings.data.pet.visible !== false) win.showInactive();
		});
		win.on("blur", () => {
			this.send("pet:blur");
			if (this.settings.data.behavior.alwaysOnTop)
				win.setAlwaysOnTop(true, "screen-saver");
		});
		win.on("closed", () => {
			this.win = null;
			if (this.cursorTimer) clearInterval(this.cursorTimer);
		});
		this.startCursorFeed();
		return win;
	}

	initialPosition(scale: number): Point {
		const { x, y } = this.settings.data.pet;
		if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
			const display = screen.getDisplayNearestPoint({
				x: Math.round(x + PET.ring.cx * scale),
				y: Math.round(y + PET.ring.cy * scale),
			});
			return clampPet({ x, y }, scale, display.workArea);
		}
		return defaultPetPosition(scale, screen.getPrimaryDisplay().workArea);
	}

	send(channel: string, payload?: unknown) {
		if (this.win && !this.win.isDestroyed())
			this.win.webContents.send(channel, payload);
	}

	workAreaFor(pos: Point, scale = this.scale): Electron.Rectangle {
		return screen.getDisplayNearestPoint({
			x: Math.round(pos.x + PET.ring.cx * scale),
			y: Math.round(pos.y + PET.ring.cy * scale),
		}).workArea;
	}

	setPosition({ x, y }: Point) {
		if (!this.win) return;
		// setBounds with a fixed size avoids DPI-related size drift on Windows.
		this.win.setBounds({ x: Math.round(x), y: Math.round(y), ...this.size() });
		this.emit("moved");
	}

	// ---------- dragging ----------
	beginDrag({ x, y }: Point) {
		if (!this.win) return;
		this.stopAnim();
		this.drag = { ox: x, oy: y };
		if (this.dragTimer) clearInterval(this.dragTimer);
		this.dragTimer = setInterval(() => this.dragTick(), FRAME_MS);
	}

	/** Start a drag from outside the pet window, keeping the cursor's offset. */
	beginDragFromCursor() {
		const b = this.bounds;
		if (!b) return;
		const c = screen.getCursorScreenPoint();
		this.beginDrag({ x: c.x - b.x, y: c.y - b.y });
	}

	dragTick() {
		if (!this.drag || !this.win) return;
		const c = screen.getCursorScreenPoint();
		const want = { x: c.x - this.drag.ox, y: c.y - this.drag.oy };
		const display = screen.getDisplayNearestPoint(c);
		const pos = clampPet(want, this.scale, display.workArea);
		const b = this.win.getBounds();
		if (pos.x === b.x && pos.y === b.y) return;
		this.setPosition(pos);
		this.send("pet:moved", { x: pos.x, y: pos.y, t: Date.now() });
	}

	endDrag() {
		if (!this.drag) return;
		if (this.dragTimer) clearInterval(this.dragTimer);
		this.drag = null;
		this.savePosition();
	}

	savePosition() {
		const b = this.bounds;
		if (b) this.settings.patch({ pet: { x: b.x, y: b.y } });
	}

	// ---------- programmatic motion ----------
	stopAnim() {
		if (this.anim) clearInterval(this.anim);
		this.anim = null;
		const done = this.animDone;
		this.animDone = null;
		done?.();
	}

	/**
	 * Glides to `target` over `ms`. Resolves when the move ends or another
	 * move or drag interrupts it. With `persist`, saves the final position.
	 */
	animateTo(target: Point, ms = 280, persist = true): Promise<void> {
		if (!this.win) return Promise.resolve();
		this.stopAnim();
		const from = this.win.getBounds();
		if (from.x === target.x && from.y === target.y) return Promise.resolve();
		const t0 = Date.now();
		return new Promise((resolve) => {
			this.animDone = resolve;
			this.anim = setInterval(() => {
				const t = Math.min(1, (Date.now() - t0) / ms);
				const k = easeOutCubic(t);
				this.setPosition({
					x: from.x + (target.x - from.x) * k,
					y: from.y + (target.y - from.y) * k,
				});
				if (t >= 1) {
					this.stopAnim();
					if (persist) this.savePosition();
				}
			}, FRAME_MS);
		});
	}

	/** Nudge Clippy so the radial menu isn't cut off by the screen edge. */
	ensureRingVisible() {
		const b = this.bounds;
		if (!b) return;
		const target = clampRing(b, this.scale, this.workAreaFor(b));
		this.animateTo(target, 240);
	}

	applyScale() {
		const b = this.bounds;
		if (!b) return;
		const old = b.width / PET.width;
		const s = this.scale;
		// keep the ring centre fixed while resizing
		const cx = b.x + PET.ring.cx * old;
		const cy = b.y + PET.ring.cy * old;
		const pos = clampPet(
			{ x: cx - PET.ring.cx * s, y: cy - PET.ring.cy * s },
			s,
			this.workAreaFor(b, s),
		);
		this.setPosition(pos);
		this.savePosition();
	}

	// ---------- eye tracking feed ----------
	startCursorFeed() {
		if (this.cursorTimer) clearInterval(this.cursorTimer);
		this.cursorTimer = setInterval(() => {
			if (!this.win?.isVisible()) return;
			const c = screen.getCursorScreenPoint();
			if (
				this.lastCursor &&
				this.lastCursor.x === c.x &&
				this.lastCursor.y === c.y
			)
				return;
			this.lastCursor = c;
			const b = this.win.getBounds();
			this.send("pet:cursor", { x: c.x - b.x, y: c.y - b.y });
		}, 33);
	}

	show() {
		if (!this.win) return;
		this.win.showInactive();
		this.settings.patch({ pet: { visible: true } });
	}

	hide() {
		if (!this.win) return;
		this.win.hide();
		this.settings.patch({ pet: { visible: false } });
	}

	get visible() {
		return !!this.win?.isVisible();
	}
}
