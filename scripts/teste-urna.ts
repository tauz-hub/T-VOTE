// Teste do pareamento mesa ↔ urna (long-poll), com dados isolados em pasta
// temporária — não toca no data/ da eleição em uso.
//
//   npm run teste:urna
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pasta = mkdtempSync(path.join(tmpdir(), "t-vote-urna-"));
process.env.T_VOTE_DADOS = pasta;

let falhas = 0;
function esperar(condicao: boolean, msg: string) {
  console.log(`${condicao ? "  ✔" : "  ✘"} ${msg}`);
  if (!condicao) falhas++;
}

async function main() {
  // importa depois de definir T_VOTE_DADOS
  const { cadastrarEleitor, obterEleitor } = await import("../lib/server/registro");
  const urnas = await import("../lib/server/urnas");

  console.log("\n▶ Pareamento mesa ↔ urna");
  const eleitor = cadastrarEleitor({ nome: "Eleitora de Teste", documento: "12345678901" });
  const { token } = urnas.instalarUrna({ zona: "1", secao: "1" });
  const urna = urnas.autenticarUrna(token);
  esperar(urna.nome === "Urna 1 — Zona 001 Seção 0001" && urna.zona === "001" && urna.secao === "0001", `nome automático com zona e seção: ${urna.nome}`);

  // a urna fica esperando; o mesário libera 300 ms depois
  let t0 = performance.now();
  const espera1 = urnas.aguardarEstado(urna, "livre");
  esperar(urnas.listarUrnas()[0].online, "urna conta como online enquanto espera");
  setTimeout(() => urnas.liberarUrna(urna.id, eleitor.id), 300);
  const r1 = await espera1;
  let ms = performance.now() - t0;
  esperar(r1.estado === "liberada" && ms < 1000, `urna acordou na hora da liberação (${ms.toFixed(0)} ms): ${r1.estado}`);
  esperar(urnas.listarUrnas()[0].eleitor === "Eleitora de Teste", "mesa vê o nome só enquanto a liberação está pendente");

  // a urna pede a credencial (a autoridade consome a liberação)
  t0 = performance.now();
  const espera2 = urnas.aguardarEstado(urnas.autenticarUrna(token), "liberada");
  setTimeout(() => urnas.consumirHabilitacaoDaUrna(urna.id), 200);
  const r2 = await espera2;
  esperar(r2.estado === "votando", `liberação virou credencial: ${r2.estado} (${(performance.now() - t0).toFixed(0)} ms)`);
  esperar(urnas.listarUrnas()[0].eleitor === null, "mesa já não sabe quem está na cabine");
  esperar(obterEleitor(eleitor.id)?.situacao === "credenciado", "registro marca o eleitor como compareceu");

  // urna ocupada recusa nova liberação
  const outro = cadastrarEleitor({ nome: "Outro Eleitor", documento: "99999999999" });
  let recusou = false;
  try {
    urnas.liberarUrna(urna.id, outro.id);
  } catch {
    recusou = true;
  }
  esperar(recusou, "urna ocupada recusa uma segunda liberação");

  // fim do voto
  const espera3 = urnas.aguardarEstado(urnas.autenticarUrna(token), "votando");
  setTimeout(() => urnas.concluirVotacaoNaUrna(urna.id), 100);
  esperar((await espera3).estado === "livre", "depois do depósito a urna volta a ficar livre");

  // cancelamento antes da credencial devolve o eleitor a "apto"
  urnas.liberarUrna(urna.id, outro.id);
  const espera4 = urnas.aguardarEstado(urnas.autenticarUrna(token), "liberada");
  setTimeout(() => urnas.cancelarLiberacao(urna.id), 100);
  esperar((await espera4).estado === "livre" && obterEleitor(outro.id)?.situacao === "apto", "cancelar a liberação devolve o eleitor a apto");

  // a urna pode desistir de esperar (aba fechada)
  const controle = new AbortController();
  t0 = performance.now();
  const espera5 = urnas.aguardarEstado(urnas.autenticarUrna(token), "livre", controle.signal);
  setTimeout(() => controle.abort(), 100);
  await espera5;
  ms = performance.now() - t0;
  esperar(ms < 1000, `espera encerrada quando a urna desconecta (${ms.toFixed(0)} ms)`);

  // remoção só com a urna livre; token antigo deixa de valer
  urnas.removerUrna(urna.id);
  let invalido = false;
  try {
    urnas.autenticarUrna(token);
  } catch {
    invalido = true;
  }
  esperar(invalido, "urna removida perde o pareamento");

  console.log(falhas === 0 ? "\n✔ Pareamento OK\n" : `\n✘ ${falhas} falha(s)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    falhas++;
  })
  .finally(() => {
    try {
      rmSync(pasta, { recursive: true, force: true });
    } catch {
      // o SQLite pode segurar o arquivo no Windows; é uma pasta temporária
    }
    process.exit(falhas === 0 ? 0 : 1);
  });
