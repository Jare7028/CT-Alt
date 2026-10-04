import Link from 'next/link';
export default function Home() {
  return (
    <main>
      <header><span className="mark" aria-hidden="true">C</span><span>CT Alt</span><span className="status">In development</span></header>
      <section aria-labelledby="page-title">
        <p className="eyebrow">Your people. Your working week.</p>
        <h1 id="page-title">A better place to<br />plan the day.</h1>
        <p className="intro">An independent home for schedules, conversations and the work that connects your team.</p>
        <div className="next-up">
          <span className="step" aria-hidden="true">01</span>
          <div><p className="eyebrow">Workforce tools</p><h2>Your team, connected</h2><p>Manage users, plan client rotas and keep conversations together.</p></div>
        </div>
        <p className="notice">Sign in with an account provided by your company owner.</p>
      <p><Link href="/overview">Open Overview</Link> · <Link href="/agents">Open Users</Link> · <Link href="/rotas">Client Rotas</Link> · <Link href="/chat">Chat</Link> · <Link href="/time-clock">Time Clock</Link> · <Link href="/quick-tasks">Quick Tasks</Link> · <Link href="/updates">Updates</Link> · <Link href="/time-off">Time Off</Link></p>
      </section>
      <footer>Built step by step, around the working day.</footer>
    </main>
  );
}
