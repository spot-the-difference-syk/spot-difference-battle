import { GameRuleError } from "@spot-battle/game-core";
import {
  guessSoloRun,
  PROGRESSION_RULES,
  koreanWeekKey,
  rankOf,
  rankingPayload,
  startSoloRun,
  submitRecord,
  weeklyRewards,
  type PublicCosmetics,
  type RankEntry,
  type RankingPayload,
  type RankingPeriod,
  type SoloGuessInput,
  type SoloGuessResultPayload,
  type SoloRun,
  type SoloStartedPayload,
  type WeeklyRewardGrant,
} from "@spot-battle/shared";
import type { CatalogService } from "./catalog-service.js";

/** 저장소에 그대로 넣을 수 있는 랭킹 상태 */
export interface LeagueState {
  /** "<그림 ID>|all" 또는 "<그림 ID>|w:<주 월요일>" → 순위표 */
  boards: Record<string, RankEntry[]>;
  /** 보상을 마지막으로 정산한 주. 그 주까지는 끝났다. */
  settledWeek: string | null;
  /** 정산 때 접속 기록이 없던 플레이어에게 다음 접속 때 줄 보상 */
  pending: Record<string, WeeklyRewardGrant[]>;
}

export const emptyLeagueState = (): LeagueState => ({ boards: {}, settledWeek: null, pending: {} });

const boardKey = (puzzleId: string, period: RankingPeriod, weekKey: string) => period === "all" ? `${puzzleId}|all` : `${puzzleId}|w:${weekKey}`;

export interface SoloFinish {
  puzzleId: string;
  elapsedMs: number;
}

/**
 * 서버 판정 솔로 타임어택과 랭킹. 대결 서버(Node)와 운영 Worker가 함께 쓴다.
 * 판(SoloRun)은 호출한 쪽이 플레이어별로 보관하고, 순위표는 이 객체가 들고 있다.
 */
export class SoloLeague {
  readonly state: LeagueState;
  /** 저장해야 하는 순위표 키(지워진 것 포함) */
  private readonly dirty = new Set<string>();
  private pendingDirty = false;

  constructor(private readonly catalog: CatalogService, state: LeagueState = emptyLeagueState(), private readonly now: () => number = Date.now) {
    this.state = state;
  }

  start(puzzleId: string, runId: string): { run: SoloRun; payload: SoloStartedPayload } {
    const puzzle = this.catalog.soloPuzzle(puzzleId);
    if (!puzzle) throw new GameRuleError("PUZZLE_NOT_FOUND", "지금 할 수 없는 그림이에요.");
    const now = this.now();
    const run = startSoloRun(runId, puzzle, now);
    return { run, payload: { runId, puzzleId: run.puzzleId, puzzleVersion: run.puzzleVersion, startsAtMs: run.startsAtMs, serverNowMs: now } };
  }

  /** 클릭 하나를 판정한다. 다 찾으면 finish에 기록이 담긴다. */
  guess(run: SoloRun | undefined, runId: string, input: SoloGuessInput): { run: SoloRun; payload: SoloGuessResultPayload; finish?: SoloFinish } {
    if (!run || run.runId !== runId) throw new GameRuleError("SOLO_NOT_FOUND", "진행 중인 솔로 판이 없어요. 다시 시작해주세요.");
    const puzzle = this.catalog.soloAnswers(run.puzzleId, run.puzzleVersion);
    if (!puzzle) throw new GameRuleError("SOLO_NOT_FOUND", "그림 정보가 바뀌었어요. 다시 시작해주세요.");
    const now = this.now();
    const outcome = guessSoloRun(run, puzzle.answers, input, now);
    if (!outcome.ok) throw new GameRuleError(outcome.code, outcome.message);
    const payload: SoloGuessResultPayload = {
      runId,
      correct: outcome.correct,
      ...(outcome.mark ? { mark: outcome.mark } : {}),
      foundCount: outcome.run.foundIds.length,
      wrongCount: outcome.run.wrongCount,
      serverNowMs: now,
    };
    return { run: outcome.run, payload, ...(outcome.elapsedMs !== undefined ? { finish: { puzzleId: run.puzzleId, elapsedMs: outcome.elapsedMs } } : {}) };
  }

  /** 서버가 잰 기록을 주간·전체 순위표에 넣고 순위를 돌려준다. */
  record(player: { playerId: string; nickname: string } & PublicCosmetics, finish: SoloFinish): { weekRank: number | null; allRank: number | null } {
    const now = this.now();
    const entry: RankEntry = { ...player, elapsedMs: finish.elapsedMs, recordedAt: now };
    const ranks = { weekRank: null as number | null, allRank: null as number | null };
    // 사람이 낼 수 없는 기록은 보상처럼 순위에도 넣지 않는다.
    if (finish.elapsedMs < PROGRESSION_RULES.minimumSoloElapsedMs) return ranks;
    for (const period of ["week", "all"] as const) {
      const key = boardKey(finish.puzzleId, period, koreanWeekKey(now));
      const { board } = submitRecord(this.state.boards[key] ?? [], entry);
      this.state.boards[key] = board;
      this.dirty.add(key);
      ranks[period === "week" ? "weekRank" : "allRank"] = rankOf(board, player.playerId);
    }
    return ranks;
  }

  ranking(puzzleId: string, period: RankingPeriod, me: { playerId: string; personalBestMs: number | null; cosmetics?: Map<string, PublicCosmetics> } | null): RankingPayload {
    const weekKey = koreanWeekKey(this.now());
    const board = this.state.boards[boardKey(puzzleId, period, weekKey)] ?? [];
    // 순위표에는 기록을 세울 때의 꾸미기가 있다. 지금 접속 중인 사람은 최신 꾸미기로 보여준다.
    const shown = me?.cosmetics ? board.map((entry) => ({ ...entry, ...me.cosmetics!.get(entry.playerId) })) : board;
    return rankingPayload(shown, { puzzleId, period, weekKey: period === "week" ? weekKey : null }, me && { playerId: me.playerId, bestMs: period === "all" ? me.personalBestMs : null });
  }

  /**
   * 지난 주들의 보상을 한 번만 정산한다. 끝난 주간 순위표는 지운다.
   * 처음 실행할 때는 지난 기록이 없으므로 이번 주부터 센다.
   */
  settle(): WeeklyRewardGrant[] {
    const current = koreanWeekKey(this.now());
    const grants: WeeklyRewardGrant[] = [];
    const weeks = new Map<string, Array<{ puzzleId: string; entries: RankEntry[] }>>();
    for (const [key, entries] of Object.entries(this.state.boards)) {
      const match = /^(.+)\|w:(\d{4}-\d{2}-\d{2})$/.exec(key);
      if (!match || match[2]! >= current) continue;
      if (this.state.settledWeek === null || match[2]! > this.state.settledWeek) {
        weeks.set(match[2]!, [...(weeks.get(match[2]!) ?? []), { puzzleId: match[1]!, entries }]);
      }
      delete this.state.boards[key];
      this.dirty.add(key);
    }
    for (const [weekKey, boards] of [...weeks].sort(([a], [b]) => a.localeCompare(b))) grants.push(...weeklyRewards(weekKey, boards));
    if (this.state.settledWeek === null || this.state.settledWeek < current) {
      // 이번 주 직전까지 정산을 마쳤다.
      this.state.settledWeek = new Date(Date.parse(`${current}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      this.pendingDirty = true;
    }
    return grants;
  }

  /** 정산 때 접속하지 않았던 플레이어의 보상을 맡아 둔다. */
  hold(grant: WeeklyRewardGrant): void {
    this.state.pending[grant.playerId] = [...(this.state.pending[grant.playerId] ?? []), grant];
    this.pendingDirty = true;
  }

  takePending(playerId: string): WeeklyRewardGrant[] {
    const grants = this.state.pending[playerId] ?? [];
    if (grants.length) {
      delete this.state.pending[playerId];
      this.pendingDirty = true;
    }
    return grants;
  }

  /** 마지막 저장 이후 바뀐 부분. 순위표 값이 undefined면 지워진 것이다. */
  drainChanges(): { boards: Array<[string, RankEntry[] | undefined]>; meta: boolean } {
    const boards = [...this.dirty].map((key): [string, RankEntry[] | undefined] => [key, this.state.boards[key]]);
    const meta = this.pendingDirty;
    this.dirty.clear();
    this.pendingDirty = false;
    return { boards, meta };
  }
}
