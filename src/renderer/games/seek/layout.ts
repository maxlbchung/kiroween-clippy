// Hide & Seek layout rules: where the pile's windows go and where the Clippies
// hide. Pure geometry with no DOM access, so it runs in unit tests. Rects are
// CSS px in overlay coordinates unless a type says otherwise.

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };
/** Returns a float in [0, 1), like `Math.random`. */
export type Rng = () => number;

/**
 * How a hiding box shows Clippy. Peeking poses cut him off at one edge of the
 * box: `up` rises from the bottom edge, `down` hangs from the top edge, `left`
 * and `right` lean out from that side. `whole` shows all of him standing, and
 * `lie` shows him lying on his side.
 */
export type Pose = "up" | "down" | "left" | "right" | "whole" | "lie";

/** Number of Clippies hiding each round. */
export const HIDERS = 3;
/** Height of the band at the top of the screen kept clear for the HUD. */
export const HUD_BAND = 72;
/** Gap between the pile and the other screen edges. */
export const EDGE = 8;
/** How many layers deep the pile covers the play area, on average. */
export const PILE_DEPTH = 1.9;
export const MAX_WINDOWS = 40;
/** Hiding boxes for Clippies standing or lying on the desk behind the pile. */
export const DESK_SIZE: Record<"whole" | "lie", Size> = {
	whole: { w: 28, h: 66 },
	lie: { w: 66, h: 28 },
};

/** Seeded generator for repeatable layouts (mulberry32). */
export function seeded(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

export function pickOne<T>(rng: Rng, xs: readonly T[]): T {
	return xs[Math.floor(rng() * xs.length)];
}

/** Returns a shuffled copy of `xs`. */
export function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** The part of the screen that windows and hiding spots may use. */
export function playArea(view: Size): Rect {
	return {
		x: EDGE,
		y: HUD_BAND,
		w: Math.max(0, view.w - EDGE * 2),
		h: Math.max(0, view.h - HUD_BAND - EDGE),
	};
}

/** True when `inner` lies inside `outer`, allowing half a pixel of rounding. */
export function contains(outer: Rect, inner: Rect) {
	const e = 0.5;
	return (
		inner.x >= outer.x - e &&
		inner.y >= outer.y - e &&
		inner.x + inner.w <= outer.x + outer.w + e &&
		inner.y + inner.h <= outer.y + outer.h + e
	);
}

export function overlap(a: Rect, b: Rect) {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

export function grow(r: Rect, by: number): Rect {
	return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/** Moves `r` the least distance that puts it inside `area`, pinned top-left when it is larger. */
export function clampRect(r: Rect, area: Rect): Rect {
	return {
		...r,
		x: Math.max(area.x, Math.min(r.x, area.x + area.w - r.w)),
		y: Math.max(area.y, Math.min(r.y, area.y + area.h - r.h)),
	};
}

/** Fraction of `r` covered by the union of `covers`, sampled on a `steps`×`steps` grid. */
export function coverage(r: Rect, covers: readonly Rect[], steps = 10) {
	if (!covers.length) return 0;
	let hit = 0;
	for (let i = 0; i < steps; i++) {
		const y = r.y + ((i + 0.5) / steps) * r.h;
		for (let j = 0; j < steps; j++) {
			const x = r.x + ((j + 0.5) / steps) * r.w;
			if (
				covers.some(
					(c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h,
				)
			)
				hit += 1;
		}
	}
	return hit / (steps * steps);
}

/** True once windows with `totalArea` in all cover `area` deeply enough, or the pile is at its cap. */
export function pileFull(totalArea: number, count: number, area: Rect) {
	return count >= MAX_WINDOWS || totalArea >= area.w * area.h * PILE_DEPTH;
}

/**
 * Places windows of the given sizes inside `area`, back to front. Each window
 * takes the least-covered of a few random candidate spots, so the pile spreads
 * over the whole area while still overlapping messily. Every rect lies fully
 * inside `area`; sizes larger than the area shrink to fit.
 */
export function layoutPile(
	sizes: readonly Size[],
	area: Rect,
	rng: Rng,
	tries = 8,
): Rect[] {
	const cols = 16;
	const rows = 10;
	const grid = new Array(cols * rows).fill(0);
	const cells = (r: Rect) => {
		const out: number[] = [];
		for (let i = 0; i < rows; i++) {
			const y = area.y + ((i + 0.5) / rows) * area.h;
			if (y < r.y || y >= r.y + r.h) continue;
			for (let j = 0; j < cols; j++) {
				const x = area.x + ((j + 0.5) / cols) * area.w;
				if (x >= r.x && x < r.x + r.w) out.push(i * cols + j);
			}
		}
		return out;
	};
	// Overshooting and clamping gives the edges as many windows as the middle.
	const along = (start: number, room: number) =>
		start + Math.max(0, Math.min(room, (rng() * 1.3 - 0.15) * room));
	return sizes.map((size) => {
		const w = Math.min(size.w, area.w);
		const h = Math.min(size.h, area.h);
		let best: Rect = null;
		let bestCost = Infinity;
		for (let t = 0; t < tries; t++) {
			const r = {
				x: along(area.x, area.w - w),
				y: along(area.y, area.h - h),
				w,
				h,
			};
			const hit = cells(r);
			const n = hit.length || 1;
			const depth = hit.reduce((sum, c) => sum + grid[c], 0) / n;
			const bare = hit.filter((c) => grid[c] === 0).length / n;
			// A little noise keeps the pile from looking tiled.
			const cost = depth - bare + rng() * 0.4;
			if (cost < bestCost) {
				best = r;
				bestCost = cost;
			}
		}
		for (const c of cells(best)) grid[c] += 1;
		return { x: Math.round(best.x), y: Math.round(best.y), w, h };
	});
}

/** A hiding box declared by a window's content, in content coordinates (scroll coordinates when the content scrolls). */
export type Slot = { pose: Pose; rect: Rect };

/** What the rules need to know about one window of the pile. */
export type PileWindow = {
	/** Catalogue kind, used to spread the hiders over different kinds of window. */
	kind: string;
	rect: Rect;
	/** Stacking order; higher draws in front. */
	z: number;
	/** Content box, relative to the window. */
	content: Rect;
	/** Full height of the content when it scrolls, or 0 when it does not. */
	scrollHeight: number;
	slots: Slot[];
	closed?: boolean;
};

export type Spot =
	| { kind: "slot"; win: number; slot: number }
	| { kind: "desk"; rect: Rect; pose: Pose; rot: number };

/**
 * True when a Clippy in `slot` can always be found: the window lies inside
 * `area`, and the slot lies inside the content box, or inside the scrolling
 * content without needing to scroll sideways.
 */
export function slotReachable(win: PileWindow, slot: Slot, area: Rect) {
	if (win.closed) return false;
	const r = slot.rect;
	if (!(r.w > 0 && r.h > 0)) return false;
	const height = Math.max(win.content.h, win.scrollHeight);
	return (
		contains(area, win.rect) &&
		contains(
			{ x: 0, y: 0, w: win.rect.w, h: win.rect.h },
			{ ...win.content, h: Math.min(win.content.h, win.rect.h) },
		) &&
		contains({ x: 0, y: 0, w: win.content.w, h: height }, r)
	);
}

/** Screen rect of a slot while its content is scrolled down by `scrollTop`. */
export function slotRect(win: PileWindow, slot: Slot, scrollTop = 0): Rect {
	return {
		x: win.rect.x + win.content.x + slot.rect.x,
		y: win.rect.y + win.content.y + slot.rect.y - scrollTop,
		w: slot.rect.w,
		h: slot.rect.h,
	};
}

/** Screen rect a spot occupies, with scrolling content at the top. */
export function spotRect(wins: readonly PileWindow[], spot: Spot): Rect {
	if (spot.kind === "desk") return spot.rect;
	const win = wins[spot.win];
	return slotRect(win, win.slots[spot.slot]);
}

/** Rects of the open windows drawn in front of window `i`, or of all of them for the desk. */
function coversOf(wins: readonly PileWindow[], i: number) {
	const z = i < 0 ? -Infinity : wins[i].z;
	return wins
		.filter((w, j) => j !== i && !w.closed && w.z > z)
		.map((w) => w.rect);
}

/**
 * How much of a spot shows before the player touches anything, from 0 (hidden
 * by windows or scrolled out of view) to 1 (in plain sight).
 */
export function exposure(wins: readonly PileWindow[], spot: Spot) {
	if (spot.kind === "desk") return 1 - coverage(spot.rect, coversOf(wins, -1));
	const win = wins[spot.win];
	const slot = win.slots[spot.slot];
	if (slot.rect.y + slot.rect.h > win.content.h) return 0;
	return 1 - coverage(slotRect(win, slot), coversOf(wins, spot.win));
}

/**
 * A random desk rect of `size` inside `area` whose coverage by the pile falls
 * within [`min`, `max`] and that keeps clear of `avoid`. Returns null when the
 * samples find no such place.
 */
export function deskSpot(
	wins: readonly PileWindow[],
	area: Rect,
	size: Size,
	rng: Rng,
	min: number,
	max: number,
	avoid: readonly Rect[] = [],
	samples = 80,
): Rect | null {
	if (size.w > area.w || size.h > area.h) return null;
	const covers = coversOf(wins, -1);
	for (let i = 0; i < samples; i++) {
		const r = {
			x: Math.round(area.x + rng() * (area.w - size.w)),
			y: Math.round(area.y + rng() * (area.h - size.h)),
			w: size.w,
			h: size.h,
		};
		if (avoid.some((a) => overlap(grow(a, 24), r) > 0)) continue;
		const c = coverage(r, covers);
		if (c >= min - 1e-9 && c <= max + 1e-9) return r;
	}
	return null;
}

/**
 * The desk rect of `size` inside `area` that the pile covers least, scanning
 * a grid of positions. Keeps clear of `avoid` when any position allows it.
 * Returns null only when `size` does not fit in `area`.
 */
export function leastCovered(
	wins: readonly PileWindow[],
	area: Rect,
	size: Size,
	rng: Rng,
	avoid: readonly Rect[] = [],
): Rect | null {
	if (size.w > area.w || size.h > area.h) return null;
	const covers = coversOf(wins, -1);
	const step = 16;
	let best: Rect = null;
	let bestCost = Infinity;
	for (let y = area.y; y <= area.y + area.h - size.h; y += step) {
		for (let x = area.x; x <= area.x + area.w - size.w; x += step) {
			const r = { x, y, ...size };
			const clash = avoid.some((a) => overlap(grow(a, 24), r) > 0) ? 2 : 0;
			// Noise breaks ties between equally bare places.
			const cost = coverage(r, covers, 6) + clash + rng() * 0.01;
			if (cost < bestCost) {
				best = r;
				bestCost = cost;
			}
		}
	}
	return best;
}

export type SpotOptions = {
	count?: number;
	/** Spots already in use, which new spots keep away from. */
	taken?: readonly Spot[];
	/** Chance that each hider waits behind the pile on the desk instead of inside a window. */
	deskChance?: number;
};

/**
 * Picks `count` distinct hiding spots that are all reachable: reachable window
 * slots (see `slotReachable`) and desk spots inside `area`. Spots prefer
 * different windows and kinds of window, at most one starts in plain sight,
 * and at most one is buried under the pile completely. Falls back to desk
 * spots when the windows run out of slots, so it always returns `count`
 * spots unless `area` cannot fit a desk spot at all.
 */
export function chooseSpots(
	wins: readonly PileWindow[],
	area: Rect,
	rng: Rng,
	{ count = HIDERS, taken = [], deskChance = 0.3 }: SpotOptions = {},
): Spot[] {
	const out: Spot[] = [];
	const all = () => [...taken, ...out];
	const usedWin = (i: number) =>
		all().some((s) => s.kind === "slot" && s.win === i);
	const usedKind = (kind: string) =>
		all().some((s) => s.kind === "slot" && wins[s.win].kind === kind);
	const plain = () => all().filter((s) => exposure(wins, s) > 0.6).length;
	const buried = () =>
		all().filter((s) => s.kind === "desk" && exposure(wins, s) === 0).length;
	const deskRects = () =>
		all()
			.filter((s) => s.kind === "desk")
			.map((s) => (s as Extract<Spot, { kind: "desk" }>).rect);

	let desk = 0;
	for (let i = 0; i < count; i++) if (rng() < deskChance) desk += 1;
	// At least one Clippy hides inside a window.
	desk = Math.min(desk, count - 1);

	const slots = shuffle(
		rng,
		wins.flatMap((w, i) =>
			w.slots.flatMap((s, j) =>
				slotReachable(w, s, area)
					? [{ kind: "slot" as const, win: i, slot: j }]
					: [],
			),
		),
	);
	for (const strict of [true, false]) {
		for (const s of slots) {
			if (out.length >= count - desk) break;
			if (usedWin(s.win)) continue;
			if (strict && usedKind(wins[s.win].kind)) continue;
			if (strict && plain() >= 1 && exposure(wins, s) > 0.6) continue;
			out.push(s);
		}
	}

	while (out.length < count) {
		const lie = rng() < 0.35;
		const pose = lie ? "lie" : "whole";
		const size = DESK_SIZE[pose];
		const bands: [number, number][] =
			buried() < 1 && rng() < 0.4
				? [
						[1, 1],
						[0.45, 0.92],
					]
				: [[0.45, 0.92]];
		bands.push([0.25, 0.97]);
		let rect: Rect = null;
		for (const [min, max] of bands) {
			rect = deskSpot(wins, area, size, rng, min, max, deskRects());
			if (rect) break;
		}
		rect ??= leastCovered(wins, area, size, rng, deskRects());
		if (!rect) break;
		out.push({
			kind: "desk",
			rect,
			pose,
			rot: Math.round(between(rng, -18, 18)),
		});
	}
	return shuffle(rng, out);
}

/**
 * Picks spots for decoys: reachable slots no hider uses, then desk spots
 * partly covered by the pile. `sizes` gives one desk size per desk decoy.
 */
export function chooseDecoys(
	wins: readonly PileWindow[],
	area: Rect,
	rng: Rng,
	taken: readonly Spot[],
	slotCount: number,
	sizes: readonly Size[],
): Spot[] {
	const used = new Set(
		taken.flatMap((s) => (s.kind === "slot" ? [`${s.win}:${s.slot}`] : [])),
	);
	const out: Spot[] = shuffle(
		rng,
		wins.flatMap((w, i) =>
			w.slots.flatMap((s, j) =>
				slotReachable(w, s, area) && !used.has(`${i}:${j}`)
					? [{ kind: "slot" as const, win: i, slot: j }]
					: [],
			),
		),
	).slice(0, slotCount);
	const avoid = taken.flatMap((s) => (s.kind === "desk" ? [s.rect] : []));
	for (const size of sizes) {
		const rect = deskSpot(wins, area, size, rng, 0.2, 0.9, avoid);
		if (!rect) continue;
		avoid.push(rect);
		out.push({
			kind: "desk",
			rect,
			pose: "whole",
			rot: Math.round(between(rng, -25, 25)),
		});
	}
	return out;
}

/** Placement of Clippy's SVG inside a hiding box, in px relative to the box. */
export type Frame = {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Rotation in degrees around (`ox`, `oy`), measured from the SVG's top-left. */
	rot: number;
	ox: number;
	oy: number;
};

// Fractions of Clippy's 200×320 SVG box: the neck line where peeking poses cut
// him off, and the bounds of his wire.
const NECK = { x: 0.5, y: 0.525 };
const WIRE_BOX = { x0: 0.27, x1: 0.73, y0: 0.23, y1: 0.925 };
const ASPECT = 1.6;

/**
 * Where Clippy's SVG goes so a `w`×`h` box shows him in `pose`. Peeking poses
 * put his neck on the cut edge; `whole` and `lie` fit his wire inside the box.
 */
export function poseFrame(pose: Pose, w: number, h: number): Frame {
	if (pose === "whole" || pose === "lie") {
		const lie = pose === "lie";
		const bw = lie ? h : w;
		const bh = lie ? w : h;
		const width = Math.min(
			bw / (WIRE_BOX.x1 - WIRE_BOX.x0),
			bh / ((WIRE_BOX.y1 - WIRE_BOX.y0) * ASPECT),
		);
		const height = width * ASPECT;
		const ox = ((WIRE_BOX.x0 + WIRE_BOX.x1) / 2) * width;
		const oy = ((WIRE_BOX.y0 + WIRE_BOX.y1) / 2) * height;
		return {
			left: w / 2 - ox,
			top: h / 2 - oy,
			width,
			height,
			rot: lie ? -90 : 0,
			ox,
			oy,
		};
	}
	const side = pose === "left" || pose === "right";
	const u = side ? Math.min(h, w / 1.15) : w;
	const width = u * 2;
	const height = width * ASPECT;
	const anchor = {
		up: { x: w / 2, y: h, rot: 0 },
		down: { x: w / 2, y: 0, rot: 180 },
		left: { x: 0, y: h * 0.6, rot: 70 },
		right: { x: w, y: h * 0.6, rot: -70 },
	}[pose];
	const ox = NECK.x * width;
	const oy = NECK.y * height;
	return {
		left: anchor.x - ox,
		top: anchor.y - oy,
		width,
		height,
		rot: anchor.rot,
		ox,
		oy,
	};
}

/**
 * Picks where a dialog of `size` goes: the centre of `view` when it keeps
 * clear of `avoid`, otherwise the candidate position that overlaps it least.
 */
export function placeDialog(
	size: Size,
	view: Size,
	avoid: readonly Rect[],
): Rect {
	const area = playArea(view);
	const xs = [0.5, 0.2, 0.8];
	const ys = [0.5, 0.18, 0.82];
	let best: Rect = null;
	let bestCost = Infinity;
	for (const fy of ys) {
		for (const fx of xs) {
			const r = clampRect(
				{
					x: Math.round(view.w * fx - size.w / 2),
					y: Math.round(view.h * fy - size.h / 2),
					...size,
				},
				area.w >= size.w && area.h >= size.h
					? area
					: { x: 0, y: 0, w: view.w, h: view.h },
			);
			const cost = avoid.reduce((sum, a) => sum + overlap(grow(a, 24), r), 0);
			if (cost < bestCost) {
				best = r;
				bestCost = cost;
			}
			if (cost === 0) return r;
		}
	}
	return best;
}
