export {
  DEFAULT_GAME_SCENE_ID,
  DEFAULT_MATCH_SETTINGS,
  GAME_CONFIG,
  GAME_DIFFICULTIES,
  GAME_DIFFICULTY_RULES,
  GAME_MODES,
  GAME_MODE_RULES,
  GAME_SCENE_IDS,
  type GameDifficulty,
  type GameMode,
  type GameSceneId,
  type MatchSettings,
} from "./game/config.js";

export {
  type AnswerRegion,
  type DifferenceKind,
  type FoundMark,
  type GameEndReason,
  type GameSnapshot,
  type GameState,
  type NormalizedPoint,
  type OpponentPlayerProgress,
  type PlayerProgress,
  type PlayerResult,
  type RevealedDifference,
  type SelfPlayerProgress,
} from "./game/types.js";

export {
  GAME_PUZZLE_ASSET_MANIFEST,
  GAME_PUZZLE_IDS,
  type GamePuzzleId,
  type PuzzleAssetFileMetadata,
  type PuzzleAssetMetadata,
  type PuzzleDifficulty,
  type PuzzleRightsStatus,
} from "./puzzles/asset-manifest.js";

export {
  type ClientToServerEvents,
  type GameActionContext,
  type GameErrorPayload,
  type GuessResult,
  type MatchFoundPayload,
  type ReportReason,
  type ReportResultPayload,
  type ServerToClientEvents,
  type SessionReadyPayload,
} from "./protocol/socket-events.js";

export {
  PROGRESSION_RULES,
  emptyGrowth,
  grantMatchReward,
  grantSoloReward,
  growthView,
  koreanDay,
  matchRewardReason,
  normalizeGrowth,
  xpForLevel,
  type GrowthView,
  type PlayerGrowth,
  type PlayerGrowthPayload,
  type RewardReason,
  type RewardSummary,
} from "./game/progression.js";
