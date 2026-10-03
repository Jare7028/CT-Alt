import Link from "next/link";
import { redirect } from "next/navigation";
import { configured, supabase } from "../../lib/supabase";
import Chat from "./chat";
export const dynamic = "force-dynamic";
export default async function ChatPage({
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
    .select("id,name")
    .order("name");
  if (readError)
    return (
      <main>
        <h1>Chat</h1>
        <p role="alert">Company access could not be loaded.</p>
      </main>
    );
  const requested = (await searchParams).company;
  const company =
    companies?.find((item) => item.id === requested) ||
    (!requested ? companies?.[0] : null);
  if (!company)
    return (
      <main>
        <h1>Chat</h1>
        <p>
          Company access unavailable. Ask your administrator to check your
          membership.
        </p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  const { data: member } = await client
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", company.id)
    .eq("user_id", user.id)
    .maybeSingle();
  return (
    <Chat
      key={company.id}
      company={company}
      companies={companies || []}
      actorId={user.id}
      management={["owner", "admin", "manager"].includes(member?.role || "")}
    />
  );
}
