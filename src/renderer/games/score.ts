// Best scores for arcade games, shared by the arcade panel and the game
// overlays. Every page loads from the same app:// origin, so they share
// localStorage.

import type { GameId } from "../../shared/types.js";

const key = (id: GameId) => `clippy.${id}.best`;

/** Returns the stored best score for `id`, or 0 if storage is empty or unavailable. */
export function loadBest(id: GameId): number {
	try {
		return Math.max(0, Number(localStorage.getItem(key(id))) || 0);
	} catch {
		return 0;
	}
}

/** Stores `score` as the best for `id` if it beats it. Returns true for a new record. */
export function saveBest(id: GameId, score: number): boolean {
	if (score <= loadBest(id)) return false;
	try {
		localStorage.setItem(key(id), String(Math.floor(score)));
	} catch {
		/* storage is optional */
	}
	return true;
}

/** Zero-padded six-digit score, like an arcade cabinet. */
export function formatScore(score: number) {
	return String(Math.min(999999, Math.floor(score))).padStart(6, "0");
}
