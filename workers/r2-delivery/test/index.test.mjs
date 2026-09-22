import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import { handleRequest } from "../src/index.mjs";

const originalPath = "/puzzles/home-office/2026-08-28.2/runtime/original.webp";
const modifiedPath = "/puzzles/home-office/2026-08-28.2/runtime/modified.webp";

function environment(isMissing = false, failure = null) {
  const get = mock.fn(async () => {
    if (failure) throw failure;
    return isMissing ? null : ({ body: new Blob(["webp"]).stream(), httpEtag: '"abc123"' });
  });
  const put = mock.fn();
  const remove = mock.fn();
  const list = mock.fn();
  return { env: { PUZZLE_ASSETS: { get, put, delete: remove, list } }, get, put, remove, list };
}

function assertFailure(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.notEqual(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

function assertNoMutation({ put, remove, list }) {
  assert.equal(put.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);
  assert.equal(list.mock.callCount(), 0);
}

/** 로그를 모아 outcome 을 확인한다. */
function recorder() {
  const lines = [];
  const log = (outcome, detail) => lines.push({ outcome, ...detail });
  return { log, lines };
}

describe("R2 delivery canary", () => {
  for (const path of [originalPath, modifiedPath]) {
    test(`serves ${path}`, async () => {
      const { env, get } = environment();
      const response = await handleRequest(new Request(`https://canary.example${path}`), env);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "image/webp");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(await response.text(), "webp");
      assert.equal(get.mock.calls[0].arguments[0], path.slice(1));
    });
  }

  test("supports HEAD without returning a body", async () => {
    const { env } = environment();
    const response = await handleRequest(new Request(`https://canary.example${modifiedPath}`, { method: "HEAD" }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(await response.text(), "");
  });

  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    test(`rejects ${method} without accessing R2`, async () => {
      const { env, get } = environment();
      const response = await handleRequest(new Request(`https://canary.example${originalPath}`, { method }), env);
      assertFailure(response, 405);
      assert.equal(response.headers.get("Allow"), "GET, HEAD");
      assert.equal(get.mock.callCount(), 0);
    });
  }
});

/**
 * 이전에는 네 경우가 모두 404 라 로그에서 운영 사고를 골라낼 수 없었다.
 */
describe("거부 사유별 상태 코드", () => {
  const badPaths = [
    ["잘못된 버전 형식", "/puzzles/home-office/wrong/runtime/original.webp"],
    ["알 수 없는 kind", "/puzzles/home-office/2026-08-28.2/runtime/extra.webp"],
    ["traversal", "/puzzles/home-office/2026-08-28.2/runtime/%2e%2e/original.webp"],
    ["대문자 섞임", "/Puzzles/home-office/2026-08-28.2/runtime/original.webp"],
    ["끝에 슬래시", `${originalPath}/`],
    ["쿼리스트링", `${originalPath}?v=1`],
  ];

  for (const [label, path] of badPaths) {
    test(`400 — ${label}`, async () => {
      const { env, get } = environment();
      const { log, lines } = recorder();
      const response = await handleRequest(new Request(`https://canary.example${path}`), env, { log });
      assertFailure(response, 400);
      assert.equal(get.mock.callCount(), 0, "형식 위반은 R2 조회 전에 거부해야 한다");
      assert.equal(lines[0].outcome, "bad_path");
    });
  }

  test("404 — 형식은 맞지만 서빙 대상이 아닌 퍼즐", async () => {
    const { env, get } = environment();
    const { log, lines } = recorder();
    const response = await handleRequest(
      new Request("https://canary.example/puzzles/unknown/2026-08-28.2/runtime/original.webp"),
      env,
      { log },
    );
    assertFailure(response, 404);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(lines[0].outcome, "not_allowed");
    assert.equal(lines[0].pairId, "unknown");
  });

  test("404 — 형식은 맞지만 허용되지 않은 버전", async () => {
    const { env, get } = environment();
    const { log, lines } = recorder();
    const response = await handleRequest(
      new Request("https://canary.example/puzzles/home-office/2099-01-01.1/runtime/original.webp"),
      env,
      { log },
    );
    assertFailure(response, 404);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(lines[0].outcome, "not_allowed");
    assert.equal(lines[0].assetVersion, "2099-01-01.1");
  });

  test("502 — 허용된 경로인데 R2 에 객체가 없다", async () => {
    const { env, get } = environment(true);
    const { log, lines } = recorder();
    const response = await handleRequest(new Request(`https://canary.example${originalPath}`), env, { log });
    assertFailure(response, 502);
    assert.equal(get.mock.callCount(), 1, "허용된 경로이므로 R2 조회까지는 간다");
    assert.equal(lines[0].outcome, "asset_missing");
  });

  test("네 사유가 서로 다른 상태 코드를 쓴다", async () => {
    const statuses = new Set();
    for (const [path, missing] of [
      ["/puzzles/home-office/2026-08-28.2/runtime/%2e%2e/x.webp", false],
      ["/puzzles/unknown/2026-08-28.2/runtime/original.webp", false],
      [originalPath, true],
      [originalPath, false],
    ]) {
      const { env } = environment(missing);
      const response = await handleRequest(new Request(`https://canary.example${path}`), env, { log: () => {} });
      statuses.add(response.status);
    }
    assert.equal(statuses.size, 4, `구분 가능해야 한다: ${[...statuses]}`);
  });
  test("500 — R2 예외는 내부 정보를 노출하지 않고 no-store로 응답한다", async () => {
    const privateError = new Error("private R2 object detail");
    const context = environment(false, privateError);
    const { log, lines } = recorder();
    const response = await handleRequest(new Request(`https://canary.example${originalPath}`, {
      headers: { Authorization: "Bearer secret-token" },
    }), context.env, { log });
    const body = await response.text();

    assertFailure(response, 500);
    assert.equal(body, "Internal Server Error");
    assert.ok(!body.includes(privateError.message));
    assert.equal(lines[0].outcome, "internal_error");
    assert.deepEqual(lines[0], {
      outcome: "internal_error",
      method: "GET",
      pairId: "home-office",
      assetVersion: "2026-08-28.2",
      kind: "original",
    });
    const serializedLog = JSON.stringify(lines);
    assert.ok(!serializedLog.includes(privateError.message));
    assert.ok(!serializedLog.includes("canary.example"));
    assert.ok(!serializedLog.includes("secret-token"));
    assertNoMutation(context);
  });

  test("R2 mutation API는 성공과 모든 실패 경로에서 호출되지 않는다", async () => {
    const contexts = [
      [environment(), new Request(`https://canary.example${originalPath}`)],
      [environment(), new Request("https://canary.example/nope")],
      [environment(), new Request("https://canary.example/puzzles/unknown/2026-08-28.2/runtime/original.webp")],
      [environment(true), new Request(`https://canary.example${originalPath}`)],
      [environment(false, new Error("failure")), new Request(`https://canary.example${originalPath}`)],
      [environment(), new Request(`https://canary.example${originalPath}`, { method: "POST" })],
    ];
    for (const [context, request] of contexts) {
      await handleRequest(request, context.env, { log: () => {} });
      assertNoMutation(context);
    }
  });
});

describe("관측", () => {
  test("결과별로 로그 심각도가 갈린다", async () => {
    const sink = { log: mock.fn(), warn: mock.fn(), error: mock.fn() };
    const { createLogger } = await import("../src/index.mjs");
    const log = createLogger(sink);

    const { env: okEnv } = environment();
    await handleRequest(new Request(`https://canary.example${originalPath}`), okEnv, { log });
    const { env: missingEnv } = environment(true);
    await handleRequest(new Request(`https://canary.example${originalPath}`), missingEnv, { log });
    await handleRequest(new Request("https://canary.example/nope"), okEnv, { log });
    const { env: failedEnv } = environment(false, new Error("private R2 detail"));
    await handleRequest(new Request(`https://canary.example${originalPath}`), failedEnv, { log });

    assert.equal(sink.log.mock.callCount(), 1, "정상은 log");
    assert.equal(sink.error.mock.callCount(), 2, "R2 miss 와 internal error 는 error");
    assert.equal(sink.warn.mock.callCount(), 1, "거부는 warn");
    const internalLog = sink.error.mock.calls[1].arguments[0];
    assert.equal(JSON.parse(internalLog).outcome, "internal_error");
    assert.ok(!internalLog.includes("private R2 detail"));
  });

  test("로그가 JSON 한 줄이고 경로 조각만 담는다", async () => {
    const sink = { log: mock.fn(), warn: mock.fn(), error: mock.fn() };
    const { createLogger } = await import("../src/index.mjs");
    const { env } = environment();
    await handleRequest(
      new Request(`https://canary.example${originalPath}`, { headers: { Cookie: "secret=1" } }),
      env,
      { log: createLogger(sink) },
    );
    const line = sink.log.mock.calls[0].arguments[0];
    const parsed = JSON.parse(line);
    assert.equal(parsed.event, "asset_request");
    assert.equal(parsed.outcome, "ok");
    assert.equal(parsed.pairId, "home-office");
    assert.ok(!line.includes("secret"), "요청 헤더를 로그에 남기면 안 된다");
    assert.ok(!line.includes("canary.example"), "전체 URL 을 남기지 않는다");
  });
});

describe("캐시", () => {
  test("버전 고정 경로는 immutable 로 내려준다", async () => {
    const { env } = environment();
    const response = await handleRequest(new Request(`https://canary.example${originalPath}`), env, { log: () => {} });
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  });

  test("ETag 를 실어 보낸다", async () => {
    const { env } = environment();
    const response = await handleRequest(new Request(`https://canary.example${originalPath}`), env, { log: () => {} });
    assert.equal(response.headers.get("ETag"), '"abc123"');
  });

  test("If-None-Match 가 맞으면 304 로 본문을 아낀다", async () => {
    const { env } = environment();
    const { log, lines } = recorder();
    const response = await handleRequest(
      new Request(`https://canary.example${originalPath}`, { headers: { "If-None-Match": '"abc123"' } }),
      env,
      { log },
    );
    assert.equal(response.status, 304);
    assert.equal(await response.text(), "");
    assert.equal(lines[0].outcome, "not_modified");
  });

  test("ETag 가 다르면 본문을 보낸다", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request(`https://canary.example${originalPath}`, { headers: { "If-None-Match": '"stale"' } }),
      env,
      { log: () => {} },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "webp");
  });

  test("HEAD 에도 캐시 헤더가 붙는다", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request(`https://canary.example${originalPath}`, { method: "HEAD" }),
      env,
      { log: () => {} },
    );
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("ETag"), '"abc123"');
  });
});
