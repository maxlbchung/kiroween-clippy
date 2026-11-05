// AI Trivia: Clippy hosts a multiple-choice quiz show in a Win9x window on the
// full-screen overlay. This module owns the page: input, round flow, HUD,
// dialogs and sound. The rules live in trivia.ts.

import { icon } from "../../common/icons.js";
import { $, $$, esc, reducedMotion, sfx, tone } from "../../common/ui.js";
import {
	clamp,
	flyTo,
	pick,
	type Script,
	stepScripts,
	tween,
	type Vec,
	wait,
} from "../motion.js";
import {
	Actor,
	Bubble,
	countdown,
	Dialog,
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
const hud = $("#hud");
const scoreEl = $("#score");
const bestEl = $("#best");
const streakEl = $("#streak");
const countEl = $("#count");
const root = document.documentElement;

const { settings, scale: s, home, cursor } = await openOverlay("quiz");
// Seconds left at which the timer turns red and starts ticking.
const LOW_TIME = 5;
// Width of one block in the timer's progress bar, gap included, in px.
const BLOCK = 12;
// Height of the quiz window until it can be measured, in px.
const WIN_H = 510;
// Answer keys, in option order.
const KEYS = ["1234", "abcd"];

const actor = new Actor($("#clippy"), {
	uid: "quiz",
	costume: settings.costume,
	scale: s,
	at: home,
});
const bubble = new Bubble($("#bubble"), s);
const dialog = new Dialog($("#dialog"), (act) => {
	if (act === "resume") resume();
	else if (act === "again") playAgain();
	else if (act === "quit") quit();
});
const rounds = new Rounds("quiz");

const sounds = {
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
	fanfare: () => {
		for (const [i, f] of [523, 659, 784, 1046].entries())
			tone(f, { at: i * 0.1, dur: i === 3 ? 0.35 : 0.1, gain: 0.045 });
	},
};

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
// Whether the card shows a question rather than the "Get ready" placeholder.
let questionShown = false;

const current = () => round[qi];

function run(script: Script) {
	scripts.push(script);
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
	bestEl.textContent = formatScore(Math.max(rounds.best, tally.score));
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
	rounds.begin();
	updateHud();
	run(intro(first));
}

function* intro(first: boolean): Script {
	state = "intro";
	document.body.classList.add("active");
	actor.mood = "happy";
	if (first) {
		bubble.say("It looks like you want to test your AI smarts!", 1.2);
		yield* wait(0.6);
		yield* flyTo(actor, host, flight(0.9));
	} else {
		bubble.say(
			pick(["Round two!", "Back for more?", "Fresh questions, coming up!"]),
			0.8,
		);
	}
	renderStandby();
	openWindow();
	hud.hidden = false;
	if (first)
		bubble.say(
			`Welcome to AI Trivia! ${round.length} questions, ${TIME_LIMIT} seconds each.`,
			1.4,
		);
	yield* wait(first ? 1.4 : 0.4);
	state = "countdown";
	yield* countdown(countEl, ["3", "2", "1", "GO!"], 0.5);
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
	bubble.say(askLine(), 1);
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
		bubble.say(
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
		bubble.say(
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
		bubble.say(
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
	whoosh();
	bubble.say(
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
	rounds.report(tally.score, roundTime);
	updateHud();
	const g = grade(tally.correct / round.length);
	actor.mood = g.mood;
	if (g.mood === "happy") run(hop());
	bubble.say(g.line, 2);
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
	const r = rounds.last;
	dialog.show(
		resultsDialog({
			title: "Results",
			glyph: g.glyph,
			heading: g.title,
			hint: g.sub,
			result: r,
			stats: [
				["Correct answers", `${tally.correct} / ${round.length}`],
				["Best streak", tally.bestStreak],
				["Time", `${Math.round(r.time)} s`],
				["Best", formatScore(rounds.best)],
			],
		}),
		{ reward: rounds.reward },
	);
}

function playAgain() {
	if (state !== "over") return;
	dialog.hide();
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
	dialog.show(
		pauseDialog(
			"Taking a break?",
			"The clock is stopped. No peeking at the question!",
		),
	);
}

function resume() {
	if (state !== "paused") return;
	dialog.hide();
	countEl.hidden = false;
	if (pausedFrom !== "asking") {
		state = pausedFrom;
		if (state === "revealed") nextBtn.focus();
		return;
	}
	state = "countdown";
	run(
		(function* (): Script {
			yield* countdown(countEl, ["READY", "GO!"], 0.45);
			state = "asking";
		})(),
	);
}

function quit() {
	if (state === "leaving") return;
	rounds.abandon(tally.score, roundTime);
	state = "leaving";
	scripts = [];
	dialog.hide();
	closeWindow();
	hud.hidden = true;
	countEl.textContent = "";
	bubble.hide();
	document.body.classList.remove("active");
	actor.mood = null;
	actor.lift = 0;
	actor.lockRot = false;
	run(
		(function* (): Script {
			yield* flyTo(actor, home, flight(0.6));
			actor.rot = 0;
			yield* wait(0.15);
			rounds.exit((points, r) =>
				r.record
					? [
							`New trivia record: ${points} points! Big brain.`,
							`${points} points, a new best! I'll need harder questions.`,
						]
					: [
							`${points} points! You know your AI.`,
							`${Math.round(r.time)} seconds of trivia, ${points} points. Smart cookie.`,
							`${points} points. I'll go easier on the history next time.`,
						],
			);
		})(),
	);
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
});

// Moving the cursor to another display doesn't stop the quiz.
pauseWhenAway(pause, false);
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

function render(now: number) {
	actor.render();
	// Keeps the bubble clear of the quiz window while it is open.
	bubble.update(
		now,
		actor.head,
		show.hidden ? window.innerWidth - 8 : winLeft - 12,
	);

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

function frame(dt: number, now: number) {
	if (state !== "paused") {
		stepScripts(scripts, dt);
		updateTimer(dt);
	}
	actor.update(dt, now, cursor);
	render(now);
}

await loadFont();
layout();
updateHud();
render(performance.now());
start(frame, () => startRound(true));
