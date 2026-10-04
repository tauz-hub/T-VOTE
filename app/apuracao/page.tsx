"use client";

import { useState } from "react";
import { type Pacote, agregarCedulas, auditarPacote, secoesDosBlocos } from "@/lib/auditoria";
import { api, mensagemDeErro, useEleicao } from "@/lib/client/api";
import { baixarPacote } from "@/lib/client/protocolo";
import { cifraParaHex } from "@/lib/crypto/elgamal";
import type { Bloco } from "@/lib/crypto/quadro";
import { type SegredoTrustee, decifrarParcial, gerarChaveTrustee } from "@/lib/crypto/trustee";
import type { EstadoPublico } from "@/lib/tipos-api";
import { Aviso, Botao, Cartao, GraficoResultado, Hash, Pagina, Selo, SeloFase } from "@/components/ui";

const NOMES = ["Trustee A", "Trustee B", "Trustee C"];
const chaveLocal = (eleicaoId: string, t: number) => `tai-vote:trustee:${eleicaoId}:${t}`;

function lerSegredo(eleicaoId: string, t: number): SegredoTrustee | null {
  try {
    const v = localStorage.getItem(chaveLocal(eleicaoId, t));
    return v ? (JSON.parse(v) as SegredoTrustee) : null;
  } catch {
    return null;
  }
}

function salvarSegredo(s: SegredoTrustee) {
  localStorage.setItem(chaveLocal(s.eleicao_id, s.trustee), JSON.stringify(s));
}

function baixarArquivo(s: SegredoTrustee) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `trustee-${s.trustee}-${s.eleicao_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Antes de decifrar, o trustee audita o quadro e recalcula o agregado por conta própria. */
async function verificarEDecifrar(segredo: SegredoTrustee, pacote: Pacote, aoProgredir: (t: string) => void) {
  const rel = await auditarPacote(pacote, (f, t, e) => aoProgredir(`${e}: ${f}/${t}`));
  const problemas = rel.verificacoes.filter((v) => v.status === "falha" && !["decriptacao", "resultado", "bu_papel"].includes(v.id));
  if (problemas.length) throw new Error(`Recusado: o quadro não passou na auditoria (${problemas.map((p) => p.titulo).join(", ")})`);
  const enc = pacote.blocos.find((b) => b.tipo === "ENCERRAMENTO");
  const abertura = pacote.blocos.find((b) => b.tipo === "ABERTURA") as Bloco<"ABERTURA">;
  const genese = pacote.blocos[0] as Bloco<"GENESE">;
  if (!enc) throw new Error("Eleição ainda não encerrada");
  // nunca decifrar algo que não seja a soma recalculada localmente (evita usar o trustee como "oráculo" de decifração)
  const agregados = secoesDosBlocos(pacote.blocos).map((b) => {
    const bu = b.conteudo.bu.conteudo;
    const agregado = agregarCedulas(bu.cedulas, genese.conteudo.opcoes.length);
    const confere = agregado.map(cifraParaHex).every((c, i) => c.a === bu.agregado[i]?.a && c.b === bu.agregado[i]?.b);
    if (!confere) throw new Error(`Recusado: o agregado do BU da seção ${b.conteudo.secao} não é a soma das cédulas dele`);
    return { secao: b.conteudo.secao, agregado };
  });
  aoProgredir(`calculando decifração parcial e provas de ${agregados.length} seção(ões)…`);
  return decifrarParcial(segredo, agregados, abertura.conteudo.hash_eleicao);
}

export default function Apuracao() {
  const { estado, recarregar } = useEleicao(4000);
  const [, setVersao] = useState(0);
  const [nomes, setNomes] = useState(NOMES);
  const [progresso, setProgresso] = useState<Record<number, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => setVersao((v) => v + 1);

  if (!estado) return <Pagina titulo="Trustees e apuração">{null}</Pagina>;
  const id = estado.eleicao_id ?? "";
  const publicados = new Map(estado.trustees.map((t) => [t.trustee, t]));

  async function gerar(t: number) {
    setErro(null);
    try {
      const { segredo, publico } = gerarChaveTrustee(id, t, nomes[t - 1]);
      salvarSegredo(segredo);
      await api("/api/trustee/chave", publico);
      atualizar();
      await recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  async function decifrar(trustees: number[]) {
    setErro(null);
    try {
      const pacote = await baixarPacote();
      for (const t of trustees) {
        const s = lerSegredo(id, t);
        if (!s) throw new Error(`Chave privada do trustee ${t} não encontrada neste navegador — carregue o arquivo`);
        const parcial = await verificarEDecifrar(s, pacote, (txt) => setProgresso((p) => ({ ...p, [t]: txt })));
        await api("/api/trustee/decifracao", parcial);
        setProgresso((p) => ({ ...p, [t]: "decifração enviada ✓" }));
      }
      await recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  async function carregarArquivo(t: number, arquivo: File) {
    setErro(null);
    try {
      const s = JSON.parse(await arquivo.text()) as SegredoTrustee;
      if (s.formato !== "tai-vote/trustee/v1" || s.eleicao_id !== id || s.trustee !== t)
        throw new Error("Arquivo não corresponde a este trustee nesta eleição");
      if (publicados.get(t)?.chave_publica !== s.chave_publica) throw new Error("A chave do arquivo não é a chave publicada no quadro");
      salvarSegredo(s);
      atualizar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <Pagina
      titulo="Trustees e apuração"
      subtitulo="A chave da eleição é h = h_A · h_B · h_C. Cada trustee gera a sua parte no próprio navegador e só publica a parte pública, com prova de que conhece a privada. Para apurar, os três decifram juntos apenas a SOMA das cédulas de cada seção — nunca uma cédula individual. Decifrar seção por seção permite conferir cada BU impresso."
      acoes={<SeloFase fase={estado.fase} />}
    >
      {!estado.existe && <Aviso tipo="alerta">Crie uma eleição no Admin primeiro.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {estado.existe && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((t) => (
              <CartaoTrustee
                key={t}
                t={t}
                estado={estado}
                nome={nomes[t - 1]}
                setNome={(n) => setNomes((ns) => ns.map((x, i) => (i === t - 1 ? n : x)))}
                segredo={lerSegredo(id, t)}
                progresso={progresso[t]}
                aoGerar={() => gerar(t)}
                aoDecifrar={() => decifrar([t])}
                aoCarregar={(f) => carregarArquivo(t, f)}
              />
            ))}
          </div>

          {estado.fase === "configuracao" && publicados.size < 3 && (
            <Cartao titulo="Modo de teste" descricao="Num cenário real, cada trustee usa o próprio computador. Aqui, para agilizar, os três podem gerar as chaves neste navegador.">
              <Botao
                variante="secundario"
                onClick={async () => {
                  for (const t of [1, 2, 3]) if (!publicados.has(t)) await gerar(t);
                }}
              >
                Gerar as chaves que faltam
              </Botao>
            </Cartao>
          )}

          {estado.fase === "encerrada" && (
            <Cartao titulo="Modo de teste" descricao="Executa a decifração dos trustees que ainda não enviaram, usando as chaves guardadas neste navegador.">
              <Botao variante="secundario" onClick={() => decifrar([1, 2, 3].filter((t) => !estado.decifracoes.includes(t)))}>
                Decifrar com os trustees restantes
              </Botao>
            </Cartao>
          )}

          {estado.resultado && (
            <Cartao titulo="Resultado" descricao="Obtido combinando as três decifrações parciais: g^m = B / (D_A · D_B · D_C).">
              <GraficoResultado resultado={estado.resultado} />
            </Cartao>
          )}
        </>
      )}
    </Pagina>
  );
}

function CartaoTrustee(props: {
  t: number;
  estado: EstadoPublico;
  nome: string;
  setNome: (n: string) => void;
  segredo: SegredoTrustee | null;
  progresso?: string;
  aoGerar: () => void;
  aoDecifrar: () => void;
  aoCarregar: (f: File) => void;
}) {
  const { t, estado, segredo } = props;
  const publico = estado.trustees.find((x) => x.trustee === t);
  const decifrou = estado.decifracoes.includes(t);
  const segredoValido = segredo && publico && segredo.chave_publica === publico.chave_publica;

  return (
    <Cartao
      titulo={publico?.nome ?? props.nome}
      acoes={decifrou ? <Selo cor="roxo">Decifrou</Selo> : publico ? <Selo cor="verde">Chave publicada</Selo> : <Selo>Sem chave</Selo>}
    >
      <div className="space-y-3 text-sm">
        {!publico && estado.fase === "configuracao" && (
          <>
            <input value={props.nome} onChange={(e) => props.setNome(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5" />
            <Botao onClick={props.aoGerar} className="w-full">
              Gerar chave neste navegador
            </Botao>
          </>
        )}
        {publico && (
          <div>
            <div className="text-xs text-slate-500">Chave pública h_{t}</div>
            <Hash valor={publico.chave_publica} n={24} />
          </div>
        )}
        {publico && (
          <div className="text-xs">
            {segredoValido ? (
              <span className="text-emerald-700">✓ chave privada disponível neste navegador</span>
            ) : (
              <span className="text-amber-700">chave privada não está neste navegador</span>
            )}
          </div>
        )}
        {segredoValido && (
          <button onClick={() => baixarArquivo(segredo)} className="text-xs text-slate-600 underline">
            Baixar arquivo da chave privada (backup)
          </button>
        )}
        {publico && !segredoValido && !decifrou && (
          <label className="block text-xs text-slate-600">
            Carregar arquivo da chave:
            <input type="file" accept="application/json" className="mt-1 block w-full text-xs" onChange={(e) => e.target.files?.[0] && props.aoCarregar(e.target.files[0])} />
          </label>
        )}
        {estado.fase === "encerrada" && !decifrou && (
          <Botao onClick={props.aoDecifrar} disabled={!segredoValido} className="w-full">
            Auditar o quadro e decifrar
          </Botao>
        )}
        {props.progresso && <div className="text-xs text-slate-500">{props.progresso}</div>}
      </div>
    </Cartao>
  );
}
