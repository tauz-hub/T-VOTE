// Teste de ponta a ponta do protocolo v4 (seção offline), sem servidor nem banco:
// simula uma eleição inteira em memória, roda o auditor, refaz em casa os testes
// dos eleitores e depois aplica adulterações conhecidas para confirmar quem
// detecta cada uma.
//
//   npm run teste
import { type Pacote, auditarPacote, boletimDaSecao, reproduzirTeste, verificarMinhaCedula } from "../lib/auditoria";
import { assinarCedula, calcularNullificador, prepararCedula } from "../lib/crypto/cedula";
import { cifraParaHex } from "../lib/crypto/elgamal";
import { formatarCodigo, formatarConferencia, palavrasDoSelo } from "../lib/crypto/palavras";
import { type Bloco } from "../lib/crypto/quadro";
import { agregarCedulas, assinarDocumentoUrna, codigoBU } from "../lib/crypto/secao";
import { gerarChaveEd25519 } from "../lib/server/chaves";
import { montarEleicao } from "./eleicao-memoria";

let falhas = 0;
function esperar(condicao: boolean, msg: string) {
  console.log(`${condicao ? "  ✔" : "  ✘"} ${msg}`);
  if (!condicao) falhas++;
}

async function main() {
  console.log("\n▶ Eleição simulada em memória (2 seções offline)…");
  const t0 = performance.now();
  const e = montarEleicao({ secoes: [{ zona: 1, secao: 1, eleitores: 8 }, { zona: 1, secao: 2, eleitores: 6 }], taxaTeste: 0.4 });
  const { blocos } = e;
  const cedulas = e.secoes.reduce((n, s) => n + s.cedulas.length, 0);
  const testes = e.lembrancas.filter((l) => l.teste);
  console.log(`  ${blocos.length} blocos, ${cedulas} cédulas, ${testes.length} testes da urna (${(performance.now() - t0).toFixed(0)} ms)`);
  const ex = e.secoes[0].cedulas[0];
  console.log(
    `  o eleitor vê: código ${formatarCodigo(ex.codigo)} · conferência ${formatarConferencia(e.lembrancas.find((l) => l.codigo === ex.codigo)!.conferencia)} · ${palavrasDoSelo(ex.selo).map((f) => `${f.figura} ${f.palavra}`).join("  ")}`,
  );

  const pacote: Pacote = { formato: "t-vote/pacote/v1", exportado_em: new Date().toISOString(), blocos };
  console.log("\n▶ Auditoria da eleição honesta");
  const rel = await auditarPacote(pacote);
  for (const v of rel.verificacoes) console.log(`  ${v.status === "ok" ? "PASS" : v.status.toUpperCase().padEnd(4)}  ${v.titulo}`);
  esperar(rel.aprovado, "eleição honesta aprovada em todas as verificações");
  esperar(JSON.stringify(rel.resultado?.map((r) => r.votos)) === JSON.stringify(e.esperado), `resultado recalculado = votos digitados (${e.esperado.join(", ")})`);

  console.log("\n▶ O eleitor confere em casa");
  const todasAchadas = e.lembrancas.every((l) => {
    const r = verificarMinhaCedula(pacote, l.codigo);
    return r.encontrada && r.figuras?.map((f) => f.palavra).join() === l.figuras.join() && r.conferencia === l.conferencia && r.itens.every((i) => i.status === "ok");
  });
  esperar(todasAchadas, `${e.lembrancas.length} eleitores acham o próprio código, com as mesmas figuras e conferência, contado na apuração`);
  const reproduzidos = testes.every((l) => {
    const r = reproduzirTeste(pacote, l.teste!.codigo, l.teste!.declaracao.semente);
    return r.encontrada && r.indice === l.teste!.opcaoEscolhida && r.seloOk;
  });
  esperar(reproduzidos, `${testes.length} testes refeitos no computador do eleitor com a chave do papel: a cifra refeita = a cédula selada`);
  const naoAbre = reproduzirTeste(pacote, e.lembrancas[0].codigo, e.lembrancas[0].teste?.declaracao.semente ?? "0".repeat(32));
  esperar(!naoAbre.encontrada && /DEPOSITADO/.test(naoAbre.motivo), "a chave de um teste não abre o voto depositado (a chave dele foi destruída)");

  // --------------------------------------------------------------- ataques
  const clonar = (bs: Bloco[] = blocos): Bloco[] => JSON.parse(JSON.stringify(bs));
  const auditar = async (bs: Bloco[]) => {
    const r = await auditarPacote({ ...pacote, blocos: bs });
    return { falhas: new Set(r.verificacoes.filter((v) => v.status === "falha").map((v) => v.id)), avisos: r.avisos };
  };
  const iSecao = blocos.findIndex((b) => b.tipo === "SECAO");
  const secao = (bs: Bloco[]) => (bs[iSecao] as Bloco<"SECAO">).conteudo;
  /** insider com a chave da urna (extraída do hardware) reassina o BU */
  const reassinarBU = (bs: Bloco[]) => {
    const s = secao(bs);
    s.bu = assinarDocumentoUrna(s.bu.conteudo, e.secoes[0].urna.privada);
    const enc = bs.find((b) => b.tipo === "ENCERRAMENTO") as Bloco<"ENCERRAMENTO">;
    const l = enc.conteudo.secoes.find((x) => x.secao === s.secao)!;
    enc.conteudo.total_cedulas += s.bu.conteudo.cedulas.length - l.cedulas;
    l.bu = s.bu.hash;
    l.cedulas = s.bu.conteudo.cedulas.length;
  };
  const ateEncerramento = () => clonar(blocos.slice(0, e.indiceEncerramento + 1));

  console.log("\n▶ Ataques (cada um deve ser detectado — e por quem)");
  {
    const bs = clonar();
    const c = secao(bs).bu.conteudo.cedulas[0];
    [c.escolhas[0], c.escolhas[1]] = [c.escolhas[1], c.escolhas[0]];
    const { falhas: f } = await auditar(bs);
    esperar(f.has("cadeia") && f.has("assinaturas_cedulas"), `banco: trocar um voto → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    const c = secao(bs).bu.conteudo.cedulas[0];
    [c.escolhas[0], c.escolhas[1]] = [c.escolhas[1], c.escolhas[0]];
    e.reencadear(bs, iSecao, false);
    const { falhas: f } = await auditar(bs);
    esperar(!f.has("cadeia") && f.has("assinaturas_blocos"), `banco: trocar voto e recalcular hashes → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    secao(bs).bu.conteudo.cedulas.splice(0, 1);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("midias"), `TSE (chave do quadro): sumir com uma cédula do BU → ${[...f].join(", ")}`);
  }
  {
    // TSE + chaves extraídas da urna e da mesa: reescreve a seção inteira ANTES da apuração
    const bs = ateEncerramento();
    const s = secao(bs);
    const sm = e.secoes[0];
    const alvo = 0;
    const quantas = s.bu.conteudo.cedulas.length;
    s.bu.conteudo.cedulas = Array.from({ length: quantas }, () => {
      const cred = e.credencial(sm);
      const p = prepararCedula(sm.ctx, cred.chave, alvo);
      return { ...assinarCedula(p, sm.ctx.hashEleicao, cred, cred.privada), rastreador: p.rastreador, nullificador: calcularNullificador(cred.chave), ...e.selar(sm, p.rastreador) };
    }).sort((x, y) => (x.rastreador < y.rastreador ? -1 : 1));
    s.bu.conteudo.contagem = s.bu.conteudo.contagem.map((x) => ({ ...x, votos: x.opcao === alvo ? quantas : 0 }));
    s.bu.conteudo.agregado = agregarCedulas(s.bu.conteudo.cedulas, e.opcoes.length).map(cifraParaHex);
    reassinarBU(bs);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    const p2: Pacote = { ...pacote, blocos: bs };
    const eleitor = e.lembrancas.find((l) => l.secao === s.secao)!;
    const achou = verificarMinhaCedula(p2, eleitor.codigo);
    const bu = boletimDaSecao(p2, s.secao);
    esperar(f.size === 0, `TSE + hardware: reescrever a seção → o auditor matemático NÃO percebe (falhas: ${[...f].join(", ") || "nenhuma"}) — esperado`);
    esperar(
      !achou.encontrada && achou.situacaoSecao === "transmitida",
      "   …mas o ELEITOR percebe: o código do comprovante sumiu da seção transmitida",
    );
    esperar(
      bu.encontrada && bu.codigo !== codigoBU(e.secoes[0].buImpresso!),
      `   …e o BU da porta da escola percebe: código impresso ${codigoBU(e.secoes[0].buImpresso!)} ≠ publicado ${bu.encontrada ? bu.codigo : "?"}`,
    );
  }
  {
    const bs = clonar();
    const s = secao(bs);
    (s.bu.conteudo as unknown as { cedulas: Record<string, unknown>[] }).cedulas = s.bu.conteudo.cedulas.reverse().map((c, i) => ({ ...c, horario: `08:0${i}:00` }));
    reassinarBU(bs);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("sigilo"), `ordem de chegada com horário no BU (TPS 2012) → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    const s = secao(bs);
    const sm = e.secoes[0];
    const cred = e.credencial(sm);
    const p = prepararCedula(sm.ctx, cred.chave, 0);
    s.bu.conteudo.cedulas.push({ ...assinarCedula(p, sm.ctx.hashEleicao, cred, cred.privada), rastreador: p.rastreador, nullificador: calcularNullificador(cred.chave), ...e.selar(sm, p.rastreador) });
    s.bu.conteudo.cedulas.sort((x, y) => (x.rastreador < y.rastreador ? -1 : 1));
    s.bu.conteudo.contagem[0].votos++;
    s.bu.conteudo.agregado = agregarCedulas(s.bu.conteudo.cedulas, e.opcoes.length).map(cifraParaHex);
    reassinarBU(bs);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("comparecimento"), `cédula extra com credencial da mesa forjada → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    const [a, b] = secao(bs).bu.conteudo.cedulas;
    [a.figuras, b.figuras] = [b.figuras, a.figuras];
    reassinarBU(bs);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("verificacao"), `trocar as figuras gravadas no BU → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    const c = secao(bs).bu.conteudo.cedulas[0];
    c.codigo = "0019999" + c.codigo.slice(7);
    reassinarBU(bs);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("verificacao"), `trocar a seção no código de verificação → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    const cont = secao(bs).bu.conteudo.contagem;
    const doador = cont.find((x) => x.votos > 0)!;
    doador.votos--;
    cont.find((x) => x.opcao !== doador.opcao)!.votos++;
    reassinarBU(bs);
    e.reencadear(bs, iSecao, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("bu_papel"), `BU impresso com números falsos (cifras intactas) → ${[...f].join(", ")}`);
  }
  {
    const bs = clonar();
    const res = bs.at(-1) as Bloco<"RESULTADO">;
    res.conteudo.contagem[0].votos += 1;
    res.conteudo.contagem[1].votos -= 1;
    e.reencadear(bs, bs.length - 1, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("resultado"), `alterar o resultado publicado → ${[...f].join(", ")}`);
  }
  {
    // nova carga da seção DEPOIS da mídia: tentar trocar a chave da urna
    const bs = clonar();
    const carga = JSON.parse(JSON.stringify(bs.find((b) => b.tipo === "CARGA")!.conteudo));
    carga.chave_urna = gerarChaveEd25519().publica;
    bs.splice(e.indiceEncerramento, 0, { ...bs[e.indiceEncerramento], tipo: "CARGA", conteudo: carga } as Bloco);
    e.reencadear(bs, e.indiceEncerramento, true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("cargas"), `trocar a chave da urna depois da mídia → ${[...f].join(", ")}`);
  }
  {
    // a mesma chave em duas urnas (TPS 2017: chave única em todas as urnas)
    const bs = clonar();
    const cargas = bs.filter((b) => b.tipo === "CARGA") as Bloco<"CARGA">[];
    cargas[1].conteudo.chave_urna = cargas[0].conteudo.chave_urna;
    e.reencadear(bs, bs.indexOf(cargas[1]), true);
    const { falhas: f } = await auditar(bs);
    esperar(f.has("cargas"), `mesma chave em duas urnas (TPS 2017) → ${[...f].join(", ")}`);
  }
  {
    // sumir com uma seção inteira antes da apuração, ajustando o encerramento
    const bs = ateEncerramento();
    const s = secao(bs);
    bs.splice(iSecao, 1);
    const enc = bs.at(-1) as Bloco<"ENCERRAMENTO">;
    enc.conteudo.secoes = enc.conteudo.secoes.filter((x) => x.secao !== s.secao);
    enc.conteudo.secoes_sem_midia = [s.secao];
    enc.conteudo.total_cedulas -= s.bu.conteudo.cedulas.length;
    enc.conteudo.total_desafiadas -= s.bu.conteudo.desafiadas.length;
    e.reencadear(bs, iSecao, true);
    const { falhas: f, avisos } = await auditar(bs);
    const p2: Pacote = { ...pacote, blocos: bs };
    const eleitor = e.lembrancas.find((l) => l.secao === s.secao)!;
    const r = verificarMinhaCedula(p2, eleitor.codigo);
    esperar(f.size === 0 && avisos.some((a) => a.includes(s.secao)), `TSE some com a seção ${s.secao} → auditor só AVISA (sem mídia) — esperado`);
    esperar(!r.encontrada && r.situacaoSecao === "aguardando_midia", "   …e o eleitor vê que a mídia da sua seção nunca chegou (o BU em papel existe)");
  }

  console.log("\n▶ Urna adulterada na instalação (desvia votos e mente no teste)");
  {
    const alvo = 0;
    const m = montarEleicao({ secoes: [{ zona: 9, secao: 9, eleitores: 12, adulterada: { alvo, percentual: 100 } }], taxaTeste: 0.5 });
    const p: Pacote = { formato: "t-vote/pacote/v1", exportado_em: new Date().toISOString(), blocos: m.blocos };
    const r = await auditarPacote(p);
    esperar(r.aprovado, "a auditoria matemática PASSA (a urna conta no BU o que cifrou) — esperado: matemática não vê intenção");
    const testes = m.lembrancas.filter((l) => l.teste);
    const pegos = testes.filter((l) => {
      const rep = reproduzirTeste(p, l.teste!.codigo, l.teste!.declaracao.semente);
      return rep.encontrada && rep.indice === alvo && l.teste!.declaracao.opcao === l.teste!.opcaoEscolhida && rep.indice !== l.teste!.opcaoEscolhida;
    });
    esperar(testes.length > 0 && pegos.length === testes.length, `todos os ${testes.length} eleitores que testaram pegam a fraude em casa: a chave do papel reproduz o nº ${m.opcoes[alvo].numero}, a urna declarou outro`);
  }

  console.log(falhas === 0 ? "\n✔ Protocolo OK\n" : `\n✘ ${falhas} falha(s)\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
