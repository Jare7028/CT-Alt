"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  RotaAgent,
  RotaJob,
  RotaShift,
  Schedule,
} from "../../lib/rota-types";
import type {
  RotaTemplate,
  RotaTemplateChange,
  RotaTemplateData,
  RotaTemplateMutation,
  RotaTemplateSaved,
  RotaTemplateRecoveryQuery,
} from "../../lib/rota-template-types";
import {
  addDays,
  localDateTime,
  supportedRotaZone,
  zonedInstant,
} from "../../lib/rota-time";
import styles from "./shift-templates.module.css";
const clock = (minute: number) =>
  `${Math.floor(minute / 60)
    .toString()
    .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
const minute = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
type Props = {
  tenantId: string;
  actorId: string;
  schedule: Schedule;
  jobs: RotaJob[];
  agents: RotaAgent[];
  day: string;
  source: RotaShift | null;
  close: () => void;
  reload: () => Promise<boolean>;
  applied: (day: string, message: string) => void;
  denied: () => void;
  locked: (value: boolean) => void;
};
export default function ShiftTemplates({
  tenantId,
  actorId,
  schedule,
  jobs,
  agents,
  day,
  source,
  close,
  reload,
  applied,
  denied,
  locked,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    epoch = useRef(0),
    active = useRef(true),
    lock = useRef(false),
    pending = useRef<RotaTemplateMutation | null>(null),
    marker = useRef<RotaTemplateRecoveryQuery | null>(null),
    listCache = useRef<RotaTemplateData | null>(null);
  const markerKey = `ct-alt:rota-template-operation:v1:${actorId}:${tenantId}:${schedule.id}`;
  function clearMarker() {
    localStorage.removeItem(markerKey);
    marker.current = null;
    pending.current = null;
  }
  const [data, setData] = useState<RotaTemplateData | null>(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [mode, setMode] = useState<
      "list" | "create" | "edit" | "duplicate" | "delete" | "apply"
    >(source ? "create" : "list"),
    [target, setTarget] = useState<RotaTemplate | null>(null),
    [date, setDate] = useState(day),
    [startOccurrence, setStartOccurrence] = useState<"" | "earlier" | "later">(
      "",
    ),
    [endOccurrence, setEndOccurrence] = useState<"" | "earlier" | "later">(""),
    [overlap, setOverlap] = useState(false);
  const invalidate = useCallback(() => {
    epoch.current++;
    pending.current = null;
    listCache.current = null;
    setData(null);
    setTarget(null);
    setUncertain(false);
    denied();
  }, [denied]);
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (!active.current) return;
      try {
        const raw = localStorage.getItem(markerKey);
        if (!raw) return;
        const value = JSON.parse(raw);
        if (
          value.mode !== "reconcile" ||
          value.tenantId !== tenantId ||
          value.scheduleId !== schedule.id ||
          typeof value.operationId !== "string" ||
          !/[0-9a-f-]{36}/i.test(value.operationId) ||
          !["create", "edit", "duplicate", "delete", "apply"].includes(
            value.action,
          ) ||
          (value.action === "create"
            ? value.templateId !== null
            : typeof value.templateId !== "string")
        )
          throw Error(
            "Pending operation marker could not be verified. Keep this schedule locked until it is reviewed.",
          );
        marker.current = value;
        setUncertain(true);
        locked(true);
        setError(
          "An earlier template operation needs an authoritative status check before another change.",
        );
      } catch (e) {
        setUncertain(true);
        locked(true);
        setError(
          e instanceof Error
            ? e.message
            : "Pending operation could not be restored.",
        );
      }
    });
  }, [markerKey, tenantId, schedule.id, locked]);
  useEffect(() => {
    active.current = true;
    const returnFocus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      active.current = false;
      locked(false);
      if (returnFocus?.isConnected) returnFocus.focus();
      else document.getElementById("shift-templates-trigger")?.focus();
    };
  }, [locked]);
  const load = useCallback(
    async (cursor?: string) => {
      const generation = ++epoch.current;
      setLoading(true);
      if (!cursor) {
        listCache.current = null;
        setData(null);
      }
      try {
        const params = new URLSearchParams({
          tenantId,
          scheduleId: schedule.id,
          q: query,
        });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch("/api/rota-templates?" + params, {
          cache: "no-store",
        });
        const result = await response.json();
        if (!active.current || generation !== epoch.current) return;
        if (response.status === 401 || response.status === 403) {
          invalidate();
          return;
        }
        if (!response.ok)
          throw Error(result.error || "Templates could not be loaded.");
        if (
          result.schemaVersion !== 1 ||
          result.tenantId !== tenantId ||
          result.actorId !== actorId ||
          result.schedule?.id !== schedule.id ||
          !Array.isArray(result.templates) ||
          result.templates.length > 100 ||
          !Number.isSafeInteger(result.schedule?.revision) ||
          result.schedule.revision < 1 ||
          !["active", "archived"].includes(result.schedule?.status) ||
          !Number.isSafeInteger(result.page?.total) ||
          result.page.total < 0 ||
          result.page.total > 500 ||
          (result.page.nextCursor !== null &&
            typeof result.page.nextCursor !== "string") ||
          result.templates.some(
            (item: RotaTemplate) =>
              item.tenant_id !== tenantId ||
              item.schedule_id !== schedule.id ||
              !Number.isSafeInteger(item.revision) ||
              item.revision < 1,
          )
        )
          throw Error("Template response could not be verified.");
        const previous = listCache.current;
        if (
          cursor &&
          (!previous || previous.schedule.revision !== result.schedule.revision)
        )
          throw Error(
            "Templates changed while paging. Refresh the list before continuing.",
          );
        const rows = cursor
          ? [...(previous?.templates || []), ...result.templates]
          : result.templates;
        if (
          new Set(rows.map((item: RotaTemplate) => item.id)).size !==
          rows.length
        )
          throw Error("Template page could not be verified. Refresh the list.");
        const next = { ...result, templates: rows };
        listCache.current = next;
        setData(next);
        setError("");
      } catch (e) {
        if (active.current && generation === epoch.current)
          setError(
            e instanceof Error ? e.message : "Templates could not be loaded.",
          );
      } finally {
        if (active.current && generation === epoch.current) setLoading(false);
      }
    },
    [tenantId, actorId, schedule.id, query, invalidate],
  );
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (active.current) return load();
    });
  }, [load]);
  const latest = data?.schedule,
    editable =
      latest?.status === "active" &&
      supportedRotaZone(latest.time_zone) &&
      latest.revision === schedule.revision;
  const zone = latest?.time_zone || schedule.time_zone;
  const sourceStart = source ? localDateTime(source.starts_at, zone) : "",
    sourceEnd = source ? localDateTime(source.ends_at, zone) : "";
  const sourceOffset = source
    ? Math.round(
        (Date.parse(sourceEnd.slice(0, 10) + "T12:00Z") -
          Date.parse(sourceStart.slice(0, 10) + "T12:00Z")) /
          86400000,
      )
    : 0;
  const needsNormalization =
    !!source &&
    [source.starts_at, source.ends_at].some((value) => {
      const instant = new Date(value);
      // Date truncates PostgreSQL microseconds. Inspect the original digits
      // before deciding that a source is aligned to a whole minute.
      const fractionalDigits = value.match(/\.([0-9]+)/)?.[1] || "";
      const localSecond = supportedRotaZone(zone)
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: zone,
            second: "2-digit",
          })
            .formatToParts(instant)
            .find((part) => part.type === "second")?.value
        : undefined;
      return (
        instant.getUTCSeconds() !== 0 ||
        instant.getUTCMilliseconds() !== 0 ||
        /[1-9]/.test(fractionalDigits) ||
        (localSecond !== undefined && Number(localSecond) !== 0)
      );
    });
  const foldNeeded = (endpoint: "start" | "end") => {
    if (!target || !date) return false;
    try {
      zonedInstant(
        (endpoint === "start" ? date : addDays(date, target.end_day_offset)) +
          "T" +
          clock(endpoint === "start" ? target.start_minute : target.end_minute),
        zone,
      );
      return false;
    } catch (e) {
      return e instanceof Error && e.message.includes("occurs twice");
    }
  };
  let preview = "",
    previewError = "";
  if (mode === "apply" && target) {
    try {
      const starts = zonedInstant(
          date + "T" + clock(target.start_minute),
          zone,
          startOccurrence,
        ),
        ends = zonedInstant(
          addDays(date, target.end_day_offset) + "T" + clock(target.end_minute),
          zone,
          endOccurrence,
        );
      const hours = (Date.parse(ends) - Date.parse(starts)) / 3600000;
      if (hours <= 0 || hours > 24)
        throw Error(
          "Choose a date giving more than zero and no more than 24 elapsed hours.",
        );
      preview = `${localDateTime(starts, zone)} – ${localDateTime(ends, zone)} · ${clock(Math.floor((Date.parse(ends) - Date.parse(starts)) / 60_000))}`;
    } catch (e) {
      previewError =
        e instanceof Error ? e.message : "Choose valid shift times.";
    }
  }
  function checkedSaved(
    value: RotaTemplateSaved,
    operation: RotaTemplateMutation,
  ) {
    const change = operation.change;
    if (
      value?.schemaVersion !== 1 ||
      value.tenantId !== tenantId ||
      value.actorId !== actorId ||
      value.operationId !== operation.operationId ||
      value.action !== change.action ||
      value.schedule_id !== schedule.id ||
      !Number.isSafeInteger(value.schedule_revision) ||
      !Number.isSafeInteger(value.template_revision) ||
      value.schedule_revision <= change.schedule_revision ||
      value.template_revision < 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.template_id,
      ) ||
      (change.action === "apply" &&
        (typeof value.shift_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(value.shift_id))) ||
      (change.action !== "apply" && value.shift_id !== null) ||
      (["edit", "delete", "apply"].includes(change.action) &&
        value.template_id !==
          ("template_id" in change ? change.template_id : null))
    )
      throw Error("The save acknowledgement could not be verified.");
  }
  async function finish(
    saved: RotaTemplateSaved,
    operation: RotaTemplateMutation,
  ) {
    checkedSaved(saved, operation);
    clearMarker();
    setUncertain(false);
    setMode("list");
    setTarget(null);
    setOverlap(false);
    const refreshed = await reload();
    if (!active.current) return;
    await load();
    if (operation.change.action === "apply") {
      const change = operation.change;
      const agent = agents.find((a) => a.id === change.agent_id);
      applied(
        change.date,
        `Draft created for ${agent ? agent.first_name + " " + agent.last_name : "the selected worker"}. Review the displayed drafts and publish when ready.`,
      );
    } else applied(day, "Template saved.");
    if (!refreshed)
      setError(
        "Saved, but schedules could not be refreshed. Refresh before another change.",
      );
  }
  async function write(change: RotaTemplateChange) {
    if (lock.current || marker.current || uncertain || !editable) return;
    const operation = { tenantId, operationId: crypto.randomUUID(), change };
    const operationMarker: RotaTemplateRecoveryQuery = {
      mode: "reconcile",
      tenantId,
      operationId: operation.operationId,
      action: change.action,
      scheduleId: schedule.id,
      templateId: "template_id" in change ? change.template_id : null,
    };
    try {
      localStorage.setItem(markerKey, JSON.stringify(operationMarker));
    } catch {
      setError(
        "Browser storage is unavailable. No operation was sent; enable storage to keep uncertain saves recoverable.",
      );
      return;
    }
    marker.current = operationMarker;
    pending.current = operation;
    lock.current = true;
    setBusy(true);
    locked(true);
    setError("");
    const generation = epoch.current;
    try {
      const response = await fetch("/api/rota-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      });
      const result = await response.json();
      if (!active.current || generation !== epoch.current) return;
      if (response.status === 401 || response.status === 403) {
        invalidate();
        return;
      }
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          clearMarker();
          if (response.status === 409) {
            setOverlap(
              typeof result.error === "string" &&
                result.error.toLowerCase().includes("overlap"),
            );
            void reload();
          }
          throw Error(result.error || "Template could not be saved.");
        }
        throw Error("Save confirmation was lost.");
      }
      await finish(result.saved, operation);
    } catch (e) {
      if (active.current) {
        setUncertain(!!marker.current);
        setError(
          marker.current
            ? "Confirmation was lost. Check this operation before making another change."
            : e instanceof Error
              ? e.message
              : "Template could not be saved.",
        );
      }
    } finally {
      lock.current = false;
      if (active.current) {
        setBusy(false);
        locked(!!marker.current);
      }
    }
  }
  async function recover() {
    const operation = marker.current;
    if (!operation || lock.current) return;
    lock.current = true;
    setBusy(true);
    const generation = epoch.current;
    try {
      const response = await fetch("/api/rota-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      });
      const result = await response.json();
      if (!active.current || generation !== epoch.current) return;
      if (response.status === 401 || response.status === 403) {
        invalidate();
        return;
      }
      if (!response.ok)
        throw Error(result.error || "Operation could not be checked.");
      if (
        result.schemaVersion !== 1 ||
        result.tenantId !== tenantId ||
        result.actorId !== actorId ||
        result.operationId !== operation.operationId ||
        result.action !== operation.action ||
        result.scheduleId !== schedule.id ||
        result.templateId !== operation.templateId
      )
        throw Error("Operation result could not be verified.");
      if (result.status === "recorded") {
        if (pending.current) await finish(result.saved, pending.current);
        else {
          const saved = result.saved as RotaTemplateSaved;
          if (
            saved?.schemaVersion !== 1 ||
            saved.tenantId !== tenantId ||
            saved.actorId !== actorId ||
            saved.operationId !== operation.operationId ||
            saved.action !== operation.action ||
            saved.schedule_id !== schedule.id ||
            !Number.isSafeInteger(saved.schedule_revision) ||
            saved.schedule_revision < 1 ||
            !Number.isSafeInteger(saved.template_revision) ||
            saved.template_revision < 1 ||
            typeof saved.template_id !== "string" ||
            (["edit", "delete", "apply"].includes(operation.action) &&
              saved.template_id !== operation.templateId) ||
            (operation.action === "apply"
              ? typeof saved.shift_id !== "string"
              : saved.shift_id !== null)
          )
            throw Error("Recovered acknowledgement could not be verified.");
          clearMarker();
          setUncertain(false);
          setMode("list");
          await reload();
          await load();
          applied(
            day,
            operation.action === "apply"
              ? "Earlier operation created one private draft. Review the displayed drafts and publish when ready."
              : "Earlier template operation was saved.",
          );
        }
      } else if (result.status === "not_recorded" && result.saved === null) {
        clearMarker();
        setUncertain(false);
        await reload();
        await load();
        setError(
          "This operation was not saved. It is safe to try again with a new operation.",
        );
      } else throw Error("Operation result could not be verified.");
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error ? e.message : "Operation could not be checked.",
        );
    } finally {
      lock.current = false;
      if (active.current) {
        setBusy(false);
        locked(!!marker.current);
      }
    }
  }
  function select(next: typeof mode, item: RotaTemplate | null = null) {
    setMode(next);
    setTarget(item);
    setError("");
    setOverlap(false);
    setStartOccurrence("");
    setEndOccurrence("");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!latest || !editable) return;
    const form = new FormData(event.currentTarget),
      text = (key: string) => String(form.get(key) || "");
    const base = {
      schedule_id: schedule.id,
      schedule_revision: latest.revision,
    };
    if (mode === "create" || mode === "edit") {
      const recipe = {
        name: text("name").trim(),
        title: text("title").trim(),
        job_id: text("job_id"),
        start_minute: minute(text("start")),
        end_minute: minute(text("end")),
        end_day_offset: Number(text("offset")),
      };
      const duration =
        recipe.end_day_offset * 1440 + recipe.end_minute - recipe.start_minute;
      if (duration <= 0 || duration > 2880) {
        setError(
          "End must follow start within 48 local hours. Actual shifts must also fit within 24 elapsed hours.",
        );
        return;
      }
      if (needsNormalization && mode === "create" && !form.has("normalize")) {
        setError("Confirm minute normalization before saving this recipe.");
        return;
      }
      void write(
        mode === "create"
          ? { action: "create", ...base, ...recipe }
          : {
              action: "edit",
              ...base,
              ...recipe,
              template_id: target!.id,
              template_revision: target!.revision,
            },
      );
    } else if (target) {
      const reference = {
        ...base,
        template_id: target.id,
        template_revision: target.revision,
      };
      if (mode === "duplicate")
        void write({
          action: "duplicate",
          ...reference,
          name: text("name").trim(),
        });
      if (mode === "delete") void write({ action: "delete", ...reference });
      if (mode === "apply") {
        if (previewError) {
          setError(previewError);
          return;
        }
        void write({
          action: "apply",
          ...reference,
          agent_id: text("agent_id"),
          date,
          start_occurrence: startOccurrence,
          end_occurrence: endOccurrence,
          allow_overlap: form.has("allow_overlap"),
        });
      }
    }
  }
  const dismiss = () => {
    if (!lock.current && !marker.current && !uncertain) close();
  };
  return (
    <dialog
      ref={dialog}
      className={styles.drawer}
      aria-label="Shift Templates"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <header>
        <h2>Shift Templates</h2>
        <button
          type="button"
          aria-label="Close templates"
          disabled={busy || uncertain}
          onClick={dismiss}
        >
          ×
        </button>
      </header>
      <p className={styles.zone}>Shifts · {zone}</p>
      {latest?.status === "archived" && (
        <p>Archived schedule. Templates are read only.</p>
      )}
      {latest && latest.revision !== schedule.revision && (
        <p>
          Schedule settings changed. Refresh schedules before editing or
          applying.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {uncertain && (
        <button disabled={busy} onClick={recover}>
          Check operation status
        </button>
      )}
      {mode === "list" ? (
        <>
          <label className={styles.search}>
            Search templates
            <input
              value={query}
              maxLength={100}
              disabled={busy || uncertain}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            disabled={busy || uncertain || loading}
            onClick={async () => {
              await reload();
              await load();
            }}
          >
            Refresh templates and schedules
          </button>
          {loading && <p role="status">Loading templates…</p>}
          {data && (
            <p className={styles.zone}>{data.page.total} matching templates</p>
          )}
          <div className={styles.cards}>
            {data?.templates.map((item) => (
              <article
                key={item.id}
                className={styles.card}
                style={{
                  borderColor: jobs.find((j) => j.id === item.job_id)?.color,
                }}
              >
                <strong>
                  {clock(item.start_minute)} – {clock(item.end_minute)}
                  {item.end_day_offset > 0
                    ? ` (+${item.end_day_offset} day${item.end_day_offset > 1 ? "s" : ""})`
                    : ""}
                </strong>
                <h3>{item.name}</h3>
                <p>
                  {item.title || jobs.find((j) => j.id === item.job_id)?.name}
                </p>
                <div>
                  <button
                    disabled={!editable || busy || uncertain || !agents.length}
                    onClick={() => select("apply", item)}
                  >
                    Apply
                  </button>
                  <details>
                    <summary aria-label={`Actions for ${item.name}`}>
                      •••
                    </summary>
                    <button
                      disabled={!editable}
                      onClick={() => select("edit", item)}
                    >
                      Edit
                    </button>
                    <button
                      disabled={!editable}
                      onClick={() => select("duplicate", item)}
                    >
                      Duplicate
                    </button>
                    <button
                      disabled={!editable}
                      onClick={() => select("delete", item)}
                    >
                      Delete
                    </button>
                  </details>
                </div>
              </article>
            ))}
          </div>
          {data?.page.nextCursor && (
            <button
              disabled={busy || loading || uncertain}
              onClick={() => load(data.page.nextCursor!)}
            >
              Load more templates
            </button>
          )}
          <footer>
            <button
              className={styles.primary}
              disabled={!editable || busy || uncertain || !jobs.length}
              onClick={() => select("create")}
            >
              Add Template
            </button>
          </footer>
        </>
      ) : (
        <form key={mode + target?.id} onSubmit={submit}>
          <h3>
            {mode === "create"
              ? "Add Template"
              : mode === "apply"
                ? "Apply template"
                : `${mode[0].toUpperCase() + mode.slice(1)} template`}
          </h3>
          <fieldset disabled={!editable || busy || uncertain}>
            {(mode === "create" || mode === "edit" || mode === "duplicate") && (
              <label>
                Template name
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={
                    mode === "duplicate"
                      ? target?.name + " copy"
                      : target?.name || source?.title || ""
                  }
                />
              </label>
            )}
            {(mode === "create" || mode === "edit") && (
              <>
                <label>
                  Shift title
                  <input
                    name="title"
                    maxLength={100}
                    defaultValue={target?.title || source?.title || ""}
                  />
                </label>
                <label>
                  Job
                  <select
                    name="job_id"
                    required
                    defaultValue={
                      target?.job_id || source?.job_id || jobs[0]?.id
                    }
                  >
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Start time
                  <input
                    name="start"
                    type="time"
                    required
                    defaultValue={
                      target
                        ? clock(target.start_minute)
                        : sourceStart.slice(11) || "09:00"
                    }
                  />
                </label>
                <label>
                  End time
                  <input
                    name="end"
                    type="time"
                    required
                    defaultValue={
                      target
                        ? clock(target.end_minute)
                        : sourceEnd.slice(11) || "17:00"
                    }
                  />
                </label>
                <label>
                  End day
                  <select
                    name="offset"
                    defaultValue={target?.end_day_offset ?? sourceOffset}
                  >
                    <option value="0">Same day</option>
                    <option value="1">Next day</option>
                    <option value="2">Two days later</option>
                  </select>
                </label>
                <p>
                  Local hours follow the schedule’s current time zone. Worker
                  assignment is chosen when applying.
                </p>
                {needsNormalization && mode === "create" && (
                  <label className={styles.checkbox}>
                    <input name="normalize" type="checkbox" required />
                    The source includes seconds. I confirm saving the displayed
                    minute times; the source shift stays unchanged.
                  </label>
                )}
              </>
            )}
            {mode === "delete" && (
              <p>
                Remove “{target?.name}” from templates? Existing shifts are
                preserved.
              </p>
            )}
            {mode === "apply" && (
              <>
                <p>
                  {target?.name} · {clock(target!.start_minute)} –{" "}
                  {clock(target!.end_minute)} · {zone}
                </p>
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setStartOccurrence("");
                      setEndOccurrence("");
                    }}
                  />
                </label>
                <label>
                  Worker
                  <select name="agent_id" required>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.first_name} {agent.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                {(["start", "end"] as const)
                  .filter(foldNeeded)
                  .map((endpoint) => (
                    <label key={endpoint}>
                      {endpoint === "start" ? "Start" : "End"} clock-change
                      occurrence
                      <select
                        value={
                          endpoint === "start" ? startOccurrence : endOccurrence
                        }
                        onChange={(event) =>
                          (endpoint === "start"
                            ? setStartOccurrence
                            : setEndOccurrence)(
                            event.target.value as "" | "earlier" | "later",
                          )
                        }
                      >
                        <option value="">Choose if time occurs twice</option>
                        <option value="earlier">Earlier</option>
                        <option value="later">Later</option>
                      </select>
                    </label>
                  ))}
                <p role="status">{previewError || preview}</p>
                <p>
                  Creates one private draft. Review the displayed period and
                  filters before publishing.
                </p>
                {overlap && (
                  <label className={styles.checkbox}>
                    <input type="checkbox" name="allow_overlap" />I reviewed the
                    overlap and allow this worker’s overlapping shift.
                  </label>
                )}
              </>
            )}
          </fieldset>
          <div className={styles.formActions}>
            <button
              type="button"
              disabled={busy || uncertain}
              onClick={() => select("list")}
            >
              Back
            </button>
            <button
              type="submit"
              className={styles.primary}
              disabled={
                !editable ||
                busy ||
                uncertain ||
                loading ||
                (mode === "apply" && !!previewError)
              }
            >
              {busy
                ? "Saving…"
                : mode === "apply"
                  ? "Create draft"
                  : mode === "delete"
                    ? "Delete template"
                    : "Save template"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
