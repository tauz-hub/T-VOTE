"use client";

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useState } from "react";
import type { FaseEleicao } from "@/lib/tipos-api";
import { FotoCandidato } from "./FotoCandidato";

export function Pagina({ titulo, subtitulo, acoes, children }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitulo}</p>}
        </div>
        {acoes}
      </div>
      {children}
    </div>
  );
}

export function Cartao({ titulo, descricao, acoes, children, className = "" }: { titulo?: ReactNode; descricao?: ReactNode; acoes?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {(titulo || acoes) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {titulo && <h2 className="font-semibold text-slate-900">{titulo}</h2>}
            {descricao && <p className="mt-0.5 text-sm text-slate-500">{descricao}</p>}
          </div>
          {acoes}
        </div>
      )}
      {children}
    </section>
  );
}

const VARIANTES = {
  primario: "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400",
  secundario: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400",
  perigo: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  sucesso: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
};

export function Botao({ variante = "primario", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: keyof typeof VARIANTES }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTES[variante]} ${className}`}
    />
  );
}

export function Campo({ rotulo, dica, ...props }: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; dica?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{rotulo}</span>
      <input
        {...props}
        className={`mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 ${props.className ?? ""}`}
      />
      {dica && <span className="mt-1 block text-xs text-slate-500">{dica}</span>}
    </label>
  );
}

const CORES_SELO = {
  cinza: "bg-slate-100 text-slate-700 ring-slate-200",
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  vermelho: "bg-red-50 text-red-700 ring-red-200",
  amarelo: "bg-amber-50 text-amber-800 ring-amber-200",
  azul: "bg-sky-50 text-sky-700 ring-sky-200",
  roxo: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Selo({ cor = "cinza", children }: { cor?: keyof typeof CORES_SELO; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CORES_SELO[cor]}`}>{children}</span>;
}

const FASES: Record<FaseEleicao, { rotulo: string; cor: keyof typeof CORES_SELO }> = {
  configuracao: { rotulo: "Configuração", cor: "azul" },
  aberta: { rotulo: "Votação aberta", cor: "verde" },
  encerrada: { rotulo: "Encerrada — aguardando trustees", cor: "amarelo" },
  apurada: { rotulo: "Apurada", cor: "roxo" },
};

export function SeloFase({ fase }: { fase?: FaseEleicao }) {
  if (!fase) return <Selo>Sem eleição</Selo>;
  return <Selo cor={FASES[fase].cor}>{FASES[fase].rotulo}</Selo>;
}

export function Hash({ valor, n = 12, className = "" }: { valor?: string | null; n?: number; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  if (!valor) return <span className="text-slate-400">—</span>;
  return (
    <button
      type="button"
      title={`${valor}\n(clique para copiar)`}
      onClick={() => {
        void navigator.clipboard?.writeText(valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1200);
      }}
      className={`hash rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-200 ${className}`}
    >
      {copiado ? "copiado!" : valor.length > n ? `${valor.slice(0, n)}…` : valor}
    </button>
  );
}

export function IconeStatus({ status }: { status: "ok" | "falha" | "pendente" }) {
  if (status === "ok") return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm text-emerald-700">✓</span>;
  if (status === "falha") return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-100 text-sm text-red-700">✕</span>;
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-sm text-slate-400">·</span>;
}

export function Estatistica({ rotulo, valor, dica }: { rotulo: string; valor: ReactNode; dica?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" title={dica}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{valor}</div>
    </div>
  );
}

const CORES_AVISO = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  alerta: "border-amber-200 bg-amber-50 text-amber-900",
  erro: "border-red-200 bg-red-50 text-red-900",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function Aviso({ tipo = "info", titulo, children }: { tipo?: keyof typeof CORES_AVISO; titulo?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${CORES_AVISO[tipo]}`}>
      {titulo && <div className="mb-0.5 font-semibold">{titulo}</div>}
      <div>{children}</div>
    </div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return <div className="py-10 text-center text-sm text-slate-500">{texto}</div>;
}

type OpcaoGrafico = { numero: string | null; nome: string; partido?: string; foto?: string; tipo?: string };

export function GraficoResultado({ resultado }: { resultado: { opcao: OpcaoGrafico; votos: number }[] }) {
  const total = resultado.reduce((s, r) => s + r.votos, 0) || 1;
  const maximo = Math.max(...resultado.map((r) => r.votos), 1);
  return (
    <div className="space-y-2.5">
      {resultado.map((r) => (
        <div key={r.opcao.nome} className="grid grid-cols-[16rem_1fr_5rem] items-center gap-3 text-sm max-sm:grid-cols-[9rem_1fr_4rem]">
          <div className="flex min-w-0 items-center gap-2" title={r.opcao.partido ? `${r.opcao.nome} (${r.opcao.partido})` : r.opcao.nome}>
            {r.opcao.numero && <FotoCandidato tamanho="sm" hash={r.opcao.foto} nome={r.opcao.nome} />}
            <span className="truncate">
              {r.opcao.numero && <span className="hash mr-1.5 text-slate-500">{r.opcao.numero}</span>}
              {r.opcao.nome}
              {r.opcao.partido && <span className="ml-1 text-xs text-slate-400">{r.opcao.partido}</span>}
            </span>
          </div>
          <div className="h-5 overflow-hidden rounded bg-slate-100">
            <div className="h-full rounded bg-slate-800" style={{ width: `${(r.votos / maximo) * 100}%` }} />
          </div>
          <div className="text-right tabular-nums">
            <span className="font-semibold">{r.votos}</span>
            <span className="ml-1 text-xs text-slate-500">{((r.votos / total) * 100).toFixed(0)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
