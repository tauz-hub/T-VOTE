// Laboratório de ataques: adultera o quadro nacional (ou as fotos) de propósito
// para provar quem percebe cada fraude — o auditor matemático, o eleitor com o
// comprovante, ou o BU em papel colado na porta da escola. Antes do primeiro
// ataque é feita uma cópia, que pode ser restaurada.
//
// Os atacantes têm poderes crescentes:
//   banco            escreve no boletim.db, sem nenhuma chave
//   TSE              tem a chave do quadro (consegue reassinar a cadeia)
//   TSE + hardware   também extraiu as chaves da urna e da mesa de uma seção
//                    (backdoor de fábrica) — consegue reassinar a mídia da seção
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contextoDaSecao, cargasDosBlocos, nacionalDosBlocos } from "../auditoria";
import { type CedulaPublicada, assinarCedula, calcularNullificador, prepararCedula } from "../crypto/cedula";
import { bytesAleatorios, inteiroAleatorio } from "../crypto/codificacao";
import { finalizarCredencial, iniciarCredencial } from "../crypto/credencial";
import { cifraParaHex } from "../crypto/elgamal";
import { codigoVerificacao, nomesDasFiguras } from "../crypto/palavras";
import { type Bloco, HASH_INICIAL, assinarHash, compararRastreador, hashBloco, hashSelo, montarBloco } from "../crypto/quadro";
import { assinarCega } from "../crypto/rsa-cega";
import { type BoletimUrna, agregarCedulas, assinarDocumentoUrna } from "../crypto/secao";
import { chavePrivadaDaMesaPorSecao } from "./autoridade";
import { DIRETORIO_DADOS, db, registrarEvento } from "./db";
import { caminhoFoto } from "./fotos";
import { ErroHttp } from "./http";
import { chaveQuadro, listarBlocos, substituirCadeia } from "./quadro";
import { chavePrivadaDaUrnaPorSecao } from "./secao";

export type Atacante = "banco" | "tse" | "tse_hardware";

export const ATAQUES = {
  alterar_voto: {
    titulo: "Trocar um voto direto no banco",
    atacante: "banco",
    descricao: "Troca as cifras de duas opções de uma cédula publicada, sem mexer em mais nada.",
    quem_detecta: "Auditor: a cadeia de hashes e a assinatura da cédula quebram.",
  },
  alterar_voto_recalcular: {
    titulo: "Trocar um voto e recalcular os hashes",
    atacante: "banco",
    descricao: "Troca o voto e refaz a cadeia de hashes para esconder a adulteração, mas sem a chave do quadro.",
    quem_detecta: "Auditor: a assinatura do quadro não confere.",
  },
  remover_cedula: {
    titulo: "Sumir com uma cédula na totalização",
    atacante: "tse",
    descricao: "O TSE tira uma cédula do BU recebido e reassina a cadeia com a chave do quadro.",
    quem_detecta: "Auditor: o BU deixa de ter a assinatura da urna (o TSE não tem a chave dela).",
  },
  omitir_secao: {
    titulo: "Sumir com uma seção inteira",
    atacante: "tse",
    descricao: "O TSE descarta a mídia de uma seção e reescreve a cadeia como se ela nunca tivesse chegado.",
    quem_detecta: "BU em papel na porta da escola e os eleitores da seção (códigos não aparecem). O auditor só pode avisar que a seção ficou sem mídia.",
  },
  reescrever_secao: {
    titulo: "Reescrever uma seção com as chaves extraídas do hardware",
    atacante: "tse_hardware",
    descricao:
      "Insider com a chave do quadro E as chaves da urna e da mesa da seção (backdoor de fábrica): troca todas as cédulas por cédulas válidas para um candidato, refaz contagem, soma e assinaturas.",
    quem_detecta:
      "A matemática toda confere — o auditor PASSA. Quem pega é o eleitor (o código do comprovante some) e o BU em papel (código do BU e números diferentes). Faça antes da apuração.",
  },
  credencial_forjada: {
    titulo: "Enfiar cédula extra com credencial legítima",
    atacante: "tse_hardware",
    descricao: "Com as chaves da mesa e da urna, cria uma cédula 100% válida sem eleitor e coloca no BU.",
    quem_detecta: "Auditor: mais cédulas que comparecimento (o contador da mesa vai impresso no BU).",
  },
  ordem_chegada: {
    titulo: "Guardar a ordem de chegada com horário (TPS 2012)",
    atacante: "tse_hardware",
    descricao: "Reordena as cédulas do BU e acrescenta o horário de cada voto — o vazamento que quebrou o sigilo em 2012.",
    quem_detecta: "Auditor: cédulas fora da ordem canônica e com campos extras.",
  },
  trocar_figuras: {
    titulo: "Trocar as figuras e o código gravados de duas cédulas",
    atacante: "tse_hardware",
    descricao: "Grava no BU figuras e códigos diferentes dos que a urna mostrou, e reassina a mídia e a cadeia.",
    quem_detecta: "Auditor: figuras e código não saem do selo; e o eleitor vê figuras diferentes das que memorizou.",
  },
  bu_falso: {
    titulo: "Imprimir um BU com números falsos",
    atacante: "tse_hardware",
    descricao: "Move votos na contagem impressa do BU sem mexer nas cédulas cifradas, e reassina com a chave da urna.",
    quem_detecta: "Auditor, depois da apuração: o BU impresso não bate com a decifração do agregado da seção.",
  },
  alterar_resultado: {
    titulo: "Alterar o resultado publicado",
    atacante: "tse",
    descricao: "Move um voto de um candidato para outro no bloco de resultado e reassina.",
    quem_detecta: "Auditor: o resultado recalculado a partir das decifrações é outro.",
  },
  trocar_foto: {
    titulo: "Trocar a foto de um candidato (TPS 2017)",
    atacante: "banco",
    descricao: "Substitui o arquivo da foto de um candidato para enganar o eleitor na tela.",
    quem_detecta: "A própria urna: ela confere o hash da foto publicado na gênese e recusa a imagem.",
  },
} as const satisfies Record<string, { titulo: string; atacante: Atacante; descricao: string; quem_detecta: string }>;

export type TipoAtaque = keyof typeof ATAQUES;

const BACKUP = path.join(DIRETORIO_DADOS, "backup", "boletim.pre-ataque.db");
const BACKUP_FOTOS = path.join(DIRETORIO_DADOS, "backup", "fotos");

export function existeBackup() {
  return existsSync(BACKUP);
}

export function descartarBackup() {
  if (existsSync(BACKUP)) rmSync(BACKUP);
  if (existsSync(BACKUP_FOTOS)) rmSync(BACKUP_FOTOS, { recursive: true });
}

function restaurarFotos() {
  if (!existsSync(BACKUP_FOTOS)) return;
  for (const f of readdirSync(BACKUP_FOTOS)) copyFileSync(path.join(BACKUP_FOTOS, f), path.join(DIRETORIO_DADOS, "fotos", f));
  rmSync(BACKUP_FOTOS, { recursive: true });
}

function garantirBackup() {
  if (existsSync(BACKUP)) return;
  mkdirSync(path.dirname(BACKUP), { recursive: true });
  db("boletim").prepare("VACUUM INTO ?").run(BACKUP);
}

export function restaurarBackup() {
  if (!existsSync(BACKUP)) throw new ErroHttp(404, "Não há adulterações para desfazer");
  const d = db("boletim");
  d.prepare("ATTACH DATABASE ? AS bk").run(BACKUP);
  try {
    d.transaction(() => {
      for (const t of ["estado", "blocos", "eventos"]) d.exec(`DELETE FROM main."${t}"; INSERT INTO main."${t}" SELECT * FROM bk."${t}";`);
    })();
  } finally {
    d.exec("DETACH DATABASE bk");
  }
  rmSync(BACKUP);
  restaurarFotos();
  registrarEvento("boletim", "ATAQUE_DESFEITO", "boletim e fotos restaurados a partir da cópia pré-ataque");
}

/** Refaz hashes (e, com a chave do quadro, as assinaturas) a partir de um bloco. */
function reencadear(blocos: Bloco[], desde: number, reassinar: boolean) {
  const privada = reassinar ? chaveQuadro().privada : null;
  for (let i = desde; i < blocos.length; i++) {
    const anterior = i === 0 ? null : blocos[i - 1];
    if (privada) {
      blocos[i] = montarBloco(anterior, blocos[i].tipo, blocos[i].conteudo, privada, blocos[i].publicado_em) as Bloco;
    } else {
      blocos[i].numero = i + 1;
      blocos[i].hash_anterior = anterior ? anterior.hash : HASH_INICIAL;
      blocos[i].hash = hashBloco(blocos[i]);
    }
  }
}

function secaoAlvo(blocos: Bloco[], minimo = 1): number {
  const i = blocos.findIndex((b) => b.tipo === "SECAO" && (b as Bloco<"SECAO">).conteudo.bu.conteudo.cedulas.length >= minimo);
  if (i < 0) throw new ErroHttp(409, `É preciso ter a mídia de uma seção com pelo menos ${minimo} cédula(s) no quadro — vote, encerre a seção e transmita`);
  return i;
}

/** O insider com a chave da urna reassina o BU alterado (e mantém o ENCERRAMENTO coerente). */
function reassinarBU(blocos: Bloco[], i: number) {
  const s = (blocos[i] as Bloco<"SECAO">).conteudo;
  const priv = chavePrivadaDaUrnaPorSecao(s.secao);
  if (!priv) throw new ErroHttp(409, "A chave desta urna não está neste computador — o ataque com backdoor de hardware só funciona com a urna local");
  s.bu = assinarDocumentoUrna(s.bu.conteudo, priv);
  const enc = blocos.find((b) => b.tipo === "ENCERRAMENTO") as Bloco<"ENCERRAMENTO"> | undefined;
  const linha = enc?.conteudo.secoes.find((x) => x.secao === s.secao);
  if (enc && linha) {
    const antes = linha.cedulas;
    linha.bu = s.bu.hash;
    linha.cedulas = s.bu.conteudo.cedulas.length;
    linha.desafiadas = s.bu.conteudo.desafiadas.length;
    enc.conteudo.total_cedulas += linha.cedulas - antes;
  }
}

/** Cédula 100% válida fabricada com as chaves extraídas da mesa e da urna. */
function forjarCedula(blocos: Bloco[], secao: string, opcao: number): CedulaPublicada {
  const n = nacionalDosBlocos(blocos);
  const carga = cargasDosBlocos(blocos).get(secao);
  const mesa = chavePrivadaDaMesaPorSecao(secao);
  const urna = chavePrivadaDaUrnaPorSecao(secao);
  if (!n || !carga || !mesa || !urna) throw new ErroHttp(409, "As chaves da mesa e da urna desta seção não estão neste computador");
  const ctx = contextoDaSecao(n, carga.carga);
  const pub = { n: mesa.n, e: mesa.e };
  const pedido = iniciarCredencial(ctx.eleicaoId, pub);
  const cred = finalizarCredencial(pedido, assinarCega(pedido.cega, mesa), pub);
  const p = prepararCedula(ctx, cred.chave, opcao);
  const cedula = assinarCedula(p, ctx.hashEleicao, cred, cred.privada);
  const selo = assinarHash(hashSelo(ctx.hashEleicao, p.rastreador, secao), urna);
  return {
    ...cedula,
    rastreador: p.rastreador,
    nullificador: calcularNullificador(cred.chave),
    secao,
    selo,
    codigo: codigoVerificacao(secao, selo),
    figuras: nomesDasFiguras(selo),
  };
}

/** Recalcula soma homomórfica (e, opcionalmente, a contagem impressa) depois de mexer nas cédulas. */
function refazerSoma(bu: BoletimUrna, nOpcoes: number) {
  bu.cedulas.sort(compararRastreador);
  bu.agregado = agregarCedulas(bu.cedulas, nOpcoes).map(cifraParaHex);
}

export function aplicarAtaque(tipo: TipoAtaque): string {
  if (!(tipo in ATAQUES)) throw new ErroHttp(400, "Ataque desconhecido");
  const blocos = listarBlocos();
  const n = nacionalDosBlocos(blocos);
  garantirBackup();
  let resumo = "";

  switch (tipo) {
    case "alterar_voto":
    case "alterar_voto_recalcular": {
      const i = secaoAlvo(blocos);
      const c = (blocos[i] as Bloco<"SECAO">).conteudo.bu.conteudo.cedulas[0];
      [c.escolhas[0], c.escolhas[1]] = [c.escolhas[1], c.escolhas[0]];
      if (tipo === "alterar_voto_recalcular") reencadear(blocos, i, false);
      resumo = `cédula ${c.codigo} da seção ${c.secao} teve as opções 1 e 2 trocadas`;
      break;
    }
    case "remover_cedula": {
      const i = secaoAlvo(blocos);
      const bu = (blocos[i] as Bloco<"SECAO">).conteudo.bu.conteudo;
      const [c] = bu.cedulas.splice(0, 1);
      refazerSoma(bu, n!.nOpcoes);
      reencadear(blocos, i, true);
      resumo = `cédula ${c.codigo} removida do BU da seção ${c.secao}; cadeia reassinada com a chave do quadro`;
      break;
    }
    case "omitir_secao": {
      const i = secaoAlvo(blocos, 0);
      const s = (blocos[i] as Bloco<"SECAO">).conteudo;
      blocos.splice(i, 1);
      const enc = blocos.find((b) => b.tipo === "ENCERRAMENTO") as Bloco<"ENCERRAMENTO"> | undefined;
      if (enc) {
        const linha = enc.conteudo.secoes.find((x) => x.secao === s.secao);
        enc.conteudo.secoes = enc.conteudo.secoes.filter((x) => x.secao !== s.secao);
        enc.conteudo.secoes_sem_midia = [...enc.conteudo.secoes_sem_midia, s.secao].sort();
        enc.conteudo.total_cedulas -= linha?.cedulas ?? 0;
        enc.conteudo.total_desafiadas -= linha?.desafiadas ?? 0;
      }
      for (const b of blocos.filter((x) => x.tipo === "DECRIPTACAO_PARCIAL") as Bloco<"DECRIPTACAO_PARCIAL">[])
        b.conteudo.secoes = b.conteudo.secoes.filter((x) => x.secao !== s.secao);
      const res = blocos.find((b) => b.tipo === "RESULTADO") as Bloco<"RESULTADO"> | undefined;
      if (res) {
        res.conteudo.secoes = res.conteudo.secoes.filter((x) => x.secao !== s.secao);
        const tirar = s.bu.conteudo.contagem;
        res.conteudo.contagem = res.conteudo.contagem.map((x) => ({ ...x, votos: x.votos - (tirar[x.opcao]?.votos ?? 0) }));
        res.conteudo.total -= s.bu.conteudo.cedulas.length;
      }
      reencadear(blocos, i, true);
      resumo = `mídia da seção ${s.secao} (${s.bu.conteudo.cedulas.length} cédulas) apagada; encerramento e resultado reescritos`;
      break;
    }
    case "reescrever_secao": {
      const i = secaoAlvo(blocos);
      const s = (blocos[i] as Bloco<"SECAO">).conteudo;
      const bu = s.bu.conteudo;
      // o insider escolhe um candidato qualquer (sorteado: o laboratório não favorece ninguém)
      const candidatos = n!.opcoes.map((o, k) => ({ o, k })).filter(({ o }) => o.tipo === "candidato");
      const alvo = candidatos[inteiroAleatorio(candidatos.length)];
      const quantas = bu.cedulas.length;
      bu.cedulas = Array.from({ length: quantas }, () => forjarCedula(blocos, s.secao, alvo.k));
      bu.contagem = bu.contagem.map((x) => ({ ...x, votos: x.opcao === alvo.k ? quantas : 0 }));
      refazerSoma(bu, n!.nOpcoes);
      reassinarBU(blocos, i);
      reencadear(blocos, i, true);
      const decifrada = blocos.some((b) => b.tipo === "DECRIPTACAO_PARCIAL");
      resumo = `seção ${s.secao}: as ${quantas} cédulas viraram ${quantas} votos válidos no ${alvo.o.numero} — reassinado com as chaves da urna, da mesa e do quadro${
        decifrada ? ". ⚠ A seção já tinha sido decifrada: as provas dos trustees deixam de valer e o auditor percebe" : ""
      }`;
      break;
    }
    case "credencial_forjada": {
      const i = secaoAlvo(blocos, 0);
      const s = (blocos[i] as Bloco<"SECAO">).conteudo;
      const opcao = inteiroAleatorio(n!.nOpcoes - 2);
      s.bu.conteudo.cedulas.push(forjarCedula(blocos, s.secao, opcao));
      s.bu.conteudo.contagem[opcao].votos += 1;
      refazerSoma(s.bu.conteudo, n!.nOpcoes);
      reassinarBU(blocos, i);
      reencadear(blocos, i, true);
      resumo = `cédula válida sem eleitor inserida no BU da seção ${s.secao} (comparecimento continua ${s.bu.conteudo.comparecimento})`;
      break;
    }
    case "ordem_chegada": {
      const i = secaoAlvo(blocos, 2);
      const s = (blocos[i] as Bloco<"SECAO">).conteudo;
      const base = Date.parse(s.bu.conteudo.encerrada_em);
      const lista = s.bu.conteudo.cedulas.reverse();
      (s.bu.conteudo as unknown as { cedulas: Record<string, unknown>[] }).cedulas = lista.map((c, k) => ({
        ...c,
        horario: new Date(base - (lista.length - k) * 97_000).toISOString(),
      }));
      reassinarBU(blocos, i);
      reencadear(blocos, i, true);
      resumo = `BU da seção ${s.secao} republicado em "ordem de chegada" com horário por voto`;
      break;
    }
    case "trocar_figuras": {
      const i = secaoAlvo(blocos, 2);
      const s = (blocos[i] as Bloco<"SECAO">).conteudo;
      const [a, b] = s.bu.conteudo.cedulas;
      [a.figuras, b.figuras] = [b.figuras, a.figuras];
      [a.codigo, b.codigo] = [b.codigo, a.codigo];
      reassinarBU(blocos, i);
      reencadear(blocos, i, true);
      resumo = `cédulas ${a.codigo} e ${b.codigo} tiveram figuras e códigos trocados no BU da seção ${s.secao}`;
      break;
    }
    case "bu_falso": {
      const i = secaoAlvo(blocos);
      const s = (blocos[i] as Bloco<"SECAO">).conteudo;
      const contagem = s.bu.conteudo.contagem;
      const doador = contagem.find((x) => x.votos > 0)!;
      const alvo = contagem.find((x) => x.opcao !== doador.opcao)!;
      doador.votos -= 1;
      alvo.votos += 1;
      reassinarBU(blocos, i);
      reencadear(blocos, i, true);
      resumo = `BU da seção ${s.secao}: 1 voto movido da opção ${doador.opcao} para a ${alvo.opcao} só no papel (cifras intactas)`;
      break;
    }
    case "trocar_foto": {
      const opcoes = (blocos[0] as Bloco<"GENESE">).conteudo.opcoes;
      const comFoto = opcoes.filter((o) => o.foto && caminhoFoto(o.foto));
      if (comFoto.length === 0) throw new ErroHttp(409, "Nenhum candidato tem foto nesta eleição — adicione fotos no formulário da eleição");
      const alvo = comFoto[0];
      const arquivo = caminhoFoto(alvo.foto!)!.arquivo;
      mkdirSync(BACKUP_FOTOS, { recursive: true });
      const copia = path.join(BACKUP_FOTOS, path.basename(arquivo));
      if (!existsSync(copia)) copyFileSync(arquivo, copia);
      // com outra foto disponível, mostra o rosto de outra pessoa; senão, altera bytes invisíveis
      const outra = comFoto.find((o) => o.foto !== alvo.foto);
      const novo = outra ? readFileSync(caminhoFoto(outra.foto!)!.arquivo) : Buffer.concat([readFileSync(copia), Buffer.from(bytesAleatorios(16))]);
      writeFileSync(arquivo, novo);
      registrarEvento("boletim", "ATAQUE_SIMULADO", `${ATAQUES[tipo].titulo}: foto de ${alvo.numero}`);
      return `arquivo da foto de ${alvo.nome} (${alvo.numero}) substituído${outra ? ` pela foto de ${outra.nome}` : ""} — abra a Urna, digite ${alvo.numero} e veja a foto ser recusada`;
    }
    case "alterar_resultado": {
      const i = blocos.findIndex((b) => b.tipo === "RESULTADO");
      if (i < 0) throw new ErroHttp(409, "O resultado ainda não foi publicado");
      const r = (blocos[i] as Bloco<"RESULTADO">).conteudo;
      const doador = r.contagem.find((c) => c.votos > 0);
      if (!doador) throw new ErroHttp(409, "Resultado sem votos para desviar");
      doador.votos -= 1;
      const alvo = r.contagem.find((c) => c.opcao !== doador.opcao)!;
      alvo.votos += 1;
      reencadear(blocos, i, true);
      resumo = `1 voto desviado da opção ${doador.opcao} para a opção ${alvo.opcao} no resultado publicado`;
      break;
    }
  }
  substituirCadeia(blocos);
  registrarEvento("boletim", "ATAQUE_SIMULADO", `${ATAQUES[tipo].titulo}: ${resumo}`);
  return resumo;
}
