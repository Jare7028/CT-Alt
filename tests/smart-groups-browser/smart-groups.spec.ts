import {
  test,
  expect,
  type Page,
  type Route,
  type Request,
} from "@playwright/test";
import {
  company,
  actor,
  segmentId,
  groupId,
  group,
  segment,
  fields,
  counts,
  identity,
  initialData,
  member,
} from "./fixture-data";
import type {
  SmartGroup,
  SmartGroupSegment,
  SmartGroupMutation,
  SmartGroupRule,
} from "../../lib/smart-group-types";
type Context = {
  groups: SmartGroup[];
  segments: SmartGroupSegment[];
  requests: Request[];
  writes: SmartGroupMutation[];
  override?: (route: Route, url: URL) => Promise<boolean> | boolean;
};
const newId = "dddddddd-dddd-4ddd-8ddd-dddddddddd10";
async function json(route: Route, body: unknown, status = 200) {
  await route
    .fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
    .catch(() => {});
}
function pageMembers(cursor: string | null, search: string, total = 1005) {
  if (search) return [member(999)];
  return Array.from(
    { length: Math.min(50, total - (cursor ? 50 : 0)) },
    (_, i) => member(i + (cursor ? 51 : 1)),
  );
}
async function setup(page: Page, options: Partial<Context> = {}) {
  const ctx: Context = {
    groups: structuredClone(initialData().groups),
    segments: [structuredClone(segment)],
    requests: [],
    writes: [],
    ...options,
  };
  await page.route("**/api/smart-groups**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    ctx.requests.push(request);
    if (await ctx.override?.(route, url)) return;
    const scope = identity(url.searchParams.get("tenantId") || company.id),
      search = url.searchParams.get("search") || "",
      cursor = url.searchParams.get("cursor"),
      status = url.searchParams.get("status") || "all";
    if (request.method() === "POST" && url.pathname === "/api/smart-groups") {
      const mutation = request.postDataJSON() as SmartGroupMutation;
      ctx.writes.push(mutation);
      const change = mutation.change;
      let targetSegment = segmentId,
        targetGroup: string | undefined;
      const revision = "revision" in change ? change.revision + 1 : 1;
      if (change.action === "create_segment") {
        ctx.segments.push({
          ...segment,
          id: newId,
          name: change.name,
          description: change.description,
          activeGroupCount: 0,
          canArchive: true,
        });
        targetSegment = newId;
      } else if (change.action === "edit_segment") {
        targetSegment = change.segmentId;
        ctx.segments = ctx.segments.map((s) =>
          s.id === change.segmentId
            ? {
                ...s,
                name: change.name,
                description: change.description,
                revision,
              }
            : s,
        );
      } else if (
        change.action === "archive_segment" ||
        change.action === "restore_segment"
      ) {
        targetSegment = change.segmentId;
        ctx.segments = ctx.segments.map((s) =>
          s.id === change.segmentId
            ? {
                ...s,
                status:
                  change.action === "archive_segment" ? "archived" : "active",
                revision,
                canRestore: change.action === "archive_segment",
                canArchive: change.action === "restore_segment",
              }
            : s,
        );
      } else if (change.action === "create_group") {
        targetGroup = newId;
        targetSegment = change.segmentId;
        ctx.groups.push({
          ...group,
          id: newId,
          name: change.name,
          description: change.description,
          rules: change.rules,
          segmentId: change.segmentId,
        });
      } else if (change.action === "edit_group") {
        targetGroup = change.groupId;
        targetSegment = change.segmentId;
        ctx.groups = ctx.groups.map((g) =>
          g.id === change.groupId
            ? {
                ...g,
                name: change.name,
                description: change.description,
                rules: change.rules,
                segmentId: change.segmentId,
                revision,
                needsReview: false,
                invalidFields: [],
                counts,
              }
            : g,
        );
      } else if ("groupId" in change) {
        targetGroup = change.groupId;
        const found = ctx.groups.find((g) => g.id === change.groupId);
        targetSegment = found?.segmentId || segmentId;
        ctx.groups = ctx.groups.map((g) =>
          g.id === change.groupId
            ? {
                ...g,
                status:
                  change.action === "archive_group" ? "archived" : "active",
                revision,
                canRestore: change.action === "archive_group",
                canArchive: change.action === "restore_group",
              }
            : g,
        );
      }
      return json(route, {
        saved: {
          operationId: mutation.operationId,
          action: change.action,
          segmentId: targetSegment,
          ...(targetGroup ? { groupId: targetGroup } : {}),
          revision,
        },
      });
    }
    if (url.pathname === "/api/smart-groups/preview") {
      const input = request.postDataJSON() as {
        rules: SmartGroupRule[];
        search?: string;
        cursor?: string;
      };
      const matches = input.rules.every((r) =>
        r.values.includes(
          r.field === "title"
            ? "Supervisor"
            : r.field === "team"
              ? "Field operations"
              : "North",
        ),
      );
      const total = matches ? 1005 : 0;
      return json(route, {
        ...identity(),
        fields,
        rules: input.rules,
        members: total
          ? pageMembers(input.cursor || null, input.search || "")
          : [],
        counts: matches
          ? counts
          : { records: 0, eligible: 0, unlinked: 0, unavailable: 0 },
        matchedCount: input.search ? Math.min(1, total) : total,
        nextCursor:
          total && !input.search && !input.cursor ? "preview-page-2" : null,
        serverTime: "2026-10-04T10:00:00Z",
      });
    }
    if (url.pathname.endsWith("/members")) {
      const id = url.pathname.split("/")[3],
        g = ctx.groups.find((g) => g.id === id) || group,
        s = ctx.segments.find((s) => s.id === g.segmentId) || segment;
      return json(route, {
        ...scope,
        group: g,
        segment: s,
        fields,
        members: g.needsReview
          ? []
          : pageMembers(cursor, search, g.counts?.records || 0),
        counts: g.counts,
        matchedCount: g.needsReview ? null : search ? 1 : g.counts!.records,
        nextCursor:
          !g.needsReview && !search && !cursor && g.counts!.records > 50
            ? "member-page-2"
            : null,
        serverTime: "2026-10-04T10:00:00Z",
      });
    }
    if (url.pathname === "/api/smart-groups/segments") {
      const filtered = ctx.segments.filter(
        (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()),
      );
      return json(route, {
        ...scope,
        segments: filtered
          .filter((s) => status === "all" || s.status === status)
          .slice(cursor ? 50 : 0, cursor ? 100 : 50),
        counts: {
          total: filtered.length,
          active: filtered.filter((s) => s.status === "active").length,
          archived: filtered.filter((s) => s.status === "archived").length,
        },
        nextCursor: !cursor && filtered.length > 50 ? "segment-page-2" : null,
        serverTime: "2026-10-04T10:00:00Z",
      });
    }
    const segmentFilter = url.searchParams.get("segmentId");
    const filtered = ctx.groups.filter(
      (g) =>
        (!search || g.name.toLowerCase().includes(search.toLowerCase())) &&
        (!segmentFilter || g.segmentId === segmentFilter),
    );
    return json(route, {
      ...scope,
      company,
      fields,
      groups: filtered.filter((g) => status === "all" || g.status === status),
      counts: {
        total: filtered.length,
        active: filtered.filter((g) => g.status === "active").length,
        archived: filtered.filter((g) => g.status === "archived").length,
        needsReview: filtered.filter((g) => g.needsReview).length,
      },
      nextCursor: null,
      serverTime: "2026-10-04T10:00:00Z",
    });
  });
  await page.goto("/smart-groups-test-fixture");
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toBeEnabled();
  return ctx;
}
async function addGroup(page: Page) {
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add group", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Select segment Operations", exact: true })
    .click();
  await dialog
    .getByLabel("Group name", { exact: true })
    .fill("New supervision group");
  await dialog.getByLabel("Rule 1 value 1", { exact: true }).fill("Supervisor");
  return dialog;
}
async function cleared(page: Page) {
  await expect(
    page.getByRole("region", { name: "Smart Groups recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Site supervisors", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Group members", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Matching preview", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
async function synthetic(page: Page, name: string) {
  await page.evaluate((name) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === name,
    );
    button?.click();
  }, name);
}

test("desktop catalog, honest exact counts and current shell navigation", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "Smart Groups", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sg-status-counts")).toContainText("1005 groups");
  await expect(page.locator(".sg-group-table")).toContainText("1005");
  await expect(
    page.getByText(/Group membership does not grant account access/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Smart groups", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/ct-alt-smart-groups-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("preview exact literal alternatives AND, case sensitivity, zero valid and rule edit invalidation", async ({
  page,
}) => {
  const ctx = await setup(page);
  const d = await addGroup(page);
  await d
    .getByRole("button", { name: "Add value to rule 1", exact: true })
    .click();
  await d.getByLabel("Rule 1 value 2", { exact: true }).fill(" Coordinator ");
  await d.getByRole("button", { name: "Add rule", exact: true }).click();
  await d.getByLabel("Rule 2 field", { exact: true }).selectOption("team");
  await d
    .getByLabel("Rule 2 value 1", { exact: true })
    .fill("Field operations");
  await d.getByRole("button", { name: "Preview matches", exact: true }).click();
  await expect(
    d.getByRole("region", { name: "Matching preview" }),
  ).toContainText("1005");
  const payload = ctx.requests
    .find((r) => r.url().endsWith("/preview"))!
    .postDataJSON();
  expect(payload.rules).toEqual([
    { field: "title", values: ["Supervisor", " Coordinator "] },
    { field: "team", values: ["Field operations"] },
  ]);
  await d.getByLabel("Rule 1 value 1", { exact: true }).fill("supervisor");
  await expect(d.getByRole("region", { name: "Matching preview" })).toHaveCount(
    0,
  );
  await d.getByRole("button", { name: "Preview matches", exact: true }).click();
  await expect(
    d.getByText(
      "No active records match these rules. A zero-member group is valid.",
    ),
  ).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Save group", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "/tmp/ct-alt-smart-groups-preview.png",
    fullPage: true,
  });
});
test("preview member paging >1000 and literal name search uses raw scoped DTO", async ({
  page,
}) => {
  const ctx = await setup(page);
  const d = await addGroup(page);
  await d.getByRole("button", { name: "Preview matches", exact: true }).click();
  const region = d.getByRole("region", { name: "Matching preview" });
  await expect(region.locator("tbody tr")).toHaveCount(50);
  await region
    .getByRole("button", { name: "Load more preview members" })
    .click();
  await expect(region.locator("tbody tr")).toHaveCount(100);
  await region.getByLabel("Search preview members").fill("0999");
  await region
    .getByRole("button", { name: "Search preview", exact: true })
    .click();
  await expect(region.locator("tbody tr")).toHaveCount(1);
  await expect(region).toContainText("1005");
  expect(
    ctx.requests
      .filter((r) => r.url().endsWith("/preview"))
      .map((r) => r.postDataJSON()),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tenantId: company.id,
        search: "0999",
        limit: 50,
      }),
    ]),
  );
  expect(ctx.writes).toHaveLength(0);
});
test("saved group names, searched members and opaque version paging stay distinct from eligibility", async ({
  page,
}) => {
  const ctx = await setup(page);
  await page
    .getByRole("button", { name: "View members Site supervisors", exact: true })
    .click();
  const region = page.getByRole("region", {
    name: "Group members",
    exact: true,
  });
  await expect(region).toContainText("Segment: Operations");
  await expect(region).toContainText("1000");
  await expect(region.locator("tbody tr")).toHaveCount(50);
  await region
    .getByRole("button", { name: "Load more members", exact: true })
    .click();
  await expect(region.locator("tbody tr")).toHaveCount(100);
  await region.getByLabel("Search group members").fill("0999");
  await region
    .getByRole("button", { name: "Search members", exact: true })
    .click();
  await expect(region.locator("tbody tr")).toHaveCount(1);
  await expect(region).toContainText("1005");
  expect(ctx.writes).toHaveLength(0);
});
test("create and edit/move group preserves exact definitions and fresh off-page parent identity", async ({
  page,
}) => {
  const other = {
    ...segment,
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    name: "Regional",
    activeGroupCount: 0,
    canArchive: true,
  };
  const ctx = await setup(page, { segments: [segment, other] });
  const d = await addGroup(page);
  await d.getByRole("button", { name: "Save group", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  expect(ctx.writes[0].change).toEqual({
    action: "create_group",
    name: "New supervision group",
    description: "",
    segmentId,
    rules: [{ field: "title", values: ["Supervisor"] }],
  });
  await page
    .getByRole("button", {
      name: "Edit group New supervision group",
      exact: true,
    })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edit Smart Group",
    exact: true,
  });
  await expect(edit).toContainText("Selected segment: Operations");
  await edit
    .getByRole("button", { name: "Select segment Regional", exact: true })
    .click();
  await edit
    .getByLabel("Group description")
    .fill("Moved to regional management");
  await edit.getByRole("button", { name: "Save group", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  expect(ctx.writes[1].change).toMatchObject({
    action: "edit_group",
    groupId: newId,
    segmentId: other.id,
    revision: 1,
    description: "Moved to regional management",
  });
});
test("segment add/edit plus nonempty archive block and explicit archive/restore retention", async ({
  page,
}) => {
  const ctx = await setup(page);
  await page.getByRole("button", { name: "Segments", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Archive segment Operations",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Add segment", exact: true }).click();
  let d = page.getByRole("dialog", { name: "Add segment", exact: true });
  await d.getByLabel("Segment name").fill("Specialists");
  await d.getByRole("button", { name: "Save segment", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  await page
    .getByRole("button", { name: "Edit segment Specialists", exact: true })
    .click();
  d = page.getByRole("dialog", { name: "Edit segment", exact: true });
  await d
    .getByLabel("Segment description")
    .fill("A retained organizational container");
  await d.getByRole("button", { name: "Save segment", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  await page
    .getByRole("button", { name: "Archive segment Specialists", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive segment", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Restore segment Specialists",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Restore segment Specialists", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore segment", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Archive segment Specialists",
      exact: true,
    }),
  ).toBeEnabled();
  expect(ctx.writes.map((w) => w.change.action)).toEqual([
    "create_segment",
    "edit_segment",
    "archive_segment",
    "restore_segment",
  ]);
});
test("group archive/restore reads all lifecycle states after acknowledgement", async ({
  page,
}) => {
  const ctx = await setup(page);
  await page
    .getByRole("button", {
      name: "Archive group Site supervisors",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive group", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Restore group Site supervisors",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: "Restore group Site supervisors",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore group", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Archive group Site supervisors",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    ctx.requests
      .filter((r) => r.method() === "GET")
      .every((r) => new URL(r.url()).searchParams.get("status") === "all"),
  ).toBe(true);
});
test("bounded searched segment picker preserves selected ID across pages and filtered empty", async ({
  page,
}) => {
  const segments = Array.from({ length: 1005 }, (_, i) => ({
    ...segment,
    id: `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, "0")}`,
    name: `Segment ${String(i + 1).padStart(4, "0")}`,
  }));
  const ctx = await setup(page, { segments });
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Add group", exact: true });
  await expect(d.locator(".sg-segment-picker button")).toHaveCount(50);
  await d.getByRole("button", { name: "Load more available segments" }).click();
  await expect(d.locator(".sg-segment-picker button")).toHaveCount(100);
  await d
    .getByRole("button", { name: "Select segment Segment 0099", exact: true })
    .click();
  await d.getByLabel("Search segments", { exact: true }).fill("absent");
  await d.getByRole("button", { name: "Find segments", exact: true }).click();
  await expect(d).toContainText("Selected segment: Segment 0099");
  await expect(d).toContainText("No active segments match this search.");
  await d.getByLabel("Group name").fill("Selected off-page");
  await d.getByLabel("Rule 1 value 1", { exact: true }).fill("Supervisor");
  await d.getByRole("button", { name: "Save group", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  expect(ctx.writes[0].change).toMatchObject({ segmentId: segments[98].id });
});
test("missing custom field retains null counts, blocks preview until repair and never drops rule", async ({
  page,
}) => {
  const invalid = {
    ...group,
    rules: [{ field: "custom:removed" as const, values: ["North"] }],
    needsReview: true,
    invalidFields: ["custom:removed"],
    counts: null,
    canRestore: false,
  };
  const ctx = await setup(page, { groups: [invalid] });
  await page.getByRole("button", { name: "Refresh Smart Groups" }).click();
  await expect(
    page.getByText("Needs review · counts unavailable"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Repair rules Site supervisors", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "Edit Smart Group" });
  await expect(d.getByLabel("Rule 1 field", { exact: true })).toHaveValue(
    "custom:removed",
  );
  await expect(
    d.getByRole("button", { name: "Preview matches" }),
  ).toBeDisabled();
  await expect(d.getByRole("button", { name: "Save group" })).toBeDisabled();
  await d
    .getByLabel("Rule 1 field", { exact: true })
    .selectOption("custom:location");
  await d.getByRole("button", { name: "Preview matches" }).click();
  await expect(
    d.getByRole("region", { name: "Matching preview" }),
  ).toContainText("1005");
  await d.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  expect(ctx.writes[0].change).toMatchObject({
    rules: [{ field: "custom:location", values: ["North"] }],
  });
});
test("duplicate/blank values and ten-rule/25-value/40KiB bounds are genuine disabled guards", async ({
  page,
}) => {
  const ctx = await setup(page);
  const d = await addGroup(page);
  await d
    .getByRole("button", { name: "Add value to rule 1", exact: true })
    .click();
  await d.getByLabel("Rule 1 value 2", { exact: true }).fill("Supervisor");
  await expect(d.getByRole("button", { name: "Save group" })).toBeDisabled();
  await d.getByLabel("Rule 1 value 2", { exact: true }).fill("  ");
  await expect(
    d.getByRole("button", { name: "Preview matches" }),
  ).toBeDisabled();
  for (let i = 2; i <= 25; i++) {
    if (i > 2)
      await d
        .getByRole("button", { name: "Add value to rule 1", exact: true })
        .click();
    await d
      .getByLabel(`Rule 1 value ${i}`, { exact: true })
      .fill(`${i}` + "😀".repeat(248));
  }
  await expect(
    d.getByRole("button", { name: "Add value to rule 1", exact: true }),
  ).toBeDisabled();
  for (let i = 2; i <= 10; i++) {
    await d.getByRole("button", { name: "Add rule", exact: true }).click();
    await d
      .getByLabel(`Rule ${i} value 1`, { exact: true })
      .fill("😀".repeat(250));
  }
  await expect(
    d.getByRole("button", { name: "Add rule", exact: true }),
  ).toBeDisabled();
  for (let i = 2; i <= 10; i++) {
    await d
      .getByRole("button", { name: "Add value to rule 2", exact: true })
      .click();
    await d
      .getByLabel(`Rule 2 value ${i}`, { exact: true })
      .fill(`${i}` + "😀".repeat(248));
  }
  await expect(d.getByRole("button", { name: "Save group" })).toBeDisabled();
  expect(ctx.writes).toHaveLength(0);
});
for (const leaf of [
  "catalog",
  "segments",
  "members",
  "picker",
  "preview",
] as const) {
  test(`current ${leaf} denial clears every private control and keeps recovery locked on 503`, async ({
    page,
  }) => {
    let deny = false;
    const ctx = await setup(page, {
      override: async (route, url) => {
        const hit =
          leaf === "catalog"
            ? url.pathname === "/api/smart-groups" &&
              route.request().method() === "GET"
            : leaf === "segments" || leaf === "picker"
              ? url.pathname.endsWith("/segments")
              : leaf === "members"
                ? url.pathname.endsWith("/members")
                : url.pathname.endsWith("/preview");
        if (deny && hit) {
          await json(route, { error: "Current owner access revoked" }, 403);
          return true;
        }
        return false;
      },
    });
    if (leaf === "catalog") {
      deny = true;
      await page.getByRole("button", { name: "Refresh Smart Groups" }).click();
    }
    if (leaf === "segments") {
      deny = true;
      await page.getByRole("button", { name: "Segments", exact: true }).click();
    }
    if (leaf === "members") {
      deny = true;
      await page
        .getByRole("button", {
          name: "View members Site supervisors",
          exact: true,
        })
        .click();
    }
    if (leaf === "picker") {
      const d = await addGroup(page);
      deny = true;
      await d
        .getByRole("button", { name: "Find segments", exact: true })
        .click();
    }
    if (leaf === "preview") {
      const d = await addGroup(page);
      deny = true;
      await d
        .getByRole("button", { name: "Preview matches", exact: true })
        .click();
    }
    await cleared(page);
    ctx.override = async (route) => {
      await json(route, { error: "Unavailable" }, 503);
      return true;
    };
    await page.getByRole("button", { name: "Refresh to recover" }).click();
    await cleared(page);
    ctx.override = undefined;
    await page.getByRole("button", { name: "Refresh to recover" }).click();
    await expect(
      page.getByRole("button", { name: "Add group", exact: true }),
    ).toBeEnabled();
  });
}
for (const invalid of [
  "actor",
  "tenant",
  "role",
  "negative",
  "missing",
  "rules",
] as const) {
  test(`malformed preview ${invalid} cannot appear as success or empty`, async ({
    page,
  }) => {
    await setup(page, {
      override: async (route, url) => {
        if (!url.pathname.endsWith("/preview")) return false;
        const body = {
          ...identity(),
          fields,
          rules: route.request().postDataJSON().rules,
          members: [member(1)],
          counts,
          matchedCount: 1005,
          nextCursor: null,
          serverTime: "2026-10-04T10:00:00Z",
        } as Record<string, unknown>;
        if (invalid === "actor") body.actorId = "foreign";
        if (invalid === "tenant") body.tenantId = "foreign";
        if (invalid === "role") body.role = "employee";
        if (invalid === "negative") body.counts = { ...counts, eligible: -1 };
        if (invalid === "missing") delete body.datasetVersion;
        if (invalid === "rules")
          body.rules = [{ field: "title", values: ["other"] }];
        await json(route, body);
        return true;
      },
    });
    const d = await addGroup(page);
    await d.getByRole("button", { name: "Preview matches" }).click();
    await cleared(page);
  });
}
test("current catalog 401 and malformed member population clear saved data", async ({
  page,
}) => {
  const ctx = await setup(page);
  ctx.override = async (route, url) => {
    if (url.pathname.endsWith("/members")) {
      await json(route, {
        ...identity(),
        group,
        segment,
        fields,
        members: [member(1)],
        counts: { ...counts, records: 1 },
        matchedCount: 1005,
        nextCursor: null,
      });
      return true;
    }
    return false;
  };
  await page
    .getByRole("button", { name: "View members Site supervisors", exact: true })
    .click();
  await cleared(page);
  ctx.override = async (route) => {
    await json(route, { error: "Sign in" }, 401);
    return true;
  };
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await cleared(page);
});
for (const target of ["members", "preview", "picker", "catalog"] as const) {
  test(`${target} changed population version cannot append stale page`, async ({
    page,
  }) => {
    const ctx = await setup(page, {
      segments: Array.from({ length: 51 }, (_, i) => ({
        ...segment,
        id: `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, "0")}`,
        name: `Segment ${i + 1}`,
      })),
    });
    const intercept = async (route: Route, url: URL) => {
      const isPreview =
        target === "preview" &&
        url.pathname.endsWith("/preview") &&
        !!route.request().postDataJSON().cursor;
      const isGet = target !== "preview" && !!url.searchParams.get("cursor");
      if (!isPreview && !isGet) return false;
      if (target === "catalog") {
        await json(route, {
          ...initialData(),
          datasetVersion: "changed-version",
        });
      } else if (target === "picker") {
        await json(route, {
          ...identity(),
          datasetVersion: "changed-version",
          segments: [],
          counts: { total: 51, active: 51, archived: 0 },
          nextCursor: null,
        });
      } else if (target === "members") {
        await json(route, {
          ...identity(),
          datasetVersion: "changed-version",
          group,
          segment,
          fields,
          members: [member(51)],
          counts,
          matchedCount: 1005,
          nextCursor: null,
        });
      } else {
        await json(route, {
          ...identity(),
          datasetVersion: "changed-version",
          fields,
          rules: route.request().postDataJSON().rules,
          members: [member(51)],
          counts,
          matchedCount: 1005,
          nextCursor: null,
        });
      }
      return true;
    };
    if (target === "catalog") {
      ctx.override = intercept;
      await page.getByRole("button", { name: "Load more groups" }).click();
    } else if (target === "members") {
      await page
        .getByRole("button", {
          name: "View members Site supervisors",
          exact: true,
        })
        .click();
      ctx.override = intercept;
      await page
        .getByRole("button", { name: "Load more members", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Add group", exact: true })
        .click();
      const d = page.getByRole("dialog", { name: "Add group", exact: true });
      if (target === "picker") {
        ctx.override = intercept;
        await d
          .getByRole("button", { name: "Load more available segments" })
          .click();
      } else {
        await d
          .getByLabel("Rule 1 value 1", { exact: true })
          .fill("Supervisor");
        await d.getByRole("button", { name: "Preview matches" }).click();
        ctx.override = intercept;
        await d
          .getByRole("button", { name: "Load more preview members" })
          .click();
      }
    }
    await cleared(page);
  });
}
test("changed rules abort delayed preview, close editor and refresh abort delayed leaf", async ({
  page,
}) => {
  const hold = gate();
  let started = false;
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (url.pathname.endsWith("/preview")) {
        started = true;
        await hold.wait;
        await json(route, {
          ...identity(),
          fields,
          rules: route.request().postDataJSON().rules,
          members: [member(1)],
          counts,
          matchedCount: 1005,
          nextCursor: null,
        });
        return true;
      }
      return false;
    },
  });
  const d = await addGroup(page);
  await d.getByRole("button", { name: "Preview matches" }).click();
  await expect.poll(() => started).toBe(true);
  await d.getByLabel("Rule 1 value 1", { exact: true }).fill("other");
  hold.release();
  await expect(d.getByRole("region", { name: "Matching preview" })).toHaveCount(
    0,
  );
  ctx.override = undefined;
  await d.getByRole("button", { name: "Close group editor" }).click();
  await page.getByRole("button", { name: "Refresh Smart Groups" }).click();
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toBeEnabled();
});
for (const replacement of ["actor", "company", "role", "departure"] as const) {
  test(`delayed scoped preview cannot repopulate after ${replacement} replacement`, async ({
    page,
  }) => {
    const hold = gate();
    let started = false;
    await setup(page, {
      override: async (route, url) => {
        if (url.pathname.endsWith("/preview")) {
          started = true;
          await hold.wait;
          await json(route, {
            ...identity(),
            fields,
            rules: route.request().postDataJSON().rules,
            members: [member(1)],
            counts,
            matchedCount: 1005,
            nextCursor: null,
          });
          return true;
        }
        return false;
      },
    });
    const d = await addGroup(page);
    await d.getByRole("button", { name: "Preview matches" }).click();
    await expect.poll(() => started).toBe(true);
    await synthetic(
      page,
      replacement === "departure"
        ? "Toggle synthetic departure"
        : `Switch synthetic ${replacement}`,
    );
    hold.release();
    await expect(
      page.getByRole("region", { name: "Matching preview" }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (replacement === "role")
      await expect(
        page.getByRole("button", { name: "Add group", exact: true }),
      ).toHaveCount(0);
  });
}
test("held POST synchronously guards forced refresh, all leaf reads and duplicate changes", async ({
  page,
}) => {
  const hold = gate();
  let started = false;
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (
        url.pathname === "/api/smart-groups" &&
        route.request().method() === "POST"
      ) {
        started = true;
        await hold.wait;
        const m = route.request().postDataJSON();
        await json(route, {
          saved: {
            operationId: m.operationId,
            action: m.change.action,
            segmentId: newId,
            revision: 1,
          },
        });
        return true;
      }
      return false;
    },
  });
  await page.getByRole("button", { name: "Add segment", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Add segment", exact: true });
  await d.getByLabel("Segment name").fill("Held segment");
  await d.getByRole("button", { name: "Save segment" }).click();
  await expect.poll(() => started).toBe(true);
  await expect(
    page.getByRole("button", { name: "Refresh Smart Groups" }),
  ).toBeDisabled();
  const before = ctx.requests.length;
  await page.evaluate(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "button",
    )) {
      if (
        [
          "Refresh Smart Groups",
          "Groups",
          "Segments",
          "Find segments",
          "Preview matches",
          "Search catalog",
          "Save group",
          "Save segment",
        ].includes(button.textContent?.trim() || "")
      ) {
        button.disabled = false;
        button.click();
      }
    }
  });
  expect(ctx.requests).toHaveLength(before);
  hold.release();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
});
test("acknowledged save then lost acknowledgement stays locked, failed recovery and exact UUID payload retry", async ({
  page,
}) => {
  let lose = false,
    failRead = false;
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (
        lose &&
        route.request().method() === "POST" &&
        url.pathname === "/api/smart-groups"
      ) {
        ctx.writes.push(route.request().postDataJSON());
        await route.abort();
        return true;
      }
      if (failRead && route.request().method() === "GET") {
        await json(route, { error: "Read unavailable" }, 503);
        return true;
      }
      return false;
    },
  });
  await page.getByRole("button", { name: "Add segment", exact: true }).click();
  let d = page.getByRole("dialog", { name: "Add segment", exact: true });
  await d.getByLabel("Segment name").fill("Acknowledged segment");
  await d.getByRole("button", { name: "Save segment" }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  lose = true;
  await page.getByRole("button", { name: "Add segment", exact: true }).click();
  d = page.getByRole("dialog", { name: "Add segment", exact: true });
  await d.getByLabel("Segment name").fill("Lost acknowledgement segment");
  await d.getByRole("button", { name: "Save segment" }).click();
  await cleared(page);
  const lost = ctx.writes[1];
  const marker = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    `ct-alt:smart-groups:${actor}:${company.id}`,
  );
  expect(JSON.parse(marker!)).toEqual({
    operationId: lost.operationId,
    action: "create_segment",
  });
  expect(marker).not.toContain("Lost acknowledgement segment");
  failRead = true;
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await cleared(page);
  lose = false;
  failRead = false;
  await page.getByRole("button", { name: "Retry last action" }).click();
  await expect(page.getByRole("status")).toContainText("Smart Groups updated.");
  expect(ctx.writes[2]).toEqual(lost);
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `ct-alt:smart-groups:${actor}:${company.id}`,
    ),
  ).toBeNull();
});
test("lost group save departure leaves field-free marker and all-status owner recovery without field replay", async ({
  page,
}) => {
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (
        url.pathname === "/api/smart-groups" &&
        route.request().method() === "POST"
      ) {
        ctx.writes.push(route.request().postDataJSON());
        await route.abort();
        return true;
      }
      return false;
    },
  });
  const d = await addGroup(page);
  await d.getByRole("button", { name: "Save group" }).click();
  await cleared(page);
  await synthetic(page, "Toggle synthetic departure");
  await synthetic(page, "Toggle synthetic departure");
  await cleared(page);
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toHaveCount(0);
  ctx.override = undefined;
  const before = ctx.requests.length;
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toBeEnabled();
  const reads = ctx.requests.slice(before);
  expect(reads).toHaveLength(2);
  expect(
    reads.every(
      (r) =>
        r.method() === "GET" &&
        new URL(r.url()).searchParams.get("status") === "all",
    ),
  ).toBe(true);
  expect(ctx.writes).toHaveLength(1);
});
test("decoded acknowledgement body after departure never starts follow-up reads or clears marker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (
        String(args[0]) === "/api/smart-groups" &&
        (args[1] as RequestInit)?.method === "POST"
      ) {
        const decode = response.json.bind(response);
        response.json = async () => {
          const data = await decode();
          (window as unknown as Record<string, unknown>).ackBodyWaiting = true;
          await new Promise<void>((resolve) => {
            (window as unknown as Record<string, unknown>).releaseAck = resolve;
          });
          return data;
        };
      }
      return response;
    };
  });
  const ctx = await setup(page);
  await page.getByRole("button", { name: "Add segment", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Add segment", exact: true });
  await d.getByLabel("Segment name").fill("Saved while leaving");
  await d.getByRole("button", { name: "Save segment" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => !!(window as unknown as Record<string, unknown>).ackBodyWaiting,
      ),
    )
    .toBe(true);
  await synthetic(page, "Toggle synthetic departure");
  await expect(
    page.getByRole("heading", { name: "Smart Groups", exact: true }),
  ).toHaveCount(0);
  const before = ctx.requests.length;
  await page.evaluate(() =>
    (window as unknown as Record<string, () => void>).releaseAck(),
  );
  await page.getByText("Synthetic departure", { exact: true }).waitFor();
  expect(ctx.requests).toHaveLength(before);
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `ct-alt:smart-groups:${actor}:${company.id}`,
    ),
  ).not.toBeNull();
  await synthetic(page, "Toggle synthetic departure");
  await cleared(page);
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toHaveCount(0);
});
test("manual refresh and member close abort delayed current leaf without a false empty", async ({
  page,
}) => {
  const hold = gate();
  let started = false;
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (url.pathname.endsWith("/members")) {
        started = true;
        await hold.wait;
        await json(route, {
          ...identity(),
          group,
          segment,
          fields,
          members: [member(1)],
          counts,
          matchedCount: 1005,
          nextCursor: null,
        });
        return true;
      }
      return false;
    },
  });
  await page
    .getByRole("button", { name: "View members Site supervisors", exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Refresh Smart Groups" }).click();
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toBeEnabled();
  hold.release();
  await expect(
    page.getByRole("region", { name: "Group members", exact: true }),
  ).toHaveCount(0);
  expect(ctx.writes).toHaveLength(0);
});
test("close members during held page cancels leaf and restores current catalog controls", async ({
  page,
}) => {
  const hold = gate();
  let started = false;
  await setup(page, {
    override: async (route, url) => {
      if (url.pathname.endsWith("/members") && url.searchParams.get("cursor")) {
        started = true;
        await hold.wait;
        await json(route, {
          ...identity(),
          group,
          segment,
          fields,
          members: [member(51)],
          counts,
          matchedCount: 1005,
          nextCursor: null,
        });
        return true;
      }
      return false;
    },
  });
  await page
    .getByRole("button", { name: "View members Site supervisors", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load more members", exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  await page
    .getByRole("button", { name: "Close group members", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toBeEnabled();
  hold.release();
  await expect(
    page.getByRole("region", { name: "Group members", exact: true }),
  ).toHaveCount(0);
});
test("recovery rejects differing field/population versions across both all-status snapshots", async ({
  page,
}) => {
  let lose = true;
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (
        lose &&
        url.pathname === "/api/smart-groups" &&
        route.request().method() === "POST"
      ) {
        await route.abort();
        return true;
      }
      if (!lose && url.pathname.endsWith("/segments")) {
        await json(route, {
          ...identity(),
          datasetVersion: "different-version",
          segments: [segment],
          counts: { total: 1, active: 1, archived: 0 },
          nextCursor: null,
        });
        return true;
      }
      return false;
    },
  });
  await page.getByRole("button", { name: "Add segment", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Add segment", exact: true });
  await d.getByLabel("Segment name").fill("Unknown segment");
  await d.getByRole("button", { name: "Save segment" }).click();
  await cleared(page);
  lose = false;
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await cleared(page);
  ctx.override = undefined;
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await expect(
    page.getByRole("button", { name: "Add segment", exact: true }),
  ).toBeEnabled();
});
test("current fresh group canEdit denial prevents stale catalog edit controls opening", async ({
  page,
}) => {
  await setup(page, { groups: [{ ...group, canEdit: false }] });
  await page
    .getByRole("button", { name: "Edit group Site supervisors", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Group members", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".sg-error[role=alert]")).toContainText(
    "cannot currently be edited",
  );
});
for (const bad of ["operation", "action", "revision", "target"] as const) {
  test(`malformed mutation acknowledgement ${bad} locks instead of reporting saved`, async ({
    page,
  }) => {
    await setup(page, {
      override: async (route, url) => {
        if (
          url.pathname === "/api/smart-groups" &&
          route.request().method() === "POST"
        ) {
          const value = route.request().postDataJSON() as SmartGroupMutation;
          const saved = {
            operationId: value.operationId,
            action: value.change.action,
            segmentId,
            groupId,
            revision: 2,
          };
          if (bad === "operation") saved.operationId = "wrong";
          if (bad === "action") saved.action = "edit_group";
          if (bad === "revision") saved.revision = 9;
          if (bad === "target") saved.groupId = "wrong";
          await json(route, { saved });
          return true;
        }
        return false;
      },
    });
    await page
      .getByRole("button", {
        name: "Archive group Site supervisors",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive group", exact: true })
      .click();
    await cleared(page);
    await expect(
      page.getByText("Smart Groups updated.", { exact: true }),
    ).toHaveCount(0);
  });
}
test("decoded preview body is fenced after rules change", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]) === "/api/smart-groups/preview") {
        const decode = response.json.bind(response);
        response.json = async () => {
          const data = await decode();
          (window as unknown as Record<string, unknown>).previewBodyWaiting =
            true;
          await new Promise<void>((resolve) => {
            (window as unknown as Record<string, unknown>).releasePreview =
              resolve;
          });
          return data;
        };
      }
      return response;
    };
  });
  await setup(page);
  const d = await addGroup(page);
  await d.getByRole("button", { name: "Preview matches" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as Record<string, unknown>).previewBodyWaiting,
      ),
    )
    .toBe(true);
  await d.getByLabel("Rule 1 value 1", { exact: true }).fill("replacement");
  await page.evaluate(() =>
    (window as unknown as Record<string, () => void>).releasePreview(),
  );
  await expect(d.getByRole("region", { name: "Matching preview" })).toHaveCount(
    0,
  );
  await expect(d.getByLabel("Rule 1 value 1", { exact: true })).toHaveValue(
    "replacement",
  );
});
test("later catalog search wins over held earlier scoped query", async ({
  page,
}) => {
  const hold = gate();
  let started = false;
  const ctx = await setup(page, {
    override: async (route, url) => {
      if (
        url.pathname === "/api/smart-groups" &&
        url.searchParams.get("search") === "old-query"
      ) {
        started = true;
        await hold.wait;
        await json(route, initialData());
        return true;
      }
      return false;
    },
  });
  await page.getByLabel("Search groups", { exact: true }).fill("old-query");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByLabel("Search groups", { exact: true }).fill("Office");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(page.locator(".sg-group-table tbody tr")).toHaveCount(1);
  hold.release();
  await expect(page.locator(".sg-group-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".sg-group-table")).toContainText(
    "Office coordinators",
  );
  expect(ctx.writes).toHaveLength(0);
});
test("malformed catalog cannot report positive matches for an unavailable field", async ({
  page,
}) => {
  await setup(page, {
    groups: [
      { ...group, rules: [{ field: "custom:missing", values: ["North"] }] },
    ],
  });
  await page.getByRole("button", { name: "Refresh Smart Groups" }).click();
  await cleared(page);
});
test("malformed preview cannot report matches when echoed field disappeared", async ({
  page,
}) => {
  await setup(page, {
    override: async (route, url) => {
      if (!url.pathname.endsWith("/preview")) return false;
      await json(route, {
        ...identity(),
        fields: fields.slice(0, 2),
        rules: route.request().postDataJSON().rules,
        members: [member(1)],
        counts,
        matchedCount: 1005,
        nextCursor: null,
      });
      return true;
    },
  });
  const d = await addGroup(page);
  await d
    .getByLabel("Rule 1 field", { exact: true })
    .selectOption("custom:location");
  await d.getByLabel("Rule 1 value 1", { exact: true }).fill("North");
  await d.getByRole("button", { name: "Preview matches" }).click();
  await cleared(page);
});
