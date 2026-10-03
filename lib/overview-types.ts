import type { Company, Member } from './agent-types';

export type ActivityAction = 'created' | 'updated' | 'archived' | 'restored';
export type ActivityEvent = {
  id: string;
  agent_id: string;
  agent_name: string;
  actor_user_id: string | null;
  actor_name: string;
  action: ActivityAction;
  revision: number;
  occurred_at: string;
};
export type OverviewData = {
  company: Company & { status: 'active' };
  role: Member['role'];
  canViewActivity: boolean;
  agents: { active: number; archived: number; linked: number; unlinked: number };
  memberships: Record<Member['role'], number>;
  recentActivity: ActivityEvent[];
};
export type ActivityData = { events: ActivityEvent[]; nextCursor: string | null; timeZone?: string };
export type ActivityFilters = { action?: ActivityAction; startDate?: string; endDate?: string; cursor?: string; limit: number };
