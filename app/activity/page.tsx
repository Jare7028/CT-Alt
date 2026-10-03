import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError, readActivity, readDashboardAccess } from '../../lib/workforce-overview';
import DashboardShell from '../components/dashboard-shell';
import Activity from './activity';

export const dynamic = 'force-dynamic';
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const access = await readDashboardAccess(client, company.id);
    const initialData = await readActivity(client, company.id, { limit: 50 });
    loaded = { companies, access, initialData };
  } catch (error) {
    if (!(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Activity</h1><p role="alert">{message}</p><Link href="/activity">Check company access again</Link><p><Link href="/overview">Open Overview</Link></p></main>;
  const { companies, access, initialData } = loaded;
  return <DashboardShell key={access.company.id} company={access.company} companies={companies} role={access.role} module="activity"><Activity company={access.company} role={access.role} initialData={initialData}/></DashboardShell>;
}
