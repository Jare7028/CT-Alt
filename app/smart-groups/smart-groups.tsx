"use client";
import { useEffect, useRef, useState } from "react";
import type { Company, Member } from "../../lib/agent-types";
import type {
  SmartGroup,
  SmartGroupSegment,
  SmartGroupRule,
  SmartGroupCounts,
  SmartGroupIdentity,
  SmartGroupsData,
  SmartGroupSegmentsData,
  SmartGroupMembersData,
  SmartGroupPreviewData,
  SmartGroupMember,
  SmartGroupMutation,
  SmartGroupChange,
  SmartGroupSaved,
} from "../../lib/smart-group-types";
import "./smart-groups.css";
type Props = {
  company: Company;
  role: Member["role"];
  initialData: SmartGroupsData;
};
type Query = {
  status: "all" | "active" | "archived";
  search: string;
  segmentId?: string;
};
type Phase = "checking" | "ready" | "reading" | "saving" | "unknown";
type GroupDraft = {
  name: string;
  description: string;
  segment: SmartGroupSegment | null;
  rules: SmartGroupRule[];
};
const blankQuery: Query = { status: "active", search: "" };
const allQuery: Query = { status: "all", search: "" };
const blankDraft: GroupDraft = {
  name: "",
  description: "",
  segment: null,
  rules: [{ field: "title", values: [""] }],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const byteLimit = 40960;
const payloadBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const validCount = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const validCursor = (value: unknown) =>
  value === null || (typeof value === "string" && !!value);
function population(value: SmartGroupCounts | null) {
  return (
    !!value &&
    [value.records, value.unlinked, value.eligible, value.unavailable].every(
      validCount,
    ) &&
    value.records === value.unlinked + value.eligible + value.unavailable
  );
}
function validSegment(value: SmartGroupSegment) {
  return (
    !!value &&
    uuid.test(value.id) &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    ["active", "archived"].includes(value.status) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    validCount(value.activeGroupCount) &&
    typeof value.canArchive === "boolean" &&
    typeof value.canRestore === "boolean"
  );
}
function validGroup(value: SmartGroup) {
  return (
    !!value &&
    uuid.test(value.id) &&
    uuid.test(value.segmentId) &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    ["active", "archived"].includes(value.status) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    Array.isArray(value.rules) &&
    value.rules.length >= 1 &&
    value.rules.length <= 10 &&
    value.rules.every(
      (rule) =>
        typeof rule.field === "string" &&
        Array.isArray(rule.values) &&
        rule.values.length >= 1 &&
        rule.values.length <= 25 &&
        new Set(rule.values).size === rule.values.length &&
        rule.values.every(
          (item) =>
            typeof item === "string" &&
            item.trim().length > 0 &&
            item.length <= 500,
        ),
    ) &&
    Array.isArray(value.invalidFields) &&
    value.invalidFields.every((field) => typeof field === "string") &&
    typeof value.needsReview === "boolean" &&
    (value.needsReview
      ? value.counts === null &&
        value.invalidFields.length > 0 &&
        !value.canRestore
      : population(value.counts) && value.invalidFields.length === 0) &&
    [value.canEdit, value.canArchive, value.canRestore].every(
      (item) => typeof item === "boolean",
    )
  );
}
function validMembers(value: SmartGroupMember[]) {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    new Set(value.map((item) => item.id)).size === value.length &&
    value.every(
      (item) =>
        uuid.test(item.id) &&
        typeof item.name === "string" &&
        typeof item.title === "string" &&
        typeof item.team === "string" &&
        ["unlinked", "eligible", "unavailable"].includes(item.linkStatus),
    )
  );
}
function fieldsAgree(group: SmartGroup, fields: SmartGroupsData["fields"]) {
  const unavailable = new Set(
    group.rules
      .filter((rule) => !fields.some((field) => field.key === rule.field))
      .map((rule) => rule.field),
  );
  return group.needsReview
    ? unavailable.size > 0 &&
        unavailable.size === group.invalidFields.length &&
        group.invalidFields.every((field) =>
          unavailable.has(field as SmartGroupRule["field"]),
        )
    : unavailable.size === 0;
}
function append<T>(current: T[], next: T[], key: (row: T) => string) {
  const ids = new Set(current.map(key));
  return [...current, ...next.filter((row) => !ids.has(key(row)))];
}
function Population({ counts }: { counts: SmartGroupCounts }) {
  return (
    <div className="sg-population">
      <span>
        <strong>{counts.records}</strong> matching records
      </span>
      <span>
        <strong>{counts.eligible}</strong> communication eligible
      </span>
      <span>
        <strong>{counts.unlinked}</strong> unlinked
      </span>
      <span>
        <strong>{counts.unavailable}</strong> linked unavailable
      </span>
    </div>
  );
}
function MemberTable({ members }: { members: SmartGroupMember[] }) {
  return (
    <div className="sg-table-scroll">
      <table>
        <caption className="sg-sr-only">
          Matching active workforce records and communication eligibility
        </caption>
        <thead>
          <tr>
            <th>Record name</th>
            <th>Title</th>
            <th>Team</th>
            <th>Communication eligibility</th>
          </tr>
        </thead>
        <tbody>
          {members.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.title || "—"}</td>
              <td>{row.team || "—"}</td>
              <td>
                {row.linkStatus === "eligible"
                  ? "Eligible account"
                  : row.linkStatus === "unlinked"
                    ? "Unlinked record"
                    : "Linked account unavailable"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function SmartGroups(props: Props) {
  if (props.role !== "owner" && props.role !== "admin")
    return (
      <div className="smart-groups-page">
        <p role="alert">
          Current owner or admin access is required for Smart Groups.
        </p>
      </div>
    );
  return (
    <GroupsContent
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}`}
      {...props}
    />
  );
}
function GroupsContent({ company, initialData }: Props) {
  const [data, setData] = useState<SmartGroupsData | null>(initialData);
  const [segments, setSegments] = useState<SmartGroupSegmentsData | null>(null);
  const [tab, setTab] = useState<"groups" | "segments">("groups");
  const [query, setQuery] = useState<Query>(blankQuery),
    [search, setSearch] = useState("");
  const [phase, setPhase] = useState<Phase>("checking"),
    [writePending, setWritePending] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<SmartGroupMutation | null>(null);
  const [members, setMembers] = useState<SmartGroupMembersData | null>(null),
    [memberSearch, setMemberSearch] = useState(""),
    [memberQuery, setMemberQuery] = useState("");
  const [draft, setDraft] = useState<GroupDraft>(blankDraft),
    [editingGroup, setEditingGroup] = useState<SmartGroup | null>(null);
  const [segmentDraft, setSegmentDraft] = useState({
      name: "",
      description: "",
    }),
    [editingSegment, setEditingSegment] = useState<SmartGroupSegment | null>(
      null,
    );
  const [picker, setPicker] = useState<SmartGroupSegmentsData | null>(null),
    [pickerSearch, setPickerSearch] = useState(""),
    [pickerQuery, setPickerQuery] = useState(""),
    [pickerBusy, setPickerBusy] = useState(false);
  const [preview, setPreview] = useState<SmartGroupPreviewData | null>(null),
    [previewSearch, setPreviewSearch] = useState(""),
    [previewQuery, setPreviewQuery] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false);
  const [fields, setFields] = useState(initialData.fields);
  const [confirmation, setConfirmation] = useState<
    | { action: "archive_group" | "restore_group"; group: SmartGroup }
    | {
        action: "archive_segment" | "restore_segment";
        segment: SmartGroupSegment;
      }
    | null
  >(null);
  const groupEditor = useRef<HTMLDialogElement>(null),
    segmentEditor = useRef<HTMLDialogElement>(null),
    confirmationDialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true),
    epoch = useRef(0),
    writeBusy = useRef<string | null>(null),
    recoveryBusy = useRef(false);
  const requests = useRef<
    Record<"main" | "members" | "picker" | "preview", AbortController | null>
  >({ main: null, members: null, picker: null, preview: null });
  const recoveryAction = useRef<string | null>(null);
  const storageKey = `ct-alt:smart-groups:${initialData.actorId}:${company.id}`;
  useEffect(() => {
    mounted.current = true;
    let recovery = false;
    try {
      const stored = sessionStorage.getItem(storageKey);
      recovery = stored !== null;
      if (stored) {
        const parsed = JSON.parse(stored);
        recoveryAction.current =
          typeof parsed?.action === "string" ? parsed.action : null;
      }
    } catch {}
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      if (recovery) {
        setData(null);
        setFields([]);
      }
      setPhase(recovery ? "unknown" : "ready");
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      epoch.current += 1;
      Object.values(requests.current).forEach((controller) =>
        controller?.abort(),
      );
    };
  }, [storageKey]);
  const locked = phase !== "ready" || !data || writePending;
  const filterLocked =
    phase === "checking" ||
    phase === "unknown" ||
    phase === "saving" ||
    writePending ||
    !data;
  const ruleError =
    draft.rules.length < 1 || draft.rules.length > 10
      ? "Use 1–10 required rules."
      : draft.rules.some(
            (rule) => !fields.some((field) => field.key === rule.field),
          )
        ? "Repair unavailable fields before previewing or saving."
        : draft.rules.some(
              (rule) =>
                rule.values.length < 1 ||
                rule.values.length > 25 ||
                rule.values.some(
                  (value) => !value.trim() || value.length > 500,
                ) ||
                new Set(rule.values).size !== rule.values.length,
            )
          ? "Each rule needs 1–25 distinct nonblank literal values, up to 500 characters each."
          : "";
  const groupChange: SmartGroupChange = editingGroup
    ? {
        action: "edit_group",
        groupId: editingGroup.id,
        revision: editingGroup.revision,
        segmentId: draft.segment?.id || "",
        name: draft.name.trim(),
        description: draft.description,
        rules: draft.rules,
      }
    : {
        action: "create_group",
        segmentId: draft.segment?.id || "",
        name: draft.name.trim(),
        description: draft.description,
        rules: draft.rules,
      };
  const groupSize = payloadBytes({
    tenantId: company.id,
    operationId: "00000000-0000-4000-8000-000000000000",
    change: groupChange,
  });
  const canSaveGroup =
    !locked &&
    !!draft.name.trim() &&
    draft.name.length <= 100 &&
    draft.description.length <= 500 &&
    draft.segment?.status === "active" &&
    !ruleError &&
    groupSize <= byteLimit;
  function invalidate() {
    epoch.current += 1;
    Object.values(requests.current).forEach((controller) =>
      controller?.abort(),
    );
    requests.current = {
      main: null,
      members: null,
      picker: null,
      preview: null,
    };
    setPickerBusy(false);
    setPreviewBusy(false);
  }
  function cancelPreview() {
    requests.current.preview?.abort();
    requests.current.preview = null;
    setPreview(null);
    setPreviewBusy(false);
    setPreviewSearch("");
    setPreviewQuery("");
  }
  function closeEditors() {
    groupEditor.current?.close();
    segmentEditor.current?.close();
    confirmationDialog.current?.close();
    requests.current.picker?.abort();
    requests.current.picker = null;
    cancelPreview();
    setPicker(null);
    setPickerSearch("");
    setPickerQuery("");
    setPickerBusy(false);
    setDraft(blankDraft);
    setEditingGroup(null);
    setEditingSegment(null);
    setSegmentDraft({ name: "", description: "" });
    setConfirmation(null);
  }
  function clearAccess(message: string) {
    invalidate();
    closeEditors();
    setData(null);
    setSegments(null);
    setMembers(null);
    setFields([]);
    setMemberSearch("");
    setMemberQuery("");
    setSearch("");
    setQuery(allQuery);
    setPhase("unknown");
    setError(message);
    setNotice("");
  }
  function startRead(kind: keyof typeof requests.current) {
    requests.current[kind]?.abort();
    const controller = new AbortController();
    requests.current[kind] = controller;
    const generation = epoch.current;
    return {
      controller,
      current: () =>
        mounted.current &&
        !controller.signal.aborted &&
        epoch.current === generation &&
        requests.current[kind] === controller,
    };
  }
  function identity(
    next: SmartGroupIdentity,
    role = data?.role || initialData.role,
  ) {
    return (
      next &&
      next.tenantId === company.id &&
      next.actorId === initialData.actorId &&
      ["owner", "admin"].includes(next.role) &&
      next.role === role &&
      typeof next.fieldFingerprint === "string" &&
      !!next.fieldFingerprint &&
      typeof next.datasetVersion === "string" &&
      !!next.datasetVersion
    );
  }
  function validFields(next: SmartGroupsData["fields"]) {
    return (
      Array.isArray(next) &&
      next.length >= 2 &&
      next.every(
        (field) =>
          typeof field.key === "string" &&
          (field.key === "title" ||
            field.key === "team" ||
            /^custom:.+/.test(field.key)) &&
          typeof field.label === "string",
      ) &&
      new Set(next.map((field) => field.key)).size === next.length &&
      next.some((field) => field.key === "title") &&
      next.some((field) => field.key === "team")
    );
  }
  async function fetchJson<T>(
    url: string,
    controller: AbortController,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Your Smart Groups access could not be verified. Refresh to check current owner or admin access."
          : response.status === 409
            ? "The group or matching population changed. Refresh before continuing."
            : "Smart Groups could not be loaded. Changes remain locked until a successful fresh read.",
      );
    return response.json() as Promise<T>;
  }
  async function readCatalog(
    view: "groups" | "segments",
    nextQuery: Query = allQuery,
    cursor: string | null = null,
    acknowledgedId?: string,
    recovery = false,
  ) {
    if (
      !mounted.current ||
      (writeBusy.current && writeBusy.current !== acknowledgedId)
    )
      return false;
    invalidate();
    setMembers(null);
    closeEditors();
    setPhase("reading");
    setError("");
    setNotice("");
    setTab(view);
    setQuery(nextQuery);
    setSearch(nextQuery.search);
    if (!cursor) {
      if (view === "groups")
        setData((current) =>
          current ? { ...current, groups: [], nextCursor: null } : null,
        );
      else setSegments(null);
    }
    const read = startRead("main");
    const params = new URLSearchParams({
      tenantId: company.id,
      status: nextQuery.status,
      search: nextQuery.search,
      limit: "50",
    });
    if (nextQuery.segmentId && view === "groups")
      params.set("segmentId", nextQuery.segmentId);
    if (cursor) params.set("cursor", cursor);
    try {
      let nextGroups: SmartGroupsData | null = null,
        nextSegments: SmartGroupSegmentsData | null = null;
      if (view === "groups" || recovery) {
        nextGroups = await fetchJson<SmartGroupsData>(
          `/api/smart-groups?${recovery ? new URLSearchParams({ tenantId: company.id, status: "all", limit: "50" }) : params}`,
          read.controller,
        );
        if (!read.current()) return false;
        if (
          !identity(nextGroups, nextGroups.role) ||
          !nextGroups.company ||
          nextGroups.company.id !== company.id ||
          !validFields(nextGroups.fields) ||
          !Array.isArray(nextGroups.groups) ||
          nextGroups.groups.length > 100 ||
          nextGroups.groups.some(
            (row) => !validGroup(row) || !fieldsAgree(row, nextGroups!.fields),
          ) ||
          new Set(nextGroups.groups.map((row) => row.id)).size !==
            nextGroups.groups.length ||
          !nextGroups.counts ||
          ![
            nextGroups.counts.total,
            nextGroups.counts.active,
            nextGroups.counts.archived,
            nextGroups.counts.needsReview,
          ].every(validCount) ||
          nextGroups.counts.total !==
            nextGroups.counts.active + nextGroups.counts.archived ||
          nextGroups.counts.needsReview > nextGroups.counts.total ||
          !validCursor(nextGroups.nextCursor)
        )
          throw new Error(
            "The group catalog response could not be verified. Refresh to recover.",
          );
        if (
          cursor &&
          (nextGroups.fieldFingerprint !== data?.fieldFingerprint ||
            nextGroups.datasetVersion !== data?.datasetVersion)
        )
          throw new Error(
            "The matching population changed between pages. Refresh to recover.",
          );
      }
      if (view === "segments" || recovery) {
        nextSegments = await fetchJson<SmartGroupSegmentsData>(
          `/api/smart-groups/segments?${recovery ? new URLSearchParams({ tenantId: company.id, status: "all", limit: "50" }) : params}`,
          read.controller,
        );
        if (!read.current()) return false;
        if (
          !identity(
            nextSegments,
            nextGroups?.role || data?.role || initialData.role,
          ) ||
          !Array.isArray(nextSegments.segments) ||
          nextSegments.segments.length > 100 ||
          nextSegments.segments.some((row) => !validSegment(row)) ||
          !nextSegments.counts ||
          ![
            nextSegments.counts.total,
            nextSegments.counts.active,
            nextSegments.counts.archived,
          ].every(validCount) ||
          nextSegments.counts.total !==
            nextSegments.counts.active + nextSegments.counts.archived ||
          !validCursor(nextSegments.nextCursor)
        )
          throw new Error(
            "The segment response could not be verified. Refresh to recover.",
          );
        if (
          cursor &&
          (nextSegments.fieldFingerprint !== segments?.fieldFingerprint ||
            nextSegments.datasetVersion !== segments?.datasetVersion)
        )
          throw new Error(
            "Segments changed between pages. Refresh to recover.",
          );
      }
      if (nextGroups) {
        if (
          nextSegments &&
          (nextGroups.fieldFingerprint !== nextSegments.fieldFingerprint ||
            nextGroups.datasetVersion !== nextSegments.datasetVersion)
        )
          throw new Error(
            "Smart Groups changed during recovery. Refresh to review a current snapshot.",
          );
        const incoming = nextGroups;
        setData((current) => ({
          ...incoming,
          groups:
            cursor && !recovery && current
              ? append(current.groups, incoming.groups, (row) => row.id)
              : incoming.groups,
        }));
        setFields(incoming.fields);
      }
      if (nextSegments) {
        const incoming = nextSegments;
        setSegments((current) => ({
          ...incoming,
          segments:
            cursor && current
              ? append(current.segments, incoming.segments, (row) => row.id)
              : incoming.segments,
        }));
      }
      setPhase("ready");
      setOperation(null);
      recoveryAction.current = null;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      return nextGroups || nextSegments;
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Smart Groups could not be loaded. Refresh to recover.",
        );
      return false;
    }
  }
  async function readMembers(
    groupId: string,
    searchValue = "",
    cursor: string | null = null,
  ) {
    if (writeBusy.current || recoveryBusy.current || !mounted.current || locked)
      return false;
    requests.current.picker?.abort();
    requests.current.picker = null;
    cancelPreview();
    closeEditors();
    const read = startRead("members");
    setPhase("reading");
    setError("");
    if (!cursor) setMembers(null);
    setMemberQuery(searchValue);
    setMemberSearch(searchValue);
    const params = new URLSearchParams({
      tenantId: company.id,
      search: searchValue,
      limit: "50",
    });
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await fetchJson<SmartGroupMembersData>(
        `/api/smart-groups/${groupId}/members?${params}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (
        !identity(next) ||
        !validGroup(next.group) ||
        next.group.id !== groupId ||
        !validSegment(next.segment) ||
        next.segment.id !== next.group.segmentId ||
        !validFields(next.fields) ||
        !fieldsAgree(next.group, next.fields) ||
        !validMembers(next.members) ||
        !validCursor(next.nextCursor) ||
        (next.group.needsReview
          ? next.counts !== null ||
            next.matchedCount !== null ||
            next.members.length > 0 ||
            next.nextCursor !== null
          : !population(next.counts) ||
            !validCount(next.matchedCount) ||
            next.matchedCount! > next.counts!.records ||
            next.members.length > next.matchedCount!)
      )
        throw new Error(
          "The group members response could not be verified. Refresh to recover.",
        );
      if (
        cursor &&
        (next.fieldFingerprint !== members?.fieldFingerprint ||
          next.datasetVersion !== members?.datasetVersion ||
          next.group.revision !== members?.group.revision ||
          next.group.status !== members?.group.status)
      )
        throw new Error(
          "The matching population changed between pages. Refresh to recover.",
        );
      setMembers((current) => ({
        ...next,
        members:
          cursor && current
            ? append(current.members, next.members, (row) => row.id)
            : next.members,
      }));
      setFields(next.fields);
      setPhase("ready");
      return next;
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Group members could not be loaded. Refresh to recover.",
        );
      return false;
    }
  }
  async function readPicker(searchValue = "", cursor: string | null = null) {
    if (writeBusy.current || recoveryBusy.current || !mounted.current || locked)
      return;
    const read = startRead("picker");
    setPickerBusy(true);
    setPickerQuery(searchValue);
    if (!cursor) setPicker(null);
    const params = new URLSearchParams({
      tenantId: company.id,
      status: "active",
      search: searchValue,
      limit: "50",
    });
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await fetchJson<SmartGroupSegmentsData>(
        `/api/smart-groups/segments?${params}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !identity(next) ||
        !Array.isArray(next.segments) ||
        next.segments.length > 100 ||
        next.segments.some(
          (row) => !validSegment(row) || row.status !== "active",
        ) ||
        !next.counts ||
        ![next.counts.total, next.counts.active, next.counts.archived].every(
          validCount,
        ) ||
        next.counts.total !== next.counts.active + next.counts.archived ||
        !validCursor(next.nextCursor)
      )
        throw new Error(
          "The segment picker could not be verified. Refresh to recover.",
        );
      if (
        cursor &&
        (next.datasetVersion !== picker?.datasetVersion ||
          next.fieldFingerprint !== picker?.fieldFingerprint)
      )
        throw new Error("Segments changed between pages. Refresh to recover.");
      setPicker((current) => ({
        ...next,
        segments:
          cursor && current
            ? append(current.segments, next.segments, (row) => row.id)
            : next.segments,
      }));
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Segments could not be loaded. Refresh to recover.",
        );
    } finally {
      if (read.current()) setPickerBusy(false);
    }
  }
  async function readPreview(searchValue = "", cursor: string | null = null) {
    if (
      writeBusy.current ||
      recoveryBusy.current ||
      locked ||
      ruleError ||
      !mounted.current
    )
      return;
    const rules = structuredClone(draft.rules);
    const body = {
      tenantId: company.id,
      rules,
      search: searchValue,
      limit: 50,
      ...(cursor ? { cursor } : {}),
    };
    if (payloadBytes(body) > byteLimit) {
      setError(
        "Preview exceeds the 40 KiB request limit. Use fewer or shorter values.",
      );
      return;
    }
    const read = startRead("preview");
    setPreviewBusy(true);
    setPreviewQuery(searchValue);
    if (!cursor) setPreview(null);
    try {
      const next = await fetchJson<SmartGroupPreviewData>(
        "/api/smart-groups/preview",
        read.controller,
        body,
      );
      if (!read.current()) return;
      if (
        !identity(next) ||
        JSON.stringify(next.rules) !== JSON.stringify(rules) ||
        !validFields(next.fields) ||
        next.rules.some(
          (rule) => !next.fields.some((field) => field.key === rule.field),
        ) ||
        !population(next.counts) ||
        !validCount(next.matchedCount) ||
        next.matchedCount > next.counts.records ||
        !validMembers(next.members) ||
        next.members.length > next.matchedCount ||
        !validCursor(next.nextCursor)
      )
        throw new Error(
          "The rule preview response could not be verified. Refresh to recover.",
        );
      if (
        cursor &&
        (next.datasetVersion !== preview?.datasetVersion ||
          next.fieldFingerprint !== preview?.fieldFingerprint)
      )
        throw new Error(
          "The preview population changed between pages. Refresh to recover.",
        );
      setPreview((current) => ({
        ...next,
        members:
          cursor && current
            ? append(current.members, next.members, (row) => row.id)
            : next.members,
      }));
      setFields(next.fields);
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Matching records could not be previewed. Refresh to recover.",
        );
    } finally {
      if (read.current()) setPreviewBusy(false);
    }
  }
  async function perform(value: SmartGroupMutation) {
    if (!mounted.current || writeBusy.current || recoveryBusy.current) return;
    writeBusy.current = value.operationId;
    setWritePending(true);
    invalidate();
    recoveryAction.current = value.change.action;
    setOperation(value);
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          operationId: value.operationId,
          action: value.change.action,
        }),
      );
    } catch {}
    setPhase("saving");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/smart-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        keepalive: true,
      });
      if (!mounted.current) return;
      if (!response.ok) {
        let message =
          "The Smart Group change was not acknowledged. Refresh before another change.";
        try {
          const result = await response.json();
          if (typeof result?.error === "string") message = result.error;
        } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      if (!mounted.current) return;
      const saved = result?.saved as SmartGroupSaved | undefined;
      const expected =
        "revision" in value.change ? value.change.revision + 1 : 1;
      if (
        !saved ||
        saved.operationId !== value.operationId ||
        saved.action !== value.change.action ||
        !uuid.test(saved.segmentId) ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision !== expected ||
        ("segmentId" in value.change &&
          saved.segmentId !== value.change.segmentId) ||
        ("groupId" in value.change && saved.groupId !== value.change.groupId) ||
        (value.change.action === "create_group" &&
          (!saved.groupId || !uuid.test(saved.groupId)))
      )
        throw new Error(
          "The Smart Group change could not be confirmed. Refresh to recover.",
        );
      const view = value.change.action.endsWith("_segment")
        ? "segments"
        : "groups";
      const next = await readCatalog(
        view,
        allQuery,
        null,
        value.operationId,
        true,
      );
      if (next && mounted.current) setNotice("Smart Groups updated.");
    } catch (cause) {
      if (mounted.current)
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "The response was interrupted. The change may have saved. Refresh to recover.",
        );
    } finally {
      writeBusy.current = null;
      if (mounted.current) setWritePending(false);
    }
  }
  function change(value: SmartGroupChange) {
    if (locked || writeBusy.current || recoveryBusy.current) return;
    const mutation = {
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change: value,
    };
    if (payloadBytes(mutation) > byteLimit) {
      setError(
        "The change exceeds the 40 KiB request limit. Use fewer or shorter values.",
      );
      return;
    }
    void perform(mutation);
  }
  async function refresh() {
    if (writeBusy.current || recoveryBusy.current || !mounted.current) return;
    recoveryBusy.current = true;
    try {
      const view =
        phase === "unknown" && recoveryAction.current?.endsWith("_segment")
          ? "segments"
          : phase === "unknown"
            ? "groups"
            : tab;
      await readCatalog(
        view,
        phase === "unknown" ? allQuery : query,
        null,
        undefined,
        phase === "unknown",
      );
    } finally {
      recoveryBusy.current = false;
    }
  }
  async function openGroup(
    group: SmartGroup | null = null,
    segment: SmartGroupSegment | null = null,
  ) {
    if (locked || writeBusy.current || recoveryBusy.current) return;
    let parent = segment;
    if (group) {
      const next = await readMembers(group.id);
      if (!next || !mounted.current) return;
      group = next.group;
      parent = next.segment;
      if (!group.canEdit) {
        setError(
          "This group cannot currently be edited. Refresh to review its current state.",
        );
        return;
      }
    }
    cancelPreview();
    setEditingGroup(group);
    setDraft(
      group
        ? {
            name: group.name,
            description: group.description,
            segment: parent,
            rules: structuredClone(group.rules),
          }
        : {
            ...blankDraft,
            segment: parent,
            rules: [{ field: "title", values: [""] }],
          },
    );
    setPicker(null);
    setPickerSearch("");
    setPickerQuery("");
    groupEditor.current?.showModal();
    void readPicker();
  }
  function openSegment(segment: SmartGroupSegment | null = null) {
    if (locked) return;
    closeEditors();
    setEditingSegment(segment);
    setSegmentDraft(
      segment
        ? { name: segment.name, description: segment.description }
        : { name: "", description: "" },
    );
    segmentEditor.current?.showModal();
  }
  function updateRules(next: SmartGroupRule[]) {
    cancelPreview();
    setDraft((current) => ({ ...current, rules: next }));
  }
  function confirm(value: NonNullable<typeof confirmation>) {
    if (locked) return;
    setConfirmation(value);
    confirmationDialog.current?.showModal();
  }
  const countData = tab === "groups" ? data : segments;
  return (
    <div
      className="smart-groups-page"
      aria-busy={phase === "reading" || phase === "saving"}
    >
      <header className="sg-heading">
        <div>
          <h1>Smart Groups</h1>
          <p>Organize active workforce records with saved profile rules</p>
        </div>
        <div>
          <button
            disabled={writePending || phase === "checking"}
            onClick={() => void refresh()}
          >
            Refresh Smart Groups
          </button>
          {data && (
            <>
              <button disabled={locked} onClick={() => openSegment()}>
                Add segment
              </button>
              <button
                className="sg-primary"
                disabled={locked}
                onClick={() => void openGroup()}
              >
                Add group
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <p className="sg-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="sg-notice" role="status">
          {notice}
        </p>
      )}
      {phase === "unknown" && (
        <section className="sg-recovery" aria-label="Smart Groups recovery">
          <h2>Review Smart Groups before another change</h2>
          <p>
            The last change may have saved. A successful current owner/admin
            read of all group and segment statuses is required before changes
            resume. Profile values, rules and names are not stored for recovery.
          </p>
          <button disabled={writePending} onClick={() => void refresh()}>
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
        </section>
      )}
      {data && (
        <section className="sg-feature">
          <nav className="sg-tabs" aria-label="Smart Groups views">
            <button
              disabled={filterLocked}
              aria-current={tab === "groups" ? "page" : undefined}
              onClick={() => void readCatalog("groups", blankQuery)}
            >
              Groups
            </button>
            <button
              disabled={filterLocked}
              aria-current={tab === "segments" ? "page" : undefined}
              onClick={() => void readCatalog("segments", allQuery)}
            >
              Segments
            </button>
          </nav>
          <div className="sg-content">
            <p className="sg-hint">
              Membership follows current profile values when refreshed. Matching
              records include unlinked profiles; communication eligibility
              requires a current active confirmed company account. Group
              membership does not grant account access or assign content.
            </p>
            {countData && (
              <div className="sg-status-counts">
                <span>
                  <strong>{countData.counts.total}</strong> {tab}
                </span>
                <span>
                  <strong>{countData.counts.active}</strong> active
                </span>
                <span>
                  <strong>{countData.counts.archived}</strong> archived
                </span>
                {tab === "groups" && (
                  <span>
                    <strong>{data.counts.needsReview}</strong> need review
                  </span>
                )}
              </div>
            )}
            <form
              className="sg-filters"
              onSubmit={(event) => {
                event.preventDefault();
                if (!filterLocked)
                  void readCatalog(tab, { ...query, search: search.trim() });
              }}
            >
              <label>
                Search {tab}
                <input
                  type="search"
                  value={search}
                  maxLength={100}
                  disabled={filterLocked}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Catalog status
                <select
                  aria-label="Catalog status"
                  value={query.status}
                  disabled={filterLocked}
                  onChange={(event) =>
                    void readCatalog(tab, {
                      ...query,
                      status: event.target.value as Query["status"],
                    })
                  }
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <button disabled={filterLocked}>Search catalog</button>
              <button
                type="button"
                disabled={filterLocked}
                onClick={() => void readCatalog(tab, allQuery)}
              >
                Clear catalog filters
              </button>
            </form>
            {query.segmentId && (
              <p className="sg-hint">
                Showing groups in the selected segment. Clear catalog filters to
                show every segment.
              </p>
            )}
            {phase === "reading" && <p role="status">Loading Smart Groups…</p>}
            {tab === "groups" ? (
              <>
                <div className="sg-table-scroll">
                  <table className="sg-group-table">
                    <caption className="sg-sr-only">
                      Saved dynamic Smart Groups
                    </caption>
                    <thead>
                      <tr>
                        <th>Group name</th>
                        <th>Required rules</th>
                        <th>Matching records</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.groups.map((group) => (
                        <tr key={group.id}>
                          <td>
                            <strong>{group.name}</strong>
                            <small>{group.description}</small>
                          </td>
                          <td>
                            {group.rules.map((rule, index) => (
                              <div key={index}>
                                {fields.find(
                                  (field) => field.key === rule.field,
                                )?.label || `Unavailable: ${rule.field}`}{" "}
                                is any of{" "}
                                {rule.values
                                  .map((value) => JSON.stringify(value))
                                  .join(", ")}
                                {index < group.rules.length - 1 ? " AND" : ""}
                              </div>
                            ))}
                          </td>
                          <td>
                            {group.needsReview ? (
                              <span className="sg-review">
                                Needs review · counts unavailable
                              </span>
                            ) : (
                              <>
                                <strong>{group.counts!.records}</strong>
                                <small>
                                  {group.counts!.eligible} eligible ·{" "}
                                  {group.counts!.unlinked} unlinked ·{" "}
                                  {group.counts!.unavailable} unavailable
                                </small>
                              </>
                            )}
                          </td>
                          <td>
                            <span className={`sg-status ${group.status}`}>
                              {group.status}
                            </span>
                          </td>
                          <td>
                            <div className="sg-row-actions">
                              <button
                                disabled={locked}
                                aria-label={`View members ${group.name}`}
                                onClick={() => void readMembers(group.id)}
                              >
                                View members
                              </button>
                              {group.canEdit && (
                                <button
                                  disabled={locked}
                                  aria-label={`${group.needsReview ? "Repair rules" : "Edit group"} ${group.name}`}
                                  onClick={() => void openGroup(group)}
                                >
                                  {group.needsReview
                                    ? "Repair rules"
                                    : "Edit group"}
                                </button>
                              )}
                              {group.status === "active" && (
                                <button
                                  disabled={locked || !group.canArchive}
                                  aria-label={`Archive group ${group.name}`}
                                  onClick={() =>
                                    confirm({ action: "archive_group", group })
                                  }
                                >
                                  Archive
                                </button>
                              )}
                              {group.status === "archived" && (
                                <button
                                  disabled={locked || !group.canRestore}
                                  aria-label={`Restore group ${group.name}`}
                                  onClick={() =>
                                    confirm({ action: "restore_group", group })
                                  }
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {phase === "ready" && !data.groups.length && (
                  <p className="sg-empty">
                    No saved groups match these filters.
                  </p>
                )}
                <p className="sg-hint">
                  {data.groups.length} groups shown. Totals are exact within the
                  current search and segment scope.
                </p>
                {data.nextCursor && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      void readCatalog("groups", query, data.nextCursor)
                    }
                  >
                    Load more groups
                  </button>
                )}
              </>
            ) : (
              <>
                {segments?.segments.map((segment) => (
                  <article className="sg-segment" key={segment.id}>
                    <div>
                      <h2>{segment.name}</h2>
                      <p>{segment.description}</p>
                      <span className={`sg-status ${segment.status}`}>
                        {segment.status}
                      </span>
                      <p>{segment.activeGroupCount} active groups</p>
                    </div>
                    <div className="sg-row-actions">
                      <button
                        disabled={locked}
                        aria-label={`View groups in ${segment.name}`}
                        onClick={() =>
                          void readCatalog("groups", {
                            status: "all",
                            search: "",
                            segmentId: segment.id,
                          })
                        }
                      >
                        View groups
                      </button>
                      <button
                        disabled={locked}
                        aria-label={`Edit segment ${segment.name}`}
                        onClick={() => openSegment(segment)}
                      >
                        Edit segment
                      </button>
                      {segment.status === "active" ? (
                        <>
                          <button
                            disabled={locked}
                            aria-label={`Add group in ${segment.name}`}
                            onClick={() => void openGroup(null, segment)}
                          >
                            Add group
                          </button>
                          <button
                            disabled={locked || !segment.canArchive}
                            aria-label={`Archive segment ${segment.name}`}
                            onClick={() =>
                              confirm({ action: "archive_segment", segment })
                            }
                          >
                            Archive segment
                          </button>
                          {segment.activeGroupCount > 0 && (
                            <small>Archive its active groups first.</small>
                          )}
                        </>
                      ) : (
                        <button
                          disabled={locked || !segment.canRestore}
                          aria-label={`Restore segment ${segment.name}`}
                          onClick={() =>
                            confirm({ action: "restore_segment", segment })
                          }
                        >
                          Restore segment
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {phase === "ready" && segments && !segments.segments.length && (
                  <p className="sg-empty">No segments match these filters.</p>
                )}
                {segments?.nextCursor && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      void readCatalog("segments", query, segments.nextCursor)
                    }
                  >
                    Load more segments
                  </button>
                )}
              </>
            )}
            {members && (
              <section className="sg-members" aria-label="Group members">
                <div className="sg-panel-heading">
                  <h2>{members.group.name}</h2>
                  <button
                    disabled={writePending}
                    aria-label="Close group members"
                    onClick={() => {
                      if (writeBusy.current) return;
                      requests.current.members?.abort();
                      requests.current.members = null;
                      setMembers(null);
                      setMemberSearch("");
                      if (data && phase === "reading") setPhase("ready");
                    }}
                  >
                    ×
                  </button>
                </div>
                <p>Segment: {members.segment.name}</p>
                {members.group.needsReview ? (
                  <div className="sg-review">
                    <h3>Rules need review</h3>
                    <p>
                      Unavailable fields:{" "}
                      {members.group.invalidFields.join(", ")}. Matching counts
                      are unavailable until the rules are repaired.
                    </p>
                    <button
                      disabled={locked || !members.group.canEdit}
                      onClick={() => void openGroup(members.group)}
                    >
                      Repair rules
                    </button>
                  </div>
                ) : (
                  <>
                    <Population counts={members.counts!} />
                    <form
                      className="sg-filters"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!locked)
                          void readMembers(
                            members.group.id,
                            memberSearch.trim(),
                          );
                      }}
                    >
                      <label>
                        Search group members
                        <input
                          type="search"
                          maxLength={100}
                          value={memberSearch}
                          disabled={locked}
                          onChange={(event) =>
                            setMemberSearch(event.target.value)
                          }
                        />
                      </label>
                      <button disabled={locked}>Search members</button>
                    </form>
                    <MemberTable members={members.members} />
                    <p className="sg-hint">
                      {members.members.length} shown · {members.matchedCount}{" "}
                      matching the name search. Population totals include every
                      matching active record.
                    </p>
                    {!members.members.length && (
                      <p>No records match this name search.</p>
                    )}
                    {members.nextCursor && (
                      <button
                        disabled={locked}
                        onClick={() =>
                          void readMembers(
                            members.group.id,
                            memberQuery,
                            members.nextCursor,
                          )
                        }
                      >
                        Load more members
                      </button>
                    )}
                  </>
                )}
              </section>
            )}
          </div>
        </section>
      )}
      <dialog
        ref={segmentEditor}
        className="sg-dialog"
        aria-labelledby="sg-segment-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else closeEditors();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              locked ||
              !segmentDraft.name.trim() ||
              segmentDraft.name.length > 100 ||
              segmentDraft.description.length > 500
            )
              return;
            const value: SmartGroupChange = editingSegment
              ? {
                  action: "edit_segment",
                  segmentId: editingSegment.id,
                  revision: editingSegment.revision,
                  ...segmentDraft,
                  name: segmentDraft.name.trim(),
                }
              : {
                  action: "create_segment",
                  ...segmentDraft,
                  name: segmentDraft.name.trim(),
                };
            segmentEditor.current?.close();
            setSegmentDraft({ name: "", description: "" });
            setEditingSegment(null);
            change(value);
          }}
        >
          <h2 id="sg-segment-title">
            {editingSegment ? "Edit segment" : "Add segment"}
          </h2>
          <label>
            Segment name
            <input
              required
              maxLength={100}
              value={segmentDraft.name}
              disabled={locked}
              onChange={(event) =>
                setSegmentDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Segment description
            <textarea
              maxLength={500}
              value={segmentDraft.description}
              disabled={locked}
              onChange={(event) =>
                setSegmentDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <div className="sg-dialog-actions">
            <button type="button" disabled={locked} onClick={closeEditors}>
              Cancel
            </button>
            <button
              className="sg-primary"
              disabled={locked || !segmentDraft.name.trim()}
            >
              Save segment
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={groupEditor}
        className="sg-group-editor"
        aria-labelledby="sg-group-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else closeEditors();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSaveGroup) return;
            groupEditor.current?.close();
            const value = groupChange;
            closeEditors();
            change(value);
          }}
        >
          <div className="sg-panel-heading">
            <h2 id="sg-group-title">
              {editingGroup ? "Edit Smart Group" : "Add group"}
            </h2>
            <button
              type="button"
              aria-label="Close group editor"
              disabled={locked}
              onClick={closeEditors}
            >
              ×
            </button>
          </div>
          <label>
            Group name
            <input
              required
              maxLength={100}
              value={draft.name}
              disabled={locked}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Group description
            <textarea
              maxLength={500}
              value={draft.description}
              disabled={locked}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <fieldset disabled={locked}>
            <legend>Required active segment</legend>
            <p>
              {draft.segment
                ? `Selected segment: ${draft.segment.name}${draft.segment.status !== "active" ? " (archived — choose an active segment)" : ""}`
                : "Select an active segment before saving."}
            </p>
            <div className="sg-picker-search">
              <label>
                Search segments
                <input
                  type="search"
                  value={pickerSearch}
                  maxLength={100}
                  onChange={(event) => setPickerSearch(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => void readPicker(pickerSearch.trim())}
              >
                Find segments
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickerSearch("");
                  void readPicker();
                }}
              >
                Clear segment search
              </button>
            </div>
            {pickerBusy && <p role="status">Loading segments…</p>}
            <div className="sg-segment-picker">
              {picker?.segments.map((segment) => (
                <button
                  type="button"
                  key={segment.id}
                  aria-label={`Select segment ${segment.name}`}
                  aria-pressed={draft.segment?.id === segment.id}
                  onClick={() =>
                    setDraft((current) => ({ ...current, segment }))
                  }
                >
                  {segment.name}
                </button>
              ))}
            </div>
            {picker && !pickerBusy && !picker.segments.length && (
              <p>No active segments match this search.</p>
            )}
            {picker?.nextCursor && (
              <button
                type="button"
                disabled={pickerBusy}
                onClick={() => void readPicker(pickerQuery, picker.nextCursor)}
              >
                Load more available segments
              </button>
            )}
          </fieldset>
          <fieldset disabled={locked}>
            <legend>Every rule must match (AND)</legend>
            <p className="sg-hint">
              Each rule matches any exact listed value (Is any). Text is
              case-sensitive; meaningful spaces are preserved. Empty or
              unavailable rules never mean all records.
            </p>
            {draft.rules.map((rule, index) => (
              <div className="sg-rule" key={index}>
                <div>
                  <label>
                    Rule {index + 1} field
                    <select
                      aria-label={`Rule ${index + 1} field`}
                      value={rule.field}
                      onChange={(event) =>
                        updateRules(
                          draft.rules.map((item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  field: event.target
                                    .value as SmartGroupRule["field"],
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      {!fields.some((field) => field.key === rule.field) && (
                        <option value={rule.field}>
                          Unavailable field: {rule.field}
                        </option>
                      )}
                      {fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>Is any of</span>
                  <button
                    type="button"
                    disabled={draft.rules.length <= 1}
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() =>
                      updateRules(
                        draft.rules.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove rule
                  </button>
                </div>
                {rule.values.map((value, position) => (
                  <div className="sg-rule-value" key={position}>
                    <label>
                      Rule {index + 1} value {position + 1}
                      <input
                        maxLength={500}
                        value={value}
                        onChange={(event) =>
                          updateRules(
                            draft.rules.map((item, row) =>
                              row === index
                                ? {
                                    ...item,
                                    values: item.values.map(
                                      (alternative, column) =>
                                        column === position
                                          ? event.target.value
                                          : alternative,
                                    ),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={rule.values.length <= 1}
                      aria-label={`Remove rule ${index + 1} value ${position + 1}`}
                      onClick={() =>
                        updateRules(
                          draft.rules.map((item, row) =>
                            row === index
                              ? {
                                  ...item,
                                  values: item.values.filter(
                                    (_, column) => column !== position,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={rule.values.length >= 25}
                  aria-label={`Add value to rule ${index + 1}`}
                  onClick={() =>
                    updateRules(
                      draft.rules.map((item, row) =>
                        row === index
                          ? { ...item, values: [...item.values, ""] }
                          : item,
                      ),
                    )
                  }
                >
                  Add alternative value
                </button>
                {index < draft.rules.length - 1 && (
                  <strong className="sg-and">AND</strong>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={draft.rules.length >= 10}
              onClick={() =>
                updateRules([...draft.rules, { field: "title", values: [""] }])
              }
            >
              Add rule
            </button>
          </fieldset>
          {ruleError && <p className="sg-error">{ruleError}</p>}
          {groupSize > byteLimit && (
            <p className="sg-error">
              Combined change exceeds 40 KiB. Use fewer or shorter values.
            </p>
          )}
          <button
            type="button"
            disabled={
              locked ||
              !!ruleError ||
              previewBusy ||
              payloadBytes({
                tenantId: company.id,
                rules: draft.rules,
                limit: 50,
              }) > byteLimit
            }
            onClick={() => void readPreview()}
          >
            Preview matches
          </button>
          {previewBusy && <p role="status">Previewing matching records…</p>}
          {preview && (
            <section className="sg-preview" aria-label="Matching preview">
              <h3>Exact current rule preview</h3>
              <Population counts={preview.counts} />
              <div className="sg-filters">
                <label>
                  Search preview members
                  <input
                    type="search"
                    maxLength={100}
                    value={previewSearch}
                    onChange={(event) => setPreviewSearch(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={locked || previewBusy}
                  onClick={() => void readPreview(previewSearch.trim())}
                >
                  Search preview
                </button>
              </div>
              <MemberTable members={preview.members} />
              <p>
                {preview.members.length} shown · {preview.matchedCount} matching
                the name search.
              </p>
              {preview.counts.records === 0 && (
                <p>
                  No active records match these rules. A zero-member group is
                  valid.
                </p>
              )}
              {preview.nextCursor && (
                <button
                  type="button"
                  disabled={locked || previewBusy}
                  onClick={() =>
                    void readPreview(previewQuery, preview.nextCursor)
                  }
                >
                  Load more preview members
                </button>
              )}
            </section>
          )}
          <p className="sg-hint">
            Records are evaluated from current profile fields. Eligibility does
            not grant permissions or connect these groups to other modules.
            Archive/restore is a CT Alt retention extension.
          </p>
          <div className="sg-dialog-actions">
            <button type="button" disabled={locked} onClick={closeEditors}>
              Cancel
            </button>
            <button className="sg-primary" disabled={!canSaveGroup}>
              Save group
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={confirmationDialog}
        className="sg-dialog"
        aria-labelledby="sg-confirm-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else setConfirmation(null);
        }}
      >
        <h2 id="sg-confirm-title">
          {confirmation?.action.startsWith("archive") ? "Archive" : "Restore"}{" "}
          {confirmation && "group" in confirmation ? "group" : "segment"}?
        </h2>
        <p>
          {confirmation?.action === "archive_segment"
            ? "Only empty-of-active-groups segments can be archived. This keeps all historical groups and records; it does not change any content audience."
            : confirmation?.action === "restore_group"
              ? "Restore this saved group only when its segment is active and all rule fields are available."
              : "This CT Alt retention action preserves definitions and history. Group membership does not grant access or assign content."}
        </p>
        <div className="sg-dialog-actions">
          <button
            disabled={locked}
            onClick={() => {
              confirmationDialog.current?.close();
              setConfirmation(null);
            }}
          >
            Cancel
          </button>
          <button
            className="sg-primary"
            disabled={locked}
            onClick={() => {
              if (!confirmation || locked) return;
              const value: SmartGroupChange =
                "group" in confirmation
                  ? {
                      action: confirmation.action,
                      groupId: confirmation.group.id,
                      revision: confirmation.group.revision,
                    }
                  : {
                      action: confirmation.action,
                      segmentId: confirmation.segment.id,
                      revision: confirmation.segment.revision,
                    };
              confirmationDialog.current?.close();
              setConfirmation(null);
              change(value);
            }}
          >
            {confirmation?.action.startsWith("archive") ? "Archive" : "Restore"}{" "}
            {confirmation && "group" in confirmation ? "group" : "segment"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
