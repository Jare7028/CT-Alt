export default function DirectoryIcon({name}:{name:'search'|'filter'|'chevron'|'export'|'columns'}) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{
    name==='search' ? <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></> :
    name==='filter' ? <path d="M3 6h18M6 12h12M9 18h6"/> :
    name==='chevron' ? <path d="m7 10 5 5 5-5"/> :
    name==='export' ? <><path d="M12 16V3m-5 5 5-5 5 5M5 14v7h14v-7"/></> :
    <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></>
  }</svg>;
}
