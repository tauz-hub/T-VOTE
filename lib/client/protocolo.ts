"use client";

// Passos do protocolo executados no navegador (urna, trustees, simulação).
//
// A urna trabalha OFFLINE: só conversa com a própria memória e com a mesa
// (/api/urna/* e /api/autoridade/* com o token da urna) e usa apenas os dados da
// carga. O navegador nunca envia: a aleatoriedade da cifração (exceto na cédula
// de teste, que é aberta de propósito), a chave privada da credencial nem as
// chaves privadas dos trustees.
import type { Pacote } from "../auditoria";
import {
  type Cedula,
  type CedulaDesafiada,
  type ContextoCedula,
  assinarCedula,
  assinarPedidoSelo,
  montarDesafiada,
  prepararCedula,
} from "../crypto/cedula";
import { inteiroAleatorio } from "../crypto/codificacao";
import { type Credencial, finalizarCredencial, iniciarCredencial } from "../crypto/credencial";
import { codigoVerificacao, nomesDasFiguras } from "../crypto/palavras";
import { type Recibo, verificarRecibo, verificarSelo } from "../crypto/quadro";
import { type DeclaracaoTeste, verificarDeclaracaoTeste } from "../crypto/secao";
import type { CargaUrna, EstadoUrnaApi } from "../tipos-api";
import { api } from "./api";

export function contextoDaCarga(carga: CargaUrna): ContextoCedula {
  return {
    eleicaoId: carga.eleicao_id,
    hashEleicao: carga.hash_eleicao,
    chavePublica: carga.chave_publica,
    nOpcoes: carga.opcoes.length,
    autoridade: carga.autoridade_secao,
  };
}

const cabecalho = (urnaToken: string) => ({ "x-urna-token": urnaToken });

export async function estadoDaUrna(urnaToken: string): Promise<EstadoUrnaApi> {
  return api<EstadoUrnaApi>("/api/urna/estado", undefined, cabecalho(urnaToken));
}

export type RegistroCredencial = { credencial: Credencial; mensagemCega: string };

/**
 * Gera a credencial efêmera, cega, pede a assinatura à mesa da seção e descega.
 * Autorização: a liberação do mesário para esta urna ou, em contingência, um código.
 */
export async function obterCredencial(urnaToken: string, carga: CargaUrna, codigo?: string): Promise<RegistroCredencial> {
  const ctx = contextoDaCarga(carga);
  const pedido = iniciarCredencial(ctx.eleicaoId, ctx.autoridade);
  const { assinatura_cega } = await api<{ assinatura_cega: string }>(
    "/api/autoridade/credencial",
    codigo ? { codigo, mensagem_cega: pedido.cega } : { mensagem_cega: pedido.cega },
    cabecalho(urnaToken),
  );
  return { credencial: finalizarCredencial(pedido, assinatura_cega, ctx.autoridade), mensagemCega: pedido.cega };
}

/** O que a urna mostra ao eleitor e o BU grava: seção, selo, código de 12 caracteres e 2 figuras. */
export type Verificacao = { secao: string; selo: string; codigo: string; figuras: string[] };

/**
 * Assim que a cédula é lacrada, a urna a sela com a própria chave. Confere tudo
 * antes de mostrar: a assinatura (com a chave da carga) e que o código e as
 * figuras são mesmo os do selo.
 */
export async function pedirSelo(rastreador: string, credencial: Credencial, carga: CargaUrna, urnaToken: string): Promise<Verificacao> {
  const v = await api<Verificacao>(
    "/api/urna/selar",
    {
      eleicao: carga.hash_eleicao,
      rastreador,
      credencial: { chave: credencial.chave, assinatura_autoridade: credencial.assinatura_autoridade },
      assinatura: assinarPedidoSelo(carga.hash_eleicao, rastreador, credencial.privada),
    },
    cabecalho(urnaToken),
  );
  if (
    v.secao !== carga.secao ||
    !verificarSelo(carga.hash_eleicao, rastreador, v.secao, v.selo, carga.chave_urna) ||
    v.codigo !== codigoVerificacao(v.secao, v.selo) ||
    v.figuras.join("|") !== nomesDasFiguras(v.selo).join("|")
  )
    throw new Error("A memória da urna devolveu um selo inválido");
  return v;
}

/** Cifra a opção e sela. Se o código de verificação sair repetido na seção, cifra de novo. */
export async function lacrarCedula(ctx: ContextoCedula, credencial: Credencial, carga: CargaUrna, urnaToken: string, opcao: number) {
  for (let tentativa = 0; ; tentativa++) {
    const preparada = prepararCedula(ctx, credencial.chave, opcao);
    try {
      return { preparada, verificacao: await pedirSelo(preparada.rastreador, credencial, carga, urnaToken) };
    } catch (e) {
      if (!(e instanceof Error && e.message === "codigo_repetido") || tentativa >= 3) throw e;
    }
  }
}

/** Deposita na memória da urna. `opcaoContada` vai para o contador que vira o BU impresso. */
export async function depositarCedula(cedula: Cedula, opcaoContada: number, carga: CargaUrna, urnaToken: string): Promise<Recibo> {
  const { recibo } = await api<{ recibo: Recibo }>("/api/urna/cedula", { cedula, opcao: opcaoContada }, cabecalho(urnaToken));
  if (!verificarRecibo(recibo, carga.chave_urna)) throw new Error("Recibo com assinatura inválida da urna");
  return recibo;
}

/** Registra a cédula de teste e a declaração (assinada) do que a urna mostrou ao eleitor. */
export async function enviarDesafio(
  desafiada: CedulaDesafiada,
  opcaoDeclarada: number,
  carga: CargaUrna,
  urnaToken: string,
  sementeImpressa?: string,
): Promise<{ recibo: Recibo; declaracao: DeclaracaoTeste }> {
  const r = await api<{ recibo: Recibo; declaracao: DeclaracaoTeste }>(
    "/api/urna/desafio",
    { desafiada, opcao_declarada: opcaoDeclarada, ...(sementeImpressa ? { semente_impressa: sementeImpressa } : {}) },
    cabecalho(urnaToken),
  );
  if (!verificarRecibo(r.recibo, carga.chave_urna) || !verificarDeclaracaoTeste(r.declaracao, carga.chave_urna))
    throw new Error("Recibo ou declaração com assinatura inválida da urna");
  return r;
}

export async function baixarPacote(): Promise<Pacote> {
  const r = await fetch("/api/publico/pacote", { cache: "no-store" });
  if (!r.ok) throw new Error(`Falha ao baixar pacote (${r.status})`);
  return (await r.json()) as Pacote;
}

/**
 * Urna usada pela simulação do Admin: instalada uma vez (zona 001, seção 9999,
 * para não se misturar às seções reais), com carga e seção abertas.
 */
export async function urnaDeSimulacao(): Promise<{ token: string; carga: CargaUrna }> {
  const CHAVE = "tai-vote:simulacao:urna";
  let token = typeof localStorage !== "undefined" ? localStorage.getItem(CHAVE) : null;
  let estado = token ? await estadoDaUrna(token).catch(() => null) : null;
  if (!token || !estado) {
    const u = await api<{ token: string }>("/api/urna/instalar", { nome: "Urna de simulação", zona: "001", secao: "9999" });
    token = u.token;
    localStorage.setItem(CHAVE, token);
    estado = await estadoDaUrna(token);
  }
  if (!estado.carga) {
    await api("/api/urna/carga", {}, cabecalho(token));
    estado = await estadoDaUrna(token);
  }
  if (estado.carga?.fase === "carregada") {
    await api("/api/mesario/secao", { urna_id: estado.id, acao: "abrir" });
    estado = await estadoDaUrna(token);
  }
  if (!estado.carga || estado.carga.fase !== "aberta") throw new Error(`A seção de simulação está "${estado.carga?.fase ?? "sem carga"}" — use outra eleição`);
  return { token, carga: estado.carga };
}

/**
 * Simula o fluxo completo de um eleitor pelas MESMAS rotas que as telas usam:
 * mesário habilita → urna obtém credencial → (às vezes) testa → deposita.
 */
export async function simularEleitor(
  eleitorId: number,
  probabilidadeTeste: number,
  urna: { token: string; carga: CargaUrna },
): Promise<{ testou: boolean; codigo: string }> {
  const { token, carga } = urna;
  const ctx = contextoDaCarga(carga);
  const { codigo } = await api<{ codigo: string }>("/api/mesario/habilitar", { eleitor_id: eleitorId });
  const { credencial } = await obterCredencial(token, carga, codigo);
  const testou = inteiroAleatorio(1000) < probabilidadeTeste * 1000;
  if (testou) {
    const o = inteiroAleatorio(ctx.nOpcoes);
    const { preparada } = await lacrarCedula(ctx, credencial, carga, token, o);
    await enviarDesafio(montarDesafiada(preparada, ctx.hashEleicao), o, carga, token);
  }
  // candidatos com mais chance que branco/nulo, só para o resultado ficar interessante
  const sorteio = inteiroAleatorio(100);
  const nCand = ctx.nOpcoes - 2;
  const opcao = sorteio < 90 ? inteiroAleatorio(nCand) : sorteio < 96 ? nCand : nCand + 1;
  const { preparada, verificacao } = await lacrarCedula(ctx, credencial, carga, token, opcao);
  await depositarCedula(assinarCedula(preparada, ctx.hashEleicao, credencial, credencial.privada), opcao, carga, token);
  return { testou, codigo: verificacao.codigo };
}
