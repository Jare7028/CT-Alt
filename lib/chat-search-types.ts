export type ChatSearchMessage = {
  conversation_id: string;
  sequence: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};
export type ChatSearchData = {
  tenantId: string;
  conversationId: string;
  actorId: string;
  query: string;
  total: number;
  messages: ChatSearchMessage[];
  nextCursor: string | null;
};
export type ChatSearchQuery = {
  tenantId: string;
  conversationId: string;
  query: string;
  limit: number;
  cursor?: string;
};
