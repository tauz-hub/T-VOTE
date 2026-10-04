// Operações dos trustees. Executadas no navegador de cada trustee: a chave
// privada x_i nunca é enviada ao servidor.
import type { CifraPontos } from "./elgamal";
import { G, elevar, escalarAleatorio, escalarDeHex, escalarHex, gElevado, pontoDeHex, pontoHex } from "./grupo";

import { provarConhecimento, provarIgualdadeLog } from "./provas";
import { type ConteudoChaveTrustee, type ConteudoDecriptacao, contextoDecriptacao, contextoTrustee } from "./quadro";

export type SegredoTrustee = {
  formato: "t-vote/trustee/v1";
  eleicao_id: string;
  trustee: number;
  nome: string;
  chave_privada: string;
  chave_publica: string;
};

export function gerarChaveTrustee(
  eleicaoId: string,
  trustee: number,
  nome: string,
): { segredo: SegredoTrustee; publico: ConteudoChaveTrustee } {
  const x = escalarAleatorio();
  const X = gElevado(x);
  const chave_publica = pontoHex(X);
  return {
    segredo: { formato: "t-vote/trustee/v1", eleicao_id: eleicaoId, trustee, nome, chave_privada: escalarHex(x), chave_publica },
    publico: { trustee, nome, chave_publica, prova: provarConhecimento(x, X, contextoTrustee(eleicaoId, trustee)) },
  };
}

/**
 * Para cada seção: D_j = A_j^{x_i}, com prova de que log_g(h_i) = log_{A_j}(D_j).
 * Decifrar por seção permite comparar o resultado com o BU impresso de cada uma.
 */
export function decifrarParcial(
  segredo: SegredoTrustee,
  agregados: { secao: string; agregado: CifraPontos[] }[],
  hashEleicao: string,
): ConteudoDecriptacao {
  const x = escalarDeHex(segredo.chave_privada);
  const X = pontoDeHex(segredo.chave_publica);
  if (!gElevado(x).equals(X)) throw new Error("arquivo de chave corrompido");
  return {
    trustee: segredo.trustee,
    secoes: agregados.map(({ secao, agregado }) => ({
      secao,
      parciais: agregado.map((c, j) => {
        const D = elevar(c.a, x);
        return {
          d: pontoHex(D),
          prova: provarIgualdadeLog(G, X, c.a, D, x, contextoDecriptacao(hashEleicao, secao, segredo.trustee, j)),
        };
      }),
    })),
  };
}
