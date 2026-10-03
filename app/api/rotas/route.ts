import { NextResponse } from "next/server";
import type { RotaData } from "../../../lib/rota-types";
import { supportedRotaZone } from "../../../lib/rota-time";
import { z } from "zod";
import { configured, supabase } from "../../../lib/supabase";
import { validOrigin } from "../../../lib/request-security";
const base = { schedule_id: z.uuid(), revision: z.number().int().positive() };
const name = z.string().trim().min(1).max(100);
const change = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create_schedule"),
      name,
      time_zone: z.string().min(1).max(100).refine(supportedRotaZone),
      agent_ids: z.array(z.uuid()).min(1).max(1000),
      admin_ids: z.array(z.uuid()).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_schedule"),
      ...base,
      name,
      time_zone: z.string().min(1).max(100).refine(supportedRotaZone),
      agent_ids: z.array(z.uuid()).min(1).max(1000),
      admin_ids: z.array(z.uuid()).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_job"),
      ...base,
      name,
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("save_shift"),
      ...base,
      id: z.uuid().optional(),
      agent_id: z.uuid(),
      job_id: z.uuid(),
      starts_at: z.iso.datetime({ offset: true }),
      ends_at: z.iso.datetime({ offset: true }),
      title: z.string().max(100),
      allow_overlap: z.boolean(),
    })
    .strict(),
  z
    .object({ action: z.enum(["publish", "archive", "restore"]), ...base })
    .strict(),
]);
const input = z.object({ tenantId: z.uuid(), change }).strict();
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  if (!configured())
    return response({ error: "Company sign-in is not configured." }, 503);
  const tenant = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("tenantId"));
  if (!tenant.success) return response({ error: "Choose a company." }, 400);
  const client = await supabase();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return response({ error: "Sign in to continue." }, 401);
  const { data: member, error: accessError } = await client
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenant.data)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (accessError)
    return response({ error: "Company access could not be checked." }, 503);
  if (!member) return response({ error: "Company access denied." }, 403);
  const { data, error: readError } = await client.rpc("read_rotas", {
    target_tenant: tenant.data,
  });
  if (readError)
    return response(
      {
        error:
          "Schedules could not be loaded. The scheduling database needs to be enabled by your administrator.",
      },
      503,
    );
  if (!data) return response({ error: "Company access denied." }, 403);
  const roster = data as RotaData;
  const limits: Record<keyof RotaData, number> = {
    schedules: 1000,
    jobs: 5000,
    shifts: 5000,
    agents: 1000,
    assignments: 10000,
    admins: 1000,
    members: 1000,
  };
  if (
    (Object.keys(limits) as (keyof RotaData)[]).some(
      (key) => roster[key].length > limits[key],
    )
  )
    return response(
      {
        error:
          "This company exceeds the initial scheduler capacity. Ask your administrator to add paginated scheduling.",
      },
      503,
    );
  return response(roster);
}
export async function POST(request: Request) {
  if (!validOrigin(request))
    return response({ error: "Invalid request origin." }, 403);
  if (!configured())
    return response({ error: "Company sign-in is not configured." }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 18000)
    return response({ error: "Request is too large." }, 413);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return response({ error: "Invalid request." }, 400);
  }
  const parsed = input.safeParse(value);
  if (!parsed.success)
    return response(
      {
        error: parsed.error.issues.some((issue) =>
          issue.path.includes("time_zone"),
        )
          ? "Choose UTC or a supported geographical IANA time zone."
          : "Complete the required schedule fields.",
      },
      400,
    );
  const client = await supabase();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user)
    return response({ error: "Sign in to continue." }, 401);
  const { data, error } = await client.rpc("save_rota", {
    target_tenant: parsed.data.tenantId,
    change: parsed.data.change,
  });
  if (!error) return response({ saved: data });
  const errors: Record<string, string> = {
    "42501": "You do not have permission for this schedule.",
    "40001": "This schedule changed. Reload before saving.",
    "40P01": "Another update is in progress. Reload and try again.",
    P0001:
      "This user has an overlapping shift. Review the times and explicitly allow overlap to continue.",
    "23503": "Choose a user and job assigned to this schedule.",
    "23514": "Enter valid fields and a shift lasting up to 24 hours.",
    "22023": error.message,
    P0002: "Shift not found.",
  };
  const status =
    error.code === "42501"
      ? 403
      : error.code === "P0002"
        ? 404
        : ["40001", "40P01", "P0001"].includes(error.code)
          ? 409
          : [
                "22023",
                "23514",
                "23503",
                "23502",
                "22P02",
                "22007",
                "22008",
              ].includes(error.code)
            ? 400
            : 503;
  return response(
    {
      error: errors[error.code] || "The scheduling change could not be saved.",
    },
    status,
  );
}
