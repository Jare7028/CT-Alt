import { test, expect, type Page, type Route } from "@playwright/test";
import type { RotaData } from "../../lib/rota-types";
import type {
  RotaPeriodMutation,
  RotaPeriodEntry,
  RotaPeriodMetadata,
  RotaPeriodCapacity,
  RotaPeriodSourcePreview,
  RotaPeriodSelector,
  RotaPeriodTargetPreview,
  RotaPeriodTargetEntry,
  RotaPeriodPageKind,
  RotaPeriodVisibleCommitment,
} from "../../lib/rota-period-template-types";
type SourceResponse = Omit<
  RotaPeriodSourcePreview,
  "firstPage" | "selectors"
> & { firstPage: boolean; selectors?: RotaPeriodSelector[] };
type TargetResponse = Omit<
  RotaPeriodTargetPreview,
  "pageKind" | "entries" | "commitments"
> & {
  pageKind: RotaPeriodPageKind;
  entries?: RotaPeriodTargetEntry[];
  commitments?: RotaPeriodVisibleCommitment[];
};
function savedChange(writes: RotaPeriodMutation[]) {
  const change = writes[0].change;
  if (change.action !== "save") throw Error("Expected Save");
  return change;
}
function addedChange(writes: RotaPeriodMutation[]) {
  const change = writes[0].change;
  if (change.action !== "add") throw Error("Expected Add");
  return change;
}
const id = (n: number) =>
  `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  actor = id(2),
  schedule = id(3),
  digest = "a".repeat(64);
const capacity: RotaPeriodCapacity = {
  companyUsageVisible: false,
  metadata: 0,
  shifts: null,
  entries: null,
  operations: null,
  generated: null,
};
const envelope: Pick<
  RotaPeriodSourcePreview,
  "schemaVersion" | "tenantId" | "actorId" | "schedule"
> = {
  schemaVersion: 1,
  tenantId: tenant,
  actorId: actor,
  schedule: { id: schedule, revision: 1, time_zone: "UTC", status: "active" },
};
const entry = (index: number): RotaPeriodEntry => ({
  index,
  source_shift_id: id(100 + index),
  source_revision: 1,
  source_status: "draft",
  source_starts_at: "2026-10-05T09:00:00.000001Z",
  source_ends_at: "2026-10-05T17:00:00.000001Z",
  agent_id: id(4),
  agent_name: "Maya Ellis",
  job_id: id(5),
  job_name: "Reception",
  job_color: "#2998ff",
  title: `Reception cover ${index + 1}`,
  start_day_offset: 0,
  end_day_offset: 0,
  start_clock_micros: 32400000001,
  end_clock_micros: 61200000001,
});
async function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function setup(page: Page, scenario = "normal", count = 1) {
  const metadata: RotaPeriodMetadata = {
    id: id(8),
    tenant_id: tenant,
    schedule_id: schedule,
    kind: "week",
    title: "Reception coverage",
    source_anchor: "2026-10-05",
    source_zone: "UTC",
    source_schedule_revision: 1,
    source_filters: { jobId: null, status: "all", workerSearch: "" },
    entry_count: scenario === "history-pages" ? 103 : 1,
    user_count: scenario === "history-pages" ? 2 : 1,
    elapsed_micros:
      scenario === "history-pages" ? 103 * 28800000000 + 530866 : 28800000000,
    revision: 1,
    created_at: "2026-10-05T00:00:00.000000Z",
    updated_at: "2026-10-05T00:00:00.000000Z",
  };
  const responseCapacity: RotaPeriodCapacity =
    scenario === "parent"
      ? {
          companyUsageVisible: true,
          metadata: 0,
          shifts: 0,
          entries: 0,
          operations: 0,
          generated: 0,
        }
      : capacity;
  const parentData: RotaData = {
    schedules: [
      {
        id: schedule,
        tenant_id: tenant,
        name: "Reception team",
        time_zone: "UTC",
        status: "active",
        revision: 1,
      },
    ],
    jobs: [
      { id: id(5), schedule_id: schedule, name: "Reception", color: "#2998ff" },
    ],
    shifts: [
      {
        id: id(100),
        schedule_id: schedule,
        agent_id: id(4),
        job_id: id(5),
        starts_at: "2026-10-05T09:00:00.000001Z",
        ends_at: "2026-10-05T17:00:00.000001Z",
        title: "Reception cover",
        status: "draft",
        revision: 1,
      },
    ],
    agents: [
      { id: id(4), first_name: "Maya", last_name: "Ellis", status: "active" },
    ],
    assignments: [{ schedule_id: schedule, agent_id: id(4) }],
    admins: [],
    members: [],
  };
  if (scenario === "parent")
    await page.route("**/api/rotas**", (route) => json(route, parentData));
  const responseEnvelope = () => ({
    ...envelope,
    schedule: {
      ...envelope.schedule,
      revision:
        scenario === "parent"
          ? parentData.schedules[0].revision
          : envelope.schedule.revision,
    },
  });
  const writes: RotaPeriodMutation[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let sourceReads = 0;
  let sourcePageReads = 0;
  let targetReads = 0;
  let catalogReads = 0;
  let reconciliationReads = 0;
  await page.route("**/api/rota-period-templates**", async (route) => {
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (body.mode === "source-preview") {
      sourceReads++;
      if (body.cursor) sourcePageReads++;
      if (["held-source", "held-owner"].includes(scenario)) await held;
      if (scenario === "denied")
        return json(route, { error: "Access revoked" }, 403);
      if (scenario === "gap")
        return json(
          route,
          { error: "Source midnight does not exist because clocks change." },
          400,
        );
      const first = !body.cursor,
        start = first ? 0 : 100;
      const data: SourceResponse = {
        ...responseEnvelope(),
        capacity: responseCapacity,
        canSave: count > 0 && scenario !== "quota",
        saveBlockers: scenario === "quota" ? ["entry_capacity"] : [],
        source: {
          kind: "week",
          anchor: "2026-10-05",
          zone: "UTC",
          filters: { jobId: null, status: "all", workerSearch: "" },
          entryCount: count,
          userCount: count ? 1 : 0,
          elapsedMicros:
            count * 28800000000 + (scenario === "rounded-hours" ? 530866 : 0),
        },
        sourceReviewDigest:
          scenario === "changed" && !first ? "b".repeat(64) : digest,
        firstPage: first,
        entries: Array.from({ length: Math.min(100, count - start) }, (_, i) =>
          entry(start + i),
        ),
        page: {
          total: count,
          nextCursor: first && count > 100 ? "next" : null,
        },
      };
      if (scenario === "rounded-hours") {
        data.entries[0].end_clock_micros = 61200530867;
        data.entries[0].source_ends_at = "2026-10-05T17:00:00.530867Z";
      }
      if (scenario === "ordinary")
        data.entries = data.entries.map((row) => ({
          ...row,
          start_clock_micros: 32400000000,
          end_clock_micros: 61200000000,
          source_starts_at: "2026-10-05T09:00:00.000000Z",
          source_ends_at: "2026-10-05T17:00:00.000000Z",
        }));
      if (first)
        data.selectors = Array.from({ length: count }, (_, i) => ({
          id: id(100 + i),
          revision: 1,
        }));
      if (scenario === "wrong-row" && !first)
        data.entries[0].source_shift_id = id(999);
      if (scenario === "privacy" || scenario === "held-owner")
        data.capacity = {
          companyUsageVisible: true,
          metadata: 0,
          shifts: 0,
          entries: 0,
          operations: 0,
          generated: 0,
        };
      return json(route, { data });
    }
    if (body.mode === "preview") {
      targetReads++;
      const blocked =
        scenario === "target-gap" ||
        (scenario === "target-fold" && !body.occurrences.length);
      const conflict = scenario === "target-hidden";
      const row: RotaPeriodTargetEntry = {
        entry: entry(0),
        availability: {
          workerAvailable: true,
          jobAvailable: true,
          currentAgentName: "Maya Hart",
          currentJobName: "Front desk",
          currentJobColor: "#ff6600",
        },
        starts_at: blocked ? null : "2026-10-05T09:00:00.000001Z",
        ends_at: blocked ? null : "2026-10-05T17:00:00.000001Z",
        elapsed_micros: blocked ? null : 28800000000,
        blockers: blocked
          ? [scenario === "target-fold" ? "start_ambiguous" : "start_gap"]
          : [],
        internalConflict: false,
        existingConflict: conflict,
      };
      const total =
        body.pageKind === "entries"
          ? 1
          : body.pageKind === "blocked"
            ? blocked
              ? 1
              : 0
            : body.pageKind === "affected"
              ? conflict
                ? 1
                : 0
              : 0;
      const value: TargetResponse = {
        ...responseEnvelope(),
        template: metadata,
        targetAnchor: body.targetAnchor,
        occurrences: body.occurrences,
        planDigest:
          scenario === "target-fold" && body.occurrences.length
            ? (body.occurrences[0].start === "earlier" ? "b" : "c").repeat(64)
            : digest,
        canAdd: !blocked,
        entryCount: 1,
        userCount: 1,
        elapsedMicros: blocked ? 0 : 28800000000,
        blockedEntryCount: blocked ? 1 : 0,
        affectedEntryCount: conflict ? 1 : 0,
        visibleCommitmentCount: 0,
        hasHiddenConflicts: conflict,
        capacity: responseCapacity,
        blockers: [],
        pageKind: body.pageKind,
        page: { total, nextCursor: null },
      };
      if (body.pageKind === "visibleCommitments") value.commitments = [];
      else value.entries = total ? [row] : [];
      return json(route, { data: value });
    }
    if (body.mode === "reconcile") {
      reconciliationReads++;
      if (["lost", "bad-ack", "mutation-quota"].includes(scenario)) await held;
      if (scenario === "recorded-add") {
        await held;
        return json(route, {
          reconciliation: {
            schemaVersion: 1,
            tenantId: tenant,
            actorId: actor,
            operationId: body.operationId,
            action: "add",
            scheduleId: schedule,
            templateId: id(8),
            status: "recorded",
            saved: {
              schemaVersion: 1,
              tenantId: tenant,
              actorId: actor,
              operationId: body.operationId,
              action: "add",
              template_id: id(8),
              template_revision: 1,
              schedule_id: schedule,
              schedule_revision: 2,
              entry_count: 1,
              generated: [{ index: 0, id: id(900), revision: 1 }],
              plan_digest: digest,
            },
          },
        });
      }
      if (scenario === "closure-quota")
        return json(
          route,
          { error: "Operation capacity prevents closure" },
          409,
        );
      return json(route, {
        reconciliation: {
          schemaVersion: 1,
          tenantId: tenant,
          actorId: actor,
          operationId: body.operationId,
          action: body.action,
          scheduleId: schedule,
          templateId: body.templateId,
          status: "not_recorded",
          saved: null,
        },
      });
    }
    if (body.change) {
      writes.push(body);
      if (scenario === "parent") parentData.schedules[0].revision = 2;
      if (scenario === "held") await held;
      if (["lost", "closure-quota"].includes(scenario)) return route.abort();
      if (scenario === "mutation-quota")
        return json(route, { error: "Company entry capacity reached" }, 409);
      const saved = {
        schemaVersion: 1,
        tenantId: tenant,
        actorId: actor,
        operationId: body.operationId,
        action: body.change.action,
        template_id: id(8),
        template_revision: 1,
        schedule_id: schedule,
        schedule_revision: scenario === "bad-ack" ? 3 : 2,
        entry_count: count,
        generated:
          body.change.action === "add"
            ? [{ index: 0, id: id(900), revision: 1 }]
            : [],
        plan_digest:
          body.change.action === "add" ? body.change.plan_digest : null,
      };
      return json(route, { saved });
    }
    const params = new URL(route.request().url()).searchParams;
    if (params.get("mode") === "history") {
      if (scenario === "late-catalog-denial")
        return json(route, { error: "Current access denied" }, 403);
      const start = params.get("cursor") ? 100 : 0;
      const total = scenario === "history-pages" ? 103 : 1;
      return json(route, {
        data: {
          ...responseEnvelope(),
          template: metadata,
          historyDigest: digest,
          entries: Array.from(
            { length: Math.min(100, total - start) },
            (_, i) => ({
              entry: {
                ...entry(start + i),
                ...(start + i >= 100
                  ? { agent_id: id(6), agent_name: "Jonah Reed" }
                  : {}),
              },
              availability: {
                workerAvailable: true,
                jobAvailable: true,
                currentAgentName:
                  start + i >= 100 ? "Jonah Reed" : "Maya Ellis",
                currentJobName: "Reception",
                currentJobColor: "#2998ff",
              },
            }),
          ),
          page: {
            total,
            nextCursor: total > 100 && !start ? "history-next" : null,
          },
        },
      });
    }
    catalogReads++;
    if (scenario === "late-catalog-denial" && catalogReads <= 2) await held;
    return json(route, {
      data: {
        ...responseEnvelope(),
        kind: params.get("kind") || "week",
        q: params.get("q") || "",
        capacity: responseCapacity,
        canEdit: true,
        editBlockers: [],
        templates:
          scenario === "recorded-add" && params.get("kind") === "day"
            ? []
            : [metadata],
        page: {
          total:
            scenario === "recorded-add" && params.get("kind") === "day" ? 0 : 1,
          nextCursor: null,
        },
      },
    });
  });
  if (scenario === "recorded-add")
    await page.addInitScript(
      ({ key, identity }) =>
        localStorage.setItem(key, JSON.stringify(identity)),
      {
        key: `ct-alt:rota-period-template-operation:v1:${actor}:${tenant}:${schedule}`,
        identity: {
          mode: "reconcile",
          tenantId: tenant,
          operationId: id(700),
          action: "add",
          scheduleId: schedule,
          templateId: id(8),
        },
      },
    );
  await page.goto(
    "/rota-period-templates-component-fixture" +
      (scenario === "held-owner"
        ? "?role=owner"
        : scenario === "recorded-add"
          ? "?kind=day"
          : scenario === "parent"
            ? "?parent=1"
            : ""),
  );
  if (scenario === "held-owner")
    await expect(page.getByText("Current fixture role: owner")).toBeVisible();

  return {
    writes,
    release,
    sourceReads: () => sourceReads,
    sourcePageReads: () => sourcePageReads,
    targetReads: () => targetReads,
    catalogReads: () => catalogReads,
    reconciliationReads: () => reconciliationReads,
  };
}
async function save(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill("Reception coverage");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
}
async function catalog(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open catalog", exact: true }).click();
  await expect(
    page.getByText("Reception coverage", { exact: true }),
  ).toBeVisible();
}
async function preview(page: Page) {
  await catalog(page);
  await page.getByLabel("Actions for Reception coverage").click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
}
async function load(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open load", exact: true }).click();
  await page.getByRole("button", { name: /Reception coverage/ }).click();
}
test("Save uses automatic authoritative source proof without custom review", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(
    page.getByRole("button", { name: "Save template" }),
  ).toBeEnabled();
  await expect(
    page.getByText(/Review exact|batch|UTC|elapsed hours/),
  ).toHaveCount(0);
  await save(page);
  await expect.poll(() => state.writes.length).toBe(1);
  expect(savedChange(state.writes).sources).toEqual([
    { id: id(100), revision: 1 },
  ]);
  expect(savedChange(state.writes).source_review_digest).toBe(digest);
});
test("complete first-page selectors save 101 shifts without unused rich pages", async ({
  page,
}) => {
  const state = await setup(page, "normal", 101);
  await save(page);
  await expect.poll(() => state.writes.length).toBe(1);
  expect(savedChange(state.writes).sources).toHaveLength(101);
  expect(state.sourcePageReads()).toBe(0);
});
for (const scenario of ["quota", "gap", "privacy", "denied"])
  test(`${scenario} source cannot write`, async ({ page }) => {
    const state = await setup(page, scenario);
    if (scenario === "denied")
      await expect(page.getByText("Access changed")).toBeVisible();
    else
      await expect(
        page.getByRole("button", { name: "Save template" }),
      ).toBeDisabled();
    expect(state.writes).toHaveLength(0);
  });
test("owner response held across manager demotion cannot install private capacity", async ({
  page,
}) => {
  const state = await setup(page, "held-owner");
  await page
    .getByRole("button", { name: "Change current role" })
    .dispatchEvent("click");
  state.release();
  await expect(page.getByText("Current fixture role: manager")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save template" }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});
test("held source is invalidated by departure", async ({ page }) => {
  const state = await setup(page, "held-source");
  await page
    .getByRole("button", { name: "Leave scheduler fixture" })
    .dispatchEvent("click");
  state.release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
test("preview shows minute clocks and HH:mm totals, without technical precision", async ({
  page,
}) => {
  await setup(page);
  await preview(page);
  await expect(page.getByRole("table")).toContainText("09:00");
  await expect(page.getByRole("table")).toContainText("17:00");
  await expect(page.getByLabel("Template totals")).toContainText("08:00");
  await expect(page.getByRole("dialog")).not.toContainText(
    /000001|Captured|UTC|Shift details|elapsed hours/,
  );
  await expect(
    page.getByRole("columnheader", { name: "Mon", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Sun", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader")).toHaveCount(8);
  await page.screenshot({ path: "/tmp/ct-alt-period-reference-preview.png" });
});
test("preview title precedes clock and summary is at footer", async ({
  page,
}) => {
  await setup(page);
  await preview(page);
  const card = page
    .locator("td div")
    .filter({ hasText: "Reception cover 1" })
    .first();
  await expect(card.locator("strong")).toHaveText("Reception cover 1");
  await expect(page.getByLabel("Template totals")).toContainText(
    "Weekly summary",
  );
});
test("preview search covers captured worker name", async ({ page }) => {
  await setup(page);
  await preview(page);
  await page.getByLabel("Search by name").fill("Maya");
  await expect(
    page.getByRole("rowheader", { name: "Maya Ellis" }),
  ).toBeVisible();
  await page.getByLabel("Search by name").fill("No matching person");
  await expect(page.getByRole("rowheader")).toHaveCount(0);
  await expect(page.getByLabel("Template totals")).toContainText("Shifts 1");
});
test("Hide empty rows is a functional switch", async ({ page }) => {
  await setup(page);
  await preview(page);
  await expect(
    page.getByRole("rowheader", { name: "Noah Bennett" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Hide empty rows" }).check();
  await expect(
    page.getByRole("rowheader", { name: "Noah Bennett" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("rowheader", { name: "Maya Ellis" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Hide empty rows" }).uncheck();
});
test("preview Close returns to catalog without load controls", async ({
  page,
}) => {
  await setup(page);
  await preview(page);
  await expect(page.getByRole("button", { name: "Load template" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Weeks" })).toBeVisible();
});
test("catalog Search retains ordinary title cards", async ({ page }) => {
  await setup(page);
  await catalog(page);
  await page.getByLabel("Search", { exact: true }).fill("Reception");
  await expect(
    page.getByText("Reception coverage", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/1 shifts • created on/)).toBeVisible();
});
test("load automatically preflights then adds exactly one full template", async ({
  page,
}) => {
  const state = await setup(page);
  await load(page);
  await page
    .getByRole("button", { name: "Load template", exact: true })
    .click();
  await expect.poll(() => state.writes.length).toBe(1);
  const change = addedChange(state.writes);
  expect(change.expected_entry_count).toBe(1);
  expect(change.plan_digest).toBe(digest);
  expect(change.target_anchor).toBe("2026-10-05");
  expect(state.targetReads()).toBeGreaterThan(0);
});
for (const scenario of ["target-gap", "target-fold"])
  test(`${scenario} disables Load without guessed endpoints`, async ({
    page,
  }) => {
    const state = await setup(page, scenario);
    await load(page);
    await expect(
      page.getByRole("button", { name: "Load template", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(/Review target|fold|earlier|later|batch/),
    ).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });
test("hidden commitments are not exposed in load chooser", async ({ page }) => {
  const state = await setup(page, "target-hidden");
  await load(page);
  await expect(
    page.getByRole("button", { name: "Load template", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).not.toContainText(
    /hidden|commitment|conflict|quota|capacity/,
  );
  expect(state.targetReads()).toBeGreaterThan(0);
});
test("held mutation locks competing writes and stores field-free identity", async ({
  page,
}) => {
  const state = await setup(page, "held");
  await save(page);
  await expect(
    page.getByRole("button", { name: "Competing scheduling write" }),
  ).toBeDisabled();
  const marker = await page.evaluate(
    () =>
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("ct-alt:rota-period-template-operation:"),
      )?.[1],
  );
  expect(marker).toBeTruthy();
  expect(marker).not.toMatch(
    /Reception|Maya|sources|digest|93000000-0000-4000-8000-000000000100/,
  );
  state.release();
  await expect(
    page.getByRole("button", { name: "Competing scheduling write" }),
  ).toBeEnabled();
});
for (const scenario of ["lost", "bad-ack", "mutation-quota"])
  test(`${scenario} remains locked until authoritative absence, without resend`, async ({
    page,
  }) => {
    const state = await setup(page, scenario);
    await save(page);
    await expect.poll(() => state.reconciliationReads()).toBe(1);
    await expect(
      page.getByRole("button", { name: "Competing scheduling write" }),
    ).toBeDisabled();
    expect(state.writes).toHaveLength(1);
    state.release();
    await expect(
      page.getByRole("button", { name: "Competing scheduling write" }),
    ).toBeEnabled();
    await expect(
      page.getByText("Reception coverage", { exact: true }),
    ).toBeVisible();
    expect(state.writes).toHaveLength(1);
    await expect.poll(() => state.catalogReads()).toBeGreaterThan(0);
  });
test("closure quota retains durable marker and write lock", async ({
  page,
}) => {
  const state = await setup(page, "closure-quota");
  await save(page);
  await expect.poll(() => state.reconciliationReads()).toBe(1);
  await expect(
    page.getByRole("button", { name: "Competing scheduling write" }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        key.startsWith("ct-alt:rota-period-template-operation:"),
      ),
    ),
  ).toBe(true);
});
test("held mutation response after departure cannot apply", async ({
  page,
}) => {
  const state = await setup(page, "held");
  await save(page);
  await page
    .getByRole("button", { name: "Leave scheduler fixture" })
    .dispatchEvent("click");
  state.release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        key.startsWith("ct-alt:rota-period-template-operation:"),
      ),
    ),
  ).toBe(true);
});

test("full historical paging finds later-page users with whole HH:mm totals", async ({
  page,
}) => {
  await setup(page, "history-pages");
  await preview(page);
  await expect(page.getByLabel("Search by name")).toBeEnabled();
  await page.getByLabel("Search by name").fill("Jonah");
  await expect(
    page.getByRole("rowheader", { name: "Jonah Reed" }),
  ).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Maya Ellis" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("table").locator("td strong")).toHaveCount(3);
  await expect(page.getByLabel("Template totals")).toContainText("824:00");
  await expect(page.getByLabel("Template totals")).toContainText("Shifts 103");
  await expect(page.getByLabel("Template totals")).toContainText("Users 2");
});
test("recorded Add restored in already-catalog phase refreshes usable catalogue once without resend", async ({
  page,
}) => {
  const state = await setup(page, "recorded-add");
  await expect.poll(() => state.reconciliationReads()).toBe(1);
  await expect(
    page.getByRole("button", { name: "Competing scheduling write" }),
  ).toBeDisabled();
  state.release();
  await expect(
    page.getByText("Reception coverage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Competing scheduling write" }),
  ).toBeEnabled();
  expect(state.writes).toHaveLength(0);
  await expect(
    page.getByRole("tab", { name: "Weeks", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => state.catalogReads()).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        key.startsWith("ct-alt:rota-period-template-operation:"),
      ),
    ),
  ).toBe(false);
});

test("older catalogue success cannot return after fresh preview denial", async ({
  page,
}) => {
  const state = await setup(page, "late-catalog-denial");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open catalog", exact: true }).click();
  await expect.poll(() => state.catalogReads()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open catalog", exact: true }).click();
  await expect(
    page.getByText("Reception coverage", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Actions for Reception coverage").click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Access changed")).toBeVisible();
  state.release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Reception coverage", { exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
test("empty authoritative source cannot create a template", async ({
  page,
}) => {
  const state = await setup(page, "normal", 0);
  await expect(
    page.getByRole("button", { name: "Save template", exact: true }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test("actual scheduler Save returns ordinary catalogue while explicit Load opens chooser", async ({
  page,
}) => {
  const state = await setup(page, "parent");
  await page
    .getByRole("button", {
      name: "Access schedule Reception team",
      exact: true,
    })
    .click();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-05");
  await page.locator("summary").filter({ hasText: "Actions" }).click();
  await page
    .getByRole("button", { name: "Save week as template", exact: true })
    .click();
  await save(page);
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Shift Templates", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Weeks", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Actions for Reception coverage").click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Weekly Template", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const loadAction = page.getByRole("button", {
    name: "Load week template",
    exact: true,
  });
  if (!(await loadAction.isVisible()))
    await page.locator("summary").filter({ hasText: "Actions" }).click();
  await loadAction.click();
  await expect(
    page.getByRole("heading", { name: "Week templates", exact: true }),
  ).toBeVisible();
});
