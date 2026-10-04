// Geração de chaves no servidor (Node). Nenhuma chave fica embutida no código:
// tudo é gerado por eleição, com o CSPRNG do sistema operacional.
// (TPS 2017: a chave que protegia as mídias estava no código-fonte e era a
// mesma em todas as urnas do país.)
import { generateKeyPairSync } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "../crypto/codificacao";
import type { ChaveRSAPrivada } from "../crypto/rsa-cega";

const b64urlParaHex = (s: string) => Buffer.from(s, "base64url").toString("hex").replace(/^0+(?=.)/, "");

export function gerarChaveRSA(bits = 2048): ChaveRSAPrivada {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: bits, publicExponent: 65537 });
  const jwk = privateKey.export({ format: "jwk" });
  return {
    n: b64urlParaHex(jwk.n!),
    e: b64urlParaHex(jwk.e!),
    d: b64urlParaHex(jwk.d!),
    p: b64urlParaHex(jwk.p!),
    q: b64urlParaHex(jwk.q!),
    dp: b64urlParaHex(jwk.dp!),
    dq: b64urlParaHex(jwk.dq!),
    qinv: b64urlParaHex(jwk.qi!),
  };
}

export function gerarChaveEd25519(): { privada: string; publica: string } {
  const sk = ed25519.utils.randomSecretKey();
  return { privada: bytesToHex(sk), publica: bytesToHex(ed25519.getPublicKey(sk)) };
}
