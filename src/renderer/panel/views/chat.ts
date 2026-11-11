// Chat: speech-bubble conversation with Clippy. The agent in the main process
// answers and can start Tasks; this view handles streaming, history and polish.

import type {
	ChatEvent,
	ChatMessage,
	RendererContext,
} from "../../../shared/types.js";
import { icon } from "../../common/icons.js";
import { $, api, esc, reducedMotion, sfx } from "../../common/ui.js";

const SUGGESTIONS = [
	"What can you do?",
	"What am I looking at?",
	"Show me how to save this",
];

// Survives panel close/re-open (the panel window stays alive).
const state: {
	messages: ChatMessage[];
	/** The reply being streamed and the id of its request. */
	stream: { id: string; msg: ChatMessage } | null;
	error: string | null;
	draft: string;
} = { messages: [], stream: null, error: null, draft: "" };

// Hooks into the mounted view; no-ops while the chat view is not shown.
// `refresh` re-renders the log and `updateStream` the streaming reply.
let refresh: () => void = () => {};
let updateStream: () => void = () => {};

// Replies stream while the chat view may be unmounted, so they are recorded
// at module level. Text goes to the streaming message wherever it sits in
// the log, since a task note can land after it.
api.onChat((evt: ChatEvent) => {
	const s = state.stream;
	if (!s || evt.id !== s.id) return;
	if (evt.type === "delta") {
		s.msg.content += evt.text;
		updateStream();
		return;
	}
	state.stream = null;
	if (!s.msg.content) state.messages.splice(state.messages.indexOf(s.msg), 1);
	if (evt.type === "error") {
		state.error = evt.message || "Something went wrong.";
		sfx.error();
	} else sfx.boop();
	refresh();
});

// Task results arrive while the chat view may be unmounted, so they are
// recorded at module level.
api.onChatNote(({ text }) => {
	if (!text) return;
	state.messages.push({ role: "assistant", content: text });
	refresh();
});

function format(text: string) {
	// minimal, safe formatting: **bold**, `code`, line breaks
	return esc(text)
		.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\n/g, "<br>");
}

export function mount(el: HTMLElement, ctx: RendererContext) {
	el.innerHTML = `
    <div class="chat">
      <header class="chat-head">
        <div class="chat-title px"><span class="live-dot"></span>Clippy <span class="chat-sub">chat</span></div>
        <div class="chat-actions">
          <button class="icon-btn" data-act="new" title="New chat" aria-label="New chat">${icon("reset", 14)}</button>
          <button class="icon-btn" data-act="close" title="Close" aria-label="Close"><span class="x-glyph"></span></button>
        </div>
      </header>
      <div class="chat-log" role="log" aria-live="polite"></div>
      <form class="chat-input">
        <textarea class="field" rows="1" placeholder="Ask me anything…" aria-label="Message"></textarea>
        <button class="btn btn-primary send-btn" type="submit" aria-label="Send">${icon("send", 16)}</button>
      </form>
      <div class="chat-hint">Enter to send · Shift+Enter for a new line</div>
    </div>`;

	const log = $(".chat-log", el);
	const form = $(".chat-input", el);
	const input = $("textarea", el) as HTMLTextAreaElement;
	const sendBtn = $(".send-btn", el) as HTMLButtonElement;
	const nearBottom = () =>
		log.scrollHeight - log.scrollTop - log.clientHeight < 60;
	const scrollDown = (smooth = true) =>
		log.scrollTo({
			top: log.scrollHeight,
			behavior: smooth && !reducedMotion() ? "smooth" : "auto",
		});

	function emptyState() {
		return `
      <div class="chat-empty">
        <div class="chat-empty-title px">What can I help with?</div>
        <p>Ask me about what's on your screen, or have me show you how to do something.</p>
        <div class="chips">${SUGGESTIONS.map((s) => `<button class="btn btn-sm chip-btn" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      </div>`;
	}

	function msgHtml(m: ChatMessage, i: number) {
		const streaming = state.stream?.msg === m;
		if (m.role === "user")
			return `<div class="msg msg-me" data-i="${i}"><div class="msg-card">${format(m.content)}</div></div>`;
		const body = m.content
			? `${format(m.content)}${streaming ? '<span class="stream-caret"></span>' : ""}`
			: '<span class="typing"><i></i><i></i><i></i></span>';
		return `<div class="msg msg-clippy" data-i="${i}"><div class="msg-text">${body}</div></div>`;
	}

	function render() {
		if (!state.messages.length) {
			log.innerHTML = emptyState();
		} else {
			log.innerHTML =
				state.messages.map(msgHtml).join("") +
				(state.error
					? `<div class="msg-error">${esc(state.error)} <button class="btn btn-sm" data-act="retry">Retry</button></div>`
					: "");
		}
		syncSend();
	}

	/** The send button doubles as Stop while a reply streams. */
	function syncSend() {
		sendBtn.innerHTML = state.stream
			? '<span class="stop-sq"></span>'
			: icon("send", 16);
		sendBtn.setAttribute("aria-label", state.stream ? "Stop" : "Send");
	}

	function updateLast() {
		const i = state.stream ? state.messages.indexOf(state.stream.msg) : -1;
		const node = log.querySelector<HTMLElement>(`[data-i="${i}"]`);
		if (!node) return render();
		const stick = nearBottom();
		node.outerHTML = msgHtml(state.messages[i], i);
		if (stick) scrollDown(false);
	}

	function appendNode(i: number) {
		log.querySelector(".chat-empty")?.remove();
		log.insertAdjacentHTML("beforeend", msgHtml(state.messages[i], i));
		const node = log.lastElementChild;
		if (!reducedMotion() && node instanceof HTMLElement) {
			node.animate(
				[
					{ opacity: 0, transform: "translateY(10px) scale(.96)" },
					{ opacity: 1, transform: "none" },
				],
				{ duration: 260, easing: "cubic-bezier(.2,.8,.3,1)" },
			);
		}
		scrollDown();
	}

	function ask() {
		const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		const history = state.messages.filter((m) => m.content);
		const msg: ChatMessage = { role: "assistant", content: "" };
		state.stream = { id, msg };
		state.error = null;
		state.messages.push(msg);
		appendNode(state.messages.length - 1);
		syncSend();
		ctx.api.chatSend(id, history);
	}

	function send(text: string) {
		const t = text.trim();
		if (!t || state.stream) return;
		sfx.send();
		state.messages.push({ role: "user", content: t });
		appendNode(state.messages.length - 1);
		input.value = "";
		state.draft = "";
		autosize();
		ask();
	}

	function autosize() {
		input.style.height = "auto";
		input.style.height = `${Math.min(96, input.scrollHeight)}px`;
	}

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		if (state.stream) ctx.api.chatCancel(state.stream.id);
		else send(input.value);
	});
	input.addEventListener("input", () => {
		state.draft = input.value;
		autosize();
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send(input.value);
		} else if (e.key === "ArrowUp" && !input.value) {
			const lastUser = [...state.messages]
				.reverse()
				.find((m) => m.role === "user");
			if (lastUser) {
				input.value = lastUser.content;
				autosize();
				e.preventDefault();
			}
		}
	});

	el.addEventListener("click", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLButtonElement)) return;
		const b = target;
		if (!b) return;
		if (b.dataset.suggest) send(b.dataset.suggest);
		else if (b.dataset.act === "close") {
			sfx.close();
			ctx.close();
		} else if (b.dataset.act === "new") {
			if (state.stream) ctx.api.chatCancel(state.stream.id);
			state.messages = [];
			state.stream = null;
			state.error = null;
			render();
			input.focus();
		} else if (b.dataset.act === "retry") {
			state.error = null;
			render();
			ask();
		}
	});

	input.value = state.draft;
	render();
	autosize();
	scrollDown(false);
	refresh = () => {
		render();
		scrollDown();
	};
	updateStream = updateLast;

	return {
		onEnter() {
			setTimeout(() => input.focus(), 60);
		},
		onFocus() {
			input.focus();
		},
		unmount() {
			refresh = () => {};
			updateStream = () => {};
		},
	};
}
