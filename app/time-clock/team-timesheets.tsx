'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Company } from '../../lib/agent-types';
import type { TeamTimesheetData, TeamTimesheetFilters } from '../../lib/team-timesheet-types';
import './team-timesheets.css';
type Props = { company: Company; actorId: string; onAccessDenied: () => void };
function calendarDates(timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return { startDate: `${parts.year}-${parts.month}-01`, endDate: `${parts.year}-${parts.month}-${parts.day}`, agentId: null };
}
function duration(value: number) {
  const seconds = Math.floor(value); return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function queryString(companyId: string, filters: TeamTimesheetFilters, cursor?: string | null) {
  const query = new URLSearchParams({ tenantId: companyId, startDate: filters.startDate, endDate: filters.endDate });
  if (filters.agentId) query.set('agentId', filters.agentId); if (cursor) query.set('cursor', cursor); return query;
}
export default function TeamTimesheets(props: Props) { return <TeamReview key={`${props.company.id}:${props.actorId}`} {...props}/>; }
function TeamReview({ company, actorId, onAccessDenied }: Props) {
  const [draft, setDraft] = useState<TeamTimesheetFilters>(() => calendarDates(company.time_zone));
  const [applied, setApplied] = useState(draft); const [data, setData] = useState<TeamTimesheetData | null>(null);
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), current = useRef<TeamTimesheetData | null>(null), request = useRef<AbortController | null>(null), exportRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (filters: TeamTimesheetFilters, cursor: string | null = null) => {
    if (exportRequest.current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const previous = cursor ? current.current : null;
    setLoading(true); setError(''); setNotice(''); setApplied(filters);
    if (!cursor) { current.current = null; setData(null); }
    try {
      if (!filters.startDate || !filters.endDate || filters.startDate > filters.endDate) throw new Error('Choose a start date on or before the end date.');
      const response = await fetch(`/api/team-timesheets?${queryString(company.id, filters, cursor)}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) { if ((response.status === 401 || response.status === 403) && mounted.current && !controller.signal.aborted && request.current === controller) { onAccessDenied(); return; } const failure = await response.json(); throw new Error(failure.error || 'Team timesheets could not be loaded. Refresh the review.'); }
      const next = await response.json() as TeamTimesheetData;
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return;
      if (next.company.id !== company.id || next.actorId !== actorId || !['owner', 'admin'].includes(next.role) ||
        next.filters.startDate !== filters.startDate || next.filters.endDate !== filters.endDate || next.filters.agentId !== filters.agentId ||
        next.entries.some(entry => entry.tenant_id !== company.id) || cursor && (!previous || previous.datasetVersion !== next.datasetVersion || previous.timeZone !== next.timeZone)) throw new Error('The timesheet scope changed. Refresh the review before continuing.');
      const combined = { ...next, entries: previous ? [...previous.entries, ...next.entries.filter(entry => !previous.entries.some(item => item.id === entry.id))] : next.entries };
      current.current = combined; setData(combined);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && request.current === controller) { current.current = null; setData(null); setError(cause instanceof Error ? cause.message : 'Team timesheets could not be loaded.'); }
    } finally { if (mounted.current && !controller.signal.aborted && request.current === controller) setLoading(false); }
  }, [company.id, actorId, onAccessDenied]);
  useEffect(() => {
    mounted.current = true; const initial = calendarDates(company.time_zone);
    const timer = setTimeout(() => { void load(initial); }, 0);
    return () => { mounted.current = false; clearTimeout(timer); request.current?.abort(); exportRequest.current?.abort(); };
  }, [company.time_zone, load]);
  async function download() {
    if (!data || loading || exportRequest.current) return;
    const controller = new AbortController(); exportRequest.current = controller; setExporting(true); setError(''); setNotice('');
    try {
      const query = queryString(company.id, applied); query.set('mode', 'export');
      const response = await fetch(`/api/team-timesheets?${query}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) { if ((response.status === 401 || response.status === 403) && mounted.current && !controller.signal.aborted && exportRequest.current === controller) { onAccessDenied(); return; } const failure = await response.json(); throw new Error(failure.error || 'The complete export could not be loaded.'); }
      if (!response.headers.get('content-type')?.startsWith('text/csv')) throw new Error('The complete CSV export could not be verified.');
      const blob = await response.blob();
      if (!mounted.current || controller.signal.aborted || exportRequest.current !== controller) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = `team-timesheets-${applied.startDate}-${applied.endDate}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Complete CSV downloaded for the selected dates and user filter.');
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) { current.current = null; setData(null); setError(cause instanceof Error ? cause.message : 'The export could not be loaded.'); }
    } finally { if (exportRequest.current === controller) exportRequest.current = null; if (mounted.current) setExporting(false); }
  }
  const busy = loading || exporting;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: data?.timeZone || company.time_zone, dateStyle: 'medium', timeStyle: 'short' });
  return <section className="team-timesheets" aria-labelledby="team-timesheets-title">
    <div className="team-timesheet-heading"><div><h2 id="team-timesheets-title">Team timesheets</h2><p>Completed entries · dates filter when the shift started</p></div><div><button disabled={busy} onClick={() => void load(applied)}>Refresh team timesheets</button><button disabled={busy || !data || data.summary.entryCount > data.exportLimit} onClick={() => void download()}>{exporting ? 'Preparing CSV…' : 'Export complete CSV'}</button></div></div>
    <form className="team-timesheet-filters" onSubmit={event => { event.preventDefault(); if (!busy) void load(draft); }}>
      <label>Team start date<input type="date" required disabled={busy} value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })}/></label>
      <label>Team end date<input type="date" required disabled={busy} value={draft.endDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })}/></label>
      <label>User<select aria-label="User" disabled={busy} value={draft.agentId || ''} onChange={event => setDraft({ ...draft, agentId: event.target.value || null })}><option value="">All users with completed entries</option>{draft.agentId && !data?.agents.some(agent => agent.id === draft.agentId) ? <option value={draft.agentId}>Selected user ({draft.agentId.slice(0, 8)})</option> : null}{data?.agents.map(agent => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label><button disabled={busy}>Apply team filters</button>
    </form>
    {error ? <p role="alert" className="team-timesheet-error">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {loading ? <p role="status">Loading team timesheets…</p> : null}
    {data ? <><p className="team-timesheet-context">{data.filters.startDate} to {data.filters.endDate} · {data.timeZone} · completed records only</p>
      <dl className="team-timesheet-summary"><div><dt>Completed entries</dt><dd>{data.summary.entryCount.toLocaleString()}</dd></div><div><dt>Users</dt><dd>{data.summary.agentCount.toLocaleString()}</dd></div><div><dt>Tracked time</dt><dd>{duration(data.summary.paidSeconds)}</dd></div><div><dt>Unpaid breaks</dt><dd>{duration(data.summary.unpaidBreakSeconds)}</dd></div></dl>
      {data.summary.entryCount > data.exportLimit ? <p>CSV exports support up to {data.exportLimit.toLocaleString()} entries. Narrow the dates or user filter to export all matching records.</p> : null}
      {data.entries.length ? <div className="team-timesheet-scroll"><table><thead><tr><th scope="col">User</th><th scope="col">Job</th><th scope="col">Clock in</th><th scope="col">Clock out</th><th scope="col">Tracked time</th><th scope="col">Unpaid breaks</th></tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id}><td><Link href={`/agents/${entry.agent_id}?company=${company.id}`}>{entry.agent_name}</Link></td><td>{entry.job_name}</td><td><time dateTime={entry.started_at}>{formatter.format(new Date(entry.started_at))}</time></td><td><time dateTime={entry.ended_at}>{formatter.format(new Date(entry.ended_at))}</time></td><td>{duration(entry.paid_seconds)}</td><td>{duration(entry.unpaid_break_seconds)}</td></tr>)}</tbody></table></div> : <p>No completed entries match the selected dates and user.</p>}
      <div className="team-timesheet-footer"><span>{data.entries.length.toLocaleString()} of {data.summary.entryCount.toLocaleString()} entries shown</span>{data.nextCursor ? <button disabled={busy} onClick={() => void load(applied, data.nextCursor)}>Load older team entries</button> : null}</div>
    </> : null}
  </section>;
}
