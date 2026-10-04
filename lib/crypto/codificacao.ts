// Codificação, hashes e aleatoriedade.
//
// Regra de ouro (lição do TPS 2012): TODA aleatoriedade do sistema vem de
// `crypto.getRandomValues` (CSPRNG do sistema operacional). Nunca usar
// Math.random, rand()/srand() ou qualquer semente derivada de horário.
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export { bytesToHex, hexToBytes, utf8ToBytes };

/**
 * JSON canônico: chaves ordenadas e sem espaços. Garante que servidor,
 * navegador e auditor calculem exatamente o mesmo hash para o mesmo objeto.
 */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return "[" + valor.map(jsonCanonico).join(",") + "]";
  const obj = valor as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + jsonCanonico(obj[k]))
      .join(",") +
    "}"
  );
}

export function sha256Hex(dados: string | Uint8Array): string {
  return bytesToHex(sha256(typeof dados === "string" ? utf8ToBytes(dados) : dados));
}

export function sha512Bytes(dados: string | Uint8Array): Uint8Array {
  return sha512(typeof dados === "string" ? utf8ToBytes(dados) : dados);
}

/** Bytes aleatórios criptograficamente seguros (CSPRNG). */
export function bytesAleatorios(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Inteiro uniforme em [0, max) via CSPRNG com amostragem por rejeição. */
export function inteiroAleatorio(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new Error("intervalo inválido");
  const limite = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limite) return buf[0] % max;
  }
}

export function bytesParaBigInt(b: Uint8Array): bigint {
  return b.length === 0 ? 0n : BigInt("0x" + bytesToHex(b));
}

const RE_HEX = /^[0-9a-f]+$/;

/** Valida string hexadecimal minúscula (opcionalmente com tamanho exato em bytes). */
export function ehHex(s: unknown, bytes?: number): s is string {
  if (typeof s !== "string" || s.length === 0 || !RE_HEX.test(s)) return false;
  return bytes === undefined || s.length === bytes * 2;
}

export function hexParaBigInt(h: string): bigint {
  if (!/^[0-9a-f]+$/.test(h)) throw new Error("hex inválido");
  return BigInt("0x" + h);
}

/** Verifica se o objeto possui exatamente estas chaves (nem mais, nem menos). */
export function chavesExatas(obj: unknown, chaves: string[]): boolean {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return false;
  const atuais = Object.keys(obj).sort();
  const esperadas = [...chaves].sort();
  return atuais.length === esperadas.length && atuais.every((k, i) => k === esperadas[i]);
}
