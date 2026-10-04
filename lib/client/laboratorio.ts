"use client";

// LABORATÓRIO — simula um eleitor numa urna de exemplo com software adulterado,
// pelas mesmas rotas e passos da tela da urna (credencial da mesa, selo, teste
// com declaração, voto), e devolve o comprovante que ele levaria para casa.
import { assinarCedula, montarDesafiada, verificarDesafiada } from "../crypto/cedula";
import { inteiroAleatorio } from "../crypto/codificacao";
import { conferenciaDoSelo } from "../crypto/palavras";
import type { Opcao, Recibo } from "../crypto/quadro";
import {
  type ParametrosFirmware,
  indiceDaOpcao,
  opcaoDeclaradaNoTeste,
  opcaoParaCifrar,
  sementeImpressaNoTeste,
  trocaCedulaNoDeposito,
} from "../laboratorio/firmware-adulterado";
import type { CargaUrna } from "../tipos-api";
import type { TesteImpresso } from "../../components/Comprovante";
import { api } from "./api";
import { type Verificacao, contextoDaCarga, depositarCedula, enviarDesafio, estadoDaUrna, lacrarCedula, obterCredencial } from "./protocolo";

/** O que fica guardado neste navegador para cada urna de exemplo. */
export type UrnaLaboratorio = {
  modelo: string;
  titulo: string;
  descricao: string;
  quem_pega: "teste" | "voto";
  como_pegar: string;
  id: string;
  nome: string;
  token: string;
  zona: string;
  secao: string;
  parametros: ParametrosFirmware;
};

export const CHAVE_URNAS_LABORATORIO = "t-vote:laboratorio:urnas";
/** O comprovante que o laboratório passa para a tela "Conferir teste". */
export const CHAVE_COMPROVANTE_PARA_CONFERIR = "t-vote:teste:colar";

export type EleitorSimulado = {
  escolhida: Opcao;
  verif: Verificacao;
  recibo: Recibo;
  testes: TesteImpresso[];
  carga: CargaUrna;
};

/**
 * Um eleitor chega, testa a urna `vezes` vezes com o candidato que escolheu e
 * depois vota nele — como na tela: TESTAR, CONFIRMA.
 */
export async function simularEleitorQueTesta(u: UrnaLaboratorio, vezes = 1): Promise<EleitorSimulado> {
  const est = await estadoDaUrna(u.token);
  const carga = est.carga;
  if (!carga || carga.fase !== "aberta") throw new Error(`A seção ${u.zona}-${u.secao} não está aberta (fase: ${carga?.fase ?? "sem carga"})`);
  const opcoes = carga.opcoes;

  // o mesário identifica alguém do caderno que ainda não votou
  const { eleitores } = await api<{ eleitores: { id: number; apto: number; situacao: string }[] }>("/api/registro/eleitores");
  const livres = eleitores.filter((e) => e.apto && e.situacao !== "credenciado");
  if (livres.length === 0) throw new Error("Não há eleitores aptos que ainda não votaram. Gere eleitores fictícios no Cadastro.");
  const eleitor = livres[inteiroAleatorio(livres.length)];
  const { codigo } = await api<{ codigo: string }>("/api/mesario/habilitar", { eleitor_id: eleitor.id });
  const { credencial } = await obterCredencial(u.token, carga, codigo);
  const ctx = contextoDaCarga(carga);

  // o eleitor escolhe: a "vítima", se houver; senão qualquer candidato que não seja o favorecido
  const alvo = indiceDaOpcao(u.parametros.alvo, opcoes);
  const candidatos = opcoes.map((o, i) => ({ o, i })).filter(({ o, i }) => o.tipo === "candidato" && i !== alvo);
  const vitima = indiceDaOpcao(u.parametros.vitima, opcoes);
  const escolha = vitima >= 0 ? vitima : candidatos[inteiroAleatorio(candidatos.length)].i;

  const testes: TesteImpresso[] = [];
  for (let t = 0; t < vezes; t++) {
    const cifrada = opcaoParaCifrar(est.firmware, est.parametros, escolha, opcoes);
    const { preparada, verificacao } = await lacrarCedula(ctx, credencial, carga, u.token, cifrada);
    const d = montarDesafiada(preparada, carga.hash_eleicao);
    const declarada = opcaoDeclaradaNoTeste(est.firmware, escolha, verificarDesafiada(d, ctx).opcao);
    const impressa = sementeImpressaNoTeste(est.firmware, est.parametros, d.revelacao.semente);
    const { declaracao } = await enviarDesafio(d, declarada, carga, u.token, impressa);
    testes.push({ codigo: verificacao.codigo, conferencia: conferenciaDoSelo(verificacao.selo), declaracao });
  }

  // CONFIRMA: vota no mesmo candidato
  const cifrada = opcaoParaCifrar(est.firmware, est.parametros, escolha, opcoes);
  const { preparada, verificacao } = await lacrarCedula(ctx, credencial, carga, u.token, cifrada);
  const troca = trocaCedulaNoDeposito(est.firmware, est.parametros, opcoes);
  let recibo: Recibo;
  if (troca !== null) {
    const outra = await lacrarCedula(ctx, credencial, carga, u.token, troca);
    recibo = await depositarCedula(assinarCedula(outra.preparada, carga.hash_eleicao, credencial, credencial.privada), troca, carga, u.token);
  } else {
    recibo = await depositarCedula(assinarCedula(preparada, carga.hash_eleicao, credencial, credencial.privada), cifrada, carga, u.token);
  }
  return { escolhida: opcoes[escolha], verif: verificacao, recibo, testes, carga };
}
