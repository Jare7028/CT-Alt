import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { RequestsError, readRequests } from '../../lib/requests-server';
import type { RequestsBoardData } from '../../lib/requests-types';
import DashboardShell from '../components/dashboard-shell';
import Requests from './requests';

export const dynamic = 'force-dynamic';
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const data = await readRequests(client, { tenantId: company.id, mode: 'board', search: '', limit: 20 });
    if (data.mode !== 'board') throw new RequestsError('The Requests board could not be verified. Try again.');
    const initialData: RequestsBoardData = data;
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof RequestsError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Requests</h1><p role="alert">{message}</p><Link href="/requests">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData } = loaded;
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}`} company={initialData.company} companies={companies} role={initialData.role} module="requests"><Requests company={initialData.company} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
