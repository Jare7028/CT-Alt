import type {
  RequestsBoardData,
  RequestsDetailData,
  RequestsSaved,
  RequestsMutation,
  WorkRequest,
  RequestStatus,
} from "../../lib/requests-types";
export const tenant = "91000000-0000-4000-8000-000000000001";
export const otherTenant = "91000000-0000-4000-8000-000000000002";
export const actor = "92000000-0000-4000-8000-000000000001";
export const otherActor = "92000000-0000-4000-8000-000000000002";
export const linkedActor = "92000000-0000-4000-8000-000000000003";
export const agent = "93000000-0000-4000-8000-000000000003";
export const ids = [
  "94000000-0000-4000-8000-000000000001",
  "94000000-0000-4000-8000-000000000002",
  "94000000-0000-4000-8000-000000000003",
  "94000000-0000-4000-8000-000000000004",
];
export const stamp = "2026-10-04T12:00:00.123456Z";
export function request(
  index: number,
  status: RequestStatus = "new",
): WorkRequest {
  return {
    id: ids[index]!,
    tenantId: tenant,
    title: [
      "Replace entrance sign",
      "Repair meeting room screen",
      "Check stock room lighting",
      "Update emergency contacts",
    ][index]!,
    description:
      "Synthetic request for a desktop component test. No notifications are sent.",
    priority: index === 0 ? "high" : "normal",
    dueDate: "2026-10-05",
    status,
    revision: 1,
    requester: { actorId: actor, name: "Alex Demo" },
    assignee:
      index === 2
        ? {
            agentId: agent,
            actorId: linkedActor,
            name: "Taylor Example",
            eligible: true,
          }
        : null,
    createdAt: stamp,
    updatedAt: stamp,
    canEdit: true,
    canMove: true,
    canAssign: true,
  };
}
export function board(scenario = "owner"): RequestsBoardData {
  const data: RequestsBoardData = {
    schemaVersion: 1,
    mode: "board",
    company: { id: tenant, name: "Northstar Demo", time_zone: "Europe/London" },
    actorId: actor,
    role: "owner",
    scopeVersion: "a".repeat(32),
    search: "",
    counts: { new: 2, in_progress: 1, done: 1, total: 4 },
    columns: {
      new: { requests: [request(0), request(1)], nextCursor: null },
      in_progress: { requests: [request(2, "in_progress")], nextCursor: null },
      done: { requests: [request(3, "done")], nextCursor: null },
    },
    capabilities: { canCreate: true, canManage: true },
    serverTime: stamp,
  };
  if (scenario === "paged") {
    data.counts.new = 3;
    data.counts.total = 5;
    data.columns.new.nextCursor = "new-page-2";
  }
  if (scenario === "employee") {
    data.role = "employee";
    data.capabilities.canManage = false;
    data.columns.new.requests = [
      { ...request(0), canAssign: false, canMove: false },
    ];
    data.columns.in_progress.requests = [
      {
        ...request(2, "in_progress"),
        assignee: {
          agentId: agent,
          actorId: actor,
          name: "Alex Demo",
          eligible: true,
        },
        requester: { actorId: linkedActor, name: "Taylor Example" },
        canEdit: false,
        canAssign: false,
      },
    ];
    data.columns.done.requests = [];
    data.counts = { new: 1, in_progress: 1, done: 0, total: 2 };
  }
  if (scenario === "invalidCounts") data.counts.total = 99;
  return data;
}
export function detail(row: WorkRequest, data = board()): RequestsDetailData {
  return {
    schemaVersion: 1,
    mode: "detail",
    company: data.company,
    actorId: data.actorId,
    role: data.role,
    scopeVersion: data.scopeVersion,
    request: row,
    serverTime: stamp,
  };
}
export function saved(
  op: RequestsMutation,
  status: RequestStatus = "new",
): RequestsSaved {
  return {
    schemaVersion: 1,
    tenantId: op.tenantId,
    actorId: actor,
    role: "owner",
    operationId: op.operationId,
    action: op.change.action,
    requestId:
      op.change.action === "create"
        ? "94000000-0000-4000-8000-000000000099"
        : op.change.requestId,
    revision: op.change.action === "create" ? 1 : op.change.revision + 1,
    status: op.change.action === "move" ? op.change.status : status,
  };
}
