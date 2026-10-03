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
          <div><p className="eyebrow">First module</p><h2>Agents</h2><p>Bring your people together and give each person the right access. Client rotas come next.</p></div>
        </div>
        <p className="notice">The project foundation is ready. Scheduling and account features are not available yet.</p>
      </section>
      <footer>Built step by step, around the working day.</footer>
    </main>
  );
}
