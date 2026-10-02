import type { AnswerRegion, FoundMark, NormalizedPoint } from "./types.js";
import type { SoloAnswer } from "../puzzles/catalog.js";

/** 솔로 타임어택 규칙. 판정과 시간은 서버가 정한다(기록이 랭킹에 오르므로). */
export const SOLO_RULES = {
  differences: 5,
  wrongPenaltyMs: 3_000,
  /** 그림을 다 불러온 뒤 시작까지 기다리는 시간 */
  countdownMs: 3_000,
  /** 이 시간이 지나도록 끝내지 못한 판은 버린다. */
  maxRunMs: 10 * 60_000,
  /** 너무 빠른 연속 입력을 막는다. */
  guessIntervalMs: 120,
  /** 손가락으로 누를 때 최소 판정 반경(화면 px). 정규화 반경으로는 최대 0.08 */
  touchTargetPx: 24,
  maxTouchRadius: 0.08,
} as const;

export interface SoloRun {
  runId: string;
  puzzleId: string;
  puzzleVersion: string;
  /** 서버 시각. 이 시각부터 입력을 받고 시간을 잰다. */
  startsAtMs: number;
  foundIds: string[];
  wrongCount: number;
  lastGuessAtMs: number | null;
  /** 다 찾은 서버 시각 */
  finishedAtMs: number | null;
}

export interface SoloGuessInput {
  point: NormalizedPoint;
  pointerType?: string;
  boardSizePx?: number;
}

export type SoloGuessOutcome =
  | { ok: true; run: SoloRun; correct: boolean; mark?: FoundMark & { label: string }; elapsedMs?: number }
  | { ok: false; code: "SOLO_NOT_STARTED" | "SOLO_FINISHED" | "SOLO_EXPIRED" | "INPUT_RATE_LIMITED" | "INVALID_POINT"; message: string };

export function startSoloRun(runId: string, puzzle: { id: string; version: string }, nowMs: number): SoloRun {
  return { runId, puzzleId: puzzle.id, puzzleVersion: puzzle.version, startsAtMs: nowMs + SOLO_RULES.countdownMs, foundIds: [], wrongCount: 0, lastGuessAtMs: null, finishedAtMs: null };
}

export function soloRegions(answer: SoloAnswer): readonly AnswerRegion[] {
  return answer.extraRegions ? [answer.region, ...answer.extraRegions] : [answer.region];
}

export function minimumSoloHitRadius(pointerType: string | undefined, boardSizePx: number | undefined): number {
  if (pointerType !== "touch" || !boardSizePx || !Number.isFinite(boardSizePx)) return 0;
  // 화면 크기는 클라이언트가 알려주므로 터무니없는 값은 잘라낸다.
  const size = Math.min(4_000, Math.max(200, boardSizePx));
  return Math.min(SOLO_RULES.maxTouchRadius, SOLO_RULES.touchTargetPx / size);
}

export function findSoloAnswer(answers: readonly SoloAnswer[], foundIds: ReadonlySet<string>, point: NormalizedPoint, minimumHitRadius = 0): SoloAnswer | null {
  let best: { answer: SoloAnswer; distanceSquared: number } | null = null;
  for (const answer of answers) {
    if (foundIds.has(answer.id)) continue;
    for (const region of soloRegions(answer)) {
      const distanceSquared = (point.x - region.x) ** 2 + (point.y - region.y) ** 2;
      const hitRadius = Math.max(region.radius, minimumHitRadius);
      if (distanceSquared <= hitRadius ** 2 && (!best || distanceSquared < best.distanceSquared)) best = { answer, distanceSquared };
    }
  }
  return best?.answer ?? null;
}

/** 걸린 시간 = 다 찾은 시각 - 시작 시각 + 오답 페널티 */
export function soloElapsedMs(run: Pick<SoloRun, "startsAtMs" | "wrongCount">, finishedAtMs: number): number {
  return Math.max(0, finishedAtMs - run.startsAtMs) + run.wrongCount * SOLO_RULES.wrongPenaltyMs;
}

/** 서버가 클릭 하나를 판정한다. run은 바꾸지 않고 새 상태를 돌려준다. */
export function guessSoloRun(run: SoloRun, answers: readonly SoloAnswer[], input: SoloGuessInput, nowMs: number): SoloGuessOutcome {
  if (run.finishedAtMs !== null) return { ok: false, code: "SOLO_FINISHED", message: "이미 끝난 판이에요." };
  if (nowMs < run.startsAtMs) return { ok: false, code: "SOLO_NOT_STARTED", message: "아직 시작하지 않았어요." };
  if (nowMs > run.startsAtMs + SOLO_RULES.maxRunMs) return { ok: false, code: "SOLO_EXPIRED", message: "시간이 너무 지나 다시 시작해야 해요." };
  const { point } = input;
  if (!point || ![point.x, point.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) {
    return { ok: false, code: "INVALID_POINT", message: "선택 좌표가 올바르지 않습니다." };
  }
  if (run.lastGuessAtMs !== null && nowMs - run.lastGuessAtMs < SOLO_RULES.guessIntervalMs) {
    return { ok: false, code: "INPUT_RATE_LIMITED", message: "입력이 너무 빠릅니다. 잠시 후 다시 시도해주세요." };
  }
  const found = findSoloAnswer(answers, new Set(run.foundIds), point, minimumSoloHitRadius(input.pointerType, input.boardSizePx));
  if (!found) {
    return { ok: true, correct: false, run: { ...run, wrongCount: run.wrongCount + 1, lastGuessAtMs: nowMs } };
  }
  const foundIds = [...run.foundIds, found.id];
  const finished = foundIds.length >= Math.min(SOLO_RULES.differences, answers.length);
  const next: SoloRun = { ...run, foundIds, lastGuessAtMs: nowMs, finishedAtMs: finished ? nowMs : null };
  return {
    ok: true,
    correct: true,
    run: next,
    mark: { differenceId: found.id, region: { ...found.region }, label: found.label },
    ...(finished ? { elapsedMs: soloElapsedMs(next, nowMs) } : {}),
  };
}
