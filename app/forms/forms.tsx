"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Company, Member } from "../../lib/agent-types";
import type {
  FormsAnswers,
  FormsAssignee,
  FormsChange,
  FormsData,
  FormsField,
  FormsForm,
  FormsFormData,
  FormsIdentity,
  FormsReconciliation,
  FormsResponseData,
  FormsResponsesData,
  FormsRosterData,
  FormsSaved,
  FormsView,
} from "../../lib/forms-types";
import "./forms.css";

type Props = { company: Company; role: Member["role"]; initialData: FormsData };
type Marker = { action: FormsChange["action"]; operationId: string };
type Phase = "ready" | "saving" | "unknown" | "denied" | "conflict";
const actions = [
  "create_form",
  "edit_form",
  "set_audience",
  "publish_form",
  "archive_form",
  "restore_form",
  "save_progress",
  "submit_response",
  "edit_response",
  "admin_edit_response",
  "review_response",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rev = (value: unknown) =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const legal = (value: string) =>
  !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );
const string = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max && legal(value);
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const clone = <T,>(value: T): T => structuredClone(value);
const timestamp = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const nextPage = (value: unknown) =>
  value === null || (typeof value === "string" && value.length > 0);
function validSchema(fields: FormsField[]) {
  if (!Array.isArray(fields) || fields.length > 50 || bytes(fields) > 131072)
    return false;
  const ids = new Set<string>();
  return fields.every((field) => {
    if (!field || !uuid.test(field.id) || ids.has(field.id)) return false;
    ids.add(field.id);
    if (field.kind === "description") return string(field.text, 5000);
    if (
      !string(field.label, 100) ||
      !field.label.trim() ||
      typeof field.required !== "boolean"
    )
      return false;
    if (["text", "number", "yes_no"].includes(field.kind)) return true;
    if (field.kind !== "single_choice" && field.kind !== "multiple_choice")
      return false;
    return (
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      field.options.length <= 50 &&
      new Set(field.options.map((option) => option.id)).size ===
        field.options.length &&
      field.options.every(
        (option) =>
          uuid.test(option.id) &&
          string(option.label, 100) &&
          !!option.label.trim(),
      )
    );
  });
}
function answerIssue(
  schema: FormsField[],
  answers: FormsAnswers,
  submitted: boolean,
) {
  if (bytes(answers) > 65536) return "Answers exceed the 64 KiB limit.";
  const answerable = schema.filter((field) => field.kind !== "description");
  if (
    Object.keys(answers).some(
      (id) => !answerable.some((field) => field.id === id),
    )
  )
    return "Answers contain an unknown question.";
  for (const field of answerable) {
    const answer = answers[field.id];
    const missing =
      answer === undefined ||
      answer === "" ||
      (field.kind === "text" && typeof answer === "string" && !answer.trim()) ||
      (Array.isArray(answer) && !answer.length);
    if (submitted && field.required && missing)
      return `Complete ${field.label}.`;
    if (answer === undefined) continue;
    if (field.kind === "text" && !string(answer, 5000))
      return `${field.label} must be at most 5,000 characters.`;
    if (
      field.kind === "number" &&
      (typeof answer !== "string" ||
        answer === "" ||
        !legal(answer) ||
        !(
          submitted
            ? /^[+-]?[0-9]{1,12}(\.[0-9]{1,6})?$/
            : /^[+-]?[0-9]{0,12}(\.[0-9]{0,6})?$/
        ).test(answer))
    ) {
      return `${field.label} needs a decimal number with at most 12 whole and 6 fractional digits.`;
    }
    if (field.kind === "yes_no" && typeof answer !== "boolean")
      return `Choose Yes or No for ${field.label}.`;
    if (
      field.kind === "single_choice" &&
      (typeof answer !== "string" ||
        !field.options.some((option) => option.id === answer))
    )
      return `Choose an option for ${field.label}.`;
    if (
      field.kind === "multiple_choice" &&
      (!Array.isArray(answer) ||
        new Set(answer).size !== answer.length ||
        !answer.every((id) => field.options.some((option) => option.id === id)))
    )
      return `Choose valid options for ${field.label}.`;
  }
  return "";
}
function validForm(form: FormsForm) {
  return (
    !!form &&
    uuid.test(form.id) &&
    string(form.name, 100) &&
    string(form.description, 500) &&
    rev(form.revision) &&
    ["draft", "published", "archived"].includes(form.status) &&
    typeof form.schemaFrozen === "boolean" &&
    typeof form.isAssigned === "boolean" &&
    typeof form.allowRespondentEdit === "boolean" &&
    !!form.capabilities &&
    [
      "canEdit",
      "canPublish",
      "canArchive",
      "canRestore",
      "canSaveProgress",
      "canSubmit",
      "canEditResponse",
      "canViewResponses",
    ].every(
      (key) =>
        typeof form.capabilities[key as keyof typeof form.capabilities] ===
        "boolean",
    ) &&
    timestamp(form.updatedAt)
  );
}
function humanTime(value: string) {
  if (!timestamp(value)) return "Time unavailable";
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}
function Questions({
  schema,
  answers,
  disabled,
  onChange,
}: {
  schema: FormsField[];
  answers: FormsAnswers;
  disabled: boolean;
  onChange?: (
    id: string,
    value: string | boolean | string[] | undefined,
  ) => void;
}) {
  return (
    <div className="forms-fields">
      {schema.map((field, index) =>
        field.kind === "description" ? (
          <section className="forms-field" key={field.id}>
            <p className="forms-answer">{field.text}</p>
          </section>
        ) : (
          <fieldset className="forms-field" key={field.id} disabled={disabled}>
            <legend>
              {index + 1}. {field.label}
              {field.required && <span className="forms-required"> *</span>}
            </legend>
            {field.kind === "text" ? (
              <textarea
                aria-label={field.label}
                maxLength={5000}
                value={
                  typeof answers[field.id] === "string"
                    ? (answers[field.id] as string)
                    : ""
                }
                onChange={(event) => onChange?.(field.id, event.target.value)}
              />
            ) : field.kind === "number" ? (
              <>
                <input
                  aria-label={field.label}
                  inputMode="decimal"
                  maxLength={21}
                  value={
                    typeof answers[field.id] === "string"
                      ? (answers[field.id] as string)
                      : ""
                  }
                  onChange={(event) =>
                    onChange?.(field.id, event.target.value || undefined)
                  }
                />
                <p className="forms-hint">
                  Decimal number, up to 12 whole and 6 fractional digits.
                </p>
              </>
            ) : field.kind === "yes_no" ? (
              <>
                {[true, false].map((value) => (
                  <label className="forms-choice" key={String(value)}>
                    <input
                      type="radio"
                      name={field.id}
                      checked={answers[field.id] === value}
                      onChange={() => onChange?.(field.id, value)}
                    />
                    {value ? "Yes" : "No"}
                  </label>
                ))}
              </>
            ) : field.kind === "single_choice" ? (
              <select
                aria-label={field.label}
                value={
                  typeof answers[field.id] === "string"
                    ? (answers[field.id] as string)
                    : ""
                }
                onChange={(event) =>
                  onChange?.(field.id, event.target.value || undefined)
                }
              >
                <option value="">Choose an option</option>
                {field.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === "multiple_choice" ? (
              field.options.map((option) => (
                <label className="forms-choice" key={option.id}>
                  <input
                    type="checkbox"
                    checked={
                      Array.isArray(answers[field.id]) &&
                      (answers[field.id] as string[]).includes(option.id)
                    }
                    onChange={(event) => {
                      const current = Array.isArray(answers[field.id])
                        ? (answers[field.id] as string[])
                        : [];
                      onChange?.(
                        field.id,
                        event.target.checked
                          ? [...current, option.id]
                          : current.filter((id) => id !== option.id),
                      );
                    }}
                  />
                  <span className="forms-choice-label">{option.label}</span>
                </label>
              ))
            ) : null}
          </fieldset>
        ),
      )}
    </div>
  );
}

export default function Forms(props: Props) {
  return (
    <FormsWorkspace
      key={`${props.company.id}:${props.initialData.actorId}:${props.role}`}
      {...props}
    />
  );
}
function FormsWorkspace({ company, role, initialData }: Props) {
  const [catalog, setCatalog] = useState<FormsData | null>(initialData);
  const [view, setView] = useState<FormsView>(initialData.view);
  const [detail, setDetail] = useState<FormsFormData | null>(null);
  const [responses, setResponses] = useState<FormsResponsesData | null>(null);
  const [responseDetail, setResponseDetail] =
    useState<FormsResponseData | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [reading, setReading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<
    "all" | "draft" | "published" | "archived"
  >("all");
  const [responseSearch, setResponseSearch] = useState("");
  const [responseStatus, setResponseStatus] = useState<"all" | "submitted">(
    "all",
  );
  const [review, setReview] = useState<"all" | "reviewed" | "not_reviewed">(
    "all",
  );
  const [answers, setAnswers] = useState<FormsAnswers>({});
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [editingResponse, setEditingResponse] = useState(false);
  const [editor, setEditor] = useState<"create" | "edit" | "audience" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormsField[]>([]);
  const [allowEdit, setAllowEdit] = useState(false);
  const [selected, setSelected] = useState<FormsAssignee[]>([]);
  const [roster, setRoster] = useState<FormsRosterData | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [operation, setOperation] = useState<Marker | null>(null);
  const mounted = useRef(true),
    epoch = useRef(0),
    busy = useRef(false),
    recoveryBusy = useRef(false),
    phaseRef = useRef<Phase>("ready");
  const controllers = useRef<Record<string, AbortController>>({});
  const selection = useRef<{ formId: string; view: FormsView } | null>(null);
  const marker = useRef<Marker | null>(null);
  const answersRef = useRef<FormsAnswers>({}),
    dirtyRef = useRef(false),
    answerGeneration = useRef(0),
    responseRevision = useRef(0),
    detailRef = useRef<FormsFormData | null>(null);
  const submitRequested = useRef(false),
    autosaveSuspended = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = `ct-alt:forms:${initialData.actorId}:${company.id}`;
  const manage = role === "owner" || role === "admin";
  const locked =
    phase === "unknown" ||
    phase === "denied" ||
    phase === "conflict" ||
    recovering;
  function changePhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }
  function identity(value: FormsIdentity) {
    return (
      !!value &&
      value.tenantId === company.id &&
      value.actorId === initialData.actorId &&
      value.role === role
    );
  }
  function invalidate() {
    epoch.current++;
    Object.values(controllers.current).forEach((controller) =>
      controller.abort(),
    );
    controllers.current = {};
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function clearPrivate(message: string) {
    invalidate();
    setCatalog(null);
    setDetail(null);
    detailRef.current = null;
    setResponses(null);
    setResponseDetail(null);
    setAnswers({});
    answersRef.current = {};
    dirtyRef.current = false;
    setDirty(false);
    selection.current = null;
    setEditor(null);
    setFields([]);
    setSelected([]);
    setRoster(null);
    setName("");
    setDescription("");
    setSearch("");
    setResponseSearch("");
    setRosterSearch("");
    setNotice("");
    setReading(false);
    setEditingResponse(false);
    submitRequested.current = false;
    setSending(false);
    changePhase("denied");
    setError(message);
  }
  function begin(kind: string) {
    controllers.current[kind]?.abort();
    const controller = new AbortController();
    controllers.current[kind] = controller;
    const generation = epoch.current;
    return {
      controller,
      current: () =>
        mounted.current &&
        !controller.signal.aborted &&
        generation === epoch.current &&
        controllers.current[kind] === controller,
    };
  }
  function storeMarker(value: Marker | null) {
    marker.current = value;
    setOperation(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {}
  }
  const initialize = useEffectEvent(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const value = JSON.parse(raw) as Marker;
        if (
          Object.keys(value).length === 2 &&
          actions.includes(value.action) &&
          uuid.test(value.operationId)
        ) {
          storeMarker(value);
          changePhase("unknown");
          setCatalog(null);
        } else {
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      changePhase("unknown");
      setError(
        "Saved recovery state could not be read. Check current access before continuing.",
      );
      setCatalog(null);
    }
  });
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (mounted.current) initialize();
    });
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, []);
  async function json<T>(
    url: string,
    controller: AbortController,
    body?: unknown,
  ): Promise<T> {
    const result = await fetch(url, {
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
    if (!result.ok)
      throw Object.assign(
        new Error(
          result.status === 401 || result.status === 403
            ? "Your current Forms access could not be verified. Private data has been cleared."
            : result.status === 409
              ? "The form or response changed. Your local answers are retained; refresh current revisions before saving again."
              : "Forms could not complete this request. Check current access before continuing.",
        ),
        { status: result.status },
      );
    return result.json() as Promise<T>;
  }
  function query(extra: Record<string, string>) {
    return new URLSearchParams({ tenantId: company.id, ...extra });
  }
  function failRead(cause: unknown) {
    clearPrivate(
      cause instanceof Error
        ? cause.message
        : "The response could not be verified. Check current access before continuing.",
    );
  }
  function canNavigate() {
    return (
      mounted.current &&
      !busy.current &&
      !recoveryBusy.current &&
      phaseRef.current === "ready" &&
      !dirtyRef.current
    );
  }
  function clearLeaf() {
    setDetail(null);
    detailRef.current = null;
    setResponses(null);
    setResponseDetail(null);
    setEditor(null);
    setRoster(null);
    setSelected([]);
    setFields([]);
    setName("");
    setDescription("");
    setAnswers({});
    answersRef.current = {};
    dirtyRef.current = false;
    setDirty(false);
    setEditingResponse(false);
    selection.current = null;
    autosaveSuspended.current = false;
    submitRequested.current = false;
  }
  async function readCatalog(
    nextView = view,
    cursor: string | null = null,
    internal = false,
  ) {
    if (!internal && !canNavigate()) return false;
    invalidate();
    clearLeaf();
    setView(nextView);
    setReading(true);
    setError("");
    const read = begin("catalog");
    try {
      const value = await json<FormsData>(
        `/api/forms?${query({ view: nextView, status: nextView === "mine" ? "all" : status, search, limit: "50", ...(cursor ? { cursor } : {}) })}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (
        !identity(value) ||
        value.company.id !== company.id ||
        value.view !== nextView ||
        (nextView === "manage" && !manage) ||
        !Array.isArray(value.forms) ||
        value.forms.length > 50 ||
        !value.forms.every(validForm) ||
        !Object.values(value.counts).every(count) ||
        value.counts.total !==
          value.counts.draft + value.counts.published + value.counts.archived ||
        !nextPage(value.nextCursor) ||
        typeof value.catalogVersion !== "string" ||
        (nextView === "mine" &&
          value.forms.some(
            (form) => form.status !== "published" || !form.isAssigned,
          ))
      )
        throw new Error("The Forms catalog could not be verified.");
      setCatalog((current) =>
        cursor &&
        current &&
        current.catalogVersion === value.catalogVersion &&
        current.view === value.view
          ? { ...value, forms: [...current.forms, ...value.forms] }
          : value,
      );
      changePhase("ready");
      return true;
    } catch (cause) {
      if (read.current()) failRead(cause);
      return false;
    } finally {
      if (read.current()) setReading(false);
    }
  }
  function checkDetail(
    value: FormsFormData,
    formId: string,
    nextView: FormsView,
  ) {
    if (
      !identity(value) ||
      value.company.id !== company.id ||
      value.view !== nextView ||
      !validForm(value.form) ||
      value.form.id !== formId ||
      !validSchema(value.schema) ||
      typeof value.collectionVersion !== "string"
    )
      return false;
    if (value.view === "manage")
      return (
        manage &&
        Array.isArray(value.assignees) &&
        value.assignees.length <= 500 &&
        value.assignees.every(
          (user) =>
            uuid.test(user.actorId) &&
            string(user.name, 200) &&
            typeof user.eligible === "boolean",
        )
      );
    return (
      value.form.isAssigned &&
      value.form.status === "published" &&
      (value.response === null ||
        (value.response.actorId === initialData.actorId &&
          value.response.formId === formId &&
          rev(value.response.revision) &&
          validSchema(value.response.schema) &&
          !answerIssue(value.schema, value.response.answers, false)))
    );
  }
  async function readForm(
    formId: string,
    nextView = view,
    internal = false,
    preserveAnswers = false,
  ) {
    if (!internal && !canNavigate()) return false;
    invalidate();
    if (!preserveAnswers) clearLeaf();
    setReading(true);
    setError("");
    selection.current = { formId, view: nextView };
    const read = begin("detail");
    try {
      const value = await json<FormsFormData>(
        `/api/forms/${formId}?${query({ view: nextView })}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (!checkDetail(value, formId, nextView))
        throw new Error(
          "The form and current respondent access could not be verified.",
        );
      setDetail(value);
      detailRef.current = value;
      setView(nextView);
      if (value.view === "mine") {
        responseRevision.current = value.response?.revision ?? 0;
        if (!preserveAnswers) {
          answersRef.current = clone(value.response?.answers ?? {});
          setAnswers(answersRef.current);
          answerGeneration.current++;
        }
      }
      changePhase("ready");
      return true;
    } catch (cause) {
      if (read.current()) failRead(cause);
      return false;
    } finally {
      if (read.current()) setReading(false);
    }
  }
  async function readRoster(cursor: string | null = null) {
    if (!canNavigate() || !manage || !editor) return;
    const read = begin("roster");
    setError("");
    try {
      const value = await json<FormsRosterData>(
        `/api/forms/roster?${query({ search: rosterSearch, limit: "50", ...(cursor ? { cursor } : {}) })}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !identity(value) ||
        !Array.isArray(value.users) ||
        value.users.length > 50 ||
        !value.users.every(
          (user) =>
            uuid.test(user.actorId) &&
            string(user.name, 200) &&
            user.eligible === true,
        ) ||
        !count(value.matchedCount) ||
        !nextPage(value.nextCursor)
      )
        throw new Error("The current eligible roster could not be verified.");
      setRoster((current) =>
        cursor && current?.rosterVersion === value.rosterVersion
          ? { ...value, users: [...current.users, ...value.users] }
          : value,
      );
    } catch (cause) {
      if (read.current()) failRead(cause);
    }
  }
  async function readResponses(formId: string, cursor: string | null = null) {
    if (!canNavigate() || !manage) return;
    invalidate();
    setResponseDetail(null);
    setEditingResponse(false);
    setReading(true);
    const read = begin("responses");
    try {
      const value = await json<FormsResponsesData>(
        `/api/forms/${formId}/responses?${query({ status: responseStatus, review, search: responseSearch, limit: "50", ...(cursor ? { cursor } : {}) })}`,
        read.controller,
      );
      if (!read.current()) return;
      if (
        !identity(value) ||
        !validForm(value.form) ||
        value.form.id !== formId ||
        !value.form.capabilities.canViewResponses ||
        !Array.isArray(value.responses) ||
        value.responses.length > 50 ||
        !value.responses.every(
          (item) =>
            item.formId === formId &&
            item.status === "submitted" &&
            uuid.test(item.id) &&
            rev(item.revision) &&
            uuid.test(item.actorId),
        ) ||
        !Object.values(value.counts).every(count) ||
        !nextPage(value.nextCursor)
      )
        throw new Error("The current submissions could not be verified.");
      setResponses((current) =>
        cursor && current?.collectionVersion === value.collectionVersion
          ? { ...value, responses: [...current.responses, ...value.responses] }
          : value,
      );
      setError("");
    } catch (cause) {
      if (read.current()) failRead(cause);
    } finally {
      if (read.current()) setReading(false);
    }
  }
  async function readResponse(
    formId: string,
    responseId: string,
    cursor: string | null = null,
    internal = false,
    preserveAnswers = false,
  ) {
    if ((!internal && !canNavigate()) || !manage) return false;
    invalidate();
    setReading(true);
    if (!preserveAnswers) setEditingResponse(false);
    const read = begin("response");
    try {
      const value = await json<FormsResponseData>(
        `/api/forms/${formId}/responses/${responseId}?${query({ limit: "10", ...(cursor ? { cursor } : {}) })}`,
        read.controller,
      );
      if (!read.current()) return false;
      if (
        !identity(value) ||
        !validForm(value.form) ||
        value.form.id !== formId ||
        !value.form.capabilities.canViewResponses ||
        value.response.id !== responseId ||
        value.response.formId !== formId ||
        value.response.status !== "submitted" ||
        !rev(value.response.revision) ||
        !validSchema(value.response.schema) ||
        answerIssue(value.response.schema, value.response.answers, false) ||
        !Array.isArray(value.history) ||
        value.history.length > 10 ||
        !value.history.every(
          (item) =>
            item.responseId === responseId &&
            item.status === "submitted" &&
            rev(item.revision) &&
            !answerIssue(value.response.schema, item.answers, false),
        ) ||
        !count(value.historyCount) ||
        !nextPage(value.nextCursor)
      )
        throw new Error("The submission history could not be verified.");
      setResponseDetail((current) =>
        cursor && current?.collectionVersion === value.collectionVersion
          ? { ...value, history: [...current.history, ...value.history] }
          : value,
      );
      if (!preserveAnswers) {
        answersRef.current = clone(value.response.answers);
        setAnswers(answersRef.current);
      }
      changePhase("ready");
      setError("");
      return true;
    } catch (cause) {
      if (read.current()) failRead(cause);
      return false;
    } finally {
      if (read.current()) setReading(false);
    }
  }
  function validSaved(
    value: FormsSaved,
    currentMarker: Marker,
    change?: FormsChange,
  ) {
    return (
      identity(value) &&
      value.operationId === currentMarker.operationId &&
      value.action === currentMarker.action &&
      uuid.test(value.formId) &&
      rev(value.formRevision) &&
      timestamp(value.updatedAt) &&
      (!change ||
        (change.action === "create_form"
          ? value.formRevision === 1
          : "responseRevision" in change
            ? value.formRevision === change.formRevision &&
              value.responseRevision === change.responseRevision + 1
            : value.formRevision === change.formRevision + 1)) &&
      (!change || !("formId" in change) || value.formId === change.formId) &&
      (!change ||
        !("responseId" in change) ||
        value.responseId === change.responseId) &&
      (!change ||
        !["save_progress", "submit_response", "edit_response"].includes(
          change.action,
        ) ||
        !detailRef.current?.form.ownResponse ||
        value.responseId === detailRef.current.form.ownResponse.id) &&
      (![
        "save_progress",
        "submit_response",
        "edit_response",
        "admin_edit_response",
        "review_response",
      ].includes(value.action) ||
        (uuid.test(value.responseId ?? "") &&
          rev(value.responseRevision) &&
          value.responseStatus ===
            (value.action === "save_progress" ? "in_progress" : "submitted")))
    );
  }
  async function post(change: FormsChange): Promise<FormsSaved | null> {
    if (
      !mounted.current ||
      busy.current ||
      recoveryBusy.current ||
      phaseRef.current !== "ready"
    )
      return null;
    const value = {
      tenantId: company.id,
      operationId: crypto.randomUUID(),
      change,
    };
    if (bytes(value) > 262144) {
      setError(
        "The request exceeds 256 KiB. Shorten the form or answers before saving.",
      );
      return null;
    }
    invalidate();
    setReading(false);
    busy.current = true;
    changePhase("saving");
    setError("");
    setNotice("");
    const currentMarker: Marker = {
      action: change.action,
      operationId: value.operationId,
    };
    storeMarker(currentMarker);
    const read = begin("write");
    try {
      const result = await json<{ saved: FormsSaved }>(
        "/api/forms",
        read.controller,
        value,
      );
      if (!read.current()) return null;
      if (!validSaved(result.saved, currentMarker, change))
        throw new Error(
          "The save acknowledgment could not be verified. Check this operation before continuing.",
        );
      storeMarker(null);
      changePhase("ready");
      return result.saved;
    } catch (cause) {
      if (!read.current()) return null;
      const code = (cause as { status?: number })?.status;
      if (code === 401 || code === 403) clearPrivate((cause as Error).message);
      else if (code === 400 || code === 409 || code === 413) {
        storeMarker(null);
        changePhase(code === 409 ? "conflict" : "ready");
        autosaveSuspended.current = true;
        setError((cause as Error).message);
      } else {
        changePhase("unknown");
        setError(
          cause instanceof Error
            ? cause.message
            : "The save outcome is uncertain. Recover before continuing.",
        );
      }
      return null;
    } finally {
      busy.current = false;
    }
  }
  function editAnswer(
    id: string,
    value: string | boolean | string[] | undefined,
  ) {
    const data = detailRef.current;
    if (
      !mounted.current ||
      recoveryBusy.current ||
      (editingResponse && busy.current) ||
      submitRequested.current ||
      ["unknown", "denied", "conflict"].includes(phaseRef.current) ||
      (!editingResponse &&
        (!data ||
          data.view !== "mine" ||
          !(
            data.form.capabilities.canSaveProgress ||
            (editingResponse && data.form.capabilities.canEditResponse)
          )))
    )
      return;
    const next = { ...answersRef.current };
    if (value === undefined) delete next[id];
    else next[id] = value;
    answersRef.current = next;
    setAnswers(next);
    answerGeneration.current++;
    dirtyRef.current = true;
    setDirty(true);
    setNotice("");
    if (
      !editingResponse &&
      data?.view === "mine" &&
      data.form.capabilities.canSaveProgress &&
      phaseRef.current !== "conflict"
    ) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveProgress(), 650);
    }
  }
  async function saveProgress(submit = false) {
    const data = detailRef.current;
    if (
      !mounted.current ||
      recoveryBusy.current ||
      editingResponse ||
      !["ready", "saving"].includes(phaseRef.current)
    )
      return;
    if (submit && data?.view === "mine" && data.form.capabilities.canSubmit) {
      submitRequested.current = true;
      setSending(true);
    }
    if (busy.current) return;
    if (
      !data ||
      data.view !== "mine" ||
      !data.form.isAssigned ||
      data.form.status !== "published"
    )
      return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    autosaveSuspended.current = false;
    while (
      mounted.current &&
      phaseRef.current === "ready" &&
      (dirtyRef.current || submitRequested.current)
    ) {
      const current = detailRef.current;
      if (
        !current ||
        current.view !== "mine" ||
        current.form.id !== data.form.id
      )
        return;
      const submitting = !dirtyRef.current && submitRequested.current;
      if (
        submitting
          ? !current.form.capabilities.canSubmit
          : !current.form.capabilities.canSaveProgress
      )
        return;
      const sentAnswers = clone(answersRef.current),
        generation = answerGeneration.current;
      const issue = answerIssue(current.schema, sentAnswers, submitting);
      if (issue) {
        setError(issue);
        autosaveSuspended.current = true;
        submitRequested.current = false;
        setSending(false);
        return;
      }
      const saved = await post({
        action: submitting ? "submit_response" : "save_progress",
        formId: current.form.id,
        formRevision: current.form.revision,
        responseRevision: responseRevision.current,
        answers: sentAnswers,
      });
      if (
        !saved ||
        !mounted.current ||
        detailRef.current?.form.id !== current.form.id
      ) {
        submitRequested.current = false;
        setSending(false);
        return;
      }
      responseRevision.current = saved.responseRevision!;
      const next = {
        ...current,
        form: {
          ...current.form,
          ownResponse: {
            id: saved.responseId!,
            revision: saved.responseRevision!,
            status: saved.responseStatus!,
            submittedAt: saved.submittedAt ?? null,
            updatedAt: saved.updatedAt,
          },
          capabilities: submitting
            ? {
                ...current.form.capabilities,
                canSaveProgress: false,
                canSubmit: false,
                canEditResponse: current.form.allowRespondentEdit,
              }
            : current.form.capabilities,
        },
        response: current.response
          ? {
              ...current.response,
              revision: saved.responseRevision!,
              answers: sentAnswers,
              status: saved.responseStatus!,
              submittedAt: saved.submittedAt ?? null,
              updatedAt: saved.updatedAt,
            }
          : null,
      } as FormsFormData;
      detailRef.current = next;
      setDetail(next);
      if (generation === answerGeneration.current) {
        dirtyRef.current = false;
        setDirty(false);
      }
      if (submitting) {
        submitRequested.current = false;
        setSending(false);
        setNotice("Your response was submitted.");
        await readForm(current.form.id, "mine", true);
        return;
      }
      setNotice("Progress saved.");
    }
  }
  async function mutate(change: FormsChange) {
    const saved = await post(change);
    if (!saved || !mounted.current) return;
    setNotice("Forms updated.");
    dirtyRef.current = false;
    setDirty(false);
    setEditingResponse(false);
    if (
      (change.action === "admin_edit_response" ||
        change.action === "review_response") &&
      saved.responseId
    )
      await readResponse(saved.formId, saved.responseId, null, true);
    else if (change.action === "edit_response")
      await readForm(saved.formId, "mine", true);
    else if (change.action === "archive_form")
      await readCatalog(view, null, true);
    else {
      setEditor(null);
      await readForm(saved.formId, "manage", true);
    }
  }
  async function recover() {
    if (busy.current || recoveryBusy.current || !mounted.current) return;
    recoveryBusy.current = true;
    setRecovering(true);
    setError("");
    const original = marker.current;
    invalidate();
    const read = begin("recover");
    try {
      if (!original) {
        if (await readCatalog(view, null, true)) {
          storeMarker(null);
          changePhase("ready");
        }
        return;
      }
      const value = await json<FormsReconciliation>(
        "/api/forms/reconcile",
        read.controller,
        { tenantId: company.id, ...original },
      );
      if (!read.current()) return;
      if (
        !identity(value) ||
        value.operationId !== original.operationId ||
        value.action !== original.action ||
        !["recorded", "not_recorded"].includes(value.status) ||
        (value.status === "not_recorded"
          ? value.saved !== null
          : !value.saved || !validSaved(value.saved, original))
      )
        throw new Error("The recovery receipt could not be verified.");
      const personal = [
        "save_progress",
        "submit_response",
        "edit_response",
      ].includes(original.action);
      let loaded = value.saved
        ? await readForm(value.saved.formId, personal ? "mine" : "manage", true)
        : await readCatalog(view, null, true);
      if (loaded && value.saved?.responseId && !personal)
        loaded = await readResponse(
          value.saved.formId,
          value.saved.responseId,
          null,
          true,
        );
      if (!loaded || !mounted.current) {
        if (phaseRef.current !== "denied") changePhase("unknown");
        return;
      }
      storeMarker(null);
      dirtyRef.current = false;
      setDirty(false);
      changePhase("ready");
      setNotice(
        value.status === "recorded"
          ? "The operation was recorded. Current data has been refreshed."
          : "The operation was not recorded. Current access has been refreshed; you can start a new action.",
      );
    } catch (cause) {
      if (read.current()) {
        failRead(cause);
        if (phaseRef.current !== "denied") changePhase("unknown");
      }
    } finally {
      recoveryBusy.current = false;
      if (mounted.current) setRecovering(false);
    }
  }
  function openEditor(next: "create" | "edit" | "audience") {
    if (
      !canNavigate() ||
      !manage ||
      (next !== "create" && !detail?.form.capabilities.canEdit)
    )
      return;
    invalidate();
    setResponses(null);
    setResponseDetail(null);
    setEditor(next);
    setName(next === "create" ? "" : detail!.form.name);
    setDescription(next === "create" ? "" : detail!.form.description);
    setFields(next === "create" ? [] : clone(detail!.schema));
    setAllowEdit(next === "create" ? false : detail!.form.allowRespondentEdit);
    setSelected(
      next === "create"
        ? []
        : detail?.view === "manage"
          ? clone(detail.assignees)
          : [],
    );
    setRoster(null);
    setRosterSearch("");
  }
  function updateField(index: number, change: Partial<FormsField>) {
    if (!canNavigate() || detail?.form.schemaFrozen) return;
    setFields((current) =>
      current.map((field, i) =>
        i === index ? ({ ...field, ...change } as FormsField) : field,
      ),
    );
  }
  function saveBuilder() {
    if (!canNavigate() || !manage || !editor) return;
    if (selected.length > 500) {
      setError("Select no more than 500 people.");
      return;
    }
    if (editor === "audience") {
      if (detail)
        void mutate({
          action: "set_audience",
          formId: detail.form.id,
          formRevision: detail.form.revision,
          audienceIds: selected.map((user) => user.actorId),
        });
      return;
    }
    if (
      !string(name, 100) ||
      !name.trim() ||
      !string(description, 500) ||
      !validSchema(fields)
    ) {
      setError(
        "Add a form name and valid questions. Choice questions need distinct, nonblank options.",
      );
      return;
    }
    void mutate(
      editor === "create"
        ? {
            action: "create_form",
            name,
            description,
            schema: fields,
            audienceIds: selected.map((user) => user.actorId),
            allowRespondentEdit: allowEdit,
          }
        : {
            action: "edit_form",
            formId: detail!.form.id,
            formRevision: detail!.form.revision,
            name,
            description,
            schema: fields,
            allowRespondentEdit: allowEdit,
          },
    );
  }
  function cancelAnswerEditing() {
    if (
      !mounted.current ||
      busy.current ||
      recoveryBusy.current ||
      phaseRef.current !== "ready"
    )
      return;
    answersRef.current = clone(
      responseDetail?.response.answers ??
        (detail?.view === "mine" ? detail.response?.answers : undefined) ??
        {},
    );
    setAnswers(answersRef.current);
    dirtyRef.current = false;
    setDirty(false);
    setEditingResponse(false);
    setError("");
  }
  function discardUnsavedAnswers() {
    const current = detailRef.current;
    if (
      !mounted.current ||
      busy.current ||
      recoveryBusy.current ||
      !["ready", "conflict"].includes(phaseRef.current) ||
      !dirtyRef.current ||
      !current ||
      current.view !== "mine"
    )
      return;
    void readForm(current.form.id, "mine", true);
  }
  function saveEditedAnswers() {
    if (!editingResponse || busy.current || locked) return;
    const schema = responseDetail?.response.schema ?? detail?.schema ?? [],
      issue = answerIssue(schema, answersRef.current, true);
    if (issue) {
      setError(issue);
      return;
    }
    if (responseDetail?.response.canEdit)
      void mutate({
        action: "admin_edit_response",
        formId: responseDetail.form.id,
        formRevision: responseDetail.form.revision,
        responseId: responseDetail.response.id,
        responseRevision: responseDetail.response.revision,
        answers: answersRef.current,
      });
    else if (
      detail?.view === "mine" &&
      detail.form.capabilities.canEditResponse
    )
      void mutate({
        action: "edit_response",
        formId: detail.form.id,
        formRevision: detail.form.revision,
        responseRevision: responseRevision.current,
        answers: answersRef.current,
      });
  }
  const disabled = locked || reading || phase === "saving";
  return (
    <div className="forms-page">
      <header className="forms-heading">
        <div>
          <h1>Forms</h1>
          <p>Create clear questions, save progress and review responses.</p>
        </div>
        <button
          disabled={
            reading ||
            phase === "saving" ||
            phase === "unknown" ||
            phase === "denied" ||
            (dirty && phase !== "conflict")
          }
          onClick={() => {
            if (
              phaseRef.current === "conflict" &&
              !busy.current &&
              detailRef.current
            )
              if (responseDetail)
                void readResponse(
                  responseDetail.form.id,
                  responseDetail.response.id,
                  null,
                  true,
                  true,
                );
              else void readForm(detailRef.current.form.id, view, true, true);
            else if (detail && !responses && !responseDetail)
              void readForm(detail.form.id);
            else void readCatalog();
          }}
        >
          Refresh Forms
        </button>
      </header>
      {error && (
        <p className="forms-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="forms-message" role="status">
          {notice}
        </p>
      )}
      {(phase === "unknown" || phase === "denied" || operation) && (
        <section className="forms-recovery" aria-label="Forms recovery">
          <h2>
            {operation
              ? "Check your last operation"
              : "Check current Forms access"}
          </h2>
          <p>
            Forms is locked until your current access and the operation outcome
            are checked. Answers are not stored in recovery state.
          </p>
          {operation && (
            <p className="forms-hint">Operation {operation.operationId}</p>
          )}
          <button
            disabled={phase === "saving" || recovering}
            onClick={() => void recover()}
          >
            Recover Forms
          </button>
        </section>
      )}
      <div className="forms-feature">
        <nav className="forms-tabs" aria-label="Forms views">
          <button
            aria-current={view === "mine" ? "page" : undefined}
            disabled={disabled || dirty}
            onClick={() => void readCatalog("mine")}
          >
            My forms
          </button>
          {manage && (
            <button
              aria-current={view === "manage" ? "page" : undefined}
              disabled={disabled || dirty}
              onClick={() => void readCatalog("manage")}
            >
              Manage forms
            </button>
          )}
        </nav>
        <div className="forms-content">
          {reading && <p role="status">Loading current Forms data…</p>}
          {catalog && !detail && !editor && (
            <>
              <div className="forms-panel-heading">
                <div>
                  <h2>
                    {view === "manage" ? "Manage forms" : "Assigned forms"}
                  </h2>
                  <p className="forms-hint">
                    {catalog.counts.total} forms
                    {view === "manage"
                      ? ` · ${catalog.counts.draft} draft · ${catalog.counts.published} published · ${catalog.counts.archived} archived`
                      : " currently available to you"}
                  </p>
                </div>
                {view === "manage" && catalog.capabilities.canManage && (
                  <button
                    className="forms-primary"
                    disabled={disabled}
                    onClick={() => openEditor("create")}
                  >
                    Create form
                  </button>
                )}
              </div>
              <form
                className="forms-filters"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canNavigate()) void readCatalog();
                }}
              >
                <label>
                  Search form titles
                  <input
                    maxLength={100}
                    value={search}
                    disabled={disabled}
                    onChange={(event) => {
                      if (canNavigate()) setSearch(event.target.value);
                    }}
                  />
                </label>
                {view === "manage" && (
                  <label>
                    Status
                    <select
                      value={status}
                      disabled={disabled}
                      onChange={(event) => {
                        if (canNavigate())
                          setStatus(event.target.value as typeof status);
                      }}
                    >
                      <option value="all">All statuses</option>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </select>
                  </label>
                )}
                <button disabled={disabled}>Search forms</button>
              </form>
              <div className="forms-grid">
                {catalog.forms.map((form) => (
                  <article className="forms-card" key={form.id}>
                    <span className={`forms-status ${form.status}`}>
                      {form.status}
                    </span>
                    <h3>{form.name}</h3>
                    <p className="forms-hint">{form.description}</p>
                    <p>
                      {view === "manage"
                        ? `${form.audienceCount} assigned people`
                        : form.ownResponse?.status === "submitted"
                          ? "Submitted"
                          : form.ownResponse
                            ? "Saved progress"
                            : "Not started"}
                    </p>
                    <button
                      disabled={disabled}
                      onClick={() => void readForm(form.id)}
                    >
                      Open form {form.name}
                    </button>
                  </article>
                ))}
              </div>
              {!catalog.forms.length && (
                <p className="forms-empty">No forms match this view.</p>
              )}
              {catalog.nextCursor && (
                <button
                  disabled={disabled}
                  onClick={() => void readCatalog(view, catalog.nextCursor)}
                >
                  Load more forms
                </button>
              )}
            </>
          )}
          {editor && (
            <>
              <div className="forms-panel-heading">
                <h2>
                  {editor === "create"
                    ? "Create form"
                    : editor === "audience"
                      ? "Assign people"
                      : "Edit form"}
                </h2>
                <button
                  disabled={disabled}
                  onClick={() => {
                    if (canNavigate()) {
                      setEditor(null);
                      setRoster(null);
                      setSelected([]);
                      setFields([]);
                    }
                  }}
                >
                  Cancel form editing
                </button>
              </div>
              <div className="forms-editor-grid">
                <div className="forms-stacked">
                  {editor !== "audience" && (
                    <>
                      <label>
                        Form name
                        <input
                          disabled={disabled}
                          maxLength={100}
                          value={name}
                          onChange={(event) => {
                            if (canNavigate()) setName(event.target.value);
                          }}
                        />
                      </label>
                      <label>
                        Form description
                        <textarea
                          disabled={disabled}
                          maxLength={500}
                          value={description}
                          onChange={(event) => {
                            if (canNavigate())
                              setDescription(event.target.value);
                          }}
                        />
                      </label>
                      <label className="forms-choice">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={allowEdit}
                          onChange={(event) => {
                            if (canNavigate())
                              setAllowEdit(event.target.checked);
                          }}
                        />
                        Allow respondents to edit submitted answers
                      </label>
                      {detail?.form.schemaFrozen && (
                        <p className="forms-hint">
                          Published questions are fixed. You can update the
                          title, description and respondent editing setting.
                        </p>
                      )}
                      <div className="forms-fields">
                        {fields.map((field, index) => (
                          <section className="forms-field" key={field.id}>
                            <div className="forms-panel-heading">
                              <h3>
                                Question {index + 1} ·{" "}
                                {field.kind.replaceAll("_", " ")}
                              </h3>
                            </div>
                            {field.kind === "description" ? (
                              <label>
                                Description text
                                <textarea
                                  disabled={
                                    disabled || !!detail?.form.schemaFrozen
                                  }
                                  maxLength={5000}
                                  value={field.text}
                                  onChange={(event) =>
                                    updateField(index, {
                                      text: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            ) : (
                              <>
                                <label>
                                  Question label {index + 1}
                                  <input
                                    disabled={
                                      disabled || !!detail?.form.schemaFrozen
                                    }
                                    maxLength={100}
                                    value={field.label}
                                    onChange={(event) =>
                                      updateField(index, {
                                        label: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="forms-choice">
                                  <input
                                    type="checkbox"
                                    disabled={
                                      disabled || !!detail?.form.schemaFrozen
                                    }
                                    checked={field.required}
                                    onChange={(event) =>
                                      updateField(index, {
                                        required: event.target.checked,
                                      })
                                    }
                                  />
                                  Required question {index + 1}
                                </label>
                                {(field.kind === "single_choice" ||
                                  field.kind === "multiple_choice") && (
                                  <>
                                    {field.options.map(
                                      (option, optionIndex) => (
                                        <div
                                          className="forms-actions"
                                          key={option.id}
                                        >
                                          <label>
                                            Option {index + 1}.{optionIndex + 1}
                                            <input
                                              disabled={
                                                disabled ||
                                                !!detail?.form.schemaFrozen
                                              }
                                              maxLength={100}
                                              value={option.label}
                                              onChange={(event) =>
                                                updateField(index, {
                                                  options: field.options.map(
                                                    (item, i) =>
                                                      i === optionIndex
                                                        ? {
                                                            ...item,
                                                            label:
                                                              event.target
                                                                .value,
                                                          }
                                                        : item,
                                                  ),
                                                })
                                              }
                                            />
                                          </label>
                                          <button
                                            disabled={
                                              disabled ||
                                              !!detail?.form.schemaFrozen
                                            }
                                            onClick={() =>
                                              updateField(index, {
                                                options: field.options.filter(
                                                  (item) =>
                                                    item.id !== option.id,
                                                ),
                                              })
                                            }
                                          >
                                            Remove option {index + 1}.
                                            {optionIndex + 1}
                                          </button>
                                        </div>
                                      ),
                                    )}
                                    <button
                                      disabled={
                                        disabled ||
                                        !!detail?.form.schemaFrozen ||
                                        field.options.length >= 50
                                      }
                                      onClick={() =>
                                        updateField(index, {
                                          options: [
                                            ...field.options,
                                            {
                                              id: crypto.randomUUID(),
                                              label: "",
                                            },
                                          ],
                                        })
                                      }
                                    >
                                      Add option to question {index + 1}
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                            {!detail?.form.schemaFrozen && (
                              <div className="forms-builder-controls">
                                <button
                                  disabled={disabled || index === 0}
                                  onClick={() => {
                                    if (!canNavigate()) return;
                                    setFields((current) => {
                                      const next = [...current];
                                      [next[index - 1], next[index]] = [
                                        next[index],
                                        next[index - 1],
                                      ];
                                      return next;
                                    });
                                  }}
                                >
                                  Move question {index + 1} up
                                </button>
                                <button
                                  disabled={
                                    disabled || index === fields.length - 1
                                  }
                                  onClick={() => {
                                    if (!canNavigate()) return;
                                    setFields((current) => {
                                      const next = [...current];
                                      [next[index + 1], next[index]] = [
                                        next[index],
                                        next[index + 1],
                                      ];
                                      return next;
                                    });
                                  }}
                                >
                                  Move question {index + 1} down
                                </button>
                                <button
                                  disabled={disabled}
                                  onClick={() => {
                                    if (canNavigate())
                                      setFields((current) =>
                                        current.filter(
                                          (item) => item.id !== field.id,
                                        ),
                                      );
                                  }}
                                >
                                  Remove question {index + 1}
                                </button>
                              </div>
                            )}
                          </section>
                        ))}
                      </div>
                      {!detail?.form.schemaFrozen && (
                        <div className="forms-actions">
                          {(
                            [
                              "description",
                              "text",
                              "yes_no",
                              "single_choice",
                              "multiple_choice",
                              "number",
                            ] as const
                          ).map((kind) => (
                            <button
                              disabled={disabled || fields.length >= 50}
                              key={kind}
                              onClick={() => {
                                if (!canNavigate()) return;
                                setFields((current) => [
                                  ...current,
                                  kind === "description"
                                    ? {
                                        id: crypto.randomUUID(),
                                        kind,
                                        text: "",
                                      }
                                    : kind === "single_choice" ||
                                        kind === "multiple_choice"
                                      ? {
                                          id: crypto.randomUUID(),
                                          kind,
                                          label: "",
                                          required: false,
                                          options: [
                                            {
                                              id: crypto.randomUUID(),
                                              label: "",
                                            },
                                          ],
                                        }
                                      : {
                                          id: crypto.randomUUID(),
                                          kind,
                                          label: "",
                                          required: false,
                                        },
                                ]);
                              }}
                            >
                              Add {kind.replaceAll("_", " ")}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {editor === "create" || editor === "audience" ? (
                    <p className="forms-hint">
                      Fixed assignment uses confirmed active company users.
                      Management access alone does not assign a person.
                    </p>
                  ) : null}
                  <button
                    className="forms-primary"
                    disabled={disabled}
                    onClick={saveBuilder}
                  >
                    {editor === "create"
                      ? "Save draft form"
                      : editor === "audience"
                        ? "Save assignments"
                        : "Save form changes"}
                  </button>
                </div>
                {(editor === "create" || editor === "audience") && (
                  <aside className="forms-roster" aria-label="Form assignments">
                    <h3>Assigned people · {selected.length}/500</h3>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void readRoster();
                      }}
                    >
                      <label>
                        Search eligible people
                        <input
                          disabled={disabled}
                          maxLength={100}
                          value={rosterSearch}
                          onChange={(event) => {
                            if (canNavigate())
                              setRosterSearch(event.target.value);
                          }}
                        />
                      </label>
                      <button disabled={disabled}>Search people</button>
                    </form>
                    {roster && (
                      <p className="forms-hint">
                        {roster.matchedCount} matching people
                      </p>
                    )}
                    <div className="forms-roster-list">
                      {roster?.users.map((user) => (
                        <label className="forms-choice" key={user.actorId}>
                          <input
                            type="checkbox"
                            disabled={
                              disabled ||
                              (!selected.some(
                                (item) => item.actorId === user.actorId,
                              ) &&
                                selected.length >= 500)
                            }
                            checked={selected.some(
                              (item) => item.actorId === user.actorId,
                            )}
                            onChange={(event) => {
                              if (!canNavigate()) return;
                              setSelected((current) =>
                                event.target.checked
                                  ? current.some(
                                      (item) => item.actorId === user.actorId,
                                    ) || current.length >= 500
                                    ? current
                                    : [...current, user]
                                  : current.filter(
                                      (item) => item.actorId !== user.actorId,
                                    ),
                              );
                            }}
                          />
                          {user.name}
                        </label>
                      ))}
                    </div>
                    {roster?.nextCursor && (
                      <button
                        disabled={disabled}
                        onClick={() => void readRoster(roster.nextCursor)}
                      >
                        Load more people
                      </button>
                    )}
                    <h4>Selected people</h4>
                    {selected.map((user) => (
                      <div className="forms-actions" key={user.actorId}>
                        <span>
                          {user.name}
                          {!user.eligible ? " · currently unavailable" : ""}
                        </span>
                        <button
                          disabled={disabled}
                          onClick={() => {
                            if (canNavigate())
                              setSelected((current) =>
                                current.filter(
                                  (item) => item.actorId !== user.actorId,
                                ),
                              );
                          }}
                        >
                          Remove assigned person {user.name}
                        </button>
                      </div>
                    ))}
                  </aside>
                )}
              </div>
            </>
          )}
          {detail && !editor && (
            <>
              <div className="forms-panel-heading">
                <div>
                  <span className={`forms-status ${detail.form.status}`}>
                    {detail.form.status}
                  </span>
                  <h2>{detail.form.name}</h2>
                  <p className="forms-hint">{detail.form.description}</p>
                </div>
                <button
                  disabled={disabled || dirty}
                  onClick={() => void readCatalog(view)}
                >
                  Back to forms
                </button>
              </div>
              {detail.view === "manage" ? (
                <>
                  <p>
                    {detail.form.audienceCount} assigned ·{" "}
                    {detail.form.eligibleAudienceCount} currently eligible
                  </p>
                  <p className="forms-hint">
                    Management does not submit a response. Use My forms if you
                    are also assigned.
                  </p>
                  <div className="forms-actions">
                    {detail.form.capabilities.canEdit && (
                      <>
                        <button
                          disabled={disabled}
                          onClick={() => openEditor("edit")}
                        >
                          Edit form
                        </button>
                        <button
                          disabled={disabled}
                          onClick={() => openEditor("audience")}
                        >
                          Assign people
                        </button>
                      </>
                    )}
                    {detail.form.capabilities.canPublish && (
                      <button
                        className="forms-primary"
                        disabled={disabled}
                        onClick={() => {
                          if (canNavigate())
                            void mutate({
                              action: "publish_form",
                              formId: detail.form.id,
                              formRevision: detail.form.revision,
                            });
                        }}
                      >
                        Publish form
                      </button>
                    )}
                    {detail.form.capabilities.canArchive && (
                      <button
                        disabled={disabled}
                        onClick={() => {
                          if (canNavigate())
                            void mutate({
                              action: "archive_form",
                              formId: detail.form.id,
                              formRevision: detail.form.revision,
                            });
                        }}
                      >
                        Archive form
                      </button>
                    )}
                    {detail.form.capabilities.canRestore && (
                      <button
                        disabled={disabled}
                        onClick={() => {
                          if (canNavigate())
                            void mutate({
                              action: "restore_form",
                              formId: detail.form.id,
                              formRevision: detail.form.revision,
                            });
                        }}
                      >
                        Restore form
                      </button>
                    )}
                    {detail.form.capabilities.canViewResponses && (
                      <button
                        disabled={disabled}
                        onClick={() => void readResponses(detail.form.id)}
                      >
                        View submissions
                      </button>
                    )}
                  </div>
                  {!responses && !responseDetail && (
                    <Questions schema={detail.schema} answers={{}} disabled />
                  )}
                </>
              ) : (
                <>
                  <p className="forms-hint">
                    {detail.response?.status === "submitted"
                      ? `Submitted ${humanTime(detail.response.submittedAt!)}${detail.form.allowRespondentEdit ? " · Editing is allowed" : " · Editing is locked"}`
                      : "Your answers save automatically as you work. Wait for Progress saved before leaving. Required questions must be complete before you send."}
                  </p>
                  <Questions
                    schema={detail.schema}
                    answers={answers}
                    disabled={
                      locked ||
                      reading ||
                      sending ||
                      (detail.response?.status === "submitted" &&
                        !editingResponse)
                    }
                    onChange={editAnswer}
                  />
                  <div className="forms-actions">
                    {detail.form.capabilities.canSaveProgress && (
                      <button
                        disabled={locked || reading || phase === "saving"}
                        onClick={() => void saveProgress()}
                      >
                        Save progress
                      </button>
                    )}
                    {detail.form.capabilities.canSubmit && (
                      <button
                        className="forms-primary"
                        disabled={locked || reading}
                        onClick={() => void saveProgress(true)}
                      >
                        Send response
                      </button>
                    )}
                    {detail.form.capabilities.canEditResponse &&
                      !editingResponse && (
                        <button
                          disabled={disabled}
                          onClick={() => {
                            if (canNavigate()) setEditingResponse(true);
                          }}
                        >
                          Edit my response
                        </button>
                      )}
                    {editingResponse && (
                      <button
                        className="forms-primary"
                        disabled={disabled}
                        onClick={saveEditedAnswers}
                      >
                        Save edited answers
                      </button>
                    )}
                  </div>
                  {editingResponse && (
                    <button disabled={disabled} onClick={cancelAnswerEditing}>
                      Cancel answer editing
                    </button>
                  )}
                  <p role="status" className="forms-hint">
                    {phase === "saving"
                      ? "Saving your answers…"
                      : dirty
                        ? "Unsaved changes"
                        : detail.form.ownResponse
                          ? "Current saved answers"
                          : "Not saved yet"}
                  </p>
                  {dirty && !editingResponse && (
                    <button
                      disabled={
                        reading ||
                        phase === "saving" ||
                        phase === "unknown" ||
                        phase === "denied" ||
                        recovering
                      }
                      onClick={discardUnsavedAnswers}
                    >
                      Discard unsaved answers
                    </button>
                  )}
                </>
              )}
              {responses && !responseDetail && (
                <section aria-label="Form submissions">
                  <h3>Submissions</h3>
                  <p>
                    {responses.counts.total} submitted responses ·{" "}
                    {responses.counts.reviewed} reviewed ·{" "}
                    {responses.counts.notReviewed} not reviewed
                  </p>
                  <form
                    className="forms-filters"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void readResponses(detail.form.id);
                    }}
                  >
                    <label>
                      Search respondents
                      <input
                        disabled={disabled}
                        maxLength={100}
                        value={responseSearch}
                        onChange={(event) => {
                          if (canNavigate())
                            setResponseSearch(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Response status
                      <select
                        disabled={disabled}
                        value={responseStatus}
                        onChange={(event) =>
                          setResponseStatus(
                            event.target.value as typeof responseStatus,
                          )
                        }
                      >
                        <option value="all">All responses</option>
                        <option value="submitted">Submitted</option>
                      </select>
                    </label>
                    <label>
                      Review status
                      <select
                        disabled={disabled}
                        value={review}
                        onChange={(event) => {
                          if (canNavigate())
                            setReview(event.target.value as typeof review);
                        }}
                      >
                        <option value="all">All reviews</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="not_reviewed">Not reviewed</option>
                      </select>
                    </label>
                    <button disabled={disabled}>Search submissions</button>
                  </form>
                  <table className="forms-table">
                    <thead>
                      <tr>
                        <th>Respondent</th>
                        <th>Status</th>
                        <th>Last changed</th>
                        <th>Review</th>
                        <th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {responses.responses.map((item) => (
                        <tr key={item.id}>
                          <td>{item.authorName}</td>
                          <td>{item.status.replaceAll("_", " ")}</td>
                          <td>{humanTime(item.updatedAt)}</td>
                          <td>{item.reviewed ? "Reviewed" : "Not reviewed"}</td>
                          <td>
                            <button
                              disabled={disabled}
                              onClick={() =>
                                void readResponse(detail.form.id, item.id)
                              }
                            >
                              Open response {item.authorName}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!responses.responses.length && (
                    <p className="forms-empty">
                      No responses match this filter.
                    </p>
                  )}
                  {responses.nextCursor && (
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void readResponses(detail.form.id, responses.nextCursor)
                      }
                    >
                      Load more submissions
                    </button>
                  )}
                </section>
              )}
              {responseDetail && (
                <section aria-label="Submission detail">
                  <div className="forms-panel-heading">
                    <div>
                      <h3>
                        {responseDetail.response.authorName} ·{" "}
                        {responseDetail.response.status.replaceAll("_", " ")}
                      </h3>
                      <p className="forms-hint">
                        Last edited by {responseDetail.response.lastEditorName}{" "}
                        · {humanTime(responseDetail.response.lastEditedAt)}
                      </p>
                      <p>
                        {responseDetail.response.reviewed
                          ? `Reviewed by ${responseDetail.response.reviewerName}`
                          : "Not reviewed"}
                      </p>
                    </div>
                    <button
                      disabled={disabled || dirty}
                      onClick={() => void readResponses(detail.form.id)}
                    >
                      Back to submissions
                    </button>
                  </div>
                  <Questions
                    schema={responseDetail.response.schema}
                    answers={answers}
                    disabled={disabled || !editingResponse}
                    onChange={editAnswer}
                  />
                  <div className="forms-actions">
                    {responseDetail.response.canEdit && !editingResponse && (
                      <button
                        disabled={disabled}
                        onClick={() => {
                          if (canNavigate()) setEditingResponse(true);
                        }}
                      >
                        Edit submitted answers
                      </button>
                    )}
                    {editingResponse && (
                      <button
                        disabled={disabled}
                        className="forms-primary"
                        onClick={saveEditedAnswers}
                      >
                        Save edited answers
                      </button>
                    )}
                    {editingResponse && (
                      <button disabled={disabled} onClick={cancelAnswerEditing}>
                        Cancel answer editing
                      </button>
                    )}
                    {responseDetail.response.canReview && (
                      <button
                        disabled={disabled || dirty}
                        onClick={() => {
                          if (canNavigate())
                            void mutate({
                              action: "review_response",
                              formId: responseDetail.form.id,
                              formRevision: responseDetail.form.revision,
                              responseId: responseDetail.response.id,
                              responseRevision:
                                responseDetail.response.revision,
                              reviewed: !responseDetail.response.reviewed,
                            });
                        }}
                      >
                        {responseDetail.response.reviewed
                          ? "Mark not reviewed"
                          : "Mark reviewed"}
                      </button>
                    )}
                  </div>
                  <div className="forms-history">
                    <h3>Retained history · {responseDetail.historyCount}</h3>
                    {responseDetail.history.map((item) => (
                      <details key={item.id}>
                        <summary>
                          Revision {item.revision} · {item.lastEditorName} ·{" "}
                          {humanTime(item.lastEditedAt)}
                        </summary>
                        <h4>{item.formName}</h4>
                        <Questions
                          schema={responseDetail.response.schema}
                          answers={item.answers}
                          disabled
                        />
                      </details>
                    ))}
                    {responseDetail.nextCursor && (
                      <button
                        disabled={disabled || dirty}
                        onClick={() =>
                          void readResponse(
                            detail.form.id,
                            responseDetail.response.id,
                            responseDetail.nextCursor,
                          )
                        }
                      >
                        Load more history
                      </button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
