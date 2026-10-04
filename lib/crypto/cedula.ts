// Cédula cifrada: um vetor "um-de-n" (uma cifra por opção), com provas de que
// cada posição é 0 ou 1 e de que a soma é exatamente 1.
//
//   opções:  [Ana, Bruno, Carla, Branco, Nulo]
//   voto:    Bruno  →  [Enc(0), Enc(1), Enc(0), Enc(0), Enc(0)]
//
// A cédula é assinada com a chave efêmera da credencial anônima. Assim, se
// alguém trocar uma cifra no caminho, a assinatura e as provas deixam de valer.
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesAleatorios, bytesToHex, chavesExatas, ehHex, hexToBytes, jsonCanonico, sha256Hex, utf8ToBytes } from "./codificacao";
import { type Cifra, cifrar, cifraDeHex, cifraParaHex, somarCifras, type CifraPontos } from "./elgamal";
import { G, hashParaEscalar, modL, pontoDeHex } from "./grupo";
import {
  type ProvaIgualdade,
  type ProvaZeroOuUm,
  provarIgualdadeLog,
  provarZeroOuUm,
  verificarIgualdadeLog,
  verificarZeroOuUm,
} from "./provas";
import { type ChaveRSAPublica, mensagemCredencial, verificarAssinaturaRSA } from "./rsa-cega";

export type EscolhaCifrada = Cifra & { prova: ProvaZeroOuUm };

export type CredencialPublica = { chave: string; assinatura_autoridade: string };

export type CorpoCedula = {
  eleicao: string;
  credencial: CredencialPublica;
  escolhas: EscolhaCifrada[];
  prova_soma: ProvaIgualdade;
};

export type Cedula = CorpoCedula & { assinatura: string };

/**
 * Como a cédula aparece no bloco. Nenhum campo de horário ou ordem. Além da
 * cédula assinada, o bloco grava o rastreador (hash completo), o nullificador,
 * a seção da urna, o selo do quadro e o que a urna mostrou ao eleitor: o código
 * de verificação de 12 caracteres e as 2 figuras.
 */
export type CedulaPublicada = Cedula & {
  rastreador: string;
  nullificador: string;
  secao: string;
  selo: string;
  codigo: string;
  figuras: string[];
};
export const CHAVES_CEDULA_PUBLICADA = [
  "eleicao",
  "credencial",
  "escolhas",
  "prova_soma",
  "assinatura",
  "rastreador",
  "nullificador",
  "secao",
  "selo",
  "codigo",
  "figuras",
];

/** Pedido de selo: a urna assina com a chave da credencial, provando ter uma credencial válida. */
export function mensagemPedidoSelo(hashEleicao: string, rastreador: string): Uint8Array {
  return utf8ToBytes(`T-VOTE/pedido-selo/v1|${hashEleicao}|${rastreador}`);
}

export function assinarPedidoSelo(hashEleicao: string, rastreador: string, chavePrivadaCredencial: string): string {
  return bytesToHex(ed25519.sign(mensagemPedidoSelo(hashEleicao, rastreador), hexToBytes(chavePrivadaCredencial)));
}

/**
 * Cédula auditada pelo eleitor (desafio de Benaloh): revela o voto e a CHAVE da
 * cédula (a semente de onde sai toda a aleatoriedade) e é descartada. A mesma
 * chave sai impressa no comprovante (parte do teste), para o eleitor refazer a cifração em casa.
 */
export type CedulaDesafiada = {
  eleicao: string;
  cifras: Cifra[];
  revelacao: { opcao: number; semente: string };
  rastreador: string;
  /** preenchidos pelo quadro ao publicar */
  secao?: string;
  selo?: string;
  codigo?: string;
  figuras?: string[];
};
export const CHAVES_CEDULA_DESAFIADA = ["eleicao", "cifras", "revelacao", "rastreador", "secao", "selo", "codigo", "figuras"];

export type ContextoCedula = {
  eleicaoId: string;
  hashEleicao: string;
  chavePublica: string;
  nOpcoes: number;
  autoridade: ChaveRSAPublica;
};

export function contextoOpcao(hashEleicao: string, chaveCredencial: string, i: number): string {
  return `${hashEleicao}|${chaveCredencial}|opcao|${i}`;
}

export function contextoSoma(hashEleicao: string, chaveCredencial: string): string {
  return `${hashEleicao}|${chaveCredencial}|soma`;
}

// ── Chave da cédula ──────────────────────────────────────────────────────────
//
// Cada cédula tem a sua chave: 128 bits do CSPRNG da urna. TODA a aleatoriedade
// da cifração sai dela (r_i = H(chave, eleição, i) mod L). Assim:
//  • a cédula DEPOSITADA tem a chave destruída na hora — ninguém, nem o eleitor,
//    consegue abri-la; ela só entra na soma que os trustees decifram;
//  • a cédula de TESTE tem a chave impressa no papel: em casa, o eleitor refaz a
//    cifração com ela e confere, matematicamente, o que a urna cifrou.
export const BYTES_SEMENTE = 16;

export function aleatoriedadeDaSemente(semente: string, hashEleicao: string, i: number): bigint {
  const r = hashParaEscalar("T-VOTE/aleatoriedade/v1", [semente, hashEleicao, String(i)]);
  if (r === 0n) throw new Error("semente inválida");
  return r;
}

/** Refaz as cifras de uma opção com a chave da cédula — o que o validador faz em casa. */
export function cifrarComSemente(ctx: Pick<ContextoCedula, "chavePublica" | "hashEleicao" | "nOpcoes">, opcao: number, semente: string): Cifra[] {
  const h = pontoDeHex(ctx.chavePublica);
  return Array.from({ length: ctx.nOpcoes }, (_, i) => cifraParaHex(cifrar(h, i === opcao ? 1 : 0, aleatoriedadeDaSemente(semente, ctx.hashEleicao, i))));
}

/** Rastreador: hash das cifras. É o "número de protocolo" que o eleitor procura no quadro. */
export function calcularRastreador(hashEleicao: string, cifras: Cifra[]): string {
  return sha256Hex(
    jsonCanonico({ dominio: "T-VOTE/rastreador/v1", eleicao: hashEleicao, cifras: cifras.map(({ a, b }) => ({ a, b })) }),
  );
}

/** Nullificador: identifica a credencial (impede voto duplo) sem identificar o eleitor. */
export function calcularNullificador(chaveCredencial: string): string {
  return sha256Hex(`T-VOTE/nullificador/v1|${chaveCredencial}`);
}

export function mensagemCedula(corpo: CorpoCedula): Uint8Array {
  return utf8ToBytes("T-VOTE/cedula/v1|" + jsonCanonico(corpo));
}

export type CedulaPreparada = {
  escolhas: EscolhaCifrada[];
  prova_soma: ProvaIgualdade;
  rastreador: string;
  /** Segredos que só a urna conhece: revelados no teste ou destruídos no depósito. */
  segredos: { opcao: number; semente: string };
};

export function prepararCedula(ctx: ContextoCedula, chaveCredencial: string, opcao: number): CedulaPreparada {
  if (!Number.isInteger(opcao) || opcao < 0 || opcao >= ctx.nOpcoes) throw new Error("opção inválida");
  const h = pontoDeHex(ctx.chavePublica);
  const semente = bytesToHex(bytesAleatorios(BYTES_SEMENTE));
  const aleatoriedades: bigint[] = [];
  const cifras: CifraPontos[] = [];
  const escolhas: EscolhaCifrada[] = [];
  for (let i = 0; i < ctx.nOpcoes; i++) {
    const m: 0 | 1 = i === opcao ? 1 : 0;
    const r = aleatoriedadeDaSemente(semente, ctx.hashEleicao, i);
    const c = cifrar(h, m, r);
    aleatoriedades.push(r);
    cifras.push(c);
    escolhas.push({
      ...cifraParaHex(c),
      prova: provarZeroOuUm(h, c.a, c.b, m, r, contextoOpcao(ctx.hashEleicao, chaveCredencial, i)),
    });
  }
  const soma = somarCifras(cifras);
  const R = modL(aleatoriedades.reduce((acc, r) => acc + r, 0n));
  const prova_soma = provarIgualdadeLog(G, soma.a, h, soma.b.subtract(G), R, contextoSoma(ctx.hashEleicao, chaveCredencial));
  return {
    escolhas,
    prova_soma,
    rastreador: calcularRastreador(ctx.hashEleicao, escolhas),
    segredos: { opcao, semente },
  };
}

export function assinarCedula(
  preparada: CedulaPreparada,
  hashEleicao: string,
  credencial: CredencialPublica,
  chavePrivadaCredencial: string,
): Cedula {
  const corpo: CorpoCedula = {
    eleicao: hashEleicao,
    credencial: { chave: credencial.chave, assinatura_autoridade: credencial.assinatura_autoridade },
    escolhas: preparada.escolhas,
    prova_soma: preparada.prova_soma,
  };
  const assinatura = bytesToHex(ed25519.sign(mensagemCedula(corpo), hexToBytes(chavePrivadaCredencial)));
  return { ...corpo, assinatura };
}

export function montarDesafiada(preparada: CedulaPreparada, hashEleicao: string): CedulaDesafiada {
  return {
    eleicao: hashEleicao,
    cifras: preparada.escolhas.map(({ a, b }) => ({ a, b })),
    revelacao: preparada.segredos,
    rastreador: preparada.rastreador,
  };
}

export type VerificacaoCedula = {
  ok: boolean;
  formato: boolean;
  credencial: boolean;
  assinatura: boolean;
  provas: boolean;
  soma: boolean;
  erros: string[];
};

export function verificarCedula(c: Cedula, ctx: ContextoCedula): VerificacaoCedula {
  const r: VerificacaoCedula = {
    ok: false,
    formato: false,
    credencial: false,
    assinatura: false,
    provas: false,
    soma: false,
    erros: [],
  };
  try {
    if (
      c?.eleicao !== ctx.hashEleicao ||
      !chavesExatas(c.credencial, ["chave", "assinatura_autoridade"]) ||
      !ehHex(c.credencial.chave, 32) ||
      !ehHex(c.assinatura, 64) ||
      !Array.isArray(c.escolhas) ||
      c.escolhas.length !== ctx.nOpcoes
    ) {
      r.erros.push("formato inválido ou cédula de outra eleição");
      return r;
    }
    r.formato = true;

    r.credencial = verificarAssinaturaRSA(
      mensagemCredencial(ctx.eleicaoId, c.credencial.chave),
      c.credencial.assinatura_autoridade,
      ctx.autoridade,
    );
    if (!r.credencial) r.erros.push("credencial sem assinatura válida da autoridade");

    const corpo: CorpoCedula = {
      eleicao: c.eleicao,
      credencial: c.credencial,
      escolhas: c.escolhas,
      prova_soma: c.prova_soma,
    };
    try {
      r.assinatura = ed25519.verify(hexToBytes(c.assinatura), mensagemCedula(corpo), hexToBytes(c.credencial.chave));
    } catch {
      r.assinatura = false;
    }
    if (!r.assinatura) r.erros.push("assinatura da cédula inválida (conteúdo alterado?)");

    const h = pontoDeHex(ctx.chavePublica);
    const cifras = c.escolhas.map((e) => cifraDeHex(e));
    r.provas = c.escolhas.every((e, i) =>
      verificarZeroOuUm(h, cifras[i].a, cifras[i].b, e.prova, contextoOpcao(ctx.hashEleicao, c.credencial.chave, i)),
    );
    if (!r.provas) r.erros.push("prova 0-ou-1 inválida em alguma opção");

    const soma = somarCifras(cifras);
    r.soma = verificarIgualdadeLog(
      G,
      soma.a,
      h,
      soma.b.subtract(G),
      c.prova_soma,
      contextoSoma(ctx.hashEleicao, c.credencial.chave),
    );
    if (!r.soma) r.erros.push("prova de que a soma é 1 inválida");
  } catch (e) {
    r.erros.push("erro ao decodificar: " + (e as Error).message);
  }
  r.ok = r.formato && r.credencial && r.assinatura && r.provas && r.soma;
  return r;
}

/**
 * Verificação do desafio de Benaloh: refaz a cifração com a aleatoriedade
 * revelada e confere se a urna cifrou exatamente a opção mostrada ao eleitor.
 */
export function verificarDesafiada(d: CedulaDesafiada, ctx: ContextoCedula): { ok: boolean; opcao: number; erros: string[] } {
  const erros: string[] = [];
  try {
    const { opcao, semente } = d.revelacao;
    if (
      d.eleicao !== ctx.hashEleicao ||
      !Array.isArray(d.cifras) ||
      d.cifras.length !== ctx.nOpcoes ||
      !ehHex(semente, BYTES_SEMENTE) ||
      !Number.isInteger(opcao) ||
      opcao < 0 ||
      opcao >= ctx.nOpcoes
    ) {
      return { ok: false, opcao: -1, erros: ["formato inválido"] };
    }
    const refeitas = cifrarComSemente(ctx, opcao, semente);
    d.cifras.forEach((c, i) => {
      if (refeitas[i].a !== c.a || refeitas[i].b !== c.b) erros.push(`cifra da opção ${i} não corresponde à revelação`);
    });
    if (calcularRastreador(ctx.hashEleicao, d.cifras) !== d.rastreador) erros.push("rastreador não confere");
    return { ok: erros.length === 0, opcao, erros };
  } catch (e) {
    return { ok: false, opcao: -1, erros: ["erro ao decodificar: " + (e as Error).message] };
  }
}
