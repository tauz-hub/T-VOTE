// Banco B — terminal da mesa: autoridade de credenciais DA SEÇÃO.
//
// Cada mesa tem a sua chave RSA, gerada na carga da urna (a pública vai para o
// quadro antes do primeiro voto). Funciona offline: recebe (liberação do
// mesário, mensagem cega) e devolve uma assinatura cega. Guarda apenas um
// CONTADOR de credenciais emitidas: nem quem recebeu (isso é do caderno), nem a
// mensagem cega, nem horário.
//
// Com uma chave por seção, a urna sozinha não consegue fabricar votos: cada
// cédula precisa de uma credencial assinada pela mesa, e o contador da mesa vai
// impresso no BU como comparecimento.
import type { ChaveRSAPrivada, ChaveRSAPublica } from "../crypto/rsa-cega";
import { assinarCega } from "../crypto/rsa-cega";
import { ehHex, hexParaBigInt } from "../crypto/codificacao";
import { gerarChaveRSA } from "./chaves";
import { db, registrarEvento } from "./db";
import { ErroHttp } from "./http";
import { consumirHabilitacao } from "./registro";
import { consumirHabilitacaoDaUrna } from "./urnas";

/** Gera a chave da mesa desta seção (na carga). Substitui a de uma carga anterior. */
export function criarAutoridadeDaSecao(urnaId: string, eleicaoId: string, secao: string): ChaveRSAPublica {
  const k = gerarChaveRSA();
  db("autoridade")
    .prepare(
      `INSERT OR REPLACE INTO chaves (urna_id, eleicao_id, secao, n, e, d, p, q, dp, dq, qinv, credenciais_emitidas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(urnaId, eleicaoId, secao, k.n, k.e, k.d, k.p, k.q, k.dp, k.dq, k.qinv);
  registrarEvento("autoridade", "CHAVE_GERADA", `RSA-2048 da mesa da seção ${secao}, gerada por CSPRNG`);
  return { n: k.n, e: k.e };
}

export function chavePrivadaDaSecao(urnaId: string): ChaveRSAPrivada | null {
  return (db("autoridade").prepare("SELECT n, e, d, p, q, dp, dq, qinv FROM chaves WHERE urna_id = ?").get(urnaId) as ChaveRSAPrivada) ?? null;
}

/** Laboratório: chave da mesa de uma seção (simula um insider que a extraiu do terminal). */
export function chavePrivadaDaMesaPorSecao(secao: string): ChaveRSAPrivada | null {
  return (db("autoridade").prepare("SELECT n, e, d, p, q, dp, dq, qinv FROM chaves WHERE secao = ?").get(secao) as ChaveRSAPrivada) ?? null;
}

export function credenciaisEmitidas(urnaId?: string): number {
  const r = urnaId
    ? (db("autoridade").prepare("SELECT credenciais_emitidas AS n FROM chaves WHERE urna_id = ?").get(urnaId) as { n: number } | undefined)
    : (db("autoridade").prepare("SELECT COALESCE(SUM(credenciais_emitidas), 0) AS n FROM chaves").get() as { n: number });
  return r?.n ?? 0;
}

/**
 * A autorização vem da liberação do mesário para esta urna (caminho normal) ou
 * de um código de contingência digitado pelo eleitor nesta urna. Nos dois casos
 * o caderno só responde sim/não — a mesa não fica sabendo qual credencial assinou.
 */
export type Autorizacao = { urnaId: string; codigo?: unknown };

export function emitirCredencial(autorizacao: Autorizacao, mensagemCega: unknown): string {
  const chave = chavePrivadaDaSecao(autorizacao.urnaId);
  if (!chave) throw new ErroHttp(409, "A urna ainda não recebeu a carga desta eleição");
  if (!ehHex(mensagemCega) || mensagemCega.length > 1024) throw new ErroHttp(400, "Mensagem cega inválida");
  const m = hexParaBigInt(mensagemCega);
  if (m <= 1n || m >= hexParaBigInt(chave.n)) throw new ErroHttp(400, "Mensagem cega fora do intervalo");

  const porCodigo = autorizacao.codigo !== undefined && autorizacao.codigo !== null && autorizacao.codigo !== "";
  const autorizado = porCodigo ? consumirHabilitacao(autorizacao.codigo) : consumirHabilitacaoDaUrna(autorizacao.urnaId);
  if (!autorizado) {
    registrarEvento("autoridade", "PEDIDO_RECUSADO", "sem habilitação válida do mesário");
    throw new ErroHttp(
      403,
      porCodigo ? "Código de habilitação inválido, expirado ou já utilizado" : "A urna não está liberada pelo mesário (ou a liberação expirou)",
    );
  }
  const assinatura = assinarCega(mensagemCega, chave);
  db("autoridade").prepare("UPDATE chaves SET credenciais_emitidas = credenciais_emitidas + 1 WHERE urna_id = ?").run(autorizacao.urnaId);
  registrarEvento("autoridade", "CREDENCIAL_EMITIDA", "assinatura cega emitida (a mesa não vê a credencial)");
  return assinatura;
}
