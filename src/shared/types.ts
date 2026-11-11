export type PetSettings = {
	x: number | null;
	y: number | null;
	scale: number;
	visible: boolean;
	greeted: boolean;
};

export type CostumeSettings = {
	hat: string | null;
	eyewear: string | null;
	mustache: string | null;
	cape: string | null;
	neck: string | null;
	finish: string;
};

export type CostumeCategory =
	| "hat"
	| "eyewear"
	| "mustache"
	| "cape"
	| "neck"
	| "finish";
export type CostumeSlot =
	| "back"
	| "neck"
	| "mustache"
	| "eyewear"
	| "capeFront"
	| "hat";
export type Costume = CostumeSettings;

export type AISettings = {
	provider: "anthropic" | "openai" | "compatible";
	chatModel: string;
	directModel: string;
	baseUrl: string;
	/** Do_Mode Tasks run risky actions and commands without asking first. */
	autoMode: boolean;
	/** Proactive tips from the Watcher. */
	tips: boolean;
	/** Minimum minutes between two tips, 1 to 30. */
	tipMinutes: number;
};

export type VoiceSettings = {
	engine: "windows" | "openai";
	language: string;
	transcribeModel: string;
	hotkey: string;
	autoSend: boolean;
};

export type BehaviorSettings = {
	alwaysOnTop: boolean;
	launchAtLogin: boolean;
	idleChatter: boolean;
	eyeTracking: boolean;
	sounds: boolean;
};

/** Arcade credits and bought costume items, written only by the main process. */
export type WalletSettings = {
	credits: number;
	/** Bought items as `category:id` keys. */
	unlocked: string[];
};

export type SettingsData = {
	pet: PetSettings;
	costume: CostumeSettings;
	wallet: WalletSettings;
	ai: AISettings;
	voice: VoiceSettings;
	behavior: BehaviorSettings;
};

export type SettingsPatch = {
	[K in keyof SettingsData]?: Partial<SettingsData[K]>;
};

export type PublicSettings = SettingsData & {
	secrets: Record<"anthropic" | "openai" | "custom", boolean>;
	encryption: boolean;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type PanelName = "chat" | "direct" | "customize" | "games" | "settings";
export type MenuItemId = PanelName | "quit";

export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type WorkArea = Rect;

export type DictationEvent =
	| { type: "ready" | "started" | "stopped" }
	| { type: "level"; value: number }
	| { type: "partial" | "final"; text: string; confidence?: number }
	| { type: "error"; code: string; message: string };

export type ChatEvent =
	| { id: string; type: "delta"; text: string }
	| { id: string; type: "done"; aborted?: boolean }
	| { id: string; type: "error"; message: string };

/** Result of a direct command: whether a Do_Mode Task started. */
export type DirectResult =
	| { status: "empty" }
	| { status: "started" }
	| { status: "rejected"; message: string };

/** An Outline in overlay-window coordinates (DIP, relative to the display). */
export type OverlayOutline = {
	rect: Rect;
	title: string;
	step: { n: number; total: number } | null;
	kind: "step" | "tip";
	/** Where the title bar goes relative to the target. */
	side: "above" | "below";
};

export type OverlayBubble = {
	id: number;
	text: string;
	buttons: { id: string; label: string; primary?: boolean }[];
	/** Clippy's body in overlay-window coordinates; the bubble sits above it. */
	anchor: Rect;
};

/** The input animations baby Clippy plays, named after the Actions. */
export type HelperAct = "click" | "type_text" | "press_keys" | "scroll";

export type OverlayHelper = {
	/** Display-local box. */
	rect: Rect;
	/** Slide time from the previous box. */
	moveMs: number;
	act: HelperAct | null;
	/** Changes on every act, so a repeated act replays. */
	actId: number;
};

export type OverlayState = {
	outline: OverlayOutline | null;
	bubble: OverlayBubble | null;
	helper: OverlayHelper | null;
	/** Takeover_Banner text, shown on every display. */
	banner: string | null;
};

export type OverlayEvent =
	| { kind: "outline"; button: "skip" | "close" }
	| { kind: "bubble"; id: number; button: string }
	| { kind: "hover"; id: number; on: boolean };

export type Unsubscribe = () => void;

import type { GameId } from "./games.js";

export type { GameId };

/** Startup data for a full-screen game, in overlay window coordinates. */
export type GameInit = {
	id: GameId;
	/** Pet scale, so the overlay Clippy matches the desktop one. */
	scale: number;
	/** Clippy's SVG box where the pet window drew him. */
	home: Rect;
	cursor: Point;
};

export type GameResult = {
	score: number;
	/** Seconds played in the round. */
	time: number;
	record: boolean;
};

export type GameRoundReward = { earned: number; credits: number };

export type PurchaseResult =
	| { ok: true; settings: PublicSettings }
	| { ok: false; error: string };

export type RendererContext = {
	api: ClippyAPI;
	settings: PublicSettings;
	close(): void;
	setMood(mood: string | null): void;
};

export interface ClippyAPI {
	readonly platform: NodeJS.Platform;
	getSettings(): Promise<PublicSettings>;
	patchSettings(patch: SettingsPatch): Promise<PublicSettings>;
	resetSettings(): Promise<PublicSettings>;
	setSecret(
		name: "anthropic" | "openai" | "custom",
		value: string,
	): Promise<PublicSettings>;
	setHotkey(accelerator: string): Promise<{ ok: boolean; error?: string }>;
	buyCostume(category: CostumeCategory, id: string): Promise<PurchaseResult>;
	onSettings(callback: (settings: PublicSettings) => void): Unsubscribe;
	setInteractive(on: boolean): void;
	dragStart(x: number, y: number): void;
	dragEnd(): void;
	menuChanged(open: boolean): void;
	petContextMenu(): void;
	petReady(): void;
	setMood(mood: string | null): void;
	onCursor(callback: (point: Point) => void): Unsubscribe;
	onMoved(callback: (point: Point & { t: number }) => void): Unsubscribe;
	onPetPanel(
		callback: (panel: {
			name: PanelName | null;
			side?: "left" | "right";
		}) => void,
	): Unsubscribe;
	onMood(callback: (mood: string | null) => void): Unsubscribe;
	onBlur(callback: () => void): Unsubscribe;
	onSay(
		callback: (message: { kind: string; text?: string }) => void,
	): Unsubscribe;
	onGoodbye(callback: () => void): Unsubscribe;
	onToggleMenu(callback: () => void): Unsubscribe;
	openPanel(name: PanelName): void;
	closePanel(): void;
	panelAck(token: number): void;
	panelDragStart(): void;
	onPanelOpen(callback: (message: PanelOpenMessage) => void): Unsubscribe;
	onPanelEnter(callback: (message: { name: PanelName }) => void): Unsubscribe;
	onPanelLeave(
		callback: (message: { name: PanelName; token: number }) => void,
	): Unsubscribe;
	onPanelAnchor(callback: (anchor: PanelAnchor) => void): Unsubscribe;
	onPanelFocus(
		callback: (message: { name: PanelName; data?: unknown }) => void,
	): Unsubscribe;
	chatSend(id: string, messages: ChatMessage[]): void;
	chatCancel(id: string): void;
	onChat(callback: (event: ChatEvent) => void): Unsubscribe;
	/** Messages the agent adds to the chat log, such as a Task's result. */
	onChatNote(callback: (note: { text: string }) => void): Unsubscribe;
	onOverlay(callback: (state: OverlayState) => void): Unsubscribe;
	overlayEvent(event: OverlayEvent): void;
	/** Points Clippy's gaze at a point in pet-window coordinates, or releases it. */
	onLook(callback: (point: Point | null) => void): Unsubscribe;
	/** Hides the pet window's own speech bubble. */
	onHush(callback: () => void): Unsubscribe;
	dictationStart(): Promise<{
		ok: boolean;
		engine: "openai" | "fake" | "windows";
	}>;
	dictationStop(): void;
	dictationCancel(): void;
	transcribe(
		audio: ArrayBuffer,
		mime: string,
	): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
	directDispatch(text: string): Promise<DirectResult>;
	onDictation(callback: (event: DictationEvent) => void): Unsubscribe;
	onDirectToggle(callback: () => void): Unsubscribe;
	launchGame(id: GameId): void;
	gameInit(): Promise<GameInit | null>;
	gameReady(): void;
	/** Reports a finished round and converts its score into credits. */
	gameRound(result: GameResult): Promise<GameRoundReward>;
	/**
	 * Closes the overlay. When the last round scored, Clippy says `quip` on
	 * the desktop, followed by the credits the session earned.
	 */
	exitGame(result: GameResult | null, quip?: string): void;
	appInfo(): Promise<{
		version: string;
		electron: string;
		platform: NodeJS.Platform;
		userData: string;
	}>;
	hidePet(): void;
	quit(): void;
}

export type PanelAnchor = {
	side: "left" | "right";
	tailY: number;
	originX: number;
	originY: number;
};

export type PanelOpenMessage = PanelAnchor & {
	name: PanelName;
	panel: {
		width: number;
		height: number;
		kind: "bubble" | "window";
		title: string;
		focus?: boolean;
	};
	data?: unknown;
	token: number;
};

declare global {
	interface Window {
		clippy: ClippyAPI;
	}
}
