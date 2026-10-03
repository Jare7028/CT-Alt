import { configured } from '../../lib/supabase';
import Login from './login';

export const dynamic = 'force-dynamic';

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  return <Login configured={configured()} linkError={(await searchParams).error==='link'} />;
}
