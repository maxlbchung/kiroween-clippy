// Dodge: Clippy attacks the mouse cursor across the whole screen. This module
// owns the overlay page: input, game states, HUD, dialogs and sound.

import { $, reducedMotion, sfx, tone } from "../../common/ui.js";
import {
	flyTo,
	pick,
	rand,
	type Script,
	stepScripts,
	type Vec,
	wait,
} from "../motion.js";
import {
	Bubble,
	countdown,
	Dialog,
	flight,
	loadFont,
	mountClippy,
	openOverlay,
	pauseDialog,
	pauseWhenAway,
	poseTransform,
	Rounds,
	resultsDialog,
	start,
	whoosh,
} from "../overlay.js";
import { formatScore } from "../score.js";
import { director } from "./attacks.js";
import { World } from "./engine.js";

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
const hud = $("#hud");
const scoreEl = $("#score");
const bestEl = $("#best");
const countEl = $("#count");
const dim = $("#dim");

const { settings, scale: s, home, cursor } = await openOverlay("dodge");
const face = mountClippy(clippyEl, {
	uid: "dodge",
	costume: settings.costume,
	scale: s,
});
const bubble = new Bubble($("#bubble"), s);
const dialog = new Dialog($("#dialog"), (act) => {
	if (act === "resume") resume();
	else if (act === "again") playAgain();
	else if (act === "quit") quit();
});
const rounds = new Rounds("dodge");

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
	whoosh,
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
	hit: () => {
		tone(330, { dur: 0.12, gain: 0.06, slide: -200 });
		tone(80, { at: 0.06, dur: 0.45, type: "triangle", gain: 0.1, slide: -30 });
	},
};

function makeWorld(at: Vec) {
	return new World({
		w: window.innerWidth,
		h: window.innerHeight,
		scale: s,
		dpr: window.devicePixelRatio || 1,
		hooks: {
			say: (text, seconds) => bubble.say(text, seconds),
			sound: (name, arg) => sounds[name]?.(arg),
		},
		winLayer,
		cursor,
		clippyAt: at,
	});
}

let world = makeWorld(home);
let state: State = "intro";
let scripts: Script[] = [];
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
	clippyEl.style.transform = poseTransform(c, s);
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

	if (world.offscreen(c.x, c.y, -20)) bubble.hide();
	bubble.update(now, c, world.w - 8);

	const shake = reducedMotion() ? 0 : world.shake;
	worldEl.style.transform = shake
		? `translate(${rand(-shake, shake).toFixed(1)}px, ${rand(-shake, shake).toFixed(1)}px)`
		: "";

	const score = world.score;
	if (score !== shownScore) {
		shownScore = score;
		scoreEl.textContent = formatScore(score);
		bestEl.textContent = formatScore(Math.max(rounds.best, score));
	}
	world.draw(back, front);
}

function run(script: Script) {
	scripts.push(script);
}

function* intro(first: boolean): Script {
	state = "intro";
	rounds.begin();
	document.body.classList.add("active");
	const c = world.clippy;
	c.mood = "happy";
	if (first) bubble.say("It looks like you want to play a game.", 1.4);
	else bubble.say(pick(["Again? Gladly.", "Round two!", "Back for more?"]), 1);
	yield* wait(first ? 0.6 : 0.2);
	yield* flyTo(c, world.pickSpot(380), flight(0.8));
	c.mood = "angry";
	hud.hidden = false;
	state = "countdown";
	yield* countdown(countEl, ["3", "2", "1", "DODGE!"], 0.55);
	state = "playing";
	startAttacks();
}

function resume() {
	dialog.hide();
	state = "countdown";
	run(
		(function* (): Script {
			yield* countdown(countEl, ["READY", "GO!"], 0.5);
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
	dialog.show(
		pauseDialog("Taking a break?", "Clippy will wait. Patiently. Menacingly."),
	);
}

function gameOver(at: Vec) {
	state = "dying";
	rounds.report(world.score, world.time);
	const c = world.clippy;
	c.mood = "happy";
	world.ring(at.x, at.y, "#ffffff", 6, 160);
	world.ring(at.x, at.y, "#e5484d", 14, 260);
	world.text("OUCH!", cursor.x, cursor.y - 26, "#ff6b6b", 28);
	world.shake = 16;
	sounds.hit();
	bubble.say(pick(["Gotcha!", "It looks like you got hit!", "Bonk!"]), 1.4);
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
				yield* flyTo(c, world.pickSpot(200), flight(0.6));
			yield* wait(0.75);
			state = "over";
			showGameOver();
		})(),
	);
}

function showGameOver() {
	const r = rounds.last;
	sfx.open();
	dialog.show(
		resultsDialog({
			title: "Game Over",
			glyph: "err",
			heading: "It looks like you got hit!",
			hint: "Would you like to try again?",
			result: r,
			stats: [
				["Time survived", `${r.time.toFixed(1)} s`],
				["Attacks dodged", world.dodged],
				["Close calls", world.grazes],
				["Best", formatScore(rounds.best)],
			],
		}),
		{ reward: rounds.reward },
	);
}

function playAgain() {
	dialog.hide();
	const c = world.clippy;
	world = makeWorld({ x: c.x, y: c.y });
	started = false;
	fitCanvases();
	shownScore = -1;
	run(intro(false));
}

function quit() {
	if (state === "leaving") return;
	rounds.abandon(world.score, world.time);
	state = "leaving";
	scripts = [];
	dialog.hide();
	hud.hidden = true;
	countEl.textContent = "";
	world.clearHazards();
	document.body.classList.remove("active");
	const c = world.clippy;
	c.mood = null;
	c.lockRot = false;
	run(
		(function* (): Script {
			yield* flyTo(c, home, flight(0.6));
			c.rot = 0;
			yield* wait(0.15);
			rounds.exit((points, r) =>
				r.record
					? [
							`New high score: ${points}! I'll get you next time.`,
							`${points} points, a new record! I demand a rematch.`,
						]
					: [
							`${points} points! Rematch anytime.`,
							`You lasted ${Math.round(r.time)} seconds. Not bad, for a cursor.`,
							`${points} points. I was going easy on you.`,
						],
			);
		})(),
	);
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

function frame(dt: number, now: number) {
	if (state === "playing") {
		world.update(dt);
		const hit = world.collide();
		if (hit) gameOver(hit);
	}
	if (state !== "paused") {
		stepScripts(scripts, dt);
		world.updateEffects(dt);
		world.updateActor(dt);
	}
	face.look(cursor, dt, now, world.clippy.mood);
	render(now);
}

await loadFont();
bestEl.textContent = formatScore(rounds.best);
render(performance.now());
start(frame, () => run(intro(true)));
