import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatSearchData, ChatSearchQuery } from './chat-search-types';
const uuid = z.uuid().transform(value => value.toLowerCase());
const literalQuery = z.string().trim().min(1).max(100);
// Decimal text is preserved throughout; converting bigint sequences to Number
// would merge distinct messages beyond the JavaScript safe integer boundary.
const sequence = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
const cursorSchema = z.object({ tenantId: uuid, actorId: uuid, conversationId: uuid, query: literalQuery, sequence }).strict();
const messageSchema = z.object({ conversation_id: uuid, sequence, sender_id: uuid, sender_name: z.string(), body: z.string().min(1).max(8000).refine(value => Array.from(value).length <= 4000), created_at: z.iso.datetime({ offset: true }) }).strict();
const resultSchema = z.object({ tenantId: uuid, actorId: uuid, conversationId: uuid, query: literalQuery, total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), messages: z.array(messageSchema).max(100), nextCursor: cursorSchema.nullable() }).strict();
export class ChatSearchError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
export function parseChatSearchQuery(params: URLSearchParams): ChatSearchQuery {
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new ChatSearchError('Choose valid conversation search details.', 400);
  const parsed = z.object({ tenantId: uuid, conversationId: uuid, query: literalQuery, limit: z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).refine(value => value <= 100).optional(), cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(1500).optional() }).strict().safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new ChatSearchError('Choose valid conversation search details.', 400);
  return { ...parsed.data, limit: parsed.data.limit ?? 50 };
}
export function decodeChatSearchCursor(value?: string) {
  if (!value) return null;
  try {
    if (value.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch { throw new ChatSearchError('Choose a valid conversation search cursor.', 400); }
}
export async function readChatSearch(client: SupabaseClient, query: ChatSearchQuery): Promise<ChatSearchData> {
  const cursor = decodeChatSearchCursor(query.cursor);
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new ChatSearchError('Sign in to search this conversation.', 401);
  if (cursor && (cursor.tenantId !== query.tenantId || cursor.actorId !== user.id || cursor.conversationId !== query.conversationId || cursor.query !== query.query)) throw new ChatSearchError('Conversation search changed. Search again.', 400);
  const { data, error } = await client.rpc('search_chat_messages', { target_tenant: query.tenantId, target_conversation: query.conversationId, search_query: query.query, page_limit: query.limit, after_message: cursor });
  if (error) throw new ChatSearchError(error.code === '42501' ? 'Company or conversation access is unavailable.' : ['22023', '22P02', '22003'].includes(error.code) ? 'Choose valid conversation search details.' : 'Conversation search could not be loaded. Try again.', error.code === '42501' ? 403 : ['22023', '22P02', '22003'].includes(error.code) ? 400 : 503);
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new ChatSearchError('Conversation search could not be verified. Try again.');
  const result = parsed.data;
  const sameScope = (scope: { tenantId: string; actorId: string; conversationId: string; query: string }) => scope.tenantId === query.tenantId && scope.actorId === user.id && scope.conversationId === query.conversationId && scope.query === query.query;
  if (!sameScope(result) || result.messages.length > query.limit || result.total < result.messages.length || result.messages.some((message, index) => message.conversation_id !== query.conversationId || (cursor && BigInt(message.sequence) >= BigInt(cursor.sequence)) || (index > 0 && BigInt(message.sequence) >= BigInt(result.messages[index - 1].sequence))) || (result.nextCursor && (!sameScope(result.nextCursor) || result.messages.length !== query.limit || result.nextCursor.sequence !== result.messages.at(-1)?.sequence))) throw new ChatSearchError('Conversation search could not be verified. Try again.');
  // A STABLE RPC uses one statement snapshot. Recheck current RLS after the
  // potentially long search so a committed removal/suspension cannot release
  // results merely because it happened after that snapshot started.
  const { data: access, error: accessError } = await client.from('chat_conversations').select('id').eq('tenant_id', query.tenantId).eq('id', query.conversationId).maybeSingle();
  if (accessError) throw new ChatSearchError('Conversation access could not be checked. Try again.');
  if (!access || access.id !== query.conversationId) throw new ChatSearchError('Company or conversation access is unavailable.', 403);
  return { ...result, nextCursor: result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString('base64url') : null };
}
