import { test, expect, type Page } from "@playwright/test";
const actor = "00000000-0000-4000-8000-000000000001";
const employee = "00000000-0000-4000-8000-000000000002";
const manager = "00000000-0000-4000-8000-000000000003";
const conversationId = "40000000-0000-4000-8000-000000000002";
const message = (sequence: number) => ({
  conversation_id: conversationId,
  sender_id: employee,
  sender_name: "Synthetic Employee",
  sequence,
  body: `Synthetic message ${sequence}`,
  client_id: `40000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  created_at: "2026-10-03T00:00:00Z",
});
async function harness(
  page: Page,
  initial = [message(1)],
  second = false,
  group = false,
) {
  const messages = [...initial];
  const sends: Record<string, unknown>[] = [];
  const reads: number[] = [];
  const creates: Record<string, unknown>[] = [];
  let denied = false;
  let loseResponse = false;
  let available = true;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/chat", async (route) => {
    expect(new URL(route.request().url()).origin).toBe("http://127.0.0.1:5193");
    const { payload } = route.request().postDataJSON();
    if (denied)
      return route.fulfill({
        status: 403,
        json: { error: "Conversation access is unavailable." },
      });
    let data: unknown;
    if (payload.action === "directory")
      data = [
        { user_id: actor, display_name: "Synthetic Owner", role: "owner" },
        {
          user_id: employee,
          display_name: "Synthetic Employee",
          role: "employee",
        },
        {
          user_id: manager,
          display_name: "Synthetic Manager",
          role: "manager",
        },
      ];
    else if (payload.action === "list")
      data = available
        ? [
            {
              id: conversationId,
              name: "Synthetic Employee",
              kind: group ? "group" : "direct",
              can_manage: group,
              can_post: true,
              member_count: 2,
              description: "Synthetic context",
              management_only: false,
              unread: 1,
              updated_at: "2026-10-03T00:00:00Z",
            },
            ...(second
              ? [
                  {
                    id: "40000000-0000-4000-8000-000000000003",
                    name: "Second synthetic chat",
                    kind: "direct",
                    description: "Second context",
                    management_only: false,
                    unread: 0,
                    updated_at: "2026-10-03T00:00:00Z",
                  },
                ]
              : []),
          ]
        : [];
    else if (payload.action === "create") {
      creates.push(payload);
      available = true;
      data = { id: conversationId };
    } else if (payload.action === "history")
      data =
        payload.after !== undefined
          ? messages
              .filter((item) => item.sequence > payload.after)
              .slice(0, 100)
          : messages
              .filter(
                (item) =>
                  payload.before === undefined ||
                  item.sequence < payload.before,
              )
              .slice(-100);
    else if (payload.action === "read") {
      reads.push(payload.sequence);
      data = {};
    } else if (payload.action === "send") {
      sends.push(payload);
      let saved = messages.find((item) => item.client_id === payload.clientId);
      if (!saved) {
        saved = {
          ...message((messages.at(-1)?.sequence || 0) + 1),
          sender_id: actor,
          sender_name: "Synthetic Owner",
          client_id: payload.clientId,
          body: payload.body,
        };
        messages.push(saved);
      }
      if (loseResponse) {
        loseResponse = false;
        return route.abort("failed");
      }
      data = saved;
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/chat-test-fixture");
  await expect(
    page.getByRole("heading", { name: "Chat", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  return {
    messages,
    sends,
    reads,
    creates,
    errors,
    deny: () => {
      denied = true;
    },
    lose: () => {
      loseResponse = true;
    },
    empty: () => {
      available = false;
    },
  };
}
test("text persists through lost-response retry with identical ID and body", async ({
  page,
}) => {
  const state = await harness(page);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await page.getByLabel("Message", { exact: true }).fill("Synthetic send");
  state.lose();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry send" })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await page.getByRole("button", { name: "Retry send" }).click();
  await expect(
    page.getByRole("log").getByText("Synthetic send", { exact: true }),
  ).toHaveCount(1);
  expect(state.sends).toHaveLength(2);
  expect(state.sends[0]).toEqual(state.sends[1]);
  expect(
    state.messages.filter((item) => item.body === "Synthetic send"),
  ).toHaveLength(1);
  expect(state.errors).toEqual([]);
  await page.screenshot({
    path: "test-results/chat-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/chat-mobile.png",
    fullPage: true,
  });
});
test("reconnect drains over 100 messages in order before marking read", async ({
  page,
}) => {
  const state = await harness(page);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  state.messages.push(
    ...Array.from({ length: 205 }, (_, index) => message(index + 2)),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(206);
  const texts = await page
    .getByRole("log")
    .getByRole("article")
    .locator("p")
    .allTextContents();
  expect(texts).toEqual(
    Array.from({ length: 206 }, (_, index) => `Synthetic message ${index + 1}`),
  );
  await expect.poll(() => state.reads.at(-1)).toBe(206);
  expect(state.errors).toEqual([]);
});
test("revoked access clears message history, list and composer", async ({
  page,
}) => {
  const state = await harness(page);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await page.getByLabel("Message", { exact: true }).fill("Unsent text");
  state.deny();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("p[role=alert]")).toContainText(
    "Conversation access is unavailable",
  );
  await expect(page.getByRole("log")).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Synthetic Employee" }),
  ).toHaveCount(0);
});
test("Add New exposes selected users and filters restricted management groups", async ({
  page,
}) => {
  const state = await harness(page);
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  const form = page.getByRole("form", { name: "New Group" });
  await form.getByLabel("Group name").fill("Synthetic management");
  await form.getByLabel("Description").fill("Synthetic description");
  await form.getByLabel("Management members only").check();
  await expect(form.getByLabel("Synthetic Employee")).toHaveCount(0);
  await form.getByLabel("Synthetic Manager").check();
  await form.getByRole("button", { name: "Create", exact: true }).click();
  expect(state.creates[0]).toMatchObject({
    kind: "group",
    management_only: true,
    members: [manager],
    name: "Synthetic management",
    description: "Synthetic description",
  });
  await expect(form).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("reselecting the open conversation preserves history and unsent text", async ({
  page,
}) => {
  await harness(page);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Unsent synthetic draft");
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Unsent synthetic draft",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
});
test("directory response arriving after revocation cannot restore names or picker", async ({
  page,
}) => {
  const state = await harness(page);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (started = resolve));
  await page.route("**/api/chat", async (route) => {
    if (route.request().postDataJSON().payload.action !== "directory")
      return route.fallback();
    started();
    await waiting;
    await route.fulfill({
      json: {
        data: [
          {
            user_id: employee,
            display_name: "Stale private name",
            role: "employee",
          },
        ],
      },
    });
  });
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Chat", exact: true }).click();
  await requested;
  state.deny();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("p[role=alert]")).toContainText(
    "Conversation access is unavailable",
  );
  const delayed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().postDataJSON().payload.action === "directory",
  );
  release();
  await delayed;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.getByRole("form", { name: "New Chat" })).toHaveCount(0);
  await expect(page.getByText("Stale private name")).toHaveCount(0);
});
for (const failure of [false, true])
  test(`cancelled creation ignores delayed ${failure ? "failure" : "success"}`, async ({
    page,
  }) => {
    await harness(page);
    await page.getByRole("button", { name: "Synthetic Employee" }).click();
    await expect(page.getByRole("log")).toContainText("Synthetic message 1");
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const requested = new Promise<void>((resolve) => (started = resolve));
    await page.route("**/api/chat", async (route) => {
      if (route.request().postDataJSON().payload.action !== "create")
        return route.fallback();
      started();
      await waiting;
      await route.fulfill({
        status: failure ? 503 : 200,
        json: failure
          ? { error: "Stale create failure" }
          : { data: { id: "40000000-0000-4000-8000-000000000099" } },
      });
    });
    await page.getByText("Add New", { exact: true }).click();
    await page.getByRole("button", { name: "New Group", exact: true }).click();
    const form = page.getByRole("form", { name: "New Group" });
    await form.getByLabel("Group name").fill("Cancelled synthetic");
    await form.getByLabel("Synthetic Manager").check();
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await requested;
    await form.getByRole("button", { name: "Cancel" }).click();
    const delayed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postDataJSON().payload.action === "create",
    );
    release();
    await delayed;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(page.getByRole("log")).toContainText("Synthetic message 1");
    await expect(page.getByRole("form", { name: "New Group" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Stale create failure")).toHaveCount(0);
  });

test("conversation switch ignores a delayed create completion", async ({
  page,
}) => {
  await harness(page, [message(1)], true);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (started = resolve));
  await page.route("**/api/chat", async (route) => {
    if (route.request().postDataJSON().payload.action !== "create")
      return route.fallback();
    started();
    await waiting;
    await route.fulfill({
      json: { data: { id: "40000000-0000-4000-8000-000000000099" } },
    });
  });
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  const form = page.getByRole("form", { name: "New Group" });
  await form.getByLabel("Group name").fill("Interrupted group");
  await form.getByLabel("Synthetic Manager").check();
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await requested;
  await page.getByRole("button", { name: "Second synthetic chat" }).click();
  await expect(
    page.getByRole("heading", { name: "Second synthetic chat" }),
  ).toBeVisible();
  const delayed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().postDataJSON().payload.action === "create",
  );
  release();
  await delayed;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(
    page.getByRole("heading", { name: "Second synthetic chat" }),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
});
test("repeated Add New actions retain only the latest directory result", async ({
  page,
}) => {
  await harness(page);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (started = resolve));
  let held = false;
  await page.route("**/api/chat", async (route) => {
    if (route.request().postDataJSON().payload.action !== "directory" || held)
      return route.fallback();
    held = true;
    started();
    await waiting;
    await route.fulfill({
      json: {
        data: [
          {
            user_id: employee,
            display_name: "Stale directory person",
            role: "employee",
          },
        ],
      },
    });
  });
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Chat", exact: true }).click();
  await requested;
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  await expect(page.getByRole("form", { name: "New Group" })).toBeVisible();
  const delayed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().postDataJSON().payload.action === "directory",
  );
  release();
  await delayed;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.getByRole("form", { name: "New Group" })).toBeVisible();
  await expect(page.getByRole("form", { name: "New Chat" })).toHaveCount(0);
  await expect(page.getByText("Stale directory person")).toHaveCount(0);
});

test("new posting restriction preserves readable history and hides composer", async ({
  page,
}) => {
  await harness(page, [message(1)], false, true);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await page.route("**/api/chat", async (route) => {
    if (route.request().postDataJSON().payload.action !== "send")
      return route.fallback();
    await route.fulfill({
      status: 403,
      json: {
        error: "Only group admins can send messages in this group.",
        kind: "posting_restricted",
      },
    });
  });
  await page.getByLabel("Message", { exact: true }).fill("Denied draft");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await expect(
    page.getByRole("button", { name: "Synthetic Employee" }),
  ).toBeVisible();
});
test("delayed Chat Info cannot restore member names after access revocation", async ({
  page,
}) => {
  const state = await harness(page, [message(1)], false, true);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (started = resolve));
  await page.route("**/api/chat", async (route) => {
    if (route.request().postDataJSON().payload.action !== "group_info")
      return route.fallback();
    started();
    await waiting;
    await route.fulfill({
      json: {
        data: {
          id: conversationId,
          name: "Stale group",
          description: "",
          management_only: false,
          allow_member_messages: true,
          settings_revision: 1,
          can_manage: false,
          members: [
            {
              user_id: employee,
              display_name: "Stale group member",
              role: "employee",
              status: "active",
              group_admin: false,
            },
          ],
        },
      },
    });
  });
  await page.getByRole("button", { name: "Chat Info", exact: true }).click();
  await requested;
  state.deny();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("p[role=alert]")).toContainText(
    "Conversation access is unavailable",
  );
  const delayed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().postDataJSON().payload.action === "group_info",
  );
  release();
  await delayed;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.getByRole("form", { name: "Chat Info" })).toHaveCount(0);
  await expect(page.getByText("Stale group member")).toHaveCount(0);
});

test("posting denial fences a delayed list that still allows posting", async ({ page }) => {
  await harness(page, [message(1)], false, true);
  await page.getByRole("button", { name: "Synthetic Employee" }).click();
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (started = resolve));
  await page.route("**/api/chat", async (route) => {
    const { payload } = route.request().postDataJSON();
    if (payload.action === "send")
      return route.fulfill({ status: 403, json: {
        error: "Only group admins can send messages in this group.",
        kind: "posting_restricted",
      }});
    if (payload.action !== "list") return route.fallback();
    started();
    await waiting;
    await route.fulfill({ json: { data: [{
      id: conversationId, name: "Synthetic Employee", kind: "group",
      can_manage: false, can_post: true, member_count: 2,
      description: "Synthetic context", management_only: false, unread: 0,
      updated_at: "2026-10-03T00:00:00Z",
    }] }});
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await requested;
  await page.getByLabel("Message", { exact: true }).fill("Denied draft");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  const delayed = page.waitForResponse((response) =>
    response.url().endsWith("/api/chat") &&
    response.request().postDataJSON().payload.action === "list");
  release();
  await delayed;
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("Synthetic message 1");
  await expect(page.locator(".chat-posting-notice")).toContainText("Only group admins can send messages in this group.");
});
