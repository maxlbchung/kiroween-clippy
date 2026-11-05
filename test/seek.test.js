import assert from "node:assert/strict";
import { test } from "node:test";
import { seeded } from "../dist/renderer/games/random.js";
import {
	chooseDecoys,
	chooseSpots,
	contains,
	coverage,
	DESK_SIZE,
	exposure,
	HIDERS,
	HUD_BAND,
	layoutPile,
	MAX_WINDOWS,
	overlap,
	pileFull,
	placeDialog,
	playArea,
	poseFrame,
	slotReachable,
	spotRect,
} from "../dist/renderer/games/seek/layout.js";
import {
	EAGER_LIMIT,
	FIND_POINTS,
	MISS_PENALTY,
	roundScore,
	strayClick,
	TIME_LIMIT,
} from "../dist/renderer/games/seek/scoring.js";

const VIEWS = [
	{ w: 1024, h: 600 },
	{ w: 1280, h: 720 },
	{ w: 1440, h: 900 },
	{ w: 1920, h: 1080 },
	{ w: 2560, h: 1440 },
];
const SIZES = [
	{ w: 460, h: 350 },
	{ w: 340, h: 280 },
	{ w: 300, h: 220 },
	{ w: 200, h: 250 },
	{ w: 380, h: 270 },
	{ w: 300, h: 140 },
];
const KINDS = ["browser", "viewer", "notepad", "calc", "explorer", "error"];
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

/** A pile like the game's: windows with a mix of good and broken slots. */
function pile(view, seed) {
	const rng = seeded(seed);
	const area = playArea(view);
	const sizes = [];
	let total = 0;
	while (!pileFull(total, sizes.length, area)) {
		const s = SIZES[Math.floor(rng() * SIZES.length)];
		sizes.push(s);
		total += s.w * s.h;
	}
	const rects = layoutPile(sizes, area, rng);
	const wins = rects.map((rect, i) => {
		const content = { x: 4, y: 30, w: rect.w - 8, h: rect.h - 34 };
		const scrolls = i % 3 === 0;
		return {
			kind: KINDS[SIZES.indexOf(sizes[i])],
			rect,
			z: i + 1,
			content,
			scrollHeight: scrolls ? content.h * 3 : 0,
			slots: [
				{ pose: "up", rect: { x: 20, y: 20, w: 34, h: 34 } },
				{
					pose: "whole",
					rect: { x: content.w - 40, y: content.h - 70, w: 26, h: 62 },
				},
				// Below the fold: only reachable when the content scrolls.
				{
					pose: "left",
					rect: { x: 40, y: content.h + 80, w: 40, h: 34 },
				},
				// Sticks out of the content sideways: never reachable.
				{
					pose: "right",
					rect: { x: content.w - 10, y: 10, w: 40, h: 34 },
				},
			],
		};
	});
	return { area, wins, rng };
}

test("the play area keeps clear of the HUD band and the screen edges", () => {
	for (const view of VIEWS) {
		const area = playArea(view);
		assert.ok(area.y >= HUD_BAND);
		assert.ok(area.x > 0 && area.x + area.w < view.w);
		assert.ok(area.y + area.h < view.h);
	}
});

test("layoutPile keeps every window inside the play area and spreads them out", () => {
	for (const view of VIEWS) {
		for (const seed of SEEDS.slice(0, 10)) {
			const { area, wins } = pile(view, seed);
			for (const w of wins)
				assert.ok(contains(area, w.rect), `${view.w}x${view.h}`);
			const covered = coverage(
				area,
				wins.map((w) => w.rect),
				24,
			);
			// A capped pile on a huge screen leaves more desk showing.
			const min = wins.length >= MAX_WINDOWS ? 0.6 : 0.85;
			assert.ok(covered > min, `pile covers ${covered} of ${view.w}x${view.h}`);
		}
	}
});

test("layoutPile shrinks windows larger than the play area", () => {
	const area = playArea({ w: 400, h: 300 });
	const [r] = layoutPile([{ w: 900, h: 900 }], area, seeded(1));
	assert.ok(contains(area, r));
});

test("every round hides three Clippies in distinct, reachable spots", () => {
	for (const view of VIEWS) {
		const viewport = { x: 0, y: 0, w: view.w, h: view.h };
		for (const seed of SEEDS) {
			const { area, wins, rng } = pile(view, seed);
			const spots = chooseSpots(wins, area, rng);
			assert.equal(spots.length, HIDERS);
			const slotWins = spots.filter((s) => s.kind === "slot").map((s) => s.win);
			assert.equal(new Set(slotWins).size, slotWins.length, "one per window");
			assert.ok(slotWins.length >= 1, "at least one hides inside a window");
			for (const s of spots) {
				const r = spotRect(wins, s);
				if (s.kind === "slot") {
					const win = wins[s.win];
					assert.ok(slotReachable(win, win.slots[s.slot], area));
					assert.notEqual(win.slots[s.slot].pose, "right", "clipped slot");
					// Scrolled-out slots must sit inside the scrolling content.
					if (win.slots[s.slot].rect.y > win.content.h)
						assert.ok(win.scrollHeight > win.content.h);
					else assert.ok(contains(viewport, r));
				} else {
					assert.ok(contains(area, r), "desk spot inside the play area");
					assert.ok(r.y >= HUD_BAND);
				}
			}
			const desk = spots.filter((s) => s.kind === "desk");
			for (let i = 0; i < desk.length; i++)
				for (let j = i + 1; j < desk.length; j++)
					assert.equal(overlap(desk[i].rect, desk[j].rect), 0);
			const buried = desk.filter((s) => exposure(wins, s) === 0);
			assert.ok(buried.length <= 1, "at most one fully buried");
		}
	}
});

test("hiding spots vary from round to round", () => {
	const { area, wins } = pile({ w: 1440, h: 900 }, 3);
	const seen = new Set();
	for (const seed of SEEDS) {
		for (const s of chooseSpots(wins, area, seeded(seed)))
			seen.add(s.kind === "slot" ? `${s.win}:${s.slot}` : "desk");
	}
	assert.ok(seen.size > 10, `only ${seen.size} different spots`);
});

test("closed windows, windows off the play area and clipped slots are never used", () => {
	const { area, wins, rng } = pile({ w: 1440, h: 900 }, 11);
	for (const [i, w] of wins.entries()) {
		if (i % 2 === 0) w.closed = true;
		else if (i % 3 === 0) w.rect = { ...w.rect, x: -50 };
	}
	for (let round = 0; round < 20; round++) {
		for (const s of chooseSpots(wins, area, rng)) {
			if (s.kind !== "slot") continue;
			assert.ok(!wins[s.win].closed);
			assert.ok(contains(area, wins[s.win].rect));
		}
	}
});

test("without any usable slot, all three hide on the desk", () => {
	const { area, wins, rng } = pile({ w: 1280, h: 720 }, 5);
	for (const w of wins) w.slots = [];
	const spots = chooseSpots(wins, area, rng);
	assert.equal(spots.length, HIDERS);
	for (const s of spots) {
		assert.equal(s.kind, "desk");
		assert.ok(contains(area, s.rect));
	}
});

test("a relocated Clippy avoids the windows already taken", () => {
	const { area, wins, rng } = pile({ w: 1920, h: 1080 }, 9);
	const taken = chooseSpots(wins, area, rng);
	for (let i = 0; i < 20; i++) {
		const [next] = chooseSpots(wins, area, rng, { count: 1, taken });
		assert.ok(next);
		if (next.kind === "slot")
			assert.ok(!taken.some((t) => t.kind === "slot" && t.win === next.win));
	}
});

test("decoys use free slots and partly covered desk spots", () => {
	const { area, wins, rng } = pile({ w: 1440, h: 900 }, 21);
	const hiders = chooseSpots(wins, area, rng);
	const decoys = chooseDecoys(wins, area, rng, hiders, 6, [
		{ w: 48, h: 26 },
		{ w: 30, h: 40 },
	]);
	const key = (s) => (s.kind === "slot" ? `${s.win}:${s.slot}` : null);
	const used = new Set(hiders.map(key));
	for (const d of decoys) {
		if (d.kind === "slot") {
			assert.ok(!used.has(key(d)));
			assert.ok(slotReachable(wins[d.win], wins[d.win].slots[d.slot], area));
		} else assert.ok(contains(area, d.rect));
	}
});

test("peeking poses cut Clippy off at the box edge they emerge from", () => {
	const neck = (f) => {
		const rad = (f.rot * Math.PI) / 180;
		// The neck is the rotation origin, so it stays put.
		return { x: f.left + f.ox, y: f.top + f.oy, rad };
	};
	const w = 40;
	const h = 36;
	assert.deepEqual(
		{ x: neck(poseFrame("up", w, h)).x, y: neck(poseFrame("up", w, h)).y },
		{ x: w / 2, y: h },
	);
	assert.equal(neck(poseFrame("down", w, h)).y, 0);
	assert.equal(neck(poseFrame("left", w, h)).x, 0);
	assert.equal(neck(poseFrame("right", w, h)).x, w);
	assert.equal(poseFrame("down", w, h).rot, 180);
});

test("whole and lying poses fit Clippy's wire inside the box", () => {
	for (const pose of ["whole", "lie"]) {
		const box = DESK_SIZE[pose];
		const f = poseFrame(pose, box.w, box.h);
		// Wire bounds as fractions of the SVG box.
		const wire = {
			w: (0.73 - 0.27) * f.width,
			h: (0.925 - 0.23) * f.height,
		};
		const [bw, bh] = pose === "lie" ? [box.h, box.w] : [box.w, box.h];
		assert.ok(wire.w <= bw + 0.01 && wire.h <= bh + 0.01, pose);
		assert.ok(
			wire.w >= bw - 0.01 || wire.h >= bh - 0.01,
			`${pose} fills the box`,
		);
	}
});

test("dialogs dodge the revealed spots when there is room", () => {
	const view = { w: 1440, h: 900 };
	const size = { w: 340, h: 300 };
	const center = placeDialog(size, view, []);
	assert.equal(Math.round(center.x + size.w / 2), view.w / 2);
	const avoid = [{ x: 700, y: 440, w: 40, h: 40 }];
	const moved = placeDialog(size, view, avoid);
	assert.equal(overlap(moved, avoid[0]), 0);
	assert.ok(contains({ x: 0, y: 0, ...view }, moved));
});

test("scores reward fast, clean rounds on Dodge's scale", () => {
	const tally = { found: 3, misses: 0, hints: 0, won: true };
	const fast = roundScore({ ...tally, timeLeft: 70 });
	const typical = roundScore({ ...tally, misses: 2, timeLeft: 40 });
	const slow = roundScore({ ...tally, timeLeft: 5 });
	const lost = roundScore({ ...tally, found: 2, won: false, timeLeft: 0 });
	assert.ok(fast > typical && typical > slow && slow > lost);
	assert.ok(typical >= 500 && typical <= 1100, `typical round ${typical}`);
	assert.ok(fast <= 1500);
	assert.equal(lost, 2 * FIND_POINTS);
	assert.equal(
		roundScore({ ...tally, found: 0, misses: 50, won: false, timeLeft: 0 }),
		0,
	);
	assert.equal(
		roundScore({ ...tally, misses: 1, timeLeft: 0 }),
		3 * FIND_POINTS - MISS_PENALTY,
	);
	assert.ok(TIME_LIMIT >= 90 && TIME_LIMIT <= 120);
});

test("calm clicks are free but spam clicking counts as misses", () => {
	let heat = 0;
	for (let i = 0; i < 30; i++) {
		const r = strayClick(heat, 1.1);
		assert.ok(!r.miss);
		heat = r.heat;
	}
	heat = 0;
	let misses = 0;
	for (let i = 0; i < 10; i++) {
		const r = strayClick(heat, 0.15);
		heat = r.heat;
		if (r.miss) misses += 1;
	}
	assert.ok(misses >= 10 - EAGER_LIMIT, `${misses} misses`);
	// Cooling down resets the streak.
	assert.ok(!strayClick(heat, 10).miss);
});
