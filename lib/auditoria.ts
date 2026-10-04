// Auditor independente. Recebe SOMENTE o pacote público (a cadeia de blocos)
// e refaz todas as verificações matemáticas, sem confiar no servidor, no banco
// de dados, no TSE ou nas urnas. Roda no navegador (/auditoria), na linha de
// comando (npm run auditar) e no validador offline (validador.html).
//
// v4 — seção offline: cada seção chega como uma mídia (zerésima + BU) assinada
// pela chave da urna, registrada na carga antes do primeiro voto.
import { chavesExatas, ehHex } from "./crypto/codificacao";
import {
  CHAVES_CEDULA_DESAFIADA,
  CHAVES_CEDULA_PUBLICADA,
  type CedulaDesafiada,
  type CedulaPublicada,
  type ContextoCedula,
  calcularNullificador,
  calcularRastreador,
  cifrarComSemente,
  verificarCedula,
  verificarDesafiada,
} from "./crypto/cedula";
import { type CifraPontos, cifraParaHex, combinarChaves, logDiscretoPequeno } from "./crypto/elgamal";
import { G, IDENTIDADE, pontoDeHex, pontoHex } from "./crypto/grupo";
import { type Figura, codigoVerificacao, conferenciaDoSelo, figuraDaPalavra, lerCodigo, nomesDasFiguras } from "./crypto/palavras";
import { verificarConhecimento, verificarIgualdadeLog } from "./crypto/provas";
import {
  type Bloco,
  type Contagem,
  type ConteudoAbertura,
  type ConteudoCarga,
  type ConteudoChaveTrustee,
  type ConteudoDecriptacao,
  type ConteudoEncerramento,
  type ConteudoGenese,
  type ConteudoResultado,
  type ConteudoSecao,
  HASH_INICIAL,
  NUM_TRUSTEES,
  type Opcao,
  VERSAO_PROTOCOLO,
  calcularHashEleicao,
  contextoDecriptacao,
  contextoTrustee,
  hashBloco,
  verificarAssinaturaHash,
  verificarSelo,
} from "./crypto/quadro";
import {
  type BoletimUrna,
  CHAVES_BU,
  CHAVES_ZERESIMA,
  type DeclaracaoTeste,
  type DocumentoUrna,
  type ZeresimaSecao,
  agregarCedulas,
  codigoBU,
  somarContagens,
  verificarDeclaracaoTeste,
  verificarDocumentoUrna,
} from "./crypto/secao";

export { agregarCedulas } from "./crypto/secao";

export type Pacote = { formato: "t-vote/pacote/v1"; exportado_em: string; blocos: Bloco[] };

export type Fase = "vazia" | "configuracao" | "aberta" | "encerrada" | "apurada";
export type StatusVerificacao = "ok" | "falha" | "pendente";

export type Verificacao = {
  id: string;
  titulo: string;
  descricao: string;
  referencia?: string;
  status: StatusVerificacao;
  detalhes: string[];
};

/** Resumo de cada seção como o eleitor a reconhece: o BU da porta da escola. */
export type ResumoSecao = {
  secao: string;
  urna: string;
  bloco: number;
  bu: string;
  comparecimento: number;
  cedulas: number;
  desafiadas: number;
  contagemBU: Contagem;
  contagemApurada?: Contagem;
};

export type RelatorioAuditoria = {
  aprovado: boolean;
  fase: Fase;
  verificacoes: Verificacao[];
  eleicao?: { nome: string; eleicao_id: string; hash_eleicao?: string; opcoes: Opcao[] };
  estatisticas: { blocos: number; secoes: number; cedulas: number; desafiadas: number };
  secoes: ResumoSecao[];
  avisos: string[];
  resultado?: { opcao: Opcao; votos: number }[];
};

type Progresso = (feito: number, total: number, etapa: string) => void;
type Falha = (id: string, msg: string) => void;

const DEFINICOES: Omit<Verificacao, "status" | "detalhes">[] = [
  { id: "cadeia", titulo: "Integridade da cadeia de blocos", descricao: "Cada bloco recalcula o próprio hash e aponta para o hash do bloco anterior." },
  {
    id: "assinaturas_blocos",
    titulo: "Assinatura do quadro em cada bloco",
    descricao: "Todo bloco é assinado (Ed25519) pela chave do quadro publicada na gênese.",
    referencia: "Quem altera o banco de dados sem a chave não consegue reassinar a cadeia.",
  },
  {
    id: "genese",
    titulo: "Manifesto da eleição (gênese)",
    descricao: "Opções, chave do quadro e hash do software, na versão 4 do protocolo (seção offline).",
    referencia: "TPS 2017: bibliotecas sem verificação de integridade permitiram injetar código.",
  },
  {
    id: "fases",
    titulo: "Ordem das fases",
    descricao: "Gênese → trustees → abertura → cargas e mídias das seções → encerramento → decifração → resultado.",
  },
  {
    id: "trustees",
    titulo: "Chaves dos trustees",
    descricao: "Três trustees distintos, cada um com prova de conhecimento (Schnorr) da própria chave.",
    referencia: "TPS 2017: chave única embutida no código e compartilhada por todas as urnas.",
  },
  {
    id: "zeresima",
    titulo: "Zerésima nacional e chave conjunta",
    descricao: "Chave da eleição = produto das chaves dos trustees; nenhuma seção recebida na abertura.",
    referencia: "Hursti (2005): contagens pré-carregadas que a zerésima em papel não revelava.",
  },
  {
    id: "cargas",
    titulo: "Carga das urnas",
    descricao: "Cada urna tem chave própria, gerada dentro dela e publicada antes do primeiro voto; nenhuma chave repetida; software = gênese.",
    referencia: "TPS 2017: a mesma chave estava em todas as urnas do país.",
  },
  {
    id: "midias",
    titulo: "Mídias das seções assinadas pela urna",
    descricao: "Zerésima zerada e BU assinados pela chave da urna registrada na carga; o BU aponta para a zerésima; uma mídia por seção.",
    referencia: "Quem tem só a chave do quadro (TSE) não consegue trocar o conteúdo de uma seção.",
  },
  {
    id: "sigilo",
    titulo: "Cédulas sem ordem de chegada e sem horário",
    descricao: "No BU as cédulas estão ordenadas pelo rastreador, sem nenhum campo de horário ou sequência.",
    referencia: "TPS 2012: a ordem dos votos foi reconstruída a partir do horário usado como semente do embaralhamento.",
  },
  { id: "credenciais", titulo: "Credenciais anônimas válidas", descricao: "Cada cédula traz uma credencial com assinatura cega válida da mesa da sua seção." },
  { id: "assinaturas_cedulas", titulo: "Assinatura de cada cédula", descricao: "A cédula está assinada pela chave efêmera da própria credencial." },
  {
    id: "provas",
    titulo: "Provas de conhecimento zero",
    descricao: "Cada opção cifra 0 ou 1 e a soma da cédula é exatamente 1 — sem revelar o voto.",
    referencia: "Helios 2012 / Swiss Post 2019: provas mal construídas permitiam forjar votos.",
  },
  { id: "rastreadores", titulo: "Rastreadores e nullificadores", descricao: "Rastreador = hash das cifras; nullificador = hash da credencial. Ambos recalculados." },
  {
    id: "verificacao",
    titulo: "Código e figuras de verificação",
    descricao: "Selo da urna válido sobre (cédula, seção); código = zona + seção + parte do selo; figuras = as do selo; códigos únicos.",
    referencia: "É exatamente o que a urna mostrou ao eleitor e o que ele confere com o comprovante impresso.",
  },
  { id: "duplicidade", titulo: "Uma credencial, um voto", descricao: "Nenhum nullificador aparece duas vezes." },
  { id: "desafiadas", titulo: "Cédulas de teste (auditoria da urna)", descricao: "Com a aleatoriedade revelada, a cifração refeita bate exatamente com a opção aberta." },
  {
    id: "comparecimento",
    titulo: "Cédulas × comparecimento",
    descricao: "Em cada seção: cédulas ≤ credenciais emitidas pela mesa; a contagem do BU soma exatamente o número de cédulas.",
    referencia: "Detecta cédulas extras mesmo quando são criptograficamente válidas.",
  },
  { id: "agregado", titulo: "Soma homomórfica por seção", descricao: "O agregado de cada BU é exatamente o produto das cifras das cédulas daquela seção." },
  {
    id: "encerramento",
    titulo: "Encerramento",
    descricao: "O encerramento lista exatamente as mídias recebidas e as seções carregadas que não transmitiram.",
    referencia: "Uma seção que some não some do papel: o BU dela continua colado na porta da escola.",
  },
  {
    id: "decriptacao",
    titulo: "Decifração parcial dos trustees",
    descricao: "Cada trustee prova (Chaum-Pedersen), seção por seção, que decifrou o agregado com a sua chave — e nada além dele.",
  },
  {
    id: "bu_papel",
    titulo: "BU impresso = apuração criptográfica",
    descricao: "A contagem que cada urna imprimiu no BU é igual à decifração do agregado daquela seção.",
    referencia: "Mostra se a contagem impressa e as cifras contam a mesma coisa.",
  },
  { id: "resultado", titulo: "Resultado final", descricao: "O resultado publicado (por seção e total) é exatamente o que a combinação das decifrações produz." },
];

const pausa = () => new Promise((r) => setTimeout(r, 0));

export type Nacional = { eleicaoId: string; hashEleicao: string; chavePublica: string; nOpcoes: number; opcoes: Opcao[] };

/** Contexto nacional da eleição aberta (gênese + abertura). */
export function nacionalDosBlocos(blocos: Bloco[]): Nacional | null {
  const genese = blocos.find((b) => b.tipo === "GENESE") as Bloco<"GENESE"> | undefined;
  const abertura = blocos.find((b) => b.tipo === "ABERTURA") as Bloco<"ABERTURA"> | undefined;
  if (!genese || !abertura) return null;
  return {
    eleicaoId: genese.conteudo.eleicao_id,
    hashEleicao: abertura.conteudo.hash_eleicao,
    chavePublica: abertura.conteudo.chave_publica_conjunta,
    nOpcoes: genese.conteudo.opcoes.length,
    opcoes: genese.conteudo.opcoes,
  };
}

/** Contexto de cédula de uma seção: a credencial é da mesa daquela seção. */
export function contextoDaSecao(n: Nacional, carga: ConteudoCarga): ContextoCedula {
  return { eleicaoId: n.eleicaoId, hashEleicao: n.hashEleicao, chavePublica: n.chavePublica, nOpcoes: n.nOpcoes, autoridade: carga.autoridade_secao };
}

/** Carga vigente de cada seção: a última publicada antes da mídia (ou a última, se ainda não há mídia). */
export function cargasDosBlocos(blocos: Bloco[]): Map<string, { carga: ConteudoCarga; bloco: number }> {
  const cargas = new Map<string, { carga: ConteudoCarga; bloco: number }>();
  const comMidia = new Set<string>();
  for (const b of blocos) {
    if (b.tipo === "SECAO") comMidia.add((b.conteudo as ConteudoSecao).secao);
    if (b.tipo === "CARGA") {
      const c = b.conteudo as ConteudoCarga;
      if (!comMidia.has(c.secao)) cargas.set(c.secao, { carga: c, bloco: b.numero });
    }
  }
  return cargas;
}

export function secoesDosBlocos(blocos: Bloco[]): Bloco<"SECAO">[] {
  return blocos.filter((b) => b.tipo === "SECAO") as Bloco<"SECAO">[];
}

/** Combina as decifrações parciais: g^m = B / (D_A · D_B · D_C), e resolve m. */
export function combinarDecifracoes(agregado: CifraPontos[], parciais: { d: string }[][], maximo: number): (number | null)[] {
  return agregado.map((c, j) => {
    const soma = parciais.reduce((acc, p) => acc.add(pontoDeHex(p[j].d)), IDENTIDADE);
    return logDiscretoPequeno(c.b.subtract(soma), maximo);
  });
}

const mesmaChaveRSA = (a: { n: string; e: string } | undefined, b: { n: string; e: string } | undefined) => !!a && !!b && a.n === b.n && a.e === b.e;

/** Selo, código e figuras gravados no BU: exatamente o que a urna mostrou ao eleitor. */
function verificacaoConfere(
  c: { rastreador: string; secao?: string; selo?: string; codigo?: string; figuras?: string[] },
  n: Nacional,
  carga: ConteudoCarga,
): string | null {
  if (c.secao !== carga.secao) return "seção da cédula diferente da seção da urna";
  if (!verificarSelo(n.hashEleicao, c.rastreador, carga.secao, c.selo ?? "", carga.chave_urna)) return "selo da urna inválido para esta cédula";
  if (c.codigo !== codigoVerificacao(carga.secao, c.selo!)) return "código de verificação não confere com o selo";
  const figuras = nomesDasFiguras(c.selo!);
  if (!Array.isArray(c.figuras) || c.figuras.join("|") !== figuras.join("|"))
    return `figuras registradas não são as do selo (${c.figuras?.join(", ")} ≠ ${figuras.join(", ")})`;
  return null;
}

/**
 * Confere uma mídia de seção inteira contra a carga da urna. Usada pelo auditor
 * e pelo TSE ao receber a mídia (que recusa mídia inválida).
 */
export async function conferirMidiaSecao(
  midia: { zeresima: DocumentoUrna<ZeresimaSecao>; bu: DocumentoUrna<BoletimUrna> },
  carga: ConteudoCarga,
  n: Nacional,
  falha: Falha,
  aoProgredir?: (feitas: number) => Promise<void> | void,
): Promise<{ cedulas: CedulaPublicada[]; desafiadas: CedulaDesafiada[]; ok: boolean }> {
  let ok = true;
  const f: Falha = (id, msg) => {
    ok = false;
    falha(id, `seção ${carga.secao}: ${msg}`);
  };
  const vazio = { cedulas: [] as CedulaPublicada[], desafiadas: [] as CedulaDesafiada[] };
  const z = midia?.zeresima;
  const bu = midia?.bu;
  if (!z?.conteudo || !bu?.conteudo) {
    f("midias", "mídia sem zerésima ou sem BU");
    return { ...vazio, ok };
  }
  // zerésima
  const zc = z.conteudo;
  if (!chavesExatas(zc, CHAVES_ZERESIMA)) f("midias", "zerésima com campos inesperados");
  if (zc.tipo !== "ZERESIMA" || zc.eleicao !== n.hashEleicao || zc.secao !== carga.secao) f("midias", "zerésima de outra eleição ou seção");
  if (zc.chave_urna !== carga.chave_urna || !mesmaChaveRSA(zc.autoridade_secao, carga.autoridade_secao))
    f("midias", "chaves da zerésima diferentes das publicadas na carga (urna trocada?)");
  if (zc.cedulas !== 0) f("midias", "a zerésima não está zerada");
  if (!verificarDocumentoUrna(z, carga.chave_urna)) f("midias", "zerésima sem assinatura válida da urna");
  // BU
  const b = bu.conteudo;
  if (!chavesExatas(b, CHAVES_BU)) f("sigilo", "BU com campos inesperados (horário? sequência?)");
  if (b.tipo !== "BU" || b.eleicao !== n.hashEleicao || b.secao !== carga.secao) f("midias", "BU de outra eleição ou seção");
  if (b.zeresima !== z.hash) f("midias", "BU não aponta para a zerésima desta seção");
  if (!verificarDocumentoUrna(bu, carga.chave_urna)) f("midias", "BU sem assinatura válida da urna (conteúdo trocado depois do encerramento?)");
  const cedulas = Array.isArray(b.cedulas) ? b.cedulas : [];
  const desafiadas = Array.isArray(b.desafiadas) ? b.desafiadas : [];

  // sigilo: ordem canônica, sem campos extras
  for (const lista of [cedulas, desafiadas] as { rastreador: string }[][]) {
    for (let k = 1; k < lista.length; k++) {
      if (!(lista[k - 1].rastreador < lista[k].rastreador)) {
        f("sigilo", "cédulas fora da ordem de rastreador (possível ordem de chegada)");
        break;
      }
    }
  }
  for (const c of cedulas)
    if (!chavesExatas(c, CHAVES_CEDULA_PUBLICADA)) f("sigilo", `cédula ${String(c.rastreador).slice(0, 12)}… com campos extras (horário?)`);
  for (const d of desafiadas) if (!chavesExatas(d, CHAVES_CEDULA_DESAFIADA)) f("sigilo", "cédula de teste com campos extras");

  const ctx = contextoDaSecao(n, carga);
  const nullificadores = new Set<string>();
  const rastreadores = new Set<string>();
  const codigos = new Set<string>();
  let feitas = 0;
  for (const c of cedulas) {
    const id = `cédula ${String(c.rastreador).slice(0, 12)}…`;
    const r = verificarCedula(c, ctx);
    if (!r.formato) f("provas", `${id}: ${r.erros.join("; ")}`);
    else {
      if (!r.credencial) f("credenciais", `${id}: credencial sem assinatura cega válida da mesa desta seção`);
      if (!r.assinatura) f("assinaturas_cedulas", `${id}: assinatura inválida`);
      if (!r.provas || !r.soma) f("provas", `${id}: ${r.erros.join("; ")}`);
    }
    try {
      if (calcularRastreador(n.hashEleicao, c.escolhas) !== c.rastreador) f("rastreadores", `${id}: rastreador não confere`);
      if (calcularNullificador(c.credencial.chave) !== c.nullificador) f("rastreadores", `${id}: nullificador não confere`);
      const v = verificacaoConfere(c, n, carga);
      if (v) f("verificacao", `${id}: ${v}`);
      if (codigos.has(c.codigo)) f("verificacao", `${id}: código de verificação repetido`);
      codigos.add(c.codigo);
      if (nullificadores.has(c.nullificador)) f("duplicidade", `${id}: credencial já usada em outra cédula (voto duplo)`);
      nullificadores.add(c.nullificador);
      if (rastreadores.has(c.rastreador)) f("rastreadores", `${id}: rastreador repetido`);
      rastreadores.add(c.rastreador);
    } catch {
      f("rastreadores", `${id}: cédula malformada`);
    }
    if (++feitas % 4 === 0) await aoProgredir?.(feitas);
  }
  for (const d of desafiadas) {
    const id = `cédula de teste ${String(d.rastreador).slice(0, 12)}…`;
    const r = verificarDesafiada(d, ctx);
    if (!r.ok) f("desafiadas", `${id}: ${r.erros.join("; ")}`);
    if (rastreadores.has(d.rastreador)) f("rastreadores", `${id}: mesmo rastreador de uma cédula depositada`);
    const v = verificacaoConfere(d, n, carga);
    if (v) f("verificacao", `${id}: ${v}`);
    if (d.codigo && codigos.has(d.codigo)) f("verificacao", `${id}: código de verificação repetido`);
    if (d.codigo) codigos.add(d.codigo);
    if (++feitas % 4 === 0) await aoProgredir?.(feitas);
  }

  // comparecimento e contagem impressa
  if (!Number.isInteger(b.comparecimento) || cedulas.length > b.comparecimento)
    f("comparecimento", `${cedulas.length} cédulas para ${b.comparecimento} eleitores que compareceram`);
  const contagemOk =
    Array.isArray(b.contagem) &&
    b.contagem.length === n.nOpcoes &&
    b.contagem.every((x, i) => x?.opcao === i && Number.isInteger(x.votos) && x.votos >= 0);
  if (!contagemOk) f("comparecimento", "contagem do BU malformada");
  else {
    const soma = b.contagem.reduce((s, x) => s + x.votos, 0);
    if (soma !== cedulas.length) f("comparecimento", `a contagem impressa soma ${soma} votos, mas o BU tem ${cedulas.length} cédulas`);
  }
  // soma homomórfica
  try {
    const agregado = agregarCedulas(cedulas, n.nOpcoes).map(cifraParaHex);
    if (!Array.isArray(b.agregado) || b.agregado.length !== agregado.length || b.agregado.some((x, i) => x.a !== agregado[i].a || x.b !== agregado[i].b))
      f("agregado", "agregado do BU ≠ soma das cédulas da seção");
  } catch {
    f("agregado", "cifras malformadas no BU");
  }
  return { cedulas, desafiadas, ok };
}

function determinarFase(blocos: Bloco[]): Fase {
  if (blocos.length === 0) return "vazia";
  const tipos = new Set(blocos.map((b) => b.tipo));
  if (tipos.has("RESULTADO")) return "apurada";
  if (tipos.has("ENCERRAMENTO")) return "encerrada";
  if (tipos.has("ABERTURA")) return "aberta";
  return "configuracao";
}

/** Confere as decifrações parciais de uma seção e combina; null se faltar algo ou alguma prova falhar. */
function apurarSecao(
  secao: string,
  agregado: CifraPontos[],
  parciais: ConteudoDecriptacao[],
  trustees: ConteudoChaveTrustee[],
  hashEleicao: string,
  maximo: number,
  falha?: Falha,
): Contagem | null {
  const validas: { d: string }[][] = [];
  for (const p of parciais) {
    const t = trustees.find((x) => x.trustee === p.trustee);
    const s = Array.isArray(p.secoes) ? p.secoes.find((x) => x.secao === secao) : undefined;
    if (!t || !s || !Array.isArray(s.parciais) || s.parciais.length !== agregado.length) {
      falha?.("decriptacao", `trustee ${p.trustee}: decifração da seção ${secao} ausente ou malformada`);
      return null;
    }
    const hi = pontoDeHex(t.chave_publica);
    const todas = s.parciais.every((par, j) => {
      try {
        return verificarIgualdadeLog(G, hi, agregado[j].a, pontoDeHex(par.d), par.prova, contextoDecriptacao(hashEleicao, secao, p.trustee, j));
      } catch {
        return false;
      }
    });
    if (!todas) {
      falha?.("decriptacao", `trustee ${p.trustee}, seção ${secao}: prova de decifração inválida`);
      return null;
    }
    validas.push(s.parciais);
  }
  if (validas.length !== NUM_TRUSTEES) return null;
  const m = combinarDecifracoes(agregado, validas, maximo);
  if (m.some((x) => x === null)) {
    falha?.("resultado", `seção ${secao}: a combinação das decifrações não produz contagem válida`);
    return null;
  }
  return m.map((votos, opcao) => ({ opcao, votos: votos! }));
}

const textoContagem = (c: Contagem, opcoes: Opcao[]) =>
  c
    .filter((x) => x.votos > 0)
    .map((x) => `${opcoes[x.opcao]?.numero ?? opcoes[x.opcao]?.nome ?? x.opcao}: ${x.votos}`)
    .join(", ") || "nenhum voto";

export async function auditarPacote(pacote: Pacote, aoProgredir?: Progresso): Promise<RelatorioAuditoria> {
  const vs = new Map<string, Verificacao>(DEFINICOES.map((d) => [d.id, { ...d, status: "pendente", detalhes: [] }]));
  const falha: Falha = (id, msg) => {
    const v = vs.get(id)!;
    v.status = "falha";
    if (v.detalhes.length < 12) v.detalhes.push(msg);
    else if (v.detalhes.length === 12) v.detalhes.push("… (mais falhas omitidas)");
  };
  const aprovar = (id: string, msg?: string) => {
    const v = vs.get(id)!;
    if (v.status === "falha") return;
    v.status = "ok";
    if (msg) v.detalhes.push(msg);
  };

  const blocos = Array.isArray(pacote?.blocos) ? pacote.blocos : [];
  const fase = determinarFase(blocos);
  const blocosSecao = secoesDosBlocos(blocos);
  const relatorio: RelatorioAuditoria = {
    aprovado: false,
    fase,
    verificacoes: [],
    estatisticas: { blocos: blocos.length, secoes: blocosSecao.length, cedulas: 0, desafiadas: 0 },
    secoes: [],
    avisos: [],
  };
  const finalizar = () => {
    relatorio.verificacoes = [...vs.values()];
    relatorio.aprovado = blocos.length > 0 && relatorio.verificacoes.every((v) => v.status !== "falha");
    return relatorio;
  };
  if (blocos.length === 0) return finalizar();

  // 1. Cadeia de hashes ------------------------------------------------------
  aoProgredir?.(0, 1, "cadeia de blocos");
  blocos.forEach((b, i) => {
    if (b.numero !== i + 1) falha("cadeia", `bloco na posição ${i + 1} tem número ${b.numero}`);
    const anterior = i === 0 ? HASH_INICIAL : blocos[i - 1].hash;
    if (b.hash_anterior !== anterior) falha("cadeia", `bloco ${b.numero}: hash_anterior não aponta para o bloco ${i}`);
    if (hashBloco(b) !== b.hash) falha("cadeia", `bloco ${b.numero}: conteúdo não corresponde ao hash (adulterado)`);
  });
  aprovar("cadeia", `${blocos.length} blocos encadeados; cabeça ${blocos[blocos.length - 1].hash.slice(0, 16)}…`);

  // 2. Gênese ----------------------------------------------------------------
  const genese = blocos[0] as Bloco<"GENESE">;
  const g = genese.conteudo as ConteudoGenese;
  const geneseOk =
    genese.tipo === "GENESE" &&
    typeof g?.eleicao_id === "string" &&
    Array.isArray(g.opcoes) &&
    g.opcoes.length >= 2 &&
    g.opcoes.every((o) => typeof o?.nome === "string" && (o.foto === undefined || ehHex(o.foto, 32))) &&
    g.grupo === "ristretto255" &&
    g.trustees_necessarios === NUM_TRUSTEES &&
    ehHex(g.chave_quadro, 32) &&
    ehHex(g.software?.hash, 32);
  if (!geneseOk) {
    falha("genese", "primeiro bloco não é uma gênese válida");
    return finalizar();
  }
  if (g.versao_protocolo !== VERSAO_PROTOCOLO) {
    falha("genese", `versão do protocolo ${g.versao_protocolo ?? 1} não suportada (atual: ${VERSAO_PROTOCOLO}) — eleição criada por uma versão antiga do sistema`);
    return finalizar();
  }
  aprovar("genese", `"${g.nome}" — ${g.opcoes.length} opções, software ${g.software.hash.slice(0, 16)}…`);
  relatorio.eleicao = { nome: g.nome, eleicao_id: g.eleicao_id, opcoes: g.opcoes };

  // 3. Assinaturas dos blocos --------------------------------------------------
  for (const b of blocos) {
    if (!verificarAssinaturaHash(b.hash, b.assinatura, g.chave_quadro)) falha("assinaturas_blocos", `bloco ${b.numero} (${b.tipo}): assinatura do quadro inválida`);
  }
  aprovar("assinaturas_blocos", `${blocos.length} assinaturas verificadas com a chave ${g.chave_quadro.slice(0, 16)}…`);

  // 4. Ordem das fases ---------------------------------------------------------
  const ordem: Record<string, number> = { GENESE: 0, CHAVE_TRUSTEE: 1, ABERTURA: 2, CARGA: 3, SECAO: 3, ENCERRAMENTO: 4, DECRIPTACAO_PARCIAL: 5, RESULTADO: 6 };
  let ultimo = -1;
  const contagemTipos: Record<string, number> = {};
  for (const b of blocos) {
    const o = ordem[b.tipo];
    if (o === undefined) falha("fases", `bloco ${b.numero}: tipo desconhecido ${b.tipo}`);
    else if (o < ultimo) falha("fases", `bloco ${b.numero} (${b.tipo}) fora de ordem`);
    else ultimo = o;
    contagemTipos[b.tipo] = (contagemTipos[b.tipo] ?? 0) + 1;
  }
  for (const t of ["GENESE", "ABERTURA", "ENCERRAMENTO", "RESULTADO"]) if ((contagemTipos[t] ?? 0) > 1) falha("fases", `${t} aparece mais de uma vez`);
  if (contagemTipos.ABERTURA && contagemTipos.CHAVE_TRUSTEE !== NUM_TRUSTEES) falha("fases", "eleição aberta sem exatamente 3 chaves de trustee");
  if ((contagemTipos.DECRIPTACAO_PARCIAL ?? 0) > NUM_TRUSTEES) falha("fases", "mais decifrações parciais que trustees");
  if (contagemTipos.RESULTADO && contagemTipos.DECRIPTACAO_PARCIAL !== NUM_TRUSTEES) falha("fases", "resultado publicado sem as 3 decifrações parciais");
  aprovar("fases", `fase atual: ${fase}`);

  // 5. Trustees ---------------------------------------------------------------
  const trustees = blocos.filter((b) => b.tipo === "CHAVE_TRUSTEE").map((b) => b.conteudo as ConteudoChaveTrustee);
  const vistos = new Set<number>();
  for (const t of trustees) {
    if (![1, 2, 3].includes(t.trustee) || vistos.has(t.trustee)) falha("trustees", `trustee ${t.trustee} inválido ou repetido`);
    vistos.add(t.trustee);
    let ok = false;
    try {
      ok = verificarConhecimento(pontoDeHex(t.chave_publica), t.prova, contextoTrustee(g.eleicao_id, t.trustee));
    } catch {
      ok = false;
    }
    if (!ok) falha("trustees", `trustee ${t.trustee}: prova de conhecimento da chave inválida`);
  }
  if (trustees.length > 0) aprovar("trustees", `${trustees.length} de ${NUM_TRUSTEES} chaves com prova Schnorr válida`);

  // 6. Abertura -----------------------------------------------------------------
  const blocoAbertura = blocos.find((b) => b.tipo === "ABERTURA") as Bloco<"ABERTURA"> | undefined;
  if (!blocoAbertura) return finalizar();
  const ab = blocoAbertura.conteudo as ConteudoAbertura;
  try {
    const conjunta = pontoHex(combinarChaves(trustees.map((t) => pontoDeHex(t.chave_publica))));
    if (conjunta !== ab.chave_publica_conjunta) falha("zeresima", "chave conjunta ≠ produto das chaves dos trustees");
    if (calcularHashEleicao(genese.hash, trustees, ab.chave_publica_conjunta) !== ab.hash_eleicao) falha("zeresima", "hash da eleição não confere com gênese + trustees");
  } catch {
    falha("zeresima", "chaves malformadas");
  }
  if (ab.zeresima?.secoes_recebidas !== 0) falha("zeresima", "a zerésima nacional não está zerada");
  aprovar("zeresima", `hash da eleição ${ab.hash_eleicao.slice(0, 16)}… — nenhuma seção na abertura`);
  relatorio.eleicao.hash_eleicao = ab.hash_eleicao;
  const n = nacionalDosBlocos(blocos)!;

  // 7. Cargas -------------------------------------------------------------------
  const chavesUrna = new Map<string, string>();
  for (const b of blocos.filter((x) => x.tipo === "CARGA") as Bloco<"CARGA">[]) {
    const c = b.conteudo;
    const id = `bloco ${b.numero}`;
    if (!chavesExatas(c, ["secao", "urna", "chave_urna", "autoridade_secao", "software"]) || !/^\d{3}-\d{4}$/.test(c.secao) || !ehHex(c.chave_urna, 32) || !ehHex(c.autoridade_secao?.n) || !ehHex(c.autoridade_secao?.e)) {
      falha("cargas", `${id}: carga malformada`);
      continue;
    }
    const outra = chavesUrna.get(c.chave_urna);
    if (outra && outra !== c.secao) falha("cargas", `${id}: a chave da urna da seção ${c.secao} é a mesma da seção ${outra}`);
    chavesUrna.set(c.chave_urna, c.secao);
    if (c.software !== g.software.hash) falha("cargas", `${id}: urna da seção ${c.secao} carregada com software diferente do publicado na gênese`);
  }
  const cargas = cargasDosBlocos(blocos);
  // uma carga publicada DEPOIS da mídia da mesma seção não vale (tentativa de trocar a chave)
  const secaoComMidia = new Set<string>();
  for (const b of blocos) {
    if (b.tipo === "SECAO") secaoComMidia.add((b.conteudo as ConteudoSecao).secao);
    if (b.tipo === "CARGA" && secaoComMidia.has((b.conteudo as ConteudoCarga).secao))
      falha("cargas", `bloco ${b.numero}: nova carga da seção ${(b.conteudo as ConteudoCarga).secao} depois da mídia dela`);
  }
  if (cargas.size > 0) aprovar("cargas", `${cargas.size} urna(s), cada uma com chave própria publicada antes dos votos`);

  // 8–17. Mídias das seções -------------------------------------------------------
  const totalItens = blocosSecao.reduce((s, b) => s + (b.conteudo.bu?.conteudo?.cedulas?.length ?? 0) + (b.conteudo.bu?.conteudo?.desafiadas?.length ?? 0), 0);
  const nullificadores = new Set<string>();
  const codigos = new Set<string>();
  const vistasSecoes = new Set<string>();
  let base = 0;
  for (const b of blocosSecao) {
    const s = b.conteudo;
    const vigente = cargas.get(s.secao);
    if (!vigente || vigente.bloco > b.numero) {
      falha("midias", `bloco ${b.numero}: mídia da seção ${s.secao} sem carga publicada antes dela (seção fantasma?)`);
      continue;
    }
    if (vistasSecoes.has(s.secao)) falha("midias", `seção ${s.secao}: mais de uma mídia recebida`);
    vistasSecoes.add(s.secao);
    const r = await conferirMidiaSecao(s, vigente.carga, n, falha, async (feitas) => {
      aoProgredir?.(base + feitas, totalItens, `seção ${s.secao}`);
      await pausa();
    });
    base += r.cedulas.length + r.desafiadas.length;
    for (const c of r.cedulas) {
      if (nullificadores.has(c.nullificador)) falha("duplicidade", `seção ${s.secao}: credencial já usada em outra seção`);
      nullificadores.add(c.nullificador);
    }
    for (const c of [...r.cedulas, ...r.desafiadas]) {
      if (c.codigo && codigos.has(c.codigo)) falha("verificacao", `código ${c.codigo} repetido entre seções`);
      if (c.codigo) codigos.add(c.codigo);
    }
    relatorio.estatisticas.cedulas += r.cedulas.length;
    relatorio.estatisticas.desafiadas += r.desafiadas.length;
    relatorio.secoes.push({
      secao: s.secao,
      urna: vigente.carga.urna,
      bloco: b.numero,
      bu: s.bu.hash,
      comparecimento: s.bu.conteudo.comparecimento,
      cedulas: r.cedulas.length,
      desafiadas: r.desafiadas.length,
      contagemBU: s.bu.conteudo.contagem,
    });
  }
  aoProgredir?.(totalItens, totalItens, "seções verificadas");
  if (blocosSecao.length > 0) {
    const { cedulas, desafiadas } = relatorio.estatisticas;
    aprovar("midias", `${blocosSecao.length} mídia(s): zerésima e BU assinados pela urna da carga`);
    aprovar("sigilo", `${blocosSecao.length} BU(s) em ordem canônica, sem campos de tempo`);
    if (cedulas > 0) {
      aprovar("credenciais", `${cedulas} credenciais com assinatura cega válida da mesa da seção`);
      aprovar("assinaturas_cedulas", `${cedulas} cédulas íntegras`);
      aprovar("provas", `${cedulas * n.nOpcoes} provas 0-ou-1 e ${cedulas} provas de soma válidas`);
      aprovar("duplicidade", `${nullificadores.size} nullificadores distintos`);
    }
    if (cedulas + desafiadas > 0) {
      aprovar("rastreadores", `${cedulas + desafiadas} rastreadores recalculados`);
      aprovar("verificacao", `${codigos.size} códigos e figuras conferem com os selos das urnas, todos únicos`);
    }
    if (desafiadas > 0) aprovar("desafiadas", `${desafiadas} teste(s) conferem com a opção aberta`);
    aprovar("comparecimento", `${cedulas} cédulas; nenhuma seção com mais cédulas que comparecimento`);
    aprovar("agregado", `soma homomórfica de ${blocosSecao.length} seção(ões) confere`);
  }

  // 18. Encerramento ------------------------------------------------------------
  const encBloco = blocos.find((b) => b.tipo === "ENCERRAMENTO") as Bloco<"ENCERRAMENTO"> | undefined;
  if (!encBloco) return finalizar();
  const enc = encBloco.conteudo as ConteudoEncerramento;
  const recebidas = new Map(blocosSecao.map((b) => [b.conteudo.secao, b.conteudo]));
  const declaradas = new Map((enc.secoes ?? []).map((s) => [s.secao, s]));
  if (declaradas.size !== recebidas.size) falha("encerramento", `encerramento lista ${declaradas.size} seções, o quadro tem ${recebidas.size} mídias`);
  for (const [secao, s] of recebidas) {
    const d = declaradas.get(secao);
    if (!d || d.bu !== s.bu.hash || d.cedulas !== s.bu.conteudo.cedulas.length || d.desafiadas !== s.bu.conteudo.desafiadas.length)
      falha("encerramento", `seção ${secao}: dados do encerramento não conferem com a mídia`);
  }
  const semMidia = [...cargas.keys()].filter((s) => !recebidas.has(s)).sort();
  if ((enc.secoes_sem_midia ?? []).slice().sort().join(",") !== semMidia.join(",")) falha("encerramento", "lista de seções sem mídia não confere com as cargas");
  if (enc.total_cedulas !== relatorio.estatisticas.cedulas || enc.total_desafiadas !== relatorio.estatisticas.desafiadas)
    falha("encerramento", "totais do encerramento não conferem com as mídias");
  for (const s of semMidia)
    relatorio.avisos.push(`Seção ${s}: a urna recebeu carga, mas a mídia não chegou ao TSE. Os votos dela não estão no resultado — o BU em papel da seção é a referência.`);
  aprovar("encerramento", semMidia.length ? `${recebidas.size} seção(ões) recebidas; ⚠ sem mídia: ${semMidia.join(", ")}` : `${recebidas.size} seção(ões) recebidas, nenhuma faltando`);

  // 19–21. Decifração, BU impresso e resultado ------------------------------------
  const parciais = blocos.filter((b) => b.tipo === "DECRIPTACAO_PARCIAL").map((b) => b.conteudo as ConteudoDecriptacao);
  const vistosParciais = new Set<number>();
  for (const p of parciais) {
    if (!trustees.some((t) => t.trustee === p.trustee) || vistosParciais.has(p.trustee)) falha("decriptacao", `decifração do trustee ${p.trustee}: trustee desconhecido ou repetido`);
    vistosParciais.add(p.trustee);
  }
  if (parciais.length < NUM_TRUSTEES) {
    if (parciais.length > 0) aprovar("decriptacao", `${parciais.length} de ${NUM_TRUSTEES} decifrações enviadas`);
    return finalizar();
  }
  const apuradas = new Map<string, Contagem>();
  for (const b of blocosSecao) {
    const s = b.conteudo;
    const agregado = agregarCedulas(s.bu.conteudo.cedulas, n.nOpcoes);
    const c = apurarSecao(s.secao, agregado, parciais, trustees, n.hashEleicao, s.bu.conteudo.cedulas.length, falha);
    if (!c) continue;
    apuradas.set(s.secao, c);
    const resumo = relatorio.secoes.find((x) => x.secao === s.secao);
    if (resumo) resumo.contagemApurada = c;
    const impresso = s.bu.conteudo.contagem;
    if (c.some((x, i) => impresso?.[i]?.votos !== x.votos))
      falha("bu_papel", `seção ${s.secao}: o BU impresso diz ${textoContagem(impresso, g.opcoes)}; a apuração criptográfica diz ${textoContagem(c, g.opcoes)}`);
  }
  if (apuradas.size === blocosSecao.length) {
    aprovar("decriptacao", `${NUM_TRUSTEES} trustees × ${blocosSecao.length} seção(ões) com prova válida`);
    aprovar("bu_papel", `${apuradas.size} BU(s): contagem impressa = decifração do agregado`);
    const total = somarContagens([...apuradas.values()], n.nOpcoes);
    relatorio.resultado = total.map((x) => ({ opcao: g.opcoes[x.opcao], votos: x.votos }));
    const publicado = blocos.find((b) => b.tipo === "RESULTADO")?.conteudo as ConteudoResultado | undefined;
    if (publicado) {
      for (const [secao, c] of apuradas) {
        const p = publicado.secoes?.find((x) => x.secao === secao);
        if (!p || c.some((x, i) => p.contagem?.[i]?.votos !== x.votos)) falha("resultado", `seção ${secao}: resultado publicado ≠ recalculado`);
      }
      total.forEach((x) => {
        const p = publicado.contagem?.find((y) => y.opcao === x.opcao);
        if (!p || p.votos !== x.votos) falha("resultado", `${g.opcoes[x.opcao].nome}: publicado ${p?.votos ?? "—"}, recalculado ${x.votos}`);
      });
      if (publicado.total !== relatorio.estatisticas.cedulas) falha("resultado", "total publicado não confere");
      aprovar("resultado", "resultado publicado = resultado recalculado pelo auditor, seção por seção");
    }
  }
  return finalizar();
}

// ------------------------------------------------------------------------------
// Verificação individual do eleitor: "minha cédula está na mídia da minha seção,
// é válida e entrou na soma que os trustees decifraram?" — sem revelar o voto.

export type ItemVerificacaoEleitor = { titulo: string; status: StatusVerificacao; detalhe: string };

/** Situação da seção quando a cédula não é encontrada. */
export type SituacaoSecao = "sem_carga" | "aguardando_midia" | "transmitida";

function situacaoDaSecao(blocos: Bloco[], secao: string): SituacaoSecao {
  if (secoesDosBlocos(blocos).some((b) => b.conteudo.secao === secao)) return "transmitida";
  if (cargasDosBlocos(blocos).has(secao)) return "aguardando_midia";
  return "sem_carga";
}

/** `consulta`: o código de 12 caracteres do comprovante ou o hash (prefixo de 8+ caracteres). */
export function verificarMinhaCedula(pacote: Pacote, consulta: string) {
  const blocos = pacote.blocos;
  const itens: ItemVerificacaoEleitor[] = [];
  const add = (titulo: string, ok: boolean | null, detalhe: string) => itens.push({ titulo, status: ok === null ? "pendente" : ok ? "ok" : "falha", detalhe });
  const nada = (situacaoSecao?: SituacaoSecao, secao?: string) => ({
    encontrada: false as const,
    tipo: null,
    itens,
    bloco: null as number | null,
    situacaoSecao,
    secao,
  });

  const genese = blocos[0] as Bloco<"GENESE"> | undefined;
  const n = nacionalDosBlocos(blocos);
  const codigo = lerCodigo(consulta);
  const secaoDoCodigo = codigo ? `${codigo.slice(0, 3)}-${codigo.slice(3, 7)}` : undefined;
  if (!genese || !n) return nada();

  const alvo = consulta.replace(/\s+/g, "").toLowerCase();
  const corresponde = (c: { rastreador: string; codigo?: string }) =>
    (!!codigo && c.codigo === codigo) || c.rastreador === alvo || (alvo.length >= 8 && /^[0-9a-f]+$/.test(alvo) && c.rastreador.startsWith(alvo));

  let achada: { c: CedulaPublicada; bloco: Bloco<"SECAO"> } | undefined;
  let achadaTeste: { c: CedulaDesafiada; bloco: Bloco<"SECAO"> } | undefined;
  for (const b of secoesDosBlocos(blocos)) {
    if (secaoDoCodigo && b.conteudo.secao !== secaoDoCodigo && !/^[0-9a-f]{8,}$/.test(alvo)) continue;
    const c = b.conteudo.bu?.conteudo?.cedulas?.find(corresponde);
    if (c) {
      achada = { c, bloco: b };
      break;
    }
    const d = b.conteudo.bu?.conteudo?.desafiadas?.find(corresponde);
    if (d) {
      achadaTeste = { c: d, bloco: b };
      break;
    }
  }
  if (!achada && !achadaTeste) return nada(secaoDoCodigo ? situacaoDaSecao(blocos, secaoDoCodigo) : undefined, secaoDoCodigo);

  const blocoSecao = (achada ?? achadaTeste)!.bloco;
  const s = blocoSecao.conteudo;
  const carga = cargasDosBlocos(blocos).get(s.secao);
  const cadeiaOk = blocos.every((b, i) => b.hash === hashBloco(b) && b.hash_anterior === (i === 0 ? HASH_INICIAL : blocos[i - 1].hash));
  const assinOk = blocos.every((b) => verificarAssinaturaHash(b.hash, b.assinatura, genese.conteudo.chave_quadro));
  const midiaOk = !!carga && verificarDocumentoUrna(s.zeresima, carga.carga.chave_urna) && verificarDocumentoUrna(s.bu, carga.carga.chave_urna);
  const figuras = (c: { figuras?: string[] }): Figura[] | undefined => c.figuras?.map((p) => figuraDaPalavra(p)).filter((x): x is Figura => !!x);
  const comum = { bloco: blocoSecao.numero, secao: s.secao, bu: s.bu.hash, codigoBU: codigoBU(s.bu.hash) };

  if (achadaTeste && carga) {
    const c = achadaTeste.c;
    const ctx = contextoDaSecao(n, carga.carga);
    const r = verificarDesafiada(c, ctx);
    add("Cédula de teste encontrada na mídia da seção", true, `seção ${s.secao}, bloco ${blocoSecao.numero}`);
    add("Cadeia de blocos íntegra e assinada", cadeiaOk && assinOk, "hashes e assinaturas do quadro conferem");
    add("Mídia assinada pela urna da seção", midiaOk, "zerésima e BU com a chave publicada na carga");
    add("Código e figuras seladas pela urna", verificacaoConfere(c, n, carga.carga) === null, "gravados no BU e conferidos com a assinatura da urna");
    add("A cifração confere com a abertura", r.ok, r.ok ? `refeita aqui: a cédula continha ${genese.conteudo.opcoes[r.opcao]?.numero ?? ""} ${genese.conteudo.opcoes[r.opcao]?.nome}` : r.erros.join("; "));
    return {
      encontrada: true as const,
      tipo: "desafiada" as const,
      itens,
      ...comum,
      opcaoRevelada: r.ok ? genese.conteudo.opcoes[r.opcao] : undefined,
      indiceRevelado: r.ok ? r.opcao : undefined,
      rastreador: c.rastreador,
      figuras: figuras(c),
      codigo: c.codigo,
      conferencia: c.selo ? conferenciaDoSelo(c.selo) : undefined,
    };
  }
  if (!achada || !carga) return nada(situacaoDaSecao(blocos, s.secao), s.secao);

  const c = achada.c;
  const ctx = contextoDaSecao(n, carga.carga);
  add("Cédula encontrada na mídia da seção", true, `seção ${s.secao}, bloco ${blocoSecao.numero}`);
  add("Cadeia de blocos íntegra e assinada", cadeiaOk && assinOk, `${blocos.length} blocos verificados`);
  add("Mídia assinada pela urna da seção", midiaOk, "zerésima e BU com a chave publicada na carga, antes dos votos");
  add("Código e figuras seladas pela urna", verificacaoConfere(c, n, carga.carga) === null, "o que a urna mostrou está gravado no BU e confere com a assinatura dela");
  const r = verificarCedula(c, ctx);
  add("Credencial anônima válida", r.credencial, "assinatura cega da mesa da seção confere");
  add("Cédula íntegra (assinatura)", r.assinatura, "nada foi alterado desde que a urna assinou");
  add("Provas de conhecimento zero", r.provas && r.soma, "o voto é válido — sem revelar qual é");
  const duplicada = s.bu.conteudo.cedulas.filter((x) => x.nullificador === c.nullificador).length > 1;
  add("Credencial usada uma única vez", !duplicada, "nenhuma outra cédula usa o mesmo nullificador");
  const agregado = agregarCedulas(s.bu.conteudo.cedulas, n.nOpcoes);
  const somaOk = agregado.map(cifraParaHex).every((x, i) => x.a === s.bu.conteudo.agregado[i]?.a && x.b === s.bu.conteudo.agregado[i]?.b);
  add("Incluída na soma da seção", somaOk, somaOk ? "o agregado que os trustees decifram contém a sua cédula" : "agregado do BU não confere");
  const parciais = blocos.filter((b) => b.tipo === "DECRIPTACAO_PARCIAL").map((b) => b.conteudo as ConteudoDecriptacao);
  const trustees = blocos.filter((b) => b.tipo === "CHAVE_TRUSTEE").map((b) => b.conteudo as ConteudoChaveTrustee);
  if (parciais.length < NUM_TRUSTEES) {
    add("Contabilizada no resultado", null, `${parciais.length}/3 decifrações parciais`);
  } else {
    const apurada = apurarSecao(s.secao, agregado, parciais, trustees, n.hashEleicao, s.bu.conteudo.cedulas.length);
    add(
      "Contabilizada no resultado",
      !!apurada && somaOk,
      apurada ? "a decifração da sua seção, com provas, inclui a sua cédula" : "decifração da seção não confere",
    );
  }
  return {
    encontrada: true as const,
    tipo: "cedula" as const,
    itens,
    ...comum,
    rastreador: c.rastreador,
    figuras: figuras(c),
    codigo: c.codigo,
    conferencia: conferenciaDoSelo(c.selo),
  };
}

/**
 * O BU da seção como está publicado — para comparar com o papel colado na porta
 * da escola (código do BU e números) — e a apuração criptográfica dele.
 */
export function boletimDaSecao(pacote: Pacote, secao: string) {
  const blocos = pacote.blocos;
  const n = nacionalDosBlocos(blocos);
  const situacao = situacaoDaSecao(blocos, secao);
  const b = secoesDosBlocos(blocos).find((x) => x.conteudo.secao === secao);
  const carga = cargasDosBlocos(blocos).get(secao);
  if (!n || !b || !carga) return { encontrada: false as const, situacao, secao };
  const bu = b.conteudo.bu;
  const assinaturaOk = verificarDocumentoUrna(b.conteudo.zeresima, carga.carga.chave_urna) && verificarDocumentoUrna(bu, carga.carga.chave_urna);
  const parciais = blocos.filter((x) => x.tipo === "DECRIPTACAO_PARCIAL").map((x) => x.conteudo as ConteudoDecriptacao);
  const trustees = blocos.filter((x) => x.tipo === "CHAVE_TRUSTEE").map((x) => x.conteudo as ConteudoChaveTrustee);
  const agregado = agregarCedulas(bu.conteudo.cedulas, n.nOpcoes);
  const somaOk = agregado.map(cifraParaHex).every((x, i) => x.a === bu.conteudo.agregado[i]?.a && x.b === bu.conteudo.agregado[i]?.b);
  const apurada = parciais.length === NUM_TRUSTEES ? apurarSecao(secao, agregado, parciais, trustees, n.hashEleicao, bu.conteudo.cedulas.length) : null;
  return {
    encontrada: true as const,
    situacao,
    secao,
    urna: carga.carga.urna,
    chave_urna: carga.carga.chave_urna,
    bloco: b.numero,
    hash: bu.hash,
    codigo: codigoBU(bu.hash),
    comparecimento: bu.conteudo.comparecimento,
    cedulas: bu.conteudo.cedulas.length,
    desafiadas: bu.conteudo.desafiadas.length,
    contagem: bu.conteudo.contagem,
    encerrada_em: bu.conteudo.encerrada_em,
    assinaturaOk,
    somaOk,
    apurada,
    confere: apurada ? apurada.every((x, i) => bu.conteudo.contagem[i]?.votos === x.votos) : null,
    opcoes: n.opcoes,
  };
}

/**
 * Comprovante de teste: a urna declarou (e assinou) o que havia na cédula
 * testada. Confere a assinatura com a chave da carga e compara com a abertura
 * publicada no BU. Se forem diferentes, é prova de fraude da urna.
 */
export function conferirDeclaracaoTeste(pacote: Pacote, d: DeclaracaoTeste) {
  const blocos = pacote.blocos;
  const n = nacionalDosBlocos(blocos);
  const carga = cargasDosBlocos(blocos).get(d?.secao);
  if (!n || !carga) return { encontrada: false as const, motivo: "seção sem carga no quadro" };
  const assinaturaValida = verificarDeclaracaoTeste(d, carga.carga.chave_urna);
  const b = secoesDosBlocos(blocos).find((x) => x.conteudo.secao === d.secao);
  if (!b) return { encontrada: false as const, assinaturaValida, motivo: "a mídia desta seção ainda não foi recebida" };
  const teste = b.conteudo.bu.conteudo.desafiadas.find((x) => x.rastreador === d.rastreador);
  if (!teste) return { encontrada: false as const, assinaturaValida, motivo: "a cédula de teste não está no BU da seção (a urna a omitiu)" };
  const r = verificarDesafiada(teste, contextoDaSecao(n, carga.carga));
  const declarada = n.opcoes[d.opcao];
  const revelada = r.ok ? n.opcoes[r.opcao] : undefined;
  return {
    encontrada: true as const,
    assinaturaValida,
    aberturaValida: r.ok,
    declarada,
    revelada,
    fraude: assinaturaValida && r.ok && r.opcao !== d.opcao,
  };
}

/**
 * O eleitor REFAZ EM CASA o teste que fez na urna. Com a chave impressa no papel
 * do teste, recifra cada opção possível e procura qual delas dá exatamente as
 * cifras da cédula que a urna selou sob aquele código (o que ela mostrou ANTES
 * de o eleitor decidir testar). Não usa a abertura publicada pela urna: a prova
 * é a conta feita no computador do eleitor.
 *
 * Só funciona para cédula de teste: a chave da cédula depositada é destruída na
 * urna e não existe em lugar nenhum — ela só pode ser contada dentro da soma.
 */
export function reproduzirTeste(pacote: Pacote, codigo: string, semente: string) {
  const blocos = pacote.blocos;
  const n = nacionalDosBlocos(blocos);
  const c = lerCodigo(codigo);
  if (!n || !c) return { encontrada: false as const, motivo: "código inválido ou eleição sem abertura" };
  const secao = `${c.slice(0, 3)}-${c.slice(3, 7)}`;
  const b = secoesDosBlocos(blocos).find((x) => x.conteudo.secao === secao);
  const carga = cargasDosBlocos(blocos).get(secao);
  if (!b || !carga) return { encontrada: false as const, motivo: "a mídia desta seção ainda não foi recebida" };
  const d = b.conteudo.bu.conteudo.desafiadas.find((x) => x.codigo === c);
  if (!d) {
    const depositada = b.conteudo.bu.conteudo.cedulas.some((x) => x.codigo === c);
    return {
      encontrada: false as const,
      motivo: depositada
        ? "este código é de um voto DEPOSITADO: a chave dele foi destruída na urna e ninguém consegue abri-lo — só a soma é decifrada"
        : "nenhuma cédula de teste com este código no BU da seção (a urna a omitiu?)",
    };
  }
  const ctx = contextoDaSecao(n, carga.carga);
  let indice: number | null = null;
  try {
    for (let j = 0; j < n.nOpcoes && indice === null; j++) {
      const refeitas = cifrarComSemente(ctx, j, semente);
      if (refeitas.every((x, i) => x.a === d.cifras[i]?.a && x.b === d.cifras[i]?.b)) indice = j;
    }
  } catch {
    indice = null;
  }
  const rastreadorOk = calcularRastreador(n.hashEleicao, d.cifras) === d.rastreador;
  const seloOk = verificacaoConfere(d, n, carga.carga) === null;
  return {
    encontrada: true as const,
    secao,
    rastreador: d.rastreador,
    /** a opção que a cifra refeita com a chave do papel reproduz — null se a chave não abre esta cédula */
    indice,
    opcao: indice === null ? undefined : n.opcoes[indice],
    /** a cédula publicada é exatamente a que a urna selou (código, figuras, conferência) antes do teste */
    seloOk: seloOk && rastreadorOk,
    conferencia: d.selo ? conferenciaDoSelo(d.selo) : undefined,
    figuras: d.figuras,
    /** a abertura que a urna publicou no BU usa a mesma chave do papel */
    aberturaPublicadaIgual: d.revelacao?.semente === semente,
  };
}

// ------------------------------------------------------------------------------
// Conferir o TESTE DA URNA em casa, com os dados impressos no comprovante.

export type VereditoTeste = "legitima" | "fraude" | "inconclusivo";

/**
 * O eleitor passa o que está no papel — código do teste, chave do teste, o
 * candidato que a urna declarou e (opcional) a declaração assinada — e o
 * computador dele decide se a urna disse a verdade naquele teste:
 *
 *  1. recifra cada opção com a chave do papel e acha a que dá exatamente a
 *     cédula que a urna selou com aquele código (ANTES de o eleitor testar);
 *  2. compara com o candidato que a urna declarou;
 *  3. com a assinatura, confere que a declaração do papel foi mesmo feita pela
 *     urna (chave da carga) — o que transforma uma mentira em prova para terceiros.
 *
 * Não revela voto nenhum: a cédula de teste foi anulada.
 */
export function conferirTesteDoPapel(
  pacote: Pacote,
  entrada: { codigo: string; chave: string; declarado: string; assinatura?: string },
) {
  const blocos = pacote.blocos;
  const n = nacionalDosBlocos(blocos);
  const codigo = lerCodigo(entrada.codigo);
  const base = { veredito: "inconclusivo" as VereditoTeste, codigo, secao: codigo ? `${codigo.slice(0, 3)}-${codigo.slice(3, 7)}` : undefined };
  if (!n) return { ...base, motivo: "o pacote não tem uma eleição aberta" };
  if (!codigo) return { ...base, motivo: "código do teste inválido (são 12 caracteres, ex.: 001 0001 APRT9)" };
  if (!/^[0-9a-f]{32}$/.test(entrada.chave)) return { ...base, motivo: "chave do teste inválida (são 26 caracteres)" };

  const indiceDeclarado =
    entrada.declarado === "branco"
      ? n.opcoes.findIndex((o) => o.tipo === "branco")
      : entrada.declarado === "nulo"
        ? n.opcoes.findIndex((o) => o.tipo === "nulo")
        : n.opcoes.findIndex((o) => o.numero === entrada.declarado);
  const declarada = indiceDeclarado >= 0 ? n.opcoes[indiceDeclarado] : undefined;

  const situacao = situacaoDaSecao(blocos, base.secao!);
  if (situacao !== "transmitida")
    return {
      ...base,
      declarada,
      motivo:
        situacao === "aguardando_midia"
          ? "a mídia desta seção ainda não chegou ao TSE — confira de novo depois do encerramento"
          : "nenhuma urna com essa zona e seção nesta eleição — confira o código",
    };

  const rep = reproduzirTeste(pacote, codigo, entrada.chave);
  if (!rep.encontrada) {
    // seção transmitida e o código não está entre as cédulas de teste: ou é o código do voto, ou a urna sumiu com o teste
    const ehVoto = /DEPOSITADO/.test(rep.motivo);
    return {
      ...base,
      declarada,
      veredito: (ehVoto ? "inconclusivo" : "fraude") as VereditoTeste,
      motivo: ehVoto
        ? "este é o código do VOTO depositado, não do teste — o voto não pode ser aberto por ninguém"
        : "a seção foi transmitida e esta cédula de teste NÃO está no BU: a urna sumiu com ela. O comprovante, assinado pela urna, é a prova.",
    };
  }
  const real = rep.indice === null ? undefined : n.opcoes[rep.indice];
  const carga = cargasDosBlocos(blocos).get(rep.secao);

  // a declaração do papel foi mesmo assinada por esta urna?
  let assinatura: "ok" | "invalida" | "ausente" = "ausente";
  if (entrada.assinatura && indiceDeclarado >= 0 && carga) {
    assinatura = verificarDeclaracaoTeste(
      {
        tipo: "DECLARACAO_TESTE",
        eleicao: n.hashEleicao,
        secao: rep.secao,
        rastreador: rep.rastreador,
        opcao: indiceDeclarado,
        semente: entrada.chave,
        assinatura: entrada.assinatura,
      },
      carga.carga.chave_urna,
    )
      ? "ok"
      : "invalida";
  } else if (entrada.assinatura) assinatura = "invalida";

  const comum = { ...base, declarada, real, conferencia: rep.conferencia, figuras: rep.figuras, seloOk: rep.seloOk, assinatura, urna: carga?.carga.urna };
  if (rep.indice === null)
    return {
      ...comum,
      veredito: "fraude" as VereditoTeste,
      motivo:
        "a chave do papel não abre a cédula que a urna selou com este código. Confira a digitação da chave; se estiver certa, a urna imprimiu uma chave falsa ou trocou a cédula.",
    };
  if (!declarada) return { ...comum, motivo: "informe o candidato que está impresso no papel do teste para comparar" };
  if (rep.indice !== indiceDeclarado)
    return {
      ...comum,
      veredito: (assinatura === "invalida" ? "inconclusivo" : "fraude") as VereditoTeste,
      motivo:
        assinatura === "ok"
          ? "a urna declarou (e assinou) um candidato, mas a cédula continha outro. A declaração assinada é prova criptográfica contra esta urna."
          : assinatura === "invalida"
            ? "o candidato informado não é o que a cédula continha — e a assinatura do papel NÃO confere com ele. Confira a digitação: um papel alterado não incrimina a urna, porque só a declaração verdadeira tem a assinatura dela."
            : "a urna declarou um candidato, mas a cédula continha outro. Digite a declaração assinada do papel para ter a prova criptográfica.",
    };
  return { ...comum, veredito: "legitima" as VereditoTeste, motivo: "a cédula testada continha exatamente o candidato que a urna declarou" };
}
