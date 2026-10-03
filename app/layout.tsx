import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CT Alt · Workforce',
  description: 'An independent workforce application, starting with client rotas.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
