// ElGamal exponencial sobre ristretto255 — permite somar votos cifrados.
//
//   chave pública conjunta  h = h_A · h_B · h_C      (h_i = g^{x_i})
//   cifrar(m; r)            (a, b) = (g^r, g^m · h^r)
//   somar                   (a1·a2, b1·b2) = Enc(m1 + m2)
//
// Nenhum trustee sozinho conhece x = x_A + x_B + x_C; decifrar exige os três.
import { G, IDENTIDADE, Ponto, elevar, gElevado, pontoDeHex, pontoHex } from "./grupo";

export type Cifra = { a: string; b: string };
export type CifraPontos = { a: Ponto; b: Ponto };

export function cifrar(chave: Ponto, m: 0 | 1, r: bigint): CifraPontos {
  return { a: gElevado(r), b: gElevado(BigInt(m)).add(elevar(chave, r)) };
}

export function somarCifras(cifras: CifraPontos[]): CifraPontos {
  return cifras.reduce(
    (acc, c) => ({ a: acc.a.add(c.a), b: acc.b.add(c.b) }),
    { a: IDENTIDADE, b: IDENTIDADE },
  );
}

export function cifraParaHex(c: CifraPontos): Cifra {
  return { a: pontoHex(c.a), b: pontoHex(c.b) };
}

export function cifraDeHex(c: Cifra): CifraPontos {
  return { a: pontoDeHex(c.a), b: pontoDeHex(c.b) };
}

/** Chave conjunta: produto das chaves públicas dos trustees. */
export function combinarChaves(chaves: Ponto[]): Ponto {
  return chaves.reduce((acc, h) => acc.add(h), IDENTIDADE);
}

/**
 * Recupera m a partir de g^m por busca exaustiva (m ≤ total de cédulas).
 * Viável porque o número de votos é pequeno — é o "preço" do ElGamal exponencial.
 */
export function logDiscretoPequeno(M: Ponto, maximo: number): number | null {
  let atual = IDENTIDADE;
  for (let m = 0; m <= maximo; m++) {
    if (atual.equals(M)) return m;
    atual = atual.add(G);
  }
  return null;
}
