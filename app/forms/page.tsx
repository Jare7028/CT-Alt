import Link from "next/link";
import { dashboardPageCompany } from "../../lib/dashboard-page";
import { OverviewReadError } from "../../lib/workforce-overview";
import { FormsError, readForms } from "../../lib/forms";
import DashboardShell from "../components/dashboard-shell";
import Forms from "./forms";

export const dynamic = "force-dynamic";
export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>;
}) {
  let loaded;
  let message = "";
  try {
    const { client, companies, company } = await dashboardPageCompany(
      (await searchParams).company,
    );
    const initialData = await readForms(client, {
      tenantId: company.id,
      view: "mine",
      status: "all",
      search: "",
      limit: 50,
    });
    loaded = { companies, initialData };
  } catch (error) {
    if (!(error instanceof FormsError) && !(error instanceof OverviewReadError))
      throw error;
    message = error.message;
  }
  if (!loaded)
    return (
      <main>
        <h1>Forms</h1>
        <p role="alert">{message}</p>
        <Link href="/forms">Check company access again</Link>
        <p>
          <Link href="/agents">Open Users</Link>
        </p>
      </main>
    );
  const { companies, initialData } = loaded;
  return (
    <DashboardShell
      key={`${initialData.company.id}:${initialData.actorId}:${initialData.role}`}
      company={initialData.company}
      companies={companies}
      role={initialData.role}
      module="forms"
    >
      <Forms
        company={initialData.company}
        role={initialData.role}
        initialData={initialData}
      />
    </DashboardShell>
  );
}
