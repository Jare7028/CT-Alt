import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
type Account = { id: string; email: string; password: string; role: string };
const f: {
  url: string;
  key: string;
  tenant: string;
  foreignTenant: string;
  accounts: Record<string, Account>;
} = JSON.parse(
  readFileSync("/tmp/ct-alt-chat-acceptance-fixtures.json", "utf8"),
);
const settings = JSON.parse(
  readFileSync("/tmp/ct-alt-chat-status.json", "utf8"),
);
if (f.url !== "http://127.0.0.1:54821" || settings.API_URL !== f.url)
  throw Error("Wrong isolated API");
if (
  !readFileSync("/tmp/ct-alt-chat-stack/supabase/config.toml", "utf8").includes(
    'project_id = "ct-alt-chat-acceptance"',
  )
)
  throw Error("Wrong project");
const admin = createClient(f.url, settings.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function signed(name: string) {
  const client = createClient(f.url, f.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword(f.accounts[name]);
  expect(error).toBeNull();
  return client;
}
async function login(page: Page, name: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(f.accounts[name].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(f.accounts[name].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/agents/);
  await page.goto(
    `/chat?company=${name === "foreign" ? f.foreignTenant : f.tenant}`,
  );
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
test("real Auth, signed-cookie API, UI persistence, tenant/privacy boundaries, retries, reconnect and live revocation", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await admin.from("chat_conversations").delete().eq("tenant_id", f.tenant);
  await admin.from("tenants").update({ status: "active" }).eq("id", f.tenant);
  for (const a of Object.values(f.accounts))
    await admin
      .from("tenant_memberships")
      .update({ role: a.role, status: "active" })
      .eq("user_id", a.id);
  const owner = await signed("owner");
  const employee = await signed("employee"),
    outsider = await signed("outsider"),
    foreign = await signed("foreign"),
    manager = await signed("manager");
  await login(page, "owner");
  // Expire the signed local access JWT while retaining its real refresh token.
  const cookies = (await context.cookies())
    .filter((c) => c.name.startsWith("ct-alt-auth"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const encoded = cookies.map((c) => c.value).join("");
  const session = JSON.parse(
    Buffer.from(encoded.slice(7), "base64url").toString(),
  );
  const pieces = session.access_token.split(".");
  const claims = JSON.parse(Buffer.from(pieces[1], "base64url").toString());
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const unsigned =
    pieces[0] + "." + Buffer.from(JSON.stringify(claims)).toString("base64url");
  session.access_token =
    unsigned +
    "." +
    createHmac("sha256", settings.JWT_SECRET)
      .update(unsigned)
      .digest("base64url");
  session.expires_at = claims.exp;
  const expired =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  expect(cookies).toHaveLength(1);
  await context.addCookies([{ ...cookies[0], value: expired }]);
  const expiredNavigation = await page.goto(`/chat?company=${f.tenant}`);
  if (!expiredNavigation)
    throw Error("Missing direct Chat navigation response");
  expect(expiredNavigation.status()).toBe(200);
  const navigationHeaders = await expiredNavigation.headersArray();
  expect(
    navigationHeaders.some(
      (header) =>
        header.name.toLowerCase() === "set-cookie" &&
        header.value.startsWith("ct-alt-auth"),
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Chat", exact: true }),
  ).toBeVisible();
  const refreshed = (await context.cookies())
    .filter((c) => c.name.startsWith("ct-alt-auth"))
    .map((c) => c.value)
    .join("");
  expect(refreshed).not.toBe(expired);
  const csrf = await context.request.post("/api/chat", {
    headers: { Origin: "https://untrusted.example.test" },
    data: { tenantId: f.tenant, payload: { action: "list" } },
  });
  expect(csrf.status()).toBe(403);
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Chat", exact: true }).click();
  const directForm = page.getByRole("form", { name: "New Chat" });
  await directForm.getByLabel("Synthetic employee").check();
  const createdPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/chat") &&
      r.request().postDataJSON().payload.action === "create",
  );
  await directForm.getByRole("button", { name: "Create", exact: true }).click();
  const created = await createdPromise;
  expect(created.status()).toBe(200);
  const conversation = (await created.json()).data.id;
  await expect(
    page.getByRole("heading", { name: "Synthetic employee" }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Actual local persistent synthetic message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "Actual local persistent synthetic message",
  );
  await expect
    .poll(
      async () => {
        const r = await owner
          .from("chat_reads")
          .select("sequence")
          .eq("conversation_id", conversation)
          .eq("user_id", f.accounts.owner.id);
        return r.data?.[0]?.sequence || 0;
      },
      { timeout: 10000 },
    )
    .toBe(1);
  const employeeHistory = await employee.rpc("chat_action", {
    target_tenant: f.tenant,
    payload: { action: "history", conversationId: conversation },
  });
  expect(employeeHistory.error).toBeNull();
  expect(employeeHistory.data[0].sender_id).toBe(f.accounts.owner.id);
  const unread = await employee.rpc("chat_action", {
    target_tenant: f.tenant,
    payload: { action: "list" },
  });
  expect(
    unread.data.find(
      (c: { id: string; unread: number }) => c.id === conversation,
    ).unread,
  ).toBe(1);
  for (const client of [outsider, foreign]) {
    const rows = await client
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversation);
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([]);
    for (const action of ["history", "send"]) {
      const result = await client.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: {
          action,
          conversationId: conversation,
          clientId: crypto.randomUUID(),
          body: "Denied synthetic",
        },
      });
      expect(result.error?.code).toBe("42501");
    }
  }
  const wrongCompany = await api(
    context,
    { action: "history", conversationId: conversation },
    f.foreignTenant,
  );
  expect(wrongCompany.status()).toBe(403);
  const attempt = {
    action: "send",
    conversationId: conversation,
    clientId: crypto.randomUUID(),
    body: "Duplicate synthetic",
  };
  const retryResponses = await Promise.all([
    api(context, attempt),
    api(context, attempt),
  ]);
  expect(retryResponses.map((r) => r.status())).toEqual([200, 200]);
  const copies = await Promise.all(retryResponses.map((r) => r.json()));
  expect(copies[0].data.sequence).toBe(copies[1].data.sequence);
  let dropped = false;
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    if (body.payload.action === "send" && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByLabel("Message", { exact: true })
    .fill("Lost actual response");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry send" })).toBeVisible();
  await page.getByRole("button", { name: "Retry send" }).click();
  await expect(
    page.getByRole("log").getByText("Lost actual response", { exact: true }),
  ).toHaveCount(1);
  await page.unroute("**/api/chat");
  const rows = await employee
    .from("chat_messages")
    .select("*")
    .eq("conversation_id", conversation);
  expect(
    rows.data?.filter((m) => m.body === "Lost actual response"),
  ).toHaveLength(1);
  expect(
    rows.data?.filter((m) => m.body === "Duplicate synthetic"),
  ).toHaveLength(1);
  await expect
    .poll(async () => {
      const read = await owner
        .from("chat_reads")
        .select("sequence")
        .eq("conversation_id", conversation)
        .eq("user_id", f.accounts.owner.id);
      return read.data?.[0]?.sequence;
    })
    .toBe(3);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  const employeeRetry = {
    action: "send",
    conversationId: conversation,
    clientId: crypto.randomUUID(),
    body: "Actual reconnect 0",
  };
  for (let i = 0; i < 205; i++) {
    const result = await employee.rpc("chat_action", {
      target_tenant: f.tenant,
      payload:
        i === 0
          ? employeeRetry
          : {
              action: "send",
              conversationId: conversation,
              clientId: crypto.randomUUID(),
              body: `Actual reconnect ${i}`,
            },
    });
    expect(result.error).toBeNull();
  }
  const pausedRead = await owner
    .from("chat_reads")
    .select("sequence")
    .eq("conversation_id", conversation)
    .eq("user_id", f.accounts.owner.id);
  expect(pausedRead.data?.[0]?.sequence).toBe(3);
  await page.clock.resume();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(208, {
    timeout: 20000,
  });
  const bodies = await page
    .getByRole("log")
    .getByRole("article")
    .locator("p")
    .allTextContents();
  expect(bodies.slice(-205)).toEqual(
    Array.from({ length: 205 }, (_, i) => `Actual reconnect ${i}`),
  );
  const history = await employee.rpc("chat_action", {
    target_tenant: f.tenant,
    payload: { action: "history", conversationId: conversation, after: 0 },
  });
  expect(history.data.map((m: { sequence: number }) => m.sequence)).toEqual(
    Array.from({ length: 100 }, (_, i) => i + 1),
  );
  await page.reload();
  await page.getByRole("button", { name: "Synthetic employee" }).click();
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(100);
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(200);
  await page.getByText("Add New", { exact: true }).click();
  await page.getByRole("button", { name: "New Group", exact: true }).click();
  const groupForm = page.getByRole("form", { name: "New Group" });
  await groupForm.getByLabel("Group name").fill("Actual synthetic group");
  await groupForm.getByLabel("Description").fill("Synthetic context");
  await groupForm.getByLabel("Synthetic employee").check();
  await groupForm.getByLabel("Synthetic manager").check();
  const groupResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/chat") &&
      r.request().postDataJSON().payload.action === "create",
  );
  await groupForm.getByRole("button", { name: "Create", exact: true }).click();
  const group = await groupResponse;
  expect(group.status()).toBe(200);
  const groupId = (await group.json()).data.id;
  await expect(
    page.getByRole("heading", { name: "Actual synthetic group" }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Actual group synthetic");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Actual group synthetic");
  const reversed = await Promise.all([
    owner.rpc("chat_action", {
      target_tenant: f.tenant,
      payload: {
        action: "create",
        kind: "direct",
        members: [f.accounts.manager.id],
      },
    }),
    manager.rpc("chat_action", {
      target_tenant: f.tenant,
      payload: {
        action: "create",
        kind: "direct",
        members: [f.accounts.owner.id],
      },
    }),
  ]);
  expect(reversed.map((r) => r.error)).toEqual([null, null]);
  expect(reversed[0].data.id).toBe(reversed[1].data.id);
  const groupRead = await employee.rpc("chat_action", {
    target_tenant: f.tenant,
    payload: { action: "history", conversationId: groupId },
  });
  expect(groupRead.data[0].body).toBe("Actual group synthetic");
  const restricted = await api(context, {
    action: "create",
    kind: "group",
    name: "Actual management",
    description: "",
    management_only: true,
    members: [f.accounts.manager.id],
  });
  expect(restricted.status()).toBe(200);
  const restrictedId = (await restricted.json()).data.id;
  expect(
    (
      await manager.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: { action: "history", conversationId: restrictedId },
      })
    ).error,
  ).toBeNull();
  async function heldUpdate<T>(
    statement: string,
    call: () => PromiseLike<T>,
  ): Promise<T> {
    const child = spawn("docker", [
      "exec",
      "-i",
      "ct-alt-chat-acceptance-db",
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
    ]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.resume();
    child.stdin.end(
      `set application_name='ct_alt_chat_acceptance_race';begin;${statement};select pg_sleep(2);commit;`,
    );
    const done = new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    let ready = false;
    for (let i = 0; i < 50; i++) {
      const r = spawnSync(
        "docker",
        [
          "exec",
          "ct-alt-chat-acceptance-db",
          "psql",
          "-X",
          "-At",
          "-U",
          "postgres",
          "-c",
          "select count(*) from pg_stat_activity where application_name='ct_alt_chat_acceptance_race' and wait_event='PgSleep'",
        ],
        { encoding: "utf8" },
      );
      if (r.stdout.trim() === "1") {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    const result = await call();
    expect(await done, stderr).toBe(0);
    return result;
  }
  const tenantRace = await heldUpdate(
    `update public.tenants set status='suspended' where id='${f.tenant}'`,
    () => api(context, attempt),
  );
  expect(tenantRace.status()).toBe(403);
  await admin.from("tenants").update({ status: "active" }).eq("id", f.tenant);
  const demotionRace = await heldUpdate(
    `update public.tenant_memberships set role='employee' where tenant_id='${f.tenant}' and user_id='${f.accounts.manager.id}'`,
    () =>
      manager.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: {
          action: "send",
          conversationId: restrictedId,
          clientId: crypto.randomUUID(),
          body: "Queued demotion synthetic",
        },
      }),
  );
  expect(demotionRace.error?.code).toBe("42501");
  await admin
    .from("tenant_memberships")
    .update({ role: "manager" })
    .eq("tenant_id", f.tenant)
    .eq("user_id", f.accounts.manager.id);
  const managementRetry = {
    action: "send",
    conversationId: restrictedId,
    clientId: crypto.randomUUID(),
    body: "Prior management synthetic",
  };
  expect(
    (
      await manager.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: managementRetry,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await admin
        .from("tenant_memberships")
        .update({ role: "employee" })
        .eq("tenant_id", f.tenant)
        .eq("user_id", f.accounts.manager.id)
    ).error,
  ).toBeNull();
  expect(
    (
      await manager.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: { action: "history", conversationId: restrictedId },
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await manager.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: managementRetry,
      })
    ).error?.code,
  ).toBe("42501");
  const employeeContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5194",
  });
  const employeePage = await employeeContext.newPage();
  await login(employeePage, "employee");
  await employeePage
    .locator("aside button")
    .filter({
      has: employeePage
        .locator("strong")
        .filter({ hasText: /^Synthetic owner$/ }),
    })
    .click();
  await expect(employeePage.getByRole("log")).toContainText(
    "Actual reconnect 204",
  );
  expect(
    (
      await admin
        .from("tenant_memberships")
        .update({ status: "suspended" })
        .eq("tenant_id", f.tenant)
        .eq("user_id", f.accounts.employee.id)
    ).error,
  ).toBeNull();
  expect(
    (
      await api(employeeContext, {
        action: "history",
        conversationId: conversation,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await employee.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: { action: "history", conversationId: conversation },
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await employee.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: employeeRetry,
      })
    ).error?.code,
  ).toBe("42501");
  await employeePage.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(employeePage.getByRole("log")).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(employeePage.getByLabel("Message", { exact: true })).toHaveCount(
    0,
  );
  expect(
    (
      await admin
        .from("tenant_memberships")
        .update({ status: "active" })
        .eq("tenant_id", f.tenant)
        .eq("user_id", f.accounts.employee.id)
    ).error,
  ).toBeNull();
  await employeePage.goto(`/chat?company=${f.tenant}`);
  await employeePage
    .locator("aside button")
    .filter({
      has: employeePage
        .locator("strong")
        .filter({ hasText: /^Synthetic owner$/ }),
    })
    .click();
  await expect(employeePage.getByRole("log")).toContainText(
    "Actual reconnect 204",
  );
  expect(
    (
      await admin
        .from("chat_members")
        .delete()
        .eq("conversation_id", conversation)
        .eq("user_id", f.accounts.employee.id)
    ).error,
  ).toBeNull();
  expect(
    (
      await api(employeeContext, {
        action: "send",
        conversationId: conversation,
        clientId: crypto.randomUUID(),
        body: "Removed",
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await employee
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversation)
    ).data,
  ).toEqual([]);
  expect(
    (
      await employee.rpc("chat_action", {
        target_tenant: f.tenant,
        payload: employeeRetry,
      })
    ).error?.code,
  ).toBe("42501");
  await employeePage.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(employeePage.getByRole("log")).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(employeePage.getByLabel("Message", { exact: true })).toHaveCount(
    0,
  );
  await employeeContext.close();
  expect(errors).toEqual([]);
});
