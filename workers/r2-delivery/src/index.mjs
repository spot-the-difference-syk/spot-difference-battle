/**
 * Private R2 퍼즐 이미지 전달 Worker.
 *
 * 이 Worker 는 Supabase 를 조회하지 않는다. 게임 서버가 확정한
 * puzzleId 와 assetVersion 으로 브라우저가 URL 을 만들고, 여기서는
 * 허용된 경로만 R2 object key 로 매핑한다.
 */

/**
 * 허용 경로 형식.
 *   /puzzles/{pairId}/{assetVersion}/runtime/{original|modified}.webp
 *
 * 퍼센트 인코딩된 경로 조작(%2e%2e)은 pathname 단계에서 이 형식에 걸린다.
 */
const PATH_PATTERN =
  /^\/puzzles\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2}\.\d+)\/runtime\/(original|modified)\.webp$/;

/** 현재 canary 로 서빙하는 퍼즐. 활성 버전 전환은 형주 영역이다. */
const ALLOWED_ASSETS = new Set([
  "home-office/2026-08-28.2",
]);

/**
 * 결과 구분.
 *
 * 없는 객체, 잘못된 버전과 traversal 입력은 구분 가능한 상태 코드로 처리한다.
 *
 *   bad_path       400  경로 형식 위반. traversal·잘못된 버전 형식·알 수 없는 kind
 *   not_allowed    404  형식은 맞지만 서빙 대상이 아닌 puzzleId/assetVersion
 *   asset_missing  502  허용된 경로인데 R2 에 객체가 없다. 업로드 또는 카탈로그 사고
 *
 * 앞의 둘은 정상적인 거부이고 502 만 운영 장애다. 같은 404 로 묶으면
 * 로그에서 사고를 골라낼 수 없다.
 */
const OUTCOME = {
  ok: { status: 200, level: "log" },
  not_modified: { status: 304, level: "log" },
  bad_path: { status: 400, level: "warn", body: "Bad Request" },
  not_allowed: { status: 404, level: "warn", body: "Not Found" },
  asset_missing: { status: 502, level: "error", body: "Bad Gateway" },
  internal_error: { status: 500, level: "error", body: "Internal Server Error" },
  method_not_allowed: { status: 405, level: "warn", body: "Method Not Allowed" },
};

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff" };

/**
 * 경로에 assetVersion 이 박혀 있어 같은 URL 의 내용은 절대 바뀌지 않는다.
 * 퍼즐을 고치면 버전이 올라가 경로가 달라지므로 무효화가 필요 없다.
 * (이전 max-age=300 은 재방문마다 이미지를 다시 받게 했다.)
 */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const CACHEABLE_OUTCOMES = new Set(["ok", "not_modified"]);

/**
 * 구조화 로그 한 줄.
 *
 * 경로 조각만 남긴다. 전체 URL 이나 헤더는 남기지 않는다.
 * R2 binding 을 쓰므로 자격증명은 코드에도 로그에도 존재하지 않는다.
 */
function createLogger(sink = console) {
  return (outcome, detail = {}) => {
    const level = OUTCOME[outcome]?.level ?? "log";
    const write = sink[level] ?? sink.log;
    write.call(sink, JSON.stringify({ event: "asset_request", outcome, ...detail }));
  };
}

const defaultLog = createLogger();

function respond(outcome, { headers = {}, body = null } = {}) {
  const spec = OUTCOME[outcome];
  const cacheHeaders = CACHEABLE_OUTCOMES.has(outcome) ? {} : { "Cache-Control": "no-store" };
  return new Response(body ?? spec.body ?? null, {
    status: spec.status,
    headers: { ...BASE_HEADERS, ...cacheHeaders, ...headers },
  });
}

export async function handleRequest(request, env, options = {}) {
  const log = options.log ?? defaultLog;
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    log("method_not_allowed", { method });
    return respond("method_not_allowed", { headers: { Allow: "GET, HEAD" } });
  }

  const url = new URL(request.url);

  // 쿼리스트링은 쓰지 않는다. 허용하면 ?v=1,2,3... 으로 캐시를 쪼개
  // R2 요청을 늘릴 수 있다.
  if (url.search) {
    log("bad_path", { method, reason: "query_string" });
    return respond("bad_path");
  }

  const match = PATH_PATTERN.exec(url.pathname);
  if (!match) {
    log("bad_path", { method, reason: "path_format" });
    return respond("bad_path");
  }

  const [, pairId, assetVersion, kind] = match;
  if (!ALLOWED_ASSETS.has(`${pairId}/${assetVersion}`)) {
    log("not_allowed", { method, pairId, assetVersion, kind });
    return respond("not_allowed");
  }

  const key = `puzzles/${pairId}/${assetVersion}/runtime/${kind}.webp`;
  let object;
  try {
    object = await env.PUZZLE_ASSETS.get(key);
  } catch {
    log("internal_error", { method, pairId, assetVersion, kind });
    return respond("internal_error");
  }
  if (!object) {
    // 허용 목록에 있는데 객체가 없다. 업로드 누락이거나 카탈로그 불일치다.
    log("asset_missing", { method, pairId, assetVersion, kind });
    return respond("asset_missing");
  }

  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": IMMUTABLE_CACHE,
  };

  // R2 의 etag 를 그대로 흘려 조건부 요청이 성립하게 한다.
  // 없으면 재방문마다 본문 전체를 다시 보낸다.
  const etag = object.httpEtag ?? (object.etag ? `"${object.etag}"` : null);
  if (etag) {
    headers.ETag = etag;
    if (request.headers.get("if-none-match") === etag) {
      log("not_modified", { method, pairId, assetVersion, kind });
      return respond("not_modified", { headers });
    }
  }

  log("ok", { method, pairId, assetVersion, kind });
  return respond("ok", {
    headers,
    body: method === "HEAD" ? null : object.body,
  });
}

export default { fetch: handleRequest };
export { createLogger, PATH_PATTERN, ALLOWED_ASSETS };
