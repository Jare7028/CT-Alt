"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  ChatPerson,
  Conversation,
  GroupInfo,
  GroupMember,
} from "../../lib/chat-types";
import { mergeMessages } from "../../lib/chat-state";
import "./chat.css";
type Company = { id: string; name: string };
type Pending = { conversationId: string; clientId: string; body: string };
class AccessError extends Error {}
class PostingError extends Error {}
export default function Chat({
  company,
  companies,
  actorId,
  management,
}: {
  company: Company;
  companies: Company[];
  actorId: string;
  management: boolean;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [editPeople, setEditPeople] = useState<GroupMember[]>([]);
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [editAdmins, setEditAdmins] = useState<string[]>([]);
  const [allowPosting, setAllowPosting] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [creating, setCreating] = useState<"direct" | "group" | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const generation = useRef(0);
  const selectedRef = useRef(selected);
  const bottom = useRef<HTMLDivElement>(null);
  const request = useCallback(
    async <T,>(payload: object): Promise<T> => {
      const result = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: company.id, payload }),
        cache: "no-store",
      });
      const response = await result.json();
      if (!result.ok) {
        if (response.kind === "posting_restricted")
          throw new PostingError(response.error);
        if (result.status === 401 || result.status === 403)
          throw new AccessError(response.error);
        throw new Error(response.error || "Chat is unavailable.");
      }
      return response.data;
    },
    [company.id],
  );
  const fail = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "Chat is unavailable.");
    if (reason instanceof PostingError) {
      setConversations((current) =>
        current.map((item) =>
          item.id === selectedRef.current ? { ...item, can_post: false } : item,
        ),
      );
      setPending(null);
    }
    if (reason instanceof AccessError) {
      setInfo(null);
      setEditPeople([]);
      generation.current++;
      selectedRef.current = "";
      setSelected("");
      setMessages([]);
      setConversations([]);
      setPeople([]);
      setBody("");
      setPending(null);
      setCreating(null);
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    let running = false;
    let lastSequence = 0;
    const refresh = async () => {
      if (running) return;
      running = true;
      const token = generation.current;
      try {
        const list = await request<Conversation[]>({ action: "list" });
        if (disposed || token !== generation.current) return;
        setConversations(list);
        if (selected && !list.some((item) => item.id === selected)) {
          fail(new AccessError("Conversation access is unavailable."));
          return;
        }
        if (selected) {
          let latest: ChatMessage[];
          do {
            const initial = lastSequence === 0;
            latest = await request<ChatMessage[]>({
              action: "history",
              conversationId: selected,
              ...(initial ? {} : { after: lastSequence }),
            });
            if (disposed || token !== generation.current) return;
            setMessages((current) => mergeMessages(current, latest));
            if (initial) setHasOlder(latest.length === 100);
            if (latest.length) lastSequence = latest.at(-1)!.sequence;
            // Reconnect can miss more than a page. Drain every new sequence
            // before advancing the read position, without discarding history.
          } while (latest.length === 100);
          if (lastSequence && document.visibilityState === "visible")
            await request({
              action: "read",
              conversationId: selected,
              sequence: lastSequence,
            });
        }
        if (!disposed && token === generation.current) setError("");
      } catch (reason) {
        if (!disposed && token === generation.current) fail(reason);
      } finally {
        running = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    const reconnect = () => void refresh();
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [selected, request, fail]);
  const newestSequence = messages.at(-1)?.sequence;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [newestSequence]);
  const choose = (id: string) => {
    if (id === selected) return;
    generation.current++;
    setBusy(false);
    setCreating(null);
    setInfo(null);
    setEditPeople([]);
    setPeople([]);
    selectedRef.current = id;
    setSelected(id);
    setMessages([]);
    setBody("");
    setPending(null);
    setHasOlder(false);
    setError("");
  };
  const active = conversations.find((item) => item.id === selected);
  async function start(kind: "direct" | "group") {
    const token = ++generation.current;
    setBusy(false);
    setError("");
    setInfo(null);
    setEditPeople([]);
    try {
      const directory = await request<ChatPerson[]>({ action: "directory" });
      if (token !== generation.current) return;
      setPeople(directory);
      setCreating(kind);
      setRestricted(false);
    } catch (reason) {
      if (token === generation.current) fail(reason);
    }
  }
  const cancelCreate = () => {
    generation.current++;
    setCreating(null);
    setPeople([]);
    setBusy(false);
  };
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const token = ++generation.current;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>({
        action: "create",
        kind: creating,
        name: creating === "direct" ? "Direct chat" : form.get("name"),
        description: form.get("description") || "",
        management_only: restricted,
        allow_member_messages:
          creating === "direct" || form.get("allowPosting") === "on",
        members: form.getAll("members"),
      });
      if (token !== generation.current) return;
      setCreating(null);
      setBusy(false);
      choose(result.id);
    } catch (reason) {
      if (token === generation.current) fail(reason);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function send() {
    if (!selected || busy) return;
    const attempt = pending || {
      conversationId: selected,
      clientId: crypto.randomUUID(),
      body,
    };
    const token = generation.current;
    setPending(attempt);
    setBusy(true);
    setError("");
    try {
      const message = await request<ChatMessage>({
        action: "send",
        ...attempt,
      });
      if (token !== generation.current) return;
      setMessages((current) => mergeMessages(current, [message]));
      setPending(null);
      setBody("");
    } catch (reason) {
      if (token === generation.current) fail(reason);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  function closeInfo() {
    generation.current++;
    setInfo(null);
    setEditPeople([]);
    setBusy(false);
  }
  async function openInfo() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setCreating(null);
    try {
      const details = await request<GroupInfo>({
        action: "group_info",
        conversationId: selected,
      });
      if (token !== generation.current) return;
      const directory = details.can_manage
        ? await request<ChatPerson[]>({ action: "directory" })
        : [];
      if (token !== generation.current) return;
      const merged = new Map<string, GroupMember>(
        details.members.map((person) => [person.user_id, person]),
      );
      directory
        .filter(
          (person) =>
            !details.management_only ||
            ["owner", "admin", "manager"].includes(person.role),
        )
        .forEach((person) => {
          if (!merged.has(person.user_id))
            merged.set(person.user_id, {
              ...person,
              status: "active",
              group_admin: false,
            });
        });
      setInfo(details);
      setEditPeople([...merged.values()]);
      setEditMembers(details.members.map((person) => person.user_id));
      setEditAdmins(
        details.members
          .filter((person) => person.group_admin)
          .map((person) => person.user_id),
      );
      setAllowPosting(details.allow_member_messages);
    } catch (reason) {
      if (token === generation.current) fail(reason);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function saveGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!info || busy) return;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      await request({
        action: "manage_group",
        conversationId: info.id,
        revision: info.settings_revision,
        members: editMembers,
        group_admins: editAdmins.filter((id) => editMembers.includes(id)),
        allow_member_messages: allowPosting,
      });
      if (token !== generation.current) return;
      setInfo(null);
      setEditPeople([]);
      if (!editMembers.includes(actorId)) choose("");
      else {
        const list = await request<Conversation[]>({ action: "list" });
        if (token !== generation.current) return;
        setConversations(list);
      }
    } catch (reason) {
      if (token === generation.current) fail(reason);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function older() {
    const token = generation.current;
    try {
      const page = await request<ChatMessage[]>({
        action: "history",
        conversationId: selected,
        before: messages[0]?.sequence,
      });
      if (token !== generation.current) return;
      setMessages((current) => mergeMessages(current, page));
      setHasOlder(page.length === 100);
    } catch (reason) {
      if (token === generation.current) fail(reason);
    }
  }
  return (
    <main className="chat-app">
      <header>
        <span className="mark">C</span>
        <span>CT Alt</span>
        <Link href="/agents">Users</Link>
        <label className="chat-company">
          Company{" "}
          <select
            value={company.id}
            onChange={(event) => {
              router.push(`/chat?company=${event.target.value}`);
            }}
          >
            {companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="chat-title">
        <h1>Chat</h1>
      </div>
      {error && <p role="alert">{error}</p>}
      {creating && (
        <form
          className="chat-create"
          onSubmit={create}
          aria-label={creating === "direct" ? "New Chat" : "New Group"}
        >
          <h2>{creating === "direct" ? "New Chat" : "New Group"}</h2>
          {creating === "group" && (
            <>
              <label>
                Group name
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Description
                <textarea name="description" maxLength={1000} />
              </label>
              <label>
                <input type="checkbox" name="allowPosting" defaultChecked />
                Allow members to send messages
              </label>
              {management && (
                <label>
                  <input
                    type="checkbox"
                    checked={restricted}
                    onChange={(event) => setRestricted(event.target.checked)}
                  />
                  Management members only
                </label>
              )}
            </>
          )}
          <fieldset>
            <legend>Selected Users</legend>
            {people
              .filter(
                (person) =>
                  person.user_id !== actorId &&
                  (!restricted ||
                    ["owner", "admin", "manager"].includes(person.role)),
              )
              .map((person) => (
                <label key={person.user_id}>
                  <input
                    name="members"
                    type={creating === "direct" ? "radio" : "checkbox"}
                    value={person.user_id}
                  />
                  {person.display_name}
                </label>
              ))}
          </fieldset>
          <button disabled={busy}>Create</button>
          <button type="button" onClick={cancelCreate}>
            Cancel
          </button>
        </form>
      )}
      {info && (
        <form className="chat-info" aria-label="Chat Info" onSubmit={saveGroup}>
          <h2>Chat Info — {info.name}</h2>
          <p>{info.description}</p>
          <p>New members can read earlier messages.</p>
          <fieldset>
            <legend>{info.can_manage ? "Edit Team" : "Members"}</legend>
            {editPeople
              .filter(
                (person) =>
                  info.can_manage || editMembers.includes(person.user_id),
              )
              .map((person) => (
                <div key={person.user_id} className="chat-info-person">
                  <label>
                    {info.can_manage && (
                      <input
                        type="checkbox"
                        aria-label={person.display_name}
                        checked={editMembers.includes(person.user_id)}
                        onChange={(event) => {
                          setEditMembers((current) =>
                            event.target.checked
                              ? [...current, person.user_id]
                              : current.filter((id) => id !== person.user_id),
                          );
                          if (!event.target.checked)
                            setEditAdmins((current) =>
                              current.filter((id) => id !== person.user_id),
                            );
                        }}
                      />
                    )}
                    {person.display_name}
                    {person.status !== "active" && " (Suspended)"}
                    {["owner", "admin"].includes(person.role) &&
                      " (Company admin access)"}
                  </label>
                  {info.can_manage ? (
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Group admin: ${person.display_name}`}
                        checked={editAdmins.includes(person.user_id)}
                        disabled={
                          !editMembers.includes(person.user_id) ||
                          (person.status !== "active" && !person.group_admin)
                        }
                        onChange={(event) =>
                          setEditAdmins((current) =>
                            event.target.checked
                              ? [...current, person.user_id]
                              : current.filter((id) => id !== person.user_id),
                          )
                        }
                      />
                      Group admin
                    </label>
                  ) : (
                    person.group_admin && <span>Group admin</span>
                  )}
                </div>
              ))}
          </fieldset>
          {info.can_manage ? (
            <label>
              <input
                type="checkbox"
                checked={allowPosting}
                onChange={(event) => setAllowPosting(event.target.checked)}
              />
              Allow members to send messages
            </label>
          ) : (
            <p>
              {info.allow_member_messages
                ? "Members can send messages."
                : "Only group admins can send messages."}
            </p>
          )}
          {info.can_manage && (
            <button disabled={busy || editMembers.length === 0}>
              Save changes
            </button>
          )}
          <button type="button" onClick={closeInfo}>
            Close Chat Info
          </button>
        </form>
      )}
      <div className="chat-workspace">
        <aside aria-label="Conversations">
          <div className="chat-list-toolbar">
            {" "}
            <details>
              <summary>Add New</summary>
              <button onClick={() => void start("direct")}>New Chat</button>
              <button onClick={() => void start("group")}>New Group</button>
            </details>
          </div>
          <label className="chat-search">
            Search conversations
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
            />
          </label>
          {conversations.length === 0 && (
            <p>No conversations yet. Use Add New to start a chat.</p>
          )}
          {conversations
            .filter((item) =>
              item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((item) => (
              <button
                key={item.id}
                className={selected === item.id ? "selected" : ""}
                onClick={() => choose(item.id)}
                aria-pressed={selected === item.id}
              >
                <span className="chat-avatar" aria-hidden="true">
                  {item.name.slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="chat-list-copy">
                  <strong>{item.name}</strong>
                  {item.preview && (
                    <small className="chat-preview">{item.preview}</small>
                  )}
                </span>
                {item.management_only && <small>Management group</small>}
                {item.unread > 0 && (
                  <span
                    className="chat-unread"
                    aria-label={`${item.unread} unread messages`}
                  >
                    {item.unread}
                  </span>
                )}
              </button>
            ))}
        </aside>
        <section aria-label="Conversation" className="chat-conversation">
          {active ? (
            <>
              <div className="chat-heading">
                <div className="chat-heading-name">
                  <span className="chat-avatar" aria-hidden="true">
                    {active.name.slice(0, 1).toLocaleUpperCase()}
                  </span>
                  <div>
                    <h2>{active.name}</h2>
                    {active.kind === "group" && (
                      <small>{active.member_count} Members</small>
                    )}
                  </div>
                </div>
                {active.kind === "group" && (
                  <button disabled={busy} onClick={() => void openInfo()}>
                    Chat Info
                  </button>
                )}
                {active.description && <p>{active.description}</p>}
              </div>
              <div className="chat-history" role="log" aria-label="Messages">
                {hasOlder && (
                  <button onClick={() => void older()}>
                    Load earlier messages
                  </button>
                )}
                {messages.length === 0 && <p>Start the conversation.</p>}
                {messages.map((message) => (
                  <article
                    key={message.sequence}
                    className={message.sender_id === actorId ? "mine" : ""}
                  >
                    <strong>{message.sender_name}</strong>
                    <p>{message.body}</p>
                    <time dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </article>
                ))}
                <div ref={bottom} />
              </div>
              {active.can_post === false ? (
                <p className="chat-posting-notice">
                  Only group admins can send messages in this group.
                </p>
              ) : (
                <form
                  className="chat-compose"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  <label htmlFor="chat-message">Message</label>
                  <textarea
                    id="chat-message"
                    value={pending?.body ?? body}
                    readOnly={!!pending}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={4000}
                    placeholder="Write a message…"
                  />
                  <button disabled={busy || !(pending?.body ?? body).trim()}>
                    {busy ? "Sending…" : pending ? "Retry send" : "Send"}
                  </button>
                  {pending && !busy && (
                    <p>Retry uses the same message ID to prevent duplicates.</p>
                  )}
                </form>
              )}
            </>
          ) : (
            <p>Select a conversation or start a new chat.</p>
          )}
        </section>
      </div>
    </main>
  );
}
