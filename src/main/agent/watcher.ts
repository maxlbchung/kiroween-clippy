// Trigger detection and rate limiting for proactive tips. Pure: callers feed
// in events and the current time.

import type { WindowInfo } from "./snapshot.js";

export type Trigger = {
	kind: "window" | "dialog" | "idle-dialog" | "undo";
	window: WindowInfo;
	/** One-line description for the model. */
	reason: string;
};

export const WATCH = {
	/** A new foreground window must stay in front this long to count. */
	settleMs: 3000,
	/** Idle time on a focused dialog that counts as being stuck. */
	idleDialogMs: 20_000,
	/** Ctrl+Z presses within `undoWindowMs` that count as being stuck. */
	undoCount: 3,
	undoWindowMs: 10_000,
	/** Minimum time between two model evaluations. */
	evalGapMs: 30_000,
	/** How long a closed tip silences tips about the same application. */
	muteMs: 30 * 60_000,
	/** How long an untouched tip stays visible. */
	tipVisibleMs: 15_000,
};

export const TIP_MINUTES = { min: 1, max: 30, fallback: 3 };

/** Tip_Interval in minutes, clamped to 1-30 whole minutes. */
export function tipMinutes(v: unknown): number {
	const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN;
	if (Number.isNaN(n)) return TIP_MINUTES.fallback;
	return Math.max(TIP_MINUTES.min, Math.min(TIP_MINUTES.max, n));
}

/** Turns foreground, idle and undo events into Trigger_Events. */
export class TriggerDetector {
	current: WindowInfo | null = null;
	pending: { window: WindowInfo; since: number } | null = null;
	undos: number[] = [];
	idleFiredFor: number | null = null;

	/** Reports a foreground change. Returns a trigger for a new dialog. */
	foreground(w: WindowInfo, now: number): Trigger | null {
		if (this.current && this.current.hwnd === w.hwnd) {
			this.current = w;
			return null;
		}
		this.current = w;
		this.idleFiredFor = null;
		if (w.isDialog) {
			this.pending = null;
			return {
				kind: "dialog",
				window: w,
				reason: `A dialog opened: "${w.title}" in ${w.process}.`,
			};
		}
		this.pending = { window: w, since: now };
		return null;
	}

	/** Reports elapsed time. Returns a trigger once a new window settles. */
	tick(now: number): Trigger | null {
		const p = this.pending;
		if (!p || now - p.since < WATCH.settleMs) return null;
		this.pending = null;
		if (this.current?.hwnd !== p.window.hwnd) return null;
		return {
			kind: "window",
			window: p.window,
			reason: `The user switched to "${p.window.title}" in ${p.window.process}.`,
		};
	}

	/** Reports system idle time. Returns a trigger once per stuck dialog. */
	idle(idleMs: number): Trigger | null {
		const w = this.current;
		if (!w?.isDialog || idleMs < WATCH.idleDialogMs) return null;
		if (this.idleFiredFor === w.hwnd) return null;
		this.idleFiredFor = w.hwnd;
		return {
			kind: "idle-dialog",
			window: w,
			reason: `The user has been idle on the dialog "${w.title}" for ${Math.round(idleMs / 1000)} seconds.`,
		};
	}

	/** Reports a Ctrl+Z press. Returns a trigger on the third within 10 s. */
	undo(now: number): Trigger | null {
		this.undos = this.undos.filter((t) => now - t < WATCH.undoWindowMs);
		this.undos.push(now);
		if (this.undos.length < WATCH.undoCount || !this.current) return null;
		this.undos = [];
		return {
			kind: "undo",
			window: this.current,
			reason: `The user pressed Undo ${WATCH.undoCount} times in a few seconds in ${this.current.process}.`,
		};
	}
}

export type GateState = {
	enabled: boolean;
	taskRunning: boolean;
	petVisible: boolean;
	bubbleVisible: boolean;
	hasKey: boolean;
	tipMinutes: number;
};

/** Decides when the Watcher may spend a model call or show a tip. */
export class TipGate {
	lastEval = -Infinity;
	lastTip = -Infinity;
	muted = new Map<string, number>();

	/** Null when a trigger may be evaluated now, else the reason it is skipped. */
	blocked(trigger: Trigger, s: GateState, now: number): string | null {
		if (!s.enabled) return "tips disabled";
		if (s.taskRunning) return "task running";
		if (!s.petVisible) return "pet hidden";
		if (s.bubbleVisible) return "bubble visible";
		if (!s.hasKey) return "no API key";
		if (trigger.window.fullScreen) return "full-screen window";
		if (now - this.lastEval < WATCH.evalGapMs) return "evaluated recently";
		if (now - this.lastTip < tipMinutes(s.tipMinutes) * 60_000)
			return "tip shown recently";
		const until = this.muted.get(appKey(trigger.window.process));
		if (until !== undefined && now < until) return "app muted";
		return null;
	}

	evaluated(now: number) {
		this.lastEval = now;
	}

	shown(now: number) {
		this.lastTip = now;
	}

	/** Silences tips about `process` for 30 minutes. */
	mute(process: string, now: number) {
		this.muted.set(appKey(process), now + WATCH.muteMs);
	}
}

const appKey = (process: string) => (process || "").toLowerCase();
