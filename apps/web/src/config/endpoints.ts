import { resolveServerUrl } from "./server-url";

/** 게임 서버 주소. 실시간 연결과 카탈로그 조회에 같이 쓴다. 브라우저에서만 호출한다. */
export function gameServerUrl(): string {
  return resolveServerUrl(import.meta.env.VITE_SERVER_URL, import.meta.env.DEV, window.location.href);
}
