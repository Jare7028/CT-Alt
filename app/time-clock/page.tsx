import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { readTimeClock, TimeClockError } from '../../lib/time-clock';
import DashboardShell from '../components/dashboard-shell';
import TimeClock from './time-clock';

export const dynamic = 'force-dynamic';
export default async function TimeClockPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const [initialData, initialTimesheets] = await Promise.all([
      readTimeClock(client, { tenantId: company.id, mode: 'status', limit: 50 }),
      readTimeClock(client, { tenantId: company.id, mode: 'timesheets', limit: 50 }),
    ]);
    loaded = { companies, initialData, initialTimesheets };
  } catch (error) {
    if (!(error instanceof TimeClockError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Time Clock</h1><p role="alert">{message}</p><Link href="/time-clock">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData, initialTimesheets } = loaded;
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}`} company={initialData.company} companies={companies} role={initialData.role} module="time-clock"><TimeClock company={initialData.company} role={initialData.role} initialData={initialData} initialTimesheets={initialTimesheets}/></DashboardShell>;
}
