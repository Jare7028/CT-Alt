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
  await page.goto("/rotas?company=" + fixtures.tenantA);
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
  // Archive only this suite's prior synthetic schedules when rerunning locally.
  const prior = await (
    await page.request.get("/api/rotas?tenantId=" + fixtures.tenantA)
  ).json();
  for (const s of prior.schedules.filter(
    (s: { name: string; status: string }) =>
      s.name.startsWith("Synthetic client rota ") && s.status === "active",
  )) {
    const archived = await page.request.post("/api/rotas", {
      headers: { Origin: "http://127.0.0.1:5180" },
      data: {
        tenantId: fixtures.tenantA,
        change: { action: "archive", schedule_id: s.id, revision: s.revision },
      },
    });
    expect(archived.ok()).toBe(true);
  }
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByText("Loading schedules…")).not.toBeVisible();
  const name = "Synthetic client rota " + Date.now();
  await page
    .getByRole("button", { name: "Create schedule", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Schedule name").fill(name);
  await dialog.getByLabel("Synthetic employee", { exact: true }).check();
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
    .getByRole("button", { name: "Publish (1)", exact: true })
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
