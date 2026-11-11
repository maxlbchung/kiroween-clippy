// OpenAI Model_Provider adapter over the Responses API, which current OpenAI
// models need for tool calling.

import type { ToolSpec } from "./actions.js";
import {
	type HistoryItem,
	looksLikeVisionError,
	MODEL_TIMEOUT_MS,
	type ModelClient,
	ModelError,
	type ModelReply,
	type ModelRequest,
	type ToolCall,
} from "./model.js";
import { SseParser } from "./sse.js";

export const OPENAI_BASE = "https://api.openai.com/v1";

type InputItem = Record<string, unknown>;
type OutputItem = {
	type: string;
	role?: string;
	content?: { type: string; text?: string; refusal?: string }[];
	call_id?: string;
	name?: string;
	arguments?: string;
};
type ResponseBody = {
	status?: string;
	incomplete_details?: { reason?: string } | null;
	output?: OutputItem[];
	error?: { message?: string } | null;
};

const imageUrl = (mime: string, data: string) => `data:${mime};base64,${data}`;

/** Converts provider-neutral history into Responses API input items. */
export function toOpenAIInput(history: HistoryItem[]): InputItem[] {
	const items: InputItem[] = [];
	for (const h of history) {
		if (h.role === "user") {
			items.push({
				role: "user",
				content: h.parts.map((p) =>
					p.type === "text"
						? { type: "input_text", text: p.text }
						: {
								type: "input_image",
								image_url: imageUrl(p.mime, p.data),
								detail: "high",
							},
				),
			});
		} else if (h.role === "assistant") {
			for (const item of (h.native as OutputItem[]) ?? []) {
				if (item.type === "message" && item.role === "assistant") {
					const text = (item.content ?? []).map((c) => c.text ?? "").join("");
					if (text)
						items.push({
							role: "assistant",
							content: [{ type: "output_text", text }],
						});
				} else if (item.type === "function_call") {
					// Replayed without the item id: stored reasoning items are not
					// kept (store: false), and an id would require them.
					items.push({
						type: "function_call",
						call_id: item.call_id,
						name: item.name,
						arguments: item.arguments ?? "{}",
					});
				}
			}
		} else {
			const images: InputItem[] = [];
			for (const r of h.results) {
				items.push({
					type: "function_call_output",
					call_id: r.callId,
					output: r.isError ? `Error: ${r.text}` : r.text,
				});
				if (r.image)
					images.push({
						type: "input_image",
						image_url: imageUrl(r.image.mime, r.image.data),
						detail: "high",
					});
			}
			if (images.length)
				items.push({
					role: "user",
					content: [
						{
							type: "input_text",
							text: "Screenshot from the tool call above:",
						},
						...images,
					],
				});
		}
	}
	return items;
}

export function toOpenAITools(tools: ToolSpec[]) {
	return tools.map((t) => ({
		type: "function",
		name: t.name,
		description: t.description,
		parameters: t.parameters,
		strict: false,
	}));
}

/** Reads a completed Responses API body into a provider-neutral reply. */
export function fromOpenAIResponse(body: ResponseBody): ModelReply {
	const output = body.output ?? [];
	let text = "";
	let refused = false;
	const calls: ToolCall[] = [];
	for (const item of output) {
		if (item.type === "message") {
			for (const c of item.content ?? []) {
				if (c.type === "output_text") text += c.text ?? "";
				if (c.type === "refusal") refused = true;
			}
		} else if (item.type === "function_call") {
			let input: unknown;
			let error: string | undefined;
			try {
				input = JSON.parse(item.arguments || "{}");
			} catch {
				error = "Tool arguments are not valid JSON";
			}
			calls.push({
				id: item.call_id ?? "",
				name: item.name ?? "",
				input,
				error,
			});
		}
	}
	const stop: ModelReply["stop"] = refused
		? "refusal"
		: body.status === "incomplete" &&
				body.incomplete_details?.reason === "max_output_tokens"
			? "max_tokens"
			: calls.length
				? "tool"
				: body.status === "completed" || !body.status
					? "end"
					: "other";
	return { text, calls, native: output, stop };
}

/**
 * POSTs `body` with a bearer key and reads the reply with `read`. Maps HTTP
 * errors, aborts, timeouts and network failures to ModelErrors.
 */
export async function post<T>(
	fetchImpl: typeof fetch,
	url: string,
	apiKey: string,
	body: unknown,
	req: ModelRequest,
	hadImages: boolean,
	read: (res: Response) => Promise<T>,
): Promise<T> {
	const timeout = AbortSignal.timeout(req.timeoutMs ?? MODEL_TIMEOUT_MS);
	const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
	let res: Response;
	try {
		res = await fetchImpl(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		throw abortOr(err, req.signal, timeout);
	}
	if (!res.ok) {
		let message = `${res.status} ${res.statusText}`;
		try {
			message = ((await res.json()) as ResponseBody)?.error?.message || message;
		} catch {
			/* keep status */
		}
		throw errorFor(res.status, message, hadImages);
	}
	try {
		return await read(res);
	} catch (err) {
		if (err instanceof ModelError) throw err;
		throw abortOr(err, req.signal, timeout);
	}
}

function errorFor(status: number, message: string, hadImages: boolean) {
	if (status === 401 || status === 403)
		return new ModelError("auth", `OpenAI rejected the API key: ${message}`);
	if (status === 429)
		return new ModelError("rate", `OpenAI rate limit: ${message}`);
	if (status === 400 && hadImages && looksLikeVisionError(message))
		return new ModelError("no-vision", message);
	if (status >= 400 && status < 500)
		return new ModelError("bad-request", `OpenAI: ${message}`);
	return new ModelError(
		"server",
		`OpenAI server error (${status}): ${message}`,
	);
}

export function createOpenAIClient({
	apiKey,
	baseUrl = OPENAI_BASE,
	fetchImpl = fetch,
}: {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}): ModelClient {
	const url = `${(baseUrl || OPENAI_BASE).replace(/\/+$/, "")}/responses`;
	// Compatible endpoints may reject the reasoning field, so only OpenAI gets it.
	const official = url === `${OPENAI_BASE}/responses`;
	return {
		provider: "openai",
		async complete(req: ModelRequest): Promise<ModelReply> {
			const stream = !!req.onText;
			const input = toOpenAIInput(req.history);
			const hadImages = JSON.stringify(input).includes('"input_image"');
			const body = {
				model: req.model,
				instructions: req.system,
				input,
				tools: req.tools.length ? toOpenAITools(req.tools) : undefined,
				tool_choice: req.tools.length
					? req.requireTool
						? "required"
						: "auto"
					: undefined,
				parallel_tool_calls: req.tools.length ? false : undefined,
				max_output_tokens: req.maxTokens ?? 16000,
				reasoning: official && req.effort ? { effort: req.effort } : undefined,
				store: false,
				stream,
			};
			return post(fetchImpl, url, apiKey, body, req, hadImages, async (res) =>
				stream
					? readStream(res, req.onText)
					: fromOpenAIResponse((await res.json()) as ResponseBody),
			);
		},
	};
}

function abortOr(
	err: unknown,
	user: AbortSignal | undefined,
	timeout: AbortSignal,
) {
	if (user?.aborted) return new ModelError("aborted", "Cancelled");
	if (timeout.aborted)
		return new ModelError("timeout", "OpenAI did not answer within 60 seconds");
	return new ModelError(
		"network",
		`Couldn't reach OpenAI: ${err instanceof Error ? err.message : String(err)}`,
	);
}

async function readStream(
	res: Response,
	onText: ((delta: string) => void) | undefined,
): Promise<ModelReply> {
	if (!res.body) throw new ModelError("server", "OpenAI sent an empty stream");
	const parser = new SseParser();
	const decoder = new TextDecoder();
	let final: ResponseBody | null = null;
	const handle = (data: string) => {
		if (!data || data === "[DONE]") return;
		const evt = JSON.parse(data) as {
			type?: string;
			delta?: string;
			response?: ResponseBody;
			message?: string;
		};
		if (evt.type === "response.output_text.delta" && evt.delta)
			onText?.(evt.delta);
		else if (
			evt.type === "response.completed" ||
			evt.type === "response.incomplete"
		)
			final = evt.response ?? null;
		else if (evt.type === "response.failed")
			throw new ModelError(
				"server",
				evt.response?.error?.message || "OpenAI could not finish the reply",
			);
		else if (evt.type === "error")
			throw new ModelError("server", evt.message || "OpenAI stream error");
	};
	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		for (const e of parser.push(decoder.decode(chunk, { stream: true })))
			handle(e.data);
	}
	for (const e of parser.end()) handle(e.data);
	if (!final) throw new ModelError("server", "OpenAI stream ended early");
	return fromOpenAIResponse(final);
}
