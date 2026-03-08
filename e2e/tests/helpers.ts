import { type Page } from "@playwright/test";

export interface PanelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function openApp(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "commit", timeout: 60_000 });

  const appeared = await page
    .waitForSelector(".mosaic-tile-pane", { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector(".mosaic-tile-pane", { timeout: 60_000 });
  }

  await page.evaluate(() => document.querySelector(".dx-toast")?.remove());
}

export async function getPanelCount(page: Page): Promise<number> {
  return page.locator(".mosaic-tile-pane").count();
}

export async function getPanelTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".mosaic-tile-header")).map(
      (el) => (el.textContent || "").replace(/✕/g, "").trim(),
    ),
  );
}

export async function getPanelBoxMap(
  page: Page,
): Promise<Record<string, PanelBox>> {
  return page.evaluate(() => {
    const titles = Array.from(
      document.querySelectorAll(".mosaic-tile-header"),
    ).map((el) => (el.textContent || "").replace(/✕/g, "").trim());

    const panes = Array.from(document.querySelectorAll(".mosaic-tile-pane"));
    const result: Record<
      string,
      { x: number; y: number; width: number; height: number }
    > = {};

    for (let i = 0; i < titles.length && i < panes.length; i++) {
      const r = panes[i].getBoundingClientRect();
      result[titles[i]] = {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }
    return result;
  });
}

export async function getHeaderCenter(
  page: Page,
  title: string,
): Promise<{ x: number; y: number }> {
  const pos = await page.evaluate((t) => {
    const headers = Array.from(
      document.querySelectorAll(".mosaic-tile-header"),
    );
    const header = headers.find(
      (h) => (h.textContent || "").replace(/✕/g, "").trim() === t,
    );
    if (!header) return null;
    const r = header.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);

  if (!pos) throw new Error(`Header not found: ${title}`);
  return pos;
}

export async function getPanelBox(
  page: Page,
  title: string,
): Promise<PanelBox> {
  const box = await page.evaluate((t) => {
    const panes = Array.from(document.querySelectorAll(".mosaic-tile-pane"));
    const pane = panes.find((p) => {
      const h = p.querySelector(".mosaic-tile-header");
      return (h?.textContent || "").replace(/✕/g, "").trim() === t;
    });
    if (!pane) return null;
    const r = pane.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, title);

  if (!box) throw new Error(`Panel not found: ${title}`);
  return box;
}

// Playwright's built-in drag API dispatches synthetic JS events that Dioxus's
// WASM event system doesn't reliably pick up. CDP Input.dispatchMouseEvent
// generates real browser-level input events — matching the original Rust tests.

async function cdpSession(page: Page) {
  return page.context().newCDPSession(page);
}

type MouseEventType = "mousePressed" | "mouseMoved" | "mouseReleased";

async function dispatchMouse(
  session: Awaited<ReturnType<typeof cdpSession>>,
  type: MouseEventType,
  x: number,
  y: number,
  button: "left" | "none" = "none",
) {
  await session.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}

export async function simulateDrag(
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps = 14,
): Promise<void> {
  const n = Math.max(steps, 1);
  const session = await cdpSession(page);

  await dispatchMouse(session, "mouseMoved", startX, startY);
  await page.waitForTimeout(50);
  await dispatchMouse(session, "mousePressed", startX, startY, "left");
  await page.waitForTimeout(100);

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t;
    await dispatchMouse(session, "mouseMoved", x, y);
    await page.waitForTimeout(30);
  }

  await page.waitForTimeout(200);
  await dispatchMouse(session, "mouseReleased", endX, endY, "left");
  await session.detach();
}

export async function simulateDragHoverOnly(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
  targetRelX: number,
  targetRelY: number,
  steps = 12,
): Promise<void> {
  const start = await getHeaderCenter(page, sourceTitle);
  const target = await getPanelBox(page, targetTitle);
  const endX = target.x + target.width * targetRelX;
  const endY = target.y + target.height * targetRelY;

  const n = Math.max(steps, 1);
  const session = await cdpSession(page);

  await dispatchMouse(session, "mouseMoved", start.x, start.y);
  await page.waitForTimeout(50);
  await dispatchMouse(session, "mousePressed", start.x, start.y, "left");
  await page.waitForTimeout(100);

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = start.x + (endX - start.x) * t;
    const y = start.y + (endY - start.y) * t;
    await dispatchMouse(session, "mouseMoved", x, y);
    await page.waitForTimeout(30);
  }

  await page.waitForTimeout(200);
  await session.detach();
}
