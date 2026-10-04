"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import type { RotaAgent, Schedule } from "../../lib/rota-types";
import type {
  RotaPeriodKind,
  RotaPeriodFilters,
  RotaPeriodMetadata,
  RotaPeriodEntry,
  RotaPeriodHistoricalEntry,
  RotaPeriodTargetEntry,
  RotaPeriodCatalogueData,
  RotaPeriodHistoricalData,
  RotaPeriodSourcePreview,
  RotaPeriodTargetPreview,
  RotaPeriodPageKind,
  RotaPeriodVisibleCommitment,
  RotaPeriodOccurrence,
  RotaPeriodChange,
  RotaPeriodMutation,
  RotaPeriodRecoveryQuery,
  RotaPeriodSaved,
} from "../../lib/rota-period-template-types";
import { ROTA_PERIOD_LIMITS } from "../../lib/rota-period-template-types";
import {
  parseRotaPeriodCatalogue,
  parseRotaPeriodHistorical,
  parseRotaPeriodSourcePreview,
  parseRotaPeriodTargetPreview,
  parseRotaPeriodSaved,
  parseRotaPeriodReconciliation,
  rotaPeriodRecoveryQuerySchema,
  rotaPeriodMutationSchema,
} from "../../lib/rota-period-template-validation";
import { viewDays } from "../../lib/rota-time";
import PeriodTemplatePreview from "./period-template-preview";
import type { PeriodPreviewRow } from "./period-template-preview";
import styles from "./period-templates.module.css";
type Props = {
  tenantId: string;
  actorId: string;
  role: string;
  schedule: Schedule;
  kind: RotaPeriodKind;
  day: string;
  sourceAnchor: string;
  sourceFilters: RotaPeriodFilters;
  saveSource: boolean;
  loadMode?: boolean;
  agents?: RotaAgent[];
  close: () => void;
  singleTab: () => void;
  reload: () => Promise<boolean>;
  applied: (date: string, message: string) => void;
  denied: () => void;
  locked: (value: boolean) => void;
  acquireWrite: () => boolean;
  accessGeneration: () => number;
};
class StaleRead extends Error {}
class HttpFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function row(entry: RotaPeriodEntry): PeriodPreviewRow {
  return {
    index: entry.index,
    workerId: entry.agent_id,
    worker: entry.agent_name,
    job: entry.job_name,
    color: entry.job_color,
    title: entry.title,
    startOffset: entry.start_day_offset,
    endOffset: entry.end_day_offset,
    startMicros: entry.start_clock_micros,
    endMicros: entry.end_clock_micros,
    originalStart: entry.source_starts_at,
    originalEnd: entry.source_ends_at,
  };
}
function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}
type TargetBucket = {
  entries: RotaPeriodTargetEntry[];
  commitments: RotaPeriodVisibleCommitment[];
  nextCursor: string | null;
  total: number;
};
export default function PeriodTemplates({
  tenantId,
  actorId,
  role,
  schedule,
  kind: initialKind,
  day,
  sourceAnchor,
  sourceFilters,
  saveSource,
  loadMode = false,
  agents = [],
  close,
  singleTab,
  reload,
  applied,
  denied,
  locked,
  acquireWrite,
  accessGeneration,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    life = useRef({ active: true }),
    epoch = useRef(0),
    transport = useRef(false),
    consumedCatalogRefresh = useRef(0),
    marker = useRef<RotaPeriodRecoveryQuery | null>(null),
    pending = useRef<RotaPeriodMutation | null>(null),
    cache = useRef<{
      catalog: RotaPeriodCatalogueData | null;
      history: RotaPeriodHistoricalData | null;
      source: RotaPeriodSourcePreview | null;
      target: RotaPeriodTargetPreview | null;
      sourceRows: RotaPeriodEntry[];
      historyRows: RotaPeriodHistoricalEntry[];
      buckets: Partial<Record<RotaPeriodPageKind, TargetBucket>>;
    }>({
      catalog: null,
      history: null,
      source: null,
      target: null,
      sourceRows: [],
      historyRows: [],
      buckets: {},
    });
  const [initialAccessGeneration] = useState(accessGeneration);
  const [initialRole] = useState(role);
  const latestRole = useRef(role);
  useLayoutEffect(() => {
    latestRole.current = role;
  }, [role]);
  const markerKey = `ct-alt:rota-period-template-operation:v1:${actorId}:${tenantId}:${schedule.id}`;
  const [kind, setKind] = useState(initialKind),
    [phase, setPhase] = useState<
      "catalog" | "source" | "history" | "target" | "rename" | "delete"
    >(saveSource ? "source" : "catalog"),
    [query, setQuery] = useState(""),
    [catalogRefresh, setCatalogRefresh] = useState(0),
    [catalog, setCatalog] = useState<RotaPeriodCatalogueData | null>(null),
    [selected, setSelected] = useState<RotaPeriodMetadata | null>(null),
    [history, setHistory] = useState<RotaPeriodHistoricalData | null>(null),
    [historyRows, setHistoryRows] = useState<RotaPeriodHistoricalEntry[]>([]),
    [source, setSource] = useState<RotaPeriodSourcePreview | null>(null),
    [target, setTarget] = useState<RotaPeriodTargetPreview | null>(null),
    [targetAnchor, setTargetAnchor] = useState(
      initialKind === "week" ? viewDays(day, "Week")[0] : day,
    ),
    [occurrences, setOccurrences] = useState<RotaPeriodOccurrence[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [markerReady, setMarkerReady] = useState(false);
  const reviewAnchor =
    kind === initialKind
      ? sourceAnchor
      : kind === "week"
        ? viewDays(day, "Week")[0]
        : day;
  const freshSchedule =
    target?.schedule ||
    history?.schedule ||
    source?.schedule ||
    catalog?.schedule ||
    schedule;
  const editable =
    freshSchedule.status === "active" &&
    freshSchedule.revision === schedule.revision;
  const current = () =>
    life.current.active &&
    initialAccessGeneration === accessGeneration() &&
    initialRole === latestRole.current;
  function clearViews() {
    cache.current = {
      catalog: null,
      history: null,
      source: null,
      target: null,
      sourceRows: [],
      historyRows: [],
      buckets: {},
    };
    setCatalog(null);
    setSelected(null);
    setHistory(null);
    setHistoryRows([]);
    setSource(null);
    setTarget(null);
  }
  function accessDenied() {
    epoch.current++;
    clearViews();
    pending.current = null;
    denied();
  }
  function clearMarker() {
    localStorage.removeItem(markerKey);
    marker.current = null;
    setMarkerReady(false);
    pending.current = null;
    setUncertain(false);
  }
  async function request(
    generation: number,
    body?: unknown,
    params?: URLSearchParams,
  ) {
    const response = await fetch(
      "/api/rota-period-templates" + (params ? "?" + params : ""),
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
          }
        : { cache: "no-store" },
    );
    const result = await response.json();
    if (!current() || generation !== epoch.current) throw new StaleRead();
    if (response.status === 401 || response.status === 403) {
      accessDenied();
      throw new StaleRead();
    }
    if (!response.ok)
      throw new HttpFailure(
        response.status,
        typeof result.error === "string"
          ? result.error
          : "The template request could not be completed.",
      );
    return result;
  }
  function envelope(value: {
    tenantId: string;
    actorId: string;
    schedule: { id: string };
    capacity?: { companyUsageVisible: boolean };
  }) {
    if (
      value.tenantId !== tenantId ||
      value.actorId !== actorId ||
      value.schedule.id !== schedule.id ||
      (value.capacity !== undefined &&
        value.capacity.companyUsageVisible !==
          ["owner", "admin"].includes(role))
    )
      throw Error(
        "This preview could not be verified. Refresh before continuing.",
      );
  }
  function readError(caught: unknown) {
    if (caught instanceof StaleRead || !current()) return;
    setError(
      caught instanceof HttpFailure
        ? caught.message
        : "This preview could not be verified or loaded. Review it again before continuing.",
    );
  }
  const loadCatalog = useCallback(
    async (cursor?: string, preserveError = false) => {
      if (transport.current || marker.current) return;
      const generation = ++epoch.current;
      setLoading(true);
      if (!preserveError) setError("");
      if (!cursor) {
        cache.current.catalog = null;
        setCatalog(null);
      }
      try {
        const params = new URLSearchParams({
          tenantId,
          scheduleId: schedule.id,
          kind,
          q: query,
          limit: "100",
        });
        if (cursor) params.set("cursor", cursor);
        const result = await request(generation, undefined, params);
        const value = parseRotaPeriodCatalogue(result.data);
        envelope(value);
        if (value.kind !== kind || value.q !== query)
          throw Error("Catalog scope changed.");
        const previous = cache.current.catalog;
        if (
          cursor &&
          (!previous || previous.schedule.revision !== value.schedule.revision)
        )
          throw Error("Template catalog changed while paging.");
        const templates = cursor
          ? [...(previous?.templates || []), ...value.templates]
          : value.templates;
        if (
          new Set(templates.map((template) => template.id)).size !==
            templates.length ||
          templates.length > value.page.total
        )
          throw Error("Catalog page is inconsistent.");
        const next = { ...value, templates };
        cache.current.catalog = next;
        setCatalog(next);
      } catch (caught) {
        if (!(caught instanceof StaleRead)) {
          cache.current.catalog = null;
          setCatalog(null);
        }
        readError(caught);
      } finally {
        if (current() && generation === epoch.current) setLoading(false);
      }
    },
    // Requests are keyed by the complete catalog scope; state-only helpers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantId, actorId, role, schedule.id, schedule.revision, kind, query],
  );
  useLayoutEffect(() => {
    const lifetime = { active: true };
    life.current = lifetime;
    const restoreFocus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    void Promise.resolve().then(() => {
      if (!lifetime.active) return;
      try {
        const stored = localStorage.getItem(markerKey);
        if (stored) {
          const value = rotaPeriodRecoveryQuerySchema.parse(JSON.parse(stored));
          if (value.tenantId !== tenantId || value.scheduleId !== schedule.id)
            throw Error("Operation scope changed.");
          marker.current = value;
          setMarkerReady(true);
          setUncertain(true);
          locked(true);
          setError(
            "An earlier template change needs an authoritative status check before another scheduling change.",
          );
        }
      } catch {
        setUncertain(true);
        locked(true);
        setError(
          "The stored operation could not be verified. Keep scheduling changes locked until it is reviewed.",
        );
      }
    });
    return () => {
      lifetime.active = false;
      locked(false);
      if (restoreFocus?.isConnected) restoreFocus.focus();
      else document.getElementById("shift-templates-trigger")?.focus();
    };
  }, [tenantId, actorId, schedule.id, markerKey, locked]);
  useEffect(() => {
    if (phase !== "catalog") return;
    const preserveError = consumedCatalogRefresh.current !== catalogRefresh;
    consumedCatalogRefresh.current = catalogRefresh;
    void Promise.resolve().then(async () => {
      await loadCatalog(undefined, preserveError);
      while (
        current() &&
        cache.current.catalog?.q === query &&
        cache.current.catalog.kind === kind &&
        cache.current.catalog.page.nextCursor
      ) {
        await loadCatalog(cache.current.catalog.page.nextCursor, preserveError);
      }
    });
    // Scope changes replace the complete catalog request chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, loadCatalog, catalogRefresh]);
  async function sourcePreview(cursor?: string, all = false) {
    if (transport.current || marker.current) return;
    const generation = ++epoch.current;
    setLoading(true);
    setError("");
    if (!cursor) {
      cache.current.source = null;
      cache.current.sourceRows = [];
      setSource(null);
    }
    try {
      let next = cursor;
      do {
        const result = await request(generation, {
          mode: "source-preview",
          tenantId,
          scheduleId: schedule.id,
          scheduleRevision: schedule.revision,
          kind,
          sourceAnchor: reviewAnchor,
          sourceFilters,
          limit: 100,
          ...(next ? { cursor: next } : {}),
        });
        const value = parseRotaPeriodSourcePreview(result.data);
        envelope(value);
        if (
          value.source.kind !== kind ||
          value.source.anchor !== reviewAnchor ||
          value.source.zone !== value.schedule.time_zone ||
          JSON.stringify(value.source.filters) !==
            JSON.stringify(sourceFilters) ||
          value.firstPage !== !next
        )
          throw Error("Source review scope changed.");
        const previous = cache.current.source;
        if (
          next &&
          (!previous ||
            previous.sourceReviewDigest !== value.sourceReviewDigest ||
            previous.schedule.revision !== value.schedule.revision ||
            JSON.stringify(previous.source) !== JSON.stringify(value.source))
        )
          throw Error("Source changed while reviewing its pages.");
        const rows = next
          ? [...cache.current.sourceRows, ...value.entries]
          : value.entries;
        if (
          rows.some((entry, index) => entry.index !== index) ||
          rows.length > value.source.entryCount
        )
          throw Error("Source entry paging is incomplete or duplicated.");
        const first = next ? previous! : value;
        if (
          !first.firstPage ||
          rows.some(
            (entry) =>
              first.selectors[entry.index]?.id !== entry.source_shift_id ||
              first.selectors[entry.index]?.revision !== entry.source_revision,
          )
        )
          throw Error(
            "Source entries differ from the complete reviewed selection.",
          );
        cache.current.source = { ...first, page: value.page };
        cache.current.sourceRows = rows;
        setSource(cache.current.source);
        next = value.page.nextCursor || undefined;
        if (next && value.entries.length === 0)
          throw Error("Source page did not advance.");
      } while (all && next && current() && generation === epoch.current);
    } catch (caught) {
      if (!(caught instanceof StaleRead)) {
        cache.current.source = null;
        cache.current.sourceRows = [];
        setSource(null);
      }
      readError(caught);
    } finally {
      if (current() && generation === epoch.current) setLoading(false);
    }
  }
  async function historyPreview(
    template: RotaPeriodMetadata,
    cursor?: string,
    all = false,
  ) {
    if (transport.current || marker.current) return;
    const generation = ++epoch.current;
    setLoading(true);
    setError("");
    setSelected(template);
    setPhase("history");
    if (!cursor) {
      cache.current.history = null;
      cache.current.historyRows = [];
      setHistory(null);
      setHistoryRows([]);
    }
    try {
      let next = cursor;
      do {
        const params = new URLSearchParams({
          mode: "history",
          tenantId,
          scheduleId: schedule.id,
          templateId: template.id,
          templateRevision: String(template.revision),
          limit: "100",
        });
        if (next) params.set("cursor", next);
        const result = await request(generation, undefined, params);
        const value = parseRotaPeriodHistorical(result.data);
        envelope(value);
        if (
          value.template.id !== template.id ||
          value.template.revision !== template.revision
        )
          throw Error("Historical template changed.");
        const previous = cache.current.history;
        if (
          next &&
          (!previous ||
            previous.historyDigest !== value.historyDigest ||
            JSON.stringify(previous.template) !==
              JSON.stringify(value.template))
        )
          throw Error("Historical availability changed while paging.");
        const rows = next
          ? [...cache.current.historyRows, ...value.entries]
          : value.entries;
        if (
          rows.some((entry, index) => entry.entry.index !== index) ||
          rows.length > value.page.total
        )
          throw Error("Historical page is incomplete or duplicated.");
        cache.current.history = value;
        cache.current.historyRows = rows;
        setHistory(value);
        setHistoryRows(rows);
        next = value.page.nextCursor || undefined;
        if (next && value.entries.length === 0)
          throw Error("Historical page did not advance.");
      } while (all && next && current() && generation === epoch.current);
    } catch (caught) {
      if (!(caught instanceof StaleRead)) {
        cache.current.history = null;
        cache.current.historyRows = [];
        setHistory(null);
        setHistoryRows([]);
      }
      readError(caught);
    } finally {
      if (current() && generation === epoch.current) setLoading(false);
    }
  }
  function resetPlan() {
    epoch.current++;
    cache.current.target = null;
    cache.current.buckets = {};
    setTarget(null);
  }
  async function targetPreview(
    template: RotaPeriodMetadata,
    pageKind: RotaPeriodPageKind = "entries",
    cursor?: string,
    all = false,
  ) {
    if (transport.current || marker.current) return;
    const generation = ++epoch.current;
    setLoading(true);
    setError("");
    setSelected(template);
    setPhase("target");
    const revision =
      cache.current.target?.schedule.revision ||
      history?.schedule.revision ||
      catalog?.schedule.revision ||
      schedule.revision;
    if (!cursor && pageKind === "entries") {
      cache.current.target = null;
      cache.current.buckets = {};
      setTarget(null);
    }
    try {
      let next = cursor;
      do {
        const result = await request(generation, {
          mode: "preview",
          tenantId,
          scheduleId: schedule.id,
          scheduleRevision: revision,
          templateId: template.id,
          templateRevision: template.revision,
          targetAnchor,
          occurrences,
          pageKind,
          limit: 100,
          ...(next ? { cursor: next } : {}),
        });
        const value = parseRotaPeriodTargetPreview(result.data);
        envelope(value);
        if (
          value.template.id !== template.id ||
          value.template.revision !== template.revision ||
          value.targetAnchor !== targetAnchor ||
          JSON.stringify(
            value.occurrences.map(({ index, start, end }) => [
              index,
              start || null,
              end || null,
            ]),
          ) !==
            JSON.stringify(
              occurrences.map(({ index, start, end }) => [
                index,
                start || null,
                end || null,
              ]),
            ) ||
          value.pageKind !== pageKind
        )
          throw Error("Target preview scope changed.");
        const previous = cache.current.target;
        if (
          previous &&
          (previous.planDigest !== value.planDigest ||
            previous.schedule.revision !== value.schedule.revision ||
            previous.entryCount !== value.entryCount ||
            previous.blockedEntryCount !== value.blockedEntryCount ||
            previous.affectedEntryCount !== value.affectedEntryCount ||
            previous.visibleCommitmentCount !== value.visibleCommitmentCount ||
            previous.hasHiddenConflicts !== value.hasHiddenConflicts)
        )
          throw Error(
            "The target plan changed. Review the complete batch again.",
          );
        const previousBucket = next ? cache.current.buckets[pageKind] : null;
        const entries =
          value.pageKind === "visibleCommitments"
            ? []
            : [...(previousBucket?.entries || []), ...value.entries];
        const commitments =
          value.pageKind === "visibleCommitments"
            ? [...(previousBucket?.commitments || []), ...value.commitments]
            : [];
        if (
          new Set(entries.map((entry) => entry.entry.index)).size !==
            entries.length ||
          new Set(commitments.map((commitment) => commitment.id)).size !==
            commitments.length ||
          entries.length + commitments.length > value.page.total
        )
          throw Error("Target page is duplicated or incomplete.");
        if (
          pageKind === "entries" &&
          entries.some((entry, index) => entry.entry.index !== index)
        )
          throw Error("Target entry page skipped part of the batch.");
        const bucket = {
          entries,
          commitments,
          nextCursor: value.page.nextCursor,
          total: value.page.total,
        };
        cache.current.target = value;
        cache.current.buckets = {
          ...cache.current.buckets,
          [pageKind]: bucket,
        };
        setTarget(value);
        next = value.page.nextCursor || undefined;
        if (
          next &&
          (value.pageKind === "visibleCommitments"
            ? value.commitments.length
            : value.entries.length) === 0
        )
          throw Error("Target page did not advance.");
      } while (all && next && current() && generation === epoch.current);
    } catch (caught) {
      if (!(caught instanceof StaleRead)) resetPlan();
      readError(caught);
    } finally {
      if (current() && (generation === epoch.current || !cache.current.target))
        setLoading(false);
    }
  }
  function validateSaved(
    value: RotaPeriodSaved,
    operation: RotaPeriodRecoveryQuery,
    mutation?: RotaPeriodMutation,
  ) {
    if (
      value.tenantId !== tenantId ||
      value.actorId !== actorId ||
      value.operationId !== operation.operationId ||
      value.action !== operation.action ||
      value.schedule_id !== schedule.id ||
      (operation.templateId !== null &&
        value.template_id !== operation.templateId)
    )
      throw Error("Saved operation scope changed.");
    if (mutation) {
      const change = mutation.change;
      const expectedCount =
        change.action === "save"
          ? change.sources.length
          : change.action === "add"
            ? change.expected_entry_count
            : selected?.entry_count;
      if (
        value.schedule_revision !== change.schedule_revision + 1 ||
        (expectedCount !== undefined && value.entry_count !== expectedCount) ||
        value.template_revision !==
          (change.action === "save"
            ? 1
            : change.action === "add"
              ? change.template_revision
              : change.template_revision + 1) ||
        (change.action === "add" && value.plan_digest !== change.plan_digest)
      )
        throw Error("The complete save acknowledgement could not be verified.");
    }
  }
  async function finish(
    saved: RotaPeriodSaved,
    operation: RotaPeriodRecoveryQuery,
  ) {
    validateSaved(saved, operation, pending.current || undefined);
    const completedAnchor =
      pending.current?.change.action === "add"
        ? pending.current.change.target_anchor
        : day;
    clearMarker();
    locked(false);
    setPhase("catalog");
    setSelected(null);
    clearViews();
    const reloaded = await reload();
    if (!reloaded || !current()) return;
    applied(completedAnchor, "");
  }
  async function write(change: RotaPeriodChange) {
    if (
      transport.current ||
      marker.current ||
      uncertain ||
      !editable ||
      !acquireWrite()
    )
      return;
    let operation: RotaPeriodMutation;
    try {
      operation = immutable(
        rotaPeriodMutationSchema.parse({
          tenantId,
          operationId: crypto.randomUUID(),
          change,
        }),
      );
      if (
        new TextEncoder().encode(JSON.stringify(operation)).length >
        ROTA_PERIOD_LIMITS.requestBytes
      )
        throw Error(
          "The complete batch request is too large; no change was sent.",
        );
      const identity: RotaPeriodRecoveryQuery = {
        mode: "reconcile",
        tenantId,
        operationId: operation.operationId,
        action: change.action,
        scheduleId: schedule.id,
        templateId: change.action === "save" ? null : change.template_id,
      };
      localStorage.setItem(markerKey, JSON.stringify(identity));
      marker.current = identity;
      setMarkerReady(true);
      pending.current = operation;
    } catch {
      locked(false);
      setError(
        "The operation could not be prepared or stored. No change was sent; browser storage is required for safe recovery.",
      );
      return;
    }
    transport.current = true;
    locked(true);
    setBusy(true);
    setError("");
    const generation = ++epoch.current;
    let completed = false;
    try {
      const result = await request(generation, operation);
      const saved = parseRotaPeriodSaved(result.saved);
      await finish(saved, marker.current!);
      completed = true;
    } catch (caught) {
      if (caught instanceof StaleRead) return;
      const certainRejection =
        caught instanceof HttpFailure &&
        caught.status >= 400 &&
        caught.status < 500 &&
        !/quota|capacity|budget|retained|limit|storage/i.test(caught.message);
      if (certainRejection) {
        clearMarker();
        locked(false);
        setError(caught.message);
        resetPlan();
      } else {
        setUncertain(true);
        setError(
          "Confirmation was lost or storage capacity prevented confirmation. Check this operation before another scheduling change; it will not be sent again automatically.",
        );
      }
    } finally {
      transport.current = false;
      if (current()) {
        setBusy(false);
        locked(!!marker.current);
        if (completed) setCatalogRefresh((sequence) => sequence + 1);
      }
    }
  }
  async function recover() {
    const identity = marker.current;
    if (!identity || transport.current || !acquireWrite()) return;
    transport.current = true;
    locked(true);
    setBusy(true);
    setError("");
    const generation = ++epoch.current;
    let recovered = false;
    try {
      const result = await request(generation, identity);
      const value = parseRotaPeriodReconciliation(result.reconciliation);
      if (
        value.tenantId !== tenantId ||
        value.actorId !== actorId ||
        value.operationId !== identity.operationId ||
        value.action !== identity.action ||
        value.scheduleId !== schedule.id ||
        value.templateId !== identity.templateId
      )
        throw Error("Recovery scope changed.");
      if (value.status === "recorded") {
        await finish(value.saved, identity);
        recovered = true;
        if (current() && identity.action !== "delete") {
          try {
            const lookupGeneration = ++epoch.current;
            for (const lookupKind of ["day", "week"] as const) {
              let cursor: string | null = null;
              let seen = 0;
              let revision: number | null = null;
              do {
                const params = new URLSearchParams({
                  tenantId,
                  scheduleId: schedule.id,
                  kind: lookupKind,
                  q: "",
                  limit: "100",
                  ...(cursor ? { cursor } : {}),
                });
                const result = await request(
                  lookupGeneration,
                  undefined,
                  params,
                );
                const catalogue = parseRotaPeriodCatalogue(result.data);
                envelope(catalogue);
                if (
                  catalogue.kind !== lookupKind ||
                  catalogue.q !== "" ||
                  (revision !== null &&
                    revision !== catalogue.schedule.revision)
                )
                  throw Error("Catalogue changed.");
                revision = catalogue.schedule.revision;
                seen += catalogue.templates.length;
                if (
                  seen > ROTA_PERIOD_LIMITS.metadataPerSchedule ||
                  (catalogue.page.nextCursor &&
                    (!catalogue.templates.length ||
                      catalogue.page.nextCursor === cursor))
                )
                  throw Error("Catalogue paging changed.");
                if (
                  catalogue.templates.some(
                    (template) => template.id === value.saved.template_id,
                  )
                ) {
                  setKind(lookupKind);
                  return;
                }
                cursor = catalogue.page.nextCursor;
              } while (cursor);
            }
          } catch (caught) {
            if (caught instanceof StaleRead || !current()) return;
            // Current catalogue availability does not alter an original recorded receipt.
          }
        }
      } else {
        clearMarker();
        locked(false);
        clearViews();
        setPhase("catalog");
        const reloaded = await reload();
        if (!reloaded || !current()) return;
        setError(
          "This change was not saved. Review the source or target again before starting a new operation.",
        );
        recovered = true;
      }
    } catch (caught) {
      if (!(caught instanceof StaleRead) && current())
        setError(
          caught instanceof HttpFailure
            ? `${caught.message} Absence has not been established; scheduling changes stay locked.`
            : "The operation result could not be verified. Scheduling changes stay locked.",
        );
    } finally {
      transport.current = false;
      if (current()) {
        setBusy(false);
        locked(!!marker.current);
        if (recovered) setCatalogRefresh((sequence) => sequence + 1);
      }
    }
  }
  function changeKind(next: RotaPeriodKind) {
    if (busy || uncertain || marker.current) return;
    epoch.current++;
    clearViews();
    setKind(next);
    setQuery("");
    setTargetAnchor(next === "week" ? viewDays(day, "Week")[0] : day);
    setPhase("catalog");
    setError("");
  }
  function back() {
    if (busy || uncertain || marker.current) return;
    epoch.current++;
    clearViews();
    setPhase("catalog");
    setError("");
  }
  const dismiss = () => {
    if (!busy && !uncertain && !marker.current && !transport.current) close();
  };
  const sourceComplete =
    !!source &&
    source.firstPage &&
    source.selectors.length === source.source.entryCount;
  const targetComplete = !!target && target.entryCount > 0;
  function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || !source.canSave || !source.firstPage || !sourceComplete)
      return;
    const title = String(new FormData(event.currentTarget).get("title") || "");
    void write({
      action: "save",
      schedule_id: schedule.id,
      schedule_revision: source.schedule.revision,
      kind: source.source.kind,
      title,
      source_anchor: source.source.anchor,
      source_zone: source.source.zone,
      source_filters: source.source.filters,
      source_review_digest: source.sourceReviewDigest,
      sources: source.selectors,
    });
  }
  const automaticSource = useEffectEvent(() => sourcePreview());
  const automaticTarget = useEffectEvent(() => {
    if (selected) void targetPreview(selected);
  });
  const automaticRecovery = useEffectEvent(() => recover());
  const checkedOperation = useRef<string | null>(null);
  useEffect(() => {
    if (phase === "source") void Promise.resolve().then(automaticSource);
  }, [
    phase,
    kind,
    schedule.revision,
    reviewAnchor,
    sourceFilters.jobId,
    sourceFilters.status,
    sourceFilters.workerSearch,
  ]);
  useEffect(() => {
    if (phase === "target") void Promise.resolve().then(automaticTarget);
  }, [
    phase,
    selected?.id,
    selected?.revision,
    schedule.revision,
    targetAnchor,
  ]);
  useEffect(() => {
    if (
      !uncertain ||
      !markerReady ||
      busy ||
      !marker.current ||
      checkedOperation.current === marker.current.operationId
    )
      return;
    checkedOperation.current = marker.current.operationId;
    void Promise.resolve().then(automaticRecovery);
  }, [uncertain, markerReady, busy]);
  const roster = agents.map((agent) => ({
    id: agent.id,
    name: `${agent.first_name} ${agent.last_name}`.trim(),
  }));
  const chooseTemplate = (template: RotaPeriodMetadata) => {
    if (busy || uncertain || loading) return;
    setSelected(template);
    setTargetAnchor(template.kind === "week" ? viewDays(day, "Week")[0] : day);
    setOccurrences([]);
    resetPlan();
    setPhase("target");
  };
  const loadTemplate = () => {
    if (!target || !targetComplete || !target.canAdd) return;
    void write({
      action: "add",
      schedule_id: schedule.id,
      schedule_revision: target.schedule.revision,
      template_id: target.template.id,
      template_revision: target.template.revision,
      target_anchor: target.targetAnchor,
      occurrences: target.occurrences,
      plan_digest: target.planDigest,
      expected_entry_count: target.entryCount,
      allow_overlap: true,
    });
  };
  const CardTitle = loadMode ? "button" : "div";
  const CardMenu = loadMode ? "div" : "details";
  const previewing = phase === "history";
  const naming = phase === "source" || phase === "rename";
  const title = previewing
    ? kind === "week"
      ? "Weekly Template"
      : "Template"
    : naming
      ? phase === "rename"
        ? selected?.title
        : `Save ${kind} as template`
      : loadMode
        ? kind === "week"
          ? "Week templates"
          : "Load day template"
        : "Shift Templates";
  return (
    <dialog
      ref={dialog}
      aria-label={previewing ? title : "Period Templates"}
      className={
        styles.drawer +
        (previewing
          ? " " + styles.wide
          : loadMode
            ? " " + styles.loadDrawer
            : "")
      }
      onCancel={(event) => {
        event.preventDefault();
        if (previewing) back();
        else dismiss();
      }}
    >
      <header className={previewing ? styles.previewHeading : styles.heading}>
        <h2>{title}</h2>
        <button
          aria-label="Close"
          disabled={busy || uncertain}
          onClick={previewing ? back : dismiss}
        >
          {previewing ? "Close" : "×"}
        </button>
      </header>
      {(loading || busy) && (
        <span className={styles.spinner} role="status" aria-label="Loading" />
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {uncertain
            ? "The change could not be confirmed. Try again later."
            : "The request could not be completed."}
        </p>
      )}
      {previewing && history && (
        <PeriodTemplatePreview
          rows={historyRows.map((value) => row(value.entry))}
          kind={history.template.kind}
          total={history.template.entry_count}
          users={history.template.user_count}
          elapsedMicros={history.template.elapsed_micros}
          anchor={history.template.source_anchor}
          roster={roster}
          loading={
            loading || historyRows.length !== history.template.entry_count
          }
        />
      )}
      {naming && (
        <form
          onSubmit={
            phase === "source"
              ? saveReview
              : (event) => {
                  event.preventDefault();
                  if (!selected) return;
                  const name = new FormData(event.currentTarget).get("title");
                  if (typeof name === "string")
                    void write({
                      action: "rename",
                      schedule_id: schedule.id,
                      schedule_revision:
                        catalog?.schedule.revision || schedule.revision,
                      template_id: selected.id,
                      template_revision: selected.revision,
                      title: name.trim(),
                    });
                }
          }
        >
          <input
            name="title"
            aria-label="Name"
            defaultValue={phase === "rename" ? selected?.title : ""}
            maxLength={100}
            required
            disabled={busy || uncertain}
          />
          <button
            className={styles.primary}
            disabled={
              !editable ||
              busy ||
              uncertain ||
              loading ||
              (phase === "source" && (!sourceComplete || !source?.canSave))
            }
          >
            Save template
          </button>
        </form>
      )}
      {!previewing && !naming && (
        <>
          {!loadMode && (
            <>
              <div
                role="tablist"
                aria-label="Template kind"
                className={styles.tabs}
              >
                <button
                  role="tab"
                  aria-selected="false"
                  disabled={busy || uncertain}
                  onClick={singleTab}
                >
                  Shifts
                </button>
                <button
                  role="tab"
                  aria-selected={kind === "day"}
                  disabled={busy || uncertain}
                  onClick={() => changeKind("day")}
                >
                  Days
                </button>
                <button
                  role="tab"
                  aria-selected={kind === "week"}
                  disabled={busy || uncertain}
                  onClick={() => changeKind("week")}
                >
                  Weeks
                </button>
              </div>
              <input
                aria-label="Search"
                placeholder="Search"
                value={query}
                maxLength={100}
                disabled={busy || uncertain}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                  resetPlan();
                  setPhase("catalog");
                }}
              />
            </>
          )}
          <div className={styles.cards}>
            {catalog?.templates.map((template) => (
              <article className={styles.card} key={template.id}>
                <CardTitle
                  className={styles.cardPick}
                  {...(loadMode
                    ? {
                        disabled: busy || uncertain || loading,
                        "aria-pressed": selected?.id === template.id,
                        onClick: () => chooseTemplate(template),
                      }
                    : {})}
                >
                  <strong>{template.title}</strong>
                  <small>
                    {template.entry_count} shifts • created on{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      timeZone: "UTC",
                    }).format(new Date(template.created_at))}
                  </small>
                </CardTitle>
                <CardMenu className={styles.templateMenu}>
                  {!loadMode && (
                    <>
                      <summary aria-label={`Actions for ${template.title}`}>
                        ⋯
                      </summary>
                      <button
                        disabled={busy || uncertain || loading}
                        onClick={() => {
                          setSelected(template);
                          void historyPreview(template, undefined, true);
                        }}
                      >
                        Preview
                      </button>
                    </>
                  )}
                  <button
                    aria-label="Edit template name"
                    disabled={
                      !editable ||
                      !catalog.canEdit ||
                      busy ||
                      uncertain ||
                      loading
                    }
                    onClick={() => {
                      setSelected(template);
                      setPhase("rename");
                    }}
                  >
                    ✎
                  </button>
                  <button
                    aria-label="Delete template"
                    disabled={
                      !editable ||
                      !catalog.canEdit ||
                      busy ||
                      uncertain ||
                      loading
                    }
                    onClick={() =>
                      void write({
                        action: "delete",
                        schedule_id: schedule.id,
                        schedule_revision: catalog.schedule.revision,
                        template_id: template.id,
                        template_revision: template.revision,
                      })
                    }
                  >
                    ⌫
                  </button>
                </CardMenu>
                {loadMode && selected?.id === template.id && (
                  <button
                    className={styles.primary}
                    disabled={
                      !editable ||
                      !targetComplete ||
                      !target?.canAdd ||
                      loading ||
                      busy ||
                      uncertain
                    }
                    onClick={loadTemplate}
                  >
                    Load template
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </dialog>
  );
}
