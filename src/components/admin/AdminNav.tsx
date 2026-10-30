"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "../shared/api";

const LINKS = [
  { href: "/admin", label: "Today" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/menu", label: "Menu" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav({ restaurant, user }: { restaurant: string; user: string }) {
  const path = usePathname();
  async function logout() {
    await api("/api/admin/logout", { method: "POST" });
    window.location.assign("/admin/login");
  }
  return (
    <header className="bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="font-display text-lg font-bold">{restaurant} kitchen</span>
        <nav className="flex flex-wrap items-center gap-1 text-[15px]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined} className={`rounded px-3 py-1.5 ${path === l.href ? "bg-mustard font-bold text-ink" : "hover:bg-leaf"}`}>
              {l.label}
            </Link>
          ))}
          <button type="button" onClick={logout} className="ml-2 rounded px-3 py-1.5 text-paper/80 hover:bg-leaf" title={`Signed in as ${user}`}>
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
