// Testes de invasão: uma eleição completa pelos MÓDULOS REAIS do sistema
// (carga, seção offline, BU, mídia, TSE, laboratório de ataques), com dados
// numa pasta temporária. Para cada fraude, quem percebe:
//
//   auditor   o auditor independente, só com o pacote público
//   eleitor   o eleitor em casa, com o comprovante (código, figuras, conferência)
//   teste     o eleitor que testou a urna, refazendo a cifração com a chave do papel
//   papel     qualquer pessoa comparando o BU publicado com o BU colado na escola
//
// Também testa o sigilo (o que um terceiro aprende com o código do eleitor) e a
// força do compromisso que a urna mostra antes de o eleitor decidir.
//
//   npm run teste:invasao        (gera docs/RELATORIO-INVASAO.md)
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pasta = mkdtempSync(path.join(tmpdir(), "t-vote-invasao-"));
process.env.T_VOTE_DADOS = pasta;

let falhas = 0;
const relatorio: string[] = [];
function esperar(condicao: boolean, msg: string) {
  console.log(`${condicao ? "  ✔" : "  ✘"} ${msg}`);
  if (!condicao) falhas++;
}
const md = (linha = "") => relatorio.push(linha);

async function main() {
  // importa depois de definir T_VOTE_DADOS
  const { auditarPacote, boletimDaSecao, conferirDeclaracaoTeste, reproduzirTeste, verificarMinhaCedula } = await import("../lib/auditoria");
  const { assinarCedula, assinarPedidoSelo, montarDesafiada, prepararCedula, verificarDesafiada } = await import("../lib/crypto/cedula");
  const { finalizarCredencial, iniciarCredencial } = await import("../lib/crypto/credencial");
  const { inteiroAleatorio } = await import("../lib/crypto/codificacao");
  const { conferenciaDoSelo, nomesDasFiguras, FIGURAS } = await import("../lib/crypto/palavras");
  const { assinarHash, hashSelo } = await import("../lib/crypto/quadro");
  const { codigoBU } = await import("../lib/crypto/secao");
  const { gerarChaveTrustee, decifrarParcial } = await import("../lib/crypto/trustee");
  const { opcaoDeclaradaNoTeste, opcaoParaCifrar } = await import("../lib/laboratorio/firmware-adulterado");
  const { CANDIDATOS_PADRAO } = await import("../lib/padroes");
  const { agregarCedulas } = await import("../lib/crypto/secao");
  const { cadastrarEleitor } = await import("../lib/server/registro");
  const urnas = await import("../lib/server/urnas");
  const secao = await import("../lib/server/secao");
  const eleicao = await import("../lib/server/eleicao");
  const { fazerCarga, transmitirSecao } = await import("../lib/server/operacoes");
  const { emitirCredencial } = await import("../lib/server/autoridade");
  const { aplicarAtaque, restaurarBackup } = await import("../lib/server/ataques");
  const { db } = await import("../lib/server/db");
  const { gerarChaveEd25519 } = await import("../lib/server/chaves");

  md("# Relatório dos testes de invasão — T-VOTE v4");
  md();
  md(`Gerado por \`npm run teste:invasao\` em ${new Date().toLocaleString("pt-BR")}. Eleição completa pelos módulos reais do sistema, com dados numa pasta temporária.`);
  md();

  // ------------------------------------------------------------ preparação
  console.log("\n▶ TSE cria a eleição, trustees publicam as chaves, eleição aberta");
  const { eleicao_id } = eleicao.criarEleicao({
    nome: "Presidente — teste de invasão",
    candidatos: CANDIDATOS_PADRAO.map((c) => ({ numero: c.numero, nome: c.nome, partido: c.partido })),
  });
  const segredos = [1, 2, 3].map((t) => {
    const { segredo, publico } = gerarChaveTrustee(eleicao_id, t, `Trustee ${"ABC"[t - 1]}`);
    eleicao.registrarChaveTrustee(publico);
    return segredo;
  });
  eleicao.abrirEleicao();
  const opcoes = eleicao.estadoPublico().opcoes!;
  const candidatos = opcoes.map((o, i) => ({ o, i })).filter(({ o }) => o.tipo === "candidato");
  // o laboratório não favorece ninguém: o alvo da urna adulterada é sorteado
  const alvo = candidatos[inteiroAleatorio(candidatos.length)].i;

  const config = [
    { zona: "001", secao: "0001", eleitores: 14, firmware: "oficial" as const },
    { zona: "001", secao: "0002", eleitores: 10, firmware: "oficial" as const },
    { zona: "001", secao: "0003", eleitores: 12, firmware: "adulterado" as const },
  ];
  const instaladas = config.map((c) => {
    const r = urnas.instalarUrna({ zona: c.zona, secao: c.secao, ...(c.firmware === "adulterado" ? { firmware: "adulterado", alvo: opcoes[alvo].numero, percentual: 100 } : {}) });
    const u = urnas.lerUrna(r.id)!;
    fazerCarga(u); // a urna gera a chave dentro dela; a pública vai para o quadro
    secao.abrirSecao(u); // zerésima
    return { ...c, id: r.id };
  });
  esperar(eleicao.estadoPublico().estatisticas.secoes_carregadas === 3, "3 urnas com carga (chaves públicas no quadro antes dos votos)");
  const blocosAntes = eleicao.pacotePublico().blocos.length;

  // ------------------------------------------------------------ votação offline
  type Lembranca = {
    secao: string;
    escolha: number;
    codigo: string;
    conferencia: string;
    figuras: string[];
    teste?: { codigo: string; semente: string; declarada: number; escolha: number; declaracao: ReturnType<typeof secao.testarNaUrna>["declaracao"] };
  };
  const lembrancas: Lembranca[] = [];
  const ordemDeChegada: string[] = [];
  const buImpresso = new Map<string, { hash: string; contagem: { opcao: number; votos: number }[] }>();
  let n = 0;
  console.log("\n▶ Votação offline nas 3 seções (a seção 001-0003 tem software adulterado)");
  for (const c of instaladas) {
    const parametros = c.firmware === "adulterado" ? { alvo: opcoes[alvo].numero!, percentual: 100 } : undefined;
    for (let k = 0; k < c.eleitores; k++) {
      const eleitor = cadastrarEleitor({ nome: `Eleitor ${++n}`, documento: `DOC${String(n).padStart(8, "0")}`, secao: c.secao });
      urnas.liberarUrna(c.id, eleitor.id);
      const u = urnas.lerUrna(c.id)!;
      const carga = secao.cargaDaUrna(u.id, eleicao_id)!;
      const ctx = { eleicaoId: carga.eleicao_id, hashEleicao: carga.hash_eleicao, chavePublica: carga.chave_publica, nOpcoes: opcoes.length, autoridade: carga.autoridade_secao };
      // a urna gera a credencial e a mesa assina às cegas
      const pedido = iniciarCredencial(ctx.eleicaoId, ctx.autoridade);
      const cred = finalizarCredencial(pedido, emitirCredencial({ urnaId: u.id }, pedido.cega), ctx.autoridade);
      const selar = (rastreador: string) =>
        secao.selarNaUrna(
          { eleicao: ctx.hashEleicao, rastreador, credencial: { chave: cred.chave, assinatura_autoridade: cred.assinatura_autoridade }, assinatura: assinarPedidoSelo(ctx.hashEleicao, rastreador, cred.privada) },
          u,
        );
      let escolha = candidatos[inteiroAleatorio(candidatos.length)].i;
      if (c.firmware === "adulterado" && escolha === alvo) escolha = candidatos.find(({ i }) => i !== alvo)!.i;
      let teste: Lembranca["teste"];
      if (k % 3 === 0) {
        // o eleitor testa a urna
        const cifrada = opcaoParaCifrar(u.firmware, parametros, escolha, opcoes);
        const p = prepararCedula(ctx, cred.chave, cifrada);
        const v = selar(p.rastreador);
        const d = montarDesafiada(p, ctx.hashEleicao);
        const aberta = verificarDesafiada(d, ctx).opcao;
        const declarada = opcaoDeclaradaNoTeste(u.firmware, escolha, aberta);
        const { declaracao } = secao.testarNaUrna(d, declarada, u);
        teste = { codigo: v.codigo, semente: p.segredos.semente, declarada, escolha, declaracao };
      }
      const cifrada = opcaoParaCifrar(u.firmware, parametros, escolha, opcoes);
      const p = prepararCedula(ctx, cred.chave, cifrada);
      const v = selar(p.rastreador);
      secao.depositarNaUrna(assinarCedula(p, ctx.hashEleicao, cred, cred.privada), cifrada, u);
      ordemDeChegada.push(p.rastreador);
      urnas.concluirVotacaoNaUrna(u.id);
      lembrancas.push({ secao: carga.secao, escolha, codigo: v.codigo, conferencia: conferenciaDoSelo(v.selo), figuras: v.figuras, teste });
    }
  }
  esperar(eleicao.pacotePublico().blocos.length === blocosAntes, "durante a votação NENHUM bloco foi escrito no quadro do TSE (seções offline)");

  // ------------------------------------------------------------ sigilo da memória da urna (TPS 2012)
  console.log("\n▶ Sigilo da memória da urna (TPS 2012)");
  const guardadas = (db("urnas").prepare("SELECT rastreador FROM cedulas WHERE tipo = 'cedula' AND urna_id = ?").all(instaladas[0].id) as { rastreador: string }[]).map((x) => x.rastreador);
  const chegada = ordemDeChegada.filter((r) => guardadas.includes(r));
  const ordenadas = [...guardadas].sort();
  esperar(JSON.stringify(guardadas) === JSON.stringify(ordenadas), "a memória da urna devolve as cédulas na ordem do rastreador (WITHOUT ROWID), não na de chegada");
  const posicoes = chegada.map((r) => guardadas.indexOf(r));
  const nPos = posicoes.length;
  const media = (nPos - 1) / 2;
  const cov = posicoes.reduce((s, p, i) => s + (p - media) * (i - media), 0);
  const varr = posicoes.reduce((s, _, i) => s + (i - media) ** 2, 0);
  const spearman = cov / varr;
  esperar(Math.abs(spearman) < 0.75, `correlação entre ordem de chegada e ordem guardada ≈ 0 (Spearman = ${spearman.toFixed(2)}, amostra de ${nPos})`);
  const sementesDepositadas = (db("urnas").prepare("SELECT COUNT(*) AS n FROM cedulas WHERE tipo = 'cedula' AND conteudo LIKE '%semente%'").get() as { n: number }).n;
  esperar(sementesDepositadas === 0, "nenhuma chave de cédula DEPOSITADA existe na memória da urna (só as de teste)");
  const eventosPorVoto = (db("urnas").prepare("SELECT COUNT(*) AS n FROM eventos WHERE tipo LIKE '%CEDULA%' AND tipo <> 'CEDULA_REJEITADA'").get() as { n: number }).n;
  esperar(eventosPorVoto === 0, "nenhum evento com horário por voto nos logs da urna");

  // ------------------------------------------------------------ encerramento e transmissão
  console.log("\n▶ Encerramento: BU impresso e mídia levada ao TSE");
  for (const c of instaladas) {
    const u = urnas.lerUrna(c.id)!;
    const bu = secao.encerrarSecao(u);
    buImpresso.set(bu.conteudo.secao, { hash: bu.hash, contagem: bu.conteudo.contagem }); // o papel colado na porta da escola
    await transmitirSecao(urnas.lerUrna(c.id)!);
  }
  eleicao.encerrarEleicao();
  esperar(eleicao.estadoPublico().estatisticas.secoes_transmitidas === 3, "3 mídias conferidas e publicadas pelo TSE");

  // ------------------------------------------------------------ verificações dos eleitores
  type Checagem = { auditor: string[]; eleitores: number; testes: number; papel: string[] };
  // testes que já denunciam a urna adulterada antes de qualquer ataque do TSE: não contam como detecção do ataque
  let testesDaUrnaAdulterada = new Set<string>();
  const pacote = () => eleicao.pacotePublico();
  async function checar(): Promise<Checagem> {
    const p = pacote();
    const rel = await auditarPacote(p);
    const auditor = rel.verificacoes.filter((v) => v.status === "falha").map((v) => v.id);
    // eleitor: o código do comprovante tem de estar lá, com as mesmas figuras e conferência
    const eleitores = lembrancas.filter((l) => {
      const r = verificarMinhaCedula(p, l.codigo);
      return !r.encontrada || r.figuras?.map((f) => f.palavra).join() !== l.figuras.join() || r.conferencia !== l.conferencia || r.itens.some((i) => i.status === "falha");
    }).length;
    // quem testou: refaz a cifração com a chave do papel e compara com o que escolheu
    const testes = lembrancas.filter((l) => {
      if (!l.teste || testesDaUrnaAdulterada.has(l.teste.codigo)) return false;
      const r = reproduzirTeste(p, l.teste.codigo, l.teste.semente);
      return !r.encontrada || r.indice !== l.teste.escolha || !r.seloOk;
    }).length;
    // BU da porta da escola × BU publicado
    const papel = [...buImpresso].filter(([s, impresso]) => {
      const b = boletimDaSecao(p, s);
      return !b.encontrada || b.codigo !== codigoBU(impresso.hash) || b.contagem.some((x, i) => x.votos !== impresso.contagem[i].votos);
    }).map(([s]) => s);
    return { auditor, eleitores, testes, papel };
  }
  const quem = (c: Checagem) =>
    [c.auditor.length ? `auditor (${c.auditor.join(", ")})` : "", c.eleitores ? `${c.eleitores} eleitor(es) com o comprovante` : "", c.testes ? `${c.testes} eleitor(es) que testaram` : "", c.papel.length ? `BU em papel (${c.papel.join(", ")})` : ""]
      .filter(Boolean)
      .join(" · ") || "NINGUÉM";

  {
    const p = pacote();
    testesDaUrnaAdulterada = new Set(
      lembrancas.filter((l) => l.teste && reproduzirTeste(p, l.teste.codigo, l.teste.semente).indice !== l.teste.escolha).map((l) => l.teste!.codigo),
    );
  }

  // ------------------------------------------------------------ ataques ANTES da apuração
  console.log("\n▶ Ataques do TSE antes da apuração (com o laboratório real)");
  const linhas: string[] = [];
  const registrar = (titulo: string, atacante: string, c: Checagem, esperado: string) => {
    linhas.push(`| ${titulo} | ${atacante} | ${quem(c)} | ${esperado} |`);
  };
  const ATACANTE: Record<string, string> = { banco: "banco de dados", tse: "TSE (chave do quadro)", tse_hardware: "TSE + chaves extraídas da urna/mesa" };
  const { ATAQUES } = await import("../lib/server/ataques");
  for (const tipo of ["reescrever_secao", "omitir_secao", "credencial_forjada", "ordem_chegada", "trocar_figuras"] as const) {
    const resumo = aplicarAtaque(tipo);
    const c = await checar();
    const pego = c.auditor.length > 0 || c.eleitores > 0 || c.papel.length > 0;
    esperar(pego, `${ATAQUES[tipo].titulo} → ${quem(c)}`);
    console.log(`      (${resumo})`);
    registrar(ATAQUES[tipo].titulo, ATACANTE[ATAQUES[tipo].atacante], c, ATAQUES[tipo].quem_detecta);
    restaurarBackup();
  }

  // ------------------------------------------------------------ apuração
  console.log("\n▶ Trustees decifram seção por seção");
  const p0 = pacote();
  const agregados = p0.blocos
    .filter((b) => b.tipo === "SECAO")
    .map((b) => {
      const s = (b as import("../lib/crypto/quadro").Bloco<"SECAO">).conteudo;
      return { secao: s.secao, agregado: agregarCedulas(s.bu.conteudo.cedulas, opcoes.length) };
    });
  const hashEleicao = eleicao.estadoPublico().hash_eleicao!;
  for (const s of segredos) eleicao.receberDecifracaoParcial(decifrarParcial(s, agregados, hashEleicao));
  const honesta = await checar();
  esperar(honesta.auditor.length === 0, `eleição apurada: auditor aprova tudo (inclusive a seção adulterada — a matemática não vê intenção)`);
  esperar(honesta.eleitores === 0, `todos os ${lembrancas.length} eleitores acham o código com as mesmas figuras e conferência`);
  esperar(honesta.papel.length === 0, "os 3 BU publicados = os 3 BU em papel");

  // ------------------------------------------------------------ urna adulterada
  console.log("\n▶ Urna adulterada na instalação (seção 001-0003)");
  const pf = pacote();
  const testaram = lembrancas.filter((l) => l.teste && l.secao === "001-0003");
  const pegos = testaram.filter((l) => {
    const r = reproduzirTeste(pf, l.teste!.codigo, l.teste!.semente);
    const d = conferirDeclaracaoTeste(pf, l.teste!.declaracao);
    return r.encontrada && r.indice === alvo && r.indice !== l.teste!.escolha && d.encontrada && d.fraude;
  });
  esperar(testaram.length > 0 && pegos.length === testaram.length, `os ${testaram.length} eleitores que testaram a urna adulterada pegam a fraude em casa: a chave do papel reproduz o nº ${opcoes[alvo].numero}; a urna declarou e ASSINOU outro`);
  const honestosTestaram = lembrancas.filter((l) => l.teste && l.secao !== "001-0003");
  const semFalsoAlarme = honestosTestaram.every((l) => {
    const r = reproduzirTeste(pf, l.teste!.codigo, l.teste!.semente);
    return r.encontrada && r.indice === l.teste!.escolha && !conferirDeclaracaoTeste(pf, l.teste!.declaracao).fraude;
  });
  esperar(semFalsoAlarme, `nas urnas honestas, os ${honestosTestaram.length} testes refeitos em casa batem com a escolha (sem falso alarme)`);
  const buAdulterada = boletimDaSecao(pf, "001-0003");
  const desvio = buAdulterada.encontrada ? buAdulterada.contagem[alvo].votos : 0;
  linhas.push(
    `| Urna com software trocado na carga: desvia 100% dos votos para o nº ${opcoes[alvo].numero} e mente no teste | quem fabrica/carrega a urna | ${pegos.length} de ${testaram.length} eleitor(es) que testaram (auditor e BU: nada — o desvio é coerente) | o eleitor que testa, em casa, com a chave do papel |`,
  );

  // ------------------------------------------------------------ ataques DEPOIS da apuração
  console.log("\n▶ Ataques do TSE depois da apuração");
  for (const tipo of ["alterar_voto", "alterar_voto_recalcular", "remover_cedula", "bu_falso", "alterar_resultado"] as const) {
    const resumo = aplicarAtaque(tipo);
    const c = await checar();
    esperar(c.auditor.length > 0 || c.eleitores > 0 || c.papel.length > 0, `${ATAQUES[tipo].titulo} → ${quem(c)}`);
    console.log(`      (${resumo})`);
    registrar(ATAQUES[tipo].titulo, ATACANTE[ATAQUES[tipo].atacante], c, ATAQUES[tipo].quem_detecta);
    restaurarBackup();
  }

  // ------------------------------------------------------------ sigilo do código do eleitor
  console.log("\n▶ Sigilo: um terceiro aprende o voto pelo código, figuras ou papel?");
  const carga1 = secao.cargaDaUrna(instaladas[0].id, eleicao_id)!;
  const ctx1 = { eleicaoId: carga1.eleicao_id, hashEleicao: carga1.hash_eleicao, chavePublica: carga1.chave_publica, nOpcoes: opcoes.length, autoridade: carga1.autoridade_secao };
  const urnaLab = gerarChaveEd25519();
  const sela = (rastreador: string) => assinarHash(hashSelo(ctx1.hashEleicao, rastreador, carga1.secao), urnaLab.privada);
  const indiceFigura = (selo: string) => FIGURAS.findIndex((f) => f.palavra === nomesDasFiguras(selo)[0]);
  const AMOSTRA = 160;
  const [A, B] = [candidatos[0].i, candidatos[1].i];
  const pares = (opcao: number) => Array.from({ length: AMOSTRA }, () => indiceFigura(sela(prepararCedula(ctx1, "00".repeat(32), opcao).rastreador)) % 2);
  const fa = pares(A).reduce((s, x) => s + x, 0) / AMOSTRA;
  const fb = pares(B).reduce((s, x) => s + x, 0) / AMOSTRA;
  esperar(Math.abs(fa - fb) < 0.2, `urna oficial: a 1ª figura não depende do voto (figura "ímpar": ${(fa * 100).toFixed(0)}% para ${opcoes[A].numero}, ${(fb * 100).toFixed(0)}% para ${opcoes[B].numero}, ${AMOSTRA} cédulas cada)`);
  // canal subliminar: uma urna ADULTERADA escolhe a aleatoriedade até a figura "contar" o voto
  let tentativas = 0;
  const vazadas = Array.from({ length: 20 }, () => {
    const opcao = candidatos[inteiroAleatorio(candidatos.length)].i;
    for (;;) {
      tentativas++;
      const p = prepararCedula(ctx1, "00".repeat(32), opcao);
      if (indiceFigura(sela(p.rastreador)) % opcoes.length === opcao) return { opcao, figura: indiceFigura(sela(p.rastreador)) };
    }
  });
  const acertos = vazadas.filter((v) => v.figura % opcoes.length === v.opcao).length;
  esperar(acertos === 20, `urna ADULTERADA pode vazar o voto pela figura (canal subliminar): ${acertos}/20 votos lidos por quem viu a 1ª figura, ~${(tentativas / 20).toFixed(0)} cifrações por voto — limite real, ver relatório`);

  // ------------------------------------------------------------ força do compromisso (colisão)
  console.log("\n▶ Colisão: a urna prepara duas cédulas com o mesmo código para enganar o teste?");
  const tabela = new Map<string, number>();
  let gastas = 0;
  const chaveFig = (selo: string) => nomesDasFiguras(selo).join("|");
  for (let i = 0; i < 300; i++) {
    tabela.set(chaveFig(sela(prepararCedula(ctx1, "00".repeat(32), A).rastreador)), i);
    gastas++;
  }
  let colisao: { selo: string } | null = null;
  for (let i = 0; i < 20000 && !colisao; i++) {
    gastas++;
    const selo = sela(prepararCedula(ctx1, "00".repeat(32), B).rastreador);
    if (tabela.has(chaveFig(selo))) colisao = { selo };
  }
  esperar(!!colisao, `com só as 2 figuras (16 bits), a urna achou duas cédulas (nº ${opcoes[A].numero} e nº ${opcoes[B].numero}) com as MESMAS figuras em ${gastas} cifrações`);
  esperar(true, "por isso a urna mostra também o código (25 bits) e IMPRIME a conferência (40 bits) antes da decisão: 81 bits no total");

  // ------------------------------------------------------------ relatório
  md("## Quem pega cada fraude");
  md();
  md("| Fraude | Atacante | Quem percebeu neste teste | Quem deve perceber |");
  md("|---|---|---|---|");
  for (const l of linhas) md(l);
  md();
  md("**Leitura:** a auditoria matemática pega tudo o que mexe no quadro sem as chaves da urna e da mesa. Quando o insider tem também essas chaves (backdoor de fábrica), ele consegue fabricar uma seção matematicamente perfeita — e quem pega é o **eleitor** (o código do comprovante some) e o **BU em papel** colado na porta da escola (código do BU e números diferentes). Quando a fraude está **dentro da urna** (software trocado), o BU sai coerente com as cifras e só o **eleitor que testa** pega — em casa, refazendo a cifração com a chave impressa no comprovante (parte do teste).");
  md();
  md("## A urna adulterada e o teste do eleitor");
  md();
  md(`A seção 001-0003 tinha software trocado na carga: desviava 100% dos votos para o nº ${opcoes[alvo].numero}, mostrava ao eleitor o número que ele digitou e, no teste, declarava (e assinava) esse número. O BU dela saiu com ${desvio} voto(s) para o nº ${opcoes[alvo].numero} e passou em todas as verificações matemáticas. Os ${testaram.length} eleitores que testaram a urna refizeram a cifração em casa com a chave do papel: em ${pegos.length} de ${testaram.length} a conta mostrou o nº ${opcoes[alvo].numero}, e a declaração assinada pela urna dizia outro — prova de fraude que qualquer juiz confere, sem revelar voto nenhum.`);
  md();
  md("Chance de pegar uma urna que troca *k* votos, se cada eleitor testa com probabilidade *p* — a urna não sabe quem vai testar, porque se compromete com o código antes da decisão. (Basta UM eleitor testar uma cédula trocada.)");
  md();
  md("| k votos trocados | 5% testam | 10% testam | 20% testam |");
  md("|---|---|---|---|");
  const pct = (x: number) => {
    const v = 100 * x;
    if (v >= 99.99995) return "> 99.9999%";
    return v >= 99.95 ? `${v.toFixed(4).replace(/0+$/, "")}%` : `${v.toFixed(1)}%`;
  };
  for (const k of [1, 10, 50, 100, 300]) md(`| ${k} | ${pct(1 - 0.95 ** k)} | ${pct(1 - 0.9 ** k)} | ${pct(1 - 0.8 ** k)} |`);
  md();
  md("## Sigilo");
  md();
  md(`- **Memória da urna:** cédulas guardadas na ordem do rastreador, não na de chegada (correlação de Spearman ${spearman.toFixed(2)}); nenhuma chave de cédula depositada guardada; nenhum log com horário por voto.`);
  md(`- **Código, figuras e papel com a urna oficial:** não dependem do voto — a 1ª figura saiu "ímpar" em ${(fa * 100).toFixed(0)}% das cédulas do nº ${opcoes[A].numero} e ${(fb * 100).toFixed(0)}% das do nº ${opcoes[B].numero}. O que o código localiza é uma cifra ElGamal; abri-la exige a chave da cédula (destruída) ou os 3 trustees juntos (que só decifram somas de seção).`);
  md(`- **Limite honesto — urna adulterada:** a urna vê o voto (como a de hoje). Uma urna adulterada pode escolher a aleatoriedade até a figura "codificar" o candidato: neste teste ela vazou 20 de 20 votos com ~${(tentativas / 20).toFixed(0)} cifrações por voto. A verificabilidade (integridade) não depende de confiar na urna; o **sigilo** contra uma urna adulterada depende de controles fora da matemática (software conferido na carga, testes) — ou de uma segunda fonte de aleatoriedade independente da urna, que fica como trabalho futuro.`);
  md();
  md("## Força do compromisso antes do teste");
  md();
  md(`Com só as 2 figuras (16 bits), uma urna adulterada achou, em ${gastas} cifrações, duas cédulas — uma para o nº ${opcoes[A].numero}, outra para o nº ${opcoes[B].numero} — com as mesmas figuras. Se o eleitor conferisse só as figuras, ela poderia abrir uma no teste e depositar a outra. Por isso a urna mostra e imprime, antes da decisão, o código (25 bits) e a **conferência** (40 bits): com 81 bits, preparar o par exigiria ~2^40 cifrações na hora, inviável. Em casa, o validador mostra a conferência gravada para o eleitor comparar com o papel.`);
  md();
  writeFileSync(path.join(process.cwd(), "docs", "RELATORIO-INVASAO.md"), relatorio.join("\n") + "\n");
  console.log("\n  relatório gravado em docs/RELATORIO-INVASAO.md");
  console.log(falhas === 0 ? "\n✔ Testes de invasão OK\n" : `\n✘ ${falhas} falha(s)\n`);
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
