import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Thai } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { Providers } from './providers';

// Self-hosted at build time: no runtime request to Google, no layout shift.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const thai = Noto_Sans_Thai({ subsets: ['thai'], variable: '--font-thai', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'PAS Employee Portal', template: '%s · PAS' },
  description: 'ระบบบันทึกเวลาทำงาน PAS',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#2E3192' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${inter.variable} ${thai.variable}`}>
      <body className="min-h-screen font-sans text-[14px] antialiased">
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
