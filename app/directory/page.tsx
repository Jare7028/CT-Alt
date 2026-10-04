import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { DirectoryError, readDirectoryCatalogue } from '../../lib/directory';
import DashboardShell from '../components/dashboard-shell';
import Directory from './directory';

export const dynamic = 'force-dynamic';
export default async function DirectoryPage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const initialData = await readDirectoryCatalogue(client, { tenantId: company.id, q: '', limit: 100 });
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof DirectoryError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Directory</h1><p role="alert">{message}</p></main>;
  const { companies, initialData } = loaded;
  const currentCompanies = companies.map(company => company.id === initialData.company.id ? initialData.company : company);
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}`} company={initialData.company} companies={currentCompanies} role={initialData.role} module="directory"><Directory company={initialData.company} actorId={initialData.actorId} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
