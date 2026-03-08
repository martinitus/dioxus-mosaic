import { test, expect } from "@playwright/test";
import { openApp, getPanelCount, getPanelTitles, getPanelBoxMap } from "./helpers";

test.describe("Initial Layout", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("renders 3 panels with correct titles", async ({ page }) => {
    const count = await getPanelCount(page);
    expect(count).toBe(3);

    const titles = await getPanelTitles(page);
    expect(titles).toEqual(["Files", "Editor", "Terminal"]);
  });

  test("Files panel is on the left at ~25% width", async ({ page }) => {
    const boxes = await getPanelBoxMap(page);
    const files = boxes["Files"];
    const editor = boxes["Editor"];
    const terminal = boxes["Terminal"];

    expect(files).toBeDefined();
    expect(editor).toBeDefined();
    expect(terminal).toBeDefined();

    const minX = Math.min(files.x, editor.x, terminal.x);
    const maxX = Math.max(
      files.x + files.width,
      editor.x + editor.width,
      terminal.x + terminal.width,
    );
    const totalWidth = maxX - minX;
    const filesRatio = files.width / totalWidth;

    expect(filesRatio).toBeGreaterThanOrEqual(0.18);
    expect(filesRatio).toBeLessThanOrEqual(0.36);
  });

  test("Editor is right of Files, Terminal is below Editor", async ({ page }) => {
    const boxes = await getPanelBoxMap(page);
    const files = boxes["Files"];
    const editor = boxes["Editor"];
    const terminal = boxes["Terminal"];

    expect(editor.x).toBeGreaterThanOrEqual(files.x + files.width - 10);
    expect(terminal.x).toBeGreaterThanOrEqual(files.x + files.width - 10);
    expect(editor.y).toBeLessThanOrEqual(terminal.y + 10);
    expect(terminal.y).toBeGreaterThanOrEqual(editor.y + editor.height - 12);
  });
});
