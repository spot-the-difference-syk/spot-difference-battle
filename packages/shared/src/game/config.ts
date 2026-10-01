export const GAME_CONFIG = {
  differenceScore: 10,
  remainingTimeScorePerSecond: 0.5,
  countdownSeconds: 3,
  readyTimeoutSeconds: 30,
  preloadTimeoutSeconds: 15,
  reconnectGraceSeconds: 10,
  /** 한 경기에 쓰는 그림 수. 카탈로그가 더 크면 무작위로 이만큼 고른다. */
  puzzlesPerMatch: 10,
} as const;

export const GAME_MODES = ["STANDARD", "SPRINT", "SURVIVAL"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const GAME_DIFFICULTIES = ["EASY", "NORMAL", "HARD"] as const;
export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];

export interface MatchSettings {
  mode: GameMode;
  difficulty: GameDifficulty;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  mode: "STANDARD",
  difficulty: "NORMAL",
};

export const GAME_MODE_RULES = {
  STANDARD: { durationSeconds: 180, wrongAnswerLimit: null },
  SPRINT: { durationSeconds: 60, wrongAnswerLimit: null },
  SURVIVAL: { durationSeconds: 120, wrongAnswerLimit: 3 },
} as const;

export const GAME_DIFFICULTY_RULES = {
  EASY: { hitRadiusMultiplier: 1.25, wrongAnswerLockSeconds: 0.5 },
  NORMAL: { hitRadiusMultiplier: 1, wrongAnswerLockSeconds: 1 },
  HARD: { hitRadiusMultiplier: 0.8, wrongAnswerLockSeconds: 2 },
} as const;
