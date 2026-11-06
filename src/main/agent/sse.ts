// Incremental parser for Server-Sent Events streams.

export type SseEvent = { event: string; data: string };

/**
 * Feeds text chunks in, gets complete events out. Handles events split
 * across chunks, CRLF line endings, multi-line data and comment lines.
 */
export class SseParser {
	buffer = "";
	event = "";
	data: string[] = [];

	push(chunk: string): SseEvent[] {
		this.buffer += chunk;
		const out: SseEvent[] = [];
		let nl = this.buffer.search(/\r\n|\n|\r/);
		while (nl >= 0) {
			const line = this.buffer.slice(0, nl);
			const len = this.buffer.startsWith("\r\n", nl) ? 2 : 1;
			// A lone "\r" at the end may be the first half of "\r\n".
			if (
				len === 1 &&
				this.buffer[nl] === "\r" &&
				nl === this.buffer.length - 1
			)
				break;
			this.buffer = this.buffer.slice(nl + len);
			const evt = this.line(line);
			if (evt) out.push(evt);
			nl = this.buffer.search(/\r\n|\n|\r/);
		}
		return out;
	}

	/** Flushes a final event that was not followed by a blank line. */
	end(): SseEvent[] {
		const out = this.buffer ? this.push("\n") : [];
		const evt = this.line("");
		return evt ? [...out, evt] : out;
	}

	line(line: string): SseEvent | null {
		if (line === "") {
			if (!this.data.length && !this.event) return null;
			const evt = {
				event: this.event || "message",
				data: this.data.join("\n"),
			};
			this.event = "";
			this.data = [];
			return evt;
		}
		if (line.startsWith(":")) return null;
		const colon = line.indexOf(":");
		const field = colon < 0 ? line : line.slice(0, colon);
		let value = colon < 0 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "event") this.event = value;
		else if (field === "data") this.data.push(value);
		return null;
	}
}

/** Serializes events in the wire format `SseParser` reads. */
export function formatSse(events: SseEvent[]): string {
	return events
		.map(
			(e) =>
				`event: ${e.event}\n${e.data
					.split("\n")
					.map((d) => `data: ${d}`)
					.join("\n")}\n\n`,
		)
		.join("");
}
