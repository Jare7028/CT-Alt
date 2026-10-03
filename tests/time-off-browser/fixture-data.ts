import type { Member } from "../../lib/agent-types";
import type {
  TimeOffData,
  TimeOffRequest,
  TimeOffType,
} from "../../lib/time-off-types";
export const company = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Northstar Example",
  time_zone: "Europe/London",
};
export const actor = "77777777-7777-4777-8777-777777777777";
export const people = [
  { id: "33333333-3333-4333-8333-333333333333", name: "Taylor Example" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Casey Sample" },
  { id: "55555555-5555-4555-8555-555555555555", name: "Morgan Retained" },
];
export const vacation: TimeOffType = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Vacation",
  description: "Planned leave for rest and family time.",
  paid: true,
  status: "active",
  revision: 1,
  canArchive: true,
};
export const unpaid: TimeOffType = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "Personal leave",
  description: "Personal time away.",
  paid: false,
  status: "active",
  revision: 1,
  canArchive: true,
};
export function request(
  index = 1,
  person = people[0],
  status: TimeOffRequest["status"] = "pending",
): TimeOffRequest {
  return {
    id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
    tenant_id: company.id,
    agent_id: person.id,
    agent_name: person.name,
    type_id: vacation.id,
    type_name: vacation.name,
    type_description: vacation.description,
    type_paid: true,
    start_date: "2026-10-24",
    end_date: "2026-10-26",
    calendar_days: 3,
    note:
      index === 1 ? "Family plans for the weekend." : "Synthetic leave note.",
    status,
    revision: status === "pending" ? 1 : 2,
    requested_by:
      person.id === people[0].id
        ? actor
        : "88888888-8888-4888-8888-888888888888",
    requested_at: `2026-10-03T10:00:00.${String(index).padStart(6, "0")}Z`,
    decision_by: status === "pending" ? null : actor,
    decision_name: status === "pending" ? null : "Alex Reviewer",
    decision_reason: status === "pending" ? null : "Reviewed coverage",
    decided_at: status === "pending" ? null : "2026-10-03T11:00:00Z",
    history: [
      {
        action: "request",
        actor_name: person.name,
        occurred_at: "2026-10-03T10:00:00Z",
        revision: 1,
        reason: null,
      },
      ...(status === "pending"
        ? []
        : [
            {
              action: status === "approved" ? "approve" : "reject",
              actor_name: "Alex Reviewer",
              occurred_at: "2026-10-03T11:00:00Z",
              revision: 2,
              reason: "Reviewed coverage",
            },
          ]),
    ],
    canWithdraw: status === "pending" && person.id === people[0].id,
    canApprove: status === "pending",
    canReject: status === "pending",
    canCancel: status === "approved",
  };
}
export function initialData(
  role: Member["role"] = "owner",
  tenant = company,
  currentActor = actor,
  agent = people[0],
): TimeOffData {
  const manage = role === "owner" || role === "admin";
  const own = agent.id === people[0].id && currentActor === actor;
  return {
    company: tenant,
    role,
    actorId: currentActor,
    agent,
    types: [vacation, unpaid].map((type) => ({ ...type, canArchive: manage })),
    requests: own
      ? [{ ...request(), canApprove: manage, canReject: manage }]
      : [],
    counts: {
      total: own ? 1 : 0,
      pending: own ? 1 : 0,
      approved: 0,
      rejected: 0,
      withdrawn: 0,
      cancelled: 0,
    },
    nextCursor: null,
    serverTime: "2026-10-03T12:00:00Z",
    timeZone: tenant.time_zone,
    capabilities: {
      canRequest: true,
      canManageTypes: manage,
      canViewTeam: manage,
    },
  };
}
