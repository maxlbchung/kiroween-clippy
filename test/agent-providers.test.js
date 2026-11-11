import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS } from "../src/main/agent/actions.ts";
import {
	fromAnthropicMessage,
	toAnthropicMessages,
	toAnthropicTools,
} from "../src/main/agent/anthropic.ts";
import {
	hasImages,
	ModelError,
	withoutImages,
} from "../src/main/agent/model.ts";
import {
	createOpenAIClient,
	fromOpenAIResponse,
	toOpenAIInput,
} from "../src/main/agent/openai.ts";
import { formatSse } from "../src/main/agent/sse.ts";

const IMG = { type: "image", mime: "image/jpeg", data: "QUJD" };

const history = [
	{ role: "user", parts: [{ type: "text", text: "Goal" }, IMG] },
	{
		role: "assistant",
		text: "Clicking.",
		calls: [
			{ id: "c1", name: "click", input: { target: "e1", explanation: "x" } },
		],
		native: [
			{ type: "reasoning", id: "rs_1", summary: [] },
			{
				type: "message",
				role: "assistant",
				id: "msg_1",
				content: [{ type: "output_text", text: "Clicking." }],
			},
			{
				type: "function_call",
				id: "fc_1",
				call_id: "c1",
				name: "click",
				arguments: '{"target":"e1","explanation":"x"}',
			},
		],
	},
	{
		role: "tool",
		results: [{ callId: "c1", name: "click", text: "Done.", image: IMG }],
	},
];

test("OpenAI input replays calls without item ids and moves images to a user turn", () => {
	const items = toOpenAIInput(history);
	assert.deepEqual(items[0].content[1], {
		type: "input_image",
		image_url: "data:image/jpeg;base64,QUJD",
		detail: "high",
	});
	assert.ok(!items.some((i) => i.type === "reasoning"), "reasoning dropped");
	const fc = items.find((i) => i.type === "function_call");
	assert.deepEqual(fc, {
		type: "function_call",
		call_id: "c1",
		name: "click",
		arguments: '{"target":"e1","explanation":"x"}',
	});
	const out = items.find((i) => i.type === "function_call_output");
	assert.deepEqual(out, {
		type: "function_call_output",
		call_id: "c1",
		output: "Done.",
	});
	const last = items.at(-1);
	assert.equal(last.role, "user");
	assert.equal(last.content[1].type, "input_image");
});

test("OpenAI responses map to calls, text and stop reasons", () => {
	const r = fromOpenAIResponse({
		status: "completed",
		output: [
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Hi" }],
			},
			{
				type: "function_call",
				call_id: "c9",
				name: "say",
				arguments: '{"text":"yo"}',
			},
			{
				type: "function_call",
				call_id: "c10",
				name: "say",
				arguments: "{oops",
			},
		],
	});
	assert.equal(r.text, "Hi");
	assert.equal(r.stop, "tool");
	assert.deepEqual(r.calls[0], {
		id: "c9",
		name: "say",
		input: { text: "yo" },
		error: undefined,
	});
	assert.ok(r.calls[1].error);
	assert.equal(
		fromOpenAIResponse({
			status: "incomplete",
			incomplete_details: { reason: "max_output_tokens" },
			output: [],
		}).stop,
		"max_tokens",
	);
	assert.equal(
		fromOpenAIResponse({
			status: "completed",
			output: [
				{
					type: "message",
					role: "assistant",
					content: [{ type: "refusal", refusal: "no" }],
				},
			],
		}).stop,
		"refusal",
	);
});

test("OpenAI client sends a Responses API request and reads the reply", async () => {
	let seen;
	const fetchImpl = async (url, init) => {
		seen = { url, init, body: JSON.parse(init.body) };
		return new Response(
			JSON.stringify({
				status: "completed",
				output: [
					{
						type: "function_call",
						call_id: "c1",
						name: "finish",
						arguments: '{"success":true,"summary":"ok"}',
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	};
	const client = createOpenAIClient({
		apiKey: "sk-test",
		baseUrl: "https://gw.example/v1/",
		fetchImpl,
	});
	const reply = await client.complete({
		model: "gpt-test",
		system: "SYS",
		history: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
		tools: [TOOLS.finish, TOOLS.say],
		requireTool: true,
		effort: "low",
	});
	assert.equal(seen.url, "https://gw.example/v1/responses");
	assert.equal(seen.init.headers.Authorization, "Bearer sk-test");
	assert.equal(seen.body.model, "gpt-test");
	assert.equal(seen.body.instructions, "SYS");
	assert.equal(seen.body.tool_choice, "required");
	assert.equal(seen.body.parallel_tool_calls, false);
	assert.equal(seen.body.store, false);
	assert.equal(seen.body.reasoning, undefined);
	assert.deepEqual(
		seen.body.tools.map((t) => [t.type, t.name]),
		[
			["function", "finish"],
			["function", "say"],
		],
	);
	assert.equal(reply.calls[0].name, "finish");
	assert.deepEqual(reply.calls[0].input, { success: true, summary: "ok" });
});

test("OpenAI client streams text deltas", async () => {
	const body = formatSse([
		{
			event: "response.output_text.delta",
			data: JSON.stringify({
				type: "response.output_text.delta",
				delta: "Hel",
			}),
		},
		{
			event: "response.output_text.delta",
			data: JSON.stringify({ type: "response.output_text.delta", delta: "lo" }),
		},
		{
			event: "response.completed",
			data: JSON.stringify({
				type: "response.completed",
				response: {
					status: "completed",
					output: [
						{
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: "Hello" }],
						},
					],
				},
			}),
		},
	]);
	const bytes = new TextEncoder().encode(body);
	const stream = new ReadableStream({
		start(c) {
			for (let i = 0; i < bytes.length; i += 7)
				c.enqueue(bytes.slice(i, i + 7));
			c.close();
		},
	});
	const client = createOpenAIClient({
		apiKey: "k",
		fetchImpl: async () => new Response(stream, { status: 200 }),
	});
	const deltas = [];
	const reply = await client.complete({
		model: "m",
		system: "s",
		history: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
		tools: [],
		onText: (d) => deltas.push(d),
	});
	assert.deepEqual(deltas, ["Hel", "lo"]);
	assert.equal(reply.text, "Hello");
	assert.equal(reply.stop, "end");
});

test("OpenAI errors map to ModelError kinds", async () => {
	const failWith = (status, message) =>
		createOpenAIClient({
			apiKey: "k",
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: { message } }), { status }),
		});
	const req = {
		model: "m",
		system: "s",
		history: [{ role: "user", parts: [IMG] }],
		tools: [],
	};
	for (const [status, message, kind] of [
		[401, "bad key", "auth"],
		[429, "slow down", "rate"],
		[400, "Invalid image input", "no-vision"],
		[400, "Unknown parameter", "bad-request"],
		[500, "boom", "server"],
	]) {
		await assert.rejects(failWith(status, message).complete(req), (err) => {
			assert.ok(err instanceof ModelError);
			assert.equal(err.kind, kind, `${status} ${message}`);
			return true;
		});
	}
	const ctrl = new AbortController();
	ctrl.abort();
	await assert.rejects(
		createOpenAIClient({
			apiKey: "k",
			fetchImpl: async (_u, init) => {
				init.signal.throwIfAborted();
				return new Response("{}");
			},
		}).complete({ ...req, signal: ctrl.signal }),
		(err) => err.kind === "aborted",
	);
});

test("Anthropic messages replay native content and nest images in tool results", () => {
	const anthropicHistory = [
		history[0],
		{
			role: "assistant",
			text: "",
			calls: [],
			native: [
				{ type: "thinking", thinking: "", signature: "sig" },
				{
					type: "tool_use",
					id: "toolu_1",
					name: "click",
					input: { target: "e1", explanation: "x" },
				},
			],
		},
		{
			role: "tool",
			results: [
				{
					callId: "toolu_1",
					name: "click",
					text: "Done.",
					image: IMG,
					isError: false,
				},
			],
		},
	];
	const msgs = toAnthropicMessages(anthropicHistory);
	assert.equal(msgs.length, 3);
	assert.deepEqual(msgs[0].content[1], {
		type: "image",
		source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
	});
	assert.equal(
		msgs[1].content[0].type,
		"thinking",
		"thinking blocks replay unchanged",
	);
	const result = msgs[2].content[0];
	assert.equal(result.type, "tool_result");
	assert.equal(result.tool_use_id, "toolu_1");
	assert.equal(result.content[0].text, "Done.");
	assert.equal(result.content[1].type, "image");
	const tools = toAnthropicTools([TOOLS.click], true);
	assert.equal(tools[0].input_schema.type, "object");
	assert.equal(tools[0].eager_input_streaming, true);
	assert.equal(
		toAnthropicTools([TOOLS.click], false)[0].eager_input_streaming,
		undefined,
	);
});

test("Anthropic responses map to calls and stop reasons", () => {
	const r = fromAnthropicMessage({
		stop_reason: "tool_use",
		content: [
			{ type: "thinking", thinking: "", signature: "s" },
			{ type: "text", text: "Okay." },
			{ type: "tool_use", id: "t1", name: "say", input: { text: "hi" } },
		],
	});
	assert.equal(r.text, "Okay.");
	assert.equal(r.stop, "tool");
	assert.deepEqual(r.calls, [{ id: "t1", name: "say", input: { text: "hi" } }]);
	assert.equal(
		fromAnthropicMessage({ stop_reason: "refusal", content: [] }).stop,
		"refusal",
	);
	assert.equal(
		fromAnthropicMessage({ stop_reason: "end_turn", content: [] }).stop,
		"end",
	);
});

test("withoutImages strips every image and keeps the rest", () => {
	assert.equal(hasImages(history), true);
	const stripped = withoutImages(history);
	assert.equal(hasImages(stripped), false);
	assert.equal(stripped[1], history[1]);
	assert.match(stripped[2].results[0].text, /^Done\./);
});

test("Chat Completions messages carry calls, tool results and screenshots", async () => {
	const { toChatMessages } = await import(
		"../src/main/agent/chat-completions.ts"
	);
	const msgs = toChatMessages("SYS", history);
	assert.deepEqual(msgs[0], { role: "system", content: "SYS" });
	assert.deepEqual(msgs[1].content[1], {
		type: "image_url",
		image_url: { url: "data:image/jpeg;base64,QUJD" },
	});
	assert.deepEqual(msgs[2].tool_calls, [
		{
			id: "c1",
			type: "function",
			function: {
				name: "click",
				arguments: '{"target":"e1","explanation":"x"}',
			},
		},
	]);
	assert.deepEqual(msgs[3], {
		role: "tool",
		tool_call_id: "c1",
		content: "Done.",
	});
	assert.equal(msgs[4].role, "user");
	assert.equal(msgs[4].content[1].type, "image_url");
	assert.equal(
		toChatMessages("S", [
			{ role: "user", parts: [{ type: "text", text: "hi" }] },
		])[1].content,
		"hi",
	);
});

test("Chat Completions client sends tools and reads tool calls", async () => {
	const { createChatCompletionsClient } = await import(
		"../src/main/agent/chat-completions.ts"
	);
	let seen;
	const client = createChatCompletionsClient({
		apiKey: "k",
		baseUrl: "https://gw.example/v1/",
		fetchImpl: async (url, init) => {
			seen = { url, body: JSON.parse(init.body) };
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: null,
								tool_calls: [
									{
										id: "t1",
										type: "function",
										function: {
											name: "start_task",
											arguments: '{"goal":"g","mode":"do"}',
										},
									},
								],
							},
							finish_reason: "tool_calls",
						},
					],
				}),
				{ status: 200 },
			);
		},
	});
	const reply = await client.complete({
		model: "m",
		system: "s",
		history: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
		tools: [TOOLS.start_task],
		requireTool: true,
	});
	assert.equal(seen.url, "https://gw.example/v1/chat/completions");
	assert.deepEqual(seen.body.tools[0].function.name, "start_task");
	assert.equal(seen.body.tools[0].type, "function");
	assert.equal(seen.body.tool_choice, "required");
	assert.equal(reply.stop, "tool");
	assert.deepEqual(reply.calls, [
		{ id: "t1", name: "start_task", input: { goal: "g", mode: "do" } },
	]);
});

test("Chat Completions streams text and assembles split tool calls", async () => {
	const { createChatCompletionsClient } = await import(
		"../src/main/agent/chat-completions.ts"
	);
	const chunk = (delta, finish_reason = null) => ({
		data: JSON.stringify({ choices: [{ delta, finish_reason }] }),
	});
	const body = formatSse([
		chunk({ content: "On " }),
		chunk({ content: "it." }),
		chunk({
			tool_calls: [
				{
					index: 0,
					id: "t9",
					function: { name: "start_task", arguments: '{"goal":' },
				},
			],
		}),
		chunk({
			tool_calls: [{ index: 0, function: { arguments: '"g","mode":"do"}' } }],
		}),
		chunk({}, "tool_calls"),
		{ data: "[DONE]" },
	]);
	const client = createChatCompletionsClient({
		apiKey: "k",
		fetchImpl: async () => new Response(body, { status: 200 }),
	});
	const deltas = [];
	const reply = await client.complete({
		model: "m",
		system: "s",
		history: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
		tools: [TOOLS.start_task],
		onText: (d) => deltas.push(d),
	});
	assert.deepEqual(deltas, ["On ", "it."]);
	assert.equal(reply.text, "On it.");
	assert.deepEqual(reply.calls, [
		{ id: "t9", name: "start_task", input: { goal: "g", mode: "do" } },
	]);
	assert.equal(reply.stop, "tool");
});
