import type { Company, Member } from "../../lib/agent-types";
import type {
  FormsData,
  FormsField,
  FormsForm,
  FormsView,
} from "../../lib/forms-types";
export const company: Company = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "Example Workshop",
  time_zone: "Europe/London",
};
export const actor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  otherActor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const formId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  draftId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
export const responseId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const instant = "2026-10-04T09:12:00.123456+00:00";
export const fieldId = (index: number) =>
  `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`;
export const optionId = (index: number) =>
  `ffffffff-ffff-4fff-8fff-${String(index).padStart(12, "0")}`;
export const schema: FormsField[] = [
  {
    id: fieldId(1),
    kind: "description",
    text: "Original synthetic daily checklist. <script>plain text only</script>",
  },
  { id: fieldId(2), kind: "text", label: "Shift notes", required: true },
  { id: fieldId(3), kind: "yes_no", label: "Equipment safe", required: true },
  {
    id: fieldId(4),
    kind: "single_choice",
    label: "Work area",
    required: true,
    options: [
      { id: optionId(1), label: "Workshop" },
      { id: optionId(2), label: "Office" },
    ],
  },
  {
    id: fieldId(5),
    kind: "multiple_choice",
    label: "Checks completed",
    required: true,
    options: [
      { id: optionId(3), label: "Doors" },
      { id: optionId(4), label: "Lights" },
    ],
  },
  { id: fieldId(6), kind: "number", label: "Meter reading", required: true },
];
export function form(
  id = formId,
  status: FormsForm["status"] = "published",
  view: FormsView = "mine",
  assigned = true,
): FormsForm {
  return {
    id,
    name: id === formId ? "Daily readiness" : "Draft inspection",
    description: "Original synthetic form for the example team.",
    status,
    restoreStatus: status === "archived" ? "published" : null,
    revision: 1,
    schemaFrozen: status !== "draft",
    allowRespondentEdit: true,
    isAssigned: assigned,
    audienceCount: view === "manage" ? 2 : null,
    eligibleAudienceCount: view === "manage" ? 2 : null,
    createdAt: instant,
    updatedAt: instant,
    ownResponse: null,
    capabilities: {
      canEdit: view === "manage" && status !== "archived",
      canPublish: view === "manage" && status === "draft",
      canArchive: view === "manage" && status !== "archived",
      canRestore: view === "manage" && status === "archived",
      canSaveProgress: view === "mine" && assigned && status === "published",
      canSubmit: view === "mine" && assigned && status === "published",
      canEditResponse: false,
      canViewResponses: view === "manage",
    },
  };
}
export function initialData(
  role: Member["role"] = "owner",
  tenant = company,
  currentActor = actor,
): FormsData {
  return {
    tenantId: tenant.id,
    actorId: currentActor,
    role,
    company: tenant,
    view: "mine",
    forms: [form()],
    counts: { total: 1, draft: 0, published: 1, archived: 0 },
    catalogVersion: "9007199254740993",
    nextCursor: null,
    capabilities: { canManage: role === "owner" || role === "admin" },
    serverTime: instant,
  };
}
