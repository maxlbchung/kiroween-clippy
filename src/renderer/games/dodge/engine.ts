// Dodge engine: entities, coroutine scheduling, collision and canvas drawing.
// Coordinates are CSS px in the overlay window. Time is in seconds.

import { WIRE } from "../../common/clippy.js";
import { esc } from "../../common/ui.js";
import {
	clamp,
	easeOut,
	pick,
	rand,
	type Script,
	smooth,
	steer,
	stepScripts,
	type Vec,
} from "../motion.js";

/** Radius of the cursor's hitbox around its hotspot. */
export const HIT_R = 4;
/** Extra distance beyond a hit that still counts as a close call. */
export const GRAZE_R = 18;
export const GRAZE_POINTS = 25;

export const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);
export const angleTo = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);

/** Distance from point `p` to the segment `a`–`b`. */
function segmentDist(p: Vec, a: Vec, b: Vec) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy || 1;
	const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export type Bullet = {
	kind: "letter" | "clip" | "fireball";
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	rot: number;
	vr: number;
	owner: number;
	age: number;
	/** Seconds until the bullet fizzles out. */
	life: number;
	/** Fraction of velocity kept per second. */
	drag: number;
	ch?: string;
	color?: string;
	size?: number;
	/** Fireballs burst after travelling this many px, or at the screen edge. */
	fuse?: number;
	letters?: string;
	grazed?: boolean;
};

export type Particle = {
	kind: "glyph" | "dot" | "ring" | "text" | "streak";
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	size: number;
	color: string;
	rot?: number;
	vr?: number;
	drag?: number;
	ch?: string;
	text?: string;
	x2?: number;
	y2?: number;
	grow?: number;
	back?: boolean;
};

export type FlyingWindow = {
	el: HTMLElement;
	x: number;
	y: number;
	w: number;
	h: number;
	vx: number;
	vy: number;
	rot: number;
	vr: number;
	pop: number;
	home: Vec | null;
	bounces: number;
	owner: number;
	grazed?: boolean;
	dead?: boolean;
};

export type Beam = {
	a: Vec;
	b: Vec;
	width: number;
	/** 0–1 while aiming, drawn as a dotted warning line. */
	warn: number;
	on: boolean;
	owner: number;
	phase: number;
	grazed?: boolean;
	dead?: boolean;
};

/** Free-form drawing on the back or front canvas, removed once `done`. */
export type Decal = {
	layer: "back" | "front";
	draw(ctx: CanvasRenderingContext2D, t: number): void;
	t: number;
	done?: boolean;
};

export type Actor = {
	x: number;
	y: number;
	rot: number;
	/** Keeps `rot` as set by an attack instead of tilting with motion. */
	lockRot: boolean;
	sx: number;
	sy: number;
	vx: number;
	px: number;
	py: number;
	/** The body hurts while true (dives). */
	hostile: boolean;
	grazed: boolean;
	mood: string | null;
	laser: boolean;
	dashing: boolean;
	/** Charge glow, 0–1. */
	charge: number;
};

export type WorldHooks = {
	say(text: string, seconds?: number): void;
	sound(name: string, arg?: number): void;
};

export type Dialog = {
	title: string;
	text: string;
	icon: "err" | "warn" | "info" | "ask";
	buttons: string[];
};

const glyphs = new Map<string, HTMLCanvasElement>();
let clipSprite: HTMLCanvasElement | null = null;

function sprite(w: number, h: number, dpr: number) {
	const c = document.createElement("canvas");
	c.width = Math.ceil(w * dpr);
	c.height = Math.ceil(h * dpr);
	const g = c.getContext("2d");
	g.scale(dpr, dpr);
	return { c, g };
}

/** Outlined pixel-font glyph, cached per character, colour and size. */
function glyph(ch: string, color: string, size: number, dpr: number) {
	const key = `${ch}|${color}|${size}|${dpr}`;
	let c = glyphs.get(key);
	if (!c) {
		const box = size * 1.5;
		const s = sprite(box, box, dpr);
		c = s.c;
		const g = s.g;
		g.font = `${size}px "Pixelify Sans", monospace`;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.lineJoin = "round";
		g.lineWidth = Math.max(3, size / 5);
		g.strokeStyle = "#1d0c02";
		g.strokeText(ch, box / 2, box / 2 + size * 0.06);
		g.fillStyle = color;
		g.fillText(ch, box / 2, box / 2 + size * 0.06);
		glyphs.set(key, c);
	}
	return c;
}

/** A tiny paper clip drawn from Clippy's own wire path. */
function clip(dpr: number) {
	if (clipSprite) return clipSprite;
	const { c, g } = sprite(16, 32, dpr);
	const path = new Path2D(WIRE);
	const k = 0.118;
	g.translate(8, 16);
	g.scale(k, k);
	g.translate(-100, -144);
	g.lineCap = "round";
	g.lineJoin = "round";
	g.strokeStyle = "#20232b";
	g.lineWidth = 30;
	g.stroke(path);
	g.strokeStyle = "#c9d2de";
	g.lineWidth = 16;
	g.stroke(path);
	g.translate(-3, -3);
	g.strokeStyle = "#ffffff";
	g.lineWidth = 5;
	g.stroke(path);
	clipSprite = c;
	return c;
}

function drawSprite(
	ctx: CanvasRenderingContext2D,
	img: HTMLCanvasElement,
	dpr: number,
	x: number,
	y: number,
	rot = 0,
	scale = 1,
	alpha = 1,
) {
	const w = (img.width / dpr) * scale;
	const h = (img.height / dpr) * scale;
	ctx.globalAlpha = alpha;
	if (rot) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(rot);
		ctx.drawImage(img, -w / 2, -h / 2, w, h);
		ctx.restore();
	} else {
		ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
	}
	ctx.globalAlpha = 1;
}

const FIRE = ["#fff3b0", "#ffd23f", "#ff8a1f", "#ff5a1f"];

export class World {
	w: number;
	h: number;
	scale: number;
	dpr: number;
	hooks: WorldHooks;
	winLayer: HTMLElement;
	cursor: Vec;
	time = 0;
	bonus = 0;
	grazes = 0;
	dodged = 0;
	shake = 0;
	owners = 0;
	bullets: Bullet[] = [];
	windows: FlyingWindow[] = [];
	beams: Beam[] = [];
	particles: Particle[] = [];
	decals: Decal[] = [];
	tasks: Script[] = [];
	clippy: Actor;

	constructor({
		w,
		h,
		scale,
		dpr,
		hooks,
		winLayer,
		cursor,
		clippyAt,
	}: {
		w: number;
		h: number;
		scale: number;
		dpr: number;
		hooks: WorldHooks;
		winLayer: HTMLElement;
		cursor: Vec;
		clippyAt: Vec;
	}) {
		this.w = w;
		this.h = h;
		this.scale = scale;
		this.dpr = dpr;
		this.hooks = hooks;
		this.winLayer = winLayer;
		this.cursor = { ...cursor };
		this.clippy = {
			x: clippyAt.x,
			y: clippyAt.y,
			rot: 0,
			lockRot: false,
			sx: 1,
			sy: 1,
			vx: 0,
			px: clippyAt.x,
			py: clippyAt.y,
			hostile: false,
			grazed: false,
			mood: null,
			laser: false,
			dashing: false,
			charge: 0,
		};
	}

	get score() {
		return Math.floor(this.time * 10) + this.bonus;
	}

	/** Grows by one every 40 seconds of play, starting at 1. */
	get difficulty() {
		return 1 + this.time / 40;
	}

	/** Whole difficulty steps, every 20 seconds. */
	get level() {
		return Math.floor(this.time / 20);
	}

	/** Scales a projectile speed with difficulty, capped at 1.6x. */
	spd(base: number) {
		return base * Math.min(1.6, 0.9 + 0.1 * this.difficulty);
	}

	/** Shrinks a telegraph duration with difficulty, down to 0.45x. */
	tel(base: number) {
		return base / Math.min(2.2, 0.8 + 0.2 * this.difficulty);
	}

	say(text: string, seconds?: number) {
		this.hooks.say(text, seconds);
	}

	sound(name: string, arg?: number) {
		this.hooks.sound(name, arg);
	}

	spawn(script: Script) {
		this.tasks.push(script);
	}

	nextOwner() {
		this.owners += 1;
		return this.owners;
	}

	/** True while anything spawned by attack `owner` is still dangerous. */
	owns(owner: number) {
		return (
			this.bullets.some((b) => b.owner === owner) ||
			this.windows.some((w) => w.owner === owner) ||
			this.beams.some((b) => b.owner === owner)
		);
	}

	award(points: number, label: string) {
		this.bonus += points;
		this.text(`${label} +${points}`, this.w / 2, 96, "#7dffa8", 18);
		this.sound("bonus");
	}

	decal(layer: Decal["layer"], draw: Decal["draw"]) {
		const d: Decal = { layer, draw, t: 0 };
		this.decals.push(d);
		return d;
	}

	text(text: string, x: number, y: number, color: string, size = 14) {
		this.particles.push({
			kind: "text",
			text,
			x,
			y,
			vx: 0,
			vy: -40,
			life: 1.1,
			max: 1.1,
			size,
			color,
		});
	}

	ring(x: number, y: number, color: string, size = 10, grow = 120) {
		this.particles.push({
			kind: "ring",
			x,
			y,
			vx: 0,
			vy: 0,
			life: 0.45,
			max: 0.45,
			size,
			grow,
			color,
		});
	}

	ember(x: number, y: number, vx: number, vy: number, ch = pick(LETTERS)) {
		this.particles.push({
			kind: "glyph",
			ch,
			x,
			y,
			vx,
			vy,
			life: 0.5,
			max: 0.5,
			size: 14,
			color: pick(FIRE),
			rot: rand(-1, 1),
			vr: rand(-4, 4),
			drag: 0.2,
		});
	}

	/** A random spot for Clippy, preferably at least `minDist` px from the cursor. */
	pickSpot(minDist = 320): Vec {
		const s = this.scale;
		const left = 110;
		const right = Math.max(left, this.w - 110);
		const top = Math.min(this.h / 2, 150 * s + 30);
		const bottom = Math.max(top, this.h - 110 * s);
		let best: Vec = { x: this.w / 2, y: this.h / 2 };
		let bestD = -1;
		for (let i = 0; i < 20; i++) {
			const p = { x: rand(left, right), y: rand(top, bottom) };
			const d = dist(p, this.cursor);
			if (d >= minDist) return p;
			if (d > bestD) {
				best = p;
				bestD = d;
			}
		}
		return best;
	}

	/** Point where Clippy's laser comes out: between his eyes. */
	eyes(): Vec {
		const c = this.clippy;
		const ox = 0.7 * this.scale;
		const oy = -31 * this.scale;
		const cos = Math.cos(c.rot);
		const sin = Math.sin(c.rot);
		return { x: c.x + ox * cos - oy * sin, y: c.y + ox * sin + oy * cos };
	}

	/** Where a ray from `p` along `angle` leaves the screen grown by `pad`. */
	edgeHit(p: Vec, angle: number, pad = 0): Vec {
		const dx = Math.cos(angle);
		const dy = Math.sin(angle);
		const ts: number[] = [];
		if (dx > 1e-6) ts.push((this.w + pad - p.x) / dx);
		if (dx < -1e-6) ts.push((-pad - p.x) / dx);
		if (dy > 1e-6) ts.push((this.h + pad - p.y) / dy);
		if (dy < -1e-6) ts.push((-pad - p.y) / dy);
		const t = Math.max(0, Math.min(...ts));
		return { x: p.x + dx * t, y: p.y + dy * t };
	}

	offscreen(x: number, y: number, pad: number) {
		return x < -pad || y < -pad || x > this.w + pad || y > this.h + pad;
	}

	spawnWindow(d: Dialog, at: Vec, owner: number): FlyingWindow {
		const el = document.createElement("div");
		el.className = "fw frame-window";
		el.innerHTML = `
      <div class="titlebar"><div class="titlebar-text">${esc(d.title)}</div><span class="icon-btn"><span class="x-glyph"></span></span></div>
      <div class="fw-body"><span class="fw-icon ${d.icon}"></span><p>${esc(d.text)}</p></div>
      <div class="fw-btns">${d.buttons.map((b) => `<span class="btn btn-sm">${esc(b)}</span>`).join("")}</div>`;
		this.winLayer.appendChild(el);
		const fw: FlyingWindow = {
			el,
			x: at.x,
			y: at.y,
			w: el.offsetWidth,
			h: el.offsetHeight,
			vx: 0,
			vy: 0,
			rot: rand(-0.2, 0.2),
			vr: 0,
			pop: 0,
			home: null,
			bounces: 0,
			owner,
		};
		this.windows.push(fw);
		this.placeWindow(fw);
		return fw;
	}

	placeWindow(fw: FlyingWindow) {
		const k = fw.pop;
		const s = k >= 1 ? 1 : 0.2 + 0.8 * easeOut(k) + Math.sin(k * Math.PI) * 0.1;
		fw.el.style.transform = `translate(${(fw.x - fw.w / 2).toFixed(1)}px, ${(fw.y - fw.h / 2).toFixed(1)}px) rotate(${fw.rot.toFixed(3)}rad) scale(${s.toFixed(3)})`;
	}

	burst(b: Bullet) {
		const n = Math.min(30, 16 + this.level * 2);
		const speed = this.spd(290);
		const offset = rand(0, Math.PI * 2);
		const letters = b.letters || LETTERS;
		for (let i = 0; i < n; i++) {
			const a = offset + (i / n) * Math.PI * 2;
			const sp = speed * rand(0.8, 1.15);
			this.bullets.push({
				kind: "letter",
				x: b.x,
				y: b.y,
				vx: Math.cos(a) * sp,
				vy: Math.sin(a) * sp,
				r: 8,
				rot: rand(-1, 1),
				vr: rand(-5, 5),
				owner: b.owner,
				age: 0,
				life: 3.2,
				drag: 0.7,
				ch: letters[i % letters.length],
				color: pick(FIRE),
				size: 26,
			});
		}
		this.ring(b.x, b.y, "#ffd23f", 16, 220);
		this.ring(b.x, b.y, "#ff5a1f", 8, 140);
		this.shake = Math.max(this.shake, 8);
		this.sound("burst");
	}

	/** Advances every coroutine and entity by `dt`. */
	update(dt: number) {
		this.time += dt;
		stepScripts(this.tasks, dt);
		this.updateBullets(dt);
		this.updateWindows(dt);
		this.beams = this.beams.filter((b) => !b.dead);
	}

	updateBullets(dt: number) {
		const keep: Bullet[] = [];
		for (const b of this.bullets) {
			b.age += dt;
			b.life -= dt;
			if (b.drag !== 1) {
				const k = b.drag ** dt;
				b.vx *= k;
				b.vy *= k;
			}
			b.x += b.vx * dt;
			b.y += b.vy * dt;
			b.rot += b.vr * dt;
			if (b.kind === "fireball") {
				b.fuse -= Math.hypot(b.vx, b.vy) * dt;
				if (Math.random() < dt * 60)
					this.ember(
						b.x + rand(-10, 10),
						b.y + rand(-10, 10),
						-b.vx * 0.15 + rand(-40, 40),
						-b.vy * 0.15 + rand(-40, 40),
					);
				if (b.fuse <= 0 || this.offscreen(b.x, b.y, 0)) {
					b.x = clamp(b.x, 0, this.w);
					b.y = clamp(b.y, 0, this.h);
					this.burst(b);
					continue;
				}
			}
			if (b.life <= 0) {
				this.particles.push({
					kind: "dot",
					x: b.x,
					y: b.y,
					vx: 0,
					vy: -20,
					life: 0.25,
					max: 0.25,
					size: 4,
					color: b.color || "#fff",
				});
				continue;
			}
			if (this.offscreen(b.x, b.y, 60)) continue;
			keep.push(b);
		}
		this.bullets = keep;
	}

	updateWindows(dt: number) {
		for (const fw of this.windows) {
			fw.pop = Math.min(1, fw.pop + dt * 4);
			if (fw.home) {
				const k = smooth(9, dt);
				fw.x += (fw.home.x - fw.x) * k;
				fw.y += (fw.home.y - fw.y) * k;
			}
			fw.x += fw.vx * dt;
			fw.y += fw.vy * dt;
			fw.rot += fw.vr * dt;
			if (fw.bounces > 0) {
				let bounced = false;
				if (
					(fw.x < fw.w / 2 && fw.vx < 0) ||
					(fw.x > this.w - fw.w / 2 && fw.vx > 0)
				) {
					fw.vx = -fw.vx;
					bounced = true;
				}
				if (
					(fw.y < fw.h / 2 && fw.vy < 0) ||
					(fw.y > this.h - fw.h / 2 && fw.vy > 0)
				) {
					fw.vy = -fw.vy;
					bounced = true;
				}
				if (bounced) {
					fw.bounces -= 1;
					fw.vr = -fw.vr * 1.2;
					this.shake = Math.max(this.shake, 4);
					this.sound("thud");
				}
			}
			const reach = Math.hypot(fw.w, fw.h) / 2;
			if (this.offscreen(fw.x, fw.y, reach + 20)) fw.dead = true;
			this.placeWindow(fw);
		}
		for (const fw of this.windows) if (fw.dead) fw.el.remove();
		this.windows = this.windows.filter((fw) => !fw.dead);
	}

	/** Moves particles and decals; runs even while play is frozen. */
	updateEffects(dt: number) {
		const keep: Particle[] = [];
		for (const p of this.particles) {
			p.life -= dt;
			if (p.life <= 0) continue;
			if (p.drag) {
				const k = p.drag ** dt;
				p.vx *= k;
				p.vy *= k;
			}
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			if (p.vr) p.rot += p.vr * dt;
			keep.push(p);
		}
		this.particles = keep;
		for (const d of this.decals) d.t += dt;
		this.decals = this.decals.filter((d) => !d.done);
		this.shake *= Math.exp(-9 * dt);
		if (this.shake < 0.2) this.shake = 0;
	}

	/** Eases Clippy's tilt and squash toward rest. */
	updateActor(dt: number) {
		const c = this.clippy;
		c.py = c.y;
		steer(c, dt);
	}

	/** Returns the point of impact if anything touches the cursor. */
	collide(): Vec | null {
		const p = this.cursor;
		const graze = (x: number, y: number) => {
			this.grazes += 1;
			this.bonus += GRAZE_POINTS;
			this.text(`+${GRAZE_POINTS}`, x + 14, y - 10, "#ffe66d", 14);
			this.sound("graze");
		};
		for (const b of this.bullets) {
			const d = Math.hypot(b.x - p.x, b.y - p.y);
			if (d < b.r + HIT_R) return { x: b.x, y: b.y };
			if (!b.grazed && d < b.r + HIT_R + GRAZE_R) {
				b.grazed = true;
				graze(p.x, p.y);
			}
		}
		for (const fw of this.windows) {
			if (fw.pop < 0.6) continue;
			const cos = Math.cos(-fw.rot);
			const sin = Math.sin(-fw.rot);
			const dx = p.x - fw.x;
			const dy = p.y - fw.y;
			const lx = Math.abs(dx * cos - dy * sin) - fw.w / 2 + 3;
			const ly = Math.abs(dx * sin + dy * cos) - fw.h / 2 + 3;
			if (lx < HIT_R && ly < HIT_R) return { ...p };
			if (!fw.grazed && lx < HIT_R + GRAZE_R && ly < HIT_R + GRAZE_R) {
				fw.grazed = true;
				graze(p.x, p.y);
			}
		}
		for (const beam of this.beams) {
			if (!beam.on) continue;
			const d = segmentDist(p, beam.a, beam.b) - beam.width / 2;
			if (d < HIT_R) return { ...p };
			if (!beam.grazed && d < HIT_R + GRAZE_R) {
				beam.grazed = true;
				graze(p.x, p.y);
			}
		}
		const c = this.clippy;
		if (c.hostile) {
			const s = this.scale;
			const cos = Math.cos(-c.rot);
			const sin = Math.sin(-c.rot);
			const dx = p.x - c.x;
			const dy = p.y - c.y;
			const lx = dx * cos - dy * sin;
			const ly = dx * sin + dy * cos;
			const e = (pad: number) =>
				(lx / (28 * s + pad)) ** 2 + (ly / (78 * s + pad)) ** 2;
			if (e(HIT_R) < 1) return { ...p };
			if (!c.grazed && e(HIT_R + GRAZE_R) < 1) {
				c.grazed = true;
				graze(p.x, p.y);
			}
		}
		return null;
	}

	/** Removes every hazard with a puff, e.g. after the cursor is hit. */
	clearHazards() {
		for (const b of this.bullets)
			this.particles.push({
				kind: "dot",
				x: b.x,
				y: b.y,
				vx: rand(-30, 30),
				vy: rand(-60, -10),
				life: 0.4,
				max: 0.4,
				size: 5,
				color: b.color || "#fff",
			});
		for (const fw of this.windows) {
			fw.el.animate(
				[
					{ opacity: 1, transform: fw.el.style.transform },
					{ opacity: 0, transform: `${fw.el.style.transform} scale(0.6)` },
				],
				{ duration: 220, fill: "forwards" },
			).onfinish = () => fw.el.remove();
		}
		this.bullets = [];
		this.windows = [];
		this.beams = [];
		this.tasks = [];
		for (const d of this.decals) d.done = true;
		this.decals = [];
		const c = this.clippy;
		c.hostile = false;
		c.dashing = false;
		c.laser = false;
		c.lockRot = false;
		c.charge = 0;
	}

	draw(back: CanvasRenderingContext2D, front: CanvasRenderingContext2D) {
		const dpr = this.dpr;
		for (const ctx of [back, front]) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		for (const d of this.decals) if (d.layer === "back") d.draw(back, d.t);
		for (const p of this.particles) if (p.back) this.drawParticle(back, p);
		for (const p of this.particles) if (!p.back) this.drawParticle(front, p);
		for (const b of this.bullets) this.drawBullet(front, b);
		for (const beam of this.beams) this.drawBeam(front, beam);
		for (const d of this.decals) if (d.layer === "front") d.draw(front, d.t);
	}

	drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
		const k = p.life / p.max;
		switch (p.kind) {
			case "glyph":
				drawSprite(
					ctx,
					glyph(p.ch, p.color, p.size, this.dpr),
					this.dpr,
					p.x,
					p.y,
					p.rot,
					0.4 + 0.6 * k,
					k,
				);
				break;
			case "dot":
				ctx.globalAlpha = k;
				ctx.fillStyle = p.color;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
				ctx.fill();
				ctx.globalAlpha = 1;
				break;
			case "ring":
				ctx.globalAlpha = k;
				ctx.strokeStyle = p.color;
				ctx.lineWidth = 3 + 5 * k;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size + (1 - k) * p.grow, 0, Math.PI * 2);
				ctx.stroke();
				ctx.globalAlpha = 1;
				break;
			case "streak":
				ctx.globalAlpha = k * 0.7;
				ctx.strokeStyle = p.color;
				ctx.lineCap = "round";
				ctx.lineWidth = p.size * k;
				ctx.beginPath();
				ctx.moveTo(p.x, p.y);
				ctx.lineTo(p.x2, p.y2);
				ctx.stroke();
				ctx.globalAlpha = 1;
				break;
			case "text":
				ctx.globalAlpha = Math.min(1, k * 2);
				ctx.font = `${p.size}px "Pixelify Sans", monospace`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.lineJoin = "round";
				ctx.lineWidth = 4;
				ctx.strokeStyle = "#17171c";
				ctx.strokeText(p.text, p.x, p.y);
				ctx.fillStyle = p.color;
				ctx.fillText(p.text, p.x, p.y);
				ctx.globalAlpha = 1;
				break;
		}
	}

	drawBullet(ctx: CanvasRenderingContext2D, b: Bullet) {
		const dpr = this.dpr;
		const fade = b.life < 0.4 ? b.life / 0.4 : 1;
		if (b.kind === "letter") {
			drawSprite(
				ctx,
				glyph(b.ch, b.color, b.size, dpr),
				dpr,
				b.x,
				b.y,
				b.rot,
				1,
				fade,
			);
		} else if (b.kind === "clip") {
			const a = Math.atan2(b.vy, b.vx) + Math.PI / 2;
			drawSprite(ctx, clip(dpr), dpr, b.x, b.y, a, 1, fade);
		} else {
			const r = b.r;
			const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 2.3);
			g.addColorStop(0, "rgba(255,255,230,1)");
			g.addColorStop(0.25, "rgba(255,214,70,.95)");
			g.addColorStop(0.55, "rgba(255,122,26,.55)");
			g.addColorStop(1, "rgba(255,60,20,0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(b.x, b.y, r * 2.3, 0, Math.PI * 2);
			ctx.fill();
			const letters = b.letters || LETTERS;
			const n = 10;
			for (let i = 0; i < n; i++) {
				const a = b.age * 6 + (i / n) * Math.PI * 2;
				const rr = r * (0.55 + 0.3 * Math.sin(b.age * 9 + i * 1.7));
				drawSprite(
					ctx,
					glyph(letters[i % letters.length], FIRE[i % FIRE.length], 22, dpr),
					dpr,
					b.x + Math.cos(a) * rr,
					b.y + Math.sin(a) * rr,
					a,
				);
			}
		}
	}

	drawBeam(ctx: CanvasRenderingContext2D, beam: Beam) {
		const { a, b } = beam;
		if (!beam.on) {
			const flash = beam.warn >= 1 && Math.floor(performance.now() / 70) % 2;
			ctx.globalAlpha = 0.35 + 0.55 * beam.warn;
			ctx.strokeStyle = flash ? "#ffffff" : "#ff3b30";
			ctx.lineWidth = beam.warn >= 1 ? 3 : 2;
			ctx.setLineDash([4, 8]);
			ctx.lineDashOffset = -performance.now() / 20;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
			return;
		}
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		const ux = (b.x - a.x) / len;
		const uy = (b.y - a.y) / len;
		const amp = beam.width * 0.45;
		const pts: Vec[] = [];
		for (let d = 0; d <= len; d += 6) {
			const off = Math.sin(d / 9 - beam.phase * 30) * amp * Math.min(1, d / 40);
			pts.push({ x: a.x + ux * d - uy * off, y: a.y + uy * d + ux * off });
		}
		const stroke = (color: string, width: number, alpha = 1) => {
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.beginPath();
			pts.forEach((p, i) => {
				if (i) ctx.lineTo(p.x, p.y);
				else ctx.moveTo(p.x, p.y);
			});
			ctx.stroke();
		};
		stroke("#ff3b30", beam.width * 2.2, 0.25);
		stroke("#3a0000", beam.width * 0.9 + 4);
		stroke("#ff3b30", beam.width * 0.9);
		stroke("#fff1ec", beam.width * 0.28);
		ctx.globalAlpha = 1;
	}
}

export const LETTERS = "ITLOOKSLIKEYOUREWRITINGALETTER";
