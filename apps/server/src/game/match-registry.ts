import { GameMatch, GameRuleError, type MatchPuzzle, type PersistedMatchState } from "@spot-battle/game-core";
import type { MatchSettings } from "@spot-battle/shared";
import { ACTIVE_GAME_PUZZLES, shuffledGamePuzzles } from "./puzzle-catalog.js";

export class MatchRegistry {
  private readonly matches = new Map<string, GameMatch>();
  private readonly playerMatches = new Map<string, string>();

  constructor(private readonly puzzles: readonly MatchPuzzle[] = ACTIVE_GAME_PUZZLES) {
    if (puzzles.length === 0) throw new Error("하나 이상의 게임 문제가 필요합니다.");
  }

  create(
    matchId: string,
    players: [{ playerId: string; nickname: string }, { playerId: string; nickname: string }],
    settings?: MatchSettings,
  ): GameMatch {
    const selected = this.puzzles === ACTIVE_GAME_PUZZLES ? shuffledGamePuzzles() : structuredClone(this.puzzles) as MatchPuzzle[];
    const match = new GameMatch(matchId, selected, players, undefined, settings);
    this.matches.set(matchId, match);
    for (const player of players) this.playerMatches.set(player.playerId, matchId);
    return match;
  }

  restore(state: PersistedMatchState): GameMatch {
    const match = GameMatch.restore(state);
    this.matches.set(match.matchId, match);
    for (const player of state.players) this.playerMatches.set(player.playerId, match.matchId);
    return match;
  }

  getForPlayer(matchId: string, playerId: string): GameMatch {
    const match = this.matches.get(matchId);
    if (!match || this.playerMatches.get(playerId) !== matchId) {
      throw new GameRuleError("MATCH_NOT_FOUND", "참가 중인 경기를 찾을 수 없습니다.");
    }
    return match;
  }

  getCurrentForPlayer(playerId: string): GameMatch | null {
    const matchId = this.playerMatches.get(playerId);
    return matchId ? this.matches.get(matchId) ?? null : null;
  }

  /** Stops resuming a finished match for a player who closed its result screen. */
  release(matchId: string, playerId: string): void {
    const match = this.matches.get(matchId);
    if (!match || !match.isTerminal || this.playerMatches.get(playerId) !== matchId) return;
    this.playerMatches.delete(playerId);
  }

  remove(matchId: string): boolean {
    const match = this.matches.get(matchId);
    if (!match) return false;
    this.matches.delete(matchId);
    for (const player of match.snapshot().players) {
      if (this.playerMatches.get(player.playerId) === matchId) this.playerMatches.delete(player.playerId);
    }
    return true;
  }

  expire(nowMs: number): GameMatch[] {
    const changed: GameMatch[] = [];
    for (const match of this.matches.values()) if (match.expire(nowMs)) changed.push(match);
    return changed;
  }
}
