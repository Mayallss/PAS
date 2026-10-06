import {
  BookOpenCheck,
  ChartNoAxesCombined,
  CloudCog,
  FileSearch,
  IdCard,
  ShieldCheck,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { ServiceIcon } from '@/content/site';

export const SERVICE_ICONS: Record<ServiceIcon, LucideIcon> = {
  book: BookOpenCheck,
  search: FileSearch,
  shield: ShieldCheck,
  wallet: WalletCards,
  chart: ChartNoAxesCombined,
  users: UsersRound,
  passport: IdCard,
  cloud: CloudCog,
};

// Brand marks (lucide ships no logos). Paths from Simple Icons, CC0.
type P = { className?: string };

export function FacebookIcon({ className = 'h-5 w-5' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  );
}

export function LinkedInIcon({ className = 'h-5 w-5' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export function TikTokIcon({ className = 'h-5 w-5' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

/** LINE speech-bubble mark, simplified. */
export function LineIcon({ className = 'h-5 w-5' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 5.64 2 10.13c0 4.02 3.56 7.39 8.37 8.03.33.07.77.22.88.5.1.26.07.66.03.92l-.14.86c-.04.26-.2 1 .87.55 1.08-.45 5.8-3.42 7.91-5.85C21.37 13.55 22 11.92 22 10.13 22 5.64 17.52 2 12 2Zm-3.9 10.6H6.12a.53.53 0 0 1-.52-.52V8.1a.52.52 0 1 1 1.05 0v3.45H8.1a.52.52 0 1 1 0 1.05Zm2.05-.52a.52.52 0 1 1-1.05 0V8.1a.52.52 0 1 1 1.05 0v3.98Zm4.77 0a.52.52 0 0 1-.94.31l-2.03-2.77v2.46a.52.52 0 1 1-1.05 0V8.1a.52.52 0 0 1 .94-.31l2.03 2.77V8.1a.52.52 0 1 1 1.05 0v3.98Zm3.2-2.51a.52.52 0 1 1 0 1.05h-1.45v.94h1.45a.52.52 0 1 1 0 1.05h-1.97a.52.52 0 0 1-.52-.52V8.1c0-.29.23-.53.52-.53h1.97a.52.52 0 1 1 0 1.05h-1.45v.94h1.45Z" />
    </svg>
  );
}
