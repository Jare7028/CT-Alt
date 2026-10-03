"use client";
import { useState } from "react";
import DashboardShell from "../../app/components/dashboard-shell";
import TimeOff from "../../app/time-off/time-off";
import { company, actor, people, initialData } from "./fixture-data";
import type { Member } from "../../lib/agent-types";
export default function Fixture() {
  const [role, setRole] = useState<Member["role"]>("owner");
  const [tenant, setTenant] = useState(company);
  const [currentActor, setActor] = useState(actor);
  const [agent, setAgent] = useState(people[0]);
  const [visible, setVisible] = useState(true);
  const [key, setKey] = useState(0);
  return (
    <DashboardShell
      company={tenant}
      companies={[
        company,
        {
          ...company,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Second Example Company",
        },
      ]}
      role={role}
      module="time-off"
    >
      <div
        aria-label="Synthetic Time Off controls"
        style={{ display: "flex", gap: 8, padding: 8 }}
      >
        <button
          onClick={() => setRole(role === "owner" ? "employee" : "owner")}
        >
          Switch synthetic role
        </button>
        <button
          onClick={() =>
            setTenant(
              tenant.id === company.id
                ? {
                    ...company,
                    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    name: "Second Example Company",
                  }
                : company,
            )
          }
        >
          Switch synthetic company
        </button>
        <button
          onClick={() =>
            setActor(
              currentActor === actor
                ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                : actor,
            )
          }
        >
          Switch synthetic actor
        </button>
        <button
          onClick={() =>
            setAgent(agent.id === people[0].id ? people[1] : people[0])
          }
        >
          Relink synthetic user
        </button>
        <button onClick={() => setVisible(!visible)}>
          Toggle synthetic departure
        </button>
        <button onClick={() => setKey(key + 1)}>
          Remount synthetic Time Off
        </button>
      </div>
      {visible ? (
        <TimeOff
          key={key}
          company={tenant}
          role={role}
          initialData={initialData(role, tenant, currentActor, agent)}
        />
      ) : (
        <p>Synthetic departure</p>
      )}
    </DashboardShell>
  );
}
