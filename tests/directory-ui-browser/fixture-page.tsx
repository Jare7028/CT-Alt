"use client";
import { useState, useSyncExternalStore } from "react";
import type { Member } from "../../lib/agent-types";
import Directory from "../../app/directory/directory";
import DashboardShell from "../../app/components/dashboard-shell";
const subscribe = () => () => {};
const readRole = (): Member["role"] => {
  const value = new URLSearchParams(location.search).get("role");
  return value === "manager" || value === "employee" || value === "admin"
    ? value
    : "owner";
};
const serverRole = (): Member["role"] => "owner";
export default function Fixture() {
  const initialRole = useSyncExternalStore(subscribe, readRole, serverRole);
  const [roleOverride, setRole] = useState<Member["role"] | null>(null),
    [open, setOpen] = useState(true),
    [otherCompany, setOtherCompany] = useState(false),
    [otherActor, setOtherActor] = useState(false);
  const role = roleOverride || initialRole;
  const company = {
    id: otherCompany
      ? "94000000-0000-4000-8000-000000000009"
      : "94000000-0000-4000-8000-000000000001",
    name: otherCompany ? "Riverside Services" : "Northbank Services",
    time_zone: "UTC",
  };
  const actorId = otherActor
    ? "94000000-0000-4000-8000-000000000008"
    : "94000000-0000-4000-8000-000000000002";
  return (
    <>
      <div data-fixture-controls>
        <button onClick={() => setOpen(false)}>Leave Directory fixture</button>
        <button onClick={() => setOpen(true)}>Open Directory fixture</button>
        <button onClick={() => setRole(role === "owner" ? "manager" : "owner")}>
          Change current role
        </button>
        <button onClick={() => setOtherCompany((value) => !value)}>
          Change current company
        </button>
        <button onClick={() => setOtherActor((value) => !value)}>
          Change current actor
        </button>
      </div>
      <DashboardShell
        company={company}
        companies={[company]}
        role={role}
        module="directory"
      >
        {open && <Directory company={company} actorId={actorId} role={role} />}
      </DashboardShell>
    </>
  );
}
