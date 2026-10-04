// Provas de conhecimento zero (não interativas, via Fiat-Shamir forte).
//
// 1. Schnorr ............ "conheço x tal que X = g^x" (trustee prova que tem a chave)
// 2. Chaum-Pedersen ..... "log_g1(X1) = log_g2(X2)" (soma da cédula = 1; decifração correta)
// 3. Disjuntiva 0-ou-1 .. "esta cifra contém 0 OU 1", sem revelar qual (CDS)
import {
  G,
  Ponto,
  elevar,
  elevarPublico,
  escalarAleatorio,
  escalarDeHex,
  escalarHex,
  gElevado,
  hashParaEscalar,
  modL,
  pontoDeHex,
  pontoHex,
} from "./grupo";

const DOM_SCHNORR = "T-VOTE/prova/schnorr/v1";
const DOM_CP = "T-VOTE/prova/chaum-pedersen/v1";
const DOM_01 = "T-VOTE/prova/zero-ou-um/v1";

// ---------------------------------------------------------------- Schnorr

export type ProvaSchnorr = { t: string; z: string };

export function provarConhecimento(x: bigint, X: Ponto, contexto: string): ProvaSchnorr {
  const w = escalarAleatorio();
  const T = gElevado(w);
  const c = hashParaEscalar(DOM_SCHNORR, [contexto, pontoHex(X), pontoHex(T)]);
  return { t: pontoHex(T), z: escalarHex(w + c * x) };
}

export function verificarConhecimento(X: Ponto, prova: ProvaSchnorr, contexto: string): boolean {
  try {
    const T = pontoDeHex(prova.t);
    const z = escalarDeHex(prova.z);
    const c = hashParaEscalar(DOM_SCHNORR, [contexto, pontoHex(X), prova.t]);
    return gElevado(z).equals(T.add(elevarPublico(X, c)));
  } catch {
    return false;
  }
}

// --------------------------------------------------------- Chaum-Pedersen

export type ProvaIgualdade = { t1: string; t2: string; z: string };

export function provarIgualdadeLog(
  g1: Ponto,
  X1: Ponto,
  g2: Ponto,
  X2: Ponto,
  segredo: bigint,
  contexto: string,
): ProvaIgualdade {
  const w = escalarAleatorio();
  const T1 = elevar(g1, w);
  const T2 = elevar(g2, w);
  const c = hashParaEscalar(DOM_CP, [
    contexto,
    pontoHex(g1),
    pontoHex(X1),
    pontoHex(g2),
    pontoHex(X2),
    pontoHex(T1),
    pontoHex(T2),
  ]);
  return { t1: pontoHex(T1), t2: pontoHex(T2), z: escalarHex(w + c * segredo) };
}

export function verificarIgualdadeLog(
  g1: Ponto,
  X1: Ponto,
  g2: Ponto,
  X2: Ponto,
  prova: ProvaIgualdade,
  contexto: string,
): boolean {
  try {
    const T1 = pontoDeHex(prova.t1);
    const T2 = pontoDeHex(prova.t2);
    const z = escalarDeHex(prova.z);
    const c = hashParaEscalar(DOM_CP, [
      contexto,
      pontoHex(g1),
      pontoHex(X1),
      pontoHex(g2),
      pontoHex(X2),
      prova.t1,
      prova.t2,
    ]);
    return (
      elevarPublico(g1, z).equals(T1.add(elevarPublico(X1, c))) &&
      elevarPublico(g2, z).equals(T2.add(elevarPublico(X2, c)))
    );
  } catch {
    return false;
  }
}

// ------------------------------------------------- Disjuntiva 0-ou-1 (CDS)

export type ProvaZeroOuUm = {
  a0: string;
  b0: string;
  a1: string;
  b1: string;
  c0: string;
  c1: string;
  z0: string;
  z1: string;
};

/** b / g^k — se a cifra contém k, isto vira h^r. */
function semMensagem(b: Ponto, k: 0 | 1): Ponto {
  return k === 0 ? b : b.subtract(G);
}

/**
 * Prova que (a, b) = (g^r, g^m h^r) com m ∈ {0,1}. O ramo verdadeiro é provado
 * de fato; o ramo falso é simulado. Como c0 + c1 tem de bater com o hash, o
 * provador só consegue simular UM ramo — logo, ao menos um é verdadeiro.
 */
export function provarZeroOuUm(
  h: Ponto,
  a: Ponto,
  b: Ponto,
  m: 0 | 1,
  r: bigint,
  contexto: string,
): ProvaZeroOuUm {
  const falso: 0 | 1 = m === 0 ? 1 : 0;
  const cFalso = escalarAleatorio();
  const zFalso = escalarAleatorio();
  const aFalso = gElevado(zFalso).subtract(elevar(a, cFalso));
  const bFalso = elevar(h, zFalso).subtract(elevar(semMensagem(b, falso), cFalso));

  const w = escalarAleatorio();
  const aReal = gElevado(w);
  const bReal = elevar(h, w);

  const [A0, B0, A1, B1] = m === 0 ? [aReal, bReal, aFalso, bFalso] : [aFalso, bFalso, aReal, bReal];
  const c = hashParaEscalar(DOM_01, [
    contexto,
    pontoHex(h),
    pontoHex(a),
    pontoHex(b),
    pontoHex(A0),
    pontoHex(B0),
    pontoHex(A1),
    pontoHex(B1),
  ]);
  const cReal = modL(c - cFalso);
  const zReal = modL(w + cReal * r);
  const [c0, c1, z0, z1] = m === 0 ? [cReal, cFalso, zReal, zFalso] : [cFalso, cReal, zFalso, zReal];
  return {
    a0: pontoHex(A0),
    b0: pontoHex(B0),
    a1: pontoHex(A1),
    b1: pontoHex(B1),
    c0: escalarHex(c0),
    c1: escalarHex(c1),
    z0: escalarHex(z0),
    z1: escalarHex(z1),
  };
}

export function verificarZeroOuUm(h: Ponto, a: Ponto, b: Ponto, p: ProvaZeroOuUm, contexto: string): boolean {
  try {
    const A = [pontoDeHex(p.a0), pontoDeHex(p.a1)];
    const B = [pontoDeHex(p.b0), pontoDeHex(p.b1)];
    const cs = [escalarDeHex(p.c0), escalarDeHex(p.c1)];
    const zs = [escalarDeHex(p.z0), escalarDeHex(p.z1)];
    const c = hashParaEscalar(DOM_01, [contexto, pontoHex(h), pontoHex(a), pontoHex(b), p.a0, p.b0, p.a1, p.b1]);
    if (modL(cs[0] + cs[1]) !== c) return false;
    for (const k of [0, 1] as const) {
      if (!gElevado(zs[k]).equals(A[k].add(elevarPublico(a, cs[k])))) return false;
      if (!elevarPublico(h, zs[k]).equals(B[k].add(elevarPublico(semMensagem(b, k), cs[k])))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
