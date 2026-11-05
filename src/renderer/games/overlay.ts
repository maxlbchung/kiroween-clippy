// Shared runtime for full-screen game overlays: startup data, Clippy and his
// speech bubble, countdowns, Win9x dialogs, round reporting and the frame
// loop. Pages pair it with overlay.css.

import type {
	Costume,
	GameId,
	GameInit,
	GameResult,
	GameRoundReward,
	PublicSettings,
} from "../../shared/types.js";
import { blink, clippyMarkup, createGaze } from "../common/clippy.js";
import { icon } from "../common/icons.js";
import {
	$,
	api,
	applyPrefs,
	esc,
	reducedMotion,
	sfx,
	tone,
} from "../common/ui.js";
import {
	clamp,
	pick,
	type Script,
	type Steerable,
	steer,
	type Vec,
	wait,
} from "./motion.js";
import { formatScore, loadBest, saveBest } from "./score.js";

/** Clippy's body centre inside his SVG box, at scale 1. */
export const ANCHOR = { x: 70, y: 130 };
/** Clippy's SVG box, at scale 1. */
const BOX = { w: 140, h: 224 };

export type Overlay = {
	settings: PublicSettings;
	init: GameInit;
	/** Pet scale, so the overlay Clippy matches the desktop one. */
	scale: number;
	/** Clippy's body centre where the pet window drew him. */
	home: Vec;
	/** Latest pointer position, kept current from pointer events. */
	cursor: Vec;
};

/**
 * Loads settings and the game's startup data, and applies app preferences.
 * Opened outside the arcade, Clippy starts near the bottom-right corner.
 */
export async function openOverlay(id: GameId): Promise<Overlay> {
	const settings = await api.getSettings();
	applyPrefs(settings);
	const init: GameInit = (await api.gameInit()) ?? {
		id,
		scale: 1,
		home: {
			x: window.innerWidth - 260,
			y: window.innerHeight - 320,
			width: BOX.w,
			height: BOX.h,
		},
		cursor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
	};
	const scale = init.scale;
	const cursor = { ...init.cursor };
	const track = (e: PointerEvent) => {
		cursor.x = e.clientX;
		cursor.y = e.clientY;
	};
	window.addEventListener("pointermove", track);
	window.addEventListener("pointerdown", track);
	return {
		settings,
		init,
		scale,
		home: {
			x: init.home.x + ANCHOR.x * scale,
			y: init.home.y + ANCHOR.y * scale,
		},
		cursor,
	};
}

/** `seconds`, or almost none when the system asks for reduced motion. */
export const flight = (seconds: number) => (reducedMotion() ? 0.01 : seconds);

/**
 * Draws Clippy into `el` (which holds a `.bob` child) at `scale` and returns
 * his face: eyes that follow a point and blink every few seconds.
 */
export function mountClippy(
	el: HTMLElement,
	{ uid, costume, scale }: { uid: string; costume: Costume; scale: number },
) {
	el.style.width = `${BOX.w * scale}px`;
	el.style.height = `${BOX.h * scale}px`;
	el.style.transformOrigin = `${ANCHOR.x * scale}px ${ANCHOR.y * scale}px`;
	$(".bob", el).innerHTML = clippyMarkup({ uid, costume });
	const svg = $("svg", el);
	const gaze = createGaze(svg);
	let nextBlink = performance.now() + 2500;
	return {
		svg,
		/** Looks at `at` and blinks when due. Happy Clippy's eyes are closed, so he skips blinks. */
		look(at: Vec, dt: number, now: number, mood: string | null) {
			gaze.lookAt(at.x, at.y);
			gaze.tick(dt);
			if (now < nextBlink) return;
			if (mood !== "happy") blink(svg);
			nextBlink = now + 2000 + Math.random() * 3500;
		},
	};
}

export type Pose = Steerable & {
	/** Raises Clippy without moving his anchor, in px. */
	lift: number;
	mood: string | null;
};

/** CSS transform that puts Clippy's anchor at the pose's position, raised by `lift`. */
export function poseTransform(
	p: Pick<Pose, "x" | "y" | "rot" | "sx" | "sy"> & { lift?: number },
	scale: number,
) {
	const x = p.x - ANCHOR.x * scale;
	const y = p.y - (p.lift ?? 0) - ANCHOR.y * scale;
	return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${p.rot.toFixed(3)}rad) scale(${p.sx.toFixed(3)}, ${p.sy.toFixed(3)})`;
}

/** Clippy drawn in an overlay. Scripts move him by changing his pose. */
export class Actor implements Pose {
	x: number;
	y: number;
	px: number;
	vx = 0;
	rot = 0;
	lockRot = false;
	sx = 1;
	sy = 1;
	lift = 0;
	mood: string | null = null;
	readonly el: HTMLElement;
	readonly scale: number;
	readonly face: ReturnType<typeof mountClippy>;
	private shownClass = "";

	constructor(
		el: HTMLElement,
		o: { uid: string; costume: Costume; scale: number; at: Vec },
	) {
		this.el = el;
		this.scale = o.scale;
		this.face = mountClippy(el, o);
		this.x = this.px = o.at.x;
		this.y = o.at.y;
	}

	/** The point his speech bubble hangs from. */
	get head(): Vec {
		return { x: this.x, y: this.y - this.lift };
	}

	/** Leans into motion, follows `look` with his eyes and blinks. */
	update(dt: number, now: number, look: Vec) {
		steer(this, dt);
		if (!this.el.hidden) this.face.look(look, dt, now, this.mood);
	}

	/** Writes the transform and the mood class, plus any `extra` classes. */
	render(extra = "") {
		this.el.style.transform = poseTransform(this, this.scale);
		const cls = `mood-${this.mood || "idle"} ${extra}`.trim();
		if (cls === this.shownClass) return;
		this.shownClass = cls;
		this.el.className = cls;
	}
}

/** Clippy's speech bubble, kept beside his head while it shows. */
export class Bubble {
	private until = 0;
	private size = { w: 0, h: 0 };

	constructor(
		readonly el: HTMLElement,
		readonly scale: number,
	) {}

	/** Shows `text` for `seconds`, plus a little longer for long lines. */
	say(text: string, seconds = 1.6) {
		this.el.textContent = text;
		this.el.classList.add("show");
		this.size = { w: this.el.offsetWidth, h: this.el.offsetHeight };
		this.until = performance.now() + (seconds + text.length * 0.02) * 1000;
	}

	hide() {
		this.el.classList.remove("show");
	}

	/**
	 * Places the bubble above `head`, or below it near the top edge, inside
	 * the screen and left of `right`. Hides it once its time is up. Sets the
	 * `below` class and a `--tail` offset for pages that draw a tail.
	 */
	update(now: number, head: Vec, right = window.innerWidth - 8) {
		if (now > this.until) this.hide();
		if (!this.el.classList.contains("show")) return;
		const { w, h } = this.size;
		const s = this.scale;
		const x = clamp(head.x - w / 2, 8, Math.max(8, right - w));
		let y = head.y - 138 * s - h;
		const below = y < 8;
		if (below) y = head.y + 110 * s;
		this.el.classList.toggle("below", below);
		this.el.style.setProperty(
			"--tail",
			`${clamp(head.x - x, 16, w - 16).toFixed(0)}px`,
		);
		this.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
	}
}

export const whoosh = () =>
	tone(1300, { dur: 0.2, type: "triangle", gain: 0.035, slide: -1000 });

/**
 * Flashes each of `steps` in `el` for `each` seconds with a beep, and a
 * brighter chord on the last one. `cls` is set on `el` while it runs.
 */
export function* countdown(
	el: HTMLElement,
	steps: string[],
	each: number,
	cls?: string,
): Script {
	if (cls) el.classList.add(cls);
	for (let i = 0; i < steps.length; i++) {
		el.textContent = steps[i];
		el.classList.remove("pop");
		void el.offsetWidth;
		el.classList.add("pop");
		if (i < steps.length - 1) tone(660, { dur: 0.09, gain: 0.04 });
		else {
			tone(880, { dur: 0.08, gain: 0.045 });
			tone(1320, { at: 0.08, dur: 0.22, gain: 0.045 });
		}
		yield* wait(each);
	}
	el.textContent = "";
	el.classList.remove("pop");
	if (cls) el.classList.remove(cls);
}

export type DialogSpec = {
	title: string;
	body: string;
	buttons: { label: string; act: string; primary?: boolean }[];
	/** Action for the title bar's close button. */
	onClose: string;
};

/** Message-box heading: a glyph (`err`, `warn`, `info` or `ask`), a title and a hint. */
export function dialogHead(glyph: string, title: string, hint: string) {
	return `
      <div class="dlg-head">
        <span class="fw-icon ${esc(glyph)}"></span>
        <div>
          <p class="dlg-title px">${esc(title)}</p>
          <p class="hint">${esc(hint)}</p>
        </div>
      </div>`;
}

/** The pause dialog: Resume or Quit. Closing it resumes. */
export function pauseDialog(title: string, hint: string): DialogSpec {
	return {
		title: "Paused",
		body: dialogHead("ask", title, hint),
		buttons: [
			{ label: "Resume", act: "resume", primary: true },
			{ label: "Quit", act: "quit" },
		],
		onClose: "resume",
	};
}

/**
 * A round's results: score, NEW BEST, `stats` rows (label, value) and a
 * credits line that `Dialog.show` fills in once the reward arrives. Offers
 * Play again or Quit. Closing it quits.
 */
export function resultsDialog(o: {
	title: string;
	glyph: string;
	heading: string;
	hint: string;
	result: GameResult;
	stats: [string, string | number][];
}): DialogSpec {
	const rows = o.stats
		.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="px">${esc(v)}</dd>`)
		.join("");
	return {
		title: o.title,
		body: `
      ${dialogHead(o.glyph, o.heading, o.hint)}
      <div class="go-score">
        <span class="label">Score</span>
        <b class="px">${formatScore(o.result.score)}</b>
        ${o.result.record ? '<span class="go-new px">NEW BEST!</span>' : ""}
      </div>
      <dl class="go-stats">${rows}</dl>
      <div class="go-credits">
        ${icon("coin", 24)}
        <b class="px" data-earned>+…</b>
        <span class="hint" data-wallet>Counting credits…</span>
      </div>`,
		buttons: [
			{ label: "Play again", act: "again", primary: true },
			{ label: "Quit", act: "quit" },
		],
		onClose: "quit",
	};
}

/** The overlay's one Win9x dialog. Clicking a `[data-act]` element calls `onAct`. */
export class Dialog {
	constructor(
		readonly el: HTMLElement,
		onAct: (act: string) => void,
	) {
		el.addEventListener("click", (e) => {
			const target = e.target;
			if (!(target instanceof Element)) return;
			const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
			if (!act) return;
			sfx.select();
			onAct(act);
		});
	}

	get open() {
		return !this.el.hidden;
	}

	/**
	 * Shows `spec` and focuses its primary button. `place` returns the
	 * dialog's centre for its measured size; without it the dialog sits on
	 * the stage centre from overlay.css. A results dialog's credits line
	 * fills in when `reward` resolves, unless another dialog replaced it.
	 */
	show(
		spec: DialogSpec,
		{
			place,
			reward,
		}: {
			place?: (size: { w: number; h: number }) => Vec;
			reward?: Promise<GameRoundReward | null>;
		} = {},
	) {
		const el = this.el;
		el.innerHTML = `
    <div class="titlebar">
      <div class="titlebar-text">${esc(spec.title)}</div>
      <button class="icon-btn" data-act="${esc(spec.onClose)}" aria-label="Close"><span class="x-glyph"></span></button>
    </div>
    <div class="win-body">
      ${spec.body}
      <div class="dlg-btns">
        ${spec.buttons.map((b) => `<button class="btn${b.primary ? " btn-primary" : ""}" data-act="${esc(b.act)}">${esc(b.label)}</button>`).join("")}
      </div>
    </div>`;
		el.hidden = false;
		if (place) {
			const at = place({ w: el.offsetWidth, h: el.offsetHeight });
			el.style.setProperty("--stage-x", `${at.x}px`);
			el.style.setProperty("--stage-y", `${at.y}px`);
		} else {
			el.style.removeProperty("--stage-x");
			el.style.removeProperty("--stage-y");
		}
		el.classList.remove("entered");
		void el.offsetWidth;
		el.classList.add("entered");
		el.querySelector<HTMLElement>(".btn-primary")?.focus();
		if (reward) this.fillCredits(reward);
	}

	hide() {
		this.el.hidden = true;
		this.el.innerHTML = "";
	}

	private fillCredits(reward: Promise<GameRoundReward | null>) {
		const shown = this.el.firstElementChild;
		reward.then((r) => {
			if (this.el.firstElementChild !== shown) return;
			const earned = this.el.querySelector("[data-earned]");
			const wallet = this.el.querySelector("[data-wallet]");
			if (!earned || !wallet) return;
			earned.textContent = `+${r?.earned ?? 0} credits`;
			wallet.textContent = r
				? `${r.credits} to spend in the Wardrobe`
				: "Credits are unavailable right now.";
		});
	}
}

/** A game's best score and its once-per-round credit reports. */
export class Rounds {
	best: number;
	last: GameResult | null = null;
	/** Credits for the last reported round, resolved by the main process. */
	reward: Promise<GameRoundReward | null> = Promise.resolve(null);
	private open = false;

	constructor(readonly id: GameId) {
		this.best = loadBest(id);
	}

	/** Starts a round, which can then be reported once. */
	begin() {
		this.open = true;
	}

	/**
	 * Saves a new best and reports the round so its score turns into
	 * credits. Does nothing if this round was already reported.
	 */
	report(score: number, time: number) {
		if (!this.open) return;
		this.open = false;
		const record = saveBest(this.id, score);
		this.best = loadBest(this.id);
		this.last = { score, time, record };
		this.reward = api.gameRound(this.last).catch(() => null);
	}

	/** Reports a round cut short by quitting, if it scored anything. */
	abandon(score: number, time: number) {
		if (score > 0) this.report(score, time);
	}

	/**
	 * Closes the overlay. Clippy then says one of `lines` for the last
	 * reported round on the desktop; `points` is its formatted score.
	 */
	exit(lines: (points: string, last: GameResult) => string[]) {
		const r = this.last;
		api.exitGame(r, r ? pick(lines(r.score.toLocaleString("en-US"), r)) : "");
	}
}

/**
 * Calls `pause` when the overlay loses focus and, unless `onCursorLeave` is
 * false, when the cursor leaves it for another display.
 */
export function pauseWhenAway(pause: () => void, onCursorLeave = true) {
	window.addEventListener("blur", pause);
	if (onCursorLeave)
		document.documentElement.addEventListener("mouseleave", pause);
}

/** Waits for the pixel font so text measures right. Falls back silently. */
export async function loadFont() {
	try {
		await document.fonts.load('16px "Pixelify Sans"');
	} catch {
		/* text falls back to the next font */
	}
}

/**
 * Tells the main process the overlay is drawn, then calls `begin` and runs
 * `frame` every animation frame. `dt` is in seconds, capped at 1/30 so a
 * stalled frame never skips ahead.
 */
export function start(
	frame: (dt: number, now: number) => void,
	begin: () => void,
) {
	api.gameReady();
	requestAnimationFrame((first) => {
		let last = first;
		begin();
		const tick = (now: number) => {
			const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
			last = now;
			frame(dt, now);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}
