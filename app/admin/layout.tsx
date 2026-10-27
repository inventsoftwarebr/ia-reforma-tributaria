import Link from "next/link";
import type { ReactNode } from "react";
import { InventLogo } from "@/components/InventLogo";
import { requireAgent } from "@/lib/admin/auth";
import { AdminNav } from "./AdminNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAgent();

  return (
    <div className="console">
      <nav className="nav" aria-label="Console">
        <Link href="/admin" className="brand" aria-label="Painel do console">
          <InventLogo />
          <span className="divider" aria-hidden="true" />
          <span className="product">IA da Reforma Tributária</span>
        </Link>
        <AdminNav />
        <span className="spacer" />
        <span className="who" title={user.email ?? undefined}>
          <span className="who-email">{user.email}</span>
          <span className="tag" data-tone={user.role === "admin" ? "brand" : undefined}>
            {user.role}
          </span>
        </span>
      </nav>
      <div className="shell">{children}</div>
    </div>
  );
}
