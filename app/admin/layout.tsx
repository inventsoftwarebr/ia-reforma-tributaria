import Link from "next/link";
import type { ReactNode } from "react";
import { requireAgent } from "@/lib/admin/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAgent();

  return (
    <>
      <nav className="nav">
        <span className="brand">IA da Reforma Tributária</span>
        <Link href="/admin">Painel</Link>
        <Link href="/admin/conversas">Conversas</Link>
        <Link href="/admin/base">Base</Link>
        <Link href="/admin/prompt">Prompt</Link>
        <Link href="/admin/whatsapp">WhatsApp</Link>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {user.email} · {user.role}
        </span>
      </nav>
      <div className="shell">{children}</div>
    </>
  );
}
