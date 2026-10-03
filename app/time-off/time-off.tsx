"use client";
import { useEffect, useRef, useState } from "react";
import type { Company, Member } from "../../lib/agent-types";
import type {
  TimeOffData,
  TimeOffRequest,
  TimeOffType,
  TimeOffChange,
  TimeOffStatus,
  TimeOffSaved,
} from "../../lib/time-off-types";
import { formatEmploymentDate } from "../../lib/agent-dates";
import "./time-off.css";

type Props = {
  company: Company;
  role: Member["role"];
  initialData: TimeOffData;
};
type Phase = "checking" | "ready" | "reading" | "saving" | "unknown";
type Filters = {
  view: "mine" | "team";
  status: "all" | TimeOffStatus;
  search: string;
  startDate: string;
  endDate: string;
  typeId: string;
  agentId: string;
  agentName: string;
};
type Operation = {
  tenantId: string;
  operationId: string;
  change: TimeOffChange;
};
type RequestDraft = {
  typeId: string;
  startDate: string;
  endDate: string;
  note: string;
};
type Decision = {
  request: TimeOffRequest;
  action: "approve" | "reject" | "cancel" | "withdraw";
};
const blankFilters: Filters = {
  view: "mine",
  status: "all",
  search: "",
  startDate: "",
  endDate: "",
  typeId: "",
  agentId: "",
  agentName: "",
};
const blankRequest: RequestDraft = {
  typeId: "",
  startDate: "",
  endDate: "",
  note: "",
};
const statuses: TimeOffStatus[] = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "cancelled",
];
const labels: Record<TimeOffStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};
const actionNames = {
  approve: "Approve request",
  reject: "Reject request",
  cancel: "Cancel approved request",
  withdraw: "Withdraw request",
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function calendarDays(start: string, end: string) {
  if (
    ![start, end].every(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !value.startsWith("0000-") &&
        Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value,
    )
  )
    return null;
  return (
    Math.round(
      (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
        86400000,
    ) + 1
  );
}
function appendRequests(current: TimeOffRequest[], next: TimeOffRequest[]) {
  const ids = new Set(current.map((request) => request.id));
  return [...current, ...next.filter((request) => !ids.has(request.id))];
}
function allowedDecision(request: TimeOffRequest, action: Decision["action"]) {
  return action === "approve"
    ? request.canApprove
    : action === "reject"
      ? request.canReject
      : action === "cancel"
        ? request.canCancel
        : request.canWithdraw;
}
export default function TimeOff(props: Props) {
  return (
    <TimeOffContent
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}:${props.initialData.agent?.id || "unlinked"}`}
      {...props}
    />
  );
}
function TimeOffContent({ company, initialData }: Props) {
  const [data, setData] = useState<TimeOffData | null>(initialData);
  const [phase, setPhase] = useState<Phase>("checking");
  const [writePending, setWritePending] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState<Filters>(blankFilters);
  const [filters, setFilters] = useState<Filters>(blankFilters);
  const [tab, setTab] = useState<"requests" | "types">("requests");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RequestDraft>(blankRequest);
  const [typeDraft, setTypeDraft] = useState({
    name: "",
    description: "",
    paid: true,
  });
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [archiveType, setArchiveType] = useState<TimeOffType | null>(null);
  const mounted = useRef(true);
  const readRequest = useRef<AbortController | null>(null);
  const writeBusy = useRef<string | null>(null);
  const requestDialog = useRef<HTMLDialogElement>(null);
  const typeDialog = useRef<HTMLDialogElement>(null);
  const decisionDialog = useRef<HTMLDialogElement>(null);
  const archiveDialog = useRef<HTMLDialogElement>(null);
  const storageKey = `ct-alt:time-off:${initialData.actorId}:${company.id}`;
  useEffect(() => {
    mounted.current = true;
    let recovery = false;
    try {
      recovery = sessionStorage.getItem(storageKey) !== null;
    } catch {}
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      if (recovery) setData(null);
      setPhase(recovery ? "unknown" : "ready");
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      readRequest.current?.abort();
    };
  }, [storageKey]);
  const locked = phase !== "ready" || !data || writePending;
  const selected = data?.requests.find((request) => request.id === selectedId);
  const activeTypes =
    data?.types.filter((type) => type.status === "active") || [];
  const days = calendarDays(draft.startDate, draft.endDate);
  const dateError =
    draft.startDate &&
    draft.endDate &&
    (days === null || days < 1 || days > 366)
      ? "Choose valid dates, with an end on or after the start, for up to 366 calendar days."
      : "";
  const filterDays = calendarDays(filters.startDate, filters.endDate);
  const filterError =
    (filters.startDate || filters.endDate) &&
    (filterDays === null || filterDays < 1 || filterDays > 366)
      ? "Choose both filter dates in order, spanning up to 366 calendar days."
      : "";
  const canSubmitRequest =
    !locked &&
    !!data?.capabilities.canRequest &&
    activeTypes.some((type) => type.id === draft.typeId) &&
    days !== null &&
    days >= 1 &&
    days <= 366 &&
    draft.note.length <= 2000;
  const timeZone = data?.timeZone || initialData.timeZone;
  const formatTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  function closeEditors() {
    requestDialog.current?.close();
    typeDialog.current?.close();
    decisionDialog.current?.close();
    archiveDialog.current?.close();
    setDraft(blankRequest);
    setTypeDraft({ name: "", description: "", paid: true });
    setDecision(null);
    setReason("");
    setArchiveType(null);
  }
  function clearAccess() {
    readRequest.current?.abort();
    readRequest.current = null;
    setData(null);
    setSelectedId(null);
    setTab("requests");
    setQuery(blankFilters);
    setFilters(blankFilters);
    closeEditors();
    setPhase("unknown");
  }
  function marker(value: Operation) {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          operationId: value.operationId,
          action: value.change.action,
        }),
      );
    } catch {}
  }
  function clearMarker() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }
  async function load(
    nextQuery: Filters | null = query,
    cursor: string | null = null,
    acknowledgedId?: string,
  ) {
    if (!mounted.current) return false;
    if (writeBusy.current && writeBusy.current !== acknowledgedId) return false;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    setPhase("reading");
    setError("");
    setNotice("");
    if (nextQuery) {
      setQuery(nextQuery);
      setFilters(nextQuery);
    }
    if (!cursor) {
      setSelectedId(null);
      setData((current) =>
        current ? { ...current, requests: [], nextCursor: null } : null,
      );
    }
    const params = new URLSearchParams({ tenantId: company.id, limit: "50" });
    if (nextQuery) {
      params.set("view", nextQuery.view);
      params.set("status", nextQuery.status);
      for (const key of [
        "search",
        "startDate",
        "endDate",
        "typeId",
        "agentId",
      ] as const)
        if (nextQuery[key]) params.set(key, nextQuery[key]);
    }
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/time-off?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your Time Off access could not be verified. Refresh to check your current access."
            : "Time Off could not be loaded. Changes remain locked until a successful refresh.",
        );
      const next = (await response.json()) as TimeOffData;
      if (
        !mounted.current ||
        controller.signal.aborted ||
        readRequest.current !== controller
      )
        return false;
      if (
        !next ||
        next.company?.id !== company.id ||
        next.actorId !== initialData.actorId ||
        !Array.isArray(next.requests) ||
        !Array.isArray(next.types) ||
        next.requests.some((request) => request.tenant_id !== company.id) ||
        !next.counts ||
        ["total", ...statuses].some(
          (key) =>
            !Number.isSafeInteger(
              next.counts[key as keyof TimeOffData["counts"]],
            ) || next.counts[key as keyof TimeOffData["counts"]] < 0,
        ) ||
        !next.capabilities ||
        !(next.nextCursor === null || typeof next.nextCursor === "string")
      )
        throw new Error(
          "The Time Off response could not be verified. Refresh to recover.",
        );
      new Intl.DateTimeFormat("en-GB", { timeZone: next.timeZone }).format(
        new Date(next.serverTime),
      );
      const sameScope =
        next.agent?.id === data?.agent?.id &&
        next.role === data?.role &&
        next.timeZone === data?.timeZone;
      if (!sameScope) {
        closeEditors();
        setSelectedId(null);
      }
      setData((current) => ({
        ...next,
        requests:
          cursor && sameScope && current
            ? appendRequests(current.requests, next.requests)
            : next.requests,
      }));
      if (!nextQuery) {
        setQuery(blankFilters);
        setFilters(blankFilters);
        setTab("requests");
      }
      if (!next.capabilities.canManageTypes) setTab("requests");
      setOperation(null);
      setPhase("ready");
      clearMarker();
      return next;
    } catch (cause) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        readRequest.current === controller
      ) {
        clearAccess();
        setError(
          cause instanceof Error
            ? cause.message
            : "Time Off could not be loaded. Refresh to recover.",
        );
      }
      return false;
    }
  }
  async function perform(value: Operation, after: Filters = query) {
    if (writeBusy.current) return;
    writeBusy.current = value.operationId;
    setWritePending(true);
    readRequest.current?.abort();
    readRequest.current = null;
    marker(value);
    setOperation(value);
    setPhase("saving");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        keepalive: true,
      });
      if (!mounted.current) return;
      if (!response.ok) {
        let message =
          "The action was not acknowledged. Review the latest Time Off records before another change.";
        try {
          const result = await response.json();
          if (typeof result?.error === "string") message = result.error;
        } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      if (!mounted.current) return;
      const saved = result?.saved as TimeOffSaved | undefined;
      if (
        !saved ||
        saved.operationId !== value.operationId ||
        saved.action !== value.change.action ||
        !uuid.test(saved.typeId) ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision !==
          ("revision" in value.change ? value.change.revision + 1 : 1) ||
        ("typeId" in value.change && saved.typeId !== value.change.typeId) ||
        ("requestId" in value.change &&
          saved.requestId !== value.change.requestId) ||
        (value.change.action === "request" &&
          (!saved.requestId || !uuid.test(saved.requestId)))
      )
        throw new Error(
          "The action could not be confirmed. Refresh to recover before another change.",
        );
      const next = await load(after, null, value.operationId);
      if (next && mounted.current)
        setNotice(
          value.change.action === "request"
            ? "Request sent for approval."
            : value.change.action === "create_type" ||
                value.change.action === "archive_type"
              ? "Leave type updated."
              : "Request updated.",
        );
    } catch (cause) {
      if (mounted.current) {
        clearAccess();
        setError(
          cause instanceof Error
            ? cause.message
            : "The response was interrupted. The action may have saved. Refresh to recover.",
        );
      }
    } finally {
      writeBusy.current = null;
      if (mounted.current) setWritePending(false);
    }
  }
  function change(value: TimeOffChange, after = query) {
    if (locked || writeBusy.current) return;
    void perform(
      { tenantId: company.id, operationId: crypto.randomUUID(), change: value },
      after,
    );
  }
  function openRequest() {
    if (locked || !data?.capabilities.canRequest || !activeTypes.length) return;
    setDraft({ ...blankRequest, typeId: activeTypes[0].id });
    requestDialog.current?.showModal();
  }
  function submitRequest() {
    if (!canSubmitRequest || !data?.agent) return;
    const value: TimeOffChange = {
      action: "request",
      agentId: data.agent.id,
      typeId: draft.typeId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      note: draft.note,
    };
    requestDialog.current?.close();
    change(value, blankFilters);
  }
  function openDecision(request: TimeOffRequest, action: Decision["action"]) {
    if (locked || !allowedDecision(request, action)) return;
    setDecision({ request, action });
    setReason("");
    decisionDialog.current?.showModal();
  }
  function decide() {
    if (
      locked ||
      !decision ||
      !allowedDecision(decision.request, decision.action) ||
      ((decision.action === "reject" || decision.action === "cancel") &&
        !reason.trim()) ||
      reason.length > 1000
    )
      return;
    const value: TimeOffChange =
      decision.action === "withdraw"
        ? {
            action: "withdraw",
            requestId: decision.request.id,
            revision: decision.request.revision,
          }
        : {
            action: decision.action,
            requestId: decision.request.id,
            revision: decision.request.revision,
            reason: reason.trim(),
          };
    decisionDialog.current?.close();
    change(value);
  }
  function filterUser(request: TimeOffRequest) {
    if (!data?.capabilities.canViewTeam || writeBusy.current) return;
    setTab("requests");
    void load({
      ...query,
      view: "team",
      agentId: request.agent_id,
      agentName: request.agent_name,
    });
  }
  function switchView(view: Filters["view"]) {
    if (
      writeBusy.current ||
      phase === "checking" ||
      (view === "team" && !data?.capabilities.canViewTeam)
    )
      return;
    setTab("requests");
    void load({ ...blankFilters, view });
  }
  const knownTypes = new Map(
    (data?.types || []).map((type) => [
      type.id,
      { name: type.name, archived: type.status === "archived" },
    ]),
  );
  data?.requests.forEach((request) => {
    if (!knownTypes.has(request.type_id))
      knownTypes.set(request.type_id, {
        name: request.type_name,
        archived: true,
      });
  });
  return (
    <div className="time-off-page">
      <header className="time-off-heading">
        <div>
          <h1>Time Off</h1>
          <p>Request leave and review your team’s absences</p>
        </div>
        <div className="time-off-heading-actions">
          <button
            disabled={writePending || phase === "checking"}
            onClick={() => void load(data ? query : null)}
          >
            Refresh Time Off
          </button>
          {data?.capabilities.canRequest && (
            <button
              className="leave-primary"
              disabled={locked || !activeTypes.length}
              onClick={openRequest}
            >
              Request time off
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="leave-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="leave-notice" role="status">
          {notice}
        </p>
      )}
      {phase === "unknown" && (
        <section className="leave-recovery" aria-label="Time Off recovery">
          <h2>Review Time Off before continuing</h2>
          <p>
            {writePending
              ? "The last action is still awaiting a response. New changes remain locked until it settles."
              : operation
                ? "The last action may have saved. Refresh to review the latest records or retry the same request. New changes remain locked."
                : "Changes remain locked until your latest records and current access are successfully loaded."}
          </p>
          <div>
            <button disabled={writePending} onClick={() => void load(null)}>
              Refresh to recover
            </button>
            {operation && (
              <button
                disabled={writePending}
                onClick={() => void perform(operation)}
              >
                Retry last action
              </button>
            )}
          </div>
        </section>
      )}
      <div
        className="leave-feature"
        aria-busy={phase === "reading" || phase === "saving"}
      >
        <nav className="leave-tabs" aria-label="Time Off views">
          <button
            aria-current={
              tab === "requests" && query.view === "mine" ? "page" : undefined
            }
            disabled={writePending || phase === "checking"}
            onClick={() => switchView("mine")}
          >
            My requests
          </button>
          {data?.capabilities.canViewTeam && (
            <button
              aria-current={
                tab === "requests" && query.view === "team" ? "page" : undefined
              }
              disabled={writePending || phase === "checking"}
              onClick={() => switchView("team")}
            >
              Team requests
            </button>
          )}
          {data?.capabilities.canManageTypes && (
            <button
              aria-current={tab === "types" ? "page" : undefined}
              disabled={locked}
              onClick={() => {
                setTab("types");
                setSelectedId(null);
              }}
            >
              Leave types
            </button>
          )}
        </nav>
        {data && phase !== "checking" ? (
          tab === "types" && data.capabilities.canManageTypes ? (
            <section className="leave-types" aria-label="Leave types">
              <div className="leave-section-heading">
                <div>
                  <h2>Leave types</h2>
                  <p>
                    Define paid or unpaid categories for full calendar-day
                    requests.
                  </p>
                </div>
                <button
                  className="leave-primary"
                  disabled={locked || activeTypes.length >= 100}
                  onClick={() => {
                    if (locked || !data.capabilities.canManageTypes) return;
                    setTypeDraft({ name: "", description: "", paid: true });
                    typeDialog.current?.showModal();
                  }}
                >
                  Add leave type
                </button>
              </div>
              {activeTypes.length >= 100 && (
                <p className="leave-help">
                  Up to 100 active leave types are supported. Archive an unused
                  type before adding another.
                </p>
              )}
              {data.types.length ? (
                <ul className="leave-type-list">
                  {data.types.map((type) => (
                    <li key={type.id}>
                      <div>
                        <strong>{type.name}</strong>
                        <span className="leave-type-payment">
                          {type.paid ? "Paid" : "Unpaid"}
                        </span>
                        <p>{type.description || "No description added."}</p>
                      </div>
                      <button
                        disabled={
                          locked || !type.canArchive || type.status !== "active"
                        }
                        onClick={() => {
                          if (locked || !type.canArchive) return;
                          setArchiveType(type);
                          archiveDialog.current?.showModal();
                        }}
                      >
                        Archive {type.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="leave-empty">
                  <strong>No leave types yet</strong>Add a type before users can
                  request time off.
                </div>
              )}
              <p className="leave-help">
                Archiving stops new requests for this type. Existing requests
                retain their original details and can still be reviewed.
              </p>
            </section>
          ) : (
            <section
              className="leave-requests"
              aria-label={
                query.view === "team" ? "Team requests" : "My requests"
              }
            >
              <div className="leave-counts" aria-label="Request status counts">
                {(["total", ...statuses] as const).map((status) => (
                  <button
                    key={status}
                    disabled={writePending}
                    aria-pressed={
                      query.status === (status === "total" ? "all" : status)
                    }
                    onClick={() =>
                      void load({
                        ...query,
                        status: status === "total" ? "all" : status,
                      })
                    }
                  >
                    <span>
                      {status === "total" ? "All requests" : labels[status]}
                    </span>
                    <strong>
                      {phase === "reading" ? "—" : data.counts[status]}
                    </strong>
                  </button>
                ))}
              </div>
              <form
                className="leave-filters"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!writeBusy.current && !filterError)
                    void load({ ...filters, search: filters.search.trim() });
                }}
              >
                <label>
                  Search requests
                  <input
                    type="search"
                    maxLength={100}
                    disabled={writePending}
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        search: event.target.value,
                      }))
                    }
                    placeholder="User, leave type or note"
                  />
                </label>
                <label>
                  From date
                  <input
                    type="date"
                    disabled={writePending}
                    value={filters.startDate}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        startDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  To date
                  <input
                    type="date"
                    disabled={writePending}
                    value={filters.endDate}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        endDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Request status
                  <select
                    aria-label="Request status"
                    disabled={writePending}
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        status: event.target.value as Filters["status"],
                      }))
                    }
                  >
                    <option value="all">All statuses</option>
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {labels[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Leave type filter
                  <select
                    aria-label="Leave type filter"
                    disabled={writePending}
                    value={filters.typeId}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        typeId: event.target.value,
                      }))
                    }
                  >
                    <option value="">All leave types</option>
                    {[...knownTypes].map(([id, type]) => (
                      <option key={id} value={id}>
                        {type.name}
                        {type.archived ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={writePending || !!filterError}>
                  Apply filters
                </button>
                <button
                  type="button"
                  disabled={writePending}
                  onClick={() =>
                    void load({ ...blankFilters, view: query.view })
                  }
                >
                  Clear filters
                </button>
                {filters.agentId && (
                  <div className="leave-user-filter">
                    <span>User: {filters.agentName}</span>
                    <button
                      type="button"
                      aria-label="Clear user filter"
                      disabled={writePending}
                      onClick={() =>
                        void load({ ...query, agentId: "", agentName: "" })
                      }
                    >
                      ×
                    </button>
                  </div>
                )}
                {filterError && <p role="alert">{filterError}</p>}
                <p className="leave-filter-help">
                  Date filters include requests overlapping either date,
                  inclusively. Search applies to all accessible request names,
                  leave types and notes; choose “Filter this user” in a request
                  for one user.
                </p>
              </form>
              <div
                className={`leave-workspace${selected ? " has-detail" : ""}`}
              >
                <div>
                  {phase === "reading" && !data.requests.length ? (
                    <p className="leave-empty" role="status">
                      Loading requests…
                    </p>
                  ) : data.requests.length ? (
                    <div className="leave-table-scroll">
                      <table className="leave-table">
                        <caption className="sr-only">
                          {query.view === "team"
                            ? "Team Time Off requests"
                            : "My Time Off requests"}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">User</th>
                            <th scope="col">Leave type</th>
                            <th scope="col">Dates</th>
                            <th scope="col">Calendar days</th>
                            <th scope="col">Status</th>
                            <th scope="col">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.requests.map((request) => (
                            <tr
                              key={request.id}
                              aria-selected={request.id === selectedId}
                            >
                              <td>
                                <strong>{request.agent_name}</strong>
                              </td>
                              <td>
                                {request.type_name}
                                <small>
                                  {request.type_paid ? "Paid" : "Unpaid"}
                                </small>
                              </td>
                              <td>
                                {formatEmploymentDate(request.start_date)}
                                <span>
                                  to {formatEmploymentDate(request.end_date)}
                                </span>
                              </td>
                              <td>{request.calendar_days}</td>
                              <td>
                                <span
                                  className={`leave-status leave-status-${request.status}`}
                                >
                                  {labels[request.status]}
                                </span>
                              </td>
                              <td>
                                <button
                                  aria-label={`View ${request.agent_name} ${request.type_name} request starting ${request.start_date}`}
                                  disabled={locked}
                                  onClick={() => setSelectedId(request.id)}
                                >
                                  View request
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="leave-empty">
                      <strong>No requests to show</strong>No requests match this
                      view and its applied filters.
                    </div>
                  )}
                  {data.nextCursor && (
                    <div className="leave-pagination">
                      <button
                        disabled={phase === "reading" || writePending}
                        onClick={() => void load(query, data.nextCursor)}
                      >
                        Load older requests
                      </button>
                    </div>
                  )}
                  <p className="leave-help">
                    {data.requests.length} shown. Status counts share the date,
                    user, leave-type and search scope, before the status filter.
                  </p>
                </div>
                {selected && (
                  <section
                    className="leave-detail"
                    aria-label="Request details"
                  >
                    <div className="leave-detail-heading">
                      <h2>{selected.agent_name}</h2>
                      <button
                        aria-label="Close request details"
                        onClick={() => setSelectedId(null)}
                      >
                        ×
                      </button>
                    </div>
                    <span
                      className={`leave-status leave-status-${selected.status}`}
                    >
                      {labels[selected.status]}
                    </span>
                    <h3>{selected.type_name}</h3>
                    <p>
                      {selected.type_paid ? "Paid" : "Unpaid"} ·{" "}
                      {selected.calendar_days}{" "}
                      {selected.calendar_days === 1
                        ? "calendar day"
                        : "calendar days"}
                    </p>
                    <p>
                      {formatEmploymentDate(selected.start_date)} –{" "}
                      {formatEmploymentDate(selected.end_date)}
                    </p>
                    {selected.type_description && (
                      <p className="leave-description">
                        {selected.type_description}
                      </p>
                    )}
                    <dl>
                      <div>
                        <dt>Note</dt>
                        <dd className="leave-note">
                          {selected.note || "No note added."}
                        </dd>
                      </div>
                      <div>
                        <dt>Requested</dt>
                        <dd>
                          <time dateTime={selected.requested_at}>
                            {formatTime.format(new Date(selected.requested_at))}
                          </time>
                        </dd>
                      </div>
                      {selected.decision_name && (
                        <div>
                          <dt>Reviewed by</dt>
                          <dd>{selected.decision_name}</dd>
                        </div>
                      )}
                      {selected.decision_reason && (
                        <div>
                          <dt>Reason</dt>
                          <dd className="leave-note">
                            {selected.decision_reason}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="leave-detail-actions">
                      {selected.status === "pending" && (
                        <>
                          {query.view === "team" && (
                            <>
                              <button
                                className="leave-primary"
                                disabled={locked || !selected.canApprove}
                                onClick={() =>
                                  openDecision(selected, "approve")
                                }
                              >
                                Approve request
                              </button>
                              <button
                                className="leave-danger"
                                disabled={locked || !selected.canReject}
                                onClick={() => openDecision(selected, "reject")}
                              >
                                Reject request
                              </button>
                            </>
                          )}
                          {selected.canWithdraw && (
                            <button
                              disabled={locked}
                              onClick={() => openDecision(selected, "withdraw")}
                            >
                              Withdraw request
                            </button>
                          )}
                        </>
                      )}
                      {selected.status === "approved" &&
                        data.capabilities.canViewTeam && (
                          <button
                            className="leave-danger"
                            disabled={locked || !selected.canCancel}
                            onClick={() => openDecision(selected, "cancel")}
                          >
                            Cancel approved request
                          </button>
                        )}
                      {data.capabilities.canViewTeam && (
                        <button
                          disabled={writePending}
                          onClick={() => filterUser(selected)}
                        >
                          Filter this user
                        </button>
                      )}
                    </div>
                    <h3>Request history</h3>
                    <ol className="leave-history">
                      {selected.history.map((event) => (
                        <li key={event.revision}>
                          <strong>
                            {event.action === "request"
                              ? "Requested"
                              : event.action === "approve"
                                ? "Approved"
                                : event.action === "reject"
                                  ? "Rejected"
                                  : event.action === "withdraw"
                                    ? "Withdrawn"
                                    : event.action === "cancel"
                                      ? "Cancelled"
                                      : event.action}
                          </strong>
                          <span>
                            {event.actor_name} ·{" "}
                            <time dateTime={event.occurred_at}>
                              {formatTime.format(new Date(event.occurred_at))}
                            </time>
                          </span>
                          {event.reason && <p>{event.reason}</p>}
                        </li>
                      ))}
                    </ol>
                    <p className="leave-help">
                      Names and leave-type details are retained as recorded.
                      Historical entries are read only; current permissions
                      determine the actions available.
                    </p>
                  </section>
                )}
              </div>
              <p className="leave-calendar-note">
                Requests count every calendar day from start through end,
                including weekends. Paid/unpaid is a leave category;
                entitlement, accrual, working-day calculations and payroll
                balances are not calculated here.
              </p>
              {!data.capabilities.canRequest && (
                <p className="leave-help">
                  New requests require a current active linked user. Your
                  accessible history remains available.
                </p>
              )}
              {data.capabilities.canRequest && !activeTypes.length && (
                <p className="leave-help">
                  No leave types are available. Ask an administrator to add one
                  before requesting leave.
                </p>
              )}
            </section>
          )
        ) : phase === "checking" ? (
          <p className="leave-empty" role="status">
            Checking Time Off recovery…
          </p>
        ) : phase === "reading" ? (
          <p className="leave-empty" role="status">
            Loading Time Off…
          </p>
        ) : null}
      </div>
      <dialog
        ref={requestDialog}
        className="leave-dialog"
        aria-labelledby="leave-request-title"
        onClose={() => setDraft(blankRequest)}
        onCancel={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitRequest();
          }}
        >
          <h2 id="leave-request-title">Request time off</h2>
          <p>
            Full calendar days, including weekends. Both dates are included.
          </p>
          <label>
            Leave type
            <select
              aria-label="Leave type"
              required
              disabled={locked}
              value={draft.typeId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  typeId: event.target.value,
                }))
              }
            >
              {activeTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} · {type.paid ? "Paid" : "Unpaid"}
                </option>
              ))}
            </select>
          </label>
          <div className="leave-date-pair">
            <label>
              Start date
              <input
                type="date"
                required
                disabled={locked}
                value={draft.startDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              End date
              <input
                type="date"
                required
                disabled={locked}
                value={draft.endDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          {days !== null && days >= 1 && days <= 366 && (
            <p className="leave-duration" role="status">
              {days} {days === 1 ? "calendar day" : "calendar days"}
            </p>
          )}
          {dateError && (
            <p className="leave-error" role="alert">
              {dateError}
            </p>
          )}
          <label>
            Note for your administrator (optional)
            <textarea
              disabled={locked}
              value={draft.note}
              maxLength={2000}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
            />
          </label>
          <div className="leave-dialog-actions">
            <button
              type="button"
              disabled={locked}
              onClick={() => requestDialog.current?.close()}
            >
              Cancel
            </button>
            <button className="leave-primary" disabled={!canSubmitRequest}>
              Send for approval
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={typeDialog}
        className="leave-dialog"
        aria-labelledby="leave-type-title"
        onClose={() => setTypeDraft({ name: "", description: "", paid: true })}
        onCancel={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              locked ||
              !data?.capabilities.canManageTypes ||
              !typeDraft.name.trim()
            )
              return;
            const value: TimeOffChange = {
              action: "create_type",
              name: typeDraft.name.trim(),
              description: typeDraft.description,
              paid: typeDraft.paid,
            };
            typeDialog.current?.close();
            change(value);
          }}
        >
          <h2 id="leave-type-title">Add leave type</h2>
          <label>
            Leave type name
            <input
              required
              disabled={locked}
              maxLength={100}
              value={typeDraft.name}
              onChange={(event) =>
                setTypeDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Leave type description (optional)
            <textarea
              disabled={locked}
              maxLength={1000}
              value={typeDraft.description}
              onChange={(event) =>
                setTypeDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Payment category
            <select
              aria-label="Payment category"
              disabled={locked}
              value={typeDraft.paid ? "paid" : "unpaid"}
              onChange={(event) =>
                setTypeDraft((current) => ({
                  ...current,
                  paid: event.target.value === "paid",
                }))
              }
            >
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <p className="leave-help">
            This category does not configure entitlement, accrual or a payroll
            rate.
          </p>
          <div className="leave-dialog-actions">
            <button
              type="button"
              disabled={locked}
              onClick={() => typeDialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className="leave-primary"
              disabled={locked || !typeDraft.name.trim()}
            >
              Save leave type
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={decisionDialog}
        className="leave-dialog"
        aria-labelledby="leave-decision-title"
        onClose={() => {
          setDecision(null);
          setReason("");
        }}
        onCancel={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            decide();
          }}
        >
          <h2 id="leave-decision-title">
            {decision ? actionNames[decision.action] : "Review request"}
          </h2>
          {decision && (
            <>
              <p>
                {decision.request.agent_name} · {decision.request.type_name}
              </p>
              <p>
                {formatEmploymentDate(decision.request.start_date)} –{" "}
                {formatEmploymentDate(decision.request.end_date)} ·{" "}
                {decision.request.calendar_days} calendar days
              </p>
              {decision.action === "withdraw" ? (
                <p>
                  Your pending request will be withdrawn. Submit a new request
                  if the dates need changing.
                </p>
              ) : (
                <label>
                  Decision reason
                  {decision.action === "approve" ? " (optional)" : ""}
                  <textarea
                    required={decision.action !== "approve"}
                    disabled={locked}
                    maxLength={1000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <div className="leave-dialog-actions">
            <button
              type="button"
              disabled={locked}
              onClick={() => decisionDialog.current?.close()}
            >
              Keep request
            </button>
            <button
              className={
                decision?.action === "approve"
                  ? "leave-primary"
                  : "leave-danger"
              }
              disabled={
                locked ||
                !decision ||
                !allowedDecision(decision.request, decision.action) ||
                ((decision.action === "reject" ||
                  decision.action === "cancel") &&
                  !reason.trim())
              }
            >
              {decision ? actionNames[decision.action] : "Save decision"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={archiveDialog}
        className="leave-dialog"
        aria-labelledby="leave-archive-title"
        onClose={() => setArchiveType(null)}
        onCancel={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        <h2 id="leave-archive-title">Archive {archiveType?.name}?</h2>
        <p>
          This stops new requests for the leave type. Existing requests and
          their history are retained.
        </p>
        <div className="leave-dialog-actions">
          <button
            disabled={locked}
            onClick={() => archiveDialog.current?.close()}
          >
            Keep leave type
          </button>
          <button
            className="leave-danger"
            disabled={locked || !archiveType?.canArchive}
            onClick={() => {
              if (locked || !archiveType?.canArchive) return;
              const value: TimeOffChange = {
                action: "archive_type",
                typeId: archiveType.id,
                revision: archiveType.revision,
              };
              archiveDialog.current?.close();
              change(value);
            }}
          >
            Archive leave type
          </button>
        </div>
      </dialog>
    </div>
  );
}
