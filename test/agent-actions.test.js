import assert from "node:assert/strict";
import { test } from "node:test";
import {
	actionInput,
	boxToScreen,
	formatTarget,
	fromAnthropicToolUse,
	fromOpenAIFunctionCall,
	hasRiskyWord,
	isRisky,
	LIMITS,
	parseAction,
	parseKeys,
	parseTarget,
	resolveTarget,
	TASK_TOOLS,
	TOOLS,
	toAnthropicToolUse,
	toOpenAIFunctionCall,
} from "../src/main/agent/actions.ts";

// Small seeded PRNG so failures reproduce.
function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const CHARS = "abcdefghijklmnopqrstuvwxyz ABC123\"'\\{}[],:é😀\n\t";
function randText(r, max, min = 1) {
	const n = min + Math.floor(r() * (max - min + 1));
	let s = "";
	while (s.length < n) s += CHARS[Math.floor(r() * CHARS.length)];
	s = s.slice(0, n);
	// Required strings must not be blank.
	return s.trim() ? s : `x${s}`.slice(0, n);
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const randTarget = (r) =>
	r() < 0.5
		? { element: `e${1 + Math.floor(r() * 600)}` }
		: {
				box: {
					x: Math.floor(r() * 1500),
					y: Math.floor(r() * 900),
					width: 1 + Math.floor(r() * 300),
					height: 1 + Math.floor(r() * 300),
				},
			};

function randAction(r) {
	switch (pick(r, Object.keys(TOOLS))) {
		case "click":
			return {
				type: "click",
				target: randTarget(r),
				button: pick(r, ["left", "right"]),
				double: r() < 0.5,
				risky: r() < 0.5,
				explanation: randText(r, LIMITS.explanation),
			};
		case "type_text":
			return {
				type: "type_text",
				target: r() < 0.5 ? randTarget(r) : null,
				text: randText(r, 300),
				risky: r() < 0.5,
				explanation: randText(r, 50),
			};
		case "press_keys":
			return {
				type: "press_keys",
				keys: pick(r, [
					"enter",
					"ctrl+s",
					"alt+tab",
					"ctrl+shift+n",
					"f5",
					"win",
				]),
				risky: r() < 0.5,
				explanation: randText(r, 50),
			};
		case "scroll":
			return {
				type: "scroll",
				target: randTarget(r),
				direction: pick(r, ["up", "down", "left", "right"]),
				amount: 1 + Math.floor(r() * LIMITS.scrollAmount),
				explanation: randText(r, 50),
			};
		case "guide_step":
			return {
				type: "guide_step",
				target: randTarget(r),
				title: randText(r, 60),
				text: randText(r, LIMITS.message),
				total: 1 + Math.floor(r() * LIMITS.totalSteps),
			};
		case "run_command":
			return {
				type: "run_command",
				command: randText(r, 500),
				timeout_seconds: 1 + Math.floor(r() * LIMITS.commandSeconds),
				explanation: randText(r, 50),
			};
		case "web_search":
			return { type: "web_search", query: randText(r, LIMITS.query) };
		case "fetch_url":
			return {
				type: "fetch_url",
				url: pick(r, ["https://example.com", "http://a.b/c?d=e&f=%20"]),
			};
		case "screenshot":
			return { type: "screenshot" };
		case "wait":
			return { type: "wait", seconds: 0.2 + Math.floor(r() * 98) / 10 };
		case "say":
			return { type: "say", text: randText(r, LIMITS.message) };
		case "finish":
			return { type: "finish", success: r() < 0.5, summary: randText(r, 300) };
		case "start_task":
			return {
				type: "start_task",
				goal: randText(r, 200),
				mode: pick(r, ["guide", "do"]),
			};
		case "assess":
			return {
				type: "assess",
				worthwhile: r() < 0.5,
				subject: r() < 0.3 ? "" : randText(r, 100),
			};
		case "show_tip":
			return {
				type: "show_tip",
				text: randText(r, LIMITS.tip),
				title: randText(r, 60),
				target: r() < 0.5 ? randTarget(r) : null,
				follow_up: r() < 0.5 ? randText(r, 200) : null,
			};
	}
}

test("every generated action is valid and survives tool-input round trips", () => {
	const r = rng(42);
	for (let i = 0; i < 500; i++) {
		const action = randAction(r);
		const { name, input } = actionInput(action);
		const back = parseAction(name, JSON.parse(JSON.stringify(input)));
		assert.ok(back.ok, `${name}: ${back.error}`);
		assert.deepEqual(back.action, action);
	}
});

test("Anthropic tool_use and OpenAI function_call conversions round-trip", () => {
	const r = rng(7);
	for (let i = 0; i < 500; i++) {
		const action = randAction(r);
		const a = fromAnthropicToolUse(
			JSON.parse(JSON.stringify(toAnthropicToolUse(`toolu_${i}`, action))),
		);
		assert.ok(a.ok, a.error);
		assert.deepEqual(a.action, action);
		const call = toOpenAIFunctionCall(`call_${i}`, action);
		assert.equal(call.call_id, `call_${i}`);
		const o = fromOpenAIFunctionCall(call);
		assert.ok(o.ok, o.error);
		assert.deepEqual(o.action, action);
	}
});

test("targets parse and format back to the same target", () => {
	const r = rng(3);
	for (let i = 0; i < 300; i++) {
		const t = randTarget(r);
		assert.deepEqual(parseTarget(formatTarget(t)), t);
	}
	assert.deepEqual(parseTarget(" e7 "), { element: "e7" });
	assert.deepEqual(parseTarget("10, 20, 30.5, 40"), {
		box: { x: 10, y: 20, width: 30.5, height: 40 },
	});
	for (const bad of [
		"",
		"E7",
		"e",
		"e123456",
		"1,2,3",
		"1,2,0,4",
		"a,b,c,d",
		5,
		null,
	])
		assert.equal(parseTarget(bad), null, `"${bad}"`);
});

test("parseAction rejects malformed input with a reason", () => {
	const bad = [
		["nope", {}],
		["click", {}],
		["click", { target: "button", explanation: "x" }],
		["click", { target: "e1", explanation: "x", button: "middle" }],
		["click", { target: "e1", explanation: "x", risky: "yes" }],
		["type_text", { text: "", explanation: "x" }],
		["type_text", { text: "a".repeat(LIMITS.typeText + 1), explanation: "x" }],
		["press_keys", { keys: "ctrl+banana", explanation: "x" }],
		["scroll", { target: "e1", direction: "sideways", explanation: "x" }],
		["scroll", { target: "e1", direction: "up", amount: 99, explanation: "x" }],
		["wait", { seconds: 60 }],
		["guide_step", { target: "e1", title: "t", text: "x", total: 0 }],
		["start_task", { goal: "x", mode: "maybe" }],
		["say", { text: "x".repeat(LIMITS.message + 1) }],
	];
	for (const [name, input] of bad) {
		const res = parseAction(name, input);
		assert.equal(res.ok, false, `${name} ${JSON.stringify(input)}`);
		assert.ok(res.error.length > 0);
	}
	assert.ok(
		parseAction("type_text", {
			text: "a".repeat(LIMITS.typeText),
			explanation: "x",
		}).ok,
	);
	// Some gateways drop the explanation, so each Action falls back to its own.
	for (const [name, input, said] of [
		["click", { target: "e1" }, "Clicking here"],
		["press_keys", { keys: "win+r" }, "Pressing win+r"],
		["scroll", { target: "e1", direction: "down" }, "Scrolling down"],
		["run_command", { command: "calc" }, "Running a command"],
		["type_text", { text: "hi" }, 'Typing "hi"'],
	])
		assert.equal(parseAction(name, input).action.explanation, said, name);
	assert.equal(
		fromOpenAIFunctionCall({
			type: "function_call",
			call_id: "c",
			name: "say",
			arguments: "{not json",
		}).ok,
		false,
	);
});

test("parseKeys normalises combinations and rejects unknown keys", () => {
	assert.deepEqual(parseKeys("Ctrl+S"), ["ctrl", "s"]);
	assert.deepEqual(parseKeys("shift + control + esc"), [
		"shift",
		"ctrl",
		"escape",
	]);
	assert.deepEqual(parseKeys("F12"), ["f12"]);
	assert.deepEqual(parseKeys("win"), ["win"]);
	for (const bad of [
		"",
		"ctrl",
		"ctrl+shift",
		"f13",
		"ctrl+s+t",
		"hello",
		"a+b",
	])
		assert.equal(parseKeys(bad), null, bad);
});

test("risky actions: model flag, risky target names, risky keys", () => {
	const click = (risky) => ({
		type: "click",
		target: { element: "e1" },
		button: "left",
		double: false,
		risky,
		explanation: "x",
	});
	assert.equal(isRisky(click(true), "OK"), true);
	assert.equal(isRisky(click(false), "Send"), true);
	assert.equal(isRisky(click(false), "Delete file"), true);
	assert.equal(isRisky(click(false), "Don't Save"), true);
	assert.equal(isRisky(click(false), "Buy now"), true);
	assert.equal(isRisky(click(false), "Save"), false);
	assert.equal(isRisky(click(false), "Sender name"), false);
	assert.equal(isRisky(click(false), null), false);
	const keys = (k, risky = false) => ({
		type: "press_keys",
		keys: k,
		risky,
		explanation: "x",
	});
	assert.equal(isRisky(keys("alt+F4")), true);
	assert.equal(isRisky(keys("ctrl+enter")), true);
	assert.equal(isRisky(keys("ctrl+s")), false);
	assert.equal(isRisky(keys("enter", true)), true);
	assert.equal(isRisky({ type: "say", text: "send" }, "send"), false);
	assert.equal(
		isRisky({ type: "run_command", command: "dir", explanation: "x" }),
		true,
	);
	assert.equal(isRisky({ type: "web_search", query: "delete" }), false);
	assert.equal(parseAction("fetch_url", { url: "file:///c:/x" }).ok, false);
	assert.equal(hasRiskyWord("PAY NOW"), true);
	assert.equal(hasRiskyWord("Payment history"), false);
});

test("TASK_TOOLS keep input actions out of guide mode", () => {
	for (const t of ["click", "type_text", "press_keys", "scroll", "run_command"])
		assert.ok(!TASK_TOOLS.guide.includes(t), t);
	for (const names of Object.values(TASK_TOOLS))
		for (const n of names) assert.ok(TOOLS[n], n);
});

test("resolveTarget validates against the snapshot, screenshot and displays", () => {
	const displays = [
		{ x: 0, y: 0, width: 1920, height: 1080 },
		{ x: 1920, y: 0, width: 1280, height: 1024 },
	];
	const elements = new Map([
		["e1", { rect: { x: 100, y: 100, width: 80, height: 30 }, name: "Save" }],
		[
			"e2",
			{ rect: { x: -500, y: -500, width: 50, height: 20 }, name: "Ghost" },
		],
	]);
	const ctx = { elements, screenshot: null, displays };
	const ok = resolveTarget({ element: "e1" }, ctx);
	assert.ok(ok.ok);
	assert.equal(ok.target.name, "Save");
	assert.equal(resolveTarget({ element: "e9" }, ctx).ok, false);
	assert.equal(resolveTarget({ element: "e2" }, ctx).ok, false);
	const box = { box: { x: 10, y: 10, width: 20, height: 20 } };
	assert.equal(resolveTarget(box, ctx).ok, false, "box needs a screenshot");
	const shot = { width: 640, height: 512, display: displays[1] };
	const res = resolveTarget(box, { ...ctx, screenshot: shot });
	assert.ok(res.ok);
	assert.deepEqual(res.target.rect, boxToScreen(box.box, shot));
	assert.deepEqual(res.target.rect, { x: 1940, y: 20, width: 40, height: 40 });
	assert.equal(
		resolveTarget(
			{ box: { x: 630, y: 10, width: 50, height: 5 } },
			{ ...ctx, screenshot: shot },
		).ok,
		false,
		"box outside the screenshot",
	);
});
