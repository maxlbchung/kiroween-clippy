// Dictation engines for "Direct" mode.
//  - windows: offline System.Speech recognizer via a long-lived PowerShell host
//  - openai:  renderer records audio, we post it to the transcription API
//  - fake:    scripted events for development on non-Windows machines
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import readline from "node:readline";

export class WindowsSpeech extends EventEmitter {
	script: string;
	proc: ReturnType<typeof spawn> | null = null;
	ready = false;
	language = "auto";
	queued: string[] = [];

	constructor(nativeDir: string) {
		super();
		this.script = path.join(nativeDir, "speech-host.ps1");
		this.proc = null;
		this.ready = false;
		this.language = "auto";
		this.queued = [];
	}

	get supported() {
		return process.platform === "win32";
	}

	warm(language = "auto") {
		if (!this.supported) return;
		if (this.proc && language === this.language) return;
		this.dispose();
		this.language = language;
		this.ready = false;
		const proc = spawn(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				this.script,
				language,
			],
			{ windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
		);
		this.proc = proc;
		let stderr = "";
		readline.createInterface({ input: proc.stdout }).on("line", (line) => {
			const clean = line.replace(/^﻿/, "").trim();
			if (!clean.startsWith("{")) return;
			let evt: unknown;
			try {
				evt = JSON.parse(clean);
			} catch {
				return;
			}
			if (typeof evt !== "object" || evt === null || !("type" in evt)) return;
			if (evt.type === "ready") {
				this.ready = true;
				for (const cmd of this.queued.splice(0)) this.write(cmd);
			}
			this.emit("event", evt);
		});
		proc.stderr.on("data", (d) => {
			stderr = (stderr + d).slice(-2000);
		});
		proc.on("error", (err) => {
			this.emit("event", {
				type: "error",
				code: "spawn-failed",
				message: `Couldn't start the speech host: ${err.message}`,
			});
		});
		proc.on("exit", (code) => {
			if (this.proc !== proc) return;
			this.proc = null;
			this.ready = false;
			this.queued = [];
			if (code) {
				const detail = stderr.trim().split(/\r?\n/).slice(-2).join(" ");
				this.emit("event", {
					type: "error",
					code: "host-exited",
					message: `Speech host stopped (code ${code}). ${detail}`.trim(),
				});
				this.emit("event", { type: "stopped" });
			}
		});
	}

	write(cmd) {
		const proc = this.proc;
		if (!proc) return;
		if (!this.ready) {
			this.queued.push(cmd);
			return;
		}
		proc.stdin?.write(`${cmd}\n`);
	}

	start(language) {
		if (!this.supported) {
			this.emit("event", {
				type: "error",
				code: "unsupported",
				message:
					"Offline dictation needs Windows. Switch Voice to cloud transcription in Settings.",
			});
			return false;
		}
		this.warm(language);
		this.write("start");
		return true;
	}

	stop() {
		this.write("stop");
	}
	cancel() {
		this.write("cancel");
	}

	dispose() {
		const p = this.proc;
		if (!p) return;
		try {
			p.stdin?.write("quit\n");
		} catch {
			/* already gone */
		}
		this.proc = null;
		setTimeout(() => {
			try {
				p.kill();
			} catch {
				/* ignore */
			}
		}, 1500);
	}
}

/** Scripted recognizer so the UI can be exercised without Windows. */
export class FakeSpeech extends EventEmitter {
	timers: ReturnType<typeof setTimeout>[] = [];
	get supported() {
		return true;
	}
	warm() {}
	start() {
		this.cancel();
		const words = "open notepad and type hello world".split(" ");
		const timers: ReturnType<typeof setTimeout>[] = [];
		const at = (ms, evt) =>
			timers.push(setTimeout(() => this.emit("event", evt), ms));
		at(50, { type: "started" });
		for (let i = 0; i < 60; i++)
			at(100 + i * 40, {
				type: "level",
				value: Math.round(20 + 60 * Math.abs(Math.sin(i / 3))),
			});
		words.forEach((_, i) => {
			at(500 + i * 260, {
				type: "partial",
				text: words.slice(0, i + 1).join(" "),
			});
		});
		at(500 + words.length * 260 + 200, {
			type: "final",
			text: words.join(" "),
			confidence: 0.92,
		});
		this.timers = timers;
		return true;
	}
	stop() {
		this.cancel();
		this.emit("event", { type: "stopped" });
	}
	cancel() {
		(this.timers || []).forEach(clearTimeout);
		this.timers = [];
	}
	dispose() {
		this.cancel();
	}
}

/** Cloud transcription (OpenAI-compatible /audio/transcriptions). */
export async function transcribeOpenAI({
	audio,
	mime,
	apiKey,
	model,
	language,
	baseUrl = "",
}: {
	audio: Buffer;
	mime: string;
	apiKey: string;
	model: string;
	language: string;
	baseUrl?: string;
}): Promise<string> {
	if (!apiKey)
		throw new Error(
			"Add an OpenAI API key in Settings → AI to use cloud transcription.",
		);
	const ext = /ogg/.test(mime)
		? "ogg"
		: /mp4|m4a/.test(mime)
			? "m4a"
			: /wav/.test(mime)
				? "wav"
				: "webm";
	const form = new FormData();
	const audioCopy = Uint8Array.from(audio).buffer;
	form.append(
		"file",
		new Blob([audioCopy], { type: mime || "audio/webm" }),
		`speech.${ext}`,
	);
	form.append("model", model || "whisper-1");
	if (language && language !== "auto")
		form.append("language", language.split("-")[0]);
	const url = `${(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/transcriptions`;
	const res = await fetch(url, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form,
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) {
		let msg = `${res.status} ${res.statusText}`;
		try {
			msg = (await res.json())?.error?.message || msg;
		} catch {
			/* keep status */
		}
		throw new Error(`Transcription failed: ${msg}`);
	}
	const json = await res.json();
	return String(json.text || "").trim();
}
