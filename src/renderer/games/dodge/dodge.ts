// Dodge: Clippy attacks the mouse cursor across the whole screen. This module
// owns the overlay page: input, game states, HUD, dialogs and sound.

import type {
	GameInit,
	GameResult,
	GameRoundReward,
} from "../../../shared/types.js";
import { blink, clippyMarkup, createGaze } from "../../common/clippy.js";
import { icon } from "../../common/icons.js";
import {
	$,
	api,
	applyPrefs,
	esc,
	reducedMotion,
	sfx,
	tone,
} from "../../common/ui.js";
import { formatScore, loadBest, saveBest } from "../score.js";
import { director } from "./attacks.js";
import {
	clamp,
	pick,
	rand,
	type Script,
	tween,
	type Vec,
	World,
	wait,
} from "./engine.js";

type State =
	| "intro"
	| "countdown"
	| "playing"
	| "paused"
	| "dying"
	| "over"
	| "leaving";

const worldEl = $("#world");
const backCanvas = $("#back") as HTMLCanvasElement;
const frontCanvas = $("#front") as HTMLCanvasElement;
const back = backCanvas.getContext("2d");
const front = frontCanvas.getContext("2d");
const clippyEl = $("#clippy");
const winLayer = $("#wins");
const bubble = $("#bubble");
const hud = $("#hud");
const scoreEl = $("#score");
const bestEl = $("#best");
const countEl = $("#count");
const dialog = $("#dialog");
const dim = $("#dim");

const settings = await api.getSettings();
applyPrefs(settings);
const init: GameInit = (await api.gameInit()) ?? {
	id: "dodge",
	scale: 1,
	home: {
		x: window.innerWidth - 260,
		y: window.innerHeight - 320,
		width: 140,
		height: 224,
	},
	cursor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
};
const s = init.scale;
// Clippy's body centre inside his SVG box, at scale 1.
const ANCHOR = { x: 70, y: 130 };
const home: Vec = {
	x: init.home.x + ANCHOR.x * s,
	y: init.home.y + ANCHOR.y * s,
};
const cursor: Vec = { ...init.cursor };

clippyEl.style.width = `${140 * s}px`;
clippyEl.style.height = `${224 * s}px`;
clippyEl.style.transformOrigin = `${ANCHOR.x * s}px ${ANCHOR.y * s}px`;
$(".bob", clippyEl).innerHTML = clippyMarkup({
	uid: "dodge",
	costume: settings.costume,
});
const svg = $("svg", clippyEl);
const gaze = createGaze(svg);

const sounds: Record<string, (arg?: number) => void> = {
	charge: (d = 1) =>
		tone(160, { dur: d, type: "sawtooth", gain: 0.02, slide: 640 }),
	fire: () => {
		tone(880, { dur: 0.22, gain: 0.045, slide: -660 });
		tone(140, { dur: 0.3, type: "triangle", gain: 0.08, slide: -70 });
	},
	burst: () => {
		tone(200, { dur: 0.28, type: "sawtooth", gain: 0.04, slide: -140 });
		tone(90, { at: 0.02, dur: 0.3, type: "triangle", gain: 0.07, slide: -40 });
	},
	pop: () => sfx.pop(),
	whoosh: () =>
		tone(1300, { dur: 0.2, type: "triangle", gain: 0.035, slide: -1000 }),
	thud: () =>
		tone(120, { dur: 0.12, type: "triangle", gain: 0.06, slide: -50 }),
	spin: (d = 1) =>
		tone(220, { dur: d, type: "triangle", gain: 0.025, slide: 900 }),
	tick: () => tone(2000, { dur: 0.015, gain: 0.008 }),
	laser: (d = 1) => {
		tone(98, { dur: d, type: "sawtooth", gain: 0.03, slide: 30 });
		tone(196, { dur: d, gain: 0.012, slide: -20 });
	},
	type: () => {
		for (let i = 0; i < 4; i++)
			tone(1500 + Math.random() * 600, {
				at: i * 0.04,
				dur: 0.02,
				gain: 0.015,
			});
	},
	graze: () => tone(1568, { dur: 0.05, type: "triangle", gain: 0.03 }),
	bonus: () => sfx.select(),
	beep: () => tone(660, { dur: 0.09, gain: 0.04 }),
	go: () => {
		tone(880, { dur: 0.08, gain: 0.045 });
		tone(1320, { at: 0.08, dur: 0.22, gain: 0.045 });
	},
	hit: () => {
		tone(330, { dur: 0.12, gain: 0.06, slide: -200 });
		tone(80, { at: 0.06, dur: 0.45, type: "triangle", gain: 0.1, slide: -30 });
	},
};

let bubbleUntil = 0;
let bubbleSize = { w: 0, h: 0 };
function say(text: string, seconds = 1.6) {
	bubble.textContent = text;
	bubble.classList.add("show");
	bubbleSize = { w: bubble.offsetWidth, h: bubble.offsetHeight };
	bubbleUntil = performance.now() + (seconds + text.length * 0.02) * 1000;
}

function makeWorld(at: Vec) {
	const w = new World({
		w: window.innerWidth,
		h: window.innerHeight,
		scale: s,
		dpr: window.devicePixelRatio || 1,
		hooks: { say, sound: (name, arg) => sounds[name]?.(arg) },
		winLayer,
		cursor,
		clippyAt: at,
	});
	w.cursor = cursor;
	return w;
}

let world = makeWorld(home);
let state: State = "intro";
let scripts: Script[] = [];
let best = loadBest("dodge");
let lastResult: GameResult | null = null;
// Credits for the last finished round, resolved by the main process.
let reward: Promise<GameRoundReward | null> = Promise.resolve(null);

/** Reports a finished round so its score turns into credits. */
function endRound(result: GameResult) {
	lastResult = result;
	reward = api.gameRound(result).catch(() => null);
}
// Whether this round's attack director is running.
let started = false;

function startAttacks() {
	if (started) return;
	started = true;
	world.spawn(director(world));
}

function fitCanvases() {
	const dpr = window.devicePixelRatio || 1;
	for (const c of [backCanvas, frontCanvas]) {
		c.width = Math.round(window.innerWidth * dpr);
		c.height = Math.round(window.innerHeight * dpr);
	}
	world.w = window.innerWidth;
	world.h = window.innerHeight;
	world.dpr = dpr;
}
fitCanvases();
window.addEventListener("resize", fitCanvases);

let clippyClass = "";
let shownScore = -1;
function render(now: number) {
	const c = world.clippy;
	clippyEl.style.transform = `translate(${(c.x - ANCHOR.x * s).toFixed(1)}px, ${(c.y - ANCHOR.y * s).toFixed(1)}px) rotate(${c.rot.toFixed(3)}rad) scale(${c.sx.toFixed(3)}, ${c.sy.toFixed(3)})`;
	const cls = [
		`mood-${c.mood || "idle"}`,
		c.laser ? "laser" : "",
		c.dashing ? "dashing" : "",
		c.charge > 0 ? "charging" : "",
	].join(" ");
	if (cls !== clippyClass) {
		clippyClass = cls;
		clippyEl.className = cls;
	}
	if (c.charge > 0) clippyEl.style.setProperty("--charge", c.charge.toFixed(2));

	const onScreen = !world.offscreen(c.x, c.y, -20);
	if (now > bubbleUntil || !onScreen) bubble.classList.remove("show");
	if (bubble.classList.contains("show")) {
		const bx = clamp(c.x - bubbleSize.w / 2, 8, world.w - bubbleSize.w - 8);
		let by = c.y - 138 * s - bubbleSize.h;
		if (by < 8) by = c.y + 110 * s;
		bubble.style.transform = `translate(${bx.toFixed(0)}px, ${by.toFixed(0)}px)`;
	}

	const shake = reducedMotion() ? 0 : world.shake;
	worldEl.style.transform = shake
		? `translate(${rand(-shake, shake).toFixed(1)}px, ${rand(-shake, shake).toFixed(1)}px)`
		: "";

	const score = world.score;
	if (score !== shownScore) {
		shownScore = score;
		scoreEl.textContent = formatScore(score);
		bestEl.textContent = formatScore(Math.max(best, score));
	}
	world.draw(back, front);
}

function run(script: Script) {
	scripts.push(script);
}

function* countdown(steps: string[], each: number): Script {
	for (let i = 0; i < steps.length; i++) {
		countEl.textContent = steps[i];
		countEl.classList.remove("pop");
		void countEl.offsetWidth;
		countEl.classList.add("pop");
		(i === steps.length - 1 ? sounds.go : sounds.beep)();
		yield* wait(each);
	}
	countEl.textContent = "";
	countEl.classList.remove("pop");
}

function* flyTo(to: Vec, seconds: number): Script {
	const c = world.clippy;
	const from = { x: c.x, y: c.y };
	yield* tween(seconds, (k) => {
		c.x = from.x + (to.x - from.x) * k;
		c.y = from.y + (to.y - from.y) * k;
	});
}

function* intro(first: boolean): Script {
	state = "intro";
	document.body.classList.add("active");
	const c = world.clippy;
	c.mood = "happy";
	if (first) say("It looks like you want to play a game.", 1.4);
	else say(pick(["Again? Gladly.", "Round two!", "Back for more?"]), 1);
	yield* wait(first ? 0.6 : 0.2);
	yield* flyTo(world.pickSpot(380), 0.8);
	c.mood = "angry";
	hud.hidden = false;
	state = "countdown";
	yield* countdown(["3", "2", "1", "DODGE!"], 0.55);
	state = "playing";
	startAttacks();
}

function resume() {
	hideDialog();
	state = "countdown";
	run(
		(function* (): Script {
			yield* countdown(["READY", "GO!"], 0.5);
			state = "playing";
			startAttacks();
		})(),
	);
}

function pause() {
	if (state !== "playing" && state !== "countdown") return;
	scripts = [];
	countEl.textContent = "";
	state = "paused";
	sfx.close();
	showDialog({
		title: "Paused",
		body: `
      <div class="dlg-head">
        <span class="fw-icon ask"></span>
        <div>
          <p class="dlg-title px">Taking a break?</p>
          <p class="hint">Clippy will wait. Patiently. Menacingly.</p>
        </div>
      </div>`,
		buttons: [
			{ label: "Resume", act: "resume", primary: true },
			{ label: "Quit", act: "quit" },
		],
		onClose: "resume",
	});
}

function gameOver(at: Vec) {
	state = "dying";
	const score = world.score;
	const record = saveBest("dodge", score);
	best = loadBest("dodge");
	endRound({ score, time: world.time, record });
	const c = world.clippy;
	c.mood = "happy";
	world.ring(at.x, at.y, "#ffffff", 6, 160);
	world.ring(at.x, at.y, "#e5484d", 14, 260);
	world.text("OUCH!", cursor.x, cursor.y - 26, "#ff6b6b", 28);
	world.shake = 16;
	sounds.hit();
	say(pick(["Gotcha!", "It looks like you got hit!", "Bonk!"]), 1.4);
	dim.animate(
		[
			{ backgroundColor: "rgba(229, 72, 77, 0.38)" },
			{ backgroundColor: "rgba(229, 72, 77, 0)" },
		],
		{ duration: 600, easing: "ease-out" },
	);
	run(
		(function* (): Script {
			yield* wait(0.35);
			world.clearHazards();
			c.mood = "happy";
			// A hit mid-dive can leave Clippy off screen.
			if (world.offscreen(c.x, c.y, -60))
				yield* flyTo(world.pickSpot(200), 0.6);
			yield* wait(0.75);
			state = "over";
			showGameOver();
		})(),
	);
}

function showGameOver() {
	const r = lastResult;
	sfx.open();
	showDialog({
		title: "Game Over",
		body: `
      <div class="dlg-head">
        <span class="fw-icon err"></span>
        <div>
          <p class="dlg-title px">It looks like you got hit!</p>
          <p class="hint">Would you like to try again?</p>
        </div>
      </div>
      <div class="go-score">
        <span class="label">Score</span>
        <b class="px">${formatScore(r.score)}</b>
        ${r.record ? '<span class="go-new px">NEW BEST!</span>' : ""}
      </div>
      <dl class="go-stats">
        <dt>Time survived</dt><dd class="px">${r.time.toFixed(1)} s</dd>
        <dt>Attacks dodged</dt><dd class="px">${world.dodged}</dd>
        <dt>Close calls</dt><dd class="px">${world.grazes}</dd>
        <dt>Best</dt><dd class="px">${formatScore(best)}</dd>
      </dl>
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
	});
	const shown = dialog.firstElementChild;
	reward.then((r) => {
		if (dialog.firstElementChild !== shown) return;
		const earned = dialog.querySelector("[data-earned]");
		const wallet = dialog.querySelector("[data-wallet]");
		if (!earned || !wallet) return;
		earned.textContent = `+${r?.earned ?? 0} credits`;
		wallet.textContent = r
			? `${r.credits} to spend in the Wardrobe`
			: "Credits are unavailable right now.";
	});
}

function playAgain() {
	hideDialog();
	const c = world.clippy;
	world = makeWorld({ x: c.x, y: c.y });
	started = false;
	fitCanvases();
	shownScore = -1;
	run(intro(false));
}

function quit() {
	if (state === "leaving") return;
	if (state === "playing" || state === "paused" || state === "countdown") {
		const score = world.score;
		if (score > 0)
			endRound({ score, time: world.time, record: saveBest("dodge", score) });
	}
	state = "leaving";
	scripts = [];
	hideDialog();
	hud.hidden = true;
	countEl.textContent = "";
	world.clearHazards();
	document.body.classList.remove("active");
	const c = world.clippy;
	c.mood = null;
	c.lockRot = false;
	run(
		(function* (): Script {
			yield* flyTo(home, reducedMotion() ? 0.01 : 0.6);
			c.rot = 0;
			yield* wait(0.15);
			api.exitGame(lastResult);
		})(),
	);
}

type DialogSpec = {
	title: string;
	body: string;
	buttons: { label: string; act: string; primary?: boolean }[];
	onClose: string;
};

function showDialog(spec: DialogSpec) {
	dialog.innerHTML = `
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
	dialog.hidden = false;
	dialog.classList.remove("entered");
	void dialog.offsetWidth;
	dialog.classList.add("entered");
	dialog.querySelector<HTMLElement>(".btn-primary")?.focus();
}

function hideDialog() {
	dialog.hidden = true;
	dialog.innerHTML = "";
}

dialog.addEventListener("click", (e) => {
	const target = e.target;
	if (!(target instanceof Element)) return;
	const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
	if (!act) return;
	sfx.select();
	if (act === "resume") resume();
	else if (act === "again") playAgain();
	else if (act === "quit") quit();
});

window.addEventListener("pointermove", (e) => {
	cursor.x = e.clientX;
	cursor.y = e.clientY;
});
window.addEventListener("pointerdown", (e) => {
	cursor.x = e.clientX;
	cursor.y = e.clientY;
});
// The cursor left the overlay (another display) or the window lost focus.
document.documentElement.addEventListener("mouseleave", pause);
window.addEventListener("blur", pause);
window.addEventListener("keydown", (e) => {
	if (e.key !== "Escape") return;
	e.preventDefault();
	if (state === "playing" || state === "countdown") pause();
	else if (state === "paused") {
		sfx.select();
		resume();
	} else if (state === "over" || state === "intro") quit();
});

let last = performance.now();
let nextBlink = last + 2500;
function frame(now: number) {
	const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
	last = now;
	if (state === "playing") {
		world.update(dt);
		const hit = world.collide();
		if (hit) gameOver(hit);
	}
	if (state !== "paused") {
		for (let i = 0; i < scripts.length; i++) {
			if (scripts[i].next(dt).done) {
				scripts.splice(i, 1);
				i -= 1;
			}
		}
		world.updateEffects(dt);
		world.updateActor(dt);
	}
	gaze.lookAt(cursor.x, cursor.y);
	gaze.tick(dt);
	if (now > nextBlink) {
		if (world.clippy.mood !== "happy") blink(svg);
		nextBlink = now + 2000 + Math.random() * 3500;
	}
	render(now);
	requestAnimationFrame(frame);
}

try {
	await document.fonts.load('16px "Pixelify Sans"');
} catch {
	/* canvas text falls back to monospace */
}
bestEl.textContent = formatScore(best);
render(performance.now());
api.gameReady();
requestAnimationFrame((now) => {
	last = now;
	run(intro(true));
	requestAnimationFrame(frame);
});
