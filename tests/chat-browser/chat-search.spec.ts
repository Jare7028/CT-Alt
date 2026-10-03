import { test, expect, type Page } from "@playwright/test";
import type { ChatSearchData } from "../../lib/chat-search-types";
const tenant = "40000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000001";
const conversation = "40000000-0000-4000-8000-000000000002";
const second = "40000000-0000-4000-8000-000000000003";
const row = (
  sequence = "9007199254740993",
  body = "Literal %_ [north] dispatch",
  id = conversation,
) => ({
  conversation_id: id,
  sequence,
  body,
  sender_id: actor,
  sender_name: "Synthetic Dispatcher",
  created_at: "2026-10-03T12:30:00Z",
});
function searchResponse(
  url: URL,
  messages = [row()],
  nextCursor: string | null = null,
  total = messages.length,
) {
  return {
    tenantId: url.searchParams.get("tenantId") || "",
    conversationId: url.searchParams.get("conversationId") || "",
    actorId: actor,
    query: url.searchParams.get("query") || "",
    total,
    messages,
    nextCursor,
  } satisfies ChatSearchData;
}
async function harness(page: Page) {
  const state = {
    denied: false,
    postingDenied: false,
    reads: 0,
    searches: [] as URL[],
    errors: [] as string[],
  };
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.route("**/api/chat", async (route) => {
    const { payload } = route.request().postDataJSON();
    if (state.denied)
      return route.fulfill({
        status: 403,
        json: { error: "Conversation access is unavailable." },
      });
    let data: unknown = {};
    if (payload.action === "list")
      data = [conversation, second].map((id, index) => ({
        id,
        kind: "group",
        name: index ? "Second synthetic chat" : "Synthetic Dispatch",
        member_count: 2,
        can_post: !state.postingDenied,
        can_manage: false,
        unread: 0,
        description: "Synthetic team conversation",
        updated_at: "2026-10-03T00:00:00Z",
      }));
    if (payload.action === "history")
      data = payload.after
        ? []
        : [
            {
              ...row("1", "Ordinary chat history", payload.conversationId),
              sequence: 1,
              client_id: "40000000-0000-4000-8000-000000000004",
            },
          ];
    if (payload.action === "read") state.reads++;
    if (payload.action === "send") {
      if (state.postingDenied)
        return route.fulfill({
          status: 403,
          json: {
            kind: "posting_restricted",
            error: "Only group admins can send messages.",
          },
        });
      data = {
        ...row("2", payload.body, payload.conversationId),
        sequence: 2,
        client_id: payload.clientId,
      };
    }
    return route.fulfill({ json: { data } });
  });
  await page.route("**/api/chat/search?**", async (route) => {
    const url = new URL(route.request().url());
    state.searches.push(url);
    await route.fulfill({ json: searchResponse(url) });
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/chat-test-fixture");
  await page
    .getByRole("button", { name: "Synthetic Dispatch", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("Ordinary chat history");
  await expect.poll(() => state.reads).toBe(1);
  return state;
}
async function search(page: Page, query = "%_ [north]") {
  await page.getByLabel("Search this conversation").fill(query);
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
}
async function heldSearch(page: Page) {
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      new URL(request.url()).pathname === "/api/chat/search",
  });
  let finished!: () => void;
  const settled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/chat/search?**", async (route) => {
    const url = new URL(route.request().url());
    entered();
    await gate;
    await route
      .fulfill({
        json: searchResponse(url, [
          row("9007199254740993", "Delayed private search result"),
        ]),
      })
      .catch(() => {});
    finished();
  });
  return {
    ready,
    release: async () => {
      release();
      const request = await aborted;
      expect(request.failure()?.errorText).toContain("ERR_ABORTED");
      await settled;
    },
  };
}
const results = (page: Page) =>
  page.getByRole("region", { name: "Message search results" });

test("literal search keeps bigint sequences distinct, sends exact cursor and clear restores draft/history", async ({
  page,
}) => {
  const state = await harness(page);
  const calls: URL[] = [];
  const cursor = "opaque-bound-cursor-9007199254740992";
  await page.route("**/api/chat/search?**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    const older = url.searchParams.has("cursor");
    await route.fulfill({
      json: searchResponse(
        url,
        older
          ? [row("9007199254740991", "Older literal %_ [north] message")]
          : [row(), row("9007199254740992")],
        older ? null : cursor,
        3,
      ),
    });
  });
  await page
    .getByLabel("Message", { exact: true })
    .fill("Retained unsent draft");
  await search(page, "  %_ [north]  ");
  await expect(results(page)).toContainText("3 matching messages");
  await expect(results(page).locator("article")).toHaveCount(2);
  expect(
    await results(page)
      .locator("article")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-sequence")),
      ),
  ).toEqual(["9007199254740993", "9007199254740992"]);
  await expect(page.getByRole("log")).toHaveCount(0);
  await page.getByRole("button", { name: "Load older results" }).click();
  await expect(results(page).locator("article")).toHaveCount(3);
  expect(calls.map((url) => url.searchParams.get("query"))).toEqual([
    "%_ [north]",
    "%_ [north]",
  ]);
  expect(calls[1].searchParams.get("cursor")).toBe(cursor);
  expect(calls[0].searchParams.get("conversationId")).toBe(conversation);
  expect(calls[0].searchParams.get("tenantId")).toBe(tenant);
  await expect(
    page.getByRole("button", { name: "Load older results" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/chat-search-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("log")).toContainText("Ordinary chat history");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Retained unsent draft",
  );
  expect(state.errors).toEqual([]);
});

test("search failure stays explicit through successful polling and never claims an empty result", async ({
  page,
}) => {
  await harness(page);
  await page.route("**/api/chat/search?**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Message search is unavailable. Try again." },
    }),
  );
  await search(page);
  await expect(results(page).getByRole("alert")).toContainText("unavailable");
  const poll = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().postDataJSON().payload.action === "list",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await poll;
  await expect(results(page).getByRole("alert")).toContainText("unavailable");
  await expect(results(page)).not.toContainText("No matching messages");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("log")).toContainText("Ordinary chat history");
});

test("older-page failure retains results and retries the same opaque cursor", async ({
  page,
}) => {
  await harness(page);
  let attempts = 0;
  const cursor = "exact-retry-cursor";
  await page.route("**/api/chat/search?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      expect(url.searchParams.get("cursor")).toBe(cursor);
      if (++attempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Older search results are unavailable." },
        });
      return route.fulfill({
        json: searchResponse(
          url,
          [row("9007199254740992", "Recovered older result")],
          null,
          2,
        ),
      });
    }
    return route.fulfill({ json: searchResponse(url, [row()], cursor, 2) });
  });
  await search(page);
  await expect(results(page).locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Load older results" }).click();
  await expect(results(page).getByRole("alert")).toContainText("unavailable");
  await expect(results(page).locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Load older results" }).click();
  await expect(results(page).locator("article")).toHaveCount(2);
  expect(attempts).toBe(2);
});

test("query replacement aborts delayed results; clearing returns ordinary chat", async ({
  page,
}) => {
  await harness(page);
  const held = await heldSearch(page);
  await search(page);
  await held.ready;
  await page
    .getByLabel("Search this conversation")
    .fill("different literal query");
  await held.release();
  await expect(results(page)).toContainText("Search to view matching messages");
  await expect(results(page)).not.toContainText(
    "Delayed private search result",
  );
  await page.getByLabel("Search this conversation").fill("");
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("Ordinary chat history");
});

test("conversation replacement aborts delayed search and clears the old search scope", async ({
  page,
}) => {
  await harness(page);
  const held = await heldSearch(page);
  await search(page);
  await held.ready;
  await page
    .getByRole("button", { name: "Second synthetic chat", exact: true })
    .click();
  await held.release();
  await expect(
    page.getByRole("heading", { name: "Second synthetic chat" }),
  ).toBeVisible();
  await expect(page.getByLabel("Search this conversation")).toHaveValue("");
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByRole("log")).not.toContainText(
    "Delayed private search result",
  );
});

test("search denial clears conversation, composer, cached results and normal history", async ({
  page,
}) => {
  const state = await harness(page);
  await page
    .getByLabel("Message", { exact: true })
    .fill("Private unsent draft");
  await page.route("**/api/chat/search?**", (route) => {
    state.denied = true;
    return route.fulfill({
      status: 403,
      json: { error: "Conversation access is unavailable." },
    });
  });
  await search(page);
  await expect(page.locator(".chat-app").getByRole("alert")).toContainText(
    "access is unavailable",
  );
  await expect(page.getByRole("log")).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(results(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Synthetic Dispatch", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Private unsent draft");
});

test("list polling revocation aborts delayed search and cannot restore private content", async ({
  page,
}) => {
  const state = await harness(page);
  const held = await heldSearch(page);
  await search(page);
  await held.ready;
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".chat-app").getByRole("alert")).toContainText(
    "access is unavailable",
  );
  await held.release();
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Delayed private search result",
  );
});

test("posting denial aborts delayed search while retaining readable history", async ({
  page,
}) => {
  const state = await harness(page);
  const held = await heldSearch(page);
  await search(page);
  await held.ready;
  state.postingDenied = true;
  await page
    .getByLabel("Message", { exact: true })
    .fill("Denied synthetic message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Only group admins can send messages in this group."),
  ).toBeVisible();
  await held.release();
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("Ordinary chat history");
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Delayed private search result",
  );
});

test("search results and repeated list polling never mark the search view read", async ({
  page,
}) => {
  const state = await harness(page);
  await search(page);
  await expect(results(page).locator("article")).toHaveCount(1);
  const before = state.reads;
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/chat"))
      actions.push(request.postDataJSON().payload.action);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const poll = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postDataJSON().payload.action === "list",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await poll;
  }
  expect(state.reads).toBe(before);
  expect(actions).not.toContain("read");
  expect(actions).not.toContain("history");
});

test("wrong scope or numeric sequence is an error rather than rendered content or false empty", async ({
  page,
}) => {
  await harness(page);
  await page.route("**/api/chat/search?**", (route) =>
    route.fulfill({
      json: {
        ...searchResponse(new URL(route.request().url())),
        actorId: "foreign-actor",
      },
    }),
  );
  await search(page);
  await expect(results(page).getByRole("alert")).toContainText(
    "invalid response",
  );
  await expect(results(page).locator("article")).toHaveCount(0);
  await page.unroute("**/api/chat/search?**");
  await page.route("**/api/chat/search?**", (route) =>
    route.fulfill({
      json: searchResponse(new URL(route.request().url()), [
        { ...row(), sequence: 9007199254740992 } as unknown as ReturnType<
          typeof row
        >,
      ]),
    }),
  );
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  await expect(results(page).getByRole("alert")).toContainText(
    "invalid response",
  );
  await expect(results(page)).not.toContainText("No matching messages");
});

for (const scope of ["actor", "company"]) {
  test(`${scope} prop replacement aborts delayed search and clears drafts without remounting the fixture`, async ({
    page,
  }) => {
    await harness(page);
    const held = await heldSearch(page);
    await page
      .getByLabel("Message", { exact: true })
      .fill("Previous scope private draft");
    await search(page);
    await held.ready;
    await page
      .getByRole("button", { name: `Switch synthetic ${scope}`, exact: true })
      .click();
    await held.release();
    await expect(results(page)).toHaveCount(0);
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "Delayed private search result",
    );
    await page
      .getByRole("button", { name: "Synthetic Dispatch", exact: true })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Search this conversation")).toHaveValue("");
  });
}

for (const denialBody of ["", "null"]) {
  test(`empty success is explicit, while ${denialBody === "" ? "missing" : "null"} auth denial clears private state`, async ({
    page,
  }) => {
    const state = await harness(page);
    await page.route("**/api/chat/search?**", (route) =>
      route.fulfill({
        json: searchResponse(new URL(route.request().url()), [], null, 0),
      }),
    );
    await search(page);
    await expect(results(page)).toContainText(
      "No matching messages in this conversation.",
    );
    await page.route("**/api/chat/search?**", (route) => {
      state.denied = true;
      return route.fulfill({
        status: 401,
        contentType: "text/plain",
        body: denialBody,
      });
    });
    await page
      .getByRole("button", { name: "Search messages", exact: true })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
    await expect(results(page)).toHaveCount(0);
    await expect(page.locator(".chat-app").getByRole("alert")).toContainText(
      "access is unavailable",
    );
  });
}

test("history already in flight when search starts cannot mark search results read", async ({
  page,
}) => {
  const state = await harness(page);
  let release!: () => void;
  let enter!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    enter = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    const { payload } = route.request().postDataJSON();
    if (payload.action !== "history") return route.fallback();
    enter();
    await gate;
    return route.fulfill({
      json: { data: [{ ...row("2", "Delayed normal history"), sequence: 2 }] },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await ready;
  await search(page);
  await expect(results(page).locator("article")).toHaveCount(1);
  const before = state.reads;
  const done = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().postDataJSON().payload.action === "history",
  );
  release();
  await done;
  await expect(results(page)).not.toContainText("Delayed normal history");
  expect(state.reads).toBe(before);
});

test("history denial already in flight when search starts clears delayed search results", async ({
  page,
}) => {
  const state = await harness(page);
  let release!: () => void;
  let enter!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    enter = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    const { payload } = route.request().postDataJSON();
    if (payload.action !== "history") return route.fallback();
    enter();
    await gate;
    state.denied = true;
    return route.fulfill({
      status: 403,
      json: { error: "Conversation access is unavailable." },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await ready;
  const held = await heldSearch(page);
  await search(page);
  await held.ready;
  release();
  await expect(page.locator(".chat-app").getByRole("alert")).toContainText(
    "access is unavailable",
  );
  await held.release();
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Delayed private search result",
  );
});
