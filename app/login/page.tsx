import { configured } from '../../lib/supabase';
import Login from './login';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <Login configured={configured()} />;
}
