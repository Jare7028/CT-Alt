'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import './app-shell.css';

export type ShellModule = 'users' | 'rotas' | 'chat' | 'overview' | 'activity' | 'time-clock' | 'quick-tasks' | 'updates' | 'time-off' | 'smart-groups';
export type AppShellProps = {
  children: ReactNode;
  companyName: string;
  companyId?: string;
  activeModule: ShellModule;
  companyControl?: ReactNode;
  accountControls?: ReactNode;
  accountName?: string;
  pageNavigation?: ReactNode;
  /** Supply only routes that exist and are ready to use. */
  moduleLinks?: Partial<Record<'rotas' | 'chat' | 'overview' | 'activity' | 'time-clock' | 'quick-tasks' | 'updates' | 'time-off' | 'smart-groups', string>>;
};

type IconName = 'grid' | 'activity' | 'users' | 'groups' | 'automation' | 'jobs' | 'chat' | 'calendar' | 'chevron' | 'plus' | 'search' | 'help' | 'accessibility' | 'bell' | 'menu' | 'clock';
export function ShellIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></>,
    activity: <><path d="M4 6h16M4 12h16M4 18h10"/></>,
    users: <><circle cx="12" cy="7" r="3"/><path d="M5 21v-3c0-5 14-5 14 0v3z"/></>,
    groups: <><circle cx="9" cy="7" r="3"/><path d="M2 21v-3c0-5 14-5 14 0v3M17 4a3 3 0 0 1 0 6M19 14c3 1 3 3 3 7"/></>,
    automation: <><path d="m13 2-9 12h7l-1 8 10-13h-8z"/></>,
    jobs: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/></>,
    chat: <><path d="M4 3h16v13H9l-5 5z"/><path d="M8 7h8M8 11h6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18M8 15h2M14 15h2"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    plus: <><circle cx="12" cy="12" r="10"/><path d="M12 7v10M7 12h10"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    help: <><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17v1"/></>,
    accessibility: <><circle cx="12" cy="3" r="2"/><path d="M3 8h18M12 6v8M12 14l-5 8M12 14l5 8"/></>,
    bell: <><path d="M4 17h16l-2-3V9a6 6 0 0 0-12 0v5zM10 21h4"/></>,
    menu: <path d="M3 5h18M3 12h18M3 19h18"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function AppShell({ children, companyName, companyId, activeModule, companyControl, accountControls, accountName, pageNavigation, moduleLinks = {} }: AppShellProps) {
  const drawer = useRef<HTMLDialogElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const usersHref = companyId ? `/agents?company=${encodeURIComponent(companyId)}` : '/agents';
  function item(label: string, icon: IconName, href?: string, active = false, color?: string) {
    const content = <><span className={`ct-nav-icon${color ? ` ct-icon-${color}` : ''}`}><ShellIcon name={icon}/></span><span className="ct-nav-label">{label}</span>{!href && <span className="ct-unavailable">Unavailable</span>}</>;
    return href ? <Link href={href} className="ct-nav-item" aria-current={active ? 'page' : undefined} title={label} onClick={() => drawer.current?.close()}>{content}</Link> : <span className="ct-nav-item ct-nav-unavailable" aria-disabled="true" title={`${label} — unavailable`}>{content}</span>;
  }
  function navigation() {
    return <nav aria-label="Main navigation">
      <div className="ct-nav-static">{item('Overview', 'grid', moduleLinks.overview, activeModule === 'overview')}{item('Activity', 'activity', moduleLinks.activity, activeModule === 'activity')}{item('Users', 'users', usersHref, activeModule === 'users')}{item('Smart groups', 'groups', moduleLinks['smart-groups'], activeModule === 'smart-groups')}{item('Automations', 'automation')}{item('Job list', 'jobs')}</div>
      {([
        ['Communication', [['Chat', 'chat', moduleLinks.chat, 'chat', 'teal'], ['Client Rotas', 'calendar', moduleLinks.rotas, 'rotas', 'orange'], ['Time Off', 'calendar', moduleLinks['time-off'], 'time-off', 'teal'], ['Client Knowledge Base', 'jobs'], ['Client Training', 'jobs'], ['Knowledge Base', 'jobs']]],
        ['Operations', [['Time Clock', 'clock', moduleLinks['time-clock'], 'time-clock', 'orange'], ['Updates', 'activity', moduleLinks.updates, 'updates', 'teal'], ['Directory', 'users'], ['Knowledge Base', 'jobs'], ['Surveys', 'jobs'], ['Quick Tasks', 'jobs', moduleLinks['quick-tasks'], 'quick-tasks', 'teal'], ['Contracts', 'jobs'], ['Forms', 'jobs'], ['Onboarding', 'users'], ['Hiring', 'users']]],
        ['HR & Skills', [['Quizzes', 'jobs'], ['Events', 'calendar'], ['Help Desk', 'help'], ['Courses', 'jobs'], ['Rewards', 'jobs'], ['Documents', 'jobs'], ['Recognitions', 'users'], ['Celebrations', 'calendar'], ['Org Chart', 'groups']]],
      ] as [string, [string, IconName, string?, ShellModule?, string?][]][]).map(([group, modules]) => <details className="ct-nav-group" open key={group}><summary aria-label={group}><span className="ct-group-title">{group}</span><span className="ct-group-options" aria-label={`${group} options unavailable`} title="Section options unavailable">···</span><ShellIcon name="chevron"/></summary>{modules.map(([label, icon, href, module, color]) => <div key={label}>{item(label, icon, href, activeModule === module, color)}</div>)}<span className="ct-add-unavailable" aria-disabled="true" title="Adding modules is unavailable"><ShellIcon name="plus"/>Add new<span className="ct-unavailable">Unavailable</span></span></details>)}
      <span className="ct-add-section" aria-disabled="true"><ShellIcon name="plus"/>Add section<span className="ct-unavailable">Unavailable</span></span>
    </nav>;
  }
  return <div className={`ct-shell${collapsed ? ' ct-shell-collapsed' : ''}`}>
    <a className="ct-skip" href="#ct-main-content">Skip to content</a>
    <header className="ct-topbar">
      <button className="ct-mobile-menu ct-icon-button" aria-label="Open navigation" onClick={() => drawer.current?.showModal()}><ShellIcon name="menu"/></button>
      <Link className="ct-brand" href="/" aria-label="CT Alt home"><span className="ct-brand-mark" aria-hidden="true">CT</span><span>CT Alt</span></Link>
      <details className="ct-quick-nav"><summary><ShellIcon name="search"/><span>Find a module</span></summary><div>{moduleLinks.overview && <Link href={moduleLinks.overview}>Overview</Link>}{moduleLinks.activity && <Link href={moduleLinks.activity}>Activity</Link>}<Link href={usersHref}>Users</Link>{moduleLinks['smart-groups'] && <Link href={moduleLinks['smart-groups']}>Smart groups</Link>}{moduleLinks.rotas && <Link href={moduleLinks.rotas}>Client Rotas</Link>}{moduleLinks.chat && <Link href={moduleLinks.chat}>Company Chat</Link>}{moduleLinks['time-clock'] && <Link href={moduleLinks['time-clock']}>Time Clock</Link>}{moduleLinks['time-off'] && <Link href={moduleLinks['time-off']}>Time Off</Link>}{moduleLinks.updates && <Link href={moduleLinks.updates}>Updates</Link>}{moduleLinks['quick-tasks'] && <Link href={moduleLinks['quick-tasks']}>Quick Tasks</Link>}</div></details>
      <div className="ct-topbar-actions">
        <a className="ct-help" href="https://github.com/Jare7028/CT-Alt#readme" target="_blank" rel="noreferrer">Help <ShellIcon name="chevron"/></a>
        <details className="ct-accessibility"><summary aria-label="Accessibility information"><ShellIcon name="accessibility"/></summary><div>Use Tab to move between controls, Enter to activate, and Escape to close navigation. Use your browser’s zoom to enlarge the interface.</div></details>
        <span className="ct-notifications" aria-label="Notifications unavailable" title="Notifications unavailable"><ShellIcon name="bell"/></span>
        {companyControl ? <div className="ct-company-control">{companyControl}</div> : <span className="ct-company-name">{companyName}</span>}
        <details className="ct-account"><summary aria-label="Account menu"><span className="ct-account-avatar" aria-hidden="true">{(accountName || companyName).trim().slice(0,2).toUpperCase()}</span><ShellIcon name="chevron"/></summary><div><strong>{accountName || companyName}</strong>{accountControls || <Link href="/login">Sign-in options</Link>}</div></details>
      </div>
    </header>
    <div className="ct-shell-body"><aside className="ct-sidebar"><button className="ct-collapse ct-icon-button" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><span aria-hidden="true">{collapsed ? '›' : '‹'}</span></button>{navigation()}</aside><div id="ct-main-content" className="ct-shell-content" tabIndex={-1}>{pageNavigation ? <div className="ct-page-navigation">{pageNavigation}</div> : null}{children}</div></div>
    <dialog ref={drawer} className="ct-nav-drawer" aria-labelledby="ct-drawer-title"><div className="ct-drawer-heading"><strong id="ct-drawer-title">CT Alt navigation</strong><button className="ct-icon-button" aria-label="Close navigation" onClick={() => drawer.current?.close()}>×</button></div>{navigation()}</dialog>
  </div>;
}
