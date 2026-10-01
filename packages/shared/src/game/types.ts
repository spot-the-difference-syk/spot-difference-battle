import type { GamePuzzleId } from "../puzzles/asset-manifest.js";
import type { MatchSettings } from "./config.js";

export type GameState =
  | "LOBBY"
  | "MATCHING"
  | "READY"
  | "PRELOADING"
  | "COUNTDOWN"
  | "PLAYING"
  | "FINISHED"
  | "CANCELLED";

export type DifferenceKind = "ADD" | "COVER" | "COLOR" | "DRAW";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface AnswerRegion extends NormalizedPoint {
  radius: number;
}

/** 이미 찾은 차이점만 표시용으로 되돌려준다. 미발견 정답은 포함하지 않는다. */
export interface FoundMark {
  differenceId: string;
  region: AnswerRegion;
}

/** 경기가 끝난 뒤에만 공개하는 전체 정답 */
export interface RevealedDifference {
  id: string;
  kind: DifferenceKind;
  region: AnswerRegion;
  found: boolean;
}

export interface PlayerResult {
  playerId: string;
  foundCount: number;
  wrongAnswerCount: number;
  lastCorrectAtMs: number | null;
}

export interface PlayerProgress {
  playerId: string;
  nickname: string;
  ready: boolean;
  loaded: boolean;
  completedPuzzleCount: number;
  foundCount: number;
  currentDifferenceCount: number;
  totalFoundCount: number;
  totalDifferenceCount: number;
  completedAllPuzzles: boolean;
  score: number;
  timeBonus: number;
  connectionStatus: "CONNECTED" | "RECONNECTING" | "FORFEITED";
  perspective: "SELF" | "OPPONENT";
  correctStreak?: number;
  bestStreak?: number;
  /** Present only for the player receiving this snapshot. */
  puzzleIndex?: number;
  /** Present only for the player receiving this snapshot. */
  wrongAnswerCount?: number;
  /** Present only for the player receiving this snapshot. */
  inputLockedUntilMs?: number | null;
}

export interface SelfPlayerProgress extends PlayerProgress {
  perspective: "SELF";
  puzzleIndex: number;
  wrongAnswerCount: number;
  inputLockedUntilMs: number | null;
}

export interface OpponentPlayerProgress extends PlayerProgress {
  perspective: "OPPONENT";
}

export type GameEndReason =
  | "COMPLETED"
  | "TIMEOUT"
  | "FORFEIT"
  | "MISTAKE_LIMIT"
  | "CANCELLED";

export interface GameSnapshot {
  matchId: string;
  state: GameState;
  stateVersion: number;
  settings?: MatchSettings;
  imageId: GamePuzzleId;
  currentPuzzleId: GamePuzzleId | null;
  currentPuzzleVersion: string | null;
  nextPuzzleId: GamePuzzleId | null;
  nextPuzzleVersion: string | null;
  totalPuzzleCount: number;
  totalDifferenceCount: number;
  deadlineMs: number | null;
  players: [PlayerProgress, PlayerProgress];
  winnerId: string | null;
  problemImage: string | null;
  myFoundIds: string[];
  /** 내가 이미 맞힌 차이점의 위치. 재접속 시 표시를 복원하는 용도. */
  foundMarks: FoundMark[];
  /** FINISHED에서만 채워지는 전체 정답 공개 */
  revealedDifferences: RevealedDifference[] | null;
  endReason: GameEndReason | null;
  cancelReason: string | null;
  /** 이 스냅샷을 보낸 순간의 서버 시각. 클라이언트 시계 오차 보정용. */
  serverNowMs?: number;
}
