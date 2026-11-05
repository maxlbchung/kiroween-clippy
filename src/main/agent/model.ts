// Provider-neutral conversation and model-client types. Each Model_Provider
// adapter turns this history into its own request format.

import type { ToolSpec } from "./actions.js";

export type ImagePart = {
	type: "image";
	mime: "image/jpeg" | "image/png";
	/** Base64 without a data: prefix. */
	data: string;
};
export type Part = { type: "text"; text: string } | ImagePart;

export type ToolCall = {
	id: string;
	name: string;
	input: unknown;
	/** Set when the provider returned arguments that are not valid JSON. */
	error?: string;
};

export type ToolResult = {
	callId: string;
	name: string;
	text: string;
	image?: ImagePart;
	isError?: boolean;
};

export type HistoryItem =
	| { role: "user"; parts: Part[] }
	| {
			role: "assistant";
			text: string;
			calls: ToolCall[];
			/** The provider's own output, replayed unchanged on later requests. */
			native: unknown;
	  }
	| { role: "tool"; results: ToolResult[] };

export type ModelRequest = {
	model: string;
	system: string;
	history: HistoryItem[];
	tools: ToolSpec[];
	/** True when the reply must be a tool call (task loops). */
	requireTool?: boolean;
	effort?: "low" | "medium" | "high";
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Streams reply text as it arrives. */
	onText?: (delta: string) => void;
};

export type ModelReply = {
	text: string;
	calls: ToolCall[];
	native: unknown;
	stop: "end" | "tool" | "refusal" | "max_tokens" | "other";
};

export type ModelErrorKind =
	| "auth"
	| "rate"
	| "network"
	| "timeout"
	| "bad-request"
	| "no-vision"
	| "server"
	| "aborted";

export class ModelError extends Error {
	kind: ModelErrorKind;
	constructor(kind: ModelErrorKind, message: string) {
		super(message);
		this.kind = kind;
	}
}

export interface ModelClient {
	readonly provider: "openai" | "anthropic";
	complete(req: ModelRequest): Promise<ModelReply>;
}

export const MODEL_TIMEOUT_MS = 60_000;

/** True when a history contains an image the model would have to read. */
export function hasImages(history: HistoryItem[]): boolean {
	return history.some(
		(h) =>
			(h.role === "user" && h.parts.some((p) => p.type === "image")) ||
			(h.role === "tool" && h.results.some((r) => r.image)),
	);
}

/** Copy of `history` with every image replaced by a short note. */
export function withoutImages(history: HistoryItem[]): HistoryItem[] {
	const note = "(screenshot omitted: this model cannot read images)";
	return history.map((h) => {
		if (h.role === "user")
			return {
				...h,
				parts: h.parts.map((p) =>
					p.type === "image" ? { type: "text" as const, text: note } : p,
				),
			};
		if (h.role === "tool")
			return {
				...h,
				results: h.results.map((r) =>
					r.image ? { ...r, image: undefined, text: `${r.text}\n${note}` } : r,
				),
			};
		return h;
	});
}

/** Error message that reads as a provider rejecting image input. */
export function looksLikeVisionError(message: string): boolean {
	return /image|vision|multimodal|input_image/i.test(message);
}
