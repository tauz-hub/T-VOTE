"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErroApi, api, mensagemDeErro, useEleicao } from "@/lib/client/api";
import { simularEleitor, urnaDeSimulacao } from "@/lib/client/protocolo";
import { formatarCodigo } from "@/lib/crypto/palavras";
import { CANDIDATOS_PADRAO, MAX_CANDIDATOS, NOME_ELEICAO_PADRAO } from "@/lib/padroes";
import type { EstadoPublico } from "@/lib/tipos-api";
import type { Eleitor } from "@/components/eleitor";
import { FotoCandidato, prepararFoto } from "@/components/FotoCandidato";
import { LaboratorioFraudes } from "@/components/LaboratorioFraudes";
import { Aviso, Botao, Campo, Cartao, Estatistica, Hash, Pagina, Selo, SeloFase } from "@/components/ui";

type Aba = "eleicao" | "bancos" | "simulacao" | "ataques";

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "eleicao", rotulo: "Eleição" },
  { id: "bancos", rotulo: "Bancos de dados" },
  { id: "simulacao", rotulo: "Simulação" },
  { id: "ataques", rotulo: "Laboratório de ataques" },
];

export default function Admin() {
  const { estado, recarregar } = useEleicao(4000);
  const [aba, setAba] = useState<Aba>("eleicao");

  return (
    <Pagina
      titulo="Administração"
      subtitulo="O administrador (TSE) cria, abre e encerra a eleição, recebe as mídias das seções e pode ler todos os bancos. Mesmo assim, não consegue ligar eleitor a voto, não consegue decifrar cédulas, não consegue alterar uma seção sem a chave da urna e não consegue apurar sem os três trustees."
      acoes={<SeloFase fase={estado?.fase} />}
    >
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === a.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === "eleicao" && <AbaEleicao estado={estado} recarregar={recarregar} />}
      {aba === "bancos" && <AbaBancos />}
      {aba === "simulacao" && <AbaSimulacao estado={estado} recarregar={recarregar} />}
      {aba === "ataques" && <AbaAtaques estado={estado} />}
    </Pagina>
  );
}

// ------------------------------------------------------------------ eleição

function AbaEleicao({ estado, recarregar }: { estado: EstadoPublico | null; recarregar: () => Promise<unknown> }) {
  const [nome, setNome] = useState(NOME_ELEICAO_PADRAO);
  // foto: hash de uma foto já guardada no servidor ou data URL de uma foto nova
  const [candidatos, setCandidatos] = useState<{ numero: string; nome: string; partido: string; foto?: string }[]>(CANDIDATOS_PADRAO);
  const [preenchido, setPreenchido] = useState(false);
  const alterar = (i: number, campo: "numero" | "nome" | "partido" | "foto", valor: string | undefined) =>
    setCandidatos(candidatos.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));

  // parte da eleição atual (com as fotos já seladas), para recriar sem recarregar tudo
  if (estado && !preenchido) {
    setPreenchido(true);
    const atuais = estado.opcoes?.filter((o) => o.tipo === "candidato") ?? [];
    if (estado.existe && atuais.length >= 2) {
      setNome(estado.nome ?? NOME_ELEICAO_PADRAO);
      setCandidatos(atuais.map((o) => ({ numero: o.numero ?? "", nome: o.nome, partido: o.partido ?? "", foto: o.foto })));
    }
  }

  async function escolherFoto(i: number, arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      alterar(i, "foto", await prepararFoto(arquivo));
    } catch {
      setMsg({ tipo: "erro", texto: "Não foi possível ler a imagem" });
    }
  }
  const proximoNumero = () => {
    for (let n = 10; n <= 99; n++) if (!candidatos.some((c) => c.numero === String(n))) return String(n);
    return "";
  };
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: string, extra: object = {}, confirmar?: string) {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(true);
    setMsg(null);
    try {
      try {
        await api("/api/admin/eleicao", { acao, ...extra });
      } catch (e) {
        // seções que receberam carga mas não transmitiram: o TSE pode encerrar mesmo assim (ficam declaradas no encerramento)
        if (!(acao === "encerrar" && e instanceof ErroApi && e.detalhes?.length)) throw e;
        if (!window.confirm(`Ainda sem mídia: ${e.detalhes.join(", ")}.\n\nEncerrar mesmo assim? Os votos dessas seções ficam fora do resultado (o BU em papel delas continua valendo).`)) return;
        await api("/api/admin/eleicao", { acao, forcar: true });
      }
      setMsg({
        tipo: "ok",
        texto:
          {
            criar: "Eleição criada — bloco de gênese publicado.",
            abrir: "Eleição aberta — chave conjunta publicada. As urnas já podem receber a carga.",
            encerrar: "Eleição encerrada — o TSE não recebe mais mídias. Agora os trustees apuram.",
          }[acao] ?? "OK",
      });
      await recarregar();
    } catch (e) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function resetar() {
    if (!window.confirm("Apagar TODOS os dados (eleitores, eleição, chaves)?")) return;
    await api("/api/admin/resetar", {});
    setMsg({ tipo: "ok", texto: "Todos os bancos foram recriados vazios." });
    await recarregar();
  }

  const s = estado?.estatisticas;
  const fase = estado?.fase;

  return (
    <div className="space-y-6">
      {msg && <Aviso tipo={msg.tipo === "ok" ? "ok" : "erro"}>{msg.texto}</Aviso>}

      {estado?.existe && (
        <Cartao titulo={estado.nome} descricao={<>ID {estado.eleicao_id} · software <Hash valor={estado.software} /></>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Estatistica rotulo="Trustees" valor={`${estado.trustees.length}/3`} />
            <Estatistica rotulo="Credenciais" valor={s?.credenciais_emitidas ?? 0} dica="Emitidas pelas mesas de todas as seções" />
            <Estatistica rotulo="Seções" valor={`${s?.secoes_transmitidas ?? 0}/${s?.secoes_carregadas ?? 0}`} dica="Mídias recebidas / urnas com carga" />
            <Estatistica rotulo="Cédulas no quadro" valor={s?.cedulas_publicadas ?? 0} />
            <Estatistica rotulo="Blocos" valor={s?.blocos ?? 0} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Botao onClick={() => executar("abrir")} disabled={ocupado || fase !== "configuracao" || estado.trustees.length < 3} variante="sucesso">
              Abrir eleição (liberar carga das urnas)
            </Botao>
            <Botao
              onClick={() => executar("encerrar", {}, "Encerrar a eleição? O TSE deixa de receber mídias de seção.")}
              disabled={ocupado || fase !== "aberta"}
              variante="perigo"
            >
              Encerrar recebimento
            </Botao>
            {fase === "configuracao" && estado.trustees.length < 3 && (
              <span className="self-center text-sm text-slate-500">
                Para abrir, os 3 trustees precisam publicar as chaves em <Link href="/apuracao" className="underline">Trustees</Link>.
              </span>
            )}
            {fase === "encerrada" && (
              <span className="self-center text-sm text-slate-500">
                Agora os trustees decifram cada seção em <Link href="/apuracao" className="underline">Trustees</Link>. O admin não consegue apurar sozinho.
              </span>
            )}
          </div>
        </Cartao>
      )}

      {estado?.existe && fase !== "configuracao" && <SecoesDoTse aberta={fase === "aberta"} aoMudar={recarregar} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Cartao titulo="Nova eleição" descricao="Publica um novo bloco de gênese. Apaga o quadro, as cargas e a memória das urnas e zera o comparecimento (os eleitores cadastrados e o pareamento das urnas são mantidos).">
          <div className="space-y-4">
            <Campo rotulo="Nome da eleição" value={nome} onChange={(e) => setNome(e.target.value)} />
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-slate-700">
                  Candidatos ({candidatos.length}/{MAX_CANDIDATOS})
                </span>
                <span className="text-xs text-slate-500">Clique no círculo para trocar a foto · fotos padrão: TSE (CC BY) · Branco e Nulo são automáticos</span>
              </div>
              <div className="mb-1 grid grid-cols-[2.5rem_4rem_1fr_8rem_2.5rem] gap-2 text-xs text-slate-500">
                <span>Foto</span>
                <span>Número</span>
                <span>Nome</span>
                <span>Partido</span>
              </div>
              <div className="space-y-2">
                {candidatos.map((c, i) => (
                  <div key={i} className="grid grid-cols-[2.5rem_4rem_1fr_8rem_2.5rem] items-center gap-2">
                    <label className="cursor-pointer" title={c.foto ? "Trocar foto" : "Adicionar foto"}>
                      <FotoCandidato
                        tamanho="sm"
                        nome={c.nome || "?"}
                        hash={c.foto && /^[0-9a-f]{64}$/.test(c.foto) ? c.foto : undefined}
                        src={
                          c.foto?.startsWith("data:")
                            ? c.foto
                            : c.foto?.startsWith("padrao:")
                              ? `/candidatos/${c.foto.slice(7)}.jpg`
                              : undefined
                        }
                      />
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => escolherFoto(i, e.target.files?.[0])} />
                    </label>
                    <input
                      value={c.numero}
                      maxLength={2}
                      onChange={(e) => alterar(i, "numero", e.target.value.replace(/\D/g, ""))}
                      className="hash rounded-lg border border-slate-300 px-2 py-1.5 text-center"
                    />
                    <input value={c.nome} onChange={(e) => alterar(i, "nome", e.target.value)} className="min-w-0 rounded-lg border border-slate-300 px-3 py-1.5" />
                    <input value={c.partido} onChange={(e) => alterar(i, "partido", e.target.value)} className="min-w-0 rounded-lg border border-slate-300 px-3 py-1.5" />
                    <Botao variante="secundario" onClick={() => setCandidatos(candidatos.filter((_, j) => j !== i))} disabled={candidatos.length <= 2} className="px-0">
                      ✕
                    </Botao>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Botao
                  variante="secundario"
                  disabled={candidatos.length >= MAX_CANDIDATOS}
                  onClick={() => setCandidatos([...candidatos, { numero: proximoNumero(), nome: "", partido: "" }])}
                >
                  + candidato
                </Botao>
                <Botao variante="secundario" onClick={() => setCandidatos(CANDIDATOS_PADRAO)}>
                  Restaurar padrão (com fotos do TSE)
                </Botao>
                <Botao variante="secundario" onClick={() => setCandidatos(candidatos.map((c) => ({ ...c, foto: undefined })))}>
                  Remover fotos
                </Botao>
              </div>
            </div>
            <Botao
              onClick={() => executar("criar", { nome, candidatos }, estado?.existe ? "Criar nova eleição? A eleição atual, o quadro e a memória das urnas serão apagados." : undefined)}
              disabled={ocupado}
            >
              Criar eleição
            </Botao>
          </div>
        </Cartao>

        <div className="space-y-6">
          <Cartao titulo="Separação de privilégios">
            <ul className="space-y-2 text-sm text-slate-700">
              <li>✕ não lê votos (só cifras)</li>
              <li>✕ não fala com as urnas durante a votação</li>
              <li>✕ não altera uma seção sem a chave da urna</li>
              <li>✕ não apura sozinho (precisa dos 3 trustees)</li>
              <li>✕ não liga eleitor a cédula</li>
              <li>✓ cria, abre e encerra a eleição</li>
              <li>✓ lê todos os bancos (veja a aba ao lado)</li>
            </ul>
          </Cartao>
          <Cartao titulo="Zona de perigo">
            <Botao variante="perigo" onClick={resetar} className="w-full">
              Apagar todos os dados
            </Botao>
          </Cartao>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ seções

type SecaoTse = {
  urna_id: string;
  nome: string;
  secao: string;
  fase: "carregada" | "aberta" | "encerrada" | "transmitida";
  estado: string;
  firmware: "oficial" | "adulterado";
  cedulas: number;
  desafiadas: number;
  comparecimento: number;
  bloco: number | null;
};

/**
 * Visão do laboratório sobre as seções. No mundo real o TSE não vê nada disto
 * durante a votação — só recebe a mídia depois. Aqui, no mesmo computador, dá
 * para acompanhar e usar o atalho "encerrar e transmitir" de cada seção.
 */
function SecoesDoTse({ aberta, aoMudar }: { aberta: boolean; aoMudar: () => Promise<unknown> }) {
  const [dados, setDados] = useState<{ urnas: SecaoTse[]; sem_midia: string[] } | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    const consultar = () =>
      api<{ urnas: SecaoTse[]; sem_midia: string[] }>("/api/admin/secoes")
        .then((d) => ativo && setDados(d))
        .catch(() => {});
    void consultar();
    const id = setInterval(consultar, 3000);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [versao]);

  async function acao(fn: () => Promise<string>) {
    setMsg(null);
    try {
      setMsg({ tipo: "ok", texto: await fn() });
    } catch (e) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(e) });
    }
    setVersao((v) => v + 1);
    await aoMudar();
  }

  const encerrarETransmitir = (u: SecaoTse) =>
    acao(async () => {
      if (u.fase === "aberta") await api("/api/mesario/secao", { urna_id: u.urna_id, acao: "encerrar" });
      const r = await api<{ bloco: number }>("/api/mesario/secao", { urna_id: u.urna_id, acao: "transmitir" });
      return `Seção ${u.secao}: BU impresso e mídia recebida no bloco ${r.bloco}.`;
    });

  const receberArquivo = (arquivo: File) =>
    acao(async () => {
      const midia = JSON.parse(await arquivo.text());
      const r = await api<{ bloco: number; secao: string }>("/api/admin/midia", { midia });
      return `Mídia da seção ${r.secao} conferida e publicada no bloco ${r.bloco}.`;
    });

  return (
    <Cartao
      titulo="Seções (urnas com carga)"
      descricao="Durante a votação o TSE não fala com as seções. A mídia (zerésima + BU assinados pela urna) chega depois do encerramento e só é publicada se conferir com a carga."
      acoes={
        aberta && (
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Receber mídia (arquivo)…
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && receberArquivo(e.target.files[0])} />
          </label>
        )
      }
    >
      {msg && <Aviso tipo={msg.tipo === "ok" ? "ok" : "erro"}>{msg.texto}</Aviso>}
      {!dados || dados.urnas.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma urna recebeu carga ainda. Abra a Urna (ou a urna do laboratório) e faça a carga.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">Seção</th>
              <th className="py-2 pr-3">Urna</th>
              <th className="py-2 pr-3">Fase</th>
              <th className="py-2 pr-3">Na memória</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {dados.urnas.map((u) => (
              <tr key={u.urna_id} className="border-b border-slate-100">
                <td className="hash py-2 pr-3">{u.secao}</td>
                <td className="py-2 pr-3">
                  {u.nome} {u.firmware === "adulterado" && <Selo cor="vermelho">laboratório: adulterada</Selo>}
                </td>
                <td className="py-2 pr-3">
                  <Selo cor={u.fase === "transmitida" ? "verde" : u.fase === "aberta" ? "azul" : u.fase === "encerrada" ? "amarelo" : "cinza"}>
                    {u.fase}
                    {u.bloco ? ` · bloco ${u.bloco}` : ""}
                  </Selo>
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {u.cedulas} cédulas · {u.desafiadas} testes · comparecimento {u.comparecimento}
                </td>
                <td className="py-2 text-right">
                  {aberta && (u.fase === "aberta" || u.fase === "encerrada") && (
                    <Botao variante="secundario" onClick={() => encerrarETransmitir(u)} disabled={u.estado !== "livre"} title="Atalho: o mesário encerra a seção e a mídia é levada ao TSE">
                      {u.fase === "aberta" ? "Encerrar e transmitir" : "Transmitir"}
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------ bancos

type Tabela = { nome: string; colunas: string[]; linhas: Record<string, unknown>[]; total: number };
type Despejo = { bancos: { nome: string; arquivo: string; descricao: string; tabelas: Tabela[] }[]; chave_quadro: { arquivo: string; publica: string } | null };

const COLUNAS_IDENTIDADE = ["nome", "documento", "eleitor_id", "cpf"];
const COLUNAS_PRIVADAS = ["d", "p", "q", "dp", "dq", "qinv", "chave_privada"];
const COLUNAS_TEMPO = ["em", "criado_em", "horario", "timestamp", "recebido_em"];

function Celula({ valor, coluna, banco, abrir }: { valor: unknown; coluna: string; banco: string; abrir: (t: string) => void }) {
  if (valor === null || valor === undefined) return <span className="text-slate-300">null</span>;
  const texto = String(valor);
  const privada = (banco === "autoridade" || banco === "urnas") && COLUNAS_PRIVADAS.includes(coluna);
  if (texto.length <= 36) return <span className={privada ? "text-red-700" : ""}>{texto}</span>;
  return (
    <button onClick={() => abrir(texto)} className={`hash text-left hover:underline ${privada ? "text-red-700" : "text-slate-600"}`} title="Ver completo">
      {texto.slice(0, 28)}… <span className="text-slate-400">({texto.length})</span>
    </button>
  );
}

function AbaBancos() {
  const [dados, setDados] = useState<Despejo | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [versao, setVersao] = useState(0);
  const carregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    let ativo = true;
    api<Despejo>("/api/admin/bancos")
      .then((d) => ativo && setDados(d))
      .catch((e) => ativo && setErro(mensagemDeErro(e)));
    return () => {
      ativo = false;
    };
  }, [versao]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return <div className="py-10 text-center text-sm text-slate-500">Lendo os quatro bancos…</div>;

  const colunasDe = (banco: string) => dados.bancos.find((b) => b.nome === banco)?.tabelas.flatMap((t) => t.colunas.map((c) => `${t.nome}.${c}`)) ?? [];
  const identidadeNoBoletim = colunasDe("boletim").filter((c) => COLUNAS_IDENTIDADE.includes(c.split(".")[1]));
  const votoNoRegistro = colunasDe("registro").filter((c) => /cedula|voto|cifra|rastreador|nullificador/.test(c));
  const identidadeNaUrna = colunasDe("urnas").filter((c) => COLUNAS_IDENTIDADE.includes(c.split(".")[1]));
  const tempoNaUrna = colunasDe("urnas").filter((c) => c.startsWith("cedulas.") && COLUNAS_TEMPO.includes(c.split(".")[1]));

  const formatar = (t: string) => {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      return t;
    }
  };

  return (
    <div className="space-y-6">
      <Cartao titulo="Análise automática de separação" acoes={<Botao variante="secundario" onClick={carregar}>Recarregar</Botao>}>
        <ul className="space-y-1.5 text-sm">
          <li>{identidadeNoBoletim.length + identidadeNaUrna.length === 0 ? "✓" : "✕"} Nenhuma coluna de identidade (nome, documento, eleitor_id) na memória da urna (D) nem no quadro (C) {[...identidadeNaUrna, ...identidadeNoBoletim].join(", ")}</li>
          <li>{votoNoRegistro.length === 0 ? "✓" : "✕"} Nenhuma coluna de voto, cifra ou rastreador no caderno (A) {votoNoRegistro.join(", ")}</li>
          <li>{tempoNaUrna.length === 0 ? "✓" : "✕"} Memória da urna sem carimbo de horário e sem id sequencial (WITHOUT ROWID, chave = urna + rastreador)</li>
          <li>✓ A chave privada de cada urna fica na memória da própria urna (Banco D); o quadro só tem a pública</li>
          <li>✓ Nenhuma chave estrangeira entre bancos — são arquivos SQLite separados</li>
          {dados.chave_quadro && (
            <li>
              ✓ Chave privada do quadro fora dos bancos: <span className="hash text-xs">{dados.chave_quadro.arquivo}</span> (pública <Hash valor={dados.chave_quadro.publica} />)
            </li>
          )}
        </ul>
      </Cartao>

      {dados.bancos.map((b) => (
        <Cartao key={b.nome} titulo={<span className="hash">{b.arquivo}</span>} descricao={b.descricao}>
          <div className="space-y-5">
            {b.tabelas.map((t) => (
              <details key={t.nome} open={t.total > 0 && t.nome !== "eventos"} className="group">
                <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">
                  {t.nome} <span className="text-slate-400">({t.total} linha{t.total === 1 ? "" : "s"})</span>
                  <span className="ml-2 text-xs font-normal text-slate-400">{t.colunas.join(" · ")}</span>
                </summary>
                {t.linhas.length > 0 && (
                  <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                        <tr>
                          {t.colunas.map((c) => (
                            <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">
                              {c}
                              {(b.nome === "autoridade" || b.nome === "urnas") && COLUNAS_PRIVADAS.includes(c) && <Selo cor="vermelho">privada</Selo>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.linhas.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            {t.colunas.map((c) => (
                              <td key={c} className="whitespace-nowrap px-2 py-1.5 align-top">
                                <Celula valor={l[c]} coluna={c} banco={b.nome} abrir={(txt) => setModal(formatar(txt))} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            ))}
          </div>
        </Cartao>
      ))}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between">
              <span className="text-sm font-medium">Valor completo</span>
              <button onClick={() => setModal(null)} className="text-sm text-slate-500">
                fechar ✕
              </button>
            </div>
            <pre className="hash whitespace-pre-wrap rounded bg-slate-900 p-3 text-[11px] text-slate-100">{modal}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- simulação

function AbaSimulacao({ estado, recarregar }: { estado: EstadoPublico | null; recarregar: () => Promise<unknown> }) {
  const [quantidade, setQuantidade] = useState(10);
  const [desafio, setDesafio] = useState(20);
  const [log, setLog] = useState<string[]>([]);
  const [rodando, setRodando] = useState(false);

  async function rodar() {
    if (!estado) return;
    setRodando(true);
    setLog([]);
    const escrever = (l: string) => setLog((x) => [...x, l]);
    try {
      const { eleitores } = await api<{ eleitores: Eleitor[] }>("/api/registro/eleitores");
      const disponiveis = eleitores.filter((e) => e.apto && e.situacao !== "credenciado").slice(0, quantidade);
      if (disponiveis.length === 0) throw new Error("Não há eleitores aptos que ainda não votaram. Gere eleitores fictícios no Cadastro.");
      escrever(`${disponiveis.length} eleitores vão votar (teste da urna em ~${desafio}% dos casos) na urna de simulação, zona 001 seção 9999`);
      const urna = await urnaDeSimulacao();
      escrever(`urna de simulação com carga e seção aberta (chave da urna ${urna.carga.chave_urna.slice(0, 16)}…)`);
      for (const [i, e] of disponiveis.entries()) {
        const t0 = performance.now();
        const { testou, codigo } = await simularEleitor(e.id, desafio / 100, urna);
        escrever(`${i + 1}. eleitor #${e.id}: credencial anônima → ${testou ? "testou a urna → " : ""}cédula ${formatarCodigo(codigo)} guardada na urna (${(performance.now() - t0).toFixed(0)} ms)`);
      }
      escrever("✓ simulação concluída — para publicar, encerre e transmita a seção 001-9999 na aba Eleição (ou no Mesário)");
    } catch (e) {
      escrever(`✕ ${mensagemDeErro(e)}`);
    } finally {
      setRodando(false);
      await recarregar();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <Cartao titulo="Votação automática" descricao="Cada eleitor simulado percorre o protocolo real pelas mesmas rotas das telas, numa urna própria (seção 001-9999): mesário habilita → urna gera credencial cega → cifra, prova, sela, assina → guarda na memória da urna.">
        <div className="space-y-3">
          <Campo rotulo="Quantidade de eleitores" type="number" min={1} max={200} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} />
          <Campo rotulo="% que testa a urna antes" type="number" min={0} max={100} value={desafio} onChange={(e) => setDesafio(Number(e.target.value))} />
          <Botao onClick={rodar} disabled={rodando || estado?.fase !== "aberta"} className="w-full">
            {rodando ? "Votando…" : "Simular votação"}
          </Botao>
          {estado?.fase !== "aberta" && <p className="text-xs text-slate-500">Disponível com a votação aberta.</p>}
        </div>
      </Cartao>
      <Cartao titulo="Registro da simulação">
        <pre className="hash max-h-[28rem] min-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
          {log.length ? log.join("\n") : "—"}
        </pre>
      </Cartao>
    </div>
  );
}

// ---------------------------------------------------------------- ataques

type Ataques = { ataques: Record<string, { titulo: string; atacante: string; descricao: string; quem_detecta: string }>; adulterado: boolean };

const ATACANTES: Record<string, string> = {
  banco: "Acesso de escrita ao banco, sem nenhuma chave",
  tse: "Insider do TSE com a chave do quadro",
  tse_hardware: "Insider do TSE com a chave do quadro + chaves extraídas da urna e da mesa (backdoor de fábrica)",
};

function AbaAtaques({ estado }: { estado: EstadoPublico | null }) {
  const [dados, setDados] = useState<Ataques | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string; ataque?: string } | null>(null);

  const [versao, setVersao] = useState(0);
  const carregar = () => setVersao((v) => v + 1);
  useEffect(() => {
    let ativo = true;
    api<Ataques>("/api/admin/ataque").then((d) => ativo && setDados(d));
    return () => {
      ativo = false;
    };
  }, [versao]);

  async function atacar(tipo: string) {
    setMsg(null);
    try {
      const { resumo } = await api<{ resumo: string }>("/api/admin/ataque", { tipo });
      setMsg({ tipo: "ok", texto: resumo, ataque: tipo });
    } catch (e) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(e) });
    }
    carregar();
  }

  return (
    <div className="space-y-6">
      <LaboratorioFraudes eleicaoAberta={estado?.fase === "aberta"} />
      <Aviso tipo="alerta" titulo="Para validar quem pega cada fraude">
        Cada botão adultera o quadro nacional (<span className="hash">boletim.db</span>) com o poder indicado. Depois, rode a{" "}
        <Link href="/auditoria" className="underline">Auditoria</Link>, confira um código em <Link href="/verificar" className="underline">Verificar voto</Link>{" "}
        e compare o BU publicado com o BU impresso. Antes do primeiro ataque é feita uma cópia, que pode ser restaurada.
      </Aviso>
      <Cartao
        titulo="Urna adulterada na instalação (ataque de dentro da urna)"
        descricao="Software trocado antes da carga: desvia votos, mostra ao eleitor o que ele digitou e mente no teste. A auditoria matemática passa — só o eleitor que testa, em casa, pega."
        acoes={
          <Link href="/laboratorio/urna" className="inline-flex items-center rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700">
            Abrir a urna adulterada →
          </Link>
        }
      >
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Instale a urna do laboratório pelo teclado dela (zona, seção e o número que ela favorece) e faça a carga (CONFIRMA).</li>
          <li>No terminal do mesário, escolha essa urna, abra a seção e libere um eleitor. Vote em outro número e aperte TESTAR: ela dirá que está tudo certo.</li>
          <li>Aperte CONFIRMA para votar. Guarde o comprovante (ele traz o código e a chave do teste); encerre e transmita a seção, apure.</li>
          <li>Em Verificar voto, digite o código e a chave do teste: o seu computador refaz a cifração e mostra o número favorecido — e a declaração assinada prova a mentira.</li>
        </ol>
      </Cartao>
      {msg && (
        <Aviso tipo={msg.tipo === "ok" ? "ok" : "erro"}>
          {msg.texto}
          {msg.tipo === "ok" && (
            <>
              {" "}
              —{" "}
              {msg.ataque === "trocar_foto" ? (
                <Link href="/urna" className="font-semibold underline">abrir a urna →</Link>
              ) : (
                <Link href="/auditoria" className="font-semibold underline">rodar auditoria →</Link>
              )}
            </>
          )}
        </Aviso>
      )}
      {dados?.adulterado && (
        <Cartao titulo="O boletim está adulterado" acoes={<Botao variante="secundario" onClick={() => atacar("restaurar")}>Desfazer adulterações</Botao>}>
          <p className="text-sm text-slate-600">Restaurar volta o boletim.db à cópia feita antes do primeiro ataque.</p>
        </Cartao>
      )}
      {(estado?.estatisticas.secoes_transmitidas ?? 0) === 0 && <Aviso>Os ataques ao quadro precisam de pelo menos uma seção transmitida. Vote (ou simule), encerre e transmita a seção antes.</Aviso>}
      <div className="grid gap-4 md:grid-cols-2">
        {dados &&
          Object.entries(dados.ataques).map(([tipo, a]) => (
            <Cartao key={tipo} titulo={a.titulo} descricao={a.descricao}>
              <div className="mb-3 space-y-1 text-xs text-slate-500">
                <div>
                  <strong>Atacante:</strong> {ATACANTES[a.atacante] ?? a.atacante}
                </div>
                <div>
                  <strong>Quem detecta:</strong> {a.quem_detecta}
                </div>
              </div>
              <Botao variante="perigo" onClick={() => atacar(tipo)}>
                Executar ataque
              </Botao>
            </Cartao>
          ))}
      </div>
    </div>
  );
}
