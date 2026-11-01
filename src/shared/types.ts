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
	reduceMotion: boolean;
	sounds: boolean;
};

export type SettingsData = {
	pet: PetSettings;
	costume: CostumeSettings;
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

export type Unsubscribe = () => void;

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
	directDispatch(
		text: string,
	): Promise<{ status: "empty" | "queued"; agent?: false; model?: string }>;
	onDictation(callback: (event: DictationEvent) => void): Unsubscribe;
	onDirectToggle(callback: () => void): Unsubscribe;
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
