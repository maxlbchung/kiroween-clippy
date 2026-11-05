// UI snapshots read through Windows UI Automation: their shape, the cap on
// element count, the compact text form sent to models, and a fingerprint for
// spotting UI changes. Free of Electron imports.

import type { Rect } from "../../shared/types.js";

export type WindowInfo = {
	hwnd: number;
	title: string;
	process: string;
	pid: number;
	className: string;
	rect: Rect;
	isDialog: boolean;
	fullScreen: boolean;
};

export type UiElement = {
	id: string;
	name: string;
	type: string;
	rect: Rect;
	enabled: boolean;
	focused: boolean;
	/** True for the focused element and its ancestors. */
	focusChain: boolean;
	value?: string;
	depth: number;
};

export type UiSnapshot = {
	foreground: WindowInfo | null;
	windows: WindowInfo[];
	elements: UiElement[];
	truncated: boolean;
};

export const MAX_ELEMENTS = 500;
const MAX_NAME = 80;
const MAX_WINDOWS = 15;

/**
 * Caps `elements` at `max`, keeping focus-chain elements first and the rest
 * in their original order.
 */
export function capElements(
	elements: UiElement[],
	max = MAX_ELEMENTS,
): { elements: UiElement[]; truncated: boolean } {
	if (elements.length <= max) return { elements, truncated: false };
	const chain = elements.filter((e) => e.focusChain);
	const rest = elements.filter((e) => !e.focusChain);
	const keep = new Set([...chain, ...rest].slice(0, max));
	return {
		elements: elements.filter((e) => keep.has(e)),
		truncated: true,
	};
}

const clip = (s: string, n = MAX_NAME) =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;
const q = (s: string) => JSON.stringify(clip(s.replace(/\s+/g, " ").trim()));
const box = (r: Rect) =>
	`[${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}]`;

/** Compact text form of a snapshot for a model prompt. */
export function formatSnapshot(snap: UiSnapshot | null): string {
	if (!snap) return "UI list unavailable.";
	const lines: string[] = [];
	const fg = snap.foreground;
	lines.push(
		fg
			? `Active window: ${q(fg.title || "(untitled)")} (${fg.process || "unknown"})${fg.isDialog ? " dialog" : ""} ${box(fg.rect)}`
			: "Active window: none",
	);
	const others = snap.windows.filter((w) => w.hwnd !== fg?.hwnd);
	if (others.length) {
		lines.push("Other windows:");
		for (const w of others.slice(0, MAX_WINDOWS))
			lines.push(`- ${q(w.title)} (${w.process}) ${box(w.rect)}`);
	}
	lines.push(
		"UI elements of the active window (id, type, name, [x,y,width,height] in screen coordinates):",
	);
	if (!snap.elements.length) lines.push("(none readable)");
	for (const e of snap.elements) {
		const flags = [
			e.focused ? "focused" : "",
			e.enabled ? "" : "disabled",
		].filter(Boolean);
		const value = e.value ? ` value=${q(e.value)}` : "";
		const indent = "  ".repeat(Math.min(6, e.depth));
		lines.push(
			`${indent}${e.id} ${e.type} ${q(e.name)} ${box(e.rect)}${value}${flags.length ? ` (${flags.join(", ")})` : ""}`,
		);
	}
	if (snap.truncated) lines.push("(list truncated)");
	return lines.join("\n");
}

/**
 * Hash of what the user can change: the active window and each element's
 * name, type, value, state and focus. Ignores positions so scrolling a
 * window by a pixel does not count as a change.
 */
export function fingerprint(snap: UiSnapshot | null): string {
	if (!snap) return "none";
	let h = 5381;
	const feed = (s: string) => {
		for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	};
	feed(`${snap.foreground?.hwnd ?? 0}|${snap.foreground?.title ?? ""}`);
	for (const e of snap.elements)
		feed(
			`|${e.type}:${e.name}:${e.value ?? ""}:${e.enabled ? 1 : 0}${e.focused ? "f" : ""}`,
		);
	return (h >>> 0).toString(36);
}

/** Element lookup for validating Action targets. */
export function elementIndex(
	snap: UiSnapshot | null,
): Map<string, { rect: Rect; name: string }> {
	const map = new Map<string, { rect: Rect; name: string }>();
	for (const e of snap?.elements ?? [])
		map.set(e.id, { rect: e.rect, name: e.name });
	return map;
}
