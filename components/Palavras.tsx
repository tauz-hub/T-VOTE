"use client";

import { type Figura, figuraDaPalavra, formatarCodigo, formatarConferencia, secaoDoCodigo } from "@/lib/crypto/palavras";

const TAMANHOS = {
  grande: { cartao: "min-w-28 px-3 py-2", figura: "text-6xl", palavra: "text-base" },
  medio: { cartao: "min-w-20 px-2 py-1.5", figura: "text-4xl", palavra: "text-xs" },
  pequeno: { cartao: "min-w-14 px-1.5 py-1", figura: "text-2xl", palavra: "text-[10px]" },
};

/** Figura grande em cima da palavra: dá para lembrar sem precisar ler. */
export function FigurasVerificacao({ figuras, tamanho = "grande" }: { figuras: Figura[]; tamanho?: keyof typeof TAMANHOS }) {
  const t = TAMANHOS[tamanho];
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {figuras.map((f, i) => (
        <div key={i} className={`flex flex-col items-center rounded-lg bg-white ring-2 ring-stone-400 ${t.cartao}`}>
          <span className={`${t.figura} leading-none`} role="img" aria-label={f.palavra}>
            {f.figura}
          </span>
          <span className={`mt-1 font-sans font-bold uppercase tracking-wide text-stone-800 ${t.palavra}`}>{f.palavra}</span>
        </div>
      ))}
    </div>
  );
}

/** As figuras de uma cédula, a partir dos nomes gravados no bloco. */
export function FigurasDaCedula({ nomes, tamanho = "grande" }: { nomes: string[]; tamanho?: keyof typeof TAMANHOS }) {
  const figuras = nomes.map((n) => figuraDaPalavra(n)).filter((f): f is Figura => !!f);
  return <FigurasVerificacao figuras={figuras} tamanho={tamanho} />;
}

/**
 * Código de verificação de 12 caracteres: zona, seção e a parte que veio do selo.
 * Com `conferencia`, mostra também os 8 caracteres que saem impressos junto
 * (não é preciso decorar: em casa, compara-se com o papel).
 */
export function CodigoVerificacao({ codigo, conferencia, tamanho = "grande" }: { codigo: string; conferencia?: string; tamanho?: "grande" | "medio" }) {
  const { zona, secao } = secaoDoCodigo(codigo);
  const [z, s, a] = formatarCodigo(codigo).split(" ");
  const fonte = tamanho === "grande" ? "text-3xl" : "text-xl";
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="inline-flex items-end gap-3 font-mono" aria-label={`Zona ${zona}, seção ${secao}, código ${a}`}>
        {[
          [z, "zona"],
          [s, "seção"],
          [a, "código"],
        ].map(([v, r]) => (
          <div key={r} className="flex flex-col items-center">
            <span className={`${fonte} font-bold tracking-wider text-stone-900`}>{v}</span>
            <span className="font-sans text-[10px] uppercase tracking-wide text-stone-500">{r}</span>
          </div>
        ))}
      </div>
      {conferencia && (
        <div className="font-mono text-sm text-stone-700" aria-label={`conferência ${conferencia}`}>
          <span className="font-sans text-[10px] uppercase tracking-wide text-stone-500">conferência </span>
          <span className="font-semibold tracking-wider">{formatarConferencia(conferencia)}</span>
        </div>
      )}
    </div>
  );
}

/** O hash completo da cédula, em grupos de 8 — para auditores. */
export function HashCompleto({ valor, rotulo = "Hash da cédula" }: { valor: string; rotulo?: string }) {
  const grupos = valor.match(/.{1,8}/g) ?? [];
  return (
    <div className="text-center">
      <div className="font-sans text-[11px] uppercase tracking-wide text-stone-500">{rotulo}</div>
      <div className="hash mx-auto mt-0.5 grid max-w-[22rem] grid-cols-4 gap-x-2 text-[12px] font-semibold text-stone-800">
        {grupos.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </div>
    </div>
  );
}
