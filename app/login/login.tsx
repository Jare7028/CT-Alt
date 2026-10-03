'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import '../agents/users.css';

export default function Login({ configured, linkError=false }: { configured: boolean; linkError?:boolean }) {
  const router = useRouter();
  const [mode,setMode]=useState<'password'|'email'>('password');
  const [error, setError] = useState(linkError?'This link could not be used. Request a new link and open it in the same browser.':'');
  const [message,setMessage]=useState('');
  const [cooldown,setCooldown]=useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(()=>{
    if(cooldown===0)return;
    const timer=setTimeout(()=>setCooldown(value=>Math.max(0,value-1)),1000);
    return ()=>clearTimeout(timer);
  },[cooldown]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy || (mode==='email' && cooldown>0))return;
    setBusy(true); setError('');setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const body=mode==='email' ? {action:'email_link',email:form.get('email')} : {action:'login',email:form.get('email'),password:form.get('password')};
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if(mode==='email'){setMessage(data.message);setCooldown(data.retryAfter);setBusy(false);}
      else {router.replace('/agents');router.refresh();}
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed. Try again.'); setBusy(false); }
  }
  return <main className="login-page"><div className="login-card"><h1>CT Alt</h1><h2>Sign in to your company</h2>{configured ? <>
    <div className="login-modes" aria-label="Sign-in method"><button type="button" aria-pressed={mode==='password'} disabled={busy} onClick={()=>{setMode('password');setError('');setMessage('');}}>Password</button><button type="button" aria-pressed={mode==='email'} disabled={busy} onClick={()=>{setMode('email');setError('');setMessage('');}}>Email link</button></div>
    <form onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>{mode==='password' ? <label>Password<input name="password" type="password" autoComplete="current-password" required /></label> : <p className="email-instructions">New here? Confirm your email to create an account. Company access is assigned separately. Open the link in this browser.</p>}
      {error ? <p role="alert" className="error">{error}</p> : null}{message ? <p role="status" className="feedback">{message}</p> : null}
      <button className="primary" disabled={busy || mode==='email' && cooldown>0}>{busy ? 'Please wait…' : mode==='email' ? cooldown>0 ? `Request again in ${cooldown}s` : 'Email me a sign-in link' : 'Sign in'}</button>
    </form></> : <p>Company sign-in is being set up. Please come back shortly.</p>}</div></main>;
}
