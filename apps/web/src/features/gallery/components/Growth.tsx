import { COSMETIC_ITEM_BY_ID, type GrowthView, type RewardSummary } from "@spot-battle/shared";

const RING_RADIUS = 22.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function levelRatio(growth: GrowthView): number {
  return growth.levelXpGoal ? Math.min(1, growth.levelXp / growth.levelXpGoal) : 0;
}

/** 프로필 사진 둘레가 다음 레벨까지 차오른다. */
export function titleName(titleId: string | undefined): string {
  return (titleId && COSMETIC_ITEM_BY_ID[titleId]?.name) || "";
}

export function LevelAvatar({ nickname, growth, size = 38, profile }: { nickname: string; growth: GrowthView | null; size?: number; profile?: string }) {
  const filled = growth ? levelRatio(growth) * RING_LENGTH : 0;
  return <span className={`level-avatar ${profile ?? growth?.loadout.profile ?? "profile-none"}`} style={{ width: size, height: size }}>
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden>{nickname.slice(0, 1)}</span>
    {growth && <svg className="level-ring" viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r={RING_RADIUS} className="track"/>
      {filled > 0 && <circle cx="24" cy="24" r={RING_RADIUS} className="fill" strokeDasharray={`${filled} ${RING_LENGTH}`}/>}
    </svg>}
    {growth && <span className="level-badge" aria-hidden>{growth.level}</span>}
  </span>;
}

export function CoinChip({ coins }: { coins: number }) {
  return <span className="coin-chip" aria-label={`코인 ${coins.toLocaleString("ko-KR")}개`}><i aria-hidden/>{coins.toLocaleString("ko-KR")}</span>;
}

export function ProfileBadge({ nickname, growth }: { nickname: string; growth: GrowthView | null }) {
  return <span className="profile">
    <LevelAvatar nickname={nickname} growth={growth}/>
    <span className="profile-text"><span className="profile-name">{nickname}</span>{growth && <span data-testid="player-level" className="profile-level">레벨 {growth.level} · {titleName(growth.loadout.title)}</span>}</span>
  </span>;
}

export function XpBar({ growth, tone = "light" }: { growth: GrowthView; tone?: "light" | "dark" }) {
  return <div className={`xp-bar ${tone}`}>
    <div className="xp-track"><i style={{ width: `${levelRatio(growth) * 100}%` }}/></div>
    <div className="xp-label"><span>경험치 {growth.levelXp} / {growth.levelXpGoal}</span><span>다음 레벨까지 {growth.levelXpGoal - growth.levelXp}</span></div>
  </div>;
}

/** 경기·솔로 결과에 붙는 보상 영역 */
export function RewardPanel({ reward, note }: { reward: RewardSummary | null | undefined; note?: string }) {
  if (!reward) return note ? <p data-testid="reward-panel" className="muted mt-6 text-[13px]">{note}</p> : null;
  return <section data-testid="reward-panel" className="reward-panel fade-up">
    {reward.leveledUp
      ? <div className="level-up"><span className="eyebrow">레벨이 올랐어요</span><strong className="level-up-number"><small>레벨</small>{reward.after.level}</strong></div>
      : <div className="reward-level"><span>레벨 {reward.after.level}</span></div>}
    <XpBar growth={reward.after}/>
    <div className="reward-rows">
      <div className="list-row"><span>경험치</span><b>+{reward.xp}</b></div>
      <div className="list-row"><span className="inline-flex items-center gap-2"><i className="coin-dot" aria-hidden/>코인</span><b>+{reward.coins}</b></div>
    </div>
  </section>;
}
