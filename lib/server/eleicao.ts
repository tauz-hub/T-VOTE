// TSE — quadro nacional. Orquestra as fases da eleição:
//
//   configuracao → (3 chaves de trustee) → aberta → encerrada → (3 decifrações) → apurada
//
// Com a eleição aberta, cada urna recebe a CARGA (a chave pública dela entra no
// quadro) e depois vota OFFLINE. O quadro só volta a ouvir a seção quando a
// mídia (zerésima + BU) chega, depois do encerramento da seção — e recusa
// mídia que não confira com a carga.
//
// O administrador cria, abre e encerra. Ele NÃO consegue apurar: isso exige
// que os três trustees decifrem os agregados com as próprias chaves.
import { type Nacional, cargasDosBlocos, combinarDecifracoes, conferirMidiaSecao, nacionalDosBlocos, secoesDosBlocos } from "../auditoria";
import { bytesToHex, bytesAleatorios, chavesExatas, ehHex } from "../crypto/codificacao";
import { cifraDeHex, combinarChaves } from "../crypto/elgamal";
import { G, pontoDeHex, pontoHex } from "../crypto/grupo";
import { verificarConhecimento, verificarIgualdadeLog } from "../crypto/provas";
import {
  type Bloco,
  type Contagem,
  type ConteudoCarga,
  type ConteudoChaveTrustee,
  type ConteudoDecriptacao,
  NUM_TRUSTEES,
  type Opcao,
  VERSAO_PROTOCOLO,
  calcularHashEleicao,
  contextoDecriptacao,
  contextoTrustee,
  versaoProtocolo,
} from "../crypto/quadro";
import { type MidiaSecao, somarContagens } from "../crypto/secao";
import { MAX_CANDIDATOS } from "../padroes";
import type { EstadoPublico } from "../tipos-api";
import { credenciaisEmitidas } from "./autoridade";
import { notificarTodasUrnas } from "./avisos";
import { recriarBanco, registrarEvento } from "./db";
import { resolverFoto } from "./fotos";
import { ErroHttp } from "./http";
import { anexarBloco, atualizarEstado, blocosDoTipo, criarChaveQuadro, estadoInterno, listarBlocos, ultimoBloco } from "./quadro";
import { estatisticasRegistro, invalidarHabilitacoesPendentes, reiniciarComparecimento } from "./registro";
import type { DadosNacionais } from "./secao";
import { compararSoftware, hashDoSoftware, hashDoSoftwareAtual } from "./software";

export function exigirFase(...fases: string[]) {
  const e = estadoInterno();
  if (!e) throw new ErroHttp(409, "Nenhuma eleição criada");
  if (!fases.includes(e.fase)) throw new ErroHttp(409, `Operação não permitida na fase "${e.fase}"`);
  return e;
}

function genese(): Bloco<"GENESE"> {
  const g = blocosDoTipo("GENESE")[0];
  if (!g) throw new ErroHttp(409, "Nenhuma eleição criada");
  return g;
}

function nacionalAtual(): Nacional {
  exigirFase("aberta", "encerrada", "apurada");
  const n = nacionalDosBlocos(listarBlocos());
  if (!n) throw new ErroHttp(409, "Eleição sem abertura");
  return n;
}

// ------------------------------------------------------------------ criação

export function criarEleicao(dados: { nome?: unknown; candidatos?: unknown }) {
  const nome = String(dados.nome ?? "").trim();
  if (nome.length < 3 || nome.length > 100) throw new ErroHttp(400, "Nome da eleição deve ter entre 3 e 100 caracteres");
  const candidatos = Array.isArray(dados.candidatos) ? dados.candidatos : [];
  if (candidatos.length < 2 || candidatos.length > MAX_CANDIDATOS) throw new ErroHttp(400, `Informe entre 2 e ${MAX_CANDIDATOS} candidatos`);
  const numeros = new Set<string>();
  const opcoes: Opcao[] = candidatos.map((c) => {
    const numero = String((c as { numero?: unknown }).numero ?? "").trim();
    const nomeC = String((c as { nome?: unknown }).nome ?? "").trim();
    const partido = String((c as { partido?: unknown }).partido ?? "").trim();
    if (!/^\d{2}$/.test(numero)) throw new ErroHttp(400, `Número de candidato inválido: "${numero}" (use 2 dígitos)`);
    if (numeros.has(numero)) throw new ErroHttp(400, `Número repetido: ${numero}`);
    if (nomeC.length < 2 || nomeC.length > 60) throw new ErroHttp(400, "Nome de candidato inválido");
    if (partido.length > 30) throw new ErroHttp(400, "Nome de partido longo demais");
    numeros.add(numero);
    const foto = resolverFoto((c as { foto?: unknown }).foto);
    return { numero, nome: nomeC, ...(partido ? { partido } : {}), ...(foto ? { foto } : {}), tipo: "candidato" };
  });
  opcoes.push({ numero: null, nome: "Branco", tipo: "branco" }, { numero: null, nome: "Nulo", tipo: "nulo" });

  const eleicao_id = bytesToHex(bytesAleatorios(8));
  recriarBanco("boletim");
  recriarBanco("urnas"); // as urnas precisam de carga nova
  recriarBanco("autoridade");
  reiniciarComparecimento();
  const chave = criarChaveQuadro(eleicao_id);
  atualizarEstado({ eleicao_id, fase: "configuracao", hash_eleicao: null, chave_publica: null });
  anexarBloco("GENESE", {
    versao_protocolo: VERSAO_PROTOCOLO,
    eleicao_id,
    nome,
    opcoes,
    grupo: "ristretto255",
    trustees_necessarios: NUM_TRUSTEES,
    chave_quadro: chave.publica,
    software: hashDoSoftware(),
  });
  notificarTodasUrnas();
  registrarEvento("boletim", "ELEICAO_CRIADA", `"${nome}" — ${opcoes.length} opções`);
  return { eleicao_id };
}

export function registrarChaveTrustee(c: Partial<ConteudoChaveTrustee>) {
  exigirFase("configuracao");
  const g = genese().conteudo;
  const trustee = Number(c.trustee);
  if (![1, 2, 3].includes(trustee)) throw new ErroHttp(400, "Trustee deve ser 1, 2 ou 3");
  if (blocosDoTipo("CHAVE_TRUSTEE").some((b) => b.conteudo.trustee === trustee)) throw new ErroHttp(409, `Trustee ${trustee} já registrou a chave`);
  const nome = String(c.nome ?? `Trustee ${"ABC"[trustee - 1]}`).trim().slice(0, 40) || `Trustee ${"ABC"[trustee - 1]}`;
  if (!ehHex(c.chave_publica, 32) || !c.prova || !chavesExatas(c.prova, ["t", "z"])) throw new ErroHttp(400, "Chave ou prova malformada");
  let ok = false;
  try {
    ok = verificarConhecimento(pontoDeHex(c.chave_publica), c.prova, contextoTrustee(g.eleicao_id, trustee));
  } catch {
    ok = false;
  }
  if (!ok) throw new ErroHttp(422, "Prova de conhecimento da chave inválida");
  anexarBloco("CHAVE_TRUSTEE", { trustee, nome, chave_publica: c.chave_publica, prova: { t: c.prova.t, z: c.prova.z } });
  registrarEvento("boletim", "CHAVE_TRUSTEE", `trustee ${trustee} publicou a chave pública`);
}

export function abrirEleicao() {
  exigirFase("configuracao");
  const trustees = blocosDoTipo("CHAVE_TRUSTEE").map((b) => b.conteudo);
  if (trustees.length !== NUM_TRUSTEES) throw new ErroHttp(409, `Faltam chaves de trustees (${trustees.length}/3)`);
  const chave = pontoHex(combinarChaves(trustees.map((t) => pontoDeHex(t.chave_publica))));
  const hash_eleicao = calcularHashEleicao(genese().hash, trustees, chave);
  anexarBloco("ABERTURA", { chave_publica_conjunta: chave, hash_eleicao, zeresima: { secoes_recebidas: 0 } });
  atualizarEstado({ fase: "aberta", hash_eleicao, chave_publica: chave });
  notificarTodasUrnas(); // as urnas já podem receber a carga
  registrarEvento("boletim", "ELEICAO_ABERTA", "chave da eleição publicada — urnas podem receber a carga");
}

// ------------------------------------------------------------------- carga

/** Dados PÚBLICOS que vão na carga da urna. Nada aqui é segredo do TSE. */
export function dadosParaCarga(): DadosNacionais {
  const e = exigirFase("aberta");
  const g = genese().conteudo;
  if (versaoProtocolo(g) !== VERSAO_PROTOCOLO) throw new ErroHttp(409, "Eleição criada com uma versão antiga do protocolo — crie uma nova eleição");
  return { eleicao_id: g.eleicao_id, nome: g.nome, hash_eleicao: e.hash_eleicao!, chave_publica: e.chave_publica!, opcoes: g.opcoes, software: g.software.hash };
}

export function verificarCargaPossivel(secao: string) {
  exigirFase("aberta");
  if (secoesDosBlocos(listarBlocos()).some((b) => b.conteudo.secao === secao)) throw new ErroHttp(409, `A seção ${secao} já transmitiu a mídia`);
}

/** Publica as chaves públicas da urna e da mesa antes do primeiro voto. */
export function registrarCarga(c: ConteudoCarga) {
  verificarCargaPossivel(c.secao);
  const b = anexarBloco("CARGA", c);
  registrarEvento("boletim", "CARGA", `seção ${c.secao}: chave da urna ${c.chave_urna.slice(0, 16)}… publicada`);
  return b;
}

// ------------------------------------------------------------ mídia da seção

/**
 * Recebe a mídia de uma seção (transmitida ou levada em pen drive). Confere
 * TUDO contra a carga — assinatura da urna, credenciais, provas, selos, contagem,
 * soma — e só então publica. Mídia que não confere é recusada com os motivos.
 */
export async function receberMidia(bruta: MidiaSecao): Promise<Bloco<"SECAO">> {
  exigirFase("aberta");
  const n = nacionalAtual();
  const doc = (d: { conteudo?: unknown; hash?: unknown; assinatura?: unknown } | undefined) => ({ conteudo: d?.conteudo, hash: d?.hash, assinatura: d?.assinatura });
  const midia = { zeresima: doc(bruta?.zeresima), bu: doc(bruta?.bu) } as unknown as Pick<MidiaSecao, "zeresima" | "bu">;
  const secao = String(midia.bu?.conteudo?.secao ?? "");
  if (bruta?.formato !== "t-vote/midia-secao/v1" || !/^\d{3}-\d{4}$/.test(secao)) throw new ErroHttp(400, "Arquivo não é uma mídia de seção do T-VOTE");
  const blocos = listarBlocos();
  const carga = cargasDosBlocos(blocos).get(secao);
  if (!carga) throw new ErroHttp(409, `A seção ${secao} não tem carga publicada — mídia de urna desconhecida`);
  if (secoesDosBlocos(blocos).some((b) => b.conteudo.secao === secao)) throw new ErroHttp(409, `A mídia da seção ${secao} já foi recebida`);
  const problemas: string[] = [];
  await conferirMidiaSecao(midia, carga.carga, n, (_, msg) => problemas.push(msg));
  if (problemas.length) {
    registrarEvento("boletim", "MIDIA_RECUSADA", `seção ${secao}: ${problemas.length} problema(s)`);
    throw new ErroHttp(422, `Mídia da seção ${secao} recusada`, problemas.slice(0, 8));
  }
  const b = anexarBloco("SECAO", { secao, zeresima: midia.zeresima, bu: midia.bu });
  registrarEvento("boletim", "MIDIA_RECEBIDA", `seção ${secao}: ${midia.bu.conteudo.cedulas.length} cédulas no bloco ${b.numero}`);
  return b;
}

// ------------------------------------------------------------- encerramento

export function encerrarEleicao() {
  exigirFase("aberta");
  const blocos = listarBlocos();
  const secoes = secoesDosBlocos(blocos);
  const cargas = cargasDosBlocos(blocos);
  const recebidas = new Set(secoes.map((b) => b.conteudo.secao));
  anexarBloco("ENCERRAMENTO", {
    secoes: secoes.map((b) => ({
      secao: b.conteudo.secao,
      bu: b.conteudo.bu.hash,
      cedulas: b.conteudo.bu.conteudo.cedulas.length,
      desafiadas: b.conteudo.bu.conteudo.desafiadas.length,
    })),
    secoes_sem_midia: [...cargas.keys()].filter((s) => !recebidas.has(s)).sort(),
    total_cedulas: secoes.reduce((s, b) => s + b.conteudo.bu.conteudo.cedulas.length, 0),
    total_desafiadas: secoes.reduce((s, b) => s + b.conteudo.bu.conteudo.desafiadas.length, 0),
  });
  invalidarHabilitacoesPendentes();
  atualizarEstado({ fase: "encerrada" });
  notificarTodasUrnas();
  registrarEvento("boletim", "ELEICAO_ENCERRADA", `${secoes.length} seção(ões) recebidas`);
}

/** Seções que ainda não transmitiram (para avisar antes de encerrar). */
export function secoesSemMidia(): string[] {
  const blocos = listarBlocos();
  const recebidas = new Set(secoesDosBlocos(blocos).map((b) => b.conteudo.secao));
  return [...cargasDosBlocos(blocos).keys()].filter((s) => !recebidas.has(s)).sort();
}

export function receberDecifracaoParcial(c: Partial<ConteudoDecriptacao>) {
  exigirFase("encerrada");
  const n = nacionalAtual();
  const trustee = Number(c.trustee);
  const t = blocosDoTipo("CHAVE_TRUSTEE").find((b) => b.conteudo.trustee === trustee)?.conteudo;
  if (!t) throw new ErroHttp(400, "Trustee desconhecido");
  if (blocosDoTipo("DECRIPTACAO_PARCIAL").some((b) => b.conteudo.trustee === trustee)) throw new ErroHttp(409, `Trustee ${trustee} já enviou a decifração`);
  const secoes = blocosDoTipo("SECAO");
  if (!Array.isArray(c.secoes) || c.secoes.length !== secoes.length) throw new ErroHttp(400, "Decifração deve trazer todas as seções recebidas");
  const hi = pontoDeHex(t.chave_publica);
  const limpas = secoes.map((b) => {
    const s = c.secoes!.find((x) => x?.secao === b.conteudo.secao);
    if (!s || !Array.isArray(s.parciais) || s.parciais.length !== n.nOpcoes) throw new ErroHttp(400, `Decifração da seção ${b.conteudo.secao} ausente ou malformada`);
    const agregado = b.conteudo.bu.conteudo.agregado;
    return {
      secao: b.conteudo.secao,
      parciais: s.parciais.map((p, j) => {
        const limpa = { d: p?.d, prova: { t1: p?.prova?.t1, t2: p?.prova?.t2, z: p?.prova?.z } };
        let ok = false;
        try {
          ok = verificarIgualdadeLog(G, hi, cifraDeHex(agregado[j]).a, pontoDeHex(limpa.d), limpa.prova, contextoDecriptacao(n.hashEleicao, b.conteudo.secao, trustee, j));
        } catch {
          ok = false;
        }
        if (!ok) throw new ErroHttp(422, `Prova de decifração inválida na seção ${b.conteudo.secao}, opção ${j}`);
        return limpa;
      }),
    };
  });
  anexarBloco("DECRIPTACAO_PARCIAL", { trustee, secoes: limpas });
  registrarEvento("boletim", "DECIFRACAO_PARCIAL", `trustee ${trustee}: ${limpas.length} seção(ões)`);

  const todas = blocosDoTipo("DECRIPTACAO_PARCIAL").map((b) => b.conteudo);
  if (todas.length === NUM_TRUSTEES) {
    const porSecao = secoes.map((b) => {
      const bu = b.conteudo.bu.conteudo;
      const parciais = todas.map((p) => p.secoes.find((x) => x.secao === b.conteudo.secao)!.parciais);
      const m = combinarDecifracoes(bu.agregado.map(cifraDeHex), parciais, bu.cedulas.length);
      if (m.some((x) => x === null)) throw new ErroHttp(500, `Combinação das decifrações falhou na seção ${b.conteudo.secao}`);
      return { secao: b.conteudo.secao, contagem: m.map((votos, opcao) => ({ opcao, votos: votos! })) as Contagem };
    });
    const total = somarContagens(
      porSecao.map((s) => s.contagem),
      n.nOpcoes,
    );
    anexarBloco("RESULTADO", { secoes: porSecao, contagem: total, total: total.reduce((s, x) => s + x.votos, 0) });
    atualizarEstado({ fase: "apurada" });
    registrarEvento("boletim", "RESULTADO_PUBLICADO", "apuração concluída pelos 3 trustees, seção por seção");
  }
}

// ------------------------------------------------------------ leitura pública

export function pacotePublico() {
  return { formato: "t-vote/pacote/v1" as const, exportado_em: new Date().toISOString(), blocos: listarBlocos() };
}

export function estadoPublico(): EstadoPublico {
  const reg = estatisticasRegistro();
  const base: EstadoPublico = {
    existe: false,
    trustees: [],
    decifracoes: [],
    secoes: [],
    estatisticas: {
      eleitores: reg.total,
      aptos: reg.aptos,
      habilitados: reg.habilitados,
      credenciados: reg.credenciados,
      credenciais_emitidas: 0,
      secoes_carregadas: 0,
      secoes_transmitidas: 0,
      cedulas_publicadas: 0,
      desafiadas_publicadas: 0,
      blocos: 0,
    },
  };
  const e = estadoInterno();
  const g = blocosDoTipo("GENESE")[0];
  if (!e || !g) return base;
  const blocos = listarBlocos();
  const secoes = secoesDosBlocos(blocos);
  const cargas = cargasDosBlocos(blocos);
  const cabeca = ultimoBloco()!;
  const resultado = blocosDoTipo("RESULTADO")[0]?.conteudo;
  const c = compararSoftware(g.conteudo.software, hashDoSoftwareAtual());
  const transmitidas = new Map(secoes.map((b) => [b.conteudo.secao, b]));
  return {
    ...base,
    existe: true,
    eleicao_id: e.eleicao_id,
    nome: g.conteudo.nome,
    fase: e.fase,
    opcoes: g.conteudo.opcoes,
    hash_eleicao: e.hash_eleicao,
    chave_publica: e.chave_publica,
    chave_quadro: g.conteudo.chave_quadro,
    software: g.conteudo.software.hash,
    software_confere: c.confere,
    software_alterados: c.alterados,
    versao_protocolo: versaoProtocolo(g.conteudo),
    trustees: blocosDoTipo("CHAVE_TRUSTEE").map((b) => ({ trustee: b.conteudo.trustee, nome: b.conteudo.nome, chave_publica: b.conteudo.chave_publica })),
    decifracoes: blocosDoTipo("DECRIPTACAO_PARCIAL").map((b) => b.conteudo.trustee),
    secoes: [...new Set([...cargas.keys(), ...transmitidas.keys()])].sort().map((secao) => {
      const b = transmitidas.get(secao);
      return {
        secao,
        urna: cargas.get(secao)?.carga.urna ?? "",
        transmitida: !!b,
        ...(b ? { bloco: b.numero, cedulas: b.conteudo.bu.conteudo.cedulas.length, desafiadas: b.conteudo.bu.conteudo.desafiadas.length } : {}),
      };
    }),
    estatisticas: {
      ...base.estatisticas,
      credenciais_emitidas: credenciaisEmitidas(),
      secoes_carregadas: cargas.size,
      secoes_transmitidas: secoes.length,
      cedulas_publicadas: secoes.reduce((s, b) => s + b.conteudo.bu.conteudo.cedulas.length, 0),
      desafiadas_publicadas: secoes.reduce((s, b) => s + b.conteudo.bu.conteudo.desafiadas.length, 0),
      blocos: cabeca.numero,
    },
    cabeca: { numero: cabeca.numero, hash: cabeca.hash, tipo: cabeca.tipo },
    resultado: resultado?.contagem.map((x) => ({ opcao: g.conteudo.opcoes[x.opcao], votos: x.votos })),
  };
}
