import { GAME_DIFFICULTY_RULES, GAME_MODE_RULES, type GameDifficulty, type GameMode, type GamePuzzleId, type NormalizedPoint, type ReportReason } from "@spot-battle/shared";
import { ChevronRight, CircleCheck, Clock, Crown, Eye, Flag, Flame, Frown, Handshake, HeartCrack, LoaderCircle, LogOut, Minus, MousePointerClick, Move, Plus, RotateCcw, ScanSearch, Search, Sparkles, Swords, Target, TimerReset, Trophy, UsersRound, WifiOff, Wrench, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImageBoard } from "../features/game/components/ImageBoard";
import { useGameClient } from "../features/game/hooks/use-game-client";
import { clampViewport, type ImageViewport } from "../features/game/model/image-geometry";
import { GAME_PUZZLE_VISUALS, preloadPuzzle } from "../features/game/puzzles/catalog";
import { SoloGame } from "../features/solo/components/SoloGame";

function useRemainingSeconds(deadlineMs: number | null | undefined, serverNow: () => number): number | null {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!deadlineMs) return;
    const timer = window.setInterval(() => refresh((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [deadlineMs]);
  return deadlineMs ? Math.max(0, Math.ceil((deadlineMs - serverNow()) / 1_000)) : null;
}

function formatScore(value: number | undefined): string {
  return (value ?? 0).toFixed(1);
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="arena min-h-screen">{children}</main>;
}

export default function App() {
  const game = useGameClient();
  const [soloActive, setSoloActive] = useState(false);
  const [originalNoticeCount, setOriginalNoticeCount] = useState(0);
  const [nicknameInput, setNicknameInput] = useState(game.nickname);
  const [mode, setMode] = useState<GameMode>("STANDARD");
  const [difficulty, setDifficulty] = useState<GameDifficulty>("NORMAL");
  const [reportReason, setReportReason] = useState<ReportReason>("UNFAIR");
  const [preloadError, setPreloadError] = useState<string | null>(null);
  const [preloadAttempt, setPreloadAttempt] = useState(0);
  const [imageViewport, setImageViewport] = useState<ImageViewport>({ scale: 1, pan: { x: 0, y: 0 } });
  const loadedKeyRef = useRef<string | null>(null);
  const remaining = useRemainingSeconds(game.snapshot?.deadlineMs, game.serverNow);
  const me = game.snapshot?.players.find((player) => player.playerId === game.match?.playerId);
  const opponent = game.snapshot?.players.find((player) => player.playerId !== game.match?.playerId);
  const puzzleId = game.snapshot?.currentPuzzleId ?? null;
  const puzzle = puzzleId ? GAME_PUZZLE_VISUALS[puzzleId] : null;
  const inputLocked = Boolean(me?.inputLockedUntilMs && me.inputLockedUntilMs > game.serverNow());
  const lockSeconds = GAME_DIFFICULTY_RULES[game.snapshot?.settings?.difficulty ?? "NORMAL"].wrongAnswerLockSeconds;
  const reconnectCount = useRef(0);
  useEffect(() => {
    if (!game.connected) reconnectCount.current += 1;
  }, [game.connected]);

  useEffect(() => {
    setImageViewport({ scale: 1, pan: { x: 0, y: 0 } });
    setOriginalNoticeCount(0);
  }, [puzzleId]);

  useEffect(() => {
    if (!originalNoticeCount) return;
    const timer = window.setTimeout(() => setOriginalNoticeCount(0), 3_000);
    return () => window.clearTimeout(timer);
  }, [originalNoticeCount]);

  const changeZoom = (delta: number) => {
    setImageViewport((current) => clampViewport({ ...current, scale: current.scale + delta }));
  };
  const panImages = (delta: NormalizedPoint) => {
    setImageViewport((current) => clampViewport({
      ...current,
      pan: { x: current.pan.x + delta.x, y: current.pan.y + delta.y },
    }));
  };

  useEffect(() => {
    if (!game.snapshot?.currentPuzzleId) return;
    const ids = [game.snapshot.currentPuzzleId, game.snapshot.nextPuzzleId].filter(Boolean) as GamePuzzleId[];
    const loading = Promise.all(ids.map(preloadPuzzle));

    if (game.snapshot.state !== "PRELOADING" || !game.match) {
      void loading.catch(() => undefined);
      return;
    }

    // Re-send after a reconnect: a message sent while offline is lost, and the server keeps waiting.
    if (me?.loaded || !game.connected) return;
    const key = `${game.match.matchId}:${game.snapshot.currentPuzzleId}:${preloadAttempt}:${reconnectCount.current}`;
    if (loadedKeyRef.current === key) return;
    void loading
      .then(() => {
        loadedKeyRef.current = key;
        setPreloadError(null);
        game.loaded(game.snapshot!.currentPuzzleId!);
      })
      .catch(() => setPreloadError("이미지를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해주세요."));
  }, [game.snapshot?.state, game.snapshot?.currentPuzzleId, game.snapshot?.nextPuzzleId, game.match?.matchId, preloadAttempt, me?.loaded, game.connected]);


  const header = useMemo(() => (
    <header className="glass mx-auto mb-6 flex max-w-6xl items-center justify-between gap-3 rounded-2xl px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_8px_24px_-6px_rgb(168_85_247/0.9)]"><ScanSearch size={22}/></span>
        <div><h1 className="text-base font-black leading-tight tracking-tight sm:text-lg">틀린그림찾기 <span className="bg-gradient-to-r from-violet-300 to-pink-300 bg-clip-text text-transparent">배틀</span></h1><p className="text-xs text-white/50">두 명이 동시에 3분 동안 연속 대결</p></div>
      </div>
      {game.nickname && <span className="chip max-w-[45%] truncate"><span className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]"/>{game.nickname}</span>}
    </header>
  ), [game.nickname]);

  if (game.phase === "NICKNAME") return <Shell>{header}
    <section className="glass-strong pop-in mx-auto max-w-md p-8 text-center sm:p-10">
      <div className="icon-tile mx-auto"><Sparkles size={28}/></div>
      <p className="eyebrow mt-6">Player Setup</p>
      <h2 className="mt-1 text-2xl font-black tracking-tight">닉네임을 정해주세요</h2>
      <p className="mt-2 text-sm text-white/55">대결 상대에게 이 이름이 표시됩니다.</p>
      <input data-testid="nickname-input" aria-label="닉네임" autoFocus value={nicknameInput} placeholder="최대 16자" onChange={(event) => setNicknameInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && game.saveNickname(nicknameInput)} maxLength={16} className="text-input mt-7"/>
      <button data-testid="nickname-submit" onClick={() => game.saveNickname(nicknameInput)} className="btn btn-primary mt-3 w-full py-4 text-lg">시작하기<ChevronRight size={20}/></button>
    </section>
  </Shell>;

  if (soloActive) return <SoloGame onExit={() => setSoloActive(false)}/>;

  if (game.phase === "LOBBY") return <Shell>{header}
    <section className="glass-strong pop-in mx-auto max-w-3xl p-5 sm:p-9">
      <div className="text-center">
        <div className="icon-tile mx-auto size-16"><Swords size={32}/></div>
        <p className="eyebrow mt-5">Realtime 1 vs 1</p>
        <h2 className="title-gradient mt-1 text-3xl font-black tracking-tight sm:text-4xl">동시 빨리찾기</h2>
        <p className="mt-2 text-white/60">같은 설정을 선택한 상대와 공정하게 대결합니다.</p>
      </div>

      <button data-testid="solo-mode-open" type="button" onClick={() => setSoloActive(true)} className="group mt-7 flex w-full items-center gap-4 rounded-2xl border border-cyan-300/30 bg-gradient-to-r from-cyan-500/15 to-sky-500/5 p-4 text-left transition hover:border-cyan-300/60 hover:from-cyan-500/25">
        <span className="icon-tile icon-tile-cyan size-12 shrink-0"><TimerReset size={24}/></span>
        <span className="min-w-0 flex-1"><strong className="block text-lg">혼자 기록 세우기</strong><small className="text-sm text-cyan-100/70">신규 하드 퍼즐 5세트 · 차이 5개 · 개인 최고기록</small></span>
        <ChevronRight className="shrink-0 text-cyan-200/70 transition group-hover:translate-x-1" size={22}/>
      </button>

      <div className="mt-7">
        <p className="eyebrow mb-3">게임 모드</p>
        <div className="grid gap-2.5 sm:grid-cols-3">{([['STANDARD','기본전','3분 동안 가장 많이 찾기',Target],['SPRINT','속도전','60초 초고속 대결',Zap],['SURVIVAL','생존전','오답 3번이면 즉시 패배',HeartCrack]] as const).map(([value,label,description,Icon]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className="option"><Icon size={20} className={mode === value ? "text-fuchsia-300" : "text-white/45"}/><strong className="mt-2 block text-base">{label}</strong><span className="text-xs text-white/55">{description}</span></button>)}</div>
      </div>

      <div className="mt-6">
        <p className="eyebrow mb-3">난이도</p>
        <div className="grid grid-cols-3 gap-2.5">{([['EASY','쉬움','넓은 판정 · 0.5초 잠금',1],['NORMAL','보통','기본 판정 · 1초 잠금',2],['HARD','어려움','정밀 판정 · 2초 잠금',3]] as const).map(([value,label,description,level]) => <button key={value} type="button" aria-pressed={difficulty === value} onClick={() => setDifficulty(value)} className="option p-3 sm:p-4"><span className="flex gap-1">{[1,2,3].map((bar) => <span key={bar} className={`h-1.5 w-4 rounded-full ${bar <= level ? (difficulty === value ? "bg-fuchsia-300" : "bg-white/50") : "bg-white/10"}`}/>)}</span><strong className="mt-2 block text-base">{label}</strong><span className="text-xs text-white/55">{description}</span></button>)}</div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2.5 text-center">
        <div className="stat"><p className="text-[11px] text-white/45">문제당 차이</p><p className="mt-0.5 font-black">3개</p></div>
        <div className="stat"><p className="text-[11px] text-white/45">대결 시간</p><p className="mt-0.5 font-black">{GAME_MODE_RULES[mode].durationSeconds}초</p></div>
        <div className="stat"><p className="text-[11px] text-white/45">오답 잠금</p><p className="mt-0.5 font-black">{GAME_DIFFICULTY_RULES[difficulty].wrongAnswerLockSeconds}초</p></div>
      </div>
      <p className="mt-4 text-center text-xs font-semibold text-white/45">전체 문제를 먼저 완료하면 즉시 승리 · 시간 종료 시 점수로 판정</p>

      <button data-testid="matchmaking-start" disabled={!game.connected} onClick={() => game.startMatching({ mode, difficulty })} className="btn btn-primary mt-6 w-full py-4 text-lg">{game.connected ? <UsersRound size={22}/> : <LoaderCircle className="animate-spin" size={22}/>}{game.connected ? "이 설정으로 상대 찾기" : "서버 연결 중"}</button>
    </section>
  </Shell>;

  if (game.phase === "MATCHING") return <Shell>{header}
    <section data-testid="matching-screen" className="glass-strong pop-in mx-auto max-w-md p-10 text-center">
      <div className="relative mx-auto grid size-28 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/25"/>
        <span className="absolute inset-3 rounded-full border border-violet-300/30"/>
        <span className="icon-tile relative size-16 rounded-full"><Search size={28}/></span>
      </div>
      <h2 className="mt-7 text-2xl font-black tracking-tight">상대를 찾는 중...</h2>
      <p className="mt-2 text-sm text-white/55">같은 모드와 난이도를 고른 플레이어와 연결합니다.</p>
      <button onClick={game.cancelMatching} className="btn btn-ghost mt-8"><X size={18}/>매칭 취소</button>
    </section>
  </Shell>;

  if (!game.snapshot || !game.match) return <Shell>{header}<div className="flex items-center justify-center gap-3 py-20 text-white/70"><LoaderCircle className="animate-spin"/>경기 정보를 불러오는 중입니다.</div></Shell>;

  const total = game.snapshot.totalPuzzleCount;
  const progressPercent = (player: typeof me) => {
    if (!player) return 0;
    if (player.completedAllPuzzles) return 100;
    const currentShare = player.currentDifferenceCount ? player.foundCount / player.currentDifferenceCount : 0;
    return Math.min(100, ((player.completedPuzzleCount + currentShare) / Math.max(total, 1)) * 100);
  };
  const timerTone = remaining === null ? "" : remaining <= 10 ? "animate-pulse border-rose-400/50 bg-rose-500/20 text-rose-200" : remaining <= 30 ? "border-amber-300/40 bg-amber-400/15 text-amber-200" : "border-white/10 bg-white/[0.06] text-white";

  const statusBar = <div className="glass mx-auto mb-5 grid max-w-6xl grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 rounded-2xl px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:gap-x-6 sm:px-5">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><span className="chip border-violet-400/30 bg-violet-500/15 text-violet-200">문제 {Math.min((me?.puzzleIndex ?? 0) + 1, total)}/{total}</span><span className="font-black">나 {me?.completedAllPuzzles ? "완료" : `${(me?.completedPuzzleCount ?? 0) + 1}/${total}번`} · {me?.foundCount ?? 0}/{me?.currentDifferenceCount ?? 0}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-[width] duration-500" style={{ width: `${progressPercent(me)}%` }}/></div>
    </div>
    <div className="flex items-center gap-2 sm:order-last sm:justify-self-end">
      {remaining !== null && <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-black tabular-nums ${timerTone}`}><Clock size={18}/>{remaining}초</span>}
      {!['FINISHED','CANCELLED'].includes(game.snapshot.state) && <button data-testid="forfeit-button" aria-label="기권하고 나가기" onClick={() => window.confirm("경기를 나가면 기권패입니다. 나갈까요?") && game.forfeit()} className="icon-btn"><LogOut size={18}/></button>}
    </div>
    <div className="col-span-2 min-w-0 sm:col-span-1">
      <p className="truncate text-sm font-bold text-white/60">상대 {opponent?.completedAllPuzzles ? "완료" : `${(opponent?.completedPuzzleCount ?? 0) + 1}/${total}번`} · {opponent?.foundCount ?? 0}/{opponent?.currentDifferenceCount ?? 0}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-400 transition-[width] duration-500" style={{ width: `${progressPercent(opponent)}%` }}/></div>
    </div>
  </div>;

  const iWon = game.snapshot.winnerId === game.match.playerId;
  const resultTitle = iWon ? "승리했습니다!" : game.snapshot.winnerId ? "아쉽게 패배했습니다" : "무승부입니다";
  const ResultIcon = iWon ? Trophy : game.snapshot.winnerId ? Frown : Handshake;
  const endReason = game.snapshot.endReason === "COMPLETED" ? "전체 문제 먼저 완료" : game.snapshot.endReason === "TIMEOUT" ? "제한시간 종료" : game.snapshot.endReason === "FORFEIT" ? (iWon ? "상대 기권" : "본인 기권") : game.snapshot.endReason === "MISTAKE_LIMIT" ? (iWon ? "상대 오답 3회" : "오답 3회") : "경기 종료";

  return <Shell>{header}{statusBar}
    {game.snapshot.state === "PLAYING" && originalNoticeCount > 0 && <div role="status" className="pop-in fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-2xl border border-violet-300/40 bg-violet-600/90 px-6 py-4 text-center text-lg font-black text-white shadow-[0_20px_50px_-10px_rgb(139_92_246/0.8)] backdrop-blur-xl">수정본에서 선택해주세요</div>}
    {game.snapshot.state === "PLAYING" && (me?.correctStreak ?? 0) >= 2 && <div className="pop-in mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border border-orange-300/40 bg-gradient-to-r from-orange-500/25 to-amber-400/20 px-5 py-2.5 text-lg font-black text-orange-200 shadow-[0_0_30px_-6px_rgb(251_146_60/0.8)]"><Flame size={20} className="text-orange-300"/>{me?.correctStreak}연속 정답!</div>}
    {opponent?.connectionStatus === "RECONNECTING" && <div className="mx-auto mb-5 flex max-w-6xl items-center justify-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-5 py-3.5 text-center font-bold text-amber-200"><WifiOff size={18}/>상대의 연결이 끊겼습니다. 10초 동안 복귀를 기다립니다.</div>}

    {game.snapshot.state === "READY" && <section data-testid="ready-screen" className="glass-strong pop-in mx-auto max-w-xl p-8 text-center sm:p-10">
      <p className="eyebrow">Match Found</p>
      <div className="mt-5 flex items-center justify-center gap-4 sm:gap-6">
        <div className="min-w-0 flex-1"><div className="icon-tile mx-auto"><UsersRound size={26}/></div><p className="mt-2 truncate font-black">{game.nickname}</p></div>
        <span className="bg-gradient-to-b from-white to-white/40 bg-clip-text text-3xl font-black italic text-transparent">VS</span>
        <div className="min-w-0 flex-1"><div className="icon-tile icon-tile-cyan mx-auto"><UsersRound size={26}/></div><p className="mt-2 truncate font-black">{game.match.opponentNickname}</p></div>
      </div>
      <h2 className="sr-only">상대: {game.match.opponentNickname}</h2>
      <p className="mt-6 text-white/60">두 명 모두 같은 문제를 동시에 풉니다.</p>
      <button data-testid="ready-button" disabled={me?.ready} onClick={game.ready} className={`btn mt-6 w-full py-4 text-lg ${me?.ready ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 disabled:opacity-100" : "btn-primary"}`}>{me?.ready ? <><CircleCheck size={20}/>준비 완료 · 상대 대기</> : "준비 완료"}</button>
    </section>}

    {game.snapshot.state === "PRELOADING" && <section data-testid="preloading-screen" className="glass-strong pop-in mx-auto max-w-xl p-10 text-center">
      <LoaderCircle className="mx-auto animate-spin text-violet-300" size={52}/>
      <h2 className="mt-5 text-2xl font-black tracking-tight">문제 이미지를 준비하고 있습니다</h2>
      <p className="mt-2 text-white/55">양쪽 준비가 끝나면 동시에 시작합니다.</p>
      {preloadError && <div className="mt-6"><p className="font-bold text-rose-300">{preloadError}</p><button onClick={() => setPreloadAttempt((value) => value + 1)} className="btn btn-ghost mt-3"><RotateCcw size={16}/>다시 시도</button></div>}
    </section>}

    {game.snapshot.state === "COUNTDOWN" && <section data-testid="countdown-screen" className="mx-auto max-w-xl py-14 text-center">
      <div key={remaining ?? 0} className="count-beat bg-gradient-to-b from-white to-violet-300 bg-clip-text text-[9rem] font-black leading-none text-transparent drop-shadow-[0_0_40px_rgb(167_139_250/0.6)]">{remaining ?? 0}</div>
      <h2 className="mt-4 text-2xl font-black tracking-tight">곧 시작합니다!</h2>
    </section>}

    {game.snapshot.state === "PLAYING" && puzzle && <section data-testid="playing-screen" data-puzzle-id={puzzle.id} className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-2xl font-black tracking-tight">{puzzle.label}</h2><p className="text-sm text-white/55">수정본에서 차이 {me?.currentDifferenceCount ?? 0}개를 찾으세요. 다 찾으면 바로 다음 그림으로 이동합니다.</p></div>
        <div className="flex items-center gap-2" data-testid="zoom-controls">
          <span className="mr-1 hidden items-center gap-1 text-xs font-bold text-white/45 sm:inline-flex"><Move size={14}/>확대 후 드래그</span>
          <button type="button" aria-label="축소" disabled={imageViewport.scale <= 1} onClick={() => changeZoom(-0.5)} className="icon-btn"><Minus size={18}/></button>
          <span className="min-w-12 text-center font-black tabular-nums">{imageViewport.scale.toFixed(1)}배</span>
          <button type="button" aria-label="확대" disabled={imageViewport.scale >= 3} onClick={() => changeZoom(0.5)} className="icon-btn"><Plus size={18}/></button>
          <button type="button" onClick={() => setImageViewport({ scale: 1, pan: { x: 0, y: 0 } })} className="btn btn-ghost rounded-xl px-3 py-2 text-sm">원래 크기</button>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div><p className="board-label text-white/60"><span className="inline-flex items-center gap-2"><Eye size={16}/>원본 · 비교용</span></p><ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={imageViewport} onPanBy={panImages} onSelect={() => setOriginalNoticeCount((count) => count + 1)}/></div>
        <div><p className="board-label text-fuchsia-200"><span className="inline-flex items-center gap-2"><MousePointerClick size={16}/>수정본 · 여기를 선택</span><span className="chip border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200">{me?.foundCount ?? 0}/{me?.currentDifferenceCount ?? 0}</span></p><ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={game.foundMarks} viewport={imageViewport} onPanBy={panImages} onSelect={inputLocked ? undefined : (point) => game.guess(puzzle.id, point)}/></div>
      </div>
      <div className="mt-5 flex min-h-12 justify-center">{inputLocked ? <span className="toast toast-bad pop-in">오답 · {lockSeconds}초 입력 잠금</span> : game.lastGuess && <span className={`toast pop-in ${game.lastGuess.correct ? "toast-good" : "toast-bad"}`}>{game.lastGuess.correct ? "정답!" : "오답"}</span>}</div>
    </section>}

    {game.snapshot.state === "PLAYING" && !puzzle && <section data-testid="deck-complete-screen" className="glass-strong pop-in mx-auto max-w-xl p-10 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_10px_30px_-8px_rgb(52_211_153/0.8)]"><CircleCheck size={32}/></div>
      <h2 className="mt-5 text-2xl font-black tracking-tight">완료 · {me?.totalFoundCount ?? 0}/{me?.totalDifferenceCount ?? game.snapshot.totalDifferenceCount}</h2>
      <p className="mt-3 text-white/55">전체 문제를 완료했습니다. 결과를 확인하고 있습니다.</p>
    </section>}

    {game.snapshot.state === "FINISHED" && <section data-testid="finished-screen" className="glass-strong pop-in relative mx-auto max-w-2xl overflow-hidden p-7 text-center sm:p-10">
      {iWon && <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(closest-side,rgb(251_191_36/0.35),transparent)]"/>}
      <div className={`relative mx-auto grid size-20 place-items-center rounded-3xl ${iWon ? "bg-gradient-to-br from-amber-300 to-orange-500 text-amber-950 shadow-[0_14px_40px_-8px_rgb(251_191_36/0.9)]" : "bg-white/10 text-white/80"}`}><ResultIcon size={40}/></div>
      <h2 className={`relative mt-5 text-3xl font-black tracking-tight sm:text-4xl ${iWon ? "bg-gradient-to-r from-amber-200 to-orange-300 bg-clip-text text-transparent" : ""}`}>{resultTitle}</h2>
      <p className="mt-2 text-white/55">종료 사유: {endReason}</p>
      <div className="mt-7 grid gap-3 text-left sm:grid-cols-2">
        <div className={`rounded-2xl border p-5 ${iWon ? "border-amber-300/40 bg-amber-400/10" : "border-violet-400/30 bg-violet-500/10"}`}>
          <p className="flex items-center gap-1.5 text-sm font-black text-white/70">{iWon && <Crown size={16} className="text-amber-300"/>}나</p>
          <p className="mt-1 text-2xl font-black">{me?.completedAllPuzzles ? "완료" : "진행"} · {me?.totalFoundCount ?? 0}/{me?.totalDifferenceCount ?? game.snapshot.totalDifferenceCount}</p>
          <p className="mt-3 text-3xl font-black tabular-nums text-violet-200">총점 {formatScore(me?.score)}점</p>
          <p className="mt-1 text-xs text-white/50">찾기 {(me?.totalFoundCount ?? 0) * 10}점 + 시간 {formatScore(me?.timeBonus)}점 · 오답 {me?.wrongAnswerCount ?? 0}</p>
        </div>
        <div className={`rounded-2xl border p-5 ${!iWon && game.snapshot.winnerId ? "border-amber-300/40 bg-amber-400/10" : "border-white/10 bg-white/[0.04]"}`}>
          <p className="flex items-center gap-1.5 truncate text-sm font-black text-white/70">{!iWon && game.snapshot.winnerId && <Crown size={16} className="text-amber-300"/>}{opponent?.nickname}</p>
          <p className="mt-1 text-2xl font-black">{opponent?.completedAllPuzzles ? "완료" : "진행"} · {opponent?.totalFoundCount ?? 0}/{opponent?.totalDifferenceCount ?? game.snapshot.totalDifferenceCount}</p>
          <p className="mt-3 text-3xl font-black tabular-nums text-white/85">총점 {formatScore(opponent?.score)}점</p>
          <p className="mt-1 text-xs text-white/50">찾기 {(opponent?.totalFoundCount ?? 0) * 10}점 + 시간 {formatScore(opponent?.timeBonus)}점</p>
        </div>
      </div>
      <p className="mt-5 text-xs font-semibold text-white/45">차이점 1개당 10점, 전체 완료 시 남은 시간 1초당 0.5점을 더합니다.</p>
      <button onClick={game.returnToLobby} className="btn btn-primary mt-7 px-8 py-4"><RotateCcw size={19}/>로비로 돌아가기</button>
    </section>}

    {game.snapshot.state === "CANCELLED" && <section className="glass-strong pop-in mx-auto max-w-2xl p-10 text-center">
      <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-white/10 text-white/80"><Wrench size={38}/></div>
      <h2 className="mt-5 text-3xl font-black tracking-tight">경기가 취소되었습니다</h2>
      <p className="mt-2 text-white/55">{game.snapshot.cancelReason}</p>
      <button onClick={game.returnToLobby} className="btn btn-primary mt-7 px-8 py-4">로비로 돌아가기</button>
    </section>}

    {(game.snapshot.state === "FINISHED" || game.snapshot.state === "CANCELLED") && <div className="glass mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-2 rounded-2xl p-3">
      <select aria-label="신고 사유" value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)} disabled={Boolean(game.reportId)} className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-bold text-white [&>option]:bg-[#15142e]"><option value="UNFAIR">불공정한 문제</option><option value="INAPPROPRIATE">부적절한 표현</option><option value="SYSTEM_ERROR">시스템 오류</option><option value="OTHER">기타</option></select>
      <button disabled={Boolean(game.reportId)} onClick={() => game.report(reportReason)} className={`btn rounded-xl px-4 py-2 text-sm ${game.reportId ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 disabled:opacity-100" : "btn-ghost"}`}><Flag size={16}/>{game.reportId ? "신고 완료" : "문제 신고"}</button>
    </div>}

    {!game.connected && <div className="fixed inset-0 z-50 grid place-items-center bg-[#05050f]/75 p-4 backdrop-blur-sm"><div className="glass-strong pop-in p-8 text-center"><WifiOff className="mx-auto text-rose-400" size={44}/><h3 className="mt-3 text-xl font-black">서버와 다시 연결 중입니다</h3><LoaderCircle className="mx-auto mt-4 animate-spin text-white/50" size={22}/></div></div>}
    {game.error && <button onClick={game.clearError} className="pop-in fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-rose-400/40 bg-rose-600/90 px-5 py-3 font-bold text-white shadow-xl backdrop-blur-xl">{game.error.message} · 닫기</button>}
  </Shell>;
}
