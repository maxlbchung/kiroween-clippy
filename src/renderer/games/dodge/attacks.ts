// Clippy's attacks. Each one is a coroutine that choreographs Clippy, shows a
// telegraph, then spawns hazards tagged with the attack's owner id.

import {
	angleDiff,
	clamp,
	easeOut,
	pick,
	rand,
	type Script,
	tween,
	type Vec,
	wait,
} from "../motion.js";
import {
	angleTo,
	type Beam,
	type Dialog,
	dist,
	type FlyingWindow,
	type World,
} from "./engine.js";

export type Attack = {
	id: string;
	/** Seconds of play before the attack can be picked. */
	from: number;
	weight: number;
	run(w: World, owner: number): Script;
};

function* flyTo(w: World, x: number, y: number, seconds: number): Script {
	const c = w.clippy;
	const sx = c.x;
	const sy = c.y;
	yield* tween(seconds, (k) => {
		c.x = sx + (x - sx) * k;
		c.y = sy + (y - sy) * k;
	});
}

/** Fires a fireball made of letters, after a charge that tracks the cursor. */
function* spellBlast(w: World, owner: number): Script {
	const c = w.clippy;
	const s = w.scale;
	w.say(
		pick([
			"Let me spell it out for you!",
			"Dear Cursor: DUCK.",
			"It looks like you need a fireball.",
		]),
	);
	const spot = w.pickSpot(380);
	yield* flyTo(w, spot.x, spot.y, 0.7);
	const shots = 1 + Math.min(2, Math.floor(w.level / 2));
	for (let i = 0; i < shots; i++) {
		const charge = w.tel(i === 0 ? 1.5 : 0.9);
		const word = pick(["HELLO", "DEARSIR", "TYPO", "OOPS", "LETTER", "CLIPPY"]);
		const orb = { x: c.x, y: c.y, r: 0 };
		let ang = angleTo(c, w.cursor);
		let locked = false;
		c.mood = "angry";
		w.sound("charge", charge);
		const aim = w.decal("back", (ctx) => {
			const end = w.edgeHit(orb, ang);
			ctx.globalAlpha = locked ? 0.9 : 0.45;
			ctx.strokeStyle = locked ? "#ff3b30" : "#ffd23f";
			ctx.lineWidth = locked ? 3 : 2;
			ctx.setLineDash([10, 10]);
			ctx.lineDashOffset = -performance.now() / 15;
			ctx.beginPath();
			ctx.moveTo(orb.x, orb.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
		});
		const glow = w.decal("front", (ctx, t) => {
			const g = ctx.createRadialGradient(
				orb.x,
				orb.y,
				0,
				orb.x,
				orb.y,
				orb.r * 2,
			);
			g.addColorStop(0, "rgba(255,255,230,1)");
			g.addColorStop(0.4, "rgba(255,190,60,.85)");
			g.addColorStop(1, "rgba(255,90,20,0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(orb.x, orb.y, orb.r * 2 + Math.sin(t * 30) * 2, 0, Math.PI * 2);
			ctx.fill();
		});
		let t = 0;
		while (t < charge) {
			const dt = yield;
			t += dt;
			const k = Math.min(1, t / charge);
			if (k < 0.78) ang = angleTo(c, w.cursor);
			else locked = true;
			orb.x = c.x + Math.cos(ang) * 64 * s;
			orb.y = c.y + Math.sin(ang) * 64 * s - 10 * s;
			orb.r = 4 + 24 * easeOut(k);
			c.charge = k;
			if (Math.random() < dt * 45) {
				const a = rand(0, Math.PI * 2);
				const r = rand(90, 150);
				w.particles.push({
					kind: "glyph",
					ch: pick(word.split("")),
					x: orb.x + Math.cos(a) * r,
					y: orb.y + Math.sin(a) * r,
					vx: -Math.cos(a) * r * 2.6,
					vy: -Math.sin(a) * r * 2.6,
					life: 0.36,
					max: 0.36,
					size: 16,
					color: pick(["#fff3b0", "#ffd23f", "#ff8a1f"]),
					rot: rand(-1, 1),
					vr: 6,
				});
			}
		}
		aim.done = true;
		glow.done = true;
		c.charge = 0;
		const target = { ...w.cursor };
		const speed = w.spd(820);
		w.bullets.push({
			kind: "fireball",
			x: orb.x,
			y: orb.y,
			vx: Math.cos(ang) * speed,
			vy: Math.sin(ang) * speed,
			r: 26,
			rot: 0,
			vr: 0,
			owner,
			age: 0,
			life: 10,
			drag: 1,
			fuse: dist(orb, target) + 220,
			letters: word,
		});
		c.x -= Math.cos(ang) * 26;
		c.y -= Math.sin(ang) * 26;
		c.sx = 1.18;
		c.sy = 0.84;
		w.shake = Math.max(w.shake, 5);
		w.sound("fire");
		yield* wait(0.35);
	}
	c.mood = null;
}

const DIALOGS: Dialog[] = [
	{
		title: "Error",
		text: "An error occurred while displaying the previous error.",
		icon: "err",
		buttons: ["OK"],
	},
	{
		title: "Clippy",
		text: "It looks like you're trying to dodge. Would you like help?",
		icon: "ask",
		buttons: ["Yes", "Also yes"],
	},
	{
		title: "Warning",
		text: "Are you sure you want to not get hit?",
		icon: "warn",
		buttons: ["Yes", "No"],
	},
	{
		title: "Not Responding",
		text: "cursor.exe has stopped dodging.",
		icon: "err",
		buttons: ["Close"],
	},
	{
		title: "Document1",
		text: "Do you want to save changes to Document1?",
		icon: "warn",
		buttons: ["Yes", "No", "Cancel"],
	},
	{
		title: "Updates",
		text: "Restart now to install 1 important update?",
		icon: "info",
		buttons: ["Now", "Now"],
	},
	{
		title: "Low Memory",
		text: "Your cursor is running low on luck.",
		icon: "warn",
		buttons: ["OK"],
	},
	{
		title: "Tip of the Day",
		text: "Did you know? Pop-ups hurt.",
		icon: "info",
		buttons: ["Next Tip"],
	},
];

/** Pops a fan of dialog boxes out of Clippy and throws them at the cursor. */
function* popupStorm(w: World, owner: number): Script {
	const c = w.clippy;
	w.say(
		pick([
			"Would you like some help? Too bad!",
			"Have some pop-ups!",
			"Error: cursor still alive.",
		]),
	);
	const spot = w.pickSpot(420);
	yield* flyTo(w, spot.x, spot.y, 0.6);
	c.mood = "happy";
	const n = Math.min(7, 3 + w.level);
	const deck = [...DIALOGS].sort(() => Math.random() - 0.5);
	const fan: FlyingWindow[] = [];
	const spread = Math.min(0.8, 3.4 / n);
	const up = c.y > w.h * 0.45 ? -Math.PI / 2 : Math.PI / 2;
	for (let i = 0; i < n; i++) {
		const a = up + (i - (n - 1) / 2) * spread;
		const fw = w.spawnWindow(deck[i % deck.length], c, owner);
		fw.home = {
			x: clamp(c.x + Math.cos(a) * 250, 130, w.w - 130),
			y: clamp(c.y + Math.sin(a) * 200, 70, w.h - 70),
		};
		fan.push(fw);
		c.sy = 0.9;
		w.sound("pop");
		yield* wait(w.tel(0.16));
	}
	yield* wait(w.tel(0.45));
	c.mood = "angry";
	for (const fw of fan) {
		if (fw.dead) continue;
		fw.el.classList.add("armed");
		yield* wait(w.tel(0.24));
		const a = angleTo(fw, w.cursor) + rand(-0.05, 0.05);
		const sp = w.spd(rand(600, 740));
		fw.home = null;
		fw.vx = Math.cos(a) * sp;
		fw.vy = Math.sin(a) * sp;
		fw.vr = rand(-3, 3);
		fw.bounces = w.level >= 2 ? 1 : 0;
		w.sound("whoosh");
	}
	c.mood = null;
}

/** Dashes across the screen several times, each pass telegraphed by a band. */
function* paperDive(w: World, _owner: number): Script {
	const c = w.clippy;
	const s = w.scale;
	w.say(pick(["Incoming!", "Paperclip dive!", "Hold still. This won't hurt."]));
	c.mood = "angry";
	const x0 = c.x;
	yield* tween(w.tel(0.55), (k) => {
		c.sx = 1 + 0.12 * k;
		c.sy = 1 - 0.16 * k;
		c.x = x0 + Math.sin(k * 60) * 3 * k;
	});
	c.x = x0;
	const dives = Math.min(6, 3 + Math.floor(w.level / 2));
	const band = 64 * s;
	for (let i = 0; i < dives; i++) {
		const from = { x: c.x, y: c.y };
		let target: Vec;
		if (i % 3 === 2) {
			target = { x: rand(80, w.w - 80), y: rand(80, w.h - 80) };
		} else {
			const off = rand(-60, 60);
			const a = angleTo(from, w.cursor) + Math.PI / 2;
			target = {
				x: w.cursor.x + Math.cos(a) * off,
				y: w.cursor.y + Math.sin(a) * off,
			};
		}
		let ang = angleTo(from, target);
		if (dist(from, target) < 40) ang = rand(0, Math.PI * 2);
		const end = w.edgeHit(from, ang, 220);
		c.lockRot = true;
		const warnFor = w.tel(0.7);
		const warn = w.decal("back", (ctx, t) => {
			const k = Math.min(1, t / warnFor);
			const pulse = 0.5 + 0.5 * Math.sin(t * 28);
			ctx.save();
			ctx.translate(from.x, from.y);
			ctx.rotate(ang);
			const len = Math.hypot(end.x - from.x, end.y - from.y);
			ctx.globalAlpha = 0.12 + 0.2 * pulse * k;
			ctx.fillStyle = "#ff3b30";
			ctx.fillRect(0, -band / 2, len * easeOut(k), band);
			ctx.globalAlpha = 0.85;
			ctx.strokeStyle = "#ff3b30";
			ctx.lineWidth = 2;
			ctx.setLineDash([12, 8]);
			ctx.beginPath();
			ctx.moveTo(0, -band / 2);
			ctx.lineTo(len * easeOut(k), -band / 2);
			ctx.moveTo(0, band / 2);
			ctx.lineTo(len * easeOut(k), band / 2);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = "#fff";
			for (let d = (t * 400) % 80; d < len * easeOut(k); d += 80) {
				ctx.beginPath();
				ctx.moveTo(d, -10);
				ctx.lineTo(d + 12, 0);
				ctx.lineTo(d, 10);
				ctx.closePath();
				ctx.fill();
			}
			ctx.restore();
			ctx.globalAlpha = 1;
		});
		const startRot = c.rot;
		const aimRot = ang + Math.PI / 2;
		yield* tween(warnFor, (k) => {
			c.rot = startRot + angleDiff(startRot, aimRot) * Math.min(1, k * 2);
			c.x = from.x + Math.sin(k * 80) * 2;
		});
		c.x = from.x;
		c.rot = aimRot;
		warn.done = true;
		c.hostile = true;
		c.grazed = false;
		c.dashing = true;
		w.sound("whoosh");
		const speed = w.spd(1900);
		const total = Math.hypot(end.x - from.x, end.y - from.y);
		let travelled = 0;
		while (travelled < total) {
			const dt = yield;
			const px = c.x;
			const py = c.y;
			travelled = Math.min(total, travelled + speed * dt);
			c.x = from.x + Math.cos(ang) * travelled;
			c.y = from.y + Math.sin(ang) * travelled;
			w.particles.push({
				kind: "streak",
				back: true,
				x: px,
				y: py,
				x2: c.x,
				y2: c.y,
				vx: 0,
				vy: 0,
				life: 0.3,
				max: 0.3,
				size: 34 * s,
				color: "#dfe7f2",
			});
		}
		c.hostile = false;
		c.dashing = false;
		yield* wait(w.tel(0.15));
	}
	const spot = w.pickSpot(300);
	c.rot = 0;
	c.lockRot = false;
	yield* flyTo(w, spot.x, spot.y, 0.8);
	c.mood = null;
}

/** Spins in place and sprays rotating arms of paper clips. */
function* clipStorm(w: World, owner: number): Script {
	const c = w.clippy;
	const s = w.scale;
	w.say(pick(["Clip storm!", "Organizing your desktop...", "Wheee!"]));
	const spot = {
		x: w.w / 2 + rand(-0.2, 0.2) * w.w,
		y: w.h / 2 + rand(-0.15, 0.15) * w.h,
	};
	if (dist(spot, w.cursor) < 260) {
		const a = angleTo(w.cursor, spot);
		spot.x = clamp(w.cursor.x + Math.cos(a) * 300, 120, w.w - 120);
		spot.y = clamp(w.cursor.y + Math.sin(a) * 300, 160, w.h - 120);
	}
	yield* flyTo(w, spot.x, spot.y, 0.7);
	c.mood = "happy";
	c.lockRot = true;
	let spin = 0;
	const spinUp = w.tel(0.8);
	w.sound("spin", spinUp);
	yield* tween(
		spinUp,
		(k, dt) => {
			spin = k * 16;
			c.rot += spin * dt;
		},
		(t) => t,
	);
	const arms = Math.min(6, 3 + Math.floor(w.level / 2));
	const duration = 3.2;
	const every = 0.1;
	const turn = (Math.random() < 0.5 ? 1 : -1) * 1.1;
	let base = rand(0, Math.PI * 2);
	let since = 0;
	let t = 0;
	while (t < duration) {
		const dt = yield;
		t += dt;
		since += dt;
		c.rot += spin * dt;
		base += turn * dt * (t < duration / 2 ? 1 : -1);
		while (since >= every) {
			since -= every;
			for (let i = 0; i < arms; i++) {
				const a = base + (i / arms) * Math.PI * 2;
				const sp = w.spd(250);
				w.bullets.push({
					kind: "clip",
					x: c.x + Math.cos(a) * 40 * s,
					y: c.y + Math.sin(a) * 40 * s,
					vx: Math.cos(a) * sp,
					vy: Math.sin(a) * sp,
					r: 6,
					rot: 0,
					vr: 0,
					owner,
					age: 0,
					life: 8,
					drag: 1,
				});
			}
			w.sound("tick");
		}
	}
	const r0 = c.rot;
	const rest = Math.ceil(r0 / (Math.PI * 2)) * Math.PI * 2;
	yield* tween(
		0.5,
		(k) => {
			c.rot = r0 + (rest - r0) * k;
		},
		easeOut,
	);
	c.rot = 0;
	c.lockRot = false;
	c.mood = null;
}

/** Fires a wavy red spell-check laser from Clippy's eyes, then sweeps it. */
function* redSquiggle(w: World, owner: number): Script {
	const c = w.clippy;
	w.say(
		pick([
			"Spell-check: ENGAGED.",
			"I found a typo. It's you.",
			"Red squiggle incoming!",
		]),
	);
	const spot = w.pickSpot(380);
	yield* flyTo(w, spot.x, spot.y, 0.7);
	c.mood = "angry";
	c.laser = true;
	let ang = angleTo(w.eyes(), w.cursor);
	const beam: Beam = {
		a: w.eyes(),
		b: w.edgeHit(w.eyes(), ang, 40),
		width: 16,
		warn: 0,
		on: false,
		owner,
		phase: 0,
	};
	const place = () => {
		beam.a = w.eyes();
		beam.b = w.edgeHit(beam.a, ang, 40);
	};
	w.beams.push(beam);
	const track = w.tel(1.2);
	const lock = w.tel(0.4);
	w.sound("charge", track + lock);
	let t = 0;
	while (t < track + lock) {
		const dt = yield;
		t += dt;
		if (t < track) ang = angleTo(w.eyes(), w.cursor);
		beam.warn = Math.min(1, t / track);
		place();
	}
	beam.on = true;
	w.shake = Math.max(w.shake, 7);
	const sweep = 1.5 + Math.min(1.2, w.level * 0.2);
	const turnRate = w.spd(0.75);
	w.sound("laser", sweep);
	t = 0;
	while (t < sweep) {
		const dt = yield;
		t += dt;
		beam.phase += dt;
		const want = angleTo(w.eyes(), w.cursor);
		const d = angleDiff(ang, want);
		ang += clamp(d, -turnRate * dt, turnRate * dt);
		beam.width = 16 + Math.sin(t * 40) * 2;
		place();
		if (Math.random() < dt * 30)
			w.particles.push({
				kind: "dot",
				x: beam.b.x,
				y: beam.b.y,
				vx: rand(-120, 120),
				vy: rand(-120, 120),
				life: 0.3,
				max: 0.3,
				size: 4,
				color: "#ff8a7a",
			});
	}
	beam.dead = true;
	c.laser = false;
	c.mood = null;
}

// Walls read top to bottom. No spaces, so a wall has exactly one gap.
const LETTER_LINES = [
	"DEARSIRORMADAM",
	"TOWHOMITMAYCONCERN",
	"YOURSSINCERELYCLIPPY",
];

/** Types marching walls of letters across the screen, each with one gap. */
function* letterWall(w: World, owner: number): Script {
	const c = w.clippy;
	const s = w.scale;
	w.say(
		pick([
			"Let me write you a letter!",
			"It looks like you're writing a letter.",
			"Dear Cursor...",
		]),
	);
	const vertical = w.level >= 2 && Math.random() < 0.4;
	const fromStart = Math.random() < 0.5;
	const span = vertical ? w.w : w.h;
	const depth = vertical ? w.h : w.w;
	const edge = fromStart ? 0 : depth;
	const dir = fromStart ? 1 : -1;
	const home = vertical
		? { x: w.w / 2, y: fromStart ? 150 * s + 20 : w.h - 110 * s }
		: { x: fromStart ? 110 : w.w - 110, y: w.h / 2 };
	yield* flyTo(w, home.x, home.y, 0.7);
	c.mood = "happy";
	const walls = Math.min(6, 3 + Math.floor(w.level / 2));
	const gap = Math.max(120, 175 - w.level * 10);
	const step = 30;
	const text = pick(LETTER_LINES);
	let center = clamp(vertical ? w.cursor.x : w.cursor.y, gap, span - gap);
	let n = 0;
	for (let i = 0; i < walls; i++) {
		if (i > 0)
			center = clamp(
				center + rand(120, 260) * (Math.random() < 0.5 ? -1 : 1),
				gap,
				span - gap,
			);
		const gc = center;
		const warnFor = w.tel(0.5);
		const warn = w.decal("back", (ctx, t) => {
			const k = Math.min(1, t / warnFor);
			ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 25);
			ctx.strokeStyle = "#7dffa8";
			ctx.lineWidth = 3;
			const reach = 26 + 30 * k;
			const e = fromStart ? reach : depth - reach;
			ctx.beginPath();
			for (const sgn of [-1, 1]) {
				const g = gc + (sgn * gap) / 2;
				if (vertical) {
					ctx.moveTo(g, edge);
					ctx.lineTo(g, e);
				} else {
					ctx.moveTo(edge, g);
					ctx.lineTo(e, g);
				}
			}
			ctx.stroke();
			ctx.globalAlpha = 1;
		});
		c.sy = 0.92;
		yield* wait(warnFor);
		warn.done = true;
		const sp = w.spd(300);
		for (let p = step / 2; p < span; p += step) {
			if (Math.abs(p - gc) < gap / 2) continue;
			const ch = text[n % text.length];
			n += 1;
			w.bullets.push({
				kind: "letter",
				x: vertical ? p : edge - dir * 10,
				y: vertical ? edge - dir * 10 : p,
				vx: vertical ? 0 : dir * sp,
				vy: vertical ? dir * sp : 0,
				r: 9,
				rot: 0,
				vr: 0,
				owner,
				age: 0,
				life: depth / sp + 1,
				drag: 1,
				ch,
				color: "#fffdf2",
				size: 24,
			});
		}
		w.sound("type");
		yield* wait(Math.max(0.6, w.tel(0.95)));
	}
	c.mood = null;
}

export const ATTACKS: Attack[] = [
	{ id: "fireball", from: 0, weight: 3, run: spellBlast },
	{ id: "popups", from: 0, weight: 3, run: popupStorm },
	{ id: "dive", from: 0, weight: 3, run: paperDive },
	{ id: "laser", from: 10, weight: 2, run: redSquiggle },
	{ id: "letters", from: 15, weight: 2, run: letterWall },
	{ id: "spiral", from: 25, weight: 2, run: clipStorm },
];

function* awardWhenClear(w: World, owner: number): Script {
	while (w.owns(owner)) yield;
	w.dodged += 1;
	w.award(50 + 10 * w.level, "DODGED");
}

/** Picks attacks forever, never the same one twice in a row. */
export function* director(w: World): Script {
	yield* wait(0.3);
	let last = "";
	let first = true;
	while (true) {
		const pool = ATTACKS.filter((a) => a.id !== last && w.time >= a.from);
		const choices = pool.length ? pool : ATTACKS;
		let attack = choices[0];
		if (first && choices.some((a) => a.id === "fireball"))
			attack = choices.find((a) => a.id === "fireball");
		else {
			let roll = Math.random() * choices.reduce((n, a) => n + a.weight, 0);
			for (const a of choices) {
				roll -= a.weight;
				if (roll <= 0) {
					attack = a;
					break;
				}
			}
		}
		first = false;
		last = attack.id;
		const owner = w.nextOwner();
		yield* attack.run(w, owner);
		w.spawn(awardWhenClear(w, owner));
		yield* wait(Math.max(0.35, 1.1 - w.time / 100));
	}
}
