// Screen access for the agent: UI snapshots and input through the Windows
// desktop host (native/desktop-host.ps1), and screenshots through Electron.
// Converts between the host's physical pixels and Electron's DIP coordinates.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import readline from "node:readline";
import { type BrowserWindow, desktopCapturer, screen } from "electron";
import type { Rect } from "../shared/types.js";
import type { InputCommand, Screen, Shot, UserInput } from "./agent/runner.js";
import {
	capElements,
	MAX_ELEMENTS,
	type UiSnapshot,
	type WindowInfo,
} from "./agent/snapshot.js";

/** Snapshot time budget inside the host, under the 1500 ms requirement. */
const SNAPSHOT_BUDGET_MS = 1100;
const REQUEST_TIMEOUT_MS = { snapshot: 2500, default: 4000 };
/** Longest screenshot edge sent to models. */
const SHOT_MAX_EDGE = 1568;

type HostEvent =
	| { type: "ready" }
	| { type: "error"; code?: string; message: string }
	| { type: "foreground"; window: WindowInfo }
	| { type: "input"; kind: "move" | "click" | "key"; x?: number; y?: number }
	| { type: "undo" };

type Pending = {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const isWin = process.platform === "win32";

/** Physical screen rect to DIP. */
function toDip(r: Rect): Rect {
	if (!isWin) return r;
	return screen.screenToDipRect(null, r);
}

/** DIP screen point to physical. */
function toPhysical(p: { x: number; y: number }) {
	if (!isWin) return p;
	return screen.dipToScreenPoint({ x: Math.round(p.x), y: Math.round(p.y) });
}

function pointToDip(p: { x: number; y: number }) {
	if (!isWin) return p;
	return screen.screenToDipPoint(p);
}

/**
 * The long-lived PowerShell desktop host. Starts on first use, restarts
 * after it exits, and emits "foreground", "input" and "undo" events.
 */
export class DesktopHost extends EventEmitter {
	script: string;
	proc: ReturnType<typeof spawn> | null = null;
	ready: Promise<void> | null = null;
	nextId = 1;
	pending = new Map<number, Pending>();
	watch = { input: false, undo: false };
	disposed = false;

	constructor(nativeDir: string) {
		super();
		this.script = path.join(nativeDir, "desktop-host.ps1");
	}

	get supported() {
		return isWin;
	}

	start(): Promise<void> {
		if (!this.supported || this.disposed)
			return Promise.reject(new Error("The desktop host needs Windows"));
		if (this.ready) return this.ready;
		const proc = spawn(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				this.script,
				"-ExcludePid",
				String(process.pid),
			],
			{ windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
		);
		this.proc = proc;
		let stderr = "";
		this.ready = new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("The desktop host did not start")),
				20_000,
			);
			readline.createInterface({ input: proc.stdout }).on("line", (line) => {
				const clean = line.replace(/^﻿/, "").trim();
				if (!clean.startsWith("{")) return;
				let msg: Record<string, unknown>;
				try {
					msg = JSON.parse(clean);
				} catch {
					return;
				}
				if (typeof msg.id === "number") return this.settle(msg);
				const evt = msg as HostEvent;
				if (evt.type === "ready") {
					clearTimeout(timer);
					resolve();
					this.sendWatch();
				} else if (evt.type === "error") {
					clearTimeout(timer);
					reject(new Error(evt.message));
				} else this.emit(evt.type, evt);
			});
			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
		this.ready.catch((err) =>
			console.error("[desktop] host failed to start:", err.message),
		);
		proc.stderr.on("data", (d) => {
			stderr = (stderr + d).slice(-2000);
		});
		proc.on("exit", (code) => {
			if (this.proc !== proc) return;
			this.proc = null;
			this.ready = null;
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new Error("The desktop host stopped"));
			}
			this.pending.clear();
			if (code && !this.disposed)
				console.error(
					`[desktop] host exited with code ${code}: ${stderr.trim().slice(-400)}`,
				);
		});
		return this.ready;
	}

	settle(msg: Record<string, unknown>) {
		const p = this.pending.get(msg.id as number);
		if (!p) return;
		this.pending.delete(msg.id as number);
		clearTimeout(p.timer);
		if (msg.ok) p.resolve(msg.result);
		else p.reject(new Error(String(msg.error || "Desktop host error")));
	}

	async request<T>(
		fields: (string | number)[],
		timeout = REQUEST_TIMEOUT_MS.default,
	): Promise<T> {
		await this.start();
		const proc = this.proc;
		if (!proc?.stdin) throw new Error("The desktop host is not running");
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Desktop host timed out on ${fields[0]}`));
			}, timeout);
			this.pending.set(id, {
				resolve: resolve as (v: unknown) => void,
				reject,
				timer,
			});
			proc.stdin?.write(`${[id, ...fields].join("\t")}\n`);
		});
	}

	/** Turns input and Ctrl+Z reporting on or off. */
	setWatch(watch: Partial<{ input: boolean; undo: boolean }>) {
		this.watch = { ...this.watch, ...watch };
		if (this.proc) this.sendWatch();
		else if (this.watch.input || this.watch.undo)
			void this.start().catch(() => {});
	}

	sendWatch() {
		void this.request([
			"watch",
			this.watch.input ? 1 : 0,
			this.watch.undo ? 1 : 0,
		]).catch(() => {});
	}

	dispose() {
		this.disposed = true;
		const p = this.proc;
		if (!p) return;
		try {
			p.stdin?.write("quit\n");
		} catch {
			/* already gone */
		}
		this.proc = null;
		setTimeout(() => {
			try {
				p.kill();
			} catch {
				/* ignore */
			}
		}, 1500);
	}
}

/** Converts a host window record to DIP coordinates. */
export function windowToDip(w: WindowInfo): WindowInfo {
	return { ...w, rect: toDip(w.rect) };
}

/**
 * The agent's Screen: UI snapshots and input through the desktop host on
 * Windows, screenshots everywhere. `ownWindows` lists Clippy's windows,
 * which are hidden from screenshots while they are taken.
 */
export class DesktopScreen implements Screen {
	host: DesktopHost;
	ownWindows: () => BrowserWindow[];
	inputCbs = new Set<(e: UserInput) => void>();
	/** Last known foreground window, from snapshots and foreground events. */
	foreground: WindowInfo | null = null;

	constructor(host: DesktopHost, ownWindows: () => BrowserWindow[]) {
		this.host = host;
		this.ownWindows = ownWindows;
		host.on("foreground", (e: { window: WindowInfo }) => {
			this.foreground = windowToDip(e.window);
		});
		host.on(
			"input",
			(e: { kind: UserInput["kind"]; x?: number; y?: number }) => {
				const p =
					e.x !== undefined && e.y !== undefined
						? pointToDip({ x: e.x, y: e.y })
						: {};
				for (const cb of this.inputCbs) cb({ kind: e.kind, ...p });
			},
		);
	}

	get canAct() {
		return this.host.supported;
	}

	displays(): Rect[] {
		return screen.getAllDisplays().map((d) => d.bounds);
	}

	async snapshot(): Promise<UiSnapshot | null> {
		if (!this.host.supported) return null;
		try {
			const raw = await this.host.request<UiSnapshot>(
				["snapshot", MAX_ELEMENTS, SNAPSHOT_BUDGET_MS],
				REQUEST_TIMEOUT_MS.snapshot,
			);
			const capped = capElements(
				raw.elements.map((e) => ({ ...e, rect: toDip(e.rect) })),
			);
			const foreground = raw.foreground ? windowToDip(raw.foreground) : null;
			if (foreground) this.foreground = foreground;
			return {
				foreground,
				windows: raw.windows.map(windowToDip),
				elements: capped.elements,
				truncated: raw.truncated || capped.truncated,
			};
		} catch (err) {
			console.error("[desktop] snapshot failed:", (err as Error).message);
			return null;
		}
	}

	async elementRect(id: string): Promise<Rect | null> {
		if (!this.host.supported) return null;
		const r = await this.host.request<Rect | null>(["bounds", id]);
		return r ? toDip(r) : null;
	}

	/** Captures the display under the foreground window, or the primary one. */
	async screenshot(): Promise<Shot | null> {
		let display = screen.getPrimaryDisplay();
		const fg = this.foreground?.rect;
		if (fg)
			display = screen.getDisplayNearestPoint({
				x: Math.round(fg.x + fg.width / 2),
				y: Math.round(fg.y + fg.height / 2),
			});
		const wins = this.ownWindows().filter((w) => !w.isDestroyed());
		// Content protection keeps Clippy's own windows out of the capture.
		for (const w of wins) w.setContentProtection(true);
		try {
			const size = {
				width: Math.round(display.size.width * display.scaleFactor),
				height: Math.round(display.size.height * display.scaleFactor),
			};
			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: size,
			});
			const source =
				sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
			if (!source || source.thumbnail.isEmpty()) return null;
			let img = source.thumbnail;
			const { width, height } = img.getSize();
			const k = Math.min(1, SHOT_MAX_EDGE / Math.max(width, height));
			if (k < 1)
				img = img.resize({
					width: Math.round(width * k),
					height: Math.round(height * k),
					quality: "good",
				});
			const out = img.getSize();
			return {
				image: {
					type: "image",
					mime: "image/jpeg",
					data: img.toJPEG(82).toString("base64"),
				},
				width: out.width,
				height: out.height,
				display: display.bounds,
			};
		} catch (err) {
			console.error("[desktop] screenshot failed:", (err as Error).message);
			return null;
		} finally {
			for (const w of wins) if (!w.isDestroyed()) w.setContentProtection(false);
		}
	}

	async perform(cmd: InputCommand): Promise<void> {
		if (!this.host.supported) throw new Error("Input needs Windows");
		switch (cmd.kind) {
			case "click": {
				const p = toPhysical(cmd);
				await this.host.request([
					"click",
					p.x,
					p.y,
					cmd.button,
					cmd.double ? 1 : 0,
				]);
				return;
			}
			case "type":
				await this.host.request(
					["type", Buffer.from(cmd.text, "utf8").toString("base64")],
					15_000,
				);
				return;
			case "keys":
				await this.host.request(["keys", cmd.keys.join("+")]);
				return;
			case "scroll": {
				const p = toPhysical(cmd);
				await this.host.request(["scroll", p.x, p.y, cmd.dx, cmd.dy]);
			}
		}
	}

	watchInput(on: boolean) {
		this.host.setWatch({ input: on });
	}

	onUserInput(cb: (e: UserInput) => void) {
		this.inputCbs.add(cb);
		return () => {
			this.inputCbs.delete(cb);
		};
	}
}
