import { PROGRESSION_RULES, SOLO_RULES, type NormalizedPoint } from "@spot-battle/shared";
import { useEffect, useMemo, useState } from "react";
import { ImageBoard, type ImageSelectionContext } from "../../game/components/ImageBoard";
import { clampViewport, type ImageViewport } from "../../game/model/image-geometry";
import { LogOut } from "lucide-react";
import { RewardPanel } from "../../gallery/components/Growth";
import { AppHeader, BoardPair, PaperScreen, ProgressTrack, StageScreen, ZoomControls, type AppTab } from "../../gallery/components/Gallery";
import type { GameClient } from "../../game/hooks/use-game-client";
import { formatSoloTime } from "../model/solo-engine";
import { BUNDLED_VISUALS, preloadVisual, usePuzzleCatalog, type PuzzleVisual } from "../../catalog/puzzle-catalog";
import { RankingBoard } from "./RankingBoard";

type SoloPhase = "SELECT" | "RUN";

const PENALTY_SECONDS = SOLO_RULES.wrongPenaltyMs / 1_000;

export function SoloGame({ client, onTab }: { client: GameClient; onTab: (tab: AppTab) => void }) {
  const { nickname, growth, soloRun, soloLast } = client;
  const [phase, setPhase] = useState<SoloPhase>("SELECT");
  const catalog = usePuzzleCatalog();
  const soloPuzzles = useMemo(() => {
    const isSolo = (visual: PuzzleVisual) => visual.mode === "solo";
    const fromCatalog = catalog.filter(isSolo);
    // 카탈로그에 솔로 그림이 없으면 앱에 들어 있는 솔로 그림으로 진행한다.
    return fromCatalog.length ? fromCatalog : BUNDLED_VISUALS.filter(isSolo);
  }, [catalog]);
  const [selectedId, setPuzzleId] = useState<string>("observatory");
  const [preparing, setPreparing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const [viewport, setViewport] = useState<ImageViewport>({ scale: 1, pan: { x: 0, y: 0 } });
  const puzzle = soloPuzzles.find((candidate) => candidate.id === selectedId) ?? soloPuzzles[0]!;
  const puzzleId = puzzle.id;
  const finished = soloLast?.finished ?? null;
  const wrongAnswers = soloLast?.wrongCount ?? 0;
  const foundCount = soloLast?.foundCount ?? 0;
  const serverNow = client.serverNow();
  const running = phase === "RUN" && soloRun !== null && !finished;
  const countingDown = running && serverNow < soloRun.startsAtMs;
  const runningMs = soloRun ? Math.max(0, serverNow - soloRun.startsAtMs) + wrongAnswers * SOLO_RULES.wrongPenaltyMs : 0;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 50);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    setViewport({ scale: 1, pan: { x: 0, y: 0 } });
  }, [puzzleId]);

  // 순위가 바뀌었을 수 있으니 끝나면 순위표를 다시 받는다.
  useEffect(() => {
    if (finished) client.requestRanking(puzzleId, "week");
  }, [finished]);

  const start = async () => {
    client.leaveSolo();
    client.clearError();
    setPhase("RUN");
    setPreparing(true);
    setLoadError(null);
    try {
      // 그림을 다 불러온 뒤에 판을 연다. 서버는 그때부터 3초 뒤에 시간을 잰다.
      await preloadVisual(puzzle);
      client.startSolo(puzzleId);
    } catch {
      setLoadError("이미지를 불러오지 못했습니다. 다시 시도해주세요.");
      setPhase("SELECT");
    } finally {
      setPreparing(false);
    }
  };

  const selectPoint = (point: NormalizedPoint, context: ImageSelectionContext) => {
    if (!running || countingDown) return;
    client.guessSolo(point, { pointerType: context.pointerType, boardSizePx: Math.round(context.boardSizePx) });
  };

  const returnToSelection = () => {
    client.leaveSolo();
    setPhase("SELECT");
  };

  const panImages = (delta: NormalizedPoint) => {
    setViewport((current) => clampViewport({
      ...current,
      pan: { x: current.pan.x + delta.x, y: current.pan.y + delta.y },
    }));
  };

  if (phase === "SELECT") {
    const best = growth?.soloBests[puzzleId];
    return <PaperScreen ambientSrc={puzzle.originalSrc}>
      <div className="has-tabbar">
        <AppHeader nickname={nickname} growth={growth} tab="SOLO" onTab={onTab}/>
        <section className="fade-up mt-7">
          <p className="eyebrow">혼자 하기</p>
          <h1 className="display-title mt-1">솔로 타임어택</h1>
          <p className="muted mt-2 text-[15px]">힌트 없이 작은 차이 5개를 찾아요. 틀릴 때마다 기록에 {PENALTY_SECONDS}초가 더해지고, 기록은 랭킹에 올라가요.</p>
          <div className="solo-grid mt-6">
            {soloPuzzles.map((candidate) => {
              const record = growth?.soloBests[candidate.id];
              return <button key={candidate.id} type="button" aria-pressed={puzzleId === candidate.id} onClick={() => setPuzzleId(candidate.id)} className="solo-card">
                <span className="solo-card-image"><img src={candidate.originalSrc} alt=""/></span>
                <span className="solo-card-text"><strong>{candidate.title}</strong><small className={record ? "record" : ""}>{record ? `최고 ${formatSoloTime(record)}` : "최고 기록 없음"}</small></span>
              </button>;
            })}
          </div>
          {loadError && <p className="mt-5 text-center font-semibold text-[#c0392b]">{loadError}</p>}
          <div className="mt-7 flex justify-center"><button data-testid="solo-puzzle-start" type="button" disabled={!client.connected} onClick={() => void start()} className="btn-primary w-full sm:w-auto sm:min-w-72">{client.connected ? `${puzzle.title} 시작` : "서버 연결 중"}</button></div>
          <RankingBoard client={client} puzzleId={puzzleId} puzzleTitle={puzzle.title} myBestMs={best}/>
        </section>
      </div>
    </PaperScreen>;
  }

  if (finished) {
    return <PaperScreen ambientSrc={puzzle.originalSrc}>
      <AppHeader nickname={nickname} growth={growth}/>
      <section data-testid="solo-finished" className="center-card fade-up">
        <p className="eyebrow">{puzzle.title}</p>
        <h1 className="display-title mt-1">5개 모두 찾았어요!</h1>
        <p className="big-number mt-6" style={{ fontSize: "clamp(64px, 16vw, 104px)" }}>{formatSoloTime(finished.elapsedMs)}</p>
        <p className="muted mt-3 text-[14px]">오답 {wrongAnswers}회 · 페널티 {wrongAnswers * PENALTY_SECONDS}초 포함</p>
        <p className="mt-2 text-[14px] font-bold" style={{ color: finished.newPersonalBest ? "var(--gold)" : undefined }}>{finished.newPersonalBest ? "새 기록이에요 · " : ""}개인 최고기록 {formatSoloTime(finished.personalBestMs)}</p>
        {finished.weekRank !== null
          ? <div data-testid="solo-ranks" className="rank-result"><span><small>이번 주</small><b>{finished.weekRank}위</b></span><span><small>전체</small><b>{finished.allRank === null ? "순위 밖" : `${finished.allRank}위`}</b></span></div>
          : <p className="muted mt-3 text-[13px]">이 기록은 랭킹에 올라가지 않아요.</p>}
        <RewardPanel reward={client.soloResult?.reward} note={client.soloResult?.limitReached ? `오늘 솔로 보상을 모두 받았어요 · 하루 ${PROGRESSION_RULES.soloDailyLimit}번` : undefined}/>
        <div className="mt-8 grid gap-2">
          <button type="button" onClick={() => void start()} className="btn-primary w-full">다시 도전</button>
          <div className="grid grid-cols-2 gap-2"><button type="button" onClick={returnToSelection} className="btn-secondary">다른 문제</button><button type="button" onClick={() => { client.leaveSolo(); onTab("HOME"); }} className="btn-secondary">홈으로</button></div>
        </div>
        <RankingBoard client={client} puzzleId={puzzleId} puzzleTitle={puzzle.title} myBestMs={finished.personalBestMs} compact/>
      </section>
    </PaperScreen>;
  }

  if (!soloRun || countingDown) {
    const seconds = soloRun ? Math.max(1, Math.ceil((soloRun.startsAtMs - serverNow) / 1_000)) : null;
    const failed = !preparing && !soloRun && client.error;
    return <StageScreen ambientSrc={puzzle.originalSrc}>
      <section data-testid="solo-countdown" className="center-card">
        {failed ? null : seconds === null ? <div className="spinner-ring"/> : <div key={seconds} className="big-number tick">{seconds}</div>}
        <h1 className="mt-5 text-xl font-bold">{failed ? "시작하지 못했어요" : seconds === null ? "그림을 준비하고 있어요" : "집중하세요"}</h1>
        <p className="mt-1 text-sm text-white/55">{failed ? client.error!.message : puzzle.title}</p>
        {failed && <button type="button" onClick={returnToSelection} className="btn-secondary mt-6">돌아가기</button>}
      </section>
    </StageScreen>;
  }

  const feedback = soloLast
    ? soloLast.correct ? `정답 · ${soloLast.mark?.label ?? ""}` : `틀렸어요 · +${PENALTY_SECONDS}초`
    : null;
  return <StageScreen ambientSrc={puzzle.originalSrc} testId="solo-playing">
    <div className="play-hud">
      <span data-testid="solo-timer" className="play-timer">{formatSoloTime(runningMs)}</span>
      <div className="flex items-center gap-2"><span className="pill">발견 {foundCount}/{SOLO_RULES.differences}</span><span className={`pill ${wrongAnswers ? "bad" : ""}`}>오답 {wrongAnswers}</span><button type="button" aria-label="그만하기" className="icon-button" onClick={returnToSelection}><LogOut size={17}/></button></div>
      <ProgressTrack done={foundCount} total={SOLO_RULES.differences}/>
      <div className="play-title">
        <h2 className="truncate">{puzzle.title}</h2>
        <ZoomControls viewport={viewport} onChange={setViewport}/>
      </div>
    </div>
    <BoardPair
      frame={growth?.loadout.frame}
      original={<ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={viewport} onPanBy={panImages}/>}
      modified={<ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={client.soloMarks} markStyle={growth?.loadout.marker} viewport={viewport} onPanBy={panImages} onSelect={selectPoint}/>}
      overlay={feedback && <span key={`${foundCount}-${wrongAnswers}`} className={`board-toast fade-up ${soloLast?.correct ? "" : "bad"}`}>{feedback}</span>}
    />
    {!client.connected && <div className="top-toast">서버와 다시 연결하고 있어요</div>}
  </StageScreen>;
}
