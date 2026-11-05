// Clippy Clicker: click the big paper clip to make clips, then spend them on
// laborers and machines that make more. This module owns the overlay page:
// input, the shop, Clippy's comments, credit milestones and saving. The rules
// live in economy.ts.

import { POINTS_PER_CREDIT } from "../../../shared/shop.js";
import { paperclipMarkup } from "../../common/clippy.js";
import { icon } from "../../common/icons.js";
import {
	$,
	api,
	esc,
	reducedMotion,
	setText,
	sfx,
	tone,
} from "../../common/ui.js";
import { flyTo, type Script, stepScripts, type Vec, wait } from "../motion.js";
import {
	Actor,
	Bubble,
	Dialog,
	flight,
	loadFont,
	openOverlay,
	pauseDialog,
	pauseWhenAway,
	start,
} from "../overlay.js";
import { pick, rand } from "../random.js";
import {
	buy,
	CLICK_CLIPS,
	catchUp,
	claimMilestones,
	click,
	costOf,
	formatCount,
	formatRate,
	maxAffordable,
	milestoneAt,
	milestoneCredits,
	ownedOf,
	PRODUCERS,
	type Producer,
	produce,
	rateOf,
	unlocked,
} from "./economy.js";
import { loadFactory, saveFactory } from "./save.js";

type State = "intro" | "playing" | "paused" | "leaving";
type Amount = 1 | 10 | "max";

/** Seconds between autosaves. */
const SAVE_EVERY = 5;
/** Seconds of quiet before Clippy offers a tip. */
const TIP_AFTER = 24;
/** Most icons a crew row shows before summing up the rest. */
const CREW_ICONS = 24;

const stage = $("#stage");
const clipBtn = $("#clip");
const clipsEl = $("#clips");
const floor = $("#floor");
const shop = $("#shop");
const goods = $("#goods");
const goalLabel = $("#goal-label");
const goalReward = $("#goal-reward");
const goalFill = $("#goal-fill");
const walletEl = $("#wallet");
const fx = $("#fx");
const hud = $("#hud");
const madeEl = $("#made");
const rateEl = $("#rate");

const { settings, scale: s, home, cursor } = await openOverlay("clicker");
const finish = settings.costume.finish;
const actor = new Actor($("#clippy"), {
	uid: "clicker",
	costume: settings.costume,
	scale: s,
	at: home,
});
const bubble = new Bubble($("#bubble"), s);
const dialog = new Dialog($("#dialog"), (act) => {
	if (act === "resume") resume();
	else if (act === "quit") quit();
});
clipBtn.innerHTML = paperclipMarkup(finish, "big-clip");

const sounds = {
	click: () =>
		tone(620 + rand(0, 260), { dur: 0.035, type: "triangle", gain: 0.03 }),
	buy: () => {
		tone(988, { dur: 0.06, gain: 0.035 });
		tone(1319, { at: 0.06, dur: 0.12, gain: 0.035 });
	},
	fanfare: () => {
		for (const [i, f] of [523, 659, 784, 1046].entries())
			tone(f, { at: i * 0.1, dur: i === 3 ? 0.35 : 0.1, gain: 0.045 });
	},
};

const factory = loadFactory();
// Production while the game was closed, credited before anything is drawn.
const away = catchUp(factory, Date.now());

let state: State = "intro";
let scripts: Script[] = [];
let amount: Amount = 1;
let credits = settings.wallet.credits;
// This visit: clips made, milestone points reported and seconds played.
let made = 0;
let points = 0;
let playTime = 0;
let saveIn = SAVE_EVERY;
let quietFor = 0;
// Where Clippy stands beside the big clip, and the shop's left edge.
let host: Vec = { ...home };
let shopLeft = window.innerWidth;

type Row = {
	p: Producer;
	btn: HTMLButtonElement;
	owned: HTMLElement;
	label: HTMLElement;
	price: HTMLElement;
};
let rows: Row[] = [];
let goalShown = -1;

function run(script: Script) {
	scripts.push(script);
}

function say(text: string, seconds = 1.6) {
	bubble.say(text, seconds);
	quietFor = 0;
}

const center = (el: Element): Vec => {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Puts Clippy's spot left of the big clip and keeps his bubble off the shop. */
function layout() {
	const r = clipBtn.getBoundingClientRect();
	host = { x: Math.max(70 * s, r.left - 70 * s), y: r.top + r.height * 0.62 };
	shopLeft = shop.hidden
		? window.innerWidth
		: shop.getBoundingClientRect().left;
	if (state === "playing" || state === "paused") {
		actor.x = host.x;
		actor.y = host.y;
	}
}

const shownCount = () => PRODUCERS.filter((p) => unlocked(factory, p)).length;

function renderShop() {
	const shown = PRODUCERS.filter((p) => unlocked(factory, p));
	const next = PRODUCERS.find((p) => !unlocked(factory, p));
	goods.innerHTML =
		shown
			.map(
				(p) => `
      <li class="good" data-id="${esc(p.id)}">
        <img src="art/${esc(p.id)}.svg" alt="">
        <div class="good-text">
          <b class="good-name px">${esc(p.name)}<small data-owned></small></b>
          <span class="good-blurb">${esc(p.blurb)}</span>
          <span class="good-rate">+${formatRate(p.rate)} clips/s each</span>
        </div>
        <button type="button" class="btn good-buy" data-buy="${esc(p.id)}"><span data-label></span><span class="price" data-price></span></button>
      </li>`,
			)
			.join("") +
		(next
			? `
      <li class="good locked">
        <img src="art/${esc(next.id)}.svg" alt="">
        <div class="good-text">
          <b class="good-name px">???</b>
          <span class="good-blurb">Make ${formatCount(next.unlockAt)} clips to unlock.</span>
        </div>
      </li>`
			: "");
	rows = shown.map((p) => {
		const li = $(`[data-id="${p.id}"]`, goods);
		return {
			p,
			btn: $("[data-buy]", li) as HTMLButtonElement,
			owned: $("[data-owned]", li),
			label: $("[data-label]", li),
			price: $("[data-price]", li),
		};
	});
	updateShop();
}

/** How many of `p` the Buy button buys at the chosen amount. */
function batch(p: Producer) {
	return amount === "max" ? Math.max(1, maxAffordable(factory, p)) : amount;
}

function updateShop() {
	for (const r of rows) {
		const owned = ownedOf(factory, r.p);
		const n = batch(r.p);
		const price = costOf(r.p, owned, n);
		setText(r.owned, owned ? ` ×${owned}` : "");
		setText(r.label, n === 1 ? "Buy" : `Buy ${n}`);
		setText(r.price, `${formatCount(price)} clips`);
		const short = price > factory.clips;
		if (r.btn.disabled !== short) r.btn.disabled = short;
	}
	const k = factory.milestones;
	const from = k ? milestoneAt(k - 1) : 0;
	const progress = Math.min(
		1,
		(factory.total - from) / (milestoneAt(k) - from),
	);
	if (k !== goalShown) {
		goalShown = k;
		goalLabel.textContent = `Bonus at ${formatCount(milestoneAt(k))} made`;
		goalReward.textContent = `+${milestoneCredits(k)} credits`;
	}
	goalFill.style.transform = `scaleX(${progress.toFixed(3)})`;
}

function renderWallet() {
	walletEl.innerHTML = `${icon("coin", 16)}${credits} credits`;
}

/** Shows each owned producer kind as a row of busy little icons. */
function renderFloor() {
	floor.innerHTML = PRODUCERS.filter((p) => ownedOf(factory, p) > 0)
		.map((p) => {
			const n = ownedOf(factory, p);
			const icons = Math.min(n, CREW_ICONS);
			return `
      <div class="crew" data-id="${esc(p.id)}">
        <div class="crew-icons">${Array.from({ length: icons }, (_, i) => `<img src="art/${esc(p.id)}.svg" alt="" style="--i:${i}">`).join("")}</div>
        ${n > icons ? `<span class="crew-more px">+${formatCount(n - icons)}</span>` : ""}
      </div>`;
		})
		.join("");
}

/** Floats `text` up from `at` and fades it out. */
function floatText(text: string, at: Vec, big = false) {
	if (reducedMotion()) return;
	const el = document.createElement("div");
	el.className = big ? "plus big" : "plus";
	el.textContent = text;
	fx.appendChild(el);
	const x = at.x - el.offsetWidth / 2;
	const y = at.y - el.offsetHeight / 2;
	el.animate(
		[
			{ transform: `translate(${x}px, ${y}px)`, opacity: 1 },
			{ transform: `translate(${x}px, ${y - (big ? 90 : 60)}px)`, opacity: 0 },
		],
		{ duration: big ? 1600 : 800, easing: "ease-out", fill: "forwards" },
	).finished.then(() => el.remove());
}

/** Tosses a tiny clip out of the big one. */
function tossClip(at: Vec) {
	if (reducedMotion()) return;
	const el = document.createElement("div");
	el.className = "bit";
	el.innerHTML = paperclipMarkup(finish);
	fx.appendChild(el);
	const dx = rand(-140, 140);
	const turn = rand(-540, 540);
	el.animate(
		[
			{ transform: `translate(${at.x}px, ${at.y}px) rotate(0deg)`, opacity: 1 },
			{
				transform: `translate(${at.x + dx * 0.6}px, ${at.y - rand(60, 120)}px) rotate(${turn * 0.6}deg)`,
				opacity: 1,
				offset: 0.45,
			},
			{
				transform: `translate(${at.x + dx}px, ${at.y + 120}px) rotate(${turn}deg)`,
				opacity: 0,
			},
		],
		{ duration: 700, easing: "ease-in", fill: "forwards" },
	).finished.then(() => el.remove());
}

function makeClip(at: Vec) {
	if (state !== "playing") return;
	click(factory);
	made += CLICK_CLIPS;
	sounds.click();
	if (reducedMotion()) return;
	clipBtn.animate(
		[{ transform: "scale(0.93) rotate(2deg)" }, { transform: "none" }],
		{ duration: 140, easing: "ease-out" },
	);
	floatText(`+${CLICK_CLIPS}`, at);
	tossClip(at);
}

clipBtn.addEventListener("click", (e) => {
	// Keyboard clicks have no pointer position.
	makeClip(e.detail ? { x: e.clientX, y: e.clientY } : center(clipBtn));
});

const FIRST_LINES: Record<string, string> = {
	laborer: "Your first laborer! They work for clips. Literally.",
	machine: "A clip machine! It never takes a coffee break.",
};

shop.addEventListener("click", (e) => {
	const target = e.target;
	if (!(target instanceof Element) || state !== "playing") return;
	if (target.closest('[data-act="pause"]')) {
		pause();
		return;
	}
	const amt = target.closest<HTMLElement>("[data-amount]");
	if (amt) {
		const v = amt.dataset.amount;
		amount = v === "max" ? "max" : v === "10" ? 10 : 1;
		for (const b of shop.querySelectorAll("[data-amount]"))
			b.classList.toggle("is-pressed", b === amt);
		sfx.select();
		updateShop();
		return;
	}
	const p = PRODUCERS.find(
		(x) => x.id === target.closest<HTMLElement>("[data-buy]")?.dataset.buy,
	);
	if (!p) return;
	const first = ownedOf(factory, p) === 0;
	if (!buy(factory, p, batch(p))) {
		sfx.error();
		return;
	}
	sounds.buy();
	renderFloor();
	updateShop();
	if (first) {
		actor.mood = "happy";
		say(FIRST_LINES[p.id] ?? `Your first ${p.name.toLowerCase()}!`, 1.8);
	} else if (Math.random() < 0.2) {
		actor.mood = "happy";
		say(
			pick([
				"It looks like you're building a paperclip empire!",
				"More hands, more clips!",
				"Production is up! I'll update the spreadsheet.",
			]),
			1.4,
		);
	}
});

/** Pays out the milestones in `ks` together: credits from the main process and a cheer. */
function reward(ks: number[]) {
	const earned = ks.reduce((sum, k) => sum + milestoneCredits(k), 0);
	const score = earned * POINTS_PER_CREDIT;
	points += score;
	api
		.gameRound({ score, time: Math.round(playTime), record: false })
		.then((r) => {
			credits = r.credits;
			renderWallet();
		})
		.catch(() => {});
	actor.mood = "happy";
	say(
		`${formatCount(milestoneAt(ks[ks.length - 1]))} paperclips! Here's ${earned} credits for the Wardrobe.`,
		2.2,
	);
	sounds.fanfare();
	floatText(`+${earned} credits`, actor.head, true);
	saveFactory(factory);
}

function tip() {
	const affordable = PRODUCERS.filter((p) => unlocked(factory, p)).find(
		(p) => costOf(p, ownedOf(factory, p)) <= factory.clips,
	);
	actor.mood = null;
	say(
		affordable
			? `Psst! You can afford a ${affordable.name.toLowerCase()}.`
			: pick([
					"Have you tried clicking faster? Asking for a friend.",
					"Paper clips: holding civilization together since forever.",
					"It looks like you're clicking. Would you like help with that?",
					"Every great empire starts with one bent wire.",
				]),
		1.8,
	);
}

function* intro(): Script {
	state = "intro";
	document.body.classList.add("active");
	actor.mood = "happy";
	say("It looks like you're trying to make paperclips!", 1.4);
	yield* wait(0.6);
	stage.hidden = false;
	shop.hidden = false;
	shop.classList.add("entered");
	hud.hidden = false;
	renderShop();
	renderFloor();
	renderWallet();
	layout();
	yield* flyTo(actor, host, flight(0.9));
	actor.mood = null;
	state = "playing";
	if (away.made >= 1)
		say(
			`Welcome back! Your crew made ${formatCount(away.made)} clips while you were away.`,
			2.4,
		);
	else if (factory.total < 1) say("Click the big paper clip to make one!", 2);
	else say(pick(["Back to work!", "The factory missed you."]), 1.2);
}

function pause() {
	if (state !== "playing") return;
	state = "paused";
	saveFactory(factory);
	sfx.close();
	dialog.show(
		pauseDialog(
			"The factory never sleeps",
			"Your crew keeps making clips during the break.",
		),
	);
}

function resume() {
	if (state !== "paused") return;
	dialog.hide();
	state = "playing";
}

function quit() {
	if (state === "leaving") return;
	state = "leaving";
	scripts = [];
	saveFactory(factory);
	dialog.hide();
	hud.hidden = true;
	shop.hidden = true;
	stage.hidden = true;
	document.body.classList.remove("active");
	actor.mood = null;
	run(
		(function* (): Script {
			yield* flyTo(actor, home, flight(0.6));
			yield* wait(0.15);
			api.exitGame(
				points
					? { score: points, time: Math.round(playTime), record: false }
					: null,
				pick([
					`You made ${formatCount(made)} paperclips! The machines will keep humming.`,
					`${formatCount(factory.total)} paperclips and counting. My empire grows!`,
					"Clip break? The crew will keep working while you're gone.",
				]),
			);
		})(),
	);
}

pauseWhenAway(pause);
window.addEventListener("resize", layout);
window.addEventListener("keydown", (e) => {
	if (e.key !== "Escape") return;
	e.preventDefault();
	if (state === "playing") pause();
	else if (state === "paused") {
		sfx.select();
		resume();
	} else if (state === "intro") quit();
});

function render(now: number) {
	actor.render();
	bubble.update(now, actor.head, shopLeft - 12);
	setText(clipsEl, formatCount(factory.clips));
	setText(madeEl, formatCount(factory.total));
	setText(rateEl, formatRate(rateOf(factory)));
	if (shop.hidden) return;
	if (rows.length !== shownCount()) {
		renderShop();
		sfx.open();
		say("Something new just arrived in the shop!", 1.6);
	}
	updateShop();
}

function frame(dt: number, now: number) {
	if (state !== "leaving") {
		made += produce(factory, dt);
		saveIn -= dt;
		if (saveIn <= 0) {
			saveIn = SAVE_EVERY;
			saveFactory(factory);
		}
	}
	if (state === "playing") {
		playTime += dt;
		const reached = claimMilestones(factory);
		if (reached.length) reward(reached);
		quietFor += dt;
		if (quietFor > TIP_AFTER) tip();
	}
	if (state !== "paused") stepScripts(scripts, dt);
	actor.update(dt, now, cursor);
	render(now);
}

await loadFont();
render(performance.now());
start(frame, () => run(intro()));
