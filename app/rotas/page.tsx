import Link from "next/link";
import { redirect } from "next/navigation";
import { configured, supabase } from "../../lib/supabase";
import type { Company } from "../../lib/agent-types";
import Scheduler from "./scheduler";
export const dynamic = "force-dynamic";
export default async function RotasPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  if (!configured()) redirect("/login");
  const client = await supabase();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: companies, error: readError } = await client
    .from("tenants")
    .select("id,name,time_zone")
    .order("name");
  if (readError)
    return (
      <main>
        <h1>Client rotas</h1>
        <p role="alert">Company access could not be loaded.</p>
      </main>
    );
  const requested = (await searchParams).company;
  const company =
    companies?.find((c) => c.id === requested) ||
    (!requested ? companies?.[0] : null);
  if (!company)
    return (
      <main>
        <h1>Company access unavailable</h1>
        <Link href="/rotas">Check company access again</Link>
      </main>
    );
  const { data: member, error: memberError } = await client
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", company.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (memberError || !member)
    return (
      <main>
        <h1>Client rotas</h1>
        <p role="alert">Company access could not be checked.</p>
      </main>
    );
  return (
    <Scheduler
      key={company.id}
      company={company as Company}
      companies={companies as Company[]}
      actorId={user.id}
      role={member.role}
    />
  );
}
