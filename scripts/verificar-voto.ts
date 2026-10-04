// Validador do eleitor, de linha de comando — roda em casa, SEM internet, só
// com o pacote público baixado e este código-fonte (que qualquer um lê).
//
//   npm run verificar -- pacote.json 0010001K7Q2M                     (meu voto: figuras e conferência)
//   npm run verificar -- pacote.json 0010001K7Q2M "K7Q2 M8XA ... XX"   (meu TESTE: refaz a cifração com a chave do papel)
//   npm run verificar -- pacote.json --bu 001-0001                    (BU da seção, para comparar com o papel da porta)
//
// Não acessa servidor nem banco: toda a matemática é refeita aqui.
import { readFileSync } from "node:fs";
import { type Pacote, boletimDaSecao, reproduzirTeste, verificarMinhaCedula } from "../lib/auditoria";
import { formatarCodigo, formatarConferencia, lerChaveTeste, lerCodigo } from "../lib/crypto/palavras";
import type { Opcao } from "../lib/crypto/quadro";

const nome = (o?: Opcao) => (o ? `${o.numero ? `${o.numero} — ` : ""}${o.nome}` : "?");
const marca = (s: string) => (s === "ok" ? "✔" : s === "falha" ? "✘" : "…");

function main() {
  const [arquivo, ...resto] = process.argv.slice(2);
  if (!arquivo || resto.length === 0) {
    console.log('uso: npm run verificar -- pacote.json <código> ["chave do teste"]\n     npm run verificar -- pacote.json --bu <zona-seção>');
    process.exit(2);
  }
  const pacote = JSON.parse(readFileSync(arquivo, "utf8")) as Pacote;
  console.log(`\nTAI-VOTE — validador do eleitor (offline)\nPacote: ${arquivo} · ${pacote.blocos.length} blocos\n`);

  if (resto[0] === "--bu") {
    const secao = resto[1] ?? "";
    const bu = boletimDaSecao(pacote, secao);
    if (!bu.encontrada) {
      console.log(bu.situacao === "aguardando_midia" ? `Seção ${secao}: a urna tem carga, mas a mídia não chegou ao TSE.` : `Seção ${secao}: sem carga nesta eleição.`);
      process.exit(1);
    }
    console.log(`BU da seção ${bu.secao} — ${bu.urna} (bloco ${bu.bloco})`);
    console.log(`CÓDIGO DO BU: ${bu.codigo}   ← compare com o papel da porta da escola\n`);
    for (const x of bu.contagem) {
      const apurado = bu.apurada ? String(bu.apurada[x.opcao]?.votos) : "—";
      console.log(`  ${nome(bu.opcoes[x.opcao]).padEnd(34)} BU ${String(x.votos).padStart(4)}   apuração ${apurado.padStart(4)}`);
    }
    console.log(`\n  ${marca(bu.assinaturaOk ? "ok" : "falha")} assinado pela urna da carga`);
    console.log(`  ${marca(bu.somaOk ? "ok" : "falha")} soma das cédulas confere com o agregado`);
    console.log(`  ${bu.confere === null ? "…" : marca(bu.confere ? "ok" : "falha")} BU impresso = apuração criptográfica`);
    process.exit(bu.assinaturaOk && bu.somaOk && bu.confere !== false ? 0 : 1);
  }

  const codigo = lerCodigo(resto[0]);
  if (!codigo) {
    console.log("Código inválido: são 12 caracteres (ex.: 001 0001 K7Q2M).");
    process.exit(2);
  }
  const r = verificarMinhaCedula(pacote, codigo);
  if (!r.encontrada) {
    const motivo = {
      aguardando_midia: "a urna desta seção ainda não entregou a mídia ao TSE — tente depois",
      transmitida: "a mídia da seção JÁ chegou e o código NÃO está nela — guarde o comprovante (a assinatura da urna prova que ela aceitou a cédula)",
      sem_carga: "nenhuma urna com essa zona e seção nesta eleição",
    }[r.situacaoSecao ?? "sem_carga"];
    console.log(`✘ Código ${formatarCodigo(codigo)} não encontrado: ${motivo}.`);
    process.exit(1);
  }
  console.log(`${r.tipo === "desafiada" ? "CÉDULA DE TESTE" : "SEU VOTO"} — código ${formatarCodigo(codigo)}`);
  console.log(`  figuras:     ${r.figuras?.map((f) => `${f.figura} ${f.palavra.toUpperCase()}`).join("   ")}`);
  if (r.conferencia) console.log(`  conferência: ${formatarConferencia(r.conferencia)}   ← tem de ser a do seu papel`);
  console.log(`  BU da seção: ${r.codigoBU}\n`);
  for (const i of r.itens) console.log(`  ${marca(i.status)} ${i.titulo} — ${i.detalhe}`);

  if (r.tipo === "desafiada") {
    const chave = resto[1] ? lerChaveTeste(resto.slice(1).join(" ")) : null;
    if (!chave) {
      console.log('\nPara refazer o teste no seu computador, passe também a chave impressa no comprovante (parte do teste) (26 caracteres, entre aspas).');
    } else {
      const rep = reproduzirTeste(pacote, codigo, chave);
      console.log("\nRefazendo a cifração com a chave do SEU papel…");
      if (!rep.encontrada) console.log(`  ✘ ${rep.motivo}`);
      else if (rep.indice === null) console.log("  ✘ a chave do papel NÃO abre a cédula que a urna selou com este código — prova contra a urna");
      else {
        console.log(`  ✔ cifrar "${nome(rep.opcao)}" com a sua chave dá exatamente as cifras da cédula selada${rep.seloOk ? " (selo da urna confere)" : " — mas o selo NÃO confere"}`);
        console.log(`\n  A CÉDULA DE TESTE CONTINHA: ${nome(rep.opcao)}`);
        console.log("  Se o comprovante diz outro candidato, a urna mentiu — e o papel, assinado por ela, é a prova.");
      }
    }
  } else {
    console.log("\nNada aqui diz em quem você votou: a chave do seu voto foi destruída na urna. Ele só é contado dentro da soma da seção.");
  }
  process.exit(r.itens.some((i) => i.status === "falha") ? 1 : 0);
}

main();
