import { expect, test, type Page } from "@playwright/test";

async function clickNormalized(page: Page, x: number, y: number) {
  const board = page.getByTestId("modified-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("솔로 변경본 보드를 찾을 수 없습니다.");
  await board.click({ position: { x: box.width * x, y: box.height * y } });
}

test("a solo player finishes a server-judged run, keeps a record and enters the ranking", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByLabel("닉네임").fill("혼자찾기");
  await page.getByTestId("nickname-submit").click();
  await page.getByTestId("solo-mode-open").click();

  await expect(page.getByRole("heading", { name: "솔로 타임어택" })).toBeVisible();
  await expect(page.getByText("최고 기록 없음")).toHaveCount(5);
  await expect(page.getByTestId("ranking-board")).toContainText("매주 월요일 0시에 새로 시작해요");
  await page.getByTestId("solo-puzzle-start").click();
  await expect(page.getByTestId("solo-countdown")).toBeVisible();
  await expect(page.getByTestId("solo-playing")).toBeVisible({ timeout: 8_000 });
  // 3초보다 빠른 완주는 서버가 비정상 기록으로 보고 보상·순위에서 뺀다.
  await page.waitForTimeout(3_100);

  // 정답은 서버만 안다. 오답 한 번은 3초 페널티로 기록된다.
  await clickNormalized(page, 0.02, 0.02);
  await expect(page.getByText("오답 1", { exact: true })).toBeVisible();
  for (const [index, point] of [
    { x: 0.31, y: 0.21 },
    { x: 0.56, y: 0.27 },
    { x: 0.924, y: 0.75 },
    { x: 0.17, y: 0.478 },
    { x: 0.32, y: 0.93 },
  ].entries()) {
    await page.waitForTimeout(200);
    await clickNormalized(page, point.x, point.y);
    if (index < 4) await expect(page.getByText(`발견 ${index + 1}/5`, { exact: true })).toBeVisible();
  }

  await expect(page.getByTestId("solo-finished")).toContainText("5개 모두 찾았어요!");
  await expect(page.getByTestId("solo-finished")).toContainText("개인 최고기록");
  await expect(page.getByTestId("solo-finished")).toContainText("오답 1회 · 페널티 3초 포함");
  await expect(page.getByTestId("reward-panel")).toContainText("+30");
  await expect(page.getByTestId("solo-ranks")).toContainText("1위");
  await expect(page.getByTestId("ranking-board").locator(".ranking-row.me")).toContainText("혼자찾기");
  await page.getByRole("button", { name: "다른 문제" }).click();
  await expect(page.getByText(/최고 \d+\.\d{2}초/)).toHaveCount(1);
  await page.getByRole("button", { name: "아침의 베이커리" }).click();
  await expect(page.getByTestId("solo-puzzle-start")).toContainText("아침의 베이커리 시작");
  await page.getByTestId("solo-puzzle-start").click();
  await expect(page.getByTestId("solo-playing")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("발견 0/5", { exact: true })).toBeVisible();
  await expect(page.getByText("오답 0", { exact: true })).toBeVisible();
  await clickNormalized(page, 0.72, 0.31);
  await expect(page.getByText("발견 1/5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "그만하기" }).click();
  await page.getByTestId("style-open").click();
  await expect(page.getByRole("heading", { name: "나만의 전시 스타일" })).toBeVisible();
  await page.getByRole("button", { name: /얇은 원/ }).click();
  await expect(page.getByText("코인이 480개 부족해요")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
