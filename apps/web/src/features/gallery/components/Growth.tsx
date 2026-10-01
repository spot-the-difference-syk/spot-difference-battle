import { COSMETIC_ITEM_BY_ID, type GrowthView, type RewardSummary } from "@spot-battle/shared";

/** 프로필 그림. 파일 이름이 아이템 ID다(avatar-cat.svg → "avatar-cat"). */
const AVATAR_IMAGES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(import.meta.glob<string>("../../../assets/avatars/*.svg", { eager: true, query: "?url", import: "default" }))
    .map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".svg".length), url]),
);

export function avatarImage(avatarId: string | undefined): string | undefined {
  return avatarId ? AVATAR_IMAGES[avatarId] : undefined;
}

const RING_RADIUS = 22.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function levelRatio(growth: GrowthView): number {
  return growth.levelXpGoal ? Math.min(1, growth.levelXp / growth.levelXpGoal) : 0;
}

/** 프로필 사진 둘레가 다음 레벨까지 차오른다. */
export function titleName(titleId: string | undefined): string {
  return (titleId && COSMETIC_ITEM_BY_ID[titleId]?.name) || "";
}

export function LevelAvatar({ nickname, growth, size = 38, profile, avatar }: { nickname: string; growth: GrowthView | null; size?: number; profile?: string; avatar?: string }) {
  const filled = growth ? levelRatio(growth) * RING_LENGTH : 0;
  const image = avatarImage(avatar ?? growth?.loadout.avatar);
  return <span className={`level-avatar ${profile ?? growth?.loadout.profile ?? "profile-none"}`} style={{ width: size, height: size }}>
    <span className={`avatar ${image ? "has-image" : ""}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden>
      {image ? <img src={image} alt="" draggable={false}/> : nickname.slice(0, 1)}
    </span>
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
      {reward.dailyGoal && <div data-testid="daily-goal-reward" className="list-row"><span>오늘의 목표 달성 · {reward.dailyGoal.label}</span><b className="text-[var(--gold)]">코인 +{reward.dailyGoal.coins} 포함</b></div>}
      {reward.newlyCollected?.length ? <div className="list-row"><span>새로 수집한 그림</span><b>{reward.newlyCollected.length}점</b></div> : null}
    </div>
  </section>;
}
