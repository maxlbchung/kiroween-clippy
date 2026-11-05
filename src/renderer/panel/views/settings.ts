// Settings: AI keys & models, voice, behaviour, about/quit.

import { PET_SCALES } from "../../../shared/layout.js";
import type { RendererContext } from "../../../shared/types.js";
import { clippyMarkup } from "../../common/clippy.js";
import { icon } from "../../common/icons.js";
import { $, $$, esc, sfx } from "../../common/ui.js";

const PROVIDERS = [
	{
		id: "anthropic",
		name: "Anthropic (Claude)",
		secret: "anthropic",
		keyLabel: "Anthropic",
		keyHint: "sk-ant-…",
	},
	{
		id: "openai",
		name: "OpenAI",
		secret: "openai",
		keyLabel: "OpenAI",
		keyHint: "sk-…",
	},
	{
		id: "compatible",
		name: "OpenAI-compatible",
		secret: "custom",
		keyLabel: "Compatible endpoint",
		keyHint: "key",
	},
];
const MODEL_SUGGESTIONS = {
	anthropic: [
		"claude-opus-5-5",
		"claude-sonnet-5-5",
		"claude-haiku-5-5",
		"claude-fable-5-1",
	],
	openai: [],
	compatible: [],
};
const LANGUAGES = [
	["auto", "Match Windows"],
	["en-US", "English (US)"],
	["en-GB", "English (UK)"],
	["es-ES", "Español"],
	["fr-FR", "Français"],
	["de-DE", "Deutsch"],
	["it-IT", "Italiano"],
	["pt-BR", "Português (BR)"],
	["ja-JP", "日本語"],
	["zh-CN", "中文 (简体)"],
];
const TABS = [
	{ id: "ai", label: "AI", icon: "key" },
	{ id: "voice", label: "Voice", icon: "direct" },
	{ id: "general", label: "General", icon: "monitor" },
	{ id: "about", label: "About", icon: "info" },
];

let lastTab = "ai";

function keyRow(name, label, isSet, placeholder) {
	return `
    <div class="key-row" data-secret="${name}">
      <label class="label" for="key-${name}">${label}</label>
      <div class="key-line">
        <input id="key-${name}" class="field mono" type="password" autocomplete="off" spellcheck="false"
               placeholder="${isSet ? "•••••••••••••••• saved" : placeholder}">
        <button class="btn btn-sm" data-act="save-key">Save</button>
        ${isSet ? '<button class="btn btn-sm btn-ghost" data-act="clear-key" title="Remove key">Clear</button>' : ""}
      </div>
      <span class="chip ${isSet ? "ok" : "off"}">${isSet ? `${icon("check", 12)} Saved` : "Not set"}</span>
    </div>`;
}

function accelFromEvent(e) {
	const mods = [];
	if (e.ctrlKey) mods.push("Control");
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");
	if (e.metaKey) mods.push("Super");
	const code = e.code;
	let key = null;
	if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
	else if (/^Digit\d$/.test(code)) key = code.slice(5);
	else if (/^F\d{1,2}$/.test(code)) key = code;
	else
		key =
			{
				Space: "Space",
				Enter: "Enter",
				Backquote: "`",
				Minus: "-",
				Equal: "=",
				BracketLeft: "[",
				BracketRight: "]",
				Backslash: "\\",
				Semicolon: ";",
				Quote: "'",
				Comma: ",",
				Period: ".",
				Slash: "/",
				ArrowUp: "Up",
				ArrowDown: "Down",
				ArrowLeft: "Left",
				ArrowRight: "Right",
				Home: "Home",
				End: "End",
				PageUp: "PageUp",
				PageDown: "PageDown",
				Insert: "Insert",
			}[code] || null;
	if (!key) return null;
	return [...mods, key].join("+");
}

const prettyAccel = (a) =>
	(a || "None").replace(/Control/g, "Ctrl").replace(/\+/g, " + ");

export function mount(el: HTMLElement, ctx: RendererContext) {
	let tab = lastTab;
	let micTest: {
		stream: MediaStream;
		ac: AudioContext;
		raf: number;
		until: number;
	} | null = null;

	el.innerHTML = `
    <div class="settings">
      <div class="tabs" role="tablist">
        ${TABS.map((t) => `<button class="tab" role="tab" data-tab="${t.id}">${icon(t.icon, 14)}${t.label}</button>`).join("")}
      </div>
      <div class="tab-panel settings-panel"></div>
      <div class="settings-foot"><span class="save-toast px" aria-live="polite"></span><button class="btn" data-act="done">OK</button></div>
    </div>`;

	const panel = $(".settings-panel", el);
	const toast = $(".save-toast", el);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function saved(msg = "Saved") {
		toast.textContent = `✓ ${msg}`;
		toast.classList.remove("show");
		void toast.offsetWidth;
		toast.classList.add("show");
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
	}

	async function patch(p, msg) {
		await ctx.api.patchSettings(p);
		saved(msg);
	}

	// ---------------------------------------------------------------- tabs
	function renderAi(s) {
		const prov = PROVIDERS.find((p) => p.id === s.ai.provider) || PROVIDERS[0];
		const sugg = MODEL_SUGGESTIONS[prov.id];
		return `
      <div class="form-grid">
        <label class="label" for="provider">Provider</label>
        <select id="provider" class="select" data-path="ai.provider">
          ${PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === prov.id ? "selected" : ""}>${p.name}</option>`).join("")}
        </select>
        ${
					prov.id === "compatible"
						? `
          <label class="label" for="baseUrl">Base URL</label>
          <input id="baseUrl" class="field mono" data-path="ai.baseUrl" placeholder="https://my-gateway.example/v1" value="${esc(s.ai.baseUrl)}">`
						: ""
				}
        <label class="label" for="chatModel">Chat model</label>
        <div><input id="chatModel" class="field mono" list="models" data-path="ai.chatModel" value="${esc(s.ai.chatModel)}">
          <div class="hint">"System 2" — thoughtful replies in the chat bubble.</div></div>
        <label class="label" for="directModel">Direct model</label>
        <div><input id="directModel" class="field mono" list="models" data-path="ai.directModel" value="${esc(s.ai.directModel)}">
          <div class="hint">"System 1" — fast model that drives your PC via UI Automation.</div></div>
      </div>
      <datalist id="models">${sugg.map((m) => `<option value="${m}">`).join("")}</datalist>
      <fieldset class="group">
        <legend>API key</legend>
        ${keyRow(prov.secret, prov.keyLabel, s.secrets[prov.secret], prov.keyHint)}
        <p class="hint key-note">${icon("lock", 12)} ${s.encryption ? `Keys are encrypted ${ctx.api.platform === "win32" ? "with Windows DPAPI" : "by your OS keychain"} and stay on this PC.` : "OS encryption unavailable — keys are stored locally without encryption."}</p>
      </fieldset>
      <p class="hint soon-note">The agents themselves are still being built — Clippy will use these once they land.</p>`;
	}

	function renderVoice(s) {
		const v = s.voice;
		return `
      <div class="label">Dictation engine</div>
      <div class="radios">
        <label class="radio"><input type="radio" name="engine" value="windows" ${v.engine === "windows" ? "checked" : ""}>
          <span><b>Windows Speech</b> <span class="chip ok">offline</span><br><span class="hint">Built into Windows. Free, private, no key needed.</span></span></label>
        <label class="radio"><input type="radio" name="engine" value="openai" ${v.engine === "openai" ? "checked" : ""}>
          <span><b>Cloud transcription</b> <span class="chip off">OpenAI key</span><br><span class="hint">More accurate. Audio is sent to OpenAI.</span></span></label>
      </div>
      <div class="form-grid">
        ${
					v.engine === "openai"
						? `
          <label class="label" for="tModel">Model</label>
          <input id="tModel" class="field mono" list="tmodels" data-path="voice.transcribeModel" value="${esc(v.transcribeModel)}">
          <datalist id="tmodels"><option value="whisper-1"><option value="gpt-4o-transcribe"><option value="gpt-4o-mini-transcribe"></datalist>`
						: ""
				}
        <label class="label" for="lang">Language</label>
        <select id="lang" class="select" data-path="voice.language">
          ${LANGUAGES.map(([id, n]) => `<option value="${id}" ${id === v.language ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        <label class="label" for="hotkey">Direct hotkey</label>
        <div class="hotkey-line">
          <button id="hotkey" class="field hotkey" data-act="hotkey" title="Click, then press a key combo">${esc(prettyAccel(v.hotkey))}</button>
          <button class="btn btn-sm" data-act="hotkey-reset">Default</button>
        </div>
      </div>
      <div class="hotkey-msg hint"></div>
      ${
				v.engine === "openai"
					? `
        <fieldset class="group">
          <legend>Transcription key</legend>
          ${keyRow("openai", "OpenAI", s.secrets.openai, "sk-…")}
        </fieldset>`
					: ""
			}
      <label class="check"><input type="checkbox" data-path="voice.autoSend" ${v.autoSend ? "checked" : ""}> Send automatically when I stop talking</label>
      <div class="mic-test">
        <button class="btn btn-sm" data-act="mic">${icon("direct", 14)}Test microphone</button>
        <div class="meter"><i class="meter-bar"></i></div>
      </div>`;
	}

	function renderGeneral(s) {
		const b = s.behavior;
		const check = (path, label, on, hint = "") =>
			`<label class="check"><input type="checkbox" data-path="${path}" ${on ? "checked" : ""}> <span>${label}${hint ? `<br><span class="hint">${hint}</span>` : ""}</span></label>`;
		const sizeNames = { 0.8: "Small", 1: "Normal", 1.25: "Large" };
		return `
      <div class="label">Clippy size</div>
      <div class="seg" role="radiogroup">
        ${PET_SCALES.map((sc) => `<button class="seg-btn${s.pet.scale === sc ? " is-on" : ""}" data-scale="${sc}">${sizeNames[sc]}</button>`).join("")}
      </div>
      <fieldset class="group">
        <legend>Behavior</legend>
        ${check("behavior.alwaysOnTop", "Always on top", b.alwaysOnTop)}
        ${check("behavior.launchAtLogin", "Start with Windows", b.launchAtLogin)}
        ${check("behavior.idleChatter", "Idle chatter", b.idleChatter, "Occasional tips and quips.")}
        ${check("behavior.eyeTracking", "Follow my cursor with his eyes", b.eyeTracking)}
        ${check("behavior.sounds", "Retro sound effects", b.sounds)}
      </fieldset>`;
	}

	function renderAbout(s, info) {
		return `
      <div class="about">
        <div class="about-hero">
          <div class="about-logo">${clippyMarkup({ uid: "about", costume: s.costume })}</div>
          <div>
            <div class="about-title px">Clippy</div>
            <div class="hint">Your agentic desktop sidekick · v${esc(info?.version || "")}</div>
            <div class="hint">Electron ${esc(info?.electron || "")}</div>
          </div>
        </div>
        <fieldset class="group">
          <legend>Clippy</legend>
          <div class="about-actions">
            <button class="btn" data-act="hide">Hide Clippy</button>
            <span class="hint">Bring him back from the tray icon.</span>
          </div>
          <div class="about-actions">
            <button class="btn" data-act="reset-all">Reset settings</button>
            <span class="hint">Keeps your API keys.</span>
          </div>
        </fieldset>
      </div>`;
	}

	let info: Awaited<ReturnType<typeof ctx.api.appInfo>> | null = null;
	ctx.api.appInfo().then((i) => {
		info = i;
		if (tab === "about") render();
	});

	function render(animate = false) {
		const s = ctx.settings;
		const focusId = panel.contains(document.activeElement)
			? document.activeElement.id
			: null;
		$$(".tab", el).forEach((t) => {
			t.setAttribute("aria-selected", String(t.dataset.tab === tab));
		});
		stopMic();
		const html = {
			ai: renderAi,
			voice: renderVoice,
			general: renderGeneral,
			about: renderAbout,
		}[tab](s, info);
		panel.innerHTML = `<div class="settings-page">${html}</div>`;
		if (focusId) document.getElementById(focusId)?.focus();
		if (animate) {
			$(".settings-page", panel).animate(
				[
					{ opacity: 0, transform: "translateX(10px)" },
					{ opacity: 1, transform: "none" },
				],
				{ duration: 200, easing: "cubic-bezier(.2,.8,.3,1)" },
			);
		}
	}

	// ---------------------------------------------------------------- events
	const pathPatch = (path, value) => {
		const [a, b] = path.split(".");
		return { [a]: { [b]: value } };
	};

	el.addEventListener("change", (e) => {
		const t = e.target;
		if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement))
			return;
		if (t.name === "engine") {
			if (t.value === "windows" || t.value === "openai")
				void patch({ voice: { engine: t.value } }, "Saved");
			return;
		}
		const path = t.dataset.path;
		if (!path) return;
		const value = t.type === "checkbox" ? t.checked : t.value.trim();
		void patch(pathPatch(path, value), "Saved");
		if (t.type === "checkbox") sfx.hover();
	});

	el.addEventListener(
		"keydown",
		async (e) => {
			const t = e.target;
			if (!(t instanceof HTMLElement)) return;
			if (t.matches('[data-act="hotkey"].listening')) {
				e.preventDefault();
				e.stopPropagation();
				if (e.key === "Escape") return stopHotkeyCapture(t);
				if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
				const accel = accelFromEvent(e);
				const msg = $(".hotkey-msg", el);
				if (!accel || !/(Control|Alt|Super)\+/.test(accel)) {
					msg.textContent = "Use at least Ctrl, Alt or Win plus a key.";
					return;
				}
				const res = await ctx.api.setHotkey(accel);
				stopHotkeyCapture(t);
				if (res.ok) {
					saved("Hotkey set");
					msg.textContent = "";
				} else {
					msg.textContent = res.error;
					sfx.error();
				}
				return;
			}
			if (e.key === "Enter" && t.closest<HTMLElement>(".key-row")) {
				e.preventDefault();
				const row = t.closest<HTMLElement>(".key-row");
				if (row) saveKey(row);
			}
		},
		true,
	);

	function stopHotkeyCapture(btn) {
		btn.classList.remove("listening");
		btn.textContent = prettyAccel(ctx.settings.voice.hotkey);
	}

	async function saveKey(row) {
		const input = $("input", row) as HTMLInputElement;
		const v = input.value.trim();
		if (!v) {
			input.focus();
			return;
		}
		await ctx.api.setSecret(row.dataset.secret, v);
		input.value = "";
		render(); // onSettings skips this while the field has focus (Enter to save)
		saved("Key saved");
		sfx.select();
	}

	el.addEventListener("click", async (e) => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const tabBtn = target.closest<HTMLElement>("[data-tab]");
		if (tabBtn) {
			if (tabBtn.dataset.tab !== tab) {
				tab = lastTab = tabBtn.dataset.tab;
				sfx.hover();
				render(true);
			}
			return;
		}
		const scaleBtn = target.closest<HTMLElement>("[data-scale]");
		if (scaleBtn) {
			void patch({ pet: { scale: Number(scaleBtn.dataset.scale) } }, "Saved");
			return;
		}
		const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
		const row = target.closest<HTMLElement>(".key-row");
		switch (act) {
			case "done":
				sfx.close();
				ctx.close();
				break;
			case "save-key":
				saveKey(row);
				break;
			case "clear-key":
				if (row)
					await ctx.api.setSecret(
						row.dataset.secret as "anthropic" | "openai" | "custom",
						"",
					);
				saved("Key removed");
				break;
			case "hotkey": {
				const btn = target.closest<HTMLElement>("[data-act]");
				btn.classList.add("listening");
				btn.textContent = "Press keys…";
				break;
			}
			case "hotkey-reset": {
				const res = await ctx.api.setHotkey("Control+Alt+Space");
				if (res.ok) saved("Hotkey reset");
				else $(".hotkey-msg", el).textContent = res.error;
				break;
			}
			case "mic":
				micTest ? stopMic() : startMic();
				break;
			case "hide":
				ctx.close();
				setTimeout(() => ctx.api.hidePet(), 250);
				break;
			case "reset-all":
				await ctx.api.resetSettings();
				saved("Settings reset");
				break;
			default:
				break;
		}
	});

	// ---------------------------------------------------------------- mic test
	async function startMic() {
		const meter = $(".meter-bar", el);
		const btn = $('[data-act="mic"]', el);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const ac = new AudioContext();
			const an = ac.createAnalyser();
			an.fftSize = 512;
			ac.createMediaStreamSource(stream).connect(an);
			const buf = new Float32Array(an.fftSize);
			micTest = { stream, ac, raf: 0, until: performance.now() + 8000 };
			btn.classList.add("is-pressed");
			const loop = () => {
				if (!micTest) return;
				an.getFloatTimeDomainData(buf);
				let sum = 0;
				for (const v of buf) sum += v * v;
				const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 8);
				meter.style.transform = `scaleX(${lvl.toFixed(3)})`;
				if (performance.now() > micTest.until) return stopMic();
				micTest.raf = requestAnimationFrame(loop);
			};
			loop();
		} catch (err) {
			$(".meter", el).dataset.error =
				err.name === "NotAllowedError" ? "Mic blocked" : "No mic";
		}
	}

	function stopMic() {
		if (!micTest) return;
		cancelAnimationFrame(micTest.raf);
		micTest.stream.getTracks().forEach((t) => {
			t.stop();
		});
		micTest.ac.close().catch(() => {});
		micTest = null;
		const m = $(".meter-bar", el);
		if (m) m.style.transform = "scaleX(0)";
		$('[data-act="mic"]', el)?.classList.remove("is-pressed");
	}

	render();

	return {
		onSettings() {
			// Re-render unless the user is typing in a field on this page.
			const active = document.activeElement;
			if (
				active &&
				panel.contains(active) &&
				active.matches(
					'input[type="text"], input:not([type]), input[type="password"]',
				)
			)
				return;
			render();
		},
		onLeave() {
			stopMic();
		},
		unmount() {
			stopMic();
		},
	};
}
