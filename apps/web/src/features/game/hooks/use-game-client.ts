import { GAME_PUZZLE_ASSET_MANIFEST } from "@spot-battle/shared";
import type {
  AnswerRegion,
  FoundMark,
  GameErrorPayload,
  GamePuzzleId,
  GameSnapshot,
  GuessResult,
  MatchSettings,
  MatchFoundPayload,
  NormalizedPoint,
  ReportReason,
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
      snapshotRef.current = null;
      setMatch(payload);
      setSnapshot(null);
      setFoundMarks([]);
      setLastGuess(null);
      setReportId(null);
      setPhase("IN_GAME");
    });
    socket.on("game:snapshot", (next) => {
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
    socket.on("game:error", setError);
    socket.on("game:report-result", ({ reportId: id }) => setReportId(id));
    socket.on("queue:left", () => setPhase("LOBBY"));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  const actionContext = () => snapshotRef.current
    ? { expectedState: snapshotRef.current.state, expectedStateVersion: snapshotRef.current.stateVersion }
    : null;

  return {
    connected,
    phase,
    nickname,
    match,
    snapshot,
    lastGuess,
    foundMarks,
    error,
    reportId,
    clearError: () => setError(null),
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
    cancelMatching: () => socketRef.current?.emit("queue:leave"),
    ready: () => match && socketRef.current?.emit("game:ready", { matchId: match.matchId }),
    loaded: (puzzleId: GamePuzzleId) => match && socketRef.current?.emit("game:loaded", {
      matchId: match.matchId,
      puzzleId,
      puzzleVersion: GAME_PUZZLE_ASSET_MANIFEST[puzzleId].version,
    }),
    guess: (puzzleId: GamePuzzleId, point: NormalizedPoint) => {
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
      snapshotRef.current = null; setMatch(null); setSnapshot(null); setFoundMarks([]); setReportId(null); setPhase("LOBBY");
    },
  };
}
