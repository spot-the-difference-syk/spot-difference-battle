import { GAME_PUZZLE_ASSET_MANIFEST } from "@spot-battle/shared";
import type {
  AnswerRegion,
  FoundMark,
  GameErrorPayload,
  GamePuzzleId,
  GameSnapshot,
  GrowthView,
  GuessResult,
  MatchSettings,
  MatchFoundPayload,
  NormalizedPoint,
  ReportReason,
  RewardSummary,
  SessionReadyPayload,
} from "@spot-battle/shared";
import { useEffect, useRef, useState } from "react";
import { createGameConnection, type GameConnection } from "../transport/game-connection.js";
import { resolveServerUrl } from "../../../config/server-url.js";
import { shouldAcceptGameSnapshot } from "../model/game-snapshot.js";

type GameSocket = GameConnection;
type LobbyPhase = "NICKNAME" | "LOBBY" | "MATCHING" | "IN_GAME";

const SERVER_URL = resolveServerUrl(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.DEV,
  window.location.href,
);
const NICKNAME_KEY = "spot-battle.nickname";
/** Errors that mean the queue request was rejected, so the matching screen must close. */
const QUEUE_REJECTION_CODES = new Set(["ALREADY_IN_MATCH", "INVALID_NICKNAME", "INVALID_SETTINGS", "SERVER_BUSY"]);
/** Errors the UI already explains (lock badge, throttling) and that should not raise a toast. */
const SILENT_ERROR_CODES = new Set(["INPUT_RATE_LIMITED", "INPUT_LOCKED"]);
/** Slightly above the server's 120ms guess interval so double taps never hit the server limit. */
const CLIENT_GUESS_INTERVAL_MS = 150;
const GUEST_TOKEN_KEY = "spot-battle.guest-token";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The game can still run for the current session when WebView storage is unavailable.
  }
}

export function useGameClient() {
  const socketRef = useRef<GameSocket | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(null);
  const storedNickname = readStorage(NICKNAME_KEY);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<LobbyPhase>(() => storedNickname ? "LOBBY" : "NICKNAME");
  const [nickname, setNickname] = useState(() => storedNickname ?? "");
  const [match, setMatch] = useState<MatchFoundPayload | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [lastGuess, setLastGuess] = useState<GuessResult | null>(null);
  const [foundMarks, setFoundMarks] = useState<FoundMark[]>([]);
  const [error, setError] = useState<GameErrorPayload | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [growth, setGrowth] = useState<GrowthView | null>(null);
  const [matchRewards, setMatchRewards] = useState<Readonly<Record<string, RewardSummary>>>({});
  const [soloResult, setSoloResult] = useState<{ reward: RewardSummary | null; limitReached: boolean } | null>(null);
  const soloPendingRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const dismissedRef = useRef(new Set<string>());
  const lastGuessAtRef = useRef(0);

  useEffect(() => {
    const socket = createGameConnection(SERVER_URL, readStorage(GUEST_TOKEN_KEY), import.meta.env.VITE_GAME_TRANSPORT);
    socketRef.current = socket;
    socket.on("session:ready", ({ guestToken }: SessionReadyPayload) => {
      writeStorage(GUEST_TOKEN_KEY, guestToken);
      socket.auth = { guestToken };
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("match:found", (payload) => {
      // The server may resume a finished match whose dismissal never reached it while offline.
      if (dismissedRef.current.has(payload.matchId)) {
        socket.emit("game:dismiss", { matchId: payload.matchId });
        return;
      }
      snapshotRef.current = null;
      setMatch(payload);
      setSnapshot(null);
      setFoundMarks([]);
      setLastGuess(null);
      setReportId(null);
      setPhase("IN_GAME");
    });
    socket.on("game:snapshot", (next) => {
      if (dismissedRef.current.has(next.matchId)) return;
      // Server deadlines are absolute; correct for the device clock (network delay makes this slightly conservative).
      if (typeof next.serverNowMs === "number") setClockOffsetMs(next.serverNowMs - Date.now());
      if (!shouldAcceptGameSnapshot(snapshotRef.current, next)) return;
      const puzzleChanged = snapshotRef.current?.currentPuzzleId !== next.currentPuzzleId;
      snapshotRef.current = next;
      setSnapshot(next);
      setFoundMarks(next.foundMarks);
      if (puzzleChanged) setLastGuess(null);
    });
    socket.on("game:guess-result", (result) => {
      setLastGuess(result);
      if (result.correct && result.differenceId && result.region && !result.puzzleCompleted) {
        const differenceId = result.differenceId;
        const region: AnswerRegion = result.region;
        setFoundMarks((current) => current.some((mark) => mark.differenceId === differenceId)
          ? current
          : [...current, { differenceId, region }]);
      }
    });
    socket.on("game:error", (payload) => {
      if (QUEUE_REJECTION_CODES.has(payload.code) && phaseRef.current === "MATCHING") setPhase("LOBBY");
      if (SILENT_ERROR_CODES.has(payload.code)) return;
      setError(payload);
    });
    socket.on("game:report-result", ({ reportId: id }) => setReportId(id));
    socket.on("player:growth", (payload) => {
      setGrowth(payload.progress);
      const { matchId, reward } = payload;
      if (matchId && reward) setMatchRewards((current) => ({ ...current, [matchId]: reward }));
      // A plain sync after reconnecting carries neither field, so it does not settle a pending solo result.
      if (!matchId && soloPendingRef.current && (reward || payload.soloLimitReached)) {
        soloPendingRef.current = false;
        setSoloResult({ reward: reward ?? null, limitReached: Boolean(payload.soloLimitReached) });
      }
    });
    socket.on("queue:left", () => setPhase("LOBBY"));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  const actionContext = () => snapshotRef.current
    ? { expectedState: snapshotRef.current.state, expectedStateVersion: snapshotRef.current.stateVersion }
    : null;

  return {
    connected,
    phase,
    /** Current time on the server clock. Use for every comparison against server deadlines. */
    serverNow: () => Date.now() + clockOffsetMs,
    nickname,
    match,
    snapshot,
    lastGuess,
    foundMarks,
    error,
    reportId,
    clearError: () => setError(null),
    /** 서버가 보낸 레벨·코인. 연결 전에는 null. */
    growth,
    /** 경기별로 받은 보상 */
    matchRewards,
    /** 마지막 솔로 완주 보상 결과 */
    soloResult,
    completeSolo: (puzzleId: string, elapsedMs: number) => {
      soloPendingRef.current = true;
      setSoloResult(null);
      socketRef.current?.emit("solo:complete", { puzzleId, elapsedMs });
    },
    saveNickname: (value: string) => {
      const normalized = value.trim().slice(0, 16);
      if (normalized.length < 2) {
        setError({ code: "INVALID_NICKNAME", message: "닉네임은 2자 이상 입력해주세요." });
        return false;
      }
      writeStorage(NICKNAME_KEY, normalized);
      setNickname(normalized);
      setError(null);
      setPhase("LOBBY");
      return true;
    },
    startMatching: (settings: MatchSettings) => {
      if (!connected || !nickname) return;
      setError(null); setSnapshot(null); setMatch(null); setPhase("MATCHING");
      socketRef.current?.emit("queue:join", { nickname, settings });
    },
    cancelMatching: () => {
      socketRef.current?.emit("queue:leave");
      setPhase("LOBBY");
    },
    ready: () => match && socketRef.current?.emit("game:ready", { matchId: match.matchId }),
    loaded: (puzzleId: GamePuzzleId) => match && socketRef.current?.emit("game:loaded", {
      matchId: match.matchId,
      puzzleId,
      puzzleVersion: GAME_PUZZLE_ASSET_MANIFEST[puzzleId].version,
    }),
    guess: (puzzleId: GamePuzzleId, point: NormalizedPoint) => {
      const now = Date.now();
      if (now - lastGuessAtRef.current < CLIENT_GUESS_INTERVAL_MS) return;
      lastGuessAtRef.current = now;
      const context = actionContext();
      if (match && context) socketRef.current?.emit("game:guess", { matchId: match.matchId, puzzleId, point, ...context });
    },
    forfeit: () => {
      const context = actionContext();
      if (match && context) socketRef.current?.emit("game:forfeit", { matchId: match.matchId, ...context });
    },
    report: (reason: ReportReason, details?: string) => {
      const context = actionContext();
      if (match && context) socketRef.current?.emit("game:report", { matchId: match.matchId, reason, details, ...context });
    },
    returnToLobby: () => {
      if (match) {
        dismissedRef.current.add(match.matchId);
        socketRef.current?.emit("game:dismiss", { matchId: match.matchId });
      }
      snapshotRef.current = null; setMatch(null); setSnapshot(null); setFoundMarks([]); setReportId(null); setPhase("LOBBY");
    },
  };
}
