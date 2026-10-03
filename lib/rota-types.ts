export type RotaAgent = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
};
export type Schedule = {
  id: string;
  tenant_id: string;
  name: string;
  time_zone: string;
  status: "active" | "archived";
  revision: number;
};
export type RotaJob = {
  id: string;
  schedule_id: string;
  name: string;
  color: string;
};
export type RotaShift = {
  id: string;
  schedule_id: string;
  agent_id: string;
  job_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  status: "draft" | "published";
  revision: number;
};
export type RotaData = {
  schedules: Schedule[];
  jobs: RotaJob[];
  shifts: RotaShift[];
  agents: RotaAgent[];
  assignments: { schedule_id: string; agent_id: string }[];
  admins: { schedule_id: string; user_id: string }[];
  members: { user_id: string; display_name: string; role: string }[];
};
