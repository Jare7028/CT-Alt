import { NextResponse } from 'next/server';
import { configured, supabase } from '../../../../lib/supabase';
import { ChatSearchError, parseChatSearchQuery, readChatSearch } from '../../../../lib/chat-search';
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request) {
  if (!configured()) return response({ error: 'Company sign-in is not configured yet.' }, 503);
  try { return response(await readChatSearch(await supabase(), parseChatSearchQuery(new URL(request.url).searchParams))); }
  catch (error) { return error instanceof ChatSearchError ? response({ error: error.message }, error.status) : response({ error: 'Conversation search could not be loaded. Try again.' }, 503); }
}
