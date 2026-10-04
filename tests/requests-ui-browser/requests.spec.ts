import { test, expect, type Page, type Route } from "@playwright/test";
import {
  board,
  request,
  detail,
  saved,
  tenant,
  actor,
  agent,
  linkedActor,
  ids,
  stamp,
} from "./fixture-data";
import type {
  RequestsBoardData,
  RequestsMutation,
  RequestStatus,
  WorkRequest,
} from "../../lib/requests-types";
const fixture = "/request-board-component-fixture";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const statuses: RequestStatus[] = ["new", "in_progress", "done"];
const key = `ct-alt:requests:v1:${actor}:${tenant}`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function install(page: Page, scenario = "owner") {
  let data = board(scenario),
    version = 1;
  const posts: RequestsMutation[] = [],
    gets: URL[] = [],
    receipts = new Map<string, ReturnType<typeof saved>>();
  let extra: WorkRequest | null =
    scenario === "paged"
      ? {
          ...request(0),
          id: "94000000-0000-4000-8000-000000000005",
          title: "Inspect reception desk",
        }
      : null;
  const rows = () => [
    ...statuses.flatMap((s) => data.columns[s].requests),
    ...(extra ? [extra] : []),
  ];
  function commit(op: RequestsMutation) {
    const old = rows().find(
      (r) => op.change.action !== "create" && r.id === op.change.requestId,
    );
    const next =
      op.change.action === "create"
        ? {
            ...request(0),
            id:
              "94000000-0000-4000-8000-" +
              String(100 + version).padStart(12, "0"),
            title: op.change.title,
            description: op.change.description,
            priority: op.change.priority,
            dueDate: op.change.dueDate,
            assignee: op.change.assigneeAgentId
              ? {
                  agentId: op.change.assigneeAgentId,
                  actorId: op.change.assigneeActorId!,
                  name: "Taylor Example",
                  eligible: true,
                }
              : null,
          }
        : op.change.action === "move"
          ? { ...old!, status: op.change.status, revision: old!.revision + 1 }
          : {
              ...old!,
              title: op.change.title,
              description: op.change.description,
              priority: op.change.priority,
              dueDate: op.change.dueDate,
              assignee: op.change.assigneeAgentId
                ? {
                    agentId: op.change.assigneeAgentId,
                    actorId: op.change.assigneeActorId!,
                    name: "Taylor Example",
                    eligible: true,
                  }
                : null,
              revision: old!.revision + 1,
            };
    const all = rows().filter((r) => r.id !== next.id);
    all.push(next);
    extra = null;
    version++;
    data = {
      ...data,
      scopeVersion: version.toString(16).padStart(32, "0"),
      counts: { new: 0, in_progress: 0, done: 0, total: all.length },
      columns: {
        new: { requests: [], nextCursor: null },
        in_progress: { requests: [], nextCursor: null },
        done: { requests: [], nextCursor: null },
      },
    };
    for (const row of all) {
      data.columns[row.status].requests.push(row);
      data.counts[row.status]++;
    }
    const ack = {
      ...saved(op, next.status),
      actorId: data.actorId,
      role: data.role,
      requestId: next.id,
    };
    receipts.set(op.operationId, ack);
    return ack;
  }
  const harness = {
    get data() {
      return data;
    },
    set data(next: RequestsBoardData) {
      data = next;
    },
    posts,
    gets,
    commit,
    receipts,
  };
  await page.route("**/api/requests*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      if (body.mode === "reconcile") {
        const found = receipts.get(body.operationId);
        await json(route, {
          schemaVersion: 1,
          tenantId: tenant,
          actorId: actor,
          role: data.role,
          operationId: body.operationId,
          action: body.action,
          status: found ? "recorded" : "not_recorded",
          saved: found || null,
        });
        return;
      }
      posts.push(clone(body));
      await json(route, {
        saved: receipts.get(body.operationId) || commit(body),
      });
      return;
    }
    gets.push(url);
    const mode = url.searchParams.get("mode") || "board";
    if (mode === "detail") {
      const row = rows().find(
        (r) => r.id === url.searchParams.get("requestId"),
      );
      await json(
        route,
        row ? detail(row, data) : { error: "Not available" },
        row ? 200 : 404,
      );
      return;
    }
    if (mode === "assignees") {
      const search = url.searchParams.get("search") || "";
      await json(route, {
        schemaVersion: 1,
        mode,
        company: data.company,
        actorId: data.actorId,
        role: data.role,
        scopeVersion: data.scopeVersion,
        search,
        matchedCount: 1,
        users: [
          { agentId: agent, actorId: linkedActor, name: "Taylor Example" },
        ],
        nextCursor: null,
        serverTime: stamp,
      });
      return;
    }
    if (mode === "column") {
      const status = url.searchParams.get("status") as RequestStatus;
      await json(route, {
        schemaVersion: 1,
        mode,
        company: data.company,
        actorId: data.actorId,
        role: data.role,
        scopeVersion: data.scopeVersion,
        search: url.searchParams.get("search") || "",
        status,
        counts: data.counts,
        requests: extra ? [extra] : [],
        nextCursor: null,
        serverTime: stamp,
      });
      return;
    }
    const next = clone(data),
      search = url.searchParams.get("search") || "";
    next.search = search;
    if (search) {
      const all = rows().filter((r) =>
        (r.title + " " + r.description)
          .toLowerCase()
          .includes(search.toLowerCase()),
      );
      next.counts = { new: 0, in_progress: 0, done: 0, total: all.length };
      for (const status of statuses)
        next.columns[status] = {
          requests: all.filter((r) => r.status === status),
          nextCursor: null,
        };
      for (const row of all) next.counts[row.status]++;
    }
    await json(route, next);
  });
  return harness;
}
async function enter(page: Page, scenario = "owner") {
  await page.goto(`${fixture}?scenario=${scenario}`);
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeEnabled();
}
async function createForm(page: Page, title = "Order replacement keys") {
  await page
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill(title);
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("Private synthetic description");
}
async function forceClick(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).evaluate((node) => {
    const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
    const props = (node as unknown as Record<string, { onClick?: () => void }>)[
      key!
    ];
    props.onClick?.();
  });
}

test("desktop three columns, exact counts and original accessible controls", async ({
  page,
}) => {
  await install(page);
  await enter(page);
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  for (const name of ["New", "In progress", "Done"])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  expect(
    await page.locator(".requests-column-count").allTextContents(),
  ).toEqual(["2", "1", "1"]);
  const geometry = await page.locator(".requests-heading").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(geometry.height).toBe(78);
  expect(
    await page
      .getByRole("button", { name: "Refresh requests", exact: true })
      .evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe("14px");
  expect(geometry.overflow).toBe(false);
  await page.screenshot({
    path: "test-results/requests-desktop.png",
    fullPage: true,
  });
});
test("create saves full typed details and captured original assignee identity", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await createForm(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Priority", { exact: true }).selectOption("high");
  await dialog.getByLabel("Due date", { exact: true }).fill("2026-11-08");
  await dialog.getByRole("button", { name: "Find users", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Taylor Example", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save request", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(h.posts[0].change).toMatchObject({
    action: "create",
    title: "Order replacement keys",
    priority: "high",
    dueDate: "2026-11-08",
    assigneeAgentId: agent,
    assigneeActorId: linkedActor,
  });
  await expect(
    page.getByRole("button", { name: "Order replacement keys", exact: true }),
  ).toBeVisible();
});
test("edit current details preserves status and revision until durable ack plus fresh board", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await page
    .getByRole("button", { name: "Repair meeting room screen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Repair projector");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(h.posts[0].change).toMatchObject({
    action: "edit",
    requestId: ids[1],
    revision: 1,
    title: "Repair projector",
  });
  await expect(
    page.getByRole("button", { name: "Repair projector", exact: true }),
  ).toBeVisible();
});
test("keyboard status action persists and moves only after acknowledgement", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await page
    .getByLabel("Status for Replace entrance sign")
    .selectOption("in_progress");
  await expect(page.locator(".requests-column").nth(1)).toContainText(
    "Replace entrance sign",
  );
  expect(h.posts[0].change).toEqual({
    action: "move",
    requestId: ids[0],
    revision: 1,
    status: "in_progress",
  });
});
test("native pointer drag drop uses the same persistent guarded status mutation", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await page
    .locator(".requests-card")
    .filter({
      has: page.getByRole("button", {
        name: "Replace entrance sign",
        exact: true,
      }),
    })
    .dragTo(page.locator(".requests-column").nth(2));
  await expect(page.locator(".requests-column").nth(2)).toContainText(
    "Replace entrance sign",
  );
  expect(h.posts[0].change).toMatchObject({
    action: "move",
    status: "done",
    revision: 1,
  });
});
test("held status POST keeps old column and imperative refresh guard blocks precommit GET", async ({
  page,
}) => {
  const h = await install(page),
    hold = deferred();
  let arrived = false;
  await page.route("**/api/requests", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const op = route.request().postDataJSON() as RequestsMutation;
    arrived = true;
    await hold.promise;
    await json(route, { saved: h.commit(op) });
  });
  await enter(page);
  try {
    await page
      .getByLabel("Status for Replace entrance sign")
      .selectOption("done");
    await expect.poll(() => arrived).toBe(true);
    await expect(page.locator(".requests-column").nth(0)).toContainText(
      "Replace entrance sign",
    );
    await expect(
      page
        .locator(".requests-column")
        .nth(2)
        .getByRole("button", { name: "Replace entrance sign", exact: true }),
    ).toHaveCount(0);
    const before = h.gets.length;
    await forceClick(page, "Refresh requests");
    expect(h.gets.length).toBe(before);
    await expect(
      page.getByRole("button", { name: "Create request", exact: true }),
    ).toBeDisabled();
  } finally {
    hold.resolve();
  }
  await expect(page.locator(".requests-column").nth(2)).toContainText(
    "Replace entrance sign",
  );
});
test("literal title/description search resets counts and board pages", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await page.getByLabel("Search requests").fill("entrance");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".requests-card")).toHaveCount(1);
  expect(h.gets.at(-1)?.searchParams.get("search")).toBe("entrance");
  expect(
    await page.locator(".requests-column-count").allTextContents(),
  ).toEqual(["1", "0", "0"]);
});
test("bounded column paging uses opaque cursor and exact count without duplicates", async ({
  page,
}) => {
  const h = await install(page, "paged");
  await enter(page, "paged");
  await page.getByRole("button", { name: "Load more new requests" }).click();
  await expect(
    page.getByRole("button", { name: "Inspect reception desk", exact: true }),
  ).toBeVisible();
  expect(h.gets.at(-1)?.searchParams.get("cursor")).toBe("new-page-2");
  await expect(
    page.getByRole("button", { name: "Load more new requests" }),
  ).toHaveCount(0);
});
test("malformed duplicate column page fails closed instead of duplicating private cards", async ({
  page,
}) => {
  const h = await install(page, "paged");
  await page.route("**/api/requests*", async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("mode") !== "column") {
      await route.fallback();
      return;
    }
    await json(route, {
      schemaVersion: h.data.schemaVersion,
      company: h.data.company,
      actorId: h.data.actorId,
      role: h.data.role,
      scopeVersion: h.data.scopeVersion,
      serverTime: h.data.serverTime,
      mode: "column",
      status: "new",
      search: "",
      counts: h.data.counts,
      requests: [request(0)],
      nextCursor: null,
    });
  });
  await enter(page, "paged");
  await page.getByRole("button", { name: "Load more new requests" }).click();
  await expect(page.locator(".requests-card")).toHaveCount(0);
  await expect(page.locator(".requests-page").getByRole("alert")).toContainText(
    "could not be verified",
  );
});
test("employee controls permit own New unassigned edit and only own assigned movement", async ({
  page,
}) => {
  const h = await install(page, "employee");
  await enter(page, "employee");
  await expect(page.getByLabel("Status for Replace entrance sign")).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Status for Check stock room lighting"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check stock room lighting", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save request", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close request details" }).click();
  await createForm(page);
  await expect(
    page.getByRole("button", { name: "Find users", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(h.posts[0].change).toMatchObject({
    assigneeAgentId: null,
    assigneeActorId: null,
  });
});
test("current read revocation clears board and editor private fields", async ({
  page,
}) => {
  await install(page);
  await enter(page);
  await page.route("**/api/requests*", async (route) =>
    json(route, { error: "Your access has changed." }, 403),
  );
  await page
    .getByRole("button", { name: "Refresh requests", exact: true })
    .click();
  await expect(page.locator(".requests-card")).toHaveCount(0);
  await expect(page.locator(".requests-page").getByRole("alert")).toContainText(
    "access has changed",
  );
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeDisabled();
});
test("failed fresh board after acknowledged POST stays unknown and marker retained", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await page.route("**/api/requests*", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { error: "Fresh read failed" }, 503);
      return;
    }
    await json(route, { saved: h.commit(route.request().postDataJSON()) });
  });
  await createForm(page);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Review save outcome" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (k) => Object.keys(JSON.parse(sessionStorage.getItem(k)!)).sort(),
      key,
    ),
  ).toEqual(["action", "operationId", "schemaVersion"]);
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeDisabled();
});
test("lost acknowledgement exact retry keeps UUID and entire original payload", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  let first: RequestsMutation | null = null;
  await page.route("**/api/requests", async (route) => {
    if (
      route.request().method() !== "POST" ||
      route.request().postDataJSON().mode === "reconcile"
    ) {
      await route.fallback();
      return;
    }
    const op = route.request().postDataJSON() as RequestsMutation;
    h.posts.push(clone(op));
    if (!first) {
      first = clone(op);
      h.commit(op);
      await route.abort("failed");
    } else {
      expect(op).toEqual(first);
      await json(route, { saved: h.receipts.get(op.operationId) });
    }
  });
  await createForm(page);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retry exact save" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(h.posts).toHaveLength(2);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
});
test("recovery after reload uses field-free reconcile and fresh board, never byte retry", async ({
  page,
}) => {
  const h = await install(page);
  const op: RequestsMutation = {
    tenantId: tenant,
    operationId: "95000000-0000-4000-8000-000000000001",
    change: {
      action: "create",
      title: "Recovered request",
      description: "Private retained content",
      priority: "normal",
      dueDate: null,
      assigneeAgentId: null,
      assigneeActorId: null,
    },
  };
  h.commit(op);
  await page.addInitScript(
    ({ k, o }) =>
      sessionStorage.setItem(
        k,
        JSON.stringify({
          schemaVersion: 1,
          operationId: o.operationId,
          action: o.change.action,
        }),
      ),
    { k: key, o: op },
  );
  await page.goto(fixture);
  await page
    .getByRole("button", { name: "Review save outcome", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Recovered request", exact: true }),
  ).toBeVisible();
  expect(h.posts).toHaveLength(0);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
});
test("failed reconcile retains unknown marker and blocks new operations", async ({
  page,
}) => {
  await install(page);
  await page.addInitScript(
    (k) =>
      sessionStorage.setItem(
        k,
        JSON.stringify({
          schemaVersion: 1,
          operationId: "95000000-0000-4000-8000-000000000002",
          action: "create",
        }),
      ),
    key,
  );
  await page.route("**/api/requests", async (route) =>
    json(route, { error: "Recovery failed" }, 503),
  );
  await page.goto(fixture);
  await page
    .getByRole("button", { name: "Review save outcome", exact: true })
    .click();
  await expect(page.locator(".requests-page").getByRole("alert")).toContainText(
    "Recovery failed",
  );
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), key),
  ).not.toBeNull();
});
test("not-recorded recovery still requires successful fresh board before unlock", async ({
  page,
}) => {
  await install(page);
  await page.addInitScript(
    (k) =>
      sessionStorage.setItem(
        k,
        JSON.stringify({
          schemaVersion: 1,
          operationId: "95000000-0000-4000-8000-000000000002",
          action: "create",
        }),
      ),
    key,
  );
  let failed = true;
  await page.route("**/api/requests*", async (route) => {
    if (route.request().method() === "GET" && failed) {
      await json(route, { error: "Fresh read unavailable" }, 503);
      return;
    }
    await route.fallback();
  });
  await page.goto(fixture);
  await page
    .getByRole("button", { name: "Review save outcome", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), key),
  ).not.toBeNull();
  failed = false;
  await page
    .getByRole("button", { name: "Review save outcome", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeEnabled();
});
for (const corruption of [
  "uuid",
  "target",
  "revision",
  "status",
  "role",
] as const)
  test(`malformed ${corruption} acknowledgement cannot clear unknown lock`, async ({
    page,
  }) => {
    await install(page);
    await enter(page);
    await page.route("**/api/requests", async (route) => {
      const op = route.request().postDataJSON() as RequestsMutation;
      const ack = saved(op);
      if (corruption === "uuid")
        ack.operationId = "95000000-0000-4000-8000-000000000099";
      if (corruption === "target") ack.requestId = ids[3];
      if (corruption === "revision") ack.revision = 9;
      if (corruption === "status") ack.status = "done";
      if (corruption === "role") ack.role = "employee";
      await json(route, { saved: ack });
    });
    await page
      .getByLabel("Status for Replace entrance sign")
      .selectOption("in_progress");
    await expect(
      page.getByRole("button", { name: "Review save outcome" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create request", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), key),
    ).not.toBeNull();
  });
test("conflict reload retains typed text and requires reviewed current revision for a new UUID", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await page
    .getByRole("button", { name: "Repair meeting room screen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("My retained edit");
  let first = true;
  await page.route("**/api/requests", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    if (first) {
      first = false;
      h.data.columns.new.requests[1] = {
        ...h.data.columns.new.requests[1],
        title: "Other editor change",
        revision: 2,
      };
      await json(route, { error: "The request changed. Reload." }, 409);
    } else await route.fallback();
  });
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reload current request" })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toHaveValue("My retained edit");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(h.posts.at(-1)?.change).toMatchObject({
    revision: 2,
    title: "My retained edit",
  });
});
test("held read cannot restore old company cards after a scope switch", async ({
  page,
}) => {
  const h = await install(page),
    hold = deferred();
  await enter(page);
  await page.route("**/api/requests*", async (route) => {
    await hold.promise;
    await json(route, h.data).catch(() => {});
  });
  await page
    .getByRole("button", { name: "Refresh requests", exact: true })
    .click();
  await page.getByRole("button", { name: "Switch synthetic company" }).click();
  hold.resolve();
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".requests-card")).toHaveCount(0);
});
test("held POST acknowledgement after departure keeps field-free marker and never unlocks another actor", async ({
  page,
}) => {
  const h = await install(page),
    hold = deferred();
  let arrived = false;
  await page.route("**/api/requests", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    arrived = true;
    const ack = h.commit(route.request().postDataJSON());
    await hold.promise;
    await json(route, { saved: ack });
  });
  await enter(page);
  await createForm(page);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect.poll(() => arrived).toBe(true);
  await forceClick(page, "Switch synthetic actor");
  hold.resolve();
  await expect(page.locator(".requests-card")).toHaveCount(0);
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), key),
  ).not.toBeNull();
});
test("decoded acknowledgement held past departure cannot remove original marker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]) === "/api/requests" && args[1]?.method === "POST") {
        const originalJSON = response.json.bind(response);
        response.json = async () => {
          const value = await originalJSON();
          await new Promise<void>(
            (resolve) =>
              ((
                window as unknown as { releaseRequestsBody: () => void }
              ).releaseRequestsBody = resolve),
          );
          return value;
        };
      }
      return response;
    };
  });
  await install(page);
  await enter(page);
  await createForm(page);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { releaseRequestsBody?: () => void })
            .releaseRequestsBody,
      ),
    )
    .toBe("function");
  await forceClick(page, "Leave synthetic Requests");
  await page.evaluate(() =>
    (
      window as unknown as { releaseRequestsBody: () => void }
    ).releaseRequestsBody(),
  );
  await expect(page.getByText("Left Requests", { exact: true })).toBeVisible();
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), key),
  ).not.toBeNull();
});
test("assignee selection survives a new searched page and preserves captured actor identity", async ({
  page,
}) => {
  const h = await install(page);
  await enter(page);
  await createForm(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Find users", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Taylor Example", exact: true })
    .click();
  await dialog.getByLabel("Search assignees").fill("No match");
  await page.route("**/api/requests*", async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("mode") !== "assignees") {
      await route.fallback();
      return;
    }
    await json(route, {
      schemaVersion: 1,
      mode: "assignees",
      company: h.data.company,
      actorId: actor,
      role: "owner",
      scopeVersion: h.data.scopeVersion,
      search: "No match",
      matchedCount: 0,
      users: [],
      nextCursor: null,
      serverTime: stamp,
    });
  });
  await dialog.getByRole("button", { name: "Find users", exact: true }).click();
  await expect(dialog.locator(".requests-assignee-name")).toHaveText(
    "Taylor Example",
  );
  await dialog
    .getByRole("button", { name: "Save request", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(h.posts[0].change).toMatchObject({
    assigneeAgentId: agent,
    assigneeActorId: linkedActor,
  });
});
test("incoherent initial counts and malformed recovery markers never enable mutations", async ({
  page,
}) => {
  await install(page);
  await page.goto(`${fixture}?scenario=invalidCounts`);
  await expect(
    page.getByRole("button", { name: "Create request", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".requests-card")).toHaveCount(0);
  await page.evaluate(
    (k) =>
      sessionStorage.setItem(
        k,
        JSON.stringify({ privateTitle: "Should never be accepted" }),
      ),
    key,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Refresh requests", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".requests-page").getByRole("alert")).toContainText(
    "marker could not be verified",
  );
});

test("delayed detail immediately enters dialog then focuses current editable title", async ({
  page,
}) => {
  await install(page);
  const hold = deferred();
  let waiting = false;
  await page.route("**/api/requests*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("mode") !== "detail") {
      await route.fallback();
      return;
    }
    waiting = true;
    await hold.promise;
    await route.fallback();
  });
  await enter(page);
  await page
    .getByRole("button", { name: "Replace entrance sign", exact: true })
    .click();
  await expect.poll(() => waiting).toBe(true);
  await expect(page.locator(".requests-heading")).toHaveAttribute("inert", "");
  await expect(page.locator(".requests-page > div[inert]")).toHaveCount(1);
  const close = page.getByRole("button", { name: "Close request details" });
  await expect(close).toBeFocused();
  const cancel = page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true });
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  hold.resolve();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toBeFocused();
});
test("readonly detail keyboard focus remains within enabled dialog controls", async ({
  page,
}) => {
  await install(page, "employee");
  await enter(page, "employee");
  await page
    .getByRole("button", { name: "Check stock room lighting", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toBeDisabled();
  const close = page.getByRole("button", { name: "Close request details" });
  await expect(close).toBeFocused();
  const cancel = page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true });
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Check stock room lighting",
      exact: true,
    }),
  ).toBeFocused();
});

test("picker loading and held POST disabled controls retain keyboard focus inside dialog", async ({
  page,
}) => {
  const h = await install(page),
    picker = deferred(),
    post = deferred();
  let pickerWaiting = false,
    postWaiting = false;
  await page.route("**/api/requests*", async (route) => {
    if (route.request().method() === "POST") {
      postWaiting = true;
      const ack = h.commit(route.request().postDataJSON());
      await post.promise;
      await json(route, { saved: ack });
      return;
    }
    if (
      new URL(route.request().url()).searchParams.get("mode") === "assignees"
    ) {
      pickerWaiting = true;
      await picker.promise;
    }
    await route.fallback();
  });
  await enter(page);
  await createForm(page);
  const dialog = page.getByRole("dialog"),
    title = dialog.getByLabel("Title", { exact: true }),
    close = dialog.getByRole("button", { name: "Close request details" });
  await title.focus();
  await title.fill("Keyboard retained draft");
  await expect(title).toBeFocused();
  await dialog.getByRole("button", { name: "Find users", exact: true }).click();
  await expect.poll(() => pickerWaiting).toBe(true);
  await expect(close).toBeFocused();
  await expect(title).toBeDisabled();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  picker.resolve();
  await expect(title).toBeEnabled();
  await title.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => postWaiting).toBe(true);
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toBeFocused();
  post.resolve();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Keyboard retained draft", exact: true }),
  ).toBeVisible();
});
