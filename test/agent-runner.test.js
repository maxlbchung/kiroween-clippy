import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelError } from "../src/main/agent/model.ts";
import {
	latestScreenOnly,
	STEP_LIMITS,
	TaskRunner,
	TURN_LIMITS,
} from "../src/main/agent/runner.ts";

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const SAVE = { x: 100, y: 100, width: 80, height: 30 };

const snapWith = (els) => ({
	foreground: {
		hwnd: 1,
		title: "Doc - Editor",
		process: "editor.exe",
		pid: 2,
		className: "Ed",
		rect: DISPLAY,
		isDialog: false,
		fullScreen: false,
	},
	windows: [],
	elements: els.map(([name, rect], i) => ({
		id: `e${i + 1}`,
		name,
		type: "Button",
		rect,
		enabled: true,
		focused: false,
		focusChain: false,
		depth: 1,
	})),
	truncated: false,
});

function fakeScreen({
	canAct = true,
	elements = [["Save", SAVE]],
	takeoverFails = false,
} = {}) {
	return {
		canAct,
		performed: [],
		watching: [],
		takeovers: [],
		async takeover(on) {
			this.takeovers.push(on);
			if (on && takeoverFails) throw new Error("no hooks");
		},
		cbs: new Set(),
		current: snapWith(elements),
		async snapshot() {
			return structuredClone(this.current);
		},
		async screenshot() {
			return {
				image: { type: "image", mime: "image/jpeg", data: "AAAA" },
				width: 960,
				height: 540,
				display: DISPLAY,
			};
		},
		displays: () => [DISPLAY],
		async perform(cmd) {
			this.performed.push({ ...cmd, at: Date.now() });
		},
		elementRect: async () => null,
		watchInput(on) {
			this.watching.push(on);
		},
		onUserInput(cb) {
			this.cbs.add(cb);
			return () => this.cbs.delete(cb);
		},
		emit(e) {
			for (const cb of this.cbs) cb(e);
		},
	};
}

/** `answer(text, buttons)` decides prompt answers; a promise that never settles means no answer. */
function fakeStage({ answer = () => null, onWalk = () => {} } = {}) {
	return {
		outlines: [],
		bubbles: [],
		walks: 0,
		homes: 0,
		helpers: [],
		banners: [],
		moods: [],
		async helper(spec) {
			this.helpers.push(spec);
		},
		banner(text) {
			this.banners.push(text);
		},
		outlineCbs: new Set(),
		outline(spec) {
			this.outlines.push(spec && { ...spec, at: Date.now() });
		},
		say(text, buttons) {
			this.bubbles.push({ text, buttons: buttons?.map((b) => b.id) ?? [] });
			if (!buttons?.length) return new Promise(() => {});
			return Promise.resolve(
				answer(
					text,
					buttons.map((b) => b.id),
				),
			);
		},
		hides: 0,
		hideBubble() {
			this.hides++;
		},
		async walkTo() {
			this.walks++;
			onWalk(this.walks);
		},
		async goHome() {
			this.homes++;
		},
		mood(m) {
			this.moods.push(m);
		},
		onOutlineButton(cb) {
			this.outlineCbs.add(cb);
			return () => this.outlineCbs.delete(cb);
		},
		press(button) {
			for (const cb of this.outlineCbs) cb(button);
		},
	};
}

let callId = 0;
const call = (name, input = {}) => ({
	text: "",
	calls: [{ id: `c${++callId}`, name, input }],
	native: [],
	stop: "tool",
});
const finish = (summary = "All done.", success = true) =>
	call("finish", { success, summary });

/** Model that plays `script` (replies or functions of the request) in order, then finishes. */
function fakeModel(script) {
	const requests = [];
	return {
		requests,
		provider: "openai",
		async complete(req) {
			requests.push(
				structuredClone({ ...req, signal: undefined, onText: undefined }),
			);
			const next = script.shift() ?? finish();
			const reply = typeof next === "function" ? next(req) : next;
			if (reply instanceof Error) throw reply;
			return reply;
		},
	};
}

const FAST = {
	outlineLeadMs: 40,
	settleMs: 1,
	commandSettleMs: 1,
	confirmMs: 60,
	guideStepMs: 300,
	clickCheckMs: 1,
	keyIdleMs: 5,
	pollMs: 25,
	trackMs: 10_000,
};

function run({
	mode = "do",
	script,
	screen = fakeScreen(),
	stage = fakeStage(),
	signal,
	local,
} = {}) {
	const model = fakeModel(script);
	const runner = new TaskRunner({ screen, stage, timing: FAST, local });
	const result = runner.run(
		{ goal: "Save the file", mode, client: model, model: "m" },
		signal ?? new AbortController().signal,
	);
	return { result, model, screen, stage };
}

const click = (target = "e1", extra = {}) =>
	call("click", { target, explanation: "Click Save", ...extra });

test("Do_Mode outlines, waits, clicks the target's center and finishes", async () => {
	const { result, screen, stage, model } = run({
		script: [click(), finish("Saved!")],
	});
	const out = await result;
	assert.deepEqual(out, { success: true, summary: "Saved!", reason: "done" });
	assert.equal(screen.performed.length, 1);
	const p = screen.performed[0];
	assert.deepEqual(
		{ kind: p.kind, x: p.x, y: p.y, button: p.button, double: p.double },
		{ kind: "click", x: 140, y: 115, button: "left", double: false },
	);
	const shown = stage.outlines.find((o) => o);
	assert.deepEqual(shown.rect, SAVE);
	assert.ok(
		p.at - shown.at >= FAST.outlineLeadMs - 2,
		"outline shows before the click",
	);
	assert.equal(stage.walks, 0, "the Pet stays home");
	assert.deepEqual(stage.helpers, [
		{},
		{ at: { x: 140, y: 115 } },
		{ act: "click" },
		null,
	]);
	assert.deepEqual(screen.takeovers, [true, false]);
	assert.match(stage.banners[0], /Esc/);
	assert.equal(stage.banners.at(-1), null);
	assert.match(stage.bubbles[0].text, /Esc/);
	assert.equal(stage.homes, 1);
	assert.equal(stage.outlines.at(-1), null, "outline removed at the end");
	assert.ok(stage.hides >= 1, "the last step bubble is hidden");
	assert.deepEqual(screen.watching, [true, false]);
	assert.ok(stage.moods.includes("thinking"));
	// The model saw the screen and only Do_Mode tools.
	assert.match(model.requests[0].history[0].parts[0].text, /e1 Button "Save"/);
	assert.ok(model.requests[0].tools.some((t) => t.name === "click"));
	assert.ok(!model.requests[0].tools.some((t) => t.name === "guide_step"));
	assert.equal(model.requests[0].requireTool, true);
});

test("a risky click asks first; No ends the task without clicking", async () => {
	let asked = null;
	const stage = fakeStage({
		answer: (text, ids) => {
			asked = { text, ids };
			return "no";
		},
	});
	const { result, screen } = run({
		script: [click("e1", { risky: true })],
		stage,
	});
	const out = await result;
	assert.equal(out.reason, "declined");
	assert.equal(screen.performed.length, 0);
	assert.deepEqual(asked.ids, ["yes", "no"]);
	assert.match(asked.text, /Click Save/);
});

test("a risky target name triggers confirmation, and Yes performs it", async () => {
	const screen = fakeScreen({ elements: [["Send", SAVE]] });
	const stage = fakeStage({ answer: () => "yes" });
	const { result } = run({ script: [click()], screen, stage });
	assert.equal((await result).success, true);
	assert.equal(screen.performed.length, 1);
	assert.ok(stage.bubbles.some((b) => b.buttons.includes("yes")));
});

test("an unanswered confirmation counts as No", async () => {
	const stage = fakeStage({ answer: () => new Promise(() => {}) });
	const { result, screen } = run({
		script: [click("e1", { risky: true })],
		stage,
	});
	const out = await result;
	assert.equal(out.reason, "declined");
	assert.equal(screen.performed.length, 0);
});

test("invalid targets are reported to the model, then the task ends after 3 retries", async () => {
	const { result, model, screen } = run({
		script: [click("e99"), click("e98"), click("e97"), click("e96")],
	});
	const out = await result;
	assert.equal(out.success, false);
	assert.equal(out.reason, "error");
	assert.equal(model.requests.length, 4);
	assert.equal(screen.performed.length, 0);
	const toolTurn = model.requests[1].history.at(-1);
	assert.equal(toolTurn.role, "tool");
	assert.equal(toolTurn.results[0].isError, true);
	assert.match(toolTurn.results[0].text, /e99/);
});

test("a valid step resets the retry count", async () => {
	const { result, screen } = run({
		script: [
			click("e99"),
			click("e98"),
			click("e97"),
			click(),
			click("e96"),
			finish(),
		],
	});
	assert.equal((await result).success, true);
	assert.equal(screen.performed.length, 1);
});

test("text without a tool call gets a nudge, then fails after 3", async () => {
	const text = { text: "Hmm", calls: [], native: [], stop: "end" };
	const { result, model } = run({ script: [text, text, text, text] });
	assert.equal((await result).reason, "error");
	assert.equal(
		model.requests[1].history.at(-1).parts[0].text,
		"Call exactly one of the tools to continue.",
	);
});

test("guide-only tools are refused in Do_Mode", async () => {
	const { result, model } = run({
		script: [
			call("guide_step", { target: "e1", title: "t", text: "x", total: 1 }),
			finish(),
		],
	});
	await result;
	assert.match(
		model.requests[1].history.at(-1).results[0].text,
		/not available/,
	);
});

test("Do_Mode stops at its step limit", async () => {
	const script = Array.from({ length: STEP_LIMITS.do + 5 }, () => click());
	const { result, screen } = run({ script });
	const out = await result;
	assert.equal(out.reason, "limit");
	assert.equal(screen.performed.length, STEP_LIMITS.do);
});

test("a confirmation hands input back while it waits, then takes it again", async () => {
	const screen = fakeScreen();
	let held = null;
	const stage = fakeStage({
		answer: () => {
			held = screen.takeovers.at(-1);
			return "yes";
		},
	});
	const { result } = run({
		script: [click("e1", { risky: true }), finish()],
		screen,
		stage,
	});
	assert.equal((await result).success, true);
	assert.equal(held, false, "the user can answer");
	assert.deepEqual(screen.takeovers, [true, false, true, false]);
	assert.equal(screen.performed.length, 1);
});

test("a failed takeover ends the task before any input", async () => {
	const screen = fakeScreen({ takeoverFails: true });
	const { result, model, stage } = run({ script: [click()], screen });
	const out = await result;
	assert.equal(out.reason, "error");
	assert.match(out.summary, /mouse and keyboard/);
	assert.equal(model.requests.length, 0);
	assert.equal(screen.performed.length, 0);
	assert.equal(stage.helpers.at(-1), null);
});

test("aborting a Do_Mode task releases the takeover and removes baby Clippy", async () => {
	const ctrl = new AbortController();
	const screen = fakeScreen();
	const { result, stage } = run({
		script: [
			() => {
				ctrl.abort();
				return click();
			},
		],
		screen,
		signal: ctrl.signal,
	});
	assert.equal((await result).reason, "cancelled");
	assert.equal(screen.performed.length, 0);
	assert.equal(screen.takeovers.at(-1), false);
	assert.equal(stage.helpers.at(-1), null);
});

const guideStep = (extra = {}) =>
	call("guide_step", {
		target: "e1",
		title: "Save it",
		text: "Click Save.",
		total: 2,
		...extra,
	});

test("Guide_Mode frames the step and advances when the user clicks the target", async () => {
	const screen = fakeScreen();
	const stage = fakeStage({
		onWalk: () =>
			setTimeout(() => screen.emit({ kind: "click", x: 120, y: 110 }), 5),
	});
	const { result, model } = run({
		mode: "guide",
		script: [guideStep(), finish("Nice!")],
		screen,
		stage,
	});
	const out = await result;
	assert.equal(out.success, true);
	assert.equal(screen.performed.length, 0, "guide mode never sends input");
	const o = stage.outlines.find((x) => x);
	assert.deepEqual(o.step, { n: 1, total: 2 });
	assert.equal(o.title, "Save it");
	assert.ok(stage.bubbles.some((b) => b.text === "Click Save."));
	assert.match(model.requests[1].history.at(-1).results[0].text, /acted/);
	assert.ok(!model.requests[0].tools.some((t) => t.name === "click"));
});

test("Guide_Mode notices UI changes from keyboard work", async () => {
	const screen = fakeScreen();
	const stage = fakeStage({
		onWalk: () =>
			setTimeout(() => {
				screen.current = snapWith([["Saved", SAVE]]);
				screen.emit({ kind: "key" });
			}, 5),
	});
	const { result } = run({
		mode: "guide",
		script: [guideStep(), finish()],
		screen,
		stage,
	});
	assert.equal((await result).success, true);
});

test("Skip completes a guide step and Close ends the guide", async () => {
	const s1 = fakeStage({ onWalk: () => setTimeout(() => s1.press("skip"), 5) });
	const a = run({ mode: "guide", script: [guideStep(), finish()], stage: s1 });
	assert.equal((await a.result).success, true);
	assert.match(a.model.requests[1].history.at(-1).results[0].text, /Skip/);

	const s2 = fakeStage({
		onWalk: () => setTimeout(() => s2.press("close"), 5),
	});
	const b = run({ mode: "guide", script: [guideStep()], stage: s2 });
	assert.equal((await b.result).reason, "cancelled");
});

test("an untouched guide step times out", async () => {
	const screen = fakeScreen({ canAct: false });
	const { result } = run({ mode: "guide", script: [guideStep()], screen });
	assert.equal((await result).reason, "timeout");
});

test("Do_Mode is unavailable without UI Automation", async () => {
	const { result, model } = run({
		screen: fakeScreen({ canAct: false }),
		script: [click()],
	});
	assert.equal((await result).reason, "unsupported");
	assert.equal(model.requests.length, 0);
});

test("an empty UI list falls back to a screenshot, dropped if the model can't read images", async () => {
	const screen = fakeScreen({ elements: [] });
	const stage = fakeStage();
	const { result, model } = run({
		screen,
		stage,
		script: [
			new ModelError("no-vision", "image input not supported"),
			finish(),
		],
	});
	assert.equal((await result).success, true);
	assert.equal(model.requests[0].history[0].parts[1].type, "image");
	assert.ok(
		!model.requests[1].history[0].parts.some((p) => p.type === "image"),
	);
	assert.ok(stage.bubbles.some((b) => /can't read screenshots/.test(b.text)));
});

test("aborting the task stops it", async () => {
	const ctrl = new AbortController();
	const { result } = run({
		script: [
			() => {
				ctrl.abort();
				return click();
			},
		],
		signal: ctrl.signal,
	});
	assert.equal((await result).reason, "cancelled");
});

test("model errors end the task with their message", async () => {
	const { result } = run({ script: [new ModelError("auth", "Bad key")] });
	assert.deepEqual(await result, {
		success: false,
		summary: "Bad key",
		reason: "error",
	});
});

function fakeLocal() {
	return {
		commands: [],
		async runCommand(command, seconds) {
			this.commands.push({ command, seconds });
			return "exit code: 0\nhello";
		},
		webSearch: async (q) => `results for ${q}`,
		fetchUrl: async () => {
			throw new Error("404 Not Found");
		},
	};
}

const lastToolText = (req) =>
	req.history.filter((h) => h.role === "tool").at(-1).results[0].text;

test("run_command runs only after Yes and returns its output", async () => {
	const local = fakeLocal();
	const asked = [];
	const { result, model } = run({
		local,
		stage: fakeStage({
			answer: (text, ids) => {
				asked.push(text);
				return ids.includes("yes") ? "yes" : null;
			},
		}),
		script: [
			call("run_command", {
				command: "Write-Output hello",
				explanation: "Print hello",
			}),
			finish(),
		],
	});
	assert.equal((await result).reason, "done");
	assert.deepEqual(local.commands, [
		{ command: "Write-Output hello", seconds: 60 },
	]);
	assert.match(asked[0], /Write-Output hello/);
	assert.match(lastToolText(model.requests[1]), /hello/);
});

test("a declined run_command never runs", async () => {
	const local = fakeLocal();
	const { result } = run({
		local,
		stage: fakeStage({ answer: () => "no" }),
		script: [
			call("run_command", { command: "Remove-Item x", explanation: "Delete" }),
		],
	});
	assert.equal((await result).reason, "declined");
	assert.deepEqual(local.commands, []);
});

test("web lookups run unconfirmed and report failures to the model", async () => {
	const stage = fakeStage();
	const { result, model } = run({
		local: fakeLocal(),
		stage,
		script: [
			call("web_search", { query: "clippy" }),
			call("fetch_url", { url: "https://example.com" }),
			finish(),
		],
	});
	assert.equal((await result).reason, "done");
	assert.equal(lastToolText(model.requests[1]), "results for clippy");
	assert.equal(lastToolText(model.requests[2]), "Failed: 404 Not Found");
	assert.ok(stage.bubbles.every((b) => !b.buttons.length));
});

test("model requests carry only the newest screen and image", () => {
	const img = (data) => ({ type: "image", mime: "image/jpeg", data });
	const sent = latestScreenOnly([
		{
			role: "user",
			parts: [
				{ type: "text", text: "Goal: save\n\nCurrent screen:\nold list" },
				img("A"),
			],
		},
		{ role: "assistant", text: "", calls: [], native: [] },
		{
			role: "tool",
			results: [
				{ callId: "1", name: "screenshot", text: "Shot", image: img("B") },
			],
		},
		{ role: "assistant", text: "", calls: [], native: [] },
		{
			role: "tool",
			results: [
				{
					callId: "2",
					name: "click",
					text: "Done.\nCurrent screen:\nnew list",
				},
			],
		},
	]);
	assert.equal(
		sent[0].parts[0].text,
		"Goal: save\n\n(Earlier screen omitted.)",
	);
	assert.equal(sent[0].parts.length, 1);
	assert.equal(sent[2].results[0].image.data, "B");
	assert.equal(sent[4].results[0].text, "Done.\nCurrent screen:\nnew list");
});

test("auto mode performs a risky click without asking", async () => {
	const screen = fakeScreen();
	const stage = fakeStage({ answer: () => "no" });
	const model = fakeModel([click("e1", { risky: true }), finish()]);
	const runner = new TaskRunner({ screen, stage, timing: FAST });
	const out = await runner.run(
		{ goal: "Send it", mode: "do", client: model, model: "m", auto: true },
		new AbortController().signal,
	);
	assert.equal(out.success, true);
	assert.equal(screen.performed.length, 1);
	assert.ok(!stage.bubbles.some((b) => b.buttons.length), "no prompt");
	assert.deepEqual(screen.takeovers, [true, false], "input stays taken over");
});

test("a task that never acts stops at its turn limit", async () => {
	const script = Array.from({ length: TURN_LIMITS.do + 5 }, () =>
		call("say", { text: "Thinking…" }),
	);
	const { result, model } = run({ script });
	const out = await result;
	assert.equal(out.reason, "limit");
	assert.equal(model.requests.length, TURN_LIMITS.do);
});

test("a confirmation does not double the explanation's punctuation", async () => {
	let asked = "";
	const stage = fakeStage({
		answer: (text) => {
			asked = text;
			return "no";
		},
	});
	const { result } = run({
		script: [click("e1", { risky: true, explanation: "Click Save." })],
		stage,
	});
	await result;
	assert.match(asked, /Click Save\. Go ahead\?$/);
});

test("an unreadable screen sends its screenshot with the step result", async () => {
	const screen = fakeScreen({ elements: [] });
	const { result, model } = run({
		script: [call("press_keys", { keys: "enter" })],
		screen,
	});
	await result;
	assert.match(model.requests[0].history[0].parts[0].text, /960x540 pixels/);
	const step = model.requests[1].history.at(-1).results[0];
	assert.match(step.text, /Current screen:[\s\S]*960x540 pixels/);
	assert.equal(step.image.data, "AAAA");
});
