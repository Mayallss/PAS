import type { Metadata } from 'next';

// The one-time token is in the URL: never send it on as a Referer.
export const metadata: Metadata = { title: 'ตั้งรหัสผ่าน', referrer: 'no-referrer', robots: { index: false, follow: false } };

export default function SetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
