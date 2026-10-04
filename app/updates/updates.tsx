"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Company, Member } from "../../lib/agent-types";
import type {
  UpdatePost,
  UpdateComment,
  UpdateRecipient,
  UpdatesData,
  UpdateDetailsData,
  UpdatesRosterData,
  UpdateRecipientsData,
  UpdatesChange,
  UpdatesSaved,
} from "../../lib/updates-types";
import "./updates.css";

type Props = {
  company: Company;
  role: Member["role"];
  initialData: UpdatesData;
};
type Query = {
  view: "feed" | "manage";
  status: "all" | UpdatePost["status"];
  search: string;
};
type Phase = "checking" | "ready" | "reading" | "saving" | "unknown";
type Operation = {
  tenantId: string;
  operationId: string;
  change: UpdatesChange;
};
type Draft = {
  title: string;
  body: string;
  recipients: UpdateRecipient[];
  allowComments: boolean;
  allowReactions: boolean;
  requireConfirmation: boolean;
};
type RecipientStatus =
  "all" | "unviewed" | "viewed" | "unconfirmed" | "confirmed";
const emptyQuery: Query = { view: "feed", status: "all", search: "" };
const emptyDraft: Draft = {
  title: "",
  body: "",
  recipients: [],
  allowComments: true,
  allowReactions: true,
  requireConfirmation: false,
};
const managementActions = new Set<UpdatesChange["action"]>([
  "create",
  "edit",
  "publish",
  "archive",
  "restore",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeCount = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const safeCursor = (value: unknown) =>
  value === null || (typeof value === "string" && value.length > 0);
const maximumRecipientCsvBytes = 1048576;
function safeDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function append<T>(current: T[], next: T[], id: (item: T) => string) {
  const known = new Set(current.map(id));
  return [...current, ...next.filter((item) => !known.has(id(item)))];
}
function validPost(post: UpdatePost, tenantId: string) {
  return (
    post &&
    uuid.test(post.id) &&
    post.tenant_id === tenantId &&
    ["draft", "published", "archived"].includes(post.status) &&
    typeof post.title === "string" &&
    typeof post.body === "string" &&
    Number.isSafeInteger(post.revision) &&
    post.revision >= 1 &&
    safeCount(post.content_revision) &&
    [
      post.recipientCount,
      post.viewedCount,
      post.confirmedCount,
      post.likeCount,
      post.commentCount,
    ].every(safeCount) &&
    post.recipientCount >= 1 &&
    post.recipientCount <= 500 &&
    post.confirmedCount <= post.viewedCount &&
    post.viewedCount <= post.recipientCount &&
    post.likeCount <= post.recipientCount &&
    [
      post.canEdit,
      post.canPublish,
      post.canArchive,
      post.canRestore,
      post.canEngage,
      post.isRecipient,
      post.allowComments,
      post.allowReactions,
      post.requireConfirmation,
      post.liked,
    ].every((value) => typeof value === "boolean")
  );
}
export default function Updates(props: Props) {
  return (
    <UpdatesContent
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}`}
      {...props}
    />
  );
}
function UpdatesContent({ company, initialData }: Props) {
  const [data, setData] = useState<UpdatesData | null>(initialData);
  const [phase, setPhase] = useState<Phase>("checking");
  const [query, setQuery] = useState<Query>(emptyQuery);
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<UpdateDetailsData | null>(null);
  const [analytics, setAnalytics] = useState<{
    post: UpdatePost;
    status: RecipientStatus;
    data: UpdateRecipientsData;
  } | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [writePending, setWritePending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<UpdatePost | null>(null);
  const [roster, setRoster] = useState<UpdateRecipient[]>([]);
  const [rosterCursor, setRosterCursor] = useState<string | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentEditing, setCommentEditing] = useState<UpdateComment | null>(
    null,
  );
  const [commentDraft, setCommentDraft] = useState("");
  const [confirmation, setConfirmation] = useState<
    | { post: UpdatePost; action: "publish" | "archive" | "restore" }
    | { post: UpdatePost; action: "remove_comment"; comment: UpdateComment }
    | null
  >(null);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const writeBusy = useRef<string | null>(null);
  const requests = useRef<
    Record<
      "list" | "detail" | "roster" | "analytics" | "export",
      AbortController | null
    >
  >({ list: null, detail: null, roster: null, analytics: null, export: null });
  const analyticsScope = useRef<{
    postId: string;
    status: RecipientStatus;
    role: Member["role"];
  } | null>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const commentEditor = useRef<HTMLDialogElement>(null);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const detailRegion = useRef<HTMLElement>(null);
  const viewAttempted = useRef<string | null>(null);
  const recoveryAction = useRef<UpdatesChange["action"] | null>(null);
  const storageKey = `ct-alt:updates:${initialData.actorId}:${company.id}`;
  useEffect(() => {
    mounted.current = true;
    let recovery = false;
    try {
      const stored = sessionStorage.getItem(storageKey);
      recovery = stored !== null;
      if (stored) recoveryAction.current = JSON.parse(stored).action;
    } catch {}
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      if (recovery) setData(null);
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
    phase === "saving" ||
    phase === "unknown" ||
    writePending ||
    !data;
  const canSave =
    !locked &&
    !!data?.capabilities.canManage &&
    !!draft.title.trim() &&
    draft.title.length <= 160 &&
    !!draft.body.trim() &&
    draft.body.length <= 5000 &&
    draft.recipients.length > 0 &&
    draft.recipients.length <= 500;
  const formatTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: data?.company.time_zone || company.time_zone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const time = (value: string | null) =>
    value ? formatTime.format(new Date(value)) : "—";
  function invalidate() {
    epoch.current += 1;
    Object.values(requests.current).forEach((controller) =>
      controller?.abort(),
    );
    requests.current = {
      list: null,
      detail: null,
      roster: null,
      analytics: null,
      export: null,
    };
    analyticsScope.current = null;
    setExportBusy(false);
    setExportNotice("");
    setRosterBusy(false);
  }
  function closeEditors() {
    requests.current.roster?.abort();
    requests.current.roster = null;
    setRosterBusy(false);
    editor.current?.close();
    commentEditor.current?.close();
    confirmationDialog.current?.close();
    setDraft(emptyDraft);
    setEditing(null);
    setCommentEditing(null);
    setCommentDraft("");
    setCommentBody("");
    setConfirmation(null);
    setRoster([]);
    setRosterCursor(null);
    setRosterSearch("");
    setRosterQuery("");
  }
  function clearAccess(message: string) {
    invalidate();
    closeEditors();
    setData(null);
    setDetails(null);
    setAnalytics(null);
    setQuery(emptyQuery);
    setSearch("");
    setPhase("unknown");
    setError(message);
    setNotice("");
  }
  function marker(value: Operation) {
    recoveryAction.current = value.change.action;
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
  function finishRecovery() {
    recoveryAction.current = null;
    setOperation(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }
  function startRead(kind: keyof typeof requests.current) {
    if (kind !== "export") cancelExport();
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
  function cancelExport() {
    requests.current.export?.abort();
    requests.current.export = null;
    setExportBusy(false);
    setExportNotice("");
  }
  async function exportRecipients() {
    if (
      !mounted.current ||
      locked ||
      writeBusy.current ||
      requests.current.export ||
      !data?.capabilities.canManage ||
      !["owner", "admin"].includes(data.role) ||
      !analytics ||
      editor.current?.open ||
      commentEditor.current?.open ||
      confirmationDialog.current?.open
    )
      return;
    const scope = {
      companyId: company.id,
      actorId: initialData.actorId,
      role: data.role,
      postId: analytics.post.id,
      status: analytics.status,
    };
    const read = startRead("export");
    const current = () =>
      read.current() &&
      analyticsScope.current?.postId === scope.postId &&
      analyticsScope.current.status === scope.status &&
      analyticsScope.current.role === scope.role;
    setExportBusy(true);
    setExportNotice("");
    setError("");
    const params = new URLSearchParams({
      tenantId: scope.companyId,
      status: scope.status,
    });
    try {
      const response = await fetch(
        `/api/updates/${scope.postId}/recipients/export?${params}`,
        {
          cache: "no-store",
          signal: read.controller.signal,
        },
      );
      if (!current()) return;
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your Updates export access could not be verified. Refresh to check your current access."
            : "Recipient CSV could not be exported. Changes remain locked until a successful refresh.",
        );
      const filename = `updates-${scope.postId}-recipients.csv`;
      const validHeaders = () =>
        response.headers.get("X-CT-Alt-Actor-ID") === scope.actorId &&
        response.headers.get("X-CT-Alt-Company-ID") === scope.companyId &&
        response.headers.get("X-CT-Alt-Update-ID") === scope.postId &&
        response.headers.get("X-CT-Alt-Recipient-Status") === scope.status &&
        response.headers.get("X-CT-Alt-Role") === scope.role &&
        /^text\/csv\s*;\s*charset=utf-8$/i.test(
          response.headers.get("Content-Type") || "",
        ) &&
        response.headers.get("Content-Disposition") ===
          `attachment; filename="${filename}"`;
      const size = response.headers.get("Content-Length");
      if (
        !validHeaders() ||
        (size !== null &&
          (!/^\d+$/.test(size) || Number(size) > maximumRecipientCsvBytes))
      )
        throw new Error(
          "The recipient CSV response could not be verified. Refresh to recover.",
        );
      const blob = await response.blob();
      if (!current()) return;
      if (!validHeaders() || !blob.size || blob.size > maximumRecipientCsvBytes)
        throw new Error(
          "The recipient CSV response could not be verified. Refresh to recover.",
        );
      safeDownload(blob, filename);
      setExportNotice(
        "Recipient CSV download started for every user matching the selected status.",
      );
    } catch (cause) {
      if (current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Recipient CSV could not be exported. Refresh to recover.",
        );
    } finally {
      if (current()) {
        requests.current.export = null;
        setExportBusy(false);
      }
    }
  }
  async function get<T>(url: string, controller: AbortController): Promise<T> {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Your Updates access could not be verified. Refresh to check your current access."
          : "Updates could not be loaded. Changes remain locked until a successful refresh.",
      );
    return response.json() as Promise<T>;
  }
  async function readList(
    nextQuery: Query | null = query,
    cursor: string | null = null,
    acknowledgedId?: string,
  ) {
    if (
      !mounted.current ||
      (writeBusy.current && writeBusy.current !== acknowledgedId)
    )
      return false;
    invalidate();
    setDetails(null);
    setAnalytics(null);
    setCommentBody("");
    const read = startRead("list");
    setPhase("reading");
    setError("");
    setNotice("");
    const applied: Query =
      nextQuery ||
      (recoveryAction.current && managementActions.has(recoveryAction.current)
        ? { view: "manage", status: "all", search: "" }
        : emptyQuery);
    setQuery(applied);
    setSearch(applied.search);
    if (!cursor)
      setData((current) =>
        current ? { ...current, posts: [], nextCursor: null } : null,
      );
    const params = new URLSearchParams({
      tenantId: company.id,
      view: applied.view,
      status: applied.status,
      limit: "50",
    });
    if (applied.search) params.set("search", applied.search);
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await get<UpdatesData>(
        `/api/updates?${params}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (
        !next ||
        next.company?.id !== company.id ||
        next.actorId !== initialData.actorId ||
        !Array.isArray(next.posts) ||
        next.posts.some((post) => !validPost(post, company.id)) ||
        !next.counts ||
        ![
          next.counts.total,
          next.counts.draft,
          next.counts.published,
          next.counts.archived,
        ].every(safeCount) ||
        typeof next.capabilities?.canManage !== "boolean" ||
        !safeCursor(next.nextCursor)
      )
        throw new Error(
          "The Updates response could not be verified. Refresh to recover.",
        );
      const sameScope =
        next.role === data?.role &&
        next.company.time_zone === data?.company.time_zone;
      if (!sameScope) closeEditors();
      setData((current) => ({
        ...next,
        posts:
          cursor && sameScope && current
            ? append(current.posts, next.posts, (post) => post.id)
            : next.posts,
      }));
      setPhase("ready");
      if (!acknowledgedId) finishRecovery();
      return next;
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Updates could not be loaded. Refresh to recover.",
        );
      return false;
    }
  }
  async function readDetails(
    postId: string,
    cursor: string | null = null,
    acknowledgedId?: string,
  ) {
    if (
      !mounted.current ||
      (writeBusy.current && writeBusy.current !== acknowledgedId)
    )
      return false;
    requests.current.analytics?.abort();
    requests.current.analytics = null;
    analyticsScope.current = null;
    setAnalytics(null);
    const read = startRead("detail");
    setPhase("reading");
    setError("");
    if (!cursor) {
      setDetails(null);
      setCommentBody("");
    }
    const params = new URLSearchParams({ tenantId: company.id, limit: "50" });
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await get<UpdateDetailsData>(
        `/api/updates/${encodeURIComponent(postId)}?${params}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (
        !next ||
        next.tenantId !== company.id ||
        next.actorId !== initialData.actorId ||
        next.role !== data?.role ||
        !validPost(next.post, company.id) ||
        next.post.id !== postId ||
        !Array.isArray(next.comments) ||
        !Array.isArray(next.recipients) ||
        !safeCursor(next.nextCommentsCursor) ||
        next.comments.some(
          (comment) =>
            comment.post_id !== postId ||
            !uuid.test(comment.id) ||
            !Number.isSafeInteger(comment.revision) ||
            comment.revision < 1 ||
            typeof comment.body !== "string" ||
            typeof comment.canEdit !== "boolean" ||
            typeof comment.canRemove !== "boolean",
        )
      ) {
        throw new Error(
          "The update details could not be verified. Refresh to recover.",
        );
      }
      setDetails((current) => ({
        ...next,
        comments:
          cursor &&
          current?.post.id === postId &&
          current.post.content_revision === next.post.content_revision
            ? append(current.comments, next.comments, (comment) => comment.id)
            : next.comments,
      }));
      setPhase("ready");
      return next;
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Update details could not be loaded. Refresh to recover.",
        );
      return false;
    }
  }
  async function readRoster(searchValue: string, cursor: string | null = null) {
    if (writeBusy.current || !mounted.current || !data?.capabilities.canManage)
      return;
    const read = startRead("roster");
    setRosterBusy(true);
    setRosterQuery(searchValue);
    setError("");
    if (!cursor) setRoster([]);
    const params = new URLSearchParams({
      tenantId: company.id,
      search: searchValue,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await get<UpdatesRosterData>(
        `/api/updates/roster?${params}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !next ||
        next.tenantId !== company.id ||
        next.actorId !== initialData.actorId ||
        next.role !== data?.role ||
        !Array.isArray(next.users) ||
        !safeCursor(next.nextCursor) ||
        next.users.some(
          (user) => !uuid.test(user.id) || typeof user.name !== "string",
        )
      )
        throw new Error(
          "The recipient list could not be verified. Refresh to recover.",
        );
      setRoster((current) =>
        cursor ? append(current, next.users, (user) => user.id) : next.users,
      );
      setRosterCursor(next.nextCursor);
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Recipients could not be loaded. Refresh to recover.",
        );
    } finally {
      if (read.current()) setRosterBusy(false);
    }
  }
  async function readAnalytics(
    post: UpdatePost,
    status: RecipientStatus = "all",
    cursor: string | null = null,
  ) {
    if (writeBusy.current || !mounted.current || !data?.capabilities.canManage)
      return;
    analyticsScope.current = null;
    requests.current.detail?.abort();
    requests.current.detail = null;
    setDetails(null);
    setCommentBody("");
    const read = startRead("analytics");
    setPhase("reading");
    setError("");
    if (!cursor) setAnalytics(null);
    const params = new URLSearchParams({
      tenantId: company.id,
      status,
      limit: "50",
    });
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await get<UpdateRecipientsData>(
        `/api/updates/${post.id}/recipients?${params}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !next ||
        next.tenantId !== company.id ||
        next.actorId !== initialData.actorId ||
        next.role !== data?.role ||
        !next.counts ||
        ![
          next.counts.total,
          next.counts.viewed,
          next.counts.confirmed,
          next.counts.likes,
          next.counts.comments,
        ].every(safeCount) ||
        !Array.isArray(next.recipients) ||
        !safeCursor(next.nextCursor) ||
        next.recipients.some(
          (user) => !uuid.test(user.actorId) || typeof user.name !== "string",
        )
      )
        throw new Error(
          "Recipient statuses could not be verified. Refresh to recover.",
        );
      analyticsScope.current = { postId: post.id, status, role: next.role };
      setAnalytics((current) => ({
        post,
        status,
        data: {
          ...next,
          recipients:
            cursor && current?.post.id === post.id && current.status === status
              ? append(
                  current.data.recipients,
                  next.recipients,
                  (user) => user.actorId,
                )
              : next.recipients,
        },
      }));
      setPhase("ready");
    } catch (cause) {
      if (read.current())
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "Recipient statuses could not be loaded. Refresh to recover.",
        );
    }
  }
  function validSaved(
    saved: UpdatesSaved,
    change: UpdatesChange,
    operationId: string,
  ) {
    if (
      !saved ||
      saved.operationId !== operationId ||
      saved.action !== change.action ||
      !uuid.test(saved.postId) ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 1 ||
      !safeCount(saved.contentRevision)
    )
      return false;
    if ("postId" in change && saved.postId !== change.postId) return false;
    if (change.action === "create")
      return saved.revision === 1 && saved.contentRevision === 0;
    if (change.action === "edit")
      return (
        saved.revision === change.revision + 1 && saved.contentRevision === 0
      );
    if (change.action === "publish")
      return (
        saved.revision === change.revision + 1 && saved.contentRevision === 1
      );
    if (change.action === "archive" || change.action === "restore")
      return (
        saved.revision === change.revision + 1 && saved.contentRevision === 1
      );
    if (
      !("contentRevision" in change) ||
      saved.contentRevision !== change.contentRevision
    )
      return false;
    if (change.action === "comment")
      return (
        !!saved.commentId &&
        uuid.test(saved.commentId) &&
        saved.commentRevision === 1
      );
    if (change.action === "edit_comment" || change.action === "remove_comment")
      return (
        saved.commentId === change.commentId &&
        saved.commentRevision === change.revision + 1
      );
    return true;
  }
  async function perform(value: Operation) {
    if (!mounted.current || writeBusy.current) return;
    const openPost = details?.post.id;
    writeBusy.current = value.operationId;
    setWritePending(true);
    invalidate();
    marker(value);
    setOperation(value);
    setPhase("saving");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        keepalive: true,
      });
      if (!mounted.current) return;
      if (!response.ok) {
        let message =
          "The action was not acknowledged. Refresh before making another change.";
        try {
          const result = await response.json();
          if (typeof result?.error === "string") message = result.error;
        } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      if (!mounted.current) return;
      if (!validSaved(result?.saved, value.change, value.operationId))
        throw new Error(
          "The action could not be confirmed. Refresh to recover before another change.",
        );
      const nextQuery: Query = managementActions.has(value.change.action)
        ? { view: "manage", status: "all", search: "" }
        : query;
      const next = await readList(nextQuery, null, value.operationId);
      if (!next || !mounted.current) return;
      if (
        openPost &&
        openPost === result.saved.postId &&
        value.change.action !== "archive"
      ) {
        if (!(await readDetails(openPost, null, value.operationId))) return;
      }
      finishRecovery();
      if (mounted.current)
        setNotice(
          value.change.action === "view"
            ? "Viewed status recorded. Confirmation is separate."
            : "Update saved.",
        );
    } catch (cause) {
      if (mounted.current)
        clearAccess(
          cause instanceof Error
            ? cause.message
            : "The response was interrupted. The action may have saved. Refresh to recover.",
        );
    } finally {
      writeBusy.current = null;
      if (mounted.current) setWritePending(false);
    }
  }
  function change(value: UpdatesChange) {
    if (locked || writeBusy.current) return;
    void perform({
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change: value,
    });
  }
  const trackView = useEffectEvent((post: UpdatePost) => {
    const key = `${post.id}:${post.content_revision}`;
    if (
      !detailRegion.current?.isConnected ||
      locked ||
      viewAttempted.current === key
    )
      return;
    viewAttempted.current = key;
    change({
      action: "view",
      postId: post.id,
      contentRevision: post.content_revision,
    });
  });
  useEffect(() => {
    if (
      phase !== "ready" ||
      writePending ||
      !details?.post.canEngage ||
      !details.post.isRecipient ||
      details.post.viewedAt
    )
      return;
    const post = details.post;
    const timer = setTimeout(() => trackView(post), 0);
    return () => clearTimeout(timer);
  }, [details, phase, writePending]);
  function closeDetail() {
    if (writeBusy.current) return;
    cancelExport();
    requests.current.detail?.abort();
    requests.current.detail = null;
    setDetails(null);
    setCommentBody("");
    setPhase("ready");
  }
  async function openEditor(post: UpdatePost | null = null) {
    if (locked || !data?.capabilities.canManage || (post && !post.canEdit))
      return;
    let recipients: UpdateRecipient[] = [];
    if (post) {
      const next = await readDetails(post.id);
      if (!next || !mounted.current || !next.post.canEdit) return;
      post = next.post;
      recipients = next.recipients;
    }
    setEditing(post);
    setDraft(
      post
        ? {
            title: post.title,
            body: post.body,
            recipients,
            allowComments: post.allowComments,
            allowReactions: post.allowReactions,
            requireConfirmation: post.requireConfirmation,
          }
        : emptyDraft,
    );
    setRosterSearch("");
    setRosterQuery("");
    setRoster([]);
    setRosterCursor(null);
    editor.current?.showModal();
    void readRoster("");
  }
  function saveDraft() {
    if (!canSave) return;
    const fields = {
      title: draft.title.trim(),
      body: draft.body,
      recipientIds: draft.recipients.map((user) => user.id),
      allowComments: draft.allowComments,
      allowReactions: draft.allowReactions,
      requireConfirmation: draft.requireConfirmation,
    };
    editor.current?.close();
    requests.current.roster?.abort();
    requests.current.roster = null;
    setDraft(emptyDraft);
    setRoster([]);
    change(
      editing
        ? {
            action: "edit",
            postId: editing.id,
            revision: editing.revision,
            ...fields,
          }
        : { action: "create", ...fields },
    );
    setEditing(null);
  }
  function showConfirmation(value: NonNullable<typeof confirmation>) {
    if (locked) return;
    setConfirmation(value);
    confirmationDialog.current?.showModal();
  }
  const selected = details?.post;
  return (
    <div
      className="updates-page"
      aria-busy={phase === "saving" || phase === "reading"}
    >
      <header className="updates-heading">
        <div>
          <h1>Updates</h1>
          <p>Share company news and keep your team informed</p>
        </div>
        <div className="updates-heading-actions">
          <button
            disabled={writePending || phase === "checking"}
            onClick={() => void readList(phase === "unknown" ? null : query)}
          >
            Refresh Updates
          </button>
          {data?.capabilities.canManage && (
            <button
              className="updates-primary"
              disabled={locked}
              onClick={() => void openEditor()}
            >
              Add update
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="updates-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="updates-notice" role="status">
          {notice}
        </p>
      )}
      {phase === "unknown" && (
        <section className="updates-recovery" aria-label="Updates recovery">
          <h2>Review Updates before another change</h2>
          <p>
            The last action may have saved. Changes stay locked until a
            successful fresh read. Update content and comments are not stored
            for recovery.
          </p>
          <div>
            <button disabled={writePending} onClick={() => void readList(null)}>
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
      {data && (
        <section className="updates-feature">
          <nav className="updates-tabs" aria-label="Updates views">
            <button
              aria-current={query.view === "feed" ? "page" : undefined}
              disabled={filterLocked}
              onClick={() => void readList(emptyQuery)}
            >
              My feed
            </button>
            {data.capabilities.canManage && (
              <button
                aria-current={query.view === "manage" ? "page" : undefined}
                disabled={filterLocked}
                onClick={() =>
                  void readList({ view: "manage", status: "all", search: "" })
                }
              >
                Manage updates
              </button>
            )}
          </nav>
          <div className="updates-content">
            {query.view === "manage" && (
              <div className="updates-counts" aria-label="Update status counts">
                {(["total", "draft", "published", "archived"] as const).map(
                  (status) => (
                    <button
                      key={status}
                      disabled={filterLocked}
                      aria-pressed={
                        query.status === (status === "total" ? "all" : status)
                      }
                      onClick={() =>
                        void readList({
                          ...query,
                          status: status === "total" ? "all" : status,
                        })
                      }
                    >
                      <span>
                        {status === "total"
                          ? "All updates"
                          : status[0].toUpperCase() + status.slice(1)}
                      </span>
                      <strong>{data.counts[status]}</strong>
                    </button>
                  ),
                )}
              </div>
            )}
            <form
              className="updates-filters"
              onSubmit={(event) => {
                event.preventDefault();
                if (!filterLocked && search.length <= 100)
                  void readList({ ...query, search: search.trim() });
              }}
            >
              <label>
                Search update titles
                <input
                  type="search"
                  maxLength={100}
                  value={search}
                  disabled={filterLocked}
                  placeholder="Search titles"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {query.view === "manage" && (
                <label>
                  Update status
                  <select
                    aria-label="Update status"
                    value={query.status}
                    disabled={filterLocked}
                    onChange={(event) =>
                      void readList({
                        ...query,
                        status: event.target.value as Query["status"],
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
              <button disabled={filterLocked || search.length > 100}>
                Search titles
              </button>
              <button
                type="button"
                disabled={filterLocked}
                onClick={() =>
                  void readList({ ...query, status: "all", search: "" })
                }
              >
                Clear filters
              </button>
            </form>
            {phase === "reading" && <p role="status">Loading Updates…</p>}
            <div
              className={`updates-layout${details || analytics ? " has-detail" : ""}`}
            >
              <div
                className="updates-list"
                aria-label={
                  query.view === "feed" ? "My update feed" : "Managed updates"
                }
              >
                {data.posts.map((post) => (
                  <article className="update-card" key={post.id}>
                    <div className="update-card-top">
                      <span className={`update-status ${post.status}`}>
                        {post.status}
                      </span>
                      <small>
                        {time(post.published_at || post.created_at)}
                      </small>
                    </div>
                    <h2>{post.title}</h2>
                    <p className="update-preview">{post.body}</p>
                    <p className="update-author">{post.created_name}</p>
                    <div className="update-summary">
                      <span>{post.likeCount} likes</span>
                      <span>{post.commentCount} comments</span>
                      {post.requireConfirmation && (
                        <span>
                          {post.confirmedAt
                            ? "Read confirmed"
                            : "Read confirmation requested"}
                        </span>
                      )}
                    </div>
                    <div className="update-card-actions">
                      <button
                        aria-label={`Open update ${post.title}`}
                        disabled={locked}
                        onClick={() => void readDetails(post.id)}
                      >
                        Open update
                      </button>
                      {post.canEdit && (
                        <button
                          aria-label={`Edit draft ${post.title}`}
                          disabled={locked}
                          onClick={() => void openEditor(post)}
                        >
                          Edit draft
                        </button>
                      )}
                      {data.capabilities.canManage && (
                        <button
                          aria-label={`Recipient statuses for ${post.title}`}
                          disabled={locked}
                          onClick={() => void readAnalytics(post)}
                        >
                          Recipient statuses
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {phase === "ready" && !data.posts.length && (
                  <p className="updates-empty">
                    {query.view === "feed"
                      ? "No published updates match your feed filters."
                      : "No updates match these filters."}
                  </p>
                )}
                <p className="updates-page-count">
                  {data.posts.length} shown ·{" "}
                  {query.status === "all"
                    ? data.counts.total
                    : data.counts[query.status]}{" "}
                  matching updates. Status totals share the title-search scope.
                </p>
                {data.nextCursor && (
                  <button
                    disabled={locked}
                    onClick={() => void readList(query, data.nextCursor)}
                  >
                    Load older updates
                  </button>
                )}
              </div>
              {details && selected && (
                <section
                  className="update-detail"
                  aria-label="Update details"
                  ref={detailRegion}
                >
                  <div className="update-detail-heading">
                    <span className={`update-status ${selected.status}`}>
                      {selected.status}
                    </span>
                    <button
                      aria-label="Close update details"
                      disabled={writePending}
                      onClick={closeDetail}
                    >
                      ×
                    </button>
                  </div>
                  <h2>{selected.title}</h2>
                  <p className="update-author">
                    {selected.created_name} ·{" "}
                    {time(selected.published_at || selected.created_at)}
                  </p>
                  <p className="update-body">{selected.body}</p>
                  {selected.status === "draft" && (
                    <p className="updates-hint">
                      Draft content is visible to company administrators.
                      Publishing fixes the content and selected-user audience.
                    </p>
                  )}
                  {selected.status !== "draft" && (
                    <p className="updates-hint">
                      Published content and recipients are fixed. Viewed status
                      and explicit read confirmation are separate.
                    </p>
                  )}
                  <div className="update-detail-actions">
                    {selected.canEdit && (
                      <button
                        disabled={locked}
                        onClick={() => void openEditor(selected)}
                      >
                        Edit draft
                      </button>
                    )}
                    {selected.canPublish && (
                      <button
                        className="updates-primary"
                        disabled={locked}
                        onClick={() =>
                          showConfirmation({
                            post: selected,
                            action: "publish",
                          })
                        }
                      >
                        Publish update
                      </button>
                    )}
                    {selected.canArchive && (
                      <button
                        disabled={locked}
                        onClick={() =>
                          showConfirmation({
                            post: selected,
                            action: "archive",
                          })
                        }
                      >
                        Archive update
                      </button>
                    )}
                    {selected.canRestore && (
                      <button
                        disabled={locked}
                        onClick={() =>
                          showConfirmation({
                            post: selected,
                            action: "restore",
                          })
                        }
                      >
                        Restore update
                      </button>
                    )}
                  </div>
                  {selected.isRecipient && selected.status === "published" && (
                    <div
                      className="update-engagement"
                      aria-label="Recipient engagement"
                    >
                      <p>
                        {selected.viewedAt
                          ? `Viewed ${time(selected.viewedAt)}`
                          : "Recording viewed status when this update opens…"}
                      </p>
                      {selected.allowReactions ? (
                        <button
                          disabled={locked || !selected.canEngage}
                          aria-label={
                            selected.liked ? "Unlike update" : "Like update"
                          }
                          aria-pressed={selected.liked}
                          onClick={() =>
                            change({
                              action: selected.liked ? "unlike" : "like",
                              postId: selected.id,
                              contentRevision: selected.content_revision,
                            })
                          }
                        >
                          {selected.liked ? "Unlike" : "Like"} ·{" "}
                          {selected.likeCount}
                        </button>
                      ) : (
                        <p>Likes are disabled for this update.</p>
                      )}
                      {selected.requireConfirmation &&
                        (selected.confirmedAt ? (
                          <p className="update-confirmed">
                            Read confirmed {time(selected.confirmedAt)}
                          </p>
                        ) : (
                          <button
                            className="updates-primary"
                            disabled={locked || !selected.canEngage}
                            onClick={() =>
                              change({
                                action: "confirm",
                                postId: selected.id,
                                contentRevision: selected.content_revision,
                              })
                            }
                          >
                            Confirm read
                          </button>
                        ))}
                    </div>
                  )}
                  {!selected.isRecipient && (
                    <p className="updates-hint">
                      Management access does not add you to this update’s
                      audience. Recipient engagement is unavailable.
                    </p>
                  )}
                  {data.capabilities.canManage && (
                    <div className="update-audience">
                      <h3>Fixed selected users</h3>
                      <p>
                        {selected.recipientCount} recipients ·{" "}
                        {selected.viewedCount} viewed ·{" "}
                        {selected.confirmedCount} confirmed
                      </p>
                      {details.recipients.length > 0 && (
                        <p>
                          {details.recipients
                            .map((user) => user.name)
                            .join(", ")}
                        </p>
                      )}
                      <button
                        disabled={locked}
                        onClick={() => void readAnalytics(selected)}
                      >
                        View recipient statuses
                      </button>
                    </div>
                  )}
                  {selected.isRecipient && selected.status === "published" && (
                    <section
                      className="update-comments"
                      aria-label="Update comments"
                    >
                      <h3>Comments · {selected.commentCount}</h3>
                      {!selected.allowComments && (
                        <p>Comments are disabled for this update.</p>
                      )}
                      {details.comments.map((comment) => (
                        <article key={comment.id} className="update-comment">
                          <div>
                            <strong>{comment.author_name}</strong>
                            <small>{time(comment.created_at)}</small>
                          </div>
                          <p>
                            {comment.status === "removed"
                              ? "Comment removed"
                              : comment.body}
                          </p>
                          {comment.status === "active" && (
                            <div>
                              {comment.canEdit && (
                                <button
                                  disabled={locked}
                                  aria-label={`Edit comment by ${comment.author_name}`}
                                  onClick={() => {
                                    setCommentEditing(comment);
                                    setCommentDraft(comment.body);
                                    commentEditor.current?.showModal();
                                  }}
                                >
                                  Edit comment
                                </button>
                              )}
                              {comment.canRemove && (
                                <button
                                  disabled={locked}
                                  aria-label={`Remove comment by ${comment.author_name}`}
                                  onClick={() =>
                                    showConfirmation({
                                      post: selected,
                                      action: "remove_comment",
                                      comment,
                                    })
                                  }
                                >
                                  Remove comment
                                </button>
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                      {details.nextCommentsCursor && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            void readDetails(
                              selected.id,
                              details.nextCommentsCursor,
                            )
                          }
                        >
                          Load older comments
                        </button>
                      )}
                      {selected.allowComments && (
                        <form
                          className="update-comment-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (
                              !locked &&
                              selected.canEngage &&
                              commentBody.trim() &&
                              commentBody.length <= 2000
                            ) {
                              const body = commentBody;
                              setCommentBody("");
                              change({
                                action: "comment",
                                postId: selected.id,
                                contentRevision: selected.content_revision,
                                body,
                              });
                            }
                          }}
                        >
                          <label>
                            Add a comment
                            <textarea
                              value={commentBody}
                              maxLength={2000}
                              disabled={locked || !selected.canEngage}
                              onChange={(event) =>
                                setCommentBody(event.target.value)
                              }
                            />
                          </label>
                          <button
                            className="updates-primary"
                            disabled={
                              locked ||
                              !selected.canEngage ||
                              !commentBody.trim() ||
                              commentBody.length > 2000
                            }
                          >
                            Post comment
                          </button>
                        </form>
                      )}
                    </section>
                  )}
                </section>
              )}
              {analytics && (
                <section
                  className="update-analytics"
                  aria-label="Recipient statuses"
                >
                  <div className="update-detail-heading">
                    <h2>Recipient statuses</h2>
                    <button
                      aria-label="Close recipient statuses"
                      disabled={writePending}
                      onClick={() => {
                        cancelExport();
                        analyticsScope.current = null;
                        requests.current.analytics?.abort();
                        requests.current.analytics = null;
                        setAnalytics(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <h3>{analytics.post.title}</h3>
                  <div className="update-analytics-counts">
                    <span>
                      <strong>{analytics.data.counts.total}</strong> recipients
                    </span>
                    <span>
                      <strong>{analytics.data.counts.viewed}</strong> viewed
                    </span>
                    <span>
                      <strong>{analytics.data.counts.confirmed}</strong>{" "}
                      confirmed
                    </span>
                    <span>
                      <strong>{analytics.data.counts.likes}</strong> likes
                    </span>
                    <span>
                      <strong>{analytics.data.counts.comments}</strong> comments
                    </span>
                  </div>
                  <p className="updates-hint">
                    Viewed means opened. Confirmed means the recipient
                    explicitly confirmed this published content. These are
                    separate statuses.
                  </p>
                  <div className="updates-recipient-export">
                    <p className="updates-hint">
                      Export every recipient matching the selected status,
                      including users beyond the displayed page.
                    </p>
                    <button
                      className="updates-primary"
                      aria-label="Export recipients"
                      disabled={
                        locked || exportBusy || !data.capabilities.canManage
                      }
                      onClick={() => void exportRecipients()}
                    >
                      {exportBusy
                        ? "Exporting recipients…"
                        : "Export recipients"}
                    </button>
                    {exportBusy && (
                      <p role="status">Preparing recipient CSV…</p>
                    )}
                    {exportNotice && <p role="status">{exportNotice}</p>}
                  </div>
                  <label>
                    Recipient status
                    <select
                      aria-label="Recipient status"
                      value={analytics.status}
                      disabled={filterLocked}
                      onChange={(event) =>
                        void readAnalytics(
                          analytics.post,
                          event.target.value as RecipientStatus,
                        )
                      }
                    >
                      <option value="all">All recipients</option>
                      <option value="unviewed">Not viewed</option>
                      <option value="viewed">Viewed</option>
                      <option value="unconfirmed">Not confirmed</option>
                      <option value="confirmed">Confirmed</option>
                    </select>
                  </label>
                  <div className="update-recipient-table">
                    <table>
                      <caption className="updates-sr-only">
                        Update recipient viewed and confirmed statuses
                      </caption>
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Viewed</th>
                          <th>Confirmed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.data.recipients.map((user) => (
                          <tr key={user.actorId}>
                            <td>{user.name}</td>
                            <td>
                              {user.viewedAt
                                ? time(user.viewedAt)
                                : "Not viewed"}
                            </td>
                            <td>
                              {user.confirmedAt
                                ? time(user.confirmedAt)
                                : "Not confirmed"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    {analytics.data.recipients.length} recipient statuses shown.
                  </p>
                  {analytics.data.nextCursor && (
                    <button
                      disabled={locked}
                      onClick={() =>
                        void readAnalytics(
                          analytics.post,
                          analytics.status,
                          analytics.data.nextCursor,
                        )
                      }
                    >
                      Load more recipient statuses
                    </button>
                  )}
                </section>
              )}
            </div>
          </div>
        </section>
      )}
      <dialog
        ref={editor}
        className="updates-editor"
        aria-labelledby="updates-editor-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else closeEditors();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveDraft();
          }}
        >
          <div className="updates-dialog-heading">
            <h2 id="updates-editor-title">
              {editing ? "Edit update draft" : "Add update"}
            </h2>
            <button
              type="button"
              aria-label="Close update editor"
              disabled={locked}
              onClick={closeEditors}
            >
              ×
            </button>
          </div>
          <label>
            Update title
            <input
              value={draft.title}
              maxLength={160}
              disabled={locked}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              required
            />
          </label>
          <label>
            Update message
            <textarea
              value={draft.body}
              maxLength={5000}
              disabled={locked}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  body: event.target.value,
                }))
              }
              required
            />
          </label>
          <fieldset disabled={locked}>
            <legend>
              Fixed selected users · {draft.recipients.length}/500
            </legend>
            <p className="updates-hint">
              Choose up to 500 specific current company users. This audience
              will be fixed when published.
            </p>
            {draft.recipients.length > 0 && (
              <ul
                className="updates-selected-users"
                aria-label="Selected update recipients"
              >
                {draft.recipients.map((user) => (
                  <li key={user.id}>
                    {user.name}
                    <button
                      type="button"
                      aria-label={`Remove recipient ${user.name}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          recipients: current.recipients.filter(
                            (item) => item.id !== user.id,
                          ),
                        }))
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="updates-roster-search">
              <label>
                Search company users
                <input
                  type="search"
                  value={rosterSearch}
                  maxLength={100}
                  onChange={(event) => setRosterSearch(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => void readRoster(rosterSearch.trim())}
              >
                Search recipients
              </button>
              <button
                type="button"
                onClick={() => {
                  setRosterSearch("");
                  void readRoster("");
                }}
              >
                Clear recipient search
              </button>
            </div>
            {rosterBusy && <p role="status">Loading company users…</p>}
            <div
              className="updates-roster"
              aria-label="Available update recipients"
            >
              {roster.map((user) => (
                <label key={user.id}>
                  <input
                    type="checkbox"
                    checked={draft.recipients.some(
                      (item) => item.id === user.id,
                    )}
                    disabled={
                      !draft.recipients.some((item) => item.id === user.id) &&
                      draft.recipients.length >= 500
                    }
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        recipients: event.target.checked
                          ? append(
                              current.recipients,
                              [user],
                              (item) => item.id,
                            )
                          : current.recipients.filter(
                              (item) => item.id !== user.id,
                            ),
                      }))
                    }
                  />
                  {user.name}
                </label>
              ))}
            </div>
            {!rosterBusy && !roster.length && (
              <p>No company users match this search.</p>
            )}
            {rosterCursor && (
              <button
                type="button"
                disabled={rosterBusy}
                onClick={() => void readRoster(rosterQuery, rosterCursor)}
              >
                Load more company users
              </button>
            )}
          </fieldset>
          <fieldset disabled={locked}>
            <legend>Recipient engagement</legend>
            <label className="updates-check">
              <input
                type="checkbox"
                checked={draft.allowReactions}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    allowReactions: event.target.checked,
                  }))
                }
              />
              Allow likes
            </label>
            <label className="updates-check">
              <input
                type="checkbox"
                checked={draft.allowComments}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    allowComments: event.target.checked,
                  }))
                }
              />
              Allow comments
            </label>
            <label className="updates-check">
              <input
                type="checkbox"
                checked={draft.requireConfirmation}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    requireConfirmation: event.target.checked,
                  }))
                }
              />
              Request explicit read confirmation
            </label>
            <p className="updates-hint">
              Confirmation is available inside the update. It does not display a
              global pop-up or send notifications.
            </p>
          </fieldset>
          <div className="updates-dialog-actions">
            <button type="button" disabled={locked} onClick={closeEditors}>
              Cancel
            </button>
            <button className="updates-primary" disabled={!canSave}>
              Save draft
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={commentEditor}
        className="updates-dialog"
        aria-labelledby="updates-comment-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else {
            setCommentEditing(null);
            setCommentDraft("");
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              locked ||
              !selected ||
              !commentEditing?.canEdit ||
              !commentDraft.trim() ||
              commentDraft.length > 2000
            )
              return;
            const value: UpdatesChange = {
              action: "edit_comment",
              postId: selected.id,
              contentRevision: selected.content_revision,
              commentId: commentEditing.id,
              revision: commentEditing.revision,
              body: commentDraft,
            };
            commentEditor.current?.close();
            setCommentDraft("");
            setCommentEditing(null);
            change(value);
          }}
        >
          <h2 id="updates-comment-title">Edit comment</h2>
          <label>
            Comment text
            <textarea
              value={commentDraft}
              maxLength={2000}
              disabled={locked}
              onChange={(event) => setCommentDraft(event.target.value)}
            />
          </label>
          <div className="updates-dialog-actions">
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                commentEditor.current?.close();
                setCommentEditing(null);
                setCommentDraft("");
              }}
            >
              Cancel
            </button>
            <button
              className="updates-primary"
              disabled={
                locked || !commentDraft.trim() || commentDraft.length > 2000
              }
            >
              Save comment
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={confirmationDialog}
        className="updates-dialog"
        aria-labelledby="updates-confirm-title"
        onCancel={(event) => {
          if (writeBusy.current) event.preventDefault();
          else setConfirmation(null);
        }}
      >
        <h2 id="updates-confirm-title">
          {confirmation?.action === "remove_comment"
            ? "Remove comment?"
            : confirmation?.action === "publish"
              ? "Publish update?"
              : confirmation?.action === "archive"
                ? "Archive update?"
                : "Restore update?"}
        </h2>
        <p>
          {confirmation?.action === "publish"
            ? "Publishing shares this update with its fixed selected users. Published text, settings and recipients cannot be edited."
            : confirmation?.action === "archive"
              ? "Archiving removes this update from recipient feeds and stops new engagement. Its history is retained."
              : confirmation?.action === "restore"
                ? "Restore the same published content and fixed audience to recipient feeds."
                : "The comment will be removed from the thread. Its removal is retained in history."}
        </p>
        <div className="updates-dialog-actions">
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
            className="updates-primary"
            disabled={locked}
            onClick={() => {
              if (!confirmation || locked) return;
              const { post, action } = confirmation;
              confirmationDialog.current?.close();
              setConfirmation(null);
              if (action === "remove_comment")
                change({
                  action,
                  postId: post.id,
                  contentRevision: post.content_revision,
                  commentId: confirmation.comment.id,
                  revision: confirmation.comment.revision,
                });
              else change({ action, postId: post.id, revision: post.revision });
            }}
          >
            {confirmation?.action === "remove_comment"
              ? "Remove comment"
              : confirmation?.action === "publish"
                ? "Publish update"
                : confirmation?.action === "archive"
                  ? "Archive update"
                  : "Restore update"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
