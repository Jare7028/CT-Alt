import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { SmartGroupsError, readSmartGroups } from '../../lib/smart-groups';
import DashboardShell from '../components/dashboard-shell';
import SmartGroups from './smart-groups';

export const dynamic = 'force-dynamic';

export default async function SmartGroupsPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const initialData = await readSmartGroups(client, { tenantId: company.id, status: 'active', search: '', limit: 50 });
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof SmartGroupsError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Smart groups</h1><p role="alert">{message}</p><Link href="/smart-groups">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData } = loaded;
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}:${initialData.role}`} company={initialData.company} companies={companies} role={initialData.role} module="smart-groups"><SmartGroups company={initialData.company} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
