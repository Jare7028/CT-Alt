export type Company = { id: string; name: string; time_zone: string };
export type Member = { user_id: string; tenant_id: string; display_name: string; role: 'owner' | 'admin' | 'manager' | 'employee'; status: 'active' | 'suspended' };
export type AgentField = { key: string; label: string; required: boolean; position: number };
export type Agent = {
  id: string; tenant_id: string; user_id: string | null;
  first_name: string; last_name: string; phone: string; title: string; team: string;
  employment_start_date: string | null; custom_fields: Record<string, string>;
  status: 'active' | 'archived'; revision: number; created_by: string; created_at: string; updated_at: string;
};
export type AgentInput = Pick<Agent, 'first_name' | 'last_name' | 'phone' | 'title' | 'team' | 'employment_start_date' | 'custom_fields'>;
