import { NextResponse } from "next/server";
import { z } from "zod";
import { configured, supabase } from "../../../lib/supabase";
import { validOrigin } from "../../../lib/request-security";

const payload = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("group_info"), conversationId: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal("manage_group"),
      conversationId: z.uuid(),
      revision: z.number().int().positive(),
      members: z.array(z.uuid()).min(1).max(100),
      group_admins: z.array(z.uuid()).max(100),
      allow_member_messages: z.boolean(),
    })
    .strict(),
  z.object({ action: z.enum(["list", "directory"]) }).strict(),
  z
    .object({
      action: z.literal("create"),
      kind: z.enum(["direct", "group"]),
      name: z.string().trim().min(1).max(100),
      description: z.string().max(1000),
      management_only: z.boolean(),
      allow_member_messages: z.boolean().optional(),
      members: z.array(z.uuid()).min(1).max(99),
    })
    .strict(),
  z
    .object({
      action: z.literal("history"),
      conversationId: z.uuid(),
      before: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      after: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("send"),
      conversationId: z.uuid(),
      clientId: z.uuid(),
      body: z
        .string()
        .min(1)
        .max(4000)
        .refine((value) => value.trim().length > 0),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      conversationId: z.uuid(),
      sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
]);
const input = z.object({ tenantId: z.uuid(), payload }).strict();
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function POST(request: Request) {
  if (!validOrigin(request))
    return response({ error: "Invalid request origin." }, 403);
  if (!configured())
    return response({ error: "Company sign-in is not configured yet." }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 24000)
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
      { error: "Check the conversation details and message." },
      400,
    );
  // Shared configuration accepts only CT Alt's verified hosted project or its
  // independent loopback test API. This client carries the signed user's cookie.
  const client = await supabase();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user)
    return response({ error: "Sign in to continue." }, 401);
  const { data, error } = await client.rpc("chat_action", {
    target_tenant: parsed.data.tenantId,
    payload: parsed.data.payload,
  });
  if (!error) return response({ data });
  if (error.code === "P0001" && error.message === "Only group admins can post")
    return response(
      {
        error: "Only group admins can send messages in this group.",
        kind: "posting_restricted",
      },
      403,
    );
  if (error.code === "40001")
    return response(
      {
        error:
          "This group changed. Close Chat Info and reopen it before saving.",
      },
      409,
    );
  if (
    error.code === "22023" &&
    error.message === "Keep at least one active group admin"
  )
    return response({ error: "Keep at least one active group admin." }, 400);
  if (error.code === "42501")
    return response(
      { error: "Company or conversation access is unavailable." },
      403,
    );
  if (["22023", "22P02", "23514", "23502"].includes(error.code))
    return response(
      { error: "Check the conversation details and message." },
      400,
    );
  return response(
    { error: "Chat could not be loaded or saved. Try again." },
    503,
  );
}
