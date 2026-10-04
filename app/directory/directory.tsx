"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Company, Member } from "../../lib/agent-types";
import {
  DIRECTORY_LIMITS,
  type DirectoryAccess,
  type DirectoryCatalogue,
  type DirectoryChange,
  type DirectoryContact,
  type DirectoryMutation,
  type DirectoryRecoveryQuery,
  type DirectorySaved,
} from "../../lib/directory-types";
import {
  directoryMutationSchema,
  directoryQuerySchema,
  directoryRecoverySchema,
  parseDirectoryAccess,
  parseDirectoryCatalogue,
  parseDirectoryReconciliation,
  parseDirectorySaved,
} from "../../lib/directory-validation";
import { ShellIcon } from "../components/app-shell";
import styles from "./directory.module.css";

type Props = {
  company: Company;
  actorId: string;
  role: Member["role"];
  initialData?: DirectoryCatalogue;
};
type Catalogue = { access: DirectoryAccess; contacts: DirectoryContact[] };
class StaleRead extends Error {}
class RequestFailure extends Error {}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] || "")
    .join("")
    .toLocaleUpperCase();
}

export default function Directory(props: Props) {
  return (
    <DirectoryScope
      key={`${props.company.id}:${props.actorId}:${props.role}`}
      {...props}
    />
  );
}
function DirectoryScope({ company, actorId, role, initialData }: Props) {
  const initial = () => {
    try {
      const value = parseDirectoryCatalogue(initialData);
      if (
        value.company.id !== company.id ||
        value.actorId !== actorId ||
        value.role !== role ||
        value.page.nextCursor
      )
        return null;
      return { access: value, contacts: value.contacts };
    } catch {
      return null;
    }
  };
  const [catalogue, setCatalogue] = useState<Catalogue | null>(initial);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    addTrigger = useRef<HTMLButtonElement>(null);
  const lifetime = useRef({ active: false }),
    epoch = useRef(0),
    transport = useRef(false),
    bootstrapped = useRef(false),
    initialized = useRef(false),
    deniedAccess = useRef(false);
  const currentCatalogue = useRef(catalogue),
    marker = useRef<DirectoryRecoveryQuery | null>(null),
    mutation = useRef<DirectoryMutation | null>(null),
    recoveryAttempt = useRef<string | null>(null),
    confirmedRevision = useRef(0),
    catalogueLoaded = useRef(false);
  const markerKey = `ct-alt:directory-operation:v1:${actorId}:${company.id}`;
  useLayoutEffect(() => {
    const life = { active: true };
    lifetime.current = life;
    return () => {
      life.active = false;
      mutation.current = null;
      currentCatalogue.current = null;
    };
  }, []);
  const current = (generation?: number) =>
    lifetime.current.active &&
    !deniedAccess.current &&
    (generation === undefined || generation === epoch.current);
  const install = (value: Catalogue | null) => {
    currentCatalogue.current = value;
    setCatalogue(value);
  };
  function revoke() {
    deniedAccess.current = true;
    epoch.current++;
    mutation.current = null;
    install(null);
    catalogueLoaded.current = false;
    setReady(false);
    setOpen(false);
    setQuery("");
    setDenied(true);
    setLoading(false);
    setBusy(false);
    setError("Directory is unavailable.");
  }
  function envelope(
    value: DirectoryAccess,
    minimum = confirmedRevision.current,
  ) {
    if (
      value.company.id !== company.id ||
      value.actorId !== actorId ||
      value.role !== role ||
      value.canManage !== (role === "owner")
    ) {
      revoke();
      throw new StaleRead();
    }
    if (value.viewRevision < minimum)
      throw new RequestFailure("Directory changed.");
  }
  async function request(
    generation: number,
    body?: DirectoryMutation | DirectoryRecoveryQuery,
    params?: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    const life = lifetime.current;
    const response = await fetch(
      `/api/directory${params ? `?${params}` : ""}`,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
          }
        : { cache: "no-store" },
    );
    if (!life.active || life !== lifetime.current) throw new StaleRead();
    if (response.status === 401 || response.status === 403) {
      revoke();
      throw new StaleRead();
    }
    if (!current(generation)) throw new StaleRead();
    const raw: unknown = await response.json();
    if (!current(generation) || !life.active || life !== lifetime.current)
      throw new StaleRead();
    if (!response.ok) throw new RequestFailure("Directory request failed.");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new RequestFailure("Directory response could not be checked.");
    return raw as Record<string, unknown>;
  }
  async function access(
    generation: number,
    minimum = confirmedRevision.current,
  ) {
    const result = await request(
      generation,
      undefined,
      new URLSearchParams({ mode: "access", tenantId: company.id }),
    );
    const value = parseDirectoryAccess(result.data);
    envelope(value, minimum);
    return value;
  }
  async function loadCatalogue() {
    if (transport.current || !current()) return;
    const generation = ++epoch.current;
    setLoading(true);
    try {
      const search =
        directoryQuerySchema.parse({ tenantId: company.id, q: query }).q || "";
      let cursor: string | null = null,
        first: DirectoryCatalogue | null = null;
      const contacts: DirectoryContact[] = [],
        ids = new Set<string>(),
        cursors = new Set<string>();
      do {
        const params = new URLSearchParams({
          tenantId: company.id,
          q: search,
          limit: String(DIRECTORY_LIMITS.page),
          ...(cursor ? { cursor } : {}),
        });
        const result = await request(generation, undefined, params);
        const value = parseDirectoryCatalogue(result.data);
        envelope(value);
        if (
          value.search !== search ||
          (first &&
            (value.viewRevision !== first.viewRevision ||
              value.active !== first.active ||
              value.page.total !== first.page.total))
        )
          throw new RequestFailure("Directory changed while loading.");
        first ||= value;
        for (const contact of value.contacts) {
          if (ids.has(contact.id))
            throw new RequestFailure("Directory paging changed.");
          ids.add(contact.id);
          contacts.push(contact);
        }
        if (
          contacts.length > value.page.total ||
          contacts.length > DIRECTORY_LIMITS.contacts
        )
          throw new RequestFailure("Directory paging changed.");
        cursor = value.page.nextCursor;
        if (cursor) {
          if (
            !value.contacts.length ||
            cursors.has(cursor) ||
            contacts.length >= value.page.total
          )
            throw new RequestFailure("Directory paging changed.");
          cursors.add(cursor);
        }
      } while (cursor);
      if (!first || contacts.length !== first.page.total)
        throw new RequestFailure("Directory paging is incomplete.");
      if (current(generation)) {
        catalogueLoaded.current = true;
        setReady(true);
        install({ access: first, contacts });
      }
    } catch (caught) {
      if (!(caught instanceof StaleRead) && current(generation)) {
        install(null);
        setError("Directory could not be loaded.");
      }
    } finally {
      if (current(generation)) setLoading(false);
    }
  }
  function clearMarker() {
    localStorage.removeItem(markerKey);
    marker.current = null;
    mutation.current = null;
    setPending(false);
  }
  function checkSaved(
    saved: DirectorySaved,
    identity: DirectoryRecoveryQuery,
    original?: DirectoryMutation,
  ) {
    if (
      saved.tenantId !== company.id ||
      saved.actorId !== actorId ||
      saved.operationId !== identity.operationId ||
      saved.action !== identity.action ||
      (identity.action === "visibility" &&
        saved.contact_id !== identity.contactId)
    )
      throw new RequestFailure("Directory confirmation changed.");
    if (original) {
      const change = original.change;
      if (
        saved.directory_revision !== change.directory_revision + 1 ||
        (change.action === "create" && saved.contact_revision !== 1) ||
        (change.action === "visibility" &&
          (saved.contact_id !== change.contact_id ||
            saved.contact_revision !== change.contact_revision + 1))
      )
        throw new RequestFailure("Directory confirmation changed.");
    }
  }
  async function finish(
    saved: DirectorySaved,
    identity: DirectoryRecoveryQuery,
    generation: number,
    original?: DirectoryMutation,
  ) {
    checkSaved(saved, identity, original);
    const proof = await access(generation, saved.directory_revision);
    if (!proof.canManage || !proof.active) {
      revoke();
      throw new StaleRead();
    }
    confirmedRevision.current = Math.max(
      confirmedRevision.current,
      saved.directory_revision,
    );
    clearMarker();
    if (identity.action !== "visibility") setQuery("");
    setOpen(false);
    setError("");
  }
  async function write(change: DirectoryChange) {
    const state = currentCatalogue.current;
    if (
      transport.current ||
      marker.current ||
      pending ||
      loading ||
      !current() ||
      role !== "owner" ||
      !state?.access.canManage
    )
      return;
    let operation: DirectoryMutation;
    try {
      operation = directoryMutationSchema.parse({
        tenantId: company.id,
        operationId: crypto.randomUUID(),
        change,
      });
      if (
        new TextEncoder().encode(JSON.stringify(operation)).length >
        DIRECTORY_LIMITS.requestBytes
      )
        throw new Error();
      const identity: DirectoryRecoveryQuery = {
        mode: "reconcile",
        tenantId: company.id,
        operationId: operation.operationId,
        action: change.action,
        contactId: change.action === "visibility" ? change.contact_id : null,
      };
      localStorage.setItem(markerKey, JSON.stringify(identity));
      marker.current = identity;
      mutation.current = operation;
      recoveryAttempt.current = null;
      setPending(true);
    } catch {
      setError("The change could not be saved.");
      return;
    }
    transport.current = true;
    const generation = ++epoch.current;
    setBusy(true);
    setError("");
    let completed = false;
    try {
      const result = await request(generation, operation);
      const saved = parseDirectorySaved(result.saved);
      await finish(saved, marker.current!, generation, operation);
      completed = true;
    } catch (caught) {
      if (!(caught instanceof StaleRead) && current())
        setError("The change could not be confirmed.");
    } finally {
      transport.current = false;
      if (current()) {
        setBusy(false);
        if (completed) setRefresh((sequence) => sequence + 1);
      }
    }
  }
  async function recover() {
    const identity = marker.current;
    if (!identity || transport.current || !current() || role !== "owner")
      return;
    transport.current = true;
    const generation = ++epoch.current;
    setBusy(true);
    setError("");
    let completed = false;
    try {
      const proof = await access(generation, 0);
      if (!proof.canManage) {
        revoke();
        throw new StaleRead();
      }
      const result = await request(generation, identity);
      const value = parseDirectoryReconciliation(result.reconciliation);
      if (
        value.tenantId !== company.id ||
        value.actorId !== actorId ||
        value.operationId !== identity.operationId ||
        value.action !== identity.action ||
        value.contactId !== identity.contactId
      )
        throw new RequestFailure("Directory recovery changed.");
      if (value.status === "recorded")
        await finish(value.saved, identity, generation);
      else {
        const currentAccess = await access(generation, 0);
        if (!currentAccess.canManage) {
          revoke();
          throw new StaleRead();
        }
        clearMarker();
        setOpen(false);
        setError("The change was not saved.");
      }
      completed = true;
    } catch (caught) {
      if (!(caught instanceof StaleRead) && current())
        setError("The change could not be confirmed.");
    } finally {
      transport.current = false;
      if (current()) {
        setBusy(false);
        if (completed) setRefresh((sequence) => sequence + 1);
      }
    }
  }
  const bootstrap = useEffectEvent(async () => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const generation = ++epoch.current;
    try {
      const proof = await access(generation, 0);
      install({ access: proof, contacts: [] });
      if (role === "owner") {
        const stored = localStorage.getItem(markerKey);
        if (stored) {
          setPending(true);
          const identity = directoryRecoverySchema.parse(JSON.parse(stored));
          if (identity.tenantId !== company.id)
            throw new RequestFailure("Directory operation scope changed.");
          marker.current = identity;
        }
      }
      initialized.current = true;
      if (!marker.current) await loadCatalogue();
    } catch (caught) {
      if (!(caught instanceof StaleRead) && current()) {
        setPending(role === "owner");
        setError("Directory could not be loaded.");
      }
    } finally {
      if (current(generation)) setLoading(false);
    }
  });
  const refreshCatalogue = useEffectEvent(() => loadCatalogue());
  const recoverOperation = useEffectEvent(() => recover());
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void bootstrap();
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (catalogueLoaded.current && initialized.current)
      void Promise.resolve().then(refreshCatalogue);
  }, [query]);
  useEffect(() => {
    if (refresh && initialized.current)
      void Promise.resolve().then(refreshCatalogue);
  }, [refresh]);
  useEffect(() => {
    if (
      pending &&
      !busy &&
      !denied &&
      marker.current &&
      recoveryAttempt.current !== marker.current.operationId
    ) {
      recoveryAttempt.current = marker.current.operationId;
      void Promise.resolve().then(recoverOperation);
    }
  }, [pending, busy, denied]);
  useLayoutEffect(() => {
    if (open && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [open]);
  const canManage =
    !!catalogue?.access.canManage && role === "owner" && !denied;
  const locked = loading || busy || pending || denied;
  const rows = catalogue?.contacts || [];
  function dismiss() {
    if (!busy && !pending) {
      dialog.current?.close();
      setOpen(false);
      addTrigger.current?.focus();
    }
  }
  function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const state = currentCatalogue.current;
    if (!state?.access.active) return;
    const values = new FormData(event.currentTarget);
    void write({
      action: "create",
      directory_revision: state.access.viewRevision,
      name: String(values.get("name") || ""),
      description: String(values.get("description") || ""),
      phone: String(values.get("phone") || ""),
      email: String(values.get("email") || ""),
    });
  }
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <ShellIcon name="directory" />
        <h1>Directory</h1>
      </header>
      {error && !open && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {(loading || busy) && (
        <span className={styles.spinner} role="status" aria-label="Loading" />
      )}
      {catalogue && !catalogue.access.active && canManage && (
        <div className={styles.activation}>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="m9 6 8 10-5 6c4 7 9 12 16 16l6-5 10 8c-5 9-12 7-19 3C15 38 6 28 3 17 1 12 4 8 9 6Z" />
            <path d="M28 4c8 2 14 8 16 16M27 12c5 1 8 4 9 9" />
          </svg>
          <div>
            <h2>Get Started with Directory</h2>
            <p>Click here to activate your Directory</p>
          </div>
          <button
            disabled={locked}
            onClick={() =>
              void write({
                action: "activate",
                directory_revision: catalogue.access.viewRevision,
              })
            }
          >
            ACTIVATE DIRECTORY
          </button>
        </div>
      )}
      {catalogue?.access.active && (
        <>
          <div className={styles.tabs}>
            <h2>Work Contacts</h2>
          </div>
          <div className={styles.panel}>
            <div className={styles.toolbar}>
              <label className={styles.search}>
                <input
                  type="search"
                  aria-label="Search"
                  placeholder="Search"
                  maxLength={DIRECTORY_LIMITS.search}
                  value={query}
                  disabled={!ready || denied}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <ShellIcon name="search" />
              </label>
              {canManage && (
                <button
                  className={styles.add}
                  ref={addTrigger}
                  disabled={locked}
                  onClick={() => {
                    setError("");
                    setOpen(true);
                  }}
                >
                  <ShellIcon name="plus" />
                  Add Contact
                </button>
              )}
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                  {canManage && <th scope="col">Visible in app</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <span className={styles.avatar} aria-hidden="true">
                        {initials(contact.name)}
                      </span>
                      <span>{contact.name}</span>
                    </td>
                    <td>{contact.description}</td>
                    {canManage && (
                      <td>
                        <label className={styles.visibility}>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`Visible in app ${contact.name}`}
                            checked={contact.visible_in_app}
                            disabled={locked}
                            onChange={(event) =>
                              void write({
                                action: "visibility",
                                directory_revision:
                                  catalogue.access.viewRevision,
                                contact_id: contact.id,
                                contact_revision: contact.revision,
                                visible_in_app: event.target.checked,
                              })
                            }
                          />
                        </label>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {open && canManage && (
        <dialog
          className={styles.drawer}
          ref={dialog}
          aria-label="Add new contact"
          onCancel={(event) => {
            event.preventDefault();
            dismiss();
          }}
        >
          <header className={styles.drawerHeading}>
            <button
              type="button"
              aria-label="Close"
              disabled={busy || pending}
              onClick={dismiss}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12h17m-7-7 7 7-7 7" />
              </svg>
            </button>
            <h2>Add new contact</h2>
          </header>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <form onSubmit={saveContact}>
            <div className={styles.fields}>
              <input
                name="name"
                aria-label="Type name"
                placeholder="Type name"
                maxLength={DIRECTORY_LIMITS.name}
                disabled={busy || pending}
              />
              <textarea
                name="description"
                aria-label="Description (optional)"
                placeholder="Description (optional)"
                maxLength={DIRECTORY_LIMITS.description}
                disabled={busy || pending}
              />
              <label>
                <span>Phone number</span>
                <input
                  name="phone"
                  aria-label="Phone number"
                  placeholder="Phone number"
                  maxLength={DIRECTORY_LIMITS.phone}
                  disabled={busy || pending}
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  name="email"
                  aria-label="Email"
                  placeholder="Email"
                  maxLength={DIRECTORY_LIMITS.email}
                  disabled={busy || pending}
                />
              </label>
            </div>
            <footer className={styles.drawerFooter}>
              <button className={styles.save} disabled={locked}>
                Save Contact
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </div>
  );
}
