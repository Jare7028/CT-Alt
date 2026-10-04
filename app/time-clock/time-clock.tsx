"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Company, Member } from "../../lib/agent-types";
import type {
  TimeClockData,
  TimeClockEntriesData,
  TimeClockEntry,
  TimeClockJob,
  TimeClockChange,
} from "../../lib/time-clock-types";
import "./time-clock.css";
import TeamTimesheets from "./team-timesheets";

type Props = {
  company: Company;
  role: Member["role"];
  initialData: TimeClockData;
  initialTimesheets: TimeClockEntriesData;
};
type Phase = "checking" | "ready" | "saving" | "unknown" | "recovering";
type Operation = {
  tenantId: string;
  operationId: string;
  change: TimeClockChange;
};
type DateFilters = { startDate: string; endDate: string };
const noDates: DateFilters = { startDate: "", endDate: "" };
function duration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor(safe / 60) % 60, safe % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
function clockInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 2h6M12 2v3m6 1 2 2" />
      <circle cx="12" cy="14" r="8" />
      <path d="M12 9v5" />
    </svg>
  );
}
function appendEntries(current: TimeClockEntry[], next: TimeClockEntry[]) {
  const ids = new Set(current.map((entry) => entry.id));
  return [...current, ...next.filter((entry) => !ids.has(entry.id))];
}
export default function TimeClock(props: Props) {
  return (
    <ClockContent
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}`}
      {...props}
    />
  );
}
function ClockContent({ company, initialData, initialTimesheets }: Props) {
  const [data, setData] = useState<TimeClockData | null>(initialData);
  const [sheets, setSheets] = useState(initialTimesheets);
  const [attendance, setAttendance] = useState<TimeClockEntriesData>({
    entries: [],
    nextCursor: null,
    serverTime: initialData.serverTime,
    timeZone: initialData.company.time_zone,
  });
  const [tab, setTab] = useState<"clock" | "today" | "jobs" | "timesheets">(
    "clock",
  );
  const [phase, setPhase] = useState<Phase>("checking");
  const [writePending, setWritePending] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedJob, setSelectedJob] = useState("");
  const [paidBreak, setPaidBreak] = useState(false);
  const [jobName, setJobName] = useState("");
  const [archiveJob, setArchiveJob] = useState<TimeClockJob | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dates, setDates] = useState(noDates);
  const [appliedDates, setAppliedDates] = useState(noDates);
  const [listLoading, setListLoading] = useState<{
    sheets: boolean;
    attendance: boolean;
  }>({ sheets: false, attendance: false });
  const mounted = useRef(true),
    writeBusy = useRef<string | null>(null),
    anchor = useRef(0),
    statusRequest = useRef<AbortController | null>(null);
  const listRequests = useRef<{
    sheets: AbortController | null;
    attendance: AbortController | null;
  }>({ sheets: null, attendance: null });
  const archiveDialog = useRef<HTMLDialogElement>(null);
  const storageKey = `ct-alt:time-clock:${initialData.actorId}:${company.id}`;
  useEffect(() => {
    mounted.current = true;
    anchor.current = performance.now();
    const requests = listRequests.current;
    let recovery = false;
    try {
      recovery = sessionStorage.getItem(storageKey) !== null;
    } catch {}
    const check = setTimeout(() => {
      if (mounted.current) setPhase(recovery ? "unknown" : "ready");
    }, 0);
    const timer = setInterval(() => {
      if (mounted.current)
        setElapsed(
          Math.max(0, Math.floor((performance.now() - anchor.current) / 1000)),
        );
    }, 1000);
    return () => {
      mounted.current = false;
      clearTimeout(check);
      clearInterval(timer);
      statusRequest.current?.abort();
      requests.sheets?.abort();
      requests.attendance?.abort();
    };
  }, [storageKey]);
  const locked = phase !== "ready" || !data;
  const entry = data?.entry;
  const openBreak = entry?.breaks.find((item) => !item.ended_at);
  const clockTime = entry
    ? entry.paid_seconds +
      (entry.ended_at || (openBreak && !openBreak.paid) ? 0 : elapsed)
    : 0;
  const displayTimeZone = data?.company.time_zone || company.time_zone;
  const formatTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTimeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  function saveMarker(value: Operation) {
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
  const clearAccess = useCallback(() => {
    statusRequest.current?.abort();
    statusRequest.current = null;
    setTab("clock");
    listRequests.current.sheets?.abort();
    listRequests.current.attendance?.abort();
    setListLoading({ sheets: false, attendance: false });
    setData(null);
    setSheets({
      entries: [],
      nextCursor: null,
      serverTime: initialData.serverTime,
      timeZone: displayTimeZone,
    });
    setAttendance({
      entries: [],
      nextCursor: null,
      serverTime: initialData.serverTime,
      timeZone: displayTimeZone,
    });
    setPhase("unknown");
    setError(
      "Your company access could not be verified. Refresh the clock after checking your access.",
    );
  }, [initialData.serverTime, displayTimeZone]);
  async function refreshStatus(acknowledgedOperationId?: string) {
    if (writeBusy.current && writeBusy.current !== acknowledgedOperationId)
      return false;
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setPhase("recovering");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/time-clock?${new URLSearchParams({ tenantId: company.id })}`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your company access could not be verified. Refresh again after checking your access."
            : "The clock status could not be refreshed. New changes remain locked. Try again.",
        );
      const next = (await response.json()) as TimeClockData;
      if (
        !mounted.current ||
        controller.signal.aborted ||
        statusRequest.current !== controller
      )
        return false;
      if (
        next.company.id !== company.id ||
        next.actorId !== initialData.actorId
      )
        throw new Error(
          "The clock identity could not be verified. New changes remain locked.",
        );
      if (next.company.time_zone !== data?.company.time_zone) {
        listRequests.current.sheets?.abort();
        listRequests.current.attendance?.abort();
        setListLoading({ sheets: false, attendance: false });
        setDates(noDates);
        setAppliedDates(noDates);
        setSheets({
          entries: [],
          nextCursor: null,
          serverTime: next.serverTime,
          timeZone: next.company.time_zone,
        });
        setAttendance({
          entries: [],
          nextCursor: null,
          serverTime: next.serverTime,
          timeZone: next.company.time_zone,
        });
      }
      anchor.current = performance.now();
      setElapsed(0);
      setData(next);
      setPhase("ready");
      setOperation(null);
      clearMarker();
      setSelectedJob((current) =>
        next.jobs.some((job) => job.id === current && job.status === "active")
          ? current
          : "",
      );
      if (!next.canViewAttendance)
        setAttendance({
          entries: [],
          nextCursor: null,
          serverTime: next.serverTime,
          timeZone: next.company.time_zone,
        });
      if (next.agent?.id !== data?.agent?.id) {
        listRequests.current.sheets?.abort();
        setListLoading((current) => ({ ...current, sheets: false }));
        setSheets({
          entries: [],
          nextCursor: null,
          serverTime: next.serverTime,
          timeZone: next.company.time_zone,
        });
      }
      if (!next.canViewAttendance) listRequests.current.attendance?.abort();
      if (!next.canViewAttendance || !next.canManageJobs) setTab("clock");
      return next;
    } catch (cause) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        statusRequest.current === controller
      ) {
        clearAccess();
        setError(
          cause instanceof Error
            ? cause.message
            : "The clock status could not be refreshed. New changes remain locked.",
        );
      }
      return false;
    }
  }
  async function perform(value: Operation) {
    if (writeBusy.current) return;
    writeBusy.current = value.operationId;
    setWritePending(true);
    statusRequest.current?.abort();
    statusRequest.current = null;
    saveMarker(value);
    setOperation(value);
    setPhase("saving");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/time-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        keepalive: true,
      });
      if (!mounted.current) return;
      if (!response.ok) {
        let message =
          "The action was not acknowledged. Refresh the clock before making another change.";
        try {
          const result = await response.json();
          if (typeof result.error === "string") message = result.error;
        } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      if (
        result.saved?.operationId !== value.operationId ||
        result.saved?.action !== value.change.action ||
        !Number.isInteger(result.saved?.revision) ||
        result.saved.revision < 1 ||
        ("entryId" in value.change &&
          result.saved.entryId !== value.change.entryId) ||
        ("jobId" in value.change && result.saved.jobId !== value.change.jobId)
      )
        throw new Error(
          "The action could not be confirmed. Refresh the clock before making another change.",
        );
      const refreshed = await refreshStatus(value.operationId);
      if (refreshed) {
        if (mounted.current) {
          setNotice(
            value.change.action === "create_job" ||
              value.change.action === "archive_job"
              ? "Job updated."
              : "Clock updated.",
          );
          if (value.change.action === "create_job") setJobName("");
          if (tab === "today") void loadEntries("attendance");
          else
            void loadEntries(
              "sheets",
              refreshed.company.time_zone !== data?.company.time_zone
                ? noDates
                : appliedDates,
            );
        }
      }
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
  function change(value: TimeClockChange) {
    if (locked || writeBusy.current) return;
    void perform({
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change: value,
    });
  }
  async function loadEntries(
    kind: "sheets" | "attendance",
    filters: DateFilters = noDates,
    cursor: string | null = null,
  ) {
    listRequests.current[kind]?.abort();
    const controller = new AbortController();
    listRequests.current[kind] = controller;
    setListLoading((current) => ({ ...current, [kind]: true }));
    setError("");
    if (kind === "sheets") setAppliedDates(filters);
    if (!cursor) {
      const blank = {
        entries: [],
        nextCursor: null,
        serverTime: data?.serverTime || initialData.serverTime,
        timeZone: displayTimeZone,
      };
      if (kind === "sheets") setSheets(blank);
      else setAttendance(blank);
    }
    const query = new URLSearchParams({
      tenantId: company.id,
      mode: kind === "sheets" ? "timesheets" : "attendance",
    });
    if (filters.startDate) query.set("startDate", filters.startDate);
    if (filters.endDate) query.set("endDate", filters.endDate);
    if (cursor) query.set("cursor", cursor);
    try {
      const response = await fetch(`/api/time-clock?${query}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your company access could not be verified. Refresh the clock to check your access."
            : "The time entries could not be loaded. Refresh the clock before making another change.",
        );
      const next = (await response.json()) as TimeClockEntriesData;
      if (next.entries.some((item) => item.tenant_id !== company.id))
        throw new Error(
          "The time entries could not be verified. Refresh the clock to recover.",
        );
      if (
        mounted.current &&
        !controller.signal.aborted &&
        listRequests.current[kind] === controller
      ) {
        const update = (current: TimeClockEntriesData) => ({
          ...next,
          entries: cursor
            ? appendEntries(current.entries, next.entries)
            : next.entries,
        });
        if (kind === "sheets") setSheets(update);
        else setAttendance(update);
      }
    } catch (cause) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        listRequests.current[kind] === controller
      ) {
        clearAccess();
        setError(
          cause instanceof Error
            ? cause.message
            : "Time entries could not be loaded. Refresh the clock to recover.",
        );
      }
    } finally {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        listRequests.current[kind] === controller
      )
        setListLoading((current) => ({ ...current, [kind]: false }));
    }
  }
  function applyDates() {
    if (dates.startDate && dates.endDate && dates.startDate > dates.endDate) {
      listRequests.current.sheets?.abort();
      setListLoading((current) => ({ ...current, sheets: false }));
      setSheets({
        entries: [],
        nextCursor: null,
        serverTime: initialData.serverTime,
        timeZone: displayTimeZone,
      });
      setError("The end date must be on or after the start date.");
      return;
    }
    void loadEntries("sheets", dates);
  }
  function switchTab(next: "clock" | "today" | "jobs" | "timesheets") {
    setTab(next);
    if (next === "today" && data?.canViewAttendance)
      void loadEntries("attendance");
  }
  function table(entries: TimeClockEntry[], kind: "sheets" | "attendance") {
    const listTimeZone =
      (kind === "sheets" ? sheets.timeZone : attendance.timeZone) ||
      displayTimeZone;
    const listFormat = new Intl.DateTimeFormat("en-GB", {
      timeZone: listTimeZone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    return entries.length ? (
      <div className="clock-table-scroll">
        <table className="clock-table">
          <thead>
            <tr>
              {kind === "attendance" ? <th scope="col">User</th> : null}
              <th scope="col">Job</th>
              <th scope="col">Clock in</th>
              <th scope="col">Clock out</th>
              <th scope="col">Tracked time</th>
              <th scope="col">Unpaid breaks</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((item) => (
              <tr key={item.id}>
                {kind === "attendance" ? (
                  <td>
                    <div className="clock-user-cell">
                      <span className="clock-user-avatar" aria-hidden="true">
                        {clockInitials(item.agent_name)}
                      </span>
                      <div>
                        <Link
                          href={`/agents/${item.agent_id}?company=${company.id}`}
                          title={item.agent_name}
                        >
                          {item.agent_name}
                        </Link>
                        <small>
                          {!item.ended_at
                            ? item.breaks.some((pause) => !pause.ended_at)
                              ? "On break"
                              : "Clocked in"
                            : "Clocked out"}
                        </small>
                      </div>
                    </div>
                  </td>
                ) : null}
                <td>
                  <span className="clock-job-pill" title={item.job_name}>
                    {item.job_name}
                  </span>
                </td>
                <td>
                  <time dateTime={item.started_at}>
                    {listFormat.format(new Date(item.started_at))}
                  </time>
                </td>
                <td>
                  {item.ended_at ? (
                    <time dateTime={item.ended_at}>
                      {listFormat.format(new Date(item.ended_at))}
                    </time>
                  ) : (
                    "In progress"
                  )}
                </td>
                <td>{duration(item.paid_seconds)}</td>
                <td>{duration(item.unpaid_break_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="clock-empty">
        <strong>
          {kind === "sheets"
            ? "No completed time entries"
            : "No attendance entries to show"}
        </strong>
        {kind === "sheets"
          ? "Completed shifts will appear here after you clock out."
          : "Current shifts and completed shifts overlapping today appear here."}
      </div>
    );
  }
  return (
    <div className="time-clock-page">
      <div className="time-clock-heading">
        <div className="clock-title">
          <ClockIcon />
          <h1>Time Clock</h1>
          <p className="sr-only">
            Track your work and review your time entries
          </p>
        </div>
        <button
          onClick={() => void refreshStatus()}
          disabled={writePending || phase === "checking"}
        >
          {phase === "recovering"
            ? "Refreshing clock…"
            : "Refresh clock status"}
        </button>
      </div>
      {error ? (
        <p className="clock-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="clock-notice" role="status">
          {notice}
        </p>
      ) : null}
      {phase === "unknown" ? (
        <div className="clock-recovery">
          <h2>Review clock status before continuing</h2>
          <p>
            {writePending
              ? "The last action is still awaiting a response. New changes stay locked until it settles."
              : operation
                ? "The last action may have saved. New changes are locked until the clock status is refreshed. Retrying sends the same request once more."
                : "New changes are locked until the latest clock status is successfully loaded."}
          </p>
          <div>
            <button
              disabled={writePending}
              onClick={() => void refreshStatus()}
            >
              Refresh to recover
            </button>
            {operation ? (
              <button
                disabled={writePending}
                onClick={() => void perform(operation)}
              >
                Retry last action
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        className="time-clock-tabs"
        role="tablist"
        aria-label="Time Clock sections"
      >
        <button
          role="tab"
          aria-selected={tab === "clock"}
          onClick={() => switchTab("clock")}
        >
          My clock
        </button>
        {data?.canViewAttendance ? (
          <button
            role="tab"
            aria-selected={tab === "today"}
            onClick={() => switchTab("today")}
          >
            Today
          </button>
        ) : null}
        {data?.canViewAttendance ? (
          <button
            role="tab"
            aria-selected={tab === "timesheets"}
            onClick={() => switchTab("timesheets")}
          >
            Team timesheets
          </button>
        ) : null}
        {data?.canManageJobs ? (
          <button
            role="tab"
            aria-selected={tab === "jobs"}
            onClick={() => switchTab("jobs")}
          >
            Jobs
          </button>
        ) : null}
      </div>
      <div
        className="clock-content"
        aria-busy={phase === "saving" || phase === "recovering"}
      >
        {!data ? (
          <div className="clock-loading">
            Refresh the clock to load current company access and time entries.
          </div>
        ) : tab === "clock" ? (
          <>
            <div className="clock-personal-grid clock-personal">
              <section className="clock-personal-card">
                <div className="clock-section-heading">
                  <h2>
                    {data.agent ? `${data.agent.name}’s clock` : "My clock"}
                  </h2>
                  <span
                    className={`clock-state ${openBreak ? "clock-state-break" : entry ? "" : "clock-state-out"}`}
                  >
                    {openBreak
                      ? `On ${openBreak.paid ? "paid" : "unpaid"} break`
                      : entry
                        ? "Clocked in"
                        : "Clocked out"}
                  </span>
                </div>
                {entry ? (
                  <>
                    <div className="clock-timer-card">
                      <p className="clock-current-job">
                        Work time on{" "}
                        <span title={entry.job_name}>{entry.job_name}</span>
                      </p>
                      <div
                        className="clock-timer"
                        aria-label="Tracked work time"
                      >
                        {duration(clockTime)}
                      </div>
                      <p className="clock-timer-label">
                        Tracked time · Elapsed shift time minus unpaid breaks
                      </p>
                    </div>
                    <div className="clock-actions">
                      {openBreak ? (
                        <button
                          disabled={locked}
                          onClick={() =>
                            change({
                              action: "break_end",
                              entryId: entry.id,
                              revision: entry.revision,
                            })
                          }
                        >
                          End break
                        </button>
                      ) : (
                        <>
                          <label>
                            Break type
                            <select
                              aria-label="Break type"
                              disabled={locked}
                              value={paidBreak ? "paid" : "unpaid"}
                              onChange={(event) =>
                                setPaidBreak(event.target.value === "paid")
                              }
                            >
                              <option value="unpaid">Unpaid break</option>
                              <option value="paid">Paid break</option>
                            </select>
                          </label>
                          <button
                            disabled={locked}
                            onClick={() =>
                              change({
                                action: "break_start",
                                entryId: entry.id,
                                revision: entry.revision,
                                paid: paidBreak,
                              })
                            }
                          >
                            Start break
                          </button>
                        </>
                      )}
                      <button
                        className="clock-out"
                        disabled={locked}
                        onClick={() =>
                          change({
                            action: "clock_out",
                            entryId: entry.id,
                            revision: entry.revision,
                          })
                        }
                      >
                        Clock out
                      </button>
                    </div>
                    {openBreak ? (
                      <p className="clock-help">
                        Clocking out also ends your open break.
                      </p>
                    ) : null}
                  </>
                ) : data.agent ? (
                  <>
                    <label className="clock-job-picker">
                      Select a job
                      <select
                        aria-label="Select a job"
                        disabled={locked}
                        value={selectedJob}
                        onChange={(event) => setSelectedJob(event.target.value)}
                      >
                        <option value="">Choose a job</option>
                        {data.jobs
                          .filter((job) => job.status === "active")
                          .map((job) => (
                            <option value={job.id} key={job.id}>
                              {job.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="clock-primary"
                      disabled={locked || !selectedJob}
                      onClick={() =>
                        change({ action: "clock_in", jobId: selectedJob })
                      }
                    >
                      Clock in
                    </button>
                    {!data.jobs.some((job) => job.status === "active") ? (
                      <p className="clock-help">
                        A company owner or admin must add an active job before
                        you can clock in.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="clock-empty">
                    A linked active user record is required to use your personal
                    clock.
                  </div>
                )}
                <p className="clock-help">
                  Times are shown in {displayTimeZone}.
                </p>
              </section>
              <section className="clock-explainer">
                <h2>{entry ? "Current shift details" : "Your workday"}</h2>
                {entry ? (
                  <dl className="clock-details">
                    <div>
                      <dt>Job</dt>
                      <dd>{entry.job_name}</dd>
                    </div>
                    <div>
                      <dt>Clocked in</dt>
                      <dd>
                        <time dateTime={entry.started_at}>
                          {formatTime.format(new Date(entry.started_at))}
                        </time>
                      </dd>
                    </div>
                    {openBreak ? (
                      <div>
                        <dt>Break started</dt>
                        <dd>
                          <time dateTime={openBreak.started_at}>
                            {formatTime.format(new Date(openBreak.started_at))}
                          </time>
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Unpaid breaks</dt>
                      <dd>
                        {duration(
                          entry.unpaid_break_seconds +
                            (openBreak && !openBreak.paid ? elapsed : 0),
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <ol>
                    <li>Select a job and clock in when you begin work.</li>
                    <li>
                      Start and end a manual paid or unpaid break as needed.
                    </li>
                    <li>
                      Clock out to finish. Your completed entry appears in your
                      timesheets.
                    </li>
                  </ol>
                )}
                <p>
                  Paid breaks remain in tracked time. Unpaid breaks are
                  deducted. Timesheet values come from your recorded clock and
                  break times.
                </p>
              </section>
            </div>
            <section className="clock-timesheets">
              <div className="clock-list-heading">
                <div>
                  <h2>My completed timesheets</h2>
                  <p>
                    Dates filter when your shift started ·{" "}
                    {sheets.timeZone || displayTimeZone}
                  </p>
                </div>
                <button
                  onClick={() => void loadEntries("sheets", appliedDates)}
                  disabled={listLoading.sheets}
                >
                  Refresh my timesheets
                </button>
              </div>
              <div className="clock-date-filters">
                <label>
                  Start date
                  <input
                    type="date"
                    value={dates.startDate}
                    onChange={(event) =>
                      setDates({ ...dates, startDate: event.target.value })
                    }
                  />
                </label>
                <label>
                  End date
                  <input
                    type="date"
                    value={dates.endDate}
                    onChange={(event) =>
                      setDates({ ...dates, endDate: event.target.value })
                    }
                  />
                </label>
                <button onClick={applyDates}>Apply dates</button>
                <button
                  onClick={() => {
                    setDates(noDates);
                    void loadEntries("sheets");
                  }}
                  disabled={
                    !dates.startDate &&
                    !dates.endDate &&
                    !appliedDates.startDate &&
                    !appliedDates.endDate
                  }
                >
                  Clear dates
                </button>
              </div>
              {listLoading.sheets && !sheets.entries.length ? (
                <p className="clock-loading" role="status">
                  Loading timesheets…
                </p>
              ) : (
                table(sheets.entries, "sheets")
              )}
              {sheets.nextCursor ? (
                <div className="clock-pagination">
                  <button
                    disabled={listLoading.sheets}
                    onClick={() =>
                      void loadEntries(
                        "sheets",
                        appliedDates,
                        sheets.nextCursor,
                      )
                    }
                  >
                    Load older timesheets
                  </button>
                </div>
              ) : null}
            </section>
          </>
        ) : tab === "today" && data.canViewAttendance ? (
          <section>
            <div className="clock-list-heading">
              <div>
                <h2>Today’s attendance</h2>
                <p>
                  Current shifts and completed shifts overlapping today ·{" "}
                  {attendance.timeZone || displayTimeZone}
                </p>
              </div>
              <button
                disabled={listLoading.attendance}
                onClick={() => void loadEntries("attendance")}
              >
                Refresh attendance
              </button>
            </div>
            {listLoading.attendance && !attendance.entries.length ? (
              <p className="clock-loading" role="status">
                Loading attendance…
              </p>
            ) : (
              table(attendance.entries, "attendance")
            )}
            {attendance.nextCursor ? (
              <div className="clock-pagination">
                <button
                  disabled={listLoading.attendance}
                  onClick={() =>
                    void loadEntries(
                      "attendance",
                      noDates,
                      attendance.nextCursor,
                    )
                  }
                >
                  Load more attendance
                </button>
              </div>
            ) : null}
            <p className="clock-help">
              {attendance.entries.length} entries shown. Attendance values
              reflect the latest refresh.
            </p>
          </section>
        ) : tab === "timesheets" && data.canViewAttendance ? (
          <TeamTimesheets
            company={data.company}
            actorId={data.actorId}
            onAccessDenied={clearAccess}
          />
        ) : tab === "jobs" && data.canManageJobs ? (
          <section>
            <div className="clock-list-heading">
              <div>
                <h2>Time Clock jobs</h2>
                <p>Choose the work your users can clock into.</p>
              </div>
            </div>
            <form
              className="clock-job-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (jobName.trim())
                  change({ action: "create_job", name: jobName.trim() });
              }}
            >
              <label>
                Job name
                <input
                  value={jobName}
                  disabled={locked}
                  maxLength={100}
                  required
                  onChange={(event) => setJobName(event.target.value)}
                  placeholder="For example, Site support"
                />
              </label>
              <button
                className="clock-primary"
                disabled={locked || !jobName.trim()}
              >
                Create job
              </button>
            </form>
            {data.jobs.length ? (
              <ul className="clock-jobs">
                {data.jobs.map((job) => (
                  <li key={job.id}>
                    <div>
                      <strong>{job.name}</strong>
                      <small>
                        {job.status === "active"
                          ? "Available to clock in"
                          : "Archived · retained for the current entry"}
                      </small>
                    </div>
                    {job.status === "active" ? (
                      <button
                        disabled={locked}
                        onClick={() => {
                          setArchiveJob(job);
                          archiveDialog.current?.showModal();
                        }}
                      >
                        Archive {job.name}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="clock-empty">
                <strong>No jobs yet</strong>Create a job so your users can begin
                clocking in.
              </div>
            )}
          </section>
        ) : null}
      </div>
      <dialog
        ref={archiveDialog}
        className="clock-confirm"
        aria-labelledby="archive-clock-job-title"
        onClose={() => setArchiveJob(null)}
      >
        <h2 id="archive-clock-job-title">Archive {archiveJob?.name}?</h2>
        <p>
          Users will no longer be able to clock into this job. Existing time
          entries and current shifts are retained.
        </p>
        <div>
          <button onClick={() => archiveDialog.current?.close()}>Cancel</button>
          <button
            className="clock-out"
            disabled={locked}
            onClick={() => {
              if (archiveJob) {
                const value = {
                  action: "archive_job" as const,
                  jobId: archiveJob.id,
                  revision: archiveJob.revision,
                };
                archiveDialog.current?.close();
                change(value);
              }
            }}
          >
            Archive job
          </button>
        </div>
      </dialog>
    </div>
  );
}
