// Arcade game ids, shared by the main process and the renderers.

/** Every full-screen game. Each one's page is `renderer/games/<id>/index.html`. */
export const GAME_IDS = ["dodge", "quiz", "seek"] as const;

export type GameId = (typeof GAME_IDS)[number];

export function isGameId(id: unknown): id is GameId {
	return GAME_IDS.includes(id as GameId);
}
