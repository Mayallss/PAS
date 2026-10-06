import Image from 'next/image';
import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarCog,
  CalendarDays,
  ClipboardCheck,
  Boxes,
  Clock3,
  DoorOpen,
  FileOutput,
  Files,
  FolderArchive,
  Globe,
  Handshake,
  Inbox,
  Laptop,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  ListTodo,
  Megaphone,
  PackageCheck,
  PlugZap,
  ShoppingCart,
  Signature,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** PAS logo from the legacy site (public/brand/pas-logo.png, 480×298). */
export function PasLogo({ className = 'h-8 w-auto', priority = false }: { className?: string; priority?: boolean }) {
  return <Image src="/brand/pas-logo.png" alt="PAS — Professional Accounting Service" width={480} height={298} className={className} priority={priority} />;
}

/** App icons are stored as data (app_link.icon): a lucide name, or a /brand/... image path. */
const ICONS: Record<string, LucideIcon> = {
  BarChart3, BookOpen, Boxes, Building2, CalendarCog, CalendarDays, ClipboardCheck, Clock3, DoorOpen, FileOutput, Files, FolderArchive, Globe, Handshake, Inbox, Laptop, LifeBuoy, ListChecks, ListTodo, Megaphone, PackageCheck, PlugZap, ShoppingCart, Signature, Truck, Users,
};

export function AppIcon({ icon, className = 'h-5 w-5' }: { icon: string; className?: string }) {
  if (icon.startsWith('/brand/')) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny local SVG/PNG icons, no optimisation needed
    return <img src={icon} alt="" className={`${className} object-contain`} aria-hidden />;
  }
  const Icon = ICONS[icon] ?? LayoutGrid;
  return <Icon className={className} aria-hidden />;
}
