// Anthropic Model_Provider adapter over the Messages API (official SDK).

import Anthropic from "@anthropic-ai/sdk";
import type { ToolSpec } from "./actions.js";
import {
	type HistoryItem,
	looksLikeVisionError,
	MODEL_TIMEOUT_MS,
	type ModelClient,
	ModelError,
	type ModelReply,
	type ModelRequest,
} from "./model.js";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlock;

/** Models that take the server-side refusal fallback chain. */
const FALLBACK_MODELS = new Set([
	"claude-fable-5-1",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-sonnet-5-5",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Converts provider-neutral history into Messages API messages. */
export function toAnthropicMessages(history: HistoryItem[]): MessageParam[] {
	const out: MessageParam[] = [];
	for (const h of history) {
		if (h.role === "user") {
			out.push({
				role: "user",
				content: h.parts.map((p) =>
					p.type === "text"
						? { type: "text" as const, text: p.text }
						: {
								type: "image" as const,
								source: {
									type: "base64" as const,
									media_type: p.mime,
									data: p.data,
								},
							},
				),
			});
		} else if (h.role === "assistant") {
			// Replays the full content, thinking blocks included, unchanged.
			out.push({
				role: "assistant",
				content: h.native as Anthropic.Beta.BetaMessageContentParam,
			});
		} else {
			out.push({
				role: "user",
				content: h.results.map((r) => ({
					type: "tool_result" as const,
					tool_use_id: r.callId,
					is_error: r.isError || undefined,
					content: r.image
						? [
								{ type: "text" as const, text: r.text },
								{
									type: "image" as const,
									source: {
										type: "base64" as const,
										media_type: r.image.mime,
										data: r.image.data,
									},
								},
							]
						: r.text,
				})),
			});
		}
	}
	return out;
}

export function toAnthropicTools(tools: ToolSpec[], streaming: boolean) {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
		...(streaming ? { eager_input_streaming: true } : {}),
	}));
}

/** Reads a Messages API response into a provider-neutral reply. */
export function fromAnthropicMessage(msg: {
	content: Block[];
	stop_reason: string | null;
}): ModelReply {
	let text = "";
	const calls: ModelReply["calls"] = [];
	for (const b of msg.content) {
		if (b.type === "text") text += b.text;
		else if (b.type === "tool_use")
			calls.push({ id: b.id, name: b.name, input: b.input });
	}
	const stop: ModelReply["stop"] =
		msg.stop_reason === "refusal"
			? "refusal"
			: msg.stop_reason === "max_tokens"
				? "max_tokens"
				: msg.stop_reason === "tool_use"
					? "tool"
					: msg.stop_reason === "end_turn"
						? "end"
						: "other";
	return { text, calls, native: msg.content, stop };
}

function toModelError(err: unknown, hadImages: boolean): ModelError {
	if (err instanceof ModelError) return err;
	if (err instanceof Anthropic.APIUserAbortError)
		return new ModelError("aborted", "Cancelled");
	if (err instanceof Anthropic.APIConnectionTimeoutError)
		return new ModelError(
			"timeout",
			"Anthropic did not answer within 60 seconds",
		);
	if (err instanceof Anthropic.APIConnectionError)
		return new ModelError(
			"network",
			`Couldn't reach Anthropic: ${err.message}`,
		);
	if (err instanceof Anthropic.AuthenticationError)
		return new ModelError(
			"auth",
			`Anthropic rejected the API key: ${err.message}`,
		);
	if (err instanceof Anthropic.PermissionDeniedError)
		return new ModelError("auth", `Anthropic denied access: ${err.message}`);
	if (err instanceof Anthropic.RateLimitError)
		return new ModelError("rate", `Anthropic rate limit: ${err.message}`);
	if (err instanceof Anthropic.BadRequestError)
		return hadImages && looksLikeVisionError(err.message)
			? new ModelError("no-vision", err.message)
			: new ModelError("bad-request", `Anthropic: ${err.message}`);
	if (err instanceof Anthropic.APIError)
		return new ModelError(
			"server",
			`Anthropic error (${err.status}): ${err.message}`,
		);
	return new ModelError(
		"network",
		err instanceof Error ? err.message : String(err),
	);
}

export function createAnthropicClient({
	apiKey,
}: {
	apiKey: string;
}): ModelClient {
	const client = new Anthropic({ apiKey, maxRetries: 1 });
	return {
		provider: "anthropic",
		async complete(req: ModelRequest): Promise<ModelReply> {
			const streaming = !!req.onText;
			const messages = toAnthropicMessages(req.history);
			const hadImages = JSON.stringify(messages).includes('"type":"image"');
			const fallback = FALLBACK_MODELS.has(req.model);
			const params: Params = {
				model: req.model,
				max_tokens: req.maxTokens ?? 16000,
				system: req.system,
				messages,
				// Caches the stable tools + system prefix across task steps.
				cache_control: { type: "ephemeral" },
				...(req.tools.length
					? {
							tools: toAnthropicTools(req.tools, streaming),
							// Forced tool use is rejected by current models; the
							// system prompt asks for exactly one tool call instead.
							tool_choice: { type: "auto", disable_parallel_tool_use: true },
						}
					: {}),
				...(req.effort ? { output_config: { effort: req.effort } } : {}),
				...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
			};
			const options = {
				signal: req.signal,
				timeout: req.timeoutMs ?? MODEL_TIMEOUT_MS,
			};
			try {
				if (!streaming)
					return fromAnthropicMessage(
						await client.beta.messages.create(params, options),
					);
				const stream = client.beta.messages.stream(params, options);
				stream.on("text", (delta) => req.onText?.(delta));
				return fromAnthropicMessage(await stream.finalMessage());
			} catch (err) {
				if (req.signal?.aborted) throw new ModelError("aborted", "Cancelled");
				throw toModelError(err, hadImages);
			}
		},
	};
}
