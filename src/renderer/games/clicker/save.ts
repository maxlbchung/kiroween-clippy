// Clippy Clicker's saved factory, shared by the game page and the arcade's
// title card. Both load from the same app:// origin, so they share
// localStorage.

import { type Factory, newFactory, parseSave } from "./economy.js";

const KEY = "clippy.clicker.save";

/** The saved factory, or a new one if storage is empty, broken or unavailable. */
export function loadFactory(now = Date.now()): Factory {
	try {
		return parseSave(localStorage.getItem(KEY)) ?? newFactory(now);
	} catch {
		return newFactory(now);
	}
}

/** Stores `f`, stamped with `now`. Silently does nothing without storage. */
export function saveFactory(f: Factory, now = Date.now()) {
	f.savedAt = now;
	try {
		localStorage.setItem(KEY, JSON.stringify(f));
	} catch {
		/* storage is optional */
	}
}
