// Runs one Task (Guide_Mode or Do_Mode) as a model-driven loop: perceive,
// ask the model for one Action, validate it, show it, perform it, repeat.
// Screen access, input and UI are injected so the loop can be tested.

import type { Rect } from "../../shared/types.js";
import {
	type Action,
	type ActionOf,
	type ActionType,
	isRisky,
	parseAction,
	parseKeys,
	type ResolvedTarget,
	resolveTarget,
	TASK_TOOLS,
	type Target,
	TOOLS,
} from "./actions.js";
import { truncateTitle } from "./geometry.js";
import {
	type HistoryItem,
	type ImagePart,
	type ModelClient,
	ModelError,
	type ModelReply,
	type ToolResult,
	withoutImages,
} from "./model.js";
import { DO_SYSTEM, GUIDE_SYSTEM, taskPrompt } from "./prompts.js";
import {
	elementIndex,
	fingerprint,
	formatSnapshot,
	type UiSnapshot,
} from "./snapshot.js";
import { type LocalTools, localTools, lookup } from "./tools.js";

export type Shot = {
	image: ImagePart;
	width: number;
	height: number;
	/** DIP bounds of the display the screenshot shows. */
	display: Rect;
};

export type InputCommand =
	| {
			kind: "click";
			x: number;
			y: number;
			button: "left" | "right";
			double: boolean;
	  }
	| { kind: "type"; text: string }
	| { kind: "keys"; keys: string[] }
	| { kind: "scroll"; x: number; y: number; dx: number; dy: number };

export type UserInput = {
	kind: "move" | "click" | "key";
	x?: number;
	y?: number;
};

/** Screen reading and input, in DIP screen coordinates. */
export interface Screen {
	/** False where Do_Mode is unavailable (no UI Automation or input). */
	readonly canAct: boolean;
	snapshot(): Promise<UiSnapshot | null>;
	screenshot(): Promise<Shot | null>;
	displays(): Rect[];
	perform(cmd: InputCommand): Promise<void>;
	/** Current bounds of an element from the latest snapshot. */
	elementRect(id: string): Promise<Rect | null>;
	watchInput(on: boolean): void;
	onUserInput(cb: (e: UserInput) => void): () => void;
}

export type OutlineSpec = {
	rect: Rect;
	title: string;
	step: { n: number; total: number } | null;
	kind: "step" | "tip";
};

export type BubbleButton = { id: string; label: string; primary?: boolean };

/** The Pet, Speech_Bubble and Overlay, as the runner drives them. */
export interface Stage {
	outline(spec: OutlineSpec | null): void;
	/** Shows a message. Resolves with the clicked button id, "close", or null when replaced. */
	say(text: string, buttons?: BubbleButton[]): Promise<string | null>;
	hideBubble(): void;
	walkTo(rect: Rect): Promise<void>;
	goHome(): Promise<void>;
	mood(m: string | null): void;
	onOutlineButton(cb: (button: "skip" | "close") => void): () => void;
}

export type Clock = {
	now(): number;
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

export const realClock: Clock = {
	now: () => Date.now(),
	sleep: (ms, signal) =>
		new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(new Error("aborted"));
			const t = setTimeout(resolve, ms);
			signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(t);
					reject(new Error("aborted"));
				},
				{ once: true },
			);
		}),
};

export const TIMING = {
	/** How long an Outline shows before the input it announces. */
	outlineLeadMs: 400,
	/** Pause after input so the UI can react before the next snapshot. */
	settleMs: 350,
	confirmMs: 30_000,
	pauseMs: 60_000,
	guideStepMs: 5 * 60_000,
	/** Delay after a click in the target before checking a guide step. */
	clickCheckMs: 300,
	/** Typing pause that ends a burst of keys in a guide step. */
	keyIdleMs: 1200,
	/** How often a guide step re-reads the screen for changes. */
	pollMs: 2500,
	/** Input ignored after the user answers a prompt. */
	resumeGraceMs: 1000,
	/** How often an outlined element's bounds are re-read. */
	trackMs: 200,
};

export const STEP_LIMITS = { do: 30, guide: 20 };
/** Invalid or failed model turns tolerated per Step. */
export const MAX_ATTEMPTS = 3;
const NUDGE_ON_TEXT = "Call exactly one of the tools to continue.";

export type TaskSpec = {
	goal: string;
	mode: "guide" | "do";
	client: ModelClient;
	model: string;
	effort?: "low" | "medium" | "high";
};

export type TaskOutcome = {
	success: boolean;
	summary: string;
	reason:
		| "done"
		| "cancelled"
		| "declined"
		| "limit"
		| "timeout"
		| "error"
		| "unsupported";
};

class EndTask extends Error {
	outcome: TaskOutcome;
	constructor(outcome: TaskOutcome) {
		super(outcome.summary);
		this.outcome = outcome;
	}
}

const end = (
	success: boolean,
	summary: string,
	reason: TaskOutcome["reason"],
) => new EndTask({ success, summary, reason });

const near = (r: Rect, p: { x?: number; y?: number }, pad = 4) =>
	p.x !== undefined &&
	p.y !== undefined &&
	p.x >= r.x - pad &&
	p.y >= r.y - pad &&
	p.x <= r.x + r.width + pad &&
	p.y <= r.y + r.height + pad;

export class TaskRunner {
	screen: Screen;
	stage: Stage;
	clock: Clock;
	timing: typeof TIMING;
	local: LocalTools;

	// Per-run state.
	spec!: TaskSpec;
	signal!: AbortSignal;
	history: HistoryItem[] = [];
	snap: UiSnapshot | null = null;
	shot: Shot | null = null;
	vision = true;
	steps = 0;
	busyWithUser = false;
	graceUntil = 0;
	pause: Promise<"resume" | "stop"> | null = null;
	trackTimer: ReturnType<typeof setInterval> | null = null;
	/** Aborted when a run ends, releasing prompts still on screen. */
	done = new AbortController();
	inputListeners = new Set<(e: UserInput) => void>();

	constructor({
		screen,
		stage,
		clock = realClock,
		timing = TIMING,
		local = localTools,
	}: {
		screen: Screen;
		stage: Stage;
		clock?: Clock;
		timing?: Partial<typeof TIMING>;
		local?: LocalTools;
	}) {
		this.screen = screen;
		this.stage = stage;
		this.clock = clock;
		this.timing = { ...TIMING, ...timing };
		this.local = local;
	}

	get tools(): ActionType[] {
		return TASK_TOOLS[this.spec.mode];
	}

	async run(spec: TaskSpec, signal: AbortSignal): Promise<TaskOutcome> {
		this.spec = spec;
		this.signal = signal;
		this.history = [];
		this.snap = null;
		this.shot = null;
		this.vision = true;
		this.steps = 0;
		this.pause = null;
		this.busyWithUser = false;
		this.done = new AbortController();
		if (spec.mode === "do" && !this.screen.canAct)
			return {
				success: false,
				summary:
					"Doing tasks for you needs Windows. Ask me to show you how instead!",
				reason: "unsupported",
			};

		const offInput = this.screen.onUserInput((e) => this.userInput(e));
		this.screen.watchInput(true);
		void this.stage.say(
			spec.mode === "guide"
				? "Let me show you how. Follow the frames!"
				: "On it! Move the mouse or press Ctrl+Alt+Backspace to stop me.",
		);
		try {
			await this.perceive();
			const parts: HistoryItem & { role: "user" } = {
				role: "user",
				parts: [
					{
						type: "text",
						text: taskPrompt(spec.goal, formatSnapshot(this.snap)),
					},
				],
			};
			if (this.shot) parts.parts.push(this.shot.image);
			this.history.push(parts);
			return await this.loop();
		} catch (err) {
			if (err instanceof EndTask) return err.outcome;
			if (signal.aborted)
				return { success: false, summary: "Stopped.", reason: "cancelled" };
			if (err instanceof ModelError)
				return {
					success: false,
					summary: err.message,
					reason: err.kind === "timeout" ? "timeout" : "error",
				};
			console.error("[agent] task failed:", err);
			return {
				success: false,
				summary: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
				reason: "error",
			};
		} finally {
			this.done.abort();
			this.stopTracking();
			offInput();
			this.screen.watchInput(false);
			this.stage.outline(null);
			this.stage.mood(null);
			await this.stage.goHome().catch(() => {});
		}
	}

	/** Reads the UI list, falling back to a screenshot when it is empty. */
	async perceive() {
		this.snap = await this.screen.snapshot();
		if (!this.snap?.elements.length) this.shot = await this.screen.screenshot();
	}

	checkAborted() {
		if (this.signal.aborted) throw end(false, "Stopped.", "cancelled");
	}

	async loop(): Promise<TaskOutcome> {
		let attempts = 0;
		for (;;) {
			this.checkAborted();
			const reply = await this.ask();
			this.history.push({
				role: "assistant",
				text: reply.text,
				calls: reply.calls,
				native: reply.native,
			});
			if (reply.stop === "refusal")
				throw end(false, "Sorry, I can't help with that one.", "error");

			if (!reply.calls.length) {
				if (++attempts > MAX_ATTEMPTS)
					throw end(
						false,
						"I lost my train of thought. Let's try again.",
						"error",
					);
				this.history.push({
					role: "user",
					parts: [{ type: "text", text: NUDGE_ON_TEXT }],
				});
				continue;
			}

			const [call, ...extra] = reply.calls;
			const results: ToolResult[] = extra.map((c) => ({
				callId: c.id,
				name: c.name,
				text: "Ignored: call one tool per turn.",
				isError: true,
			}));
			const parsed =
				reply.stop === "max_tokens"
					? {
							ok: false as const,
							error: "The tool call was cut off; try again.",
						}
					: call.error
						? { ok: false as const, error: call.error }
						: parseAction(call.name, call.input);
			let result: Omit<ToolResult, "callId" | "name">;
			if ("error" in parsed) result = { text: parsed.error, isError: true };
			else if (!this.tools.includes(parsed.action.type))
				result = {
					text: `"${parsed.action.type}" is not available in this task.`,
					isError: true,
				};
			else result = await this.execute(parsed.action);

			if (result.isError) {
				if (++attempts > MAX_ATTEMPTS)
					throw end(
						false,
						"I couldn't find what I was looking for on screen, so I stopped.",
						"error",
					);
			} else attempts = 0;
			this.history.push({
				role: "tool",
				results: [{ callId: call.id, name: call.name, ...result }, ...results],
			});
		}
	}

	/** One model request, with the thinking mood and a no-vision fallback. */
	async ask(): Promise<ModelReply> {
		const { client, model, effort } = this.spec;
		this.stage.mood("thinking");
		try {
			return await client.complete({
				model,
				system: this.spec.mode === "guide" ? GUIDE_SYSTEM : DO_SYSTEM,
				history: this.vision ? this.history : withoutImages(this.history),
				tools: this.tools.map((t) => TOOLS[t]),
				requireTool: true,
				effort: effort ?? "medium",
				signal: this.signal,
			});
		} catch (err) {
			if (
				err instanceof ModelError &&
				err.kind === "no-vision" &&
				this.vision
			) {
				this.vision = false;
				void this.stage.say(
					"Heads up: this model can't read screenshots, so I'll go by the UI list only.",
				);
				return this.ask();
			}
			throw err;
		} finally {
			this.stage.mood(null);
		}
	}

	resolve(t: Target) {
		return resolveTarget(t, {
			elements: elementIndex(this.snap),
			screenshot: this.shot
				? {
						width: this.shot.width,
						height: this.shot.height,
						display: this.shot.display,
					}
				: null,
			displays: this.screen.displays(),
		});
	}

	screenText(prefix: string, before?: string): string {
		const now = fingerprint(this.snap);
		if (before !== undefined && before === now)
			return `${prefix}\nThe screen looks unchanged.`;
		return `${prefix}\nCurrent screen:\n${formatSnapshot(this.snap)}`;
	}

	async execute(action: Action): Promise<Omit<ToolResult, "callId" | "name">> {
		switch (action.type) {
			case "screenshot": {
				const shot = await this.screen.screenshot();
				if (!shot) return { text: "Screenshot unavailable.", isError: true };
				this.shot = shot;
				return {
					text: `Screenshot of the display, ${shot.width}x${shot.height} pixels. Boxes refer to these pixels.`,
					image: this.vision ? shot.image : undefined,
				};
			}
			case "wait": {
				const before = fingerprint(this.snap);
				await this.clock.sleep(action.seconds * 1000, this.signal);
				await this.perceive();
				return { text: this.screenText("Waited.", before) };
			}
			case "say":
				void this.stage.say(action.text);
				return { text: "Shown to the user." };
			case "finish":
				throw end(action.success, action.summary, "done");
			case "guide_step":
				return this.guideStep(action);
			case "web_search":
			case "fetch_url":
				return lookup(this.local, action, this.signal);
			case "run_command":
				return this.command(action);
			case "click":
			case "type_text":
			case "press_keys":
			case "scroll":
				return this.act(action);
			default:
				return { text: `"${action.type}" is not available.`, isError: true };
		}
	}

	// Do_Mode

	async act(
		action: ActionOf<"click" | "type_text" | "press_keys" | "scroll">,
	): Promise<Omit<ToolResult, "callId" | "name">> {
		let target: ResolvedTarget | null = null;
		const t = "target" in action ? action.target : null;
		if (t) {
			const r = this.resolve(t);
			if ("error" in r) return { text: r.error, isError: true };
			target = r.target;
		}
		if (++this.steps > STEP_LIMITS.do)
			throw end(
				false,
				`I hit my limit of ${STEP_LIMITS.do} steps, so I stopped here.`,
				"limit",
			);

		const shownAt = this.clock.now();
		if (target) {
			this.showOutline(
				{
					rect: target.rect,
					title: action.explanation,
					step: null,
					kind: "step",
				},
				t && "element" in t ? t.element : null,
			);
			await this.stage.walkTo(target.rect);
		}
		void this.stage.say(action.explanation);
		const lead = this.timing.outlineLeadMs - (this.clock.now() - shownAt);
		if (lead > 0) await this.clock.sleep(lead, this.signal);

		if (isRisky(action, target?.name)) await this.confirm(action.explanation);
		if ((await this.gate()) === "resumed")
			return {
				text: this.screenText(
					"The user interrupted before this action ran, so it was not performed. Decide the next step from the current screen.",
				),
				isError: false,
			};

		const before = fingerprint(this.snap);
		await this.perform(action, target);
		await this.clock.sleep(this.timing.settleMs, this.signal);
		this.stopTracking();
		this.stage.outline(null);
		await this.perceive();
		return { text: this.screenText("Done.", before) };
	}

	/** Runs PowerShell after the user confirms it; counts as a Do_Mode Step. */
	async command(
		action: ActionOf<"run_command">,
	): Promise<Omit<ToolResult, "callId" | "name">> {
		if (++this.steps > STEP_LIMITS.do)
			throw end(
				false,
				`I hit my limit of ${STEP_LIMITS.do} steps, so I stopped here.`,
				"limit",
			);
		const shown =
			action.command.length > 120
				? `${action.command.slice(0, 119)}…`
				: action.command;
		await this.confirm(`${action.explanation} (runs "${shown}")`);
		if ((await this.gate()) === "resumed")
			return {
				text: this.screenText(
					"The user interrupted before this command ran, so it was not run. Decide the next step from the current screen.",
				),
			};
		void this.stage.say(action.explanation);
		const before = fingerprint(this.snap);
		const output = await this.local.runCommand(
			action.command,
			action.timeout_seconds,
			this.signal,
		);
		await this.perceive();
		return { text: this.screenText(output, before) };
	}

	async perform(
		action: ActionOf<"click" | "type_text" | "press_keys" | "scroll">,
		target: ResolvedTarget | null,
	) {
		const c = target
			? {
					x: target.rect.x + target.rect.width / 2,
					y: target.rect.y + target.rect.height / 2,
				}
			: null;
		switch (action.type) {
			case "click":
				if (!c) return;
				await this.screen.perform({
					kind: "click",
					...c,
					button: action.button,
					double: action.double,
				});
				return;
			case "type_text":
				if (c) {
					await this.screen.perform({
						kind: "click",
						...c,
						button: "left",
						double: false,
					});
					await this.clock.sleep(120, this.signal);
				}
				await this.screen.perform({ kind: "type", text: action.text });
				return;
			case "press_keys":
				await this.screen.perform({
					kind: "keys",
					keys: parseKeys(action.keys) ?? [],
				});
				return;
			case "scroll": {
				if (!c) return;
				const n = action.amount;
				const d = {
					up: [0, n],
					down: [0, -n],
					left: [-n, 0],
					right: [n, 0],
				}[action.direction];
				await this.screen.perform({ kind: "scroll", ...c, dx: d[0], dy: d[1] });
			}
		}
	}

	/** Shows a Confirmation_Prompt. Ends the Task on No or after 30 s. */
	async confirm(explanation: string) {
		const answer = await this.askUser(
			`This one needs your OK: ${explanation}. Go ahead?`,
			[
				{ id: "yes", label: "Yes", primary: true },
				{ id: "no", label: "No" },
			],
			this.timing.confirmMs,
		);
		if (answer !== "yes")
			throw end(
				false,
				answer === null
					? "No answer, so I left that alone and stopped."
					: "Okay, I won't do that. Stopped.",
				"declined",
			);
	}

	/** Shows a question with buttons; null on timeout. Input is not watched meanwhile. */
	async askUser(
		text: string,
		buttons: BubbleButton[],
		timeoutMs: number,
	): Promise<string | null> {
		this.busyWithUser = true;
		const ctrl = new AbortController();
		const onAbort = () => ctrl.abort();
		const done = this.done.signal;
		this.signal.addEventListener("abort", onAbort, { once: true });
		done.addEventListener("abort", onAbort, { once: true });
		try {
			const answer = await Promise.race([
				this.stage.say(text, buttons),
				this.clock
					.sleep(timeoutMs, ctrl.signal)
					.then(() => null)
					.catch(() => null),
			]);
			// A run that already ended leaves the stage to whoever owns it now.
			if (done.aborted) return null;
			this.checkAborted();
			if (answer === null) this.stage.hideBubble();
			return answer === "close" ? null : answer;
		} finally {
			ctrl.abort();
			this.signal.removeEventListener("abort", onAbort);
			done.removeEventListener("abort", onAbort);
			this.busyWithUser = false;
			this.graceUntil = this.clock.now() + this.timing.resumeGraceMs;
		}
	}

	userInput(e: UserInput) {
		for (const fn of this.inputListeners) fn(e);
		if (
			this.spec.mode !== "do" ||
			this.busyWithUser ||
			this.pause ||
			this.clock.now() < this.graceUntil
		)
			return;
		this.pause = this.askUser(
			"You moved — I paused. Want me to keep going?",
			[
				{ id: "continue", label: "Continue", primary: true },
				{ id: "stop", label: "Stop" },
			],
			this.timing.pauseMs,
		).then(
			(a) => (a === "continue" ? "resume" : "stop"),
			() => "stop" as const,
		);
	}

	/** Waits out a pause. "resumed" when the user chose Continue. */
	async gate(): Promise<"clear" | "resumed"> {
		if (!this.pause) return "clear";
		const decision = await this.pause;
		this.pause = null;
		this.checkAborted();
		if (decision === "stop") throw end(false, "Okay, I stopped.", "cancelled");
		await this.perceive();
		return "resumed";
	}

	// Guide_Mode

	async guideStep(
		action: ActionOf<"guide_step">,
	): Promise<Omit<ToolResult, "callId" | "name">> {
		const r = this.resolve(action.target);
		if ("error" in r) return { text: r.error, isError: true };
		if (++this.steps > STEP_LIMITS.guide)
			throw end(
				false,
				`That's ${STEP_LIMITS.guide} steps, my limit for one guide. Ask me again to pick up from here.`,
				"limit",
			);
		const n = this.steps;
		const rect = r.target.rect;
		this.showOutline(
			{
				rect,
				title: truncateTitle(action.title),
				step: { n, total: Math.max(n, action.total) },
				kind: "step",
			},
			"element" in action.target ? action.target.element : null,
		);
		await this.stage.walkTo(rect);
		void this.stage.say(action.text);

		const before = fingerprint(this.snap);
		const status = await this.waitForStep(rect, before);
		this.stopTracking();
		this.stage.outline(null);
		if (status === "closed")
			throw end(false, "Okay, we'll stop here.", "cancelled");
		if (status === "timeout")
			throw end(
				false,
				"I stopped the guide since that step sat for 5 minutes. Ask me again any time.",
				"timeout",
			);
		if (status === "skipped") {
			await this.perceive();
			return {
				text: this.screenText(
					"The user pressed Skip: treat this step as done (or done another way).",
				),
			};
		}
		return { text: this.screenText("The user acted on this step.") };
	}

	/**
	 * Resolves when the step is done (a click in the target, or a UI change
	 * after keys or between polls), skipped, closed or timed out. Leaves the
	 * new snapshot in `this.snap` when done.
	 */
	waitForStep(
		rect: Rect,
		before: string,
	): Promise<"done" | "skipped" | "closed" | "timeout"> {
		return new Promise((resolve) => {
			let settled = false;
			let checking = false;
			let keyTimer: ReturnType<typeof setTimeout> | null = null;
			const cleanup: (() => void)[] = [];
			const finish = (s: "done" | "skipped" | "closed" | "timeout") => {
				if (settled) return;
				settled = true;
				for (const fn of cleanup) fn();
				resolve(s);
			};
			const check = async (force: boolean) => {
				if (checking || settled) return;
				checking = true;
				try {
					const snap = await this.screen.snapshot();
					if (settled) return;
					if (force || fingerprint(snap) !== before) {
						this.snap = snap;
						finish("done");
					}
				} finally {
					checking = false;
				}
			};
			const onInput = (e: UserInput) => {
				if (e.kind === "click" && near(rect, e)) {
					setTimeout(() => void check(true), this.timing.clickCheckMs);
				} else if (e.kind === "key" || e.kind === "click") {
					if (keyTimer) clearTimeout(keyTimer);
					keyTimer = setTimeout(
						() => void check(false),
						e.kind === "key" ? this.timing.keyIdleMs : this.timing.clickCheckMs,
					);
				}
			};
			this.inputListeners.add(onInput);
			cleanup.push(() => this.inputListeners.delete(onInput));
			cleanup.push(() => keyTimer && clearTimeout(keyTimer));
			cleanup.push(
				this.stage.onOutlineButton((b) =>
					finish(b === "skip" ? "skipped" : "closed"),
				),
			);
			if (this.screen.canAct) {
				const poll = setInterval(() => void check(false), this.timing.pollMs);
				cleanup.push(() => clearInterval(poll));
			}
			const timer = setTimeout(
				() => finish("timeout"),
				this.timing.guideStepMs,
			);
			cleanup.push(() => clearTimeout(timer));
			const onAbort = () => finish("closed");
			this.signal.addEventListener("abort", onAbort, { once: true });
			cleanup.push(() => this.signal.removeEventListener("abort", onAbort));
		});
	}

	// Outlines

	/** Shows an Outline and keeps it on an element as the element moves. */
	showOutline(spec: OutlineSpec, element: string | null) {
		this.stopTracking();
		this.stage.outline(spec);
		if (!element) return;
		let rect = spec.rect;
		this.trackTimer = setInterval(async () => {
			const next = await this.screen.elementRect(element).catch(() => null);
			if (!next || !this.trackTimer) return;
			if (
				Math.abs(next.x - rect.x) > 1 ||
				Math.abs(next.y - rect.y) > 1 ||
				Math.abs(next.width - rect.width) > 1 ||
				Math.abs(next.height - rect.height) > 1
			) {
				rect = next;
				this.stage.outline({ ...spec, rect });
			}
		}, this.timing.trackMs);
	}

	stopTracking() {
		if (this.trackTimer) clearInterval(this.trackTimer);
		this.trackTimer = null;
	}
}
