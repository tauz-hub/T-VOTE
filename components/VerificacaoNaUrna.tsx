"use client";

import { useState } from "react";
import { type Verificacao, contextoDaCarga } from "@/lib/client/protocolo";
import { codigoVerificacao, nomesDasFiguras } from "@/lib/crypto/palavras";
import { type Cedula, verificarCedula } from "@/lib/crypto/cedula";
import { type Recibo, verificarRecibo, verificarSelo } from "@/lib/crypto/quadro";
import type { CargaUrna } from "@/lib/tipos-api";

type Status = "ok" | "falha" | "pendente";

function Icone({ s }: { s: Status }) {
  const estilo = s === "ok" ? "bg-emerald-600" : s === "falha" ? "bg-red-600" : "bg-stone-400";
  return <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${estilo}`}>{s === "ok" ? "✓" : s === "falha" ? "✕" : "…"}</span>;
}

function Item({ s, titulo, detalhe }: { s: Status; titulo: string; detalhe?: string }) {
  return (
    <li className="flex items-start gap-2">
      <Icone s={s} />
      <div>
        <div className="font-semibold text-stone-800">{titulo}</div>
        {detalhe && <div className="text-stone-600">{detalhe}</div>}
      </div>
    </li>
  );
}

export type Software = { confere?: boolean; hash?: string; alterados?: string[] };

/**
 * Mostra se o código desta urna é o publicado na gênese. Limite honesto: um
 * software adulterado pode mentir aqui (veja a urna do laboratório) — quem
 * pega a mentira é o teste da urna, conferido em outro aparelho.
 */
export function SeloSoftware({ software, claro = false }: { software: Software | null; claro?: boolean }) {
  if (!software || software.confere === undefined) return null;
  const ok = software.confere;
  const cor = ok ? (claro ? "text-emerald-300" : "text-emerald-700") : claro ? "text-amber-300" : "text-amber-700";
  return (
    <span className={`font-sans text-xs ${cor}`} title={ok ? `hash ${software.hash}` : `alterados: ${software.alterados?.join(", ")}`}>
      {ok
        ? `✓ software conferido com a gênese (${software.hash?.slice(0, 8)})`
        : `⚠ software diferente do publicado na gênese (${software.alterados?.length ?? "?"} arquivo(s))`}
    </span>
  );
}

/**
 * Verificação do voto feita na própria urna, logo depois do depósito — sem rede:
 * tudo é conferido com as chaves da carga. Para conferir SEM depender desta
 * urna, o eleitor usa o código e as figuras em casa, depois da apuração.
 */
export function VerificacaoNaUrna({
  recibo,
  cedula,
  verif,
  carga,
  software,
}: {
  recibo: Recibo;
  cedula: Cedula;
  verif: Verificacao;
  carga: CargaUrna;
  software: Software | null;
}) {
  // conferências locais: feitas uma vez (a de provas leva alguns milissegundos)
  const [locais] = useState(() => ({
    recibo: verificarRecibo(recibo, carga.chave_urna),
    selo:
      verificarSelo(carga.hash_eleicao, recibo.rastreador, verif.secao, verif.selo, carga.chave_urna) &&
      verif.codigo === codigoVerificacao(verif.secao, verif.selo) &&
      verif.figuras.join("|") === nomesDasFiguras(verif.selo).join("|"),
    cedula: verificarCedula(cedula, contextoDaCarga(carga)).ok,
  }));

  return (
    <div className="mt-4 rounded-lg bg-[#f3f1e7] p-4 font-sans text-xs shadow-inner">
      <div className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-700">Verificação do seu voto, feita aqui na urna (sem rede)</div>
      <ul className="grid gap-2 sm:grid-cols-2">
        <Item s={locais.recibo ? "ok" : "falha"} titulo="Recibo assinado pela urna" detalhe="com a chave da urna publicada na carga, antes da votação" />
        <Item s={locais.selo ? "ok" : "falha"} titulo="Código e figuras vêm do selo da urna" detalhe="a seção está na assinatura; o código começa com ela" />
        <Item s={locais.cedula ? "ok" : "falha"} titulo="Cédula válida" detalhe="credencial da mesa, assinatura e provas de conhecimento zero conferem" />
        <Item
          s={software?.confere === undefined ? "pendente" : software.confere ? "ok" : "falha"}
          titulo="Software desta urna = publicado"
          detalhe={software?.confere ? "mesmo código registrado na gênese (a própria urna diz — veja o aviso abaixo)" : `diferente em: ${software?.alterados?.join(", ")}`}
        />
        <Item s="ok" titulo={`Guardada na memória da urna (seção ${carga.secao})`} detalhe="sem ordem e sem horário; vai inteira para o BU no encerramento" />
        <Item s="pendente" titulo="Publicada na cadeia de blocos" detalhe="quando a mídia da seção chegar ao TSE, depois do encerramento" />
      </ul>
      <p className="mt-3 text-stone-600">
        Esta lista é calculada pela própria urna — uma urna adulterada poderia mentir aqui. Por isso o que vale é a conferência{" "}
        <strong>fora dela</strong>: em casa, com o código do comprovante, o validador mostra as figuras gravadas no BU. Nada aqui mostra em quem
        você votou: é isso que impede a venda de voto.
      </p>
    </div>
  );
}
