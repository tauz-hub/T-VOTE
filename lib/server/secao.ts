// Banco D — memória interna da urna (a parte "hardware" da urna). OFFLINE.
//
// Tudo aqui acontece dentro da seção, sem falar com o TSE:
//
//   carga     a urna gera o próprio par de chaves Ed25519 (a privada nunca sai)
//   abertura  imprime a ZERÉSIMA assinada: nenhum voto, chaves da urna e da mesa
//   votação   sela cada cédula com a chave da urna (código + 2 figuras), guarda a
//             cédula sem ordem e sem horário, soma 1 no contador da opção
//   teste     guarda a cédula aberta e ASSINA a declaração do que havia dentro
//   fim       imprime o BU assinado: contagem + todas as cédulas + soma homomórfica
//
// A mídia (zerésima + BU) só vai para o TSE depois do encerramento.
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  type Cedula,
  type CedulaDesafiada,
  type CedulaPublicada,
  type ContextoCedula,
  calcularNullificador,
  calcularRastreador,
  mensagemPedidoSelo,
  verificarCedula,
  verificarDesafiada,
} from "../crypto/cedula";
import { ehHex, hexToBytes } from "../crypto/codificacao";
import { cifraParaHex } from "../crypto/elgamal";
import { codigoVerificacao, nomesDasFiguras } from "../crypto/palavras";
import type { ProvaZeroOuUm } from "../crypto/provas";
import { type ConteudoCarga, type Opcao, type Recibo, type TipoRecibo, assinarHash, hashRecibo, hashSelo } from "../crypto/quadro";
import { mensagemCredencial, verificarAssinaturaRSA, type ChaveRSAPublica } from "../crypto/rsa-cega";
import {
  type BoletimUrna,
  type DeclaracaoTeste,
  type DocumentoUrna,
  type MidiaSecao,
  type ZeresimaSecao,
  agregarCedulas,
  assinarDocumentoUrna,
  hashDeclaracaoTeste,
} from "../crypto/secao";
import type { CargaUrna, FaseSecao, ResumoBU } from "../tipos-api";
import { type ParametrosFirmware, omiteTeste } from "../laboratorio/firmware-adulterado";
import { credenciaisEmitidas, criarAutoridadeDaSecao } from "./autoridade";
import { notificarUrna } from "./avisos";
import { gerarChaveEd25519 } from "./chaves";
import { db, registrarEvento } from "./db";
import { ErroHttp } from "./http";
import { idSecao } from "../crypto/palavras";
import type { LinhaUrna } from "./urnas";

/** O que a urna recebe na carga: dados públicos da eleição (nada secreto do TSE). */
export type DadosNacionais = { eleicao_id: string; nome: string; hash_eleicao: string; chave_publica: string; opcoes: Opcao[]; software: string };

type DadosCarga = DadosNacionais & { urna: string; autoridade_secao: ChaveRSAPublica };

type LinhaCarga = {
  urna_id: string;
  eleicao_id: string;
  secao: string;
  fase: FaseSecao;
  chave_privada: string;
  chave_publica: string;
  dados: string;
  zeresima: string | null;
  bu: string | null;
  bloco: number | null;
};

const lerLinha = (urnaId: string) => db("urnas").prepare("SELECT * FROM carga WHERE urna_id = ?").get(urnaId) as LinhaCarga | undefined;

export const secaoDaUrna = (u: Pick<LinhaUrna, "zona" | "secao">) => idSecao(u.zona, u.secao);

function resumoBU(doc: DocumentoUrna<BoletimUrna>): ResumoBU {
  const b = doc.conteudo;
  return {
    hash: doc.hash,
    assinatura: doc.assinatura,
    comparecimento: b.comparecimento,
    cedulas: b.cedulas.length,
    desafiadas: b.desafiadas.length,
    contagem: b.contagem,
    encerrada_em: b.encerrada_em,
  };
}

/** A carga desta urna para a eleição atual (sem a chave privada), ou null. */
export function cargaDaUrna(urnaId: string, eleicaoId: string | undefined): CargaUrna | null {
  const l = lerLinha(urnaId);
  if (!l || !eleicaoId || l.eleicao_id !== eleicaoId) return null;
  const dados = JSON.parse(l.dados) as DadosCarga;
  return {
    ...dados,
    secao: l.secao,
    fase: l.fase,
    chave_urna: l.chave_publica,
    bloco: l.bloco,
    zeresima: l.zeresima ? (JSON.parse(l.zeresima) as DocumentoUrna<ZeresimaSecao>) : undefined,
    bu: l.bu ? resumoBU(JSON.parse(l.bu) as DocumentoUrna<BoletimUrna>) : undefined,
  };
}

/** Marca para o long-poll: muda quando a mesa libera a urna ou quando a seção muda de fase. */
export function marcaDaUrna(u: LinhaUrna): string {
  const l = lerLinha(u.id);
  return `${u.estado}|${l?.eleicao_id ?? "-"}|${l?.fase ?? "sem-carga"}`;
}

function contextoDe(dados: DadosCarga): ContextoCedula {
  return {
    eleicaoId: dados.eleicao_id,
    hashEleicao: dados.hash_eleicao,
    chavePublica: dados.chave_publica,
    nOpcoes: dados.opcoes.length,
    autoridade: dados.autoridade_secao,
  };
}

function secaoNaFase(urnaId: string, ...fases: FaseSecao[]) {
  const l = lerLinha(urnaId);
  if (!l) throw new ErroHttp(409, "A urna ainda não recebeu a carga da eleição");
  if (!fases.includes(l.fase)) {
    const msg: Record<FaseSecao, string> = {
      carregada: "A seção ainda não foi aberta — o mesário imprime a zerésima primeiro",
      aberta: "A seção está aberta",
      encerrada: "A seção já foi encerrada (BU impresso)",
      transmitida: "A seção já foi encerrada e transmitida",
    };
    throw new ErroHttp(409, msg[l.fase]);
  }
  const dados = JSON.parse(l.dados) as DadosCarga;
  return { l, dados, ctx: contextoDe(dados) };
}

/** A mesa só libera a urna com a seção aberta. */
export function exigirSecaoAberta(urnaId: string) {
  return secaoNaFase(urnaId, "aberta");
}

// ------------------------------------------------------------------- carga

/**
 * Carga (cerimônia no TRE, antes da eleição): a urna gera a própria chave aqui
 * dentro e a mesa da seção gera a chave das credenciais. Devolve o conteúdo
 * PÚBLICO que vai para o quadro. Recarregar só é possível antes da abertura.
 */
export function gerarCarga(urna: LinhaUrna, nacional: DadosNacionais): ConteudoCarga {
  const secao = secaoDaUrna(urna);
  const d = db("urnas");
  const atual = lerLinha(urna.id);
  if (atual && atual.eleicao_id === nacional.eleicao_id && atual.fase !== "carregada")
    throw new ErroHttp(409, "Esta urna já abriu a seção nesta eleição — a carga não pode ser refeita");
  const outra = d
    .prepare("SELECT urna_id, fase FROM carga WHERE secao = ? AND eleicao_id = ? AND urna_id <> ?")
    .get(secao, nacional.eleicao_id, urna.id) as { urna_id: string; fase: FaseSecao } | undefined;
  if (outra && outra.fase !== "carregada") throw new ErroHttp(409, `Já existe outra urna em uso na seção ${secao}`);

  const chave = gerarChaveEd25519();
  const autoridade_secao = criarAutoridadeDaSecao(urna.id, nacional.eleicao_id, secao);
  const dados: DadosCarga = { ...nacional, urna: urna.nome, autoridade_secao };
  d.transaction(() => {
    for (const id of [urna.id, outra?.urna_id].filter((x): x is string => !!x)) {
      for (const t of ["carga", "cedulas", "selos", "nullificadores", "contagem"]) d.prepare(`DELETE FROM ${t} WHERE urna_id = ?`).run(id);
    }
    d.prepare(
      "INSERT INTO carga (urna_id, eleicao_id, secao, fase, chave_privada, chave_publica, dados) VALUES (?, ?, ?, 'carregada', ?, ?, ?)",
    ).run(urna.id, nacional.eleicao_id, secao, chave.privada, chave.publica, JSON.stringify(dados));
  })();
  if (outra) notificarUrna(outra.urna_id);
  notificarUrna(urna.id);
  registrarEvento("urnas", "CARGA", `${urna.nome}: seção ${secao}, chave da urna gerada dentro dela`);
  return { secao, urna: urna.nome, chave_urna: chave.publica, autoridade_secao, software: nacional.software };
}

// ---------------------------------------------------------------- abertura

/** O mesário abre a seção: a urna imprime a zerésima assinada (nenhum voto). */
export function abrirSecao(urna: LinhaUrna): DocumentoUrna<ZeresimaSecao> {
  const { l, dados } = secaoNaFase(urna.id, "carregada");
  const zeresima = assinarDocumentoUrna<ZeresimaSecao>(
    {
      tipo: "ZERESIMA",
      eleicao: dados.hash_eleicao,
      secao: l.secao,
      urna: dados.urna,
      chave_urna: l.chave_publica,
      autoridade_secao: dados.autoridade_secao,
      software: dados.software,
      cedulas: (db("urnas").prepare("SELECT COUNT(*) AS n FROM cedulas WHERE urna_id = ?").get(urna.id) as { n: number }).n,
      aberta_em: new Date().toISOString(),
    },
    l.chave_privada,
  );
  db("urnas").prepare("UPDATE carga SET fase = 'aberta', zeresima = ? WHERE urna_id = ?").run(JSON.stringify(zeresima), urna.id);
  notificarUrna(urna.id);
  registrarEvento("urnas", "ZERESIMA", `seção ${l.secao} aberta — zerésima impressa`);
  return zeresima;
}

// ---------------------------------------------------------------- votação

const MAX_SELOS_POR_CREDENCIAL = 12;
const memoriaSelos = globalThis as unknown as { __taiVoteSelosUrna?: Map<string, number> };
const selosPorCredencial = (memoriaSelos.__taiVoteSelosUrna ??= new Map());

export type SeloUrna = { secao: string; selo: string; codigo: string; figuras: string[] };

function seloGuardado(urnaId: string, secao: string, rastreador: string): SeloUrna {
  const s = db("urnas").prepare("SELECT selo, codigo FROM selos WHERE urna_id = ? AND rastreador = ?").get(urnaId, rastreador) as
    | { selo: string; codigo: string }
    | undefined;
  if (!s) throw new ErroHttp(409, "Cédula sem selo da urna: ela precisa ser lacrada antes");
  return { secao, selo: s.selo, codigo: s.codigo, figuras: nomesDasFiguras(s.selo) };
}

/**
 * Assim que a cédula é lacrada, a urna a sela com a própria chave. Do selo
 * saem as 2 figuras e o código de 12 caracteres. Exige credencial válida da
 * mesa desta seção e assinatura dela no pedido.
 */
export function selarNaUrna(
  pedido: { eleicao?: unknown; rastreador?: unknown; credencial?: { chave?: unknown; assinatura_autoridade?: unknown }; assinatura?: unknown },
  urna: LinhaUrna,
): SeloUrna {
  const { l, ctx } = exigirSecaoAberta(urna.id);
  const chave = pedido.credencial?.chave;
  const assinaturaMesa = pedido.credencial?.assinatura_autoridade;
  if (pedido.eleicao !== ctx.hashEleicao || !ehHex(pedido.rastreador, 32) || !ehHex(chave, 32) || !ehHex(assinaturaMesa) || !ehHex(pedido.assinatura, 64))
    throw new ErroHttp(400, "Pedido de selo malformado");
  if (!verificarAssinaturaRSA(mensagemCredencial(ctx.eleicaoId, chave), assinaturaMesa, ctx.autoridade)) throw new ErroHttp(403, "Credencial inválida");
  let assinaturaOk = false;
  try {
    assinaturaOk = ed25519.verify(hexToBytes(pedido.assinatura), mensagemPedidoSelo(ctx.hashEleicao, pedido.rastreador), hexToBytes(chave));
  } catch {
    assinaturaOk = false;
  }
  if (!assinaturaOk) throw new ErroHttp(403, "Pedido de selo sem assinatura válida da credencial");
  const nullificador = calcularNullificador(chave);
  const d = db("urnas");
  if (d.prepare("SELECT 1 FROM nullificadores WHERE urna_id = ? AND nullificador = ?").get(urna.id, nullificador)) throw new ErroHttp(409, "Esta credencial já votou");
  const chaveContador = `${urna.id}|${nullificador}`;
  const usados = selosPorCredencial.get(chaveContador) ?? 0;
  if (usados >= MAX_SELOS_POR_CREDENCIAL) throw new ErroHttp(429, "Limite de selos desta credencial atingido");
  selosPorCredencial.set(chaveContador, usados + 1);

  const selo = assinarHash(hashSelo(ctx.hashEleicao, pedido.rastreador, l.secao), l.chave_privada);
  const codigo = codigoVerificacao(l.secao, selo);
  const outro = d.prepare("SELECT rastreador FROM selos WHERE urna_id = ? AND codigo = ?").get(urna.id, codigo) as { rastreador: string } | undefined;
  if (outro && outro.rastreador !== pedido.rastreador) throw new ErroHttp(409, "codigo_repetido");
  d.prepare("INSERT OR IGNORE INTO selos (urna_id, rastreador, selo, codigo) VALUES (?, ?, ?, ?)").run(urna.id, pedido.rastreador, selo, codigo);
  return { secao: l.secao, selo, codigo, figuras: nomesDasFiguras(selo) };
}

/** Reconstrói a cédula só com os campos do protocolo — nada extra entra no BU. */
function sanearCedula(c: Cedula): Cedula {
  const prova = (p: ProvaZeroOuUm): ProvaZeroOuUm => ({ a0: p?.a0, b0: p?.b0, a1: p?.a1, b1: p?.b1, c0: p?.c0, c1: p?.c1, z0: p?.z0, z1: p?.z1 });
  return {
    eleicao: c?.eleicao,
    credencial: { chave: c?.credencial?.chave, assinatura_autoridade: c?.credencial?.assinatura_autoridade },
    escolhas: Array.isArray(c?.escolhas) ? c.escolhas.map((e) => ({ a: e?.a, b: e?.b, prova: prova(e?.prova) })) : [],
    prova_soma: { t1: c?.prova_soma?.t1, t2: c?.prova_soma?.t2, z: c?.prova_soma?.z },
    assinatura: c?.assinatura,
  };
}

function assinarRecibo(tipo: TipoRecibo, l: LinhaCarga, eleicao: string, rastreador: string): Recibo {
  return { tipo, eleicao, secao: l.secao, rastreador, assinatura: assinarHash(hashRecibo(tipo, eleicao, l.secao, rastreador), l.chave_privada) };
}

/**
 * Guarda a cédula na memória da urna e soma 1 no contador da opção (o contador
 * vira a contagem impressa no BU, como na urna de hoje). A cédula fica numa
 * tabela sem ordem e sem horário.
 */
export function depositarNaUrna(bruta: Cedula, opcaoContada: unknown, urna: LinhaUrna): Recibo {
  const { l, ctx } = exigirSecaoAberta(urna.id);
  const cedula = sanearCedula(bruta);
  const v = verificarCedula(cedula, ctx);
  if (!v.ok) {
    registrarEvento("urnas", "CEDULA_REJEITADA", v.erros.join("; "));
    throw new ErroHttp(422, "Cédula rejeitada", v.erros);
  }
  const opcao = Number(opcaoContada);
  if (!Number.isInteger(opcao) || opcao < 0 || opcao >= ctx.nOpcoes) throw new ErroHttp(400, "Opção inválida");
  const rastreador = calcularRastreador(ctx.hashEleicao, cedula.escolhas);
  const nullificador = calcularNullificador(cedula.credencial.chave);
  const publicada: CedulaPublicada = { ...cedula, rastreador, nullificador, ...seloGuardado(urna.id, l.secao, rastreador) };
  const d = db("urnas");
  d.transaction(() => {
    if (d.prepare("SELECT 1 FROM nullificadores WHERE urna_id = ? AND nullificador = ?").get(urna.id, nullificador))
      throw new ErroHttp(409, "Esta credencial já foi usada para votar");
    if (d.prepare("SELECT 1 FROM cedulas WHERE urna_id = ? AND rastreador = ?").get(urna.id, rastreador)) throw new ErroHttp(409, "Cédula repetida");
    d.prepare("INSERT INTO nullificadores (urna_id, nullificador) VALUES (?, ?)").run(urna.id, nullificador);
    d.prepare("INSERT INTO cedulas (urna_id, rastreador, tipo, conteudo) VALUES (?, ?, 'cedula', ?)").run(urna.id, rastreador, JSON.stringify(publicada));
    d.prepare("INSERT INTO contagem (urna_id, opcao, votos) VALUES (?, ?, 1) ON CONFLICT(urna_id, opcao) DO UPDATE SET votos = votos + 1").run(urna.id, opcao);
  })();
  // deliberadamente sem evento por cédula: um log com horário por voto recriaria a ordem de chegada
  return assinarRecibo("RECIBO_CEDULA", l, ctx.hashEleicao, rastreador);
}

/**
 * Cédula de teste (desafio de Benaloh): a urna guarda a abertura para o BU e
 * assina a DECLARAÇÃO do que mostrou ao eleitor. Uma urna honesta declara a
 * opção aberta; uma adulterada que mentir na tela deixa a mentira assinada.
 */
export function testarNaUrna(
  bruta: CedulaDesafiada,
  opcaoDeclarada: unknown,
  urna: LinhaUrna,
  sementeImpressa?: unknown,
): { recibo: Recibo; declaracao: DeclaracaoTeste } {
  const { l, ctx } = exigirSecaoAberta(urna.id);
  const d: CedulaDesafiada = {
    eleicao: bruta?.eleicao,
    cifras: Array.isArray(bruta?.cifras) ? bruta.cifras.map((c) => ({ a: c?.a, b: c?.b })) : [],
    revelacao: { opcao: Number(bruta?.revelacao?.opcao), semente: String(bruta?.revelacao?.semente ?? "") },
    rastreador: String(bruta?.rastreador ?? ""),
  };
  const v = verificarDesafiada(d, ctx);
  if (!v.ok) throw new ErroHttp(422, "Cédula de teste inconsistente", v.erros);
  const opcao = Number(opcaoDeclarada);
  if (!Number.isInteger(opcao) || opcao < 0 || opcao >= ctx.nOpcoes) throw new ErroHttp(400, "Opção declarada inválida");
  // a chave que sai impressa: a urna oficial imprime a verdadeira (o laboratório pode imprimir outra)
  const semente = sementeImpressa === undefined || sementeImpressa === null || sementeImpressa === "" ? d.revelacao.semente : String(sementeImpressa);
  if (!ehHex(semente, 16)) throw new ErroHttp(400, "Chave do teste inválida");
  Object.assign(d, seloGuardado(urna.id, l.secao, d.rastreador));
  const banco = db("urnas");
  // LABORATÓRIO: um software adulterado pode "esquecer" de guardar a cédula de teste no BU
  const parametros = urna.firmware_parametros ? (JSON.parse(urna.firmware_parametros) as ParametrosFirmware) : undefined;
  if (!omiteTeste(urna.firmware, parametros)) {
    banco.transaction(() => {
      if (banco.prepare("SELECT 1 FROM cedulas WHERE urna_id = ? AND rastreador = ?").get(urna.id, d.rastreador)) throw new ErroHttp(409, "Teste já registrado");
      banco.prepare("INSERT INTO cedulas (urna_id, rastreador, tipo, conteudo) VALUES (?, ?, 'desafiada', ?)").run(urna.id, d.rastreador, JSON.stringify(d));
    })();
  }
  const declaracao: DeclaracaoTeste = {
    tipo: "DECLARACAO_TESTE",
    eleicao: ctx.hashEleicao,
    secao: l.secao,
    rastreador: d.rastreador,
    opcao,
    semente,
    assinatura: assinarHash(hashDeclaracaoTeste(ctx.hashEleicao, l.secao, d.rastreador, opcao, semente), l.chave_privada),
  };
  return { recibo: assinarRecibo("RECIBO_DESAFIO", l, ctx.hashEleicao, d.rastreador), declaracao };
}

// ------------------------------------------------------------ encerramento

/**
 * O mesário encerra a seção: a urna monta o BU — contagem impressa, todas as
 * cédulas na ordem do rastreador e a soma homomórfica — e assina.
 */
export function encerrarSecao(urna: LinhaUrna): DocumentoUrna<BoletimUrna> {
  const { l, dados, ctx } = secaoNaFase(urna.id, "aberta");
  const d = db("urnas");
  const itens = d.prepare("SELECT tipo, conteudo FROM cedulas WHERE urna_id = ? ORDER BY rastreador").all(urna.id) as { tipo: string; conteudo: string }[];
  const cedulas = itens.filter((i) => i.tipo === "cedula").map((i) => JSON.parse(i.conteudo) as CedulaPublicada);
  const desafiadas = itens.filter((i) => i.tipo === "desafiada").map((i) => JSON.parse(i.conteudo) as CedulaDesafiada);
  const contador = new Map(
    (d.prepare("SELECT opcao, votos FROM contagem WHERE urna_id = ?").all(urna.id) as { opcao: number; votos: number }[]).map((x) => [x.opcao, x.votos]),
  );
  const zeresima = JSON.parse(l.zeresima!) as DocumentoUrna<ZeresimaSecao>;
  const bu = assinarDocumentoUrna<BoletimUrna>(
    {
      tipo: "BU",
      eleicao: ctx.hashEleicao,
      secao: l.secao,
      zeresima: zeresima.hash,
      comparecimento: credenciaisEmitidas(urna.id),
      cedulas,
      desafiadas,
      contagem: dados.opcoes.map((_, opcao) => ({ opcao, votos: contador.get(opcao) ?? 0 })),
      agregado: agregarCedulas(cedulas, ctx.nOpcoes).map(cifraParaHex),
      encerrada_em: new Date().toISOString(),
    },
    l.chave_privada,
  );
  d.prepare("UPDATE carga SET fase = 'encerrada', bu = ? WHERE urna_id = ?").run(JSON.stringify(bu), urna.id);
  notificarUrna(urna.id);
  registrarEvento("urnas", "BU", `seção ${l.secao} encerrada — BU impresso com ${cedulas.length} cédulas`);
  return bu;
}

/** A mídia de resultado: o que vai num pen drive (ou pela rede de transmissão) para o TSE. */
export function midiaDaSecao(urnaId: string): MidiaSecao {
  const { l } = secaoNaFase(urnaId, "encerrada", "transmitida");
  return { formato: "tai-vote/midia-secao/v1", zeresima: JSON.parse(l.zeresima!), bu: JSON.parse(l.bu!) };
}

export function marcarTransmitida(urnaId: string, bloco: number) {
  db("urnas").prepare("UPDATE carga SET fase = 'transmitida', bloco = ? WHERE urna_id = ?").run(bloco, urnaId);
  notificarUrna(urnaId);
}

/** Mídia recebida por arquivo: marca a urna local correspondente (se estiver neste computador). */
export function marcarTransmitidaPorMidia(midia: MidiaSecao, bloco: number) {
  const l = db("urnas")
    .prepare("SELECT urna_id FROM carga WHERE secao = ? AND chave_publica = ?")
    .get(midia.bu.conteudo.secao, midia.zeresima.conteudo.chave_urna) as { urna_id: string } | undefined;
  if (l) marcarTransmitida(l.urna_id, bloco);
}

/** Visão geral para o administrador do laboratório: fase e volume de cada urna. */
export function resumoDasUrnas(eleicaoId: string | undefined) {
  const linhas = db("urnas").prepare("SELECT urna_id, eleicao_id, secao, fase, bloco FROM carga ORDER BY secao").all() as Pick<
    LinhaCarga,
    "urna_id" | "eleicao_id" | "secao" | "fase" | "bloco"
  >[];
  const contar = db("urnas").prepare("SELECT tipo, COUNT(*) AS n FROM cedulas WHERE urna_id = ? GROUP BY tipo");
  return linhas
    .filter((l) => l.eleicao_id === eleicaoId)
    .map((l) => {
      const c = Object.fromEntries((contar.all(l.urna_id) as { tipo: string; n: number }[]).map((x) => [x.tipo, x.n]));
      return { urna_id: l.urna_id, secao: l.secao, fase: l.fase, bloco: l.bloco, cedulas: c.cedula ?? 0, desafiadas: c.desafiada ?? 0 };
    });
}

/** Laboratório: a chave privada da urna (só para simular um insider que a extraiu do hardware). */
export function chavePrivadaDaUrnaPorSecao(secao: string): string | null {
  return (db("urnas").prepare("SELECT chave_privada FROM carga WHERE secao = ?").get(secao) as { chave_privada: string } | undefined)?.chave_privada ?? null;
}
