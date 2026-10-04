import { test, expect, type Page } from "@playwright/test";
import type { Member } from "../../lib/agent-types";
import type {
  UpdateComment,
  UpdatePost,
  UpdateDetailsData,
  UpdatesData,
  UpdatesChange,
  UpdatesSaved,
  UpdateRecipientsData,
} from "../../lib/updates-types";
import { company, actor, employee, users, post } from "./fixture-data";
type Operation = {
  tenantId: string;
  operationId: string;
  change: UpdatesChange;
};
async function harness(page: Page) {
  const state = {
    role: "owner" as Member["role"],
    actor,
    tenant: company,
    posts: [post(), post(2), post(3, "draft")],
    audiences: new Map<string, string[]>(),
    comments: [] as UpdateComment[],
    views: new Map<string, Set<string>>(),
    confirmations: new Map<string, Set<string>>(),
    likes: new Map<string, Set<string>>(),
    mutations: [] as Operation[],
    gets: [] as URL[],
    receipts: new Map<string, { payload: Operation; saved: UpdatesSaved }>(),
    mode: "normal",
    holdPost: null as (() => void) | null,
    serial: 50,
    errors: [] as string[],
    mismatch: "" as "" | "actor" | "tenant" | "role",
  };
  function identity() {
    return {
      tenantId:
        state.mismatch === "tenant"
          ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          : state.tenant.id,
      actorId: state.mismatch === "actor" ? employee : state.actor,
      role: state.mismatch === "role" ? ("employee" as const) : state.role,
    };
  }
  const manage = () => state.role === "owner" || state.role === "admin";
  const audience = (id: string) => state.audiences.get(id) || [actor, employee];
  const members = (map: Map<string, Set<string>>, id: string) =>
    map.get(id) || new Set<string>();
  function expose(row: UpdatePost): UpdatePost {
    const recipient = audience(row.id).includes(state.actor);
    return {
      ...row,
      recipientCount: audience(row.id).length,
      viewedCount: members(state.views, row.id).size,
      confirmedCount: members(state.confirmations, row.id).size,
      likeCount: members(state.likes, row.id).size,
      commentCount: state.comments.filter(
        (comment) => comment.post_id === row.id && comment.status === "active",
      ).length,
      liked: members(state.likes, row.id).has(state.actor),
      viewedAt: members(state.views, row.id).has(state.actor)
        ? "2026-10-03T13:01:00Z"
        : null,
      confirmedAt: members(state.confirmations, row.id).has(state.actor)
        ? "2026-10-03T13:02:00Z"
        : null,
      isRecipient: recipient,
      canEngage: recipient && row.status === "published",
      canEdit: manage() && row.status === "draft",
      canPublish: manage() && row.status === "draft",
      canArchive: manage() && row.status === "published",
      canRestore: manage() && row.status === "archived",
    };
  }
  function list(url: URL): UpdatesData {
    const query = url.searchParams;
    const feed = query.get("view") !== "manage";
    const search = (query.get("search") || "").toLocaleLowerCase();
    const scoped = state.posts.filter(
      (row) =>
        row.tenant_id === state.tenant.id &&
        row.title.toLocaleLowerCase().includes(search) &&
        (!feed ||
          (row.status === "published" &&
            audience(row.id).includes(state.actor))),
    );
    const status = query.get("status") || "all";
    const filtered = scoped.filter(
      (row) => status === "all" || row.status === status,
    );
    const offset = Number(
      (query.get("cursor") || "0").replace("opaque-list-", ""),
    );
    return {
      company: state.tenant,
      actorId: state.actor,
      role: state.role,
      capabilities: { canManage: manage() },
      posts: filtered.slice(offset, offset + 50).map(expose),
      counts: {
        total: scoped.length,
        draft: scoped.filter((row) => row.status === "draft").length,
        published: scoped.filter((row) => row.status === "published").length,
        archived: scoped.filter((row) => row.status === "archived").length,
      },
      nextCursor:
        filtered.length > offset + 50 ? `opaque-list-${offset + 50}` : null,
      serverTime: "2026-10-03T13:00:00Z",
    };
  }
  function details(row: UpdatePost, url: URL): UpdateDetailsData {
    const offset = Number(
      (url.searchParams.get("cursor") || "0").replace("opaque-comments-", ""),
    );
    const recipient = audience(row.id).includes(state.actor);
    const comments = recipient
      ? state.comments.filter((comment) => comment.post_id === row.id)
      : [];
    return {
      ...identity(),
      post: expose(row),
      recipients: manage()
        ? audience(row.id).map((id) => users.find((user) => user.id === id)!)
        : [],
      comments: comments.slice(offset, offset + 50).map((comment) => ({
        ...comment,
        body: comment.status === "removed" ? "" : comment.body,
        canEdit:
          row.status === "published" &&
          row.allowComments &&
          recipient &&
          comment.actorId === state.actor &&
          comment.status === "active",
        canRemove:
          row.status === "published" &&
          row.allowComments &&
          recipient &&
          (comment.actorId === state.actor || manage()) &&
          comment.status === "active",
      })),
      nextCommentsCursor:
        comments.length > offset + 50 ? `opaque-comments-${offset + 50}` : null,
      serverTime: "2026-10-03T13:00:00Z",
    };
  }
  function statuses(row: UpdatePost, url: URL): UpdateRecipientsData {
    const scoped = audience(row.id).map((id) => ({
      actorId: id,
      name: users.find((user) => user.id === id)!.name,
      viewedAt: members(state.views, row.id).has(id)
        ? "2026-10-03T13:01:00Z"
        : null,
      confirmedAt: members(state.confirmations, row.id).has(id)
        ? "2026-10-03T13:02:00Z"
        : null,
    }));
    const status = url.searchParams.get("status") || "all";
    const filtered = scoped.filter(
      (user) =>
        status === "all" ||
        (status === "viewed"
          ? !!user.viewedAt
          : status === "unviewed"
            ? !user.viewedAt
            : status === "confirmed"
              ? !!user.confirmedAt
              : !user.confirmedAt),
    );
    const offset = Number(
      (url.searchParams.get("cursor") || "0").replace("opaque-statuses-", ""),
    );
    return {
      ...identity(),
      recipients: filtered.slice(offset, offset + 50),
      counts: {
        total: scoped.length,
        viewed: scoped.filter((user) => user.viewedAt).length,
        confirmed: scoped.filter((user) => user.confirmedAt).length,
        likes: members(state.likes, row.id).size,
        comments: state.comments.filter(
          (comment) =>
            comment.post_id === row.id && comment.status === "active",
        ).length,
      },
      nextCursor:
        filtered.length > offset + 50 ? `opaque-statuses-${offset + 50}` : null,
    };
  }
  const fail = (status: number, error: string): never => {
    throw { status, error };
  };
  function apply(value: Operation): UpdatesSaved {
    const change = value.change;
    const management = [
      "create",
      "edit",
      "publish",
      "archive",
      "restore",
    ].includes(change.action);
    if ((management && !manage()) || value.tenantId !== state.tenant.id)
      fail(403, "Current Updates access denied");
    let row =
      "postId" in change
        ? state.posts.find((item) => item.id === change.postId)
        : undefined;
    if (
      !management &&
      (!row ||
        row.status !== "published" ||
        !audience(row.id).includes(state.actor))
    )
      fail(403, "Current recipient access denied");
    const old = state.receipts.get(value.operationId);
    if (old) {
      if (JSON.stringify(old.payload) !== JSON.stringify(value))
        fail(409, "UUID payload conflict");
      return old.saved;
    }
    if (state.mode === "conflict")
      fail(409, "This update changed. Refresh its latest revision.");
    if (change.action === "create") {
      row = {
        ...post(state.serial++, "draft"),
        title: change.title,
        body: change.body,
        allowComments: change.allowComments,
        allowReactions: change.allowReactions,
        requireConfirmation: change.requireConfirmation,
      };
      state.posts.unshift(row);
      state.audiences.set(row.id, change.recipientIds);
    } else if (!row) fail(403, "Update missing");
    if (!row) throw new Error("Fixture missing post");
    if (change.action === "edit") {
      if (row.status !== "draft" || row.revision !== change.revision)
        fail(409, "Draft changed");
      Object.assign(row, {
        title: change.title,
        body: change.body,
        allowComments: change.allowComments,
        allowReactions: change.allowReactions,
        requireConfirmation: change.requireConfirmation,
        revision: row.revision + 1,
      });
      state.audiences.set(row.id, change.recipientIds);
    }
    if (
      change.action === "publish" ||
      change.action === "archive" ||
      change.action === "restore"
    ) {
      if (row.revision !== change.revision)
        fail(409, "Update revision changed");
      row.status = change.action === "archive" ? "archived" : "published";
      row.revision += 1;
      row.content_revision = 1;
      row.published_at ||= "2026-10-03T13:00:00Z";
    }
    const saved: UpdatesSaved = {
      operationId: value.operationId,
      action: change.action,
      postId: row.id,
      revision: row.revision,
      contentRevision: row.content_revision,
    };
    if (change.action === "view" || change.action === "confirm") {
      const viewed = members(state.views, row.id);
      viewed.add(state.actor);
      state.views.set(row.id, viewed);
    }
    if (change.action === "confirm") {
      const confirmed = members(state.confirmations, row.id);
      confirmed.add(state.actor);
      state.confirmations.set(row.id, confirmed);
    }
    if (change.action === "like" || change.action === "unlike") {
      if (!row.allowReactions) fail(403, "Likes disabled");
      const liked = members(state.likes, row.id);
      if (change.action === "like") liked.add(state.actor);
      else liked.delete(state.actor);
      state.likes.set(row.id, liked);
    }
    if (change.action === "comment") {
      if (!row.allowComments) fail(403, "Comments disabled");
      const comment: UpdateComment = {
        id: `99999999-9999-4999-8999-${String(state.serial++).padStart(12, "0")}`,
        post_id: row.id,
        actorId: state.actor,
        author_name: users.find((user) => user.id === state.actor)!.name,
        body: change.body,
        status: "active",
        revision: 1,
        created_at: "2026-10-03T13:05:00Z",
        updated_at: "2026-10-03T13:05:00Z",
        canEdit: true,
        canRemove: true,
      };
      state.comments.unshift(comment);
      saved.commentId = comment.id;
      saved.commentRevision = 1;
    }
    if (
      change.action === "edit_comment" ||
      change.action === "remove_comment"
    ) {
      const comment = state.comments.find(
        (item) => item.id === change.commentId,
      );
      if (!comment || comment.revision !== change.revision)
        return fail(409, "Comment revision changed");
      if (change.action === "edit_comment") comment.body = change.body;
      else {
        comment.status = "removed";
        comment.body = "";
      }
      comment.revision += 1;
      saved.commentId = comment.id;
      saved.commentRevision = comment.revision;
    }
    state.receipts.set(value.operationId, {
      payload: structuredClone(value),
      saved,
    });
    return saved;
  }
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.route("**/api/updates**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      state.gets.push(url);
      if (state.mode === "denied" || state.mode === "failed-read")
        return route.fulfill({
          status: state.mode === "denied" ? 403 : 503,
          json: { error: "Read unavailable" },
        });
      if (url.pathname === "/api/updates") {
        if (url.searchParams.get("view") === "manage" && !manage())
          return route.fulfill({
            status: 403,
            json: { error: "Management denied" },
          });
        return route.fulfill({ json: list(url) });
      }
      if (url.pathname === "/api/updates/roster") {
        if (!manage())
          return route.fulfill({
            status: 403,
            json: { error: "Roster denied" },
          });
        const filtered = users.filter((user) =>
          user.name
            .toLocaleLowerCase()
            .includes(
              (url.searchParams.get("search") || "").toLocaleLowerCase(),
            ),
        );
        const offset = Number(
          (url.searchParams.get("cursor") || "0").replace("opaque-users-", ""),
        );
        return route.fulfill({
          json: {
            ...identity(),
            users: filtered.slice(offset, offset + 100),
            nextCursor:
              filtered.length > offset + 100
                ? `opaque-users-${offset + 100}`
                : null,
          },
        });
      }
      const row = state.posts.find(
        (item) => item.id === url.pathname.split("/")[3],
      );
      if (
        !row ||
        (!manage() &&
          (row.status !== "published" ||
            !audience(row.id).includes(state.actor)))
      )
        return route.fulfill({ status: 403, json: { error: "Detail denied" } });
      if (url.pathname.endsWith("/recipients"))
        return route.fulfill({
          status: manage() ? 200 : 403,
          json: statuses(row, url),
        });
      return route.fulfill({ json: details(row, url) });
    }
    const value = route.request().postDataJSON() as Operation;
    state.mutations.push(value);
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
            state.mode === "bad-ack" ? { ...saved, action: "unlike" } : saved,
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
  await page.goto("/updates-test-fixture");
  await ready(page);
  return state;
}
async function ready(page: Page) {
  await expect(page.locator(".updates-page")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "My feed", exact: true }),
  ).toBeEnabled();
}
async function open(page: Page, title = post().title) {
  await page
    .getByRole("button", { name: `Open update ${title}`, exact: true })
    .click();
  const detail = page.getByRole("region", {
    name: "Update details",
    exact: true,
  });
  await expect(detail).toBeVisible();
  return detail;
}
async function openViewed(page: Page, title = post().title) {
  await open(page, title);
  const detail = page.getByRole("region", {
    name: "Update details",
    exact: true,
  });
  await expect(detail).toContainText("Viewed 3 Oct");
  await ready(page);
  return detail;
}
async function draft(page: Page, body = "Private synthetic update body") {
  await page.getByRole("button", { name: "Add update", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add update", exact: true });
  await editor
    .getByLabel("Update title", { exact: true })
    .fill("October company news");
  await editor.getByLabel("Update message", { exact: true }).fill(body);
  await editor
    .getByRole("checkbox", { name: "Alex Publisher", exact: true })
    .check();
  return editor;
}
async function marker(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.entries(sessionStorage).filter(([key]) =>
        key.startsWith("ct-alt:updates:"),
      ),
    ),
  );
}
async function capture(page: Page, name: string) {
  await page.addStyleTag({
    content:
      '[aria-label="Synthetic Updates controls"],nextjs-portal{display:none!important;}',
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/${name}.png` });
}

test("draft fixed-recipient picker retains off-page selections and draft lifecycle stays immutable after publish", async ({
  page,
}) => {
  const state = await harness(page);
  const editor = await draft(page);
  await expect(
    editor.getByRole("checkbox", { name: /^Example User/ }),
  ).toHaveCount(99);
  await editor.getByRole("button", { name: "Load more company users" }).click();
  await expect(
    editor.getByRole("checkbox", { name: "Taylor Example", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("checkbox", { name: "Taylor Example", exact: true })
    .check();
  await editor.getByLabel("Search company users").fill("Morgan");
  await editor
    .getByRole("button", { name: "Search recipients", exact: true })
    .click();
  await editor
    .getByRole("checkbox", { name: "Morgan Target", exact: true })
    .check();
  await expect(
    editor.getByRole("list", { name: "Selected update recipients" }),
  ).toContainText("Taylor Example");
  await editor
    .getByRole("checkbox", { name: "Request explicit read confirmation" })
    .check();
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await ready(page);
  const created = state.mutations.find(
    (item) => item.change.action === "create",
  )!;
  expect(created.change).toMatchObject({
    recipientIds: [actor, employee, users[1004].id],
    requireConfirmation: true,
  });
  expect(await marker(page)).toEqual({});
  const detail = await open(page, "October company news");
  await detail.getByRole("button", { name: "Edit draft", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit update draft" });
  await expect(
    edit.getByRole("list", { name: "Selected update recipients" }),
  ).toContainText("Morgan Target");
  await edit.getByLabel("Update message").fill("Updated immutable briefing");
  await edit.getByRole("button", { name: "Save draft", exact: true }).click();
  await ready(page);
  await page
    .getByRole("region", { name: "Update details" })
    .getByRole("button", { name: "Publish update", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Publish update?", exact: true })
    .getByRole("button", { name: "Publish update", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Update details" }),
  ).toContainText("Viewed 3 Oct");
  await ready(page);
  await expect(
    page
      .getByRole("region", { name: "Update details" })
      .getByRole("button", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  expect(
    state.posts.find(
      (row) =>
        row.id ===
        ("postId" in created.change
          ? created.change.postId
          : state.receipts.get(created.operationId)!.saved.postId),
    ),
  ).toMatchObject({
    status: "published",
    body: "Updated immutable briefing",
    revision: 3,
    content_revision: 1,
  });
  await capture(page, "updates-management-desktop");
});

test("fixed audience500 cap preserves existing names and permits replacing one selected user", async ({
  page,
}) => {
  const state = await harness(page);
  state.audiences.set(
    post(3).id,
    users.slice(0, 500).map((user) => user.id),
  );
  await page
    .getByRole("button", { name: "Manage updates", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: `Edit draft ${post(3).title}`, exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit update draft",
    exact: true,
  });
  await expect(editor).toContainText("Fixed selected users · 500/500");
  await editor.getByLabel("Search company users").fill("Morgan");
  await editor
    .getByRole("button", { name: "Search recipients", exact: true })
    .click();
  await expect(
    editor.getByRole("checkbox", { name: "Morgan Target", exact: true }),
  ).toBeDisabled();
  await editor
    .getByRole("button", {
      name: "Remove recipient Alex Publisher",
      exact: true,
    })
    .click();
  await editor
    .getByRole("checkbox", { name: "Morgan Target", exact: true })
    .check();
  await expect(editor).toContainText("Fixed selected users · 500/500");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await ready(page);
  const change = state.mutations[0].change;
  expect(change.action).toBe("edit");
  if (change.action === "edit") {
    expect(change.recipientIds).toHaveLength(500);
    expect(change.recipientIds).not.toContain(actor);
    expect(change.recipientIds).toContain(users[1004].id);
  }
});

test("listing/search/analytics never mark viewed, visible recipient detail marks once and explicit confirmation stays separate", async ({
  page,
}) => {
  const state = await harness(page);
  await page.getByRole("button", { name: "Refresh Updates" }).click();
  await ready(page);
  await page
    .getByRole("button", { name: "Manage updates", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", {
      name: `Recipient statuses for ${post().title}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Recipient statuses", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Close recipient statuses" }).click();
  const detail = await openViewed(page);
  expect(
    state.mutations.filter((item) => item.change.action === "view"),
  ).toHaveLength(1);
  await expect(
    detail.getByRole("button", { name: "Confirm read", exact: true }),
  ).toBeEnabled();
  expect(state.confirmations.size).toBe(0);
  await detail
    .getByRole("button", { name: "Confirm read", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Update details" }),
  ).toContainText("Read confirmed 3 Oct");
  await ready(page);
  await page.getByRole("button", { name: "Close update details" }).click();
  await openViewed(page);
  expect(
    state.mutations.filter((item) => item.change.action === "view"),
  ).toHaveLength(1);
});

test("recipient likes/comments edit/soft-removal respect settings and preserved comment history", async ({
  page,
}) => {
  const state = await harness(page);
  await openViewed(page);
  await page.getByRole("button", { name: "Like update", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlike update", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Unlike update", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Like update", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("First synthetic comment");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Update comments" }),
  ).toContainText("First synthetic comment");
  await ready(page);
  await page
    .getByRole("button", {
      name: "Edit comment by Alex Publisher",
      exact: true,
    })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit comment", exact: true });
  await edit.getByLabel("Comment text").fill("Revised synthetic comment");
  await edit.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Update comments" }),
  ).toContainText("Revised synthetic comment");
  await ready(page);
  await page
    .getByRole("button", {
      name: "Remove comment by Alex Publisher",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Remove comment?", exact: true })
    .getByRole("button", { name: "Remove comment", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Update comments" }),
  ).toContainText("Comment removed");
  await ready(page);
  expect(state.comments[0]).toMatchObject({
    status: "removed",
    body: "",
    revision: 3,
  });
  state.posts[1].allowComments = false;
  state.posts[1].allowReactions = false;
  await page.getByRole("button", { name: "Close update details" }).click();
  await openViewed(page, post(2).title);
  await expect(
    page.getByText("Likes are disabled for this update."),
  ).toBeVisible();
  await expect(
    page.getByText("Comments are disabled for this update."),
  ).toBeVisible();
  await expect(page.getByLabel("Add a comment", { exact: true })).toHaveCount(
    0,
  );
  await capture(page, "updates-disabled-engagement-desktop");
});

test("employee recipient feed exposes engagement without management or recipient analytics", async ({
  page,
}) => {
  const state = await harness(page);
  state.role = "employee";
  state.actor = employee;
  await page.getByRole("button", { name: "Switch synthetic role" }).click();
  await page.getByRole("button", { name: "Switch synthetic actor" }).click();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Add update", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Manage updates", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Recipient statuses for/ }),
  ).toHaveCount(0);
  const detail = await openViewed(page);
  await expect(
    detail.getByRole("button", { name: "Archive update", exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Confirm read", exact: true }),
  ).toBeEnabled();
  await detail
    .getByLabel("Add a comment", { exact: true })
    .fill("Thanks for the team briefing.");
  await detail
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Update comments" }),
  ).toContainText("Taylor Example");
  await ready(page);
  await capture(page, "updates-recipient-desktop");
  await page
    .getByRole("region", { name: "Update details", exact: true })
    .screenshot({ path: "test-results/updates-recipient-detail.png" });
});

test("admin management does not grant nonrecipient engagement, archive/restore keeps fixed published content", async ({
  page,
}) => {
  const state = await harness(page);
  state.audiences.set(post().id, [employee]);
  await page
    .getByRole("button", { name: "Manage updates", exact: true })
    .click();
  await ready(page);
  const detail = await open(page);
  await expect(detail).toContainText("Management access does not add you");
  expect(state.mutations).toHaveLength(0);
  await expect(detail.getByRole("button", { name: "Like update" })).toHaveCount(
    0,
  );
  await detail
    .getByRole("button", { name: "Archive update", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Archive update?", exact: true })
    .getByRole("button", { name: "Archive update", exact: true })
    .click();
  await ready(page);
  const archived = await open(page);
  await expect(archived).toContainText("archived");
  await archived
    .getByRole("button", { name: "Restore update", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Restore update?", exact: true })
    .getByRole("button", { name: "Restore update", exact: true })
    .click();
  await ready(page);
  expect(state.posts[0]).toMatchObject({
    status: "published",
    content_revision: 1,
    revision: 4,
  });
  expect(state.audiences.get(post().id)).toEqual([employee]);
  expect(state.mutations.map((item) => item.change.action)).toEqual([
    "archive",
    "restore",
  ]);
});

test("literal title query has exact123 counts and opaque50-row keyset paging", async ({
  page,
}) => {
  const state = await harness(page);
  state.posts = Array.from({ length: 123 }, (_, index) => post(index + 1));
  await page
    .getByRole("button", { name: "Manage updates", exact: true })
    .click();
  await ready(page);
  await expect(page.locator(".updates-counts button").first()).toContainText(
    "123",
  );
  await expect(page.locator(".update-card")).toHaveCount(50);
  await page.getByRole("button", { name: "Load older updates" }).click();
  await ready(page);
  await expect(page.locator(".update-card")).toHaveCount(100);
  expect(state.gets.at(-1)?.searchParams.get("cursor")).toBe("opaque-list-50");
  await page.getByLabel("Search update titles").fill("100%_");
  await page
    .getByRole("button", { name: "Search titles", exact: true })
    .click();
  await ready(page);
  await expect(page.locator(".update-card")).toHaveCount(1);
  await expect(page.locator(".updates-counts button").first()).toContainText(
    "1",
  );
  expect(state.gets.at(-1)?.searchParams.get("search")).toBe("100%_");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await ready(page);
  await expect(page.locator(".update-card")).toHaveCount(50);
});

test("admin exact500 recipient viewed/confirmed analytics use bounded status paging without engagement", async ({
  page,
}) => {
  const state = await harness(page);
  state.audiences.set(
    post().id,
    users.slice(0, 500).map((user) => user.id),
  );
  state.views.set(post().id, new Set([employee]));
  await page
    .getByRole("button", { name: "Manage updates", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", {
      name: `Recipient statuses for ${post().title}`,
      exact: true,
    })
    .click();
  await ready(page);
  const analytics = page.getByRole("region", {
    name: "Recipient statuses",
    exact: true,
  });
  await expect(analytics.locator(".update-analytics-counts")).toContainText(
    "500",
  );
  await expect(analytics.locator("tbody tr")).toHaveCount(50);
  await analytics
    .getByRole("button", { name: "Load more recipient statuses" })
    .click();
  await ready(page);
  await expect(analytics.locator("tbody tr")).toHaveCount(100);
  expect(state.gets.at(-1)?.searchParams.get("cursor")).toBe(
    "opaque-statuses-50",
  );
  await analytics
    .getByLabel("Recipient status", { exact: true })
    .selectOption("viewed");
  await ready(page);
  await expect(
    page
      .getByRole("region", { name: "Recipient statuses", exact: true })
      .locator("tbody tr"),
  ).toHaveCount(1);
  expect(state.mutations).toHaveLength(0);
  await capture(page, "updates-analytics-desktop");
});

test("lost draft acknowledgement keeps field-free marker, failed GET locks and exact replay creates once", async ({
  page,
}) => {
  const state = await harness(page);
  const editor = await draft(page, "Sensitive synthetic publishing text");
  state.mode = "lost";
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toBeVisible();
  const first = structuredClone(state.mutations[0]);
  const stored = await marker(page);
  expect(JSON.parse(Object.values(stored)[0])).toEqual({
    operationId: first.operationId,
    action: "create",
  });
  expect(JSON.stringify(stored)).not.toContain("Sensitive");
  state.mode = "failed-read";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await expect(
    page.getByRole("region", { name: "Updates recovery" }),
  ).toBeVisible();
  expect(await marker(page)).toEqual(stored);
  state.mode = "normal";
  await page.getByRole("button", { name: "Retry last action" }).click();
  await ready(page);
  expect(state.mutations[1]).toEqual(first);
  expect(
    state.posts.filter(
      (row) => row.body === "Sensitive synthetic publishing text",
    ),
  ).toHaveLength(1);
  expect(await marker(page)).toEqual({});
  expect(state.gets.at(-1)?.searchParams.get("view")).toBe("manage");
});

test("unknown draft departure/return recovers actual management list instead of empty personal feed", async ({
  page,
}) => {
  const state = await harness(page);
  const editor = await draft(page);
  state.mode = "lost";
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  await expect(
    page.getByRole("region", { name: "Updates recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toHaveCount(0);
  state.mode = "normal";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await ready(page);
  expect(state.gets.at(-1)?.searchParams.get("view")).toBe("manage");
  await expect(page.locator(".update-card")).toContainText([
    "October company news",
  ]);
  await expect(
    page.getByRole("button", { name: "Manage updates", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("unknown management marker after admin downgrade stays locked and does not recover through recipient feed", async ({
  page,
}) => {
  const state = await harness(page);
  const editor = await draft(page);
  state.mode = "lost";
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Updates recovery" }),
  ).toBeVisible();
  const stored = await marker(page);
  state.role = "employee";
  await page.getByRole("button", { name: "Switch synthetic role" }).click();
  await expect(
    page.getByRole("region", { name: "Updates recovery" }),
  ).toBeVisible();
  state.mode = "normal";
  await page.getByRole("button", { name: "Refresh to recover" }).click();
  await expect(page.locator(".updates-page").getByRole("alert")).toContainText(
    "access could not be verified",
  );
  expect(state.gets.at(-1)?.searchParams.get("view")).toBe("manage");
  expect(await marker(page)).toEqual(stored);
  await expect(page.locator(".update-card")).toHaveCount(0);
});

test("held POST blocks forced manual refresh and preserves pending marker across departure", async ({
  page,
}) => {
  const state = await harness(page);
  const editor = await draft(page);
  state.mode = "hold-post";
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => !!state.holdPost).toBe(true);
  const before = state.gets.length;
  const refresh = page.getByRole("button", { name: "Refresh Updates" });
  await expect(refresh).toBeDisabled();
  await refresh.evaluate((button) => {
    button.removeAttribute("disabled");
    (button as HTMLButtonElement).click();
  });
  expect(state.gets.length).toBe(before);
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/updates"),
  );
  state.mode = "normal";
  state.holdPost!();
  await completed;
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  await expect(
    page.getByRole("region", { name: "Updates recovery" }),
  ).toBeVisible();
  expect(state.gets.length).toBe(before);
  expect(Object.keys(await marker(page))).toHaveLength(1);
});

test("departure while successful acknowledgement body is delayed never starts a stale GET", async ({
  page,
}) => {
  const state = await harness(page);
  await page.evaluate(() => {
    const controls = window as unknown as {
      held: boolean;
      release: () => void;
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (args[1]?.method === "POST") {
        const json = response.json.bind(response);
        response.json = async () => {
          const data = await json();
          controls.held = true;
          await new Promise<void>((resolve) => {
            controls.release = resolve;
          });
          return data;
        };
      }
      return response;
    };
  });
  const editor = await draft(page);
  const before = state.gets.length;
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { held: boolean }).held),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Toggle synthetic departure" })
    .click();
  await page.evaluate(async () => {
    (window as unknown as { release: () => void }).release();
    await new Promise(requestAnimationFrame);
  });
  expect(state.gets.length).toBe(before);
  expect(Object.keys(await marker(page))).toHaveLength(1);
});

for (const context of ["role", "company", "actor"] as const)
  test(`${context} replacement clears private editor and aborts stale searched picker`, async ({
    page,
  }) => {
    const state = await harness(page);
    const editor = await draft(page, "Private draft should disappear");
    let release: (() => void) | undefined;
    let aborted = false;
    await page.route("**/api/updates/roster**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("search") !== "held")
        return route.fallback();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await route.fulfill({
          json: {
            tenantId: company.id,
            actorId: actor,
            role: "owner",
            users: [{ id: employee, name: "Stale private recipient" }],
            nextCursor: null,
          },
        });
      } catch {
        aborted = true;
      }
    });
    await editor.getByLabel("Search company users").fill("held");
    await editor
      .getByRole("button", { name: "Search recipients", exact: true })
      .click();
    await expect.poll(() => !!release).toBe(true);
    if (context === "role") state.role = "employee";
    if (context === "actor") state.actor = employee;
    if (context === "company")
      state.tenant = {
        ...company,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Second Example Company",
      };
    await page
      .getByRole("button", { name: `Switch synthetic ${context}` })
      .evaluate((button) => (button as HTMLButtonElement).click());
    release!();
    await ready(page);
    await expect(page.getByText("Private draft should disappear")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("dialog", { name: "Add update", exact: true }),
    ).not.toBeVisible();
    await expect(page.getByText("Stale private recipient")).toHaveCount(0);
    expect(state.mutations).toHaveLength(0);
    void aborted;
  });

test("delayed authorized detail followed by denied list cannot restore content or mark view", async ({
  page,
}) => {
  const state = await harness(page);
  let release: (() => void) | undefined;
  await page.route(`**/api/updates/${post().id}?**`, async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await route.fallback();
    } catch {}
  });
  await page
    .getByRole("button", { name: `Open update ${post().title}`, exact: true })
    .click();
  await expect.poll(() => !!release).toBe(true);
  state.mode = "denied";
  await page.getByRole("button", { name: "Refresh Updates" }).click();
  await expect(
    page.getByRole("region", { name: "Updates recovery" }),
  ).toBeVisible();
  state.mode = "normal";
  release!();
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
  });
  await expect(
    page.getByRole("region", { name: "Update details" }),
  ).toHaveCount(0);
  await expect(page.locator(".update-card")).toHaveCount(0);
  expect(state.mutations).toHaveLength(0);
});

for (const surface of ["detail", "roster", "analytics"] as const)
  test(`${surface} mismatched identity clears private state and controls`, async ({
    page,
  }) => {
    const state = await harness(page);
    state.mismatch = "actor";
    if (surface === "detail")
      await page
        .getByRole("button", {
          name: `Open update ${post().title}`,
          exact: true,
        })
        .click();
    if (surface === "roster")
      await page
        .getByRole("button", { name: "Add update", exact: true })
        .click();
    if (surface === "analytics")
      await page
        .getByRole("button", {
          name: `Recipient statuses for ${post().title}`,
          exact: true,
        })
        .click();
    await expect(
      page.getByRole("region", { name: "Updates recovery" }),
    ).toBeVisible();
    await expect(page.locator(".update-card")).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Add update", exact: true }),
    ).not.toBeVisible();
    expect(state.mutations).toHaveLength(0);
  });

for (const mode of ["bad-ack", "conflict"] as const)
  test(`${mode} never claims success and remains locked until current GET`, async ({
    page,
  }) => {
    const state = await harness(page);
    const editor = await draft(page);
    state.mode = mode;
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Updates recovery" }),
    ).toBeVisible();
    expect(Object.keys(await marker(page))).toHaveLength(1);
    await expect(page.getByText("Update saved.", { exact: true })).toHaveCount(
      0,
    );
    state.mode = "normal";
    await page.getByRole("button", { name: "Refresh to recover" }).click();
    await ready(page);
    expect(await marker(page)).toEqual({});
  });

test("recipient engagement replay accepts prior post revision after archive/restore and saves once", async ({
  page,
}) => {
  const state = await harness(page);
  await openViewed(page);
  state.mode = "lost";
  await page.getByRole("button", { name: "Like update", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry last action" }),
  ).toBeVisible();
  const original = structuredClone(state.mutations.at(-1)!);
  state.posts[0].revision += 2;
  state.mode = "normal";
  await page.getByRole("button", { name: "Retry last action" }).click();
  await ready(page);
  expect(state.mutations.at(-1)).toEqual(original);
  expect(state.likes.get(post().id)?.size).toBe(1);
  expect(await marker(page)).toEqual({});
});
