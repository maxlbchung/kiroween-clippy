// Persistent settings in userData/settings.json. API keys are encrypted with
// Electron safeStorage (DPAPI on Windows) and never sent to renderers.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type {
	PublicSettings,
	SettingsData,
	SettingsPatch,
} from "../shared/types.js";

export const DEFAULTS: SettingsData = {
	pet: { x: null, y: null, scale: 1, visible: true, greeted: false },
	costume: {
		hat: null,
		eyewear: null,
		mustache: null,
		cape: null,
		neck: null,
		finish: "silver",
	},
	ai: {
		provider: "anthropic",
		chatModel: "claude-sonnet-5-5",
		directModel: "claude-haiku-5-5",
		baseUrl: "",
	},
	voice: {
		engine: "windows",
		language: "auto",
		transcribeModel: "whisper-1",
		hotkey: "Control+Alt+Space",
		autoSend: true,
	},
	behavior: {
		alwaysOnTop: true,
		launchAtLogin: false,
		idleChatter: true,
		eyeTracking: true,
		reduceMotion: false,
		sounds: true,
	},
};

export const SECRET_NAMES = ["anthropic", "openai", "custom"];

type SecretName = (typeof SECRET_NAMES)[number];
type SecretRecord = Partial<Record<SecretName, { enc: string; data: string }>>;

type SettingsFile = {
	version?: number;
	settings?: Partial<SettingsData>;
	secrets?: Record<string, { enc?: string; data?: unknown } | undefined>;
};

const isObj = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Keep only known keys with the right type. */
function sanitize(
	defaults: Record<string, unknown>,
	input: unknown,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!isObj(input)) return out;
	for (const [key, def] of Object.entries(defaults)) {
		if (!(key in input)) continue;
		const v = input[key];
		if (isObj(def)) {
			const sub = sanitize(def, v);
			if (Object.keys(sub).length) out[key] = sub;
		} else if (def === null) {
			if (
				v === null ||
				typeof v === "string" ||
				(typeof v === "number" && Number.isFinite(v))
			)
				out[key] = v;
		} else if (
			typeof v === typeof def &&
			(typeof v !== "number" || Number.isFinite(v))
		) {
			out[key] = typeof v === "string" ? v.slice(0, 500) : v;
		}
	}
	return out;
}

function merge(
	base: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const out = { ...base };
	for (const [k, v] of Object.entries(patch || {})) {
		out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
	}
	return out;
}

export class Settings extends EventEmitter {
	file: string;
	data: SettingsData = structuredClone(DEFAULTS);
	secrets: SecretRecord = {};
	saveTimer: ReturnType<typeof setTimeout> | null = null;
	encryption = false;

	constructor(dir: string) {
		super();
		this.file = path.join(dir, "settings.json");
		this.data = structuredClone(DEFAULTS);
		this.secrets = {};
		this.saveTimer = null;
		this.encryption = false;
		this.load();
	}

	/** Must be awaited after app 'ready' (initialises the OS key store). */
	async init() {
		try {
			this.encryption = await safeStorage.isAsyncEncryptionAvailable();
		} catch {
			this.encryption = false;
		}
		return this;
	}

	load() {
		try {
			const raw = JSON.parse(
				fs.readFileSync(this.file, "utf8"),
			) as SettingsFile;
			this.data = merge(
				DEFAULTS as unknown as Record<string, unknown>,
				sanitize(DEFAULTS as unknown as Record<string, unknown>, raw.settings),
			) as unknown as SettingsData;
			for (const name of SECRET_NAMES) {
				const s = raw.secrets?.[name];
				if (s && typeof s.data === "string" && typeof s.enc === "string") {
					this.secrets[name as SecretName] = { enc: s.enc, data: s.data };
				}
			}
		} catch {
			// first run or unreadable file: keep defaults
		}
	}

	/** Snapshot safe to send to renderers (no secrets, only "is set" flags). */
	get public(): PublicSettings {
		return {
			...structuredClone(this.data),
			secrets: Object.fromEntries(
				SECRET_NAMES.map((n) => [n, !!this.secrets[n]]),
			) as PublicSettings["secrets"],
			encryption: this.encryption,
		};
	}

	patch(patch: SettingsPatch): PublicSettings {
		const clean = sanitize(DEFAULTS, patch);
		if (!Object.keys(clean).length) return this.public;
		const prev = this.data;
		this.data = merge(
			this.data as unknown as Record<string, unknown>,
			clean,
		) as unknown as SettingsData;
		this.scheduleSave();
		this.emit("change", this.data, prev, clean);
		return this.public;
	}

	reset() {
		const prev = this.data;
		this.data = merge(
			structuredClone(DEFAULTS) as unknown as Record<string, unknown>,
			{ pet: { x: prev.pet.x, y: prev.pet.y } },
		) as unknown as SettingsData;
		this.scheduleSave();
		this.emit("change", this.data, prev, this.data);
		return this.public;
	}

	async setSecret(
		name: "anthropic" | "openai" | "custom",
		value: string,
	): Promise<PublicSettings> {
		if (!SECRET_NAMES.includes(name))
			throw new Error(`Unknown secret "${name}"`);
		const v = typeof value === "string" ? value.trim() : "";
		if (!v) delete this.secrets[name];
		else this.secrets[name] = await this.seal(v);
		this.scheduleSave();
		this.emit("change", this.data, this.data, {});
		return this.public;
	}

	async seal(v: string): Promise<{ enc: string; data: string }> {
		if (this.encryption) {
			return {
				enc: "safe",
				data: (await safeStorage.encryptStringAsync(v)).toString("base64"),
			};
		}
		return { enc: "plain", data: Buffer.from(v, "utf8").toString("base64") };
	}

	async getSecret(name: "anthropic" | "openai" | "custom"): Promise<string> {
		const s = this.secrets[name];
		if (!s) return "";
		try {
			const buf = Buffer.from(s.data, "base64");
			if (s.enc !== "safe") return buf.toString("utf8");
			const { result, shouldReEncrypt } =
				await safeStorage.decryptStringAsync(buf);
			if (shouldReEncrypt) {
				this.secrets[name] = await this.seal(result);
				this.scheduleSave();
			}
			return result;
		} catch {
			return "";
		}
	}

	hasSecret(name: "anthropic" | "openai" | "custom"): boolean {
		return !!this.secrets[name];
	}

	scheduleSave() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.flush(), 250);
	}

	flush() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		try {
			fs.mkdirSync(path.dirname(this.file), { recursive: true });
			const tmp = `${this.file}.tmp`;
			fs.writeFileSync(
				tmp,
				JSON.stringify(
					{ version: 1, settings: this.data, secrets: this.secrets },
					null,
					2,
				),
			);
			fs.renameSync(tmp, this.file);
		} catch (err) {
			console.error("[settings] save failed:", err);
		}
	}
}
