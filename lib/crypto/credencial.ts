// Credencial anônima = par de chaves Ed25519 efêmero, gerado NA URNA, cuja
// chave pública recebe uma assinatura cega da autoridade de credenciais.
//
//   1. urna gera (sk, pk) e cega a mensagem "credencial|pk"
//   2. autoridade confere a habilitação do mesário e assina às cegas
//   3. urna remove o fator de cegamento → assinatura válida sobre pk
//
// A autoridade sabe que o eleitor 4453 recebeu UMA credencial, mas nunca viu pk.
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "./codificacao";
import { type ChaveRSAPublica, cegar, descegar, mensagemCredencial, verificarAssinaturaRSA } from "./rsa-cega";

export type PedidoCredencial = {
  chave: string;
  privada: string;
  mensagem: string;
  cega: string;
  fator: string;
};

export type Credencial = { chave: string; privada: string; assinatura_autoridade: string };

export function iniciarCredencial(eleicaoId: string, autoridade: ChaveRSAPublica): PedidoCredencial {
  const sk = ed25519.utils.randomSecretKey();
  const chave = bytesToHex(ed25519.getPublicKey(sk));
  const mensagem = mensagemCredencial(eleicaoId, chave);
  const { cega, fator } = cegar(mensagem, autoridade);
  return { chave, privada: bytesToHex(sk), mensagem, cega, fator };
}

export function finalizarCredencial(
  pedido: PedidoCredencial,
  assinaturaCega: string,
  autoridade: ChaveRSAPublica,
): Credencial {
  const assinatura = descegar(assinaturaCega, pedido.fator, autoridade);
  if (!verificarAssinaturaRSA(pedido.mensagem, assinatura, autoridade))
    throw new Error("A autoridade devolveu uma assinatura inválida");
  return { chave: pedido.chave, privada: pedido.privada, assinatura_autoridade: assinatura };
}
