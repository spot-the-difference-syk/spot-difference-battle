import type { FoundMark, NormalizedPoint } from "@spot-battle/shared";
import { ArrowLeft, Clock3, Minus, Move, Plus, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ImageBoard,
  type ImageSelectionContext,
} from "../../game/components/ImageBoard";
import { clampViewport, type ImageViewport } from "../../game/model/image-geometry";
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

export function SoloGame({ onExit }: { onExit: () => void }) {
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
      setFeedback(`오답 · +${SOLO_WRONG_PENALTY_MS / 1_000}초`);
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

  if (phase === "SELECT") {
    return <main className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-amber-50 p-4 text-slate-900 sm:p-7">
      <header className="mx-auto mb-6 flex max-w-6xl items-center justify-between rounded-2xl bg-white/90 px-5 py-4 shadow-sm">
        <button type="button" onClick={onExit} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-bold"><ArrowLeft size={18}/>경쟁전 로비</button>
        <div className="text-right"><h1 className="font-black text-cyan-700">혼자 찾기 · 하드</h1><p className="text-xs text-slate-500">5개를 가장 빠르게 찾으세요</p></div>
      </header>
      <section className="mx-auto max-w-6xl rounded-3xl bg-slate-900 p-6 text-white shadow-xl sm:p-9">
        <div className="text-center"><div className="text-6xl">⏱️</div><h2 className="mt-3 text-3xl font-black">솔로 타임어택</h2><p className="mt-2 text-slate-300">힌트 없이 정밀한 차이 5개를 찾습니다. 오답마다 3초가 기록에 추가됩니다.</p></div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SOLO_PUZZLES.map((candidate) => <button key={candidate.id} type="button" onClick={() => setPuzzleId(candidate.id)} className={`overflow-hidden rounded-2xl border-4 text-left transition ${puzzleId === candidate.id ? "border-cyan-400 bg-cyan-950" : "border-transparent bg-white/10"}`}>
            <img src={candidate.originalSrc} alt="" className="aspect-square w-full object-cover"/>
            <span className="block p-3"><strong className="block">{candidate.label}</strong><small className="text-slate-300">최고 {records[candidate.id] ? formatSoloTime(records[candidate.id]!) : "기록 없음"}</small></span>
          </button>)}
        </div>
        {loadError && <p className="mt-5 text-center font-bold text-red-300">{loadError}</p>}
        <div className="mt-7 text-center"><button data-testid="solo-puzzle-start" type="button" onClick={() => void start()} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-8 py-4 font-black text-slate-950"><Clock3 size={20}/>{puzzle.label} 시작</button></div>
      </section>
    </main>;
  }

  if (phase === "LOADING" || phase === "COUNTDOWN") {
    return <main className="min-h-screen grid place-items-center bg-slate-950 p-4 text-white">
      <section data-testid="solo-countdown" className="text-center"><div className="text-8xl font-black text-cyan-300">{phase === "LOADING" ? "…" : countdown}</div><h2 className="mt-4 text-2xl font-black">{phase === "LOADING" ? "이미지 준비 중" : "집중하세요!"}</h2></section>
    </main>;
  }

  return <main className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-amber-50 p-4 text-slate-900 sm:p-7">
    <header className="mx-auto mb-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 shadow-sm">
      <div><span className="font-black text-cyan-700">{puzzle.label}</span><span className="ml-3 text-sm font-bold">발견 {foundIds.length}/{SOLO_DIFFERENCE_COUNT}</span></div>
      <div className="flex items-center gap-2"><span data-testid="solo-timer" className="rounded-full bg-slate-900 px-4 py-2 font-black text-white"><Clock3 className="mr-2 inline" size={17}/>{formatSoloTime(finishedMs ?? runningMs)}</span><span className="rounded-full bg-red-100 px-3 py-2 text-sm font-black text-red-700">오답 {wrongAnswers}</span></div>
    </header>
    {phase === "PLAYING" && <section data-testid="solo-playing" className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="font-bold text-slate-600">변경본에서 아주 작은 차이 5개를 찾으세요.</p><div className="flex items-center gap-2"><Move size={16}/><button type="button" aria-label="축소" disabled={viewport.scale <= 1} onClick={() => setViewport((current) => clampViewport({ ...current, scale: current.scale - 0.5 }))} className="rounded-xl bg-white p-2 shadow disabled:opacity-35"><Minus size={18}/></button><strong>{viewport.scale.toFixed(1)}배</strong><button type="button" aria-label="확대" disabled={viewport.scale >= 3} onClick={() => setViewport((current) => clampViewport({ ...current, scale: current.scale + 0.5 }))} className="rounded-xl bg-white p-2 shadow disabled:opacity-35"><Plus size={18}/></button></div></div>
      <div className="grid gap-5 lg:grid-cols-2"><div><p className="mb-2 text-center font-black">원본</p><ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={viewport} onPanBy={panImages}/></div><div><p className="mb-2 text-center font-black">변경본 · 여기를 선택</p><ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={marks} viewport={viewport} onPanBy={panImages} onSelect={selectPoint}/></div></div>
      {feedback && <p className={`mx-auto mt-4 w-fit rounded-xl px-5 py-3 font-black ${feedback.startsWith("정답") ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{feedback}</p>}
    </section>}
    {phase === "FINISHED" && finishedMs !== null && <section data-testid="solo-finished" className="mx-auto max-w-xl rounded-3xl bg-white p-9 text-center shadow-xl"><Trophy className="mx-auto text-amber-500" size={64}/><h2 className="mt-4 text-3xl font-black">5개 모두 찾았습니다!</h2><p className="mt-4 text-5xl font-black text-cyan-700">{formatSoloTime(finishedMs)}</p><p className="mt-3 text-slate-500">오답 {wrongAnswers}회 · 페널티 {wrongAnswers * SOLO_WRONG_PENALTY_MS / 1_000}초 포함</p><p className="mt-2 font-black">개인 최고기록 {formatSoloTime(records[puzzleId] ?? finishedMs)}</p><div className="mt-7 flex flex-wrap justify-center gap-3"><button type="button" onClick={() => void start()} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-6 py-3 font-black text-white"><RotateCcw size={18}/>다시 도전</button><button type="button" onClick={returnToSelection} className="rounded-2xl bg-slate-100 px-6 py-3 font-black">다른 문제</button><button type="button" onClick={onExit} className="rounded-2xl bg-slate-900 px-6 py-3 font-black text-white">경쟁전 로비</button></div></section>}
  </main>;
}
