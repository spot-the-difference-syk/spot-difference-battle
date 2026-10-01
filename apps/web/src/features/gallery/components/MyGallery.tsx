import type { DailyGoalView, GrowthView } from "@spot-battle/shared";
import { Lock } from "lucide-react";
import { usePuzzleCatalog } from "../../catalog/puzzle-catalog";
import { AppHeader, PaperScreen, type AppTab } from "./Gallery";
import { LevelAvatar, XpBar, titleName } from "./Growth";

export function DailyGoal({ goal }: { goal: DailyGoalView }) {
  return <div data-testid="daily-goal" className="daily-goal">
    <div className="min-w-0">
      <p className="eyebrow">오늘의 목표</p>
      <p className="daily-goal-label">{goal.label}</p>
      <p className="muted text-[12px] font-medium">{goal.done ? "달성했어요 · 내일 새 목표가 열려요" : `달성하면 경험치 ${goal.bonus.xp} · 코인 ${goal.bonus.coins}`}</p>
    </div>
    <div className="daily-goal-meter" aria-label={`${goal.progress} / ${goal.target}`}>
      <span>{goal.done ? "완료" : `${goal.progress} / ${goal.target}`}</span>
      <div className="xp-track"><i style={{ width: `${(goal.progress / goal.target) * 100}%` }}/></div>
    </div>
  </div>;
}

export function MyGallery({ nickname, growth, onTab }: { nickname: string; growth: GrowthView | null; onTab: (tab: AppTab) => void }) {
  const artworks = usePuzzleCatalog();
  const collected = new Set(growth?.collected ?? []);
  const collectedHere = artworks.filter((artwork) => collected.has(artwork.key)).length;
  const stats = growth?.stats;
  const winRate = stats && stats.matches ? Math.round((stats.wins / stats.matches) * 100) : 0;
  return <PaperScreen>
    <div className="has-tabbar">
      <AppHeader nickname={nickname} growth={growth} tab="ME" onTab={onTab}/>
      <section className="fade-up mx-auto mt-7 w-full max-w-3xl">
        {!growth ? <p className="muted">서버에 연결하면 내 정보를 볼 수 있어요.</p> : <>
          <div className="me-head">
            <LevelAvatar nickname={nickname} growth={growth} size={72}/>
            <div className="min-w-0">
              <h1 className="text-[24px] font-extrabold tracking-tight">{nickname}</h1>
              <p className="text-[13px] font-semibold text-[var(--gold)]">레벨 {growth.level} · {titleName(growth.loadout.title)}</p>
            </div>
          </div>
          <XpBar growth={growth}/>

          <div className="stat-grid">
            <div className="stat-card"><b>{stats!.matches}</b><span>대결</span></div>
            <div className="stat-card"><b>{stats!.wins}<small> 승</small></b><span>{stats!.draws}무 {stats!.losses}패</span></div>
            <div className="stat-card"><b>{winRate}<small>%</small></b><span>승률</span></div>
            <div className="stat-card"><b>{stats!.soloClears}</b><span>솔로 완주</span></div>
          </div>

          <div className="mt-4"><DailyGoal goal={growth.daily}/></div>

          <div className="mt-8 flex items-baseline justify-between">
            <h2 className="text-[17px] font-extrabold">내 갤러리</h2>
            <span data-testid="collection-count" className="muted text-[13px] font-semibold">{collectedHere} / {artworks.length}</span>
          </div>
          <p className="muted mt-1 text-[13px]">대결이나 솔로에서 끝까지 푼 그림이 모여요.</p>
          <div className="collection-grid">
            {artworks.map((artwork) => collected.has(artwork.key)
              ? <figure key={artwork.key} className="collection-item"><img src={artwork.originalSrc} alt={artwork.title} loading="lazy"/><figcaption>{artwork.title}</figcaption></figure>
              : <figure key={artwork.key} className="collection-item locked" aria-label="아직 수집하지 않은 그림"><span><Lock size={16}/></span><figcaption>{artwork.genre}</figcaption></figure>)}
          </div>
        </>}
      </section>
    </div>
  </PaperScreen>;
}
