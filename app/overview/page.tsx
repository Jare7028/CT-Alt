import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError, readOverview } from '../../lib/workforce-overview';
import DashboardShell from '../components/dashboard-shell';
import Overview from './overview';

export const dynamic = 'force-dynamic';
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const initialData = await readOverview(client, company.id);
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Overview</h1><p role="alert">{message}</p><Link href="/overview">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData } = loaded;
  return <DashboardShell key={initialData.company.id} company={initialData.company} companies={companies} role={initialData.role} module="overview"><Overview company={initialData.company} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
