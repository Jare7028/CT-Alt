import Link from 'next/link';
export default function UnavailableProfile() {
  return <main><h1>Agent details unavailable</h1><p>This record is unavailable or your role does not include access.</p><Link href="/agents">Return to Users</Link></main>;
}
