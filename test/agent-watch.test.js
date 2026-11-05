import assert from "node:assert/strict";
import { test } from "node:test";
import {
	capElements,
	elementIndex,
	fingerprint,
	formatSnapshot,
} from "../src/main/agent/snapshot.ts";
import { formatSse, SseParser } from "../src/main/agent/sse.ts";
import {
	TipGate,
	TriggerDetector,
	tipMinutes,
	WATCH,
} from "../src/main/agent/watcher.ts";

const win = (hwnd, extra = {}) => ({
	hwnd,
	title: `Window ${hwnd}`,
	process: "app.exe",
	pid: 10,
	className: "AppWindow",
	rect: { x: 0, y: 0, width: 800, height: 600 },
	isDialog: false,
	fullScreen: false,
	...extra,
});

const el = (id, extra = {}) => ({
	id,
	name: `Item ${id}`,
	type: "Button",
	rect: { x: 10, y: 10, width: 50, height: 20 },
	enabled: true,
	focused: false,
	focusChain: false,
	depth: 1,
	...extra,
});

test("capElements keeps the focus chain first and preserves order", () => {
	const els = Array.from({ length: 20 }, (_, i) =>
		el(`e${i + 1}`, { focusChain: i === 17 || i === 19 }),
	);
	const { elements, truncated } = capElements(els, 5);
	assert.equal(truncated, true);
	assert.deepEqual(
		elements.map((e) => e.id),
		["e1", "e2", "e3", "e18", "e20"],
	);
	assert.equal(capElements(els, 50).truncated, false);
});

test("formatSnapshot lists the active window and elements by id", () => {
	const text = formatSnapshot({
		foreground: win(1, { title: "Report.docx - Word", process: "winword.exe" }),
		windows: [win(1), win(2)],
		elements: [
			el("e1", { name: "Save", focused: true }),
			el("e2", { value: "hello", enabled: false }),
		],
		truncated: true,
	});
	assert.match(text, /Active window: "Report.docx - Word" \(winword.exe\)/);
	assert.match(text, /Window 2/);
	assert.match(text, /e1 Button "Save" \[10,10,50,20\] \(focused\)/);
	assert.match(text, /e2 Button "Item e2" .*value="hello" \(disabled\)/);
	assert.match(text, /truncated/);
	assert.equal(formatSnapshot(null), "UI list unavailable.");
});

test("fingerprints ignore movement but notice content changes", () => {
	const base = {
		foreground: win(1),
		windows: [],
		elements: [el("e1"), el("e2")],
		truncated: false,
	};
	const moved = {
		...base,
		elements: [
			el("e1", { rect: { x: 99, y: 99, width: 50, height: 20 } }),
			el("e2"),
		],
	};
	const renamed = {
		...base,
		elements: [el("e1", { name: "Other" }), el("e2")],
	};
	const typed = { ...base, elements: [el("e1"), el("e2", { value: "a" })] };
	assert.equal(fingerprint(base), fingerprint(moved));
	assert.notEqual(fingerprint(base), fingerprint(renamed));
	assert.notEqual(fingerprint(base), fingerprint(typed));
	assert.equal(elementIndex(base).get("e2").name, "Item e2");
});

test("a new window counts once it has stayed in front for 3 seconds", () => {
	const d = new TriggerDetector();
	assert.equal(d.foreground(win(1), 0), null);
	assert.equal(d.tick(WATCH.settleMs - 1), null);
	const t = d.tick(WATCH.settleMs);
	assert.equal(t.kind, "window");
	assert.equal(d.tick(WATCH.settleMs * 2), null, "fires once");
	// Switching away before it settles cancels it.
	d.foreground(win(2), 10_000);
	d.foreground(win(3), 11_000);
	assert.equal(d.tick(13_500), null);
	assert.equal(d.tick(14_000).window.hwnd, 3);
	// Re-reporting the same window does not restart anything.
	assert.equal(d.foreground(win(3), 20_000), null);
	assert.equal(d.tick(30_000), null);
});

test("dialogs trigger at once, and again once after 20 s idle", () => {
	const d = new TriggerDetector();
	const t = d.foreground(win(5, { isDialog: true, title: "Error" }), 0);
	assert.equal(t.kind, "dialog");
	assert.equal(d.idle(WATCH.idleDialogMs - 1), null);
	assert.equal(d.idle(WATCH.idleDialogMs).kind, "idle-dialog");
	assert.equal(d.idle(WATCH.idleDialogMs * 2), null, "once per dialog");
	d.foreground(win(6), 1000);
	assert.equal(d.idle(60_000), null, "not on normal windows");
});

test("three Ctrl+Z presses within 10 s trigger", () => {
	const d = new TriggerDetector();
	d.foreground(win(1), 0);
	assert.equal(d.undo(1000), null);
	assert.equal(d.undo(2000), null);
	assert.equal(d.undo(2500).kind, "undo");
	assert.equal(d.undo(3000), null, "count restarts");
	const e = new TriggerDetector();
	e.foreground(win(1), 0);
	e.undo(0);
	e.undo(9000);
	assert.equal(e.undo(10_500), null, "first press fell out of the window");
});

test("TipGate enforces conditions, spacing and muting", () => {
	const g = new TipGate();
	const trig = { kind: "window", window: win(1), reason: "r" };
	const ok = {
		enabled: true,
		taskRunning: false,
		petVisible: true,
		bubbleVisible: false,
		hasKey: true,
		tipMinutes: 3,
	};
	assert.equal(g.blocked(trig, ok, 0), null);
	for (const [k, v] of [
		["enabled", false],
		["taskRunning", true],
		["petVisible", false],
		["bubbleVisible", true],
		["hasKey", false],
	])
		assert.ok(g.blocked(trig, { ...ok, [k]: v }, 0), k);
	assert.ok(
		g.blocked({ ...trig, window: win(1, { fullScreen: true }) }, ok, 0),
	);
	g.evaluated(0);
	assert.ok(g.blocked(trig, ok, WATCH.evalGapMs - 1));
	assert.equal(g.blocked(trig, ok, WATCH.evalGapMs), null);
	g.shown(100_000);
	assert.ok(g.blocked(trig, ok, 100_000 + 3 * 60_000 - 1));
	assert.equal(g.blocked(trig, ok, 100_000 + 3 * 60_000), null);
	g.mute("APP.exe", 500_000);
	assert.equal(g.blocked(trig, ok, 600_000), "app muted");
	assert.equal(g.blocked(trig, ok, 500_000 + WATCH.muteMs), null);
});

test("tip interval is clamped to 1-30 whole minutes", () => {
	assert.equal(tipMinutes(3), 3);
	assert.equal(tipMinutes(0), 1);
	assert.equal(tipMinutes(99), 30);
	assert.equal(tipMinutes(2.6), 3);
	assert.equal(tipMinutes("5"), 3);
	assert.equal(tipMinutes(Number.NaN), 3);
});

test("SSE parser round-trips events across arbitrary chunk splits", () => {
	let seed = 5;
	const r = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	for (let i = 0; i < 200; i++) {
		const events = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, j) => ({
			event: `type.${j}`,
			data: JSON.stringify({
				n: j,
				text: "line one\nline: two ✓".slice(0, Math.floor(r() * 22)),
			}),
		}));
		let wire = formatSse(events);
		if (r() < 0.5) wire = wire.replace(/\n/g, "\r\n");
		const p = new SseParser();
		const out = [];
		let at = 0;
		while (at < wire.length) {
			const n = 1 + Math.floor(r() * 9);
			out.push(...p.push(wire.slice(at, at + n)));
			at += n;
		}
		out.push(...p.end());
		assert.deepEqual(out, events);
	}
	const p = new SseParser();
	assert.deepEqual(p.push(": ping\n\ndata: x\n"), []);
	assert.deepEqual(p.end(), [{ event: "message", data: "x" }]);
});
