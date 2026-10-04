import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { UpdatesError, readUpdates } from '../../lib/updates';
import DashboardShell from '../components/dashboard-shell';
import Updates from './updates';

export const dynamic = 'force-dynamic';
export default async function UpdatesPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const initialData = await readUpdates(client, { tenantId: company.id, view: 'feed', status: 'all', search: '', limit: 50 });
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof UpdatesError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Updates</h1><p role="alert">{message}</p><Link href="/updates">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData } = loaded;
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}`} company={initialData.company} companies={companies} role={initialData.role} module="updates"><Updates company={initialData.company} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
