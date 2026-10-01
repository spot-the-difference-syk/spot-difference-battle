import type { MatchPuzzle } from "@spot-battle/game-core";
import { GAME_CONFIG, bundledPuzzleCards, puzzleObjectKey, type PuzzleCard } from "@spot-battle/shared";
import { GAME_PUZZLES } from "./puzzle-catalog.js";

/** 대결 문제(정답 포함, 서버 전용)와 브라우저에 공개하는 카드 */
export interface LoadedCatalog {
  battle: MatchPuzzle[];
  cards: PuzzleCard[];
}

export function codeCatalog(puzzles: readonly MatchPuzzle[] = GAME_PUZZLES): LoadedCatalog {
  const cards = bundledPuzzleCards();
  const battleIds = new Set(puzzles.map((puzzle) => puzzle.id));
  return {
    battle: structuredClone([...puzzles]) as MatchPuzzle[],
    // 주입된 테스트 카탈로그에 없는 대결 그림은 공개 목록에서도 뺀다.
    cards: cards.filter((card) => card.mode === "solo" || battleIds.has(card.id)),
  };
}

const DEFAULT_REFRESH_MS = 5 * 60 * 1_000;

/**
 * 현재 활성 카탈로그를 들고 있다가 오래되면 다시 읽는다.
 * 새 그림을 DB에 등록·활성화하면 재배포 없이 몇 분 안에 반영된다.
 * 다시 읽기에 실패하면 직전 카탈로그를 그대로 쓴다.
 */
export class CatalogService {
  private current: LoadedCatalog;
  private loadedAt: number;
  private pending: Promise<void> | null = null;
  /** 경기 도중 카탈로그가 바뀌어도 진행 중인 그림 정보를 내려줄 수 있게 본 카드를 기억한다. */
  private readonly seenCards = new Map<string, PuzzleCard>();

  constructor(
    initial: LoadedCatalog,
    private readonly loader?: () => Promise<LoadedCatalog>,
    private readonly options: { refreshMs?: number; assetBaseUrl?: string; now?: () => number; onError?: (error: unknown) => void } = {},
  ) {
    this.current = initial;
    this.loadedAt = this.now();
    this.remember(initial);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private remember(catalog: LoadedCatalog): void {
    for (const card of catalog.cards) this.seenCards.set(`${card.id}@${card.version}`, card);
  }

  /** 오래된 카탈로그면 다시 읽은 뒤 돌려준다. */
  async fresh(): Promise<LoadedCatalog> {
    if (this.loader && this.now() - this.loadedAt >= (this.options.refreshMs ?? DEFAULT_REFRESH_MS)) {
      this.pending ??= this.loader()
        .then((next) => {
          this.current = next;
          this.remember(next);
        })
        .catch((error) => this.options.onError?.(error))
        .finally(() => {
          // 실패해도 매 요청마다 DB를 두드리지 않도록 시각은 갱신한다.
          this.loadedAt = this.now();
          this.pending = null;
        });
      await this.pending;
    }
    return this.current;
  }

  get catalog(): LoadedCatalog {
    return this.current;
  }

  get cards(): PuzzleCard[] {
    return this.current.cards;
  }

  /** 한 경기용 그림을 무작위로 고른다. */
  pickDeck(): MatchPuzzle[] {
    return [...this.current.battle]
      .map((puzzle) => ({ puzzle, order: Math.random() }))
      .sort((left, right) => left.order - right.order)
      .slice(0, GAME_CONFIG.puzzlesPerMatch)
      .map(({ puzzle }) => structuredClone(puzzle));
  }

  isSoloPuzzle(id: string): boolean {
    return this.current.cards.some((card) => card.mode === "solo" && card.id === id);
  }

  /** 경기 그림들의 공개 카드. 카탈로그에서 빠진 그림도 R2 주소 규칙으로 복원한다. */
  deckCards(puzzles: ReadonlyArray<{ id: string; assetVersion: string }>): PuzzleCard[] {
    const base = this.options.assetBaseUrl?.replace(/\/+$/, "");
    return puzzles.map(({ id, assetVersion }) => this.seenCards.get(`${id}@${assetVersion}`) ?? {
      id,
      version: assetVersion,
      mode: "battle",
      title: id,
      alt: id,
      genre: "실사",
      ...(base ? {
        originalUrl: `${base}/${puzzleObjectKey(id, assetVersion, "original")}`,
        modifiedUrl: `${base}/${puzzleObjectKey(id, assetVersion, "modified")}`,
      } : {}),
    });
  }
}
