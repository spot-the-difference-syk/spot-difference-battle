import { ART_GENRES, type ArtGenre } from "@spot-battle/shared";
import { useMemo, useState } from "react";
import { usePuzzleCatalog, type PuzzleVisual } from "../../catalog/puzzle-catalog";

export function FeaturedArtwork({ artwork }: { artwork: PuzzleVisual }) {
  return <div className="featured">
    <img src={artwork.originalSrc} alt="" />
    <div className="glass featured-caption"><strong>{artwork.title}</strong><span>{artwork.genre} · 오늘의 대표작</span></div>
  </div>;
}

export function ArtworkShelf() {
  const artworks = usePuzzleCatalog();
  const [genre, setGenre] = useState<ArtGenre | "전체">("전체");
  const genres = useMemo(() => ART_GENRES.filter((candidate) => artworks.some((artwork) => artwork.genre === candidate)), [artworks]);
  const visible = genre === "전체" ? artworks : artworks.filter((artwork) => artwork.genre === genre);
  return <section className="panel">
    <div className="shelf-head"><h3 className="section-title">전시 중인 그림</h3><span className="muted text-[13px] font-semibold">{artworks.length}점</span></div>
    <div className="genre-tabs" role="group" aria-label="화풍">
      {(["전체", ...genres] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={genre === candidate} onClick={() => setGenre(candidate)}>{candidate}</button>)}
    </div>
    <div className="thumb-grid">
      {visible.map((artwork) => <div key={artwork.key} className="thumb" title={`${artwork.title} · ${artwork.genre}`}><img src={artwork.originalSrc} alt="" loading="lazy"/></div>)}
    </div>
  </section>;
}
