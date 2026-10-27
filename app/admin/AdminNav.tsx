"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/conversas", label: "Conversas" },
  { href: "/admin/leads", label: "Contatos do site" },
  { href: "/admin/base", label: "Base" },
  { href: "/admin/prompt", label: "Prompt" },
  { href: "/admin/simulador", label: "Simulador" },
  { href: "/admin/whatsapp", label: "WhatsApp" },
];

/** Abas do console; a da página atual recebe o filete vermelho do guia. */
export function AdminNav() {
  const pathname = usePathname();
  const links = useRef<HTMLDivElement>(null);

  // No celular as abas rolam na horizontal; a da página atual precisa aparecer.
  useEffect(() => {
    links.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <div className="links" ref={links}>
      {LINKS.map((link) => {
        const active =
          link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
