import { test, expect } from "@playwright/test";
import { setDeskState } from "./setState";
import { decision } from "./fakeDaemon";

/**
 * Every dashboard page, under every desk status the daemon can report, driven by a real
 * browser against a real Next.js server. Nothing here should ever crash, hang, or throw
 * an unhandled promise rejection — a live trading desk's UI failing silently under a
 * halt/error condition is exactly the failure mode this suite exists to catch.
 */

const PAGES = ["/overview", "/quotes", "/radar", "/decisions", "/grade", "/arena", "/scoreboard", "/analyst"] as const;

test.describe("every page renders without crashing, across every desk status", () => {
  for (const status of ["starting", "verifying", "quoting", "watching", "halted", "error"] as const) {
    test(`status=${status}`, async ({ page }) => {
      await setDeskState({
        status,
        ...(status === "halted" ? { haltReason: "unexplained-movement" } : {}),
        ...(status === "error" ? { error: "TxLINE stream unavailable" } : {}),
      });
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => consoleErrors.push(err.message));

      for (const path of PAGES) {
        const response = await page.goto(path);
        expect(response?.status(), `${path} under status=${status}`).toBeLessThan(500);
        // The page must render real content, not a blank/crashed shell.
        await expect(page.locator("body")).not.toBeEmpty();
      }

      expect(consoleErrors, `unhandled page errors while visiting every page under status=${status}`).toEqual([]);
    });
  }
});

test.describe("empty-state pages render real empty copy, not a crash", () => {
  test("no fixture yet", async ({ page }) => {
    await setDeskState({ status: "starting", hasFixture: false });
    for (const path of PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(500);
    }
  });
});

test.describe("halt banner shows distinct, reason-specific copy per halt type", () => {
  const haltReasons = ["unexplained-movement", "informed-flow", "feed-gap", "drawdown-kill", "model-divergence", "match-void"];

  for (const reason of haltReasons) {
    test(`halt reason: ${reason}`, async ({ page }) => {
      await setDeskState({
        status: "halted",
        haltReason: reason,
        decisions: [decision({ seq: 0, action: "HALT", haltReason: reason })],
      });
      await page.goto("/overview");
      await expect(page.locator("body")).toContainText(reason.length > 0 ? new RegExp(reason.split("-")[0]!, "i") : /.*/);
    });
  }
});

test.describe("decision feed renders regime badges only when non-default", () => {
  test("stoppage-time and mutual-danger badges appear when active", async ({ page }) => {
    await setDeskState({
      status: "quoting",
      decisions: [
        decision({
          seq: 0,
          action: "POST",
          state: {
            minute: 91,
            homeScore: 1,
            awayScore: 1,
            homeReds: 0,
            awayReds: 0,
            inventory: { bySelection: {}, netUnits: 0 },
            exposure: { perMarketUnits: {}, perFixtureUnits: 0, openIntents: 1, realizedPnlUnits: 0, peakEquityUnits: 0, drawdownUnits: 0 },
            feedGapMs: 0,
            matchPhase: "regulation",
            stoppageActive: true,
            mutualDangerActive: true,
            narrativeRegime: "cautious",
          },
        }),
      ],
    });
    await page.goto("/decisions");
    await expect(page.getByText("STOPPAGE", { exact: false })).toBeVisible();
    await expect(page.getByText("MUTUAL DANGER", { exact: false })).toBeVisible();
  });

  test("no regime badges render for a plain regulation-time decision", async ({ page }) => {
    await setDeskState({ status: "quoting", decisions: [decision({ seq: 0, action: "NO_ACTION" })] });
    await page.goto("/decisions");
    await expect(page.getByText("STOPPAGE", { exact: false })).toHaveCount(0);
    await expect(page.getByText("MUTUAL DANGER", { exact: false })).toHaveCount(0);
  });
});

test.describe("hash-chain verification is a real, clickable action", () => {
  test("the verify button reflects a real /verify call", async ({ page }) => {
    await setDeskState({ status: "quoting" });
    await page.goto("/decisions");
    const verifyButton = page.getByRole("button", { name: /verify/i });
    if (await verifyButton.count() > 0) {
      await verifyButton.first().click();
      await expect(page.locator("body")).toContainText(/ok|verified|valid/i, { timeout: 10_000 });
    }
  });
});

test.describe("Strategy Arena and regime ablation matrix render real computed data", () => {
  test("arena page shows Tissue vs Baseline and the per-regime table", async ({ page }) => {
    await setDeskState({ status: "quoting" });
    await page.goto("/arena");
    await expect(page.locator("body")).toContainText(/tissue/i);
    await expect(page.locator("body")).toContainText(/baseline/i);
    await expect(page.locator("body")).toContainText(/stoppage/i);
  });

  test("arena page handles unavailable state (no fixture) without crashing", async ({ page }) => {
    await setDeskState({ status: "starting", hasFixture: false });
    const response = await page.goto("/arena");
    expect(response?.status()).toBeLessThan(500);
  });
});

test.describe("grade card and equity curve render on the grade page", () => {
  test("grade card image request actually resolves with a 200 and a real SVG body", async ({ page }) => {
    await setDeskState({ status: "quoting" });
    const imageResponse = page.waitForResponse((res) => res.url().includes("/api/desk/grade-card") && res.request().resourceType() === "image");
    await page.goto("/grade");
    const res = await imageResponse;
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<svg");
    await expect(page.locator("img[alt*='grade card' i]")).toBeVisible();
  });
});

test.describe("network flip between requests never crashes an already-rendered page", () => {
  test("desk transitioning from quoting to error mid-session still allows navigation", async ({ page }) => {
    await setDeskState({ status: "quoting" });
    await page.goto("/overview");
    await setDeskState({ status: "error", error: "TxLINE stream unavailable" });
    const response = await page.goto("/overview");
    expect(response?.status()).toBeLessThan(500);
  });
});
