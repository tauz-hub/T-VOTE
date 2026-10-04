// Assinatura cega RSA (Chaum, 1982) — base da credencial anônima.
//
//   urna:        m' = H(msg) · r^e  mod n          (cega a mensagem com fator r)
//   autoridade:  s' = (m')^d        mod n          (assina SEM ver msg)
//   urna:        s  = s' · r^{-1}   mod n          (remove o fator)
//   qualquer um: s^e ≡ H(msg)       mod n          (verifica)
//
// A autoridade só vê m', que é uniformemente aleatório: ela sabe QUEM recebeu
// uma credencial, mas não consegue reconhecer a credencial depois.
//
// Protótipo: hash de domínio completo (FDH). Em produção, usar RSABSSA
// (RFC 9474), que padroniza codificação PSS e verificações adicionais.
import { bytesAleatorios, bytesParaBigInt, ehHex, hexParaBigInt, sha256Hex } from "./codificacao";

export type ChaveRSAPublica = { n: string; e: string };
export type ChaveRSAPrivada = ChaveRSAPublica & {
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qinv: string;
};

export function potenciaModular(base: bigint, exp: bigint, mod: bigint): bigint {
  let resultado = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) resultado = (resultado * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return resultado;
}

function mdc(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function inversoModular(a: bigint, m: bigint): bigint {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("sem inverso modular");
  return ((s0 % m) + m) % m;
}

/** Hash de domínio completo: expande SHA-256 até cobrir o módulo inteiro. */
export function hashDominioCompleto(mensagem: string, n: bigint): bigint {
  const blocos = Math.ceil((n.toString(16).length * 4 + 128) / 256);
  let hex = "";
  for (let i = 0; i < blocos; i++) hex += sha256Hex(`T-VOTE/fdh/v1|${i}|${mensagem}`);
  return BigInt("0x" + hex) % n;
}

function lerPublica(pub: ChaveRSAPublica) {
  return { n: hexParaBigInt(pub.n), e: hexParaBigInt(pub.e) };
}

export function cegar(mensagem: string, pub: ChaveRSAPublica): { cega: string; fator: string } {
  const { n, e } = lerPublica(pub);
  const bytes = Math.ceil(n.toString(16).length / 2) + 16;
  for (;;) {
    const r = bytesParaBigInt(bytesAleatorios(bytes)) % n;
    if (r > 1n && mdc(r, n) === 1n) {
      const cega = (hashDominioCompleto(mensagem, n) * potenciaModular(r, e, n)) % n;
      return { cega: cega.toString(16), fator: r.toString(16) };
    }
  }
}

/** Executado pela autoridade (servidor). Usa CRT e confere o resultado. */
export function assinarCega(cegaHex: string, priv: ChaveRSAPrivada): string {
  if (!ehHex(cegaHex)) throw new Error("mensagem cega inválida");
  const n = hexParaBigInt(priv.n);
  const c = hexParaBigInt(cegaHex);
  if (c <= 1n || c >= n) throw new Error("mensagem cega fora do intervalo");
  const p = hexParaBigInt(priv.p);
  const q = hexParaBigInt(priv.q);
  const m1 = potenciaModular(c, hexParaBigInt(priv.dp), p);
  const m2 = potenciaModular(c, hexParaBigInt(priv.dq), q);
  const h = (hexParaBigInt(priv.qinv) * (((m1 - m2) % p) + p)) % p;
  const s = m2 + h * q;
  if (potenciaModular(s, hexParaBigInt(priv.e), n) !== c) throw new Error("falha na assinatura");
  return s.toString(16);
}

export function descegar(assinaturaCegaHex: string, fatorHex: string, pub: ChaveRSAPublica): string {
  const { n } = lerPublica(pub);
  const s = (hexParaBigInt(assinaturaCegaHex) * inversoModular(hexParaBigInt(fatorHex), n)) % n;
  return s.toString(16);
}

export function verificarAssinaturaRSA(mensagem: string, assinaturaHex: string, pub: ChaveRSAPublica): boolean {
  try {
    if (!ehHex(assinaturaHex)) return false;
    const { n, e } = lerPublica(pub);
    const s = hexParaBigInt(assinaturaHex);
    if (s <= 0n || s >= n) return false;
    return potenciaModular(s, e, n) === hashDominioCompleto(mensagem, n);
  } catch {
    return false;
  }
}

/** Mensagem que a autoridade assina às cegas: a chave pública efêmera da credencial. */
export function mensagemCredencial(eleicaoId: string, chaveCredencial: string): string {
  return `T-VOTE/credencial/v1|${eleicaoId}|${chaveCredencial}`;
}
