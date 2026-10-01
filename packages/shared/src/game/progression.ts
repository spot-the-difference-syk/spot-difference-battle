import { DEFAULT_LOADOUT, normalizeLoadout, normalizeOwnedItems, ownedItemIds, type CosmeticLoadout } from "./cosmetics.js";
import type { GameSnapshot } from "./types.js";

/** 서버가 저장하는 플레이어 성장 기록. 보상 계산은 항상 서버가 한다. */
export interface PlayerGrowth {
  totalXp: number;
  coins: number;
  /** 같은 경기 보상을 두 번 주지 않도록 최근 보상 경기 ID를 남긴다. */
  rewardedMatchIds: string[];
  /** 솔로 보상 하루 한도를 세는 한국 시간 날짜(YYYY-MM-DD). */
  soloRewardDay: string | null;
  soloRewardCount: number;
  /** 코인으로 산 꾸미기 아이템 ID. 무료 아이템은 저장하지 않는다. */
  ownedItems: string[];
  loadout: CosmeticLoadout;
}

/** 화면에 보여줄 레벨 정보 */
export interface GrowthView {
  level: number;
  totalXp: number;
  /** 현재 레벨 안에서 모은 경험치 */
  levelXp: number;
  /** 다음 레벨까지 필요한 이번 레벨 경험치 총량 */
  levelXpGoal: number;
  coins: number;
  /** 지금 쓸 수 있는 꾸미기 아이템(무료 해금 포함) */
  ownedItemIds: string[];
  loadout: CosmeticLoadout;
}

export type RewardReason = "WIN" | "LOSS" | "DRAW" | "SOLO";

export interface RewardSummary {
  reason: RewardReason;
  xp: number;
  coins: number;
  before: GrowthView;
  after: GrowthView;
  leveledUp: boolean;
}

export interface PlayerGrowthPayload {
  progress: GrowthView;
  /** 방금 받은 보상. 접속 직후 동기화에는 없다. */
  reward?: RewardSummary;
  /** 대결 보상이면 해당 경기 ID */
  matchId?: string;
  /** 솔로 하루 보상 한도에 도달해 이번 완주에는 보상이 없을 때 true */
  soloLimitReached?: boolean;
}

export const PROGRESSION_RULES = {
  rewards: {
    WIN: { xp: 100, coins: 120 },
    LOSS: { xp: 40, coins: 30 },
    DRAW: { xp: 60, coins: 60 },
    SOLO: { xp: 30, coins: 20 },
  },
  /** 하루에 솔로 보상을 받을 수 있는 횟수 */
  soloDailyLimit: 5,
  /** 레벨 1→2에 필요한 경험치. 레벨마다 levelStepXp씩 늘어난다. */
  baseLevelXp: 100,
  levelStepXp: 20,
  /** 솔로 완주로 인정하는 최소 기록. 이보다 빠르면 조작으로 보고 보상하지 않는다. */
  minimumSoloElapsedMs: 3_000,
  rememberedMatchCount: 20,
} as const satisfies {
  rewards: Record<RewardReason, { xp: number; coins: number }>;
  soloDailyLimit: number;
  baseLevelXp: number;
  levelStepXp: number;
  minimumSoloElapsedMs: number;
  rememberedMatchCount: number;
};

export function emptyGrowth(): PlayerGrowth {
  return { totalXp: 0, coins: 0, rewardedMatchIds: [], soloRewardDay: null, soloRewardCount: 0, ownedItems: [], loadout: { ...DEFAULT_LOADOUT } };
}

/** level 레벨에서 다음 레벨로 가는 데 필요한 경험치 */
export function xpForLevel(level: number): number {
  return PROGRESSION_RULES.baseLevelXp + (level - 1) * PROGRESSION_RULES.levelStepXp;
}

export function growthView(progress: PlayerGrowth): GrowthView {
  let level = 1;
  let remaining = Math.max(0, Math.floor(progress.totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return {
    level,
    totalXp: progress.totalXp,
    levelXp: remaining,
    levelXpGoal: xpForLevel(level),
    coins: progress.coins,
    ownedItemIds: ownedItemIds(progress, level),
    loadout: progress.loadout,
  };
}

/** 저장소에서 읽은 값을 검증한다. 손상된 값은 빈 기록으로 취급한다. */
export function normalizeGrowth(value: unknown): PlayerGrowth {
  if (!value || typeof value !== "object") return emptyGrowth();
  const input = value as Partial<PlayerGrowth>;
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
  return {
    totalXp: count(input.totalXp),
    coins: count(input.coins),
    rewardedMatchIds: Array.isArray(input.rewardedMatchIds)
      ? input.rewardedMatchIds.filter((id): id is string => typeof id === "string").slice(-PROGRESSION_RULES.rememberedMatchCount)
      : [],
    soloRewardDay: typeof input.soloRewardDay === "string" ? input.soloRewardDay : null,
    soloRewardCount: count(input.soloRewardCount),
    ownedItems: normalizeOwnedItems(input.ownedItems),
    loadout: normalizeLoadout(input.loadout),
  };
}

function grant(progress: PlayerGrowth, reason: RewardReason): { progress: PlayerGrowth; reward: RewardSummary } {
  const amount = PROGRESSION_RULES.rewards[reason];
  const before = growthView(progress);
  const next = { ...progress, totalXp: progress.totalXp + amount.xp, coins: progress.coins + amount.coins };
  const after = growthView(next);
  return {
    progress: next,
    reward: { reason, xp: amount.xp, coins: amount.coins, before, after, leveledUp: after.level > before.level },
  };
}

/** 종료된 경기에서 이 플레이어가 받을 보상 종류. 보상이 없으면 null. */
export function matchRewardReason(snapshot: Pick<GameSnapshot, "state" | "winnerId" | "endReason">, playerId: string): Exclude<RewardReason, "SOLO"> | null {
  if (snapshot.state !== "FINISHED") return null;
  if (snapshot.winnerId === null) return "DRAW";
  if (snapshot.winnerId === playerId) return "WIN";
  // 스스로 나가거나 연결이 끊겨 기권패한 경우에는 보상하지 않는다.
  if (snapshot.endReason === "FORFEIT") return null;
  return "LOSS";
}

/** 경기 보상을 한 번만 지급한다. 이미 받았거나 보상 대상이 아니면 null. */
export function grantMatchReward(
  progress: PlayerGrowth,
  matchId: string,
  snapshot: Pick<GameSnapshot, "state" | "winnerId" | "endReason">,
  playerId: string,
): { progress: PlayerGrowth; reward: RewardSummary } | null {
  const reason = matchRewardReason(snapshot, playerId);
  if (!reason || progress.rewardedMatchIds.includes(matchId)) return null;
  const granted = grant(progress, reason);
  granted.progress.rewardedMatchIds = [...progress.rewardedMatchIds, matchId].slice(-PROGRESSION_RULES.rememberedMatchCount);
  return granted;
}

/** 한국 시간 기준 날짜 */
export function koreanDay(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

/** 솔로 완주 보상. 하루 한도를 넘거나 기록이 비정상이면 reward 없이 돌려준다. */
export function grantSoloReward(
  progress: PlayerGrowth,
  elapsedMs: number,
  nowMs: number,
): { progress: PlayerGrowth; reward: RewardSummary | null; limitReached: boolean } {
  if (!Number.isFinite(elapsedMs) || elapsedMs < PROGRESSION_RULES.minimumSoloElapsedMs) {
    return { progress, reward: null, limitReached: false };
  }
  const day = koreanDay(nowMs);
  const count = progress.soloRewardDay === day ? progress.soloRewardCount : 0;
  if (count >= PROGRESSION_RULES.soloDailyLimit) {
    return { progress: { ...progress, soloRewardDay: day, soloRewardCount: count }, reward: null, limitReached: true };
  }
  const granted = grant(progress, "SOLO");
  return { progress: { ...granted.progress, soloRewardDay: day, soloRewardCount: count + 1 }, reward: granted.reward, limitReached: false };
}
