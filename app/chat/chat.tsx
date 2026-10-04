"use client";
import AppShell from "../components/app-shell";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  ChatPerson,
  Conversation,
  GroupInfo,
  GroupMember,
} from "../../lib/chat-types";
import type {
  ChatSearchData,
  ChatSearchMessage,
} from "../../lib/chat-search-types";
import { mergeMessages } from "../../lib/chat-state";
import "./chat.css";
type Company = { id: string; name: string };
type Pending = { conversationId: string; clientId: string; body: string };
class AccessError extends Error {}
class PostingError extends Error {}
type ChatProps = {
  company: Company;
  companies: Company[];
  actorId: string;
  management: boolean;
  canViewActivity?: boolean;
};
export default function Chat(props: ChatProps) {
  return (
    <ChatContent key={`${props.company.id}:${props.actorId}`} {...props} />
  );
}
function ChatContent({
  company,
  companies,
  actorId,
  management,
  canViewActivity = false,
}: ChatProps) {
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
  const [messageQuery, setMessageQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchMessages, setSearchMessages] = useState<ChatSearchMessage[]>([]);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchEpoch = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const searchModeRef = useRef(false);
  const mounted = useRef(true);
  const invalidateSearch = useCallback(() => {
    searchEpoch.current++;
    searchController.current?.abort();
    searchController.current = null;
    setSearchLoading(false);
    setSearchMessages([]);
    setSearchTotal(null);
    setSearchCursor(null);
    setSearchedQuery("");
    setSearchError("");
  }, []);
  const clearSearch = useCallback(() => {
    invalidateSearch();
    searchModeRef.current = false;
    setSearchMode(false);
    setMessageQuery("");
  }, [invalidateSearch]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      searchController.current?.abort();
    };
  }, []);
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
      const response = (await result.json().catch(() => {
        if (result.status === 401 || result.status === 403) return {};
        throw new Error("Chat is unavailable.");
      })) ?? {};
      if (!result.ok) {
        if (response.kind === "posting_restricted")
          throw new PostingError(response.error);
        if (result.status === 401 || result.status === 403)
          throw new AccessError(
            response.error || "Conversation access is unavailable.",
          );
        throw new Error(response.error || "Chat is unavailable.");
      }
      return response.data;
    },
    [company.id],
  );
  const fail = useCallback(
    (reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Chat is unavailable.",
      );
      if (reason instanceof PostingError) {
        // A list requested before this denial may still claim posting is allowed.
        // Invalidate its response before hiding the composer.
        generation.current++;
        clearSearch();
        setBusy(false);
        setConversations((current) =>
          current.map((item) =>
            item.id === selectedRef.current
              ? { ...item, can_post: false }
              : item,
          ),
        );
        setPending(null);
      }
      if (reason instanceof AccessError) {
        clearSearch();
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
    },
    [clearSearch],
  );
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
        if (selected && !searchModeRef.current) {
          let latest: ChatMessage[];
          do {
            const initial = lastSequence === 0;
            latest = await request<ChatMessage[]>({
              action: "history",
              conversationId: selected,
              ...(initial ? {} : { after: lastSequence }),
            });
            if (
              disposed ||
              token !== generation.current ||
              searchModeRef.current
            )
              return;
            setMessages((current) => mergeMessages(current, latest));
            if (initial) setHasOlder(latest.length === 100);
            if (latest.length) lastSequence = latest.at(-1)!.sequence;
            // Reconnect can miss more than a page. Drain every new sequence
            // before advancing the read position, without discarding history.
          } while (latest.length === 100);
          if (
            lastSequence &&
            !searchModeRef.current &&
            document.visibilityState === "visible"
          )
            await request({
              action: "read",
              conversationId: selected,
              sequence: lastSequence,
            });
        }
        if (!disposed && token === generation.current) setError("");
      } catch (reason) {
        // Switching into search pauses history, but a denial from a history
        // request already in flight still governs this same conversation.
        if (
          mounted.current &&
          token === generation.current &&
          (!disposed ||
            (reason instanceof AccessError && selectedRef.current === selected))
        )
          fail(reason);
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
  }, [selected, request, fail, searchMode]);
  async function searchConversation(older = false) {
    if (!selected || busy || (older && (!searchCursor || searchLoading)))
      return;
    const normalized = older ? searchedQuery : messageQuery.trim();
    if (!normalized || normalized.length > 100) return;
    const cursor = older ? searchCursor : null;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const epoch = ++searchEpoch.current;
    const token = generation.current;
    searchModeRef.current = true;
    setSearchMode(true);
    setSearchedQuery(normalized);
    setSearchLoading(true);
    setSearchError("");
    if (!older) {
      setSearchMessages([]);
      setSearchTotal(null);
      setSearchCursor(null);
    }
    try {
      const params = new URLSearchParams({
        tenantId: company.id,
        conversationId: selected,
        query: normalized,
      });
      if (cursor) params.set("cursor", cursor);
      const result = await fetch(`/api/chat/search?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const response = (await result.json().catch(() => ({}))) ?? {};
      if (
        controller.signal.aborted ||
        epoch !== searchEpoch.current ||
        token !== generation.current
      )
        return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403)
          throw new AccessError(
            response.error || "Conversation access is unavailable.",
          );
        throw new Error(
          response.error || "Message search is unavailable. Try again.",
        );
      }
      const data = response as ChatSearchData;
      if (
        !data ||
        data.tenantId !== company.id ||
        data.actorId !== actorId ||
        data.conversationId !== selected ||
        data.query !== normalized ||
        !Number.isSafeInteger(data.total) ||
        data.total < 0 ||
        !Array.isArray(data.messages) ||
        data.total < data.messages.length ||
        !(
          data.nextCursor === null ||
          (typeof data.nextCursor === "string" && data.nextCursor.length > 0)
        ) ||
        (data.nextCursor !== null && data.messages.length === 0)
      )
        throw new Error(
          "Message search returned an invalid response. Try again.",
        );
      let previous: bigint | null =
        older && searchMessages.length
          ? BigInt(searchMessages.at(-1)!.sequence)
          : null;
      for (const message of data.messages) {
        if (
          !message ||
          typeof message !== "object" ||
          message.conversation_id !== selected ||
          typeof message.sequence !== "string" ||
          !/^[1-9][0-9]{0,18}$/.test(message.sequence) ||
          BigInt(message.sequence) > 9223372036854775807n ||
          (previous !== null && BigInt(message.sequence) >= previous) ||
          typeof message.body !== "string" ||
          typeof message.sender_name !== "string" ||
          typeof message.sender_id !== "string" ||
          typeof message.created_at !== "string" ||
          !Number.isFinite(Date.parse(message.created_at))
        )
          throw new Error(
            "Message search returned an invalid response. Try again.",
          );
        previous = BigInt(message.sequence);
      }
      setSearchMessages((current) => {
        const seen = new Set(current.map((message) => message.sequence));
        return older
          ? [
              ...current,
              ...data.messages.filter((message) => !seen.has(message.sequence)),
            ]
          : data.messages;
      });
      setSearchTotal(data.total);
      setSearchCursor(data.nextCursor);
    } catch (reason) {
      if (
        controller.signal.aborted ||
        epoch !== searchEpoch.current ||
        token !== generation.current
      )
        return;
      if (reason instanceof AccessError) fail(reason);
      else
        setSearchError(
          reason instanceof Error
            ? reason.message
            : "Message search is unavailable. Try again.",
        );
    } finally {
      if (epoch === searchEpoch.current && token === generation.current) {
        setSearchLoading(false);
        searchController.current = null;
      }
    }
  }
  const newestSequence = messages.at(-1)?.sequence;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [newestSequence]);
  const choose = (id: string) => {
    if (id === selected) return;
    generation.current++;
    clearSearch();
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
    clearSearch();
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
    clearSearch();
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
    clearSearch();
    generation.current++;
    setInfo(null);
    setEditPeople([]);
    setBusy(false);
  }
  async function openInfo() {
    clearSearch();
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
    clearSearch();
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
    <AppShell
      companyName={company.name}
      companyId={company.id}
      activeModule="chat"
      moduleLinks={{
        requests: `/requests?company=${encodeURIComponent(company.id)}`,
        forms: `/forms?company=${encodeURIComponent(company.id)}`,
        "knowledge-base": `/knowledge-base?company=${encodeURIComponent(company.id)}`,
        "smart-groups": canViewActivity ? `/smart-groups?company=${encodeURIComponent(company.id)}` : undefined,
        updates: `/updates?company=${encodeURIComponent(company.id)}`,
        "time-off": `/time-off?company=${encodeURIComponent(company.id)}`,
        "quick-tasks": `/quick-tasks?company=${encodeURIComponent(company.id)}`,
        "time-clock": `/time-clock?company=${encodeURIComponent(company.id)}`,
        overview: management
          ? `/overview?company=${encodeURIComponent(company.id)}`
          : undefined,
        activity: canViewActivity
          ? `/activity?company=${encodeURIComponent(company.id)}`
          : undefined,
        chat: `/chat?company=${encodeURIComponent(company.id)}`,
        rotas: `/rotas?company=${encodeURIComponent(company.id)}`,
      }}
      companyControl={
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
      }
    >
    <main className="chat-app">
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
        <form
          className="chat-info"
          aria-label="Chat Info"
          onSubmit={saveGroup}
        >
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
              item.name
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
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
              <form
                className="chat-message-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchConversation();
                }}
              >
                <label htmlFor="chat-message-search">
                  Search this conversation
                </label>
                <input
                  id="chat-message-search"
                  type="search"
                  maxLength={100}
                  value={messageQuery}
                  placeholder="Find a message…"
                  disabled={busy}
                  onChange={(event) => {
                    invalidateSearch();
                    setMessageQuery(event.target.value);
                    if (!event.target.value.trim()) clearSearch();
                  }}
                />
                <button
                  disabled={busy || !messageQuery.trim() || searchLoading}
                >
                  Search messages
                </button>
                {(messageQuery || searchMode) && (
                  <button type="button" onClick={clearSearch}>
                    Clear search
                  </button>
                )}
              </form>
              {searchMode ? (
                <section
                  className="chat-message-results"
                  aria-label="Message search results"
                  aria-busy={searchLoading}
                >
                  <div className="chat-results-heading">
                    <h3>
                      {searchedQuery
                        ? `Results for “${searchedQuery}”`
                        : "Message search"}
                    </h3>
                    {searchTotal !== null && (
                      <p>
                        {searchTotal}{" "}
                        {searchTotal === 1
                          ? "matching message"
                          : "matching messages"}{" "}
                        · Newest first
                      </p>
                    )}
                    {!searchedQuery && (
                      <p>
                        Search to view matching messages in this conversation.
                      </p>
                    )}
                    {searchError && <p role="alert">{searchError}</p>}
                    {searchLoading && (
                      <p role="status">
                        {searchMessages.length
                          ? "Loading older results…"
                          : "Searching messages…"}
                      </p>
                    )}
                    {searchTotal === 0 && !searchLoading && !searchError && (
                      <p>No matching messages in this conversation.</p>
                    )}
                  </div>
                  {searchMessages.map((message) => (
                    <article
                      key={message.sequence}
                      data-sequence={message.sequence}
                    >
                      <strong>{message.sender_name}</strong>
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      <p>{message.body}</p>
                    </article>
                  ))}
                  {searchCursor && (
                    <button
                      disabled={searchLoading || busy}
                      onClick={() => void searchConversation(true)}
                    >
                      Load older results
                    </button>
                  )}
                </section>
              ) : (
                <div
                  className="chat-history"
                  role="log"
                  aria-label="Messages"
                >
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
              )}
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
                    <p>
                      Retry uses the same message ID to prevent duplicates.
                    </p>
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
    </AppShell>
  );
}
