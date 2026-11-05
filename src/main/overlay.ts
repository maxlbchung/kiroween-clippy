// Transparent, always-on-top, click-through windows, one per display, where
// the agent draws Outlines and its speech bubble. Only the title bar and the
// bubble take clicks, and the windows never take focus from other apps.

import { EventEmitter } from "node:events";
import { BrowserWindow, type Display, screen } from "electron";
import type {
	OverlayEvent,
	OverlayOutline,
	OverlayState,
	Rect,
} from "../shared/types.js";
import { titleBarSide, truncateTitle } from "./agent/geometry.js";
import type { BubbleButton, OutlineSpec } from "./agent/runner.js";

const TITLE_BAR_HEIGHT = 26;

const centerIn = (r: Rect, d: Rect) => {
	const cx = r.x + r.width / 2;
	const cy = r.y + r.height / 2;
	return cx >= d.x && cy >= d.y && cx < d.x + d.width && cy < d.y + d.height;
};

const local = (r: Rect, d: Rect): Rect => ({
	x: r.x - d.x,
	y: r.y - d.y,
	width: r.width,
	height: r.height,
});

type Bubble = {
	id: number;
	text: string;
	buttons: BubbleButton[];
	resolve: (answer: string | null) => void;
};

/**
 * Emits "outline-button" ("skip" | "close") and "hover" ({ id, on }).
 * Bubble button clicks resolve the promise `say` returned.
 */
export class Overlay extends EventEmitter {
	preload: string;
	url: string;
	wins = new Map<number, BrowserWindow>();
	loaded = new Map<number, Promise<void>>();
	outlineSpec: OutlineSpec | null = null;
	bubble: Bubble | null = null;
	anchor: Rect | null = null;
	nextBubble = 1;

	constructor({ preload, url }: { preload: string; url: string }) {
		super();
		this.preload = preload;
		this.url = url;
		screen.on("display-removed", (_e, d) => this.drop(d.id));
		screen.on("display-metrics-changed", (_e, d) => this.drop(d.id));
	}

	/** Every overlay window, for hiding them from screenshots. */
	get windows(): BrowserWindow[] {
		return [...this.wins.values()];
	}

	get bubbleVisible() {
		return !!this.bubble;
	}

	windowFor(d: Display): BrowserWindow {
		const existing = this.wins.get(d.id);
		if (existing && !existing.isDestroyed()) return existing;
		const win = new BrowserWindow({
			...d.bounds,
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			movable: false,
			maximizable: false,
			minimizable: false,
			fullscreenable: false,
			focusable: false,
			skipTaskbar: true,
			hasShadow: false,
			thickFrame: false,
			roundedCorners: false,
			alwaysOnTop: true,
			type: process.platform === "win32" ? "toolbar" : undefined,
			title: "Clippy",
			webPreferences: {
				preload: this.preload,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				spellcheck: false,
			},
		});
		win.setAlwaysOnTop(true, "screen-saver");
		win.setIgnoreMouseEvents(true, { forward: true });
		win.setBounds(d.bounds);
		this.loaded.set(
			d.id,
			new Promise((res) =>
				win.webContents.once("did-finish-load", () => res()),
			),
		);
		win.loadURL(this.url);
		win.on("closed", () => {
			if (this.wins.get(d.id) === win) {
				this.wins.delete(d.id);
				this.loaded.delete(d.id);
			}
		});
		win.webContents.on("render-process-gone", () => this.drop(d.id));
		this.wins.set(d.id, win);
		return win;
	}

	drop(id: number) {
		const win = this.wins.get(id);
		this.wins.delete(id);
		this.loaded.delete(id);
		if (win && !win.isDestroyed()) win.destroy();
		this.render();
	}

	/** Handles a click or hover reported by an overlay window. */
	handle(e: OverlayEvent) {
		if (e.kind === "outline") this.emit("outline-button", e.button);
		else if (e.kind === "hover") this.emit("hover", e);
		else if (this.bubble && e.id === this.bubble.id) {
			const b = this.bubble;
			this.bubble = null;
			b.resolve(e.button);
			this.render();
		}
	}

	outline(spec: OutlineSpec | null) {
		this.outlineSpec = spec;
		this.render();
	}

	/** Clippy's body in screen DIP; the bubble is drawn above it. */
	setAnchor(rect: Rect | null) {
		this.anchor = rect;
		if (this.bubble) this.render();
	}

	/**
	 * Shows a bubble. Resolves with the clicked button id or "close", or
	 * null when another bubble replaces it or it is hidden.
	 */
	say(text: string, buttons: BubbleButton[] = []): Promise<string | null> {
		const prev = this.bubble;
		return new Promise((resolve) => {
			this.bubble = { id: this.nextBubble++, text, buttons, resolve };
			prev?.resolve(null);
			this.render();
		});
	}

	/** Id of the bubble on screen, or null. */
	get bubbleId(): number | null {
		return this.bubble?.id ?? null;
	}

	hideBubble(id?: number) {
		if (!this.bubble || (id !== undefined && this.bubble.id !== id)) return;
		const b = this.bubble;
		this.bubble = null;
		b.resolve(null);
		this.render();
	}

	clear() {
		this.outlineSpec = null;
		this.hideBubble();
		this.render();
	}

	render() {
		const displays = screen.getAllDisplays();
		for (const d of displays) {
			const state: OverlayState = { outline: null, bubble: null };
			const o = this.outlineSpec;
			if (o && centerIn(o.rect, d.bounds))
				state.outline = this.localOutline(o, d);
			if (this.bubble && this.anchor && centerIn(this.anchor, d.bounds))
				state.bubble = {
					id: this.bubble.id,
					text: this.bubble.text,
					buttons: this.bubble.buttons,
					anchor: local(this.anchor, d.bounds),
				};
			const empty = !state.outline && !state.bubble;
			const win = this.wins.get(d.id);
			if (empty && !win) continue;
			const w = win ?? this.windowFor(d);
			void this.loaded.get(d.id)?.then(() => {
				if (w.isDestroyed()) return;
				w.webContents.send("overlay:state", state);
				if (empty) w.hide();
				else if (!w.isVisible()) {
					w.showInactive();
					w.setAlwaysOnTop(true, "screen-saver");
				}
			});
		}
	}

	localOutline(o: OutlineSpec, d: Display): OverlayOutline {
		return {
			rect: local(o.rect, d.bounds),
			title: truncateTitle(o.title),
			step: o.step,
			kind: o.kind,
			side: titleBarSide(o.rect, d.bounds, TITLE_BAR_HEIGHT + 4),
		};
	}

	dispose() {
		this.bubble?.resolve(null);
		this.bubble = null;
		for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy();
		this.wins.clear();
	}
}
