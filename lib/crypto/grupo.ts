// Grupo criptográfico: ristretto255 (RFC 9496), ordem prima ~2^252.
//
// Lição de Moscou 2019: a eleição usou ElGamal com chaves de 256 bits sobre
// inteiros módulo p e a chave foi quebrada em minutos. Aqui usamos um grupo
// padronizado com ~128 bits de segurança e nenhum parâmetro "caseiro".
//
// Notação: a biblioteca usa notação aditiva (P + Q, k·P). Nos comentários do
// protocolo usamos a notação multiplicativa clássica (g^k), que é equivalente.
import { ristretto255 } from "@noble/curves/ed25519.js";
import { bytesAleatorios, bytesParaBigInt, ehHex, jsonCanonico, sha512Bytes } from "./codificacao";

export const Ponto = ristretto255.Point;
export type Ponto = InstanceType<typeof ristretto255.Point>;

/** Ordem do grupo (L). */
export const ORDEM: bigint = Ponto.Fn.ORDER;
/** Gerador padrão g. */
export const G: Ponto = Ponto.BASE;
/** Elemento neutro (g^0). */
export const IDENTIDADE: Ponto = Ponto.ZERO;

export function modL(x: bigint): bigint {
  const r = x % ORDEM;
  return r >= 0n ? r : r + ORDEM;
}

/** Escalar uniforme em [1, L) gerado por CSPRNG (64 bytes reduzidos módulo L). */
export function escalarAleatorio(): bigint {
  for (;;) {
    const s = modL(bytesParaBigInt(bytesAleatorios(64)));
    if (s !== 0n) return s;
  }
}

/** g^s em tempo constante (uso com segredos). */
export function gElevado(s: bigint): Ponto {
  const k = modL(s);
  return k === 0n ? IDENTIDADE : G.multiply(k);
}

/** P^s em tempo constante (uso com segredos). */
export function elevar(p: Ponto, s: bigint): Ponto {
  const k = modL(s);
  return k === 0n ? IDENTIDADE : p.multiply(k);
}

/** P^s em tempo variável — apenas para dados públicos (verificação). */
export function elevarPublico(p: Ponto, s: bigint): Ponto {
  return p.multiplyUnsafe(modL(s));
}

export function pontoHex(p: Ponto): string {
  return p.toHex();
}

export function pontoDeHex(h: unknown): Ponto {
  if (!ehHex(h, 32)) throw new Error("ponto inválido");
  return Ponto.fromHex(h);
}

export function escalarHex(s: bigint): string {
  return modL(s).toString(16).padStart(64, "0");
}

export function escalarDeHex(h: unknown): bigint {
  if (!ehHex(h, 32)) throw new Error("escalar inválido");
  const s = BigInt("0x" + h);
  if (s >= ORDEM) throw new Error("escalar fora do intervalo");
  return s;
}

/**
 * Fiat-Shamir forte: o desafio é o hash de TODO o enunciado (contexto da
 * eleição, chave pública, cifras e compromissos). A versão "fraca", que omitia
 * parte do enunciado, permitiu forjar provas no Helios (Bernhard, Pereira e
 * Warinschi, ASIACRYPT 2012).
 */
export function hashParaEscalar(dominio: string, partes: unknown[]): bigint {
  return modL(bytesParaBigInt(sha512Bytes(jsonCanonico({ dominio, partes }))));
}
