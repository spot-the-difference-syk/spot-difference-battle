import type { PublicCosmetics } from "./cosmetics.js";

/** 솔로 랭킹. 그림마다 주간(월요일 0시, 한국 시간 초기화)·전체 순위를 둔다. */
export type RankingPeriod = "week" | "all";

export const RANKING_RULES = {
  /** 순위표에 저장하는 최대 인원. 그 밖은 "N위 밖"으로 보인다. */
  boardSize: 500,
  /** 한 번에 보여주는 순위 */
  listSize: 50,
  /** 주간 보상을 주려면 그 그림에 이만큼은 참가해야 한다(혼자 1위 방지). */
  minParticipantsForReward: 5,
} as const;

/** 주간 보상. 한 사람은 그 주 모든 그림 중 가장 좋은 보상 하나만 받는다. */
export const WEEKLY_RANK_REWARDS = [
  { tier: "champion", label: "주간 1위", coins: 600, titleId: "title-weekly-champion" },
  { tier: "podium", label: "주간 2~3위", coins: 300, titleId: "title-weekly-top" },
  { tier: "top10", label: "주간 상위 10%", coins: 150, titleId: "title-weekly-top" },
] as const;
export type WeeklyRewardTier = (typeof WEEKLY_RANK_REWARDS)[number]["tier"];

export interface RankEntry extends PublicCosmetics {
  playerId: string;
  nickname: string;
  elapsedMs: number;
  /** 기록을 세운 서버 시각. 같은 기록이면 먼저 세운 사람이 앞선다. */
  recordedAt: number;
}

export interface RankRow extends PublicCosmetics {
  rank: number;
  nickname: string;
  elapsedMs: number;
  me: boolean;
}

export interface RankingPayload {
  puzzleId: string;
  period: RankingPeriod;
  /** 주간이면 그 주의 월요일 날짜(YYYY-MM-DD) */
  weekKey: string | null;
  participants: number;
  rows: RankRow[];
  /** 내 기록. 순위표 밖이면 rank가 null */
  me: { rank: number | null; elapsedMs: number } | null;
}

export interface WeeklyRewardGrant {
  playerId: string;
  weekKey: string;
  tier: WeeklyRewardTier;
  label: string;
  rank: number;
  puzzleId: string;
  coins: number;
  titleId: string;
}

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;

/** 한국 시간 기준 그 주 월요일 날짜 */
export function koreanWeekKey(nowMs: number): string {
  const kst = new Date(nowMs + KST_MS);
  const sinceMonday = (kst.getUTCDay() + 6) % 7;
  return new Date(kst.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export function previousWeekKey(weekKey: string): string {
  return new Date(Date.parse(`${weekKey}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10);
}

const compare = (a: RankEntry, b: RankEntry) => a.elapsedMs - b.elapsedMs || a.recordedAt - b.recordedAt;

/**
 * 기록을 넣는다. 한 사람은 가장 좋은 기록 하나만 남는다.
 * improved: 이번 기록이 순위표의 내 기록보다 좋아서 반영됐는지
 */
export function submitRecord(board: readonly RankEntry[], entry: RankEntry, size: number = RANKING_RULES.boardSize): { board: RankEntry[]; improved: boolean } {
  const previous = board.find((candidate) => candidate.playerId === entry.playerId);
  if (previous && previous.elapsedMs <= entry.elapsedMs) {
    // 기록은 그대로 두고 닉네임·꾸미기만 최신으로 맞춘다.
    const refreshed = board.map((candidate) => candidate === previous ? { ...previous, nickname: entry.nickname, avatar: entry.avatar, profile: entry.profile, title: entry.title } : candidate);
    return { board: refreshed, improved: false };
  }
  const next = [...board.filter((candidate) => candidate.playerId !== entry.playerId), entry].sort(compare).slice(0, size);
  return { board: next, improved: next.includes(entry) };
}

export function rankOf(board: readonly RankEntry[], playerId: string): number | null {
  const index = board.findIndex((entry) => entry.playerId === playerId);
  return index < 0 ? null : index + 1;
}

export function rankingPayload(
  board: readonly RankEntry[],
  query: { puzzleId: string; period: RankingPeriod; weekKey: string | null },
  me: { playerId: string; bestMs: number | null } | null,
): RankingPayload {
  const rank = me ? rankOf(board, me.playerId) : null;
  const myEntry = rank ? board[rank - 1] : undefined;
  const myMs = myEntry?.elapsedMs ?? me?.bestMs ?? null;
  return {
    ...query,
    participants: board.length,
    rows: board.slice(0, RANKING_RULES.listSize).map((entry, index) => ({
      rank: index + 1,
      nickname: entry.nickname,
      elapsedMs: entry.elapsedMs,
      avatar: entry.avatar,
      profile: entry.profile,
      title: entry.title,
      me: entry.playerId === me?.playerId,
    })),
    me: myMs === null ? null : { rank, elapsedMs: myMs },
  };
}

function rewardFor(rank: number, participants: number) {
  if (participants < RANKING_RULES.minParticipantsForReward) return null;
  if (rank === 1) return WEEKLY_RANK_REWARDS[0];
  if (rank <= 3) return WEEKLY_RANK_REWARDS[1];
  if (rank <= Math.ceil(participants * 0.1)) return WEEKLY_RANK_REWARDS[2];
  return null;
}

/** 지난주 순위표들로 보상을 정한다. 한 사람은 가장 좋은 보상 하나만 받는다. */
export function weeklyRewards(weekKey: string, boards: ReadonlyArray<{ puzzleId: string; entries: readonly RankEntry[] }>): WeeklyRewardGrant[] {
  const order = WEEKLY_RANK_REWARDS.map((reward) => reward.tier);
  const best = new Map<string, WeeklyRewardGrant>();
  for (const { puzzleId, entries } of boards) {
    entries.forEach((entry, index) => {
      const reward = rewardFor(index + 1, entries.length);
      if (!reward) return;
      const grant: WeeklyRewardGrant = { playerId: entry.playerId, weekKey, tier: reward.tier, label: reward.label, rank: index + 1, puzzleId, coins: reward.coins, titleId: reward.titleId };
      const current = best.get(entry.playerId);
      if (!current || order.indexOf(grant.tier) < order.indexOf(current.tier)) best.set(entry.playerId, grant);
    });
  }
  return [...best.values()];
}
