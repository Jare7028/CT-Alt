import type { Company } from "../../lib/agent-types";
import type {
  SmartGroupsData,
  SmartGroup,
  SmartGroupSegment,
  SmartGroupIdentity,
  SmartGroupMember,
  SmartGroupCounts,
} from "../../lib/smart-group-types";
export const company: Company = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "Northstar Operations",
  time_zone: "Europe/London",
};
export const actor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const secondActor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const segmentId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const groupId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const version = "12345678901234567890123456789012";
export const fields = [
  { key: "title" as const, label: "Title" },
  { key: "team" as const, label: "Team" },
  { key: "custom:location" as const, label: "Location" },
];
export const counts: SmartGroupCounts = {
  records: 1005,
  eligible: 1000,
  unlinked: 3,
  unavailable: 2,
};
export function identity(
  tenant = company.id,
  currentActor = actor,
): SmartGroupIdentity {
  return {
    tenantId: tenant,
    actorId: currentActor,
    role: "owner",
    fieldFingerprint: "abcdefabcdefabcdefabcdefabcdefab",
    datasetVersion: version,
  };
}
export const segment: SmartGroupSegment = {
  id: segmentId,
  name: "Operations",
  description: "Teams organized by current workforce profiles",
  status: "active",
  revision: 1,
  activeGroupCount: 2,
  canArchive: false,
  canRestore: false,
};
export const group: SmartGroup = {
  id: groupId,
  segmentId,
  name: "Site supervisors",
  description: "Current supervisors working in field operations",
  status: "active",
  revision: 1,
  rules: [
    { field: "title", values: ["Supervisor"] },
    { field: "team", values: ["Field operations"] },
  ],
  needsReview: false,
  invalidFields: [],
  counts,
  canEdit: true,
  canArchive: true,
  canRestore: false,
};
export function initialData(
  tenant = company,
  currentActor = actor,
): SmartGroupsData {
  return {
    ...identity(tenant.id, currentActor),
    company: tenant,
    fields,
    groups: [
      group,
      {
        ...group,
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
        name: "Office coordinators",
        description: "Office operations and coordination",
        rules: [{ field: "title", values: ["Coordinator"] }],
        counts: { records: 12, eligible: 8, unlinked: 3, unavailable: 1 },
      },
      {
        ...group,
        id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
        name: "Regional leads",
        rules: [{ field: "custom:location", values: ["North"] }],
        counts: { records: 21, eligible: 21, unlinked: 0, unavailable: 0 },
      },
    ],
    counts: { total: 1005, active: 1004, archived: 1, needsReview: 0 },
    nextCursor: "group-page-2",
    serverTime: "2026-10-04T10:00:00Z",
  };
}
export function member(index: number): SmartGroupMember {
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`,
    name: `Workforce record ${String(index).padStart(4, "0")}`,
    title: "Supervisor",
    team: "Field operations",
    linkStatus:
      index === 1 ? "unlinked" : index === 2 ? "unavailable" : "eligible",
  };
}
