import {
  COSMETIC_ITEMS,
  COSMETIC_ITEM_BY_ID,
  type CosmeticItem,
  type CosmeticSlot,
  type GameErrorPayload,
  type GrowthView,
} from "@spot-battle/shared";
import { Lock } from "lucide-react";
import { useState } from "react";
import { SOLO_PUZZLE_BY_ID } from "../../solo/puzzles/catalog";
import { AppHeader, PaperScreen, Segmented, type AppTab } from "./Gallery";
import { LevelAvatar, titleName } from "./Growth";

const SLOT_OPTIONS = [["marker", "정답 표시"], ["frame", "액자"], ["avatar", "프로필 그림"], ["profile", "테두리"], ["title", "칭호"]] as const;
const PREVIEW = SOLO_PUZZLE_BY_ID.bakery;
const PREVIEW_MARK = PREVIEW.differences[0]!.region;

type ItemState = "EQUIPPED" | "OWNED" | "LOCKED" | "BUYABLE" | "TOO_EXPENSIVE";

function itemState(entry: CosmeticItem, growth: GrowthView): ItemState {
  if (growth.loadout[entry.slot] === entry.id) return "EQUIPPED";
  if (growth.ownedItemIds.includes(entry.id)) return "OWNED";
  if (growth.level < entry.minLevel) return "LOCKED";
  return growth.coins >= entry.price ? "BUYABLE" : "TOO_EXPENSIVE";
}

function statusText(entry: CosmeticItem, state: ItemState): string {
  if (state === "EQUIPPED") return "사용 중";
  if (state === "OWNED") return "보유";
  if (state === "LOCKED") return `레벨 ${entry.minLevel}`;
  return `${entry.price.toLocaleString("ko-KR")}코인`;
}

function Swatch({ entry, nickname, locked }: { entry: CosmeticItem; nickname: string; locked: boolean }) {
  const light = entry.slot === "avatar" || entry.slot === "profile" || entry.slot === "title";
  return <span className={`item-swatch ${light ? "light" : ""} ${locked ? "locked" : ""}`} aria-hidden>
    {entry.slot === "marker" && <span className={`found-mark ${entry.id}`}/>}
    {entry.slot === "frame" && <span className={`mini-frame ${entry.id}`}><img src={PREVIEW.originalSrc} alt=""/></span>}
    {entry.slot === "avatar" && <LevelAvatar nickname={nickname} growth={null} size={52} avatar={entry.id}/>}
    {entry.slot === "profile" && <LevelAvatar nickname={nickname} growth={null} size={44} profile={entry.id}/>}
    {entry.slot === "title" && <span className="title-chip">{entry.name}</span>}
    {locked && <Lock size={14} className="absolute right-2 top-2 text-[var(--mute)]" style={{ opacity: 1 }}/>}
  </span>;
}

export function Wardrobe({ nickname, growth, error, onTab, onBuy, onEquip }: {
  nickname: string;
  growth: GrowthView | null;
  error: GameErrorPayload | null;
  onTab: (tab: AppTab) => void;
  onBuy: (itemId: string) => void;
  onEquip: (itemId: string) => void;
}) {
  const [slot, setSlot] = useState<CosmeticSlot>("marker");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = COSMETIC_ITEMS.filter((entry) => entry.slot === slot);
  const current = COSMETIC_ITEM_BY_ID[selectedId ?? growth?.loadout[slot] ?? ""];
  const visibleSelected = current?.slot === slot ? current : items[0]!;
  // Preview the selected item on top of what is already equipped.
  const preview = growth ? { ...growth.loadout, [visibleSelected.slot]: visibleSelected.id } : null;
  const state = growth ? itemState(visibleSelected, growth) : "LOCKED";

  return <PaperScreen ambientSrc={PREVIEW.originalSrc}>
    <div className="has-tabbar">
      <AppHeader nickname={nickname} growth={growth} tab="STYLE" onTab={onTab}/>
      <section className="fade-up mx-auto mt-7 w-full max-w-3xl">
        <p className="eyebrow">꾸미기</p>
        <h1 className="display-title mt-1">나만의 전시 스타일</h1>
        {!growth ? <p className="muted mt-6">서버에 연결하면 꾸미기를 할 수 있어요.</p> : <>
          <div className="wardrobe-preview">
            <div className={`preview-board ${preview!.frame}`}>
              <img src={PREVIEW.modifiedSrc} alt="꾸미기 미리보기"/>
              <span className={`found-mark ${preview!.marker}`} style={{ left: `${PREVIEW_MARK.x * 100}%`, top: `${PREVIEW_MARK.y * 100}%`, width: `${PREVIEW_MARK.radius * 260}%`, translate: "-50% -50%" }}/>
            </div>
            <div className="preview-profile">
              <LevelAvatar nickname={nickname} growth={{ ...growth, loadout: preview! }} size={56}/>
              <strong>{nickname}</strong>
              <span>{titleName(preview!.title)}</span>
            </div>
          </div>

          <div className="mt-6"><Segmented label="꾸미기 종류" value={slot} options={SLOT_OPTIONS} onChange={(next) => { setSlot(next); setSelectedId(null); }}/></div>

          <div className="item-grid" role="group" aria-label="아이템">
            {items.map((entry) => {
              const entryState = itemState(entry, growth);
              return <button key={entry.id} type="button" className="item-card" aria-pressed={visibleSelected.id === entry.id} onClick={() => setSelectedId(entry.id)}>
                <Swatch entry={entry} nickname={nickname} locked={entryState === "LOCKED"}/>
                <span className="item-name">{entry.name}</span>
                <span className={`item-status ${entryState === "EQUIPPED" ? "equipped" : ""}`}>{entryState !== "EQUIPPED" && entryState !== "OWNED" && entryState !== "LOCKED" && <i className="coin-dot" style={{ width: 10, height: 10 }}/>}{statusText(entry, entryState)}</span>
              </button>;
            })}
          </div>

          <div className="wardrobe-action">
            <p className="muted text-center text-[13px]">{visibleSelected.name} · {visibleSelected.description}</p>
            {error && <p role="alert" className="text-center text-[13px] font-semibold text-[#c0392b]">{error.message}</p>}
            {state === "EQUIPPED" && <button type="button" className="btn-primary" disabled>사용 중이에요</button>}
            {state === "OWNED" && <button data-testid="item-equip" type="button" className="btn-primary" onClick={() => onEquip(visibleSelected.id)}>사용하기</button>}
            {state === "BUYABLE" && <button data-testid="item-buy" type="button" className="btn-primary" onClick={() => onBuy(visibleSelected.id)}>{visibleSelected.price.toLocaleString("ko-KR")}코인으로 구매하고 사용하기</button>}
            {state === "TOO_EXPENSIVE" && <button type="button" className="btn-primary" disabled>코인이 {(visibleSelected.price - growth.coins).toLocaleString("ko-KR")}개 부족해요</button>}
            {state === "LOCKED" && <button type="button" className="btn-primary" disabled>레벨 {visibleSelected.minLevel}부터 쓸 수 있어요</button>}
          </div>
        </>}
      </section>
    </div>
  </PaperScreen>;
}
