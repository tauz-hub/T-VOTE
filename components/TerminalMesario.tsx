"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, mensagemDeErro, useEleicao } from "@/lib/client/api";
import type { UrnaMesa } from "@/lib/tipos-api";
import { type Eleitor, SeloSituacao } from "@/components/eleitor";
import { BoletimImpresso, ZeresimaImpressa, digital } from "@/components/Impressos";
import { Aviso, Botao, Cartao, Estatistica, Pagina, Selo } from "@/components/ui";

const FASES = { carregada: "Carga feita", aberta: "Seção aberta", encerrada: "Seção encerrada", transmitida: "Mídia entregue" } as const;

function SeloUrna({ u }: { u: UrnaMesa }) {
  if (!u.online) return <Selo cor="vermelho">Sem conexão</Selo>;
  if (u.estado === "liberada") return <Selo cor="amarelo">Liberada</Selo>;
  if (u.estado === "votando") return <Selo cor="azul">Eleitor votando</Selo>;
  return <Selo cor="verde">Livre</Selo>;
}

/**
 * O terminal do mesário. Em `/mesario` aparece dentro do site, com atalhos para
 * abrir as janelas da seção; em `/terminal` (modo quiosque) é só o que o
 * mesário vê no aparelho dele, sem rede e sem menus.
 */
export function TerminalMesario({ quiosque = false }: { quiosque?: boolean }) {
  const { estado, recarregar } = useEleicao(4000);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Eleitor[]>([]);
  const [selecionado, setSelecionado] = useState<Eleitor | null>(null);
  const [urnas, setUrnas] = useState<UrnaMesa[]>([]);
  const [urnaId, setUrnaId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = useCallback(async (termo: string) => {
    if (termo.trim().length < 2) return setResultados([]);
    const r = await api<{ eleitores: Eleitor[] }>(`/api/registro/eleitores?busca=${encodeURIComponent(termo)}`);
    setResultados(r.eleitores);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void buscar(busca), 200);
    return () => clearTimeout(id);
  }, [busca, buscar]);

  // estado das urnas pareadas, como o painel do terminal do mesário (ligado por cabo à urna)
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    const consultar = () =>
      api<{ urnas: UrnaMesa[] }>("/api/mesario/urnas")
        .then((r) => ativo && setUrnas(r.urnas))
        .catch(() => {});
    void consultar();
    const id = setInterval(consultar, 1000);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [versao]);

  const urna = urnas.find((u) => u.id === urnaId) ?? urnas.find((u) => u.online) ?? urnas[0];
  const carga = urna?.carga ?? null;
  const fase = carga?.fase;
  const aberta = fase === "aberta";
  const s = estado?.estatisticas;

  function limparBusca() {
    setSelecionado(null);
    setBusca("");
    setResultados([]);
  }

  async function executar(acao: () => Promise<unknown>) {
    setErro(null);
    setMsg(null);
    setOcupado(true);
    try {
      await acao();
      void recarregar();
      setVersao((v) => v + 1);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const liberar = (e: Eleitor) =>
    executar(async () => {
      await api("/api/mesario/liberar", { urna_id: urna!.id, eleitor_id: e.id });
      limparBusca();
    });

  const cancelar = (u: UrnaMesa) => {
    if (u.estado === "votando" && !window.confirm("Interromper a votação? A credencial do eleitor será descartada e ele constará como compareceu, sem voto."))
      return;
    void executar(() => api("/api/mesario/cancelar", { urna_id: u.id }));
  };

  const remover = (u: UrnaMesa) => {
    if (!window.confirm(`Remover "${u.nome}"? Ela precisará ser instalada de novo para votar.`)) return;
    void executar(() => api("/api/mesario/remover-urna", { urna_id: u.id }));
  };

  /** Abertura, encerramento, carga e entrega da mídia — a rotina da mesa, como hoje. */
  const secao = (acao: "carga" | "abrir" | "encerrar" | "transmitir", confirmar?: string) => {
    if (!urna || (confirmar && !window.confirm(confirmar))) return;
    void executar(async () => {
      const r = await api<{ bloco?: number }>("/api/mesario/secao", { urna_id: urna.id, acao });
      setMsg(
        {
          carga: `Carga feita: a chave da urna foi gerada dentro dela e a pública publicada no bloco ${r.bloco}.`,
          abrir: "Seção aberta — a urna imprimiu a zerésima (nenhum voto na memória). Fiscais: fotografem.",
          encerrar: "Seção encerrada — a urna imprimiu o BU. Cole uma via na porta da seção e entregue a mídia ao TSE.",
          transmitir: `Mídia recebida e conferida pelo TSE: publicada no bloco ${r.bloco}.`,
        }[acao],
      );
    });
  };

  // Cada aparelho da seção numa janela própria: a urna "no canto" e o terminal na mesa.
  const abrirCabine = () => window.open("/cabine", "tai-vote-cabine", "popup,width=1000,height=760");
  const abrirTerminal = () => window.open("/terminal", "tai-vote-terminal", "popup,width=1100,height=820");

  const podeLiberar = !!urna && urna.online && urna.estado === "livre" && aberta;

  const conteudo = (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Estatistica rotulo="Aptos (caderno)" valor={s?.aptos ?? "—"} />
        <Estatistica rotulo="Compareceram" valor={s?.credenciados ?? "—"} />
        <Estatistica rotulo="Comparecimento nesta urna" valor={urna?.comparecimento ?? "—"} dica="Credenciais assinadas pela mesa desta seção — vai impresso no BU" />
        <Estatistica rotulo="Liberações pendentes" valor={s?.habilitados ?? "—"} />
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {msg && <Aviso tipo="ok">{msg}</Aviso>}

      <Cartao
        titulo={urna ? `Seção ${carga?.secao ?? `${urna.zona}-${urna.secao}`}` : "Seção"}
        descricao={urna ? urna.nome : undefined}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {urnas.length > 1 && (
              <select value={urna?.id} onChange={(e) => setUrnaId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                {urnas.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                    {u.online ? "" : " (sem conexão)"}
                  </option>
                ))}
              </select>
            )}
            {!quiosque && (
              <Botao variante="secundario" onClick={abrirCabine} title="Abre só a urna numa janela separada — posicione ao lado desta">
                Abrir urna em outra janela
              </Botao>
            )}
          </div>
        }
      >
        {!urna ? (
          <Aviso tipo="alerta" titulo="Nenhuma urna pareada">
            Abra a urna (<Link href="/cabine" className="underline">/cabine</Link>) e instale-a pelo teclado dela: zona, CONFIRMA, seção, CONFIRMA —
            feito uma vez pela equipe técnica.
          </Aviso>
        ) : (
          <div className="space-y-4">
            <ol className="grid gap-2 text-sm sm:grid-cols-4">
              {(["carregada", "aberta", "encerrada", "transmitida"] as const).map((f, i) => {
                const ordem = ["carregada", "aberta", "encerrada", "transmitida"];
                const feito = fase ? ordem.indexOf(fase) >= i : false;
                return (
                  <li key={f} className={`rounded-lg px-3 py-2 ring-1 ${fase === f ? "bg-slate-900 text-white ring-slate-900" : feito ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-white text-slate-500 ring-slate-200"}`}>
                    {i + 1}. {["Carga", "Abertura (zerésima)", "Encerramento (BU)", "Mídia ao TSE"][i]}
                  </li>
                );
              })}
            </ol>

            {!carga && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-600">
                  {estado?.fase === "aberta"
                    ? "A urna ainda não recebeu a carga desta eleição (a urna gera a própria chave; a pública vai para o quadro)."
                    : "Aguardando o TSE abrir a eleição para a carga das urnas."}
                </p>
                <Botao onClick={() => secao("carga")} disabled={ocupado || estado?.fase !== "aberta"}>
                  Fazer a carga
                </Botao>
              </div>
            )}
            {fase === "carregada" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-600">
                  Chave da urna <span className="hash">{digital(carga!.chave_urna)}</span>. Na abertura, a urna imprime a zerésima.
                </p>
                <Botao variante="sucesso" onClick={() => secao("abrir")} disabled={ocupado}>
                  Abrir a seção — imprimir zerésima
                </Botao>
              </div>
            )}
            {fase === "aberta" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <SeloUrna u={urna} />
                  <span className="text-sm text-slate-600">
                    {urna.estado === "livre"
                      ? urna.online
                        ? "Urna livre. Identifique o próximo eleitor e libere."
                        : "Verifique se a tela da urna está aberta."
                      : urna.estado === "liberada"
                        ? `Urna liberada para ${urna.eleitor ?? "o eleitor"}.`
                        : "Eleitor votando — a mesa já não sabe quem é."}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {urna.estado === "liberada" && (
                    <Botao variante="secundario" onClick={() => cancelar(urna)}>
                      Cancelar liberação
                    </Botao>
                  )}
                  {urna.estado === "votando" && (
                    <Botao variante="perigo" onClick={() => cancelar(urna)}>
                      Interromper (eleitor desistiu)
                    </Botao>
                  )}
                  <Botao
                    variante="perigo"
                    onClick={() => secao("encerrar", "Encerrar a seção? A urna imprime o BU e não aceita mais votos.")}
                    disabled={ocupado || urna.estado !== "livre"}
                  >
                    Encerrar a seção — imprimir BU
                  </Botao>
                </div>
              </div>
            )}
            {fase === "encerrada" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-600">BU impresso. Entregue a mídia ao TSE — pela transmissão ou levando o arquivo (pen drive).</p>
                <Botao onClick={() => secao("transmitir")} disabled={ocupado || estado?.fase !== "aberta"}>
                  Transmitir a mídia ao TSE
                </Botao>
                <a href={`/api/mesario/midia?urna_id=${urna.id}`} className="text-sm text-slate-700 underline">
                  Baixar a mídia (arquivo)
                </a>
              </div>
            )}
            {fase === "transmitida" && (
              <p className="text-sm text-emerald-800">
                ✓ Mídia conferida pelo TSE e publicada no bloco {carga!.bloco}. Qualquer pessoa compara o BU publicado com o papel da porta em{" "}
                <Link href="/verificar" className="underline">
                  Verificar voto → Boletim da seção
                </Link>
                .
              </p>
            )}
            {urna.estado === "livre" && !urna.online && (
              <button onClick={() => remover(urna)} className="text-xs text-slate-500 underline">
                Remover esta urna da mesa (ex.: urna de teste ou de outro computador)
              </button>
            )}
          </div>
        )}
      </Cartao>

      <div className="grid gap-6 lg:grid-cols-2">
        <Cartao titulo="Identificar e liberar o eleitor" descricao="Busque pelo documento ou pelo nome.">
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setSelecionado(null);
            }}
            placeholder="Documento ou nome"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-lg"
          />
          <ul className="mt-3 divide-y divide-slate-100">
            {resultados.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelecionado(e)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 ${selecionado?.id === e.id ? "bg-slate-100" : ""}`}
                >
                  <span>
                    <span className="font-medium text-slate-900">{e.nome}</span>
                    <span className="hash ml-2 text-xs text-slate-500">{e.documento}</span>
                  </span>
                  <SeloSituacao e={e} />
                </button>
              </li>
            ))}
          </ul>
          {busca.trim().length >= 2 && resultados.length === 0 && <p className="mt-3 text-sm text-slate-500">Nenhum eleitor encontrado.</p>}

          {selecionado && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-lg font-semibold text-slate-900">{selecionado.nome}</div>
                <div className="mt-1 text-sm text-slate-600">
                  Documento <span className="hash">{selecionado.documento}</span> · Seção {selecionado.secao}
                </div>
                <div className="mt-2">
                  <SeloSituacao e={selecionado} />
                </div>
              </div>
              {selecionado.situacao === "credenciado" ? (
                <Aviso tipo="erro">Este eleitor já compareceu e recebeu credencial. Não é possível votar de novo.</Aviso>
              ) : !selecionado.apto ? (
                <Aviso tipo="erro">Eleitor inapto.</Aviso>
              ) : (
                <>
                  <Botao onClick={() => liberar(selecionado)} disabled={!podeLiberar} className="w-full py-3 text-base">
                    Conferi o documento — liberar {urna ? urna.nome : "a urna"}
                  </Botao>
                  {urna && !podeLiberar && (
                    <p className="text-xs text-slate-500">
                      {!aberta ? "A seção não está aberta." : !urna.online ? "A urna está sem conexão com a mesa." : "A urna está ocupada — aguarde o eleitor atual terminar."}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </Cartao>

        <Cartao
          titulo="Impressora da urna"
          descricao={fase === "encerrada" || fase === "transmitida" ? "Boletim de urna — uma via vai para a porta da seção." : "Zerésima — impressa na abertura."}
          acoes={
            (carga?.zeresima || carga?.bu) && (
              <Botao variante="secundario" onClick={() => window.print()}>
                🖨️ Imprimir
              </Botao>
            )
          }
        >
          {carga?.bu ? (
            <BoletimImpresso bu={carga.bu} eleicao={carga.nome} secao={carga.secao} urna={carga.urna} opcoes={carga.opcoes} imprimivel />
          ) : carga?.zeresima ? (
            <ZeresimaImpressa zeresima={carga.zeresima} eleicao={carga.nome} opcoes={carga.opcoes} imprimivel />
          ) : (
            <p className="text-sm text-slate-500">Nada impresso ainda: a zerésima sai quando a seção for aberta.</p>
          )}
        </Cartao>
      </div>

      {!quiosque && (
        <Aviso titulo="O que fica registrado">
          O caderno marca o eleitor como “compareceu” quando a urna troca a liberação por uma credencial. Ele <strong>não</strong> grava a ordem nem o
          horário de comparecimento, a urna nunca recebe o nome de quem vota, e a mesa assina a credencial às cegas — por isso não há como cruzar a
          fila da seção com as cédulas do BU.
        </Aviso>
      )}
    </>
  );

  // Modo quiosque: só o terminal, em tela cheia, como o aparelho do mesário na seção (sem rede, sem menus).
  if (quiosque)
    return (
      <div className="fixed inset-0 z-30 overflow-auto bg-slate-800 p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400">Terminal do mesário · sem rede</div>
              <div className="text-lg font-semibold">
                {urna ? `Zona ${urna.zona} · Seção ${urna.secao}` : "Nenhuma urna ligada"}
                {fase && <span className="ml-3 align-middle text-sm font-normal text-slate-300">{FASES[fase]}</span>}
              </div>
            </div>
            <span className="flex gap-4 text-xs text-slate-400">
              <button onClick={() => void document.documentElement.requestFullscreen?.()} className="underline hover:text-white">
                tela cheia
              </button>
              <Link href="/mesario" className="underline hover:text-white">
                sair do terminal
              </Link>
            </span>
          </div>
          {conteudo}
        </div>
      </div>
    );

  return (
    <Pagina
      titulo="Mesa receptora"
      subtitulo="O terminal do mesário é ligado à urna, como hoje, e nenhum dos dois fala com o TSE durante a votação. A mesa abre a seção (zerésima), confere o documento e libera a urna, encerra (BU) e entrega a mídia."
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="secundario" onClick={abrirTerminal} title="Abre só a tela do mesário numa janela separada">
            Abrir terminal do mesário
          </Botao>
          <Botao variante="secundario" onClick={abrirCabine} title="Abre só a urna numa janela separada">
            Abrir urna
          </Botao>
          {fase && <Selo cor={aberta ? "verde" : "cinza"}>{FASES[fase]}</Selo>}
        </div>
      }
    >
      {conteudo}
    </Pagina>
  );
}
