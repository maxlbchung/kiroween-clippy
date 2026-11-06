import assert from "node:assert/strict";
import { test } from "node:test";

// The engine imports renderer helpers that read the preload API on load.
globalThis.window ??= { clippy: {} };
const { bulletDist, CLIP_HALF_LEN, HIT_R, World } = await import(
	"../src/renderer/games/dodge/engine.ts"
);

function makeWorld(cursor) {
	return new World({
		w: 1000,
		h: 800,
		scale: 1,
		dpr: 1,
		hooks: { say() {}, sound() {} },
		winLayer: null,
		cursor,
		clippyAt: { x: 900, y: 700 },
	});
}

function bullet(fields) {
	return {
		kind: "letter",
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		r: 9,
		rot: 0,
		vr: 0,
		owner: 0,
		age: 0,
		life: 10,
		drag: 1,
		grazed: true,
		...fields,
	};
}

test("the world follows the live cursor instead of a copy", () => {
	const cursor = { x: 100, y: 100 };
	const world = makeWorld(cursor);
	cursor.x = 600;
	cursor.y = 400;
	assert.equal(world.cursor, cursor);
	assert.deepEqual(world.cursor, { x: 600, y: 400 });
});

test("a bullet aimed at the starting spot misses a cursor that moved away", () => {
	const cursor = { x: 100, y: 100 };
	const world = makeWorld(cursor);
	world.bullets.push(bullet({ x: 100, y: 100, r: 26 }));
	cursor.x = 400;
	assert.equal(world.collide(), null);
	cursor.x = 100;
	assert.deepEqual(world.collide(), { x: 100, y: 100 });
});

test("a fast bullet cannot tunnel through the cursor in one step", () => {
	const cursor = { x: 500, y: 400 };
	const world = makeWorld(cursor);
	world.bullets.push(bullet({ x: 440, y: 400, vx: 2400 }));
	world.updateBullets(0.05);
	assert.ok(
		world.bullets[0].x > 500 + 9 + HIT_R,
		"bullet ends past the cursor",
	);
	assert.notEqual(world.collide(), null);
});

test("a bullet that passes beside the cursor does not hit", () => {
	const cursor = { x: 500, y: 400 };
	const world = makeWorld(cursor);
	world.bullets.push(bullet({ x: 440, y: 430, vx: 2400 }));
	world.updateBullets(0.05);
	assert.equal(world.collide(), null);
});

test("paper clips hit along their length, not just at their centre", () => {
	const clip = bullet({ kind: "clip", x: 0, y: 0, vx: 0, vy: 250, r: 5 });
	const nearTip = { x: 0, y: CLIP_HALF_LEN + 4 };
	assert.ok(bulletDist(clip, nearTip) < clip.r + HIT_R);
	const beside = { x: clip.r + HIT_R + 1, y: 0 };
	assert.ok(bulletDist(clip, beside) >= clip.r + HIT_R);
	const pastTip = { x: 0, y: CLIP_HALF_LEN + clip.r + HIT_R + 1 };
	assert.ok(bulletDist(clip, pastTip) >= clip.r + HIT_R);
});
