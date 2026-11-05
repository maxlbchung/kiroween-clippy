// Random helpers shared by the arcade games. Each takes an optional generator,
// so tests and previews can make results repeatable with `seeded`.

/** Returns a float in [0, 1), like `Math.random`. */
export type Rng = () => number;

/** Seeded generator for repeatable results (mulberry32). */
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

/** A float in [a, b). */
export const rand = (a: number, b: number, rng: Rng = Math.random) =>
	a + rng() * (b - a);

export const pick = <T>(xs: ArrayLike<T>, rng: Rng = Math.random): T =>
	xs[Math.floor(rng() * xs.length)];

/** Returns a shuffled copy of `xs`. */
export function shuffle<T>(xs: readonly T[], rng: Rng = Math.random): T[] {
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
