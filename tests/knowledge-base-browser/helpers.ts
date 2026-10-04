import { expect, type Page, type Route } from "@playwright/test";
import type { Member } from "../../lib/agent-types";
import type {
  KnowledgeMutation,
  KnowledgeSaved,
  KnowledgeBase,
  KnowledgeNode,
  KnowledgeAssignee,
  KnowledgeChange,
} from "../../lib/knowledge-base-types";
import * as f from "./fixture-data";
export type Call = { url: URL; method: string; body: KnowledgeMutation | null };
export type Response = { status?: number; data?: unknown; abort?: boolean };
export type Hook = (call: Call) => Promise<Response | void> | Response | void;
export const markerKey = `ct-alt:knowledge-base:${f.actor}:${f.company.id}`;
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
export async function forceClick(page: Page, label: string) {
  await page
    .getByRole("button", { name: label, exact: true })
    .evaluate((element) => {
      const node = element as HTMLButtonElement;
      const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
      const props = key
        ? (
            node as unknown as Record<
              string,
              { onClick?: (event: { preventDefault: () => void }) => void }
            >
          )[key]
        : null;
      if (typeof props?.onClick !== "function")
        throw new Error("React handler missing");
      node.disabled = false;
      props.onClick({ preventDefault() {} });
    });
}
export async function bodyBarrier(
  page: Page,
  method = "POST",
  path = "/api/knowledge-base",
) {
  await page.evaluate(
    ({ method, path }) => {
      const original = window.fetch;
      let release!: () => void;
      const promise = new Promise<void>((r) => (release = r));
      Object.assign(window, { kbRelease: release, kbBodyHeld: false });
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        if (
          String(input).split("?")[0] === path &&
          (init?.method || "GET") === method
        ) {
          const json = response.json.bind(response);
          response.json = async () => {
            const data = await json();
            Object.assign(window, { kbBodyHeld: true });
            await promise;
            return data;
          };
        }
        return response;
      };
    },
    { method, path },
  );
}
export async function waitBody(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => !!(window as unknown as { kbBodyHeld: boolean }).kbBodyHeld,
      ),
    )
    .toBe(true);
}
export async function releaseBody(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { kbRelease: () => void }).kbRelease(),
  );
}
export class Model {
  page: Page;
  calls: Call[] = [];
  hook: Hook | null = null;
  role: Member["role"] = "owner";
  actor = f.actor;
  tenant = f.company.id;
  bases = structuredClone(f.bases);
  nodes = structuredClone(f.nodes);
  audience = new Map<string, KnowledgeAssignee[]>([
    [f.bookId, structuredClone(f.audience)],
  ]);
  bodies = new Map(f.bodies);
  urls = new Map([[f.linkId, "https://example.test/team"]]);
  receipts = new Map<string, KnowledgeSaved>();
  events: KnowledgeMutation[] = [];
  serial = 10;
  catalogVersion = f.version;
  treeVersion = f.version;
  audienceVersion = f.version;
  rosterVersion = f.version;
  eventVersion = f.eventVersion;
  chartViews: string[] = [];
  hugeTotal: string | null = null;
  roster = Array.from({ length: 1006 }, (_, i) => f.assigned(i + 1)).filter(
    (u) => u.actorId !== f.assigned(3).actorId,
  );
  extraBases = 0;
  extraSearch = 0;
  constructor(page: Page) {
    this.page = page;
  }
  async install() {
    await this.page.route("**/api/knowledge-base**", (r) => this.route(r));
    await this.page.goto("/knowledge-base-test-fixture");
    await expect(
      this.page.getByRole("button", { name: "Add base", exact: true }),
    ).toBeEnabled();
  }
  id() {
    return `99999999-9999-4999-8999-${String(this.serial++).padStart(12, "0")}`;
  }
  permissions(b: KnowledgeBase, view: string) {
    const manage = view === "manage";
    return {
      ...b,
      isAssigned:
        b.id === f.bookId ||
        !!this.audience.get(b.id)?.some((u) => u.actorId === this.actor),
      canRead:
        b.status === "published" &&
        (b.id === f.bookId ||
          !!this.audience.get(b.id)?.some((u) => u.actorId === this.actor)),
      canEdit: manage && b.status !== "archived",
      canPublish: manage && b.status === "draft" && b.audienceCount > 0,
      canArchive: manage && b.status !== "archived",
      canRestore: manage && b.status === "archived",
    };
  }
  nodePermissions(n: KnowledgeNode, view: string) {
    if (view === "manage") return { ...n };
    return {
      ...n,
      canEdit: false,
      canMove: false,
      canMoveEarlier: false,
      canMoveLater: false,
      canArchive: false,
      canRestore: false,
    };
  }
  identity(view: string) {
    return {
      tenantId: this.tenant,
      actorId: this.actor,
      role: this.role,
      view,
    };
  }
  scope(b: KnowledgeBase, view: string) {
    return {
      ...this.identity(view),
      baseId: b.id,
      baseRevision: b.revision,
      audienceVersion: this.audienceVersion,
      treeVersion: this.treeVersion,
      base: this.permissions(b, view),
      serverTime: f.timestamp,
    };
  }
  path(n: KnowledgeNode | null, include = false) {
    const output: KnowledgeNode[] = [];
    let current = include
      ? n
      : this.nodes.find((v) => v.id === n?.parentId) || null;
    while (current) {
      output.unshift(current);
      current = this.nodes.find((v) => v.id === current!.parentId) || null;
    }
    return output.map(({ id, name, status, revision }) => ({
      id,
      name,
      status,
      revision,
    }));
  }
  pageRows<T>(rows: T[], url: URL) {
    const start = Number(url.searchParams.get("cursor") || 0);
    return {
      rows: rows.slice(start, start + 50),
      nextCursor: start + 50 < rows.length ? String(start + 50) : null,
    };
  }
  read(call: Call): unknown {
    const { url } = call;
    const view = url.searchParams.get("view") || "manage";
    const search = url.searchParams.get("search") || "";
    const match = (v: string) => v.toLowerCase().includes(search.toLowerCase());
    const parts = url.pathname.split("/").filter(Boolean);
    const bid = parts[2];
    if (parts.length === 2) {
      let rows = this.bases.map((b) => this.permissions(b, view));
      if (this.extraBases)
        rows = Array.from({ length: this.extraBases }, (_, i) => ({
          ...rows[0],
          id: `88888888-8888-4888-8888-${String(i + 1).padStart(12, "0")}`,
          name: `Reference base ${String(i + 1).padStart(4, "0")}`,
        }));
      rows = rows.filter(
        (b) => match(b.name) && (view !== "library" || b.canRead),
      );
      const counts = {
        total: rows.length,
        draft: rows.filter((b) => b.status === "draft").length,
        published: rows.filter((b) => b.status === "published").length,
        archived: rows.filter((b) => b.status === "archived").length,
      };
      const status = url.searchParams.get("status") || "all";
      const paged = this.pageRows(
        rows.filter((b) => status === "all" || b.status === status),
        url,
      );
      return {
        ...this.identity(view),
        company: { ...f.company, id: this.tenant },
        bases: paged.rows,
        counts,
        catalogVersion: this.catalogVersion,
        nextCursor: paged.nextCursor,
        serverTime: f.timestamp,
        capabilities: {
          canManage: this.role === "owner" || this.role === "admin",
        },
      };
    }
    if (bid === "assignees") {
      const rows = this.roster.filter((u) => match(u.name));
      const paged = this.pageRows(rows, url);
      return {
        ...this.identity(view),
        users: paged.rows,
        matchedCount: rows.length,
        rosterVersion: this.rosterVersion,
        nextCursor: paged.nextCursor,
        serverTime: f.timestamp,
      };
    }
    const b = this.bases.find((b) => b.id === bid);
    if (!b) throw new Error("Missing mock base " + bid);
    const scoped = this.scope(b, view);
    if (parts.length === 3)
      return {
        ...scoped,
        company: { ...f.company, id: this.tenant },
        assignees: view === "manage" ? this.audience.get(bid) || [] : [],
        root: {
          activeChildCount: this.nodes.filter(
            (n) =>
              n.baseId === bid && n.parentId === null && n.status === "active",
          ).length,
        },
      };
    if (parts[3] === "nodes" && parts[4]) {
      const n = this.nodes.find((n) => n.id === parts[4])!;
      return {
        ...scoped,
        node: this.nodePermissions(n, view),
        path: this.path(n),
        body:
          n.kind === "text"
            ? this.bodies.get(n.id) || "Original synthetic text"
            : null,
        url:
          n.kind === "link"
            ? this.urls.get(n.id) || "https://example.test/path"
            : null,
      };
    }
    if (parts[3] === "nodes") {
      const parentId = url.searchParams.get("parentId");
      const parent = this.nodes.find((n) => n.id === parentId) || null;
      const status = url.searchParams.get("status") || "all";
      const rows = this.nodes
        .filter(
          (n) =>
            n.baseId === bid &&
            n.parentId === parentId &&
            (status === "all" || n.status === status) &&
            match(n.name),
        )
        .map((n) => this.nodePermissions(n, view));
      const paged = this.pageRows(rows, url);
      return {
        ...scoped,
        parent: parent ? this.nodePermissions(parent, view) : null,
        path: this.path(parent, true),
        nodes: paged.rows,
        matchedCount: rows.length,
        nextCursor: paged.nextCursor,
      };
    }
    if (parts[3] === "search") {
      let rows = this.nodes.filter(
        (n) =>
          n.baseId === bid &&
          match(n.name) &&
          (view === "manage" || n.status === "active"),
      );
      if (this.extraSearch)
        rows = Array.from({ length: this.extraSearch }, (_, i) => ({
          ...this.nodes.find((n) => n.id === f.textId)!,
          id: `77777777-7777-4777-8777-${String(i + 1).padStart(12, "0")}`,
          name: `Policy ${String(i + 1).padStart(4, "0")}`,
        }));
      const paged = this.pageRows(rows, url);
      return {
        ...scoped,
        results: paged.rows.map((n) => ({
          node: this.nodePermissions(n, view),
          path: this.path(n),
        })),
        matchedCount: rows.length,
        nextCursor: paged.nextCursor,
      };
    }
    if (parts[3] === "insights") {
      const nodeId = url.searchParams.get("nodeId");
      const n = this.nodes.find((n) => n.id === nodeId) || null;
      const users = (this.audience.get(bid) || []).map((u) => {
        const events = this.events.filter(
          (e) =>
            e.change.action === "view" &&
            e.change.baseId === bid &&
            (!nodeId || e.change.nodeId === nodeId),
        );
        return {
          ...u,
          totalViews: u.actorId === this.actor ? String(events.length) : "0",
          lastViewedAt:
            u.actorId === this.actor && events.length ? f.timestamp : null,
        };
      });
      const eligible = users.filter((u) => u.eligible).length;
      const distinct = users.filter(
        (u) => u.eligible && u.totalViews !== "0",
      ).length;
      const rows = users.filter((u) => match(u.name));
      const paged = this.pageRows(rows, url);
      return {
        ...scoped,
        node: n ? this.nodePermissions(n, view) : null,
        path: this.path(n),
        eventVersion: this.eventVersion,
        timeZone: "Europe/London",
        counts: {
          assigned: users.length,
          eligible,
          unavailable: users.length - eligible,
          distinctEligibleViewers: distinct,
          eligibleViewedPercentage: eligible
            ? (distinct * 100) / eligible
            : null,
          totalViews:
            this.hugeTotal ??
            String(
              this.events.filter(
                (e) =>
                  e.change.action === "view" &&
                  e.change.baseId === bid &&
                  (!nodeId || e.change.nodeId === nodeId),
              ).length,
            ),
        },
        users: paged.rows,
        matchedCount: rows.length,
        chart: Array.from({ length: 30 }, (_, i) => ({
          date: new Date(Date.UTC(2026, 8, 5 + i)).toISOString().slice(0, 10),
          views: this.chartViews[i] || "0",
        })),
        nextCursor: paged.nextCursor,
      };
    }
    throw new Error("Unknown mock " + url.pathname);
  }
  mutate(value: KnowledgeMutation) {
    const known = this.receipts.get(value.operationId);
    if (known) return known;
    const c = value.change;
    let b =
      "baseId" in c ? this.bases.find((b) => b.id === c.baseId) : undefined;
    let n =
      "nodeId" in c ? this.nodes.find((n) => n.id === c.nodeId) : undefined;
    let saved: KnowledgeSaved;
    if (c.action === "view") {
      this.events.push(structuredClone(value));
      saved = {
        operationId: value.operationId,
        action: c.action,
        baseId: c.baseId,
        revision: c.revision,
        ...(c.nodeId
          ? { nodeId: c.nodeId, nodeRevision: c.nodeRevision! }
          : {}),
        eventId: this.id(),
        recordedAt: f.timestamp,
      };
    } else {
      if (c.action === "create_base") {
        b = {
          ...f.base,
          id: this.id(),
          name: c.name,
          description: c.description,
          status: "draft",
          revision: 1,
          audienceCount: c.audienceIds.length,
          eligibleAudienceCount: c.audienceIds.length,
          isAssigned: false,
          canRead: false,
          canPublish: c.audienceIds.length > 0,
        };
        this.bases.push(b);
        this.audience.set(
          b.id,
          c.audienceIds.map((id) => this.roster.find((u) => u.actorId === id)!),
        );
      } else {
        if (!b) throw new Error("Missing base mutation");
        b.revision++;
        if (c.action === "edit_base") {
          b.name = c.name;
          b.description = c.description;
        }
        if (c.action === "set_audience") {
          const selected = c.audienceIds.map(
            (id) =>
              this.roster.find((u) => u.actorId === id) ||
              f.audience.find((u) => u.actorId === id)!,
          );
          this.audience.set(b.id, selected);
          b.audienceCount = selected.length;
          b.eligibleAudienceCount = selected.filter((u) => u.eligible).length;
        }
        if (c.action === "publish_base") {
          b.status = "published";
          b.restoreStatus = null;
        }
        if (c.action === "archive_base") {
          b.restoreStatus = b.status as "draft" | "published";
          b.status = "archived";
        }
        if (c.action === "restore_base") {
          b.status = b.restoreStatus!;
          b.restoreStatus = null;
        }
        if (c.action === "create_node") {
          n = {
            ...f.section,
            id: this.id(),
            baseId: b.id,
            parentId: c.parentId,
            kind: c.kind,
            name: c.name,
            description: c.description,
            depth:
              (this.nodes.find((x) => x.id === c.parentId)?.depth || 0) + 1,
            activeChildCount: 0,
            canArchive: true,
          };
          this.nodes.push(n);
          if (c.kind === "text") this.bodies.set(n.id, c.body);
          if (c.kind === "link") this.urls.set(n.id, c.url);
        }
        if (c.action === "edit_node") {
          n!.revision++;
          n!.name = c.name;
          n!.description = c.description;
          if (c.kind === "text") this.bodies.set(n!.id, c.body);
          if (c.kind === "link") this.urls.set(n!.id, c.url);
        }
        if (c.action === "move_node") {
          n!.revision++;
          n!.parentId = c.parentId;
          n!.depth =
            (this.nodes.find((x) => x.id === c.parentId)?.depth || 0) + 1;
        }
        if (c.action === "order_node") {
          n!.revision++;
          const siblings = this.nodes
            .filter(
              (x) =>
                x.parentId === n!.parentId &&
                x.baseId === b!.id &&
                x.status === "active",
            )
            .sort((a, b) => Number(a.rank) - Number(b.rank));
          const index = siblings.indexOf(n!),
            other = siblings[index + (c.direction === "earlier" ? -1 : 1)];
          if (other) {
            [n!.rank, other.rank] = [other.rank, n!.rank];
          }
          this.nodes.sort((a, b) => Number(a.rank) - Number(b.rank));
        }
        if (c.action === "archive_node") {
          n!.revision++;
          n!.status = "archived";
          n!.canArchive = false;
          n!.canRestore = true;
        }
        if (c.action === "restore_node") {
          n!.revision++;
          n!.status = "active";
          n!.canArchive = true;
          n!.canRestore = false;
        }
      }
      saved = {
        operationId: value.operationId,
        action: c.action,
        baseId: b!.id,
        revision: b!.revision,
        ...(n ? { nodeId: n.id, nodeRevision: n.revision } : {}),
      };
    }
    this.receipts.set(value.operationId, saved);
    return saved;
  }
  async route(route: Route) {
    const request = route.request();
    const call: Call = {
      url: new URL(request.url()),
      method: request.method(),
      body:
        request.method() === "POST"
          ? (request.postDataJSON() as KnowledgeMutation)
          : null,
    };
    this.calls.push(call);
    // Mirror the actual strict assignee query contract: management authority is
    // server-derived here; this endpoint does not accept a resource-view filter.
    if (
      call.url.pathname === "/api/knowledge-base/assignees" &&
      [...call.url.searchParams.keys()].some(
        (key) =>
          !["tenantId", "search", "limit", "cursor"].includes(key) ||
          call.url.searchParams.getAll(key).length !== 1,
      )
    ) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Choose valid Knowledge Base filters." }),
      });
      return;
    }
    let response = await this.hook?.(call);
    if (!response) {
      if (call.url.pathname.endsWith("/reconcile-view")) {
        const input = call.body as unknown as { operationId: string };
        response = {
          data: {
            tenantId: this.tenant,
            actorId: this.actor,
            role: this.role,
            operationId: input.operationId,
            status: this.receipts.has(input.operationId)
              ? "recorded"
              : "not_recorded",
          },
        };
      } else
        response = {
          data:
            call.method === "POST"
              ? { saved: this.mutate(call.body!) }
              : this.read(call),
        };
    }
    if (response.abort) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: response.status || 200,
      contentType: "application/json",
      body: JSON.stringify(response.data ?? { error: "Synthetic read failed" }),
    });
  }
  writes(action?: KnowledgeChange["action"]) {
    return this.calls.filter(
      (c) =>
        c.method === "POST" &&
        c.body?.change &&
        (!action || c.body.change.action === action),
    );
  }
}
export async function openBook(page: Page) {
  await page
    .getByRole("button", { name: "Open base Company Handbook", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open folder Company Information",
      exact: true,
    }),
  ).toBeEnabled();
}
export async function openSection(page: Page) {
  await openBook(page);
  await page
    .getByRole("button", {
      name: "Open folder Company Information",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open resource Welcome Handbook",
      exact: true,
    }),
  ).toBeEnabled();
}
export async function manager(page: Page, model: Model) {
  model.role = "manager";
  await page
    .getByRole("button", { name: "Switch synthetic role", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open base Company Handbook",
      exact: true,
    }),
  ).toBeEnabled();
}
export async function assertCleared(page: Page) {
  await expect(
    page.getByRole("region", { name: "Knowledge Base recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add base", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Open (base|folder|resource)/ }),
  ).toHaveCount(0);
  await expect(page.locator(".kb-text")).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
