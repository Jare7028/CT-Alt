"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormsField, FormsResponseSummary } from "../../lib/forms-types";
import type {
  FormsReportData,
  FormsReportFilters,
  FormsReportKind,
  FormsReportingProps,
} from "../../lib/forms-reporting-types";
import "./reporting.css";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[0-9a-f]{32}$/;
const MAX_BYTES = 8388608;
const defaults: FormsReportFilters = {
  from: null,
  to: null,
  review: "all",
  search: "",
  submission: "all",
  fieldId: null,
  fieldAnswer: "all",
};
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const time = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
const text = (v: unknown, max = 200): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    v,
  );
function scopeKey(kind: FormsReportKind, filters: FormsReportFilters) {
  return JSON.stringify([
    kind,
    filters.from,
    filters.to,
    filters.review,
    filters.search,
    filters.submission,
    filters.fieldId,
    filters.fieldAnswer,
  ]);
}
function responseValid(r: FormsResponseSummary, formId: string) {
  return (
    !!r &&
    id(r.id) &&
    r.formId === formId &&
    id(r.actorId) &&
    text(r.authorName) &&
    r.status === "submitted" &&
    integer(r.revision) &&
    r.revision > 0 &&
    time(r.submittedAt) &&
    time(r.updatedAt) &&
    id(r.lastEditedBy) &&
    text(r.lastEditorName) &&
    time(r.lastEditedAt) &&
    typeof r.reviewed === "boolean" &&
    (r.reviewed
      ? time(r.reviewedAt) && id(r.reviewedBy) && text(r.reviewerName)
      : r.reviewedAt === null &&
        r.reviewedBy === null &&
        r.reviewerName === null) &&
    typeof r.canEdit === "boolean" &&
    typeof r.canReview === "boolean"
  );
}
function fieldValid(f: FormsField) {
  if (!f || !id(f.id)) return false;
  if (f.kind === "description") return text(f.text, 5000);
  if (!text(f.label, 100) || !f.label.trim() || typeof f.required !== "boolean")
    return false;
  if (f.kind === "text" || f.kind === "yes_no" || f.kind === "number")
    return true;
  return (
    (f.kind === "single_choice" || f.kind === "multiple_choice") &&
    Array.isArray(f.options) &&
    f.options.length > 0 &&
    f.options.length <= 50 &&
    new Set(f.options.map((o) => o.id)).size === f.options.length &&
    f.options.every((o) => id(o.id) && text(o.label, 100) && o.label.trim())
  );
}
function answerValid(
  field: Exclude<FormsField, { kind: "description" }>,
  answer: unknown,
  answered: boolean,
) {
  if (answer === null) return !answered;
  if (field.kind === "text")
    return text(answer, 5000) && answered === answer.trim().length > 0;
  if (field.kind === "yes_no") return typeof answer === "boolean" && answered;
  if (field.kind === "number")
    return (
      typeof answer === "string" &&
      /^[+-]?[0-9]{1,12}(\.[0-9]{1,6})?$/.test(answer) &&
      answered
    );
  if (field.kind === "single_choice")
    return (
      typeof answer === "string" &&
      field.options.some((o) => o.id === answer) &&
      answered
    );
  return (
    field.kind === "multiple_choice" &&
    Array.isArray(answer) &&
    answer.length <= 50 &&
    new Set(answer).size === answer.length &&
    answer.every(
      (v) => typeof v === "string" && field.options.some((o) => o.id === v),
    ) &&
    answered === answer.length > 0
  );
}
function validData(
  data: FormsReportData,
  props: FormsReportingProps,
  kind: FormsReportKind,
  filters: FormsReportFilters,
) {
  if (
    !data ||
    data.tenantId !== props.identity.tenantId ||
    data.actorId !== props.identity.actorId ||
    data.role !== props.identity.role ||
    data.company?.id !== props.company.id ||
    data.kind !== kind ||
    !data.form ||
    data.form.id !== props.form.id ||
    data.form.revision !== props.form.revision ||
    data.form.status !== props.form.status ||
    !data.form.capabilities?.canViewResponses ||
    !VERSION.test(data.collectionVersion) ||
    !time(data.serverTime) ||
    scopeKey(kind, data.filters) !== scopeKey(kind, filters) ||
    !data.company.time_zone
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", {
      timeZone: data.company.time_zone,
    }).format();
  } catch {
    return false;
  }
  const page = (cursor: unknown) =>
    cursor === null ||
    (typeof cursor === "string" && cursor.length > 0 && cursor.length <= 6000);
  const counts = (c: {
    total: number;
    reviewed: number;
    notReviewed: number;
  }) =>
    !!c &&
    Object.keys(c).length === 3 &&
    integer(c.total) &&
    integer(c.reviewed) &&
    integer(c.notReviewed) &&
    c.total === c.reviewed + c.notReviewed;
  if (data.kind === "entries")
    return (
      counts(data.counts) &&
      Array.isArray(data.responses) &&
      data.responses.length <= 50 &&
      data.responses.length <= data.counts.total &&
      new Set(data.responses.map((r) => r.id)).size === data.responses.length &&
      data.responses.every((r) => responseValid(r, props.form.id)) &&
      page(data.nextCursor)
    );
  if (data.kind === "status") {
    const c = data.counts;
    return (
      !!c &&
      Object.values(c).every(integer) &&
      [
        "total",
        "submitted",
        "notSubmitted",
        "eligible",
        "assignmentTotal",
        "assignmentEligible",
      ].every((k) => Object.hasOwn(c, k)) &&
      c.total === c.submitted + c.notSubmitted &&
      Object.keys(c).length === 6 &&
      c.eligible <= c.total &&
      c.total <= c.assignmentTotal &&
      c.assignmentTotal <= 500 &&
      c.assignmentEligible <= c.assignmentTotal &&
      Array.isArray(data.users) &&
      data.users.length <= 50 &&
      data.users.length <= c.total &&
      (data.users.length !== c.total ||
        (data.users.filter((u) => u.eligible).length === c.eligible &&
          data.users.filter((u) => u.response !== null).length ===
            c.submitted)) &&
      new Set(data.users.map((u) => u.actorId)).size === data.users.length &&
      data.users.every(
        (u) =>
          id(u.actorId) &&
          text(u.name) &&
          typeof u.eligible === "boolean" &&
          (u.response === null ||
            (responseValid(u.response, props.form.id) &&
              u.response.actorId === u.actorId)),
      ) &&
      page(data.nextCursor)
    );
  }
  if (data.kind === "summary") {
    if (
      !counts(data.counts) ||
      data.counts.total > 10000 ||
      !Array.isArray(data.schema) ||
      data.schema.length > 50 ||
      !data.schema.every(fieldValid) ||
      new Set(data.schema.map((f) => f.id)).size !== data.schema.length ||
      !Array.isArray(data.fields)
    )
      return false;
    const questions = data.schema.filter((f) => f.kind !== "description");
    return (
      data.fields.length === questions.length &&
      data.fields.every((s, index) => {
        const field = questions[index];
        if (
          !s ||
          s.fieldId !== field.id ||
          !integer(s.total) ||
          s.total !== data.counts.total ||
          !integer(s.answered) ||
          !integer(s.empty) ||
          s.answered + s.empty !== s.total ||
          !Array.isArray(s.options)
        )
          return false;
        const options =
          field.kind === "single_choice" || field.kind === "multiple_choice"
            ? field.options
            : field.kind === "yes_no"
              ? [
                  { id: "true", label: "Yes" },
                  { id: "false", label: "No" },
                ]
              : [];
        return (
          s.options.length === options.length &&
          s.options.every(
            (o, i) =>
              o.id === options[i].id &&
              o.label === options[i].label &&
              integer(o.count) &&
              o.count <= s.answered,
          ) &&
          (field.kind === "single_choice" || field.kind === "yes_no"
            ? s.options.reduce((sum, o) => sum + o.count, 0) === s.answered
            : true)
        );
      })
    );
  }
  const c = data.counts;
  return (
    fieldValid(data.field) &&
    data.field.id === filters.fieldId &&
    !!c &&
    ["total", "answered", "empty", "matched"].every((k) =>
      Object.hasOwn(c, k),
    ) &&
    Object.values(c).every(integer) &&
    c.total === c.answered + c.empty &&
    c.matched ===
      (filters.fieldAnswer === "answered"
        ? c.answered
        : filters.fieldAnswer === "empty"
          ? c.empty
          : c.total) &&
    Array.isArray(data.responses) &&
    data.responses.length <= 50 &&
    data.responses.length <= c.matched &&
    new Set(data.responses.map((r) => r.response.id)).size ===
      data.responses.length &&
    data.responses.every(
      (r) =>
        responseValid(r.response, props.form.id) &&
        typeof r.answered === "boolean" &&
        (filters.fieldAnswer === "all" ||
          r.answered === (filters.fieldAnswer === "answered")) &&
        answerValid(data.field, r.answer, r.answered),
    ) &&
    page(data.nextCursor)
  );
}
function readableAnswer(
  field: Exclude<FormsField, { kind: "description" }>,
  answer: unknown,
) {
  if (
    answer === null ||
    (Array.isArray(answer) && answer.length === 0) ||
    (typeof answer === "string" && !answer.trim())
  )
    return "Empty";
  if (field.kind === "yes_no") return answer ? "Yes" : "No";
  if (field.kind === "single_choice")
    return field.options.find((o) => o.id === answer)?.label ?? "";
  if (field.kind === "multiple_choice")
    return Array.isArray(answer)
      ? answer
          .map((v) => field.options.find((o) => o.id === v)?.label ?? "")
          .join(", ")
      : "";
  return String(answer);
}
function dateValid(v: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
    new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v
  );
}
export default function FormsReporting(props: FormsReportingProps) {
  const [kind, setKind] = useState<FormsReportKind>("entries"),
    [filters, setFilters] = useState<FormsReportFilters>({ ...defaults }),
    [data, setData] = useState<FormsReportData | null>(null),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState("");
  const mounted = useRef(true),
    generation = useRef(0),
    readController = useRef<AbortController | null>(null),
    downloadController = useRef<AbortController | null>(null),
    scope = useRef(scopeKey(kind, filters)),
    downloadBusy = useRef(false),
    urls = useRef(new Set<string>());
  const dataRef = useRef<FormsReportData | null>(null);
  const currentProps = useRef(props);
  useEffect(() => {
    currentProps.current = props;
  }, [props]);
  function replaceData(value: FormsReportData | null) {
    dataRef.current = value;
    setData(value);
  }
  function allowed() {
    return (
      mounted.current &&
      !currentProps.current.disabled &&
      currentProps.current.canAct()
    );
  }
  function invalidate() {
    generation.current++;
    readController.current?.abort();
    downloadController.current?.abort();
    readController.current = null;
    downloadController.current = null;
    downloadBusy.current = false;
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, []);
  function apply(nextKind: FormsReportKind, next: FormsReportFilters) {
    if (!allowed()) return;
    invalidate();
    scope.current = scopeKey(nextKind, next);
    setKind(nextKind);
    setFilters(next);
    replaceData(null);
    setError("");
    setBusy(false);
    setExporting(false);
    void load(nextKind, next);
  }
  async function load(
    nextKind: FormsReportKind,
    next: FormsReportFilters,
    cursor: string | null = null,
  ) {
    if (!allowed()) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const epoch = generation.current,
      key = scopeKey(nextKind, next);
    const current = () =>
      allowed() &&
      !controller.signal.aborted &&
      generation.current === epoch &&
      scope.current === key &&
      readController.current === controller;
    setBusy(true);
    setError("");
    if (!cursor) replaceData(null);
    try {
      const result = await fetch(
        `/api/forms/${props.form.id}/reports?${query(nextKind, next, cursor)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!current()) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          currentProps.current.onDenied(
            "Your current Forms access could not be verified. Private data has been cleared.",
          );
          return;
        }
        throw Error(
          result.status === 413
            ? "This complete report exceeds the supported limit. Narrow the date range or search."
            : result.status === 409
              ? "This report changed. Refresh the current form and report."
              : "Reporting could not be verified. Try the current report again.",
        );
      }
      const value = (await result.json()) as FormsReportData;
      if (!current()) return;
      if (!validData(value, currentProps.current, nextKind, next))
        throw Error("The report response could not be verified.");
      const previous = dataRef.current;
      const merged = (() => {
        if (!cursor) return value;
        if (
          !previous ||
          previous.kind !== value.kind ||
          previous.collectionVersion !== value.collectionVersion
        )
          throw Error("The report changed between pages. Refresh this report.");
        if (value.kind === "entries" && previous.kind === "entries") {
          const rows = [...previous.responses, ...value.responses];
          if (new Set(rows.map((r) => r.id)).size !== rows.length)
            throw Error("Repeated report rows could not be verified.");
          return { ...value, responses: rows };
        }
        if (value.kind === "status" && previous.kind === "status") {
          const rows = [...previous.users, ...value.users];
          if (new Set(rows.map((r) => r.actorId)).size !== rows.length)
            throw Error("Repeated assigned users could not be verified.");
          return { ...value, users: rows };
        }
        if (value.kind === "field" && previous.kind === "field") {
          const rows = [...previous.responses, ...value.responses];
          if (new Set(rows.map((r) => r.response.id)).size !== rows.length)
            throw Error("Repeated question responses could not be verified.");
          return { ...value, responses: rows };
        }
        throw Error("This report page could not be verified.");
      })();
      replaceData(merged);
    } catch (cause) {
      if (current()) {
        replaceData(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Reporting could not be verified.",
        );
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  const initialize = useEffectEvent(() => {
    void load("entries", { ...defaults });
  });
  useEffect(() => {
    queueMicrotask(() => {
      if (mounted.current) initialize();
    });
  }, []);
  function query(
    nextKind: FormsReportKind,
    next: FormsReportFilters,
    cursor: string | null = null,
    exportFile = false,
  ) {
    const q = new URLSearchParams({
      tenantId: props.identity.tenantId,
      kind: nextKind,
      review: next.review,
      search: next.search,
    });
    if (next.from) q.set("from", next.from);
    if (next.to) q.set("to", next.to);
    if (nextKind === "status") q.set("submission", next.submission);
    if (nextKind === "field") {
      q.set("fieldId", next.fieldId!);
      q.set("fieldAnswer", next.fieldAnswer);
    }
    if (!exportFile) {
      q.set("limit", "50");
      if (cursor) q.set("cursor", cursor);
    }
    return q;
  }
  function exportHeaders(result: Response, snapshot: FormsReportData) {
    const filename = `forms-${props.form.id}-${snapshot.kind}.xlsx`;
    return (
      result.headers.get("content-type")?.split(";")[0].trim() ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
      result.headers.get("x-content-type-options") === "nosniff" &&
      result.headers.get("content-disposition") ===
        `attachment; filename="${filename}"` &&
      result.headers.get("x-ct-alt-actor-id") === props.identity.actorId &&
      result.headers.get("x-ct-alt-company-id") === props.identity.tenantId &&
      result.headers.get("x-ct-alt-form-id") === props.form.id &&
      result.headers.get("x-ct-alt-role") === props.identity.role &&
      result.headers.get("x-ct-alt-collection-version") ===
        snapshot.collectionVersion &&
      result.headers.get("x-ct-alt-form-revision") ===
        String(props.form.revision) &&
      result.headers.get("x-ct-alt-report-kind") === snapshot.kind
    );
  }
  async function download() {
    if (
      !allowed() ||
      downloadBusy.current ||
      !dataRef.current ||
      (dataRef.current.kind !== "entries" && dataRef.current.kind !== "status")
    )
      return;
    const snapshot = dataRef.current,
      controller = new AbortController(),
      epoch = generation.current,
      key = scope.current;
    downloadController.current?.abort();
    downloadController.current = controller;
    downloadBusy.current = true;
    setExporting(true);
    setError("");
    const current = () =>
      allowed() &&
      !controller.signal.aborted &&
      generation.current === epoch &&
      scope.current === key &&
      downloadController.current === controller &&
      dataRef.current?.collectionVersion === snapshot.collectionVersion;
    try {
      const result = await fetch(
        `/api/forms/${props.form.id}/reports/export?${query(snapshot.kind, snapshot.filters, null, true)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!current()) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          currentProps.current.onDenied(
            "Your current Forms access could not be verified. Private data has been cleared.",
          );
          return;
        }
        throw Error(
          result.status === 413
            ? "The complete workbook is too large. Narrow the date range or search."
            : "The workbook could not be verified. Refresh the current report before exporting.",
        );
      }
      const length = result.headers.get("content-length");
      if (
        !exportHeaders(result, snapshot) ||
        (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      )
        throw Error("The workbook identity or size could not be verified.");
      const blob = await result.blob();
      if (!current()) return;
      if (
        !exportHeaders(result, snapshot) ||
        blob.size === 0 ||
        blob.size > MAX_BYTES
      )
        throw Error("The workbook identity or size could not be verified.");
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      if (!current()) {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `forms-${props.form.id}-${snapshot.kind}.xlsx`;
      document.body.append(anchor);
      try {
        if (current()) anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error
            ? cause.message
            : "The workbook could not be verified.",
        );
    } finally {
      if (current()) {
        downloadBusy.current = false;
        setExporting(false);
      }
    }
  }
  function changeInput(change: () => void) {
    if (!allowed()) return;
    invalidate();
    replaceData(null);
    setBusy(false);
    setExporting(false);
    setError("");
    change();
  }
  function open(id: string) {
    if (allowed() && !busy) {
      invalidate();
      currentProps.current.onOpenResponse(id);
    }
  }
  const blocked = props.disabled || !props.canAct(),
    period = filters.from
      ? "Submitted in selected period"
      : "Submitted in all time";
  return (
    <section className="forms-reporting" aria-label="Forms reporting">
      <header className="fr-heading">
        <div>
          <h2>Reporting</h2>
          <p>
            {props.form.name} ·{" "}
            {data?.company.time_zone ?? props.company.time_zone}
          </p>
        </div>
        <button
          disabled={blocked}
          onClick={() => {
            if (allowed()) {
              invalidate();
              props.onClose();
            }
          }}
        >
          Close reporting
        </button>
      </header>
      <nav className="fr-tabs" aria-label="Reporting views">
        {(["entries", "status", "summary"] as const).map((tab) => (
          <button
            key={tab}
            aria-current={
              kind === tab || (tab === "summary" && kind === "field")
                ? "page"
                : undefined
            }
            disabled={blocked}
            onClick={() =>
              apply(tab, {
                ...filters,
                submission: "all",
                fieldId: null,
                fieldAnswer: "all",
              })
            }
          >
            {tab === "entries"
              ? "Submissions"
              : tab === "status"
                ? "Assigned users"
                : "Summary"}
          </button>
        ))}
      </nav>
      <form
        className="fr-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (!allowed()) return;
          if (
            (from || to) &&
            (!dateValid(from) ||
              !dateValid(to) ||
              from > to ||
              (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 366)
          ) {
            setError(
              "Choose both real dates in order, within 366 calendar days.",
            );
            return;
          }
          apply(kind, {
            ...filters,
            from: from || null,
            to: to || null,
            search,
          });
        }}
      >
        <label>
          From
          <input
            type="date"
            value={from}
            disabled={blocked}
            onChange={(e) => {
              changeInput(() => setFrom(e.target.value));
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            disabled={blocked}
            onChange={(e) => {
              changeInput(() => setTo(e.target.value));
            }}
          />
        </label>
        <label>
          Search respondents
          <input
            value={search}
            maxLength={100}
            disabled={blocked}
            onChange={(e) => {
              changeInput(() => setSearch(e.target.value));
            }}
          />
        </label>
        <label>
          Review status
          <select
            aria-label="Review status"
            value={filters.review}
            disabled={blocked}
            onChange={(e) => {
              if (allowed())
                apply(kind, {
                  ...filters,
                  review: e.target.value as FormsReportFilters["review"],
                });
            }}
          >
            <option value="all">All review statuses</option>
            <option value="reviewed">Reviewed</option>
            <option value="not_reviewed">Not reviewed</option>
          </select>
        </label>
        <button type="submit" disabled={blocked}>
          Apply filters
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            if (!allowed()) return;
            setFrom("");
            setTo("");
            setSearch("");
            apply(kind, {
              ...defaults,
              fieldId: kind === "field" ? filters.fieldId : null,
            });
          }}
        >
          Show all
        </button>
      </form>
      <p className="fr-hint">
        Dates use the company calendar and the first submission time. Review and
        search filters further narrow the selected scope. Private unfinished
        responses are excluded.
      </p>
      {kind === "status" && (
        <label className="fr-status-filter">
          Assignment status
          <select
            aria-label="Assignment status"
            disabled={blocked}
            value={filters.submission}
            onChange={(e) =>
              apply("status", {
                ...filters,
                submission: e.target.value as FormsReportFilters["submission"],
              })
            }
          >
            <option value="all">All assigned users</option>
            <option value="submitted">Submitted in scope</option>
            <option value="not_submitted">Not submitted in scope</option>
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="fr-error">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading current report…</p>}
      {exporting && <p role="status">Preparing complete workbook…</p>}
      {data && (
        <>
          <div className="fr-counts">
            {data.kind === "entries" || data.kind === "summary" ? (
              <p>
                {data.counts.total} submissions · {data.counts.reviewed}{" "}
                reviewed · {data.counts.notReviewed} not reviewed
              </p>
            ) : data.kind === "status" ? (
              <p>
                {data.counts.total} assigned users in scope ·{" "}
                {data.counts.submitted} submitted · {data.counts.notSubmitted}{" "}
                not submitted · {data.counts.eligible} eligible
                <br />
                {data.counts.assignmentTotal} assigned overall ·{" "}
                {data.counts.assignmentEligible} currently eligible
              </p>
            ) : (
              <p>
                {data.counts.answered} answered · {data.counts.empty} empty ·{" "}
                {data.counts.total} submissions
              </p>
            )}
            {(data.kind === "entries" || data.kind === "status") && (
              <button
                disabled={blocked || busy || exporting}
                onClick={() => void download()}
              >
                Export XLSX
              </button>
            )}
          </div>
          {data.kind === "entries" && (
            <div className="fr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Respondent</th>
                    <th>First submitted</th>
                    <th>Last content editor</th>
                    <th>Review</th>
                    <th>Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.responses.map((r) => (
                    <tr key={r.id}>
                      <td>{r.authorName}</td>
                      <td>
                        {new Date(r.submittedAt!).toLocaleString(undefined, {
                          timeZone: data.company.time_zone,
                        })}
                      </td>
                      <td>
                        {r.lastEditorName}
                        <small>
                          {new Date(r.lastEditedAt).toLocaleString(undefined, {
                            timeZone: data.company.time_zone,
                          })}
                        </small>
                      </td>
                      <td>{r.reviewed ? "Reviewed" : "Not reviewed"}</td>
                      <td>
                        <button
                          disabled={blocked || busy}
                          onClick={() => open(r.id)}
                        >
                          Open response
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.responses.length === 0 && (
                <p>No submissions match this scope.</p>
              )}
            </div>
          )}
          {data.kind === "status" && (
            <div className="fr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Assigned user</th>
                    <th>Current eligibility</th>
                    <th>{period}</th>
                    <th>Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.actorId}>
                      <td>{u.name}</td>
                      <td>{u.eligible ? "Eligible" : "Unavailable"}</td>
                      <td>{u.response ? "Yes" : "No"}</td>
                      <td>
                        {u.response && (
                          <button
                            disabled={blocked || busy}
                            onClick={() => open(u.response!.id)}
                          >
                            Open response
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.users.length === 0 && (
                <p>No assigned users match this scope.</p>
              )}
            </div>
          )}
          {data.kind === "summary" && (
            <div className="fr-summaries">
              {data.fields.map((s) => {
                const f = data.schema.find((f) => f.id === s.fieldId)!;
                return (
                  <article key={s.fieldId}>
                    <h3>{f.kind !== "description" ? f.label : ""}</h3>
                    <p>
                      {s.answered} answered · {s.empty} empty · {s.total}{" "}
                      submissions
                    </p>
                    {s.options.length > 0 && s.answered === 0 && (
                      <p>No responses.</p>
                    )}
                    {s.options.length > 0 && s.answered > 0 && (
                      <>
                        <p className="fr-hint">
                          Percentages use {s.answered} answered respondents
                          {f.kind === "multiple_choice"
                            ? "; each respondent may select several options."
                            : "."}
                        </p>
                        {s.options.map((o) => (
                          <div className="fr-distribution" key={o.id}>
                            <span>{o.label}</span>
                            <progress
                              max={Math.max(1, s.answered)}
                              value={o.count}
                            />
                            <span>
                              {o.count} ·{" "}
                              {s.answered
                                ? (
                                    Math.round((1000 * o.count) / s.answered) /
                                    10
                                  ).toFixed(1)
                                : "0.0"}
                              %
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    <button
                      disabled={blocked}
                      onClick={() =>
                        apply("field", {
                          ...filters,
                          fieldId: s.fieldId,
                          fieldAnswer: "all",
                        })
                      }
                    >
                      View question responses
                    </button>
                  </article>
                );
              })}
              {data.fields.length === 0 && (
                <p>No answerable questions in this form.</p>
              )}
            </div>
          )}
          {data.kind === "field" && (
            <>
              <div className="fr-field-heading">
                <h3>{data.field.label}</h3>
                <label>
                  Question response status
                  <select
                    aria-label="Question response status"
                    value={filters.fieldAnswer}
                    disabled={blocked}
                    onChange={(e) =>
                      apply("field", {
                        ...filters,
                        fieldAnswer: e.target
                          .value as FormsReportFilters["fieldAnswer"],
                      })
                    }
                  >
                    <option value="all">All question responses</option>
                    <option value="answered">Answered</option>
                    <option value="empty">Empty</option>
                  </select>
                </label>
              </div>
              <div className="fr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Respondent</th>
                      <th>Answer</th>
                      <th>Entry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.responses.map((r) => (
                      <tr key={r.response.id}>
                        <td>{r.response.authorName}</td>
                        <td>{readableAnswer(data.field, r.answer)}</td>
                        <td>
                          <button
                            disabled={blocked || busy}
                            onClick={() => open(r.response.id)}
                          >
                            Open response
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.responses.length === 0 && (
                  <p>No question responses match this scope.</p>
                )}
              </div>
            </>
          )}
          {data.kind !== "summary" && data.nextCursor && (
            <button
              className="fr-load"
              disabled={blocked || busy}
              onClick={() => void load(kind, filters, data.nextCursor)}
            >
              Load more report rows
            </button>
          )}
        </>
      )}
    </section>
  );
}
