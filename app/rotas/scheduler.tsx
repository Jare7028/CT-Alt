"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Company } from "../../lib/agent-types";
import type { RotaData, RotaShift } from "../../lib/rota-types";
import {
  addDays,
  supportedRotaZone,
  displayRotaZone,
  dayBoundary,
  dateInZone,
  localDateTime,
  viewDays,
  zonedInstant,
} from "../../lib/rota-time";
import styles from "./scheduler.module.css";
function jobInk(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179
    ? "#152331"
    : "#ffffff";
}
const empty: RotaData = {
  schedules: [],
  jobs: [],
  shifts: [],
  agents: [],
  assignments: [],
  admins: [],
  members: [],
};
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className={styles.modalHeading}>
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label="Close dialog">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function Scheduler({
  company,
  companies,
  actorId,
  role,
}: {
  company: Company;
  companies: Company[];
  actorId: string;
  role: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<RotaData>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState<"Day" | "Week" | "Month">("Week");
  const [day, setDay] = useState(() =>
    dateInZone(new Date().toISOString(), company.time_zone),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [modal, setModal] = useState<
    | ""
    | "schedule"
    | "settings"
    | "job"
    | "shift"
    | "publish"
    | "archive"
    | "restore"
  >("");
  const [editing, setEditing] = useState<RotaShift | null>(null);
  const [formError, setFormError] = useState("");
  const [overlapWarning, setOverlapWarning] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch("/api/rotas?tenantId=" + company.id, {
          cache: "no-store",
          signal,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        setData(json);
        setError("");
        return true;
      } catch (e) {
        if (signal?.aborted) return false;
        setError(
          e instanceof Error ? e.message : "Schedules could not be loaded.",
        );
        return false;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [company.id],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);
  const schedule = data.schedules.find((s) => s.id === selected);
  const owner = ["owner", "admin"].includes(role);
  const canManage =
    owner ||
    (role === "manager" &&
      data.admins.some(
        (a) => a.schedule_id === selected && a.user_id === actorId,
      ));
  const editable =
    canManage &&
    schedule?.status === "active" &&
    supportedRotaZone(schedule.time_zone);
  const jobs = data.jobs.filter((j) => j.schedule_id === selected);
  const shifts = data.shifts.filter((s) => s.schedule_id === selected);
  const assigned = data.agents.filter((a) =>
    data.assignments.some(
      (r) => r.schedule_id === selected && r.agent_id === a.id,
    ),
  );
  const activeAssigned = assigned.filter((a) => a.status === "active");
  const days = viewDays(day, view);
  const requestedZone = schedule?.time_zone || company.time_zone;
  const zone = displayRotaZone(requestedZone);
  const boundaries = useMemo(
    () =>
      new Map(
        viewDays(day, view).map((d) => [
          d,
          [dayBoundary(d, zone), dayBoundary(addDays(d, 1), zone)],
        ]),
      ),
    [day, view, zone],
  );
  const hoursOn = (s: RotaShift, d: string) => {
    const [start, end] = boundaries.get(d)!;
    return (
      Math.max(
        0,
        Math.min(Date.parse(s.ends_at), end) -
          Math.max(Date.parse(s.starts_at), start),
      ) / 3600000
    );
  };
  const visible = shifts.filter(
    (s) =>
      (!jobFilter || s.job_id === jobFilter) &&
      (!statusFilter || s.status === statusFilter) &&
      days.some((d) => hoursOn(s, d) > 0),
  );
  const agents = assigned
    .filter((a) =>
      (a.first_name + " " + a.last_name)
        .toLowerCase()
        .includes(userQuery.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "hours"
        ? visible
            .filter((s) => s.agent_id === b.id)
            .reduce(
              (sum, s) => sum + days.reduce((h, d) => h + hoursOn(s, d), 0),
              0,
            ) -
          visible
            .filter((s) => s.agent_id === a.id)
            .reduce(
              (sum, s) => sum + days.reduce((h, d) => h + hoursOn(s, d), 0),
              0,
            )
        : (a.last_name + a.first_name).localeCompare(
            b.last_name + b.first_name,
          ),
    );
  const displayed = visible.filter((s) =>
    agents.some((a) => a.id === s.agent_id),
  );
  const hours = displayed.reduce(
    (sum, s) => sum + days.reduce((h, d) => h + hoursOn(s, d), 0),
    0,
  );
  const open = (kind: typeof modal, shift: RotaShift | null = null) => {
    setFormError("");
    setOverlapWarning(false);
    setEditing(shift);
    setModal(kind);
  };
  const close = () => {
    if (!busy) setModal("");
  };
  async function save(change: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      const response = await fetch("/api/rotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: company.id, change }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          change.action === "save_shift" &&
          response.status === 409 &&
          result.error.includes("overlapping")
        )
          setOverlapWarning(true);
        throw new Error(result.error);
      }
      setModal("");
      setNotice(
        change.action === "publish"
          ? "Published. Assigned employees can now see these shifts."
          : "Saved.",
      );
      if (change.action === "create_schedule") {
        setSelected(result.saved.schedule_id);
        setArchived(false);
      }
      setLoading(true);
      await load();
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) || "");
    const base = { schedule_id: selected, revision: schedule?.revision };
    if (modal === "schedule" || modal === "settings")
      void save({
        ...(modal === "settings" ? base : {}),
        action: modal === "settings" ? "update_schedule" : "create_schedule",
        name: text("name"),
        time_zone: text("time_zone"),
        agent_ids: form.getAll("agent_ids"),
        admin_ids: form.getAll("admin_ids"),
      });
    if (modal === "job")
      void save({
        action: "add_job",
        ...base,
        name: text("name"),
        color: text("color"),
      });
    if (modal === "shift") {
      try {
        const start = zonedInstant(
          text("starts_at"),
          zone,
          text("start_occurrence") as "" | "earlier" | "later",
        );
        const end = zonedInstant(
          text("ends_at"),
          zone,
          text("end_occurrence") as "" | "earlier" | "later",
        );
        const duration = (Date.parse(end) - Date.parse(start)) / 3600000;
        if (duration <= 0 || duration > 24)
          throw new Error(
            "End must follow start, with up to 24 elapsed hours. For overnight shifts, choose the following date.",
          );
        void save({
          action: "save_shift",
          ...base,
          ...(editing ? { id: editing.id } : {}),
          agent_id: text("agent_id"),
          job_id: text("job_id"),
          starts_at: start,
          ends_at: end,
          title: text("title"),
          allow_overlap: form.get("allow_overlap") === "on",
        });
      } catch (e) {
        setFormError(
          e instanceof Error ? e.message : "Enter valid shift times.",
        );
      }
    }
    if (["publish", "archive", "restore"].includes(modal))
      void save({ action: modal, ...base });
  }
  const today = () => setDay(dateInZone(new Date().toISOString(), zone));
  const changeSchedule = (id: string) => {
    setSelected(id);
    setJobFilter("");
    setStatusFilter("");
    setUserQuery("");
    setNotice("");
  };
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/agents" className={styles.brand}>
          CT Alt
        </Link>
        <span>Client rotas</span>
        <label className={styles.company}>
          Company
          <select
            value={company.id}
            onChange={(e) => {
              router.push("/rotas?company=" + e.target.value);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className={styles.toolbar}>
        <h1>{schedule ? schedule.name : "Job scheduling"}</h1>
        {selected ? (
          <button onClick={() => changeSchedule("")}>All schedules</button>
        ) : (
          owner && (
            <button
              disabled={loading || !!error}
              className={styles.primary}
              onClick={() => open("schedule")}
            >
              Create schedule
            </button>
          )
        )}
        <button
          disabled={busy || loading}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Reload
        </button>
      </div>
      {loading && <p role="status">Loading schedules…</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {!selected && (
        <>
          <div className={styles.toolbar}>
            <div role="tablist" aria-label="Schedule status">
              <button
                role="tab"
                aria-selected={!archived}
                onClick={() => setArchived(false)}
              >
                Active
              </button>
              <button
                role="tab"
                aria-selected={archived}
                onClick={() => setArchived(true)}
              >
                Archived
              </button>
            </div>
            <input
              type="search"
              aria-label="Search schedules"
              placeholder="Search schedules"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.lobby}>
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Assigned users</th>
                  <th>Administrators</th>
                  <th>Time zone</th>
                </tr>
              </thead>
              <tbody>
                {data.schedules
                  .filter(
                    (s) =>
                      (s.status === "archived") === archived &&
                      s.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <button
                          className={styles.textButton}
                          onClick={() => {
                            changeSchedule(s.id);
                            setDay(
                              dateInZone(new Date().toISOString(), s.time_zone),
                            );
                          }}
                        >
                          {s.name}
                        </button>
                      </td>
                      <td>
                        {
                          data.assignments.filter((a) => a.schedule_id === s.id)
                            .length
                        }
                        {!owner && role === "employee"
                          ? " (your assignment)"
                          : ""}
                      </td>
                      <td>
                        {data.admins
                          .filter((a) => a.schedule_id === s.id)
                          .map(
                            (a) =>
                              data.members.find((m) => m.user_id === a.user_id)
                                ?.display_name,
                          )
                          .filter(Boolean)
                          .join(", ") ||
                          (owner ? "Company owners and admins" : "—")}
                      </td>
                      <td>{s.time_zone}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!loading &&
            !error &&
            !data.schedules.some(
              (s) =>
                (s.status === "archived") === archived &&
                s.name.toLowerCase().includes(query.toLowerCase()),
            ) && <p>No {archived ? "archived" : "active"} schedules match.</p>}
        </>
      )}
      {schedule && (
        <>
          {!supportedRotaZone(requestedZone) && (
            <p role="alert" className={styles.error}>
              This schedule’s time zone cannot be displayed safely. Times are
              shown in UTC and shift editing is disabled. Ask a company owner or
              admin to choose a supported IANA time zone in Settings.
            </p>
          )}
          <div className={styles.toolbar}>
            <p className={styles.zone}>
              {zone} ·{" "}
              {schedule.status === "archived"
                ? "Archived schedule"
                : canManage
                  ? "Manager view"
                  : "My published shifts"}
            </p>
            <div className={styles.actions}>
              {editable && (
                <>
                  <button
                    disabled={loading || busy || !!error}
                    onClick={() => open("job")}
                  >
                    Job list
                  </button>
                  <div className={styles.addMenu}>
                    <button
                      aria-expanded={addOpen}
                      disabled={
                        loading ||
                        busy ||
                        !!error ||
                        !jobs.length ||
                        !activeAssigned.length
                      }
                      onClick={() => setAddOpen(!addOpen)}
                    >
                      Add ▾
                    </button>
                    {addOpen && (
                      <div className={styles.addOptions}>
                        <button
                          onClick={() => {
                            setAddOpen(false);
                            open("shift");
                          }}
                        >
                          Add single shift
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className={styles.primary}
                    disabled={
                      loading ||
                      busy ||
                      !!error ||
                      !shifts.some((s) => s.status === "draft")
                    }
                    onClick={() => open("publish")}
                  >
                    Publish ({shifts.filter((s) => s.status === "draft").length}
                    )
                  </button>
                </>
              )}
              {owner && schedule.status === "active" && (
                <button
                  disabled={loading || busy || !!error}
                  onClick={() => open("settings")}
                >
                  Settings
                </button>
              )}
              {owner && (
                <button
                  disabled={loading || busy || !!error}
                  onClick={() =>
                    open(schedule.status === "archived" ? "restore" : "archive")
                  }
                >
                  {schedule.status === "archived"
                    ? "Restore schedule"
                    : "Archive schedule"}
                </button>
              )}
            </div>
          </div>
          <div className={styles.toolbar}>
            <div className={styles.actions}>
              <button
                aria-label="Previous period"
                onClick={() =>
                  setDay(
                    view === "Month"
                      ? new Date(
                          Date.UTC(
                            Number(day.slice(0, 4)),
                            Number(day.slice(5, 7)) - 2,
                            1,
                          ),
                        )
                          .toISOString()
                          .slice(0, 10)
                      : addDays(day, view === "Week" ? -7 : -1),
                  )
                }
              >
                ‹
              </button>
              <button onClick={today}>Today</button>
              <button
                aria-label="Next period"
                onClick={() =>
                  setDay(
                    view === "Month"
                      ? new Date(
                          Date.UTC(
                            Number(day.slice(0, 4)),
                            Number(day.slice(5, 7)),
                            1,
                          ),
                        )
                          .toISOString()
                          .slice(0, 10)
                      : addDays(day, view === "Week" ? 7 : 1),
                  )
                }
              >
                ›
              </button>
              <label>
                Date
                <input
                  type="date"
                  value={day}
                  required
                  onChange={(e) => {
                    if (e.target.value) setDay(e.target.value);
                  }}
                />
              </label>
            </div>
            <div role="tablist" aria-label="Calendar view">
              {(["Day", "Week", "Month"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filters}>
            <input
              type="search"
              aria-label="Search users"
              placeholder="Search users"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
            <label>
              Sort users
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">Name</option>
                <option value="hours">Hours, highest first</option>
              </select>
            </label>
            <label>
              Job
              <select
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
              >
                <option value="">All jobs</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </label>
            {canManage && (
              <label>
                Shift status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All shifts</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
            )}
          </div>
          <div className={styles.summary} aria-label="Period summary">
            <strong>{hours.toFixed(1)} hours</strong>
            <span>{displayed.length} shifts</span>
            <span>{new Set(displayed.map((s) => s.agent_id)).size} users</span>
            <span>Visible {view.toLowerCase()} totals · elapsed time</span>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.calendar}>
              <thead>
                <tr>
                  <th scope="col">Users</th>
                  {days.map((d) => (
                    <th scope="col" key={d}>
                      {new Intl.DateTimeFormat("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        timeZone: "UTC",
                      }).format(new Date(d + "T12:00:00Z"))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      {a.first_name} {a.last_name}
                      <small>
                        {displayed
                          .filter((s) => s.agent_id === a.id)
                          .reduce(
                            (sum, s) =>
                              sum + days.reduce((h, d) => h + hoursOn(s, d), 0),
                            0,
                          )
                          .toFixed(1)}{" "}
                        h{a.status !== "active" ? " · Archived user" : ""}
                      </small>
                    </th>
                    {days.map((d) => (
                      <td key={d}>
                        {displayed
                          .filter(
                            (s) => s.agent_id === a.id && hoursOn(s, d) > 0,
                          )
                          .map((s) => {
                            const job = jobs.find((j) => j.id === s.job_id);
                            return (
                              <button
                                key={s.id}
                                className={styles.shift}
                                style={{
                                  backgroundColor: job?.color,
                                  color: job ? jobInk(job.color) : undefined,
                                  borderStyle:
                                    s.status === "draft" ? "dashed" : "solid",
                                }}
                                disabled={
                                  !editable ||
                                  loading ||
                                  busy ||
                                  !!error ||
                                  s.status === "published"
                                }
                                onClick={() => open("shift", s)}
                                aria-label={`${s.status === "draft" ? "Edit draft" : "Published"} ${s.title || job?.name} ${a.first_name} ${a.last_name}`}
                              >
                                <strong>{job?.name}</strong>
                                <span>
                                  {localDateTime(s.starts_at, zone).slice(11)} –{" "}
                                  {localDateTime(s.ends_at, zone).slice(11)}
                                  {dateInZone(s.starts_at, zone) !==
                                  dateInZone(s.ends_at, zone)
                                    ? " (overnight)"
                                    : ""}
                                </span>
                                {s.title && <span>{s.title}</span>}
                                <small>
                                  {s.status === "draft" ? "Draft" : "Published"}{" "}
                                  · {hoursOn(s, d).toFixed(1)} h today
                                </small>
                              </button>
                            );
                          })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Daily totals</th>
                  {days.map((d) => (
                    <td key={d}>
                      {displayed
                        .reduce((sum, s) => sum + hoursOn(s, d), 0)
                        .toFixed(1)}{" "}
                      h
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {!agents.length && <p>No assigned users match this search.</p>}
          <p className={styles.hint}>
            {canManage
              ? "Drafts are private to schedule managers. Published shifts are visible to their assigned employee."
              : ""}{" "}
            Overnight shifts appear on each day they touch. Hours reflect time
            elapsed, including clock changes.
          </p>
        </>
      )}
      {modal && (
        <Modal
          title={
            modal === "settings"
              ? "Schedule settings"
              : modal === "schedule"
                ? "Create schedule"
                : modal === "job"
                  ? "Job list"
                  : modal === "shift"
                    ? editing
                      ? "Edit draft shift"
                      : "Add draft shift"
                    : modal === "publish"
                      ? "Publish draft shifts"
                      : modal === "archive"
                        ? "Archive schedule"
                        : "Restore schedule"
          }
          close={close}
        >
          <form onSubmit={submit}>
            {(modal === "schedule" || modal === "settings") && (
              <>
                <label>
                  Schedule name
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={modal === "settings" ? schedule?.name : ""}
                  />
                </label>
                <label>
                  Time zone
                  <input
                    name="time_zone"
                    required
                    defaultValue={
                      modal === "settings"
                        ? schedule?.time_zone
                        : company.time_zone
                    }
                    maxLength={100}
                  />
                </label>
                <p>Use an IANA time zone such as Europe/London.</p>
                {modal === "settings" && (
                  <p>
                    Changing the time zone changes the displayed times. Existing
                    shifts keep their absolute start and end times. Saving
                    settings does not publish drafts. Users with retained shifts
                    cannot be removed.
                  </p>
                )}
                <fieldset>
                  <legend>Assigned users</legend>
                  {data.agents
                    .filter(
                      (a) =>
                        a.status === "active" ||
                        (modal === "settings" &&
                          data.assignments.some(
                            (r) =>
                              r.schedule_id === selected && r.agent_id === a.id,
                          )),
                    )
                    .map((a) => (
                      <label className={styles.checkbox} key={a.id}>
                        <input
                          type="checkbox"
                          name="agent_ids"
                          value={a.id}
                          defaultChecked={
                            modal === "settings" &&
                            data.assignments.some(
                              (r) =>
                                r.schedule_id === selected &&
                                r.agent_id === a.id,
                            )
                          }
                        />
                        {a.first_name} {a.last_name}
                      </label>
                    ))}
                </fieldset>
                <fieldset>
                  <legend>Schedule administrators</legend>
                  <p>
                    Company owners and admins always manage schedules. Select
                    managers who can also edit this schedule.
                  </p>
                  {modal === "settings" &&
                    data.admins
                      .filter(
                        (r) =>
                          r.schedule_id === selected &&
                          !data.members.some(
                            (m) =>
                              m.user_id === r.user_id && m.role === "manager",
                          ),
                      )
                      .map((r) => (
                        <p key={r.user_id}>
                          Existing unavailable administrator retained.
                          <input
                            type="hidden"
                            name="admin_ids"
                            value={r.user_id}
                          />
                        </p>
                      ))}
                  {data.members
                    .filter((m) => m.role === "manager")
                    .map((m) => (
                      <label className={styles.checkbox} key={m.user_id}>
                        <input
                          type="checkbox"
                          name="admin_ids"
                          value={m.user_id}
                          defaultChecked={
                            modal === "settings" &&
                            data.admins.some(
                              (r) =>
                                r.schedule_id === selected &&
                                r.user_id === m.user_id,
                            )
                          }
                        />
                        {m.display_name}
                      </label>
                    ))}
                </fieldset>
              </>
            )}
            {modal === "job" && (
              <>
                <ul className={styles.jobs}>
                  {jobs.map((j) => (
                    <li key={j.id}>
                      <span style={{ backgroundColor: j.color }} />
                      {j.name}
                    </li>
                  ))}
                </ul>
                <label>
                  Job name
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  Job color
                  <input
                    name="color"
                    type="color"
                    defaultValue="#285c4c"
                    required
                  />
                </label>
              </>
            )}
            {modal === "shift" && (
              <>
                <p>
                  Times are in {zone}. Choose the next date for an overnight
                  shift.
                </p>
                <label>
                  User
                  <select
                    name="agent_id"
                    defaultValue={editing?.agent_id || activeAssigned[0]?.id}
                    required
                  >
                    {activeAssigned.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.first_name} {a.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Job
                  <select
                    name="job_id"
                    defaultValue={editing?.job_id || jobs[0]?.id}
                    required
                  >
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Shift title
                  <input
                    name="title"
                    defaultValue={editing?.title}
                    maxLength={100}
                  />
                </label>
                <label>
                  Start
                  <input
                    name="starts_at"
                    type="datetime-local"
                    required
                    defaultValue={
                      editing
                        ? localDateTime(editing.starts_at, zone)
                        : day + "T09:00"
                    }
                  />
                </label>
                <label>
                  Start clock-change occurrence
                  <select name="start_occurrence" defaultValue="">
                    <option value="">Choose if time occurs twice</option>
                    <option value="earlier">Earlier occurrence</option>
                    <option value="later">Later occurrence</option>
                  </select>
                </label>
                <label>
                  End
                  <input
                    name="ends_at"
                    type="datetime-local"
                    required
                    defaultValue={
                      editing
                        ? localDateTime(editing.ends_at, zone)
                        : day + "T17:00"
                    }
                  />
                </label>
                <label>
                  End clock-change occurrence
                  <select name="end_occurrence" defaultValue="">
                    <option value="">Choose if time occurs twice</option>
                    <option value="earlier">Earlier occurrence</option>
                    <option value="later">Later occurrence</option>
                  </select>
                </label>
                {overlapWarning && (
                  <label className={styles.checkbox}>
                    <input type="checkbox" name="allow_overlap" />I reviewed the
                    times and allow this user’s overlap.
                  </label>
                )}
              </>
            )}
            {modal === "publish" && (
              <p>
                Publish all {shifts.filter((s) => s.status === "draft").length}{" "}
                draft shifts in this schedule, including drafts outside the
                displayed period? Assigned employees will be able to see them.
              </p>
            )}
            {modal === "archive" && (
              <p>
                Move this schedule to Archived? Shifts are retained and remain
                readable. Retained drafts and published shifts still count in
                overlap warnings. Managers cannot add or publish shifts until it
                is restored.
              </p>
            )}
            {modal === "restore" && <p>Return this schedule to Active?</p>}
            {formError && (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            )}
            <div className={styles.modalActions}>
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || loading}
                className={styles.primary}
              >
                {busy
                  ? "Saving…"
                  : modal === "shift"
                    ? "Save draft"
                    : modal === "job"
                      ? "Add job"
                      : modal === "settings"
                        ? "Save settings"
                        : modal === "schedule"
                          ? "Create schedule"
                          : modal === "publish"
                            ? "Publish all drafts"
                            : modal === "archive"
                              ? "Archive"
                              : "Restore"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
