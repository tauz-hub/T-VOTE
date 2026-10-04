// Documentos da seção eleitoral, produzidos pela urna OFFLINE e assinados com a
// chave dela (gerada dentro da urna na carga):
//
//   ZERÉSIMA  impressa na abertura: "nenhum voto", chave da urna, chave da mesa
//   BU        impresso no encerramento e colado na porta da seção: contagem em
//             claro (como o BU de hoje) + TODAS as cédulas cifradas, ordenadas
//             pelo rastreador, + a soma homomórfica delas
//   MÍDIA     zerésima + BU, levados ao TSE depois do encerramento
//
// O BU impresso traz o "código do BU" (início do hash). Qualquer pessoa compara o
// papel da porta da escola com o BU publicado no quadro: se o TSE trocar a seção
// na totalização, o código e os números deixam de bater.
import { jsonCanonico, sha256Hex } from "./codificacao";
import type { CedulaDesafiada, CedulaPublicada } from "./cedula";
import { type Cifra, type CifraPontos, cifraDeHex, somarCifras } from "./elgamal";
import { IDENTIDADE } from "./grupo";
import { assinarHash, verificarAssinaturaHash, type Contagem } from "./quadro";
import type { ChaveRSAPublica } from "./rsa-cega";

export type ZeresimaSecao = {
  tipo: "ZERESIMA";
  eleicao: string;
  secao: string;
  urna: string;
  chave_urna: string;
  autoridade_secao: ChaveRSAPublica;
  software: string;
  cedulas: number;
  aberta_em: string;
};

export type BoletimUrna = {
  tipo: "BU";
  eleicao: string;
  secao: string;
  /** hash da zerésima desta seção: a cadeia da seção tem dois elos */
  zeresima: string;
  /** credenciais emitidas pela mesa desta seção (eleitores que compareceram) */
  comparecimento: number;
  cedulas: CedulaPublicada[];
  desafiadas: CedulaDesafiada[];
  /** contagem em claro feita pela urna — é o que sai impresso e vai para a porta da escola */
  contagem: Contagem;
  /** soma homomórfica das cédulas: é isto que os trustees decifram */
  agregado: Cifra[];
  encerrada_em: string;
};

export type DocumentoUrna<T> = { conteudo: T; hash: string; assinatura: string };

export type MidiaSecao = { formato: "tai-vote/midia-secao/v1"; zeresima: DocumentoUrna<ZeresimaSecao>; bu: DocumentoUrna<BoletimUrna> };

export const CHAVES_ZERESIMA = ["tipo", "eleicao", "secao", "urna", "chave_urna", "autoridade_secao", "software", "cedulas", "aberta_em"];
export const CHAVES_BU = ["tipo", "eleicao", "secao", "zeresima", "comparecimento", "cedulas", "desafiadas", "contagem", "agregado", "encerrada_em"];

export function hashDocumentoUrna(conteudo: ZeresimaSecao | BoletimUrna): string {
  return sha256Hex("TAI-VOTE/documento-urna/v1|" + jsonCanonico(conteudo));
}

export function assinarDocumentoUrna<T extends ZeresimaSecao | BoletimUrna>(conteudo: T, chavePrivadaUrna: string): DocumentoUrna<T> {
  const hash = hashDocumentoUrna(conteudo);
  return { conteudo, hash, assinatura: assinarHash(hash, chavePrivadaUrna) };
}

/** Hash recalculado e assinatura da urna conferida. */
export function verificarDocumentoUrna(doc: DocumentoUrna<ZeresimaSecao | BoletimUrna>, chaveUrna: string): boolean {
  try {
    return doc.hash === hashDocumentoUrna(doc.conteudo) && verificarAssinaturaHash(doc.hash, doc.assinatura, chaveUrna);
  } catch {
    return false;
  }
}

/** "a1b2 c3d4 e5f6 7890": os 16 primeiros caracteres do hash do BU, como saem no papel. */
export function codigoBU(hashBU: string): string {
  return (hashBU.slice(0, 16).match(/.{4}/g) ?? []).join(" ");
}

/** Lê o código do BU digitado (com ou sem espaços). */
export function lerCodigoBU(texto: string): string | null {
  const c = texto.toLowerCase().replace(/[^0-9a-f]/g, "");
  return c.length >= 8 && c.length <= 64 ? c : null;
}

/** Soma homomórfica (uma cifra por opção). */
export function agregarCedulas(cedulas: CedulaPublicada[], nOpcoes: number): CifraPontos[] {
  const agregado: CifraPontos[] = Array.from({ length: nOpcoes }, () => ({ a: IDENTIDADE, b: IDENTIDADE }));
  for (const c of cedulas) {
    c.escolhas.forEach((e, i) => {
      if (i < nOpcoes) agregado[i] = somarCifras([agregado[i], cifraDeHex(e)]);
    });
  }
  return agregado;
}

// ------------------------------------------------- declaração do teste
//
// Quando o eleitor testa a urna, ela abre a cédula e DECLARA o que havia dentro
// (na tela e no comprovante de teste), assinando a declaração com a chave dela.
// A abertura de verdade vai para o BU. Se uma urna adulterada mentir na tela, a
// mentira fica assinada: em casa, o validador mostra a abertura publicada e a
// declaração assinada lado a lado — prova de fraude que qualquer juiz confere,
// sem revelar nenhum voto (a cédula de teste não é contada).

export type DeclaracaoTeste = {
  tipo: "DECLARACAO_TESTE";
  eleicao: string;
  secao: string;
  rastreador: string;
  /** opção que a urna AFIRMA ter encontrado na cédula testada */
  opcao: number;
  /** chave da cédula de teste, impressa no papel: com ela o eleitor refaz a cifração em casa */
  semente: string;
  assinatura: string;
};

export function hashDeclaracaoTeste(eleicao: string, secao: string, rastreador: string, opcao: number, semente: string): string {
  return sha256Hex("TAI-VOTE/declaracao-teste/v2|" + jsonCanonico({ eleicao, secao, rastreador, opcao, semente }));
}

export function verificarDeclaracaoTeste(d: DeclaracaoTeste, chaveUrna: string): boolean {
  return verificarAssinaturaHash(hashDeclaracaoTeste(d.eleicao, d.secao, d.rastreador, d.opcao, d.semente), d.assinatura, chaveUrna);
}

/** Contagem em claro somada por opção (todas as opções presentes, em ordem). */
export function somarContagens(contagens: Contagem[], nOpcoes: number): Contagem {
  return Array.from({ length: nOpcoes }, (_, opcao) => ({
    opcao,
    votos: contagens.reduce((s, c) => s + (c.find((x) => x.opcao === opcao)?.votos ?? 0), 0),
  }));
}
