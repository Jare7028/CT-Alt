import type { Company, Member } from "../../lib/agent-types";
import type {
  KnowledgeBase,
  KnowledgeNode,
  KnowledgeBasesData,
  KnowledgeIdentity,
  KnowledgeAssignee,
  KnowledgeReadScope,
} from "../../lib/knowledge-base-types";
export const company: Company = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "Northstar Operations",
  time_zone: "Europe/London",
};
export const actor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const otherActor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const bookId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const sectionId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const policyFolderId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
export const textId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
export const linkId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
export const version = "12345678901234567890123456789012";
export const eventVersion = "abcdefabcdefabcdefabcdefabcdefab";
export const timestamp = "2026-10-04T10:00:00.123456Z";
export function identity(
  role: Member["role"] = "owner",
  view: "manage" | "library" = role === "owner" || role === "admin"
    ? "manage"
    : "library",
  tenantId = company.id,
  actorId = actor,
): KnowledgeIdentity {
  return { tenantId, actorId, role, view };
}
export const base: KnowledgeBase = {
  id: bookId,
  name: "Company Handbook",
  description: "Policies, practical guidance and useful company resources",
  status: "published",
  restoreStatus: null,
  revision: 1,
  audienceCount: 3,
  eligibleAudienceCount: 2,
  isAssigned: true,
  canRead: true,
  canEdit: true,
  canPublish: false,
  canArchive: true,
  canRestore: false,
};
export const bases: KnowledgeBase[] = [
  base,
  {
    ...base,
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    name: "Field Operations",
    description: "A draft library for the field operations team",
    status: "draft",
    audienceCount: 0,
    eligibleAudienceCount: 0,
    isAssigned: false,
    canRead: false,
    canPublish: false,
  },
  {
    ...base,
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    name: "Retained Procedures",
    description: "Archived material with retained assignments and history",
    status: "archived",
    restoreStatus: "published",
    isAssigned: false,
    canRead: false,
    canEdit: false,
    canArchive: false,
    canRestore: true,
  },
];
export const section: KnowledgeNode = {
  id: sectionId,
  baseId: bookId,
  parentId: null,
  kind: "folder",
  name: "Company Information",
  description: "Our policies and resources",
  status: "active",
  revision: 1,
  depth: 1,
  rank: "1024",
  activeChildCount: 3,
  canEdit: true,
  canMove: true,
  canMoveEarlier: false,
  canMoveLater: true,
  canArchive: false,
  canRestore: false,
};
export const nodes: KnowledgeNode[] = [
  section,
  {
    ...section,
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
    name: "Operations",
    description: "Operational reference material",
    rank: "2048",
    activeChildCount: 0,
    canArchive: true,
    canMoveEarlier: true,
    canMoveLater: false,
  },
  {
    ...section,
    id: policyFolderId,
    parentId: sectionId,
    name: "Policies",
    description: "Company policies",
    depth: 2,
    rank: "1024",
    activeChildCount: 1,
    canMoveLater: true,
  },
  {
    ...section,
    id: textId,
    parentId: sectionId,
    kind: "text",
    name: "Welcome Handbook",
    description: "A concise introduction for our team",
    depth: 2,
    rank: "2048",
    activeChildCount: 0,
    canArchive: true,
    canMoveEarlier: true,
  },
  {
    ...section,
    id: linkId,
    parentId: sectionId,
    kind: "link",
    name: "Company website",
    description: "An external resource",
    depth: 2,
    rank: "3072",
    activeChildCount: 0,
    canArchive: true,
    canMoveEarlier: true,
    canMoveLater: false,
  },
  {
    ...section,
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
    parentId: policyFolderId,
    kind: "text",
    name: "Annual Leave",
    description: "How to find and submit a time-off request",
    depth: 3,
    rank: "1024",
    activeChildCount: 0,
    canArchive: true,
    canMoveLater: false,
  },
  {
    ...section,
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
    parentId: sectionId,
    kind: "text",
    name: "Previous Handbook",
    description: "A retained earlier resource",
    status: "archived",
    depth: 2,
    rank: "4096",
    activeChildCount: 0,
    canArchive: false,
    canRestore: true,
    canMoveEarlier: true,
    canMoveLater: false,
  },
];
export const bodies = new Map([
  [
    textId,
    'Welcome to Northstar Operations.\n\n  This handbook brings our shared information together.\n\n<script>alert("synthetic")</script>\n\nUse the folder path to find policies and practical guidance.',
  ],
  [
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
    "Time off requests are submitted in Time Off.\n\nCheck the current approval status in your own request history.",
  ],
]);
export function assigned(index: number): KnowledgeAssignee {
  return {
    actorId:
      index === 1
        ? actor
        : `ffffffff-ffff-4fff-8fff-${String(index).padStart(12, "0")}`,
    name:
      index === 1
        ? "Alex Morgan"
        : `Eligible account ${String(index).padStart(4, "0")}`,
    eligible: true,
  };
}
export const audience: KnowledgeAssignee[] = [
  assigned(1),
  assigned(2),
  { ...assigned(3), name: "Retained unavailable assignee", eligible: false },
];
export function scope(
  currentBase = base,
  role: Member["role"] = "owner",
  view: "manage" | "library" = role === "owner" || role === "admin"
    ? "manage"
    : "library",
): KnowledgeReadScope {
  return {
    ...identity(role, view),
    baseId: currentBase.id,
    baseRevision: currentBase.revision,
    audienceVersion: version,
    treeVersion: version,
  };
}
export function initialData(
  role: Member["role"] = "owner",
  tenant = company,
  currentActor = actor,
): KnowledgeBasesData {
  const view = role === "owner" || role === "admin" ? "manage" : "library";
  return {
    ...identity(role, view, tenant.id, currentActor),
    company: tenant,
    bases:
      view === "manage"
        ? bases
        : [
            {
              ...base,
              canEdit: false,
              canArchive: false,
              canRestore: false,
              canPublish: false,
            },
          ],
    counts:
      view === "manage"
        ? { total: 3, published: 1, draft: 1, archived: 1 }
        : { total: 1, published: 1, draft: 0, archived: 0 },
    catalogVersion: version,
    nextCursor: null,
    serverTime: timestamp,
    capabilities: { canManage: role === "owner" || role === "admin" },
  };
}
