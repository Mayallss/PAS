import type { Metadata } from 'next';

// The share token is in the URL: never send it on as a Referer to anything this page links to or loads.
export const metadata: Metadata = { title: 'เซ็นรับ–ส่งเอกสาร', referrer: 'no-referrer', robots: { index: false, follow: false } };

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
