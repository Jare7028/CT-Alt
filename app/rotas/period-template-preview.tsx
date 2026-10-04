import { useState } from "react";
import { addDays } from "../../lib/rota-time";
import styles from "./period-templates.module.css";
export type PeriodPreviewRow = {
  index: number;
  worker: string;
  workerId: string;
  job: string;
  color: string;
  title: string;
  startOffset: number;
  endOffset: number;
  startMicros: number;
  endMicros: number;
  originalStart: string;
  originalEnd: string;
  currentWorker?: string | null;
  currentJob?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  elapsedMicros?: number | null;
  reasons?: string[];
  startFold?: boolean;
  endFold?: boolean;
};
export function previewClock(micros: number) {
  const minutes = Math.floor(micros / 60_000_000);
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}
export function elapsedHours(micros: number) {
  return previewClock(micros);
}
export default function PeriodTemplatePreview({
  rows,
  kind,
  total,
  users,
  elapsedMicros,
  anchor,
  roster = [],
  loading = false,
}: {
  rows: PeriodPreviewRow[];
  kind: "day" | "week";
  total: number;
  users: number;
  elapsedMicros: number;
  anchor: string;
  roster?: { id: string; name: string }[];
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  const count = kind === "week" ? 7 : 1;
  const offsets = Array.from({ length: count }, (_, index) => index);
  const cells = new Map<string, PeriodPreviewRow[]>();
  const populated = new Set<string>();
  for (const row of rows)
    for (const offset of offsets) {
      const low = Math.min(row.startOffset, row.endOffset),
        high = Math.max(row.startOffset, row.endOffset);
      if (
        offset < low ||
        offset > high ||
        (offset === row.endOffset &&
          row.endMicros === 0 &&
          row.startOffset < row.endOffset)
      )
        continue;
      const key = `${row.workerId}:${offset}`,
        entries = cells.get(key) || [];
      entries.push(row);
      cells.set(key, entries);
      populated.add(row.workerId);
    }
  const workers = [
    ...new Map([
      ...roster.map((worker) => [worker.id, worker] as const),
      ...rows.map(
        (row) =>
          [row.workerId, { id: row.workerId, name: row.worker }] as const,
      ),
    ]).values(),
  ].filter(
    (worker) =>
      (!hideEmpty || populated.has(worker.id)) &&
      worker.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <div className={styles.actions}>
        <input
          aria-label="Search by name"
          placeholder="Search by name"
          value={search}
          maxLength={100}
          disabled={loading}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            role="switch"
            checked={hideEmpty}
            disabled={loading}
            onChange={(event) => setHideEmpty(event.target.checked)}
          />
          Hide empty rows
        </label>
      </div>
      <div className={styles.scroll} aria-busy={loading}>
        <table
          className={styles.grid}
          aria-label={kind === "week" ? "Weekly Template" : "Template"}
        >
          <thead>
            <tr>
              <th scope="col"></th>
              {offsets.map((offset) => (
                <th scope="col" key={offset}>
                  {kind === "week"
                    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][offset]
                    : addDays(anchor, offset)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workers.map((worker) => (
              <tr key={worker.id}>
                <th scope="row">{worker.name}</th>
                {offsets.map((offset) => (
                  <td key={offset}>
                    {(cells.get(`${worker.id}:${offset}`) || []).map((row) => (
                      <div
                        key={row.index}
                        className={styles.shift}
                        style={{ borderColor: row.color }}
                      >
                        <strong>{row.title || row.job}</strong>
                        <div>
                          <span className={styles.clock}>
                            {previewClock(row.startMicros)}
                          </span>{" "}
                          –{" "}
                          <span className={styles.clock}>
                            {previewClock(row.endMicros)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.summary} aria-label="Template totals">
          {kind === "week" && <strong>Weekly summary</strong>}
          <span>
            Hours <strong>{elapsedHours(elapsedMicros)}</strong>
          </span>
          <span>
            Shifts <strong>{total}</strong>
          </span>
          <span>
            Users <strong>{users}</strong>
          </span>
        </div>
      </div>
    </>
  );
}
