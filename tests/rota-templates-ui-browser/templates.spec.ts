import type {
  RotaTemplateMutation,
  RotaTemplateRecoveryQuery,
  RotaTemplateSaved,
} from "../../lib/rota-template-types";
import type { RotaShift } from "../../lib/rota-types";
import { test, expect, type Page, type Route } from "@playwright/test";
const id = (n: number) =>
    `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1),
  actor = id(2),
  scheduleId = id(3),
  job = id(4),
  agent = id(5),
  templateId = id(6);
const recipe = {
  id: templateId,
  tenant_id: tenant,
  schedule_id: scheduleId,
  name: "Reception opening",
  title: "Open reception",
  job_id: job,
  start_minute: 540,
  end_minute: 1020,
  end_day_offset: 0,
  revision: 1,
};
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function setup(page: Page, scenario = "normal") {
  let revision = 1,
    templates = [
      {
        ...recipe,
        ...(scenario === "dst" ? { start_minute: 90, end_minute: 180 } : {}),
      },
    ],
    receipt: RotaTemplateSaved | null = null;
  const drafts: RotaShift[] = [],
    posts: (RotaTemplateMutation | RotaTemplateRecoveryQuery)[] = [];
  let recoveries = 0;
  const schedule = () => ({
    id: scheduleId,
    tenant_id: tenant,
    name: "Reception team",
    time_zone:
      scenario === "dst"
        ? "Europe/London"
        : scenario === "wall-seconds"
          ? "Europe/Paris"
          : "UTC",
    status: scenario === "archived" ? "archived" : "active",
    revision,
  });
  await page.route("**/api/rotas?*", (route) =>
    json(route, {
      schedules: [schedule()],
      jobs: [
        {
          id: job,
          schedule_id: scheduleId,
          name: "Reception",
          color: "#2998ff",
        },
      ],
      shifts: [
        {
          id: id(7),
          schedule_id: scheduleId,
          agent_id: agent,
          job_id: job,
          title: "Morning cover",
          starts_at:
            scenario === "wall-seconds"
              ? "1900-01-01T09:00:00Z"
              : scenario === "sub-millisecond"
                ? "2026-11-08T09:00:00.000001+00:00"
                : scenario === "zero-fraction"
                  ? "2026-11-08T09:00:00.000000+00:00"
                  : "2026-10-05T09:00:30Z",
          ends_at:
            scenario === "wall-seconds"
              ? "1900-01-01T17:00:00Z"
              : ["sub-millisecond", "zero-fraction"].includes(scenario)
                ? "2026-11-08T17:00:00.000000+00:00"
                : "2026-10-05T17:00:30Z",
          status: "published",
          revision: 1,
        },
        ...drafts,
      ],
      agents: [
        {
          id: agent,
          first_name: "Alex",
          last_name: "Morgan",
          status: "active",
        },
      ],
      assignments: [{ schedule_id: scheduleId, agent_id: agent }],
      admins: [],
      members: [],
    }),
  );
  await page.route("**/api/rota-templates**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const url = new URL(request.url());
      return json(route, {
        schemaVersion: 1,
        tenantId: tenant,
        actorId: actor,
        schedule: schedule(),
        templates: templates.filter((t) =>
          t.name
            .toLowerCase()
            .includes((url.searchParams.get("q") || "").toLowerCase()),
        ),
        page: { total: templates.length, nextCursor: null },
      });
    }
    const op = request.postDataJSON() as
      RotaTemplateMutation | RotaTemplateRecoveryQuery;
    posts.push(op);
    if ("mode" in op) {
      recoveries++;
      if (scenario === "lost" && recoveries === 1)
        return json(route, { error: "Try checking again." }, 503);
      return json(route, {
        schemaVersion: 1,
        tenantId: tenant,
        actorId: actor,
        operationId: op.operationId,
        action: op.action,
        scheduleId,
        templateId: op.templateId,
        status: scenario === "closed" ? "not_recorded" : "recorded",
        saved: scenario === "closed" ? null : receipt,
      });
    }
    if (scenario === "denied")
      return json(route, { error: "Scheduling access changed." }, 403);
    if (scenario === "closed") return route.abort();
    const c = op.change;
    revision++;
    if (c.action === "create") templates.push({ ...recipe, ...c, id: id(10) });
    if (c.action === "edit")
      templates = templates.map((t) =>
        t.id === c.template_id ? { ...t, ...c, revision: t.revision + 1 } : t,
      );
    if (c.action === "duplicate")
      templates.push({ ...recipe, id: id(11), name: c.name });
    if (c.action === "delete")
      templates = templates.filter((t) => t.id !== c.template_id);
    if (c.action === "apply")
      drafts.push({
        id: id(12),
        schedule_id: scheduleId,
        agent_id: c.agent_id,
        job_id: job,
        title: recipe.title,
        starts_at: c.date + "T09:00:00Z",
        ends_at: c.date + "T17:00:00Z",
        status: "draft",
        revision: 1,
      });
    receipt = {
      schemaVersion: 1,
      tenantId: tenant,
      actorId: actor,
      operationId: op.operationId,
      action: c.action,
      template_id:
        c.action === "create"
          ? id(10)
          : c.action === "duplicate"
            ? id(11)
            : templateId,
      template_revision: 1,
      schedule_id: scheduleId,
      schedule_revision: revision,
      shift_id: c.action === "apply" ? id(12) : null,
    };
    if (scenario === "lost") return route.abort();
    return json(route, { saved: receipt });
  });
  await page.goto("/rota-templates-component-fixture");
  if (scenario === "archived")
    await page.getByRole("tab", { name: "Archived" }).click();
  await page.getByRole("button", { name: "Access schedule" }).click();
  return { posts, drafts };
}
test("manager creates, edits, duplicates, applies one draft and deletes without removing draft", async ({
  page,
}) => {
  const { posts, drafts } = await setup(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await expect(
    drawer.getByText("Reception opening", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/workspace/scratch/ct-alt-shift-templates-original.png",
    fullPage: true,
  });
  await drawer.getByRole("button", { name: "Add Template" }).click();
  await drawer.getByLabel("Template name").fill("Evening handover");
  await drawer.getByRole("button", { name: "Save template" }).click();
  await expect(
    drawer.getByText("Evening handover", { exact: true }),
  ).toBeVisible();
  await drawer.locator("article").first().locator("summary").click();
  await drawer
    .getByRole("button", { name: "Edit", exact: true })
    .first()
    .click();
  await drawer.getByLabel("Template name").fill("Opening checklist");
  await drawer.getByRole("button", { name: "Save template" }).click();
  await expect(
    drawer.getByText("Opening checklist", { exact: true }),
  ).toBeVisible();
  await drawer.locator("article").first().locator("summary").click();
  await drawer
    .getByRole("button", { name: "Duplicate", exact: true })
    .first()
    .click();
  await drawer.getByRole("button", { name: "Save template" }).click();
  await expect(
    drawer.getByText("Opening checklist copy", { exact: true }),
  ).toBeVisible();
  await drawer
    .getByRole("button", { name: "Apply", exact: true })
    .first()
    .click();
  await drawer.getByLabel("Date", { exact: true }).fill("2026-10-06");
  await drawer.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("Draft created for Alex Morgan.", { exact: false }),
  ).toBeVisible();
  expect(drafts).toHaveLength(1);
  expect(
    posts.filter((p) => "change" in p && p.change.action === "apply"),
  ).toHaveLength(1);
  await drawer.locator("article").first().locator("summary").click();
  await drawer
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  await expect(drawer.getByText(/Existing shifts are preserved/)).toBeVisible();
  await drawer.getByRole("button", { name: "Delete template" }).click();
  expect(drafts).toHaveLength(1);
});
test("lost acknowledgement stays locked through failed recovery and recorded recovery produces one draft", async ({
  page,
}) => {
  const { posts, drafts } = await setup(page, "lost");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Apply", exact: true }).click();
  await drawer.getByRole("button", { name: "Create draft" }).click();
  await expect(
    drawer.getByRole("button", { name: "Check operation status" }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Back", exact: true }),
  ).toBeDisabled();
  await drawer.getByRole("button", { name: "Check operation status" }).click();
  await expect(drawer.getByRole("alert")).toHaveText("Try checking again.");
  await expect(
    drawer.getByRole("button", { name: "Back", exact: true }),
  ).toBeDisabled();
  await drawer.getByRole("button", { name: "Check operation status" }).click();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeEnabled();
  expect(drafts).toHaveLength(1);
  expect(posts.filter((p) => "change" in p)).toHaveLength(1);
});
test("authoritative not recorded recovery unlocks safely", async ({ page }) => {
  await setup(page, "closed");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Apply", exact: true }).click();
  await drawer.getByRole("button", { name: "Create draft" }).click();
  await drawer.getByRole("button", { name: "Check operation status" }).click();
  await expect(drawer.getByRole("alert")).toContainText("not saved");
  await expect(
    drawer.getByRole("button", { name: "Create draft" }),
  ).toBeEnabled();
});
test("permission rejection clears sensitive panel and selection", async ({
  page,
}) => {
  await setup(page, "denied");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Apply", exact: true }).click();
  await drawer.getByRole("button", { name: "Create draft" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByText(
      "Scheduling access changed. Reload to check your current permissions.",
    ),
  ).toBeVisible();
});
test("published source details cannot edit and require explicit seconds normalization", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Date", { exact: true }).fill("2026-10-05");
  await page
    .getByRole("button", { name: "Published Morning cover Alex Morgan" })
    .first()
    .click();
  const details = page.getByRole("dialog", { name: "Published shift details" });
  await expect(details.getByRole("button", { name: "Save draft" })).toHaveCount(
    0,
  );
  await details
    .getByRole("button", { name: "Save as template from saved shift" })
    .click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await expect(drawer.getByLabel(/source includes seconds/)).toBeVisible();
  await drawer.getByLabel(/source includes seconds/).check();
  await drawer.getByRole("button", { name: "Save template" }).click();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeEnabled();
});

test("departure preserves only operation identity and authoritative recovery after reload", async ({
  page,
}) => {
  const { posts, drafts } = await setup(page, "lost");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Apply", exact: true }).click();
  await drawer.getByRole("button", { name: "Create draft" }).click();
  await expect(
    drawer.getByRole("button", { name: "Check operation status" }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("ct-alt:rota-template-operation:v1:"),
    ),
  );
  expect(stored).toHaveLength(1);
  const marker = JSON.parse(stored[0][1]);
  expect(Object.keys(marker).sort()).toEqual(
    [
      "action",
      "mode",
      "operationId",
      "scheduleId",
      "templateId",
      "tenantId",
    ].sort(),
  );
  expect(stored[0][1]).not.toContain("Alex");
  expect(stored[0][1]).not.toContain("Reception");
  await page.reload();
  drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeDisabled();
  await drawer.getByRole("button", { name: "Check operation status" }).click();
  await drawer.getByRole("button", { name: "Check operation status" }).click();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeEnabled();
  expect(drafts).toHaveLength(1);
  expect(posts.filter((p) => "change" in p)).toHaveLength(1);
});
test("held acknowledgement locks controls and does not permit duplicate submission", async ({
  page,
}) => {
  const { posts } = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/rota-templates", async (route) => {
    if (route.request().method() === "POST") {
      await gate;
    }
    await route.fallback();
  });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Apply", exact: true }).click();
  await drawer.getByRole("button", { name: "Create draft" }).click();
  await expect(drawer.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(
    drawer.getByRole("button", { name: "Close templates" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  release();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeEnabled();
  expect(posts.filter((p) => "change" in p)).toHaveLength(1);
});
test("late list response cannot restore templates after current permission rejection", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/rota-templates?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "held") {
      held = true;
      await gate;
      return route.fallback();
    }
    if (q === "revoked") return json(route, { error: "Access revoked" }, 403);
    return route.fallback();
  });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByLabel("Search templates").fill("held");
  await expect.poll(() => held).toBe(true);
  await drawer.getByLabel("Search templates").fill("revoked");
  await expect(drawer).toHaveCount(0);
  release();
  await expect(
    page.getByText(
      "Scheduling access changed. Reload to check your current permissions.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Reception opening", { exact: true }),
  ).toHaveCount(0);
});

test("schedule timezone preview rejects gaps and resolves both fold occurrences", async ({
  page,
}) => {
  await setup(page, "dst");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Apply", exact: true }).click();
  await drawer.getByLabel("Date", { exact: true }).fill("2026-03-29");
  await expect(drawer.getByRole("status")).toContainText("does not exist");
  await expect(
    drawer.getByRole("button", { name: "Create draft" }),
  ).toBeDisabled();
  await drawer.getByLabel("Date", { exact: true }).fill("2026-10-25");
  await expect(drawer.getByRole("status")).toContainText("occurs twice");
  await drawer
    .getByLabel("Start clock-change occurrence")
    .selectOption("earlier");
  await expect(drawer.getByRole("status")).toContainText(
    "2026-10-25T01:30 – 2026-10-25T03:00 · 02:30",
  );
  await drawer
    .getByLabel("Start clock-change occurrence")
    .selectOption("later");
  await expect(drawer.getByRole("status")).toContainText(
    "2026-10-25T01:30 – 2026-10-25T03:00 · 01:30",
  );
  await expect(
    drawer.getByRole("button", { name: "Create draft" }),
  ).toBeEnabled();
});

test("archived schedule templates remain visible with all writes disabled", async ({
  page,
}) => {
  await setup(page, "archived");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await expect(
    drawer.getByText("Archived schedule. Templates are read only."),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeDisabled();
  await expect(
    drawer.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await drawer.locator("summary").click();
  await expect(
    drawer.getByRole("button", { name: "Edit", exact: true }),
  ).toBeDisabled();
  await expect(
    drawer.getByRole("button", { name: "Duplicate", exact: true }),
  ).toBeDisabled();
  await expect(
    drawer.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
});
test("pagination rejects revision changes instead of mixing snapshots", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/rota-templates?**", async (route) => {
    const url = new URL(route.request().url());
    return json(route, {
      schemaVersion: 1,
      tenantId: tenant,
      actorId: actor,
      schedule: {
        id: scheduleId,
        revision: url.searchParams.has("cursor") ? 2 : 1,
        time_zone: "UTC",
        status: "active",
      },
      templates: [
        url.searchParams.has("cursor")
          ? { ...recipe, id: id(99), name: "Later template" }
          : recipe,
      ],
      page: {
        total: 2,
        nextCursor: url.searchParams.has("cursor")
          ? null
          : "opaque-local-cursor",
      },
    });
  });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await drawer.getByRole("button", { name: "Load more templates" }).click();
  await expect(drawer.getByRole("alert")).toContainText("changed while paging");
  await expect(drawer.getByText("Later template", { exact: true })).toHaveCount(
    0,
  );
});
test("Escape closes drawer and restores Templates trigger focus", async ({
  page,
}) => {
  await setup(page);
  const trigger = page.getByRole("button", { name: "Templates", exact: true });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "Shift Templates" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Shift Templates" }),
  ).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("revoked readable schedule marker cannot lock another delegated schedule", async ({
  page,
}) => {
  const otherSchedule = id(81),
    otherJob = id(82),
    markerKey = `ct-alt:rota-template-operation:v1:${actor}:${tenant}:${scheduleId}`;
  const marker = {
    mode: "reconcile",
    tenantId: tenant,
    operationId: id(83),
    action: "apply",
    scheduleId,
    templateId,
  };
  let reads = 0;
  const legacyPosts: Record<string, unknown>[] = [];
  const templateCalls: string[] = [];
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: markerKey, value: marker },
  );
  await page.route("**/api/rota-templates**", async (route) => {
    templateCalls.push(route.request().url());
    return json(route, { error: "A is no longer manageable" }, 403);
  });
  await page.route("**/api/rotas**", async (route) => {
    if (route.request().method() === "POST") {
      const change = route.request().postDataJSON().change;
      legacyPosts.push(change);
      return json(route, {
        saved: { schedule_id: otherSchedule, revision: 2 },
      });
    }
    reads++;
    return json(route, {
      schedules: [
        {
          id: scheduleId,
          tenant_id: tenant,
          name: "Reception team",
          time_zone: "UTC",
          status: "active",
          revision: 1,
        },
        {
          id: otherSchedule,
          tenant_id: tenant,
          name: "Warehouse team",
          time_zone: "UTC",
          status: "active",
          revision: 1,
        },
      ],
      jobs: [
        {
          id: job,
          schedule_id: scheduleId,
          name: "Reception",
          color: "#2998ff",
        },
        {
          id: otherJob,
          schedule_id: otherSchedule,
          name: "Warehouse",
          color: "#2998ff",
        },
      ],
      shifts: [],
      agents: [
        {
          id: agent,
          first_name: "Alex",
          last_name: "Morgan",
          status: "active",
        },
      ],
      assignments: [
        { schedule_id: scheduleId, agent_id: agent },
        { schedule_id: otherSchedule, agent_id: agent },
      ],
      admins: [{ schedule_id: otherSchedule, user_id: actor }],
      members: [
        { user_id: actor, display_name: "Alex Morgan", role: "manager" },
      ],
    });
  });
  await page.goto("/rota-templates-component-fixture?role=manager");
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("dialog", { name: "Shift Templates" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(1);
  await page
    .getByRole("article", { name: "Schedule Warehouse team" })
    .getByRole("button", { name: "Access schedule" })
    .click();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Job list", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Job list", exact: true }).click();
  const jobs = page.getByRole("dialog", { name: "Job list" });
  await jobs.getByLabel("Job name").fill("Warehouse close");
  await jobs.getByRole("button", { name: "Add job", exact: true }).click();
  await expect(jobs).toHaveCount(0);
  expect(legacyPosts).toHaveLength(1);
  expect(legacyPosts[0].schedule_id).toBe(otherSchedule);
  expect(templateCalls).toHaveLength(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), markerKey),
  ).toBe(JSON.stringify(marker));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("dialog", { name: "Shift Templates" }),
  ).toHaveCount(0);
});

test("historical zone wall seconds require consent even when UTC seconds are zero", async ({
  page,
}) => {
  const { posts } = await setup(page, "wall-seconds");
  await page.getByLabel("Date", { exact: true }).fill("1900-01-01");
  await page
    .getByRole("button", { name: "Published Morning cover Alex Morgan" })
    .first()
    .click();
  await page
    .getByRole("dialog", { name: "Published shift details" })
    .getByRole("button", { name: "Save as template from saved shift" })
    .click();
  const drawer = page.getByRole("dialog", { name: "Shift Templates" });
  await expect(drawer.getByLabel("Start time")).toHaveValue("09:09");
  await expect(drawer.getByLabel("End time")).toHaveValue("17:09");
  const consent = drawer.getByLabel(/source includes seconds/);
  await expect(consent).toBeVisible();
  await drawer.getByRole("button", { name: "Save template" }).click();
  await expect(consent).not.toBeChecked();
  expect(posts.filter((p) => "change" in p)).toHaveLength(0);
  await consent.check();
  await drawer.getByRole("button", { name: "Save template" }).click();
  await expect(
    drawer.getByRole("button", { name: "Add Template" }),
  ).toBeEnabled();
  const saved = posts.find((p) => "change" in p);
  expect(
    saved && "change" in saved && saved.change.action === "create"
      ? saved.change.start_minute
      : null,
  ).toBe(549);
});

for (const scenario of ["sub-millisecond", "zero-fraction"]) {
  test(`${scenario} source precision is checked before minute capture`, async ({
    page,
  }) => {
    const { posts } = await setup(page, scenario);
    const legacyWrites: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/rotas" &&
        request.method() === "POST"
      )
        legacyWrites.push(request.postData() || "");
    });
    const original = await page.evaluate(async () => {
      const data = await (
        await fetch("/api/rotas?tenantId=91000000-0000-4000-8000-000000000001")
      ).json();
      return data.shifts[0];
    });
    await page.getByLabel("Date", { exact: true }).fill("2026-11-08");
    await page
      .getByRole("button", { name: "Published Morning cover Alex Morgan" })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Published shift details" })
      .getByRole("button", { name: "Save as template from saved shift" })
      .click();
    const drawer = page.getByRole("dialog", { name: "Shift Templates" }),
      consent = drawer.getByLabel(/source includes seconds/);
    await expect(drawer.getByLabel("Start time")).toHaveValue("09:00");
    await expect(drawer.getByLabel("End time")).toHaveValue("17:00");
    if (scenario === "sub-millisecond") {
      await expect(consent).toBeVisible();
      await drawer.getByRole("button", { name: "Save template" }).click();
      expect(posts.filter((p) => "change" in p)).toHaveLength(0);
      await expect(consent).not.toBeChecked();
      await consent.check();
    } else await expect(consent).toHaveCount(0);
    await drawer.getByRole("button", { name: "Save template" }).click();
    await expect(
      drawer.getByRole("button", { name: "Add Template" }),
    ).toBeEnabled();
    expect(posts.filter((p) => "change" in p)).toHaveLength(1);
    expect(legacyWrites).toHaveLength(0);
    const retained = await page.evaluate(async () => {
      const data = await (
        await fetch("/api/rotas?tenantId=91000000-0000-4000-8000-000000000001")
      ).json();
      return data.shifts[0];
    });
    expect(retained).toEqual(original);
    expect(retained.starts_at).toBe(
      scenario === "sub-millisecond"
        ? "2026-11-08T09:00:00.000001+00:00"
        : "2026-11-08T09:00:00.000000+00:00",
    );
  });
}
