import { test, expect, type Page, type Route } from "@playwright/test";
import type {
  DirectoryRole,
  DirectoryContact,
  DirectorySaved,
  DirectoryMutation,
  DirectoryAccess,
  DirectoryRecoveryQuery,
  DirectoryCatalogue,
} from "../../lib/directory-types";
const id = (value: number) =>
  `94000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenant = id(1),
  actor = id(2),
  markerKey = `ct-alt:directory-operation:v1:${actor}:${tenant}`;
const contact = (value: number, visible = true): DirectoryContact => ({
  id: id(100 + value),
  name:
    value === 0
      ? "Northbank Locksmiths"
      : `Site supplier ${String(value).padStart(4, "0")}`,
  description: value === 0 ? "Locksmith service" : "Building supplies",
  phone: "020 7111 2222",
  email: "contact@northbank.example",
  visible_in_app: visible,
  revision: 1,
  created_at: "2026-10-05T09:00:00.000001Z",
  updated_at: "2026-10-05T09:00:00.000001Z",
});
async function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function setup(
  page: Page,
  scenario = "normal",
  count = 1,
  initialRole: DirectoryRole = "owner",
) {
  const state = {
    active: scenario !== "inactive",
    revision: scenario === "inactive" ? 0 : 1,
    role: initialRole,
    tenant,
    actor,
    contacts: Array.from({ length: count }, (_, index) => contact(index)),
    quota: scenario === "closure-quota",
  };
  const writes: DirectoryMutation[] = [],
    reconciliations: DirectoryRecoveryQuery[] = [],
    receipts = new Map<string, DirectorySaved | null>();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let catalogueReads = 0,
    accessReads = 0;
  const access = (): DirectoryAccess => ({
    schemaVersion: 1,
    company: {
      id: state.tenant,
      name:
        state.tenant === tenant ? "Northbank Services" : "Riverside Services",
      time_zone: "UTC",
    },
    actorId: state.actor,
    role: state.role,
    canManage: state.role === "owner",
    active: state.active,
    viewRevision: state.revision,
  });
  if (["hidden", "held-catalogue"].includes(scenario))
    state.contacts.push({ ...contact(2, false), name: "Private supplier" });
  if (scenario === "literal")
    state.contacts.push({
      ...contact(2),
      name: "Gate %_ Service",
      description: "Replacement gates",
    });
  if (scenario === "unicode-authoritative")
    state.contacts = [
      { ...contact(0), name: "ΟΣ Supplies", description: "Greek supplier" },
    ];
  if (scenario === "unicode")
    state.contacts = [
      {
        ...contact(0),
        name: "Élodie Nguyen",
        description: "Réception support",
      },
    ];
  await page.route("**/api/directory**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const params = new URL(request.url()).searchParams;
      const proof = access();
      if (params.get("mode") === "access") {
        accessReads++;
        if (scenario === "denied-proof" && accessReads > 1)
          return json(route, { error: "Current owner revoked" }, 403);
        if (!proof.active && !proof.canManage)
          return json(route, { error: "Inactive Directory denied" }, 403);
        if (scenario === "denied-read")
          return json(route, { error: "Access revoked" }, 403);
        if (scenario === "held-access" && accessReads === 1) await held;
        return json(route, { data: proof });
      }
      catalogueReads++;
      const search = (params.get("q") || "").trim();
      const scoped = proof.canManage
        ? state.contacts
        : state.contacts.filter((row) => row.visible_in_app);
      const visible =
        scenario === "unicode-authoritative" && search === "οσ"
          ? scoped
          : scoped.filter((row) =>
              `${row.name} ${row.description}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            );
      const start = params.get("cursor")
        ? 100 * Number(params.get("cursor"))
        : 0;
      const rows = visible.slice(start, start + 100);
      const data: DirectoryCatalogue = {
        ...proof,
        search,
        contacts: rows,
        page: {
          total: visible.length,
          nextCursor:
            start + 100 < visible.length ? String(start / 100 + 1) : null,
        },
      };
      if (scenario === "held-catalogue" && catalogueReads === 1) await held;
      if (scenario === "held-search" && search === "Northbank") await held;
      if (scenario === "late-denial" && catalogueReads === 1) await held;
      if (scenario === "page-revision" && start) data.viewRevision++;
      if (scenario === "page-duplicate" && start) data.contacts[0] = contact(0);
      if (scenario === "page-cycle" && start)
        data.page.nextCursor = params.get("cursor");
      if (scenario === "page-incomplete") data.page.nextCursor = null;
      if (scenario === "hidden-forged")
        data.contacts = [{ ...contact(3, false), name: "Private supplier" }];
      if (scenario === "wrong-actor") data.actorId = id(99);
      if (scenario === "wrong-company") data.company.id = id(99);
      return json(route, { data });
    }
    const body: DirectoryMutation | DirectoryRecoveryQuery =
      request.postDataJSON();
    if ("mode" in body) {
      reconciliations.push(body);
      if (["lost", "bad-ack", "absent", "mutation-quota"].includes(scenario))
        await held;
      if (state.quota)
        return json(
          route,
          { error: "Operation capacity prevents closure" },
          409,
        );
      const saved = receipts.get(body.operationId) || null;
      if (!saved) receipts.set(body.operationId, null);
      return json(route, {
        reconciliation: {
          schemaVersion: 1,
          tenantId: state.tenant,
          actorId: state.actor,
          operationId: body.operationId,
          action: body.action,
          contactId: body.contactId,
          status: saved ? "recorded" : "not_recorded",
          saved,
        },
      });
    }
    writes.push(body);
    if (scenario === "denied-write" || scenario === "late-denial")
      return json(route, { error: "Owner access revoked" }, 403);
    if (scenario === "absent" || scenario === "closure-quota")
      return route.abort();
    if (scenario === "mutation-quota")
      return json(route, { error: "Contact capacity reached" }, 409);
    state.revision++;
    state.active = true;
    let target: DirectoryContact | null = null;
    const change = body.change;
    if (change.action === "create") {
      target = {
        ...contact(700),
        name: change.name,
        description: change.description,
        phone: change.phone,
        email: change.email,
      };
      state.contacts.push(target);
    } else if (change.action === "visibility") {
      target =
        state.contacts.find((row) => row.id === change.contact_id) || null;
      if (target) {
        target.visible_in_app = change.visible_in_app;
        target.revision++;
      }
    }
    const saved: DirectorySaved = {
      schemaVersion: 1,
      tenantId: state.tenant,
      actorId: state.actor,
      operationId: body.operationId,
      action: change.action,
      directory_revision: state.revision,
      contact_id: target?.id || null,
      contact_revision: target?.revision || null,
      active: true,
    };
    receipts.set(body.operationId, saved);
    if (scenario === "held-ack") await held;
    if (scenario === "lost") return route.abort();
    return json(route, {
      saved: scenario === "bad-ack" ? { ...saved, operationId: id(99) } : saved,
    });
  });
  await page.goto(`/directory-component-fixture?role=${initialRole}`);
  return {
    state,
    writes,
    reconciliations,
    receipts,
    release,
    catalogueReads: () => catalogueReads,
    accessReads: () => accessReads,
  };
}
async function add(
  page: Page,
  name = "Riverside Reception",
  phone = "020 7333 4444",
  email = "reception@riverside.example",
) {
  await page.getByRole("button", { name: "Add Contact", exact: true }).click();
  const drawer = page.getByRole("dialog", {
    name: "Add new contact",
    exact: true,
  });
  await drawer.getByLabel("Type name", { exact: true }).fill(name);
  await drawer
    .getByLabel("Description (optional)", { exact: true })
    .fill("Front desk support");
  await drawer.getByLabel("Phone number", { exact: true }).fill(phone);
  await drawer.getByLabel("Email", { exact: true }).fill(email);
  await drawer
    .getByRole("button", { name: "Save Contact", exact: true })
    .click();
}
async function marker(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), markerKey);
}
async function leave(page: Page) {
  await page
    .getByRole("button", { name: "Leave Directory fixture", exact: true })
    .dispatchEvent("click");
}
async function reopen(page: Page) {
  await page
    .getByRole("button", { name: "Open Directory fixture", exact: true })
    .click();
}

test("owner activates Directory atomically then sees Work Contacts", async ({
  page,
}) => {
  const state = await setup(page, "inactive", 0);
  await expect(
    page.getByText("Get Started with Directory", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Click here to activate your Directory", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add Contact", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "ACTIVATE DIRECTORY", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Work Contacts", exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].change).toEqual({
    action: "activate",
    directory_revision: 0,
  });
  await expect(
    page.getByRole("button", { name: "ACTIVATE DIRECTORY", exact: true }),
  ).toHaveCount(0);
});
test("reference catalogue uses supported headers, initials and green switch without extra controls", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader")).toHaveText([
    "Name",
    "Description",
    "Visible in app",
  ]);
  await expect(
    page.getByRole("switch", {
      name: "Visible in app Northbank Locksmiths",
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.getByText("NL", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /Category admins|Mobile Preview|Add Information|Select contacts|quota|capacity|Review/,
    ),
  ).toHaveCount(0);
  await page
    .locator("[data-fixture-controls]")
    .evaluate((element) => element.setAttribute("hidden", ""));
  await page.screenshot({ path: "/tmp/ct-alt-directory-catalogue-ui.png" });
});
test("Add Contact drawer has only fixed supported fields and persists plain text", async ({
  page,
}) => {
  const state = await setup(page);
  await add(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Riverside Reception", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].change).toEqual({
    action: "create",
    directory_revision: 1,
    name: "Riverside Reception",
    description: "Front desk support",
    phone: "020 7333 4444",
    email: "reception@riverside.example",
  });
  expect(await marker(page)).toBeNull();
});
test("reference drawer keeps501px width in actual DashboardShell cascade", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add Contact", exact: true }).click();
  const drawer = page.getByRole("dialog", {
    name: "Add new contact",
    exact: true,
  });
  await expect(drawer.getByRole("textbox")).toHaveCount(4);
  await expect(drawer.getByRole("button")).toHaveCount(2);
  expect(
    await drawer.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    ),
  ).toBe(501);
  await expect(drawer).not.toContainText(/Add Information|Photo|Remove|Review/);
  await page
    .locator("[data-fixture-controls]")
    .evaluate((element) => element.setAttribute("hidden", ""));
  await page.screenshot({ path: "/tmp/ct-alt-directory-add-ui.png" });
});
test("optional channels are permitted empty without accounts or invitations", async ({
  page,
}) => {
  const state = await setup(page);
  await add(page, "Westgate Supplies", "", "");
  await expect(
    page.getByText("Westgate Supplies", { exact: true }),
  ).toBeVisible();
  const change = state.writes[0].change;
  expect(change.action).toBe("create");
  if (change.action === "create") {
    expect(change.phone).toBe("");
    expect(change.email).toBe("");
  }
  await expect(
    page.getByText(/Invite|account created|notification sent/),
  ).toHaveCount(0);
});
test("phone and email are plain optional strings without undocumented validators", async ({
  page,
}) => {
  const state = await setup(page);
  await add(page, "Gatehouse Contact", "extension seven", "ask reception");
  await expect(
    page.getByText("Gatehouse Contact", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
});
test("owner visibility changes persist without optimistic switch state", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("switch", {
      name: "Visible in app Northbank Locksmiths",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("switch", {
      name: "Visible in app Northbank Locksmiths",
      exact: true,
    }),
  ).not.toBeChecked();
  expect(state.writes[0].change).toEqual({
    action: "visibility",
    directory_revision: 1,
    contact_id: id(100),
    contact_revision: 1,
    visible_in_app: false,
  });
  expect(state.state.contacts[0].revision).toBe(2);
});
for (const role of ["admin", "manager", "employee"] as const)
  test(`${role} has a visible-only readonly phonebook`, async ({ page }) => {
    await setup(page, "hidden", 1, role);
    await expect(
      page.getByText("Northbank Locksmiths", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Private supplier", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add Contact", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Search", exact: true })
      .fill("Private");
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(0);
  });
test("full1000-contact automatic paging enables truthful last-page search", async ({
  page,
}) => {
  const state = await setup(page, "normal", 1000);
  await expect(
    page.getByRole("searchbox", { name: "Search", exact: true }),
  ).toBeEnabled();
  expect(state.catalogueReads()).toBe(10);
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("Site supplier 0999");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByText("Site supplier 0999", { exact: true }),
  ).toBeVisible();
  expect(state.catalogueReads()).toBe(11);
});
test("literal search matches percent and underscore without wildcard expansion", async ({
  page,
}) => {
  await setup(page, "literal");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("%_");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByText("Gate %_ Service", { exact: true }),
  ).toBeVisible();
});
test("description search and Unicode names retain original plain text", async ({
  page,
}) => {
  await setup(page, "unicode");
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("réception");
  await expect(page.getByText("Élodie Nguyen", { exact: true })).toBeVisible();
  await expect(page.getByText("ÉN", { exact: true })).toBeVisible();
});
for (const scenario of [
  "page-revision",
  "page-duplicate",
  "page-cycle",
  "page-incomplete",
])
  test(`${scenario} rejects partial or mixed catalogue`, async ({ page }) => {
    await setup(page, scenario, 101);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Directory could not be loaded." }),
    ).toBeVisible();
    await expect(
      page.getByText("Northbank Locksmiths", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add Contact", exact: true }),
    ).toHaveCount(0);
  });
for (const scenario of ["wrong-actor", "wrong-company"])
  test(`${scenario} response clears protected controls`, async ({ page }) => {
    await setup(page, scenario);
    await expect(
      page.getByText("Directory is unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });
test("nonowner rejects forged hidden row instead of rendering it", async ({
  page,
}) => {
  await setup(page, "hidden-forged", 1, "employee");
  await expect(
    page.getByText("Directory could not be loaded.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Private supplier", { exact: true })).toHaveCount(
    0,
  );
});
test("held owner response cannot restore hidden rows after manager demotion", async ({
  page,
}) => {
  const state = await setup(page, "held-catalogue");
  await expect.poll(() => state.catalogueReads()).toBe(1);
  state.state.role = "manager";
  await page
    .getByRole("button", { name: "Change current role", exact: true })
    .dispatchEvent("click");
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toBeVisible();
  state.release();
  await expect(
    page.getByRole("button", { name: "Add Contact", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Private supplier", { exact: true })).toHaveCount(
    0,
  );
});
test("held response after company departure cannot install old-company contacts", async ({
  page,
}) => {
  const state = await setup(page, "held-catalogue");
  await expect.poll(() => state.catalogueReads()).toBe(1);
  state.state.tenant = id(9);
  state.state.contacts = [{ ...contact(2), name: "Riverside Supplies" }];
  await page
    .getByRole("button", { name: "Change current company", exact: true })
    .dispatchEvent("click");
  await expect(
    page.getByText("Riverside Supplies", { exact: true }),
  ).toBeVisible();
  state.release();
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toHaveCount(0);
});
test("held acknowledgement stores only identity and locks other writes", async ({
  page,
}) => {
  const state = await setup(page, "held-ack");
  await add(page);
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Save Contact", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeDisabled();
  const stored = await marker(page);
  expect(stored).toBeTruthy();
  expect(stored).not.toMatch(
    /Riverside|reception|020 7333 4444|description|phone|email|directory_revision/,
  );
  state.release();
  await expect(
    page.getByText("Riverside Reception", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
});
for (const scenario of ["lost", "bad-ack"])
  test(`${scenario} recovers original recorded outcome with one mutation`, async ({
    page,
  }) => {
    const state = await setup(page, scenario);
    await add(page);
    await expect.poll(() => state.reconciliations.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Save Contact", exact: true }),
    ).toBeDisabled();
    state.release();
    await expect(
      page.getByText("Riverside Reception", { exact: true }),
    ).toBeVisible();
    expect(state.writes).toHaveLength(1);
    expect(state.reconciliations[0].operationId).toBe(
      state.writes[0].operationId,
    );
    expect(await marker(page)).toBeNull();
  });
for (const scenario of ["absent", "mutation-quota"])
  test(`${scenario} waits for durable closed absence before a new write`, async ({
    page,
  }) => {
    const state = await setup(page, scenario);
    await add(page);
    await expect.poll(() => state.reconciliations.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Save Contact", exact: true }),
    ).toBeDisabled();
    state.release();
    await expect(
      page.getByRole("button", { name: "Add Contact", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("Riverside Reception", { exact: true }),
    ).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    expect(await marker(page)).toBeNull();
  });
test("closure quota retains marker until a later remount can close absence", async ({
  page,
}) => {
  const state = await setup(page, "closure-quota");
  await add(page);
  await expect.poll(() => state.reconciliations.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Save Contact", exact: true }),
  ).toBeDisabled();
  expect(await marker(page)).toBeTruthy();
  await leave(page);
  state.state.quota = false;
  await reopen(page);
  await expect(
    page.getByRole("button", { name: "Add Contact", exact: true }),
  ).toBeEnabled();
  expect(state.reconciliations).toHaveLength(2);
  expect(state.writes).toHaveLength(1);
  expect(await marker(page)).toBeNull();
});
test("departure and remount recover held committed create without replay", async ({
  page,
}) => {
  const state = await setup(page, "held-ack");
  await add(page);
  await expect.poll(() => state.writes.length).toBe(1);
  await leave(page);
  await reopen(page);
  await expect(
    page.getByText("Riverside Reception", { exact: true }),
  ).toBeVisible();
  state.release();
  expect(state.writes).toHaveLength(1);
  expect(state.reconciliations).toHaveLength(1);
  expect(await marker(page)).toBeNull();
});
test("current403 removes entered fields and all retained protected rows", async ({
  page,
}) => {
  const state = await setup(page, "denied-write");
  await add(page);
  await expect(
    page.getByText("Directory is unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.reconciliations).toHaveLength(0);
  expect(await marker(page)).toBeTruthy();
});
test("older privileged catalogue cannot return after current write403", async ({
  page,
}) => {
  const state = await setup(page, "late-denial");
  await expect.poll(() => state.catalogueReads()).toBe(1);
  await leave(page);
  await reopen(page);
  await add(page);
  await expect(
    page.getByText("Directory is unavailable.", { exact: true }),
  ).toBeVisible();
  state.release();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toHaveCount(0);
});
test("browser storage failure prevents any mutation", async ({ page }) => {
  const state = await setup(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error("Unavailable");
    };
  });
  await add(page);
  await expect(
    page.getByText("The change could not be saved.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(0);
  expect(state.reconciliations).toHaveLength(0);
});
test("control characters are rejected before storing or sending a contact", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Add Contact", exact: true }).click();
  await page
    .getByLabel("Type name", { exact: true })
    .fill("Riverside Reception");
  await page
    .getByLabel("Description (optional)", { exact: true })
    .fill("Line one\nLine two");
  await page.getByRole("button", { name: "Save Contact", exact: true }).click();
  await expect(
    page.getByText("The change could not be saved.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(0);
  expect(await marker(page)).toBeNull();
});
test("Close arrow and Escape dismiss idle drawer", async ({ page }) => {
  await setup(page);
  const button = page.getByRole("button", { name: "Add Contact", exact: true });
  await button.click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await button.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("held visibility acknowledgement retains previous switch until persisted refresh", async ({
  page,
}) => {
  const state = await setup(page, "held-ack");
  const toggle = page.getByRole("switch", {
    name: "Visible in app Northbank Locksmiths",
    exact: true,
  });
  await toggle.click();
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add Contact", exact: true }),
  ).toBeDisabled();
  state.release();
  await expect(toggle).not.toBeChecked();
  expect(state.writes).toHaveLength(1);
});
test("empty name has no undocumented native required marker or bubble", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Add Contact", exact: true }).click();
  await expect(
    page.getByLabel("Type name", { exact: true }),
  ).not.toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Save Contact", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "The change could not be saved.",
  );
  expect(state.writes).toHaveLength(0);
});
test("interfield literal Search uses authoritative space-separated query", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("Locksmiths Locksmith");
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
});
test("Unicode server matches remain authoritative instead of client locale refiltering", async ({
  page,
}) => {
  await setup(page, "unicode-authoritative");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("οσ");
  await expect(page.getByText("ΟΣ Supplies", { exact: true })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
});
test("older Search response cannot replace newer query result", async ({
  page,
}) => {
  const state = await setup(page, "held-search", 2);
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("Northbank");
  await expect.poll(() => state.catalogueReads()).toBe(2);
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("Site supplier");
  await expect(
    page.getByText("Site supplier 0001", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toHaveCount(0);
  state.release();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByText("Northbank Locksmiths", { exact: true }),
  ).toHaveCount(0);
});
for (const change of ["later-revision", "later-absence"])
  test(`original receipt remains valid after ${change}`, async ({ page }) => {
    const state = await setup(page, "held-ack");
    await add(page);
    await expect.poll(() => state.writes.length).toBe(1);
    await leave(page);
    state.state.revision = 8;
    if (change === "later-revision") {
      const row = state.state.contacts.find(
        (row) => row.name === "Riverside Reception",
      )!;
      row.revision = 5;
      row.name = "Riverside Dispatch";
    } else
      state.state.contacts = state.state.contacts.filter(
        (row) => row.name !== "Riverside Reception",
      );
    await reopen(page);
    await expect(
      page.getByRole("button", { name: "Add Contact", exact: true }),
    ).toBeEnabled();
    expect(await marker(page)).toBeNull();
    expect(state.writes).toHaveLength(1);
    expect(state.reconciliations).toHaveLength(1);
    if (change === "later-revision")
      await expect(
        page.getByText("Riverside Dispatch", { exact: true }),
      ).toBeVisible();
    await expect(
      page.getByText("Riverside Reception", { exact: true }),
    ).toHaveCount(0);
    state.release();
  });
test("current owner denial during post-ACK proof preserves original operation and clears data", async ({
  page,
}) => {
  const state = await setup(page, "denied-proof");
  await add(page);
  await expect(
    page.getByText("Directory is unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await marker(page)).toBeTruthy();
  expect(state.writes).toHaveLength(1);
  expect(state.reconciliations).toHaveLength(0);
});
for (const role of ["admin", "manager", "employee"] as const)
  test(`${role} cannot activate inactive Directory`, async ({ page }) => {
    const state = await setup(page, "inactive", 0, role);
    await expect(
      page.getByText("Directory is unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ACTIVATE DIRECTORY", exact: true }),
    ).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });
test("actor-scoped marker is not reconciled or erased by a different current owner", async ({
  page,
}) => {
  const state = await setup(page, "held-ack");
  await add(page);
  await expect.poll(() => state.writes.length).toBe(1);
  state.state.actor = id(8);
  await page
    .getByRole("button", { name: "Change current actor", exact: true })
    .dispatchEvent("click");
  await expect(
    page.getByRole("button", { name: "Add Contact", exact: true }),
  ).toBeEnabled();
  expect(state.reconciliations).toHaveLength(0);
  expect(await marker(page)).toBeTruthy();
  state.release();
  expect(await marker(page)).toBeTruthy();
});
