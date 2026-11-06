// Tools that reach past the screen: PowerShell on this PC, web search and
// page downloads. Each returns plain text for the model.

import { spawn } from "node:child_process";
import type { ActionOf } from "./actions.js";

const MAX_OUTPUT = 12000;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const clip = (s: string, max = MAX_OUTPUT) =>
	s.length > max
		? `${s.slice(0, max)}\n[truncated, ${s.length - max} more characters]`
		: s;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	"#39": "'",
	"#x27": "'",
};
const decode = (s: string) =>
	s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);

/** Strips tags, scripts and styles from HTML, keeping block breaks as newlines. */
export function htmlToText(html: string): string {
	return decode(
		html
			.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
			.replace(/<\/(p|div|li|tr|h[1-6]|section|article)>|<br\s*\/?>/gi, "\n")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
}

/** Reads "title\nurl\nsnippet" entries from a DuckDuckGo HTML results page. */
export function parseSearchResults(html: string): string[] {
	const results: string[] = [];
	const re =
		/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
	for (const [, href, title, snippet] of html.matchAll(re)) {
		const target =
			new URL(decode(href), "https://duckduckgo.com").searchParams.get(
				"uddg",
			) || decode(href);
		results.push(`${htmlToText(title)}\n${target}\n${htmlToText(snippet)}`);
	}
	return results;
}

const timeout = (signal?: AbortSignal) =>
	AbortSignal.any([
		...(signal ? [signal] : []),
		AbortSignal.timeout(FETCH_TIMEOUT_MS),
	]);

// ponytail: scrapes DuckDuckGo's HTML page so every provider shares one search;
// swap in a search API if it starts rate limiting.
export async function webSearch(
	query: string,
	signal?: AbortSignal,
): Promise<string> {
	const res = await fetch("https://html.duckduckgo.com/html/", {
		method: "POST",
		headers: {
			"User-Agent": USER_AGENT,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({ q: query }),
		signal: timeout(signal),
	});
	if (!res.ok) throw new Error(`Search failed: ${res.status}`);
	const results = parseSearchResults(await res.text());
	return results.length
		? results.slice(0, 8).join("\n\n")
		: "No results. Try fetch_url on a site you know.";
}

/** Downloads a page, as plain text when it is HTML. */
export async function fetchUrl(
	url: string,
	signal?: AbortSignal,
): Promise<string> {
	const res = await fetch(url, {
		headers: { "User-Agent": USER_AGENT },
		signal: timeout(signal),
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	const body = await res.text();
	return clip(
		/html/i.test(res.headers.get("content-type") || "")
			? htmlToText(body)
			: body,
	);
}

/**
 * Runs PowerShell in the user's home folder and resolves with the exit code
 * and combined output. Kills the process on abort or after `timeoutSeconds`
 * (at most 300).
 */
export function runCommand(
	command: string,
	timeoutSeconds = 60,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${command}`;
		// Base64 avoids quoting issues; -EncodedCommand would wrap stderr in CLIXML.
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		const proc = spawn(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-OutputFormat",
				"Text",
				"-Command",
				`Invoke-Expression ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')))`,
			],
			{
				windowsHide: true,
				cwd: process.env.USERPROFILE,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "";
		const add = (d: Buffer) => {
			output = (output + d).slice(-MAX_OUTPUT * 2);
		};
		proc.stdout.on("data", add);
		proc.stderr.on("data", add);
		const kill = () => proc.kill();
		const timer = setTimeout(kill, Math.min(timeoutSeconds, 300) * 1000);
		signal?.addEventListener("abort", kill, { once: true });
		proc.on("error", reject);
		proc.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", kill);
			resolve(clip(`exit code: ${code ?? "killed"}\n${output.trim()}`));
		});
	});
}

export type LocalTools = {
	runCommand: typeof runCommand;
	webSearch: typeof webSearch;
	fetchUrl: typeof fetchUrl;
};

export const localTools: LocalTools = { runCommand, webSearch, fetchUrl };

/** Runs a web_search or fetch_url Action. Failures come back as error text. */
export async function lookup(
	tools: LocalTools,
	action: ActionOf<"web_search" | "fetch_url">,
	signal?: AbortSignal,
): Promise<{ text: string; isError?: boolean }> {
	try {
		return {
			text:
				action.type === "web_search"
					? await tools.webSearch(action.query, signal)
					: await tools.fetchUrl(action.url, signal),
		};
	} catch (err) {
		return { text: `Failed: ${err.message}`, isError: true };
	}
}
