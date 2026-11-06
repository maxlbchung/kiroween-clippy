import { PANEL_PAD } from "../../shared/layout.js";
import type {
	PanelAnchor,
	PanelName,
	PublicSettings,
	RendererContext,
} from "../../shared/types.js";
import { icon } from "../common/icons.js";
import {
	$,
	api,
	applyPrefs,
	esc,
	installClickThrough,
	nextFrame,
	reducedMotion,
	sfx,
} from "../common/ui.js";
import * as chat from "./views/chat.js";
import * as customize from "./views/customize.js";
import * as direct from "./views/direct.js";
import * as games from "./views/games.js";
import * as settingsView from "./views/settings.js";

const VIEWS = { chat, direct, customize, games, settings: settingsView };
const TITLE_ICONS: Partial<Record<PanelName, string>> = {
	customize: "customize",
	games: "games",
	settings: "settings",
};

const root = $("#root");
const frame = $("#frame");

let settings = await api.getSettings();
applyPrefs(settings);
document.documentElement.style.setProperty("--pad", `${PANEL_PAD}px`);

type ViewHandle = {
	unmount?: () => void;
	onEnter?: () => void;
	onLeave?: () => void;
	onFocus?: (data?: unknown) => void;
	onToggle?: () => void;
	onEscape?: () => boolean;
	onSettings?: (settings: PublicSettings) => void;
};
let current: {
	name: PanelName;
	kind: "bubble" | "window";
	handle: ViewHandle | null;
} | null = null;

const ctx: RendererContext = {
	api,
	settings,
	close: () => api.closePanel(),
	setMood: (m) => api.setMood(m),
};

function buildFrame(
	name: PanelName,
	panel: { kind: "bubble" | "window"; title: string },
): HTMLElement {
	frame.className = "";
	if (panel.kind === "bubble") {
		frame.classList.add("frame-bubble");
		frame.innerHTML = `
      <svg class="bubble-tail" viewBox="0 0 20 34" aria-hidden="true"><path d="M20 3 Q12 14 1 19 Q11 22 20 30"/></svg>
      <div class="bubble-body"></div>`;
		return $(".bubble-body", frame);
	}
	frame.classList.add("frame-window");
	frame.innerHTML = `
    <div class="titlebar">
      ${icon(TITLE_ICONS[name] || "info", 16)}
      <div class="titlebar-text">${esc(panel.title)}</div>
      <button class="icon-btn" data-close aria-label="Close"><span class="x-glyph"></span></button>
    </div>
    <div class="win-body"></div>`;
	$("[data-close]", frame).addEventListener("click", () => {
		sfx.close();
		ctx.close();
	});
	return $(".win-body", frame);
}

function setAnchor({ side, tailY, originX, originY }: PanelAnchor) {
	frame.classList.toggle("side-right", side === "right");
	frame.classList.toggle("side-left", side === "left");
	root.style.setProperty("--tail-y", `${tailY}px`);
	frame.style.transformOrigin = `${originX}px ${originY}px`;
}

function setOpacity(value: number) {
	frame.style.opacity = String(value);
}

function stopAnimations() {
	frame.getAnimations().forEach((a) => {
		a.cancel();
	});
}

async function animateIn() {
	stopAnimations();
	if (reducedMotion()) {
		setOpacity(1);
		return;
	}
	if (current.kind === "bubble") {
		frame.animate(
			[
				{ transform: "scale(.15)", opacity: 0 },
				{ transform: "scale(1.035)", opacity: 1, offset: 0.62 },
				{ transform: "scale(.995)", opacity: 1, offset: 0.85 },
				{ transform: "scale(1)", opacity: 1 },
			],
			{ duration: 420, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" },
		);
	} else {
		frame.animate(
			[
				{ opacity: 0, transform: "scale(.97)" },
				{ opacity: 1, transform: "scale(1)" },
			],
			{ duration: 170, easing: "ease-out", fill: "both" },
		);
		frame.classList.add("entered");
	}
	setOpacity(1);
}

async function animateOut() {
	if (reducedMotion()) {
		setOpacity(0);
		return;
	}
	stopAnimations();
	if (current?.kind === "bubble") {
		await frame
			.animate(
				[
					{ transform: "scale(1)", opacity: 1 },
					{ transform: "scale(.2)", opacity: 0 },
				],
				{ duration: 190, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" },
			)
			.finished.catch(() => {});
	} else {
		await frame
			.animate(
				[
					{ opacity: 1, transform: "scale(1)" },
					{ opacity: 0, transform: "scale(.97)" },
				],
				{ duration: 110, easing: "ease-in", fill: "forwards" },
			)
			.finished.catch(() => {});
	}
	setOpacity(0);
}

api.onPanelOpen(async (msg) => {
	try {
		current?.handle?.unmount?.();
	} catch (e) {
		console.error(e);
	}
	stopAnimations();
	setOpacity(0);
	root.style.setProperty("--w", `${msg.panel.width}px`);
	root.style.setProperty("--h", `${msg.panel.height}px`);
	const body = buildFrame(msg.name, msg.panel);
	current = { name: msg.name, kind: msg.panel.kind, handle: null };
	setAnchor(msg);
	try {
		const opened = current;
		opened.handle = VIEWS[msg.name].mount(body, ctx) || {};
	} catch (e) {
		console.error(e);
		body.innerHTML = `<p style="padding:16px">Something went wrong: ${esc(e.message)}</p>`;
	}
	await nextFrame();
	api.panelAck(msg.token);
});

api.onPanelEnter(() => {
	if (!current) return;
	animateIn();
	sfx.open();
	current.handle?.onEnter?.();
});

api.onPanelLeave(async ({ token }) => {
	try {
		current?.handle?.onLeave?.();
	} catch (e) {
		console.error(e);
	}
	await animateOut();
	frame.classList.remove("entered");
	api.panelAck(token);
});

api.onPanelAnchor(setAnchor);
api.onPanelFocus(({ data }) => current?.handle?.onFocus?.(data));
api.onDirectToggle(
	() => current?.name === "direct" && current.handle?.onToggle?.(),
);

api.onSettings((s) => {
	settings = s;
	ctx.settings = s;
	applyPrefs(s);
	current?.handle?.onSettings?.(s);
});

window.addEventListener("keydown", (e) => {
	if (e.key !== "Escape" || !current) return;
	if (current.handle?.onEscape?.()) return;
	sfx.close();
	ctx.close();
});

// Dragging a panel's header moves Clippy, and the panel follows him.
frame.addEventListener("pointerdown", (e) => {
	const target = e.target;
	if (
		e.button !== 0 ||
		!(target instanceof Element) ||
		!target.closest(".titlebar, .chat-head, .direct-top") ||
		target.closest("button")
	)
		return;
	frame.setPointerCapture(e.pointerId);
	ctx.setMood("drag");
	api.panelDragStart();
	frame.addEventListener(
		"lostpointercapture",
		() => {
			api.dragEnd();
			ctx.setMood(null);
		},
		{ once: true },
	);
});

let pointerDown = false;
window.addEventListener(
	"pointerdown",
	() => {
		pointerDown = true;
	},
	true,
);
window.addEventListener(
	"pointerup",
	() => {
		pointerDown = false;
	},
	true,
);
installClickThrough({ isLocked: () => pointerDown });
