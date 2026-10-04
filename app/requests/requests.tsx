"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Company, Member } from "../../lib/agent-types";
import { formatEmploymentDate } from "../../lib/agent-dates";
import {
  REQUESTS_LIMITS,
  type RequestPriority,
  type RequestStatus,
  type WorkRequest,
  type RequestsBoardData,
  type RequestsDetailData,
  type RequestsAssigneesData,
  type RequestsMutation,
  type RequestsSaved,
} from "../../lib/requests-types";
import "./requests.css";

const statuses: RequestStatus[] = ["new", "in_progress", "done"];
const statusLabels: Record<RequestStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};
const uuid = z.uuid();
const role = z.enum(["owner", "admin", "manager", "employee"]);
const text = (max: number) => z.string().refine((value) => value.length <= max);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().positive().max(2147483647);
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)));
const calendar = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !value.startsWith("0000") &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value,
  );
const cursor = text(4096)
  .refine((value) => !!value && !/[\u0000-\u0020]/.test(value))
  .nullable();
const companySchema = z.strictObject({
  id: uuid,
  name: text(500),
  time_zone: text(100).refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }),
});
const identity = {
  schemaVersion: z.literal(1),
  company: companySchema,
  actorId: uuid,
  role,
  scopeVersion: z.string().regex(/^[a-f0-9]{32}$/),
};
const person = z.strictObject({ actorId: uuid, name: text(500) });
const assignee = person.extend({ agentId: uuid, eligible: z.boolean() });
const requestSchema = z.strictObject({
  id: uuid,
  tenantId: uuid,
  title: text(REQUESTS_LIMITS.title).refine((v) => !!v.trim()),
  description: text(REQUESTS_LIMITS.description),
  priority: z.enum(["low", "normal", "high"]),
  dueDate: calendar.nullable(),
  status: z.enum(statuses),
  revision,
  requester: person,
  assignee: assignee.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  canEdit: z.boolean(),
  canMove: z.boolean(),
  canAssign: z.boolean(),
});
const countsSchema = z
  .strictObject({ new: count, in_progress: count, done: count, total: count })
  .refine((v) => v.total === v.new + v.in_progress + v.done);
const pageSchema = z.strictObject({
  requests: z.array(requestSchema).max(REQUESTS_LIMITS.pageMax),
  nextCursor: cursor,
});
const boardSchema = z.strictObject({
  ...identity,
  mode: z.literal("board"),
  search: text(REQUESTS_LIMITS.search),
  counts: countsSchema,
  columns: z.strictObject({
    new: pageSchema,
    in_progress: pageSchema,
    done: pageSchema,
  }),
  capabilities: z.strictObject({
    canCreate: z.boolean(),
    canManage: z.boolean(),
  }),
  serverTime: timestamp,
});
const columnSchema = z.strictObject({
  ...identity,
  ...pageSchema.shape,
  mode: z.literal("column"),
  status: z.enum(statuses),
  search: text(REQUESTS_LIMITS.search),
  counts: countsSchema,
  serverTime: timestamp,
});
const detailSchema = z.strictObject({
  ...identity,
  mode: z.literal("detail"),
  request: requestSchema,
  serverTime: timestamp,
});
const assigneesSchema = z.strictObject({
  ...identity,
  mode: z.literal("assignees"),
  search: text(REQUESTS_LIMITS.search),
  matchedCount: count,
  users: z.array(person.extend({ agentId: uuid })).max(REQUESTS_LIMITS.pageMax),
  nextCursor: cursor,
  serverTime: timestamp,
});
const savedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tenantId: uuid,
  actorId: uuid,
  role,
  operationId: uuid,
  action: z.enum(["create", "edit", "move"]),
  requestId: uuid,
  revision,
  status: z.enum(statuses),
});
const markerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: uuid,
  action: z.enum(["create", "edit", "move"]),
});
type Marker = z.infer<typeof markerSchema>;
type Phase =
  | "checking"
  | "ready"
  | "reading"
  | "saving"
  | "unknown"
  | "conflict"
  | "denied";
type Draft = {
  title: string;
  description: string;
  priority: RequestPriority;
  dueDate: string;
  assignee: { agentId: string; actorId: string; name: string } | null;
};
type Props = {
  company: Company;
  role: Member["role"];
  initialData: RequestsBoardData;
};
const blankDraft = (): Draft => ({
  title: "",
  description: "",
  priority: "normal",
  dueDate: "",
  assignee: null,
});
const draftFrom = (request: WorkRequest): Draft => ({
  title: request.title,
  description: request.description,
  priority: request.priority,
  dueDate: request.dueDate || "",
  assignee: request.assignee
    ? {
        agentId: request.assignee.agentId,
        actorId: request.assignee.actorId,
        name: request.assignee.name,
      }
    : null,
});
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}
function message(body: unknown, fallback: string) {
  return body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : fallback;
}
function decode<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ReadFailure(
      "The request response could not be verified. Refresh current requests.",
    );
  return parsed.data;
}
class ReadFailure extends Error {
  constructor(
    message: string,
    readonly denied = false,
  ) {
    super(message);
  }
}

export default function Requests(props: Props) {
  return (
    <RequestsContent
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}`}
      {...props}
    />
  );
}
function RequestsContent({ company, role: expectedRole, initialData }: Props) {
  const expectedActor = initialData.actorId;
  function scope<
    T extends { company: Company; actorId: string; role: Member["role"] },
  >(value: T) {
    if (
      value.company.id !== company.id ||
      value.actorId !== expectedActor ||
      value.role !== expectedRole
    )
      throw new ReadFailure(
        "Current company access could not be verified. Reload the page.",
        true,
      );
    return value;
  }
  function boardValue(raw: unknown, search: string): RequestsBoardData {
    const value = scope(decode(boardSchema, raw));
    if (value.search !== search)
      throw new ReadFailure("The request search could not be verified.");
    const ids = new Set<string>();
    for (const status of statuses) {
      const page = value.columns[status];
      if (
        page.requests.length > value.counts[status] ||
        (!page.nextCursor && page.requests.length !== value.counts[status]) ||
        (page.nextCursor && !page.requests.length)
      )
        throw new ReadFailure("The request counts could not be verified.");
      for (const row of page.requests) {
        if (
          row.tenantId !== company.id ||
          row.status !== status ||
          ids.has(row.id)
        )
          throw new ReadFailure("The request board could not be verified.");
        ids.add(row.id);
      }
    }
    return value;
  }
  function initialBoard() {
    try {
      return boardValue(initialData, initialData.search);
    } catch {
      return null;
    }
  }
  const [data, setData] = useState<RequestsBoardData | null>(initialBoard),
    [phase, setPhase] = useState<Phase>("checking"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dataRef = useRef(data),
    phaseRef = useRef<Phase>("checking"),
    mounted = useRef(false),
    epoch = useRef(0),
    readController = useRef<AbortController | null>(null),
    writeFence = useRef<RequestsMutation | null>(null);
  const [search, setSearch] = useState(initialData.search),
    searchRef = useRef(initialData.search),
    [searchInput, setSearchInput] = useState(initialData.search),
    searchInputRef = useRef(initialData.search);
  const [editor, setEditor] = useState<"create" | string | null>(null),
    editorRef = useRef<"create" | string | null>(null),
    [detail, setDetail] = useState<RequestsDetailData | null>(null),
    detailRef = useRef<RequestsDetailData | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft),
    draftRef = useRef<Draft>(draft),
    [operation, setOperation] = useState<RequestsMutation | null>(null),
    operationRef = useRef<RequestsMutation | null>(null),
    recoveryRef = useRef<Marker | null>(null);
  const [recovery, setRecovery] = useState<Marker | null>(null),
    [invalidRecovery, setInvalidRecovery] = useState(false),
    invalidRecoveryRef = useRef(false);
  const hasRecovery = !!recovery;
  const [assignees, setAssignees] = useState<RequestsAssigneesData | null>(
      null,
    ),
    assigneesRef = useRef<RequestsAssigneesData | null>(null),
    [assigneeSearch, setAssigneeSearch] = useState(""),
    assigneeSearchRef = useRef(""),
    [dragged, setDragged] = useState<{ id: string; revision: number } | null>(
      null,
    );
  const modal = useRef<HTMLDivElement>(null),
    titleInput = useRef<HTMLInputElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const storageKey = `ct-alt:requests:v1:${expectedActor}:${company.id}`;
  function showPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }
  function showData(next: RequestsBoardData | null) {
    dataRef.current = next;
    setData(next);
  }
  function showDetail(next: RequestsDetailData | null) {
    detailRef.current = next;
    setDetail(next);
  }
  function showEditor(next: "create" | string | null) {
    editorRef.current = next;
    setEditor(next);
  }
  function showOperation(next: RequestsMutation | null) {
    operationRef.current = next;
    setOperation(next);
  }
  function changeDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
  }
  function showAssignees(next: RequestsAssigneesData | null) {
    assigneesRef.current = next;
    setAssignees(next);
  }
  function marker(next: Marker | null) {
    recoveryRef.current = next;
    setRecovery(next);
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The server's UUID fence does not depend on browser storage. */
    }
  }
  function alive(token: number) {
    return mounted.current && epoch.current === token;
  }
  function cancelRead() {
    epoch.current++;
    readController.current?.abort();
    readController.current = null;
  }
  function canAct() {
    return (
      mounted.current &&
      phaseRef.current === "ready" &&
      !writeFence.current &&
      !!dataRef.current &&
      !recoveryRef.current &&
      !invalidRecoveryRef.current
    );
  }
  function wipePrivate() {
    cancelRead();
    showData(null);
    showDetail(null);
    showEditor(null);
    showAssignees(null);
    changeDraft(blankDraft());
    showOperation(null);
    setDragged(null);
  }
  function deny(text: string) {
    wipePrivate();
    showPhase("denied");
    setError(text);
  }
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      let raw: string | null = null;
      try {
        raw = sessionStorage.getItem(storageKey);
      } catch {}
      if (raw) {
        try {
          recoveryRef.current = markerSchema.parse(JSON.parse(raw));
          setRecovery(recoveryRef.current);
          showPhase("unknown");
          showData(null);
          setError("An earlier request save outcome needs to be reviewed.");
        } catch {
          invalidRecoveryRef.current = true;
          setInvalidRecovery(true);
          showPhase("denied");
          showData(null);
          setError(
            "The earlier save marker could not be verified. Keep this tab and review your company access.",
          );
        }
      } else if (dataRef.current) showPhase("ready");
      else {
        showPhase("denied");
        setError(
          "The request board could not be verified. Refresh current requests.",
        );
      }
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      cancelRead();
    };
    // Scope changes remount this component, and all asynchronous handlers use refs.
  }, [storageKey]);
  useEffect(() => {
    if (
      !editor ||
      !mounted.current ||
      editorRef.current !== editor ||
      detailRef.current !== detail
    )
      return;
    const title = titleInput.current;
    const first = modal.current?.querySelector<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
    );
    // Loading and read-only details still enter the dialog; editable detail
    // resolution moves focus to its title only after the current scoped read.
    (title && !title.disabled ? title : first || modal.current)?.focus();
  }, [editor, detail]);
  useEffect(() => {
    const dialog = modal.current;
    if (
      !editor ||
      !dialog ||
      !mounted.current ||
      editorRef.current !== editor ||
      detailRef.current !== detail ||
      phaseRef.current !== phase
    )
      return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      dialog.contains(active) &&
      !active.matches(":disabled")
    )
      return;
    // Reads and writes can disable the previously focused control. Keep focus
    // in the current dialog without moving it during normal typing.
    (
      dialog.querySelector<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ) || dialog
    ).focus();
  }, [editor, detail, phase]);
  async function get(
    query: URLSearchParams,
    token: number,
    controller: AbortController,
  ) {
    const response = await fetch(`/api/requests?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!alive(token) || controller.signal.aborted)
      throw new DOMException("Stale request", "AbortError");
    if (!response.ok)
      throw new ReadFailure(
        message(
          raw,
          response.status === 403
            ? "Your request access has changed. Reload to review company access."
            : "Requests could not be loaded. Try again.",
        ),
        [401, 403, 404].includes(response.status),
      );
    return raw;
  }
  function readStart() {
    cancelRead();
    const controller = new AbortController();
    readController.current = controller;
    return { controller, token: epoch.current };
  }
  async function fetchBoard(token: number, controller: AbortController) {
    return boardValue(
      await get(
        new URLSearchParams({
          tenantId: company.id,
          mode: "board",
          search: searchRef.current,
          limit: String(REQUESTS_LIMITS.pageDefault),
        }),
        token,
        controller,
      ),
      searchRef.current,
    );
  }
  async function refresh() {
    if (
      !mounted.current ||
      writeFence.current ||
      recoveryRef.current ||
      invalidRecoveryRef.current ||
      !["ready", "denied"].includes(phaseRef.current)
    )
      return;
    const { token, controller } = readStart();
    showPhase("reading");
    setError("");
    try {
      const next = await fetchBoard(token, controller);
      if (alive(token)) {
        showData(next);
        showPhase("ready");
        setNotice("Requests refreshed.");
      }
    } catch (cause) {
      if (!alive(token)) return;
      if (cause instanceof ReadFailure && cause.denied) deny(cause.message);
      else {
        showData(null);
        showPhase("ready");
        setError(
          cause instanceof Error
            ? cause.message
            : "Requests could not be loaded.",
        );
      }
    }
  }
  async function applySearch(event: React.FormEvent) {
    event.preventDefault();
    if (!canAct() || searchInputRef.current.length > REQUESTS_LIMITS.search)
      return;
    searchRef.current = searchInputRef.current;
    setSearch(searchInputRef.current);
    await refresh();
  }
  async function more(status: RequestStatus) {
    if (!canAct()) return;
    const original = dataRef.current!;
    const nextCursor = original.columns[status].nextCursor;
    if (!nextCursor) return;
    const { token, controller } = readStart();
    showPhase("reading");
    setError("");
    try {
      const next = scope(
        decode(
          columnSchema,
          await get(
            new URLSearchParams({
              tenantId: company.id,
              mode: "column",
              status,
              search: searchRef.current,
              limit: String(REQUESTS_LIMITS.pageDefault),
              cursor: nextCursor,
            }),
            token,
            controller,
          ),
        ),
      );
      if (
        next.scopeVersion !== original.scopeVersion ||
        next.search !== searchRef.current ||
        next.status !== status ||
        JSON.stringify(next.counts) !== JSON.stringify(original.counts)
      )
        throw new ReadFailure(
          "The request board changed. Refresh current requests before loading more.",
        );
      const ids = new Set(
        statuses.flatMap((s) =>
          original.columns[s].requests.map((row) => row.id),
        ),
      );
      if (
        next.requests.some(
          (row) =>
            row.tenantId !== company.id ||
            row.status !== status ||
            ids.has(row.id),
        ) ||
        new Set(next.requests.map((row) => row.id)).size !==
          next.requests.length ||
        (next.nextCursor && !next.requests.length)
      )
        throw new ReadFailure("The request page could not be verified.");
      const rows = [...original.columns[status].requests, ...next.requests];
      if (
        rows.length > next.counts[status] ||
        (!next.nextCursor && rows.length !== next.counts[status])
      )
        throw new ReadFailure(
          "The complete request count could not be verified.",
        );
      if (alive(token)) {
        showData({
          ...original,
          serverTime: next.serverTime,
          columns: {
            ...original.columns,
            [status]: { requests: rows, nextCursor: next.nextCursor },
          },
        });
        showPhase("ready");
      }
    } catch (cause) {
      if (!alive(token)) return;
      if (cause instanceof ReadFailure && cause.denied) deny(cause.message);
      else {
        showData(null);
        showPhase("ready");
        setError(
          cause instanceof Error
            ? cause.message
            : "More requests could not be loaded.",
        );
      }
    }
  }
  async function open(request: WorkRequest, event: React.MouseEvent) {
    if (
      !canAct() ||
      !statuses.some((status) =>
        dataRef.current?.columns[status].requests.some(
          (row) => row.id === request.id && row.revision === request.revision,
        ),
      )
    )
      return;
    returnFocus.current = event.currentTarget as HTMLElement;
    showEditor(request.id);
    showDetail(null);
    showAssignees(null);
    changeDraft(blankDraft());
    setAssigneeSearch("");
    assigneeSearchRef.current = "";
    const { token, controller } = readStart();
    showPhase("reading");
    setError("");
    try {
      const next = scope(
        decode(
          detailSchema,
          await get(
            new URLSearchParams({
              tenantId: company.id,
              mode: "detail",
              requestId: request.id,
            }),
            token,
            controller,
          ),
        ),
      );
      if (
        next.request.id !== request.id ||
        next.request.tenantId !== company.id
      )
        throw new ReadFailure("This request could not be verified.");
      if (alive(token) && editorRef.current === request.id) {
        showDetail(next);
        changeDraft(draftFrom(next.request));
        showPhase("ready");
      }
    } catch (cause) {
      if (!alive(token)) return;
      if (cause instanceof ReadFailure && cause.denied) deny(cause.message);
      else {
        showEditor(null);
        showDetail(null);
        showPhase("ready");
        setError(
          cause instanceof Error
            ? cause.message
            : "Request details could not be loaded.",
        );
      }
    }
  }
  function create(event: React.MouseEvent) {
    if (!canAct() || !dataRef.current?.capabilities.canCreate) return;
    returnFocus.current = event.currentTarget as HTMLElement;
    showEditor("create");
    showDetail(null);
    showAssignees(null);
    changeDraft(blankDraft());
    setAssigneeSearch("");
    assigneeSearchRef.current = "";
    setError("");
    setNotice("");
  }
  function close() {
    if (
      editorRef.current !== editor ||
      !mounted.current ||
      writeFence.current ||
      recoveryRef.current ||
      ["saving", "unknown", "conflict"].includes(phaseRef.current)
    )
      return;
    cancelRead();
    showEditor(null);
    showDetail(null);
    showAssignees(null);
    changeDraft(blankDraft());
    showPhase(dataRef.current ? "ready" : "denied");
    requestAnimationFrame(() => {
      if (mounted.current) returnFocus.current?.focus();
    });
  }
  async function picker(more = false) {
    if (
      !canAct() ||
      editorRef.current !== editor ||
      !editorRef.current ||
      !(editorRef.current === "create"
        ? dataRef.current?.capabilities.canManage
        : detailRef.current?.request.canAssign) ||
      assigneeSearchRef.current.length > REQUESTS_LIMITS.search
    )
      return;
    const selectedSearch = assigneeSearchRef.current;
    const original = assigneesRef.current;
    const cursorValue =
      more && original?.search === selectedSearch ? original.nextCursor : null;
    if (more && !cursorValue) return;
    const leaf = editorRef.current,
      { token, controller } = readStart();
    showPhase("reading");
    setError("");
    if (!more) showAssignees(null);
    const query = new URLSearchParams({
      tenantId: company.id,
      mode: "assignees",
      search: selectedSearch,
      limit: String(REQUESTS_LIMITS.pageMax),
    });
    if (cursorValue) query.set("cursor", cursorValue);
    try {
      const next = scope(
        decode(assigneesSchema, await get(query, token, controller)),
      );
      if (
        next.search !== selectedSearch ||
        next.users.some((u) => u.actorId === null) ||
        new Set(next.users.map((u) => u.agentId)).size !== next.users.length ||
        next.users.length > next.matchedCount ||
        (next.nextCursor && !next.users.length)
      )
        throw new ReadFailure("The assignee list could not be verified.");
      let users = next.users;
      if (more && original) {
        if (
          next.scopeVersion !== original.scopeVersion ||
          next.matchedCount !== original.matchedCount ||
          next.users.some((u) =>
            original.users.some((old) => old.agentId === u.agentId),
          )
        )
          throw new ReadFailure("The assignee list changed. Search again.");
        users = [...original.users, ...next.users];
      }
      if (!next.nextCursor && users.length !== next.matchedCount)
        throw new ReadFailure(
          "The complete assignee count could not be verified.",
        );
      if (alive(token) && editorRef.current === leaf) {
        showAssignees({ ...next, users });
        showPhase("ready");
      }
    } catch (cause) {
      if (!alive(token)) return;
      if (cause instanceof ReadFailure && cause.denied) deny(cause.message);
      else {
        showAssignees(null);
        showPhase("ready");
        setError(
          cause instanceof Error
            ? cause.message
            : "Assignees could not be loaded.",
        );
      }
    }
  }
  function selectedAssignee(
    user: RequestsAssigneesData["users"][number] | null,
  ) {
    if (editorRef.current !== editor || !canAct() || !editorRef.current) return;
    const permitted =
      editorRef.current === "create"
        ? dataRef.current?.capabilities.canManage
        : detailRef.current?.request.canAssign;
    if (!permitted) return;
    if (
      user &&
      !assigneesRef.current?.users.some(
        (v) => v.agentId === user.agentId && v.actorId === user.actorId,
      )
    )
      return;
    changeDraft({ ...draftRef.current, assignee: user });
  }
  function savedValue(
    raw: unknown,
    owner: Marker,
    expected: RequestsMutation | null,
  ): RequestsSaved {
    const saved = decode(savedSchema, raw);
    if (
      saved.tenantId !== company.id ||
      saved.actorId !== expectedActor ||
      saved.role !== expectedRole ||
      saved.operationId !== owner.operationId ||
      saved.action !== owner.action
    )
      throw Error("The save acknowledgement could not be verified.");
    if (
      saved.action === "create" &&
      (saved.revision !== 1 || saved.status !== "new")
    )
      throw Error("The new request acknowledgement could not be verified.");
    if (expected && expected.change.action !== "create") {
      const change = expected.change;
      if (
        saved.requestId !== change.requestId ||
        saved.revision !== change.revision + 1 ||
        (change.action === "move" && saved.status !== change.status) ||
        (change.action === "edit" &&
          saved.status !== detailRef.current?.request.status)
      )
        throw Error(
          "The request revision acknowledgement could not be verified.",
        );
    }
    return saved;
  }
  async function finishBoard(
    token: number,
    controller: AbortController,
    owner: RequestsMutation | null,
  ) {
    const next = await fetchBoard(token, controller);
    if (!alive(token) || writeFence.current !== owner)
      throw new DOMException("Stale save", "AbortError");
    showData(next);
    marker(null);
    showOperation(null);
    showDetail(null);
    showEditor(null);
    showAssignees(null);
    changeDraft(blankDraft());
    showPhase("ready");
    setNotice("Request changes saved.");
  }
  async function send(op: RequestsMutation, retry = false) {
    if (!mounted.current || writeFence.current) return;
    if (
      retry
        ? phaseRef.current !== "unknown" || operationRef.current !== op
        : !canAct()
    )
      return;
    cancelRead();
    const token = epoch.current;
    writeFence.current = op;
    showOperation(op);
    marker({
      schemaVersion: 1,
      operationId: op.operationId,
      action: op.change.action,
    });
    showPhase("saving");
    setError("");
    setNotice("");
    setDragged(null);
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op),
      });
      const raw: unknown = await response.json();
      if (!alive(token) || writeFence.current !== op) return;
      if (!response.ok) {
        if (response.status >= 500)
          throw Error(
            "The request save outcome is unknown. Review it before making further changes.",
          );
        if ([401, 403, 404].includes(response.status)) {
          deny(message(raw, "Your request access has changed."));
          return;
        }
        marker(null);
        showOperation(null);
        showPhase(response.status === 409 ? "conflict" : "ready");
        setError(
          message(raw, "The request change was rejected. Review your entries."),
        );
        return;
      }
      if (
        !raw ||
        typeof raw !== "object" ||
        Object.keys(raw).length !== 1 ||
        !("saved" in raw)
      )
        throw Error("The request acknowledgement could not be verified.");
      savedValue(raw.saved, recoveryRef.current!, op);
      const controller = new AbortController();
      readController.current = controller;
      await finishBoard(token, controller, op);
    } catch (cause) {
      if (!alive(token) || writeFence.current !== op) return;
      if (cause instanceof ReadFailure && cause.denied) {
        deny(cause.message);
      } else {
        showPhase("unknown");
        setError(
          cause instanceof Error
            ? cause.message
            : "The request save outcome is unknown.",
        );
      }
    } finally {
      if (writeFence.current === op) writeFence.current = null;
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (editorRef.current !== editor || !canAct() || !editorRef.current) return;
    const current = draftRef.current;
    const selected = detailRef.current?.request;
    if (
      (editorRef.current !== "create" && (!selected || !selected.canEdit)) ||
      (editorRef.current === "create" &&
        !dataRef.current?.capabilities.canCreate)
    )
      return;
    if (
      !current.title.trim() ||
      current.title.length > REQUESTS_LIMITS.title ||
      current.description.length > REQUESTS_LIMITS.description ||
      (current.dueDate && !calendar.safeParse(current.dueDate).success)
    ) {
      setError(
        "Enter a title within 160 characters, description within 5000 characters and a real due date.",
      );
      return;
    }
    const assignment =
      editorRef.current === "create"
        ? dataRef.current?.capabilities.canManage
        : selected?.canAssign;
    const chosen = assignment ? current.assignee : null;
    if (!assignment && selected?.assignee) {
      setError("Current request assignment must be reviewed before editing.");
      return;
    }
    const details = {
      title: current.title,
      description: current.description,
      priority: current.priority,
      dueDate: current.dueDate || null,
      assigneeAgentId: chosen?.agentId || null,
      assigneeActorId: chosen?.actorId || null,
    };
    const op: RequestsMutation = {
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change: selected
        ? {
            action: "edit",
            requestId: selected.id,
            revision: selected.revision,
            ...details,
          }
        : { action: "create", ...details },
    };
    void send(op);
  }
  function move(id: string, expectedRevision: number, status: RequestStatus) {
    if (!canAct()) return;
    const request = statuses
      .flatMap((s) => dataRef.current!.columns[s].requests)
      .find((row) => row.id === id);
    if (
      !request ||
      request.revision !== expectedRevision ||
      !request.canMove ||
      request.status === status ||
      !statuses.includes(status)
    )
      return;
    void send({
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change: {
        action: "move",
        requestId: id,
        revision: expectedRevision,
        status,
      },
    });
  }
  async function recover() {
    if (
      !mounted.current ||
      writeFence.current ||
      !["unknown", "denied"].includes(phaseRef.current) ||
      !recoveryRef.current ||
      recoveryRef.current.operationId !== recovery?.operationId ||
      recoveryRef.current.action !== recovery.action
    )
      return;
    const owner = recoveryRef.current,
      original = operationRef.current,
      { token, controller } = readStart();
    showPhase("reading");
    setError("");
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "reconcile",
          tenantId: company.id,
          operationId: owner.operationId,
          action: owner.action,
        }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!alive(token) || controller.signal.aborted) return;
      if (!response.ok)
        throw new ReadFailure(
          message(raw, "The save outcome could not be reviewed."),
          [401, 403, 404].includes(response.status),
        );
      const result = z
        .strictObject({
          schemaVersion: z.literal(1),
          tenantId: uuid,
          actorId: uuid,
          role,
          operationId: uuid,
          action: z.enum(["create", "edit", "move"]),
          status: z.enum(["recorded", "not_recorded"]),
          saved: savedSchema.nullable(),
        })
        .parse(raw);
      if (
        result.tenantId !== company.id ||
        result.actorId !== expectedActor ||
        result.role !== expectedRole ||
        result.operationId !== owner.operationId ||
        result.action !== owner.action ||
        (result.status === "not_recorded" && result.saved !== null) ||
        (result.status === "recorded" && !result.saved)
      )
        throw Error("The save outcome could not be verified.");
      if (result.saved) savedValue(result.saved, owner, original);
      const next = await fetchBoard(token, controller);
      if (!alive(token) || recoveryRef.current !== owner || writeFence.current)
        return;
      showData(next);
      marker(null);
      showOperation(null);
      showDetail(null);
      showEditor(null);
      showAssignees(null);
      changeDraft(blankDraft());
      showPhase("ready");
      setNotice(
        result.status === "recorded"
          ? "The saved request was confirmed."
          : "The earlier request was not saved. You can enter a new change.",
      );
    } catch (cause) {
      if (!alive(token)) return;
      if (cause instanceof ReadFailure && cause.denied) deny(cause.message);
      else {
        showPhase("unknown");
        setError(
          cause instanceof Error
            ? cause.message
            : "The save outcome could not be reviewed.",
        );
      }
    }
  }
  async function resolveConflict() {
    if (
      !mounted.current ||
      writeFence.current ||
      phaseRef.current !== "conflict" ||
      editorRef.current !== editor
    )
      return;
    const leaf = editorRef.current,
      { token, controller } = readStart();
    showPhase("reading");
    setError("");
    try {
      let nextDetail: RequestsDetailData | null = null;
      if (leaf && leaf !== "create") {
        nextDetail = scope(
          decode(
            detailSchema,
            await get(
              new URLSearchParams({
                tenantId: company.id,
                mode: "detail",
                requestId: leaf,
              }),
              token,
              controller,
            ),
          ),
        );
        if (
          nextDetail.request.id !== leaf ||
          nextDetail.request.tenantId !== company.id
        )
          throw Error("This request could not be verified.");
      }
      const next = await fetchBoard(token, controller);
      if (!alive(token)) return;
      showData(next);
      showDetail(nextDetail);
      showPhase("ready");
      setNotice(
        "Latest requests loaded. Your text is retained; review it before saving again.",
      );
    } catch (cause) {
      if (!alive(token)) return;
      if (cause instanceof ReadFailure && cause.denied) deny(cause.message);
      else {
        showPhase("conflict");
        setError(
          cause instanceof Error
            ? cause.message
            : "Current requests could not be loaded.",
        );
      }
    }
  }
  function trap(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      modal.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ) || [],
    );
    const first = controls[0],
      last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      modal.current?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  function canEditDraft() {
    return (
      canAct() &&
      editorRef.current === editor &&
      (editor === "create"
        ? dataRef.current?.capabilities.canCreate
        : detailRef.current?.request.canEdit &&
          detailRef.current.request.id === editor)
    );
  }
  const locked = phase !== "ready" || !data || hasRecovery || invalidRecovery;
  const request = detail?.request,
    editable =
      editor === "create" ? !!data?.capabilities.canCreate : !!request?.canEdit,
    assignable =
      editor === "create"
        ? !!data?.capabilities.canManage
        : !!request?.canAssign;
  let today = "";
  if (data) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: data.company.time_zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(data.serverTime));
    today = ["year", "month", "day"]
      .map((name) => parts.find((p) => p.type === name)?.value)
      .join("-");
  }
  return (
    <div className="requests-page">
      <header className="requests-heading" inert={!!editor}>
        <h1>Requests</h1>
        <div className="requests-heading-actions">
          <button
            onClick={() => void refresh()}
            disabled={
              phase === "checking" ||
              phase === "reading" ||
              phase === "saving" ||
              phase === "unknown" ||
              phase === "conflict" ||
              hasRecovery ||
              invalidRecovery
            }
          >
            Refresh requests
          </button>
          <button
            className="requests-primary"
            onClick={create}
            disabled={locked || !data?.capabilities.canCreate}
          >
            Create request
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="requests-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="requests-notice">
          {notice}
        </p>
      ) : null}
      {!editor &&
      (phase === "unknown" ||
        phase === "saving" ||
        phase === "conflict" ||
        (phase === "denied" && hasRecovery)) ? (
        <section
          className="requests-recovery"
          aria-label="Request save recovery"
        >
          <p>
            {phase === "saving"
              ? "Saving this request. Wait before making another change."
              : phase === "conflict"
                ? "The current request changed. Reload it to review your retained text before saving."
                : "The save outcome has not been confirmed. New changes stay locked until it is reviewed."}
          </p>
          <div className="requests-recovery-actions">
            {phase === "unknown" || (phase === "denied" && hasRecovery) ? (
              <>
                <button onClick={() => void recover()}>
                  Review save outcome
                </button>
                {operation ? (
                  <button onClick={() => void send(operation, true)}>
                    Retry exact save
                  </button>
                ) : null}
              </>
            ) : phase === "conflict" ? (
              <button onClick={() => void resolveConflict()}>
                Reload current request
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <div inert={!!editor}>
        <div className="requests-toolbar">
          <form className="requests-search" onSubmit={applySearch}>
            <input
              aria-label="Search requests"
              value={searchInput}
              maxLength={REQUESTS_LIMITS.search}
              disabled={locked}
              onChange={(event) => {
                if (canAct()) {
                  searchInputRef.current = event.target.value;
                  setSearchInput(event.target.value);
                }
              }}
              placeholder="Search title or description"
            />
            <button disabled={locked}>Search</button>
          </form>
          <p className="requests-scope">
            {data?.capabilities.canManage
              ? "Company requests"
              : "Requests you created or are currently assigned"}
            {data ? ` · ${data.counts.total} matching requests` : ""}
          </p>
        </div>
        {data ? (
          <div
            className="requests-board"
            aria-busy={phase === "reading" || phase === "saving"}
          >
            {statuses.map((status) => (
              <section
                key={status}
                className="requests-column"
                aria-labelledby={`requests-${status}`}
                data-drop={!!dragged && dragged.id !== "" && !locked}
                onDragOver={(event) => {
                  if (canAct() && dragged) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!canAct()) return;
                  try {
                    const parsed = z
                      .strictObject({ id: uuid, revision })
                      .parse(
                        JSON.parse(event.dataTransfer.getData("text/plain")),
                      );
                    setDragged(null);
                    move(parsed.id, parsed.revision, status);
                  } catch {
                    setDragged(null);
                  }
                }}
              >
                <div className="requests-column-heading">
                  <h2 id={`requests-${status}`}>{statusLabels[status]}</h2>
                  <span
                    className="requests-column-count"
                    aria-label={`${statusLabels[status]} request count`}
                  >
                    {data.counts[status]}
                  </span>
                </div>
                <div className="requests-column-list">
                  {data.columns[status].requests.map((row) => (
                    <article
                      key={row.id}
                      className="requests-card"
                      draggable={!locked && row.canMove}
                      onDragStart={(event) => {
                        if (!canAct() || !row.canMove) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.setData(
                          "text/plain",
                          JSON.stringify({
                            id: row.id,
                            revision: row.revision,
                          }),
                        );
                        event.dataTransfer.effectAllowed = "move";
                        setDragged({ id: row.id, revision: row.revision });
                      }}
                      onDragEnd={() => setDragged(null)}
                    >
                      <button
                        className="requests-card-title"
                        disabled={locked}
                        onClick={(event) => void open(row, event)}
                      >
                        {row.title}
                      </button>
                      <p className="requests-card-description">
                        {row.description.length > 180
                          ? row.description.slice(0, 180) + "…"
                          : row.description || "No description"}
                      </p>
                      <div className="requests-card-meta">
                        <span
                          className={`requests-priority requests-priority-${row.priority}`}
                        >
                          {row.priority}
                        </span>
                        {row.dueDate ? (
                          <time
                            className="requests-due"
                            dateTime={row.dueDate}
                            data-overdue={
                              row.status !== "done" && row.dueDate < today
                            }
                          >
                            Due {formatEmploymentDate(row.dueDate)}
                          </time>
                        ) : null}
                      </div>
                      <div className="requests-card-people">
                        <div className="requests-card-person">
                          <span className="requests-avatar" aria-hidden="true">
                            {initials(row.requester.name)}
                          </span>
                          <span>Requested by {row.requester.name}</span>
                        </div>
                        <div className="requests-card-person">
                          <span className="requests-avatar" aria-hidden="true">
                            {row.assignee ? initials(row.assignee.name) : "—"}
                          </span>
                          <span>
                            {row.assignee
                              ? `Assigned to ${row.assignee.name}${row.assignee.eligible ? "" : " (unavailable)"}`
                              : "Unassigned"}
                          </span>
                        </div>
                      </div>
                      {row.canMove ? (
                        <label className="requests-card-status">
                          Status
                          <select
                            aria-label={`Status for ${row.title}`}
                            value={row.status}
                            disabled={locked}
                            onChange={(event) =>
                              move(
                                row.id,
                                row.revision,
                                event.target.value as RequestStatus,
                              )
                            }
                          >
                            {statuses.map((value) => (
                              <option key={value} value={value}>
                                {statusLabels[value]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </article>
                  ))}
                </div>
                {!data.columns[status].requests.length ? (
                  <div className="requests-empty">
                    {search
                      ? "No requests match this search."
                      : "No requests in this column."}
                  </div>
                ) : null}
                {data.columns[status].nextCursor ? (
                  <div className="requests-column-footer">
                    <button disabled={locked} onClick={() => void more(status)}>
                      Load more {statusLabels[status].toLowerCase()} requests
                    </button>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        ) : (
          <div className="requests-empty">
            {phase === "checking"
              ? "Checking request access…"
              : "The request board is unavailable. Refresh or review the save outcome to continue."}
          </div>
        )}
      </div>
      {editor ? (
        <div className="requests-modal">
          <div
            className="requests-editor"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-labelledby="requests-editor-title"
            ref={modal}
            onKeyDown={trap}
          >
            <form onSubmit={submit}>
              <div className="requests-editor-heading">
                <h2 id="requests-editor-title">
                  {editor === "create"
                    ? "Create request"
                    : editable
                      ? "Edit request"
                      : "Request details"}
                </h2>
                <button
                  type="button"
                  aria-label="Close request details"
                  onClick={close}
                  disabled={
                    hasRecovery ||
                    ["saving", "unknown", "conflict"].includes(phase)
                  }
                >
                  ×
                </button>
              </div>
              <div className="requests-editor-body">
                {phase === "reading" && !detail && editor !== "create" ? (
                  <p role="status">Loading current request…</p>
                ) : (
                  <>
                    <label>
                      Title
                      <input
                        ref={titleInput}
                        value={draft.title}
                        maxLength={REQUESTS_LIMITS.title}
                        required
                        disabled={locked || !editable}
                        onChange={(event) => {
                          if (canEditDraft())
                            changeDraft({
                              ...draftRef.current,
                              title: event.target.value,
                            });
                        }}
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        value={draft.description}
                        maxLength={REQUESTS_LIMITS.description}
                        disabled={locked || !editable}
                        onChange={(event) => {
                          if (canEditDraft())
                            changeDraft({
                              ...draftRef.current,
                              description: event.target.value,
                            });
                        }}
                      />
                    </label>
                    <div className="requests-editor-row">
                      <label>
                        Priority
                        <select
                          aria-label="Priority"
                          value={draft.priority}
                          disabled={locked || !editable}
                          onChange={(event) => {
                            if (canEditDraft())
                              changeDraft({
                                ...draftRef.current,
                                priority: event.target.value as RequestPriority,
                              });
                          }}
                        >
                          {(["low", "normal", "high"] as const).map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Due date
                        <input
                          type="date"
                          min="0001-01-01"
                          max="9999-12-31"
                          value={draft.dueDate}
                          disabled={locked || !editable}
                          onChange={(event) => {
                            if (canEditDraft())
                              changeDraft({
                                ...draftRef.current,
                                dueDate: event.target.value,
                              });
                          }}
                        />
                      </label>
                    </div>
                    <p className="requests-editor-help">
                      Due dates use the company calendar
                      {data ? ` (${data.company.time_zone})` : ""}. No
                      notifications are sent.
                    </p>
                    <div>
                      <p className="requests-editor-help">
                        Assignee:{" "}
                        <strong className="requests-assignee-name">
                          {draft.assignee?.name || "Unassigned"}
                        </strong>
                      </p>
                      {request?.assignee && !request.assignee.eligible ? (
                        <p className="requests-editor-help">
                          This assignee is unavailable. Choose an active user or
                          leave the request unassigned before saving.
                        </p>
                      ) : null}
                    </div>
                    {assignable ? (
                      <div className="requests-assignees">
                        <div className="requests-assignee-search">
                          <input
                            aria-label="Search assignees"
                            placeholder="Find active linked users"
                            maxLength={REQUESTS_LIMITS.search}
                            value={assigneeSearch}
                            disabled={locked}
                            onChange={(event) => {
                              if (canAct()) {
                                assigneeSearchRef.current = event.target.value;
                                setAssigneeSearch(event.target.value);
                                showAssignees(null);
                              }
                            }}
                          />
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => void picker()}
                          >
                            Find users
                          </button>
                        </div>
                        <div className="requests-assignee-list">
                          <button
                            type="button"
                            aria-pressed={!draft.assignee}
                            disabled={locked}
                            onClick={() => selectedAssignee(null)}
                          >
                            Unassigned
                          </button>
                          {assignees?.users.map((user) => (
                            <button
                              type="button"
                              key={user.agentId}
                              aria-pressed={
                                draft.assignee?.agentId === user.agentId &&
                                draft.assignee.actorId === user.actorId
                              }
                              disabled={locked}
                              onClick={() => selectedAssignee(user)}
                            >
                              {user.name}
                            </button>
                          ))}
                        </div>
                        {assignees ? (
                          <p className="requests-editor-help">
                            {assignees.users.length} of {assignees.matchedCount}{" "}
                            matching users
                          </p>
                        ) : null}
                        {assignees?.nextCursor ? (
                          <button
                            className="requests-assignee-more"
                            type="button"
                            disabled={locked}
                            onClick={() => void picker(true)}
                          >
                            Load more users
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {request ? (
                      <p className="requests-editor-help">
                        Requested by {request.requester.name} ·{" "}
                        {statusLabels[request.status]} · Revision{" "}
                        {request.revision}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
              <div className="requests-editor-footer">
                {error ? (
                  <p role="alert" className="requests-error">
                    {error}
                  </p>
                ) : null}
                {notice ? (
                  <p role="status" className="requests-notice">
                    {notice}
                  </p>
                ) : null}
                {phase === "unknown" || (phase === "denied" && hasRecovery) ? (
                  <>
                    <button type="button" onClick={() => void recover()}>
                      Review save outcome
                    </button>
                    {operation ? (
                      <button
                        type="button"
                        onClick={() => void send(operation, true)}
                      >
                        Retry exact save
                      </button>
                    ) : null}
                  </>
                ) : phase === "conflict" ? (
                  <button type="button" onClick={() => void resolveConflict()}>
                    Reload current request
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  disabled={
                    hasRecovery ||
                    ["saving", "unknown", "conflict"].includes(phase)
                  }
                >
                  Cancel
                </button>
                {editable ? (
                  <button className="requests-primary" disabled={locked}>
                    {phase === "saving" ? "Saving…" : "Save request"}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
