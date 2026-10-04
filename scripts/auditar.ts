// Auditor independente de linha de comando.
//
//   npm run auditar -- pacote-eleicao.json
//   npm run auditar -- http://127.0.0.1:3000/api/publico/pacote
//
// Não acessa os bancos de dados: lê apenas o pacote público e refaz toda a
// matemática. Também compara o hash do software publicado na gênese com o
// hash dos arquivos deste auditor.
import { readFileSync } from "node:fs";
import { type Pacote, auditarPacote } from "../lib/auditoria";
import type { Bloco } from "../lib/crypto/quadro";
import { hashDoSoftware } from "../lib/server/software";

async function carregar(origem: string): Promise<Pacote> {
  if (/^https?:\/\//.test(origem)) {
    const r = await fetch(origem);
    if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar ${origem}`);
    return (await r.json()) as Pacote;
  }
  return JSON.parse(readFileSync(origem, "utf8")) as Pacote;
}

async function main() {
  const origem = process.argv[2] ?? "http://127.0.0.1:3000/api/publico/pacote";
  console.log(`\nT-VOTE — auditor independente\nOrigem: ${origem}\n`);
  const pacote = await carregar(origem);

  const tty = process.stdout.isTTY;
  const rel = await auditarPacote(pacote, (feito, total, etapa) => {
    if (tty) process.stdout.write(`\r  ${etapa}: ${feito}/${total}`.padEnd(60));
  });
  if (tty) process.stdout.write("\r".padEnd(62) + "\r");

  if (rel.eleicao) console.log(`Eleição: ${rel.eleicao.nome}  (fase: ${rel.fase})`);
  console.log(
    `Blocos: ${rel.estatisticas.blocos}  Seções: ${rel.estatisticas.secoes}  Cédulas: ${rel.estatisticas.cedulas}  Desafiadas: ${rel.estatisticas.desafiadas}\n`,
  );
  const largura = Math.max(...rel.verificacoes.map((v) => v.titulo.length));
  for (const v of rel.verificacoes) {
    const status = v.status === "ok" ? "PASS" : v.status === "falha" ? "FAIL" : "----";
    console.log(`  ${v.titulo.padEnd(largura)}  ${status}`);
    if (v.status === "falha") for (const d of v.detalhes) console.log(`      ↳ ${d}`);
  }

  const genese = pacote.blocos?.[0] as Bloco<"GENESE"> | undefined;
  if (genese?.tipo === "GENESE") {
    const local = hashDoSoftware();
    const publicado = genese.conteudo.software;
    const igual = local.hash === publicado.hash;
    console.log(`\n  ${"Software do auditor = software publicado".padEnd(largura)}  ${igual ? "PASS" : "DIFERENTE"}`);
    if (!igual) {
      for (const [arq, h] of Object.entries(publicado.arquivos))
        if (local.arquivos[arq] !== h) console.log(`      ↳ ${arq} difere da versão publicada`);
    }
  }

  if (rel.resultado) {
    console.log("\nResultado recalculado pelo auditor:");
    for (const r of rel.resultado) console.log(`  ${(r.opcao.numero ?? "--").padStart(2)}  ${r.opcao.nome.padEnd(24)} ${r.votos}`);
  }
  console.log(`\n${rel.aprovado ? "✔ ELEIÇÃO ÍNTEGRA" : "✘ PROBLEMAS ENCONTRADOS"}\n`);
  process.exit(rel.aprovado ? 0 : 1);
}

main().catch((e) => {
  console.error("Erro:", (e as Error).message);
  process.exit(2);
});
