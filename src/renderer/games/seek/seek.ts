// Hide & Seek: Clippy and two clones hide in a pile of fake windows and the
// player has to find all three. This module owns the overlay page: round flow,
// input, HUD, dialogs and sound.
//
// Query parameters for previews and automated tests: `limit` sets the round
// length in seconds and `seed` makes every round's layout repeatable.

import type { GameRoundReward } from "../../../shared/types.js";
import { blink, clippyMarkup, createGaze } from "../../common/clippy.js";
import { $, api, esc, reducedMotion, sfx, tone } from "../../common/ui.js";
import {
	clamp,
	flyTo,
	pick,
	rand,
	type Script,
	stepScripts,
	type Vec,
	wait,
} from "../motion.js";
import {
	Actor,
	Bubble,
	countdown,
	Dialog,
	type DialogSpec,
	flight,
	loadFont,
	openOverlay,
	pauseDialog,
	pauseWhenAway,
	Rounds,
	resultsDialog,
	start,
	whoosh,
} from "../overlay.js";
import { formatScore } from "../score.js";
import { closePopup, DECOYS, type DecoyKind, draftPile } from "./catalog.js";
import {
	chooseDecoys,
	chooseSpots,
	clampRect,
	HIDERS,
	layoutPile,
	type Pose,
	pickOne,
	pileFull,
	placeDialog,
	playArea,
	type Rect,
	type Rng,
	type Spot,
	seeded,
} from "./layout.js";
import {
	clippyInBox,
	createWindow,
	decoyInBox,
	fillSpot,
	measureWindow,
	placeWindow,
	SHADED_H,
	type Win,
} from "./pile.js";
import {
	FIND_POINTS,
	HINT_COST,
	MISS_PENALTY,
	roundScore,
	strayClick,
	TIME_LIMIT,
} from "./scoring.js";

type State =
	| "intro"
	| "countdown"
	| "playing"
	| "paused"
	| "ending"
	| "over"
	| "leaving";

type Hider = {
	spot: Spot;
	el: HTMLElement;
	svg: SVGSVGElement;
	gaze: ReturnType<typeof createGaze>;
	found: boolean;
	nextBlink: number;
	nextLook: number;
};

type Round = {
	rng: Rng;
	wins: Win[];
	hiders: Hider[];
	decoys: Spot[];
	elapsed: number;
	found: number;
	misses: number;
	hints: number;
	heat: number;
	lastStray: number;
	top: Win | null;
	z: number;
	popups: number;
};

const desk = $("#desk");
const fx = $("#fx");
const blind = $("#blind");
const hud = $("#hud");
const headsEl = $("#heads");
const timeEl = $("#time");
const scoreEl = $("#score");
const hintBtn = $("#hint") as HTMLButtonElement;
const countEl = $("#count");

const params = new URLSearchParams(location.search);
const limit = Number(params.get("limit")) || TIME_LIMIT;
const seed = Number(params.get("seed")) || 0;

const { settings, scale: s, home, cursor } = await openOverlay("seek");
const costume = settings.costume;

const actor = new Actor($("#clippy"), {
	uid: "seek",
	costume,
	scale: s,
	at: home,
});
const bubble = new Bubble($("#bubble"), s);
const dialog = new Dialog($("#dialog"), (act) => {
	if (act === "resume") resume();
	else if (act === "again") playAgain();
	else if (act === "quit") quit();
});
const rounds = new Rounds("seek");

headsEl.innerHTML = Array.from(
	{ length: HIDERS },
	(_, i) =>
		`<span class="head">${clippyInBox(`hud${i}`, costume, "up", 22, 24)}</span>`,
).join("");
const heads = [...headsEl.children] as HTMLElement[];
hintBtn.textContent = `Hint -${HINT_COST}`;

const sounds = {
	spawn: (i: number) =>
		tone(300 + (i % 14) * 45, { dur: 0.05, type: "triangle", gain: 0.025 }),
	found: (n: number) => {
		const k = 1 + (n - 1) * 0.125;
		[523, 659, 784, 1047].forEach((f, i) => {
			tone(f * k, { at: i * 0.06, dur: 0.12, gain: 0.04 });
		});
	},
	win: () => {
		[523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => {
			tone(f, { at: i * 0.09, dur: 0.16, type: "triangle", gain: 0.06 });
		});
	},
	miss: () => {
		tone(180, { dur: 0.12, type: "sawtooth", gain: 0.035, slide: -60 });
		tone(120, { at: 0.1, dur: 0.18, type: "sawtooth", gain: 0.03 });
	},
	hint: () => {
		tone(2400, { dur: 0.05, type: "triangle", gain: 0.02, slide: -600 });
		tone(2000, {
			at: 0.09,
			dur: 0.07,
			type: "triangle",
			gain: 0.02,
			slide: -600,
		});
	},
	popup: () => {
		tone(784, { dur: 0.12, type: "triangle", gain: 0.045 });
		tone(988, { at: 0.1, dur: 0.2, type: "triangle", gain: 0.045 });
	},
	tick: () => tone(1800, { dur: 0.02, gain: 0.02 }),
	timeUp: () => {
		tone(523, { dur: 0.15, gain: 0.05 });
		tone(392, { at: 0.15, dur: 0.15, gain: 0.05 });
		tone(262, { at: 0.3, dur: 0.45, type: "triangle", gain: 0.07 });
	},
	shade: () =>
		tone(900, { dur: 0.05, type: "triangle", gain: 0.025, slide: -300 }),
};

let state: State = "intro";
let scripts: Script[] = [];
let round: Round | null = null;
// Rounds played, which varies seeded layouts between rounds.
let played = 0;
// Makes every Clippy SVG id on the page unique.
let uids = 0;
let hintCooldown = 0;
let lastTick = -1;

const view = () => ({ w: window.innerWidth, h: window.innerHeight });
const area = () => playArea(view());
const center = (r: {
	left: number;
	top: number;
	width: number;
	height: number;
}) => ({
	x: r.left + r.width / 2,
	y: r.top + r.height / 2,
});

function run(script: Script) {
	scripts.push(script);
}

function showClippy(at?: Vec) {
	if (at) {
		actor.x = at.x;
		actor.y = at.y;
	}
	actor.el.hidden = false;
}

function hideClippy() {
	actor.el.hidden = true;
	bubble.hide();
}

/** Runs `fn` once `seconds` of real time pass, unless the round changes first. */
function later(seconds: number, fn: () => void) {
	const r = round;
	setTimeout(() => {
		if (round === r) fn();
	}, seconds * 1000);
}

/** Plays a one-shot animation on a new element in the effects layer, then removes it. */
function effect(
	cls: string,
	html: string,
	frames: Keyframe[],
	options: KeyframeAnimationOptions,
) {
	const el = document.createElement("div");
	el.className = cls;
	el.innerHTML = html;
	fx.appendChild(el);
	const anim = el.animate(frames, { fill: "forwards", ...options });
	anim.finished.then(
		() => el.remove(),
		() => el.remove(),
	);
	return el;
}

function ring(at: Vec, color: string, from = 16, to = 120, ms = 520) {
	const el = effect(
		"ring",
		"",
		[
			{
				transform: `translate(${at.x - from}px, ${at.y - from}px)`,
				width: `${from * 2}px`,
				height: `${from * 2}px`,
				opacity: 1,
			},
			{
				transform: `translate(${at.x - to}px, ${at.y - to}px)`,
				width: `${to * 2}px`,
				height: `${to * 2}px`,
				opacity: 0,
			},
		],
		{ duration: reducedMotion() ? 1 : ms, easing: "ease-out" },
	);
	el.style.borderColor = color;
}

function confetti(at: Vec, n = 16) {
	if (reducedMotion()) return;
	const colors = [
		"#ffd23f",
		"#e5484d",
		"#30a46c",
		"#2f7cf6",
		"#8e4ec6",
		"#ff7a1a",
	];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
		const d = rand(50, 120);
		const el = effect(
			"bit",
			"",
			[
				{ transform: `translate(${at.x}px, ${at.y}px) rotate(0)` },
				{
					transform: `translate(${at.x + Math.cos(a) * d}px, ${at.y + Math.sin(a) * d - 30}px) rotate(${rand(-3, 3)}turn)`,
					offset: 0.6,
				},
				{
					transform: `translate(${at.x + Math.cos(a) * d * 1.2}px, ${at.y + Math.sin(a) * d + 40}px) rotate(${rand(-4, 4)}turn)`,
					opacity: 0,
				},
			],
			{ duration: rand(700, 1000), easing: "ease-out" },
		);
		el.style.background = pick(colors);
	}
}

function popText(text: string, at: Vec, bad = false) {
	effect(
		`pop-text${bad ? " bad" : ""}`,
		esc(text),
		[
			{
				transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`,
				opacity: 1,
			},
			{
				transform: `translate(${at.x}px, ${at.y - 46}px) translate(-50%, -50%)`,
				opacity: 0,
			},
		],
		{ duration: 1000, easing: "ease-out" },
	);
}

/** A small speech bubble at `at`, kept on screen. */
function quip(text: string, at: Vec, seconds = 1.6) {
	const el = effect(
		"quip px",
		esc(text),
		[
			{ opacity: 0, offset: 0 },
			{ opacity: 1, offset: 0.08 },
			{ opacity: 1, offset: 0.85 },
			{ opacity: 0 },
		],
		{ duration: seconds * 1000 },
	);
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	el.style.left = `${clamp(at.x - w / 2, 8, window.innerWidth - w - 8)}px`;
	el.style.top = `${clamp(at.y - h, 8, window.innerHeight - h - 8)}px`;
	return el;
}

/** Brings a window to the front of the pile and marks it active. */
function raise(w: Win, r = round) {
	if (!r || r.top === w) return;
	r.top?.el.classList.remove("top");
	r.z += 1;
	w.model.z = r.z;
	w.el.style.zIndex = String(r.z);
	w.el.classList.add("top");
	r.top = w;
}

const fullHeight = (w: Win) => Math.min(w.draft.h, area().h);

function setShaded(w: Win, shaded: boolean) {
	if (w.el.classList.contains("shaded") === shaded) return;
	w.el.classList.toggle("shaded", shaded);
	const rect = { ...w.model.rect, h: shaded ? SHADED_H : fullHeight(w) };
	w.model.rect = clampRect(rect, area());
	w.el.style.height = `${rect.h}px`;
	placeWindow(w.el, w.model.rect);
}

function hiderAt(spot: Spot, i: number, r: Round): Hider {
	const uid = `h${uids++}`;
	const el = fillSpot(
		desk,
		r.wins,
		spot,
		(pose, w, h) => clippyInBox(uid, costume, pose, w, h),
		"hider",
	);
	el.dataset.hider = String(i);
	if (spot.kind === "desk" && spot.pose === "lie")
		el.classList.add("mood-sleep");
	const hsvg = $("svg", el);
	return {
		spot,
		el,
		svg: hsvg,
		gaze: createGaze(hsvg),
		found: false,
		nextBlink: performance.now() + rand(1000, 4000),
		nextLook: 0,
	};
}

/** Decoy art for a hiding box: plain paper clips most often, since they look most like Clippy. */
function decoyFor(r: Round, pose: Pose): DecoyKind {
	const roll = r.rng();
	if (pose === "whole" || pose === "lie")
		return roll < 0.7 ? "paperclip" : "pushpin";
	return roll < 0.6 ? "paperclip" : roll < 0.85 ? "binder" : "pushpin";
}

function buildRound(): Round {
	played += 1;
	const rng = seed ? seeded(seed + played) : Math.random;
	const a = area();
	const drafts = draftPile(rng, (d) =>
		pileFull(
			d.reduce((sum, x) => sum + x.w * x.h, 0),
			d.length,
			a,
		),
	);
	const rects = layoutPile(drafts, a, rng);
	const els = drafts.map((d, i) => {
		const el = createWindow(desk, d, rects[i], i + 1);
		el.classList.add("unborn");
		return el;
	});
	const wins = els.map((el, i) =>
		measureWindow(el, drafts[i], rects[i], i + 1),
	);
	const r: Round = {
		rng,
		wins,
		hiders: [],
		decoys: [],
		elapsed: 0,
		found: 0,
		misses: 0,
		hints: 0,
		heat: 0,
		lastStray: -10,
		top: null,
		z: wins.length,
		popups: 0,
	};
	const models = wins.map((w) => w.model);
	const spots = chooseSpots(models, a, rng);
	const kinds = Object.keys(DECOYS) as DecoyKind[];
	const deskDecoys = Array.from({ length: 2 + Math.floor(rng() * 2) }, () =>
		pickOne(rng, kinds),
	);
	r.decoys = chooseDecoys(
		models,
		a,
		rng,
		spots,
		4 + Math.floor(rng() * 3),
		deskDecoys.map((k) => DECOYS[k].size),
	);
	for (const spot of r.decoys) {
		// Desk decoys come back sized for their art, which tells them apart.
		const kind =
			spot.kind === "desk"
				? kinds.find(
						(k) =>
							DECOYS[k].size.w === spot.rect.w &&
							DECOYS[k].size.h === spot.rect.h,
					)
				: decoyFor(r, models[spot.win].slots[spot.slot].pose);
		const el = fillSpot(
			desk,
			wins,
			spot,
			(pose, w, h) =>
				spot.kind === "desk"
					? `<img class="dart" src="art/${kind}.svg" alt="" draggable="false">`
					: decoyInBox(kind, pose, w, h),
			"decoy",
		);
		el.dataset.decoy = kind;
	}
	r.hiders = spots.map((spot, i) => hiderAt(spot, i, r));
	for (const h of r.hiders) h.el.classList.add("lurk");
	raise(wins[wins.length - 1], r);
	return r;
}

function* spawnPile(r: Round): Script {
	const from = { x: actor.x, y: actor.y };
	const fast = reducedMotion();
	for (const [i, w] of r.wins.entries()) {
		w.el.classList.remove("unborn");
		if (!fast) {
			const rect = w.model.rect;
			w.el.animate(
				[
					{
						transform: `translate(${from.x - rect.w / 2}px, ${from.y - rect.h / 2}px) scale(0.05)`,
						opacity: 0,
					},
					{ opacity: 1, offset: 0.25 },
					{
						transform: `translate(${rect.x}px, ${rect.y}px) scale(1)`,
						opacity: 1,
					},
				],
				{ duration: 460, easing: "cubic-bezier(.2,.9,.3,1.12)" },
			);
		}
		sounds.spawn(i);
		yield* wait(fast ? 0 : 0.05);
	}
	yield* wait(fast ? 0.1 : 0.5);
}

function* clearPile(): Script {
	const r = round;
	if (!r) return;
	const to = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
	if (!reducedMotion()) {
		whoosh();
		for (const w of r.wins) {
			if (w.model.closed) continue;
			const rect = w.model.rect;
			w.el.animate(
				[
					{
						transform: `translate(${rect.x}px, ${rect.y}px) scale(1)`,
						opacity: 1,
					},
					{
						transform: `translate(${to.x - rect.w / 2}px, ${to.y - rect.h / 2}px) scale(0.05)`,
						opacity: 0,
					},
				],
				{
					duration: 380,
					delay: rand(0, 160),
					easing: "ease-in",
					fill: "forwards",
				},
			);
		}
		for (const el of desk.querySelectorAll<HTMLElement>(".desk-spot"))
			el.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 300,
				fill: "forwards",
			});
		yield* wait(0.56);
	}
	desk.innerHTML = "";
	fx.innerHTML = "";
	round = null;
}

/** The round's score so far, or its final score once `won`. */
function points(won = false) {
	const r = round;
	if (!r) return 0;
	return roundScore({ ...r, timeLeft: limit - r.elapsed, won });
}

const setText = (el: HTMLElement, text: string) => {
	if (el.textContent !== text) el.textContent = text;
};

function updateHud() {
	const r = round;
	const left = r ? Math.max(0, limit - r.elapsed) : limit;
	const secs = Math.ceil(left);
	setText(
		timeEl,
		`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
	);
	timeEl.classList.toggle("low", !!r && state === "playing" && left <= 10);
	setText(scoreEl, formatScore(points()));
	heads.forEach((h, i) => {
		h.classList.toggle("got", !!r && i < r.found);
	});
	hintBtn.disabled =
		state !== "playing" || hintCooldown > 0 || !r || r.found >= HIDERS;
}

/** Reports the round's score; later calls for the same round do nothing. */
function finishRound(score: number, time: number) {
	rounds.report(score, Math.round(time * 10) / 10);
}

function* intro(first: boolean): Script {
	state = "intro";
	document.body.classList.add("active");
	showClippy();
	actor.mood = "happy";
	if (first) bubble.say("It looks like you want to play hide and seek!", 1.4);
	else
		bubble.say(
			pick([
				"Again? I'll hide better this time.",
				"Round two! No peeking.",
				"You won't find us so easily now.",
			]),
			1,
		);
	yield* wait(first ? 0.8 : 0.3);
	yield* flyTo(
		actor,
		{ x: window.innerWidth / 2, y: window.innerHeight / 2 + 40 * s },
		flight(0.8),
	);
	hud.hidden = false;
	round = buildRound();
	rounds.begin();
	updateHud();
	actor.mood = "talking";
	yield* spawnPile(round);
	actor.mood = null;
	bubble.say("Count to three... no peeking!", 1.2);
	yield* wait(1.7);
	blind.classList.add("on");
	yield* wait(reducedMotion() ? 0.05 : 0.4);
	hideClippy();
	for (const h of round.hiders) h.el.classList.remove("lurk");
	state = "countdown";
	yield* countdown(countEl, ["1", "2", "3"], 0.7);
	yield* countdown(countEl, ["READY OR NOT!"], 0.9, "small");
	blind.classList.remove("on");
	state = "playing";
	updateHud();
}

function pause() {
	if (state !== "playing" && state !== "countdown") return;
	scripts = [];
	countEl.textContent = "";
	state = "paused";
	document.body.classList.add("paused");
	blind.classList.remove("on");
	sfx.close();
	updateHud();
	showDialog(
		pauseDialog(
			"No peeking!",
			"The windows are hidden while the game is paused.",
		),
	);
}

function resume() {
	dialog.hide();
	document.body.classList.remove("paused");
	for (const h of round?.hiders ?? []) h.el.classList.remove("lurk");
	hideClippy();
	state = "countdown";
	blind.classList.add("on");
	run(
		(function* (): Script {
			yield* countdown(countEl, ["READY", "GO!"], 0.5);
			blind.classList.remove("on");
			state = "playing";
			updateHud();
		})(),
	);
}

function findHider(h: Hider) {
	const r = round;
	if (!r || h.found) return;
	h.found = true;
	r.found += 1;
	const box = h.el.getBoundingClientRect();
	const at = center(box);
	h.el.classList.add("found");
	sounds.found(r.found);
	ring(at, "#ffd23f", 10, 90);
	ring(at, "#30a46c", 6, 140, 700);
	confetti(at);
	popText(`+${FIND_POINTS}`, { x: at.x, y: at.y - 40 });
	jumpOut(at, r.found - 1);
	updateHud();
	if (r.found >= HIDERS) win();
}

/** A found Clippy hops out of his spot, says something, then flies into the HUD. */
function jumpOut(at: Vec, slot: number) {
	const w = 70 * s;
	const h = 112 * s;
	const el = document.createElement("div");
	el.className = "jumper mood-hover";
	el.style.width = `${w}px`;
	el.style.height = `${h}px`;
	el.innerHTML = clippyMarkup({ uid: `j${uids++}`, costume });
	fx.appendChild(el);
	const top = clamp(at.y - h / 2 - 40, 8, window.innerHeight - h - 8);
	const x = clamp(at.x - w / 2, 8, window.innerWidth - w - 8);
	const head = heads[slot].getBoundingClientRect();
	const fast = reducedMotion();
	el.animate(
		[
			{
				transform: `translate(${x}px, ${at.y - h / 2}px) scale(0.3)`,
				opacity: 0,
			},
			{
				transform: `translate(${x}px, ${top - 16}px) scale(1.12)`,
				opacity: 1,
				offset: 0.5,
			},
			{ transform: `translate(${x}px, ${top}px) scale(1)`, opacity: 1 },
		],
		{
			duration: fast ? 1 : 420,
			easing: "cubic-bezier(.3,1.4,.5,1)",
			fill: "forwards",
		},
	);
	const line = pick([
		"You found me!",
		"Aw, shucks!",
		"Darn, my best spot!",
		"No fair, you peeked!",
		"How did you see me?",
	]);
	later(0.35, () => quip(line, { x: at.x, y: top - 4 }, 1.3));
	later(1.2, () => {
		const fly = el.animate(
			[
				{ transform: `translate(${x}px, ${top}px) scale(1)`, opacity: 1 },
				{
					transform: `translate(${head.left + head.width / 2 - w / 2}px, ${head.top + head.height / 2 - h / 2}px) scale(0.18)`,
					opacity: 0.6,
				},
			],
			{
				duration: fast ? 1 : 520,
				easing: "cubic-bezier(.5,0,.6,1)",
				fill: "forwards",
			},
		);
		fly.finished.then(
			() => {
				el.remove();
				heads[slot].classList.remove("pop");
				void heads[slot].offsetWidth;
				heads[slot].classList.add("pop");
				sfx.pop();
			},
			() => el.remove(),
		);
	});
}

function miss(line: string, at: Vec, el?: HTMLElement) {
	const r = round;
	if (!r) return;
	r.misses += 1;
	sounds.miss();
	popText(`-${MISS_PENALTY}`, { x: at.x, y: at.y - 14 }, true);
	quip(line, { x: at.x, y: at.y - 34 }, 1.4);
	el?.animate(
		[
			{ transform: "rotate(0)" },
			{ transform: "rotate(-10deg)" },
			{ transform: "rotate(10deg)" },
			{ transform: "rotate(0)" },
		],
		{ duration: 300, composite: "add" },
	);
	updateHud();
}

function stray(at: Vec) {
	const r = round;
	const next = strayClick(r.heat, r.elapsed - r.lastStray);
	r.heat = next.heat;
	r.lastStray = r.elapsed;
	if (next.miss)
		miss(
			pick([
				"Easy on the clicking!",
				"Clicking wildly won't help.",
				"Look first, click later!",
			]),
			at,
		);
}

function win() {
	const r = round;
	state = "ending";
	finishRound(points(true), r.elapsed);
	updateHud();
	run(
		(function* (): Script {
			yield* wait(reducedMotion() ? 0.3 : 1.8);
			showClippy({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
			actor.mood = "hover";
			actor.el.animate(
				[
					{ opacity: 0, scale: "0.4" },
					{ opacity: 1, scale: "1" },
				],
				{ duration: 300, easing: "cubic-bezier(.3,1.5,.5,1)" },
			);
			bubble.say(
				pick([
					"You found all three of us!",
					"Ta-da! We give up!",
					"Olly olly oxen free!",
				]),
				1.4,
			);
			sounds.win();
			yield* wait(1.3);
			state = "over";
			const b = actor.el.getBoundingClientRect();
			// Keeps the dialog off Clippy and his speech bubble.
			showResult(true, [
				{ x: b.left, y: b.top - 70, w: b.width, h: b.height + 70 },
			]);
		})(),
	);
}

/** Shows where the unfound Clippies were. Returns the screen rects it marks. */
function reveal(r: Round) {
	const rects: Rect[] = [];
	for (const h of r.hiders) {
		if (h.found) continue;
		h.el.classList.remove("lurk");
		if (h.spot.kind === "slot") {
			const w = r.wins[h.spot.win];
			setShaded(w, false);
			raise(w);
			if (w.scroller) {
				const slot = w.model.slots[h.spot.slot].rect;
				w.scroller.scrollTop = slot.y - w.model.content.h / 2 + slot.h / 2;
			}
		}
		h.el.classList.remove("mood-sleep");
		h.el.classList.add("revealed", "mood-hover");
	}
	for (const h of r.hiders) {
		if (h.found) continue;
		const box = h.el.getBoundingClientRect();
		const at = center(box);
		const size = Math.max(box.width, box.height) + 30;
		const marker = document.createElement("div");
		marker.className = "marker";
		marker.style.cssText = `left:${at.x - size / 2}px;top:${at.y - size / 2}px;width:${size}px;height:${size}px`;
		fx.appendChild(marker);
		quip(
			pick(["Here I was!", "Peekaboo!", "Right here!"]),
			{ x: at.x, y: at.y - size / 2 - 4 },
			60,
		);
		rects.push({
			x: at.x - size / 2,
			y: at.y - size / 2 - 40,
			w: size,
			h: size + 40,
		});
	}
	return rects;
}

function timeUp() {
	const r = round;
	state = "ending";
	r.elapsed = limit;
	finishRound(points(), limit);
	updateHud();
	sounds.timeUp();
	countEl.classList.add("small");
	countEl.textContent = "TIME'S UP!";
	countEl.classList.remove("pop");
	void countEl.offsetWidth;
	countEl.classList.add("pop");
	const marks = reveal(r);
	run(
		(function* (): Script {
			yield* wait(1.6);
			countEl.textContent = "";
			countEl.classList.remove("pop", "small");
			state = "over";
			showResult(false, marks);
		})(),
	);
}

function showResult(won: boolean, avoid: Rect[]) {
	const res = rounds.last;
	const r = round;
	sfx.open();
	showDialog(
		resultsDialog({
			title: won ? "Found Them All" : "Time's Up",
			glyph: won ? "info" : "warn",
			heading: won
				? "You found all three of us!"
				: "Time's up! We were right there.",
			hint: won
				? "Want to play again? I know better spots."
				: "Would you like to try again?",
			result: res,
			stats: [
				["Found", `${r.found} / ${HIDERS}`],
				["Time", `${res.time.toFixed(1)} s`],
				["Misses", r.misses],
				["Hints", r.hints],
				["Best", formatScore(rounds.best)],
			],
		}),
		avoid,
		rounds.reward,
	);
}

function playAgain() {
	dialog.hide();
	state = "intro";
	if (actor.el.hidden)
		showClippy({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
	run(
		(function* (): Script {
			yield* clearPile();
			yield* intro(false);
		})(),
	);
}

function quit() {
	if (state === "leaving") return;
	if (state === "playing" || state === "paused" || state === "countdown") {
		rounds.abandon(points(), round?.elapsed ?? 0);
	}
	const comeOut = actor.el.hidden;
	state = "leaving";
	scripts = [];
	dialog.hide();
	hud.hidden = true;
	countEl.textContent = "";
	blind.classList.remove("on");
	document.body.classList.remove("paused");
	run(
		(function* (): Script {
			yield* clearPile();
			document.body.classList.remove("active");
			if (comeOut) {
				showClippy({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
				actor.mood = "happy";
				bubble.say(
					pick(["Fine, I'll come out.", "Olly olly oxen free!", "Here I am!"]),
					0.8,
				);
				yield* wait(reducedMotion() ? 0.2 : 0.9);
			}
			actor.mood = null;
			yield* flyTo(actor, home, flight(0.6));
			yield* wait(0.15);
			api.exitGame(rounds.last);
		})(),
	);
}

/** Closes a window from the pile. Clippies inside move to new spots, and a cheeky pop-up may appear. */
function closeWindow(w: Win) {
	const r = round;
	if (!r || w.model.closed) return;
	w.model.closed = true;
	if (r.top === w) r.top = null;
	sfx.close();
	const rect = w.model.rect;
	const at = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
	w.el.classList.add("closing");
	w.el
		.animate(
			[
				{
					transform: `translate(${rect.x}px, ${rect.y}px) scale(1)`,
					opacity: 1,
				},
				{
					transform: `translate(${rect.x}px, ${rect.y}px) scale(0.85)`,
					opacity: 0,
				},
			],
			{
				duration: reducedMotion() ? 1 : 150,
				easing: "ease-in",
				fill: "forwards",
			},
		)
		.finished.then(
			() => w.el.remove(),
			() => w.el.remove(),
		);
	if (w.draft.kind === "popup") r.popups -= 1;
	const index = r.wins.indexOf(w);
	r.decoys = r.decoys.filter((d) => d.kind !== "slot" || d.win !== index);
	for (const [i, h] of r.hiders.entries()) {
		if (h.found || h.spot.kind !== "slot" || h.spot.win !== index) continue;
		const taken = [
			...r.hiders.filter((o) => o !== h && !o.found).map((o) => o.spot),
			...r.decoys,
		];
		const [spot] = chooseSpots(
			r.wins.map((x) => x.model),
			area(),
			r.rng,
			{ count: 1, taken },
		);
		if (!spot) continue;
		r.hiders[i] = hiderAt(spot, i, r);
		whoosh();
		quip(
			pick([
				"Hey! I was hiding there!",
				"Whoa! Moving out!",
				"Too close! Bye!",
			]),
			at,
			1.4,
		);
	}
	const depth = w.draft.kind === "popup" ? 1 : 0;
	if (r.popups < 4 && r.rng() < (depth ? 0.3 : 0.35))
		later(0.25, () => {
			if (state === "playing") spawnPopup(depth, at);
		});
}

function spawnPopup(depth: number, near: Vec) {
	const r = round;
	const d = closePopup(r.rng, depth);
	const rect = clampRect(
		{
			x: Math.round(near.x - d.w / 2 + rand(-60, 60)),
			y: Math.round(near.y - d.h / 2 + rand(-40, 40)),
			w: d.w,
			h: d.h,
		},
		area(),
	);
	const el = createWindow(desk, d, rect, r.z + 1);
	const w = measureWindow(el, d, rect, r.z + 1);
	r.wins.push(w);
	r.popups += 1;
	raise(w);
	sounds.popup();
	if (!reducedMotion())
		el.animate(
			[
				{
					transform: `translate(${rect.x}px, ${rect.y}px) scale(0.3)`,
					opacity: 0,
				},
				{
					transform: `translate(${rect.x}px, ${rect.y}px) scale(1)`,
					opacity: 1,
				},
			],
			{ duration: 220, easing: "cubic-bezier(.3,1.4,.5,1)" },
		);
}

function hint() {
	const r = round;
	if (state !== "playing" || hintCooldown > 0 || !r) return;
	const left = r.hiders.filter((h) => !h.found);
	if (!left.length) return;
	r.hints += 1;
	hintCooldown = 4;
	const h = pick(left);
	let box = h.el.getBoundingClientRect();
	if (h.spot.kind === "slot") {
		// A box scrolled out of view hints at the bottom of its window instead.
		const wr = r.wins[h.spot.win].model.rect;
		const at = center(box);
		box = new DOMRect(
			clamp(at.x, wr.x, wr.x + wr.w) - 10,
			clamp(at.y, wr.y, wr.y + wr.h - 20) - 10,
			20,
			20,
		);
	}
	const at = center(box);
	const radius = 95;
	const c = { x: at.x + rand(-40, 40), y: at.y + rand(-40, 40) };
	effect(
		"warm",
		"",
		[
			{ opacity: 0, scale: "0.6" },
			{ opacity: 1, scale: "1", offset: 0.2 },
			{ opacity: 1, scale: "0.92", offset: 0.6 },
			{ opacity: 0, scale: "1" },
		],
		{ duration: 2200, easing: "ease-in-out" },
	).style.cssText =
		`left:${c.x - radius}px;top:${c.y - radius}px;width:${radius * 2}px;height:${radius * 2}px`;
	h.el.classList.remove("wiggle");
	void h.el.offsetWidth;
	h.el.classList.add("wiggle");
	sounds.hint();
	updateHud();
}

/** Shows `spec` where it covers the least of `avoid`. */
function showDialog(
	spec: DialogSpec,
	avoid: Rect[] = [],
	reward?: Promise<GameRoundReward | null>,
) {
	dialog.show(spec, {
		place: (size) => {
			const at = placeDialog(size, view(), avoid);
			return { x: at.x + at.w / 2, y: at.y + at.h / 2 };
		},
		reward,
	});
}

hintBtn.addEventListener("click", hint);

type Press = {
	at: Vec;
	target: Element;
	win: Win | null;
	wasTop: boolean;
	moved: boolean;
};
let press: Press | null = null;
let drag: { win: Win; dx: number; dy: number } | null = null;

desk.addEventListener("pointerdown", (e) => {
	press = null;
	if (state !== "playing" || e.button !== 0 || !(e.target instanceof Element))
		return;
	const r = round;
	const winEl = e.target.closest(".sw");
	const win = winEl ? (r.wins.find((w) => w.el === winEl) ?? null) : null;
	if (win?.model.closed) return;
	const wasTop = !!win && r.top === win;
	if (win) raise(win);
	press = {
		at: { x: e.clientX, y: e.clientY },
		target: e.target,
		win,
		wasTop,
		moved: false,
	};
	if (win && e.target.closest(".titlebar") && !e.target.closest("[data-act]")) {
		drag = {
			win,
			dx: e.clientX - win.model.rect.x,
			dy: e.clientY - win.model.rect.y,
		};
		win.el.classList.add("dragging");
		desk.setPointerCapture(e.pointerId);
		e.preventDefault();
	}
});

window.addEventListener("pointermove", (e) => {
	if (press && Math.hypot(e.clientX - press.at.x, e.clientY - press.at.y) > 5)
		press.moved = true;
	if (drag && state === "playing") {
		const w = drag.win;
		w.model.rect = clampRect(
			{ ...w.model.rect, x: e.clientX - drag.dx, y: e.clientY - drag.dy },
			area(),
		);
		placeWindow(w.el, w.model.rect);
	}
});

window.addEventListener("pointerup", (e) => {
	const p = press;
	press = null;
	if (drag) {
		drag.win.el.classList.remove("dragging");
		drag = null;
	}
	if (!p || p.moved || state !== "playing") return;
	click(p, { x: e.clientX, y: e.clientY });
});

/** Handles a click that did not drag: window buttons, finds, decoys and stray clicks. */
function click(p: Press, at: Vec) {
	const r = round;
	const t = p.target;
	const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
	if (act && p.win) {
		if (act === "close") closeWindow(p.win);
		else if (act === "shade") {
			sounds.shade();
			setShaded(p.win, !p.win.el.classList.contains("shaded"));
		}
		return;
	}
	const hiderEl = t.closest<HTMLElement>(".hider");
	const h = hiderEl && r.hiders.find((x) => x.el === hiderEl);
	if (h && !h.found) {
		findHider(h);
		return;
	}
	const decoyEl = t.closest<HTMLElement>("[data-decoy]");
	if (decoyEl) {
		miss(
			DECOYS[decoyEl.dataset.decoy as DecoyKind]?.line ?? "Nope!",
			at,
			decoyEl,
		);
		return;
	}
	if (t.closest(".titlebar")) return;
	const scroller = t.closest<HTMLElement>(".scroll");
	if (scroller) {
		const box = scroller.getBoundingClientRect();
		if (at.x >= box.left + scroller.clientLeft + scroller.clientWidth) return;
	}
	// Clicking a window to bring it forward is free.
	if (p.win && !p.wasTop) return;
	stray(at);
}

pauseWhenAway(pause);
window.addEventListener("keydown", (e) => {
	if (e.key !== "Escape") return;
	e.preventDefault();
	if (state === "playing" || state === "countdown") pause();
	else if (state === "paused") {
		sfx.select();
		resume();
	} else if (state === "over" || state === "intro") quit();
});

function render(now: number) {
	actor.render();
	if (actor.el.hidden) bubble.hide();
	bubble.update(now, actor);
}

function updateHiders(now: number, dt: number) {
	const r = round;
	if (!r) return;
	for (const h of r.hiders) {
		if (h.found || h.el.classList.contains("lurk")) continue;
		const at = center(h.el.getBoundingClientRect());
		if (Math.hypot(cursor.x - at.x, cursor.y - at.y) < 320)
			h.gaze.lookAt(cursor.x, cursor.y);
		else if (now > h.nextLook) {
			h.gaze.lookDir(rand(-1, 1), rand(-0.6, 0.8));
			h.nextLook = now + rand(1200, 3200);
		}
		h.gaze.tick(dt);
		if (now > h.nextBlink) {
			blink(h.svg, { double: Math.random() < 0.2 });
			h.nextBlink = now + rand(1800, 5200);
		}
	}
}

function frame(dt: number, now: number) {
	if (state === "playing" && round) {
		round.elapsed += dt;
		hintCooldown = Math.max(0, hintCooldown - dt);
		const left = limit - round.elapsed;
		const whole = Math.ceil(left);
		if (left <= 10 && whole !== lastTick && left > 0) {
			lastTick = whole;
			sounds.tick();
		}
		if (left <= 0) timeUp();
		updateHud();
	}
	if (state !== "paused") stepScripts(scripts, dt);
	updateHiders(now, dt);
	actor.update(dt, now, cursor);
	render(now);
}

await loadFont();
render(performance.now());
updateHud();
start(frame, () => run(intro(true)));
