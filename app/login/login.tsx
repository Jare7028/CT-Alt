'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import '../agents/users.css';

export default function Login({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: form.get('email'), password: form.get('password') }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      router.replace('/agents');router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed. Try again.'); setBusy(false); }
  }
  return <main className="login-page"><div className="login-card"><h1>CT Alt</h1><h2>Sign in to your company</h2>{configured ? <form onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error ? <p role="alert">{error}</p> : null}<button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form> : <p>Company sign-in is being set up. Please come back shortly.</p>}</div></main>;
}
