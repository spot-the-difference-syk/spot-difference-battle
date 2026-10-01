import type { MatchSettings } from "../game/config.js";
import type {
  AnswerRegion,
  GameSnapshot,
  GameState,
  NormalizedPoint,
} from "../game/types.js";
import type { PublicCosmetics } from "../game/cosmetics.js";
import type { PlayerGrowthPayload } from "../game/progression.js";
import type { GamePuzzleId } from "../puzzles/asset-manifest.js";
import type { PuzzleCard } from "../puzzles/catalog.js";

export interface MatchFoundPayload {
  matchId: string;
  playerId: string;
  opponentNickname: string;
  /** 상대의 프로필 테두리와 칭호 */
  opponentCosmetics?: PublicCosmetics;
  /** 이 경기에서 풀 그림들의 공개 정보(정답 제외). 이미지 주소를 여기서 얻는다. */
  deck?: PuzzleCard[];
}

export interface SessionReadyPayload {
  guestToken: string;
  playerId: string;
}

export interface GuessResult {
  outcome: "CORRECT" | "DUPLICATE" | "WRONG";
  correct: boolean;
  differenceId: string | null;
  /** 맞혔을 때만 그 차이점의 위치를 돌려준다. 오답이면 null. */
  region: AnswerRegion | null;
  remainingTimeMs: number;
  puzzleCompleted: boolean;
  matchFinished: boolean;
  inputLockedUntilMs: number | null;
  currentPuzzleId: GamePuzzleId | null;
  correctStreak: number;
  bestStreak: number;
}

export interface GameErrorPayload {
  code: string;
  message: string;
}

export type ReportReason = "UNFAIR" | "INAPPROPRIATE" | "SYSTEM_ERROR" | "OTHER";

export interface ReportResultPayload {
  reportId: string;
}

export interface GameActionContext {
  expectedState: GameState;
  expectedStateVersion: number;
}

export interface ServerToClientEvents {
  "session:ready": (payload: SessionReadyPayload) => void;
  "match:found": (payload: MatchFoundPayload) => void;
  "queue:left": () => void;
  "game:snapshot": (payload: GameSnapshot) => void;
  "game:guess-result": (payload: GuessResult) => void;
  "game:error": (payload: GameErrorPayload) => void;
  "game:report-result": (payload: ReportResultPayload) => void;
  /** 레벨·코인 동기화. 접속 직후와 보상을 받을 때 보낸다. */
  "player:growth": (payload: PlayerGrowthPayload) => void;
}

export interface ClientToServerEvents {
  "queue:join": (payload: { nickname: string; settings?: MatchSettings }) => void;
  "queue:leave": () => void;
  "game:ready": (payload: { matchId: string }) => void;
  "game:loaded": (payload: {
    matchId: string;
    puzzleId: GamePuzzleId;
    puzzleVersion: string;
  }) => void;
  "game:guess": (payload: GameActionContext & {
    matchId: string;
    puzzleId: GamePuzzleId;
    point: NormalizedPoint;
  }) => void;
  /** 종료된 경기 결과 화면을 닫았다. 재접속해도 이 경기로 되돌아가지 않는다. */
  "game:dismiss": (payload: { matchId: string }) => void;
  "game:forfeit": (payload: GameActionContext & { matchId: string }) => void;
  "game:report": (payload: GameActionContext & {
    matchId: string;
    reason: ReportReason;
    details?: string;
  }) => void;
  /** 솔로 타임어택 완주. 서버가 하루 한도 안에서 보상한다. */
  "solo:complete": (payload: { puzzleId: string; elapsedMs: number }) => void;
  /** 꾸미기 아이템을 코인으로 사고 바로 착용한다. */
  "shop:buy": (payload: { itemId: string }) => void;
  /** 가지고 있는 꾸미기 아이템을 착용한다. */
  "shop:equip": (payload: { itemId: string }) => void;
}
