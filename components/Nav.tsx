"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", rotulo: "Início" },
  { href: "/cadastro", rotulo: "Cadastro" },
  { href: "/mesario", rotulo: "Mesário" },
  { href: "/urna", rotulo: "Urna" },
  { href: "/verificar", rotulo: "Verificar voto" },
  { href: "/teste", rotulo: "Conferir teste" },
  { href: "/apuracao", rotulo: "Trustees" },
  { href: "/auditoria", rotulo: "Auditoria" },
  { href: "/admin", rotulo: "Admin" },
  { href: "/seguranca", rotulo: "Segurança" },
];

export function Nav() {
  const atual = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-xs text-white">TV</span>
          TAI-VOTE
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const ativo = l.href === "/" ? atual === "/" : atual.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
                  ativo ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {l.rotulo}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
