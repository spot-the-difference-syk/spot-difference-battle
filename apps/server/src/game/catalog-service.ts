import type { MatchPuzzle } from "@spot-battle/game-core";
import { GAME_CONFIG, bundledPuzzleCards, puzzleObjectKey, type PuzzleCard } from "@spot-battle/shared";
import { GAME_PUZZLES } from "./puzzle-catalog.js";
import { BUNDLED_SOLO_ANSWERS, type SoloPuzzle } from "./solo-puzzles.js";

/** 대결·솔로 문제(정답 포함, 서버 전용)와 브라우저에 공개하는 카드 */
export interface LoadedCatalog {
  battle: MatchPuzzle[];
  solo: SoloPuzzle[];
  cards: PuzzleCard[];
}

export function codeCatalog(puzzles: readonly MatchPuzzle[] = GAME_PUZZLES, solo: readonly SoloPuzzle[] = BUNDLED_SOLO_ANSWERS): LoadedCatalog {
  const cards = bundledPuzzleCards();
  const battleIds = new Set(puzzles.map((puzzle) => puzzle.id));
  return {
    battle: structuredClone([...puzzles]) as MatchPuzzle[],
    solo: structuredClone([...solo]),
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
  /** 솔로 판 도중 카탈로그가 바뀌어도 그 판의 정답으로 판정할 수 있게 기억한다. */
  private readonly seenSolo = new Map<string, SoloPuzzle>();

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
    for (const puzzle of catalog.solo) this.seenSolo.set(`${puzzle.id}@${puzzle.version}`, puzzle);
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

  /** 대결 그림을 화풍별로 묶는다. 카드가 없는 그림은 화풍을 알 수 없으므로 "기타"로 둔다. */
  battleGenres(): Map<string, MatchPuzzle[]> {
    const genreOf = new Map(this.current.cards.filter((card) => card.mode === "battle").map((card) => [`${card.id}@${card.version}`, card.genre]));
    const groups = new Map<string, MatchPuzzle[]>();
    for (const puzzle of this.current.battle) {
      const genre = genreOf.get(`${puzzle.id}@${puzzle.assetVersion}`) ?? "기타";
      groups.set(genre, [...(groups.get(genre) ?? []), puzzle]);
    }
    return groups;
  }

  /**
   * 한 경기용 그림을 고른다. 매번 화풍 하나를 무작위로 정하고 그 화풍 그림만 섞어서 쓴다.
   * 그림이 너무 적은 화풍(minPuzzlesPerGenre 미만)은 고르지 않는다. 그런 화풍만 있으면 전체에서 섞는다.
   */
  pickDeck(random: () => number = Math.random): MatchPuzzle[] {
    const eligible = [...this.battleGenres().values()].filter((puzzles) => puzzles.length >= GAME_CONFIG.minPuzzlesPerGenre);
    const pool = eligible.length ? eligible[Math.floor(random() * eligible.length)]! : this.current.battle;
    return [...pool]
      .map((puzzle) => ({ puzzle, order: random() }))
      .sort((left, right) => left.order - right.order)
      .slice(0, GAME_CONFIG.puzzlesPerMatch)
      .map(({ puzzle }) => structuredClone(puzzle));
  }

  /** 지금 활성인 솔로 그림 */
  soloPuzzle(id: string): SoloPuzzle | undefined {
    return this.current.solo.find((puzzle) => puzzle.id === id);
  }

  /** 진행 중인 솔로 판의 정답(그 판을 시작한 버전) */
  soloAnswers(id: string, version: string): SoloPuzzle | undefined {
    return this.seenSolo.get(`${id}@${version}`);
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
