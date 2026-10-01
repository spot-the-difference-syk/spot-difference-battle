import type { FoundMark, NormalizedPoint } from "@spot-battle/shared";
import { useEffect, useMemo, useState } from "react";
import {
  ImageBoard,
  type ImageSelectionContext,
} from "../../game/components/ImageBoard";
import { clampViewport, type ImageViewport } from "../../game/model/image-geometry";
import { AppHeader, BoardPair, PaperScreen, ProgressTrack, StageScreen, ZoomControls, type AppTab } from "../../gallery/components/Gallery";
import {
  SOLO_DIFFERENCE_COUNT,
  SOLO_WRONG_PENALTY_MS,
  bestSoloTime,
  findSoloDifference,
  formatSoloTime,
  minimumSoloHitRadius,
  soloElapsedMs,
} from "../model/solo-engine";
import {
  SOLO_PUZZLES,
  SOLO_PUZZLE_BY_ID,
  preloadSoloPuzzle,
  type SoloPuzzleId,
} from "../puzzles/catalog";

type SoloPhase = "SELECT" | "LOADING" | "COUNTDOWN" | "PLAYING" | "FINISHED";
type SoloRecords = Partial<Record<SoloPuzzleId, number>>;

const RECORD_KEY = "spot-battle:solo-records:v1";

function loadRecords(): SoloRecords {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECORD_KEY) ?? "{}") as SoloRecords;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveRecords(records: SoloRecords) {
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(records));
  } catch {
    // WebView storage가 제한돼도 현재 솔로 게임은 계속 진행한다.
  }
}

export function SoloGame({ nickname, onTab }: { nickname: string; onTab: (tab: AppTab) => void }) {
  const [phase, setPhase] = useState<SoloPhase>("SELECT");
  const [puzzleId, setPuzzleId] = useState<SoloPuzzleId>("observatory");
  const [records, setRecords] = useState<SoloRecords>(loadRecords);
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [wrongAnswers, setWrongAnswers] = useState(0);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [finishedMs, setFinishedMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [countdown, setCountdown] = useState(3);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ImageViewport>({ scale: 1, pan: { x: 0, y: 0 } });
  const puzzle = SOLO_PUZZLE_BY_ID[puzzleId];
  const foundSet = useMemo(() => new Set(foundIds), [foundIds]);
  const marks: FoundMark[] = foundIds.map((differenceId) => {
    const difference = puzzle.differences.find((candidate) => candidate.id === differenceId)!;
    return { differenceId, region: difference.region };
  });
  const runningMs = startedAtMs === null
    ? 0
    : soloElapsedMs(startedAtMs, nowMs, wrongAnswers);

  useEffect(() => {
    if (phase !== "PLAYING") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    setViewport({ scale: 1, pan: { x: 0, y: 0 } });
  }, [puzzleId]);

  const start = async () => {
    setPhase("LOADING");
    setLoadError(null);
    setFeedback(null);
    setFoundIds([]);
    setWrongAnswers(0);
    setFinishedMs(null);
    setStartedAtMs(null);
    try {
      await preloadSoloPuzzle(puzzleId);
      setCountdown(3);
      setPhase("COUNTDOWN");
      let remaining = 3;
      const timer = window.setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          window.clearInterval(timer);
          const started = Date.now();
          setStartedAtMs(started);
          setNowMs(started);
          setPhase("PLAYING");
        }
      }, 1_000);
    } catch {
      setLoadError("이미지를 불러오지 못했습니다. 다시 시도해주세요.");
      setPhase("SELECT");
    }
  };

  const selectPoint = (point: NormalizedPoint, context: ImageSelectionContext) => {
    if (phase !== "PLAYING" || startedAtMs === null) return;
    const found = findSoloDifference(
      puzzle.differences,
      foundSet,
      point,
      minimumSoloHitRadius(context.pointerType, context.boardSizePx),
    );
    if (!found) {
      setWrongAnswers((value) => value + 1);
      setFeedback(`틀렸어요 · +${SOLO_WRONG_PENALTY_MS / 1_000}초`);
      return;
    }

    const nextFoundIds = [...foundIds, found.id];
    setFoundIds(nextFoundIds);
    setFeedback(`정답 · ${found.label}`);
    if (nextFoundIds.length !== SOLO_DIFFERENCE_COUNT) return;

    const result = soloElapsedMs(startedAtMs, Date.now(), wrongAnswers);
    setFinishedMs(result);
    setNowMs(Date.now());
    setPhase("FINISHED");
    setRecords((current) => {
      const next = { ...current, [puzzleId]: bestSoloTime(current[puzzleId], result) };
      saveRecords(next);
      return next;
    });
  };

  const returnToSelection = () => {
    // 정답 ID는 현재 그림에만 유효하므로 다른 그림을 고르기 전에 비운다.
    setFoundIds([]);
    setFeedback(null);
    setPhase("SELECT");
  };

  const panImages = (delta: NormalizedPoint) => {
    setViewport((current) => clampViewport({
      ...current,
      pan: { x: current.pan.x + delta.x, y: current.pan.y + delta.y },
    }));
  };

  const best = records[puzzleId];

  if (phase === "SELECT") {
    return <PaperScreen ambientSrc={puzzle.originalSrc}>
      <div className="has-tabbar">
        <AppHeader nickname={nickname} tab="SOLO" onTab={onTab}/>
        <section className="fade-up mt-7">
          <p className="eyebrow">혼자 하기</p>
          <h1 className="display-title mt-1">솔로 타임어택</h1>
          <p className="muted mt-2 text-[15px]">힌트 없이 작은 차이 5개를 찾아요. 틀릴 때마다 기록에 3초가 더해져요.</p>
          <div className="solo-grid mt-6">
            {SOLO_PUZZLES.map((candidate) => {
              const record = records[candidate.id];
              return <button key={candidate.id} type="button" aria-pressed={puzzleId === candidate.id} onClick={() => setPuzzleId(candidate.id)} className="solo-card">
                <span className="solo-card-image"><img src={candidate.originalSrc} alt=""/></span>
                <span className="solo-card-text"><strong>{candidate.label}</strong><small className={record ? "record" : ""}>{record ? `최고 ${formatSoloTime(record)}` : "최고 기록 없음"}</small></span>
              </button>;
            })}
          </div>
          {loadError && <p className="mt-5 text-center font-semibold text-[#c0392b]">{loadError}</p>}
          <div className="mt-7 flex justify-center"><button data-testid="solo-puzzle-start" type="button" onClick={() => void start()} className="btn-primary w-full sm:w-auto sm:min-w-72">{puzzle.label} 시작</button></div>
        </section>
      </div>
    </PaperScreen>;
  }

  if (phase === "LOADING" || phase === "COUNTDOWN") {
    return <StageScreen ambientSrc={puzzle.originalSrc}>
      <section data-testid="solo-countdown" className="center-card">
        {phase === "LOADING" ? <div className="spinner-ring"/> : <div key={countdown} className="big-number tick">{countdown}</div>}
        <h1 className="mt-5 text-xl font-bold">{phase === "LOADING" ? "그림을 준비하고 있어요" : "집중하세요"}</h1>
        <p className="mt-1 text-sm text-white/55">{puzzle.label}</p>
      </section>
    </StageScreen>;
  }

  if (phase === "FINISHED" && finishedMs !== null) {
    const isBest = best === finishedMs;
    return <PaperScreen ambientSrc={puzzle.originalSrc}>
      <AppHeader nickname={nickname}/>
      <section data-testid="solo-finished" className="center-card fade-up">
        <p className="eyebrow">{puzzle.label}</p>
        <h1 className="display-title mt-1">5개 모두 찾았어요!</h1>
        <p className="big-number mt-6" style={{ fontSize: "clamp(64px, 16vw, 104px)" }}>{formatSoloTime(finishedMs)}</p>
        <p className="muted mt-3 text-[14px]">오답 {wrongAnswers}회 · 페널티 {wrongAnswers * SOLO_WRONG_PENALTY_MS / 1_000}초 포함</p>
        <p className="mt-2 text-[14px] font-bold" style={{ color: isBest ? "var(--gold)" : undefined }}>{isBest ? "새 기록이에요 · " : ""}개인 최고기록 {formatSoloTime(best ?? finishedMs)}</p>
        <div className="mt-8 grid gap-2">
          <button type="button" onClick={() => void start()} className="btn-primary w-full">다시 도전</button>
          <div className="grid grid-cols-2 gap-2"><button type="button" onClick={returnToSelection} className="btn-secondary">다른 문제</button><button type="button" onClick={() => onTab("HOME")} className="btn-secondary">홈으로</button></div>
        </div>
      </section>
    </PaperScreen>;
  }

  return <StageScreen ambientSrc={puzzle.originalSrc} testId="solo-playing">
    <div className="play-hud">
      <span data-testid="solo-timer" className="play-timer">{formatSoloTime(runningMs)}</span>
      <div className="flex items-center gap-2"><span className="pill">발견 {foundIds.length}/{SOLO_DIFFERENCE_COUNT}</span><span className={`pill ${wrongAnswers ? "bad" : ""}`}>오답 {wrongAnswers}</span></div>
      <ProgressTrack done={foundIds.length} total={SOLO_DIFFERENCE_COUNT}/>
      <div className="play-title">
        <h2 className="truncate">{puzzle.label}</h2>
        <ZoomControls viewport={viewport} onChange={setViewport}/>
      </div>
    </div>
    <BoardPair
      original={<ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={viewport} onPanBy={panImages}/>}
      modified={<ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={marks} viewport={viewport} onPanBy={panImages} onSelect={selectPoint}/>}
      overlay={feedback && <span key={`${foundIds.length}-${wrongAnswers}`} className={`board-toast fade-up ${feedback.startsWith("정답") ? "" : "bad"}`}>{feedback}</span>}
    />
  </StageScreen>;
}
