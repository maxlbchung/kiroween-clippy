// Coroutines and small math helpers shared by the arcade games. Coordinates
// are CSS px and time is in seconds.

export type Vec = { x: number; y: number };

/** A coroutine resumed once per frame with the frame's delta time. */
export type Script = Generator<void, void, number>;

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(xs: ArrayLike<T>): T =>
	xs[Math.floor(Math.random() * xs.length)];
export const clamp = (v: number, a: number, b: number) =>
	Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeInOut = (t: number) =>
	t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
/** Share of the remaining gap to close this frame when easing at `rate` per second. */
export const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Shortest signed difference between two angles, in radians. */
export function angleDiff(from: number, to: number) {
	return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function* wait(seconds: number): Script {
	let t = 0;
	while (t < seconds) t += yield;
}

/** Calls `fn` every frame with eased progress from 0 to 1. */
export function* tween(
	seconds: number,
	fn: (k: number, dt: number) => void,
	ease = easeInOut,
): Script {
	let t = 0;
	while (t < seconds) {
		const dt = yield;
		t += dt;
		fn(ease(Math.min(1, t / seconds)), dt);
	}
}

/** Moves `body` in a straight line to `to` over `seconds`. */
export function* flyTo(body: Vec, to: Vec, seconds: number): Script {
	const from = { x: body.x, y: body.y };
	yield* tween(seconds, (k) => {
		body.x = lerp(from.x, to.x, k);
		body.y = lerp(from.y, to.y, k);
	});
}

/** Advances every script in `list` by `dt` and removes the finished ones. */
export function stepScripts(list: Script[], dt: number) {
	for (let i = 0; i < list.length; i++) {
		if (list[i].next(dt).done) {
			list.splice(i, 1);
			i -= 1;
		}
	}
}

/** A body that leans into its horizontal motion and springs back from squash. */
export type Steerable = Vec & {
	/** x on the previous frame. */
	px: number;
	/** Smoothed horizontal speed, px per second. */
	vx: number;
	rot: number;
	/** Keeps `rot` as a script set it instead of leaning with motion. */
	lockRot: boolean;
	sx: number;
	sy: number;
};

/** Leans `body` into its horizontal motion and eases its scale back to 1. */
export function steer(body: Steerable, dt: number) {
	if (dt > 0) {
		const vx = (body.x - body.px) / dt;
		body.vx += (vx - body.vx) * smooth(12, dt);
	}
	body.px = body.x;
	if (!body.lockRot) {
		const target = clamp(body.vx * 0.0005, -0.4, 0.4);
		body.rot += angleDiff(body.rot, target) * smooth(10, dt);
	}
	const k = smooth(8, dt);
	body.sx += (1 - body.sx) * k;
	body.sy += (1 - body.sy) * k;
}
