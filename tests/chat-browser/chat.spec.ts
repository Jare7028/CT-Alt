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
async function harness(page: Page, initial = [message(1)]) {
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
              kind: "direct",
              description: "Synthetic context",
              management_only: false,
              unread: 1,
              updated_at: "2026-10-03T00:00:00Z",
            },
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
