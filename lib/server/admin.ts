// Visão do administrador sobre o conteúdo bruto dos quatro bancos.
// O administrador pode LER tudo — e mesmo assim não consegue ligar eleitor a
// voto nem decifrar cédulas. Essa é a demonstração.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DESCRICAO_BANCOS, DIRETORIO_DADOS, type NomeBanco, caminhoBanco, db, recriarBanco } from "./db";
import { descartarBackup } from "./ataques";
import { chaveQuadro } from "./quadro";

export type TabelaDespejo = { nome: string; colunas: string[]; linhas: Record<string, unknown>[]; total: number };

/** Caminho para exibir na tela: relativo ao projeto, nunca absoluto (não revela usuário nem pastas do computador). */
function caminhoExibido(arquivo: string): string {
  const relativo = path.relative(process.cwd(), arquivo);
  if (!relativo || relativo.startsWith("..") || path.isAbsolute(relativo)) return `<pasta de dados>/${path.relative(DIRETORIO_DADOS, arquivo).split(path.sep).join("/")}`;
  return relativo.split(path.sep).join("/");
}

export function despejarBancos() {
  const bancos: NomeBanco[] = ["registro", "autoridade", "urnas", "boletim"];
  return {
    bancos: bancos.map((nome) => {
      const d = db(nome);
      const tabelas = (
        d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as {
          name: string;
        }[]
      ).map(({ name }): TabelaDespejo => {
        const colunas = (d.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
        const total = (d.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
        const ordem = name === "eventos" ? "ORDER BY id DESC" : "";
        const linhas = d.prepare(`SELECT * FROM "${name}" ${ordem} LIMIT 300`).all() as Record<string, unknown>[];
        return { nome: name, colunas, linhas, total };
      });
      return {
        nome,
        arquivo: caminhoExibido(caminhoBanco(nome)),
        descricao: DESCRICAO_BANCOS[nome],
        tabelas,
      };
    }),
    chave_quadro: (() => {
      try {
        const k = chaveQuadro();
        return { arquivo: `${caminhoExibido(path.join(DIRETORIO_DADOS, "chaves", "quadro.json"))} (fora do banco)`, publica: k.publica };
      } catch {
        return null;
      }
    })(),
  };
}

export function resetarTudo() {
  recriarBanco("registro");
  recriarBanco("autoridade");
  recriarBanco("urnas");
  recriarBanco("boletim");
  descartarBackup();
  const chaves = path.join(DIRETORIO_DADOS, "chaves", "quadro.json");
  if (existsSync(chaves)) rmSync(chaves);
}
