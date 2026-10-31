"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, UserSquare2, FilePlus2, History, Settings, Building2,
  Shield, LogOut,
} from "lucide-react";
import { displayName, useAuth } from "@/lib/auth";
import { clsx } from "clsx";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profiles",  label: "Profiles",  icon: UserSquare2 },
  { href: "/new",       label: "New run",   icon: FilePlus2 },
  { href: "/history",   label: "History",   icon: History },
  { href: "/settings",  label: "Settings",  icon: Settings },
  { href: "/agency-branding", label: "Agency", icon: Building2 },
];

const ADMIN_NAV = [
  { href: "/admin/users",     label: "Users",     icon: Shield },
  { href: "/admin/runs",      label: "Runs",      icon: History },
  { href: "/admin/audit",     label: "Audit",     icon: Shield },
  { href: "/admin/reproduce", label: "Reproduce", icon: History },
  { href: "/admin/2fa",       label: "Two factor", icon: Shield },
];

export function AppShell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const items = admin ? ADMIN_NAV : NAV;

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-border bg-bg-2">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-gold to-gold-2" />
          <span className="font-semibold tracking-tight">Resume Engine</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-bg-3 text-fg"
                    : "text-fg-2 hover:bg-bg-3/60 hover:text-fg"
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 truncate text-xs text-fg-2">
            {displayName(user)} <span className="text-fg-2/60">· {user?.role}</span>
          </div>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-2 hover:bg-bg-3 hover:text-fg"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
