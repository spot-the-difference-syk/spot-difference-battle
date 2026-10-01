import { GAME_DIFFICULTY_RULES, GAME_MODE_RULES, type GameDifficulty, type GameMode, type GamePuzzleId, type NormalizedPoint, type ReportReason } from "@spot-battle/shared";
import { Clock, Flag, LoaderCircle, LogOut, Minus, Move, Plus, RotateCcw, TimerReset, UsersRound, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImageBoard } from "../features/game/components/ImageBoard";
import { useGameClient } from "../features/game/hooks/use-game-client";
import { clampViewport, type ImageViewport } from "../features/game/model/image-geometry";
import { GAME_PUZZLE_VISUALS, preloadPuzzle } from "../features/game/puzzles/catalog";
import { SoloGame } from "../features/solo/components/SoloGame";

function useRemainingSeconds(deadlineMs: number | null | undefined): number | null {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!deadlineMs) return;
    const timer = window.setInterval(() => refresh((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [deadlineMs]);
  return deadlineMs ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1_000)) : null;
}

function formatScore(value: number | undefined): string {
  return (value ?? 0).toFixed(1);
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-amber-50 p-4 text-slate-900 sm:p-7">{children}</main>;
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
  const remaining = useRemainingSeconds(game.snapshot?.deadlineMs);
  const me = game.snapshot?.players.find((player) => player.playerId === game.match?.playerId);
  const opponent = game.snapshot?.players.find((player) => player.playerId !== game.match?.playerId);
  const puzzleId = game.snapshot?.currentPuzzleId ?? null;
  const puzzle = puzzleId ? GAME_PUZZLE_VISUALS[puzzleId] : null;
  const inputLocked = Boolean(me?.inputLockedUntilMs && me.inputLockedUntilMs > Date.now());
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

    const key = `${game.match.matchId}:${game.snapshot.currentPuzzleId}`;
    if (loadedKeyRef.current === key) return;
    void loading
      .then(() => {
        loadedKeyRef.current = key;
        setPreloadError(null);
        game.loaded(game.snapshot!.currentPuzzleId!);
      })
      .catch(() => setPreloadError("이미지를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해주세요."));
  }, [game.snapshot?.state, game.snapshot?.currentPuzzleId, game.snapshot?.nextPuzzleId, game.match?.matchId, preloadAttempt]);

  const header = useMemo(() => (
    <header className="mx-auto mb-6 flex max-w-6xl items-center justify-between rounded-2xl bg-white/90 px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3"><span className="text-3xl">🔍</span><div><h1 className="font-black text-violet-700">틀린그림찾기 배틀</h1><p className="text-xs text-slate-500">두 명이 동시에 3분 동안 연속 대결</p></div></div>
      {game.nickname && <span className="rounded-full bg-violet-100 px-4 py-2 text-sm font-bold text-violet-700">{game.nickname}</span>}
    </header>
  ), [game.nickname]);

  if (game.phase === "NICKNAME") return <Shell>{header}<section className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-xl"><div className="text-5xl">👋</div><h2 className="mt-4 text-2xl font-black">닉네임을 정해주세요</h2><input data-testid="nickname-input" aria-label="닉네임" autoFocus value={nicknameInput} onChange={(event) => setNicknameInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && game.saveNickname(nicknameInput)} maxLength={16} className="mt-6 w-full rounded-2xl border-2 border-violet-200 px-4 py-3 text-center font-bold"/><button data-testid="nickname-submit" onClick={() => game.saveNickname(nicknameInput)} className="mt-3 w-full rounded-2xl bg-violet-600 py-3 font-black text-white">시작하기</button></section></Shell>;

  if (soloActive) return <SoloGame onExit={() => setSoloActive(false)}/>;

  if (game.phase === "LOBBY") return <Shell>{header}<section className="mx-auto max-w-3xl rounded-3xl bg-violet-700 p-6 text-center text-white shadow-xl sm:p-10"><div className="text-6xl">⚔️</div><h2 className="mt-4 text-3xl font-black">동시 빨리찾기</h2><p className="mt-2 text-violet-100">같은 설정을 선택한 상대와 공정하게 대결합니다.</p><button data-testid="solo-mode-open" type="button" onClick={() => setSoloActive(true)} className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-cyan-300 bg-cyan-950/60 px-6 py-4 text-left"><TimerReset size={24}/><span><strong className="block text-lg">혼자 기록 세우기</strong><small className="text-cyan-100">신규 하드 퍼즐 5세트 · 차이 5개 · 개인 최고기록</small></span></button><div className="mt-6 text-left"><p className="mb-2 font-black">게임 모드</p><div className="grid gap-2 sm:grid-cols-3">{([['STANDARD','기본전','3분 동안 가장 많이 찾기'],['SPRINT','속도전','60초 초고속 대결'],['SURVIVAL','생존전','오답 3번이면 즉시 패배']] as const).map(([value,label,description]) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-2xl border-2 p-4 text-left ${mode === value ? 'border-amber-300 bg-white text-violet-800' : 'border-white/20 bg-white/10'}`}><strong className="block">{label}</strong><span className="text-xs opacity-80">{description}</span></button>)}</div></div><div className="mt-5 text-left"><p className="mb-2 font-black">난이도</p><div className="grid gap-2 sm:grid-cols-3">{([['EASY','쉬움','넓은 판정 · 0.5초 잠금'],['NORMAL','보통','기본 판정 · 1초 잠금'],['HARD','어려움','정밀 판정 · 2초 잠금']] as const).map(([value,label,description]) => <button key={value} type="button" onClick={() => setDifficulty(value)} className={`rounded-2xl border-2 p-3 text-left ${difficulty === value ? 'border-amber-300 bg-white text-violet-800' : 'border-white/20 bg-white/10'}`}><strong className="block">{label}</strong><span className="text-xs opacity-80">{description}</span></button>)}</div></div><div className="mt-5 grid gap-3 text-sm sm:grid-cols-3"><span className="rounded-xl bg-white/10 p-3">문제당 차이 3개</span><span className="rounded-xl bg-white/10 p-3">{GAME_MODE_RULES[mode].durationSeconds}초 대결</span><span className="rounded-xl bg-white/10 p-3">오답 잠금 {GAME_DIFFICULTY_RULES[difficulty].wrongAnswerLockSeconds}초</span></div><p className="mt-4 text-sm font-bold text-violet-100">전체 문제를 먼저 완료하면 즉시 승리 · 시간 종료 시 점수로 판정</p><button data-testid="matchmaking-start" disabled={!game.connected} onClick={() => game.startMatching({ mode, difficulty })} className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-8 py-4 font-black text-slate-900 disabled:opacity-40"><UsersRound size={20}/>{game.connected ? "이 설정으로 상대 찾기" : "서버 연결 중"}</button></section></Shell>;

  if (game.phase === "MATCHING") return <Shell>{header}<section data-testid="matching-screen" className="mx-auto max-w-md rounded-3xl bg-white p-10 text-center shadow-xl"><LoaderCircle className="mx-auto animate-spin text-violet-600" size={56}/><h2 className="mt-5 text-2xl font-black">상대를 찾는 중...</h2><button onClick={game.cancelMatching} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 font-bold"><X size={18}/>매칭 취소</button></section></Shell>;

  if (!game.snapshot || !game.match) return <Shell>{header}<div className="text-center"><LoaderCircle className="mx-auto animate-spin"/>경기 정보를 불러오는 중입니다.</div></Shell>;

  const statusBar = <div className="mx-auto mb-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 shadow-sm"><div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">문제 {Math.min((me?.puzzleIndex ?? 0) + 1, game.snapshot.totalPuzzleCount)}/{game.snapshot.totalPuzzleCount}</span><span className="ml-3 font-black">나 {me?.completedAllPuzzles ? "완료" : `${(me?.completedPuzzleCount ?? 0) + 1}/${game.snapshot.totalPuzzleCount}번`} · {me?.foundCount ?? 0}/{me?.currentDifferenceCount ?? 0}</span><span className="ml-3 text-sm text-slate-500">상대 {opponent?.completedAllPuzzles ? "완료" : `${(opponent?.completedPuzzleCount ?? 0) + 1}/${game.snapshot.totalPuzzleCount}번`} · {opponent?.foundCount ?? 0}/{opponent?.currentDifferenceCount ?? 0}</span></div><div className="flex items-center gap-2">{remaining !== null && <span className={`flex items-center gap-2 rounded-full px-4 py-2 font-black ${remaining <= 10 ? "animate-pulse bg-red-100 text-red-600" : remaining <= 30 ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"}`}><Clock size={18}/>{remaining}초</span>}{!['FINISHED','CANCELLED'].includes(game.snapshot.state) && <button data-testid="forfeit-button" onClick={() => window.confirm("경기를 나가면 기권패입니다. 나갈까요?") && game.forfeit()} className="rounded-full bg-slate-100 p-2 text-slate-500"><LogOut size={18}/></button>}</div></div>;

  return <Shell>{header}{statusBar}
    {game.snapshot.state === "PLAYING" && originalNoticeCount > 0 && <div role="status" className="fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-2xl bg-violet-700 px-6 py-4 text-center text-lg font-black text-white shadow-xl">수정본에서 선택해주세요</div>}
    {game.snapshot.state === "PLAYING" && (me?.correctStreak ?? 0) >= 2 && <div className="mx-auto mb-4 max-w-sm animate-pulse rounded-2xl bg-orange-100 px-5 py-3 text-center text-xl font-black text-orange-700">🔥 {me?.correctStreak}연속 정답!</div>}
    {opponent?.connectionStatus === "RECONNECTING" && <div className="mx-auto mb-5 max-w-6xl rounded-2xl bg-amber-100 px-5 py-4 text-center font-bold text-amber-800">상대의 연결이 끊겼습니다. 10초 동안 복귀를 기다립니다.</div>}

    {game.snapshot.state === "READY" && <section data-testid="ready-screen" className="mx-auto max-w-xl rounded-3xl bg-white p-10 text-center shadow-xl"><div className="text-6xl">🔎</div><h2 className="mt-4 text-2xl font-black">상대: {game.match.opponentNickname}</h2><p className="mt-3 text-slate-500">두 명 모두 같은 문제를 동시에 풉니다.</p><button data-testid="ready-button" disabled={me?.ready} onClick={game.ready} className="mt-6 rounded-2xl bg-violet-600 px-8 py-4 font-black text-white disabled:bg-emerald-500">{me?.ready ? "준비 완료 · 상대 대기" : "준비 완료"}</button></section>}

    {game.snapshot.state === "PRELOADING" && <section data-testid="preloading-screen" className="mx-auto max-w-xl rounded-3xl bg-white p-10 text-center shadow-xl"><LoaderCircle className="mx-auto animate-spin text-violet-600" size={52}/><h2 className="mt-4 text-2xl font-black">문제 이미지를 준비하고 있습니다</h2><p className="mt-2 text-slate-500">양쪽 준비가 끝나면 동시에 시작합니다.</p>{preloadError && <div className="mt-5"><p className="font-bold text-red-600">{preloadError}</p><button onClick={() => setPreloadAttempt((value) => value + 1)} className="mt-3 rounded-xl bg-slate-800 px-4 py-2 font-bold text-white">다시 시도</button></div>}</section>}

    {game.snapshot.state === "COUNTDOWN" && <section data-testid="countdown-screen" className="mx-auto max-w-xl rounded-3xl bg-white p-12 text-center shadow-xl"><div className="text-8xl font-black text-violet-600">{remaining ?? 0}</div><h2 className="mt-3 text-2xl font-black">곧 시작합니다!</h2></section>}

    {game.snapshot.state === "PLAYING" && puzzle && <section data-testid="playing-screen" data-puzzle-id={puzzle.id} className="mx-auto max-w-6xl"><div className="mb-4 text-center"><h2 className="text-2xl font-black">{puzzle.label}</h2><p className="text-sm text-slate-500">수정본에서 차이 {me?.currentDifferenceCount ?? 0}개를 찾으세요. 다 찾으면 바로 다음 그림으로 이동합니다.</p></div><div className="mb-4 flex flex-wrap items-center justify-center gap-2" data-testid="zoom-controls"><span className="mr-1 inline-flex items-center gap-1 text-sm font-bold text-slate-600"><Move size={16}/>확대 후 드래그</span><button type="button" aria-label="축소" disabled={imageViewport.scale <= 1} onClick={() => changeZoom(-0.5)} className="rounded-xl bg-white p-2 shadow disabled:opacity-35"><Minus size={18}/></button><span className="min-w-14 text-center font-black">{imageViewport.scale.toFixed(1)}배</span><button type="button" aria-label="확대" disabled={imageViewport.scale >= 3} onClick={() => changeZoom(0.5)} className="rounded-xl bg-white p-2 shadow disabled:opacity-35"><Plus size={18}/></button><button type="button" onClick={() => setImageViewport({ scale: 1, pan: { x: 0, y: 0 } })} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-bold text-white">원래 크기</button></div><div className="grid gap-5 lg:grid-cols-2"><div><p className="mb-3 rounded-xl bg-slate-100 py-3 text-center text-xl font-black sm:text-2xl">원본 · 비교용</p><ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={imageViewport} onPanBy={panImages} onSelect={() => setOriginalNoticeCount((count) => count + 1)}/></div><div><p className="mb-3 rounded-xl bg-violet-100 py-3 text-center text-xl font-black text-violet-800 sm:text-2xl">수정본 · 여기를 선택</p><ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={game.foundMarks} viewport={imageViewport} onPanBy={panImages} onSelect={inputLocked ? undefined : (point) => game.guess(puzzle.id, point)}/></div></div><div className="mt-5 flex justify-center">{inputLocked ? <span className="rounded-xl bg-red-100 px-5 py-3 font-black text-red-700">오답 · 1초 입력 잠금</span> : game.lastGuess && <span className={`rounded-xl px-5 py-3 font-black ${game.lastGuess.correct ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{game.lastGuess.correct ? "정답!" : "오답"}</span>}</div></section>}

    {game.snapshot.state === "PLAYING" && !puzzle && <section data-testid="deck-complete-screen" className="mx-auto max-w-xl rounded-3xl bg-white p-10 text-center shadow-xl"><div className="text-6xl">✅</div><h2 className="mt-4 text-2xl font-black">완료 · {me?.totalFoundCount ?? 0}/{me?.totalDifferenceCount ?? game.snapshot.totalDifferenceCount}</h2><p className="mt-3 text-slate-500">전체 문제를 완료했습니다. 결과를 확인하고 있습니다.</p></section>}

    {game.snapshot.state === "FINISHED" && <section data-testid="finished-screen" className="mx-auto max-w-2xl rounded-3xl bg-white p-10 text-center shadow-xl"><div className="text-7xl">{game.snapshot.winnerId === game.match.playerId ? "🏆" : game.snapshot.winnerId ? "😿" : "🤝"}</div><h2 className="mt-4 text-3xl font-black">{game.snapshot.winnerId === game.match.playerId ? "승리했습니다!" : game.snapshot.winnerId ? "아쉽게 패배했습니다" : "무승부입니다"}</h2><p className="mt-2 text-slate-500">종료 사유: {game.snapshot.endReason === "COMPLETED" ? "전체 문제 먼저 완료" : game.snapshot.endReason === "TIMEOUT" ? "제한시간 종료" : game.snapshot.endReason === "FORFEIT" ? (game.snapshot.winnerId === game.match.playerId ? "상대 기권" : "본인 기권") : "경기 종료"}</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-violet-50 p-5"><p className="font-black">나</p><p className="mt-1 text-2xl font-black">{me?.completedAllPuzzles ? "완료" : "진행"} · {me?.totalFoundCount ?? 0}/{me?.totalDifferenceCount ?? game.snapshot.totalDifferenceCount}</p><p className="mt-2 font-black text-violet-700">총점 {formatScore(me?.score)}점</p><p className="text-sm text-slate-500">찾기 {(me?.totalFoundCount ?? 0) * 10}점 + 시간 {formatScore(me?.timeBonus)}점 · 오답 {me?.wrongAnswerCount ?? 0}</p></div><div className="rounded-2xl bg-slate-100 p-5"><p className="font-black">{opponent?.nickname}</p><p className="mt-1 text-2xl font-black">{opponent?.completedAllPuzzles ? "완료" : "진행"} · {opponent?.totalFoundCount ?? 0}/{opponent?.totalDifferenceCount ?? game.snapshot.totalDifferenceCount}</p><p className="mt-2 font-black text-slate-700">총점 {formatScore(opponent?.score)}점</p><p className="text-sm text-slate-500">찾기 {(opponent?.totalFoundCount ?? 0) * 10}점 + 시간 {formatScore(opponent?.timeBonus)}점</p></div></div><p className="mt-4 text-sm font-bold text-slate-500">차이점 1개당 10점, 전체 완료 시 남은 시간 1초당 0.5점을 더합니다.</p><button onClick={game.returnToLobby} className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-7 py-4 font-black text-white"><RotateCcw size={19}/>로비로 돌아가기</button></section>}

    {game.snapshot.state === "CANCELLED" && <section className="mx-auto max-w-2xl rounded-3xl bg-white p-10 text-center shadow-xl"><div className="text-7xl">🛠️</div><h2 className="mt-4 text-3xl font-black">경기가 취소되었습니다</h2><p className="mt-2 text-slate-500">{game.snapshot.cancelReason}</p><button onClick={game.returnToLobby} className="mt-7 rounded-2xl bg-violet-600 px-7 py-4 font-black text-white">로비로 돌아가기</button></section>}

    {(game.snapshot.state === "FINISHED" || game.snapshot.state === "CANCELLED") && <div className="mx-auto mt-4 flex max-w-2xl justify-center gap-2 rounded-2xl bg-white p-4 shadow"><select value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)} disabled={Boolean(game.reportId)} className="rounded-xl border px-3 py-2"><option value="UNFAIR">불공정한 문제</option><option value="INAPPROPRIATE">부적절한 표현</option><option value="SYSTEM_ERROR">시스템 오류</option><option value="OTHER">기타</option></select><button disabled={Boolean(game.reportId)} onClick={() => game.report(reportReason)} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 font-bold text-white disabled:bg-emerald-600"><Flag size={16}/>{game.reportId ? "신고 완료" : "문제 신고"}</button></div>}

    {!game.connected && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-4"><div className="rounded-3xl bg-white p-8 text-center"><WifiOff className="mx-auto text-red-500" size={48}/><h3 className="mt-3 text-xl font-black">서버와 다시 연결 중입니다</h3></div></div>}
    {game.error && <button onClick={game.clearError} className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-red-600 px-5 py-3 font-bold text-white shadow-xl">{game.error.message} · 닫기</button>}
  </Shell>;
}
