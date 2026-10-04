// Banco A — Registro eleitoral e mesário.
//
// Responde "este eleitor pode votar?" e "ele já compareceu?". Nunca recebe
// nada sobre o voto. Os eventos de habilitação NÃO registram qual eleitor foi
// habilitado nem em que ordem — o mesário vê a fila, mas o sistema não grava
// uma sequência que, cruzada com o quadro, permitiria reconstruir votos.
import { inteiroAleatorio, sha256Hex } from "../crypto/codificacao";
import { notificarTodasUrnas } from "./avisos";
import { db, registrarEvento } from "./db";
import { ErroHttp } from "./http";

export type Eleitor = {
  id: number;
  nome: string;
  documento: string;
  secao: string;
  apto: number;
  situacao: "apto" | "habilitado" | "credenciado";
  cadastrado_em: string;
};

const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VALIDADE_MINUTOS = 15;

export function normalizarDocumento(doc: unknown): string {
  return String(doc ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
}

function normalizarCodigo(codigo: unknown): string {
  return String(codigo ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
}

const hashCodigo = (codigo: string) => sha256Hex(`T-VOTE/habilitacao/v1|${codigo}`);

export function cadastrarEleitor(dados: { nome?: unknown; documento?: unknown; secao?: unknown }): Eleitor {
  const nome = String(dados.nome ?? "").trim().replace(/\s+/g, " ");
  const documento = normalizarDocumento(dados.documento);
  const secao = String(dados.secao ?? "0001").replace(/\D/g, "").padStart(4, "0").slice(-4) || "0001";
  if (nome.length < 3 || nome.length > 80) throw new ErroHttp(400, "Nome deve ter entre 3 e 80 caracteres");
  if (documento.length < 5 || documento.length > 20) throw new ErroHttp(400, "Documento deve ter entre 5 e 20 caracteres");
  try {
    const info = db("registro")
      .prepare("INSERT INTO eleitores (nome, documento, secao, cadastrado_em) VALUES (?, ?, ?, ?)")
      .run(nome, documento, secao, new Date().toISOString());
    registrarEvento("registro", "ELEITOR_CADASTRADO", `eleitor #${info.lastInsertRowid}`);
    return obterEleitor(Number(info.lastInsertRowid))!;
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new ErroHttp(409, "Já existe eleitor com este documento");
    throw e;
  }
}

export function obterEleitor(id: number): Eleitor | undefined {
  return db("registro").prepare("SELECT * FROM eleitores WHERE id = ?").get(id) as Eleitor | undefined;
}

export function listarEleitores(busca?: string): Eleitor[] {
  const termo = (busca ?? "").trim();
  if (!termo) return db("registro").prepare("SELECT * FROM eleitores ORDER BY nome LIMIT 500").all() as Eleitor[];
  return db("registro")
    .prepare("SELECT * FROM eleitores WHERE documento = ? OR nome LIKE ? ORDER BY nome LIMIT 50")
    .all(normalizarDocumento(termo), `%${termo}%`) as Eleitor[];
}

export function alterarAptidao(id: number, apto: boolean) {
  const e = obterEleitor(id);
  if (!e) throw new ErroHttp(404, "Eleitor não encontrado");
  if (e.situacao === "credenciado") throw new ErroHttp(409, "Eleitor já compareceu");
  db("registro").prepare("UPDATE eleitores SET apto = ? WHERE id = ?").run(apto ? 1 : 0, id);
  registrarEvento("registro", "APTIDAO_ALTERADA", `eleitor #${id} → ${apto ? "apto" : "inapto"}`);
}

/**
 * Contingência: em vez de liberar uma urna pareada, o mesário entrega um código
 * de uso único que o eleitor digita na urna (ex.: urna sem pareamento).
 */
export function habilitarEleitor(id: number): { codigo: string; expira_em: string } {
  const e = obterEleitor(id);
  if (!e) throw new ErroHttp(404, "Eleitor não encontrado");
  if (!e.apto) throw new ErroHttp(403, "Eleitor não está apto a votar");
  if (e.situacao === "credenciado") throw new ErroHttp(409, "Eleitor já compareceu e recebeu credencial");

  let bruto = "";
  for (let i = 0; i < 8; i++) bruto += ALFABETO_CODIGO[inteiroAleatorio(ALFABETO_CODIGO.length)];
  const expira_em = new Date(Date.now() + VALIDADE_MINUTOS * 60_000).toISOString();
  const d = db("registro");
  d.transaction(() => {
    d.prepare("UPDATE urnas SET estado = 'livre' WHERE id IN (SELECT urna_id FROM habilitacoes WHERE eleitor_id = ?)").run(id);
    d.prepare("DELETE FROM habilitacoes WHERE eleitor_id = ?").run(id);
    d.prepare("INSERT INTO habilitacoes (codigo_hash, eleitor_id, expira_em) VALUES (?, ?, ?)").run(
      hashCodigo(bruto),
      id,
      expira_em,
    );
    d.prepare("UPDATE eleitores SET situacao = 'habilitado' WHERE id = ?").run(id);
  })();
  notificarTodasUrnas(); // se o eleitor estava liberado numa urna, ela voltou a ficar livre
  // sem identificação do eleitor no log: evita reconstruir a ordem de comparecimento
  registrarEvento("registro", "HABILITACAO_EMITIDA", "código de uso único gerado pelo mesário");
  return { codigo: `${bruto.slice(0, 4)}-${bruto.slice(4)}`, expira_em };
}

/**
 * Chamado pela autoridade de credenciais. Consome o código (uso único) e marca
 * o eleitor como credenciado. Devolve apenas verdadeiro/falso — a autoridade
 * não fica sabendo quem é o eleitor.
 */
export function consumirHabilitacao(codigo: unknown): boolean {
  const h = hashCodigo(normalizarCodigo(codigo));
  const d = db("registro");
  return d.transaction(() => {
    const linha = d.prepare("SELECT eleitor_id, expira_em FROM habilitacoes WHERE codigo_hash = ? AND urna_id IS NULL").get(h) as
      | { eleitor_id: number; expira_em: string }
      | undefined;
    if (!linha || linha.expira_em < new Date().toISOString()) return false;
    d.prepare("DELETE FROM habilitacoes WHERE codigo_hash = ?").run(h);
    d.prepare("UPDATE eleitores SET situacao = 'credenciado' WHERE id = ?").run(linha.eleitor_id);
    return true;
  })();
}

/** No encerramento: códigos não usados deixam de valer. */
export function invalidarHabilitacoesPendentes() {
  const d = db("registro");
  d.transaction(() => {
    d.prepare("DELETE FROM habilitacoes").run();
    d.prepare("UPDATE eleitores SET situacao = 'apto' WHERE situacao = 'habilitado'").run();
    d.prepare("UPDATE urnas SET estado = 'livre'").run();
  })();
  notificarTodasUrnas();
}

export function reiniciarComparecimento() {
  const d = db("registro");
  d.transaction(() => {
    d.prepare("DELETE FROM habilitacoes").run();
    d.prepare("UPDATE eleitores SET situacao = 'apto'").run();
    d.prepare("UPDATE urnas SET estado = 'livre'").run();
  })();
  notificarTodasUrnas();
  registrarEvento("registro", "COMPARECIMENTO_REINICIADO", "nova eleição");
}

export function estatisticasRegistro() {
  const r = db("registro")
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(apto), 0) AS aptos,
              COALESCE(SUM(situacao = 'habilitado'), 0) AS habilitados,
              COALESCE(SUM(situacao = 'credenciado'), 0) AS credenciados
         FROM eleitores`,
    )
    .get() as { total: number; aptos: number; habilitados: number; credenciados: number };
  return r;
}

const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Heitor", "Isabela", "João", "Karina", "Lucas", "Marina", "Nicolas", "Olívia", "Pedro", "Rafaela", "Samuel", "Tatiane", "Vinícius"];
const SOBRENOMES = ["Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Ferreira", "Gomes", "Lima", "Moreira", "Nascimento", "Oliveira", "Pereira", "Ribeiro", "Santos", "Teixeira", "Vieira"];

export function gerarEleitoresFicticios(quantidade: number): number {
  const n = Math.max(1, Math.min(500, Math.floor(quantidade)));
  const d = db("registro");
  const inserir = d.prepare("INSERT OR IGNORE INTO eleitores (nome, documento, secao, cadastrado_em) VALUES (?, ?, ?, ?)");
  let criados = 0;
  d.transaction(() => {
    for (let i = 0; i < n; i++) {
      const nome = `${NOMES[inteiroAleatorio(NOMES.length)]} ${SOBRENOMES[inteiroAleatorio(SOBRENOMES.length)]} ${SOBRENOMES[inteiroAleatorio(SOBRENOMES.length)]}`;
      let doc = "";
      for (let k = 0; k < 12; k++) doc += inteiroAleatorio(10);
      criados += inserir.run(nome, doc, "0001", new Date().toISOString()).changes;
    }
  })();
  registrarEvento("registro", "ELEITORES_FICTICIOS", `${criados} eleitores de teste cadastrados`);
  return criados;
}
