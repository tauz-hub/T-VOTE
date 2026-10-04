"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { api, mensagemDeErro } from "@/lib/client/api";
import { type Verificacao, contextoDaCarga, depositarCedula, enviarDesafio, estadoDaUrna, lacrarCedula, obterCredencial } from "@/lib/client/protocolo";
import { type Cedula, type CedulaPreparada, assinarCedula, calcularNullificador, montarDesafiada, verificarDesafiada } from "@/lib/crypto/cedula";
import type { Credencial } from "@/lib/crypto/credencial";
import { conferenciaDoSelo } from "@/lib/crypto/palavras";
import type { Opcao, Recibo } from "@/lib/crypto/quadro";
import type { DeclaracaoTeste } from "@/lib/crypto/secao";
import { descreverFraude, opcaoDeclaradaNoTeste, opcaoParaCifrar, sementeImpressaNoTeste, trocaCedulaNoDeposito } from "@/lib/laboratorio/firmware-adulterado";
import type { EstadoUrnaApi } from "@/lib/tipos-api";
import { FotoCandidato } from "@/components/FotoCandidato";
import { CodigoVerificacao, FigurasDaCedula } from "@/components/Palavras";
import { Comprovante, type TesteImpresso } from "@/components/Comprovante";
import { BoletimImpresso, ZeresimaImpressa, digital } from "@/components/Impressos";
import { somAlerta, somConfirma, somFim, somTecla } from "@/lib/client/som";
import { SeloSoftware, type Software, VerificacaoNaUrna } from "@/components/VerificacaoNaUrna";
import { Aviso, Hash, Pagina, Selo } from "@/components/ui";

// A urna real não tem tela de toque: tudo é feito pelo teclado dela. Além das
// teclas de sempre (números, BRANCO, CORRIGE, CONFIRMA), esta urna tem TESTAR.
type TeclaUrna = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "BRANCO" | "CORRIGE" | "CONFIRMA" | "TESTAR";

type Etapa =
  | { tipo: "aguardando" }
  | { tipo: "credenciando" }
  | { tipo: "votando" }
  | { tipo: "revisao"; opcao: number; opcaoCifrada: number; preparada: CedulaPreparada; verif: Verificacao; repeticao?: boolean }
  | { tipo: "desafiada"; escolhida: number; declarada: number; ok: boolean; recibo: Recibo; declaracao: DeclaracaoTeste; verif: Verificacao }
  | { tipo: "enviando"; texto: string }
  | { tipo: "fim"; recibo: Recibo; cedula: Cedula; verif: Verificacao; testes: TesteImpresso[] };

type Detalhes = { chave?: string; mensagemCega?: string; assinatura?: string; nullificador?: string };

type Instalacao = { id: string; nome: string; token: string; zona?: string; secao?: string };
export type PerfilUrna = "padrao" | "laboratorio";

/** Instalação feita pelo técnico, também só pelo teclado: zona → seção (→ número favorecido, no laboratório). */
type CampoInstalacao = "zona" | "secao" | "alvo";
const TAMANHO_CAMPO: Record<CampoInstalacao, number> = { zona: 3, secao: 4, alvo: 2 };

// A instalação (pareamento) fica guardada neste navegador: é "a urna".
// As urnas de exemplo do laboratório têm cada uma o seu pareamento (`idLaboratorio`).
const chavesDoPerfil = (perfil: PerfilUrna, idLaboratorio?: string) => {
  const sufixo = idLaboratorio ? `:${idLaboratorio}` : "";
  return {
    instalacao: perfil === "laboratorio" ? `t-vote:laboratorio:instalacao${sufixo}` : "t-vote:urna:instalacao",
    sessao: perfil === "laboratorio" ? `t-vote:laboratorio:credencial${sufixo}` : "t-vote:urna:credencial",
  };
};

/** Chave do localStorage onde o laboratório guarda o pareamento de uma urna de exemplo. */
export const chaveInstalacaoLaboratorio = (id: string) => chavesDoPerfil("laboratorio", id).instalacao;

const assinantes = new Set<() => void>();
function assinarInstalacao(avisar: () => void) {
  assinantes.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    assinantes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}
function lerBruto(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravarInstalacao(chave: string, valor: Instalacao | null) {
  if (valor) localStorage.setItem(chave, JSON.stringify(valor));
  else localStorage.removeItem(chave);
  for (const avisar of assinantes) avisar();
}

function lerSessao(chave: string): { eleicao_id: string; credencial: Credencial; detalhes: Detalhes } | null {
  try {
    const v = sessionStorage.getItem(chave);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/** O candidato na tela: sempre com a foto, para o eleitor saber em quem está votando. */
function CandidatoNaTela({ opcao, grande = false }: { opcao?: Opcao; grande?: boolean }) {
  if (!opcao) return null;
  if (opcao.tipo !== "candidato")
    return <div className={`${grande ? "text-3xl" : "text-2xl"} font-bold`}>{opcao.tipo === "branco" ? "VOTO EM BRANCO" : "VOTO NULO"}</div>;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-stone-600">
          Número: <strong>{opcao.numero}</strong>
        </div>
        <div className="text-sm text-stone-600">Nome:</div>
        <div className={`${grande ? "text-2xl" : "text-xl"} font-bold`}>{opcao.nome}</div>
        {opcao.partido && (
          <>
            <div className="mt-1 text-sm text-stone-600">Partido:</div>
            <div className="text-lg font-bold">{opcao.partido}</div>
          </>
        )}
      </div>
      <FotoCandidato tamanho={grande ? "lg" : "md"} hash={opcao.foto} nome={opcao.nome} />
    </div>
  );
}

/** Legenda de teclas no rodapé da tela, como na urna de hoje. */
function Legenda({ linhas }: { linhas: [string, string][] }) {
  return (
    <div className="mt-auto border-t border-stone-400 pt-2 text-xs">
      Aperte a tecla:
      {linhas.map(([tecla, texto]) => (
        <div key={tecla}>
          <strong>{tecla}</strong> para {texto}
        </div>
      ))}
    </div>
  );
}

export function Urna({ cabine = false, perfil = "padrao", idLaboratorio }: { cabine?: boolean; perfil?: PerfilUrna; idLaboratorio?: string }) {
  const chaves = chavesDoPerfil(perfil, idLaboratorio);
  // no servidor ainda não se sabe se a urna está instalada (undefined); no navegador, lê o pareamento
  const bruto = useSyncExternalStore(
    assinarInstalacao,
    () => lerBruto(chaves.instalacao),
    () => undefined,
  );
  const instalacao: Instalacao | null | undefined = bruto === undefined ? undefined : bruto ? (JSON.parse(bruto) as Instalacao) : null;

  const [urna, setUrna] = useState<EstadoUrnaApi | null>(null);
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "aguardando" });
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  const [campo, setCampo] = useState<CampoInstalacao>("zona");
  const [valores, setValores] = useState<Record<CampoInstalacao, string>>({ zona: "", secao: "", alvo: "" });
  const [testes, setTestes] = useState<TesteImpresso[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<Detalhes>({});
  const [digitos, setDigitos] = useState("");
  const [branco, setBranco] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarTecnico, setMostrarTecnico] = useState(true);
  const [restaurado, setRestaurado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carga = urna?.carga ?? null;
  const fase = carga?.fase;
  const adulterada = urna?.firmware === "adulterado";
  const impressaoAuto = cabine;
  // a urna adulterada também mente sobre o próprio software
  const software: Software | null = carga
    ? adulterada
      ? { confere: true, hash: carga.software }
      : { confere: urna?.software_confere, hash: carga.software, alterados: urna?.software_alterados }
    : null;

  const opcoes = carga?.opcoes ?? [];
  const candidatos = opcoes.map((o, i) => ({ ...o, indice: i })).filter((o) => o.tipo === "candidato");
  const candidato = digitos.length === 2 ? candidatos.find((c) => c.numero === digitos) : undefined;
  const iBranco = opcoes.findIndex((o) => o.tipo === "branco");
  const iNulo = opcoes.findIndex((o) => o.tipo === "nulo");

  const corrigir = () => {
    setDigitos("");
    setBranco(false);
  };

  async function instalar() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await api<Instalacao>("/api/urna/instalar", {
        zona: valores.zona,
        secao: valores.secao,
        ...(perfil === "laboratorio" ? { firmware: "adulterado", alvo: valores.alvo, percentual: 100 } : {}),
      });
      gravarInstalacao(chaves.instalacao, r);
      setValores({ zona: "", secao: "", alvo: "" });
      setCampo("zona");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function desinstalar() {
    gravarInstalacao(chaves.instalacao, null);
    setUrna(null);
  }

  /** Cerimônia de carga: a urna gera a chave dela aqui dentro; a pública vai para o quadro. */
  async function fazerCarga() {
    if (!instalacao) return;
    setErro(null);
    setOcupado(true);
    try {
      await api("/api/urna/carga", {}, { "x-urna-token": instalacao.token });
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  /** Obtém a credencial anônima da mesa da seção — disparado sozinho quando o mesário libera a urna. */
  async function credenciar() {
    if (!instalacao) return;
    setErro(null);
    setAviso(null);
    corrigir();
    setTestes([]);
    setEtapa({ tipo: "credenciando" });
    try {
      // sempre com a carga mais recente da memória da urna
      const atual = await estadoDaUrna(instalacao.token);
      if (!atual.carga || atual.carga.fase !== "aberta") throw new Error("A seção não está aberta");
      const { credencial: c, mensagemCega } = await obterCredencial(instalacao.token, atual.carga);
      const det = { chave: c.chave, mensagemCega, assinatura: c.assinatura_autoridade, nullificador: calcularNullificador(c.chave) };
      sessionStorage.setItem(chaves.sessao, JSON.stringify({ eleicao_id: atual.carga.eleicao_id, credencial: c, detalhes: det }));
      setUrna(atual);
      setCredencial(c);
      setDetalhes(det);
      setEtapa({ tipo: "votando" });
    } catch (e) {
      setErro(mensagemDeErro(e));
      setEtapa({ tipo: "aguardando" });
    }
  }

  function descartarCredencial() {
    sessionStorage.removeItem(chaves.sessao);
    setCredencial(null);
    setDetalhes({});
    corrigir();
  }

  // A urna espera a mesa (o "cabo" do terminal do mesário) por long-poll.
  const aoReceberEstado = useEffectEvent((e: EstadoUrnaApi) => {
    // se a página recarregou no meio do voto, recupera a credencial desta sessão
    if (!restaurado) {
      setRestaurado(true);
      const s = lerSessao(chaves.sessao);
      if (s && e.carga?.fase === "aberta" && s.eleicao_id === e.carga.eleicao_id && e.estado === "votando") {
        setCredencial(s.credencial);
        setDetalhes(s.detalhes);
        setEtapa({ tipo: "votando" });
        return;
      }
    }
    if (e.carga?.fase !== "aberta") {
      if (credencial) descartarCredencial();
      if (etapa.tipo !== "aguardando") setEtapa({ tipo: "aguardando" });
      return;
    }
    if (e.estado === "liberada" && (etapa.tipo === "aguardando" || etapa.tipo === "fim")) {
      void credenciar();
    } else if (e.estado === "livre" && credencial && etapa.tipo !== "fim" && etapa.tipo !== "enviando") {
      descartarCredencial();
      setTestes([]);
      setEtapa({ tipo: "aguardando" });
      setAviso("Votação interrompida pelo mesário.");
    } else if (e.estado === "votando" && !credencial && etapa.tipo === "aguardando") {
      setAviso("A urna perdeu a credencial do eleitor atual. Peça ao mesário para reiniciar a urna.");
    }
  });

  const token = instalacao?.token;
  useEffect(() => {
    if (!token) return;
    const controle = new AbortController();
    void (async () => {
      let marca = "";
      while (!controle.signal.aborted) {
        try {
          const r = await fetch(`/api/urna/estado${marca ? `?aguardar=${encodeURIComponent(marca)}` : ""}`, {
            headers: { "x-urna-token": token },
            cache: "no-store",
            signal: controle.signal,
          });
          if (r.status === 401) {
            gravarInstalacao(chaves.instalacao, null);
            setUrna(null);
            return;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const e = (await r.json()) as EstadoUrnaApi;
          marca = e.marca;
          setUrna(e);
          aoReceberEstado(e);
        } catch {
          if (controle.signal.aborted) return;
          await new Promise((ok) => setTimeout(ok, 2000)); // servidor local fora do ar: tenta de novo
        }
      }
    })();
    return () => controle.abort();
  }, [token, chaves.instalacao]);

  /**
   * Cifra a opção e sela com a chave da urna. Depois de um teste bem-sucedido é
   * chamada de novo com a MESMA opção: o eleitor não redigita nada. A cédula
   * testada não pode ser reaproveitada (o segredo dela foi revelado); esta é uma
   * cédula nova, com figuras novas — e o eleitor ainda escolhe entre votar e
   * testar de novo, porque a urna não pode saber de antemão o que ele fará.
   */
  async function lacrar(opcao: number, repeticao = false) {
    if (!carga || !credencial || !instalacao || !urna) return;
    somConfirma();
    setErro(null);
    setEtapa({ tipo: "enviando", texto: "Gravando…" });
    try {
      // urna oficial: cifra a escolha. Urna adulterada (laboratório): pode cifrar outro candidato.
      const opcaoCifrada = opcaoParaCifrar(urna.firmware, urna.parametros, opcao, opcoes);
      const { preparada, verificacao } = await lacrarCedula(contextoDaCarga(carga), credencial, carga, instalacao.token, opcaoCifrada);
      setEtapa({ tipo: "revisao", opcao, opcaoCifrada, preparada, verif: verificacao, repeticao });
    } catch (e) {
      setErro(mensagemDeErro(e));
      setEtapa({ tipo: "votando" });
    }
  }

  async function depositar(e: Extract<Etapa, { tipo: "revisao" }>) {
    if (!carga || !credencial || !instalacao) return;
    setErro(null);
    setEtapa({ tipo: "enviando", texto: "Gravando o voto…" });
    try {
      const cedula = assinarCedula(e.preparada, carga.hash_eleicao, credencial, credencial.privada);
      // LABORATÓRIO: a urna adulterada "troca_cedula" grava outra cédula no lugar da que mostrou
      const troca = urna ? trocaCedulaNoDeposito(urna.firmware, urna.parametros, opcoes) : null;
      let recibo: Recibo;
      if (troca !== null) {
        const outra = await lacrarCedula(contextoDaCarga(carga), credencial, carga, instalacao.token, troca);
        const cedulaTrocada = assinarCedula(outra.preparada, carga.hash_eleicao, credencial, credencial.privada);
        recibo = await depositarCedula(cedulaTrocada, troca, carga, instalacao.token);
      } else {
        // o contador do BU soma o que foi cifrado (numa urna adulterada, o desvio fica coerente)
        recibo = await depositarCedula(cedula, e.opcaoCifrada, carga, instalacao.token);
      }
      // destrói os segredos: a aleatoriedade e a chave da credencial deixam de existir
      descartarCredencial();
      setEtapa({ tipo: "fim", recibo, cedula, verif: e.verif, testes });
      setTestes([]);
      somFim();
      if (impressaoAuto) setTimeout(() => window.print(), 400); // um papel só: voto + testes
      // avisa a mesa que o eleitor terminou (a urna fica livre para o próximo)
      await api("/api/urna/concluir", {}, { "x-urna-token": instalacao.token }).catch(() => {});
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEtapa({ tipo: "votando" });
    }
  }

  async function desafiar(e: Extract<Etapa, { tipo: "revisao" }>) {
    if (!carga || !instalacao || !urna) return;
    setErro(null);
    setEtapa({ tipo: "enviando", texto: "Abrindo a cédula de teste…" });
    try {
      const d = montarDesafiada(e.preparada, carga.hash_eleicao);
      const v = verificarDesafiada(d, contextoDaCarga(carga));
      // a abertura verdadeira vai para o BU; a declaração é o que a urna diz ao eleitor
      const declarada = opcaoDeclaradaNoTeste(urna.firmware, e.opcao, v.opcao);
      const impressa = sementeImpressaNoTeste(urna.firmware, urna.parametros, d.revelacao.semente);
      const { recibo, declaracao } = await enviarDesafio(d, declarada, carga, instalacao.token, impressa);
      corrigir();
      // o teste vai no mesmo papel do voto, impresso no fim
      setTestes((t) => [...t, { codigo: e.verif.codigo, conferencia: conferenciaDoSelo(e.verif.selo), declaracao }]);
      const ok = v.ok && declarada === e.opcao;
      setEtapa({ tipo: "desafiada", escolhida: e.opcao, declarada, ok, recibo, declaracao, verif: e.verif });
      if (ok) somConfirma();
      else somAlerta();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEtapa({ tipo: "votando" });
    }
  }

  // ── o teclado da urna ────────────────────────────────────────────────────────
  const instalando = instalacao === null;
  const camposInstalacao: CampoInstalacao[] = perfil === "laboratorio" ? ["zona", "secao", "alvo"] : ["zona", "secao"];
  const podeCarga = !!instalacao && !!urna && !carga && urna.eleicao.fase === "aberta" && !ocupado;
  const ativas = {
    digitos: instalando || (fase === "aberta" && etapa.tipo === "votando" && !branco),
    branco: fase === "aberta" && etapa.tipo === "votando",
    corrige: instalando || (fase === "aberta" && ["votando", "revisao", "desafiada"].includes(etapa.tipo)),
    confirma:
      (instalando && valores[campo].length > 0 && !ocupado) ||
      podeCarga ||
      (fase === "aberta" &&
        ((etapa.tipo === "votando" && (branco || digitos.length === 2)) || etapa.tipo === "revisao" || (etapa.tipo === "desafiada" && etapa.ok))),
    testar: fase === "aberta" && etapa.tipo === "revisao",
  };

  function apertar(tecla: TeclaUrna) {
    const digito = /^\d$/.test(tecla);
    const permitida = digito
      ? ativas.digitos
      : tecla === "BRANCO"
        ? ativas.branco
        : tecla === "CORRIGE"
          ? ativas.corrige
          : tecla === "CONFIRMA"
            ? ativas.confirma
            : ativas.testar;
    if (!permitida) return;
    if (tecla !== "CONFIRMA") somTecla();

    // instalação pelo técnico
    if (instalando) {
      if (digito) setValores((v) => ({ ...v, [campo]: v[campo].length < TAMANHO_CAMPO[campo] ? v[campo] + tecla : v[campo] }));
      else if (tecla === "CORRIGE") {
        if (valores[campo]) setValores((v) => ({ ...v, [campo]: "" }));
        else setCampo(camposInstalacao[Math.max(0, camposInstalacao.indexOf(campo) - 1)]);
      } else if (tecla === "CONFIRMA") {
        somConfirma();
        const proximo = camposInstalacao[camposInstalacao.indexOf(campo) + 1];
        if (proximo) setCampo(proximo);
        else void instalar();
      }
      return;
    }
    if (tecla === "CONFIRMA" && podeCarga) {
      somConfirma();
      void fazerCarga();
      return;
    }
    switch (etapa.tipo) {
      case "votando":
        if (digito) setDigitos((d) => (d.length < 2 ? d + tecla : d));
        else if (tecla === "BRANCO") {
          setDigitos("");
          setBranco(true);
        } else if (tecla === "CORRIGE") corrigir();
        else if (tecla === "CONFIRMA") void lacrar(branco ? iBranco : candidato ? candidato.indice : iNulo);
        return;
      case "revisao":
        if (tecla === "CONFIRMA") void depositar(etapa);
        else if (tecla === "TESTAR") void desafiar(etapa);
        else if (tecla === "CORRIGE") {
          // desiste desta cédula (não foi depositada nem aberta) e escolhe de novo
          corrigir();
          setEtapa({ tipo: "votando" });
        }
        return;
      case "desafiada":
        if (tecla === "CONFIRMA") void lacrar(etapa.escolhida, true);
        else if (tecla === "CORRIGE") setEtapa({ tipo: "votando" });
        return;
    }
  }

  // teclado do computador: números, Backspace = CORRIGE, Enter = CONFIRMA, T = TESTAR, B = BRANCO
  const aoTeclar = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    const mapa: Record<string, TeclaUrna> = { Backspace: "CORRIGE", Delete: "CORRIGE", Enter: "CONFIRMA", t: "TESTAR", T: "TESTAR", b: "BRANCO", B: "BRANCO" };
    const tecla = /^\d$/.test(ev.key) ? (ev.key as TeclaUrna) : mapa[ev.key];
    if (!tecla) return;
    ev.preventDefault();
    apertar(tecla);
  });
  useEffect(() => {
    const ouvir = (ev: KeyboardEvent) => aoTeclar(ev);
    window.addEventListener("keydown", ouvir);
    return () => window.removeEventListener("keydown", ouvir);
  }, []);

  const nomeOpcao = (i: number) => {
    const o = opcoes[i];
    return o ? (o.numero ? `${o.nome} (${o.numero})` : o.nome) : "?";
  };

  const avisos = (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="alerta">{aviso}</Aviso>}
    </>
  );

  const centro = (conteudo: ReactNode) => <div className="flex h-full flex-col items-center justify-center gap-3 text-center">{conteudo}</div>;

  // ── a tela (só mostra; quem comanda é o teclado) ─────────────────────────────
  let tela: ReactNode = null;
  if (etapa.tipo === "enviando") tela = centro(<div className="text-lg">{etapa.texto}</div>);
  else if (instalacao === undefined) tela = null;
  else if (instalando) {
    const rotulos: Record<CampoInstalacao, string> = { zona: "Zona", secao: "Seção", alvo: "Desviar votos para o nº" };
    tela = (
      <div className="flex h-full flex-col gap-3">
        <div className="text-sm uppercase tracking-widest text-stone-600">{perfil === "laboratorio" ? "Laboratório — urna adulterada" : "Instalação da urna"}</div>
        <div className="text-sm">
          {perfil === "laboratorio"
            ? "Simula um ataque interno: o programa desta urna foi trocado antes da carga. Ela desvia votos para o número escolhido e mente quando o eleitor testa."
            : "Procedimento da equipe técnica, feito uma única vez: informe a zona e a seção pelo teclado da urna."}
        </div>
        <div className="grid gap-2">
          {camposInstalacao.map((c) => (
            <div key={c} className={`flex items-center justify-between rounded border-2 px-3 py-2 ${c === campo ? "border-stone-800 bg-white" : "border-stone-300"}`}>
              <span className="text-sm">{rotulos[c]}</span>
              <span className="text-2xl font-bold tracking-widest">{valores[c].padEnd(TAMANHO_CAMPO[c], "_")}</span>
            </div>
          ))}
        </div>
        <Legenda
          linhas={[
            ["CONFIRMA", "passar para o próximo campo / instalar"],
            ["CORRIGE", "apagar o campo"],
          ]}
        />
      </div>
    );
  } else if (!urna) tela = centro(<div className="text-sm text-stone-600">Ligando a urna…</div>);
  else if (!carga)
    tela = centro(
      <>
        <div className="text-sm uppercase tracking-widest text-stone-600">{urna.nome}</div>
        <div className="text-2xl font-bold">CARGA DA URNA</div>
        {urna.eleicao.fase === "aberta" ? (
          <>
            <div className="max-w-sm text-sm text-stone-700">
              A urna recebe os dados de <strong>{urna.eleicao.nome}</strong> e gera aqui dentro a própria chave.
            </div>
            <div className="text-sm font-bold">{ocupado ? "Gerando as chaves…" : "Aperte CONFIRMA para fazer a carga"}</div>
          </>
        ) : (
          <div className="max-w-sm text-sm text-stone-600">
            {urna.eleicao.existe
              ? urna.eleicao.fase === "configuracao"
                ? "Aguardando o TSE abrir a eleição."
                : "A eleição desta carga já foi encerrada."
              : "Nenhuma eleição criada."}
          </div>
        )}
      </>,
    );
  else if (fase === "carregada")
    tela = centro(
      <>
        <div className="text-sm uppercase tracking-widest text-stone-600">{carga.urna}</div>
        <div className="text-2xl font-bold">AGUARDANDO ABERTURA</div>
        <div className="max-w-sm text-sm text-stone-600">O mesário abre a seção e a urna imprime a zerésima.</div>
      </>,
    );
  else if (fase === "encerrada" || fase === "transmitida")
    tela = centro(
      <>
        <div className="text-sm uppercase tracking-widest text-stone-600">{carga.urna}</div>
        <div className="text-2xl font-bold">SEÇÃO ENCERRADA</div>
        <div className="max-w-sm text-sm text-stone-700">{fase === "transmitida" ? "Boletim de urna impresso e entregue." : "Boletim de urna impresso."}</div>
      </>,
    );
  else if (etapa.tipo === "aguardando" || etapa.tipo === "credenciando")
    tela = centro(
      <>
        <div className="text-sm uppercase tracking-widest text-stone-600">{carga.urna}</div>
        <div className="text-2xl font-bold">{etapa.tipo === "credenciando" ? "AGUARDE" : "AGUARDANDO O MESÁRIO"}</div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-stone-500" style={{ animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
      </>,
    );
  else if (etapa.tipo === "votando")
    tela = (
      <div className="flex h-full flex-col">
        <div className="text-xs uppercase tracking-widest text-stone-600">Seu voto para</div>
        <div className="mb-4 text-lg font-bold uppercase">{carga.nome}</div>
        {branco ? (
          <div className="my-auto text-center text-3xl font-bold">VOTO EM BRANCO</div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-sm">Número:</span>
              {[0, 1].map((i) => (
                <span key={i} className="grid h-14 w-11 place-items-center border-2 border-stone-700 bg-white text-3xl font-bold">
                  {digitos[i] ?? ""}
                </span>
              ))}
            </div>
            {digitos.length === 2 && (
              <div className="mt-5">{candidato ? <CandidatoNaTela opcao={candidato} grande /> : <div className="text-xl font-bold">NÚMERO ERRADO — VOTO NULO</div>}</div>
            )}
          </>
        )}
        {branco || digitos.length === 2 ? (
          <Legenda
            linhas={[
              ["CONFIRMA", "CONFIRMAR este voto"],
              ["CORRIGE", "REINICIAR este voto"],
            ]}
          />
        ) : (
          <div className="mt-auto text-xs text-stone-500">Depois de CONFIRMA, você pode testar a urna com a tecla TESTAR.</div>
        )}
      </div>
    );
  else if (etapa.tipo === "revisao")
    tela = (
      <div className="flex h-full flex-col gap-2">
        <div className="text-xs uppercase tracking-widest text-stone-600">{etapa.repeticao ? "Seu voto, de novo" : "Confira o seu voto"}</div>
        <CandidatoNaTela opcao={opcoes[etapa.opcao]} />
        <div className="mt-1 text-center font-sans text-sm font-bold text-stone-700">Guarde estas 2 figuras:</div>
        <FigurasDaCedula nomes={etapa.verif.figuras} tamanho="medio" />
        <div className="text-center">
          <CodigoVerificacao codigo={etapa.verif.codigo} conferencia={conferenciaDoSelo(etapa.verif.selo)} tamanho="medio" />
        </div>
        <Legenda
          linhas={[
            ["CONFIRMA", "VOTAR"],
            ["TESTAR", "testar a urna (esta cédula é anulada e aberta)"],
            ["CORRIGE", "escolher outro"],
          ]}
        />
      </div>
    );
  else if (etapa.tipo === "desafiada")
    tela = (
      <div className="flex h-full flex-col gap-2">
        <div className="text-xs uppercase tracking-widest text-stone-600">Teste da urna — cédula anulada</div>
        {etapa.ok ? (
          <div className="text-sm font-bold text-emerald-800">✓ A cédula testada continha:</div>
        ) : (
          <div className="rounded bg-red-100 px-3 py-2 text-sm font-bold text-red-900">
            ✕ A urna errou: você escolheu {nomeOpcao(etapa.escolhida)}, mas a cédula continha o candidato abaixo. Avise o mesário.
          </div>
        )}
        <CandidatoNaTela opcao={opcoes[etapa.declarada]} />
        <div className="text-xs text-stone-600">O código e a chave deste teste saem no seu comprovante: em casa, você confere com eles.</div>
        <Legenda
          linhas={
            etapa.ok
              ? [
                  ["CONFIRMA", `VOTAR em ${nomeOpcao(etapa.escolhida)}`],
                  ["CORRIGE", "escolher outro"],
                ]
              : [["CORRIGE", "escolher outro"]]
          }
        />
      </div>
    );
  else if (etapa.tipo === "fim")
    tela = centro(
      <>
        <div className="text-6xl font-black tracking-widest">FIM</div>
        <div className="text-sm font-bold text-stone-700">Pegue o seu comprovante. As figuras do seu voto:</div>
        <FigurasDaCedula nomes={etapa.verif.figuras} tamanho="medio" />
      </>,
    );

  // corpo da urna (tela + teclado)
  const corpo = (
    <div className="rounded-2xl bg-gradient-to-b from-stone-300 to-stone-400 p-4 shadow-lg sm:p-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-sans text-xs text-stone-700">{carga ? `Zona ${carga.secao.slice(0, 3)} · Seção ${carga.secao.slice(4)}` : ""}</span>
        <SeloSoftware software={software} />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        {/* Tela: não é sensível ao toque, como a da urna real */}
        <div className="min-h-[24rem] select-none rounded-lg border-4 border-stone-500 bg-[#f3f1e7] p-5 font-mono text-stone-900 shadow-inner">{tela}</div>

        {/* Teclado */}
        <div className="rounded-lg bg-stone-800 p-4">
          <div className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-stone-300">T-VOTE · urna de demonstração</div>
          <div className="grid grid-cols-3 gap-2">
            {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((n) => (
              <Tecla key={n} rotulo={n} desabilitada={!ativas.digitos} onClick={() => apertar(n)} />
            ))}
            <span />
            <Tecla rotulo="0" desabilitada={!ativas.digitos} onClick={() => apertar("0")} />
            <span />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button disabled={!ativas.branco} onClick={() => apertar("BRANCO")} className="rounded bg-white py-3 text-[11px] font-bold text-stone-900 disabled:opacity-50">
              BRANCO
            </button>
            <button disabled={!ativas.corrige} onClick={() => apertar("CORRIGE")} className="rounded bg-orange-500 py-3 text-[11px] font-bold text-stone-900 disabled:opacity-50">
              CORRIGE
            </button>
            <button disabled={!ativas.confirma} onClick={() => apertar("CONFIRMA")} className="rounded bg-emerald-500 py-4 text-[11px] font-bold text-stone-900 disabled:opacity-50">
              CONFIRMA
            </button>
          </div>
          <button
            disabled={!ativas.testar}
            onClick={() => apertar("TESTAR")}
            className="mt-2 w-full rounded bg-sky-400 py-2.5 text-[11px] font-bold text-stone-900 disabled:opacity-50"
            title="Testar a urna: abre a cédula que acabou de ser gravada"
          >
            🔍 TESTAR
          </button>
          <div className="mt-4 text-[11px] text-stone-400">
            <div className="mb-0.5 uppercase tracking-wide">Candidatos</div>
            <div className="space-y-0.5">
              {candidatos.map((c) => (
                <div key={c.numero} className="truncate" title={`${c.numero} — ${c.nome}${c.partido ? ` (${c.partido})` : ""}`}>
                  <span className="hash text-stone-200">{c.numero}</span> {c.nome}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* impressora da urna: um papel só por eleitor (voto + testes) */}
      {fase === "aberta" && etapa.tipo === "fim" && carga && (
        <div className="mt-4">
          <Comprovante
            eleicao={carga.nome}
            urna={carga.urna}
            recibo={etapa.recibo}
            codigo={etapa.verif.codigo}
            conferencia={conferenciaDoSelo(etapa.verif.selo)}
            figuras={etapa.verif.figuras}
            testes={etapa.testes}
            opcoes={opcoes}
          />
        </div>
      )}
      {(fase === "encerrada" || fase === "transmitida") && carga?.bu && (
        <div className="mt-4">
          <BoletimImpresso bu={carga.bu} eleicao={carga.nome} secao={carga.secao} urna={carga.urna} opcoes={opcoes} imprimivel />
        </div>
      )}
    </div>
  );

  // painel técnico ao lado da urna (fora do aparelho)
  const painel = (
    <div className="space-y-4">
      {etapa.tipo === "fim" && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <button onClick={() => window.print()} className="rounded bg-slate-900 px-3 py-1.5 font-semibold text-white">
            🖨️ Imprimir o comprovante
          </button>
          <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(etapa.recibo))} className="rounded border border-slate-300 px-3 py-1.5">
            Copiar recibo
          </button>
          {etapa.testes.map((t, i) => (
            <button key={t.codigo} onClick={() => navigator.clipboard?.writeText(JSON.stringify(t.declaracao))} className="rounded border border-slate-300 px-3 py-1.5">
              Copiar declaração do teste {etapa.testes.length > 1 ? i + 1 : ""}
            </button>
          ))}
        </div>
      )}
      {mostrarTecnico && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          <div className="text-sm font-semibold text-slate-900">O que a urna está fazendo</div>
          <Linha rotulo="Credencial (chave efêmera)" valor={detalhes.chave} />
          <Linha rotulo="O que a mesa viu (mensagem cega)" valor={detalhes.mensagemCega} />
          <Linha rotulo="Assinatura da mesa (descegada)" valor={detalhes.assinatura} />
          <Linha rotulo="Nullificador (impede voto duplo)" valor={detalhes.nullificador} />
          {etapa.tipo === "revisao" && (
            <>
              <Linha rotulo="Rastreador = hash das cifras" valor={etapa.preparada.rastreador} />
              <div>
                {etapa.preparada.escolhas.length} cifras ElGamal + {etapa.preparada.escolhas.length} provas 0-ou-1 + 1 prova de soma.
              </div>
            </>
          )}
          <div className="text-slate-400">Teclado do computador: números, Enter = CONFIRMA, Backspace = CORRIGE, T = TESTAR, B = BRANCO.</div>
          {carga && (
            <div className="border-t border-slate-100 pt-3">
              <div className="font-medium text-slate-500">Carga desta urna</div>
              <div>
                Seção {carga.secao} · fase <strong>{carga.fase}</strong> · chave <span className="hash">{digital(carga.chave_urna)}</span>
              </div>
            </div>
          )}
          {instalacao && (
            <div className="border-t border-slate-100 pt-3">
              <div className="font-medium text-slate-500">Pareamento</div>
              <div>
                {instalacao.nome} <span className="hash text-slate-400">({instalacao.id})</span>
              </div>
              <button onClick={desinstalar} className="mt-1 text-slate-500 underline">
                desparear esta urna
              </button>
            </div>
          )}
        </div>
      )}
      {mostrarTecnico && etapa.tipo === "fim" && carga && (
        <VerificacaoNaUrna key={etapa.recibo.rastreador} recibo={etapa.recibo} cedula={etapa.cedula} verif={etapa.verif} carga={carga} software={software} />
      )}
      {carga?.zeresima && (
        <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Zerésima impressa na abertura</summary>
          <div className="mt-3">
            <ZeresimaImpressa zeresima={carga.zeresima} eleicao={carga.nome} opcoes={opcoes} />
          </div>
        </details>
      )}
    </div>
  );

  const bannerLaboratorio = perfil === "laboratorio" && urna?.parametros && (
    <Aviso tipo="erro" titulo={`Urna de laboratório com software ADULTERADO${carga ? ` — seção ${carga.secao}` : ""}`}>
      {descreverFraude(urna.parametros, opcoes)} A tela mostra ao eleitor o que ele digitou e o BU sai coerente (a auditoria matemática passa). Depois
      que a seção for transmitida, confira em casa:{" "}
      <Link href="/teste" className="underline">
        Conferir teste
      </Link>{" "}
      (código e chave do teste) ou{" "}
      <Link href="/verificar" className="underline">
        Verificar voto
      </Link>{" "}
      (código do voto).
    </Aviso>
  );

  // Modo cabine: só o aparelho, em tela cheia, como a urna no canto da seção.
  if (cabine)
    return (
      <div className="fixed inset-0 z-30 overflow-auto bg-stone-800 p-4 sm:p-8">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-400">
            <span>{carga?.urna ?? instalacao?.nome ?? "Urna não instalada"} · cabine de votação</span>
            <span className="flex gap-4">
              <button onClick={() => void document.documentElement.requestFullscreen?.()} className="underline hover:text-white">
                tela cheia
              </button>
              <Link href="/urna" className="underline hover:text-white">
                sair do modo cabine
              </Link>
            </span>
          </div>
          {avisos}
          {corpo}
        </div>
      </div>
    );

  return (
    <Pagina
      titulo={perfil === "laboratorio" ? "Laboratório: urna adulterada" : "Urna"}
      subtitulo="A urna trabalha sem rede e sem tela de toque: tudo pelo teclado dela. Fala só com a mesa e com a própria memória; a mídia (zerésima + BU) vai para o TSE depois do encerramento."
      acoes={
        <div className="flex flex-wrap items-center gap-3">
          {perfil === "padrao" && (
            <Link href="/cabine" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
              Modo cabine
            </Link>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={mostrarTecnico} onChange={(e) => setMostrarTecnico(e.target.checked)} />
            detalhes técnicos
          </label>
          {fase && <Selo cor={fase === "aberta" ? "verde" : fase === "carregada" ? "amarelo" : "cinza"}>seção {fase}</Selo>}
        </div>
      }
    >
      {bannerLaboratorio}
      {avisos}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {corpo}
        {painel}
      </div>
    </Pagina>
  );
}

function Tecla({ rotulo, onClick, desabilitada }: { rotulo: string; onClick: () => void; desabilitada: boolean }) {
  return (
    <button
      disabled={desabilitada}
      onClick={onClick}
      className="rounded bg-stone-950 py-3 text-xl font-semibold text-white shadow-[inset_0_-3px_0_rgba(255,255,255,0.1)] hover:bg-black disabled:opacity-50"
    >
      {rotulo}
    </button>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string }) {
  return (
    <div>
      <div className="font-medium text-slate-500">{rotulo}</div>
      <Hash valor={valor} n={28} />
    </div>
  );
}
