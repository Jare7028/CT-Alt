"use client";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import Scheduler from "../../app/rotas/scheduler";
import PeriodTemplates from "../../app/rotas/period-templates";
const subscribe = () => () => {};
const readRole = () =>
  new URLSearchParams(location.search).get("role") === "owner"
    ? "owner"
    : "manager";
const serverRole = () => "manager";
const readKind = () =>
  new URLSearchParams(location.search).get("kind") === "day"
    ? ("day" as const)
    : ("week" as const);
const serverKind = () => "week" as const;
const readParent = () => new URLSearchParams(location.search).has("parent");
const serverParent = () => false;
export default function Fixture() {
  const parent = useSyncExternalStore(subscribe, readParent, serverParent);
  const initialKind = useSyncExternalStore(subscribe, readKind, serverKind);
  const initialRole = useSyncExternalStore(subscribe, readRole, serverRole);
  const [roleOverride, setRoleOverride] = useState<string | null>(null);
  const role = roleOverride || initialRole;
  const [mode, setMode] = useState("save");
  const [open, setOpen] = useState(true),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0),
    owned = useRef(false);
  const lock = useCallback((value: boolean) => {
    owned.current = value;
    setLocked(value);
  }, []);
  const access = useCallback(() => generation.current, []);
  const acquire = useCallback(() => {
    owned.current = true;
    return true;
  }, []);
  if (parent)
    return (
      <Scheduler
        company={{
          id: "93000000-0000-4000-8000-000000000001",
          name: "Northbank Services",
          time_zone: "UTC",
        }}
        companies={[]}
        actorId="93000000-0000-4000-8000-000000000002"
        role="owner"
      />
    );
  return (
    <>
      <button
        onClick={() => {
          generation.current++;
          setOpen(false);
        }}
      >
        Leave scheduler fixture
      </button>
      <button
        onClick={() => setRoleOverride(role === "owner" ? "manager" : "owner")}
      >
        Change current role
      </button>
      <p>Current fixture role: {role}</p>
      {["save", "catalog", "load"].map((value) => (
        <button
          key={value}
          disabled={locked}
          onClick={() => {
            setMode(value);
            setOpen(true);
          }}
        >
          Open {value}
        </button>
      ))}
      <button disabled={locked}>Competing scheduling write</button>
      <p role="status">{message}</p>
      {open && (
        <PeriodTemplates
          key={role + mode}
          tenantId="93000000-0000-4000-8000-000000000001"
          actorId="93000000-0000-4000-8000-000000000002"
          role={role}
          schedule={{
            id: "93000000-0000-4000-8000-000000000003",
            tenant_id: "93000000-0000-4000-8000-000000000001",
            name: "Reception team",
            revision: 1,
            time_zone: "UTC",
            status: "active",
          }}
          kind={initialKind}
          day="2026-10-05"
          sourceAnchor="2026-10-05"
          sourceFilters={{ jobId: null, status: "all", workerSearch: "" }}
          saveSource={mode === "save"}
          loadMode={mode === "load"}
          agents={[
            {
              id: "93000000-0000-4000-8000-000000000004",
              first_name: "Maya",
              last_name: "Ellis",
              status: "active",
            },
            {
              id: "93000000-0000-4000-8000-000000000007",
              first_name: "Noah",
              last_name: "Bennett",
              status: "active",
            },
          ]}
          close={() => setOpen(false)}
          singleTab={() => setOpen(false)}
          reload={async () => true}
          applied={(_, message) => setMessage(message)}
          denied={() => {
            generation.current++;
            setOpen(false);
            setMessage("Access changed");
          }}
          locked={lock}
          acquireWrite={acquire}
          accessGeneration={access}
        />
      )}
    </>
  );
}
