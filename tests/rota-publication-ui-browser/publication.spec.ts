import { test, expect, type Page, type Route } from "@playwright/test";
import type { RotaData, RotaShift } from "../../lib/rota-types";
import type { RotaPublicationMutation } from "../../lib/rota-publication-types";
const id = (n: number) =>
    `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1),
  actor = id(2),
  schedule = id(3),
  job = id(4),
  otherJob = id(5),
  alice = id(6),
  bob = id(7);
function shift(
  n: number,
  agent = alice,
  jobId = job,
  start = "2026-10-05T09:00:00Z",
  end = "2026-10-05T17:00:00Z",
  status: "draft" | "published" = "draft",
): RotaShift {
  return {
    id: id(n),
    schedule_id: schedule,
    agent_id: agent,
    job_id: jobId,
    starts_at: start,
    ends_at: end,
    title: `Cover ${n}`,
    status,
    revision: 1,
  };
}
const initial = (): RotaData => ({
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
    { id: job, schedule_id: schedule, name: "Reception", color: "#2998ff" },
    { id: otherJob, schedule_id: schedule, name: "Patrol", color: "#af7ad9" },
  ],
  shifts: [
    shift(10),
    shift(11, bob),
    shift(12, alice, job, "2026-10-12T09:00:00Z", "2026-10-12T17:00:00Z"),
    shift(13, alice, job, undefined, undefined, "published"),
    shift(14, alice, job, "2026-10-05T23:00:00Z", "2026-10-06T02:00:00Z"),
    shift(15, alice, otherJob),
  ],
  agents: [
    { id: alice, first_name: "Alice", last_name: "Morgan", status: "active" },
    { id: bob, first_name: "Bob", last_name: "Clarke", status: "active" },
  ],
  assignments: [
    { schedule_id: schedule, agent_id: alice },
    { schedule_id: schedule, agent_id: bob },
  ],
  admins: [],
  members: [],
});
async function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function setup(page: Page, scenario = "normal") {
  const data = initial(),
    posts: RotaPublicationMutation[] = [],
    legacy: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0,
    settledReads = 0;
  await page.route("**/api/rotas**", async (route) => {
    if (route.request().method() === "POST") {
      legacy.push(route.request().postData() || "");
      return json(route, { error: "Unexpected legacy write" }, 400);
    }
    reads++;
    if (scenario === "held-read-denial" && reads > 1) await held;
    await json(route, data);
    settledReads++;
    return;
  });
  await page.route("**/api/rota-publication", async (route) => {
    const op = route.request().postDataJSON() as RotaPublicationMutation;
    posts.push(op);
    if (scenario === "held" || scenario === "departure") await held;
    if (scenario === "denied" || scenario === "held-read-denial")
      return json(route, { error: "Access revoked" }, 403);
    data.shifts = data.shifts.map((s) =>
      op.shifts.some((target) => target.id === s.id)
        ? { ...s, status: "published", revision: s.revision + 1 }
        : s,
    );
    data.schedules[0].revision++;
    if (scenario === "lost") return route.abort();
    const saved = {
      schemaVersion: 1,
      tenantId: tenant,
      actorId: actor,
      schedule_id: schedule,
      schedule_revision: op.scheduleRevision + 1,
      published_count: op.shifts.length,
      shifts: op.shifts
        .map((s) => ({ id: s.id, revision: s.revision + 1 }))
        .reverse(),
    };
    if (scenario === "bad-ack") saved.shifts[0].revision++;
    return json(route, { saved });
  });
  await page.goto("/rota-publication-component-fixture");
  await page.getByRole("button", { name: "Access schedule" }).click();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-05");
  return {
    data,
    posts,
    legacy,
    release,
    reads: () => reads,
    settledReads: () => settledReads,
  };
}
async function filter(page: Page) {
  await page.getByLabel("Search users").fill("Alice");
  await page.locator("summary").filter({ hasText: "Filters" }).click();
  await page
    .getByRole("combobox", { name: "Job", exact: true })
    .selectOption(job);
  await page.locator("summary").filter({ hasText: "Filters" }).click();
}
test("filtered visible week excludes other workers, jobs, dates and published shifts; overnight target appears once", async ({
  page,
}) => {
  const { posts, data, legacy } = await setup(page);
  await filter(page);
  await page.getByRole("button", { name: "Publish (2)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish draft shifts" });
  await expect(dialog).toContainText("Week: 2026-10-05 – 2026-10-11");
  await expect(dialog).toContainText("Worker search: “Alice”");
  await expect(dialog).toContainText("Job: Reception");
  await dialog
    .getByRole("button", { name: "Publish displayed drafts" })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toEqual([
    {
      tenantId: tenant,
      scheduleId: schedule,
      scheduleRevision: 1,
      shifts: [
        { id: id(10), revision: 1 },
        { id: id(14), revision: 1 },
      ],
    },
  ]);
  expect(legacy).toHaveLength(0);
  expect(
    data.shifts.filter((s) => s.status === "draft").map((s) => s.id),
  ).toEqual([id(11), id(12), id(15)]);
  await expect(
    page.getByRole("button", { name: "Publish (0)", exact: true }),
  ).toBeDisabled();
});
test("day overlap and month scope use actual visible unique drafts", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("tab", { name: "Day", exact: true }).click();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-06");
  await expect(
    page.getByRole("button", { name: "Publish (1)", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Month", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publish (5)", exact: true }),
  ).toBeEnabled();
});
test("published-only status and empty worker search disable publication", async ({
  page,
}) => {
  await setup(page);
  await page.locator("summary").filter({ hasText: "Filters" }).click();
  await page.getByLabel("Shift status").selectOption("published");
  await expect(
    page.getByRole("button", { name: "Publish (0)", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Shift status").selectOption("");
  await page.locator("summary").filter({ hasText: "Filters" }).click();
  await page.getByLabel("Search users").fill("Nobody");
  await expect(
    page.getByRole("button", { name: "Publish (0)", exact: true }),
  ).toBeDisabled();
});
test("confirmation freezes IDs, revisions and caption when underlying period changes", async ({
  page,
}) => {
  const { posts } = await setup(page);
  await filter(page);
  await page.getByRole("button", { name: "Publish (2)", exact: true }).click();
  await page
    .getByLabel("Date", { exact: true })
    .evaluate((element: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(element, "2026-10-12");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const dialog = page.getByRole("dialog", { name: "Publish draft shifts" });
  await expect(dialog).toContainText("Week: 2026-10-05 – 2026-10-11");
  await dialog
    .getByRole("button", { name: "Publish displayed drafts" })
    .click();
  expect(posts[0].shifts.map((s) => s.id)).toEqual([id(10), id(14)]);
});
for (const scenario of ["lost", "bad-ack"]) {
  test(`${scenario} acknowledgement locks changes until manual review without retry`, async ({
    page,
  }) => {
    const { posts } = await setup(page, scenario);
    await filter(page);
    await page
      .getByRole("button", { name: "Publish (2)", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Publish draft shifts" });
    await dialog
      .getByRole("button", { name: "Publish displayed drafts" })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "confirmation was lost",
    );
    await expect(
      dialog.getByRole("button", { name: "Publish displayed drafts" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Reload schedules to review" })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: "Publish (0)", exact: true }),
    ).toBeDisabled();
  });
}
test("held acknowledgement prevents duplicate submissions and Escape", async ({
  page,
}) => {
  const { posts, release } = await setup(page, "held");
  await filter(page);
  await page.getByRole("button", { name: "Publish (2)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish draft shifts" });
  await dialog
    .getByRole("button", { name: "Publish displayed drafts" })
    .click();
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(posts).toHaveLength(1);
  release();
  await expect(dialog).toHaveCount(0);
});
test("current denial clears retained scheduling data and confirmation", async ({
  page,
}) => {
  await setup(page, "denied");
  await filter(page);
  await page.getByRole("button", { name: "Publish (2)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish draft shifts" });
  await dialog
    .getByRole("button", { name: "Publish displayed drafts" })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Scheduling access changed",
  );
  await expect(page.getByText("Alice Morgan", { exact: true })).toHaveCount(0);
});
test("late acknowledgement after departure does not restore scheduler success", async ({
  page,
}) => {
  const { release } = await setup(page, "departure");
  await filter(page);
  await page.getByRole("button", { name: "Publish (2)", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Publish draft shifts" })
    .getByRole("button", { name: "Publish displayed drafts" })
    .click();
  await page
    .getByRole("button", { name: "Leave scheduler fixture" })
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByText("Left scheduler", { exact: true })).toBeVisible();
  release();
  await expect(
    page.getByText(/Published 2 displayed draft shifts/),
  ).toHaveCount(0);
});

test("held earlier successful read cannot restore workforce after current publication denial", async ({
  page,
}) => {
  const { release, reads, settledReads } = await setup(
    page,
    "held-read-denial",
  );
  await page.route("**/api/rota-templates?**", (route) =>
    json(route, {
      schemaVersion: 1,
      tenantId: tenant,
      actorId: actor,
      schedule: {
        id: schedule,
        revision: 1,
        time_zone: "UTC",
        status: "active",
      },
      templates: [],
      page: { total: 0, nextCursor: null },
    }),
  );
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const templates = page.getByRole("dialog", { name: "Shift Templates" });
  await templates
    .getByRole("button", { name: "Refresh templates and schedules" })
    .click();
  await expect.poll(reads).toBe(2);
  await templates.getByRole("button", { name: "Close templates" }).click();
  await filter(page);
  await page.getByRole("button", { name: "Publish (2)", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Publish draft shifts" })
    .getByRole("button", { name: "Publish displayed drafts" })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Scheduling access changed",
  );
  release();
  await expect.poll(settledReads).toBe(2);
  await expect(page.getByText("Alice Morgan", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Publish \(/ })).toHaveCount(
    0,
  );
});
