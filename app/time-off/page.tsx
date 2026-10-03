import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { TimeOffError, readTimeOff } from '../../lib/time-off';
import DashboardShell from '../components/dashboard-shell';
import TimeOff from './time-off';

export const dynamic = 'force-dynamic';
export default async function TimeOffPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const initialData = await readTimeOff(client, { tenantId: company.id, view: 'mine', status: 'all', search: '', limit: 50 });
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof TimeOffError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Time Off</h1><p role="alert">{message}</p><Link href="/time-off">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData } = loaded;
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}:${initialData.agent?.id ?? "unlinked"}`} company={initialData.company} companies={companies} role={initialData.role} module="time-off"><TimeOff company={initialData.company} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
