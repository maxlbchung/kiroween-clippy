// Model_Provider adapter for OpenAI-compatible endpoints over Chat
// Completions, the API gateways most often implement with tool calling.

import type { ToolSpec } from "./actions.js";
import {
	type HistoryItem,
	type ModelClient,
	ModelError,
	type ModelReply,
	type Part,
	type ToolCall,
} from "./model.js";
import { OPENAI_BASE, post } from "./openai.js";
import { SseParser } from "./sse.js";

type Message = Record<string, unknown>;
type WireCall = {
	id?: string;
	function?: { name?: string; arguments?: string };
};
type Choice = {
	message?: {
		content?: string | null;
		refusal?: string | null;
		tool_calls?: WireCall[];
	};
	finish_reason?: string | null;
};

/** A user message's content: plain text, or parts when it carries images. */
function content(parts: Part[]) {
	if (parts.every((p) => p.type === "text"))
		return parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
	return parts.map((p) =>
		p.type === "text"
			? { type: "text", text: p.text }
			: {
					type: "image_url",
					image_url: { url: `data:${p.mime};base64,${p.data}` },
				},
	);
}

/** Converts provider-neutral history into Chat Completions messages. */
export function toChatMessages(
	system: string,
	history: HistoryItem[],
): Message[] {
	const out: Message[] = [{ role: "system", content: system }];
	for (const h of history) {
		if (h.role === "user")
			out.push({ role: "user", content: content(h.parts) });
		else if (h.role === "assistant")
			out.push({
				role: "assistant",
				content: h.text,
				...(h.calls.length && {
					tool_calls: h.calls.map((c) => ({
						id: c.id,
						type: "function",
						function: {
							name: c.name,
							arguments: JSON.stringify(c.input ?? {}),
						},
					})),
				}),
			});
		else {
			const images: Part[] = [];
			for (const r of h.results) {
				out.push({
					role: "tool",
					tool_call_id: r.callId,
					content: r.isError ? `Error: ${r.text}` : r.text,
				});
				if (r.image) images.push(r.image);
			}
			// Tool messages carry only text, so screenshots follow as a user message.
			if (images.length)
				out.push({
					role: "user",
					content: content([
						{ type: "text", text: "Screenshot from the tool call above:" },
						...images,
					]),
				});
		}
	}
	return out;
}

export function toChatTools(tools: ToolSpec[]) {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

/** Reads the first choice of a Chat Completions reply. */
export function fromChatChoice(choice: Choice | undefined): ModelReply {
	const m = choice?.message ?? {};
	const calls: ToolCall[] = (m.tool_calls ?? []).map((c, i) => {
		const id = c.id || `call_${i}`;
		const name = c.function?.name ?? "";
		try {
			return { id, name, input: JSON.parse(c.function?.arguments || "{}") };
		} catch {
			return {
				id,
				name,
				input: undefined,
				error: "Tool arguments are not valid JSON",
			};
		}
	});
	const r = choice?.finish_reason;
	const stop: ModelReply["stop"] =
		m.refusal || r === "content_filter"
			? "refusal"
			: calls.length
				? "tool"
				: r === "length"
					? "max_tokens"
					: r === "stop" || !r
						? "end"
						: "other";
	return { text: m.content ?? "", calls, native: m, stop };
}

/** Assembles a streamed reply, passing text deltas to `onText`. */
async function readStream(
	res: Response,
	onText: ((delta: string) => void) | undefined,
): Promise<ModelReply> {
	if (!res.body)
		throw new ModelError("server", "The endpoint sent an empty stream");
	const parser = new SseParser();
	const decoder = new TextDecoder();
	let text = "";
	let refusal = "";
	let finish: string | null = null;
	const calls: { id?: string; name: string; args: string }[] = [];
	const handle = (data: string) => {
		if (!data || data === "[DONE]") return;
		const evt = JSON.parse(data) as {
			choices?: {
				delta?: {
					content?: string | null;
					refusal?: string | null;
					tool_calls?: (WireCall & { index?: number })[];
				};
				finish_reason?: string | null;
			}[];
			error?: { message?: string };
		};
		if (evt.error)
			throw new ModelError(
				"server",
				evt.error.message || "The endpoint sent a stream error",
			);
		const choice = evt.choices?.[0];
		if (!choice) return;
		const d = choice.delta ?? {};
		if (d.content) {
			text += d.content;
			onText?.(d.content);
		}
		if (d.refusal) refusal += d.refusal;
		for (const t of d.tool_calls ?? []) {
			calls[t.index ?? 0] ??= { name: "", args: "" };
			const slot = calls[t.index ?? 0];
			if (t.id) slot.id = t.id;
			slot.name += t.function?.name ?? "";
			slot.args += t.function?.arguments ?? "";
		}
		if (choice.finish_reason) finish = choice.finish_reason;
	};
	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		for (const e of parser.push(decoder.decode(chunk, { stream: true })))
			handle(e.data);
	}
	for (const e of parser.end()) handle(e.data);
	return fromChatChoice({
		message: {
			content: text,
			refusal: refusal || null,
			tool_calls: calls
				.filter(Boolean)
				.map((c) => ({
					id: c.id,
					function: { name: c.name, arguments: c.args },
				})),
		},
		finish_reason: finish,
	});
}

export function createChatCompletionsClient({
	apiKey,
	baseUrl = OPENAI_BASE,
	fetchImpl = fetch,
}: {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}): ModelClient {
	const url = `${(baseUrl || OPENAI_BASE).replace(/\/+$/, "")}/chat/completions`;
	return {
		provider: "openai",
		async complete(req) {
			const stream = !!req.onText;
			const messages = toChatMessages(req.system, req.history);
			const body = {
				model: req.model,
				messages,
				tools: req.tools.length ? toChatTools(req.tools) : undefined,
				tool_choice: req.tools.length
					? req.requireTool
						? "required"
						: "auto"
					: undefined,
				parallel_tool_calls: req.tools.length ? false : undefined,
				stream,
			};
			const hadImages = JSON.stringify(messages).includes('"image_url"');
			return post(fetchImpl, url, apiKey, body, req, hadImages, async (res) =>
				stream
					? readStream(res, req.onText)
					: fromChatChoice(
							((await res.json()) as { choices?: Choice[] }).choices?.[0],
						),
			);
		},
	};
}
