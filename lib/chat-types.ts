export type ChatPerson = {
  user_id: string;
  display_name: string;
  role: string;
};
export type Conversation = {
  id: string;
  kind: "direct" | "group";
  name: string;
  description: string;
  management_only: boolean;
  updated_at: string;
  unread: number;
  preview: string | null;
  member_count: number;
};
export type ChatMessage = {
  conversation_id: string;
  sequence: number;
  sender_id: string;
  sender_name: string;
  client_id: string;
  body: string;
  created_at: string;
};
