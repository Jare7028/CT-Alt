"use client";
import AppShell from "../components/app-shell";
import ShiftTemplates from "./shift-templates";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Company } from "../../lib/agent-types";
import type { RotaPublicationMutation } from "../../lib/rota-publication-types";
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
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
      <path d="M7 3v4m10-4v4M3.5 10h17M7 14h3m4 0h3M7 17.5h3" />
    </svg>
  );
}
function CalendarArtwork() {
  return (
    <svg
      className={styles.calendarArtwork}
      viewBox="0 0 120 82"
      fill="none"
      aria-hidden="true"
    >
      <path d="M91 14l14 68H90z" fill="#1c70ba" />
      <path d="M9 14h83v68H9z" fill="#fff" />
      <path d="M9 14h83v12H9z" fill="#2998ff" />
      {[15, 24, 33, 42, 51, 60, 69, 78, 87].map((x) => (
        <circle key={x} cx={x} cy="20" r="1.25" fill="white" />
      ))}
      <path d="M9 36h83M9 47h83M9 58h83M9 69h83M9 80h83" stroke="#d6ebff" />
      <rect x="15" y="38" width="31" height="8" rx="4" fill="#2998ff" />
      <rect x="59" y="49" width="23" height="8" rx="4" fill="#2998ff" />
      <path
        d="m28 65 3 3 5-5"
        stroke="#54adff"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
    </svg>
  );
}
function ShiftsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="4" rx="1" />
      <rect x="2" y="9" width="12" height="4" rx="1" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2" />
      <path d="M3 13v-1a5 5 0 0 1 10 0v1z" />
    </svg>
  );
}
function elapsedLabel(hours: number) {
  const minutes = Math.round(hours * 60);
  return (
    Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0") +
    ":" +
    (minutes % 60).toString().padStart(2, "0")
  );
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => Array.from(x)[0])
    .join("")
    .toUpperCase();
}
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
  const [rotaBusy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const busy = rotaBusy || templateBusy;
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateSource, setTemplateSource] = useState<RotaShift | null>(null);
  const accessEpoch = useRef(0);
  const templateScope = useRef("");
  const publicationEpoch = useRef(0);
  const publicationLifetime = useRef({ active: true });
  const publicationRef = useRef<
    (RotaPublicationMutation & { caption: string }) | null
  >(null);
  const [publication, setPublication] = useState<
    (RotaPublicationMutation & { caption: string }) | null
  >(null);
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
    | "details"
    | "publish"
    | "archive"
    | "restore"
  >("");
  const [editing, setEditing] = useState<RotaShift | null>(null);
  const [formError, setFormError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const writeLock = useRef(false);
  const [overlapWarning, setOverlapWarning] = useState(false);
  useEffect(() => {
    const lifetime = { active: true };
    publicationLifetime.current = lifetime;
    void Promise.resolve().then(() => {
      if (!lifetime.active) return;
      publicationRef.current = null;
      setPublication(null);
      setBusy(false);
      writeLock.current = false;
      setUncertain(false);
    });
    return () => {
      lifetime.active = false;
    };
  }, [company.id, actorId]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const generation = accessEpoch.current;
      try {
        const response = await fetch("/api/rotas?tenantId=" + company.id, {
          cache: "no-store",
          signal,
        });
        const json = await response.json();
        if (signal?.aborted || generation !== accessEpoch.current) return false;
        if (response.status === 401 || response.status === 403) {
          accessEpoch.current++;
          publicationRef.current = null;
          setPublication(null);
          setData(empty);
          setTemplatesOpen(false);
          setTemplateSource(null);
          setModal("");
        }
        if (!response.ok) throw new Error(json.error);
        setData(json);
        const currentCanManage = (scheduleId: string) =>
          (json.schedules as RotaData["schedules"]).some(
            (item) => item.id === scheduleId,
          ) &&
          (["owner", "admin"].includes(role) ||
            (role === "manager" &&
              (json.admins as RotaData["admins"]).some(
                (grant) =>
                  grant.schedule_id === scheduleId && grant.user_id === actorId,
              )));
        let restored = false;
        try {
          for (const available of json.schedules as RotaData["schedules"]) {
            if (
              currentCanManage(available.id) &&
              localStorage.getItem(
                `ct-alt:rota-template-operation:v1:${actorId}:${company.id}:${available.id}`,
              )
            ) {
              templateScope.current = available.id;
              setSelected(available.id);
              setTemplateSource(null);
              setTemplatesOpen(true);
              setTemplateBusy(true);
              restored = true;
              break;
            }
          }
        } catch {
          // The drawer prevents new template mutations when a recovery marker
          // cannot be persisted; unrelated scheduling remains available.
        }
        if (!restored) {
          setTemplateBusy(false);
          if (
            templateScope.current &&
            !currentCanManage(templateScope.current)
          ) {
            templateScope.current = "";
            setTemplatesOpen(false);
            setTemplateSource(null);
          }
        }
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
    [company.id, actorId, role],
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
  const displayedDrafts = [
    ...new Map(
      displayed
        .filter((shift) => shift.status === "draft")
        .map((shift) => [shift.id, { id: shift.id, revision: shift.revision }]),
    ).values(),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const hours = displayed.reduce(
    (sum, s) => sum + days.reduce((h, d) => h + hoursOn(s, d), 0),
    0,
  );
  const open = (kind: typeof modal, shift: RotaShift | null = null) => {
    setFormError("");
    setOverlapWarning(false);
    setEditing(shift);
    if (kind === "publish") {
      if (
        !schedule ||
        !editable ||
        !displayedDrafts.length ||
        busy ||
        uncertain
      )
        return;
      const snapshot = {
        tenantId: company.id,
        scheduleId: schedule.id,
        scheduleRevision: schedule.revision,
        shifts: displayedDrafts.map((shift) => ({ ...shift })),
        caption: `${view}: ${days[0]} – ${days[days.length - 1]} · ${zone}. Worker search: ${userQuery ? `“${userQuery}”` : "all assigned workers"}. Job: ${jobs.find((job) => job.id === jobFilter)?.name || "all jobs"}. Status: ${statusFilter || "all statuses"}.`,
      };
      publicationRef.current = snapshot;
      setPublication(snapshot);
    }
    setModal(kind);
  };
  const close = () => {
    if (!writeLock.current && !uncertain) {
      publicationRef.current = null;
      setPublication(null);
      setModal("");
    }
  };
  async function save(change: Record<string, unknown>) {
    if (writeLock.current || uncertain || templateBusy) return;
    writeLock.current = true;
    setBusy(true);
    setFormError("");
    setNotice("");
    let rejected = false;
    let acknowledged = false;
    try {
      const response = await fetch("/api/rotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: company.id, change }),
      });
      const result = await response.json();
      if (!response.ok) {
        rejected = response.status >= 400 && response.status < 500;
        if (
          change.action === "save_shift" &&
          response.status === 409 &&
          result.error.includes("overlapping")
        )
          setOverlapWarning(true);
        throw new Error(result.error);
      }
      if (
        !result.saved ||
        (change.action === "create_schedule" &&
          typeof result.saved.schedule_id !== "string")
      )
        throw new Error("The save acknowledgement could not be verified.");
      acknowledged = true;
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
      if (!rejected && !acknowledged) {
        setUncertain(true);
        setFormError(
          "This change may have been saved, but confirmation was lost. Reload schedules and review the result before making another change.",
        );
      } else {
        setFormError(
          e instanceof Error ? e.message : "The change could not be saved.",
        );
      }
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  async function publishDisplayed() {
    const snapshot = publicationRef.current;
    if (!snapshot || writeLock.current || uncertain || templateBusy) return;
    writeLock.current = true;
    setBusy(true);
    setFormError("");
    setNotice("");
    const generation = publicationEpoch.current,
      access = accessEpoch.current,
      lifetime = publicationLifetime.current;
    let rejected = false,
      acknowledged = false;
    try {
      const { caption, ...mutation } = snapshot;
      void caption;
      const response = await fetch("/api/rota-publication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      });
      const result = await response.json();
      if (
        !lifetime.active ||
        generation !== publicationEpoch.current ||
        access !== accessEpoch.current ||
        publicationRef.current !== snapshot
      )
        return;
      if (response.status === 401 || response.status === 403) {
        rejected = true;
        accessEpoch.current++;
        publicationRef.current = null;
        setPublication(null);
        setData(empty);
        setModal("");
        setError(
          "Scheduling access changed. Reload to check your current permissions.",
        );
        return;
      }
      if (!response.ok) {
        rejected = response.status >= 400 && response.status < 500;
        throw Error(result.error || "These drafts could not be published.");
      }
      const saved = result.saved;
      const expected = snapshot.shifts
        .map((shift) => `${shift.id}:${shift.revision + 1}`)
        .sort();
      if (
        saved?.schemaVersion !== 1 ||
        saved.tenantId !== company.id ||
        saved.actorId !== actorId ||
        saved.schedule_id !== snapshot.scheduleId ||
        saved.schedule_revision !== snapshot.scheduleRevision + 1 ||
        saved.published_count !== snapshot.shifts.length ||
        !Array.isArray(saved.shifts) ||
        saved.shifts.length !== expected.length ||
        saved.shifts.some(
          (shift: { id: string; revision: number }) =>
            !shift ||
            typeof shift.id !== "string" ||
            !Number.isSafeInteger(shift.revision),
        ) ||
        JSON.stringify(
          saved.shifts
            .map(
              (shift: { id: string; revision: number }) =>
                `${shift.id}:${shift.revision}`,
            )
            .sort(),
        ) !== JSON.stringify(expected)
      )
        throw Error("The publication acknowledgement could not be verified.");
      acknowledged = true;
      publicationRef.current = null;
      setPublication(null);
      setModal("");
      setNotice(
        `Published ${snapshot.shifts.length} displayed draft ${snapshot.shifts.length === 1 ? "shift" : "shifts"}. Assigned employees can now see them.`,
      );
      setLoading(true);
      await load();
    } catch (e) {
      if (
        !lifetime.active ||
        generation !== publicationEpoch.current ||
        access !== accessEpoch.current
      )
        return;
      if (!rejected && !acknowledged) {
        setUncertain(true);
        setFormError(
          "These drafts may have been published, but confirmation was lost. Reload schedules and review the result before another change.",
        );
      } else
        setFormError(
          e instanceof Error
            ? e.message
            : "These drafts could not be published.",
        );
    } finally {
      if (lifetime.active && generation === publicationEpoch.current) {
        writeLock.current = false;
        setBusy(false);
      }
    }
  }
  async function reviewSavedChanges() {
    if (writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    try {
      if (await load()) {
        setUncertain(false);
        publicationRef.current = null;
        setPublication(null);
        setFormError("");
        setModal("");
        setNotice(
          "Schedules reloaded. Review the latest saved changes before trying again.",
        );
      }
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writeLock.current || uncertain || templateBusy) return;
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
    if (modal === "publish") void publishDisplayed();
    if (["archive", "restore"].includes(modal))
      void save({ action: modal, ...base });
  }
  const templateDenied = useCallback(() => {
    accessEpoch.current++;
    publicationRef.current = null;
    setPublication(null);
    templateScope.current = "";
    setTemplateBusy(false);
    setData(empty);
    setTemplatesOpen(false);
    setTemplateSource(null);
    setModal("");
    setError(
      "Scheduling access changed. Reload to check your current permissions.",
    );
  }, []);
  const templateApplied = useCallback((date: string, message: string) => {
    setDay(date);
    setNotice(message);
  }, []);
  const templateClose = useCallback(() => {
    templateScope.current = "";
    setTemplatesOpen(false);
    setTemplateSource(null);
  }, []);
  const captureTemplate = () => {
    if (!editing || busy || uncertain) return;
    templateScope.current = selected;
    setTemplateSource(editing);
    setModal("");
    setTemplatesOpen(true);
  };
  const today = () => setDay(dateInZone(new Date().toISOString(), zone));
  const changeSchedule = (id: string) => {
    publicationEpoch.current++;
    publicationRef.current = null;
    setPublication(null);
    setModal("");
    setBusy(false);
    writeLock.current = false;
    setUncertain(false);
    templateScope.current = "";
    setTemplatesOpen(false);
    setTemplateSource(null);
    setTemplateBusy(false);
    setSelected(id);
    setJobFilter("");
    setStatusFilter("");
    setUserQuery("");
    setNotice("");
  };
  return (
    <AppShell
      activeModule="rotas"
      companyId={company.id}
      companyName={company.name}
      accountName={
        data.members.find((m) => m.user_id === actorId)?.display_name
      }
      moduleLinks={{
        requests: `/requests?company=${encodeURIComponent(company.id)}`,
        forms: `/forms?company=${encodeURIComponent(company.id)}`,
        "knowledge-base": `/knowledge-base?company=${encodeURIComponent(company.id)}`,
        "smart-groups": owner
          ? `/smart-groups?company=${encodeURIComponent(company.id)}`
          : undefined,
        updates: `/updates?company=${encodeURIComponent(company.id)}`,
        "time-off": `/time-off?company=${encodeURIComponent(company.id)}`,
        "quick-tasks": `/quick-tasks?company=${encodeURIComponent(company.id)}`,
        "time-clock": `/time-clock?company=${encodeURIComponent(company.id)}`,
        overview:
          role !== "employee"
            ? `/overview?company=${encodeURIComponent(company.id)}`
            : undefined,
        activity: owner
          ? `/activity?company=${encodeURIComponent(company.id)}`
          : undefined,
        chat: `/chat?company=${encodeURIComponent(company.id)}`,
        rotas: `/rotas?company=${encodeURIComponent(company.id)}`,
      }}
      companyControl={
        <label>
          <span className="sr-only">Company</span>
          <select
            value={company.id}
            onChange={(event) =>
              router.push(
                `/rotas?company=${encodeURIComponent(event.target.value)}`,
              )
            }
          >
            {companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <main className={styles.shell}>
        <div
          className={selected ? styles.calendarTitleBar : styles.lobbyTitleBar}
        >
          <div
            className={
              styles.lobbyHeading +
              (selected ? " " + styles.calendarHeading : "")
            }
          >
            <span className={styles.lobbyHeadingIcon}>
              <CalendarIcon />
            </span>
            <h1 aria-label={selected ? undefined : "Job scheduling"}>
              {schedule ? schedule.name : "Job scheduling lobby"}
            </h1>
          </div>
          {selected && (
            <div className={styles.calendarHeaderActions}>
              <button onClick={() => changeSchedule("")}>All schedules</button>
              {editable && (
                <button
                  disabled={loading || busy || !!error}
                  onClick={() => open("job")}
                >
                  Job list
                </button>
              )}
              {owner && schedule?.status === "active" && (
                <button
                  disabled={loading || busy || !!error}
                  onClick={() => open("settings")}
                >
                  Settings
                </button>
              )}
              {owner && schedule && (
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
          )}
          {selected && (
            <button
              disabled={busy || loading}
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Reload
            </button>
          )}
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
          <section className={styles.lobbyRegion} aria-label="Schedules">
            <div
              role="tablist"
              aria-label="Schedule status"
              className={styles.lobbyTabs}
            >
              <button
                role="tab"
                aria-label="Active"
                aria-selected={!archived}
                onClick={() => setArchived(false)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="7.5" />
                  <path d="m6.5 10 2.2 2.4 4.8-5" />
                </svg>
                Active (
                {loading || error
                  ? "—"
                  : data.schedules.filter((s) => s.status === "active").length}
                )
              </button>
              <button
                role="tab"
                aria-label="Archived"
                aria-selected={archived}
                onClick={() => setArchived(true)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 3h14v14H3zM3 12h4l1.3 2h3.4l1.3-2h4" />
                </svg>
                Archived (
                {loading || error
                  ? "—"
                  : data.schedules.filter((s) => s.status === "archived")
                      .length}
                )
              </button>
            </div>
            <div
              className={
                styles.lobbyPanel + (archived ? " " + styles.archivedPanel : "")
              }
            >
              <div className={styles.lobbyControls}>
                <button
                  className={styles.lobbyReload}
                  disabled={busy || loading}
                  onClick={() => {
                    setLoading(true);
                    void load();
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M16.5 8a6.5 6.5 0 1 0 .2 4M16.5 3.5V8H12" />
                  </svg>
                  Reload
                </button>
                <div className={styles.lobbySearch}>
                  <input
                    type="search"
                    aria-label="Search schedules"
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="7.5" />
                    <path d="m16 16 5 5" />
                  </svg>
                </div>
                {owner && (
                  <button
                    className={styles.lobbyAdd}
                    aria-label="Create schedule"
                    disabled={loading || !!error}
                    onClick={() => open("schedule")}
                  >
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <circle cx="10" cy="10" r="7.5" />
                      <path d="M10 6v8m-4-4h8" />
                    </svg>
                    Add new
                  </button>
                )}
              </div>
              <div className={styles.scheduleGrid}>
                {data.schedules
                  .filter(
                    (s) =>
                      (s.status === "archived") === archived &&
                      s.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((s) => {
                    const assignedCount = data.assignments.filter(
                      (a) => a.schedule_id === s.id,
                    ).length;
                    const admins = data.members.filter(
                      (m) =>
                        ["owner", "admin"].includes(m.role) ||
                        data.admins.some(
                          (a) =>
                            a.schedule_id === s.id && a.user_id === m.user_id,
                        ),
                    );
                    const enter = () => {
                      changeSchedule(s.id);
                      setDay(dateInZone(new Date().toISOString(), s.time_zone));
                    };
                    return (
                      <article
                        className={styles.scheduleCard}
                        key={s.id}
                        aria-label={"Schedule " + s.name}
                      >
                        <div className={styles.scheduleArt}>
                          <CalendarArtwork />
                        </div>
                        <div className={styles.scheduleBody}>
                          <p className={styles.scheduleLabel}>Schedule</p>
                          <h2>
                            <button
                              className={styles.scheduleName}
                              title={s.name}
                              onClick={enter}
                            >
                              {s.name}
                            </button>
                          </h2>
                          <div className={styles.scheduleAssigned}>
                            <span>Assigned</span>
                            <span
                              className={
                                assignedCount
                                  ? styles.assignedPill
                                  : styles.unassigned
                              }
                            >
                              {assignedCount
                                ? assignedCount +
                                  " " +
                                  (assignedCount === 1 ? "user" : "users")
                                : "Not assigned"}
                              {!owner && role === "employee" && assignedCount
                                ? " (your assignment)"
                                : ""}
                            </span>
                          </div>
                          <div className={styles.scheduleAdmins}>
                            <span>Admins</span>
                            {admins.length ? (
                              <div className={styles.adminAvatars}>
                                {admins.slice(0, 3).map((a, i) => (
                                  <span
                                    key={a.user_id}
                                    className={styles.adminAvatar}
                                    data-tone={i}
                                    role="img"
                                    aria-label={a.display_name}
                                    title={a.display_name}
                                  >
                                    {initials(a.display_name) || "?"}
                                  </span>
                                ))}
                                {admins.length > 3 && (
                                  <span
                                    className={styles.adminMore}
                                    title={admins
                                      .map((a) => a.display_name)
                                      .join(", ")}
                                  >
                                    +{admins.length - 3}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className={styles.unassigned}>
                                {owner ? "Company owners and admins" : "—"}
                              </span>
                            )}
                          </div>
                          <span className={styles.scheduleZone}>
                            {s.time_zone}
                          </span>
                        </div>
                        <div className={styles.scheduleFooter}>
                          <button
                            className={styles.accessSchedule}
                            onClick={enter}
                            aria-label={"Access schedule " + s.name}
                          >
                            Access schedule
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>
              {!loading &&
                !error &&
                !data.schedules.some(
                  (s) =>
                    (s.status === "archived") === archived &&
                    s.name.toLowerCase().includes(query.toLowerCase()),
                ) && (
                  <p className={styles.scheduleEmpty}>
                    No {archived ? "archived" : "active"} schedules match.
                  </p>
                )}
            </div>
          </section>
        )}
        {schedule && (
          <>
            {!supportedRotaZone(requestedZone) && (
              <p role="alert" className={styles.error}>
                This schedule’s time zone cannot be displayed safely. Times are
                shown in UTC and shift editing is disabled. Ask a company owner
                or admin to choose a supported IANA time zone in Settings.
              </p>
            )}
            <section
              className={styles.calendarPane}
              aria-label="Schedule calendar"
            >
              <div className={styles.calendarControls}>
                <div className={styles.calendarViewControls}>
                  <details className={styles.calendarFilterMenu}>
                    <summary>
                      Filters <span aria-hidden="true">⌄</span>
                    </summary>
                    <div className={styles.filters}>
                      <label>
                        Sort users
                        <select
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
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
                  </details>
                  <div
                    role="tablist"
                    aria-label="Calendar view"
                    className={styles.calendarViewTabs}
                  >
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
                  <div className={styles.calendarPeriod}>
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
                    <span>
                      {days.length > 1
                        ? new Intl.DateTimeFormat("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "UTC",
                          }).formatRange(
                            new Date(days[0] + "T12:00:00Z"),
                            new Date(days[days.length - 1] + "T12:00:00Z"),
                          )
                        : new Intl.DateTimeFormat("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "UTC",
                          }).format(new Date(days[0] + "T12:00:00Z"))}
                    </span>
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
                  </div>
                  <label className={styles.calendarDate}>
                    <span className="sr-only">Date</span>
                    <input
                      type="date"
                      value={day}
                      required
                      onChange={(e) => {
                        if (e.target.value) setDay(e.target.value);
                      }}
                    />
                  </label>
                  <button onClick={today}>Today</button>
                </div>
                <div className={styles.calendarWriteActions}>
                  {canManage && (
                    <button
                      id="shift-templates-trigger"
                      disabled={loading || busy || uncertain || !!error}
                      onClick={() => {
                        templateScope.current = selected;
                        setTemplateSource(null);
                        setTemplatesOpen(true);
                      }}
                    >
                      Templates
                    </button>
                  )}
                  {editable && (
                    <>
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
                          uncertain ||
                          !displayedDrafts.length
                        }
                        onClick={() => open("publish")}
                      >
                        Publish ({displayedDrafts.length})
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className={styles.calendarScopeMeta}>
                {zone} ·{" "}
                {schedule.status === "archived"
                  ? "Archived schedule"
                  : canManage
                    ? "Manager view"
                    : "My published shifts"}
              </p>
              <div className={styles.tableScroll}>
                <table
                  className={styles.calendar}
                  style={{ minWidth: 192 + days.length * 138 }}
                >
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">Users</span>
                        <div className={styles.calendarUserSearch}>
                          <input
                            type="search"
                            aria-label="Search users"
                            placeholder="Search users"
                            value={userQuery}
                            onChange={(e) => setUserQuery(e.target.value)}
                          />
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <circle cx="10.5" cy="10.5" r="7.5" />
                            <path d="m16 16 5 5" />
                          </svg>
                        </div>
                      </th>
                      {days.map((d) => {
                        const dayShifts = displayed.filter(
                            (s) => hoursOn(s, d) > 0,
                          ),
                          dayHours = dayShifts.reduce(
                            (h, s) => h + hoursOn(s, d),
                            0,
                          );
                        return (
                          <th scope="col" key={d}>
                            <span className={styles.calendarDay}>
                              {new Intl.DateTimeFormat("en-GB", {
                                weekday: "short",
                                day: "numeric",
                                month: "2-digit",
                                timeZone: "UTC",
                              }).format(new Date(d + "T12:00:00Z"))}
                            </span>
                            <div
                              className={styles.calendarDayTotals}
                              aria-label={"Daily totals for " + d}
                            >
                              <span title={dayHours.toFixed(1) + " hours"}>
                                <ClockIcon />
                                {elapsedLabel(dayHours)}
                              </span>
                              <span title="Shifts">
                                <ShiftsIcon />
                                {dayShifts.length}
                              </span>
                              <span title="Users">
                                <UsersIcon />
                                {new Set(dayShifts.map((s) => s.agent_id)).size}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.id}>
                        <th scope="row">
                          <div className={styles.calendarUser}>
                            <span
                              className={styles.calendarUserAvatar}
                              aria-hidden="true"
                            >
                              {initials(a.first_name + " " + a.last_name)}
                            </span>
                            <div className={styles.calendarUserText}>
                              <span title={a.first_name + " " + a.last_name}>
                                {a.first_name} {a.last_name}
                              </span>
                              <small>
                                <ClockIcon />
                                {elapsedLabel(
                                  displayed
                                    .filter((s) => s.agent_id === a.id)
                                    .reduce(
                                      (sum, s) =>
                                        sum +
                                        days.reduce(
                                          (h, d) => h + hoursOn(s, d),
                                          0,
                                        ),
                                      0,
                                    ),
                                )}
                                <ShiftsIcon />
                                {
                                  displayed.filter((s) => s.agent_id === a.id)
                                    .length
                                }
                                {a.status !== "active"
                                  ? " · Archived user"
                                  : ""}
                              </small>
                            </div>
                          </div>
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
                                      backgroundColor:
                                        s.status === "draft"
                                          ? "#fff"
                                          : job?.color,
                                      color:
                                        s.status === "draft"
                                          ? "#4b5358"
                                          : job
                                            ? jobInk(job.color)
                                            : undefined,
                                      borderColor: job?.color,
                                      borderStyle: "solid",
                                    }}
                                    disabled={
                                      !canManage ||
                                      loading ||
                                      busy ||
                                      !!error ||
                                      (s.status === "draft" && !editable)
                                    }
                                    onClick={() =>
                                      open(
                                        s.status === "published"
                                          ? "details"
                                          : "shift",
                                        s,
                                      )
                                    }
                                    aria-label={`${s.status === "draft" ? "Edit draft" : "Published"} ${s.title || job?.name} ${a.first_name} ${a.last_name}`}
                                  >
                                    <strong>
                                      {localDateTime(s.starts_at, zone).slice(
                                        11,
                                      )}{" "}
                                      –{" "}
                                      {localDateTime(s.ends_at, zone).slice(11)}
                                      {dateInZone(s.starts_at, zone) !==
                                      dateInZone(s.ends_at, zone)
                                        ? " (overnight)"
                                        : ""}
                                    </strong>
                                    <span>{s.title || job?.name}</span>
                                    <small className="sr-only">
                                      {job?.name} ·{" "}
                                      {s.status === "draft"
                                        ? "Draft"
                                        : "Published"}{" "}
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
                </table>
              </div>
              <div
                className={styles.calendarSummary}
                aria-label="Period summary"
              >
                <strong>
                  {view === "Week"
                    ? "Weekly"
                    : view === "Month"
                      ? "Monthly"
                      : "Daily"}{" "}
                  totals
                </strong>
                <span>
                  <ClockIcon />
                  Hours <b>{hours.toFixed(1)} hours</b>
                </span>
                <span>
                  <ShiftsIcon />
                  Shifts <b>{displayed.length} shifts</b>
                </span>
                <span>
                  <UsersIcon />
                  Users{" "}
                  <b>{new Set(displayed.map((s) => s.agent_id)).size} users</b>
                </span>
                <span className="sr-only">
                  Visible {view.toLowerCase()} totals · elapsed time
                </span>
              </div>
              {!agents.length && <p>No assigned users match this search.</p>}
            </section>
            <p className={styles.hint}>
              {canManage
                ? "Drafts are private to schedule managers. Published shifts are visible to their assigned employee."
                : ""}{" "}
              Overnight shifts appear on each day they touch. Hours reflect time
              elapsed, including clock changes.
            </p>
          </>
        )}
        {templatesOpen && schedule && canManage && (
          <ShiftTemplates
            key={company.id + actorId + schedule.id}
            tenantId={company.id}
            actorId={actorId}
            schedule={schedule}
            jobs={jobs}
            agents={activeAssigned}
            day={day}
            source={templateSource}
            close={templateClose}
            reload={load}
            applied={templateApplied}
            denied={templateDenied}
            locked={setTemplateBusy}
          />
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
                      : modal === "details"
                        ? "Published shift details"
                        : modal === "publish"
                          ? "Publish draft shifts"
                          : modal === "archive"
                            ? "Archive schedule"
                            : "Restore schedule"
            }
            close={close}
          >
            <form onSubmit={submit}>
              <fieldset
                className={styles.formFields}
                disabled={busy || uncertain}
              >
                {(modal === "schedule" || modal === "settings") && (
                  <>
                    <label>
                      Schedule name
                      <input
                        name="name"
                        required
                        maxLength={100}
                        defaultValue={
                          modal === "settings" ? schedule?.name : ""
                        }
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
                        Changing the time zone changes the displayed times.
                        Existing shifts keep their absolute start and end times.
                        Saving settings does not publish drafts. Users with
                        retained shifts cannot be removed.
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
                                  r.schedule_id === selected &&
                                  r.agent_id === a.id,
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
                        Company owners and admins always manage schedules.
                        Select managers who can also edit this schedule.
                      </p>
                      {modal === "settings" &&
                        data.admins
                          .filter(
                            (r) =>
                              r.schedule_id === selected &&
                              !data.members.some(
                                (m) =>
                                  m.user_id === r.user_id &&
                                  m.role === "manager",
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
                        defaultValue={
                          editing?.agent_id || activeAssigned[0]?.id
                        }
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
                        <input type="checkbox" name="allow_overlap" />I reviewed
                        the times and allow this user’s overlap.
                      </label>
                    )}
                  </>
                )}
                {modal === "details" && editing && (
                  <>
                    <p>Published · {zone}</p>
                    <p>
                      {editing.title ||
                        jobs.find((j) => j.id === editing.job_id)?.name}
                    </p>
                    <p>
                      {localDateTime(editing.starts_at, zone)} –{" "}
                      {localDateTime(editing.ends_at, zone)}
                    </p>
                    <p>
                      {
                        assigned.find((a) => a.id === editing.agent_id)
                          ?.first_name
                      }{" "}
                      {
                        assigned.find((a) => a.id === editing.agent_id)
                          ?.last_name
                      }
                    </p>
                  </>
                )}
                {(modal === "details" || modal === "shift") &&
                  editing &&
                  canManage && (
                    <button
                      type="button"
                      disabled={!editable || busy || uncertain}
                      onClick={captureTemplate}
                    >
                      Save as template from saved shift
                    </button>
                  )}
                {modal === "publish" && publication && (
                  <>
                    <p>
                      Publish {publication.shifts.length} displayed draft{" "}
                      {publication.shifts.length === 1 ? "shift" : "shifts"}?
                      Assigned employees will be able to see these shifts.
                    </p>
                    <p>{publication.caption}</p>
                    <p>
                      This confirmation keeps the exact draft IDs and revisions
                      selected when it opened. Drafts outside that displayed
                      subset stay private.
                    </p>
                  </>
                )}
                {modal === "archive" && (
                  <p>
                    Move this schedule to Archived? Shifts are retained and
                    remain readable. Retained drafts and published shifts still
                    count in overlap warnings. Managers cannot add or publish
                    shifts until it is restored.
                  </p>
                )}
                {modal === "restore" && <p>Return this schedule to Active?</p>}
              </fieldset>
              {formError && (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              )}
              {uncertain && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={reviewSavedChanges}
                >
                  Reload schedules to review
                </button>
              )}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  disabled={busy || uncertain}
                  onClick={close}
                >
                  Cancel
                </button>
                {modal !== "details" && (
                  <button
                    type="submit"
                    disabled={busy || loading || uncertain}
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
                                ? "Publish displayed drafts"
                                : modal === "archive"
                                  ? "Archive"
                                  : "Restore"}
                  </button>
                )}
              </div>
            </form>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
