// AI Trivia: Clippy hosts a multiple-choice quiz show in a Win9x window on the
// full-screen overlay. This module owns the page: input, round flow, HUD,
// dialogs and sound. The rules live in trivia.ts.

import type {
	GameInit,
	GameResult,
	GameRoundReward,
} from "../../../shared/types.js";
import { blink, clippyMarkup, createGaze } from "../../common/clippy.js";
import { icon } from "../../common/icons.js";
import {
	$,
	$$,
	api,
	applyPrefs,
	esc,
	reducedMotion,
	sfx,
	tone,
} from "../../common/ui.js";
import {
	clamp,
	pick,
	type Script,
	smooth,
	tween,
	type Vec,
	wait,
} from "../motion.js";
import { formatScore, loadBest, saveBest } from "../score.js";
import { QUESTIONS } from "./questions.js";
import {
	type Award,
	fiftyFifty,
	newRound,
	newTally,
	type Question,
	recordAnswer,
	type Tally,
	TIME_LIMIT,
	TOPIC_LABELS,
} from "./trivia.js";

type State =
	| "intro"
	| "countdown"
	| "asking"
	| "revealed"
	| "paused"
	| "over"
	| "leaving";

const show = $("#show");
const qNum = $("#q-num");
const qTopic = $("#q-topic");
const qText = $("#q-text");
const timerEl = $("#timer");
const timerFill = $("#timer-fill");
const timerSec = $("#timer-sec");
const optEls = $$(".opt") as HTMLButtonElement[];
const foot = $("#foot");
const lifeline = $("#lifeline") as HTMLButtonElement;
const revealEl = $("#reveal");
const verdictEl = $("#verdict");
const factEl = $("#fact");
const nextBtn = $("#next");
const clippyEl = $("#clippy");
const bubble = $("#bubble");
const hud = $("#hud");
const scoreEl = $("#score");
const bestEl = $("#best");
const streakEl = $("#streak");
const countEl = $("#count");
const dialog = $("#dialog");
const root = document.documentElement;

const settings = await api.getSettings();
applyPrefs(settings);
const init: GameInit = (await api.gameInit()) ?? {
	id: "quiz",
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
// Seconds left at which the timer turns red and starts ticking.
const LOW_TIME = 5;
// Width of one block in the timer's progress bar, gap included, in px.
const BLOCK = 12;
// Height of the quiz window until it can be measured, in px.
const WIN_H = 510;
// Answer keys, in option order.
const KEYS = ["1234", "abcd"];

clippyEl.style.width = `${140 * s}px`;
clippyEl.style.height = `${224 * s}px`;
clippyEl.style.transformOrigin = `${ANCHOR.x * s}px ${ANCHOR.y * s}px`;
$(".bob", clippyEl).innerHTML = clippyMarkup({
	uid: "quiz",
	costume: settings.costume,
});
const svg = $("svg", clippyEl);
const gaze = createGaze(svg);

const sounds = {
	beep: () => tone(660, { dur: 0.09, gain: 0.04 }),
	go: () => {
		tone(880, { dur: 0.08, gain: 0.045 });
		tone(1320, { at: 0.08, dur: 0.22, gain: 0.045 });
	},
	tick: () => tone(1800, { dur: 0.03, type: "triangle", gain: 0.03 }),
	right: () => {
		tone(660, { dur: 0.08, type: "triangle", gain: 0.06 });
		tone(880, { at: 0.08, dur: 0.08, type: "triangle", gain: 0.06 });
		tone(1320, { at: 0.16, dur: 0.2, type: "triangle", gain: 0.06 });
	},
	wrong: () => {
		tone(311, { dur: 0.16, type: "sawtooth", gain: 0.035 });
		tone(208, {
			at: 0.16,
			dur: 0.32,
			type: "sawtooth",
			gain: 0.035,
			slide: -40,
		});
	},
	buzz: () => tone(110, { dur: 0.55, type: "square", gain: 0.04 }),
	whoosh: () =>
		tone(1300, { dur: 0.2, type: "triangle", gain: 0.035, slide: -1000 }),
	fanfare: () => {
		for (const [i, f] of [523, 659, 784, 1046].entries())
			tone(f, { at: i * 0.1, dur: i === 3 ? 0.35 : 0.1, gain: 0.045 });
	},
};

/** Clippy in the overlay. `lift` raises him without moving his anchor. */
const actor = {
	x: home.x,
	y: home.y,
	px: home.x,
	vx: 0,
	rot: 0,
	lift: 0,
	lockRot: false,
	mood: null as string | null,
};

/** Tilts Clippy into his horizontal motion, like the Dodge actor. */
function updateActor(dt: number) {
	if (dt > 0) {
		const vx = (actor.x - actor.px) / dt;
		actor.vx += (vx - actor.vx) * smooth(12, dt);
	}
	actor.px = actor.x;
	if (!actor.lockRot) {
		const target = clamp(actor.vx * 0.0005, -0.4, 0.4);
		actor.rot += (target - actor.rot) * smooth(10, dt);
	}
}

// Stage layout in overlay px, updated by `layout()`.
let host: Vec = { ...home };
let winLeft = 0;
let blockWidth = 0;

/**
 * Centres the quiz window, leaving room on its left for Clippy's hosting spot
 * and speech bubble. Moves Clippy to the new spot once he has arrived there.
 */
function layout() {
	const w = window.innerWidth;
	const h = window.innerHeight;
	const col = 210 * s;
	const winW = Math.max(320, Math.min(600, w - col - 32));
	const winH = show.offsetHeight || WIN_H;
	const left = Math.max(16, (w - col - winW) / 2);
	// Keeps the window below the HUD.
	const top = Math.max(72, (h - winH) / 2);
	winLeft = left + col;
	show.style.left = `${winLeft}px`;
	show.style.top = `${top}px`;
	show.style.width = `${winW}px`;
	host = {
		x: winLeft - 85 * s,
		y: Math.min(h - 100 * s, top + winH * 0.62),
	};
	root.style.setProperty("--stage-x", `${winLeft + winW / 2}px`);
	root.style.setProperty("--stage-y", `${top + winH / 2}px`);
	// A hidden window has no width to measure, so this estimates it from the
	// window width minus the seconds counter and paddings.
	const well = $(".timer-well", show);
	blockWidth = well.clientWidth ? well.clientWidth - 4 : winW - 80;
	if (state !== "intro" && state !== "leaving") {
		actor.x = host.x;
		actor.y = host.y;
	}
}

let bubbleUntil = 0;
let bubbleSize = { w: 0, h: 0 };
function say(text: string, seconds = 1.6) {
	bubble.textContent = text;
	bubble.classList.add("show");
	bubbleSize = { w: bubble.offsetWidth, h: bubble.offsetHeight };
	bubbleUntil = performance.now() + (seconds + text.length * 0.03) * 1000;
}

let state: State = "intro";
let pausedFrom: State = "asking";
let scripts: Script[] = [];
let round: Question[] = [];
let qi = 0;
let removed: number[] = [];
let lifelineUsed = false;
let tally: Tally = newTally();
let timeLeft = TIME_LIMIT;
let lastTick = TIME_LIMIT;
// Seconds spent on questions this round, excluding pauses.
let roundTime = 0;
let reported = false;
// Whether the card shows a question rather than the "Get ready" placeholder.
let questionShown = false;
let best = loadBest("quiz");
let lastResult: GameResult | null = null;
// Credits for the last finished round, resolved by the main process.
let reward: Promise<GameRoundReward | null> = Promise.resolve(null);

const current = () => round[qi];

/** Reports a round so its score turns into credits. Runs at most once per round. */
function endRound(result: GameResult) {
	if (reported) return;
	reported = true;
	lastResult = result;
	reward = api.gameRound(result).catch(() => null);
}

function run(script: Script) {
	scripts.push(script);
}

const flight = (seconds: number) => (reducedMotion() ? 0.01 : seconds);

function* flyTo(to: Vec, seconds: number): Script {
	const from = { x: actor.x, y: actor.y };
	yield* tween(seconds, (k) => {
		actor.x = from.x + (to.x - from.x) * k;
		actor.y = from.y + (to.y - from.y) * k;
	});
}

function* hop(): Script {
	if (reducedMotion()) return;
	yield* tween(
		0.42,
		(k) => {
			actor.lift = Math.sin(k * Math.PI) * 24 * s;
		},
		(t) => t,
	);
	actor.lift = 0;
}

function* shake(): Script {
	if (reducedMotion()) return;
	actor.lockRot = true;
	yield* tween(
		0.5,
		(k) => {
			actor.rot = Math.sin(k * Math.PI * 4) * 0.14 * (1 - k);
		},
		(t) => t,
	);
	actor.rot = 0;
	actor.lockRot = false;
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

function openWindow() {
	if (!show.hidden) return;
	show.hidden = false;
	show.classList.remove("entered", "leaving");
	void show.offsetWidth;
	show.classList.add("entered");
	layout();
	sfx.open();
}

function closeWindow() {
	if (show.hidden) return;
	show.classList.remove("entered");
	show.classList.add("leaving");
	setTimeout(
		() => {
			if (show.classList.contains("leaving")) show.hidden = true;
		},
		reducedMotion() ? 0 : 200,
	);
}

function updateHud() {
	scoreEl.textContent = formatScore(tally.score);
	bestEl.textContent = formatScore(Math.max(best, tally.score));
	streakEl.textContent = `×${tally.streak}`;
}

/** Shows the empty question card before the first question. */
function renderStandby() {
	qNum.textContent = `Question 1 of ${round.length}`;
	qTopic.textContent = "Get ready";
	qTopic.dataset.topic = "";
	qText.textContent = "Get ready…";
	for (const el of optEls) {
		el.className = "opt";
		el.disabled = true;
		$(".opt-text", el).textContent = "";
		$(".opt-mark", el).innerHTML = "";
	}
	lifeline.disabled = lifelineUsed;
	foot.hidden = false;
	revealEl.hidden = true;
	timeLeft = TIME_LIMIT;
	questionShown = false;
}

function renderQuestion() {
	const q = current();
	qNum.textContent = `Question ${qi + 1} of ${round.length}`;
	qTopic.textContent = TOPIC_LABELS[q.topic];
	qTopic.dataset.topic = q.topic;
	qText.textContent = q.q;
	optEls.forEach((el, i) => {
		el.className = "opt";
		el.disabled = false;
		$(".opt-text", el).textContent = q.options[i];
		$(".opt-mark", el).innerHTML = "";
	});
	lifeline.disabled = lifelineUsed;
	foot.hidden = false;
	revealEl.hidden = true;
	questionShown = true;
	show.classList.remove("fresh");
	void show.offsetWidth;
	show.classList.add("fresh");
}

function renderReveal(choice: number | null, award: Award) {
	const q = current();
	optEls.forEach((el, i) => {
		el.disabled = true;
		const right = i === q.answer;
		const wrong = i === choice && !right;
		el.classList.toggle("right", right);
		el.classList.toggle("wrong", wrong);
		el.classList.toggle("faded", !right && !wrong);
		$(".opt-mark", el).innerHTML = right
			? icon("check", 20)
			: wrong
				? '<span class="x-glyph"></span>'
				: "";
	});
	const letter = "ABCD"[q.answer];
	if (award.total > 0) {
		const parts = [`${award.base}`];
		if (award.speed) parts.push(`${award.speed} speed`);
		if (award.streak) parts.push(`${award.streak} streak`);
		verdictEl.className = "verdict px good";
		verdictEl.innerHTML = `Correct! <b>+${award.total}</b> <span class="award">${esc(parts.join(" + "))}</span>`;
	} else {
		verdictEl.className = "verdict px bad";
		verdictEl.innerHTML = `${choice === null ? "Time's up!" : "Wrong!"} <span class="award">The answer is ${letter}.</span>`;
	}
	factEl.innerHTML = `<b>Did you know?</b> ${esc(q.fact)}`;
	nextBtn.textContent = qi === round.length - 1 ? "See results" : "Next";
	foot.hidden = true;
	revealEl.hidden = false;
	nextBtn.focus();
}

/** Floats the points just won up from the chosen option. */
function popPoints(choice: number, points: number) {
	const el = optEls[choice];
	const pop = document.createElement("span");
	pop.className = "pts px";
	pop.textContent = `+${points}`;
	pop.style.left = `${el.offsetLeft + el.offsetWidth / 2}px`;
	pop.style.top = `${el.offsetTop - 6}px`;
	$(".win-body", show).append(pop);
	pop.addEventListener("animationend", () => pop.remove());
	setTimeout(() => pop.remove(), 1500);
}

function askLine() {
	const q = current();
	if (qi === round.length - 1) return "Final question!";
	if (q.topic === "clippy")
		return pick(["Ooh, this one's about me!", "A question about yours truly!"]);
	if (qi === 0)
		return pick(["First question!", "Let's start easy.", "Here we go!"]);
	if (qi === Math.floor(round.length / 2)) return "Halfway there!";
	return pick([
		`Question ${qi + 1}!`,
		"Next up!",
		"Ooh, I love this one.",
		"Think fast!",
		"No peeking at the Help file!",
		"This one's tricky.",
		"You've got this.",
	]);
}

function startRound(first: boolean) {
	round = newRound(QUESTIONS);
	qi = 0;
	tally = newTally();
	lifelineUsed = false;
	roundTime = 0;
	reported = false;
	updateHud();
	run(intro(first));
}

function* intro(first: boolean): Script {
	state = "intro";
	document.body.classList.add("active");
	actor.mood = "happy";
	if (first) {
		say("It looks like you want to test your AI smarts!", 1.2);
		yield* wait(0.6);
		yield* flyTo(host, flight(0.9));
	} else {
		say(
			pick(["Round two!", "Back for more?", "Fresh questions, coming up!"]),
			0.8,
		);
	}
	renderStandby();
	openWindow();
	hud.hidden = false;
	if (first)
		say(
			`Welcome to AI Trivia! ${round.length} questions, ${TIME_LIMIT} seconds each.`,
			1.4,
		);
	yield* wait(first ? 1.4 : 0.4);
	state = "countdown";
	yield* countdown(["3", "2", "1", "GO!"], 0.5);
	ask();
}

function ask() {
	removed = [];
	timeLeft = TIME_LIMIT;
	lastTick = Math.ceil(TIME_LIMIT);
	state = "asking";
	renderQuestion();
	if (document.activeElement instanceof HTMLElement)
		document.activeElement.blur();
	actor.mood = "thinking";
	say(askLine(), 1);
	sfx.pop();
}

function choose(i: number) {
	if (state !== "asking" || removed.includes(i) || !optEls[i]) return;
	answer(i);
}

/** Locks in `choice`, or a timeout when it is null, and reveals the answer. */
function answer(choice: number | null) {
	if (state !== "asking") return;
	state = "revealed";
	const q = current();
	const correct = choice === q.answer;
	const result = recordAnswer(tally, correct, timeLeft);
	tally = result.tally;
	renderReveal(choice, result.award);
	updateHud();
	if (correct) {
		sounds.right();
		popPoints(choice, result.award.total);
		actor.mood = "happy";
		run(hop());
		say(
			tally.streak >= 3
				? pick([
						`${tally.streak} in a row! Are you secretly a robot?`,
						`That's ${tally.streak} straight! Big brain energy.`,
					])
				: pick([
						"Correct!",
						"Nailed it!",
						"You've been reading the manual!",
						"Exactly right!",
						"Ding ding ding!",
					]),
			1.2,
		);
	} else if (choice === null) {
		sounds.buzz();
		actor.mood = "smug";
		run(shake());
		say(
			pick([
				"Time's up!",
				"Tick tock! Too slow.",
				"It looks like you ran out of time!",
			]),
			1.2,
		);
	} else {
		sounds.wrong();
		const smug = Math.random() < 0.5;
		actor.mood = smug ? "smug" : "sad";
		run(shake());
		say(
			smug
				? pick([
						"Nope! It looks like you guessed.",
						"Not quite! I knew that one.",
						"Wrong! Would you like to open Help?",
					])
				: pick([
						"Aw, so close!",
						"Oof. I believed in you.",
						"Don't worry, I won't tell anyone.",
					]),
			1.2,
		);
	}
}

function useLifeline() {
	if (state !== "asking" || lifelineUsed) return;
	lifelineUsed = true;
	removed = fiftyFifty(current());
	for (const i of removed) {
		optEls[i].disabled = true;
		optEls[i].classList.add("removed");
	}
	lifeline.disabled = true;
	sounds.whoosh();
	say(
		pick([
			"Poof! Two wrong answers, gone.",
			"Two down, two to go!",
			"Fine, I'll help. Just this once.",
		]),
		1,
	);
}

function next() {
	if (state !== "revealed") return;
	sfx.select();
	qi += 1;
	if (qi >= round.length) finish();
	else ask();
}

function finish() {
	state = "over";
	const score = tally.score;
	const record = saveBest("quiz", score);
	best = loadBest("quiz");
	endRound({ score, time: roundTime, record });
	updateHud();
	const g = grade(tally.correct / round.length);
	actor.mood = g.mood;
	if (g.mood === "happy") run(hop());
	say(g.line, 2);
	sounds.fanfare();
	show.classList.add("dimmed");
	showGameOver(g);
}

type Grade = {
	title: string;
	sub: string;
	/** Clippy's line in the speech bubble. */
	line: string;
	mood: string;
	glyph: "info" | "ask";
};

/** Clippy's verdict on a round, from the share of right answers. */
function grade(ratio: number): Grade {
	if (ratio === 1)
		return {
			title: "A perfect round!",
			sub: "Are you secretly an AI?",
			line: "A perfect score! Are you secretly an AI?",
			mood: "happy",
			glyph: "info",
		};
	if (ratio >= 0.7)
		return {
			title: "Impressive!",
			sub: "You really know your AI.",
			line: "Impressive! You really know your AI.",
			mood: "happy",
			glyph: "info",
		};
	if (ratio >= 0.4)
		return {
			title: "Not bad!",
			sub: "Would you like to try again?",
			line: "Not bad! I'd give you a B-minus.",
			mood: "thinking",
			glyph: "ask",
		};
	return {
		title: "Time for a refresher!",
		sub: "Would you like to try again?",
		line: "It looks like you need a refresher!",
		mood: "smug",
		glyph: "ask",
	};
}

function showGameOver(g: Grade) {
	const r = lastResult;
	showDialog({
		title: "Results",
		body: `
      <div class="dlg-head">
        <span class="fw-icon ${g.glyph}"></span>
        <div>
          <p class="dlg-title px">${esc(g.title)}</p>
          <p class="hint">${esc(g.sub)}</p>
        </div>
      </div>
      <div class="go-score">
        <span class="label">Score</span>
        <b class="px">${formatScore(r.score)}</b>
        ${r.record ? '<span class="go-new px">NEW BEST!</span>' : ""}
      </div>
      <dl class="go-stats">
        <dt>Correct answers</dt><dd class="px">${tally.correct} / ${round.length}</dd>
        <dt>Best streak</dt><dd class="px">${tally.bestStreak}</dd>
        <dt>Time</dt><dd class="px">${Math.round(r.time)} s</dd>
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
	if (state !== "over") return;
	hideDialog();
	show.classList.remove("dimmed");
	startRound(false);
}

function pause() {
	if (state !== "asking" && state !== "countdown" && state !== "revealed")
		return;
	pausedFrom = state;
	state = "paused";
	countEl.hidden = true;
	sfx.close();
	showDialog({
		title: "Paused",
		body: `
      <div class="dlg-head">
        <span class="fw-icon ask"></span>
        <div>
          <p class="dlg-title px">Taking a break?</p>
          <p class="hint">The clock is stopped. No peeking at the question!</p>
        </div>
      </div>`,
		buttons: [
			{ label: "Resume", act: "resume", primary: true },
			{ label: "Quit", act: "quit" },
		],
		onClose: "resume",
	});
}

function resume() {
	if (state !== "paused") return;
	hideDialog();
	countEl.hidden = false;
	if (pausedFrom !== "asking") {
		state = pausedFrom;
		if (state === "revealed") nextBtn.focus();
		return;
	}
	state = "countdown";
	run(
		(function* (): Script {
			yield* countdown(["READY", "GO!"], 0.45);
			state = "asking";
		})(),
	);
}

function quit() {
	if (state === "leaving") return;
	const score = tally.score;
	if (!reported && score > 0)
		endRound({ score, time: roundTime, record: saveBest("quiz", score) });
	state = "leaving";
	scripts = [];
	hideDialog();
	closeWindow();
	hud.hidden = true;
	countEl.textContent = "";
	bubble.classList.remove("show");
	document.body.classList.remove("active");
	actor.mood = null;
	actor.lift = 0;
	actor.lockRot = false;
	run(
		(function* (): Script {
			yield* flyTo(home, flight(0.6));
			actor.rot = 0;
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

document.addEventListener("click", (e) => {
	const target = e.target;
	if (!(target instanceof Element)) return;
	const opt = target.closest<HTMLElement>("[data-opt]");
	if (opt) {
		choose(Number(opt.dataset.opt));
		return;
	}
	const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
	if (!act) return;
	if (act === "pause") pause();
	else if (act === "next") next();
	else if (act === "lifeline") useLifeline();
	else {
		sfx.select();
		if (act === "resume") resume();
		else if (act === "again") playAgain();
		else if (act === "quit") quit();
	}
});

window.addEventListener("pointermove", (e) => {
	cursor.x = e.clientX;
	cursor.y = e.clientY;
});
window.addEventListener("blur", pause);
window.addEventListener("resize", layout);
window.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		e.preventDefault();
		if (state === "asking" || state === "countdown" || state === "revealed")
			pause();
		else if (state === "paused") {
			sfx.select();
			resume();
		} else if (state === "over" || state === "intro") quit();
		return;
	}
	if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
	const key = e.key.toLowerCase();
	if (state === "asking") {
		for (const keys of KEYS) {
			const i = keys.indexOf(key);
			if (i < 0 || key.length !== 1) continue;
			e.preventDefault();
			choose(i);
			return;
		}
	} else if (state === "revealed" && (e.key === "Enter" || e.key === " ")) {
		// Also stops the focused Next button from firing its own click.
		e.preventDefault();
		next();
	}
});

let clippyClass = "";
function render(now: number) {
	clippyEl.style.transform = `translate(${(actor.x - ANCHOR.x * s).toFixed(1)}px, ${(actor.y - actor.lift - ANCHOR.y * s).toFixed(1)}px) rotate(${actor.rot.toFixed(3)}rad)`;
	const cls = `mood-${actor.mood || "idle"}`;
	if (cls !== clippyClass) {
		clippyClass = cls;
		clippyEl.className = cls;
	}

	if (now > bubbleUntil) bubble.classList.remove("show");
	if (bubble.classList.contains("show")) {
		const cx = actor.x;
		// Keeps the bubble clear of the quiz window while it is open.
		const right = show.hidden ? window.innerWidth - 8 : winLeft - 12;
		const bx = clamp(
			cx - bubbleSize.w / 2,
			8,
			Math.max(8, right - bubbleSize.w),
		);
		let by = actor.y - actor.lift - 138 * s - bubbleSize.h;
		const below = by < 8;
		if (below) by = actor.y - actor.lift + 110 * s;
		bubble.classList.toggle("below", below);
		bubble.style.setProperty(
			"--tail",
			`${clamp(cx - bx, 16, bubbleSize.w - 16).toFixed(0)}px`,
		);
		bubble.style.transform = `translate(${bx.toFixed(0)}px, ${by.toFixed(0)}px)`;
	}

	// Hides the question while the clock is stopped.
	show.classList.toggle(
		"standby",
		questionShown && (state === "countdown" || state === "paused"),
	);
	const k = clamp(timeLeft / TIME_LIMIT, 0, 1);
	const blocks = Math.ceil((k * blockWidth) / BLOCK);
	timerFill.style.width = `${Math.min(blockWidth, blocks * BLOCK)}px`;
	timerSec.textContent = `${Math.ceil(timeLeft)}`;
	timerEl.classList.toggle("low", state === "asking" && timeLeft <= LOW_TIME);
}

function updateTimer(dt: number) {
	if (state === "asking" || state === "revealed") roundTime += dt;
	if (state !== "asking") return;
	timeLeft = Math.max(0, timeLeft - dt);
	const sec = Math.ceil(timeLeft);
	if (sec < lastTick) {
		lastTick = sec;
		if (sec > 0 && sec <= LOW_TIME) sounds.tick();
	}
	if (timeLeft <= 0) answer(null);
}

let last = performance.now();
let nextBlink = last + 2500;
function frame(now: number) {
	const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
	last = now;
	if (state !== "paused") {
		for (let i = 0; i < scripts.length; i++) {
			if (scripts[i].next(dt).done) {
				scripts.splice(i, 1);
				i -= 1;
			}
		}
		updateTimer(dt);
	}
	updateActor(dt);
	gaze.lookAt(cursor.x, cursor.y);
	gaze.tick(dt);
	if (now > nextBlink) {
		if (actor.mood !== "happy") blink(svg);
		nextBlink = now + 2000 + Math.random() * 3500;
	}
	render(now);
	requestAnimationFrame(frame);
}

try {
	await document.fonts.load('16px "Pixelify Sans"');
} catch {
	/* text falls back to Tahoma */
}
layout();
updateHud();
render(performance.now());
api.gameReady();
requestAnimationFrame((now) => {
	last = now;
	startRound(true);
	requestAnimationFrame(frame);
});
