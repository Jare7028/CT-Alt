import { test, expect, type Page } from "@playwright/test";
import type { Member } from "../../lib/agent-types";
import type {
  TimeOffData,
  TimeOffChange,
  TimeOffSaved,
} from "../../lib/time-off-types";
import {
  company,
  actor,
  people,
  vacation,
  unpaid,
  request,
  initialData,
} from "./fixture-data";
type Operation = {
  tenantId: string;
  operationId: string;
  change: TimeOffChange;
};
async function captureDesktop(page: Page, name: string) {
  await page.addStyleTag({
    content:
      '[aria-label="Synthetic Time Off controls"], nextjs-portal { display: none !important; }',
  });
  await page.screenshot({ path: `test-results/${name}.png` });
}
async function harness(page: Page) {
  const state = {
    role: "owner" as Member["role"],
    agent: people[0],
    actor,
    tenant: company,
    requests: [
      request(),
      request(2, people[1], "approved"),
      request(3, people[2], "rejected"),
    ],
    types: [{ ...vacation }, { ...unpaid }],
    posts: [] as Operation[],
    gets: [] as URL[],
    receipts: new Map<string, { payload: Operation; saved: TimeOffSaved }>(),
    mode: "normal",
    nextError: "",
    serial: 10,
    errors: [] as string[],
    holdPost: null as (() => void) | null,
  };
  page.on("pageerror", (error) => state.errors.push(error.message));
  function snapshot(url: URL): TimeOffData {
    const manage = state.role === "owner" || state.role === "admin";
    const view = url.searchParams.get("view") || "mine";
    let found = state.requests.filter(
      (row) =>
        view === "team" ||
        (row.agent_id === state.agent.id && row.requested_by === state.actor),
    );
    const search = (url.searchParams.get("search") || "").toLocaleLowerCase();
    if (search)
      found = found.filter((row) =>
        (row.agent_name + " " + row.type_name + " " + row.note)
          .toLocaleLowerCase()
          .includes(search),
      );
    const agentId = url.searchParams.get("agentId"),
      typeId = url.searchParams.get("typeId"),
      start = url.searchParams.get("startDate"),
      end = url.searchParams.get("endDate");
    found = found.filter(
      (row) =>
        (!agentId || row.agent_id === agentId) &&
        (!typeId || row.type_id === typeId) &&
        (!start || row.end_date >= start) &&
        (!end || row.start_date <= end),
    );
    const counts = {
      total: found.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      withdrawn: 0,
      cancelled: 0,
    };
    found.forEach((row) => counts[row.status]++);
    const status = url.searchParams.get("status");
    if (status && status !== "all")
      found = found.filter((row) => row.status === status);
    const offset = Number(
      url.searchParams.get("cursor")?.replace("opaque-page:", "") || 0,
    );
    const rows = found.slice(offset, offset + 50).map((row) => ({
      ...row,
      tenant_id: state.tenant.id,
      canApprove: manage && row.canApprove,
      canReject: manage && row.canReject,
      canCancel: manage && row.canCancel,
      canWithdraw:
        row.status === "pending" &&
        row.requested_by === state.actor &&
        row.agent_id === state.agent.id,
    }));
    return {
      ...initialData(state.role, state.tenant, state.actor, state.agent),
      types: state.types
        .filter((type) => type.status === "active")
        .map((type) => ({ ...type, canArchive: manage })),
      requests: rows,
      counts,
      nextCursor:
        offset + 50 < found.length ? `opaque-page:${offset + 50}` : null,
    };
  }
  function apply(value: Operation): TimeOffSaved {
    const change = value.change;
    const manage = state.role === "owner" || state.role === "admin";
    if (change.action === "request" && change.agentId !== state.agent.id)
      throw {
        status: 403,
        error:
          "Your linked user changed. Review current access before another request.",
      };
    if (
      ["create_type", "archive_type", "approve", "reject", "cancel"].includes(
        change.action,
      ) &&
      !manage
    )
      throw { status: 403, error: "Your Time Off permissions changed." };
    const receipt = state.receipts.get(value.operationId);
    if (receipt) {
      expect(value).toEqual(receipt.payload);
      return receipt.saved;
    }
    if (state.nextError) {
      const error = state.nextError;
      state.nextError = "";
      throw { status: 409, error };
    }
    let saved: TimeOffSaved;
    if (change.action === "create_type") {
      const id = `eeeeeeee-eeee-4eee-8eee-${String(++state.serial).padStart(12, "0")}`;
      state.types.push({
        id,
        name: change.name,
        description: change.description,
        paid: change.paid,
        status: "active",
        revision: 1,
        canArchive: manage,
      });
      saved = {
        operationId: value.operationId,
        action: change.action,
        typeId: id,
        revision: 1,
      };
    } else if (change.action === "archive_type") {
      const type = state.types.find((type) => type.id === change.typeId)!;
      expect(change.revision).toBe(type.revision);
      type.status = "archived";
      type.revision++;
      saved = {
        operationId: value.operationId,
        action: change.action,
        typeId: type.id,
        revision: type.revision,
      };
    } else if (change.action === "request") {
      const type = state.types.find(
        (type) => type.id === change.typeId && type.status === "active",
      );
      if (!type)
        throw { status: 409, error: "This leave type is no longer available." };
      const row = {
        ...request(++state.serial, state.agent),
        requested_by: state.actor,
        start_date: change.startDate,
        end_date: change.endDate,
        calendar_days:
          (Date.parse(change.endDate) - Date.parse(change.startDate)) /
            86400000 +
          1,
        type_id: type.id,
        type_name: type.name,
        type_description: type.description,
        type_paid: type.paid,
        note: change.note,
      };
      state.requests.push(row);
      saved = {
        operationId: value.operationId,
        action: change.action,
        typeId: type.id,
        requestId: row.id,
        revision: 1,
      };
    } else {
      const row = state.requests.find((row) => row.id === change.requestId)!;
      if (row.revision !== change.revision)
        throw {
          status: 409,
          error: "This request changed. Refresh its latest revision.",
        };
      if (
        change.action === "withdraw" &&
        (row.agent_id !== state.agent.id || row.requested_by !== state.actor)
      )
        throw {
          status: 403,
          error: "This request is no longer yours to withdraw.",
        };
      row.status =
        change.action === "approve"
          ? "approved"
          : change.action === "reject"
            ? "rejected"
            : change.action === "cancel"
              ? "cancelled"
              : "withdrawn";
      row.revision++;
      row.canApprove = false;
      row.canReject = false;
      row.canWithdraw = false;
      row.canCancel = row.status === "approved";
      row.decision_name = state.agent.name;
      row.decision_reason = "reason" in change ? change.reason : null;
      row.history.push({
        action: change.action,
        actor_name: state.agent.name,
        occurred_at: "2026-10-03T13:00:00Z",
        revision: row.revision,
        reason: row.decision_reason,
      });
      saved = {
        operationId: value.operationId,
        action: change.action,
        typeId: row.type_id,
        requestId: row.id,
        revision: row.revision,
      };
    }
    state.receipts.set(value.operationId, {
      payload: structuredClone(value),
      saved,
    });
    return saved;
  }
  await page.route("**/api/time-off**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      state.gets.push(url);
      if (state.mode === "deny")
        return route.fulfill({ status: 403, json: { error: "Access denied" } });
      if (state.mode === "failed-read")
        return route.fulfill({ status: 503, json: { error: "Read failed" } });
      if (
        url.searchParams.get("view") === "team" &&
        state.role !== "owner" &&
        state.role !== "admin"
      )
        return route.fulfill({
          status: 403,
          json: { error: "Team access denied" },
        });
      return route.fulfill({ json: snapshot(url) });
    }
    const value = route.request().postDataJSON() as Operation;
    state.posts.push(value);
    if (state.mode === "hold-post")
      await new Promise<void>((resolve) => {
        state.holdPost = resolve;
      });
    try {
      const saved = apply(value);
      if (state.mode === "lost") return route.abort();
      return route.fulfill({
        json: {
          saved:
            state.mode === "bad-ack"
              ? { ...saved, revision: saved.revision + 1 }
              : saved,
        },
      });
    } catch (cause) {
      const failure = cause as { status: number; error: string };
      return route.fulfill({
        status: failure.status,
        json: { error: failure.error },
      });
    }
  });
  await page.goto("/time-off-test-fixture");
  await expect(
    page.getByRole("button", { name: "Request time off", exact: true }),
  ).toBeEnabled();
  return state;
}
async function openDetails(
  page: Page,
  name = "Taylor Example",
  date = "2026-10-24",
) {
  await page
    .getByRole("button", {
      name: `View ${name} Vacation request starting ${date}`,
      exact: true,
    })
    .first()
    .click();
  return page.getByRole("region", { name: "Request details" });
}
async function fillRequest(page: Page, note = "Private synthetic family note") {
  await page
    .getByRole("button", { name: "Request time off", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Request time off",
    exact: true,
  });
  await dialog.getByLabel("Start date", { exact: true }).fill("2026-10-24");
  await dialog.getByLabel("End date", { exact: true }).fill("2026-10-26");
  await dialog.getByLabel("Note for your administrator (optional)").fill(note);
  return dialog;
}
async function waitReady(page: Page) {
  await expect(
    page.getByRole("button", { name: "Request time off", exact: true }),
  ).toBeEnabled();
}
async function marker(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.entries(sessionStorage).filter(([key]) =>
        key.startsWith("ct-alt:time-off:"),
      ),
    ),
  );
}

test("leave type setup/archive retains historical requests and approval reason", async ({
  page,
}) => {
  const state = await harness(page);
  await page.getByRole("button", { name: "Leave types", exact: true }).click();
  await page
    .getByRole("button", { name: "Add leave type", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add leave type" });
  await dialog.getByLabel("Leave type name").fill("Compassionate leave");
  await dialog
    .getByLabel("Leave type description (optional)")
    .fill("Time for family support.");
  await dialog.getByLabel("Payment category").selectOption("unpaid");
  await dialog.getByRole("button", { name: "Save leave type" }).click();
  await expect(
    page.getByText("Compassionate leave", { exact: true }),
  ).toBeVisible();
  expect(state.posts.at(-1)?.change).toEqual({
    action: "create_type",
    name: "Compassionate leave",
    description: "Time for family support.",
    paid: false,
  });
  await page
    .getByRole("button", { name: "Archive Vacation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Archive Vacation?" })
    .getByRole("button", { name: "Archive leave type" })
    .click();
  await expect(
    page.getByRole("button", { name: "Archive Vacation", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Team requests", exact: true })
    .click();
  const detail = await openDetails(page);
  await expect(detail).toContainText("Vacation");
  await detail
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  const decision = page.getByRole("dialog", {
    name: "Approve request",
    exact: true,
  });
  await decision
    .getByLabel("Decision reason (optional)")
    .fill("Coverage confirmed");
  await decision
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await waitReady(page);
  await openDetails(page);
  await expect(
    page.getByRole("region", { name: "Request details" }),
  ).toContainText("Coverage confirmed");
  expect(state.requests[0].status).toBe("approved");
  expect(state.errors).toEqual([]);
});

test("linked user sends inclusive calendar-day request across DST and withdraws pending", async ({
  page,
}) => {
  const state = await harness(page);
  state.role = "employee";
  await page.getByRole("button", { name: "Switch synthetic role" }).click();
  await waitReady(page);
  await expect(
    page.getByRole("button", { name: "Team requests", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Leave types", exact: true }),
  ).toHaveCount(0);
  const dialog = await fillRequest(page);
  await expect(dialog).toContainText("3 calendar days");
  await dialog.getByLabel("End date", { exact: true }).fill("2026-10-23");
  await expect(
    dialog.getByRole("button", { name: "Send for approval" }),
  ).toBeDisabled();
  await dialog.getByLabel("End date", { exact: true }).fill("2026-10-26");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(
    page.getByText("Request sent for approval.", { exact: true }),
  ).toBeVisible();
  expect(state.posts.at(-1)?.change).toMatchObject({
    action: "request",
    agentId: people[0].id,
    startDate: "2026-10-24",
    endDate: "2026-10-26",
    note: "Private synthetic family note",
  });
  expect(state.requests.at(-1)?.calendar_days).toBe(3);
  const detail = await openDetails(page);
  await expect(
    detail.getByRole("button", { name: "Approve request", exact: true }),
  ).toHaveCount(0);
  await detail
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Withdraw request", exact: true })
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  await waitReady(page);
  expect(state.requests[0].status).toBe("withdrawn");
  await expect(page.locator(".time-off-page")).toContainText("calendar day");
  await captureDesktop(page, "time-off-employee-desktop");
});

test("reject and admin cancellation require reasons and preserve decision history", async ({
  page,
}) => {
  const state = await harness(page);
  await page
    .getByRole("button", { name: "Team requests", exact: true })
    .click();
  const detail = await openDetails(page);
  await detail
    .getByRole("button", { name: "Reject request", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Reject request",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Reject request", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Decision reason", { exact: true })
    .fill("No coverage on these dates");
  await dialog
    .getByRole("button", { name: "Reject request", exact: true })
    .click();
  await waitReady(page);
  expect(state.requests[0].status).toBe("rejected");
  const approved = await openDetails(page, "Casey Sample");
  await approved
    .getByRole("button", { name: "Cancel approved request", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Cancel approved request",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", {
      name: "Cancel approved request",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Decision reason", { exact: true })
    .fill("User changed their plans");
  await dialog
    .getByRole("button", { name: "Cancel approved request", exact: true })
    .click();
  await waitReady(page);
  await openDetails(page, "Casey Sample");
  await expect(
    page.getByRole("region", { name: "Request details" }),
  ).toContainText("User changed their plans");
  expect(state.requests[1].history.map((event) => event.action)).toEqual([
    "request",
    "approve",
    "cancel",
  ]);
});

test("team filters use exact counts, bounded opaque paging and retained historical user names", async ({
  page,
}) => {
  const state = await harness(page);
  state.requests.push(
    ...Array.from({ length: 120 }, (_, index) =>
      request(index + 100, people[1], index % 2 ? "approved" : "pending"),
    ),
  );
  await page
    .getByRole("button", { name: "Team requests", exact: true })
    .click();
  await expect(page.locator(".leave-table tbody tr")).toHaveCount(50);
  await expect(page.locator(".leave-counts button").first()).toContainText(
    "123",
  );
  await page.getByRole("button", { name: "Load older requests" }).click();
  await expect(page.locator(".leave-table tbody tr")).toHaveCount(100);
  expect(state.gets.at(-1)?.searchParams.get("cursor")).toBe("opaque-page:50");
  await page
    .getByLabel("Search requests", { exact: true })
    .fill("Morgan Retained");
  await page.getByLabel("From date", { exact: true }).fill("2026-10-25");
  await page.getByLabel("To date", { exact: true }).fill("2026-10-25");
  await page
    .getByLabel("Request status", { exact: true })
    .selectOption("rejected");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".leave-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".leave-counts button").first()).toContainText("1");
  const detail = await openDetails(page, "Morgan Retained");
  await expect(detail).toContainText("Morgan Retained");
  await detail.getByRole("button", { name: "Filter this user" }).click();
  await expect(
    page.getByText("User: Morgan Retained", { exact: true }),
  ).toBeVisible();
  expect(state.gets.at(-1)?.searchParams.get("agentId")).toBe(people[2].id);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".leave-table tbody tr")).toHaveCount(50);
  await captureDesktop(page, "time-off-team-desktop");
});

test("lost acknowledgement locks, failed recovery retains field-free marker, exact retry saves once", async ({
  page,
}) => {
  const state = await harness(page);
  const dialog = await fillRequest(page, "Sensitive synthetic request note");
  state.mode = "lost";
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toBeVisible();
  const first = structuredClone(state.posts.at(-1)!);
  const stored = await marker(page);
  expect(Object.keys(stored)).toHaveLength(1);
  expect(JSON.parse(Object.values(stored)[0])).toEqual({
    operationId: first.operationId,
    action: "request",
  });
  expect(JSON.stringify(stored)).not.toContain("Sensitive");
  state.mode = "failed-read";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await expect(
    page.getByRole("region", { name: "Time Off recovery" }),
  ).toBeVisible();
  await expect(page.locator(".leave-table")).toHaveCount(0);
  expect(await marker(page)).toEqual(stored);
  state.mode = "normal";
  await page.getByRole("button", { name: "Retry last action" }).click();
  await waitReady(page);
  expect(state.posts.at(-1)).toEqual(first);
  expect(
    state.requests.filter(
      (row) => row.note === "Sensitive synthetic request note",
    ),
  ).toHaveLength(1);
  expect(await marker(page)).toEqual({});
});

test("held POST prevents forced manual refresh and new saves, departure retains unknown lock", async ({
  page,
}) => {
  const state = await harness(page);
  const dialog = await fillRequest(page);
  state.mode = "hold-post";
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect.poll(() => !!state.holdPost).toBe(true);
  const before = state.gets.length;
  const refresh = page.getByRole("button", {
    name: "Refresh Time Off",
    exact: true,
  });
  await expect(refresh).toBeDisabled();
  await refresh.evaluate((button) => {
    button.removeAttribute("disabled");
    (button as HTMLButtonElement).click();
  });
  expect(state.gets.length).toBe(before);
  expect(state.posts).toHaveLength(1);
  expect(Object.keys(await marker(page))).toHaveLength(1);
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/time-off") &&
      response.request().method() === "POST",
  );
  state.mode = "normal";
  state.holdPost!();
  await completed;
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  await expect(
    page.getByRole("region", { name: "Time Off recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toHaveCount(0);
  expect(state.gets.length).toBe(before);
  expect(Object.keys(await marker(page))).toHaveLength(1);
  state.mode = "failed-read";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await expect(
    page.getByRole("region", { name: "Time Off recovery" }),
  ).toBeVisible();
  expect(Object.keys(await marker(page))).toHaveLength(1);
  state.mode = "normal";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await waitReady(page);
  expect(await marker(page)).toEqual({});
});

test("departure during acknowledged POST body decoding does not start a stale read", async ({
  page,
}) => {
  const state = await harness(page);
  await page.evaluate(() => {
    const controls = window as unknown as {
      bodyHeld: boolean;
      releaseBody: () => void;
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (args[1]?.method === "POST") {
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const value = await originalJson();
          controls.bodyHeld = true;
          await new Promise<void>((resolve) => {
            controls.releaseBody = resolve;
          });
          return value;
        };
      }
      return response;
    };
  });
  const dialog = await fillRequest(page);
  const before = state.gets.length;
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { bodyHeld: boolean }).bodyHeld),
    )
    .toBe(true);
  expect(state.receipts.size).toBe(1);
  await page.getByRole("button", { name: "Toggle synthetic departure" }).click();
  await page.evaluate(async () => {
    (window as unknown as { releaseBody: () => void }).releaseBody();
    await new Promise(requestAnimationFrame);
  });
  expect(state.gets.length).toBe(before);
  await page.getByRole("button", { name: "Toggle synthetic departure" }).click();
  await expect(
    page.getByRole("region", { name: "Time Off recovery" }),
  ).toBeVisible();
  expect(Object.keys(await marker(page))).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Retry last action" })).toHaveCount(0);
});

test("delayed old read cannot restore rows after a denied read", async ({
  page,
}) => {
  const state = await harness(page);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let old = true;
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      new URL(request.url()).pathname === "/api/time-off" &&
      request.method() === "GET",
  });
  await page.route("**/api/time-off?**", async (route) => {
    if (!old) return route.fallback();
    old = false;
    entered();
    await gate;
    await route.fulfill({ json: initialData() }).catch(() => {});
  });
  await page
    .getByRole("button", { name: "Refresh Time Off", exact: true })
    .click();
  await ready;
  state.mode = "deny";
  await page
    .getByRole("button", { name: "Refresh Time Off", exact: true })
    .click();
  await aborted;
  await expect(
    page.getByRole("region", { name: "Time Off recovery" }),
  ).toBeVisible();
  release();
  await expect(page.locator(".leave-table")).toHaveCount(0);
  await expect(page.locator(".time-off-page")).not.toContainText(
    "Family plans for the weekend.",
  );
});

for (const scope of ["role", "company", "actor", "link"] as const) {
  test(`${scope} prop replacement clears open request notes and stale reads`, async ({
    page,
  }) => {
    const state = await harness(page);
    await fillRequest(page, "Previous identity private note");
    if (scope === "role") {
      state.role = "employee";
      await page
        .getByRole("button", { name: "Switch synthetic role" })
        .evaluate((button) => (button as HTMLButtonElement).click());
    }
    if (scope === "company") {
      state.tenant = {
        ...company,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Second Example Company",
      };
      await page
        .getByRole("button", { name: "Switch synthetic company" })
        .evaluate((button) => (button as HTMLButtonElement).click());
    }
    if (scope === "actor") {
      state.actor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await page
        .getByRole("button", { name: "Switch synthetic actor" })
        .evaluate((button) => (button as HTMLButtonElement).click());
    }
    if (scope === "link") {
      state.agent = people[1];
      await page
        .getByRole("button", { name: "Relink synthetic user" })
        .evaluate((button) => (button as HTMLButtonElement).click());
    }
    await waitReady(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Request time off", exact: true })
      .click();
    await expect(
      page.getByLabel("Note for your administrator (optional)"),
    ).toHaveValue("");
  });
}

test("old exact request retry after server relink is denied without changing its captured agent", async ({
  page,
}) => {
  const state = await harness(page);
  const dialog = await fillRequest(page, "Original user note");
  state.mode = "lost";
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toBeVisible();
  const original = structuredClone(state.posts[0]);
  state.agent = people[1];
  state.mode = "normal";
  await page.getByRole("button", { name: "Retry last action" }).click();
  await expect(page.locator(".time-off-page").getByRole("alert")).toContainText(
    "linked user changed",
  );
  expect(state.posts[1]).toEqual(original);
  expect(
    state.requests.filter((row) => row.note === "Original user note"),
  ).toHaveLength(1);
  await expect(page.locator(".leave-table")).toHaveCount(0);
});

for (const failure of [
  "This request changed. Refresh its latest revision.",
  "Approved leave overlaps these dates.",
]) {
  test(`rejected mutation remains explicit and locked: ${failure}`, async ({
    page,
  }) => {
    const state = await harness(page);
    const dialog = await fillRequest(page);
    state.nextError = failure;
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.locator(".time-off-page").getByRole("alert"),
    ).toContainText(failure);
    await expect(
      page.getByRole("region", { name: "Time Off recovery" }),
    ).toBeVisible();
    await expect(
      page.getByText("Request sent for approval.", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh to recover" }).click();
    await waitReady(page);
    expect(await marker(page)).toEqual({});
  });
}

test("malformed save acknowledgement locks until a successful fresh read", async ({
  page,
}) => {
  const state = await harness(page);
  const dialog = await fillRequest(page);
  state.mode = "bad-ack";
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.locator(".time-off-page").getByRole("alert")).toContainText(
    "could not be confirmed",
  );
  await expect(
    page.getByRole("region", { name: "Time Off recovery" }),
  ).toBeVisible();
  expect(Object.keys(await marker(page))).toHaveLength(1);
  state.mode = "normal";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await waitReady(page);
  expect(await marker(page)).toEqual({});
});

test("retained inactive request uses explicit server capabilities and historical names", async ({
  page,
}) => {
  const state = await harness(page);
  const row = request(20, people[2]);
  row.canApprove = false;
  state.requests.push(row);
  await page
    .getByRole("button", { name: "Team requests", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "View Morgan Retained Vacation request starting 2026-10-24",
      exact: true,
    })
    .last()
    .click();
  const detail = page.getByRole("region", { name: "Request details" });
  await expect(
    detail.getByRole("button", { name: "Approve request", exact: true }),
  ).toBeDisabled();
  await expect(
    detail.getByRole("button", { name: "Reject request", exact: true }),
  ).toBeEnabled();
  await expect(detail).toContainText("Morgan Retained");
  await expect(detail).toContainText("Historical entries are read only");
  await detail.screenshot({ path: "test-results/time-off-detail-desktop.png" });
});
