import assert from "node:assert/strict";
import { test } from "node:test";
import {
	htmlToText,
	parseSearchResults,
	runCommand,
} from "../src/main/agent/tools.ts";

test("run_command returns plain text, including errors", {
	skip: process.platform !== "win32",
}, async () => {
	const out = await runCommand("Write-Output hello; Write-Error oops");
	assert.match(out, /hello/);
	assert.match(out, /oops/);
	assert.doesNotMatch(out, /CLIXML/);
});

test("search results unwrap redirect links", () => {
	const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Ex <b>ample</b></a>
    <a class="result__snippet" href="x">A &amp; B</a>`;
	assert.deepEqual(parseSearchResults(html), [
		"Ex ample\nhttps://example.com/a\nA & B",
	]);
});

test("htmlToText drops scripts and keeps blocks apart", () => {
	assert.equal(
		htmlToText("<script>x()</script><p>one</p><p>two &amp; three</p>"),
		"one\ntwo & three",
	);
});

test("native scripts are ASCII, which Windows PowerShell reads without a BOM", async () => {
	const { readdir, readFile } = await import("node:fs/promises");
	const dir = new URL("../native/", import.meta.url);
	for (const name of await readdir(dir))
		assert.doesNotMatch(
			await readFile(new URL(name, dir), "latin1"),
			/[^\t\n\r -~]/,
			name,
		);
});

test("chat only talks, looks things up and delegates screen work", async () => {
	const { TASK_TOOLS } = await import("../src/main/agent/actions.ts");
	const { CHAT_SYSTEM } = await import("../src/main/agent/prompts.ts");
	assert.deepEqual(TASK_TOOLS.chat.sort(), [
		"fetch_url",
		"screenshot",
		"start_task",
		"web_search",
	]);
	assert.match(CHAT_SYSTEM, /only chat and delegate/);
});
