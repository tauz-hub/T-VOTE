// Urnas pareadas com a mesa receptora (parte do Banco A — registro).
//
// Como na urna real, em que o terminal do mesário é ligado por cabo à urna: o
// mesário libera, a urna percebe sozinha, e o eleitor não digita nada além do
// voto. O pareamento é feito UMA vez, pela equipe, quando a urna é instalada.
//
// Privacidade: a urna nunca recebe o nome de quem vai votar — só "estou
// liberada". E continua sendo ela quem gera e cega a credencial, então nem o
// registro nem a autoridade conseguem reconhecer a credencial depois.
import { bytesAleatorios, bytesToHex, sha256Hex } from "../crypto/codificacao";
import { idSecao } from "../crypto/palavras";
import { esperarAviso, notificarTodasUrnas, notificarUrna } from "./avisos";
import { db, registrarEvento } from "./db";
import { ErroHttp } from "./http";
import { obterEleitor } from "./registro";

export type EstadoUrna = "livre" | "liberada" | "votando";
import { type Firmware, MODOS, type ModoFraude, type ParametrosFirmware } from "../laboratorio/firmware-adulterado";
export type { Firmware, ParametrosFirmware };
export type LinhaUrna = {
  id: string;
  nome: string;
  estado: EstadoUrna;
  instalada_em: string;
  zona: string;
  secao: string;
  firmware: Firmware;
  firmware_parametros: string | null;
};
const COLUNAS = "id, nome, estado, instalada_em, zona, secao, firmware, firmware_parametros";

const VALIDADE_MINUTOS = 15;
const ONLINE_MS = 6000;
const ESPERA_MS = 25_000;

// Contato com cada urna fica só em memória: nada de gravar no disco um
// histórico de horários que pudesse ser cruzado com outra coisa.
const memoria = globalThis as unknown as { __tVoteContato?: Map<string, number>; __tVoteConexoes?: Map<string, number> };
const contato = (memoria.__tVoteContato ??= new Map());
const conexoes = (memoria.__tVoteConexoes ??= new Map());

const hashToken = (token: string) => sha256Hex(`T-VOTE/urna/v1|${token}`);

export function instalarUrna(dados: {
  nome?: unknown;
  zona?: unknown;
  secao?: unknown;
  firmware?: unknown;
  modo?: unknown;
  alvo?: unknown;
  percentual?: unknown;
  vitima?: unknown;
}): {
  id: string;
  nome: string;
  token: string;
  zona: string;
  secao: string;
} {
  const [zona, secao] = idSecao(String(dados.zona ?? "1"), String(dados.secao ?? "1")).split("-");
  if (zona === "000" || secao === "0000") throw new ErroHttp(400, "Informe a zona e a seção da urna");
  const firmware: Firmware = dados.firmware === "adulterado" ? "adulterado" : "oficial";
  let parametros: string | null = null;
  if (firmware === "adulterado") {
    // alvo e vítima: 2 dígitos, "branco" ou "nulo"
    const lerOpcao = (v: unknown) => {
      const t = String(v ?? "").trim().toLowerCase();
      return t === "branco" || t === "nulo" ? t : t.replace(/\D/g, "").slice(0, 2);
    };
    const alvo = lerOpcao(dados.alvo);
    const vitima = dados.vitima ? lerOpcao(dados.vitima) : undefined;
    const modo: ModoFraude = MODOS.includes(dados.modo as ModoFraude) ? (dados.modo as ModoFraude) : "desvia";
    const percentual = Math.max(1, Math.min(100, Math.floor(Number(dados.percentual ?? 100)) || 100));
    if (alvo.length < 2) throw new ErroHttp(400, "Informe o número do candidato que a urna adulterada vai favorecer");
    parametros = JSON.stringify({ modo, alvo, percentual, ...(vitima ? { vitima } : {}) } satisfies ParametrosFirmware);
  }
  const quantas = (db("registro").prepare("SELECT COUNT(*) AS n FROM urnas").get() as { n: number }).n;
  const n = String(dados.nome ?? "").trim().slice(0, 40) || `Urna ${quantas + 1} — Zona ${zona} Seção ${secao}`;
  const id = bytesToHex(bytesAleatorios(6));
  const token = bytesToHex(bytesAleatorios(32));
  db("registro")
    .prepare("INSERT INTO urnas (id, nome, token_hash, instalada_em, zona, secao, firmware, firmware_parametros) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, n, hashToken(token), new Date().toISOString(), zona, secao, firmware, parametros);
  registrarEvento("registro", "URNA_INSTALADA", `${n} (${id}) pareada com a mesa receptora`);
  return { id, nome: n, token, zona, secao };
}

export function autenticarUrna(token: string | null): LinhaUrna {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) throw new ErroHttp(401, "Urna não instalada");
  const u = db("registro").prepare(`SELECT ${COLUNAS} FROM urnas WHERE token_hash = ?`).get(hashToken(token)) as
    | LinhaUrna
    | undefined;
  if (!u) throw new ErroHttp(401, "Urna não reconhecida — instale-a novamente");
  contato.set(u.id, Date.now());
  return u;
}

export const lerUrna = (id: string) => db("registro").prepare(`SELECT ${COLUNAS} FROM urnas WHERE id = ?`).get(id) as LinhaUrna | undefined;

/**
 * Long-poll: devolve o estado assim que a marca dele for diferente de
 * `conhecido` (ou após 25 s). A marca inclui a liberação e a fase da seção.
 * Enquanto a requisição está aberta, a urna conta como online.
 */
export async function aguardarEstado(
  urna: LinhaUrna,
  conhecido: string,
  sinal?: AbortSignal,
  marca: (u: LinhaUrna) => string = (u) => u.estado,
): Promise<LinhaUrna> {
  if (marca(urna) !== conhecido) return urna;
  conexoes.set(urna.id, (conexoes.get(urna.id) ?? 0) + 1);
  try {
    await esperarAviso(urna.id, ESPERA_MS, sinal);
  } finally {
    conexoes.set(urna.id, (conexoes.get(urna.id) ?? 1) - 1);
    contato.set(urna.id, Date.now());
  }
  return lerUrna(urna.id) ?? urna;
}

/** Remove uma urna (ex.: urna de teste ou de outro computador). Só se estiver livre. */
export function removerUrna(urnaId: string) {
  const r = db("registro").prepare("DELETE FROM urnas WHERE id = ? AND estado = 'livre'").run(urnaId);
  if (r.changes === 0) throw new ErroHttp(409, "Só é possível remover uma urna livre");
  notificarUrna(urnaId);
  registrarEvento("registro", "URNA_REMOVIDA", `urna ${urnaId} despareada pela mesa`);
}

/** Para o mesário. Mostra o nome do eleitor só enquanto a liberação está pendente. */
export function listarUrnas() {
  const urnas = db("registro").prepare(`SELECT ${COLUNAS} FROM urnas ORDER BY instalada_em`).all() as LinhaUrna[];
  const pendente = db("registro").prepare(
    "SELECT e.nome FROM habilitacoes h JOIN eleitores e ON e.id = h.eleitor_id WHERE h.urna_id = ?",
  );
  // o firmware não aparece para a mesa: uma urna adulterada parece igual a qualquer outra
  return urnas.map(({ id, nome, estado, instalada_em, zona, secao }) => ({
    id,
    nome,
    estado,
    instalada_em,
    zona,
    secao,
    online: (conexoes.get(id) ?? 0) > 0 || Date.now() - (contato.get(id) ?? 0) < ONLINE_MS,
    eleitor: estado === "liberada" ? ((pendente.get(id) as { nome: string } | undefined)?.nome ?? null) : null,
  }));
}

/** Mesário libera a urna para um eleitor já identificado. */
export function liberarUrna(urnaId: string, eleitorId: number) {
  const d = db("registro");
  const e = obterEleitor(eleitorId);
  if (!e) throw new ErroHttp(404, "Eleitor não encontrado");
  if (!e.apto) throw new ErroHttp(403, "Eleitor não está apto a votar");
  if (e.situacao === "credenciado") throw new ErroHttp(409, "Eleitor já compareceu e recebeu credencial");
  d.transaction(() => {
    const u = d.prepare("SELECT estado FROM urnas WHERE id = ?").get(urnaId) as { estado: EstadoUrna } | undefined;
    if (!u) throw new ErroHttp(404, "Urna não encontrada");
    if (u.estado !== "livre") throw new ErroHttp(409, "A urna está ocupada — aguarde o eleitor atual terminar");
    // descarta qualquer habilitação anterior do eleitor (ex.: código de contingência não usado)
    d.prepare("UPDATE urnas SET estado = 'livre' WHERE id IN (SELECT urna_id FROM habilitacoes WHERE eleitor_id = ?)").run(eleitorId);
    d.prepare("DELETE FROM habilitacoes WHERE eleitor_id = ?").run(eleitorId);
    d.prepare("INSERT INTO habilitacoes (codigo_hash, eleitor_id, urna_id, expira_em) VALUES (?, ?, ?, ?)").run(
      sha256Hex(bytesToHex(bytesAleatorios(32))), // sem código visível: a autorização vai direto para a urna
      eleitorId,
      urnaId,
      new Date(Date.now() + VALIDADE_MINUTOS * 60_000).toISOString(),
    );
    d.prepare("UPDATE eleitores SET situacao = 'habilitado' WHERE id = ?").run(eleitorId);
    d.prepare("UPDATE urnas SET estado = 'liberada' WHERE id = ?").run(urnaId);
  })();
  notificarTodasUrnas(); // esta urna e, se for o caso, a que tinha uma liberação anterior do eleitor
  registrarEvento("registro", "URNA_LIBERADA", "mesário liberou a urna (eleitor não identificado no log)");
}

/**
 * Cancelar antes da credencial devolve o eleitor a "apto". Depois da credencial
 * (eleitor desistiu no meio), a urna é reiniciada e descarta a credencial; o
 * eleitor continua constando como compareceu — como assinar o caderno e não votar.
 */
export function cancelarLiberacao(urnaId: string) {
  const d = db("registro");
  d.transaction(() => {
    const u = d.prepare("SELECT estado FROM urnas WHERE id = ?").get(urnaId) as { estado: EstadoUrna } | undefined;
    if (!u) throw new ErroHttp(404, "Urna não encontrada");
    const h = d.prepare("SELECT eleitor_id FROM habilitacoes WHERE urna_id = ?").get(urnaId) as { eleitor_id: number } | undefined;
    if (h) {
      d.prepare("DELETE FROM habilitacoes WHERE urna_id = ?").run(urnaId);
      d.prepare("UPDATE eleitores SET situacao = 'apto' WHERE id = ?").run(h.eleitor_id);
    }
    d.prepare("UPDATE urnas SET estado = 'livre' WHERE id = ?").run(urnaId);
  })();
  notificarUrna(urnaId);
  registrarEvento("registro", "URNA_REINICIADA", "liberação cancelada ou votação interrompida pelo mesário");
}

/** Chamado pela autoridade de credenciais quando a própria urna pede a credencial. */
export function consumirHabilitacaoDaUrna(urnaId: string): boolean {
  const d = db("registro");
  const ok = d.transaction(() => {
    const h = d.prepare("SELECT eleitor_id, expira_em FROM habilitacoes WHERE urna_id = ?").get(urnaId) as
      | { eleitor_id: number; expira_em: string }
      | undefined;
    if (!h || h.expira_em < new Date().toISOString()) return false;
    d.prepare("DELETE FROM habilitacoes WHERE urna_id = ?").run(urnaId);
    d.prepare("UPDATE eleitores SET situacao = 'credenciado' WHERE id = ?").run(h.eleitor_id);
    d.prepare("UPDATE urnas SET estado = 'votando' WHERE id = ?").run(urnaId);
    return true;
  })();
  if (ok) notificarUrna(urnaId);
  return ok;
}

/** A urna avisa que o eleitor terminou; a mesa pode chamar o próximo. */
export function concluirVotacaoNaUrna(urnaId: string) {
  db("registro").prepare("UPDATE urnas SET estado = 'livre' WHERE id = ? AND estado = 'votando'").run(urnaId);
  notificarUrna(urnaId);
}
