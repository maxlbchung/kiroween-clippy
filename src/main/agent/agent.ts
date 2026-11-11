// The Clippy_Agent: answers chat, runs Tasks from chat, Direct commands and
// tips, and drives the Watcher. Wires the model providers, the screen, the
// overlay and the pet together.

import { screen as electronScreen, powerMonitor } from "electron";
import type {
	ChatMessage,
	DirectResult,
	Point,
	Rect,
} from "../../shared/types.js";
import type { DesktopHost, DesktopScreen } from "../desktop.js";
import { windowToDip } from "../desktop.js";
import type { Overlay } from "../overlay.js";
import type { Panels } from "../panels.js";
import type { Pet } from "../pet.js";
import { bodyRect } from "../placement.js";
import type { Settings } from "../settings.js";
import {
	type ActionType,
	parseAction,
	resolveTarget,
	TASK_TOOLS,
	TOOLS,
} from "./actions.js";
import { createAnthropicClient } from "./anthropic.js";
import { createChatCompletionsClient } from "./chat-completions.js";
import { placeNear, walkDuration } from "./geometry.js";
import type {
	HistoryItem,
	ModelClient,
	ToolCall,
	ToolResult,
} from "./model.js";
import { createOpenAIClient } from "./openai.js";
import { ASSESS_SYSTEM, CHAT_SYSTEM, TIP_SYSTEM } from "./prompts.js";
import { type Stage, type TaskOutcome, TaskRunner } from "./runner.js";
import { elementIndex, formatSnapshot, type WindowInfo } from "./snapshot.js";
import { localTools, lookup } from "./tools.js";
import {
	TipGate,
	type Trigger,
	TriggerDetector,
	tipMinutes,
	WATCH,
} from "./watcher.js";

/** Most chat messages sent in one model request. */
export const MAX_CHAT_MESSAGES = 40;
const MAX_CHAT_TURNS = 6;
const DIRECT_SUMMARY_MAX = 80;
const SUMMARY_MAX = 200;
const NOTE_MAX = 400;

type Origin = "chat" | "direct" | "tip";

const KEY_FOR = {
	openai: "openai",
	anthropic: "anthropic",
	compatible: "custom",
} as const;
const KEY_LABEL = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	compatible: "OpenAI-compatible endpoint",
} as const;

const clip = (s: string, n: number) =>
	s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

/** A plain assistant text turn in the provider's native replay format. */
function assistantText(provider: ModelClient["provider"], text: string) {
	return {
		role: "assistant" as const,
		text,
		calls: [] as ToolCall[],
		native:
			provider === "anthropic"
				? [{ type: "text", text }]
				: [
						{
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text }],
						},
					],
	};
}

export type ChatResult = {
	task: { goal: string; mode: "guide" | "do" } | null;
};

export function createAgent({
	settings,
	screen,
	host,
	overlay,
	pet,
	panels,
	isPlaying,
}: {
	settings: Settings;
	screen: DesktopScreen;
	host: DesktopHost;
	overlay: Overlay;
	pet: Pet;
	panels: Panels;
	isPlaying: () => boolean;
}) {
	let home: Point | null = null;
	let current: { ctrl: AbortController; done: Promise<void> } | null = null;
	/** Tasks between ending the running Task and becoming `current`. */
	let starting = 0;

	// Models

	function provider() {
		const p = settings.data.ai.provider;
		return p === "anthropic" || p === "compatible" ? p : "openai";
	}

	function hasKey() {
		return settings.hasSecret(KEY_FOR[provider()]);
	}

	/** A client for the selected provider, or null after telling the user the key is missing. */
	async function client(): Promise<ModelClient | null> {
		const p = provider();
		const apiKey = await settings.getSecret(KEY_FOR[p]);
		if (!apiKey) return null;
		if (p === "anthropic") return createAnthropicClient({ apiKey });
		if (p === "compatible")
			return createChatCompletionsClient({
				apiKey,
				baseUrl: settings.data.ai.baseUrl,
			});
		return createOpenAIClient({ apiKey });
	}

	function missingKeyMessage() {
		return `I need an ${KEY_LABEL[provider()]} API key first. Add one in Settings → AI.`;
	}

	// Stage

	function petBody(): Rect | null {
		const b = pet.bounds;
		return b ? bodyRect(b, pet.scale) : null;
	}

	function look(rect: Rect | null) {
		const b = pet.bounds;
		if (!rect || !b) return pet.send("pet:look", null);
		pet.send("pet:look", {
			x: rect.x + rect.width / 2 - b.x,
			y: rect.y + rect.height / 2 - b.y,
		});
	}

	async function walkTo(rect: Rect) {
		const b = pet.bounds;
		if (!b) return;
		if (!pet.visible) pet.show();
		const display = electronScreen.getDisplayNearestPoint({
			x: Math.round(rect.x + rect.width / 2),
			y: Math.round(rect.y + rect.height / 2),
		});
		const { pos } = placeNear(rect, pet.scale, display.workArea);
		await pet.animateTo(pos, walkDuration(b, pos), false);
		look(rect);
	}

	async function goHome() {
		look(null);
		const b = pet.bounds;
		const h = home;
		home = null;
		if (!b || !h) return;
		await pet.animateTo(h, walkDuration(b, h), true);
	}

	const stage: Stage = {
		outline: (spec) => overlay.outline(spec),
		say: (text, buttons) => {
			pet.send("pet:hush");
			return overlay.say(text, buttons);
		},
		hideBubble: () => overlay.hideBubble(),
		walkTo,
		goHome,
		helper: (spec) => overlay.helper(spec),
		banner: (text) => overlay.banner(text),
		mood: (m) => pet.send("pet:mood", m),
		onOutlineButton: (cb) => {
			overlay.on("outline-button", cb);
			return () => overlay.off("outline-button", cb);
		},
	};

	const syncAnchor = () => overlay.setAnchor(petBody());
	pet.on("moved", syncAnchor);
	syncAnchor();

	/** Shows a message that hides itself after a reading-time delay. */
	function announce(text: string) {
		const shown = stage.say(text);
		const id = overlay.bubbleId;
		setTimeout(
			() => {
				if (id !== null) overlay.hideBubble(id);
			},
			6000 + text.length * 40,
		);
		return shown;
	}

	// Tasks

	async function stopTask() {
		const t = current;
		if (!t) return;
		t.ctrl.abort();
		await t.done.catch(() => {});
	}

	// Esc or the Stop_Hotkey during a takeover, which the host keeps from other apps.
	host.on("cancel", (e: { reason: string }) => {
		console.error(`[agent] takeover ended by ${e.reason}`);
		void stopTask();
	});

	/**
	 * Starts a Task, ending any running one first. Returns false when the
	 * provider has no key (the user is told).
	 */
	async function startTask(
		goal: string,
		mode: "guide" | "do",
		origin: Origin,
		signal?: AbortSignal,
	): Promise<boolean> {
		starting++;
		let c: ModelClient | null;
		try {
			await stopTask();
			c = await client();
		} finally {
			starting--;
		}
		if (!c) {
			// The Direct panel shows its own rejection message.
			if (origin !== "direct") void announce(missingKeyMessage());
			return false;
		}
		const ctrl = new AbortController();
		signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
		const runner = new TaskRunner({ screen, stage });
		let finish: () => void = () => {};
		const done = new Promise<void>((r) => {
			finish = r;
		});
		current = { ctrl, done };
		tipState?.dismiss();
		await panels.close();
		// A tip that walked Clippy to its target already recorded where he lives.
		home ??= pet.bounds ? { x: pet.bounds.x, y: pet.bounds.y } : null;
		const model =
			origin === "direct"
				? settings.data.ai.directModel
				: settings.data.ai.chatModel;
		void (async () => {
			let outcome: TaskOutcome;
			try {
				outcome = await runner.run(
					{
						goal,
						mode,
						client: c,
						model,
						effort: "medium",
						auto: settings.data.ai.autoMode,
					},
					ctrl.signal,
				);
			} finally {
				if (current?.ctrl === ctrl) current = null;
				finish();
			}
			reportOutcome(outcome, origin, ctrl.signal.aborted);
		})();
		return true;
	}

	function reportOutcome(
		outcome: TaskOutcome,
		origin: Origin,
		aborted: boolean,
	) {
		// A task replaced by a newer one leaves the stage to the new task.
		if (aborted && (current || starting)) return;
		const summary = clip(
			outcome.summary,
			origin === "direct" ? DIRECT_SUMMARY_MAX : SUMMARY_MAX,
		);
		pet.send("pet:mood", outcome.success ? "happy" : null);
		setTimeout(() => pet.send("pet:mood", null), 1400);
		// Chat tasks report back in the chat they came from, not over it.
		if (origin === "chat") {
			panels.send("chat:note", { text: clip(outcome.summary, NOTE_MAX) });
			void panels.open("chat");
		} else void announce(summary);
	}

	// Chat

	/**
	 * Answers a chat conversation, streaming reply text through `onText`.
	 * Returns the Task the model asked to start, if any.
	 */
	async function chat(
		messages: ChatMessage[],
		{ signal, onText }: { signal: AbortSignal; onText: (t: string) => void },
	): Promise<ChatResult> {
		const c = await client();
		// The chat panel shows the error; a bubble would repeat it.
		if (!c) throw new Error(missingKeyMessage());
		const snap = await screen.snapshot();
		const recent = messages.slice(-MAX_CHAT_MESSAGES);
		while (recent.length && recent[0].role !== "user") recent.shift();
		// A request ends with the user's turn; a retry after a partial reply or a task note does not.
		while (recent.at(-1)?.role === "assistant") recent.pop();
		const history: HistoryItem[] = recent.map((m, i) =>
			m.role === "assistant"
				? assistantText(c.provider, m.content)
				: {
						role: "user",
						parts: [
							{
								type: "text",
								text:
									i === recent.length - 1
										? `${m.content}\n\n[Current screen]\n${formatSnapshot(snap)}`
										: m.content,
							},
						],
					},
		);
		const tools = TASK_TOOLS.chat.map((t) => TOOLS[t]);
		let wrote = false;
		let silent = true;
		const emit = (t: string) => {
			wrote = true;
			silent = false;
			onText(t);
		};
		/** Ends a reply without a Task, saying something when the model said nothing. */
		const none = (): ChatResult => {
			if (silent) onText("Hmm, I came up empty on that one. Ask me again?");
			return { task: null };
		};
		for (let turn = 0; turn < MAX_CHAT_TURNS; turn++) {
			if (wrote) onText("\n\n");
			wrote = false;
			const reply = await c.complete({
				model: settings.data.ai.chatModel,
				system: CHAT_SYSTEM,
				history,
				tools,
				effort: "low",
				signal,
				onText: emit,
			});
			if (reply.stop === "refusal" && !reply.text)
				emit("Sorry, I can't help with that one.");
			if (!reply.calls.length) return none();
			history.push({
				role: "assistant",
				text: reply.text,
				calls: reply.calls,
				native: reply.native,
			});
			const results: ToolResult[] = [];
			let task: ChatResult["task"] = null;
			for (const call of reply.calls) {
				const parsed = call.error
					? { ok: false as const, error: call.error }
					: parseAction(call.name, call.input);
				if ("error" in parsed) {
					results.push({
						callId: call.id,
						name: call.name,
						text: parsed.error,
						isError: true,
					});
				} else if (parsed.action.type === "start_task" && !task) {
					task = { goal: parsed.action.goal, mode: parsed.action.mode };
					results.push({
						callId: call.id,
						name: call.name,
						text: "Task started.",
					});
				} else if (
					parsed.action.type === "web_search" ||
					parsed.action.type === "fetch_url"
				) {
					results.push({
						callId: call.id,
						name: call.name,
						...(await lookup(localTools, parsed.action, signal)),
					});
				} else if (parsed.action.type === "screenshot") {
					const shot = await screen.screenshot();
					results.push({
						callId: call.id,
						name: call.name,
						text: shot
							? `Screenshot, ${shot.width}x${shot.height} pixels.`
							: "Screenshot unavailable.",
						image: shot?.image,
						isError: !shot,
					});
				} else {
					results.push({
						callId: call.id,
						name: call.name,
						text: "Not available here.",
						isError: true,
					});
				}
			}
			if (task) return { task };
			history.push({ role: "tool", results });
		}
		return none();
	}

	// Direct

	async function direct(command: string): Promise<DirectResult> {
		const text = String(command || "").trim();
		if (!text) return { status: "empty" };
		// The Direct panel shows the message; a bubble would repeat it.
		if (!hasKey()) return { status: "rejected", message: missingKeyMessage() };
		if (!screen.canAct)
			return {
				status: "rejected",
				message: "Doing tasks for you needs Windows.",
			};
		const started = await startTask(text, "do", "direct");
		return started
			? { status: "started" }
			: { status: "rejected", message: missingKeyMessage() };
	}

	// Watcher

	const detector = new TriggerDetector();
	const gate = new TipGate();
	let assessing = false;
	let tipState: { dismiss: () => void } | null = null;

	const tipsOn = () => settings.data.ai.tips !== false && host.supported;

	function gateState() {
		return {
			enabled: tipsOn(),
			// An open panel follows the Pet, so a tip must not walk him away.
			taskRunning: !!current || isPlaying() || panels.visible,
			petVisible: pet.visible,
			bubbleVisible: overlay.bubbleVisible,
			hasKey: hasKey(),
			tipMinutes: tipMinutes(settings.data.ai.tipMinutes),
		};
	}

	function consider(trigger: Trigger | null) {
		if (!trigger || assessing) return;
		const now = Date.now();
		if (gate.blocked(trigger, gateState(), now)) return;
		gate.evaluated(now);
		assessing = true;
		void evaluate(trigger)
			.catch((err) => console.error("[agent] tip failed:", err?.message ?? err))
			.finally(() => {
				assessing = false;
			});
	}

	async function evaluate(trigger: Trigger) {
		const c = await client();
		if (!c) return;
		const snap = await screen.snapshot();
		const screenText = formatSnapshot(snap);
		const first = await c.complete({
			model: settings.data.ai.directModel,
			system: ASSESS_SYSTEM,
			history: [
				{
					role: "user",
					parts: [
						{
							type: "text",
							text: `${trigger.reason}\n\nScreen:\n${screenText}`,
						},
					],
				},
			],
			tools: toolsFor("assess"),
			requireTool: true,
			effort: "low",
			maxTokens: 2000,
		});
		const call = first.calls[0];
		const verdict = call && parseAction(call.name, call.input);
		if (
			!verdict?.ok ||
			verdict.action.type !== "assess" ||
			!verdict.action.worthwhile
		)
			return;

		const shot = await screen.screenshot();
		const second = await c.complete({
			model: settings.data.ai.chatModel,
			system: TIP_SYSTEM,
			history: [
				{
					role: "user",
					parts: [
						{
							type: "text",
							text: `${trigger.reason} Tip subject: ${verdict.action.subject}\n\nScreen:\n${screenText}`,
						},
						...(shot ? [shot.image] : []),
					],
				},
			],
			tools: toolsFor("tip"),
			requireTool: true,
			effort: "low",
		});
		const tipCall = second.calls[0];
		const tip = tipCall && parseAction(tipCall.name, tipCall.input);
		if (!tip?.ok || tip.action.type !== "show_tip") return;
		// The world may have moved on while the models thought.
		const s = gateState();
		if (!s.enabled || s.taskRunning || s.bubbleVisible || !s.petVisible) return;
		let rect: Rect | null = null;
		if (tip.action.target) {
			const r = resolveTarget(tip.action.target, {
				elements: elementIndex(snap),
				screenshot: shot
					? { width: shot.width, height: shot.height, display: shot.display }
					: null,
				displays: screen.displays(),
			});
			if (r.ok) rect = r.target.rect;
		}
		gate.shown(Date.now());
		await showTip(
			tip.action.text,
			tip.action.title,
			rect,
			tip.action.follow_up,
			trigger.window,
		);
	}

	function toolsFor(kind: "assess" | "tip") {
		return (TASK_TOOLS[kind] as ActionType[]).map((t) => TOOLS[t]);
	}

	async function showTip(
		text: string,
		title: string,
		rect: Rect | null,
		followUp: string | null,
		window: WindowInfo,
	) {
		home = pet.bounds ? { x: pet.bounds.x, y: pet.bounds.y } : null;
		if (rect) {
			overlay.outline({ rect, title, step: null, kind: "tip" });
			await walkTo(rect);
		}
		const answer = stage.say(
			text,
			followUp ? [{ id: "show", label: "Show me", primary: true }] : [],
		);
		const id = overlay.bubbleId;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const arm = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(
				() => id !== null && overlay.hideBubble(id),
				WATCH.tipVisibleMs,
			);
		};
		const onHover = (e: { id: number; on: boolean }) => {
			if (e.id !== id) return;
			if (e.on && timer) clearTimeout(timer);
			else if (!e.on) arm();
		};
		const onOutline = (b: string) => {
			if (b === "close" && id !== null) overlay.hideBubble(id);
			gate.mute(window.process, Date.now());
		};
		overlay.on("hover", onHover);
		overlay.on("outline-button", onOutline);
		tipState = { dismiss: () => id !== null && overlay.hideBubble(id) };
		arm();
		const result = await answer;
		if (timer) clearTimeout(timer);
		overlay.off("hover", onHover);
		overlay.off("outline-button", onOutline);
		tipState = null;
		if (result === "close") gate.mute(window.process, Date.now());
		if (result === "show" && followUp) {
			overlay.outline(null);
			await startTask(followUp, "guide", "tip");
			return;
		}
		if (!current) {
			overlay.outline(null);
			await goHome();
		}
	}

	if (host.supported) {
		host.on("foreground", (e: { window: WindowInfo }) =>
			consider(detector.foreground(windowToDip(e.window), Date.now())),
		);
		host.on("undo", () => consider(detector.undo(Date.now())));
		setInterval(() => {
			if (!tipsOn()) return;
			consider(detector.tick(Date.now()));
			consider(detector.idle(powerMonitor.getSystemIdleTime() * 1000));
		}, 1000);
		host.setWatch({ undo: tipsOn() });
	}

	function applySettings() {
		if (host.supported) host.setWatch({ undo: tipsOn() });
		if (!tipsOn()) tipState?.dismiss();
	}

	return {
		chat,
		direct,
		startTask,
		stopTask,
		applySettings,
		get busy() {
			return !!current;
		},
		dispose() {
			current?.ctrl.abort();
			overlay.clear();
		},
	};
}

export type Agent = ReturnType<typeof createAgent>;
