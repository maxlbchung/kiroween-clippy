// Clippy — an agentic desktop pet. Main process entry.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	globalShortcut,
	ipcMain,
	Menu,
	net,
	protocol,
	session,
	shell,
} from "electron";
import type {
	ChatMessage,
	DictationEvent,
	PanelName,
	SettingsPatch,
} from "../shared/types.js";
import { createAgent } from "./agent.js";
import { Panels } from "./panels.js";
import { Pet } from "./pet.js";
import { Settings } from "./settings.js";
import { FakeSpeech, transcribeOpenAI, WindowsSpeech } from "./speech.js";
import { createTray } from "./tray.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..");
const COMPILED = DIST;
const ROOT = app.isPackaged
	? path.join(process.resourcesPath, "app")
	: path.resolve(DIST, "..");
const NATIVE = app.isPackaged
	? path.join(process.resourcesPath, "native")
	: path.join(ROOT, "native");
const ICONS = path.join(ROOT, "build", "icons");
const PRELOAD = path.join(COMPILED, "preload", "preload.js");
const APP_ORIGIN = "app://clippy";

app.setAppUserModelId("com.kiroween.clippy");
if (process.env.CLIPPY_USER_DATA)
	app.setPath("userData", process.env.CLIPPY_USER_DATA);
if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

// Serve renderer files from a privileged custom scheme instead of file://.
protocol.registerSchemesAsPrivileged([
	{
		scheme: "app",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			codeCache: true,
		},
	},
]);

function serveAppProtocol() {
	const allowed = [
		path.join(COMPILED, "renderer"),
		path.join(COMPILED, "shared"),
	];
	protocol.handle("app", (req) => {
		const { host, pathname } = new URL(req.url);
		const file = path.normalize(
			path.join(COMPILED, decodeURIComponent(pathname)),
		);
		if (
			host !== "clippy" ||
			!allowed.some((dir) => file.startsWith(dir + path.sep))
		) {
			return new Response("Not found", { status: 404 });
		}
		return net.fetch(pathToFileURL(file).toString());
	});
}

let settings: Settings | undefined;
let pet: Pet | undefined;
let panels: Panels | undefined;
let agent: ReturnType<typeof createAgent> | undefined;
let speech: { windows: WindowsSpeech; fake?: FakeSpeech } | undefined;
let trayCtl: ReturnType<typeof createTray> | undefined;
let quitting = false;
const chats = new Map<string, AbortController>();

function broadcast(channel: string, payload: unknown) {
	for (const w of BrowserWindow.getAllWindows()) {
		if (!w.isDestroyed()) w.webContents.send(channel, payload);
	}
}

function registerHotkey(accelerator: string) {
	globalShortcut.unregisterAll();
	if (!accelerator) return { ok: true };
	try {
		const ok = globalShortcut.register(accelerator, () => {
			if (panels?.visible && panels?.current === "direct")
				panels?.send("direct:toggle");
			else panels?.open("direct");
		});
		return ok
			? { ok: true }
			: { ok: false, error: "That shortcut is already taken by another app." };
	} catch (err) {
		return {
			ok: false,
			error: `Invalid shortcut: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

function applyLoginItem(on: boolean) {
	if (!app.isPackaged) return;
	app.setLoginItemSettings({ openAtLogin: !!on });
}

function speechEngine() {
	if (process.env.CLIPPY_FAKE_SPEECH) {
		if (!speech) return new FakeSpeech().on("event", relayDictation);
		if (!speech.fake)
			speech.fake = new FakeSpeech().on("event", relayDictation);
		return speech.fake;
	}
	return speech?.windows;
}

function relayDictation(evt: DictationEvent) {
	panels?.send("dictation:event", evt);
	if (evt.type === "started") pet?.send("pet:mood", "listening");
	if (evt.type === "stopped") pet?.send("pet:mood", null);
}

async function quitWithGoodbye() {
	if (quitting) return;
	quitting = true;
	await panels?.close();
	pet?.send("pet:goodbye");
	setTimeout(() => app.quit(), 520);
}

function wireIpc() {
	const fromSender = (e: Electron.IpcMainEvent) =>
		BrowserWindow.fromWebContents(e.sender);

	ipcMain.handle("settings:get", () => settings?.public);
	ipcMain.handle("settings:patch", (_e, patch: SettingsPatch) =>
		settings?.patch(patch),
	);
	ipcMain.handle("settings:reset", () => settings?.reset());
	ipcMain.handle(
		"settings:set-secret",
		(_e, name: "anthropic" | "openai" | "custom", value: string) =>
			settings?.setSecret(name, value),
	);
	ipcMain.handle("hotkey:set", (_e, accel: string) => {
		const res = registerHotkey(accel);
		if (res.ok) settings?.patch({ voice: { hotkey: accel || "" } });
		else registerHotkey(settings?.data.voice.hotkey ?? "");
		return res;
	});

	ipcMain.on("win:interactive", (e, on: boolean) => {
		const w = fromSender(e);
		if (!w) return;
		if (on) w.setIgnoreMouseEvents(false);
		else w.setIgnoreMouseEvents(true, { forward: true });
	});

	// pet
	ipcMain.on("pet:drag-start", (_e, p: { x: number; y: number }) =>
		pet?.beginDrag(p),
	);
	ipcMain.on("pet:drag-end", () => pet?.endDrag());
	ipcMain.on("pet:menu", (_e, open: boolean) => {
		if (open) pet?.ensureRingVisible();
	});
	ipcMain.on("pet:mood", (_e, mood: string | null) =>
		pet?.send("pet:mood", mood),
	);
	ipcMain.on("pet:ready", () => {
		pet?.send("pet:say", {
			kind: settings?.data.pet?.greeted ? "hello" : "intro",
		});
		if (!settings?.data.pet?.greeted)
			settings?.patch({ pet: { greeted: true } });
	});
	ipcMain.on("pet:context-menu", () => {
		Menu.buildFromTemplate([
			{ label: "Chat", click: () => panels?.open("chat") },
			{ label: "Direct", click: () => panels?.open("direct") },
			{ label: "Wardrobe", click: () => panels?.open("customize") },
			{ label: "Arcade", click: () => panels?.open("games") },
			{ label: "Settings", click: () => panels?.open("settings") },
			{ type: "separator" },
			{ label: "Hide Clippy", click: () => trayCtl?.hidePet() },
			{ label: "Quit Clippy", click: quitWithGoodbye },
		]).popup({ window: pet?.win ?? undefined });
	});

	// panels
	ipcMain.on("panel:open", (_e, name: PanelName) => panels?.toggle(name));
	ipcMain.on("panel:close", () => panels?.close());
	ipcMain.on("panel:ack", (_e, token: number) => panels?.ack(token));
	ipcMain.on("panel:drag-start", () => pet?.beginDragFromCursor());

	// chat (stub agent, real streaming contract)
	ipcMain.on(
		"chat:send",
		async (e, { id, messages }: { id: string; messages: ChatMessage[] }) => {
			const ctrl = new AbortController();
			chats.set(id, ctrl);
			const send = (evt: Record<string, unknown>) =>
				!e.sender.isDestroyed() && e.sender.send("chat:event", { id, ...evt });
			pet?.send("pet:mood", "thinking");
			let talking = false;
			try {
				const clean = (Array.isArray(messages) ? messages : [])
					.filter((m) => m && (m.role === "user" || m.role === "assistant"))
					.map((m) => ({
						role: m.role,
						content: String(m.content || "").slice(0, 20000),
					}));
				const chatAgent = agent;
				if (!chatAgent) throw new Error("Chat agent is not initialized");
				for await (const chunk of chatAgent.chat(clean, ctrl.signal)) {
					if (!talking) {
						talking = true;
						pet?.send("pet:mood", "talking");
					}
					send({ type: "delta", text: chunk });
				}
				send({ type: "done" });
			} catch (err) {
				send(
					ctrl.signal.aborted
						? { type: "done", aborted: true }
						: {
								type: "error",
								message: err instanceof Error ? err.message : String(err),
							},
				);
			} finally {
				chats.delete(id);
				pet?.send("pet:mood", null);
			}
		},
	);
	ipcMain.on("chat:cancel", (_e, id: string) => chats.get(id)?.abort());

	// dictation / direct
	ipcMain.handle("dictation:start", () => {
		const engine = settings?.data.voice.engine;
		if (engine === "openai") {
			pet?.send("pet:mood", "listening");
			return { ok: true, engine: "openai" };
		}
		const ok = speechEngine().start(settings?.data.voice.language ?? "auto");
		return { ok, engine: process.env.CLIPPY_FAKE_SPEECH ? "fake" : "windows" };
	});
	ipcMain.on("dictation:stop", () => {
		if (settings?.data.voice.engine === "openai") pet?.send("pet:mood", null);
		else speechEngine().stop();
	});
	ipcMain.on("dictation:cancel", () => {
		pet?.send("pet:mood", null);
		if (settings?.data.voice.engine !== "openai") speechEngine().cancel();
	});
	ipcMain.handle(
		"dictation:transcribe",
		async (_e, { audio, mime }: { audio: Uint8Array; mime: string }) => {
			try {
				const text = await transcribeOpenAI({
					audio: Buffer.from(audio),
					mime,
					apiKey: await settings?.getSecret("openai"),
					model: settings?.data.voice.transcribeModel,
					language: settings?.data.voice.language,
				});
				return { ok: true, text };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);
	ipcMain.handle("direct:dispatch", async (_e, text: string) => {
		pet?.send("pet:mood", "happy");
		setTimeout(() => pet?.send("pet:mood", null), 1400);
		return agent?.direct(text);
	});

	// app
	ipcMain.handle("app:info", () => ({
		version: app.getVersion(),
		electron: process.versions.electron,
		platform: process.platform,
		userData: app.getPath("userData"),
	}));
	ipcMain.on("app:hide", () => trayCtl?.hidePet());
	ipcMain.on("app:quit", quitWithGoodbye);
}

function onSettingsChange(
	data: import("../shared/types.js").SettingsData,
	prev: import("../shared/types.js").SettingsData,
	patch: SettingsPatch,
) {
	broadcast("settings:changed", settings?.public);
	if (
		patch.behavior &&
		data.behavior.alwaysOnTop !== prev.behavior.alwaysOnTop
	) {
		pet?.win?.setAlwaysOnTop(data.behavior.alwaysOnTop, "screen-saver");
		panels?.setAlwaysOnTop(data.behavior.alwaysOnTop);
	}
	if (
		patch.behavior &&
		data.behavior.launchAtLogin !== prev.behavior.launchAtLogin
	)
		applyLoginItem(data.behavior.launchAtLogin);
	if (patch.pet && data.pet?.scale !== prev.pet?.scale) {
		pet?.applyScale();
		panels?.follow();
	}
	if (
		patch.voice &&
		(data.voice.language !== prev.voice.language ||
			data.voice.engine !== prev.voice.engine)
	) {
		if (data.voice.engine === "windows")
			speech?.windows.warm(data.voice.language);
		else speech?.windows.dispose();
	}
}

app.whenReady().then(async () => {
	serveAppProtocol();
	Menu.setApplicationMenu(null);

	// Microphone for cloud dictation + mic test; deny everything else.
	const ses = session.defaultSession;
	const allow = (wc: Electron.WebContents | null, permission: string) =>
		permission === "media" && !!wc && wc.getURL().startsWith(APP_ORIGIN);
	ses.setPermissionRequestHandler((wc, permission, cb) =>
		cb(allow(wc, permission)),
	);
	ses.setPermissionCheckHandler(
		(wc, permission) => !!wc && allow(wc, permission),
	);

	settings = await new Settings(app.getPath("userData")).init();
	agent = createAgent({ settings });
	speech = { windows: new WindowsSpeech(NATIVE) };
	speech?.windows.on("event", relayDictation);

	pet = new Pet({
		settings,
		preload: PRELOAD,
		url: `${APP_ORIGIN}/renderer/pet/index.html`,
	});
	panels = new Panels({
		pet,
		settings,
		preload: PRELOAD,
		url: `${APP_ORIGIN}/renderer/panel/index.html`,
	});
	pet.create();
	panels.create();
	pet?.on("moved", () => panels?.follow());

	trayCtl = createTray({
		iconDir: ICONS,
		pet,
		panels,
		settings,
		onQuit: quitWithGoodbye,
	});
	settings.on("change", onSettingsChange);
	wireIpc();
	registerHotkey(settings.data.voice.hotkey);
	applyLoginItem(settings.data.behavior.launchAtLogin);

	// Warm the offline recognizer so the first "Direct" is instant.
	if (settings.data.voice.engine === "windows")
		setTimeout(() => speech?.windows.warm(settings?.data.voice.language), 2500);
});

// Never let renderers open new windows or navigate away.
app.on("web-contents-created", (_e, wc) => {
	wc.setWindowOpenHandler(({ url }) => {
		if (/^https:\/\//.test(url)) shell.openExternal(url);
		return { action: "deny" };
	});
	wc.on("will-navigate", (e, url) => {
		if (!url.startsWith(APP_ORIGIN)) e.preventDefault();
	});
});

app.on("second-instance", () => {
	if (!pet) return;
	pet?.show();
	pet?.send("pet:say", { kind: "again" });
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
	globalShortcut.unregisterAll();
	speech?.windows.dispose();
	speech?.fake?.dispose();
	settings?.flush();
});
