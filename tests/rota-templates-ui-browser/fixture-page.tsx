"use client";
import { useEffect, useState } from "react";
import Scheduler from "../../app/rotas/scheduler";
export default function Fixture() {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() =>
      setRole(new URLSearchParams(location.search).get("role") || "owner"),
    );
  }, []);
  if (!role) return <p>Preparing scheduling fixture…</p>;
  return (
    <Scheduler
      company={{
        id: "91000000-0000-4000-8000-000000000001",
        name: "Northbank Services",
        time_zone: "UTC",
      }}
      companies={[]}
      actorId="91000000-0000-4000-8000-000000000002"
      role={role}
    />
  );
}
