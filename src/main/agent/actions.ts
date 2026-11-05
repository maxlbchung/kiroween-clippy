// The Actions a model can ask for, the tool definitions that describe them,
// and the parsing and validation that every model-proposed Action passes
// before it runs. Free of Electron imports so it can be unit-tested.

import type { Rect } from "../../shared/types.js";

/** An element id from the latest UI snapshot, or a box in screenshot pixels. */
export type Target =
	| { element: string }
	| { box: { x: number; y: number; width: number; height: number } };

export type Action =
	| {
			type: "click";
			target: Target;
			button: "left" | "right";
			double: boolean;
			risky: boolean;
			explanation: string;
	  }
	| {
			type: "type_text";
			target: Target | null;
			text: string;
			risky: boolean;
			explanation: string;
	  }
	| { type: "press_keys"; keys: string; risky: boolean; explanation: string }
	| {
			type: "scroll";
			target: Target;
			direction: "up" | "down" | "left" | "right";
			amount: number;
			explanation: string;
	  }
	| {
			type: "guide_step";
			target: Target;
			title: string;
			text: string;
			total: number;
	  }
	| { type: "screenshot" }
	| { type: "wait"; seconds: number }
	| { type: "say"; text: string }
	| { type: "finish"; success: boolean; summary: string }
	| { type: "start_task"; goal: string; mode: "guide" | "do" }
	| { type: "assess"; worthwhile: boolean; subject: string }
	| {
			type: "show_tip";
			text: string;
			title: string;
			target: Target | null;
			follow_up: string | null;
	  };

export type ActionType = Action["type"];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

export const LIMITS = {
	typeText: 2000,
	explanation: 200,
	message: 200,
	title: 120,
	goal: 500,
	summary: 400,
	keys: 60,
	tip: 280,
	waitSeconds: 10,
	scrollAmount: 10,
	totalSteps: 20,
};

type JsonSchema = Record<string, unknown>;
export type ToolSpec = {
	name: ActionType;
	description: string;
	parameters: JsonSchema;
};

const TARGET_DOC =
	'Either an element id from the UI list (like "e12"), or a box "x,y,width,height" in pixels of the latest screenshot.';

const str = (description: string, maxLength?: number): JsonSchema => ({
	type: "string",
	description,
	...(maxLength ? { maxLength } : {}),
});
const bool = (description: string): JsonSchema => ({
	type: "boolean",
	description,
});
const obj = (
	properties: Record<string, JsonSchema>,
	required = Object.keys(properties),
): JsonSchema => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});

const RISKY_DOC =
	"True if this action sends, submits, deletes, buys, pays, closes unsaved work, runs a command, installs software or changes system settings.";
const EXPLAIN_DOC = "Short description of this step for the user.";

export const TOOLS: Record<ActionType, ToolSpec> = {
	click: {
		name: "click",
		description: "Click a UI element or screen box.",
		parameters: obj(
			{
				target: str(TARGET_DOC),
				button: { type: "string", enum: ["left", "right"] },
				double: bool("True for a double-click."),
				risky: bool(RISKY_DOC),
				explanation: str(EXPLAIN_DOC, LIMITS.explanation),
			},
			["target", "explanation"],
		),
	},
	type_text: {
		name: "type_text",
		description:
			"Type text. With a target, clicks the target first so the text goes into it.",
		parameters: obj(
			{
				target: str(`${TARGET_DOC} Optional.`),
				text: str("The text to type.", LIMITS.typeText),
				risky: bool(RISKY_DOC),
				explanation: str(EXPLAIN_DOC, LIMITS.explanation),
			},
			["text", "explanation"],
		),
	},
	press_keys: {
		name: "press_keys",
		description:
			'Press a key or key combination, written like "enter", "ctrl+s" or "alt+tab".',
		parameters: obj(
			{
				keys: str("Key combination.", LIMITS.keys),
				risky: bool(RISKY_DOC),
				explanation: str(EXPLAIN_DOC, LIMITS.explanation),
			},
			["keys", "explanation"],
		),
	},
	scroll: {
		name: "scroll",
		description: "Scroll over a UI element or screen box.",
		parameters: obj(
			{
				target: str(TARGET_DOC),
				direction: { type: "string", enum: ["up", "down", "left", "right"] },
				amount: {
					type: "integer",
					minimum: 1,
					maximum: LIMITS.scrollAmount,
					description: "Number of wheel notches.",
				},
				explanation: str(EXPLAIN_DOC, LIMITS.explanation),
			},
			["target", "direction", "explanation"],
		),
	},
	guide_step: {
		name: "guide_step",
		description:
			"Show the user one step: frame the target and explain what to do. The user does the step; the result arrives once they have.",
		parameters: obj({
			target: str(TARGET_DOC),
			title: str("Short title for the frame, a few words.", 60),
			text: str(
				"One or two sentences telling the user what to do.",
				LIMITS.message,
			),
			total: {
				type: "integer",
				minimum: 1,
				maximum: LIMITS.totalSteps,
				description: "Your current estimate of the total number of steps.",
			},
		}),
	},
	screenshot: {
		name: "screenshot",
		description:
			"Get a screenshot of the display with the active window, when the UI list is not enough.",
		parameters: obj({}),
	},
	wait: {
		name: "wait",
		description: "Wait for something to load before the next step.",
		parameters: obj({
			seconds: {
				type: "number",
				minimum: 0.2,
				maximum: LIMITS.waitSeconds,
			},
		}),
	},
	say: {
		name: "say",
		description: "Show the user a short message without acting.",
		parameters: obj({ text: str("The message.", LIMITS.message) }),
	},
	finish: {
		name: "finish",
		description: "End the task.",
		parameters: obj({
			success: bool("True if the task is done."),
			summary: str(
				"One or two sentences for the user about the result.",
				LIMITS.summary,
			),
		}),
	},
	start_task: {
		name: "start_task",
		description:
			'Start a task on the user\'s screen. Use mode "guide" to show the user how, "do" to do it for them.',
		parameters: obj({
			goal: str("What to accomplish, in one sentence.", LIMITS.goal),
			mode: { type: "string", enum: ["guide", "do"] },
		}),
	},
	assess: {
		name: "assess",
		description: "Decide whether a tip would help the user right now.",
		parameters: obj({
			worthwhile: bool("True if a tip would clearly help."),
			subject: str("What the tip would be about, a few words.", 120),
		}),
	},
	show_tip: {
		name: "show_tip",
		description: "Show the user a tip.",
		parameters: obj(
			{
				text: str("The tip, one or two sentences.", LIMITS.tip),
				title: str("Short title for the frame, a few words.", 60),
				target: str(`${TARGET_DOC} Optional element the tip is about.`),
				follow_up: str(
					"Optional goal for a step-by-step guide the user can start from the tip.",
					LIMITS.goal,
				),
			},
			["text", "title"],
		),
	},
};

export const TASK_TOOLS = {
	do: [
		"click",
		"type_text",
		"press_keys",
		"scroll",
		"screenshot",
		"wait",
		"say",
		"finish",
	] as ActionType[],
	guide: ["guide_step", "screenshot", "wait", "say", "finish"] as ActionType[],
	chat: ["start_task", "screenshot"] as ActionType[],
	assess: ["assess"] as ActionType[],
	tip: ["show_tip"] as ActionType[],
};

// Targets

const ELEMENT_RE = /^e\d{1,5}$/;
const BOX_RE =
	/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/;

/** Parses a target string. Returns null when it is neither form. */
export function parseTarget(s: unknown): Target | null {
	if (typeof s !== "string") return null;
	const t = s.trim();
	if (ELEMENT_RE.test(t)) return { element: t };
	const m = BOX_RE.exec(t);
	if (!m) return null;
	const [x, y, width, height] = m.slice(1).map(Number);
	if (width <= 0 || height <= 0) return null;
	return { box: { x, y, width, height } };
}

/** Formats a target back into the string form that `parseTarget` reads. */
export function formatTarget(t: Target): string {
	if ("element" in t) return t.element;
	const { x, y, width, height } = t.box;
	return `${x},${y},${width},${height}`;
}

// Parsing

export type ParseResult =
	| { ok: true; action: Action }
	| { ok: false; error: string };

class InputError extends Error {}

function need<T>(cond: T, msg: string): asserts cond {
	if (!cond) throw new InputError(msg);
}

function text(
	input: Record<string, unknown>,
	key: string,
	max: number,
	{ optional = false, allowEmpty = false } = {},
): string | null {
	const v = input[key];
	if (v === undefined || v === null || (optional && v === "")) {
		need(optional, `"${key}" is required`);
		return null;
	}
	need(typeof v === "string", `"${key}" must be a string`);
	need(allowEmpty || v.trim().length > 0, `"${key}" must not be empty`);
	need(v.length <= max, `"${key}" is longer than ${max} characters`);
	return v;
}

function flag(input: Record<string, unknown>, key: string): boolean {
	const v = input[key];
	if (v === undefined || v === null) return false;
	need(typeof v === "boolean", `"${key}" must be true or false`);
	return v;
}

function num(
	input: Record<string, unknown>,
	key: string,
	min: number,
	max: number,
	{ fallback, integer = false }: { fallback?: number; integer?: boolean } = {},
): number {
	const v = input[key];
	if ((v === undefined || v === null) && fallback !== undefined)
		return fallback;
	need(
		typeof v === "number" && Number.isFinite(v),
		`"${key}" must be a number`,
	);
	need(!integer || Number.isInteger(v), `"${key}" must be a whole number`);
	need(v >= min && v <= max, `"${key}" must be between ${min} and ${max}`);
	return v;
}

function oneOf<T extends string>(
	input: Record<string, unknown>,
	key: string,
	values: readonly T[],
	fallback?: T,
): T {
	const v = input[key];
	if ((v === undefined || v === null) && fallback !== undefined)
		return fallback;
	need(
		typeof v === "string" && (values as readonly string[]).includes(v),
		`"${key}" must be one of ${values.join(", ")}`,
	);
	return v as T;
}

function target(
	input: Record<string, unknown>,
	key: string,
	optional = false,
): Target | null {
	const v = input[key];
	if (v === undefined || v === null || v === "") {
		need(optional, `"${key}" is required`);
		return null;
	}
	const t = parseTarget(v);
	need(t, `"${key}" must be an element id like "e12" or a box "x,y,w,h"`);
	return t;
}

/**
 * Turns a tool call's name and input into an Action, checking types,
 * required fields and limits. Never throws.
 */
export function parseAction(name: unknown, input: unknown): ParseResult {
	try {
		need(typeof name === "string" && name in TOOLS, `Unknown tool "${name}"`);
		const i = (
			input && typeof input === "object" && !Array.isArray(input) ? input : {}
		) as Record<string, unknown>;
		const type = name as ActionType;
		switch (type) {
			case "click":
				return ok({
					type,
					target: target(i, "target"),
					button: oneOf(i, "button", ["left", "right"] as const, "left"),
					double: flag(i, "double"),
					risky: flag(i, "risky"),
					explanation: text(i, "explanation", LIMITS.explanation),
				});
			case "type_text":
				return ok({
					type,
					target: target(i, "target", true),
					text: text(i, "text", LIMITS.typeText),
					risky: flag(i, "risky"),
					explanation: text(i, "explanation", LIMITS.explanation),
				});
			case "press_keys": {
				const keys = text(i, "keys", LIMITS.keys);
				need(parseKeys(keys), `"keys" is not a key combination I know`);
				return ok({
					type,
					keys,
					risky: flag(i, "risky"),
					explanation: text(i, "explanation", LIMITS.explanation),
				});
			}
			case "scroll":
				return ok({
					type,
					target: target(i, "target"),
					direction: oneOf(i, "direction", [
						"up",
						"down",
						"left",
						"right",
					] as const),
					amount: num(i, "amount", 1, LIMITS.scrollAmount, {
						fallback: 3,
						integer: true,
					}),
					explanation: text(i, "explanation", LIMITS.explanation),
				});
			case "guide_step":
				return ok({
					type,
					target: target(i, "target"),
					title: text(i, "title", LIMITS.title),
					text: text(i, "text", LIMITS.message),
					total: num(i, "total", 1, LIMITS.totalSteps, {
						fallback: 1,
						integer: true,
					}),
				});
			case "screenshot":
				return ok({ type });
			case "wait":
				return ok({
					type,
					seconds: num(i, "seconds", 0.2, LIMITS.waitSeconds),
				});
			case "say":
				return ok({ type, text: text(i, "text", LIMITS.message) });
			case "finish":
				return ok({
					type,
					success: flag(i, "success"),
					summary: text(i, "summary", LIMITS.summary),
				});
			case "start_task":
				return ok({
					type,
					goal: text(i, "goal", LIMITS.goal),
					mode: oneOf(i, "mode", ["guide", "do"] as const),
				});
			case "assess":
				return ok({
					type,
					worthwhile: flag(i, "worthwhile"),
					subject: text(i, "subject", 120, { optional: true }) ?? "",
				});
			case "show_tip":
				return ok({
					type,
					text: text(i, "text", LIMITS.tip),
					title: text(i, "title", LIMITS.title),
					target: target(i, "target", true),
					follow_up: text(i, "follow_up", LIMITS.goal, { optional: true }),
				});
		}
	} catch (err) {
		if (err instanceof InputError) return { ok: false, error: err.message };
		throw err;
	}
}

const ok = (action: Action): ParseResult => ({ ok: true, action });

/** The tool input that `parseAction` turns back into `action`. */
export function actionInput(action: Action): {
	name: ActionType;
	input: Record<string, unknown>;
} {
	const { type, ...rest } = action;
	const input: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(rest)) {
		if (v === null) continue;
		input[k] =
			k === "target" && v && typeof v === "object"
				? formatTarget(v as Target)
				: v;
	}
	return { name: type, input };
}

// Provider tool calls

export type AnthropicToolUse = {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
};
export type OpenAIFunctionCall = {
	type: "function_call";
	call_id: string;
	name: string;
	arguments: string;
};

export function toAnthropicToolUse(
	id: string,
	action: Action,
): AnthropicToolUse {
	const { name, input } = actionInput(action);
	return { type: "tool_use", id, name, input };
}

export function fromAnthropicToolUse(block: AnthropicToolUse): ParseResult {
	return parseAction(block.name, block.input);
}

export function toOpenAIFunctionCall(
	callId: string,
	action: Action,
): OpenAIFunctionCall {
	const { name, input } = actionInput(action);
	return {
		type: "function_call",
		call_id: callId,
		name,
		arguments: JSON.stringify(input),
	};
}

export function fromOpenAIFunctionCall(call: OpenAIFunctionCall): ParseResult {
	let input: unknown;
	try {
		input = JSON.parse(call.arguments || "{}");
	} catch {
		return { ok: false, error: "Tool arguments are not valid JSON" };
	}
	return parseAction(call.name, input);
}

// Keys

const KEY_NAMES = new Set([
	"enter",
	"tab",
	"escape",
	"esc",
	"space",
	"backspace",
	"delete",
	"del",
	"insert",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	"printscreen",
	"menu",
	"apps",
]);
const MODIFIERS = new Set(["ctrl", "control", "alt", "shift", "win", "meta"]);

/**
 * Splits a combination like "ctrl+shift+s" into lowercase key names, with
 * modifiers first. Returns null for unknown keys or a combination without a
 * main key.
 */
export function parseKeys(combo: string): string[] | null {
	const parts = combo
		.toLowerCase()
		.split("+")
		.map((p) => p.trim())
		.filter(Boolean);
	if (!parts.length || parts.length > 4) return null;
	const mods: string[] = [];
	let main: string | null = null;
	for (const p of parts) {
		if (MODIFIERS.has(p)) {
			const m = p === "control" ? "ctrl" : p === "meta" ? "win" : p;
			if (!mods.includes(m)) mods.push(m);
		} else if (
			main === null &&
			(KEY_NAMES.has(p) || /^f([1-9]|1[0-2])$/.test(p) || /^[a-z0-9]$/.test(p))
		) {
			main = p === "esc" ? "escape" : p === "del" ? "delete" : p;
		} else return null;
	}
	if (main === null) {
		// "win" alone opens the Start menu; other lone modifiers do nothing.
		return mods.length === 1 && mods[0] === "win" ? mods : null;
	}
	return [...mods, main];
}

// Risk

/** Words that mark a control as one whose click is a Risky_Action. */
export const RISKY_WORDS = [
	"send",
	"submit",
	"post",
	"publish",
	"delete",
	"remove",
	"erase",
	"discard",
	"trash",
	"uninstall",
	"install",
	"buy",
	"purchase",
	"pay",
	"checkout",
	"order",
	"confirm payment",
	"don't save",
	"dont save",
	"do not save",
	"format",
	"run",
	"execute",
	"reset",
	"restart",
	"shut down",
	"shutdown",
	"sign out",
	"log out",
];

const RISKY_KEYS = new Set([
	"alt+f4",
	"ctrl+w",
	"ctrl+enter",
	"shift+delete",
	"ctrl+shift+delete",
	"win+r",
	"win+l",
]);

/** True when `name` contains a risky word as a whole word, ignoring case. */
export function hasRiskyWord(name: string | null | undefined): boolean {
	if (!name) return false;
	const n = ` ${name.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
	return RISKY_WORDS.some((w) => n.includes(` ${w} `));
}

/**
 * True when an input Action must be confirmed: the model marked it risky,
 * the target's name contains a risky word, or it presses a risky key.
 */
export function isRisky(action: Action, targetName?: string | null): boolean {
	switch (action.type) {
		case "click":
		case "type_text":
			return action.risky || hasRiskyWord(targetName);
		case "press_keys": {
			const keys = parseKeys(action.keys);
			return action.risky || (!!keys && RISKY_KEYS.has(keys.join("+")));
		}
		default:
			return false;
	}
}

// Validation against the screen

/** What an Action's target may refer to at the moment it runs. */
export type ScreenContext = {
	/** Element bounds from the latest UI snapshot, in DIP screen coordinates. */
	elements: Map<string, { rect: Rect; name: string }>;
	/** The latest screenshot, if any, and the display it shows. */
	screenshot: { width: number; height: number; display: Rect } | null;
	/** Bounds of every connected display, in DIP screen coordinates. */
	displays: Rect[];
};

export type ResolvedTarget = { rect: Rect; name: string | null };

/** Maps a box in screenshot pixels to DIP screen coordinates. */
export function boxToScreen(
	box: { x: number; y: number; width: number; height: number },
	shot: { width: number; height: number; display: Rect },
): Rect {
	const kx = shot.display.width / shot.width;
	const ky = shot.display.height / shot.height;
	return {
		x: shot.display.x + box.x * kx,
		y: shot.display.y + box.y * ky,
		width: box.width * kx,
		height: box.height * ky,
	};
}

const centerOf = (r: Rect) => ({
	x: r.x + r.width / 2,
	y: r.y + r.height / 2,
});

const contains = (r: Rect, p: { x: number; y: number }) =>
	p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

/**
 * Resolves a target to screen bounds. Fails when the element id is not in
 * the latest snapshot, a box is given without a screenshot or lies outside
 * it, or the target's center is on no connected display.
 */
export function resolveTarget(
	t: Target,
	ctx: ScreenContext,
): { ok: true; target: ResolvedTarget } | { ok: false; error: string } {
	let rect: Rect;
	let name: string | null = null;
	if ("element" in t) {
		const el = ctx.elements.get(t.element);
		if (!el)
			return {
				ok: false,
				error: `Element ${t.element} is not in the latest UI list`,
			};
		rect = el.rect;
		name = el.name;
	} else {
		if (!ctx.screenshot)
			return {
				ok: false,
				error: "A box target needs a screenshot; call screenshot first",
			};
		const { x, y, width, height } = t.box;
		if (
			x < 0 ||
			y < 0 ||
			x + width > ctx.screenshot.width + 1 ||
			y + height > ctx.screenshot.height + 1
		)
			return { ok: false, error: "The box lies outside the screenshot" };
		rect = boxToScreen(t.box, ctx.screenshot);
	}
	if (
		rect.width <= 0 ||
		rect.height <= 0 ||
		!ctx.displays.some((d) => contains(d, centerOf(rect)))
	)
		return { ok: false, error: "The target is not on any display" };
	return { ok: true, target: { rect, name } };
}
