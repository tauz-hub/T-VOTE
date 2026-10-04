// Banco C — quadro público nacional (cadeia de blocos) do TSE.
//
// A chave privada do quadro fica FORA do banco (data/chaves/quadro.json).
// Quem consegue escrever no banco, mas não tem a chave, não consegue reassinar
// a cadeia — e o auditor percebe. E quem tem a chave do quadro ainda assim não
// consegue alterar uma seção: a mídia dela é assinada pela chave da urna.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Bloco, type ConteudoPorTipo, type TipoBloco, montarBloco } from "../crypto/quadro";
import { gerarChaveEd25519 } from "./chaves";
import { DIRETORIO_DADOS, db } from "./db";

const ARQUIVO_CHAVE = path.join(DIRETORIO_DADOS, "chaves", "quadro.json");

type ChaveQuadro = { eleicao_id: string; privada: string; publica: string };

export function criarChaveQuadro(eleicaoId: string): ChaveQuadro {
  const k = gerarChaveEd25519();
  const chave = { eleicao_id: eleicaoId, ...k };
  mkdirSync(path.dirname(ARQUIVO_CHAVE), { recursive: true });
  writeFileSync(ARQUIVO_CHAVE, JSON.stringify(chave, null, 2), { mode: 0o600 });
  return chave;
}

export function chaveQuadro(): ChaveQuadro {
  try {
    return JSON.parse(readFileSync(ARQUIVO_CHAVE, "utf8")) as ChaveQuadro;
  } catch {
    throw new Error("Chave do quadro ausente — crie uma nova eleição");
  }
}

type LinhaBloco = Omit<Bloco, "conteudo"> & { conteudo: string };

const deLinha = (l: LinhaBloco): Bloco => ({ ...l, conteudo: JSON.parse(l.conteudo) }) as Bloco;

export function listarBlocos(): Bloco[] {
  return (db("boletim").prepare("SELECT * FROM blocos ORDER BY numero").all() as LinhaBloco[]).map(deLinha);
}

export function blocosDoTipo<T extends TipoBloco>(tipo: T): Bloco<T>[] {
  return (db("boletim").prepare("SELECT * FROM blocos WHERE tipo = ? ORDER BY numero").all(tipo) as LinhaBloco[]).map(
    deLinha,
  ) as Bloco<T>[];
}

export function ultimoBloco(): Bloco | null {
  const l = db("boletim").prepare("SELECT * FROM blocos ORDER BY numero DESC LIMIT 1").get() as LinhaBloco | undefined;
  return l ? deLinha(l) : null;
}

export function anexarBloco<T extends TipoBloco>(tipo: T, conteudo: ConteudoPorTipo[T]): Bloco<T> {
  const d = db("boletim");
  return d.transaction(() => {
    const b = montarBloco(ultimoBloco(), tipo, conteudo, chaveQuadro().privada, new Date().toISOString());
    d.prepare(
      "INSERT INTO blocos (numero, tipo, conteudo, hash_anterior, hash, assinatura, publicado_em) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(b.numero, b.tipo, JSON.stringify(b.conteudo), b.hash_anterior, b.hash, b.assinatura, b.publicado_em);
    return b;
  })();
}

export function gravarBlocos(blocos: Bloco[]) {
  const d = db("boletim");
  const upd = d.prepare("UPDATE blocos SET conteudo = ?, hash_anterior = ?, hash = ?, assinatura = ? WHERE numero = ?");
  d.transaction(() => {
    for (const b of blocos) upd.run(JSON.stringify(b.conteudo), b.hash_anterior, b.hash, b.assinatura, b.numero);
  })();
}

/** Laboratório: regrava a cadeia inteira (ex.: insider que some com um bloco e renumera o resto). */
export function substituirCadeia(blocos: Bloco[]) {
  const d = db("boletim");
  const ins = d.prepare("INSERT INTO blocos (numero, tipo, conteudo, hash_anterior, hash, assinatura, publicado_em) VALUES (?, ?, ?, ?, ?, ?, ?)");
  d.transaction(() => {
    d.prepare("DELETE FROM blocos").run();
    for (const b of blocos) ins.run(b.numero, b.tipo, JSON.stringify(b.conteudo), b.hash_anterior, b.hash, b.assinatura, b.publicado_em);
  })();
}

// ------------------------------------------------------------------- estado

export type EstadoInterno = {
  eleicao_id: string;
  fase: "configuracao" | "aberta" | "encerrada" | "apurada";
  hash_eleicao: string | null;
  chave_publica: string | null;
};

export function estadoInterno(): EstadoInterno | null {
  return (db("boletim").prepare("SELECT eleicao_id, fase, hash_eleicao, chave_publica FROM estado WHERE id = 1").get() as EstadoInterno) ?? null;
}

export function atualizarEstado(e: Partial<EstadoInterno>) {
  const atual = estadoInterno();
  const novo = { ...atual, ...e } as EstadoInterno;
  db("boletim")
    .prepare(
      `INSERT INTO estado (id, eleicao_id, fase, hash_eleicao, chave_publica) VALUES (1, @eleicao_id, @fase, @hash_eleicao, @chave_publica)
       ON CONFLICT(id) DO UPDATE SET eleicao_id = @eleicao_id, fase = @fase, hash_eleicao = @hash_eleicao, chave_publica = @chave_publica`,
    )
    .run({ ...novo, hash_eleicao: novo.hash_eleicao ?? null, chave_publica: novo.chave_publica ?? null });
}
