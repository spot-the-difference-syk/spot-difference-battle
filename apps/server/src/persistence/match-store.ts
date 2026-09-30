import type { PersistedMatchState } from "@spot-battle/game-core";
import {
  DEFAULT_MATCH_SETTINGS,
  GAME_MODE_RULES,
  type GameSnapshot,
  type ReportReason,
} from "@spot-battle/shared";
import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";

export interface ReportInput {
  matchId: string;
  reporterPlayerId: string;
  reason: ReportReason;
  details?: string;
}

export interface MatchStore {
  health(): Promise<boolean>;
  loadGuests(): Promise<Array<{
    playerId: string;
    guestToken: string;
    nickname: string | null;
    updatedAt: number;
  }>>;
  upsertGuest(input: { playerId: string; guestToken: string; nickname: string | null }): Promise<void>;
  deleteGuest(playerId: string): Promise<void>;
  loadActiveMatches(): Promise<PersistedMatchState[]>;
  saveActiveMatch(state: PersistedMatchState): Promise<void>;
  deleteActiveMatch(matchId: string): Promise<void>;
  saveMatch(snapshot: GameSnapshot, state: PersistedMatchState): Promise<void>;
  createReport(input: ReportInput): Promise<string>;
  close(): Promise<void>;
}

export class InMemoryMatchStore implements MatchStore {
  readonly matches = new Map<string, GameSnapshot>();
  readonly completedMatchStates = new Map<string, PersistedMatchState>();
  readonly reports = new Map<string, ReportInput>();
  readonly guests = new Map<string, { guestToken: string; nickname: string | null; updatedAt: number }>();
  readonly activeMatches = new Map<string, PersistedMatchState>();

  async health(): Promise<boolean> {
    return true;
  }

  async loadGuests() {
    return [...this.guests.entries()].map(([playerId, guest]) => ({ playerId, ...guest }));
  }

  async loadActiveMatches(): Promise<PersistedMatchState[]> {
    return [...this.activeMatches.values()].map((state) => structuredClone(state));
  }

  async saveActiveMatch(state: PersistedMatchState): Promise<void> {
    this.activeMatches.set(state.matchId, structuredClone(state));
  }

  async deleteActiveMatch(matchId: string): Promise<void> {
    this.activeMatches.delete(matchId);
  }

  async upsertGuest(input: {
    playerId: string;
    guestToken: string;
    nickname: string | null;
  }): Promise<void> {
    this.guests.set(input.playerId, {
      guestToken: input.guestToken,
      nickname: input.nickname,
      updatedAt: Date.now(),
    });
  }

  async deleteGuest(playerId: string): Promise<void> {
    this.guests.delete(playerId);
  }

  async saveMatch(snapshot: GameSnapshot, state: PersistedMatchState): Promise<void> {
    if (this.matches.has(snapshot.matchId)) return;
    this.matches.set(snapshot.matchId, structuredClone(snapshot));
    this.completedMatchStates.set(snapshot.matchId, structuredClone(state));
  }

  async createReport(input: ReportInput): Promise<string> {
    const duplicate = [...this.reports.values()].some(
      (report) =>
        report.matchId === input.matchId &&
        report.reporterPlayerId === input.reporterPlayerId,
    );
    if (duplicate) throw new Error("DUPLICATE_REPORT");
    const reportId = randomUUID();
    this.reports.set(reportId, structuredClone(input));
    return reportId;
  }

  async close(): Promise<void> {}
}

/** Supabase PostgreSQL 전용 운영 저장소. */
export class SupabasePostgresMatchStore implements MatchStore {
  private readonly pool: Pool;

  constructor(connectionString: string, options: Pick<PoolConfig, "connectionTimeoutMillis" | "query_timeout" | "max"> = {}) {
    this.pool = new Pool({ connectionString, ...options });
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async loadGuests() {
    const result = await this.pool.query<{
      player_id: string;
      guest_token: string;
      nickname: string | null;
      updated_at: Date;
    }>("SELECT player_id, guest_token, nickname, updated_at FROM guest_sessions");
    return result.rows.map((row) => ({
      playerId: row.player_id,
      guestToken: row.guest_token,
      nickname: row.nickname,
      updatedAt: row.updated_at.getTime(),
    }));
  }

  async loadActiveMatches(): Promise<PersistedMatchState[]> {
    const result = await this.pool.query<{ state: PersistedMatchState }>(
      "SELECT state FROM active_matches ORDER BY updated_at",
    );
    return result.rows.map((row) => row.state);
  }

  async saveActiveMatch(state: PersistedMatchState): Promise<void> {
    await this.pool.query(
      `INSERT INTO active_matches (match_id, state)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (match_id) DO UPDATE
       SET state = EXCLUDED.state, updated_at = NOW()`,
      [state.matchId, JSON.stringify(state)],
    );
  }

  async deleteActiveMatch(matchId: string): Promise<void> {
    await this.pool.query("DELETE FROM active_matches WHERE match_id = $1", [matchId]);
  }

  async upsertGuest(input: {
    playerId: string;
    guestToken: string;
    nickname: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO guest_sessions (player_id, guest_token, nickname)
       VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE
       SET guest_token = EXCLUDED.guest_token,
           nickname = COALESCE(EXCLUDED.nickname, guest_sessions.nickname),
           updated_at = NOW()`,
      [input.playerId, input.guestToken, input.nickname],
    );
  }

  async deleteGuest(playerId: string): Promise<void> {
    await this.pool.query("DELETE FROM guest_sessions WHERE player_id = $1", [playerId]);
  }

  async saveMatch(snapshot: GameSnapshot, state: PersistedMatchState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const settings = state.settings ?? DEFAULT_MATCH_SETTINGS;
      const inserted = await client.query(
        `INSERT INTO matches
         (id, image_id, winner_player_id, end_reason, state_version, puzzle_manifest,
          mode, difficulty, duration_seconds, total_puzzle_count, total_difference_count,
          cancel_reason, final_state, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::jsonb, NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          snapshot.matchId,
          state.puzzles[0]?.id ?? "unknown",
          snapshot.winnerId,
          snapshot.endReason,
          snapshot.stateVersion,
          JSON.stringify(state.puzzles),
          settings.mode,
          settings.difficulty,
          GAME_MODE_RULES[settings.mode].durationSeconds,
          state.puzzles.length,
          state.puzzles.reduce((total, puzzle) => total + puzzle.differences.length, 0),
          state.cancelReason,
          JSON.stringify(state),
        ],
      );
      if (inserted.rowCount) {
        for (const player of state.players) {
          const progress = snapshot.players.find((candidate) => candidate.playerId === player.playerId)!;
          const result = snapshot.endReason === "CANCELLED"
            ? "CANCELLED"
            : snapshot.winnerId === null
              ? "DRAW"
              : snapshot.winnerId === player.playerId ? "WIN" : "LOSE";
          await client.query(
            `INSERT INTO match_players
             (match_id, player_id, nickname, found_count, wrong_answer_count, hints_used,
              connection_status, result, completed_puzzle_count, total_found_count,
              score, time_bonus, best_streak, completed_at, found_ids_by_puzzle)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                     CASE WHEN $14::bigint IS NULL THEN NULL ELSE to_timestamp($14::double precision / 1000.0) END,
                     $15::jsonb)`,
            [
              snapshot.matchId,
              player.playerId,
              player.nickname,
              player.foundIdsByPuzzle.reduce((total, ids) => total + ids.length, 0),
              player.wrongAnswerCount,
              0,
              player.connectionStatus,
              result,
              player.puzzleIndex,
              progress.totalFoundCount,
              progress.score,
              progress.timeBonus,
              player.bestStreak ?? 0,
              player.completedAtMs ?? null,
              JSON.stringify(player.foundIdsByPuzzle),
            ],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createReport(input: ReportInput): Promise<string> {
    const reportId = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO reports (id, match_id, reporter_player_id, reason, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, input.matchId, input.reporterPlayerId, input.reason, input.details ?? null],
      );
      return reportId;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("DUPLICATE_REPORT");
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** @deprecated SupabasePostgresMatchStore를 사용한다. */
export class PostgresMatchStore extends SupabasePostgresMatchStore {}
