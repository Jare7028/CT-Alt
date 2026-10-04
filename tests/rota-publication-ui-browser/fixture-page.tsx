"use client";
import { useState } from "react";
import Scheduler from "../../app/rotas/scheduler";
export default function Fixture() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button onClick={() => setVisible(false)}>Leave scheduler fixture</button>
      {visible ? (
        <Scheduler
          company={{
            id: "92000000-0000-4000-8000-000000000001",
            name: "Northbank Services",
            time_zone: "UTC",
          }}
          companies={[]}
          actorId="92000000-0000-4000-8000-000000000002"
          role="owner"
        />
      ) : (
        <p>Left scheduler</p>
      )}
    </>
  );
}
