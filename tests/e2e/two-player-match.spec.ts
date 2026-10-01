import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { GAME_PUZZLES } from "../../apps/server/src/game/puzzle-catalog.js";
import { GAME_PUZZLE_IDS, type GamePuzzleId } from "@spot-battle/shared";

async function createPlayer(browser: Browser, nickname: string, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("닉네임").fill(nickname);
  await page.getByTestId("nickname-submit").click();
  return { context, page };
}

async function clickNormalized(page: Page, x: number, y: number) {
  const image = page.getByRole("img", { name: /변경본$/ });
  const box = await image.boundingBox();
  if (!box) throw new Error("변경본 이미지 좌표를 찾을 수 없습니다.");
  await image.click({ position: { x: box.width * x, y: box.height * y } });
  await page.waitForTimeout(160);
}

function pointsForPuzzle(puzzleId: string | null): Array<{ x: number; y: number }> {
  const puzzle = GAME_PUZZLES.find((candidate) => candidate.id === puzzleId as GamePuzzleId);
  if (!puzzle) throw new Error(`등록되지 않은 문제 ID입니다: ${puzzleId}`);
  return puzzle.differences.map(({ regions }) => {
    const [point] = regions;
    if (!point) throw new Error(`정답 영역이 없는 문제입니다: ${puzzleId}`);
    return point;
  });
}
test("the first player to clear the deck wins immediately", async ({ browser }) => {
  const first = await createPlayer(browser, "빠른사람", { width: 1280, height: 900 });
  const second = await createPlayer(browser, "도전자", { width: 390, height: 844 });
  try {
    await Promise.all([
      first.page.getByTestId("matchmaking-start").click(),
      second.page.getByTestId("matchmaking-start").click(),
    ]);
    await Promise.all([
      expect(first.page.getByTestId("ready-screen")).toBeVisible(),
      expect(second.page.getByTestId("ready-screen")).toBeVisible(),
    ]);
    await Promise.all([
      first.page.getByTestId("ready-button").click(),
      second.page.getByTestId("ready-button").click(),
    ]);
    await Promise.all([
      expect(first.page.getByTestId("countdown-screen")).toBeVisible(),
      expect(second.page.getByTestId("countdown-screen")).toBeVisible(),
    ]);
    await Promise.all([
      expect(first.page.getByTestId("playing-screen")).toBeVisible({ timeout: 6_000 }),
      expect(second.page.getByTestId("playing-screen")).toBeVisible({ timeout: 6_000 }),
    ]);
    await expect(first.page.getByRole("img", { name: /원본$/ })).toBeVisible();
    await expect(first.page.getByRole("img", { name: /변경본$/ })).toBeVisible();

    await first.page.getByTestId("original-board").click();
    await expect(first.page.getByRole("status")).toContainText("수정본에서 선택해주세요");
    await expect(first.page.getByText(`나 1/${GAME_PUZZLE_IDS.length}번 · 0/3`, { exact: true })).toBeVisible();

    const playingScreen = first.page.getByTestId("playing-screen");
    const firstPuzzleId = await playingScreen.getAttribute("data-puzzle-id");
    const firstPoints = pointsForPuzzle(firstPuzzleId);
    const mobileImage = second.page.getByRole("img", { name: /변경본$/ });
    const imageBeforeZoom = await mobileImage.boundingBox();
    await second.page.getByRole("button", { name: "확대" }).click();
    await second.page.getByRole("button", { name: "확대" }).click();
    await expect(second.page.getByTestId("zoom-controls")).toContainText("2.0배");
    const imageAfterZoom = await mobileImage.boundingBox();
    expect(imageAfterZoom!.width).toBeGreaterThan(imageBeforeZoom!.width * 1.9);

    const mobileBoard = second.page.getByTestId("modified-board");
    await mobileBoard.scrollIntoViewIfNeeded();
    const boardBox = await mobileBoard.boundingBox();
    if (!boardBox) throw new Error("모바일 변경본 보드를 찾을 수 없습니다.");
    await second.page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2);
    await second.page.mouse.down();
    await second.page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2 + 120, { steps: 5 });
    await second.page.mouse.up();
    const totalPuzzleCount = GAME_PUZZLE_IDS.length;
    await expect(second.page.getByText(`나 1/${totalPuzzleCount}번 · 0/3`, { exact: true })).toBeVisible();
    await second.page.getByRole("button", { name: "원래 크기" }).click();
    await expect(second.page.getByTestId("zoom-controls")).toContainText("1.0배");

    await clickNormalized(second.page, firstPoints[0]!.x, firstPoints[0]!.y);
    await expect(second.page.getByText(`나 1/${totalPuzzleCount}번 · 1/3`, { exact: true })).toBeVisible();
    for (let puzzleIndex = 0; puzzleIndex < totalPuzzleCount; puzzleIndex += 1) {
      const puzzleId = await playingScreen.getAttribute("data-puzzle-id");
      const points = pointsForPuzzle(puzzleId);
      for (const point of points) await clickNormalized(first.page, point.x, point.y);
      if (puzzleIndex < totalPuzzleCount - 1) {
        await expect(playingScreen).not.toHaveAttribute("data-puzzle-id", puzzleId ?? "", {
          timeout: 5_000,
        });
      }
    }

    await expect(first.page.getByTestId("finished-screen")).toContainText("승리했습니다", { timeout: 5_000 });
    await expect(second.page.getByTestId("finished-screen")).toContainText("패배했습니다", { timeout: 5_000 });
    await expect(first.page.getByTestId("finished-screen")).toContainText("전체 문제 먼저 완료");
  } finally {
    await first.context.close();
    await second.context.close();
  }
});
