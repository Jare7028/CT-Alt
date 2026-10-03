import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(
  readFileSync("/tmp/ct-alt-local-fixtures.json", "utf8"),
);
if (fixtures.url !== "http://127.0.0.1:54821")
  throw new Error("Independent local CT Alt fixtures required");
async function login(page: Page, role: string) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(fixtures.accounts[role].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(fixtures.accounts[role].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);
  if (role === "employee") {
    await page.goto("/rotas?company=" + fixtures.tenantA);
  } else {
    await page.locator(".ct-sidebar nav").getByRole("link", { name: "Client Rotas", exact: true }).click();
    await expect(page).toHaveURL("/rotas?company=" + fixtures.tenantA);
  }
  await expect(
    page.getByRole("heading", { name: "Job scheduling" }),
  ).toBeVisible();
  await expect(page.getByText("Loading schedules…")).not.toBeVisible();
}
test("owner creates drafts; manager publishes; employee sees only published own shifts", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "owner");
  const prior = await (
    await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)
  ).json();
  expect(
    prior.schedules.filter((s: { name: string }) =>
      s.name.startsWith("Synthetic client rota "),
    ),
    "Restart the disposable browser fixture before each full suite run.",
  ).toHaveLength(0);
  const name = "Synthetic client rota " + Date.now();
  await page
    .getByRole("button", { name: "Create schedule", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Schedule name").fill(name);
  await dialog.getByLabel("Synthetic employee", { exact: true }).check();
  await dialog
    .getByRole("group", { name: "Assigned users" })
    .getByLabel("Synthetic manager", { exact: true })
    .check();
  await dialog
    .getByRole("group", { name: "Schedule administrators" })
    .getByLabel("Synthetic manager", { exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Create schedule", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Job list", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Job name").fill("Client care");
  await dialog.getByLabel("Job color").fill("#285c4c");
  await dialog.getByRole("button", { name: "Add job" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-24");
  await page.getByRole("button", { name: "Add ▾", exact: true }).click();
  await page
    .getByRole("button", { name: "Add single shift", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Start", { exact: true }).fill("2026-10-24T23:00");
  await dialog.getByLabel("End", { exact: true }).fill("2026-10-25T07:00");
  await dialog.getByLabel("Shift title").fill("Overnight care");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Period summary")).toContainText("9.0 hours");
  await expect(
    page.getByRole("button", { name: /Edit draft Overnight care/ }),
  ).toHaveCount(2);
  // Edit before publishing; an exact reload snapshot guards against stale saves.
  await page
    .getByRole("button", { name: /Edit draft Overnight care/ })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Shift title").fill("Reviewed overnight care");
  await page.screenshot({
    path: "test-results/rotas-shift-dialog.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog).not.toBeVisible();
  // Put a real coworker's draft in the same schedule before publishing.
  const ownerRead = await (
    await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)
  ).json();
  const current = ownerRead.schedules.find(
    (s: { name: string }) => s.name === name,
  );
  const coworker = ownerRead.agents.find(
    (a: { last_name: string }) => a.last_name === "manager",
  );
  const job = ownerRead.jobs.find(
    (j: { schedule_id: string }) => j.schedule_id === current.id,
  );
  const coworkerSave = await page.request.post("/api/rotas", {
    headers: { Origin: "http://127.0.0.1:5180" },
    data: {
      tenantId: fixtures.tenantA,
      change: {
        action: "save_shift",
        schedule_id: current.id,
        revision: current.revision,
        agent_id: coworker.id,
        job_id: job.id,
        starts_at: "2026-10-24T08:00:00Z",
        ends_at: "2026-10-24T16:00:00Z",
        title: "Coworker care",
        allow_overlap: false,
      },
    },
  });
  expect(coworkerSave.ok()).toBe(true);
  const employeeContext = await browser.newContext();
  const employee = await employeeContext.newPage();
  await login(employee, "employee");
  await employee.getByRole("button", { name, exact: true }).click();
  await employee.getByLabel("Date", { exact: true }).fill("2026-10-24");
  await expect(employee.getByLabel("Period summary")).toContainText("0 shifts");
  await expect(
    employee.getByRole("button", { name: "Add ▾", exact: true }),
  ).toHaveCount(0);
  const schedules = await employee.request.get(
    "/api/rotas?tenantId=" + fixtures.tenantA,
  );
  expect(schedules.status()).toBe(200);
  const read = await schedules.json();
  const schedule = read.schedules.find(
    (s: { name: string }) => s.name === name,
  );
  expect(
    read.shifts.filter(
      (s: { schedule_id: string }) => s.schedule_id === schedule.id,
    ),
  ).toEqual([]);
  const denied = await employee.request.post("/api/rotas", {
    headers: { Origin: "http://127.0.0.1:5180" },
    data: {
      tenantId: fixtures.tenantA,
      change: {
        action: "publish",
        schedule_id: schedule.id,
        revision: schedule.revision,
      },
    },
  });
  expect(denied.status()).toBe(403);
  const invalidOrigin = await page.request.post("/api/rotas", {
    headers: { Origin: "https://unowned.example" },
    data: {
      tenantId: fixtures.tenantA,
      change: {
        action: "publish",
        schedule_id: schedule.id,
        revision: schedule.revision,
      },
    },
  });
  expect(invalidOrigin.status()).toBe(403);
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, "manager");
  await expect(
    manager.getByRole("button", { name: "Create schedule", exact: true }),
  ).toHaveCount(0);
  await manager.getByRole("button", { name, exact: true }).click();
  await manager
    .getByRole("button", { name: "Publish (2)", exact: true })
    .click();
  await manager
    .getByRole("dialog")
    .getByRole("button", { name: "Publish all drafts" })
    .click();
  await expect(
    manager.getByRole("status").filter({ hasText: "Published." }),
  ).toBeVisible();
  await employee.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(employee.getByLabel("Period summary")).toContainText(
    "9.0 hours",
  );
  await expect(
    employee.getByRole("button", { name: /Published Reviewed overnight care/ }),
  ).toHaveCount(2);
  const employeeRead = await (
    await employee.request.get("/api/rotas?tenantId=" + fixtures.tenantA)
  ).json();
  const ownShifts = employeeRead.shifts.filter(
    (s: { schedule_id: string }) => s.schedule_id === schedule.id,
  );
  expect(ownShifts).toHaveLength(1);
  expect(
    employeeRead.shifts.some(
      (s: { title: string }) => s.title === "Coworker care",
    ),
  ).toBe(false);
  await expect(
    employee.getByText("Coworker care", { exact: true }),
  ).toHaveCount(0);
  await employee.getByRole("tab", { name: "Day", exact: true }).click();
  await expect(employee.getByLabel("Period summary")).toContainText(
    "1.0 hours",
  );
  await employee.getByRole("button", { name: "Next period" }).click();
  await expect(employee.getByLabel("Period summary")).toContainText(
    "8.0 hours",
  );
  await employee.getByRole("tab", { name: "Month", exact: true }).click();
  await expect(employee.getByRole("columnheader")).toHaveCount(32);
  await expect(employee.getByLabel("Period summary")).toContainText(
    "9.0 hours",
  );
  const stale = await page.request.post("/api/rotas", {
    headers: { Origin: "http://127.0.0.1:5180" },
    data: {
      tenantId: fixtures.tenantA,
      change: {
        action: "add_job",
        schedule_id: schedule.id,
        revision: schedule.revision,
        name: "Stale job",
        color: "#123456",
      },
    },
  });
  expect(stale.status()).toBe(409);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publish (0)", exact: true }),
  ).toBeDisabled();
  await page.getByRole("searchbox", { name: "Search users" }).fill("unmatched");
  await expect(
    page.getByText("No assigned users match this search."),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Search users" }).fill("");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/rotas-manager-desktop.png",
    fullPage: true,
  });
  await employee.getByRole("tab", { name: "Week", exact: true }).click();
  await employee.setViewportSize({ width: 1440, height: 1000 });
  await employee.screenshot({
    path: "test-results/rotas-employee-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("table").evaluate((table) => {
    const scroller = table.parentElement!;
    scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.screenshot({
    path: "test-results/rotas-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "All schedules", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/rotas-lobby.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await employeeContext.close();
  await managerContext.close();
});
test("API rejects unauthenticated reads and malformed changes", async ({
  request,
}) => {
  expect(
    (await request.get("/api/rotas?tenantId=" + fixtures.tenantA)).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/rotas", {
        headers: { Origin: "http://127.0.0.1:5180" },
        data: {
          tenantId: fixtures.tenantA,
          change: {
            action: "create_schedule",
            name: "X",
            time_zone: "UTC",
            agent_ids: [],
            admin_ids: [],
            role: "owner",
          },
        },
      })
    ).status(),
  ).toBe(400);
});

test("expired access cookie refreshes and persists on direct rota navigation", async ({
  page,
  context,
}) => {
  await login(page, "owner");
  const cookies = (await context.cookies())
    .filter((c) => /^ct-alt-auth(?:\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const value = cookies.map((c) => c.value).join("");
  expect(value.startsWith("base64-")).toBe(true);
  const session = JSON.parse(
    Buffer.from(value.slice(7), "base64url").toString(),
  );
  const [header, payload] = session.access_token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const expiredBody = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const unsigned = header + "." + expiredBody;
  const { createHmac } = await import("node:crypto");
  // Sign only inside the ephemeral local fixture, with its generated test key.
  expect(typeof fixtures.jwtSecret).toBe("string");
  session.access_token =
    unsigned +
    "." +
    createHmac("sha256", fixtures.jwtSecret)
      .update(unsigned)
      .digest("base64url");
  session.expires_at = claims.exp;
  const expiredValue =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const chunkSize = 3180;
  const replacements = [];
  for (let i = 0; i < Math.ceil(expiredValue.length / chunkSize); i++) {
    replacements.push({
      ...cookies[0],
      name:
        expiredValue.length <= chunkSize ? "ct-alt-auth" : "ct-alt-auth." + i,
      value: expiredValue.slice(i * chunkSize, (i + 1) * chunkSize),
    });
  }
  for (const c of cookies) await context.clearCookies({ name: c.name });
  await context.addCookies(replacements);
  const response = await page.goto("/rotas?company=" + fixtures.tenantA);
  expect(response?.status()).toBe(200);
  expect((await response!.allHeaders())["set-cookie"]).toContain("ct-alt-auth");
  await expect(
    page.getByRole("heading", { name: "Job scheduling" }),
  ).toBeVisible();
  await expect(page.getByText("Loading schedules…")).not.toBeVisible();
  const refreshed = (await context.cookies())
    .filter((c) => /^ct-alt-auth(?:\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((c) => c.value)
    .join("");
  expect(refreshed).not.toBe(expiredValue);
  const freshSession = JSON.parse(
    Buffer.from(refreshed.slice(7), "base64url").toString(),
  );
  expect(freshSession.expires_at).toBeGreaterThan(Date.now() / 1000);
  expect(
    (
      await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)
    ).status(),
  ).toBe(200);
});

test("unsupported legacy timezone renders a warning and blocks editing; API rejects new invalid zone", async ({
  page,
}) => {
  await login(page, "owner");
  await page
    .getByRole("button", {
      name: "Synthetic legacy unsupported zone",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This schedule’s time zone" }),
  ).toContainText("Times are shown in UTC and shift editing is disabled");
  await expect(
    page.getByRole("button", { name: "Add ▾", exact: true }),
  ).toHaveCount(0);
  const result = await page.request.post("/api/rotas", {
    headers: { Origin: "http://127.0.0.1:5180" },
    data: {
      tenantId: fixtures.tenantA,
      change: {
        action: "create_schedule",
        name: "Unsupported zone",
        time_zone: "Factory",
        agent_ids: ["60000000-0000-4000-8000-000000000001"],
        admin_ids: [],
      },
    },
  });
  expect(result.status()).toBe(400);
  expect((await result.json()).error).toContain("supported");
  await page.screenshot({
    path: "test-results/rotas-unsupported-zone.png",
    fullPage: true,
  });
});

test("schedule settings preserve shifts, show errors, cancel safely and revoke managers", async ({
  page,
  browser,
}) => {
  await login(page, "owner");
  const fetchData = async () =>
    (await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)).json();
  const initial = await fetchData();
  const employee = initial.agents.find(
    (a: { first_name: string; last_name: string }) =>
      a.first_name + " " + a.last_name === "Synthetic employee",
  );
  const manager = initial.members.find(
    (m: { role: string }) => m.role === "manager",
  );
  const post = (change: Record<string, unknown>) =>
    page.request.post("/api/rotas", {
      headers: { Origin: "http://127.0.0.1:5180" },
      data: { tenantId: fixtures.tenantA, change },
    });
  const name = "Synthetic settings rota";
  let result = await post({
    action: "create_schedule",
    name,
    time_zone: "Europe/London",
    agent_ids: [employee.id],
    admin_ids: [manager.user_id],
  });
  expect(result.status()).toBe(200);
  const id = (await result.json()).saved.schedule_id;
  result = await post({
    action: "add_job",
    schedule_id: id,
    revision: 1,
    name: "Settings care",
    color: "#285c4c",
  });
  expect(result.status()).toBe(200);
  let snapshot = await fetchData();
  const job = snapshot.jobs.find(
    (j: { schedule_id: string }) => j.schedule_id === id,
  );
  result = await post({
    action: "save_shift",
    schedule_id: id,
    revision: 2,
    agent_id: employee.id,
    job_id: job.id,
    starts_at: "2030-10-26T22:00:00Z",
    ends_at: "2030-10-27T07:00:00Z",
    title: "Settings overnight draft",
    allow_overlap: false,
  });
  expect(result.status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Schedule name").fill("Cancelled name");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Schedule name").fill("Escape cancelled");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Synthetic employee", { exact: true }).uncheck();
  await dialog.getByLabel("Synthetic manager", { exact: true }).first().check();
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Cannot remove a user with retained shifts",
  );
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Synthetic employee", { exact: true }).check();
  await dialog
    .getByLabel("Synthetic manager", { exact: true })
    .first()
    .uncheck();
  await dialog.getByLabel("Schedule name").fill("Synthetic settings renamed");
  await dialog
    .getByLabel("Time zone", { exact: true })
    .fill("America/New_York");
  await dialog
    .getByRole("group", { name: "Schedule administrators" })
    .getByLabel("Synthetic manager", { exact: true })
    .uncheck();
  await page.screenshot({
    path: "test-results/rotas-settings.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic settings renamed",
      exact: true,
    }),
  ).toBeVisible();
  snapshot = await fetchData();
  expect(
    snapshot.schedules.find((s: { id: string }) => s.id === id),
  ).toMatchObject({ time_zone: "America/New_York", revision: 4 });
  expect(
    snapshot.shifts.find((s: { schedule_id: string }) => s.schedule_id === id),
  ).toMatchObject({
    status: "draft",
    starts_at: "2030-10-26T22:00:00+00:00",
    ends_at: "2030-10-27T07:00:00+00:00",
  });
  expect(
    snapshot.admins.filter(
      (a: { schedule_id: string }) => a.schedule_id === id,
    ),
  ).toHaveLength(0);
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await login(managerPage, "manager");
  expect(
    (
      await (
        await managerPage.request.get("/api/rotas?tenantId=" + fixtures.tenantA)
      ).json()
    ).schedules.some((s: { id: string }) => s.id === id),
  ).toBe(false);
  await managerContext.close();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog");
  result = await post({
    action: "add_job",
    schedule_id: id,
    revision: 4,
    name: "Concurrent job",
    color: "#123456",
  });
  expect(result.status()).toBe(200);
  await dialog.getByLabel("Schedule name").fill("Stale name");
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This schedule changed. Reload before saving.",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic settings renamed",
      exact: true,
    }),
  ).toBeVisible();
});

test("lost create acknowledgement blocks duplicate retries until a fresh review", async ({ page }) => {
  await login(page, "owner");
  const name = "Synthetic uncertain creation " + Date.now();
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create schedule", exact: true });
  await dialog.getByLabel("Schedule name").fill(name);
  await dialog.getByLabel("Synthetic employee", { exact: true }).check();
  let writes = 0;
  await page.route("**/api/rotas", async route => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    // Commit against the real local API/database, then discard its acknowledgement.
    await route.abort("connectionfailed");
  });
  await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("confirmation was lost");
  await expect(dialog.getByRole("button", { name: "Create schedule", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await dialog.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  const saved = await (await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)).json();
  expect(saved.schedules.filter((schedule: { name: string }) => schedule.name === name)).toHaveLength(1);
  expect(writes).toBe(1);
  await page.route("**/api/rotas?*", route => route.fulfill({ status: 503, json: { error: "Temporary read failure" } }));
  await dialog.getByRole("button", { name: "Reload schedules to review" }).click();
  await expect(dialog.getByRole("button", { name: "Create schedule", exact: true })).toBeDisabled();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary read failure" })).toBeVisible();
  await page.unroute("**/api/rotas?*");
  await dialog.getByRole("button", { name: "Reload schedules to review" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
  expect(writes).toBe(1);
});

test("acknowledged settings followed by a lost response stay locked until a successful review", async ({ page }) => {
  await login(page, "owner");
  const name = "Synthetic settings recovery " + Date.now();
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Schedule name").fill(name);
  await dialog.getByLabel("Time zone", { exact: true }).fill("Europe/London");
  await dialog.getByLabel("Synthetic employee", { exact: true }).check();
  await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByLabel("Schedule name").fill(name + " acknowledged");
  await dialog.getByLabel("Time zone", { exact: true }).fill("America/New_York");
  await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: name + " acknowledged", exact: true })).toBeVisible();
  const fetchData = async () => (await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)).json();
  const acknowledged = (await fetchData()).schedules.find((schedule: { name: string }) => schedule.name === name + " acknowledged");
  expect(acknowledged).toMatchObject({ revision: 2, time_zone: "America/New_York" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByLabel("Schedule name").fill(name + " unconfirmed");
  await dialog.getByLabel("Time zone", { exact: true }).fill("UTC");
  let writes = 0;
  await page.route("**/api/rotas", async route => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON().change.action).toBe("update_schedule");
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("connectionfailed");
  });
  await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("confirmation was lost");
  await expect(dialog.getByLabel("Schedule name")).toBeDisabled();
  await expect(dialog.getByLabel("Time zone", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await dialog.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect((await fetchData()).schedules.find((schedule: { id: string }) => schedule.id === acknowledged.id)).toMatchObject({ name: name + " unconfirmed", revision: 3, time_zone: "UTC" });
  expect(writes).toBe(1);
  await page.route("**/api/rotas?*", route => route.fulfill({ status: 503, json: { error: "Temporary settings read failure" } }));
  await dialog.getByRole("button", { name: "Reload schedules to review" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary settings read failure" })).toBeVisible();
  await expect(dialog.getByLabel("Schedule name")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await expect(dialog).toBeVisible();
  await page.unroute("**/api/rotas?*");
  await dialog.getByRole("button", { name: "Reload schedules to review" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: name + " unconfirmed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dialog.getByLabel("Schedule name")).toHaveValue(name + " unconfirmed");
  await expect(dialog.getByLabel("Time zone", { exact: true })).toHaveValue("UTC");
  await expect(dialog.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
  expect((await fetchData()).schedules.find((schedule: { id: string }) => schedule.id === acknowledged.id)?.revision).toBe(3);
  expect(writes).toBe(1);
  await page.unroute("**/api/rotas");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
