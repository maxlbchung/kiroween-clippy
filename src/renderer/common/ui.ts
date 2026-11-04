// Small DOM + window helpers shared by the pet and panel renderers.
import type { ClippyAPI, PublicSettings } from "../../shared/types.js";

export const api: ClippyAPI = window.clippy;

type ElementForSelector<T extends string> = T extends
	| `#clippy-bob svg`
	| `.ward-preview svg`
	| "svg"
	? SVGSVGElement
	: T extends "textarea"
		? HTMLTextAreaElement
		: T extends "input"
			? HTMLInputElement
			: T extends
						| "button"
						| "[data-act]"
						| "[data-tab]"
						| "[data-scale]"
						| ".tile"
						| ".cart"
				? HTMLElement
				: HTMLElement;

export const $ = <T extends string>(
	sel: T,
	root: ParentNode = document,
): ElementForSelector<T> => {
	const el = root.querySelector<ElementForSelector<T>>(sel);
	if (!el) throw new Error(`Required element not found: ${sel}`);
	return el;
};
export const $$ = <T extends string>(
	sel: T,
	root: ParentNode = document,
): ElementForSelector<T>[] => [
	...root.querySelectorAll<ElementForSelector<T>>(sel),
];

export function esc(s: unknown) {
	return String(s ?? "").replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] ?? c,
	);
}

export const sleep = (ms: number) =>
	new Promise<void>((r) => setTimeout(r, ms));
export const nextFrame = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

export function reducedMotion() {
	return (
		document.documentElement.classList.contains("reduce-motion") ||
		matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * Transparent windows ignore the mouse except over elements marked [data-hit].
 * Electron forwards mouse-move events while ignoring, so we can flip back on hover.
 */
export function installClickThrough({
	isLocked = () => false,
}: {
	isLocked?: () => boolean;
} = {}) {
	let interactive = null;
	const set = (on) => {
		if (on === interactive) return;
		interactive = on;
		api.setInteractive(on);
	};
	const check = (e) => {
		if (isLocked() || e.buttons) return set(true);
		const el = document.elementFromPoint(e.clientX, e.clientY);
		set(!!el?.closest("[data-hit]"));
	};
	window.addEventListener("mousemove", check, { passive: true });
	window.addEventListener("mousedown", check, { passive: true });
	document.addEventListener("mouseleave", () => {
		if (!isLocked()) set(false);
	});
	set(false);
	return {
		refresh: (x, y) => check({ clientX: x, clientY: y, buttons: 0 }),
		set,
	};
}

// ---------- tiny retro synth (no audio files) ----------
let ctx: AudioContext | null = null;
let enabled = true;
export function setSoundEnabled(on) {
	enabled = !!on;
}

/** Play one synthesized note. `at` and `dur` are in seconds. */
export function tone(
	freq: number,
	{
		at = 0,
		dur = 0.08,
		type = "square",
		gain = 0.05,
		slide = 0,
	}: {
		at?: number;
		dur?: number;
		type?: OscillatorType;
		gain?: number;
		slide?: number;
	} = {},
) {
	if (!enabled) return;
	try {
		ctx ??= new AudioContext();
		const t = ctx.currentTime + at;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (slide)
			o.frequency.exponentialRampToValueAtTime(
				Math.max(40, freq + slide),
				t + dur,
			);
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(ctx.destination);
		o.start(t);
		o.stop(t + dur + 0.02);
	} catch {
		/* audio is optional */
	}
}

export const sfx = {
	open: () => {
		tone(523, { dur: 0.07 });
		tone(784, { at: 0.06, dur: 0.1 });
	},
	close: () => {
		tone(659, { dur: 0.06 });
		tone(440, { at: 0.05, dur: 0.09 });
	},
	hover: () => tone(1046, { dur: 0.03, gain: 0.018, type: "triangle" }),
	select: () => {
		tone(660, { dur: 0.05, type: "triangle", gain: 0.06 });
		tone(990, { at: 0.04, dur: 0.09, type: "triangle", gain: 0.06 });
	},
	pop: () => tone(300, { dur: 0.12, type: "sine", gain: 0.09, slide: 500 }),
	send: () =>
		tone(500, { dur: 0.14, type: "triangle", gain: 0.05, slide: 600 }),
	boop: () => tone(220, { dur: 0.1, type: "sine", gain: 0.08, slide: -60 }),
	start: () => {
		tone(880, { dur: 0.06, type: "sine", gain: 0.06 });
		tone(1320, { at: 0.07, dur: 0.08, type: "sine", gain: 0.06 });
	},
	stop: () => {
		tone(1320, { dur: 0.06, type: "sine", gain: 0.05 });
		tone(880, { at: 0.07, dur: 0.08, type: "sine", gain: 0.05 });
	},
	error: () => {
		tone(180, { dur: 0.12, gain: 0.05 });
		tone(140, { at: 0.12, dur: 0.16, gain: 0.05 });
	},
};

/** Apply app-wide preference classes from settings. */
export function applyPrefs(s: PublicSettings) {
	document.documentElement.classList.toggle(
		"reduce-motion",
		!!s?.behavior?.reduceMotion,
	);
	setSoundEnabled(s?.behavior?.sounds !== false);
}
