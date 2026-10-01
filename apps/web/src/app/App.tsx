import { GAME_DIFFICULTY_RULES, GAME_MODE_RULES, type GameDifficulty, type GameMode, type GamePuzzleId, type NormalizedPoint, type ReportReason } from "@spot-battle/shared";
import { Flag, LogOut, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader, BoardPair, PaperScreen, ProgressTrack, RESET_VIEWPORT, Segmented, StageScreen, ZoomControls, type AppTab } from "../features/gallery/components/Gallery";
import { ArtworkShelf, FeaturedArtwork, featuredArtwork } from "../features/gallery/components/Exhibition";
import { LevelAvatar, RewardPanel, titleName } from "../features/gallery/components/Growth";
import { DailyGoal, MyGallery } from "../features/gallery/components/MyGallery";
import { Wardrobe } from "../features/gallery/components/Wardrobe";
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

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const MODE_OPTIONS = [["STANDARD", "기본전"], ["SPRINT", "속도전"], ["SURVIVAL", "생존전"]] as const;
const MODE_DESCRIPTIONS: Record<GameMode, string> = {
  STANDARD: "제한시간 동안 가장 많이 찾기",
  SPRINT: "60초 초고속 대결",
  SURVIVAL: "오답 3번이면 바로 패배",
};
const DIFFICULTY_OPTIONS = [["EASY", "쉬움"], ["NORMAL", "보통"], ["HARD", "어려움"]] as const;
const DIFFICULTY_DESCRIPTIONS: Record<GameDifficulty, string> = {
  EASY: "넓은 판정",
  NORMAL: "기본 판정",
  HARD: "정밀 판정",
};

export default function App() {
  const game = useGameClient();
  const [tab, setTab] = useState<AppTab>("HOME");
  const [originalNoticeCount, setOriginalNoticeCount] = useState(0);
  const [nicknameInput, setNicknameInput] = useState(game.nickname);
  const [mode, setMode] = useState<GameMode>("STANDARD");
  const [difficulty, setDifficulty] = useState<GameDifficulty>("NORMAL");
  const [reportReason, setReportReason] = useState<ReportReason>("UNFAIR");
  const [preloadError, setPreloadError] = useState<string | null>(null);
  const [preloadAttempt, setPreloadAttempt] = useState(0);
  const [imageViewport, setImageViewport] = useState<ImageViewport>(RESET_VIEWPORT);
  const loadedKeyRef = useRef<string | null>(null);
  const featured = useMemo(() => featuredArtwork(), []);
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
    setImageViewport(RESET_VIEWPORT);
    setOriginalNoticeCount(0);
  }, [puzzleId]);

  useEffect(() => {
    if (!originalNoticeCount) return;
    const timer = window.setTimeout(() => setOriginalNoticeCount(0), 3_000);
    return () => window.clearTimeout(timer);
  }, [originalNoticeCount]);

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
      .catch(() => setPreloadError("이미지를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해주세요."));
  }, [game.snapshot?.state, game.snapshot?.currentPuzzleId, game.snapshot?.nextPuzzleId, game.match?.matchId, preloadAttempt, me?.loaded, game.connected]);

  const switchTab = (next: AppTab) => { game.clearError(); setTab(next); };
  const loadout = game.growth?.loadout;

  if (game.phase === "NICKNAME") return <PaperScreen ambientSrc={featured.src}>
    <AppHeader/>
    <section className="center-card fade-up">
      <p className="eyebrow">처음 오셨네요</p>
      <h1 className="display-title mt-2">닉네임을 정해주세요</h1>
      <p className="muted mt-2 text-[15px]">대결 상대에게 이 이름이 보여요.</p>
      <input data-testid="nickname-input" aria-label="닉네임" autoFocus value={nicknameInput} placeholder="최대 16자" onChange={(event) => setNicknameInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && game.saveNickname(nicknameInput)} maxLength={16} className="text-field mt-8"/>
      <button data-testid="nickname-submit" type="button" onClick={() => game.saveNickname(nicknameInput)} className="btn-primary mt-3 w-full">시작하기</button>
    </section>
  </PaperScreen>;

  if (tab === "STYLE" && game.phase === "LOBBY") return <Wardrobe nickname={game.nickname} growth={game.growth} error={game.error} onTab={switchTab} onBuy={game.buyItem} onEquip={game.equipItem}/>;

  if (tab === "ME" && game.phase === "LOBBY") return <MyGallery nickname={game.nickname} growth={game.growth} onTab={switchTab}/>;

  if (tab === "SOLO") return <SoloGame nickname={game.nickname} growth={game.growth} soloResult={game.soloResult} onComplete={game.completeSolo} onTab={switchTab}/>;

  if (game.phase === "LOBBY") return <PaperScreen ambientSrc={featured.src}>
    <div className="has-tabbar">
      <AppHeader nickname={game.nickname} growth={game.growth} tab="HOME" onTab={switchTab}/>
      <div className="lobby-grid fade-up">
        <div>
          <p className="eyebrow">오늘의 전시</p>
          <h1 className="display-title mt-1">같은 그림 속<br/>다른 한 곳을 찾아보세요</h1>
          <FeaturedArtwork artwork={featured}/>
        </div>
        <div className="lobby-side">
          {game.growth && <DailyGoal goal={game.growth.daily}/>}
          <section className="panel grid gap-3">
            <h2 className="section-title">대결하기</h2>
            <Segmented label="게임 모드" value={mode} options={MODE_OPTIONS} onChange={setMode}/>
            <Segmented label="난이도" value={difficulty} options={DIFFICULTY_OPTIONS} onChange={setDifficulty}/>
            <p className="muted text-[13px] font-medium">{MODE_DESCRIPTIONS[mode]} · {GAME_MODE_RULES[mode].durationSeconds}초<br/>{DIFFICULTY_DESCRIPTIONS[difficulty]} · 오답 시 {GAME_DIFFICULTY_RULES[difficulty].wrongAnswerLockSeconds}초 잠금</p>
            <button data-testid="matchmaking-start" type="button" disabled={!game.connected} onClick={() => game.startMatching({ mode, difficulty })} className="btn-primary w-full">{game.connected ? "상대 찾기" : "서버 연결 중"}</button>
            <p className="muted text-center text-[12px]">그림을 모두 먼저 끝내면 바로 승리해요</p>
          </section>
          <ArtworkShelf/>
        </div>
      </div>
    </div>
  </PaperScreen>;

  if (game.phase === "MATCHING") return <PaperScreen ambientSrc={featured.src}>
    <AppHeader nickname={game.nickname} growth={game.growth}/>
    <section data-testid="matching-screen" className="center-card fade-up">
      <div className="spinner-ring"/>
      <h1 className="display-title mt-8">상대를 찾고 있어요</h1>
      <p className="muted mt-2 text-[15px]">같은 모드와 난이도를 고른 사람과 연결해요.</p>
      <button type="button" onClick={game.cancelMatching} className="btn-secondary mt-8">매칭 취소</button>
    </section>
  </PaperScreen>;

  if (!game.snapshot || !game.match) return <PaperScreen>
    <section className="center-card"><div className="spinner-ring"/><p className="muted mt-6">경기 정보를 불러오고 있어요</p></section>
  </PaperScreen>;

  const snapshot = game.snapshot;
  const total = snapshot.totalPuzzleCount;
  const canForfeit = !["FINISHED", "CANCELLED"].includes(snapshot.state);
  const forfeitButton = canForfeit && <button data-testid="forfeit-button" type="button" aria-label="기권하고 나가기" className="icon-button" onClick={() => window.confirm("경기를 나가면 기권패예요. 나갈까요?") && game.forfeit()}><LogOut size={17}/></button>;
  const overlays = <>
    {opponent?.connectionStatus === "RECONNECTING" && <div className="top-toast">상대의 연결이 끊겼어요 · 10초 동안 기다려요</div>}
    {!game.connected && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"><div className="panel w-full max-w-xs text-center text-[var(--ink)]"><WifiOff className="mx-auto text-[var(--mute)]" size={36}/><p className="mt-3 text-lg font-bold">서버와 다시 연결하고 있어요</p></div></div>}
    {game.error && <button type="button" onClick={game.clearError} className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#141414] px-5 py-3 text-sm font-semibold text-white shadow-xl">{game.error.message} · 닫기</button>}
  </>;

  if (snapshot.state === "PLAYING" && puzzle) {
    const myPuzzleNumber = Math.min((me?.completedPuzzleCount ?? 0) + 1, total);
    const found = me?.foundCount ?? 0;
    const differenceCount = me?.currentDifferenceCount ?? 0;
    const streak = me?.correctStreak ?? 0;
    const toast = inputLocked
      ? <span className="board-toast bad fade-up">틀렸어요 · {lockSeconds}초 잠금</span>
      : game.lastGuess && <span key={`${found}-${me?.wrongAnswerCount ?? 0}`} className={`board-toast fade-up ${game.lastGuess.correct ? "" : "bad"}`}>{game.lastGuess.correct ? (streak >= 2 ? `${streak}연속 정답이에요` : "정답이에요") : "틀렸어요"}</span>;
    return <StageScreen ambientSrc={puzzle.originalSrc} testId="playing-screen" puzzleId={puzzle.id}>
      {originalNoticeCount > 0 && <div role="status" className="top-toast fade-up">수정본에서 선택해주세요</div>}
      <div className="play-hud">
        <span className={`play-timer ${remaining !== null && remaining <= 10 ? "danger" : remaining !== null && remaining <= 30 ? "warn" : ""}`}>{remaining === null ? "—" : formatClock(remaining)}</span>
        <div className="flex items-center gap-2">
          <span className="versus" aria-label={`찾은 차이 나 ${me?.totalFoundCount ?? 0}, 상대 ${opponent?.totalFoundCount ?? 0}`}>
            <LevelAvatar nickname={game.nickname} growth={null} size={28} profile={loadout?.profile}/><span>{me?.totalFoundCount ?? 0}</span><span className="them">{opponent?.totalFoundCount ?? 0}</span><LevelAvatar nickname={opponent?.nickname ?? "?"} growth={null} size={28} profile={game.match.opponentCosmetics?.profile}/>
          </span>
          {forfeitButton}
        </div>
        <ProgressTrack done={me?.completedPuzzleCount ?? 0} total={total} partial={differenceCount ? found / differenceCount : 0}/>
        <div className="play-title">
          <div className="flex min-w-0 items-baseline gap-2"><h2 className="truncate">{puzzle.label}</h2><span data-testid="puzzle-progress" className="shrink-0 text-xs font-semibold text-white/50">{myPuzzleNumber} / {total}</span></div>
          <ZoomControls viewport={imageViewport} onChange={setImageViewport}/>
        </div>
      </div>
      <BoardPair
        frame={loadout?.frame}
        modifiedTag={<>여기서 찾기 · <span data-testid="found-progress">{found} / {differenceCount}</span></>}
        original={<ImageBoard src={puzzle.originalSrc} alt={`${puzzle.alt} 원본`} viewport={imageViewport} onPanBy={panImages} onSelect={() => setOriginalNoticeCount((count) => count + 1)}/>}
        modified={<ImageBoard src={puzzle.modifiedSrc} alt={`${puzzle.alt} 변경본`} marks={game.foundMarks} markStyle={loadout?.marker} viewport={imageViewport} onPanBy={panImages} onSelect={inputLocked ? undefined : (point) => game.guess(puzzle.id, point)}/>}
        overlay={toast}
      />
      {overlays}
    </StageScreen>;
  }

  if (snapshot.state === "COUNTDOWN") return <StageScreen ambientSrc={puzzle?.originalSrc}>
    <section data-testid="countdown-screen" className="center-card">
      <div key={remaining ?? 0} className="big-number tick">{remaining ?? 0}</div>
      <h1 className="mt-4 text-xl font-bold">곧 시작해요</h1>
      {puzzle && <p className="mt-1 text-sm text-white/55">첫 그림 · {puzzle.label}</p>}
    </section>
    {overlays}
  </StageScreen>;

  const iWon = snapshot.winnerId === game.match.playerId;
  const endReason = snapshot.endReason === "COMPLETED" ? "전체 문제 먼저 완료" : snapshot.endReason === "TIMEOUT" ? "제한시간 종료" : snapshot.endReason === "FORFEIT" ? (iWon ? "상대 기권" : "본인 기권") : snapshot.endReason === "MISTAKE_LIMIT" ? (iWon ? "상대 오답 3회" : "오답 3회") : "경기 종료";

  return <PaperScreen ambientSrc={puzzle?.originalSrc ?? featured.src}>
    <AppHeader nickname={game.nickname} growth={game.growth} trailing={forfeitButton}/>

    {snapshot.state === "READY" && <section data-testid="ready-screen" className="center-card fade-up">
      <p className="eyebrow">상대를 찾았어요</p>
      <h1 className="sr-only">상대: {game.match.opponentNickname}</h1>
      <div className="versus-card">
        <div className="grid justify-items-center gap-2"><LevelAvatar nickname={game.nickname} growth={null} size={64} profile={loadout?.profile}/><p className="font-bold">{game.nickname}</p><p className="muted text-[12px] font-semibold">{titleName(loadout?.title)}</p></div>
        <span className="vs">대</span>
        <div className="grid justify-items-center gap-2"><LevelAvatar nickname={game.match.opponentNickname} growth={null} size={64} profile={game.match.opponentCosmetics?.profile}/><p className="font-bold">{game.match.opponentNickname}</p><p className="muted text-[12px] font-semibold">{titleName(game.match.opponentCosmetics?.title)}</p></div>
      </div>
      <p className="muted mt-6 text-[15px]">두 사람 모두 같은 그림을 동시에 풀어요.</p>
      <button data-testid="ready-button" type="button" disabled={me?.ready} onClick={game.ready} className="btn-primary mt-6 w-full">{me?.ready ? "준비 완료 · 상대를 기다리는 중" : "준비 완료"}</button>
    </section>}

    {snapshot.state === "PRELOADING" && <section data-testid="preloading-screen" className="center-card fade-up">
      <div className="spinner-ring"/>
      <h1 className="display-title mt-8">그림을 준비하고 있어요</h1>
      <p className="muted mt-2 text-[15px]">두 사람 모두 준비되면 동시에 시작해요.</p>
      {preloadError && <div className="mt-6"><p className="font-semibold text-[#c0392b]">{preloadError}</p><button type="button" onClick={() => setPreloadAttempt((value) => value + 1)} className="btn-secondary mt-3">다시 시도</button></div>}
    </section>}

    {snapshot.state === "PLAYING" && !puzzle && <section data-testid="deck-complete-screen" className="center-card fade-up">
      <p className="eyebrow">모든 그림 완료</p>
      <h1 className="display-title mt-2">{me?.totalFoundCount ?? 0} / {me?.totalDifferenceCount ?? snapshot.totalDifferenceCount}</h1>
      <p className="muted mt-2 text-[15px]">결과를 확인하고 있어요.</p>
    </section>}

    {snapshot.state === "FINISHED" && <section data-testid="finished-screen" className="center-card fade-up text-left">
      <p className="eyebrow">{endReason}</p>
      <h1 className="display-title mt-1">{iWon ? "승리했어요" : snapshot.winnerId ? "아쉽게 패배했어요" : "무승부예요"}</h1>
      <div className="mt-6">
        <div className="list-row"><span>나</span><b>{formatScore(me?.score)}점</b></div>
        <p className="muted pt-2 text-[12px]">찾은 차이 {me?.totalFoundCount ?? 0} / {me?.totalDifferenceCount ?? snapshot.totalDifferenceCount} · 시간 보너스 {formatScore(me?.timeBonus)}점 · 오답 {me?.wrongAnswerCount ?? 0}</p>
        <div className="list-row muted"><span>{opponent?.nickname ?? "상대"}</span><b>{formatScore(opponent?.score)}점</b></div>
        <p className="muted pt-2 text-[12px]">찾은 차이 {opponent?.totalFoundCount ?? 0} / {opponent?.totalDifferenceCount ?? snapshot.totalDifferenceCount} · 시간 보너스 {formatScore(opponent?.timeBonus)}점</p>
      </div>
      <p className="muted mt-5 text-[12px]">차이 1개당 10점, 모두 끝내면 남은 시간 1초당 0.5점을 더해요.</p>
      <RewardPanel reward={game.matchRewards[game.match.matchId]} note={!iWon && snapshot.winnerId && snapshot.endReason === "FORFEIT" ? "기권한 경기는 보상이 없어요." : undefined}/>
      <button type="button" onClick={game.returnToLobby} className="btn-primary mt-7 w-full">로비로 돌아가기</button>
    </section>}

    {snapshot.state === "CANCELLED" && <section className="center-card fade-up">
      <h1 className="display-title">경기가 취소됐어요</h1>
      <p className="muted mt-2 text-[15px]">{snapshot.cancelReason}</p>
      <button type="button" onClick={game.returnToLobby} className="btn-primary mt-7 w-full">로비로 돌아가기</button>
    </section>}

    {(snapshot.state === "FINISHED" || snapshot.state === "CANCELLED") && <div className="center-card mt-6 flex items-center justify-center gap-2" style={{ margin: "24px auto 0" }}>
      <select aria-label="신고 사유" value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)} disabled={Boolean(game.reportId)} className="h-10 rounded-xl bg-[var(--soft)] px-3 text-sm font-semibold"><option value="UNFAIR">불공정한 문제</option><option value="INAPPROPRIATE">부적절한 표현</option><option value="SYSTEM_ERROR">시스템 오류</option><option value="OTHER">기타</option></select>
      <button type="button" disabled={Boolean(game.reportId)} onClick={() => game.report(reportReason)} className="btn-text inline-flex items-center gap-1"><Flag size={15}/>{game.reportId ? "신고했어요" : "문제 신고"}</button>
    </div>}
    {overlays}
  </PaperScreen>;
}
