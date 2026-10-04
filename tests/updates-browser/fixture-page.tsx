"use client";
import { useState } from "react";
import DashboardShell from "../../app/components/dashboard-shell";
import Updates from "../../app/updates/updates";
import { company, actor, employee, initialData } from "./fixture-data";
import type { Member } from "../../lib/agent-types";
export default function Fixture() {
  const [role, setRole] = useState<Member["role"]>("owner");
  const [tenant, setTenant] = useState(company);
  const [currentActor, setActor] = useState(actor);
  const [visible, setVisible] = useState(true);
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
      module="updates"
    >
      <div
        aria-label="Synthetic Updates controls"
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
          onClick={() => setActor(currentActor === actor ? employee : actor)}
        >
          Switch synthetic actor
        </button>
        <button onClick={() => setVisible(!visible)}>
          Toggle synthetic departure
        </button>
      </div>
      {visible ? (
        <Updates
          company={tenant}
          role={role}
          initialData={initialData(role, tenant, currentActor)}
        />
      ) : (
        <p>Synthetic departure</p>
      )}
    </DashboardShell>
  );
}
