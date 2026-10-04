"use client";
import { useState } from "react";
import DashboardShell from "../../app/components/dashboard-shell";
import KnowledgeBase from "../../app/knowledge-base/knowledge-base";
import { company, actor, otherActor, initialData } from "./fixture-data";
import type { Member } from "../../lib/agent-types";
export default function Fixture() {
  const [tenant, setTenant] = useState(company),
    [currentActor, setActor] = useState(actor),
    [role, setRole] = useState<Member["role"]>("owner"),
    [visible, setVisible] = useState(true);
  return (
    <DashboardShell
      company={tenant}
      companies={[company]}
      role={role}
      module="knowledge-base"
    >
      <div
        aria-label="Synthetic Knowledge Base controls"
        style={{ display: "flex", gap: 8, padding: 8 }}
      >
        <button
          onClick={() => setActor(currentActor === actor ? otherActor : actor)}
        >
          Switch synthetic actor
        </button>
        <button
          onClick={() =>
            setTenant(
              tenant.id === company.id
                ? {
                    ...company,
                    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
                    name: "Second Example Company",
                  }
                : company,
            )
          }
        >
          Switch synthetic company
        </button>
        <button onClick={() => setRole(role === "owner" ? "manager" : "owner")}>
          Switch synthetic role
        </button>
        <button onClick={() => setVisible(!visible)}>
          Toggle synthetic departure
        </button>
      </div>
      {visible ? (
        <KnowledgeBase
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
