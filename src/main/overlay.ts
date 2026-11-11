// Transparent, always-on-top, click-through windows, one per display, where
// the agent draws Outlines, its speech bubble, baby Clippy and the takeover
// banner. Only the title bar and the bubble take clicks, and the windows
// never take focus from other apps.

import { EventEmitter } from "node:events";
import { BrowserWindow, type Display, screen } from "electron";
import { PET } from "../shared/layout.js";
import type {
	HelperAct,
	OverlayEvent,
	OverlayHelper,
	OverlayOutline,
	OverlayState,
	Point,
	Rect,
} from "../shared/types.js";
import {
	helperBesidePet,
	helperBesidePoint,
	helperMoveMs,
	titleBarSide,
	truncateTitle,
} from "./agent/geometry.js";
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
	/** Baby Clippy in screen DIP. */
	helperState: OverlayHelper | null = null;
	bannerText: string | null = null;

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

	/**
	 * Shows baby Clippy beside `at` (screen DIP), or where he is when `at`
	 * is omitted, starting beside the Pet, and plays `act`. null removes
	 * him. Resolves when his slide ends.
	 */
	helper(spec: { at?: Point; act?: HelperAct } | null): Promise<void> {
		const prev = this.helperState;
		if (!spec) {
			this.helperState = null;
			this.render();
			return Promise.resolve();
		}
		const body = this.anchor;
		const scale = body ? body.height / PET.body.height : 1;
		let rect = prev?.rect;
		if (spec.at)
			rect = helperBesidePoint(
				spec.at,
				scale,
				screen.getDisplayNearestPoint({
					x: Math.round(spec.at.x),
					y: Math.round(spec.at.y),
				}).bounds,
			);
		rect ??= body ? helperBesidePet(body, scale) : undefined;
		if (!rect) return Promise.resolve();
		const moveMs = prev ? helperMoveMs(prev.rect, rect) : 0;
		this.helperState = {
			rect,
			moveMs,
			act: spec.act ?? null,
			actId: (prev?.actId ?? 0) + (spec.act ? 1 : 0),
		};
		this.render();
		return new Promise((resolve) => setTimeout(resolve, moveMs));
	}

	/** Shows the takeover banner on every display, or hides it. */
	banner(text: string | null) {
		this.bannerText = text;
		this.render();
	}

	render() {
		const displays = screen.getAllDisplays();
		for (const d of displays) {
			const state: OverlayState = {
				outline: null,
				bubble: null,
				helper: null,
				banner: this.bannerText,
			};
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
			const h = this.helperState;
			if (h && centerIn(h.rect, d.bounds))
				state.helper = { ...h, rect: local(h.rect, d.bounds) };
			const empty =
				!state.outline && !state.bubble && !state.helper && !state.banner;
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
		this.helperState = null;
		this.bannerText = null;
		for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy();
		this.wins.clear();
	}
}
