import type { Member } from "../../lib/agent-types";
import type {
  UpdatePost,
  UpdateRecipient,
  UpdatesData,
} from "../../lib/updates-types";
export const company = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Northstar Example",
  time_zone: "Europe/London",
};
export const actor = "77777777-7777-4777-8777-777777777777";
export const employee = "88888888-8888-4888-8888-888888888888";
export const users: UpdateRecipient[] = Array.from(
  { length: 1005 },
  (_, index) => ({
    id:
      index === 0
        ? actor
        : index === 100
          ? employee
          : `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    name:
      index === 0
        ? "Alex Publisher"
        : index === 100
          ? "Taylor Example"
          : index === 1004
            ? "Morgan Target"
            : `Example User ${String(index + 1).padStart(4, "0")}`,
  }),
);
export function post(
  index = 1,
  status: UpdatePost["status"] = "published",
): UpdatePost {
  return {
    id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
    tenant_id: company.id,
    title:
      index === 1
        ? "Welcome to the October team briefing"
        : index === 2
          ? "Safety CAFÉ 100%_ guide"
          : `Company update ${String(index).padStart(4, "0")}`,
    body: "Please read the company briefing and share your questions below.\nThis is synthetic desktop review content.",
    status,
    revision: status === "draft" ? 1 : 2,
    content_revision: status === "draft" ? 0 : 1,
    created_by: actor,
    created_name: "Alex Publisher",
    created_at: `2026-10-03T10:00:00.${String(index).padStart(6, "0")}Z`,
    published_at:
      status === "draft"
        ? null
        : `2026-10-03T12:00:00.${String(index).padStart(6, "0")}Z`,
    allowComments: true,
    allowReactions: true,
    requireConfirmation: true,
    recipientCount: 2,
    viewedCount: 0,
    confirmedCount: 0,
    likeCount: 0,
    commentCount: 0,
    liked: false,
    viewedAt: null,
    confirmedAt: null,
    canEdit: status === "draft",
    canPublish: status === "draft",
    canArchive: status === "published",
    canRestore: status === "archived",
    canEngage: status === "published",
    isRecipient: true,
  };
}
export function initialData(
  role: Member["role"] = "owner",
  tenant = company,
  currentActor = actor,
): UpdatesData {
  const manage = role === "owner" || role === "admin";
  return {
    company: tenant,
    role,
    actorId: currentActor,
    capabilities: { canManage: manage },
    posts: [{ ...post(), tenant_id: tenant.id, canArchive: manage }],
    counts: { total: 1, draft: 0, published: 1, archived: 0 },
    nextCursor: null,
    serverTime: "2026-10-03T13:00:00Z",
  };
}
