import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const f = JSON.parse(
  readFileSync("/tmp/ct-alt-chat-acceptance-fixtures.json", "utf8"),
);
const settings = JSON.parse(
  readFileSync("/tmp/ct-alt-chat-status.json", "utf8"),
);
if (
  f.url !== "http://127.0.0.1:54821" ||
  settings.API_URL !== f.url ||
  !readFileSync("/tmp/ct-alt-chat-stack/supabase/config.toml", "utf8").includes(
    'project_id = "ct-alt-chat-acceptance"',
  )
)
  throw Error("Wrong isolated project");
const admin = createClient(f.url, settings.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function login(page: Page, account: string) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(f.accounts[account].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(f.accounts[account].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/agents/);
  await page.goto(`/chat?company=${f.tenant}`);
  await expect(
    page.getByRole("heading", { name: "Chat", exact: true }),
  ).toBeVisible();
}
async function api(
  context: BrowserContext,
  payload: object,
  tenantId = f.tenant,
) {
  return context.request.post("/api/chat", {
    headers: { Origin: "http://127.0.0.1:5194" },
    data: { tenantId, payload },
  });
}
test("real signed Auth group edits, admin-only posting, history, private boundaries and immediate revocation", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90000);
  await login(page, "employee");
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  const create = page.getByRole("form", { name: "New Group" });
  await create
    .getByLabel("Group name", { exact: true })
    .fill("Synthetic group controls");
  await create.getByLabel("Synthetic manager", { exact: true }).check();
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic group controls",
      exact: true,
    }),
  ).toBeVisible();
  const list = await (await api(context, { action: "list" })).json();
  const group = list.data.find(
    (x: { name: string }) => x.name === "Synthetic group controls",
  );
  expect(group.can_manage).toBe(true);
  await page
    .getByLabel("Message", { exact: true })
    .fill("Persistent earlier group history");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "Persistent earlier group history",
  );
  await page.getByRole("button", { name: "Chat Info", exact: true }).click();
  const info = page.getByRole("form", { name: "Chat Info" });
  await expect(info.getByText("Edit Team", { exact: true })).toBeVisible();
  await info.getByLabel("Synthetic owner", { exact: true }).check();
  await info
    .getByLabel("Allow members to send messages", { exact: true })
    .uncheck();
  await page.screenshot({
    path: "/tmp/ct-alt-chat-group-info.png",
    fullPage: true,
  });
  await info.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(info).not.toBeVisible();
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await login(managerPage, "manager");
  await managerPage
    .getByRole("button", { name: /Synthetic group controls/ })
    .click();
  await expect(managerPage.getByRole("log")).toContainText(
    "Persistent earlier group history",
  );
  await expect(
    managerPage.getByText(
      "Only group admins can send messages in this group.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(managerPage.getByLabel("Message", { exact: true })).toHaveCount(
    0,
  );
  const denied = await api(managerContext, {
    action: "send",
    conversationId: group.id,
    clientId: crypto.randomUUID(),
    body: "Denied real local member",
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).kind).toBe("posting_restricted");
  expect(
    (
      await api(managerContext, { action: "history", conversationId: group.id })
    ).status(),
  ).toBe(200);
  await managerPage
    .getByRole("button", { name: "Chat Info", exact: true })
    .click();
  await expect(
    managerPage
      .getByRole("form", { name: "Chat Info" })
      .getByRole("button", { name: "Save changes" }),
  ).toHaveCount(0);
  await managerPage.getByRole("button", { name: "Close Chat Info" }).click();
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await login(outsiderPage, "outsider");
  expect(
    (
      await api(outsiderContext, {
        action: "group_info",
        conversationId: group.id,
      })
    ).status(),
  ).toBe(403);
  const original = {
    action: "manage_group",
    conversationId: group.id,
    revision: 2,
    members: [
      f.accounts.employee.id,
      f.accounts.manager.id,
      f.accounts.owner.id,
    ],
    group_admins: [f.accounts.employee.id],
    allow_member_messages: false,
  };
  expect((await api(outsiderContext, original)).status()).toBe(403);
  expect((await api(managerContext, original)).status()).toBe(403);
  expect((await api(context, { ...original, revision: 1 })).status()).toBe(409);
  expect(
    (
      await api(context, {
        ...original,
        group_admins: [],
        members: [f.accounts.employee.id, f.accounts.manager.id],
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await api(context, {
        ...original,
        members: [...original.members, f.accounts.foreign.id],
      })
    ).status(),
  ).toBe(403);
  expect((await api(context, original, f.foreignTenant)).status()).toBe(403);
  await page.getByRole("button", { name: "Chat Info", exact: true }).click();
  await info
    .getByLabel("Group admin: Synthetic manager", { exact: true })
    .check();
  await info.getByLabel("Synthetic owner", { exact: true }).uncheck();
  await info.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(info).not.toBeVisible();
  await managerPage.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    managerPage.getByLabel("Message", { exact: true }),
  ).toBeVisible();
  await managerPage
    .getByLabel("Message", { exact: true })
    .fill("Promoted group admin message");
  await managerPage.getByRole("button", { name: "Send", exact: true }).click();
  await expect(managerPage.getByRole("log")).toContainText(
    "Promoted group admin message",
  );
  await page.getByRole("button", { name: "Chat Info", exact: true }).click();
  await info.getByLabel("Synthetic manager", { exact: true }).uncheck();
  await info.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(info).not.toBeVisible();
  expect(
    (
      await api(managerContext, { action: "history", conversationId: group.id })
    ).status(),
  ).toBe(403);
  await managerPage.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(managerPage.getByRole("log")).toHaveCount(0);
  const audit = await admin
    .from("chat_group_audit")
    .select("revision")
    .eq("conversation_id", group.id);
  expect(audit.error).toBeNull();
  expect(audit.data?.map((x) => x.revision)).toEqual([2, 3, 4]);
  const suspended = await admin
    .from("tenant_memberships")
    .update({ status: "suspended" })
    .eq("tenant_id", f.tenant)
    .eq("user_id", f.accounts.employee.id);
  expect(suspended.error).toBeNull();
  expect((await api(context, { ...original, revision: 4 })).status()).toBe(403);
  await managerContext.close();
  await outsiderContext.close();
});
