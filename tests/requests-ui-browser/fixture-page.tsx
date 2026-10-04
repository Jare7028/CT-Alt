"use client";
import { useEffect, useState } from "react";
import Requests from "../../app/requests/requests";
import AppShell from "../../app/components/app-shell";
import type { RequestsBoardData } from "../../lib/requests-types";
import { board, otherTenant, otherActor } from "./fixture-data";
export default function Fixture() {
  const [data, setData] = useState<RequestsBoardData | null>(null),
    [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setData(
          board(
            new URLSearchParams(location.search).get("scenario") || "owner",
          ),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  if (!data) return <p>Preparing synthetic Requests…</p>;
  return (
    <AppShell
      activeModule="overview"
      companyName={data.company.name}
      companyId={data.company.id}
      accountName="Alex Demo"
    >
      <div style={{ padding: "4px 20px", display: "flex", gap: 12 }}>
        <button
          onClick={() =>
            setData({
              ...board(),
              company: {
                ...data.company,
                id: otherTenant,
                name: "Other Synthetic Company",
              },
              columns: {
                new: { requests: [], nextCursor: null },
                in_progress: { requests: [], nextCursor: null },
                done: { requests: [], nextCursor: null },
              },
              counts: { new: 0, in_progress: 0, done: 0, total: 0 },
            })
          }
        >
          Switch synthetic company
        </button>
        <button
          onClick={() =>
            setData({
              ...board(),
              actorId: otherActor,
              columns: {
                new: { requests: [], nextCursor: null },
                in_progress: { requests: [], nextCursor: null },
                done: { requests: [], nextCursor: null },
              },
              counts: { new: 0, in_progress: 0, done: 0, total: 0 },
            })
          }
        >
          Switch synthetic actor
        </button>
        <button onClick={() => setVisible(false)}>
          Leave synthetic Requests
        </button>
      </div>
      {visible ? (
        <Requests company={data.company} role={data.role} initialData={data} />
      ) : (
        <p>Left Requests</p>
      )}
    </AppShell>
  );
}
