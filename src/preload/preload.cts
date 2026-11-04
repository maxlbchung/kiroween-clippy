// Sandboxed preload: exposes a narrow, explicit API to the renderers.
import { contextBridge, ipcRenderer } from "electron";
import type { ClippyAPI } from "../shared/types.js";

function on(channel: string) {
	return (cb) => {
		const fn = (_e, payload) => cb(payload);
		ipcRenderer.on(channel, fn);
		return () => ipcRenderer.removeListener(channel, fn);
	};
}

const api: ClippyAPI = {
	platform: process.platform,

	// settings
	getSettings: () => ipcRenderer.invoke("settings:get"),
	patchSettings: (patch) => ipcRenderer.invoke("settings:patch", patch),
	resetSettings: () => ipcRenderer.invoke("settings:reset"),
	setSecret: (name, value) =>
		ipcRenderer.invoke("settings:set-secret", name, value),
	setHotkey: (accelerator) => ipcRenderer.invoke("hotkey:set", accelerator),
	buyCostume: (category, id) => ipcRenderer.invoke("shop:buy", category, id),
	onSettings: on("settings:changed"),

	// window plumbing
	setInteractive: (on) => ipcRenderer.send("win:interactive", !!on),

	// pet
	dragStart: (x, y) => ipcRenderer.send("pet:drag-start", { x, y }),
	dragEnd: () => ipcRenderer.send("pet:drag-end"),
	menuChanged: (open) => ipcRenderer.send("pet:menu", !!open),
	petContextMenu: () => ipcRenderer.send("pet:context-menu"),
	petReady: () => ipcRenderer.send("pet:ready"),
	setMood: (mood) => ipcRenderer.send("pet:mood", mood),
	onCursor: on("pet:cursor"),
	onMoved: on("pet:moved"),
	onPetPanel: on("pet:panel"),
	onMood: on("pet:mood"),
	onBlur: on("pet:blur"),
	onSay: on("pet:say"),
	onGoodbye: on("pet:goodbye"),
	onToggleMenu: on("pet:toggle-menu"),

	// panels
	openPanel: (name) => ipcRenderer.send("panel:open", name),
	closePanel: () => ipcRenderer.send("panel:close"),
	panelAck: (token) => ipcRenderer.send("panel:ack", token),
	panelDragStart: () => ipcRenderer.send("panel:drag-start"),
	onPanelOpen: on("panel:open"),
	onPanelEnter: on("panel:enter"),
	onPanelLeave: on("panel:leave"),
	onPanelAnchor: on("panel:anchor"),
	onPanelFocus: on("panel:focus"),

	// chat (agent is stubbed for now)
	chatSend: (id, messages) => ipcRenderer.send("chat:send", { id, messages }),
	chatCancel: (id) => ipcRenderer.send("chat:cancel", id),
	onChat: on("chat:event"),

	// direct / dictation
	dictationStart: () => ipcRenderer.invoke("dictation:start"),
	dictationStop: () => ipcRenderer.send("dictation:stop"),
	dictationCancel: () => ipcRenderer.send("dictation:cancel"),
	transcribe: (audio, mime) =>
		ipcRenderer.invoke("dictation:transcribe", { audio, mime }),
	directDispatch: (text) => ipcRenderer.invoke("direct:dispatch", text),
	onDictation: on("dictation:event"),
	onDirectToggle: on("direct:toggle"),

	// full-screen games
	launchGame: (id) => ipcRenderer.send("game:launch", id),
	gameInit: () => ipcRenderer.invoke("game:init"),
	gameReady: () => ipcRenderer.send("game:ready"),
	gameRound: (result) => ipcRenderer.invoke("game:round", result),
	exitGame: (result) => ipcRenderer.send("game:exit", result),

	// app
	appInfo: () => ipcRenderer.invoke("app:info"),
	hidePet: () => ipcRenderer.send("app:hide"),
	quit: () => ipcRenderer.send("app:quit"),
};

contextBridge.exposeInMainWorld("clippy", api);
