import {
  bundledPuzzleCards,
  collectionKey,
  type ArtGenre,
  type CatalogPayload,
  type PuzzleCard,
  type PuzzleMode,
  type SoloAnswer,
} from "@spot-battle/shared";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { gameServerUrl } from "../../config/endpoints";
import { GAME_PUZZLE_VISUALS } from "../game/puzzles/catalog";
import { SOLO_PUZZLES } from "../solo/puzzles/catalog";

/** 화면에서 쓰는 퍼즐: 공개 카드 + 실제 이미지 주소 */
export interface PuzzleVisual {
  id: string;
  version: string;
  mode: PuzzleMode;
  title: string;
  alt: string;
  genre: ArtGenre;
  /** 수집 키 "game:<id>" / "solo:<id>" */
  key: string;
  originalSrc: string;
  modifiedSrc: string;
  answers?: readonly SoloAnswer[];
}

/** 앱 번들에 들어 있는 이미지. 서버가 URL을 주지 않으면 여기서 찾는다. */
const BUNDLED_IMAGES = new Map<string, { originalSrc: string; modifiedSrc: string }>([
  ...Object.values(GAME_PUZZLE_VISUALS).map((visual) => [`game:${visual.id}`, visual] as const),
  ...SOLO_PUZZLES.map((puzzle) => [`solo:${puzzle.id}`, puzzle] as const),
]);

export function toVisual(card: PuzzleCard): PuzzleVisual | null {
  const key = collectionKey(card);
  const bundled = BUNDLED_IMAGES.get(key);
  const originalSrc = card.originalUrl ?? bundled?.originalSrc;
  const modifiedSrc = card.modifiedUrl ?? bundled?.modifiedSrc;
  if (!originalSrc || !modifiedSrc) return null;
  if (card.mode === "solo" && !card.answers?.length) return null;
  return {
    id: card.id,
    version: card.version,
    mode: card.mode,
    title: card.title,
    alt: card.alt,
    genre: card.genre,
    key,
    originalSrc,
    modifiedSrc,
    ...(card.answers ? { answers: card.answers } : {}),
  };
}

export function toVisuals(cards: readonly PuzzleCard[]): PuzzleVisual[] {
  return cards.map(toVisual).filter((visual): visual is PuzzleVisual => visual !== null);
}

/** 서버에 닿지 못해도 번들 그림으로 게임을 할 수 있게 하는 기본 목록 */
export const BUNDLED_VISUALS: readonly PuzzleVisual[] = toVisuals(bundledPuzzleCards());

const preloadCache = new Map<string, Promise<void>>();

function preloadImage(src: string): Promise<void> {
  const cached = preloadCache.get(src);
  if (cached) return cached;
  const loading = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("이미지를 불러오지 못했어요."));
    image.src = src;
  }).catch((error: unknown) => {
    preloadCache.delete(src);
    throw error;
  });
  preloadCache.set(src, loading);
  return loading;
}

export function preloadVisual(visual: Pick<PuzzleVisual, "originalSrc" | "modifiedSrc">): Promise<void> {
  return Promise.all([preloadImage(visual.originalSrc), preloadImage(visual.modifiedSrc)]).then(() => undefined);
}

export async function fetchCatalog(serverUrl = gameServerUrl(), fetcher: typeof fetch = fetch): Promise<PuzzleVisual[]> {
  const response = await fetcher(new URL("/catalog", serverUrl).toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  const payload = await response.json() as CatalogPayload;
  if (!payload || !Array.isArray(payload.puzzles)) throw new Error("catalog format");
  const visuals = toVisuals(payload.puzzles);
  if (!visuals.some((visual) => visual.mode === "battle")) throw new Error("catalog empty");
  return visuals;
}

const CatalogContext = createContext<readonly PuzzleVisual[]>(BUNDLED_VISUALS);

const REFRESH_MS = 10 * 60 * 1_000;

/** 서버의 활성 카탈로그를 읽고, 실패하면 번들 목록을 계속 쓴다. */
export function PuzzleCatalogProvider({ children }: { children: ReactNode }) {
  const [visuals, setVisuals] = useState<readonly PuzzleVisual[]>(BUNDLED_VISUALS);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetchCatalog()
      .then((next) => { if (!cancelled) setVisuals(next); })
      .catch(() => { /* 번들 목록으로 계속 진행한다. */ });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return <CatalogContext.Provider value={visuals}>{children}</CatalogContext.Provider>;
}

export function usePuzzleCatalog(): readonly PuzzleVisual[] {
  return useContext(CatalogContext);
}

/** 날짜마다 바뀌는 오늘의 대표작 */
export function featuredVisual(visuals: readonly PuzzleVisual[], now = new Date()): PuzzleVisual {
  const list = visuals.length ? visuals : BUNDLED_VISUALS;
  const day = Math.floor(now.getTime() / 86_400_000);
  return list[day % list.length]!;
}
