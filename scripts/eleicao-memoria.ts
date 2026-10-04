// Eleição inteira em memória (sem servidor, sem banco), com o protocolo v4:
// seções offline, carga de cada urna, zerésima e BU assinados pela urna,
// decifração por seção. Usada pelos testes para gerar um pacote público e
// adulterá-lo de propósito.
import { agregarCedulas } from "../lib/auditoria";
import { inteiroAleatorio } from "../lib/crypto/codificacao";
import {
  type CedulaDesafiada,
  type CedulaPublicada,
  type ContextoCedula,
  assinarCedula,
  calcularNullificador,
  montarDesafiada,
  prepararCedula,
  verificarDesafiada,
} from "../lib/crypto/cedula";
import { type Credencial, finalizarCredencial, iniciarCredencial } from "../lib/crypto/credencial";
import { cifraParaHex, combinarChaves } from "../lib/crypto/elgamal";
import { pontoDeHex, pontoHex } from "../lib/crypto/grupo";
import { codigoVerificacao, conferenciaDoSelo, idSecao, nomesDasFiguras } from "../lib/crypto/palavras";
import {
  type Bloco,
  type ConteudoPorTipo,
  type Contagem,
  type Opcao,
  type TipoBloco,
  HASH_INICIAL,
  VERSAO_PROTOCOLO,
  assinarHash,
  calcularHashEleicao,
  compararRastreador,
  hashBloco,
  hashSelo,
  montarBloco,
} from "../lib/crypto/quadro";
import { type ChaveRSAPrivada, assinarCega } from "../lib/crypto/rsa-cega";
import {
  type BoletimUrna,
  type DeclaracaoTeste,
  type ZeresimaSecao,
  assinarDocumentoUrna,
  hashDeclaracaoTeste,
  somarContagens,
} from "../lib/crypto/secao";
import { type SegredoTrustee, decifrarParcial, gerarChaveTrustee } from "../lib/crypto/trustee";
import { opcaoDeclaradaNoTeste, opcaoParaCifrar } from "../lib/laboratorio/firmware-adulterado";
import { CANDIDATOS_PADRAO } from "../lib/padroes";
import { gerarChaveEd25519, gerarChaveRSA } from "../lib/server/chaves";
import { hashDoSoftware } from "../lib/server/software";

export type ConfigSecao = { zona: number; secao: number; eleitores: number; adulterada?: { alvo: number; percentual: number } };

/** O que o eleitor leva para casa (papel + memória), para conferir depois. */
export type Lembranca = {
  secao: string;
  opcaoEscolhida: number;
  codigo: string;
  conferencia: string;
  figuras: string[];
  rastreador: string;
  teste?: { codigo: string; conferencia: string; declaracao: DeclaracaoTeste; opcaoEscolhida: number };
};

export type SecaoMemoria = {
  secao: string;
  urna: { privada: string; publica: string };
  mesa: ChaveRSAPrivada;
  ctx: ContextoCedula;
  cedulas: CedulaPublicada[];
  desafiadas: CedulaDesafiada[];
  contagem: number[];
  buImpresso?: string;
};

export function opcoesPadrao(): Opcao[] {
  return [
    ...CANDIDATOS_PADRAO.map((c): Opcao => ({ numero: c.numero, nome: c.nome, partido: c.partido, tipo: "candidato" })),
    { numero: null, nome: "Branco", tipo: "branco" },
    { numero: null, nome: "Nulo", tipo: "nulo" },
  ];
}

export function montarEleicao(config: { secoes: ConfigSecao[]; taxaTeste?: number; opcoes?: Opcao[] }) {
  const opcoes = config.opcoes ?? opcoesPadrao();
  const quadro = gerarChaveEd25519();
  const blocos: Bloco[] = [];
  const agora = () => new Date().toISOString();
  const anexar = <T extends TipoBloco>(tipo: T, conteudo: ConteudoPorTipo[T]) => {
    const b = montarBloco(blocos.at(-1) ?? null, tipo, conteudo, quadro.privada, agora());
    blocos.push(b as Bloco);
    return b;
  };
  const software = hashDoSoftware();
  const eleicaoId = "teste-" + Date.now().toString(36);
  const genese = anexar("GENESE", {
    versao_protocolo: VERSAO_PROTOCOLO,
    eleicao_id: eleicaoId,
    nome: "Eleição de teste (Presidente)",
    opcoes,
    grupo: "ristretto255",
    trustees_necessarios: 3,
    chave_quadro: quadro.publica,
    software,
  });
  const segredos: SegredoTrustee[] = [1, 2, 3].map((t) => {
    const { segredo, publico } = gerarChaveTrustee(eleicaoId, t, `Trustee ${"ABC"[t - 1]}`);
    anexar("CHAVE_TRUSTEE", publico);
    return segredo;
  });
  const chaveConjunta = pontoHex(combinarChaves(segredos.map((s) => pontoDeHex(s.chave_publica))));
  const hashEleicao = calcularHashEleicao(
    genese.hash,
    segredos.map((s) => ({ trustee: s.trustee, chave_publica: s.chave_publica })),
    chaveConjunta,
  );
  anexar("ABERTURA", { chave_publica_conjunta: chaveConjunta, hash_eleicao: hashEleicao, zeresima: { secoes_recebidas: 0 } });

  const lembrancas: Lembranca[] = [];
  const secoes: SecaoMemoria[] = [];
  const esperado = new Array(opcoes.length).fill(0);
  const taxaTeste = config.taxaTeste ?? 0.25;

  for (const cfg of config.secoes) {
    const secao = idSecao(cfg.zona, cfg.secao);
    const urna = gerarChaveEd25519();
    const mesa = gerarChaveRSA();
    const autoridade_secao = { n: mesa.n, e: mesa.e };
    // carga: só as chaves públicas vão para o quadro, antes dos votos
    anexar("CARGA", { secao, urna: `Urna ${secao}`, chave_urna: urna.publica, autoridade_secao, software: software.hash });
    const ctx: ContextoCedula = { eleicaoId, hashEleicao, chavePublica: chaveConjunta, nOpcoes: opcoes.length, autoridade: autoridade_secao };
    secoes.push({ secao, urna, mesa, ctx, cedulas: [], desafiadas: [], contagem: new Array(opcoes.length).fill(0) });
  }

  const selar = (s: SecaoMemoria, rastreador: string) => {
    const selo = assinarHash(hashSelo(hashEleicao, rastreador, s.secao), s.urna.privada);
    return { secao: s.secao, selo, codigo: codigoVerificacao(s.secao, selo), figuras: nomesDasFiguras(selo) };
  };
  const credencial = (s: SecaoMemoria): Credencial => {
    const pub = { n: s.mesa.n, e: s.mesa.e };
    const pedido = iniciarCredencial(eleicaoId, pub);
    return finalizarCredencial(pedido, assinarCega(pedido.cega, s.mesa), pub);
  };

  // votação offline em cada seção
  config.secoes.forEach((cfg, k) => {
    const s = secoes[k];
    const firmware = cfg.adulterada ? "adulterado" : "oficial";
    const parametros = cfg.adulterada ? { alvo: opcoes[cfg.adulterada.alvo].numero!, percentual: cfg.adulterada.percentual } : undefined;
    const zeresima = assinarDocumentoUrna<ZeresimaSecao>(
      {
        tipo: "ZERESIMA",
        eleicao: hashEleicao,
        secao: s.secao,
        urna: `Urna ${s.secao}`,
        chave_urna: s.urna.publica,
        autoridade_secao: s.ctx.autoridade,
        software: software.hash,
        cedulas: 0,
        aberta_em: agora(),
      },
      s.urna.privada,
    );
    for (let i = 0; i < cfg.eleitores; i++) {
      const cred = credencial(s);
      // o eleitor escolhe um candidato (não o alvo da urna adulterada, para o desvio aparecer)
      let escolha = inteiroAleatorio(opcoes.length);
      if (cfg.adulterada && escolha === cfg.adulterada.alvo) escolha = (escolha + 1) % opcoes.length;
      let teste: Lembranca["teste"];
      if (inteiroAleatorio(1000) < taxaTeste * 1000) {
        const cifrada = opcaoParaCifrar(firmware, parametros, escolha, opcoes);
        const p = prepararCedula(s.ctx, cred.chave, cifrada);
        const sel = selar(s, p.rastreador);
        const d = { ...montarDesafiada(p, hashEleicao), ...sel };
        const v = verificarDesafiada(d, s.ctx);
        const declarada = opcaoDeclaradaNoTeste(firmware, escolha, v.opcao);
        s.desafiadas.push(d);
        teste = {
          codigo: sel.codigo,
          conferencia: conferenciaDoSelo(sel.selo),
          opcaoEscolhida: escolha,
          declaracao: {
            tipo: "DECLARACAO_TESTE",
            eleicao: hashEleicao,
            secao: s.secao,
            rastreador: d.rastreador,
            opcao: declarada,
            semente: d.revelacao.semente,
            assinatura: assinarHash(hashDeclaracaoTeste(hashEleicao, s.secao, d.rastreador, declarada, d.revelacao.semente), s.urna.privada),
          },
        };
      }
      const cifrada = opcaoParaCifrar(firmware, parametros, escolha, opcoes);
      const p = prepararCedula(s.ctx, cred.chave, cifrada);
      const cedula = assinarCedula(p, hashEleicao, cred, cred.privada);
      const sel = selar(s, p.rastreador);
      s.cedulas.push({ ...cedula, rastreador: p.rastreador, nullificador: calcularNullificador(cred.chave), ...sel });
      s.contagem[cifrada]++;
      esperado[escolha]++;
      lembrancas.push({
        secao: s.secao,
        opcaoEscolhida: escolha,
        codigo: sel.codigo,
        conferencia: conferenciaDoSelo(sel.selo),
        figuras: sel.figuras,
        rastreador: p.rastreador,
        teste,
      });
    }
    s.cedulas.sort(compararRastreador);
    s.desafiadas.sort(compararRastreador);
    const bu = assinarDocumentoUrna<BoletimUrna>(
      {
        tipo: "BU",
        eleicao: hashEleicao,
        secao: s.secao,
        zeresima: zeresima.hash,
        comparecimento: cfg.eleitores,
        cedulas: s.cedulas,
        desafiadas: s.desafiadas,
        contagem: s.contagem.map((votos, opcao) => ({ opcao, votos })),
        agregado: agregarCedulas(s.cedulas, opcoes.length).map(cifraParaHex),
        encerrada_em: agora(),
      },
      s.urna.privada,
    );
    s.buImpresso = bu.hash; // o "papel colado na porta da escola"
    anexar("SECAO", { secao: s.secao, zeresima, bu });
  });

  const indiceEncerramento = blocos.length;
  anexar("ENCERRAMENTO", {
    secoes: secoes.map((s) => ({ secao: s.secao, bu: s.buImpresso!, cedulas: s.cedulas.length, desafiadas: s.desafiadas.length })),
    secoes_sem_midia: [],
    total_cedulas: secoes.reduce((n, s) => n + s.cedulas.length, 0),
    total_desafiadas: secoes.reduce((n, s) => n + s.desafiadas.length, 0),
  });
  const agregados = secoes.map((s) => ({ secao: s.secao, agregado: agregarCedulas(s.cedulas, opcoes.length) }));
  for (const sg of segredos) anexar("DECRIPTACAO_PARCIAL", decifrarParcial(sg, agregados, hashEleicao));
  const porSecao = secoes.map((s) => ({ secao: s.secao, contagem: s.contagem.map((votos, opcao) => ({ opcao, votos })) as Contagem }));
  const total = somarContagens(
    porSecao.map((s) => s.contagem),
    opcoes.length,
  );
  anexar("RESULTADO", { secoes: porSecao, contagem: total, total: total.reduce((n, x) => n + x.votos, 0) });

  /** Refaz hashes a partir de um bloco; com `reassinar`, também as assinaturas (insider com a chave do quadro). */
  const reencadear = (bs: Bloco[], desde: number, reassinar: boolean) => {
    for (let i = desde; i < bs.length; i++) {
      bs[i].numero = i + 1;
      bs[i].hash_anterior = i === 0 ? HASH_INICIAL : bs[i - 1].hash;
      bs[i].hash = hashBloco(bs[i]);
      if (reassinar) bs[i] = montarBloco(i === 0 ? null : bs[i - 1], bs[i].tipo, bs[i].conteudo, quadro.privada, bs[i].publicado_em) as Bloco;
    }
  };

  return { blocos, opcoes, quadro, secoes, segredos, lembrancas, esperado, hashEleicao, eleicaoId, indiceEncerramento, reencadear, credencial, selar };
}
