import Link from 'next/link';
import { dashboardPageCompany } from '../../lib/dashboard-page';
import { OverviewReadError } from '../../lib/workforce-overview';
import { KnowledgeBaseError, readKnowledgeBases } from '../../lib/knowledge-base';
import DashboardShell from '../components/dashboard-shell';
import KnowledgeBase from './knowledge-base';

export const dynamic = 'force-dynamic';

export default async function KnowledgeBasePage({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  let loaded;
  let message = '';
  try {
    const { client, companies, company } = await dashboardPageCompany((await searchParams).company);
    const initialData = await readKnowledgeBases(client, { tenantId: company.id, view: 'auto', status: 'all', search: '', limit: 50 });
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof KnowledgeBaseError) && !(error instanceof OverviewReadError)) throw error;
    message = error.message;
  }
  if (!loaded) return <main><h1>Knowledge Base</h1><p role="alert">{message}</p><Link href="/knowledge-base">Check company access again</Link><p><Link href="/agents">Open Users</Link></p></main>;
  const { companies, initialData } = loaded;
  return <DashboardShell key={`${initialData.company.id}:${initialData.actorId}:${initialData.role}`} company={initialData.company} companies={companies} role={initialData.role} module="knowledge-base"><KnowledgeBase company={initialData.company} role={initialData.role} initialData={initialData}/></DashboardShell>;
}
