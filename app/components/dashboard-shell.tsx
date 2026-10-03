'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Company, Member } from '../../lib/agent-types';
import AppShell from './app-shell';

export default function DashboardShell({ company, companies, role, module, children }: {
  company: Company; companies: Company[]; role: Member['role']; module: 'overview' | 'activity'; children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suffix = `?company=${encodeURIComponent(company.id)}`;
  async function signout() {
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
      if (!result.ok) throw new Error('Sign out failed. Try again.');
      router.replace('/login'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign out failed.'); setBusy(false); }
  }
  return <AppShell companyName={company.name} companyId={company.id} activeModule={module}
    moduleLinks={{ overview: `/overview${suffix}`, activity: role === 'owner' || role === 'admin' ? `/activity${suffix}` : undefined, chat: `/chat${suffix}`, rotas: `/rotas${suffix}` }}
    companyControl={<label><span className="sr-only">Company</span><select value={company.id} onChange={event => router.push(`/${module}?company=${encodeURIComponent(event.target.value)}`)}>{companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    accountControls={<><button onClick={signout} disabled={busy}>Sign out</button>{error && <p role="alert">{error}</p>}</>}
  ><main className="ct-dashboard-main">{children}</main></AppShell>;
}
