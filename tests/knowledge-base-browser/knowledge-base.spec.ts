import { test, expect, type Page } from "@playwright/test";
import {
  Model,
  openBook,
  openSection,
  manager,
  assertCleared,
  deferred,
  forceClick,
  bodyBarrier,
  waitBody,
  releaseBody,
  markerKey,
} from "./helpers";
import * as f from "./fixture-data";
let model: Model;
test.beforeEach(async ({ page }) => {
  model = new Model(page);
  await model.install();
});
async function addBase(page: Page, name = "Safety Reference") {
  await page.getByRole("button", { name: "Add base", exact: true }).click();
  await page.getByLabel("Base name", { exact: true }).fill(name);
  await page
    .getByLabel("Base description", { exact: true })
    .fill("Original synthetic reference");
}
async function addText(
  page: Page,
  body = "  Legal plain text\n\n<script>no execution</script>",
) {
  await openSection(page);
  await page
    .getByRole("button", { name: "Add plain text", exact: true })
    .click();
  await page
    .getByLabel("Resource name", { exact: true })
    .fill("New working guide");
  await page.getByLabel("Plain text", { exact: true }).fill(body);
}
async function openText(page: Page) {
  await openSection(page);
  await page
    .getByRole("button", {
      name: "Open resource Welcome Handbook",
      exact: true,
    })
    .click();
  await expect(page.locator(".kb-text")).toBeVisible();
}
async function settleWrite(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: "Knowledge Base updated." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh Knowledge Base", exact: true }),
  ).toBeEnabled();
}
test("desktop hierarchy has real navigation, current shell link and compact original layout", async ({
  page,
}) => {
  await openSection(page);
  await expect(
    page.getByRole("button", { name: "Open folder Policies", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open folder Policies", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open resource Annual Leave",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("navigation", { name: "Knowledge Base path" }),
  ).toContainText("Company Information");
  await page.screenshot({
    path: "test-results/knowledge-base-desktop.png",
    fullPage: true,
  });
  const layout = await page.locator(".kb-workspace").boundingBox();
  expect(layout!.width).toBeGreaterThan(900);
  expect(
    await page
      .getByRole("button", { name: "Refresh Knowledge Base", exact: true })
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("14px");
  expect(model.writes()).toHaveLength(0);
});
test("plain text preserves whitespace and escapes apparent HTML", async ({
  page,
}) => {
  await openText(page);
  await expect(page.locator(".kb-text")).toHaveText(f.bodies.get(f.textId)!);
  await expect(page.locator(".kb-text script")).toHaveCount(0);
  expect(
    await page
      .locator(".kb-text")
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe("pre-wrap");
  expect(model.writes("view")).toHaveLength(0);
});
test("named link is explicit, safe and never fetched for metadata", async ({
  page,
}) => {
  await openSection(page);
  await page
    .getByRole("button", { name: "Open resource Company website", exact: true })
    .click();
  const link = page.getByRole("link", {
    name: "Open Company website externally ↗",
  });
  await expect(link).toHaveAttribute("href", "https://example.test/team");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("target", "_blank");
  expect(model.writes()).toHaveLength(0);
});
test("draft creation keeps searched and off-page selected Auth identities", async ({
  page,
}) => {
  await addBase(page);
  await expect(
    page.getByText("50 shown of 1005 matching eligible accounts."),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Select user Alex Morgan", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Load more eligible users", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Eligible account 0101",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Search eligible users", { exact: true }).fill("1005");
  await page
    .getByRole("button", { name: "Find eligible users", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Select user Eligible account 1005",
      exact: true,
    })
    .check();
  await expect(
    page.getByText("2 selected users", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await settleWrite(page);
  const mutation = model.writes("create_base")[0].body!;
  expect(mutation.change).toMatchObject({
    audienceIds: [f.actor, f.assigned(1005).actorId],
  });
  await expect(
    page
      .getByRole("heading", { name: "Safety Reference", exact: true })
      .first(),
  ).toBeVisible();
});
test("existing unavailable assignee remains visible and retained until explicit removal", async ({
  page,
}) => {
  await openBook(page);
  await page
    .getByRole("button", { name: "Edit assignments", exact: true })
    .click();
  await expect(
    page.getByText("Retained unavailable assignee · unavailable"),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Retained unavailable assignee",
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save assignments", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("set_audience")[0].body!.change).toMatchObject({
    audienceIds: f.audience.map((u) => u.actorId),
  });
});
test("draft can have empty audience; publication explicitly requires selected users", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Open base Field Operations", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish base", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Edit assignments", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select user Alex Morgan", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Save assignments", exact: true })
    .click();
  await settleWrite(page);
  await page.getByRole("button", { name: "Publish base", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Publish base?" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish base", exact: true })
    .click();
  await settleWrite(page);
  expect(model.bases[1].status).toBe("published");
});
test("base edit and archive/restore persist real revisioned lifecycle", async ({
  page,
}) => {
  await openBook(page);
  await page.getByRole("button", { name: "Edit base", exact: true }).click();
  await page.getByLabel("Base name", { exact: true }).fill("Working Handbook");
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await settleWrite(page);
  await page.getByRole("button", { name: "Archive base", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive base", exact: true })
    .click();
  await settleWrite(page);
  expect(model.bases[0]).toMatchObject({
    name: "Working Handbook",
    status: "archived",
    revision: 3,
  });
  await page.getByRole("button", { name: "Restore base", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore base", exact: true })
    .click();
  await settleWrite(page);
  expect(model.bases[0]).toMatchObject({ status: "published", revision: 4 });
  expect(model.writes("view")).toHaveLength(0);
});
test("creates legal plain-text content in the selected folder", async ({
  page,
}) => {
  await addText(page);
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("create_node")[0].body!.change).toMatchObject({
    parentId: f.sectionId,
    kind: "text",
    body: "  Legal plain text\n\n<script>no execution</script>",
  });
  await expect(
    page.getByRole("button", {
      name: "Open resource New working guide",
      exact: true,
    }),
  ).toBeVisible();
});
test("section action from hierarchy creates at base root while browsing deeper", async ({
  page,
}) => {
  await openSection(page);
  await page
    .getByRole("button", { name: "Add section from hierarchy", exact: true })
    .click();
  await page
    .getByLabel("Resource name", { exact: true })
    .fill("Emergency Reference");
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("create_node")[0].body!.change).toMatchObject({
    parentId: null,
    kind: "folder",
  });
});
test("sibling movement writes actual revisioned order and refreshes persisted order", async ({
  page,
}) => {
  await openBook(page);
  await page
    .getByRole("button", { name: "Move earlier Operations", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("order_node")[0].body!.change).toMatchObject({
    direction: "earlier",
    nodeRevision: 1,
    revision: 1,
  });
  const names = await page.locator(".kb-node-name > button").allTextContents();
  expect(names[0]).toBe("Operations");
});
test("real move chooses an active same-base folder and saves target identity", async ({
  page,
}) => {
  await openSection(page);
  await page
    .getByRole("button", {
      name: "Move resource Welcome Handbook",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Browse destination Operations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select this destination", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move resource", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("move_node")[0].body!.change).toMatchObject({
    nodeId: f.textId,
    parentId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    nodeRevision: 1,
  });
});
test("nonempty folder cannot archive; archived leaf restores explicitly", async ({
  page,
}) => {
  await openBook(page);
  await expect(
    page.getByRole("button", {
      name: "Archive resource Company Information",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Open folder Company Information",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Restore resource Previous Handbook",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore resource", exact: true })
    .click();
  await settleWrite(page);
  expect(model.nodes.find((n) => n.name === "Previous Handbook")).toMatchObject(
    { status: "active", revision: 2 },
  );
});
test("catalog exact counts exceed1000 independently of loaded50 and preserve keyset paging", async ({
  page,
}) => {
  model.extraBases = 1005;
  await page
    .getByRole("button", { name: "Refresh Knowledge Base", exact: true })
    .click();
  await expect(page.locator(".kb-counts")).toContainText("1005");
  await expect(page.locator(".kb-base-card")).toHaveCount(50);
  await page
    .getByRole("button", { name: "Load more bases", exact: true })
    .click();
  await expect(page.locator(".kb-base-card")).toHaveCount(100);
  expect(model.calls.at(-1)!.url.searchParams.get("cursor")).toBe("50");
});
test("title search is literal scoped and >1000 exact matches page without marking views", async ({
  page,
}) => {
  await openBook(page);
  model.extraSearch = 1005;
  await page
    .getByLabel("Search titles in this base", { exact: true })
    .fill("Policy");
  await page
    .getByRole("button", { name: "Find resources", exact: true })
    .click();
  const results = page.getByRole("region", {
    name: "Knowledge Base title results",
  });
  await expect(results).toContainText("1005");
  await page
    .getByRole("button", { name: "Load more title results", exact: true })
    .click();
  await expect(
    results.getByRole("button", { name: /^Open search result Policy / }),
  ).toHaveCount(100);
  expect(model.writes("view")).toHaveLength(0);
});
test("manager opens record only explicit rendered resources; refresh produces no extra event", async ({
  page,
}) => {
  await manager(page, model);
  await openSection(page);
  await page
    .getByRole("button", {
      name: "Open resource Welcome Handbook",
      exact: true,
    })
    .click();
  await expect.poll(() => model.events.length).toBe(3);
  await expect(
    page.getByRole("button", { name: "Refresh Knowledge Base", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Refresh Knowledge Base", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refresh Knowledge Base", exact: true }),
  ).toBeEnabled();
  expect(model.events.map((e) => e.change)).toEqual([
    {
      action: "view",
      baseId: f.bookId,
      revision: 1,
      nodeId: null,
      nodeRevision: null,
    },
    {
      action: "view",
      baseId: f.bookId,
      revision: 1,
      nodeId: f.sectionId,
      nodeRevision: 1,
    },
    {
      action: "view",
      baseId: f.bookId,
      revision: 1,
      nodeId: f.textId,
      nodeRevision: 1,
    },
  ]);
  expect(new Set(model.events.map((e) => e.operationId)).size).toBe(3);
  await expect(
    page.getByRole("button", { name: "Add plain text", exact: true }),
  ).toHaveCount(0);
});
test("zero-view chart renders no blue-height bars", async ({ page }) => {
  await openBook(page);
  await page
    .getByRole("button", { name: "Overall insights", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Knowledge Base insights" }),
  ).toContainText("0");
  const heights = await page
    .locator(".kb-chart span")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  expect(heights).toHaveLength(30);
  expect(heights.every((h) => h === 0)).toBe(true);
  await page.screenshot({
    path: "test-results/knowledge-base-zero-insights.png",
    fullPage: true,
  });
});
test("mixed chart zero days stay invisible while actual small counts have visible bars", async ({
  page,
}) => {
  model.chartViews = Array.from({ length: 30 }, (_, i) =>
    i === 3 ? "1" : i === 12 ? "500" : "0",
  );
  model.hugeTotal = "9007199254740993";
  await openBook(page);
  await page
    .getByRole("button", { name: "Overall insights", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Knowledge Base insights" }),
  ).toContainText("9007199254740993");
  const heights = await page
    .locator(".kb-chart span")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  expect(heights.filter((h) => h > 0)).toHaveLength(2);
  expect(heights[3]).toBeGreaterThanOrEqual(2);
  expect(heights[12]).toBeGreaterThan(100);
  await expect(
    page.getByRole("region", { name: "Knowledge Base insights" }),
  ).toContainText("1 unavailable");
});
test("zero eligible denominator is represented honestly without percentage or fake balance", async ({
  page,
}) => {
  model.audience.set(
    f.bookId,
    f.audience.map((u) => ({ ...u, eligible: false })),
  );
  model.bases[0].eligibleAudienceCount = 0;
  await openBook(page);
  await page
    .getByRole("button", { name: "Overall insights", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Knowledge Base insights" }),
  ).toContainText("No eligible audience");
});
for (const bad of [
  "javascript:alert(1)",
  "https://user:pass@example.test/path",
  "https://[::1]/",
  "https://xn--caf-dma.test/",
  "https://example.0xface/",
  "https://127.00.0.1/",
  "https://example.test:0/",
  "https://example.test/%oops",
])
  test(`unsupported link cannot save: ${bad}`, async ({ page }) => {
    await openSection(page);
    await page
      .getByRole("button", { name: "Add external link", exact: true })
      .click();
    await page.getByLabel("Resource name", { exact: true }).fill("Reference");
    await page.getByLabel("External URL", { exact: true }).fill(bad);
    await expect(
      page.getByRole("button", { name: "Save resource", exact: true }),
    ).toBeDisabled();
    expect(model.writes("create_node")).toHaveLength(0);
  });
test("supported Unicode path link persists exact unnormalized URL", async ({
  page,
}) => {
  await openSection(page);
  await page
    .getByRole("button", { name: "Add external link", exact: true })
    .click();
  await page
    .getByLabel("Resource name", { exact: true })
    .fill("Regional reference");
  await page
    .getByLabel("External URL", { exact: true })
    .fill("https://example.test:8443/café?language=日本語");
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("create_node")[0].body!.change).toMatchObject({
    url: "https://example.test:8443/café?language=日本語",
  });
});
for (const status of [401, 403, 503])
  test(`current leaf${status} clears all private hierarchy/content/drafts`, async ({
    page,
  }) => {
    await openSection(page);
    model.hook = (c) =>
      c.url.pathname.endsWith("/nodes/" + f.textId) ? { status } : undefined;
    await page
      .getByRole("button", {
        name: "Open resource Welcome Handbook",
        exact: true,
      })
      .click();
    await assertCleared(page);
    await expect(
      page.getByText("Company Handbook", { exact: true }),
    ).toHaveCount(0);
  });
test("malformed leaf identity clears private state and fails recovery closed", async ({
  page,
}) => {
  await openBook(page);
  model.hook = (c) =>
    c.url.pathname.endsWith("/insights")
      ? { data: { ...(model.read(c) as object), actorId: f.otherActor } }
      : undefined;
  await page
    .getByRole("button", { name: "Overall insights", exact: true })
    .click();
  await assertCleared(page);
  model.hook = () => ({ status: 503 });
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await assertCleared(page);
});
test("changed tree version between catalog/detail and child response fails closed", async ({
  page,
}) => {
  model.hook = (c) =>
    c.url.pathname.endsWith("/nodes")
      ? { data: { ...(model.read(c) as object), treeVersion: "different" } }
      : undefined;
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await assertCleared(page);
});
test("stale roster after actor departure cannot populate new identity editor", async ({
  page,
}) => {
  const held = deferred(),
    entered = deferred();
  model.hook = async (c) => {
    if (c.url.pathname.endsWith("/assignees")) {
      const data = model.read(c);
      entered.resolve();
      await held.promise;
      return { data };
    }
  };
  await page.getByRole("button", { name: "Add base", exact: true }).click();
  await entered.promise;
  await forceClick(page, "Switch synthetic actor");
  model.actor = f.otherActor;
  held.resolve();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add base", exact: true }),
  ).toBeEnabled();
  expect(model.writes()).toHaveLength(0);
});
test("current roster denial clears existing editor and typed name", async ({
  page,
}) => {
  await addBase(page, "Private draft");
  model.hook = (c) =>
    c.url.pathname.endsWith("/assignees") ? { status: 403 } : undefined;
  await page
    .getByRole("button", { name: "Find eligible users", exact: true })
    .click();
  await assertCleared(page);
  expect(
    await page
      .locator("input")
      .evaluateAll((inputs) =>
        inputs.some(
          (input) => (input as HTMLInputElement).value === "Private draft",
        ),
      ),
  ).toBe(false);
});
test("stale insight after refresh is aborted and cannot restore analytics", async ({
  page,
}) => {
  await openBook(page);
  const held = deferred(),
    entered = deferred();
  model.hook = async (c) => {
    if (c.url.pathname.endsWith("/insights")) {
      const data = model.read(c);
      entered.resolve();
      await held.promise;
      return { data };
    }
  };
  await page
    .getByRole("button", { name: "Overall insights", exact: true })
    .click();
  await entered.promise;
  await page
    .getByRole("button", { name: "Refresh Knowledge Base", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refresh Knowledge Base", exact: true }),
  ).toBeEnabled();
  held.resolve();
  await expect(
    page.getByRole("region", { name: "Knowledge Base insights" }),
  ).toHaveCount(0);
});
test("held decoded management acknowledgement fences forced refresh/leaf handlers and exact marker", async ({
  page,
}) => {
  await addBase(page, "Held draft");
  await bodyBarrier(page);
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await waitBody(page);
  const before = model.calls.length;
  const marker = await page.evaluate(
    (k) => sessionStorage.getItem(k),
    markerKey,
  );
  await forceClick(page, "Refresh Knowledge Base");
  await forceClick(page, "My library");
  await forceClick(page, "Add base");
  expect(model.calls).toHaveLength(before);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), markerKey)).toBe(
    marker,
  );
  expect(model.writes()).toHaveLength(1);
  await releaseBody(page);
  await settleWrite(page);
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), markerKey),
  ).toBeNull();
});
test("held decoded reader acknowledgement guards manual and leaf handlers without another view", async ({
  page,
}) => {
  await manager(page, model);
  await bodyBarrier(page);
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await waitBody(page);
  const before = model.calls.length;
  const marker = await page.evaluate(
    (k) => sessionStorage.getItem(k),
    markerKey,
  );
  await forceClick(page, "Refresh Knowledge Base");
  await forceClick(page, "Open folder Company Information");
  await forceClick(page, "Back to bases");
  expect(model.calls).toHaveLength(before);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), markerKey)).toBe(
    marker,
  );
  expect(model.events).toHaveLength(1);
  await releaseBody(page);
  await expect(
    page.getByRole("button", { name: "Refresh Knowledge Base", exact: true }),
  ).toBeEnabled();
  expect(model.events).toHaveLength(1);
});
test("acknowledged save followed by committed lost response retains exactUUID retry and failed recovery lock", async ({
  page,
}) => {
  await addBase(page, "First acknowledged");
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await settleWrite(page);
  await page
    .getByRole("button", { name: "Back to bases", exact: true })
    .click();
  await addBase(page, "Committed second");
  let lost = true;
  model.hook = (c) => {
    if (
      c.method === "POST" &&
      c.body?.change.action === "create_base" &&
      lost
    ) {
      lost = false;
      model.mutate(c.body);
      return { abort: true };
    }
  };
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry last action", exact: true }),
  ).toBeVisible();
  const committed = model.writes("create_base").at(-1)!.body!;
  model.hook = (c) => (c.method === "GET" ? { status: 503 } : undefined);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await assertCleared(page);
  expect(model.bases.filter((b) => b.name === "Committed second")).toHaveLength(
    1,
  );
  model.hook = null;
  await page
    .getByRole("button", { name: "Retry last action", exact: true })
    .click();
  await settleWrite(page);
  expect(model.writes("create_base").at(-1)!.body).toEqual(committed);
  expect(model.bases.filter((b) => b.name === "Committed second")).toHaveLength(
    1,
  );
});
test("management departure after decoded acknowledgement preserves field-free marker and unfiltered recovery", async ({
  page,
}) => {
  await addBase(page, "Never store this name");
  await bodyBarrier(page);
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await waitBody(page);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true }),
  ).toHaveCount(0);
  await releaseBody(page);
  const marker = await page.evaluate(
    (k) => JSON.parse(sessionStorage.getItem(k)!),
    markerKey,
  );
  expect(Object.keys(marker).sort()).toEqual(["action", "operationId"]);
  expect(JSON.stringify(marker)).not.toContain("Never store");
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry last action", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open base Never store this name",
      exact: true,
    }),
  ).toBeVisible();
  const reads = model.calls.filter(
    (c) => c.method === "GET" && c.url.pathname === "/api/knowledge-base",
  );
  expect(reads.at(-1)!.url.searchParams.get("view")).toBe("manage");
  expect(reads.at(-1)!.url.searchParams.get("status")).toBe("all");
  expect(model.writes("create_base")).toHaveLength(1);
});
test("personal committed lost acknowledgement reconciliation does not replay view and holds original recovery through leafGET", async ({
  page,
}) => {
  await manager(page, model);
  let lost = true;
  model.hook = (c) => {
    if (c.method === "POST" && c.body?.change?.action === "view" && lost) {
      lost = false;
      model.mutate(c.body);
      return { abort: true };
    }
  };
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await assertCleared(page);
  model.hook = (c) =>
    c.url.pathname.endsWith("/reconcile-view") ? { status: 503 } : undefined;
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await assertCleared(page);
  const held = deferred(),
    entered = deferred();
  model.hook = async (c) => {
    if (c.url.pathname.endsWith("/nodes")) {
      const data = model.read(c);
      entered.resolve();
      await held.promise;
      return { data };
    }
  };
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await entered.promise;
  const before = model.calls.length;
  await forceClick(page, "Refresh Knowledge Base");
  expect(model.calls).toHaveLength(before);
  held.resolve();
  await expect(page.getByRole("status")).toContainText(
    "No extra view was added",
  );
  expect(model.events).toHaveLength(1);
  expect(model.writes("view")).toHaveLength(1);
});
test("personal departure marker reconciles only operation without privateIDs and current reader denial stays locked", async ({
  page,
}) => {
  await manager(page, model);
  await bodyBarrier(page);
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await waitBody(page);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true }),
  ).toHaveCount(0);
  await releaseBody(page);
  const marker = await page.evaluate(
    (k) => JSON.parse(sessionStorage.getItem(k)!),
    markerKey,
  );
  expect(Object.keys(marker).sort()).toEqual(["action", "operationId"]);
  expect(JSON.stringify(marker)).not.toContain(f.bookId);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  model.hook = (c) =>
    c.url.pathname.endsWith("/reconcile-view") ? { status: 403 } : undefined;
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await assertCleared(page);
  model.hook = null;
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open base Company Handbook",
      exact: true,
    }),
  ).toBeEnabled();
  expect(model.events).toHaveLength(1);
  const reconcile = model.calls
    .filter((c) => c.url.pathname.endsWith("/reconcile-view"))
    .at(-1)!.body;
  expect(reconcile).toEqual({
    tenantId: f.company.id,
    operationId: marker.operationId,
  });
});
test("personal uncommitted view reconciliation states not recorded and never resends originalpayload", async ({
  page,
}) => {
  await manager(page, model);
  model.hook = (c) =>
    c.method === "POST" && c.body?.change?.action === "view"
      ? { abort: true }
      : undefined;
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await assertCleared(page);
  model.hook = null;
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("No view was replayed");
  expect(model.events).toHaveLength(0);
  expect(model.writes("view")).toHaveLength(1);
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), markerKey),
  ).toBeNull();
});
test("valid >64KiB text saves via ordinary fetch and departure remains unknown without unsafe resend", async ({
  page,
}) => {
  await addText(page, "😀".repeat(18000));
  await page.evaluate(() => {
    const original = window.fetch;
    Object.assign(window, { kbKeepalive: null, kbSaveBytes: 0 });
    window.fetch = (input, init) => {
      if (String(input) === "/api/knowledge-base" && init?.method === "POST")
        Object.assign(window, {
          kbKeepalive: init.keepalive,
          kbSaveBytes: new TextEncoder().encode(String(init.body)).length,
        });
      return original(input, init);
    };
  });
  await bodyBarrier(page);
  await page
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await waitBody(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { kbKeepalive: boolean }).kbKeepalive,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => (window as unknown as { kbSaveBytes: number }).kbSaveBytes,
    ),
  ).toBeGreaterThan(65536);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true }),
  ).toHaveCount(0);
  await releaseBody(page);
  await page
    .getByRole("button", { name: "Toggle synthetic departure", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry last action", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Refresh to recover", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add base", exact: true }),
  ).toBeEnabled();
  expect(model.writes("create_node")).toHaveLength(1);
});
test("raw escape transport cap disables content that would exceed256KiB", async ({
  page,
}) => {
  await addText(page, "\u0001".repeat(45000));
  await expect(
    page.getByRole("button", { name: "Save resource", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/JSON transport exceeds 256 KiB/)).toBeVisible();
  expect(model.writes("create_node")).toHaveLength(0);
});
test("missing acknowledgement IDs preserve lock and privatecontentclearing", async ({
  page,
}) => {
  await addBase(page);
  model.hook = (c) =>
    c.method === "POST"
      ? {
          data: {
            saved: {
              operationId: c.body!.operationId,
              action: "create_base",
              revision: 1,
            },
          },
        }
      : undefined;
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await assertCleared(page);
  await expect(
    page.getByRole("button", { name: "Retry last action", exact: true }),
  ).toBeVisible();
});
test("stale decoded node body after company replacement cannot restore private oldcontent", async ({
  page,
}) => {
  await openSection(page);
  await bodyBarrier(
    page,
    "GET",
    `/api/knowledge-base/${f.bookId}/nodes/${f.textId}`,
  );
  await page
    .getByRole("button", {
      name: "Open resource Welcome Handbook",
      exact: true,
    })
    .click();
  await waitBody(page);
  await page
    .getByRole("button", { name: "Switch synthetic company", exact: true })
    .click();
  model.tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  await releaseBody(page);
  await expect(page.locator(".kb-text")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open base Company Handbook",
      exact: true,
    }),
  ).toBeEnabled();
  expect(model.writes("view")).toHaveLength(0);
});
for (const leaf of ["title search", "insights", "destination"])
  test(`current ${leaf} failure removes every private pane and editor`, async ({
    page,
  }) => {
    await openSection(page);
    model.hook = (c) => (c.method === "GET" ? { status: 403 } : undefined);
    if (leaf === "title search") {
      await page
        .getByLabel("Search titles in this base", { exact: true })
        .fill("Handbook");
      await page
        .getByRole("button", { name: "Find resources", exact: true })
        .click();
    } else if (leaf === "insights")
      await page
        .getByRole("button", { name: "Overall insights", exact: true })
        .click();
    else
      await page
        .getByRole("button", {
          name: "Move resource Welcome Handbook",
          exact: true,
        })
        .click();
    await assertCleared(page);
    await expect(
      page.getByText("Company Handbook", { exact: true }),
    ).toHaveCount(0);
  });
test("catalog cursor version change clears old catalog rather than mixing versions", async ({
  page,
}) => {
  model.extraBases = 1005;
  await page
    .getByRole("button", { name: "Refresh Knowledge Base", exact: true })
    .click();
  await expect(page.locator(".kb-base-card")).toHaveCount(50);
  model.catalogVersion = "changed";
  await page
    .getByRole("button", { name: "Load more bases", exact: true })
    .click();
  await assertCleared(page);
});
test("insight cursor event version change clears displayed totals and users", async ({
  page,
}) => {
  model.audience.set(f.bookId, model.roster.slice(0, 100));
  model.bases[0].audienceCount = 100;
  model.bases[0].eligibleAudienceCount = 100;
  await openBook(page);
  await page
    .getByRole("button", { name: "Overall insights", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Load more insight users", exact: true }),
  ).toBeEnabled();
  model.eventVersion = "different";
  await page
    .getByRole("button", { name: "Load more insight users", exact: true })
    .click();
  await assertCleared(page);
  await expect(
    page.getByRole("region", { name: "Knowledge Base insights" }),
  ).toHaveCount(0);
});
test("roster cursor identity/version mismatch closes private audience editor", async ({
  page,
}) => {
  await addBase(page);
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Alex Morgan",
      exact: true,
    }),
  ).toBeVisible();
  model.rosterVersion = "different";
  await page
    .getByRole("button", { name: "Load more eligible users", exact: true })
    .click();
  await assertCleared(page);
});
for (const illegal of ["\u0000", "\ud800"])
  test(`unsupported PostgreSQL character ${illegal.charCodeAt(0)} cannot save`, async ({
    page,
  }) => {
    await addText(page, "Legal prefix");
    // The Playwright text protocol replaces lone surrogates before input. Generate
    // the exact UTF16 value inside the browser and invoke the real input handler.
    await page
      .getByLabel("Plain text", { exact: true })
      .evaluate((element, code) => {
        const key = Object.keys(element).find((k) =>
          k.startsWith("__reactProps$"),
        )!;
        const props = (
          element as unknown as Record<
            string,
            { onChange: (event: { target: { value: string } }) => void }
          >
        )[key];
        if (typeof props?.onChange !== "function")
          throw new Error("Text handler missing");
        props.onChange({
          target: { value: "Legal prefix" + String.fromCharCode(code) },
        });
      }, illegal.charCodeAt(0));
    await expect(
      page.getByRole("button", { name: "Save resource", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(/NUL and unpaired surrogate characters cannot be stored/),
    ).toBeVisible();
    expect(model.writes()).toHaveLength(0);
  });
test("link external navigation remains guarded through held reader acknowledgement", async ({
  page,
}) => {
  await manager(page, model);
  await openSection(page);
  await bodyBarrier(page);
  await page
    .getByRole("button", { name: "Open resource Company website", exact: true })
    .click();
  await waitBody(page);
  const link = page.getByRole("link", {
    name: "Open Company website externally ↗",
  }); // aria-disabled anchor without href has no link role, select scoped node below
  const anchor = page.locator('.kb-main a[rel="noopener noreferrer"]');
  await expect(anchor).toHaveAttribute("aria-disabled", "true");
  await expect(anchor).not.toHaveAttribute("href");
  const prevented = await anchor.evaluate((element) => {
    const key = Object.keys(element).find((k) =>
      k.startsWith("__reactProps$"),
    )!;
    const props = (
      element as unknown as Record<
        string,
        { onClick: (e: { preventDefault: () => void }) => void }
      >
    )[key];
    let prevented = false;
    props.onClick({
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  });
  expect(prevented).toBe(true);
  await releaseBody(page);
  await expect(link).toHaveAttribute("href", "https://example.test/team");
  expect(model.events).toHaveLength(3);
});
test("fixed searched assignment supports exactly500 and blocks a501st ordinary selection", async ({
  page,
}) => {
  test.setTimeout(60000);
  await addBase(page, "Bounded whole assignment");
  for (let current = 0; current < 10; current++) {
    await expect(page.locator(".kb-assignees input")).toHaveCount(
      (current + 1) * 50,
    );
    await page.locator(".kb-assignees input").evaluateAll((inputs) => {
      for (const input of inputs) {
        const el = input as HTMLInputElement;
        if (el.checked) continue;
        const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
        const props = (
          el as unknown as Record<
            string,
            { onChange: (e: { target: { checked: boolean } }) => void }
          >
        )[key];
        if (!props?.onChange) throw new Error("Checkbox handler missing");
        props.onChange({ target: { checked: true } });
      }
    });
    await expect(
      page.getByText(`${(current + 1) * 50} selected users`, { exact: true }),
    ).toBeVisible();
    if (current < 9)
      await page
        .getByRole("button", { name: "Load more eligible users", exact: true })
        .click();
  }
  await page.getByLabel("Search eligible users", { exact: true }).fill("1005");
  await page
    .getByRole("button", { name: "Find eligible users", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Eligible account 1005",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save base", exact: true }).click();
  await settleWrite(page);
  const c = model.writes("create_base")[0].body!.change;
  expect(c.action).toBe("create_base");
  if (c.action === "create_base") {
    expect(c.audienceIds).toHaveLength(500);
    expect(new Set(c.audienceIds).size).toBe(500);
  }
});
test("assignee picker sends the strict signed query contract for initial/search/keyset reads", async ({
  page,
}) => {
  await addBase(page);
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Alex Morgan",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load more eligible users", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Eligible account 0101",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Search eligible users", { exact: true }).fill("1005");
  await page
    .getByRole("button", { name: "Find eligible users", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Select user Eligible account 1005",
      exact: true,
    }),
  ).toBeVisible();
  const rosterCalls = model.calls.filter(
    (c) => c.url.pathname === "/api/knowledge-base/assignees",
  );
  expect(rosterCalls).toHaveLength(3);
  for (const c of rosterCalls) {
    expect(c.method).toBe("GET");
    expect(c.url.searchParams.get("tenantId")).toBe(f.company.id);
    expect(c.url.searchParams.has("view")).toBe(false);
    expect(
      [...c.url.searchParams.keys()].every((key) =>
        ["tenantId", "search", "limit", "cursor"].includes(key),
      ),
    ).toBe(true);
  }
  expect(rosterCalls.map((c) => c.url.searchParams.get("search"))).toEqual([
    "",
    "",
    "1005",
  ]);
  expect(rosterCalls.map((c) => c.url.searchParams.get("cursor"))).toEqual([
    null,
    "50",
    null,
  ]);
  const malformed = await page.evaluate(async (tenantId) => {
    const response = await fetch(
      "/api/knowledge-base/assignees?" +
        new URLSearchParams({ tenantId, view: "manage", limit: "50" }),
    );
    return response.status;
  }, f.company.id);
  expect(malformed).toBe(400);
  await expect(
    page.getByRole("dialog", { name: "Add base", exact: true }),
  ).toBeVisible();
});
