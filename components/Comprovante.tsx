"use client";

import { chaveTesteParaTexto, formatarCodigo, formatarConferencia, secaoDoCodigo } from "@/lib/crypto/palavras";
import type { Opcao, Recibo } from "@/lib/crypto/quadro";
import type { DeclaracaoTeste } from "@/lib/crypto/secao";

/** Um teste da urna feito pelo eleitor nesta sessão (vai no mesmo papel do voto). */
export type TesteImpresso = { codigo: string; conferencia: string; declaracao: DeclaracaoTeste };

/**
 * Comprovante impresso pela urna, no formato do comprovante de votação (bobina
 * de 80 mm) — mas ANÔNIMO:
 *
 *  • sem nome e sem título de eleitor: o comprovante com nome continua sendo o
 *    do mesário, separado. Pôr o código no mesmo papel do nome ligaria eleitor e
 *    cédula, e a urna nem sabe quem está votando;
 *  • sem horário (só a data): horário por voto foi o que permitiu reconstruir a
 *    ordem dos votos no TPS 2012;
 *  • com o NOME das 2 figuras (só a palavra): o eleitor confere na hora que o
 *    papel bate com a tela e, em casa, que o site mostra as mesmas. Não revela
 *    o voto — as figuras saem do selo, como o código.
 *
 * Os testes da urna feitos na mesma sessão saem no MESMO papel (economiza
 * bobina): o candidato que a urna declarou, código, conferência e a CHAVE da
 * cédula de teste, com a declaração assinada. A cédula de teste foi anulada: o
 * teste não diz em quem o eleitor votou — ele pode testar um candidato e votar
 * em outro.
 *
 * `imprimivel` (padrão) marca o papel que vai para a impressora.
 */
export function Comprovante({
  eleicao,
  urna,
  recibo,
  codigo,
  conferencia,
  figuras,
  testes = [],
  opcoes = [],
  imprimivel = true,
}: {
  eleicao: string;
  urna: string;
  recibo: Recibo;
  codigo: string;
  conferencia: string;
  figuras: string[];
  testes?: TesteImpresso[];
  opcoes?: Opcao[];
  imprimivel?: boolean;
}) {
  const { zona, secao } = secaoDoCodigo(codigo);
  const data = new Date().toLocaleDateString("pt-BR");
  const linha = <div className="my-2 border-t border-dashed border-black" />;
  return (
    <div className={`${imprimivel ? "area-impressao" : ""} mx-auto w-[300px] bg-white px-4 py-3 text-left font-mono text-[11px] leading-snug text-black shadow ring-1 ring-stone-300`}>
      <div className="text-center font-bold">T-VOTE · DEMONSTRAÇÃO</div>
      <div className="text-center font-bold">COMPROVANTE DE VOTAÇÃO</div>
      <div className="mt-1 text-center">{eleicao}</div>
      <div className="text-center">{data}</div>
      <div className="text-center">
        ZONA {zona} · SEÇÃO {secao}
      </div>
      <div className="text-center text-[10px]">{urna}</div>
      {linha}
      <div className="text-center font-bold">CÓDIGO DO SEU VOTO</div>
      <div className="mt-1 text-center text-[22px] font-bold tracking-widest">{formatarCodigo(codigo)}</div>
      <div className="text-center">
        CONFERÊNCIA: <span className="font-bold tracking-wider">{formatarConferencia(conferencia)}</span>
      </div>
      <div className="mt-1 text-center">
        FIGURAS: <span className="font-bold">{figuras.map((f) => f.toUpperCase()).join(" · ")}</span>
      </div>
      <div className="mt-2 text-center font-bold">Este código NÃO mostra em quem você votou.</div>

      {testes.map((t, i) => {
        const o = opcoes[t.declaracao.opcao];
        return (
          <div key={t.declaracao.rastreador}>
            {linha}
            <div className="text-center font-bold">TESTE DA URNA{testes.length > 1 ? ` ${i + 1}` : ""} — ANULADO, NÃO É VOTO</div>
            <div className="mt-1 text-center">A urna declara que a cédula testada continha:</div>
            <div className="text-center text-[13px] font-bold">
              {o?.numero ? `${o.numero} — ` : ""}
              {o?.nome}
            </div>
            <div className="mt-1 text-center">
              CÓDIGO DO TESTE: <span className="font-bold">{formatarCodigo(t.codigo)}</span>
            </div>
            <div className="text-center">CONFERÊNCIA: {formatarConferencia(t.conferencia)}</div>
            <div className="mt-1 text-center">CHAVE DO TESTE:</div>
            <div className="text-center font-bold tracking-wider">{chaveTesteParaTexto(t.declaracao.semente)}</div>
            <div className="mt-1 break-all text-[7px] leading-tight">Declaração assinada pela urna: {t.declaracao.assinatura}</div>
          </div>
        );
      })}

      {linha}
      <ol className="list-decimal space-y-0.5 pl-4">
        <li>Confira agora: as 2 FIGURAS acima são as mesmas da tela da urna.</li>
        <li>Depois da apuração, em “Verificar voto”, digite o código: devem aparecer as mesmas figuras e a mesma conferência.</li>
        {testes.length > 0 && <li>Para o teste: digite o código e a chave do teste — o seu computador mostra o que a urna cifrou de verdade.</li>}
      </ol>
      {linha}
      <div className="break-all text-[7px] leading-tight">
        Hash completo (auditoria): {recibo.rastreador}
        <br />
        Assinatura da urna (prova de que a cédula foi aceita): {recibo.assinatura}
      </div>
    </div>
  );
}
