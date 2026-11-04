// Full-screen overlay window for games that Clippy plays on the desktop itself.
// While a game runs, the pet window is hidden and the overlay draws Clippy.

import { BrowserWindow, screen } from "electron";
import { PET } from "../shared/layout.js";
import type { GameId, GameInit, GameResult } from "../shared/types.js";
import type { Panels } from "./panels.js";
import type { Pet } from "./pet.js";

const PAGES: Record<GameId, string> = {
	dodge: "renderer/games/dodge/index.html",
};

// Shows the overlay anyway if the renderer never reports that it is ready.
const READY_TIMEOUT_MS = 3000;

export class Arcade {
	pet: Pet;
	panels: Panels;
	preload: string;
	origin: string;
	onExit: (id: GameId, result: GameResult | null) => void;
	win: BrowserWindow | null = null;
	init: GameInit | null = null;
	revealed = false;

	constructor({
		pet,
		panels,
		preload,
		origin,
		onExit,
	}: {
		pet: Pet;
		panels: Panels;
		preload: string;
		origin: string;
		onExit: (id: GameId, result: GameResult | null) => void;
	}) {
		this.pet = pet;
		this.panels = panels;
		this.preload = preload;
		this.origin = origin;
		this.onExit = onExit;
	}

	get playing() {
		return !!this.win;
	}

	/** Closes any open panel and opens game `id` over the pet's display. */
	async launch(id: GameId) {
		if (!PAGES[id] || !this.pet.win) return;
		if (this.win) {
			this.win.focus();
			return;
		}
		await this.panels.close();
		const petBounds = this.pet.bounds;
		const scale = this.pet.scale;
		const display = screen.getDisplayNearestPoint({
			x: Math.round(petBounds.x + petBounds.width / 2),
			y: Math.round(petBounds.y + petBounds.height / 2),
		});
		const area = display.bounds;
		const cursor = screen.getCursorScreenPoint();
		this.init = {
			id,
			scale,
			home: {
				x: petBounds.x - area.x + PET.svg.left * scale,
				y: petBounds.y - area.y + PET.svg.top * scale,
				width: PET.svg.width * scale,
				height: PET.svg.height * scale,
			},
			cursor: { x: cursor.x - area.x, y: cursor.y - area.y },
		};
		this.revealed = false;

		const win = new BrowserWindow({
			...area,
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			movable: false,
			maximizable: false,
			minimizable: false,
			fullscreenable: false,
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
				autoplayPolicy: "no-user-gesture-required",
			},
		});
		this.win = win;
		win.setAlwaysOnTop(true, "screen-saver");
		win.on("closed", () => {
			if (this.win === win) this.finish(null);
		});
		// Never leave a dead full-screen window covering the desktop.
		win.webContents.on("render-process-gone", () => this.close());
		win.on("unresponsive", () => this.close());
		win.loadURL(`${this.origin}/${PAGES[id]}`);
		setTimeout(() => {
			if (this.win === win) this.reveal();
		}, READY_TIMEOUT_MS);
	}

	/** Swaps the pet window for the overlay once the overlay has drawn Clippy. */
	reveal() {
		if (!this.win || this.revealed) return;
		this.revealed = true;
		this.win.show();
		this.win.focus();
		this.pet.win?.hide();
	}

	/** Closes the overlay and brings the pet back. */
	exit(result: GameResult | null) {
		if (!this.win) return;
		const win = this.win;
		this.finish(result);
		if (!win.isDestroyed()) win.destroy();
	}

	close() {
		this.exit(null);
	}

	finish(result: GameResult | null) {
		const id = this.init?.id;
		this.win = null;
		this.init = null;
		if (this.pet.win && !this.pet.win.isDestroyed())
			this.pet.win.showInactive();
		this.onExit(id, result);
	}
}
