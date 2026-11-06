import assert from "node:assert/strict";
import { test } from "node:test";
import {
	footprint,
	inside,
	overlaps,
	placeNear,
	titleBarSide,
	truncateTitle,
	walkDuration,
} from "../src/main/agent/geometry.ts";

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

test("Clippy lands inside the work area and clear of the target", () => {
	const r = rng(11);
	let fallbacks = 0;
	for (let i = 0; i < 2000; i++) {
		const wa = {
			x: Math.floor(r() * 3000) - 1000,
			y: Math.floor(r() * 200),
			width: 800 + Math.floor(r() * 2400),
			height: 600 + Math.floor(r() * 1000),
		};
		const tw = 4 + Math.floor(r() * wa.width * (r() < 0.1 ? 1 : 0.4));
		const th = 4 + Math.floor(r() * wa.height * (r() < 0.1 ? 1 : 0.4));
		const target = {
			x: wa.x + Math.floor(r() * Math.max(1, wa.width - tw)),
			y: wa.y + Math.floor(r() * Math.max(1, wa.height - th)),
			width: tw,
			height: th,
		};
		const scale = [0.8, 1, 1.25][i % 3];
		const { pos, fallback } = placeNear(target, scale, wa);
		const fp = footprint(pos, scale);
		assert.ok(inside(fp, wa), `footprint outside work area (case ${i})`);
		if (fallback) fallbacks++;
		else assert.ok(!overlaps(fp, target), `overlaps target (case ${i})`);
	}
	assert.ok(fallbacks < 400, `too many fallbacks: ${fallbacks}`);
});

test("a target covering the screen sends Clippy to the farthest corner", () => {
	const wa = { x: 0, y: 0, width: 1920, height: 1040 };
	const target = { x: 0, y: 0, width: 1750, height: 1040 };
	const { pos, fallback } = placeNear(target, 1, wa);
	assert.equal(fallback, true);
	const fp = footprint(pos, 1);
	assert.ok(inside(fp, wa));
	assert.ok(fp.x + fp.width > 1800, "picked the right-hand corner");
});

test("walk duration stays within 300-1000 ms", () => {
	assert.equal(walkDuration({ x: 0, y: 0 }, { x: 0, y: 0 }), 300);
	assert.equal(walkDuration({ x: 0, y: 0 }, { x: 5000, y: 0 }), 1000);
	const mid = walkDuration({ x: 0, y: 0 }, { x: 600, y: 0 });
	assert.ok(mid > 300 && mid < 1000);
});

test("titles are cut to 60 characters with an ellipsis", () => {
	assert.equal(truncateTitle("  Click   Save  "), "Click Save");
	const long = "x".repeat(80);
	const t = truncateTitle(long);
	assert.equal(t.length, 60);
	assert.ok(t.endsWith("…"));
	assert.equal(truncateTitle("y".repeat(60)), "y".repeat(60));
});

test("the title bar moves below targets at the top edge", () => {
	const d = { x: 0, y: 0, width: 1920, height: 1080 };
	assert.equal(
		titleBarSide({ x: 10, y: 5, width: 50, height: 20 }, d, 30),
		"below",
	);
	assert.equal(
		titleBarSide({ x: 10, y: 300, width: 50, height: 20 }, d, 30),
		"above",
	);
	assert.equal(
		titleBarSide({ x: 10, y: 20, width: 50, height: 20 }, { ...d, y: -10 }, 30),
		"above",
	);
});
