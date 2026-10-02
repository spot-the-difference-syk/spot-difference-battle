import { RANKING_RULES, WEEKLY_RANK_REWARDS, type RankingPeriod } from "@spot-battle/shared";
import { Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "../../gallery/components/Gallery";
import { LevelAvatar, titleName } from "../../gallery/components/Growth";
import type { GameClient } from "../../game/hooks/use-game-client";
import { formatSoloTime } from "../model/solo-engine";

const PERIOD_OPTIONS = [["week", "이번 주"], ["all", "전체"]] as const;
const [CHAMPION, PODIUM, TOP10] = WEEKLY_RANK_REWARDS;

/** 그림별 솔로 랭킹. 주간 순위는 월요일 0시(한국 시간)에 새로 시작한다. */
export function RankingBoard({ client, puzzleId, puzzleTitle, myBestMs, compact = false }: {
  client: GameClient;
  puzzleId: string;
  puzzleTitle: string;
  myBestMs?: number;
  compact?: boolean;
}) {
  const [period, setPeriod] = useState<RankingPeriod>("week");
  const ranking = client.rankings[`${puzzleId}|${period}`];
  const { connected, requestRanking } = client;

  useEffect(() => {
    if (connected) requestRanking(puzzleId, period);
  }, [connected, puzzleId, period]);

  const rows = compact ? ranking?.rows.slice(0, 10) : ranking?.rows;
  const meShown = ranking?.rows.some((row) => row.me && (!compact || row.rank <= 10));

  return <section data-testid="ranking-board" className={`ranking-board ${compact ? "compact" : ""}`} aria-label={`${puzzleTitle} 랭킹`}>
    <div className="ranking-head">
      <h2 className="section-title inline-flex items-center gap-2"><Trophy size={18} aria-hidden/>{puzzleTitle} 랭킹</h2>
      <Segmented label="랭킹 기간" value={period} options={PERIOD_OPTIONS} onChange={setPeriod}/>
    </div>
    {period === "week" && <p className="ranking-note">매주 월요일 0시에 새로 시작해요 · 1위 {CHAMPION.coins}코인과 &lsquo;{titleName(CHAMPION.titleId)}&rsquo; 칭호, 2~3위 {PODIUM.coins}코인, 상위 10% {TOP10.coins}코인과 &lsquo;{titleName(TOP10.titleId)}&rsquo; 칭호 · {RANKING_RULES.minParticipantsForReward}명 이상 참가한 그림만</p>}
    {!connected && !ranking ? <p className="ranking-empty">서버에 연결하면 랭킹을 볼 수 있어요.</p>
      : !ranking ? <div className="ranking-empty"><span className="spinner-ring small"/></div>
      : ranking.rows.length === 0 ? <p className="ranking-empty">{period === "week" ? "이번 주 첫 기록의 주인공이 되어보세요." : "아직 기록이 없어요."}</p>
      : <ol className="ranking-list">
        {rows!.map((row) => <li key={row.rank} className={`ranking-row ${row.me ? "me" : ""} ${row.rank <= 3 ? `top top-${row.rank}` : ""}`}>
          <span className="ranking-rank" aria-label={`${row.rank}위`}>{row.rank}</span>
          <LevelAvatar nickname={row.nickname} growth={null} size={34} profile={row.profile} avatar={row.avatar}/>
          <span className="ranking-name"><strong>{row.nickname}{row.me && <em> · 나</em>}</strong><small>{titleName(row.title)}</small></span>
          <b className="ranking-time">{formatSoloTime(row.elapsedMs)}</b>
        </li>)}
      </ol>}
    {ranking && !meShown && <p className="ranking-me">
      {ranking.me
        ? <>내 기록 {formatSoloTime(ranking.me.elapsedMs)} · {ranking.me.rank ? `${ranking.me.rank}위` : `${ranking.participants}명 중 순위 밖`}</>
        : myBestMs !== undefined && period === "week" ? <>이번 주에는 아직 기록이 없어요 · 개인 최고 {formatSoloTime(myBestMs)}</>
        : <>아직 내 기록이 없어요</>}
    </p>}
    {ranking && ranking.participants > 0 && <p className="ranking-count">{ranking.participants.toLocaleString("ko-KR")}명 참가</p>}
  </section>;
}
