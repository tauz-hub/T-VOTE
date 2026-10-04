"use client";

import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "@/lib/client/api";
import {
  CHAVE_COMPROVANTE_PARA_CONFERIR,
  CHAVE_URNAS_LABORATORIO,
  type EleitorSimulado,
  type UrnaLaboratorio,
  simularEleitorQueTesta,
} from "@/lib/client/laboratorio";
import { textoDosTestes } from "@/lib/comprovante";
import { conferenciaDoSelo, formatarCodigo } from "@/lib/crypto/palavras";
import { Comprovante } from "@/components/Comprovante";
import { chaveInstalacaoLaboratorio } from "@/components/Urna";
import { Aviso, Botao, Cartao, Selo } from "@/components/ui";

type Fase = "carregada" | "aberta" | "encerrada" | "transmitida";

function lerUrnas(): UrnaLaboratorio[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_URNAS_LABORATORIO) ?? "[]") as UrnaLaboratorio[];
  } catch {
    return [];
  }
}

const CHAVE_ELEITORES = "tai-vote:laboratorio:eleitores";

/** Os comprovantes dos eleitores simulados ficam guardados: dá para sair da tela e voltar. */
function lerEleitores(): Record<string, EleitorSimulado[]> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ELEITORES) ?? "{}") as Record<string, EleitorSimulado[]>;
  } catch {
    return {};
  }
}

function gravarUrnas(urnas: UrnaLaboratorio[]) {
  localStorage.setItem(CHAVE_URNAS_LABORATORIO, JSON.stringify(urnas));
  // cada urna de exemplo tem o seu pareamento, para abrir em /laboratorio/urna?u=<id>
  for (const u of urnas) localStorage.setItem(chaveInstalacaoLaboratorio(u.id), JSON.stringify({ id: u.id, nome: u.nome, token: u.token, zona: u.zona, secao: u.secao }));
}

/**
 * Urnas de exemplo com software adulterado — uma por tipo de fraude — prontas
 * para simular e conferir em casa. Só existe neste navegador (os pareamentos
 * ficam no localStorage, como numa urna de verdade ficam no hardware).
 */
export function LaboratorioFraudes({ eleicaoAberta }: { eleicaoAberta: boolean }) {
  const [urnas, setUrnas] = useState<UrnaLaboratorio[]>(lerUrnas);
  const [fases, setFases] = useState<Record<string, Fase>>({});
  const [eleitores, setEleitores] = useState<Record<string, EleitorSimulado[]>>(lerEleitores);

  function registrarEleitor(id: string, r: EleitorSimulado) {
    const todos = lerEleitores();
    todos[id] = [...(todos[id] ?? []), r];
    localStorage.setItem(CHAVE_ELEITORES, JSON.stringify(todos));
    setEleitores(todos);
  }
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  // fase de cada seção (a visão do laboratório)
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    const consultar = () =>
      api<{ urnas: { urna_id: string; fase: Fase }[] }>("/api/admin/secoes")
        .then((r) => ativo && setFases(Object.fromEntries(r.urnas.map((u) => [u.urna_id, u.fase]))))
        .catch(() => {});
    void consultar();
    const id = setInterval(consultar, 3000);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [versao]);

  async function tarefa(chave: string, fn: () => Promise<string>) {
    setOcupado(chave);
    setMsg(null);
    try {
      setMsg({ tipo: "ok", texto: await fn() });
    } catch (e) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(e) });
    } finally {
      setOcupado(null);
      setVersao((v) => v + 1);
    }
  }

  const criar = () =>
    tarefa("criar", async () => {
      const r = await api<{ urnas: UrnaLaboratorio[] }>("/api/admin/laboratorio", {});
      const todas = [...r.urnas];
      gravarUrnas(todas);
      setUrnas(todas);
      return `${r.urnas.length} urnas de exemplo instaladas, com carga e seção aberta (zona 900).`;
    });

  const simular = (u: UrnaLaboratorio) =>
    tarefa(u.id, async () => {
      // a "metade" precisa de mais de um teste para ter boa chance de cair numa cédula desviada
      const r = await simularEleitorQueTesta(u, u.modelo === "desvia_metade" ? 3 : 1);
      registrarEleitor(u.id, r);
      return `${u.titulo}: o eleitor escolheu ${r.escolhida.numero ?? ""} ${r.escolhida.nome}, testou ${r.testes.length}× e votou. Comprovante abaixo.`;
    });

  const transmitir = (u: UrnaLaboratorio) =>
    tarefa(u.id, async () => {
      if (fases[u.id] === "aberta") await api("/api/mesario/secao", { urna_id: u.id, acao: "encerrar" });
      const r = await api<{ bloco: number }>("/api/mesario/secao", { urna_id: u.id, acao: "transmitir" });
      return `Seção ${u.zona}-${u.secao}: BU impresso e mídia publicada no bloco ${r.bloco}. Agora dá para conferir em casa.`;
    });

  const simularTudo = () =>
    tarefa("tudo", async () => {
      for (const u of urnas) {
        if (fases[u.id] !== "aberta") continue;
        const r = await simularEleitorQueTesta(u, u.modelo === "desvia_metade" ? 3 : 1);
        registrarEleitor(u.id, r);
        await api("/api/mesario/secao", { urna_id: u.id, acao: "encerrar" });
        await api("/api/mesario/secao", { urna_id: u.id, acao: "transmitir" });
      }
      return "Um eleitor votou (e testou) em cada urna, e todas as seções foram encerradas e transmitidas. Use “Conferir em casa” em cada uma.";
    });

  function conferirEmCasa(u: UrnaLaboratorio, e: EleitorSimulado) {
    if (u.quem_pega === "voto") {
      window.open(`/verificar?r=${e.verif.codigo}`, "_blank");
      return;
    }
    localStorage.setItem(CHAVE_COMPROVANTE_PARA_CONFERIR, textoDosTestes(e.testes, e.carga.opcoes));
    window.open("/teste", "_blank");
  }

  function esquecer() {
    if (!window.confirm("Esquecer as urnas de exemplo neste navegador? (Elas continuam no banco; só o pareamento local é apagado.)")) return;
    for (const u of urnas) localStorage.removeItem(chaveInstalacaoLaboratorio(u.id));
    localStorage.removeItem(CHAVE_URNAS_LABORATORIO);
    localStorage.removeItem(CHAVE_ELEITORES);
    setUrnas([]);
    setEleitores({});
  }

  const ativas = urnas.filter((u) => fases[u.id]);

  return (
    <Cartao
      titulo="Urnas com fraude — exemplos prontos"
      descricao="Uma urna por tipo de software adulterado. Todas mostram ao eleitor o que ele digitou e passam na auditoria matemática; cada fraude é pega em casa de um jeito. Simule um eleitor que testa, transmita a seção e confira em casa."
      acoes={
        <div className="flex flex-wrap gap-2">
          <Botao onClick={criar} disabled={!eleicaoAberta || ocupado !== null} variante="perigo">
            {ocupado === "criar" ? "Instalando…" : ativas.length ? "Criar outra leva de urnas" : "Criar as 7 urnas de exemplo"}
          </Botao>
          {ativas.length > 0 && (
            <Botao variante="secundario" onClick={simularTudo} disabled={ocupado !== null}>
              {ocupado === "tudo" ? "Simulando…" : "Simular tudo e transmitir"}
            </Botao>
          )}
        </div>
      }
    >
      {!eleicaoAberta && <Aviso tipo="alerta">Abra a eleição (Admin → Eleição) para instalar as urnas de exemplo.</Aviso>}
      {msg && <Aviso tipo={msg.tipo === "ok" ? "ok" : "erro"}>{msg.texto}</Aviso>}
      {ativas.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma urna de exemplo nesta eleição. Clique em “Criar as 7 urnas de exemplo”.</p>
      ) : (
        <div className="mt-2 space-y-4">
          {ativas.map((u) => {
            const fase = fases[u.id];
            const lista = eleitores[u.id] ?? [];
            const ultimo = lista.at(-1);
            return (
              <div key={u.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{u.titulo}</div>
                    <div className="text-sm text-slate-600">{u.descricao}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      <strong>Como pegar em casa:</strong> {u.como_pegar}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="hash text-xs text-slate-500">seção {u.zona}-{u.secao}</span>
                    <Selo cor={fase === "transmitida" ? "verde" : fase === "aberta" ? "azul" : "amarelo"}>{fase}</Selo>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Botao variante="secundario" onClick={() => window.open(`/laboratorio/urna?u=${u.id}`, `tai-vote-lab-${u.id}`, "popup,width=1000,height=760")}>
                    Abrir a urna
                  </Botao>
                  <Botao onClick={() => simular(u)} disabled={fase !== "aberta" || ocupado !== null}>
                    {ocupado === u.id ? "Votando…" : "Simular eleitor que testa"}
                  </Botao>
                  <Botao variante="secundario" onClick={() => transmitir(u)} disabled={(fase !== "aberta" && fase !== "encerrada") || ocupado !== null}>
                    Encerrar e transmitir
                  </Botao>
                  <Botao variante="sucesso" onClick={() => ultimo && conferirEmCasa(u, ultimo)} disabled={!ultimo || fase !== "transmitida"}>
                    Conferir em casa →
                  </Botao>
                </div>
                {ultimo && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-slate-700">
                      Comprovante do último eleitor ({lista.length} simulado{lista.length > 1 ? "s" : ""}) — escolheu {ultimo.escolhida.numero ?? ""} {ultimo.escolhida.nome}, voto{" "}
                      <span className="hash">{formatarCodigo(ultimo.verif.codigo)}</span>
                    </summary>
                    <div className="mt-3">
                      <Comprovante
                        eleicao={ultimo.carga.nome}
                        urna={ultimo.carga.urna}
                        recibo={ultimo.recibo}
                        codigo={ultimo.verif.codigo}
                        conferencia={conferenciaDoSelo(ultimo.verif.selo)}
                        figuras={ultimo.verif.figuras}
                        testes={ultimo.testes}
                        opcoes={ultimo.carga.opcoes}
                        imprimivel={false}
                      />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
          <button onClick={esquecer} className="text-xs text-slate-500 underline">
            esquecer as urnas de exemplo neste navegador
          </button>
        </div>
      )}
    </Cartao>
  );
}
