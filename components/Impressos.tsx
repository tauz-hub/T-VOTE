"use client";

// Os papéis que a urna imprime na bobina de 80 mm — os mesmos de hoje, com o
// que é preciso para conferir na cadeia de blocos:
//
//   ZERÉSIMA   na abertura (fiscais fotografam: chave da urna, nenhum voto)
//   BU         no encerramento, colado na porta da seção (código do BU + números)
//
// `imprimivel` marca qual papel vai para a impressora (só um por tela).
import type { ReactNode } from "react";
import { sha256Hex } from "@/lib/crypto/codificacao";
import type { Opcao } from "@/lib/crypto/quadro";
import { type DocumentoUrna, type ZeresimaSecao, codigoBU } from "@/lib/crypto/secao";
import type { ResumoBU } from "@/lib/tipos-api";

/** Impressão digital curta de uma chave: 16 caracteres em grupos de 4. */
export function digital(valor: string): string {
  return (valor.slice(0, 16).match(/.{4}/g) ?? []).join(" ");
}

export const digitalRSA = (n: string) => digital(sha256Hex(`T-VOTE/digital-rsa/v1|${n}`));

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Bobina({ imprimivel, children }: { imprimivel?: boolean; children: ReactNode }) {
  return (
    <div
      className={`${imprimivel ? "area-impressao" : ""} mx-auto w-[300px] bg-white px-4 py-3 text-left font-mono text-[11px] leading-snug text-black shadow ring-1 ring-stone-300`}
    >
      {children}
    </div>
  );
}

const Linha = () => <div className="my-2 border-t border-dashed border-black" />;

function Cabecalho({ titulo, eleicao, secao, urna, quando }: { titulo: string; eleicao: string; secao: string; urna: string; quando: string }) {
  const [z, s] = secao.split("-");
  return (
    <>
      <div className="text-center font-bold">T-VOTE · DEMONSTRAÇÃO</div>
      <div className="text-center text-[14px] font-bold">{titulo}</div>
      <div className="mt-1 text-center">{eleicao}</div>
      <div className="text-center font-bold">
        ZONA {z} · SEÇÃO {s}
      </div>
      <div className="text-center text-[10px]">{urna}</div>
      <div className="text-center">{quando}</div>
    </>
  );
}

function TabelaVotos({ opcoes, votos }: { opcoes: Opcao[]; votos: (i: number) => number }) {
  return (
    <table className="w-full">
      <tbody>
        {opcoes.map((o, i) => (
          <tr key={i}>
            <td className="w-6 align-top">{o.numero ?? ""}</td>
            <td className="truncate pr-1">{o.tipo === "candidato" ? o.nome : o.tipo === "branco" ? "BRANCOS" : "NULOS"}</td>
            <td className="w-8 text-right tabular-nums">{votos(i)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ZeresimaImpressa({ zeresima, eleicao, opcoes, imprimivel }: { zeresima: DocumentoUrna<ZeresimaSecao>; eleicao: string; opcoes: Opcao[]; imprimivel?: boolean }) {
  const z = zeresima.conteudo;
  return (
    <Bobina imprimivel={imprimivel}>
      <Cabecalho titulo="ZERÉSIMA" eleicao={eleicao} secao={z.secao} urna={z.urna} quando={`aberta em ${dataHora(z.aberta_em)}`} />
      <Linha />
      <TabelaVotos opcoes={opcoes} votos={() => 0} />
      <div className="mt-1 font-bold">CÉDULAS NA MEMÓRIA DA URNA: {z.cedulas}</div>
      <Linha />
      <div>CHAVE DA URNA: {digital(z.chave_urna)}</div>
      <div>CHAVE DA MESA: {digitalRSA(z.autoridade_secao.n)}</div>
      <div>SOFTWARE: {digital(z.software)}</div>
      <div className="font-bold">CÓDIGO DA ZERÉSIMA: {digital(zeresima.hash)}</div>
      <Linha />
      <div className="text-[10px]">
        Fiscais: fotografem este papel. A chave da urna tem de ser a MESMA publicada no quadro (bloco de carga) e a mesma do BU no fim do dia.
      </div>
      <div className="mt-1 break-all text-[7px] leading-tight">Assinatura da urna: {zeresima.assinatura}</div>
    </Bobina>
  );
}

export function BoletimImpresso({
  bu,
  eleicao,
  secao,
  urna,
  opcoes,
  imprimivel,
}: {
  bu: ResumoBU;
  eleicao: string;
  secao: string;
  urna: string;
  opcoes: Opcao[];
  imprimivel?: boolean;
}) {
  const total = bu.contagem.reduce((s, x) => s + x.votos, 0);
  return (
    <Bobina imprimivel={imprimivel}>
      <Cabecalho titulo="BOLETIM DE URNA" eleicao={eleicao} secao={secao} urna={urna} quando={`encerrada em ${dataHora(bu.encerrada_em)}`} />
      <Linha />
      <div className="font-bold">COMPARECIMENTO: {bu.comparecimento}</div>
      <Linha />
      <TabelaVotos opcoes={opcoes} votos={(i) => bu.contagem[i]?.votos ?? 0} />
      <div className="mt-1 font-bold">TOTAL DE VOTOS: {total}</div>
      <div>Cédulas de teste (abertas, não contadas): {bu.desafiadas}</div>
      <Linha />
      <div className="text-center font-bold">CÓDIGO DO BU</div>
      <div className="text-center text-[18px] font-bold tracking-wider">{codigoBU(bu.hash)}</div>
      <Linha />
      <div className="text-[10px]">
        Em “Verificar voto → Boletim da seção”, o código do BU e os números publicados têm de ser IGUAIS aos deste papel. Se o TSE trocar a
        seção, não batem.
      </div>
      <div className="mt-1 break-all text-[7px] leading-tight">
        Hash do BU: {bu.hash}
        <br />
        Assinatura da urna: {bu.assinatura}
      </div>
    </Bobina>
  );
}
