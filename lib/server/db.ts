// Quatro bancos SQLite FISICAMENTE separados — a separação de funções do
// protocolo também é separação de dados:
//
//   SEÇÃO (offline, no local de votação)
//   registro.db    Banco A  caderno: quem é eleitor e quem compareceu; pareamento mesa ↔ urna
//   autoridade.db  Banco B  terminal da mesa: chave das credenciais de cada seção + contador
//   urnas.db       Banco D  memória interna de cada urna: chave da urna, cédulas, contagem, zerésima, BU
//   TSE (central)
//   boletim.db     Banco C  quadro público nacional: só recebe a carga antes e a mídia depois
//
// Durante a votação nada é escrito no boletim.db: a urna não fala com o TSE.
// Não existe nenhuma chave estrangeira ligando eleitores a cédulas.
//
// Lição do TPS 2012: nada pode registrar a ORDEM de chegada das cédulas. Por
// isso a memória da urna é uma tabela WITHOUT ROWID indexada pelo rastreador
// (sem id sequencial), não há horário por cédula, o journal é DELETE (o WAL
// guardaria quadros em ordem de escrita) e secure_delete sobrescreve com zeros
// as páginas apagadas.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type NomeBanco = "registro" | "autoridade" | "urnas" | "boletim";

// TAI_VOTE_DADOS permite rodar testes (ou outra seção) com dados separados
export const DIRETORIO_DADOS = process.env.TAI_VOTE_DADOS ?? path.join(process.cwd(), "data");

export const DESCRICAO_BANCOS: Record<NomeBanco, string> = {
  registro: "Banco A — Caderno da seção: identidade e comparecimento. Nunca vê votos.",
  autoridade: "Banco B — Terminal da mesa: chave das credenciais de cada seção e contador. Não guarda quem recebeu o quê.",
  urnas: "Banco D — Memória interna das urnas (offline): chave da urna, cédulas cifradas sem ordem, contagem, zerésima e BU.",
  boletim: "Banco C — Quadro público nacional (TSE): cargas antes da votação e mídias das seções depois. Sem identidade de eleitores.",
};

const ESQUEMAS: Record<NomeBanco, string> = {
  registro: `
    CREATE TABLE IF NOT EXISTS eleitores (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nome          TEXT NOT NULL,
      documento     TEXT NOT NULL UNIQUE,
      secao         TEXT NOT NULL DEFAULT '0001',
      apto          INTEGER NOT NULL DEFAULT 1,
      situacao      TEXT NOT NULL DEFAULT 'apto' CHECK (situacao IN ('apto', 'habilitado', 'credenciado')),
      cadastrado_em TEXT NOT NULL
    );
    -- urnas pareadas com a mesa: o token identifica a urna (não o eleitor) e só o hash fica guardado
    CREATE TABLE IF NOT EXISTS urnas (
      id           TEXT PRIMARY KEY,
      nome         TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      estado       TEXT NOT NULL DEFAULT 'livre' CHECK (estado IN ('livre', 'liberada', 'votando')),
      instalada_em TEXT NOT NULL,
      zona         TEXT NOT NULL DEFAULT '001',
      secao        TEXT NOT NULL DEFAULT '0001',
      -- laboratório: 'adulterado' simula uma urna com software trocado na carga
      firmware     TEXT NOT NULL DEFAULT 'oficial' CHECK (firmware IN ('oficial', 'adulterado')),
      firmware_parametros TEXT
    ) WITHOUT ROWID;
    -- habilitação pendente: ou ligada a uma urna pareada (urna_id), ou a um código de contingência
    CREATE TABLE IF NOT EXISTS habilitacoes (
      codigo_hash TEXT PRIMARY KEY,
      eleitor_id  INTEGER NOT NULL UNIQUE REFERENCES eleitores(id) ON DELETE CASCADE,
      urna_id     TEXT UNIQUE REFERENCES urnas(id) ON DELETE CASCADE,
      expira_em   TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT NOT NULL, tipo TEXT NOT NULL, detalhe TEXT NOT NULL
    );`,
  autoridade: `
    -- uma chave por mesa (seção), gerada na carga; a pública vai para o quadro
    CREATE TABLE IF NOT EXISTS chaves (
      urna_id    TEXT PRIMARY KEY,
      eleicao_id TEXT NOT NULL,
      secao      TEXT NOT NULL,
      n TEXT NOT NULL, e TEXT NOT NULL, d TEXT NOT NULL, p TEXT NOT NULL, q TEXT NOT NULL,
      dp TEXT NOT NULL, dq TEXT NOT NULL, qinv TEXT NOT NULL,
      credenciais_emitidas INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT NOT NULL, tipo TEXT NOT NULL, detalhe TEXT NOT NULL
    );`,
  boletim: `
    CREATE TABLE IF NOT EXISTS estado (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      eleicao_id TEXT NOT NULL,
      fase TEXT NOT NULL CHECK (fase IN ('configuracao', 'aberta', 'encerrada', 'apurada')),
      hash_eleicao TEXT,
      chave_publica TEXT
    );
    CREATE TABLE IF NOT EXISTS blocos (
      numero        INTEGER PRIMARY KEY,
      tipo          TEXT NOT NULL,
      conteudo      TEXT NOT NULL,
      hash_anterior TEXT NOT NULL,
      hash          TEXT NOT NULL UNIQUE,
      assinatura    TEXT NOT NULL,
      publicado_em  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT NOT NULL, tipo TEXT NOT NULL, detalhe TEXT NOT NULL
    );`,
  urnas: `
    -- carga e estado de cada urna. A chave privada da urna nasce aqui dentro e nunca sai.
    CREATE TABLE IF NOT EXISTS carga (
      urna_id       TEXT PRIMARY KEY,
      eleicao_id    TEXT NOT NULL,
      secao         TEXT NOT NULL,
      fase          TEXT NOT NULL CHECK (fase IN ('carregada', 'aberta', 'encerrada', 'transmitida')),
      chave_privada TEXT NOT NULL,
      chave_publica TEXT NOT NULL,
      dados         TEXT NOT NULL,
      zeresima      TEXT,
      bu            TEXT,
      bloco         INTEGER
    ) WITHOUT ROWID;
    -- cédulas guardadas pela urna: chave (urna, rastreador), sem id sequencial e sem horário
    CREATE TABLE IF NOT EXISTS cedulas (
      urna_id    TEXT NOT NULL,
      rastreador TEXT NOT NULL,
      tipo       TEXT NOT NULL CHECK (tipo IN ('cedula', 'desafiada')),
      conteudo   TEXT NOT NULL,
      PRIMARY KEY (urna_id, rastreador)
    ) WITHOUT ROWID;
    -- selos emitidos pela urna: o código de verificação é único na seção
    CREATE TABLE IF NOT EXISTS selos (
      urna_id    TEXT NOT NULL,
      rastreador TEXT NOT NULL,
      selo       TEXT NOT NULL,
      codigo     TEXT NOT NULL,
      PRIMARY KEY (urna_id, rastreador),
      UNIQUE (urna_id, codigo)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS nullificadores (
      urna_id      TEXT NOT NULL,
      nullificador TEXT NOT NULL,
      PRIMARY KEY (urna_id, nullificador)
    ) WITHOUT ROWID;
    -- contagem em claro (só totais por opção, como o contador da urna de hoje): vira o BU impresso
    CREATE TABLE IF NOT EXISTS contagem (
      urna_id TEXT NOT NULL,
      opcao   INTEGER NOT NULL,
      votos   INTEGER NOT NULL,
      PRIMARY KEY (urna_id, opcao)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT NOT NULL, tipo TEXT NOT NULL, detalhe TEXT NOT NULL
    );`,
};

const cache = globalThis as unknown as {
  __taiVoteDbs?: Partial<Record<NomeBanco, Database.Database>>;
  __taiVoteEsquemas?: Partial<Record<NomeBanco, string>>;
};

export function caminhoBanco(nome: NomeBanco): string {
  return path.join(DIRETORIO_DADOS, `${nome}.db`);
}

export function db(nome: NomeBanco): Database.Database {
  cache.__taiVoteDbs ??= {};
  cache.__taiVoteEsquemas ??= {};
  const existente = cache.__taiVoteDbs[nome];
  if (existente?.open) {
    // o código mudou com o servidor no ar (recarga automática): aplica o esquema novo
    if (cache.__taiVoteEsquemas[nome] !== ESQUEMAS[nome]) {
      migrar(nome, existente);
      existente.exec(ESQUEMAS[nome]);
      cache.__taiVoteEsquemas[nome] = ESQUEMAS[nome];
    }
    return existente;
  }
  mkdirSync(DIRETORIO_DADOS, { recursive: true });
  const conexao = new Database(caminhoBanco(nome));
  conexao.pragma("journal_mode = DELETE");
  conexao.pragma("secure_delete = ON");
  conexao.pragma("foreign_keys = ON");
  migrar(nome, conexao);
  conexao.exec(ESQUEMAS[nome]);
  cache.__taiVoteDbs[nome] = conexao;
  cache.__taiVoteEsquemas[nome] = ESQUEMAS[nome];
  return conexao;
}

/** Ajusta bancos criados por versões anteriores do protótipo. */
function migrar(nome: NomeBanco, conexao: Database.Database) {
  const colunas = (tabela: string) => (conexao.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
  // v4: a autoridade única virou uma chave por seção; o reservatório central deixou de existir
  if (nome === "autoridade") conexao.exec("DROP TABLE IF EXISTS chave; DROP TABLE IF EXISTS contador;");
  if (nome === "boletim") conexao.exec("DROP TABLE IF EXISTS reservatorio; DROP TABLE IF EXISTS nullificadores; DROP TABLE IF EXISTS selos;");
  if (nome !== "registro") return;
  // habilitações são transitórias: basta recriar a tabela
  const hab = colunas("habilitacoes");
  if (hab.length > 0 && !hab.includes("urna_id")) {
    conexao.exec("DROP TABLE habilitacoes; UPDATE eleitores SET situacao = 'apto' WHERE situacao = 'habilitado';");
  }
  // urnas instaladas antes de zona/seção ficam na zona 001, seção 0001
  const urnas = colunas("urnas");
  if (urnas.length > 0 && !urnas.includes("zona")) {
    conexao.exec("ALTER TABLE urnas ADD COLUMN zona TEXT NOT NULL DEFAULT '001'; ALTER TABLE urnas ADD COLUMN secao TEXT NOT NULL DEFAULT '0001';");
  }
  if (urnas.length > 0 && !colunas("urnas").includes("firmware")) {
    conexao.exec("ALTER TABLE urnas ADD COLUMN firmware TEXT NOT NULL DEFAULT 'oficial'; ALTER TABLE urnas ADD COLUMN firmware_parametros TEXT;");
  }
}

/** Apaga todas as tabelas de um banco e recria o esquema vazio. */
export function recriarBanco(nome: NomeBanco) {
  const d = db(nome);
  const tabelas = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  d.pragma("foreign_keys = OFF");
  for (const t of tabelas) d.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  d.pragma("foreign_keys = ON");
  d.exec("VACUUM");
  d.exec(ESQUEMAS[nome]);
}

export function registrarEvento(nome: NomeBanco, tipo: string, detalhe: string) {
  db(nome).prepare("INSERT INTO eventos (em, tipo, detalhe) VALUES (?, ?, ?)").run(new Date().toISOString(), tipo, detalhe);
}
