// Agent seams. Both the chat agent ("system 2") and the direct action agent
// ("system 1", UI Automation) are stubs for now: the UI, IPC and streaming
// contract are real, so a model-backed implementation can drop in here.

import type { ChatMessage } from "../shared/types.js";
import type { Settings } from "./settings.js";

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new Error("aborted"));
			},
			{ once: true },
		);
	});

const NO_KEY_REPLIES = [
	"Hi there! My brain isn't plugged in yet — the chat agent is still being built. Once it's ready, add an API key in Settings and I'll actually answer you.",
	"Ooh, good question. Unfortunately I'm just a paperclip with great eyebrows right now — my agent hasn't been wired up yet. Check back soon!",
];
const KEY_REPLIES = [
	"I can see your API key is saved — nice! The chat agent itself isn't implemented yet, so this is just a placeholder reply. Soon I'll answer for real.",
	"Key's in place, model's picked… now we just need my agent to be written. Until then, I'm all eyebrows and no answers!",
];

export function createAgent({ settings }: { settings: Settings }) {
	const hasKey = () => {
		const p = settings.data.ai.provider;
		return settings.hasSecret(
			p === "openai" ? "openai" : p === "compatible" ? "custom" : "anthropic",
		);
	};

	return {
		/**
		 * Stream a reply. Yields text chunks.
		 * @param {{role: 'user'|'assistant', content: string}[]} messages
		 * @param {AbortSignal} signal
		 */
		async *chat(messages: ChatMessage[], signal: AbortSignal) {
			const pool = hasKey() ? KEY_REPLIES : NO_KEY_REPLIES;
			const turn = messages.filter((m) => m.role === "user").length;
			const reply = pool[(turn - 1) % pool.length];
			await sleep(650 + Math.random() * 400, signal); // "thinking"
			for (const word of reply.split(/(\s+)/)) {
				await sleep(word.trim() ? 28 + Math.random() * 45 : 0, signal);
				yield word;
			}
		},

		/**
		 * Fire-and-forget computer action from a spoken command. No reply text.
		 * A real implementation would plan with the fast model and act via UIA.
		 */
		async direct(command: string) {
			const text = String(command || "").trim();
			if (!text) return { status: "empty" };
			console.log(`[direct] queued (agent not implemented): "${text}"`);
			return {
				status: "queued",
				agent: false,
				model: settings.data.ai.directModel,
			};
		},
	};
}
