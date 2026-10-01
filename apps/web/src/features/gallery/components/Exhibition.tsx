import { useMemo, useState } from "react";
import { GAME_PUZZLE_VISUALS } from "../../game/puzzles/catalog";
import { SOLO_PUZZLES } from "../../solo/puzzles/catalog";
import { ART_GENRES, GAME_PUZZLE_GENRES, SOLO_PUZZLE_GENRES, type ArtGenre } from "../genres";

export interface Artwork {
  key: string;
  label: string;
  src: string;
  genre: ArtGenre;
}

export const ARTWORKS: readonly Artwork[] = [
  ...Object.values(GAME_PUZZLE_VISUALS).map((puzzle) => ({
    key: `game:${puzzle.id}`,
    label: puzzle.label,
    src: puzzle.originalSrc,
    genre: GAME_PUZZLE_GENRES[puzzle.id],
  })),
  ...SOLO_PUZZLES.map((puzzle) => ({
    key: `solo:${puzzle.id}`,
    label: puzzle.label,
    src: puzzle.originalSrc,
    genre: SOLO_PUZZLE_GENRES[puzzle.id],
  })),
];

/** 날짜마다 바뀌는 오늘의 대표작 */
export function featuredArtwork(now = new Date()): Artwork {
  const day = Math.floor(now.getTime() / 86_400_000);
  return ARTWORKS[day % ARTWORKS.length]!;
}

export function FeaturedArtwork({ artwork }: { artwork: Artwork }) {
  return <div className="featured">
    <img src={artwork.src} alt="" />
    <div className="glass featured-caption"><strong>{artwork.label}</strong><span>{artwork.genre} · 오늘의 대표작</span></div>
  </div>;
}

export function ArtworkShelf() {
  const [genre, setGenre] = useState<ArtGenre | "전체">("전체");
  const genres = useMemo(() => ART_GENRES.filter((candidate) => ARTWORKS.some((artwork) => artwork.genre === candidate)), []);
  const visible = genre === "전체" ? ARTWORKS : ARTWORKS.filter((artwork) => artwork.genre === genre);
  return <section className="panel">
    <div className="shelf-head"><h3 className="section-title">전시 중인 그림</h3><span className="muted text-[13px] font-semibold">{ARTWORKS.length}점</span></div>
    <div className="genre-tabs" role="group" aria-label="화풍">
      {(["전체", ...genres] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={genre === candidate} onClick={() => setGenre(candidate)}>{candidate}</button>)}
    </div>
    <div className="thumb-grid">
      {visible.map((artwork) => <div key={artwork.key} className="thumb" title={`${artwork.label} · ${artwork.genre}`}><img src={artwork.src} alt="" loading="lazy"/></div>)}
    </div>
  </section>;
}
