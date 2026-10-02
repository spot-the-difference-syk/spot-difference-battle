export const GAME_CONFIG = {
  differenceScore: 10,
  remainingTimeScorePerSecond: 0.5,
  countdownSeconds: 3,
  readyTimeoutSeconds: 30,
  preloadTimeoutSeconds: 15,
  reconnectGraceSeconds: 10,
  /** 한 경기에 쓰는 그림 수. 카탈로그가 더 크면 무작위로 이만큼 고른다. */
  puzzlesPerMatch: 10,
  /** 한 경기는 한 화풍 그림만 쓴다. 이만큼 이상 있는 화풍 중에서 무작위로 고른다. */
  minPuzzlesPerGenre: 3,
  /** 오답 뒤 입력 잠금 */
  wrongAnswerLockSeconds: 1,
} as const;

export const GAME_MODES = ["STANDARD", "SPRINT", "SURVIVAL"] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** 대결 설정. 난이도는 없애고 판정 반경·오답 잠금을 하나로 고정했다(2026-10-02). */
export interface MatchSettings {
  mode: GameMode;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  mode: "STANDARD",
};

/** 저장된 예전 경기(난이도 포함)나 예전 앱의 요청에서 모드만 꺼낸다. 모르는 모드면 null */
export function matchSettingsFrom(raw: unknown): MatchSettings | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_MATCH_SETTINGS };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const mode = (raw as Record<string, unknown>).mode ?? DEFAULT_MATCH_SETTINGS.mode;
  return GAME_MODES.includes(mode as GameMode) ? { mode: mode as GameMode } : null;
}

export const GAME_MODE_RULES = {
  STANDARD: { durationSeconds: 180, wrongAnswerLimit: null },
  SPRINT: { durationSeconds: 60, wrongAnswerLimit: null },
  SURVIVAL: { durationSeconds: 120, wrongAnswerLimit: 3 },
} as const;
