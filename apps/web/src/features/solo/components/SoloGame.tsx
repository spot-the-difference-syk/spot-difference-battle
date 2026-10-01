import type { FoundMark, NormalizedPoint } from "@spot-battle/shared";
import { ArrowLeft, Check, Clock3, Crown, Eye, LoaderCircle, Minus, MousePointerClick, Move, Plus, Play, RotateCcw, Timer, Trophy } from "lucide-react";
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
    return <main className="arena arena-solo min-h-screen">
      <header className="glass mx-auto mb-6 flex max-w-6xl items-center justify-between gap-3 rounded-2xl px-4 py-3 sm:px-5">
        <button type="button" onClick={onExit} className="btn btn-ghost rounded-xl px-4 py-2 text-sm"><ArrowLeft size={18}/>경쟁전 로비</button>
        <div className="text-right"><h1 className="text-base font-black tracking-tight text-cyan-200">혼자 찾기 · 하드</h1><p className="text-xs text-white/50">5개를 가장 빠르게 찾으세요</p></div>
      </header>
      <section className="glass-strong pop-in mx-auto max-w-6xl p-5 sm:p-9">
        <div className="text-center">
          <div className="icon-tile icon-tile-cyan mx-auto size-16"><Timer size={32}/></div>
          <p className="eyebrow mt-5">Solo Time Attack</p>
          <h2 className="mt-1 bg-gradient-to-r from-white via-cyan-100 to-sky-200 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">솔로 타임어택</h2>
          <p className="mt-2 text-white/60">힌트 없이 정밀한 차이 5개를 찾습니다. 오답마다 3초가 기록에 추가됩니다.</p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {SOLO_PUZZLES.map((candidate) => {
            const selected = puzzleId === candidate.id;
            const record = records[candidate.id];
            return <button key={candidate.id} type="button" aria-pressed={selected} onClick={() => setPuzzleId(candidate.id)} className={`group relative overflow-hidden rounded-2xl border text-left transition duration-200 ${selected ? "border-cyan-300/80 shadow-[0_0_0_1px_rgb(103_232_249/0.6),0_16px_40px_-12px_rgb(34_211_238/0.7)]" : "border-white/10 hover:border-white/30"}`}>
              <span className="relative block aspect-square overflow-hidden">
                <img src={candidate.originalSrc} alt="" className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${selected ? "" : "opacity-80"}`}/>
                <span className="absolute inset-0 bg-gradient-to-t from-[#08081a] via-[#08081a]/20 to-transparent"/>
                {selected && <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-cyan-400 text-slate-950"><Check size={16} strokeWidth={3}/></span>}
              </span>
              <span className="absolute inset-x-0 bottom-0 block p-3"><strong className="block text-sm sm:text-base">{candidate.label}</strong><small className={`text-xs ${record ? "font-bold text-amber-300" : "text-white/50"}`}>최고 {record ? formatSoloTime(record) : "기록 없음"}</small></span>
            </button>;
          })}
        </div>
        {loadError && <p className="mt-5 text-center font-bold text-rose-300">{loadError}</p>}
        <div className="mt-8 text-center"><button data-testid="solo-puzzle-start" type="button" onClick={() => void start()} className="btn btn-cyan w-full px-8 py-4 text-lg sm:w-auto"><Play size={20} fill="currentColor"/>{puzzle.label} 시작</button></div>
      </section>
    </main>;
  }

  if (phase === "LOADING" || phase === "COUNTDOWN") {
    return <main className="arena arena-solo min-h-screen grid place-items-center">
      <section data-testid="solo-countdown" className="text-center">
        {phase === "LOADING"
          ? <LoaderCircle className="mx-auto animate-spin text-cyan-300" size={72}/>
          : <div key={countdown} className="count-beat bg-gradient-to-b from-white to-cyan-300 bg-clip-text text-[9rem] font-black leading-none text-transparent drop-shadow-[0_0_40px_rgb(34_211_238/0.55)]">{countdown}</div>}
        <h2 className="mt-5 text-2xl font-black tracking-tight">{phase === "LOADING" ? "이미지 준비 중" : "집중하세요!"}</h2>
        <p className="mt-1 text-sm text-white/50">{puzzle.label}</p>
      </section>
    </main>;
  }

  return <main className="arena arena-solo min-h-screen">
    <header className="glass mx-auto mb-5 grid max-w-6xl grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 rounded-2xl px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="truncate font-black text-cyan-200">{puzzle.label}</span><span className="chip border-cyan-300/30 bg-cyan-400/10 text-cyan-100">발견 {foundIds.length}/{SOLO_DIFFERENCE_COUNT}</span></div>
        <div className="mt-2 flex gap-1">{Array.from({ length: SOLO_DIFFERENCE_COUNT }, (_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${index < foundIds.length ? "bg-gradient-to-r from-cyan-300 to-sky-400" : "bg-white/10"}`}/>)}</div>
      </div>
      <div className="flex items-center gap-2"><span data-testid="solo-timer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-lg font-black tabular-nums"><Clock3 size={17} className="text-cyan-300"/>{formatSoloTime(finishedMs ?? runningMs)}</span><span className={`chip py-2 ${wrongAnswers ? "border-rose-400/40 bg-rose-500/15 text-rose-200" : ""}`}>오답 {wrongAnswers}</span></div>
    </header>
    {phase === "PLAYING" && <section data-testid="solo-playing" className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="font-bold text-white/60">변경본에서 아주 작은 차이 5개를 찾으세요.</p><div className="flex items-center gap-2"><Move size={16} className="text-white/45"/><button type="button" aria-label="축소" disabled={viewport.scale <= 1} onClick={() => setViewport((current) => clampViewport({ ...current, scale: current.scale - 0.5 }))} className="icon-btn"><Minus size={18}/></button><strong className="min-w-12 text-center tabular-nums">{viewport.scale.toFixed(1)}배</strong><button type="button" aria-label="확대" disabled={viewport.scale >= 3} onClick={() => setViewport((current) => clampViewport({ ...current, scale: current.scale + 0.5 }))} className="icon-btn"><Plus size={18}/></button></div></div>
      <div className="grid gap-5 lg:grid-cols-2"><div><p className="board-label text-white/60"><span className="inline-flex items-center gap-2"><Eye size={16}/>원본</span></p><ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={viewport} onPanBy={panImages}/></div><div><p className="board-label text-cyan-200"><span className="inline-flex items-center gap-2"><MousePointerClick size={16}/>변경본 · 여기를 선택</span></p><ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={marks} viewport={viewport} onPanBy={panImages} onSelect={selectPoint}/></div></div>
      <div className="mt-4 flex min-h-12 justify-center">{feedback && <p key={`${foundIds.length}-${wrongAnswers}`} className={`toast pop-in ${feedback.startsWith("정답") ? "toast-good" : "toast-bad"}`}>{feedback}</p>}</div>
    </section>}
    {phase === "FINISHED" && finishedMs !== null && <section data-testid="solo-finished" className="glass-strong pop-in relative mx-auto max-w-xl overflow-hidden p-8 text-center sm:p-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(closest-side,rgb(251_191_36/0.3),transparent)]"/>
      <div className="relative mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-amber-300 to-orange-500 text-amber-950 shadow-[0_14px_40px_-8px_rgb(251_191_36/0.9)]"><Trophy size={40}/></div>
      <h2 className="relative mt-5 text-3xl font-black tracking-tight">5개 모두 찾았습니다!</h2>
      <p className="mt-4 bg-gradient-to-r from-cyan-200 to-sky-300 bg-clip-text text-6xl font-black tabular-nums text-transparent">{formatSoloTime(finishedMs)}</p>
      <p className="mt-3 text-white/55">오답 {wrongAnswers}회 · 페널티 {wrongAnswers * SOLO_WRONG_PENALTY_MS / 1_000}초 포함</p>
      <p className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/10 px-4 py-2 font-black text-amber-200"><Crown size={16}/>개인 최고기록 {formatSoloTime(records[puzzleId] ?? finishedMs)}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5"><button type="button" onClick={() => void start()} className="btn btn-cyan"><RotateCcw size={18}/>다시 도전</button><button type="button" onClick={returnToSelection} className="btn btn-ghost">다른 문제</button><button type="button" onClick={onExit} className="btn btn-ghost">경쟁전 로비</button></div>
    </section>}
  </main>;
}
