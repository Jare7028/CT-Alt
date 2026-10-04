"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Company, Member } from "../../lib/agent-types";
import type {
  KnowledgeBase,
  KnowledgeBaseData,
  KnowledgeBasesData,
  KnowledgeNode,
  KnowledgeNodeData,
  KnowledgeNodesData,
  KnowledgeSearchData,
  KnowledgeAssignee,
  KnowledgeAssigneesData,
  KnowledgeInsightsData,
  KnowledgeIdentity,
  KnowledgeReadScope,
  KnowledgePathItem,
  KnowledgeChange,
  KnowledgeMutation,
  KnowledgeSaved,
  KnowledgeView,
  KnowledgeNodeKind,
  KnowledgeViewReconciliation,
} from "../../lib/knowledge-base-types";
import {
  KNOWLEDGE_FILE_HEADERS,
  KNOWLEDGE_FILE_MAX_BYTES,
  KNOWLEDGE_FILE_MAX_METADATA_BYTES,
  type KnowledgeCurrentFile,
  type KnowledgeFileMetadata,
  type KnowledgeFileSaved,
  type KnowledgeFileAttemptData,
  type KnowledgeFileBudgetData,
} from "../../lib/knowledge-base-file-types";
import "./knowledge-base.css";
type Props = {
  company: Company;
  role: Member["role"];
  initialData: KnowledgeBasesData;
};
type Phase = "checking" | "ready" | "reading" | "saving" | "unknown";
type Selection = {
  baseId: string;
  parentId: string | null;
  nodeId: string | null;
};
type CatalogQuery = {
  status: "all" | "draft" | "published" | "archived";
  search: string;
};
type Editor = "base" | "audience" | "node" | "file" | "move" | null;
type Confirmation = {
  action:
    | "publish_base"
    | "archive_base"
    | "restore_base"
    | "archive_node"
    | "restore_node";
  node?: KnowledgeNode;
} | null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limit = 262144;
const emptyQuery: CatalogQuery = { status: "all", search: "" };
const encoded = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
function semantic(value: unknown): number {
  if (typeof value === "string")
    return new TextEncoder().encode(value).byteLength;
  if (Array.isArray(value))
    return 32 + value.reduce((sum, item) => sum + semantic(item), 0);
  if (value && typeof value === "object")
    return (
      64 +
      Object.values(value).reduce<number>(
        (sum, item) => sum + semantic(item),
        0,
      )
    );
  return 16;
}
function legalText(value: string) {
  if (value.includes("\0")) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function payloadIssue(value: unknown) {
  if (encoded(value) > limit)
    return "The JSON transport exceeds 256 KiB. Escaped controls can exceed this limit even within the text character bound.";
  if (1024 + semantic(value) > limit)
    return "The decoded content exceeds the 256 KiB semantic budget. Use less content or fewer selected users.";
  const strings = (item: unknown): boolean =>
    typeof item === "string"
      ? legalText(item)
      : Array.isArray(item)
        ? item.every(strings)
        : item && typeof item === "object"
          ? Object.values(item).every(strings)
          : true;
  return strings(value)
    ? ""
    : "NUL and unpaired surrogate characters cannot be stored. Remove these characters before saving.";
}
const count = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const revision = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 1;
const decimal = (value: unknown) =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const cursor = (value: unknown) =>
  value === null || (typeof value === "string" && !!value);
const text = (value: unknown, max: number, min = 0) =>
  typeof value === "string" &&
  value.length >= min &&
  value.length <= max &&
  legalText(value);
function safeLink(value: unknown) {
  if (
    typeof value !== "string" ||
    !text(value, 2000, 1) ||
    /[\s\\\x00-\x1f\x7f]/.test(value) ||
    /%(?![0-9a-f]{2})/i.test(value)
  )
    return false;
  const parts = /^https?:\/\/([^/?#:]+)(?::([0-9]{1,5}))?([/?#].*)?$/i.exec(
    value,
  );
  if (!parts) return false;
  const host = parts[1],
    labels = host.split(".");
  if (parts[2] && (Number(parts[2]) < 1 || Number(parts[2]) > 65535))
    return false;
  const valid = /^[0-9]+(?:\.[0-9]+){3}$/.test(host)
    ? labels.every(
        (label) => /^(0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255,
      )
    : host.length <= 253 &&
      !/^0x[0-9a-f]*$/i.test(labels.at(-1) ?? "") &&
      /[a-z]/i.test(labels.at(-1) ?? "") &&
      labels.every(
        (label) =>
          !/^xn--/i.test(label) &&
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      );
  if (!valid) return false;
  try {
    return !!new URL(value).hostname;
  } catch {
    return false;
  }
}
function validBase(value: KnowledgeBase) {
  return (
    !!value &&
    uuid.test(value.id) &&
    text(value.name, 100, 1) &&
    text(value.description, 500) &&
    ["draft", "published", "archived"].includes(value.status) &&
    revision(value.revision) &&
    count(value.audienceCount) &&
    value.audienceCount <= 500 &&
    count(value.eligibleAudienceCount) &&
    value.eligibleAudienceCount <= value.audienceCount &&
    [
      value.isAssigned,
      value.canRead,
      value.canEdit,
      value.canPublish,
      value.canArchive,
      value.canRestore,
    ].every((v) => typeof v === "boolean") &&
    (value.restoreStatus === null ||
      ["draft", "published"].includes(value.restoreStatus))
  );
}
function validFile(value: KnowledgeCurrentFile | undefined) {
  return (
    !!value &&
    uuid.test(value.versionId) &&
    text(value.filename, 255, 1) &&
    !/[\r\n]/.test(value.filename) &&
    new TextEncoder().encode(value.filename).length <= 1024 &&
    [
      "application/pdf",
      "text/plain",
      "text/csv",
      "image/png",
      "image/jpeg",
    ].includes(value.mediaType) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= KNOWLEDGE_FILE_MAX_BYTES &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    typeof value.uploadedAt === "string" &&
    Number.isFinite(Date.parse(value.uploadedAt)) &&
    text(value.uploaderName, 200, 1)
  );
}
function fileIssue(value: File | null) {
  if (!value) return "Choose one file.";
  if (!value.size || value.size > KNOWLEDGE_FILE_MAX_BYTES)
    return "Choose a nonempty file up to 2 MiB.";
  if (
    !legalText(value.name) ||
    !value.name.length ||
    value.name.length > 255 ||
    /[\r\n]/.test(value.name) ||
    new TextEncoder().encode(value.name).length > 1024
  )
    return "The filename is invalid or too long.";
  const extension = value.name.split(".").pop()?.toLowerCase();
  const media: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  if (!extension || !media[extension])
    return "Choose a PDF, UTF-8 text or CSV, PNG, or JPEG file.";
  if (
    value.type &&
    value.type !== "application/octet-stream" &&
    value.type !== media[extension] &&
    !(extension === "csv" && value.type === "application/vnd.ms-excel")
  )
    return "The filename and declared file type must agree.";
  return "";
}
function validNode(value: KnowledgeNode, baseId: string) {
  return (
    !!value &&
    uuid.test(value.id) &&
    value.baseId === baseId &&
    (value.parentId === null || uuid.test(value.parentId)) &&
    ["folder", "text", "link", "file"].includes(value.kind) &&
    (value.kind === "file"
      ? validFile(value.currentFile)
      : value.currentFile === undefined) &&
    text(value.name, 100, 1) &&
    text(value.description, 500) &&
    ["active", "archived"].includes(value.status) &&
    revision(value.revision) &&
    Number.isSafeInteger(value.depth) &&
    value.depth >= 1 &&
    value.depth <= 16 &&
    typeof value.rank === "string" &&
    /^-?\d+$/.test(value.rank) &&
    count(value.activeChildCount) &&
    [
      value.canEdit,
      value.canMove,
      value.canMoveEarlier,
      value.canMoveLater,
      value.canArchive,
      value.canRestore,
    ].every((v) => typeof v === "boolean")
  );
}
function validPath(value: KnowledgePathItem[]) {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    new Set(value.map((v) => v.id)).size === value.length &&
    value.every(
      (v) =>
        uuid.test(v.id) &&
        text(v.name, 100, 1) &&
        ["active", "archived"].includes(v.status) &&
        revision(v.revision),
    )
  );
}
function validAssignees(value: KnowledgeAssignee[], max = 500) {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    new Set(value.map((v) => v.actorId)).size === value.length &&
    value.every(
      (v) =>
        uuid.test(v.actorId) &&
        text(v.name, 200, 1) &&
        Array.from(v.name).length <= 100 &&
        typeof v.eligible === "boolean",
    )
  );
}
function append<T>(old: T[], next: T[], key: (v: T) => string) {
  const seen = new Set(old.map(key));
  return [...old, ...next.filter((v) => !seen.has(key(v)))];
}
export default function KnowledgeBase(props: Props) {
  if (
    props.initialData.role !== props.role ||
    props.initialData.tenantId !== props.company.id ||
    props.initialData.company.id !== props.company.id
  )
    return (
      <div className="knowledge-base-page">
        <p role="alert">
          Current Knowledge Base identity could not be verified. Reload to check
          access.
        </p>
      </div>
    );
  return (
    <Library
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}`}
      {...props}
    />
  );
}
function Library({ company, initialData }: Props) {
  const [catalog, setCatalog] = useState<KnowledgeBasesData | null>(
      initialData,
    ),
    [view, setView] = useState<KnowledgeView>(initialData.view),
    [query, setQuery] = useState<CatalogQuery>(emptyQuery),
    [catalogSearch, setCatalogSearch] = useState("");
  const [baseData, setBaseData] = useState<KnowledgeBaseData | null>(null),
    [nodes, setNodes] = useState<KnowledgeNodesData | null>(null),
    [node, setNode] = useState<KnowledgeNodeData | null>(null),
    [searchData, setSearchData] = useState<KnowledgeSearchData | null>(null),
    [baseSearch, setBaseSearch] = useState(""),
    [baseSearchQuery, setBaseSearchQuery] = useState(""),
    [nodeStatus, setNodeStatus] = useState<"all" | "active" | "archived">(
      "all",
    );
  const [insights, setInsights] = useState<KnowledgeInsightsData | null>(null),
    [insightSearch, setInsightSearch] = useState(""),
    [insightQuery, setInsightQuery] = useState("");
  const [recoveryKind, setRecoveryKind] = useState<
    "view" | "management" | "file"
  >("management");
  const [phase, setPhase] = useState<Phase>("checking"),
    [writePending, setWritePending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [operation, setOperation] = useState<KnowledgeMutation | null>(null),
    [renderedOpen, setRenderedOpen] = useState<KnowledgeMutation | null>(null);
  const [editor, setEditor] = useState<Editor>(null),
    [newParent, setNewParent] = useState<string | null>(null),
    [editingBase, setEditingBase] = useState<KnowledgeBase | null>(null),
    [editingNode, setEditingNode] = useState<KnowledgeNode | null>(null),
    [baseDraft, setBaseDraft] = useState({ name: "", description: "" }),
    [nodeDraft, setNodeDraft] = useState({
      kind: "folder" as KnowledgeNodeKind,
      name: "",
      description: "",
      body: "",
      url: "",
    }),
    [selectedAudience, setSelectedAudience] = useState<KnowledgeAssignee[]>([]);
  const [roster, setRoster] = useState<KnowledgeAssigneesData | null>(null),
    [rosterSearch, setRosterSearch] = useState(""),
    [rosterQuery, setRosterQuery] = useState(""),
    [rosterBusy, setRosterBusy] = useState(false);
  const [destination, setDestination] = useState<KnowledgeNodesData | null>(
      null,
    ),
    [destinationChoice, setDestinationChoice] = useState<{
      id: string | null;
      name: string;
    } | null>(null),
    [destinationBusy, setDestinationBusy] = useState(false),
    [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const [, setFileBudget] = useState<KnowledgeFileBudgetData | null>(
    null,
  );
  const [fileAttempt, setFileAttempt] =
    useState<KnowledgeFileAttemptData | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const downloadUrls = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null),
    confirmDialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(true),
    epoch = useRef(0),
    writeBusy = useRef<string | null>(null),
    recoveryBusy = useRef(false),
    selection = useRef<Selection | null>(null),
    viewSelection = useRef<Selection | null>(null),
    marker = useRef<{ operationId: string; action: string } | null>(null);
  const requests = useRef<
    Record<
      | "main"
      | "search"
      | "roster"
      | "insights"
      | "destination"
      | "reconcile"
      | "download"
      | "budget",
      AbortController | null
    >
  >({
    main: null,
    search: null,
    roster: null,
    insights: null,
    destination: null,
    reconcile: null,
    download: null,
    budget: null,
  });
  const storageKey = `ct-alt:knowledge-base:${initialData.actorId}:${company.id}`;
  useEffect(() => {
    mounted.current = true;
    const epochRef = epoch;
    const urls = downloadUrls.current;
    let pending = false;
    try {
      const stored = sessionStorage.getItem(storageKey);
      pending = stored !== null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.action === "string" && uuid.test(parsed.operationId))
          marker.current = {
            action: parsed.action,
            operationId: parsed.operationId,
          };
      }
    } catch {}
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      if (pending) {
        setCatalog(null);
        setRecoveryKind(
          marker.current?.action === "view"
            ? "view"
            : marker.current?.action === "save_file"
              ? "file"
              : "management",
        );
      }
      setPhase(pending ? "unknown" : "ready");
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      epochRef.current += 1;
      Object.values(requests.current).forEach((r) => r?.abort());
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, [storageKey]);
  const locked = phase !== "ready" || !catalog || writePending;
  const canManage = !!catalog?.capabilities.canManage;
  const base = baseData?.base;
  function cancelDownload() {
    requests.current.download?.abort();
    requests.current.download = null;
    downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
    downloadUrls.current.clear();
    setDownloadBusy(false);
  }
  function invalidate() {
    epoch.current++;
    Object.values(requests.current).forEach((r) => r?.abort());
    requests.current = {
      main: null,
      search: null,
      roster: null,
      insights: null,
      destination: null,
      reconcile: null,
      download: null,
      budget: null,
    };
    cancelDownload();
    setFileBudget(null);
    setRenderedOpen(null);
    setRosterBusy(false);
    setDestinationBusy(false);
  }
  function closeEditor() {
    requests.current.budget?.abort();
    requests.current.budget = null;
    setFileBudget(null);
    requests.current.roster?.abort();
    requests.current.roster = null;
    requests.current.destination?.abort();
    requests.current.destination = null;
    dialog.current?.close();
    confirmDialog.current?.close();
    setEditor(null);
    setChosenFile(null);
    setNewParent(null);
    setConfirmation(null);
    setEditingBase(null);
    setEditingNode(null);
    setBaseDraft({ name: "", description: "" });
    setNodeDraft({
      kind: "folder",
      name: "",
      description: "",
      body: "",
      url: "",
    });
    setSelectedAudience([]);
    setRoster(null);
    setRosterSearch("");
    setRosterQuery("");
    setRosterBusy(false);
    setDestination(null);
    setDestinationChoice(null);
    setDestinationBusy(false);
  }
  function clearContents() {
    setBaseData(null);
    setNodes(null);
    setNode(null);
    setSearchData(null);
    setInsights(null);
    setBaseSearch("");
    setBaseSearchQuery("");
    setInsightSearch("");
    setInsightQuery("");
    selection.current = null;
  }
  function clearAccess(message: string) {
    invalidate();
    closeEditor();
    setCatalog(null);
    setFileAttempt(null);
    clearContents();
    setCatalogSearch("");
    setQuery(emptyQuery);
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
        generation === epoch.current &&
        requests.current[kind] === controller,
    };
  }
  function identity(
    next: KnowledgeIdentity,
    expectedView: KnowledgeView,
    expectedRole = catalog?.role || initialData.role,
  ) {
    return (
      !!next &&
      next.tenantId === company.id &&
      next.actorId === initialData.actorId &&
      next.role === expectedRole &&
      next.view === expectedView &&
      ["owner", "admin", "manager", "employee"].includes(next.role) &&
      (next.view !== "manage" || ["owner", "admin"].includes(next.role))
    );
  }
  function scope(
    next: KnowledgeReadScope & { base: KnowledgeBase },
    baseId: string,
    expectedView: KnowledgeView,
  ) {
    return (
      identity(next, expectedView) &&
      next.baseId === baseId &&
      validBase(next.base) &&
      next.base.id === baseId &&
      next.baseRevision === next.base.revision &&
      typeof next.audienceVersion === "string" &&
      !!next.audienceVersion &&
      typeof next.treeVersion === "string" &&
      !!next.treeVersion &&
      (expectedView !== "library" ||
        (next.base.status === "published" &&
          next.base.canRead &&
          next.base.isAssigned))
    );
  }
  function sameScope(a: KnowledgeReadScope, b: KnowledgeReadScope) {
    return (
      a.baseId === b.baseId &&
      a.baseRevision === b.baseRevision &&
      a.audienceVersion === b.audienceVersion &&
      a.treeVersion === b.treeVersion &&
      a.role === b.role &&
      a.view === b.view
    );
  }
  async function fetchJson<T>(
    url: string,
    controller: AbortController,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
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
          ? "Your current Knowledge Base access could not be verified. Private content has been cleared."
          : response.status === 409
            ? "The base, path, audience or view data changed. Refresh before continuing."
            : "Knowledge Base could not be loaded. A successful fresh read is required before continuing.",
      );
    return response.json() as Promise<T>;
  }
  function params(
    expectedView: KnowledgeView,
    extras: Record<string, string> = {},
  ) {
    return new URLSearchParams({
      tenantId: company.id,
      view: expectedView,
      ...extras,
    });
  }
  function fail(cause: unknown) {
    clearAccess(
      cause instanceof Error
        ? cause.message
        : "Knowledge Base response could not be verified. Refresh to recover.",
    );
  }
  function clearMarker() {
    marker.current = null;
    setFileAttempt(null);
    viewSelection.current = null;
    setOperation(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }
  async function readCatalog(
    expectedView: KnowledgeView,
    nextQuery: CatalogQuery = emptyQuery,
    nextCursor: string | null = null,
    allowedWrite?: string,
  ) {
    if (
      !mounted.current ||
      (writeBusy.current && writeBusy.current !== allowedWrite)
    )
      return false;
    invalidate();
    closeEditor();
    clearContents();
    setView(expectedView);
    setQuery(nextQuery);
    setCatalogSearch(nextQuery.search);
    setPhase("reading");
    setError("");
    setNotice("");
    if (!nextCursor)
      setCatalog((current) =>
        current ? { ...current, bases: [], nextCursor: null } : null,
      );
    const read = startRead("main");
    const p = params(expectedView, {
      status: expectedView === "library" ? "all" : nextQuery.status,
      search: nextQuery.search,
      limit: "50",
    });
    if (nextCursor) p.set("cursor", nextCursor);
    try {
      const next = await fetchJson<KnowledgeBasesData>(
        `/api/knowledge-base?${p}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (
        !identity(next, expectedView, next.role) ||
        !next.company ||
        next.company.id !== company.id ||
        !Array.isArray(next.bases) ||
        next.bases.length > 100 ||
        next.bases.some(
          (v) =>
            !validBase(v) ||
            (expectedView === "library" &&
              (!v.canRead || !v.isAssigned || v.status !== "published")),
        ) ||
        new Set(next.bases.map((v) => v.id)).size !== next.bases.length ||
        !next.counts ||
        ![
          next.counts.total,
          next.counts.draft,
          next.counts.published,
          next.counts.archived,
        ].every(count) ||
        next.counts.total !==
          next.counts.draft + next.counts.published + next.counts.archived ||
        typeof next.catalogVersion !== "string" ||
        !next.catalogVersion ||
        !cursor(next.nextCursor) ||
        typeof next.capabilities?.canManage !== "boolean" ||
        next.capabilities.canManage !== ["owner", "admin"].includes(next.role)
      )
        throw new Error("The base catalog response could not be verified.");
      if (
        nextCursor &&
        (catalog?.catalogVersion !== next.catalogVersion ||
          catalog.role !== next.role ||
          catalog.view !== next.view)
      )
        throw new Error(
          "The base catalog changed between pages. Refresh to recover.",
        );
      setCatalog((current) => ({
        ...next,
        bases:
          nextCursor && current
            ? append(current.bases, next.bases, (v) => v.id)
            : next.bases,
      }));
      setPhase("ready");
      return next;
    } catch (cause) {
      if (read.current()) fail(cause);
      return false;
    }
  }
  function validBaseDetails(
    next: KnowledgeBaseData,
    id: string,
    expectedView: KnowledgeView,
  ) {
    return (
      scope(next, id, expectedView) &&
      next.company?.id === company.id &&
      validAssignees(next.assignees) &&
      count(next.root?.activeChildCount) &&
      (expectedView !== "manage" ||
        next.assignees.length === next.base.audienceCount) &&
      (expectedView !== "library" || next.assignees.length === 0)
    );
  }
  function validChildren(
    next: KnowledgeNodesData,
    id: string,
    parentId: string | null,
    expectedView: KnowledgeView,
  ) {
    return (
      scope(next, id, expectedView) &&
      (parentId === null
        ? next.parent === null
        : validNode(next.parent!, id) &&
          next.parent?.id === parentId &&
          next.parent.kind === "folder") &&
      validPath(next.path) &&
      (parentId === null
        ? next.path.length === 0
        : next.path.at(-1)?.id === parentId) &&
      Array.isArray(next.nodes) &&
      next.nodes.length <= 100 &&
      new Set(next.nodes.map((v) => v.id)).size === next.nodes.length &&
      next.nodes.every((v) => validNode(v, id) && v.parentId === parentId) &&
      (expectedView !== "library" ||
        ((!next.parent || next.parent.status === "active") &&
          next.path.every((v) => v.status === "active") &&
          next.nodes.every((v) => v.status === "active"))) &&
      count(next.matchedCount) &&
      next.nodes.length <= next.matchedCount &&
      cursor(next.nextCursor)
    );
  }
  function validReader(
    next: KnowledgeNodeData,
    id: string,
    nodeId: string,
    expectedView: KnowledgeView,
  ) {
    return (
      scope(next, id, expectedView) &&
      validNode(next.node, id) &&
      next.node.id === nodeId &&
      validPath(next.path) &&
      !next.path.some((v) => v.id === nodeId) &&
      (next.node.kind === "text"
        ? text(next.body, 50000, 1) && next.url === null
        : next.node.kind === "link"
          ? next.body === null && safeLink(next.url)
          : next.body === null && next.url === null) &&
      (expectedView !== "library" ||
        (next.node.status === "active" &&
          next.path.every((v) => v.status === "active")))
    );
  }
  async function openResource(
    next: Selection,
    expectedView = view,
    record = true,
    allowedWrite?: string,
    nextCursor: string | null = null,
    nextStatus = nodeStatus,
    recoveryRead = false,
  ) {
    if (
      !mounted.current ||
      (writeBusy.current && writeBusy.current !== allowedWrite) ||
      (recoveryBusy.current && !allowedWrite && !recoveryRead)
    )
      return false;
    invalidate();
    closeEditor();
    setPhase("reading");
    setError("");
    setNotice("");
    if (!nextCursor) {
      setNodes(null);
      setNode(null);
    }
    setSearchData(null);
    setInsights(null);
    const read = startRead("main");
    try {
      const detail = await fetchJson<KnowledgeBaseData>(
        `/api/knowledge-base/${next.baseId}?${params(expectedView)}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (!validBaseDetails(detail, next.baseId, expectedView))
        throw new Error("The base definition response could not be verified.");
      let nextNodes: KnowledgeNodesData | null = null,
        nextNode: KnowledgeNodeData | null = null;
      if (next.nodeId) {
        nextNode = await fetchJson<KnowledgeNodeData>(
          `/api/knowledge-base/${next.baseId}/nodes/${next.nodeId}?${params(expectedView)}`,
          read.controller,
        );
        if (!read.current()) return false;
        if (
          !validReader(nextNode, next.baseId, next.nodeId, expectedView) ||
          !sameScope(detail, nextNode)
        )
          throw new Error(
            "The resource response or current path could not be verified.",
          );
      } else {
        const p = params(expectedView, {
          status: expectedView === "library" ? "active" : nextStatus,
          search: "",
          limit: "50",
        });
        if (next.parentId) p.set("parentId", next.parentId);
        if (nextCursor) p.set("cursor", nextCursor);
        nextNodes = await fetchJson<KnowledgeNodesData>(
          `/api/knowledge-base/${next.baseId}/nodes?${p}`,
          read.controller,
        );
        if (!read.current()) return false;
        if (
          !validChildren(nextNodes, next.baseId, next.parentId, expectedView) ||
          !sameScope(detail, nextNodes) ||
          (nextCursor && (!nodes || !sameScope(nodes, nextNodes)))
        )
          throw new Error(
            "The folder response or population changed. Refresh to recover.",
          );
      }
      selection.current = next;
      setBaseData(detail);
      setView(expectedView);
      if (nextNode) setNode(nextNode);
      if (nextNodes) {
        const incoming = nextNodes;
        setNodes((current) => ({
          ...incoming,
          nodes:
            nextCursor && current
              ? append(current.nodes, incoming.nodes, (v) => v.id)
              : incoming.nodes,
        }));
      }
      setPhase("ready");
      if (expectedView === "library" && record && !nextCursor) {
        const opened = nextNode?.node || nextNodes?.parent || null;
        setRenderedOpen({
          tenantId: company.id,
          operationId: crypto.randomUUID(),
          change: {
            action: "view",
            baseId: next.baseId,
            revision: detail.baseRevision,
            nodeId: opened?.id || null,
            nodeRevision: opened?.revision || null,
          },
        });
      }
      return detail;
    } catch (cause) {
      if (read.current()) fail(cause);
      return false;
    }
  }
  async function readSearch(value: string, nextCursor: string | null = null) {
    if (locked || writeBusy.current || recoveryBusy.current || !baseData)
      return;
    cancelDownload();
    requests.current.insights?.abort();
    requests.current.insights = null;
    setInsights(null);
    const read = startRead("search");
    setBaseSearchQuery(value);
    setPhase("reading");
    if (!nextCursor) setSearchData(null);
    try {
      const p = params(view, { search: value, limit: "50" });
      if (nextCursor) p.set("cursor", nextCursor);
      const next = await fetchJson<KnowledgeSearchData>(
        `/api/knowledge-base/${baseData.baseId}/search?${p}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !scope(next, baseData.baseId, view) ||
        !sameScope(next, baseData) ||
        !Array.isArray(next.results) ||
        next.results.length > 100 ||
        next.results.some(
          (v) => !validNode(v.node, baseData.baseId) || !validPath(v.path),
        ) ||
        !count(next.matchedCount) ||
        next.results.length > next.matchedCount ||
        !cursor(next.nextCursor) ||
        (nextCursor && (!searchData || !sameScope(next, searchData)))
      )
        throw new Error(
          "The title search response or current base version could not be verified.",
        );
      setSearchData((current) => ({
        ...next,
        results:
          nextCursor && current
            ? append(current.results, next.results, (v) => v.node.id)
            : next.results,
      }));
      setPhase("ready");
    } catch (cause) {
      if (read.current()) fail(cause);
    }
  }
  async function readRoster(value = "", nextCursor: string | null = null) {
    if (locked || writeBusy.current || recoveryBusy.current || !canManage)
      return;
    const read = startRead("roster");
    setRosterBusy(true);
    setRosterQuery(value);
    if (!nextCursor) setRoster(null);
    try {
      const p = new URLSearchParams({
        tenantId: company.id,
        search: value,
        limit: "50",
      });
      if (nextCursor) p.set("cursor", nextCursor);
      const next = await fetchJson<KnowledgeAssigneesData>(
        `/api/knowledge-base/assignees?${p}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !identity(next, "manage") ||
        !validAssignees(next.users, 100) ||
        next.users.some((v) => !v.eligible) ||
        !count(next.matchedCount) ||
        next.users.length > next.matchedCount ||
        typeof next.rosterVersion !== "string" ||
        !next.rosterVersion ||
        !cursor(next.nextCursor) ||
        (nextCursor && next.rosterVersion !== roster?.rosterVersion)
      )
        throw new Error(
          "The eligible assignee list changed or could not be verified.",
        );
      setRoster((current) => ({
        ...next,
        users:
          nextCursor && current
            ? append(current.users, next.users, (v) => v.actorId)
            : next.users,
      }));
    } catch (cause) {
      if (read.current()) fail(cause);
    } finally {
      if (read.current()) setRosterBusy(false);
    }
  }
  async function readInsights(
    nodeId: string | null = null,
    value = "",
    nextCursor: string | null = null,
  ) {
    if (
      locked ||
      writeBusy.current ||
      recoveryBusy.current ||
      !baseData ||
      view !== "manage"
    )
      return;
    cancelDownload();
    requests.current.search?.abort();
    requests.current.search = null;
    setSearchData(null);
    const read = startRead("insights");
    setPhase("reading");
    setInsightQuery(value);
    setInsightSearch(value);
    if (!nextCursor) setInsights(null);
    try {
      const p = params("manage", { search: value, limit: "50" });
      if (nodeId) p.set("nodeId", nodeId);
      if (nextCursor) p.set("cursor", nextCursor);
      const next = await fetchJson<KnowledgeInsightsData>(
        `/api/knowledge-base/${baseData.baseId}/insights?${p}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !scope(next, baseData.baseId, "manage") ||
        !sameScope(next, baseData) ||
        (nodeId
          ? !validNode(next.node!, baseData.baseId) || next.node?.id !== nodeId
          : next.node !== null) ||
        !validPath(next.path) ||
        typeof next.eventVersion !== "string" ||
        !next.eventVersion ||
        typeof next.timeZone !== "string" ||
        !next.timeZone ||
        !next.counts ||
        ![
          next.counts.assigned,
          next.counts.eligible,
          next.counts.unavailable,
          next.counts.distinctEligibleViewers,
        ].every(count) ||
        next.counts.assigned !==
          next.counts.eligible + next.counts.unavailable ||
        next.counts.distinctEligibleViewers > next.counts.eligible ||
        (next.counts.eligible === 0
          ? next.counts.eligibleViewedPercentage !== null
          : typeof next.counts.eligibleViewedPercentage !== "number" ||
            !Number.isFinite(next.counts.eligibleViewedPercentage) ||
            next.counts.eligibleViewedPercentage < 0 ||
            next.counts.eligibleViewedPercentage > 100) ||
        !decimal(next.counts.totalViews) ||
        !Array.isArray(next.users) ||
        next.users.length > 100 ||
        next.users.some(
          (v) =>
            !uuid.test(v.actorId) ||
            !text(v.name, 200, 1) ||
            Array.from(v.name).length > 100 ||
            typeof v.eligible !== "boolean" ||
            !decimal(v.totalViews) ||
            (v.lastViewedAt !== null &&
              (typeof v.lastViewedAt !== "string" ||
                !Number.isFinite(Date.parse(v.lastViewedAt)))),
        ) ||
        !count(next.matchedCount) ||
        next.users.length > next.matchedCount ||
        !Array.isArray(next.chart) ||
        next.chart.length !== 30 ||
        next.chart.some(
          (v) => !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !decimal(v.views),
        ) ||
        !cursor(next.nextCursor) ||
        (nextCursor &&
          (!insights ||
            !sameScope(next, insights) ||
            next.eventVersion !== insights.eventVersion))
      )
        throw new Error(
          "The current-audience insights response changed or could not be verified.",
        );
      setInsights((current) => ({
        ...next,
        users:
          nextCursor && current
            ? append(current.users, next.users, (v) => v.actorId)
            : next.users,
      }));
      setPhase("ready");
    } catch (cause) {
      if (read.current()) fail(cause);
    }
  }
  async function readDestination(
    parentId: string | null = null,
    nextCursor: string | null = null,
  ) {
    if (locked || writeBusy.current || recoveryBusy.current || !baseData)
      return;
    const read = startRead("destination");
    setDestinationBusy(true);
    if (!nextCursor) setDestination(null);
    try {
      const p = params("manage", { status: "active", search: "", limit: "50" });
      if (parentId) p.set("parentId", parentId);
      if (nextCursor) p.set("cursor", nextCursor);
      const next = await fetchJson<KnowledgeNodesData>(
        `/api/knowledge-base/${baseData.baseId}/nodes?${p}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !validChildren(next, baseData.baseId, parentId, "manage") ||
        !sameScope(next, baseData) ||
        (nextCursor && (!destination || !sameScope(next, destination)))
      )
        throw new Error(
          "The destination folder response or current base version could not be verified.",
        );
      setDestination((current) => ({
        ...next,
        nodes:
          nextCursor && current
            ? append(current.nodes, next.nodes, (v) => v.id)
            : next.nodes,
      }));
    } catch (cause) {
      if (read.current()) fail(cause);
    } finally {
      if (read.current()) setDestinationBusy(false);
    }
  }
  async function perform(value: KnowledgeMutation) {
    if (!mounted.current || writeBusy.current || recoveryBusy.current) return;
    const previous = selection.current;
    if (value.change.action === "view" && previous)
      viewSelection.current = { ...previous };
    writeBusy.current = value.operationId;
    setWritePending(true);
    invalidate();
    setOperation(value);
    setRecoveryKind(value.change.action === "view" ? "view" : "management");
    marker.current = {
      operationId: value.operationId,
      action: value.change.action,
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(marker.current));
    } catch {}
    setPhase("saving");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        keepalive: encoded(value) <= 61440,
      });
      if (!mounted.current) return;
      if (!response.ok) {
        let message =
          "The Knowledge Base change was not acknowledged. It may have saved; review before another action.";
        try {
          const result = await response.json();
          if (typeof result?.error === "string") message = result.error;
        } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      if (!mounted.current) return;
      const saved = result?.saved as KnowledgeSaved | undefined;
      const personal = value.change.action === "view";
      const expected =
        value.change.action === "create_base"
          ? 1
          : "revision" in value.change
            ? value.change.revision + (personal ? 0 : 1)
            : 1;
      if (
        !saved ||
        saved.operationId !== value.operationId ||
        saved.action !== value.change.action ||
        !uuid.test(saved.baseId) ||
        saved.revision !== expected ||
        !revision(saved.revision) ||
        ("baseId" in value.change && saved.baseId !== value.change.baseId) ||
        ("nodeId" in value.change &&
          value.change.nodeId !== null &&
          saved.nodeId !== value.change.nodeId) ||
        (value.change.action === "create_node" &&
          (!saved.nodeId ||
            !uuid.test(saved.nodeId) ||
            saved.nodeRevision !== 1)) ||
        ("nodeRevision" in value.change &&
          value.change.nodeRevision !== null &&
          saved.nodeRevision !==
            value.change.nodeRevision + (personal ? 0 : 1)) ||
        (personal &&
          (!saved.eventId ||
            !uuid.test(saved.eventId) ||
            typeof saved.recordedAt !== "string" ||
            !Number.isFinite(Date.parse(saved.recordedAt))))
      )
        throw new Error(
          "The action acknowledgement could not be confirmed. Refresh to recover.",
        );
      if (personal) {
        clearMarker();
        setPhase("ready");
        setNotice("View recorded.");
        return;
      }
      const next = await readCatalog(
        "manage",
        emptyQuery,
        null,
        value.operationId,
      );
      if (!next || !mounted.current) return;
      const target =
        previous?.baseId === saved.baseId
          ? { ...previous }
          : { baseId: saved.baseId, parentId: null, nodeId: null };
      if (
        value.change.action === "archive_node" &&
        "nodeId" in value.change &&
        (target.nodeId === value.change.nodeId ||
          target.parentId === value.change.nodeId)
      ) {
        target.nodeId = null;
        target.parentId = null;
      }
      const fresh = await openResource(
        target,
        "manage",
        false,
        value.operationId,
      );
      if (!fresh || !mounted.current) return;
      clearMarker();
      setNotice("Knowledge Base updated.");
    } catch (cause) {
      if (mounted.current) fail(cause);
    } finally {
      writeBusy.current = null;
      if (mounted.current) setWritePending(false);
    }
  }
  const executeOpen = useEffectEvent((value: KnowledgeMutation) => {
    if (
      !mounted.current ||
      phase !== "ready" ||
      writeBusy.current ||
      value.change.action !== "view" ||
      !selection.current ||
      selection.current.baseId !== value.change.baseId ||
      (selection.current.nodeId || selection.current.parentId) !==
        value.change.nodeId
    )
      return;
    setRenderedOpen(null);
    void perform(value);
  });
  useEffect(() => {
    if (!renderedOpen) return;
    const timer = setTimeout(() => executeOpen(renderedOpen), 0);
    return () => clearTimeout(timer);
  }, [renderedOpen]);
  function change(value: KnowledgeChange) {
    if (locked || writeBusy.current || recoveryBusy.current) return;
    const mutation = {
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change: value,
    };
    const issue = payloadIssue(mutation);
    if (issue) {
      setError(issue);
      return;
    }
    closeEditor();
    void perform(mutation);
  }
  function fileIdentity(value: {
    tenantId: string;
    actorId: string;
    role: Member["role"];
  }) {
    return (
      value.tenantId === company.id &&
      value.actorId === initialData.actorId &&
      value.role === initialData.role
    );
  }
  function validFileSaved(value: KnowledgeFileSaved, operationId: string) {
    return (
      !!value &&
      fileIdentity(value) &&
      value.operationId === operationId &&
      value.action === "save_file" &&
      uuid.test(value.baseId) &&
      uuid.test(value.nodeId) &&
      uuid.test(value.versionId) &&
      revision(value.revision) &&
      revision(value.nodeRevision)
    );
  }
  function validAttempt(value: KnowledgeFileAttemptData, operationId: string) {
    return (
      !!value &&
      fileIdentity(value) &&
      value.operationId === operationId &&
      value.action === "save_file" &&
      [
        "not_recorded",
        "upload_attempted",
        "uploaded_unverified",
        "provider_succeeded",
        "finalized",
        "closed",
        "cleanup_acknowledged",
      ].includes(value.status) &&
      (value.status === "not_recorded"
        ? value.attemptRevision === null
        : revision(value.attemptRevision)) &&
      !!value.capabilities &&
      [
        value.capabilities.canClose,
        value.capabilities.canFinalize,
        value.capabilities.canCleanup,
      ].every((v) => typeof v === "boolean") &&
      (!value.capabilities.canFinalize ||
        value.status === "provider_succeeded") &&
      (!value.capabilities.canClose ||
        [
          "upload_attempted",
          "uploaded_unverified",
          "provider_succeeded",
        ].includes(value.status)) &&
      (value.status === "finalized"
        ? validFileSaved(value.saved!, operationId)
        : value.saved === null) &&
      (value.deadline === null ||
        (typeof value.deadline === "string" &&
          Number.isFinite(Date.parse(value.deadline)))) &&
      typeof value.serverTime === "string" &&
      Number.isFinite(Date.parse(value.serverTime))
    );
  }
  async function readFileBudget() {
    if (
      !mounted.current ||
      writeBusy.current ||
      recoveryBusy.current ||
      !canManage ||
      locked
    )
      return;
    const read = startRead("budget");
    setFileBudget(null);
    try {
      const next = await fetchJson<KnowledgeFileBudgetData>(
        `/api/knowledge-base/files/budget?${new URLSearchParams({ tenantId: company.id })}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !fileIdentity(next) ||
        !count(next.allocatedBytes) ||
        !count(next.allocatedAttempts) ||
        next.allocatedBytes > 104857600 ||
        next.allocatedAttempts > 2048 ||
        next.byteLimit !== 104857600 ||
        next.globalAttemptLimit !== 4096 ||
        next.companyAttemptLimit !== 2048 ||
        !next.states ||
        ![
          "upload_attempted",
          "uploaded_unverified",
          "provider_succeeded",
          "finalized",
          "closed",
          "cleanup_acknowledged",
        ].every((key) => count(next.states[key as keyof typeof next.states])) ||
        Object.values(next.states).reduce((sum, value) => sum + value, 0) !==
          next.allocatedAttempts
      )
        throw new Error(
          "The reserved and retained budget could not be verified.",
        );
      setFileBudget(next);
    } catch (cause) {
      if (read.current()) fail(cause);
    }
  }
  async function finishFile(saved: KnowledgeFileSaved, operationId: string) {
    const fresh = await readCatalog("manage", emptyQuery, null, operationId);
    if (!fresh || !mounted.current) return;
    const opened = await openResource(
      { baseId: saved.baseId, parentId: null, nodeId: saved.nodeId },
      "manage",
      false,
      operationId,
      null,
      nodeStatus,
      true,
    );
    if (!opened || !mounted.current) return;
    clearMarker();
    setNotice("File saved. Current resource refreshed.");
  }
  async function saveFile() {
    if (
      locked ||
      writeBusy.current ||
      recoveryBusy.current ||
      !baseData ||
      !base?.canEdit ||
      editor !== "file"
    )
      return;
    const issue = fileIssue(chosenFile);
    if (
      issue ||
      !legalText(nodeDraft.name) ||
      !nodeDraft.name.trim() ||
      nodeDraft.name.length > 100 ||
      !legalText(nodeDraft.description) ||
      nodeDraft.description.length > 500
    ) {
      setError(issue || "Check the resource name and description.");
      return;
    }
    const operationId = crypto.randomUUID();
    const common = {
      tenantId: company.id,
      operationId,
      baseId: baseData.baseId,
      expectedBaseRevision: baseData.baseRevision,
      name: nodeDraft.name,
      description: nodeDraft.description,
      filename: chosenFile!.name,
    };
    if (!editingNode && !newParent) return;
    const metadata: KnowledgeFileMetadata = editingNode
      ? {
          ...common,
          mode: "replace",
          nodeId: editingNode.id,
          expectedNodeRevision: editingNode.revision,
        }
      : { ...common, mode: "create", parentId: newParent! };
    if (encoded(metadata) > KNOWLEDGE_FILE_MAX_METADATA_BYTES) {
      setError("The file metadata is too large.");
      return;
    }
    const body = new FormData();
    body.set("metadata", JSON.stringify(metadata));
    body.set("file", chosenFile!);
    writeBusy.current = operationId;
    setWritePending(true);
    invalidate();
    closeEditor();
    setOperation(null);
    setFileAttempt(null);
    marker.current = { operationId, action: "save_file" };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(marker.current));
    } catch {}
    setRecoveryKind("file");
    setPhase("saving");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/knowledge-base/${metadata.baseId}/files`,
        { method: "POST", cache: "no-store", body },
      );
      if (!mounted.current) return;
      const result = await response.json();
      if (!mounted.current) return;
      if (!response.ok)
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "The upload was not acknowledged. Recover this operation without resending the file.",
        );
      const saved = result?.saved as KnowledgeFileSaved;
      if (
        !validFileSaved(saved, operationId) ||
        saved.baseId !== metadata.baseId ||
        saved.revision !== metadata.expectedBaseRevision + 1 ||
        (metadata.mode === "replace" &&
          (saved.nodeId !== metadata.nodeId ||
            saved.nodeRevision !== metadata.expectedNodeRevision + 1)) ||
        (metadata.mode === "create" && saved.nodeRevision !== 1)
      )
        throw new Error(
          "The file acknowledgement could not be verified. Recover without resending bytes.",
        );
      await finishFile(saved, operationId);
    } catch (cause) {
      if (mounted.current) fail(cause);
    } finally {
      writeBusy.current = null;
      if (mounted.current) setWritePending(false);
    }
  }
  async function reconcileFile() {
    const pending = marker.current;
    if (!pending || pending.action !== "save_file") return;
    invalidate();
    setFileAttempt(null);
    setPhase("reading");
    setError("");
    const read = startRead("reconcile");
    try {
      const next = await fetchJson<KnowledgeFileAttemptData>(
        "/api/knowledge-base/files/reconcile",
        read.controller,
        { tenantId: company.id, operationId: pending.operationId },
      );
      if (!read.current()) return;
      if (!validAttempt(next, pending.operationId))
        throw new Error("The original file operation could not be verified.");
      if (
        ["not_recorded", "closed", "cleanup_acknowledged"].includes(next.status)
      ) {
        const fresh = await readCatalog("manage", emptyQuery);
        if (fresh) {
          clearMarker();
          setNotice(
            next.status === "not_recorded"
              ? "No file reservation was recorded. No bytes were resent."
              : "The file operation is closed. Its permanent reserved and retained budget remains charged.",
          );
        }
      } else if (next.status === "finalized") {
        await finishFile(next.saved!, pending.operationId);
      } else {
        setFileAttempt(next);
        setPhase("unknown");
        setNotice("The file operation remains locked. No bytes were resent.");
      }
    } catch (cause) {
      if (read.current()) fail(cause);
    }
  }
  async function changeFileAttempt(action: "finalize" | "close") {
    if (
      writeBusy.current ||
      recoveryBusy.current ||
      !mounted.current ||
      !fileAttempt ||
      !marker.current ||
      marker.current.action !== "save_file" ||
      fileAttempt.operationId !== marker.current.operationId ||
      !revision(fileAttempt.attemptRevision) ||
      !(action === "finalize"
        ? fileAttempt.capabilities.canFinalize
        : fileAttempt.capabilities.canClose)
    )
      return;
    const pending = fileAttempt;
    writeBusy.current = pending.operationId;
    setWritePending(true);
    invalidate();
    setFileAttempt(null);
    setPhase("saving");
    setError("");
    try {
      const response = await fetch(`/api/knowledge-base/files/${action}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: company.id,
          operationId: pending.operationId,
          expectedAttemptRevision: pending.attemptRevision,
        }),
      });
      if (!mounted.current) return;
      const next = await response.json();
      if (!mounted.current) return;
      if (!response.ok)
        throw new Error(
          typeof next?.error === "string"
            ? next.error
            : "The operation was not acknowledged. Recover before continuing.",
        );
      if (action === "finalize") {
        if (!validFileSaved(next?.saved, pending.operationId))
          throw new Error("The final file receipt could not be verified.");
        await finishFile(next.saved, pending.operationId);
      } else {
        if (
          !validAttempt(next, pending.operationId) ||
          next.status !== "closed"
        )
          throw new Error("The file close receipt could not be verified.");
        const fresh = await readCatalog(
          "manage",
          emptyQuery,
          null,
          pending.operationId,
        );
        if (fresh) {
          clearMarker();
          setNotice(
            "File operation closed. Its reserved and retained budget remains permanently charged.",
          );
        }
      }
    } catch (cause) {
      if (mounted.current) fail(cause);
    } finally {
      writeBusy.current = null;
      if (mounted.current) setWritePending(false);
    }
  }
  async function downloadFile() {
    if (
      locked ||
      writeBusy.current ||
      recoveryBusy.current ||
      !node ||
      node.node.kind !== "file" ||
      node.node.status !== "active" ||
      base?.status === "archived" ||
      node.path.some((item) => item.status !== "active") ||
      !node.node.currentFile ||
      downloadBusy
    )
      return;
    const current = node.node.currentFile;
    const baseId = node.baseId;
    const nodeId = node.node.id;
    const read = startRead("download");
    setDownloadBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/knowledge-base/${baseId}/nodes/${nodeId}/download?${new URLSearchParams({ tenantId: company.id, versionId: current.versionId })}`,
        { cache: "no-store", signal: read.controller.signal },
      );
      if (!read.current()) return;
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your current file access could not be verified. Private content has been cleared."
            : "The current file could not be downloaded. Refresh before continuing.",
        );
      const headers = response.headers;
      if (
        headers.get(KNOWLEDGE_FILE_HEADERS.actor) !== initialData.actorId ||
        headers.get(KNOWLEDGE_FILE_HEADERS.tenant) !== company.id ||
        headers.get(KNOWLEDGE_FILE_HEADERS.base) !== baseId ||
        headers.get(KNOWLEDGE_FILE_HEADERS.node) !== nodeId ||
        headers.get(KNOWLEDGE_FILE_HEADERS.version) !== current.versionId ||
        headers.get("Content-Type")?.split(";")[0].trim() !==
          current.mediaType ||
        headers.get("Content-Length") !== String(current.bytes) ||
        !headers.get("Cache-Control")?.toLowerCase().includes("no-store") ||
        !headers.get("Cache-Control")?.toLowerCase().includes("private") ||
        headers.get("X-Content-Type-Options") !== "nosniff" ||
        !headers
          .get("Content-Disposition")
          ?.toLowerCase()
          .startsWith("attachment;")
      )
        throw new Error(
          "The file identity, version, or attachment headers could not be verified.",
        );
      const blob = await response.blob();
      if (
        !read.current() ||
        selection.current?.baseId !== baseId ||
        selection.current?.nodeId !== nodeId
      )
        return;
      if (
        blob.size !== current.bytes ||
        blob.size <= 0 ||
        blob.size > KNOWLEDGE_FILE_MAX_BYTES
      )
        throw new Error("The complete file body could not be verified.");
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = current.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setNotice(
        "File download started. Downloading does not record an additional view.",
      );
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 0);
    } catch (cause) {
      if (read.current()) fail(cause);
    } finally {
      if (read.current()) setDownloadBusy(false);
    }
  }
  async function refresh() {
    if (writeBusy.current || recoveryBusy.current || !mounted.current) return;
    recoveryBusy.current = true;
    try {
      if (phase === "unknown" && marker.current?.action === "save_file") {
        await reconcileFile();
        return;
      }
      if (phase === "unknown" && marker.current?.action === "view") {
        invalidate();
        setPhase("reading");
        setError("");
        const read = startRead("reconcile");
        try {
          const pending = marker.current;
          const next = await fetchJson<KnowledgeViewReconciliation>(
            "/api/knowledge-base/reconcile-view",
            read.controller,
            { tenantId: company.id, operationId: pending.operationId },
          );
          if (!read.current()) return;
          if (
            next.tenantId !== company.id ||
            next.actorId !== initialData.actorId ||
            next.role !== (catalog?.role || initialData.role) ||
            next.operationId !== pending.operationId ||
            !["recorded", "not_recorded"].includes(next.status)
          )
            throw new Error("The view reconciliation could not be verified.");
          const resource = viewSelection.current;
          if (next.status === "not_recorded") {
            clearMarker();
            const fresh = await readCatalog("library", emptyQuery);
            if (fresh)
              setNotice(
                "The interrupted view was not recorded. No view was replayed.",
              );
          } else {
            const fresh = await readCatalog("library", emptyQuery);
            if (!fresh) return;
            if (resource) {
              const opened = await openResource(
                resource,
                "library",
                false,
                undefined,
                null,
                nodeStatus,
                true,
              );
              if (!opened) return;
            }
            clearMarker();
            setNotice(
              "The prior view was recorded and current reader access verified. No extra view was added.",
            );
          }
        } catch (cause) {
          if (read.current()) fail(cause);
        }
        return;
      }
      if (phase === "unknown") {
        const next = await readCatalog(
          marker.current ? "manage" : view,
          emptyQuery,
        );
        if (next) {
          clearMarker();
          setNotice(
            "Current bases refreshed. Review the result before another change.",
          );
        }
        return;
      }
      const target = selection.current;
      if (target) {
        await openResource(
          target,
          view,
          false,
          undefined,
          null,
          nodeStatus,
          true,
        );
      } else await readCatalog(view, query);
    } finally {
      recoveryBusy.current = false;
    }
  }
  async function editBase(value: KnowledgeBase | null = null) {
    if (locked || writeBusy.current || recoveryBusy.current || !canManage)
      return;
    closeEditor();
    setEditingBase(value);
    setBaseDraft(
      value
        ? { name: value.name, description: value.description }
        : { name: "", description: "" },
    );
    setSelectedAudience([]);
    setEditor("base");
    dialog.current?.showModal();
    if (!value) void readRoster();
  }
  function audience() {
    if (locked || writeBusy.current || !baseData || !base?.canEdit) return;
    closeEditor();
    setSelectedAudience(structuredClone(baseData.assignees));
    setEditor("audience");
    dialog.current?.showModal();
    void readRoster();
  }
  async function editNode(
    value: KnowledgeNode | null,
    kind: KnowledgeNodeKind = "folder",
    root = false,
  ) {
    if (
      locked ||
      writeBusy.current ||
      recoveryBusy.current ||
      !baseData ||
      !base?.canEdit
    )
      return;
    if (
      !value &&
      kind === "file" &&
      (!nodes?.parent ||
        nodes.parent.status !== "active" ||
        nodes.parent.depth >= 16)
    )
      return;
    closeEditor();
    let content: KnowledgeNodeData | null = null;
    if (value) {
      const read = startRead("main");
      setPhase("reading");
      try {
        content = await fetchJson<KnowledgeNodeData>(
          `/api/knowledge-base/${baseData.baseId}/nodes/${value.id}?${params("manage")}`,
          read.controller,
        );
        if (!read.current()) return;
        if (
          !validReader(content, baseData.baseId, value.id, "manage") ||
          !sameScope(content, baseData) ||
          !content.node.canEdit
        )
          throw new Error(
            "The resource changed or cannot currently be edited.",
          );
        setPhase("ready");
      } catch (cause) {
        if (read.current()) fail(cause);
        return;
      }
    }
    if (!mounted.current) return;
    setEditingNode(content?.node || null);
    setNewParent(root ? null : nodes?.parent?.id || null);
    setNodeDraft({
      kind: content?.node.kind || kind,
      name: content?.node.name || "",
      description: content?.node.description || "",
      body: content?.body || "",
      url: content?.url || "",
    });
    setEditor((content?.node.kind || kind) === "file" ? "file" : "node");
    dialog.current?.showModal();
    if ((content?.node.kind || kind) === "file") void readFileBudget();
  }
  function moveNode(value: KnowledgeNode) {
    if (locked || writeBusy.current || !baseData || !value.canMove) return;
    closeEditor();
    setEditingNode(value);
    setEditor("move");
    dialog.current?.showModal();
    void readDestination();
  }
  function confirm(value: NonNullable<Confirmation>) {
    if (locked || writeBusy.current) return;
    setConfirmation(value);
    confirmDialog.current?.showModal();
  }
  const baseChange: KnowledgeChange = editingBase
    ? {
        action: "edit_base",
        baseId: editingBase.id,
        revision: editingBase.revision,
        ...baseDraft,
      }
    : {
        action: "create_base",
        ...baseDraft,
        audienceIds: selectedAudience.map((v) => v.actorId),
      };
  const content =
    nodeDraft.kind === "text"
      ? {
          kind: "text" as const,
          name: nodeDraft.name,
          description: nodeDraft.description,
          body: nodeDraft.body,
        }
      : nodeDraft.kind === "link"
        ? {
            kind: "link" as const,
            name: nodeDraft.name,
            description: nodeDraft.description,
            url: nodeDraft.url,
          }
        : {
            kind: "folder" as const,
            name: nodeDraft.name,
            description: nodeDraft.description,
          };
  const nodeChange: KnowledgeChange = editingNode
    ? {
        action: "edit_node",
        baseId: base?.id || "",
        revision: base?.revision || 1,
        nodeId: editingNode.id,
        nodeRevision: editingNode.revision,
        ...content,
      }
    : {
        action: "create_node",
        baseId: base?.id || "",
        revision: base?.revision || 1,
        parentId: newParent,
        ...content,
      };
  const draftMutation = {
    tenantId: company.id,
    operationId: "00000000-0000-4000-8000-000000000000",
    change:
      editor === "node"
        ? nodeChange
        : editor === "audience"
          ? {
              action: "set_audience",
              baseId: base?.id || "",
              revision: base?.revision || 1,
              audienceIds: selectedAudience.map((v) => v.actorId),
            }
          : baseChange,
  };
  const draftIssue = editor === "file" ? "" : payloadIssue(draftMutation);
  const path = node?.path || nodes?.path || [];
  return (
    <div
      className="knowledge-base-page"
      aria-busy={phase === "reading" || phase === "saving"}
    >
      <header className="kb-heading">
        <div>
          <h1>Knowledge Base</h1>
          <p>Company information, organized into bases and folders</p>
        </div>
        <div>
          <button
            disabled={writePending || phase === "checking"}
            onClick={() => void refresh()}
          >
            Refresh Knowledge Base
          </button>
          {catalog && canManage && view === "manage" && (
            <button
              className="kb-primary"
              disabled={locked}
              onClick={() => void editBase()}
            >
              Add base
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="kb-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="kb-notice" role="status">
          {notice}
        </p>
      )}
      {phase === "unknown" && (
        <section className="kb-recovery" aria-label="Knowledge Base recovery">
          <h2>Verify current access before continuing</h2>
          <p>
            {recoveryKind === "view"
              ? "An interrupted rendered-open event may have been recorded. Recovery checks only your operation receipt and current reader access; it never replays a view."
              : recoveryKind === "file"
                ? "An interrupted file upload may have reserved permanent budget. Recovery checks only your original operation. It never resends file bytes or reconstructs private fields."
                : "The last action may have saved. Fresh unfiltered management reads are required for a pending management change."}{" "}
            Names, content and resource IDs are not stored for recovery.
          </p>
          <button disabled={writePending} onClick={() => void refresh()}>
            Refresh to recover
          </button>
          {fileAttempt && (
            <div className="kb-file-recovery">
              <p>
                Original file operation:{" "}
                {fileAttempt.status.replaceAll("_", " ")}.{" "}
                {fileAttempt.deadline && (
                  <>
                    Deadline:{" "}
                    <time dateTime={fileAttempt.deadline}>
                      {fileAttempt.deadline
                        .replace("T", " ")
                        .replace("Z", " UTC")}
                    </time>
                    .
                  </>
                )}
              </p>
              <p className="kb-hint">
                An unknown provider result cannot become a readable file. Only a
                durably acknowledged provider success may be finalized. Closing
                is permanent and retains the budget charge.
              </p>
              {fileAttempt.capabilities.canFinalize && (
                <button
                  disabled={writePending}
                  onClick={() => void changeFileAttempt("finalize")}
                >
                  Verify and finalize original file
                </button>
              )}
              {fileAttempt.capabilities.canClose && (
                <button
                  disabled={writePending}
                  onClick={() => void changeFileAttempt("close")}
                >
                  Permanently close file operation
                </button>
              )}
            </div>
          )}
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
      {catalog && (
        <>
          <nav className="kb-tabs" aria-label="Knowledge Base views">
            {canManage && (
              <button
                disabled={locked}
                aria-current={view === "manage" ? "page" : undefined}
                onClick={() => void readCatalog("manage", emptyQuery)}
              >
                Manage bases
              </button>
            )}
            <button
              disabled={locked}
              aria-current={view === "library" ? "page" : undefined}
              onClick={() => void readCatalog("library", emptyQuery)}
            >
              My library
            </button>
          </nav>
          {!baseData ? (
            <section className="kb-feature">
              <div className="kb-content">
                <p className="kb-hint">
                  {view === "manage"
                    ? "Management opens do not record reader views. Publish a base explicitly for its fixed selected users."
                    : "Your library includes only currently assigned published bases. Opening a base, folder or resource records a rendered-open event; a view does not confirm reading."}
                </p>
                <div className="kb-counts">
                  <span>
                    <strong>{catalog.counts.total}</strong> bases
                  </span>
                  <span>
                    <strong>{catalog.counts.published}</strong> published
                  </span>
                  {view === "manage" && (
                    <>
                      <span>
                        <strong>{catalog.counts.draft}</strong> draft
                      </span>
                      <span>
                        <strong>{catalog.counts.archived}</strong> archived
                      </span>
                    </>
                  )}
                </div>
                <form
                  className="kb-filters"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!writeBusy.current && phase !== "unknown")
                      void readCatalog(view, {
                        ...query,
                        search: catalogSearch.trim(),
                      });
                  }}
                >
                  <label>
                    Search bases
                    <input
                      type="search"
                      maxLength={100}
                      value={catalogSearch}
                      disabled={writePending || phase === "unknown"}
                      onChange={(event) => setCatalogSearch(event.target.value)}
                    />
                  </label>
                  {view === "manage" && (
                    <label>
                      Base status
                      <select
                        aria-label="Base status"
                        value={query.status}
                        disabled={writePending}
                        onChange={(event) =>
                          void readCatalog(view, {
                            ...query,
                            status: event.target
                              .value as CatalogQuery["status"],
                          })
                        }
                      >
                        <option value="all">All statuses</option>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                        <option value="archived">Archived</option>
                      </select>
                    </label>
                  )}
                  <button disabled={writePending}>Find bases</button>
                  <button
                    type="button"
                    disabled={writePending}
                    onClick={() => void readCatalog(view, emptyQuery)}
                  >
                    Clear base search
                  </button>
                </form>
                {phase === "reading" && <p role="status">Loading bases…</p>}
                <div className="kb-base-grid">
                  {catalog.bases.map((value) => (
                    <article key={value.id} className="kb-base-card">
                      <div className="kb-base-icon" aria-hidden="true">
                        ▤
                      </div>
                      <h2>{value.name}</h2>
                      <span className={`kb-status ${value.status}`}>
                        {value.status}
                      </span>
                      <p>
                        {value.description || "Organized company resources"}
                      </p>
                      <p className="kb-hint">
                        {value.audienceCount} fixed assigned users ·{" "}
                        {value.eligibleAudienceCount} currently eligible
                      </p>
                      <button
                        disabled={locked}
                        aria-label={`Open base ${value.name}`}
                        onClick={() =>
                          void openResource({
                            baseId: value.id,
                            parentId: null,
                            nodeId: null,
                          })
                        }
                      >
                        Open base
                      </button>
                    </article>
                  ))}
                </div>
                {phase === "ready" && !catalog.bases.length && (
                  <p className="kb-empty">
                    No knowledge bases match this view and search.
                  </p>
                )}
                <p className="kb-hint">
                  {catalog.bases.length} shown. Counts cover the whole current
                  title-search scope.
                </p>
                {catalog.nextCursor && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      void readCatalog(view, query, catalog.nextCursor)
                    }
                  >
                    Load more bases
                  </button>
                )}
              </div>
            </section>
          ) : (
            <>
              <div className="kb-panel-heading">
                <div>
                  <button
                    disabled={locked}
                    onClick={() => void readCatalog(view, query)}
                  >
                    Back to bases
                  </button>
                </div>
                <div className="kb-actions">
                  {view === "manage" && (
                    <>
                      <button
                        disabled={locked}
                        onClick={() => void readInsights()}
                      >
                        Overall insights
                      </button>
                      {base?.canEdit && (
                        <>
                          <button
                            disabled={locked}
                            onClick={() => void editBase(base)}
                          >
                            Edit base
                          </button>
                          <button disabled={locked} onClick={audience}>
                            Edit assignments
                          </button>
                        </>
                      )}
                      {base?.status === "draft" && (
                        <button
                          disabled={locked || !base.canPublish}
                          onClick={() => confirm({ action: "publish_base" })}
                        >
                          Publish base
                        </button>
                      )}
                      {base?.status === "archived" ? (
                        <button
                          disabled={locked || !base.canRestore}
                          onClick={() => confirm({ action: "restore_base" })}
                        >
                          Restore base
                        </button>
                      ) : (
                        <button
                          disabled={locked || !base?.canArchive}
                          onClick={() => confirm({ action: "archive_base" })}
                        >
                          Archive base
                        </button>
                      )}
                      {base?.isAssigned && base.canRead && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            void openResource(
                              { baseId: base.id, parentId: null, nodeId: null },
                              "library",
                            )
                          }
                        >
                          Read as assigned user
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="kb-workspace">
                <aside className="kb-hierarchy" aria-label="Folder hierarchy">
                  <h2>Folders</h2>
                  <button
                    disabled={locked}
                    aria-current={!node && !nodes?.parent ? "page" : undefined}
                    onClick={() =>
                      void openResource(
                        {
                          baseId: baseData.baseId,
                          parentId: null,
                          nodeId: null,
                        },
                        view,
                        !!node || !!nodes?.parent,
                      )
                    }
                  >
                    ▤ {base?.name}
                  </button>
                  {path.map((folder) => (
                    <div className="kb-path-entry" key={folder.id}>
                      <button
                        disabled={locked}
                        aria-current={
                          nodes?.parent?.id === folder.id ? "page" : undefined
                        }
                        onClick={() =>
                          void openResource(
                            {
                              baseId: baseData.baseId,
                              parentId: folder.id,
                              nodeId: null,
                            },
                            view,
                            nodes?.parent?.id !== folder.id,
                          )
                        }
                      >
                        ▸ {folder.name}
                      </button>
                    </div>
                  ))}
                  {nodes?.nodes
                    .filter((value) => value.kind === "folder")
                    .map((folder) => (
                      <button
                        className="kb-nested"
                        key={folder.id}
                        disabled={locked}
                        aria-label={`Navigate folder ${folder.name}`}
                        onClick={() =>
                          void openResource({
                            baseId: baseData.baseId,
                            parentId: folder.id,
                            nodeId: null,
                          })
                        }
                      >
                        ▸ {folder.name}
                      </button>
                    ))}
                  {view === "manage" && base?.canEdit && (
                    <button
                      disabled={locked}
                      aria-label="Add section from hierarchy"
                      onClick={() => void editNode(null, "folder", true)}
                    >
                      Add section
                    </button>
                  )}
                  <p className="kb-hint">
                    Use the current path and breadcrumbs to navigate nested
                    folders.
                  </p>
                </aside>
                <div className="kb-main">
                  <nav
                    className="kb-breadcrumbs"
                    aria-label="Knowledge Base path"
                  >
                    <button
                      disabled={locked}
                      onClick={() =>
                        void openResource(
                          {
                            baseId: baseData.baseId,
                            parentId: null,
                            nodeId: null,
                          },
                          view,
                          !!node || !!nodes?.parent,
                        )
                      }
                    >
                      {base?.name}
                    </button>
                    {path.map((folder) => (
                      <span key={folder.id}>
                        /{" "}
                        <button
                          disabled={locked}
                          onClick={() =>
                            void openResource(
                              {
                                baseId: baseData.baseId,
                                parentId: folder.id,
                                nodeId: null,
                              },
                              view,
                              nodes?.parent?.id !== folder.id,
                            )
                          }
                        >
                          {folder.name}
                        </button>
                      </span>
                    ))}
                    {node && <span>/ {node.node.name}</span>}
                  </nav>
                  <div className="kb-panel-heading">
                    <div>
                      <h2>
                        {node?.node.name || nodes?.parent?.name || base?.name}
                      </h2>
                      <p className="kb-hint">
                        {node?.node.description ||
                          nodes?.parent?.description ||
                          base?.description}
                      </p>
                      <span className={`kb-status ${base?.status}`}>
                        {base?.status}
                      </span>
                    </div>
                    {view === "manage" &&
                      base?.canEdit &&
                      nodes &&
                      (!nodes.parent || nodes.parent.status === "active") && (
                        <div className="kb-actions">
                          <button
                            disabled={
                              locked || (nodes.parent?.depth || 0) >= 16
                            }
                            onClick={() => void editNode(null, "folder")}
                          >
                            {nodes.parent ? "Add folder" : "Add section"}
                          </button>
                          {nodes.parent && (
                            <>
                              <button
                                disabled={locked || nodes.parent.depth >= 16}
                                onClick={() => void editNode(null, "text")}
                              >
                                Add plain text
                              </button>
                              <button
                                disabled={locked || nodes.parent.depth >= 16}
                                onClick={() => void editNode(null, "link")}
                              >
                                Add external link
                              </button>
                              <button
                                disabled={locked || nodes.parent.depth >= 16}
                                onClick={() => void editNode(null, "file")}
                              >
                                Add file
                              </button>
                            </>
                          )}
                        </div>
                      )}
                  </div>
                  <p className="kb-hint">
                    {view === "manage"
                      ? "Management view · editing and insights do not record audience views."
                      : "Reader view · only deliberately entered resources record views. Refreshing the selected resource does not add another."}
                  </p>
                  <form
                    className="kb-filters"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!locked) void readSearch(baseSearch.trim());
                    }}
                  >
                    <label>
                      Search titles in this base
                      <input
                        type="search"
                        maxLength={100}
                        value={baseSearch}
                        disabled={locked}
                        onChange={(event) => setBaseSearch(event.target.value)}
                      />
                    </label>
                    <button disabled={locked}>Find resources</button>
                    {searchData && (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          requests.current.search?.abort();
                          requests.current.search = null;
                          setSearchData(null);
                          setBaseSearch("");
                        }}
                      >
                        Clear title search
                      </button>
                    )}
                  </form>
                  {phase === "reading" && (
                    <p role="status">Loading current resources…</p>
                  )}
                  {searchData ? (
                    <section aria-label="Knowledge Base title results">
                      <p>
                        {searchData.matchedCount} matching titles ·{" "}
                        {searchData.results.length} shown
                      </p>
                      <div className="kb-node-list">
                        {searchData.results.map((result) => (
                          <div className="kb-node-row" key={result.node.id}>
                            <span className="kb-node-icon" aria-hidden="true">
                              {result.node.kind === "folder"
                                ? "▰"
                                : result.node.kind === "text" ||
                                    result.node.kind === "file"
                                  ? "▤"
                                  : "↗"}
                            </span>
                            <div className="kb-node-name">
                              <button
                                disabled={locked}
                                aria-label={`Open search result ${result.node.name}`}
                                onClick={() =>
                                  void openResource({
                                    baseId: baseData.baseId,
                                    parentId:
                                      result.node.kind === "folder"
                                        ? result.node.id
                                        : null,
                                    nodeId:
                                      result.node.kind === "folder"
                                        ? null
                                        : result.node.id,
                                  })
                                }
                              >
                                {result.node.name}
                              </button>
                              <small>
                                {result.path.map((v) => v.name).join(" / ") ||
                                  base?.name}
                              </small>
                            </div>
                            <span className={`kb-status ${result.node.status}`}>
                              {result.node.status}
                            </span>
                          </div>
                        ))}
                      </div>
                      {!searchData.results.length && (
                        <p className="kb-empty">
                          No resource titles match this search.
                        </p>
                      )}
                      {searchData.nextCursor && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            void readSearch(
                              baseSearchQuery,
                              searchData.nextCursor,
                            )
                          }
                        >
                          Load more title results
                        </button>
                      )}
                    </section>
                  ) : (
                    <>
                      {nodes && (
                        <section aria-label="Folder contents">
                          {view === "manage" && (
                            <div className="kb-filters">
                              <label>
                                Resource status
                                <select
                                  aria-label="Resource status"
                                  value={nodeStatus}
                                  disabled={locked}
                                  onChange={(event) => {
                                    const status = event.target
                                      .value as typeof nodeStatus;
                                    setNodeStatus(status);
                                    void openResource(
                                      {
                                        baseId: baseData.baseId,
                                        parentId: nodes.parent?.id || null,
                                        nodeId: null,
                                      },
                                      view,
                                      false,
                                      undefined,
                                      null,
                                      status,
                                    );
                                  }}
                                >
                                  <option value="all">
                                    All retained resources
                                  </option>
                                  <option value="active">Active</option>
                                  <option value="archived">Archived</option>
                                </select>
                              </label>
                            </div>
                          )}
                          <div className="kb-node-list">
                            {nodes.nodes.map((value) => (
                              <div className="kb-node-row" key={value.id}>
                                <span
                                  className="kb-node-icon"
                                  aria-hidden="true"
                                >
                                  {value.kind === "folder"
                                    ? "▰"
                                    : value.kind === "text" ||
                                        value.kind === "file"
                                      ? "▤"
                                      : "↗"}
                                </span>
                                <div className="kb-node-name">
                                  <button
                                    disabled={locked}
                                    aria-label={`${value.kind === "folder" ? "Open folder" : "Open resource"} ${value.name}`}
                                    onClick={() =>
                                      void openResource({
                                        baseId: baseData.baseId,
                                        parentId:
                                          value.kind === "folder"
                                            ? value.id
                                            : null,
                                        nodeId:
                                          value.kind === "folder"
                                            ? null
                                            : value.id,
                                      })
                                    }
                                  >
                                    {value.name}
                                  </button>
                                  <small>
                                    {value.kind === "folder"
                                      ? `${value.activeChildCount} active child resources`
                                      : value.kind === "text"
                                        ? "Plain text"
                                        : value.kind === "file"
                                          ? "Private file attachment"
                                          : "Named external link"}
                                  </small>
                                </div>
                                <span className={`kb-status ${value.status}`}>
                                  {value.status}
                                </span>
                                {view === "manage" && (
                                  <div className="kb-row-actions">
                                    <button
                                      disabled={locked}
                                      aria-label={`Resource insights ${value.name}`}
                                      onClick={() =>
                                        void readInsights(value.id)
                                      }
                                    >
                                      Insights
                                    </button>
                                    {value.canEdit && (
                                      <button
                                        disabled={locked}
                                        aria-label={`Edit resource ${value.name}`}
                                        onClick={() => void editNode(value)}
                                      >
                                        Edit
                                      </button>
                                    )}
                                    <button
                                      disabled={locked || !value.canMoveEarlier}
                                      aria-label={`Move earlier ${value.name}`}
                                      onClick={() =>
                                        change({
                                          action: "order_node",
                                          baseId: baseData.baseId,
                                          revision: baseData.baseRevision,
                                          nodeId: value.id,
                                          nodeRevision: value.revision,
                                          direction: "earlier",
                                        })
                                      }
                                    >
                                      ↑ Earlier
                                    </button>
                                    <button
                                      disabled={locked || !value.canMoveLater}
                                      aria-label={`Move later ${value.name}`}
                                      onClick={() =>
                                        change({
                                          action: "order_node",
                                          baseId: baseData.baseId,
                                          revision: baseData.baseRevision,
                                          nodeId: value.id,
                                          nodeRevision: value.revision,
                                          direction: "later",
                                        })
                                      }
                                    >
                                      ↓ Later
                                    </button>
                                    {value.canMove && (
                                      <button
                                        disabled={locked}
                                        aria-label={`Move resource ${value.name}`}
                                        onClick={() => moveNode(value)}
                                      >
                                        Move
                                      </button>
                                    )}
                                    {value.status === "active" ? (
                                      <button
                                        disabled={locked || !value.canArchive}
                                        aria-label={`Archive resource ${value.name}`}
                                        onClick={() =>
                                          confirm({
                                            action: "archive_node",
                                            node: value,
                                          })
                                        }
                                      >
                                        Archive
                                      </button>
                                    ) : (
                                      <button
                                        disabled={locked || !value.canRestore}
                                        aria-label={`Restore resource ${value.name}`}
                                        onClick={() =>
                                          confirm({
                                            action: "restore_node",
                                            node: value,
                                          })
                                        }
                                      >
                                        Restore
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {!nodes.nodes.length && (
                            <p className="kb-empty">
                              This folder has no resources matching the selected
                              status.
                            </p>
                          )}
                          <p className="kb-hint">
                            {nodes.nodes.length} shown of {nodes.matchedCount}.
                            Earlier/later changes persistent sibling order.
                          </p>
                          {nodes.nextCursor && (
                            <button
                              disabled={locked}
                              onClick={() =>
                                void openResource(
                                  {
                                    baseId: baseData.baseId,
                                    parentId: nodes.parent?.id || null,
                                    nodeId: null,
                                  },
                                  view,
                                  false,
                                  undefined,
                                  nodes.nextCursor,
                                )
                              }
                            >
                              Load more resources
                            </button>
                          )}
                        </section>
                      )}
                      {node && (
                        <section
                          className="kb-reader"
                          aria-label="Knowledge Base resource"
                        >
                          <div className="kb-panel-heading">
                            <h3>{node.node.name}</h3>
                            {view === "manage" && (
                              <div className="kb-actions">
                                <button
                                  disabled={locked}
                                  onClick={() =>
                                    void readInsights(node.node.id)
                                  }
                                >
                                  Resource insights
                                </button>
                                {node.node.canEdit && (
                                  <button
                                    disabled={locked}
                                    onClick={() => void editNode(node.node)}
                                  >
                                    Edit resource
                                  </button>
                                )}
                                {node.node.canMove && (
                                  <button
                                    disabled={locked}
                                    onClick={() => moveNode(node.node)}
                                  >
                                    Move resource
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {node.node.kind === "text" ? (
                            <div className="kb-text">{node.body}</div>
                          ) : node.node.kind === "link" ? (
                            <>
                              <p>Named external link</p>
                              <a
                                href={locked ? undefined : node.url!}
                                aria-disabled={locked || undefined}
                                onClick={(event) => {
                                  if (
                                    locked ||
                                    writeBusy.current ||
                                    recoveryBusy.current
                                  )
                                    event.preventDefault();
                                }}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Open {node.node.name} externally ↗
                              </a>
                              <p className="kb-hint">{node.url}</p>
                              <p className="kb-hint">
                                A resource open records this CT Alt card, not a
                                visit to or reading of the external website.
                              </p>
                            </>
                          ) : node.node.kind === "file" &&
                            node.node.currentFile ? (
                            <section
                              className="kb-file-card"
                              aria-label="Current file"
                            >
                              <span className="kb-file-icon" aria-hidden="true">
                                ▤
                              </span>
                              <div>
                                <h4>{node.node.currentFile.filename}</h4>
                                <p>
                                  {node.node.currentFile.mediaType} ·{" "}
                                  {node.node.currentFile.bytes.toLocaleString(
                                    "en-GB",
                                  )}{" "}
                                  bytes
                                </p>
                                <p className="kb-hint">
                                  Uploaded by{" "}
                                  {node.node.currentFile.uploaderName} ·{" "}
                                  <time
                                    dateTime={node.node.currentFile.uploadedAt}
                                  >
                                    {new Intl.DateTimeFormat("en-GB", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                      timeZone: "UTC",
                                    }).format(
                                      new Date(node.node.currentFile.uploadedAt),
                                    )}{" "}
                                    UTC
                                  </time>
                                </p>
                                <p className="kb-hint">
                                  Private attachment. Download the file to view
                                  it on your device.
                                </p>
                                <button
                                  disabled={
                                    locked ||
                                    downloadBusy ||
                                    base?.status === "archived" ||
                                    node.node.status !== "active" ||
                                    node.path.some(
                                      (item) => item.status !== "active",
                                    )
                                  }
                                  onClick={() => void downloadFile()}
                                >
                                  {downloadBusy
                                    ? "Preparing file download…"
                                    : "Download current file"}
                                </button>
                              </div>
                            </section>
                          ) : (
                            <p>This is a retained folder resource.</p>
                          )}
                        </section>
                      )}
                    </>
                  )}
                  {insights && (
                    <section
                      className="kb-insights"
                      aria-label="Knowledge Base insights"
                    >
                      <div className="kb-panel-heading">
                        <div>
                          <h3>
                            {insights.node
                              ? insights.node.name
                              : "Overall resource opens in this base"}
                          </h3>
                          <p className="kb-hint">
                            {insights.node
                              ? "Opens of this exact resource; descendants are not implicitly included."
                              : "All actual base and resource-open events in this base."}{" "}
                            Current assigned audience only; removed actors
                            remain retained historical events outside these
                            displayed totals.
                          </p>
                        </div>
                        <button
                          disabled={writePending}
                          aria-label="Close Knowledge Base insights"
                          onClick={() => {
                            if (writeBusy.current) return;
                            requests.current.insights?.abort();
                            requests.current.insights = null;
                            setInsights(null);
                            if (catalog) setPhase("ready");
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <div className="kb-metrics">
                        <div>
                          <strong>{insights.counts.totalViews}</strong>
                          <small>
                            Current assigned audience resource opens
                          </small>
                        </div>
                        <div>
                          <strong>{insights.counts.assigned}</strong>
                          <small>
                            Assigned users · {insights.counts.unavailable}{" "}
                            unavailable
                          </small>
                        </div>
                        <div>
                          <strong>
                            {insights.counts.eligibleViewedPercentage === null
                              ? "Unavailable"
                              : `${insights.counts.eligibleViewedPercentage}%`}
                          </strong>
                          <small>
                            {insights.counts.eligible === 0
                              ? "No eligible audience"
                              : `${insights.counts.distinctEligibleViewers} distinct eligible viewers / ${insights.counts.eligible} eligible assigned accounts`}
                          </small>
                        </div>
                      </div>
                      <h4>Resource opens · 30 company calendar days</h4>
                      <p className="kb-hint">
                        {insights.timeZone} · current assigned audience,
                        including unavailable assignees
                      </p>
                      <div
                        className="kb-chart"
                        aria-label="30 day resource-open chart"
                      >
                        {insights.chart.map((day) => (
                          <div
                            key={day.date}
                            title={`${day.date}: ${day.views} resource opens`}
                          >
                            <span
                              style={{
                                height: `${chartHeight(day.views, insights.chart)}%`,
                                minHeight: day.views === "0" ? 0 : 2,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="kb-chart-labels">
                        <span>{insights.chart[0].date}</span>
                        <span>{insights.chart.at(-1)?.date}</span>
                      </div>
                      <form
                        className="kb-filters"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!locked)
                            void readInsights(
                              insights.node?.id || null,
                              insightSearch.trim(),
                            );
                        }}
                      >
                        <label>
                          Search assigned users
                          <input
                            type="search"
                            maxLength={100}
                            value={insightSearch}
                            disabled={locked}
                            onChange={(event) =>
                              setInsightSearch(event.target.value)
                            }
                          />
                        </label>
                        <button disabled={locked}>Find insight users</button>
                      </form>
                      <div className="kb-table-scroll">
                        <table>
                          <caption className="kb-sr-only">
                            Current assigned audience resource-open totals
                          </caption>
                          <thead>
                            <tr>
                              <th>User name</th>
                              <th>Current eligibility</th>
                              <th>Total resource opens</th>
                              <th>Last viewed (UTC)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {insights.users.map((user) => (
                              <tr key={user.actorId}>
                                <td>{user.name}</td>
                                <td>
                                  {user.eligible
                                    ? "Eligible"
                                    : "Unavailable assigned user"}
                                </td>
                                <td>{user.totalViews}</td>
                                <td>
                                  {user.lastViewedAt ? (
                                    <time dateTime={user.lastViewedAt}>
                                      {user.lastViewedAt
                                        .replace("T", " ")
                                        .replace("Z", " UTC")}
                                    </time>
                                  ) : (
                                    "Never viewed"
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="kb-hint">
                        {insights.users.length} shown of {insights.matchedCount}{" "}
                        matching assigned users.
                      </p>
                      {insights.nextCursor && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            void readInsights(
                              insights.node?.id || null,
                              insightQuery,
                              insights.nextCursor,
                            )
                          }
                        >
                          Load more insight users
                        </button>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="kb-editor-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else closeEditor();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (locked || (editor !== "file" && draftIssue)) return;
            if (editor === "file") {
              void saveFile();
              return;
            }
            if (editor === "base") {
              if (!baseDraft.name.trim()) return;
              change(baseChange);
            } else if (editor === "audience") {
              if (
                !baseData ||
                selectedAudience.length > 500 ||
                (base?.status === "published" && !selectedAudience.length)
              )
                return;
              change({
                action: "set_audience",
                baseId: baseData.baseId,
                revision: baseData.baseRevision,
                audienceIds: selectedAudience.map((v) => v.actorId),
              });
            } else if (editor === "node") {
              if (
                !nodeDraft.name.trim() ||
                (nodeDraft.kind === "text" && !nodeDraft.body.length) ||
                (nodeDraft.kind === "link" && !safeLink(nodeDraft.url))
              )
                return;
              change(nodeChange);
            } else if (
              editor === "move" &&
              editingNode &&
              destinationChoice &&
              baseData
            ) {
              change({
                action: "move_node",
                baseId: baseData.baseId,
                revision: baseData.baseRevision,
                nodeId: editingNode.id,
                nodeRevision: editingNode.revision,
                parentId: destinationChoice.id,
              });
            }
          }}
        >
          <div className="kb-panel-heading">
            <h2 id="kb-editor-title">
              {editor === "base"
                ? editingBase
                  ? "Edit base"
                  : "Add base"
                : editor === "audience"
                  ? "Edit assignments"
                  : editor === "move"
                    ? "Move resource"
                    : editor === "file"
                      ? editingNode
                        ? "Replace file"
                        : "Add file"
                      : editingNode
                        ? "Edit resource"
                        : nodeDraft.kind === "folder"
                          ? "Add folder"
                          : nodeDraft.kind === "text"
                            ? "Add plain text"
                            : "Add external link"}
            </h2>
            <button
              className="kb-dialog-close"
              type="button"
              disabled={locked}
              aria-label="Close Knowledge Base editor"
              onClick={closeEditor}
            >
              ×
            </button>
          </div>
          {editor === "file" && (
            <>
              <label>
                Resource name
                <input
                  required
                  maxLength={100}
                  value={nodeDraft.name}
                  disabled={locked}
                  onChange={(event) =>
                    setNodeDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Resource description
                <textarea
                  maxLength={500}
                  value={nodeDraft.description}
                  disabled={locked}
                  onChange={(event) =>
                    setNodeDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Choose file
                <input
                  type="file"
                  required
                  accept=".pdf,.txt,.csv,.png,.jpg,.jpeg"
                  disabled={locked}
                  onChange={(event) =>
                    setChosenFile(event.target.files?.[0] || null)
                  }
                />
              </label>
              <p className="kb-hint">
                One nonempty PDF, UTF-8 text or CSV, PNG, or JPEG, up to 2 MiB.
              </p>
              {chosenFile && (
                <p>
                  {chosenFile.name} · {chosenFile.size.toLocaleString("en-GB")}{" "}
                  bytes
                </p>
              )}
              {chosenFile && fileIssue(chosenFile) && (
                <p className="kb-error" role="alert">
                  {fileIssue(chosenFile)}
                </p>
              )}
            </>
          )}
          {editor === "base" && (
            <>
              <label>
                Base name
                <input
                  required
                  maxLength={100}
                  value={baseDraft.name}
                  disabled={locked}
                  onChange={(event) =>
                    setBaseDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Base description
                <textarea
                  maxLength={500}
                  value={baseDraft.description}
                  disabled={locked}
                  onChange={(event) =>
                    setBaseDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          )}
          {(editor === "audience" || (editor === "base" && !editingBase)) && (
            <>
              <p className="kb-hint">
                Fixed selected Auth accounts apply to every folder in this base.
                New users are not added automatically.{" "}
                {editor === "base"
                  ? "Drafts may start with no audience; publication requires at least one current eligible user."
                  : "Existing unavailable assignees are retained unless explicitly removed."}{" "}
                Select at most 500 users.
              </p>
              <p>{selectedAudience.length} selected users</p>
              <div className="kb-assignee-tags">
                {selectedAudience.map((user) => (
                  <span key={user.actorId}>
                    {user.name}
                    {!user.eligible ? " · unavailable" : ""}
                    <button
                      type="button"
                      disabled={locked}
                      aria-label={`Remove selected user ${user.name}`}
                      onClick={() =>
                        setSelectedAudience((current) =>
                          current.filter((v) => v.actorId !== user.actorId),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="kb-filters">
                <label>
                  Search eligible users
                  <input
                    type="search"
                    maxLength={100}
                    value={rosterSearch}
                    disabled={locked}
                    onChange={(event) => setRosterSearch(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void readRoster(rosterSearch.trim())}
                >
                  Find eligible users
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setRosterSearch("");
                    void readRoster();
                  }}
                >
                  Clear eligible search
                </button>
              </div>
              {rosterBusy && <p role="status">Loading eligible accounts…</p>}
              <div className="kb-assignees">
                {roster?.users.map((user) => (
                  <label key={user.actorId}>
                    <input
                      type="checkbox"
                      aria-label={`Select user ${user.name}`}
                      checked={selectedAudience.some(
                        (v) => v.actorId === user.actorId,
                      )}
                      disabled={
                        locked ||
                        (selectedAudience.length >= 500 &&
                          !selectedAudience.some(
                            (v) => v.actorId === user.actorId,
                          ))
                      }
                      onChange={(event) =>
                        setSelectedAudience((current) =>
                          event.target.checked
                            ? [...current, user]
                            : current.filter((v) => v.actorId !== user.actorId),
                        )
                      }
                    />
                    {user.name}
                  </label>
                ))}
              </div>
              {roster && (
                <p className="kb-hint">
                  {roster.users.length} shown of {roster.matchedCount} matching
                  eligible accounts.
                </p>
              )}
              {roster?.nextCursor && (
                <button
                  type="button"
                  disabled={locked || rosterBusy}
                  onClick={() =>
                    void readRoster(rosterQuery, roster.nextCursor)
                  }
                >
                  Load more eligible users
                </button>
              )}
            </>
          )}
          {editor === "node" && (
            <>
              <p className="kb-hint">
                {editingNode
                  ? "Resource identity and kind remain unchanged."
                  : nodeDraft.kind === "folder"
                    ? "Creates a section at the base root or a folder under the selected active folder."
                    : "Plain text and links require an active folder."}
              </p>
              <label>
                Resource name
                <input
                  required
                  maxLength={100}
                  value={nodeDraft.name}
                  disabled={locked}
                  onChange={(event) =>
                    setNodeDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Resource description
                <textarea
                  maxLength={500}
                  value={nodeDraft.description}
                  disabled={locked}
                  onChange={(event) =>
                    setNodeDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              {nodeDraft.kind === "text" && (
                <label>
                  Plain text
                  <textarea
                    className="kb-text-editor"
                    aria-label="Plain text"
                    required
                    maxLength={50000}
                    value={nodeDraft.body}
                    disabled={locked}
                    onChange={(event) =>
                      setNodeDraft((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                  />
                  <small className="kb-hint">
                    {nodeDraft.body.length} / 50000 UTF16 characters · exact
                    whitespace and newlines, displayed as plain text.
                  </small>
                </label>
              )}
              {nodeDraft.kind === "link" && (
                <label>
                  External URL
                  <input
                    type="url"
                    aria-label="External URL"
                    required
                    maxLength={2000}
                    value={nodeDraft.url}
                    disabled={locked}
                    onChange={(event) =>
                      setNodeDraft((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                  />
                  <small className="kb-hint">
                    HTTP or HTTPS with an ASCII hostname or decimal IPv4
                    address. Credentials and IPv6 are unsupported. CT Alt does
                    not fetch link metadata.
                  </small>
                </label>
              )}
            </>
          )}
          {editor === "move" && editingNode && (
            <>
              <p>
                Move {editingNode.name} within {base?.name}. Resource identity,
                status and history are retained.
              </p>
              <p>
                {destinationChoice
                  ? `Selected destination: ${destinationChoice.name}`
                  : "Choose an active destination."}
              </p>
              <div className="kb-destination">
                <button
                  type="button"
                  disabled={locked || destinationBusy}
                  onClick={() => void readDestination()}
                >
                  Browse base root
                </button>
                {destination?.path.map((folder) => (
                  <button
                    type="button"
                    key={folder.id}
                    disabled={locked || destinationBusy}
                    onClick={() => void readDestination(folder.id)}
                  >
                    {folder.name}
                  </button>
                ))}
                <p>{destination?.parent?.name || base?.name}</p>
                <button
                  type="button"
                  disabled={
                    locked ||
                    destinationBusy ||
                    !destination ||
                    (editingNode.kind !== "folder" && !destination.parent) ||
                    destination.path.some((v) => v.id === editingNode.id) ||
                    destination.parent?.id === editingNode.id
                  }
                  onClick={() =>
                    setDestinationChoice({
                      id: destination?.parent?.id || null,
                      name:
                        destination?.parent?.name || base?.name || "Base root",
                    })
                  }
                >
                  Select this destination
                </button>
                {destinationBusy && (
                  <p role="status">Loading destination folders…</p>
                )}
                {destination?.nodes
                  .filter(
                    (value) =>
                      value.kind === "folder" && value.id !== editingNode.id,
                  )
                  .map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      disabled={locked || destinationBusy}
                      aria-label={`Browse destination ${folder.name}`}
                      onClick={() => void readDestination(folder.id)}
                    >
                      {folder.name} →
                    </button>
                  ))}
                {destination?.nextCursor && (
                  <button
                    type="button"
                    disabled={locked || destinationBusy}
                    onClick={() =>
                      void readDestination(
                        destination.parent?.id || null,
                        destination.nextCursor,
                      )
                    }
                  >
                    Load more destination folders
                  </button>
                )}
              </div>
            </>
          )}
          {draftIssue && <p className="kb-error">{draftIssue}</p>}
          <div className="kb-dialog-actions">
            <button type="button" disabled={locked} onClick={closeEditor}>
              Cancel
            </button>
            <button
              className="kb-primary"
              disabled={
                locked ||
                !!draftIssue ||
                (editor === "base" && !baseDraft.name.trim()) ||
                (editor === "audience" &&
                  (selectedAudience.length > 500 ||
                    (base?.status === "published" &&
                      !selectedAudience.length))) ||
                (editor === "node" &&
                  (!nodeDraft.name.trim() ||
                    (nodeDraft.kind === "text" && !nodeDraft.body.length) ||
                    (nodeDraft.kind === "link" && !safeLink(nodeDraft.url)))) ||
                (editor === "file" &&
                  (!nodeDraft.name.trim() || !!fileIssue(chosenFile))) ||
                (editor === "move" && !destinationChoice)
              }
            >
              {editor === "base"
                ? "Save base"
                : editor === "audience"
                  ? "Save assignments"
                  : editor === "move"
                    ? "Move resource"
                    : editor === "file"
                      ? editingNode
                        ? "Replace file"
                        : "Save file"
                      : "Save resource"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={confirmDialog}
        aria-labelledby="kb-confirm-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else {
            setConfirmation(null);
            confirmDialog.current?.close();
          }
        }}
      >
        <h2 id="kb-confirm-title">
          {confirmation ? lifecycleLabel(confirmation.action) : ""}?
        </h2>
        <p>
          {confirmation?.action === "publish_base"
            ? "Publish this base for exactly its selected eligible Auth accounts. No notifications are sent."
            : confirmation?.action.startsWith("archive")
              ? "Archive retains history and assignments. A folder with active children cannot be archived."
              : "Restore preserves the prior base state or node status without restoring descendants."}
        </p>
        <div className="kb-dialog-actions">
          <button
            disabled={locked}
            onClick={() => {
              confirmDialog.current?.close();
              setConfirmation(null);
            }}
          >
            Cancel
          </button>
          <button
            className="kb-primary"
            disabled={locked || !confirmation || !baseData}
            onClick={() => {
              if (!confirmation || !baseData) return;
              const action = confirmation.action;
              if (action === "archive_node" || action === "restore_node") {
                if (!confirmation.node) return;
                change({
                  action,
                  baseId: baseData.baseId,
                  revision: baseData.baseRevision,
                  nodeId: confirmation.node.id,
                  nodeRevision: confirmation.node.revision,
                });
              } else
                change({
                  action,
                  baseId: baseData.baseId,
                  revision: baseData.baseRevision,
                });
            }}
          >
            {confirmation ? lifecycleLabel(confirmation.action) : ""}
          </button>
        </div>
      </dialog>
    </div>
  );
}
function chartHeight(value: string, chart: { views: string }[]) {
  const highest = chart.reduce(
    (max, day) => (BigInt(day.views) > max ? BigInt(day.views) : max),
    0n,
  );
  return highest === 0n ? 0 : Number((BigInt(value) * 100n) / highest);
}

function lifecycleLabel(action: NonNullable<Confirmation>["action"]) {
  return {
    publish_base: "Publish base",
    archive_base: "Archive base",
    restore_base: "Restore base",
    archive_node: "Archive resource",
    restore_node: "Restore resource",
  }[action];
}
