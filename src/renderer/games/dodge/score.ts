// Best score for Dodge, shared by the arcade panel and the game overlay.
// Both pages load from the same app:// origin, so they share localStorage.

const KEY = "clippy.dodge.best";

/** Returns the stored best score, or 0 if storage is empty or unavailable. */
export function loadBest(): number {
	try {
		return Math.max(0, Number(localStorage.getItem(KEY)) || 0);
	} catch {
		return 0;
	}
}

/** Stores `score` if it beats the best. Returns true for a new record. */
export function saveBest(score: number): boolean {
	if (score <= loadBest()) return false;
	try {
		localStorage.setItem(KEY, String(Math.floor(score)));
	} catch {
		/* storage is optional */
	}
	return true;
}

/** Zero-padded six-digit score, like an arcade cabinet. */
export function formatScore(score: number) {
	return String(Math.min(999999, Math.floor(score))).padStart(6, "0");
}
