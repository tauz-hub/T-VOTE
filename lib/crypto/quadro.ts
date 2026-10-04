// Quadro público nacional (bulletin board) como cadeia de blocos encadeados por
// hash e assinados pela chave do quadro (TSE). Não é blockchain com mineração:
// é um log append-only verificável.
//
//   hash_n = SHA-256(numero | tipo | conteudo | hash_{n-1} | publicado_em)
//   assinatura_n = Ed25519(chave_quadro, hash_n)
//
// Protocolo v4 — seção offline. Durante a votação a urna NÃO fala com o quadro:
// ela sela, guarda e conta sozinha, com a própria chave. O quadro só recebe:
//
//   CARGA   chave pública de cada urna e da mesa da seção, antes do primeiro voto
//   SECAO   a mídia da urna depois do encerramento: zerésima + boletim de urna (BU),
//           assinados pela urna, com todas as cédulas da seção
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, ehHex, hexToBytes, jsonCanonico, sha256Hex } from "./codificacao";
import type { ProvaIgualdade, ProvaSchnorr } from "./provas";
import type { ChaveRSAPublica } from "./rsa-cega";
import type { BoletimUrna, DocumentoUrna, ZeresimaSecao } from "./secao";

export const HASH_INICIAL = "0".repeat(64);
export const NUM_TRUSTEES = 3;
/** v4: seção offline — urna com chave própria, zerésima e BU assinados pela urna, mídia transmitida depois do encerramento. */
export const VERSAO_PROTOCOLO = 4;

/** foto = SHA-256 da imagem: a urna só exibe a foto se o hash bater com a gênese. */
export type Opcao = { numero: string | null; nome: string; partido?: string; foto?: string; tipo: "candidato" | "branco" | "nulo" };

export type ConteudoGenese = {
  versao_protocolo: number;
  eleicao_id: string;
  nome: string;
  opcoes: Opcao[];
  grupo: "ristretto255";
  trustees_necessarios: number;
  chave_quadro: string;
  software: { hash: string; arquivos: Record<string, string> };
};

export type ConteudoChaveTrustee = { trustee: number; nome: string; chave_publica: string; prova: ProvaSchnorr };

/** Zerésima nacional: chave da eleição publicada antes de qualquer urna receber a carga. */
export type ConteudoAbertura = {
  chave_publica_conjunta: string;
  hash_eleicao: string;
  zeresima: { secoes_recebidas: number };
};

/**
 * Carga de uma urna (como a cerimônia de carga no TRE): a urna gera a própria
 * chave Ed25519 lá dentro e a mesa da seção gera a chave RSA das credenciais.
 * Só as chaves PÚBLICAS vêm para o quadro — antes do primeiro voto.
 */
export type ConteudoCarga = {
  secao: string;
  urna: string;
  chave_urna: string;
  autoridade_secao: ChaveRSAPublica;
  software: string;
};

/** Mídia de resultado da seção, recebida depois do encerramento. */
export type ConteudoSecao = {
  secao: string;
  zeresima: DocumentoUrna<ZeresimaSecao>;
  bu: DocumentoUrna<BoletimUrna>;
};

export type ConteudoEncerramento = {
  secoes: { secao: string; bu: string; cedulas: number; desafiadas: number }[];
  /** seções que receberam carga mas cuja mídia não chegou — o BU em papel delas existe na escola */
  secoes_sem_midia: string[];
  total_cedulas: number;
  total_desafiadas: number;
};

export type ParcialSecao = { secao: string; parciais: { d: string; prova: ProvaIgualdade }[] };
export type ConteudoDecriptacao = { trustee: number; secoes: ParcialSecao[] };

export type Contagem = { opcao: number; votos: number }[];
export type ConteudoResultado = { secoes: { secao: string; contagem: Contagem }[]; contagem: Contagem; total: number };

export type ConteudoPorTipo = {
  GENESE: ConteudoGenese;
  CHAVE_TRUSTEE: ConteudoChaveTrustee;
  ABERTURA: ConteudoAbertura;
  CARGA: ConteudoCarga;
  SECAO: ConteudoSecao;
  ENCERRAMENTO: ConteudoEncerramento;
  DECRIPTACAO_PARCIAL: ConteudoDecriptacao;
  RESULTADO: ConteudoResultado;
};

export type TipoBloco = keyof ConteudoPorTipo;

export type CabecalhoBloco<T extends TipoBloco = TipoBloco> = {
  numero: number;
  tipo: T;
  conteudo: ConteudoPorTipo[T];
  hash_anterior: string;
  publicado_em: string;
};

export type Bloco<T extends TipoBloco = TipoBloco> = CabecalhoBloco<T> & { hash: string; assinatura: string };

export function hashBloco(b: CabecalhoBloco): string {
  return sha256Hex(
    "T-VOTE/bloco/v1|" +
      jsonCanonico({
        numero: b.numero,
        tipo: b.tipo,
        conteudo: b.conteudo,
        hash_anterior: b.hash_anterior,
        publicado_em: b.publicado_em,
      }),
  );
}

/** Monta o próximo bloco da cadeia: calcula o hash e assina com a chave do quadro. */
export function montarBloco<T extends TipoBloco>(
  anterior: { numero: number; hash: string } | null,
  tipo: T,
  conteudo: ConteudoPorTipo[T],
  chavePrivadaQuadro: string,
  publicado_em: string,
): Bloco<T> {
  const cabecalho: CabecalhoBloco<T> = {
    numero: anterior ? anterior.numero + 1 : 1,
    tipo,
    conteudo,
    hash_anterior: anterior ? anterior.hash : HASH_INICIAL,
    publicado_em,
  };
  const hash = hashBloco(cabecalho);
  return { ...cabecalho, hash, assinatura: assinarHash(hash, chavePrivadaQuadro) };
}

export function assinarHash(hashHex: string, chavePrivadaHex: string): string {
  return bytesToHex(ed25519.sign(hexToBytes(hashHex), hexToBytes(chavePrivadaHex)));
}

export function verificarAssinaturaHash(hashHex: string, assinaturaHex: string, chavePublicaHex: string): boolean {
  try {
    if (!ehHex(hashHex, 32) || !ehHex(assinaturaHex, 64) || !ehHex(chavePublicaHex, 32)) return false;
    return ed25519.verify(hexToBytes(assinaturaHex), hexToBytes(hashHex), hexToBytes(chavePublicaHex));
  } catch {
    return false;
  }
}

/** Hash da eleição: compromete gênese, chaves dos trustees e chave conjunta. Toda cédula referencia este valor. */
export function calcularHashEleicao(
  hashGenese: string,
  trustees: { trustee: number; chave_publica: string }[],
  chaveConjunta: string,
): string {
  return sha256Hex(
    jsonCanonico({
      dominio: "T-VOTE/eleicao/v1",
      genese: hashGenese,
      trustees: [...trustees]
        .sort((x, y) => x.trustee - y.trustee)
        .map((t) => ({ trustee: t.trustee, chave_publica: t.chave_publica })),
      chave_conjunta: chaveConjunta,
    }),
  );
}

export function contextoTrustee(eleicaoId: string, trustee: number): string {
  return `${eleicaoId}|trustee|${trustee}`;
}

/** A seção entra no contexto: a prova de decifração de uma seção não serve para outra. */
export function contextoDecriptacao(hashEleicao: string, secao: string, trustee: number, opcao: number): string {
  return `${hashEleicao}|decriptacao|${secao}|${trustee}|${opcao}`;
}

// ---------------------------------------------------------------- Recibos
//
// O recibo prova que a URNA aceitou a cédula (rastreador), sem dizer em quem se
// votou e sem horário. É assinado pela chave da urna, registrada na carga: se a
// cédula não aparecer na mídia da seção, o eleitor tem prova assinada da omissão.

export type TipoRecibo = "RECIBO_CEDULA" | "RECIBO_DESAFIO";
export type Recibo = { tipo: TipoRecibo; eleicao: string; secao: string; rastreador: string; assinatura: string };

export function hashRecibo(tipo: TipoRecibo, eleicao: string, secao: string, rastreador: string): string {
  return sha256Hex("T-VOTE/recibo/v2|" + jsonCanonico({ tipo, eleicao, secao, rastreador }));
}

export function verificarRecibo(r: Recibo, chaveUrna: string): boolean {
  return verificarAssinaturaHash(hashRecibo(r.tipo, r.eleicao, r.secao, r.rastreador), r.assinatura, chaveUrna);
}

/**
 * Selo: assinatura da URNA sobre (eleição, rastreador, seção), feita assim que a
 * cédula é lacrada — antes de o eleitor decidir entre depositar e testar. As
 * figuras e o código de verificação saem do selo. Ed25519 é determinística: para
 * a mesma cédula só existe um selo, e qualquer um o confere com a chave da urna
 * publicada na carga.
 */
export function hashSelo(eleicao: string, rastreador: string, secao: string): string {
  return sha256Hex("T-VOTE/selo/v1|" + jsonCanonico({ eleicao, rastreador, secao }));
}

export function verificarSelo(eleicao: string, rastreador: string, secao: string, selo: string, chaveUrna: string): boolean {
  return verificarAssinaturaHash(hashSelo(eleicao, rastreador, secao), selo, chaveUrna);
}

export function versaoProtocolo(genese: ConteudoGenese | undefined): number {
  return genese?.versao_protocolo ?? 0;
}

/** Ordem canônica das cédulas no BU: lexicográfica do rastreador (sem semente, sem horário). */
export function compararRastreador(x: { rastreador: string }, y: { rastreador: string }): number {
  return x.rastreador < y.rastreador ? -1 : x.rastreador > y.rastreador ? 1 : 0;
}
