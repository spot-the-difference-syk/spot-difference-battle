import { expect, test, type Page } from "@playwright/test";

async function clickNormalized(page: Page, x: number, y: number) {
  const board = page.getByTestId("modified-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("솔로 변경본 보드를 찾을 수 없습니다.");
  await board.click({ position: { x: box.width * x, y: box.height * y } });
}

test("a solo player can finish five hard differences and keep a personal record", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByLabel("닉네임").fill("혼자찾기");
  await page.getByTestId("nickname-submit").click();
  await page.getByTestId("solo-mode-open").click();

  await expect(page.getByRole("heading", { name: "솔로 타임어택" })).toBeVisible();
  await expect(page.getByText("최고 기록 없음")).toHaveCount(5);
  await page.getByTestId("solo-puzzle-start").click();
  await expect(page.getByTestId("solo-playing")).toBeVisible({ timeout: 6_000 });
  // 3초보다 빠른 완주는 서버가 비정상 기록으로 보고 보상하지 않는다.
  await page.waitForTimeout(3_100);

  for (const point of [
    { x: 0.31, y: 0.21 },
    { x: 0.56, y: 0.27 },
    { x: 0.924, y: 0.75 },
    { x: 0.17, y: 0.478 },
    { x: 0.32, y: 0.93 },
  ]) {
    await clickNormalized(page, point.x, point.y);
  }

  await expect(page.getByTestId("solo-finished")).toContainText("5개 모두 찾았어요!");
  await expect(page.getByTestId("solo-finished")).toContainText("개인 최고기록");
  await expect(page.getByTestId("reward-panel")).toContainText("+30");
  await page.getByRole("button", { name: "다른 문제" }).click();
  await expect(page.getByText(/최고 \d+\.\d{2}초/)).toHaveCount(1);
  await page.getByRole("button", { name: "아침의 베이커리" }).click();
  await expect(page.getByTestId("solo-puzzle-start")).toContainText("아침의 베이커리 시작");
  await page.getByTestId("solo-puzzle-start").click();
  await expect(page.getByTestId("solo-playing")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("발견 0/5", { exact: true })).toBeVisible();
  await expect(page.getByText("오답 0", { exact: true })).toBeVisible();
  await clickNormalized(page, 0.72, 0.31);
  await expect(page.getByText("발견 1/5", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
