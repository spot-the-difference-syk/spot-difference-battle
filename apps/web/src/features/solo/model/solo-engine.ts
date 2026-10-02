/** 솔로 기록 표시. 판정과 시간 측정은 서버가 한다(SOLO_RULES). */
export function formatSoloTime(elapsedMs: number): string {
  return `${(elapsedMs / 1_000).toFixed(2)}초`;
}
