import type { GrowthView } from "@spot-battle/shared";
import { House, Minus, Plus, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { clampViewport, type ImageViewport } from "../../game/model/image-geometry";
import { CoinChip, ProfileBadge } from "./Growth";

export type AppTab = "HOME" | "SOLO";

export const RESET_VIEWPORT: ImageViewport = { scale: 1, pan: { x: 0, y: 0 } };

/** 밝은 전시장 화면. 로비·대기·결과 화면에서 쓴다. */
export function PaperScreen({ children, ambientSrc }: { children: ReactNode; ambientSrc?: string | null }) {
  return <main className="paper-screen min-h-screen">
    {ambientSrc && <Ambient src={ambientSrc} tone="light"/>}
    <div className="paper-inner">{children}</div>
  </main>;
}

/** 어두운 관람 화면. 게임 중에는 그림 색으로 배경이 물든다. */
export function StageScreen({ children, ambientSrc, testId, puzzleId }: { children: ReactNode; ambientSrc?: string | null; testId?: string; puzzleId?: string }) {
  return <main className="stage-screen min-h-screen" data-testid={testId} data-puzzle-id={puzzleId}>
    {ambientSrc && <Ambient src={ambientSrc} tone="dark"/>}
    <div className="stage-inner">{children}</div>
  </main>;
}

function Ambient({ src, tone }: { src: string; tone: "light" | "dark" }) {
  return <div aria-hidden className={`ambient ambient-${tone}`}>
    <div className="ambient-image" style={{ backgroundImage: `url("${src}")` }}/>
    <div className="ambient-veil"/>
  </div>;
}

export function AppHeader({ nickname, growth = null, tab, onTab, trailing }: { nickname?: string; growth?: GrowthView | null; tab?: AppTab; onTab?: (tab: AppTab) => void; trailing?: ReactNode }) {
  return <header className="app-header">
    <span className="brand">틀린그림 갤러리</span>
    {tab && onTab && <nav className="app-nav" aria-label="메뉴">
      <button type="button" aria-current={tab === "HOME" ? "page" : undefined} onClick={() => onTab("HOME")}><House size={20} strokeWidth={1.8}/>홈</button>
      <button type="button" data-testid="solo-mode-open" aria-current={tab === "SOLO" ? "page" : undefined} onClick={() => onTab("SOLO")}><Timer size={20} strokeWidth={1.8}/>혼자 하기</button>
    </nav>}
    <div className="header-trailing">
      {trailing}
      {nickname && growth && <CoinChip coins={growth.coins}/>}
      {nickname && <ProfileBadge nickname={nickname} growth={growth}/>}
    </div>
  </header>;
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(([option, text]) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{text}</button>)}
  </div>;
}

export function ZoomControls({ viewport, onChange }: { viewport: ImageViewport; onChange: (viewport: ImageViewport) => void }) {
  const zoom = (delta: number) => onChange(clampViewport({ ...viewport, scale: viewport.scale + delta }));
  return <div className="zoom-controls" data-testid="zoom-controls">
    <button type="button" aria-label="축소" disabled={viewport.scale <= 1} onClick={() => zoom(-0.5)}><Minus size={16}/></button>
    <button type="button" aria-label="원래 크기" className="zoom-value" onClick={() => onChange(RESET_VIEWPORT)}>{viewport.scale.toFixed(1)}배</button>
    <button type="button" aria-label="확대" disabled={viewport.scale >= 3} onClick={() => zoom(0.5)}><Plus size={16}/></button>
  </div>;
}

/** 원본과 수정본을 항상 같은 크기로 놓는다. 세로 화면은 위아래, 넓은 화면은 좌우. */
export function BoardPair({ original, modified, modifiedTag = "여기서 찾기", overlay }: { original: ReactNode; modified: ReactNode; modifiedTag?: ReactNode; overlay?: ReactNode }) {
  return <div className="board-pair">
    <figure className="board-slot"><figcaption className="board-tag">원본</figcaption>{original}</figure>
    <figure className="board-slot"><figcaption className="board-tag">{modifiedTag}</figcaption>{modified}{overlay}</figure>
  </div>;
}

export function FoundDots({ found, total }: { found: number; total: number }) {
  return <span className="found-dots" aria-hidden>{Array.from({ length: total }, (_, index) => <i key={index} className={index < found ? "on" : ""}/>)}</span>;
}

export function ProgressTrack({ done, total, partial = 0 }: { done: number; total: number; partial?: number }) {
  return <div className="progress-track" aria-hidden>{Array.from({ length: total }, (_, index) => <i key={index} style={{ ["--fill" as string]: index < done ? "100%" : index === done ? `${Math.round(partial * 100)}%` : "0%" }}/>)}</div>;
}
