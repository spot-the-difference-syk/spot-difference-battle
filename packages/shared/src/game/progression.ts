import { DEFAULT_LOADOUT, normalizeLoadout, normalizeOwnedItems, ownedItemIds, type CosmeticLoadout } from "./cosmetics.js";
import type { GameSnapshot } from "./types.js";

export interface PlayerStats {
  /** 끝까지 진행된 대결 수(기권 포함) */
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  /** 정상 기록으로 인정된 솔로 완주 수 */
  soloClears: number;
  /** 대결에서 찾은 차이 수 */
  differencesFound: number;
}

export interface DailyGoalRecord {
  day: string;
  goalId: string;
  progress: number;
  done: boolean;
}

/** 서버가 저장하는 플레이어 성장 기록. 보상 계산은 항상 서버가 한다. */
export interface PlayerGrowth {
  totalXp: number;
  coins: number;
  /** 같은 경기를 두 번 정산하지 않도록 최근 정산 경기 ID를 남긴다. */
  rewardedMatchIds: string[];
  /** 솔로 보상 하루 한도를 세는 한국 시간 날짜(YYYY-MM-DD). */
  soloRewardDay: string | null;
  soloRewardCount: number;
  /** 코인으로 산 꾸미기 아이템 ID. 무료 아이템은 저장하지 않는다. */
  ownedItems: string[];
  loadout: CosmeticLoadout;
  stats: PlayerStats;
  /** 끝까지 푼 그림. "game:<id>" 또는 "solo:<id>" */
  collected: string[];
  daily: DailyGoalRecord | null;
}

export interface DailyGoalView {
  id: string;
  label: string;
  progress: number;
  target: number;
  done: boolean;
  bonus: { xp: number; coins: number };
}

/** 화면에 보여줄 성장 정보 */
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
  stats: PlayerStats;
  collected: string[];
  daily: DailyGoalView;
}

export type RewardReason = "WIN" | "LOSS" | "DRAW" | "SOLO";

export interface RewardSummary {
  reason: RewardReason;
  /** 오늘의 목표 보너스를 포함한 합계 */
  xp: number;
  coins: number;
  before: GrowthView;
  after: GrowthView;
  leveledUp: boolean;
  /** 이번 보상으로 오늘의 목표를 달성했으면 그 보너스 */
  dailyGoal?: { label: string; xp: number; coins: number };
  /** 이번에 처음 수집한 그림 */
  newlyCollected?: string[];
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
  dailyGoalBonus: { xp: 50, coins: 60 },
} as const;

type GoalMetric = "wins" | "matches" | "soloClears" | "differences";

/** 오늘의 목표 후보. 날짜마다 모두에게 같은 목표가 나온다. */
export const DAILY_GOALS: ReadonlyArray<{ id: string; label: string; target: number; metric: GoalMetric }> = [
  { id: "win-2", label: "대결 2번 이기기", target: 2, metric: "wins" },
  { id: "play-3", label: "대결 3판 하기", target: 3, metric: "matches" },
  { id: "solo-2", label: "솔로 2번 완주하기", target: 2, metric: "soloClears" },
  { id: "find-20", label: "대결에서 차이 20개 찾기", target: 20, metric: "differences" },
];

/** 수집 키: "game:<퍼즐 ID>" 또는 "solo:<퍼즐 ID>". 그림은 카탈로그로 늘어나므로 형식만 검사한다. */
const COLLECTION_KEY_PATTERN = /^(game|solo):[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_COLLECTION = 5_000;
const isCollectionKey = (key: string) => COLLECTION_KEY_PATTERN.test(key) && key.length <= 80;

const emptyStats = (): PlayerStats => ({ matches: 0, wins: 0, draws: 0, losses: 0, soloClears: 0, differencesFound: 0 });

export function emptyGrowth(): PlayerGrowth {
  return {
    totalXp: 0,
    coins: 0,
    rewardedMatchIds: [],
    soloRewardDay: null,
    soloRewardCount: 0,
    ownedItems: [],
    loadout: { ...DEFAULT_LOADOUT },
    stats: emptyStats(),
    collected: [],
    daily: null,
  };
}

/** 한국 시간 기준 날짜 */
export function koreanDay(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function dailyGoalFor(day: string) {
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DAILY_GOALS[hash % DAILY_GOALS.length]!;
}

function todayRecord(growth: PlayerGrowth, nowMs: number): DailyGoalRecord {
  const day = koreanDay(nowMs);
  const goal = dailyGoalFor(day);
  return growth.daily?.day === day && growth.daily.goalId === goal.id
    ? growth.daily
    : { day, goalId: goal.id, progress: 0, done: false };
}

/** level 레벨에서 다음 레벨로 가는 데 필요한 경험치 */
export function xpForLevel(level: number): number {
  return PROGRESSION_RULES.baseLevelXp + (level - 1) * PROGRESSION_RULES.levelStepXp;
}

export function growthView(progress: PlayerGrowth, nowMs = Date.now()): GrowthView {
  let level = 1;
  let remaining = Math.max(0, Math.floor(progress.totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  const record = todayRecord(progress, nowMs);
  const goal = dailyGoalFor(record.day);
  return {
    level,
    totalXp: progress.totalXp,
    levelXp: remaining,
    levelXpGoal: xpForLevel(level),
    coins: progress.coins,
    ownedItemIds: ownedItemIds(progress, level),
    loadout: progress.loadout,
    stats: progress.stats,
    collected: progress.collected,
    daily: { id: goal.id, label: goal.label, progress: Math.min(record.progress, goal.target), target: goal.target, done: record.done, bonus: PROGRESSION_RULES.dailyGoalBonus },
  };
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);

/** 저장소에서 읽은 값을 검증한다. 손상된 값은 빈 기록으로 취급한다. */
export function normalizeGrowth(value: unknown): PlayerGrowth {
  if (!value || typeof value !== "object") return emptyGrowth();
  const input = value as Partial<Record<keyof PlayerGrowth, unknown>>;
  const stats = (input.stats && typeof input.stats === "object" ? input.stats : {}) as Record<string, unknown>;
  const daily = input.daily && typeof input.daily === "object" ? input.daily as Record<string, unknown> : null;
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
    stats: {
      matches: count(stats.matches),
      wins: count(stats.wins),
      draws: count(stats.draws),
      losses: count(stats.losses),
      soloClears: count(stats.soloClears),
      differencesFound: count(stats.differencesFound),
    },
    collected: Array.isArray(input.collected)
      ? [...new Set(input.collected.filter((key): key is string => typeof key === "string" && isCollectionKey(key)))].slice(0, MAX_COLLECTION)
      : [],
    daily: daily && typeof daily.day === "string" && typeof daily.goalId === "string"
      ? { day: daily.day, goalId: daily.goalId, progress: count(daily.progress), done: daily.done === true }
      : null,
  };
}

function collect(growth: PlayerGrowth, keys: readonly string[]): { growth: PlayerGrowth; added: string[] } {
  const room = MAX_COLLECTION - growth.collected.length;
  const added = [...new Set(keys)].filter((key) => isCollectionKey(key) && !growth.collected.includes(key)).slice(0, Math.max(0, room));
  return added.length ? { growth: { ...growth, collected: [...growth.collected, ...added] }, added } : { growth, added };
}

/** 보상과 오늘의 목표 진행을 함께 반영한다. */
function grant(
  progress: PlayerGrowth,
  reason: RewardReason,
  before: GrowthView,
  goalIncrements: Partial<Record<GoalMetric, number>>,
  nowMs: number,
  newlyCollected: string[],
): { progress: PlayerGrowth; reward: RewardSummary } {
  const amount = PROGRESSION_RULES.rewards[reason];
  let xp: number = amount.xp;
  let coins: number = amount.coins;
  const record = todayRecord(progress, nowMs);
  const goal = dailyGoalFor(record.day);
  const daily = { ...record, progress: record.progress + (goalIncrements[goal.metric] ?? 0) };
  let dailyGoal: RewardSummary["dailyGoal"];
  if (!daily.done && daily.progress >= goal.target) {
    daily.done = true;
    xp += PROGRESSION_RULES.dailyGoalBonus.xp;
    coins += PROGRESSION_RULES.dailyGoalBonus.coins;
    dailyGoal = { label: goal.label, ...PROGRESSION_RULES.dailyGoalBonus };
  }
  const next = { ...progress, totalXp: progress.totalXp + xp, coins: progress.coins + coins, daily };
  const after = growthView(next, nowMs);
  return {
    progress: next,
    reward: {
      reason, xp, coins, before, after, leveledUp: after.level > before.level,
      ...(dailyGoal ? { dailyGoal } : {}),
      ...(newlyCollected.length ? { newlyCollected } : {}),
    },
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

/** 경기 기록에서 이 플레이어가 끝까지 푼 그림과 찾은 차이 수를 뽑는다. */
export function matchJourney(
  state: { puzzles: ReadonlyArray<{ id: string }>; players: ReadonlyArray<{ playerId: string; puzzleIndex: number; foundIdsByPuzzle: ReadonlyArray<ReadonlyArray<string>> }> },
  playerId: string,
): { completedKeys: string[]; found: number } {
  const player = state.players.find((candidate) => candidate.playerId === playerId);
  if (!player) return { completedKeys: [], found: 0 };
  return {
    completedKeys: state.puzzles.slice(0, player.puzzleIndex).map((puzzle) => `game:${puzzle.id}`),
    found: player.foundIdsByPuzzle.reduce((total, ids) => total + ids.length, 0),
  };
}

/**
 * 종료된 경기를 한 번만 정산한다. 전적·수집은 기권패도 반영하고,
 * 경험치·코인·오늘의 목표는 보상 대상일 때만 반영한다.
 */
export function settleMatch(
  progress: PlayerGrowth,
  matchId: string,
  snapshot: Pick<GameSnapshot, "state" | "winnerId" | "endReason">,
  playerId: string,
  journey: { completedKeys: readonly string[]; found: number },
  nowMs = Date.now(),
): { progress: PlayerGrowth; reward: RewardSummary | null } | null {
  if (snapshot.state !== "FINISHED" || progress.rewardedMatchIds.includes(matchId)) return null;
  const before = growthView(progress, nowMs);
  const outcome = snapshot.winnerId === null ? "draws" : snapshot.winnerId === playerId ? "wins" : "losses";
  const stats = {
    ...progress.stats,
    matches: progress.stats.matches + 1,
    [outcome]: progress.stats[outcome] + 1,
    differencesFound: progress.stats.differencesFound + journey.found,
  };
  const collected = collect({ ...progress, stats }, journey.completedKeys);
  let next: PlayerGrowth = {
    ...collected.growth,
    rewardedMatchIds: [...progress.rewardedMatchIds, matchId].slice(-PROGRESSION_RULES.rememberedMatchCount),
  };
  const reason = matchRewardReason(snapshot, playerId);
  if (!reason) return { progress: next, reward: null };
  const granted = grant(next, reason, before, { wins: reason === "WIN" ? 1 : 0, matches: 1, differences: journey.found }, nowMs, collected.added);
  next = granted.progress;
  return { progress: next, reward: granted.reward };
}

/** 솔로 완주 정산. 기록이 비정상이면 아무것도 바꾸지 않고, 하루 한도를 넘으면 수집·전적만 반영한다. */
export function grantSoloReward(
  progress: PlayerGrowth,
  elapsedMs: number,
  nowMs: number,
  soloPuzzleId?: string,
): { progress: PlayerGrowth; reward: RewardSummary | null; limitReached: boolean } {
  if (!Number.isFinite(elapsedMs) || elapsedMs < PROGRESSION_RULES.minimumSoloElapsedMs) {
    return { progress, reward: null, limitReached: false };
  }
  const before = growthView(progress, nowMs);
  const day = koreanDay(nowMs);
  const used = progress.soloRewardDay === day ? progress.soloRewardCount : 0;
  const collected = collect(
    { ...progress, stats: { ...progress.stats, soloClears: progress.stats.soloClears + 1 } },
    soloPuzzleId ? [`solo:${soloPuzzleId}`] : [],
  );
  if (used >= PROGRESSION_RULES.soloDailyLimit) {
    return { progress: { ...collected.growth, soloRewardDay: day, soloRewardCount: used }, reward: null, limitReached: true };
  }
  const granted = grant(collected.growth, "SOLO", before, { soloClears: 1 }, nowMs, collected.added);
  return { progress: { ...granted.progress, soloRewardDay: day, soloRewardCount: used + 1 }, reward: granted.reward, limitReached: false };
}
