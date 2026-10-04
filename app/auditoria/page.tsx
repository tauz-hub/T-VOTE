"use client";

import { useEffect, useState } from "react";
import { type Pacote, type RelatorioAuditoria, auditarPacote } from "@/lib/auditoria";
import { mensagemDeErro } from "@/lib/client/api";
import { baixarPacote } from "@/lib/client/protocolo";
import type { Bloco } from "@/lib/crypto/quadro";
import { figuraDaPalavra, formatarCodigo } from "@/lib/crypto/palavras";
import { codigoBU } from "@/lib/crypto/secao";
import { Aviso, Botao, Cartao, GraficoResultado, Hash, IconeStatus, Pagina, Selo } from "@/components/ui";

/**
 * Resumo de uma linha do bloco. A cadeia vem de fora (pode ser de uma versão
 * antiga do protocolo ou adulterada): nada aqui pode quebrar a tela — quem
 * julga o conteúdo é o auditor.
 */
function resumoBloco(b: Bloco): string {
  try {
    return resumoSeguro(b);
  } catch {
    return (b.tipo as string) === "LOTE" ? "lote de cédulas (protocolo antigo, v3)" : "conteúdo fora do formato v4";
  }
}

function resumoSeguro(b: Bloco): string {
  switch (b.tipo) {
    case "GENESE":
      return `${(b as Bloco<"GENESE">).conteudo.nome}`;
    case "CHAVE_TRUSTEE":
      return (b as Bloco<"CHAVE_TRUSTEE">).conteudo.nome;
    case "ABERTURA":
      return "chave da eleição publicada; nenhuma seção recebida";
    case "CARGA": {
      const c = (b as Bloco<"CARGA">).conteudo;
      return `seção ${c.secao}: chave da urna ${c.chave_urna.slice(0, 8)}… (antes dos votos)`;
    }
    case "SECAO": {
      const c = (b as Bloco<"SECAO">).conteudo;
      return `mídia da seção ${c.secao}: ${c.bu.conteudo.cedulas.length} cédulas, ${c.bu.conteudo.desafiadas.length} de teste · BU ${codigoBU(c.bu.hash)}`;
    }
    case "ENCERRAMENTO": {
      const c = (b as Bloco<"ENCERRAMENTO">).conteudo;
      return `${c.secoes.length} seção(ões), ${c.total_cedulas} cédulas${c.secoes_sem_midia.length ? ` · sem mídia: ${c.secoes_sem_midia.join(", ")}` : ""}`;
    }
    case "DECRIPTACAO_PARCIAL":
      return `trustee ${(b as Bloco<"DECRIPTACAO_PARCIAL">).conteudo.trustee}, ${(b as Bloco<"DECRIPTACAO_PARCIAL">).conteudo.secoes.length} seção(ões)`;
    case "RESULTADO":
      return `total ${(b as Bloco<"RESULTADO">).conteudo.total}`;
  }
  return "";
}

export default function Auditoria() {
  const [relatorio, setRelatorio] = useState<RelatorioAuditoria | null>(null);
  const [pacote, setPacote] = useState<Pacote | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  // a cadeia aparece logo ao abrir a página, mesmo antes de rodar a auditoria
  useEffect(() => {
    let ativo = true;
    baixarPacote()
      .then((p) => ativo && setPacote((atual) => atual ?? p))
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  async function executar(origem?: Pacote) {
    setErro(null);
    setRelatorio(null);
    try {
      setProgresso("baixando pacote público…");
      const p = origem ?? (await baixarPacote());
      setPacote(p);
      const t0 = performance.now();
      const r = await auditarPacote(p, (f, t, etapa) => setProgresso(`${etapa}: ${f}/${t}`));
      setProgresso(`concluída em ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      setRelatorio(r);
    } catch (e) {
      setErro(mensagemDeErro(e));
      setProgresso(null);
    }
  }

  async function carregarArquivo(f: File) {
    try {
      await executar(JSON.parse(await f.text()) as Pacote);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <Pagina
      titulo="Auditoria independente"
      subtitulo="audit_election(): o navegador baixa o pacote público (só a cadeia de blocos) e refaz toda a matemática. Não usa o banco, não confia no servidor e não revela nenhum voto individual."
      acoes={
        <div className="flex flex-wrap gap-2">
          <a href="/api/publico/pacote?baixar" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Baixar pacote (JSON)
          </a>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Auditar arquivo…
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && carregarArquivo(e.target.files[0])} />
          </label>
          <Botao onClick={() => executar()}>Executar auditoria</Botao>
        </div>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {progresso && !relatorio && <Aviso>{progresso}</Aviso>}

      {relatorio && (
        <div className={`rounded-xl border-2 p-5 ${relatorio.aprovado ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-xl font-semibold ${relatorio.aprovado ? "text-emerald-900" : "text-red-900"}`}>
                {relatorio.aprovado ? "✓ Nenhuma inconsistência encontrada" : "✕ Problemas encontrados"}
              </div>
              <div className="mt-1 text-sm text-slate-700">
                {relatorio.eleicao?.nome} · fase {relatorio.fase} · {relatorio.estatisticas.blocos} blocos · {relatorio.estatisticas.secoes} seção(ões) ·{" "}
                {relatorio.estatisticas.cedulas} cédulas · {relatorio.estatisticas.desafiadas} desafiadas · {progresso}
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <Selo cor="verde">{relatorio.verificacoes.filter((v) => v.status === "ok").length} PASS</Selo>
              <Selo cor="vermelho">{relatorio.verificacoes.filter((v) => v.status === "falha").length} FAIL</Selo>
              <Selo>{relatorio.verificacoes.filter((v) => v.status === "pendente").length} pendentes</Selo>
            </div>
          </div>
        </div>
      )}

      {relatorio && relatorio.avisos.length > 0 && (
        <Aviso tipo="alerta" titulo="Avisos">
          <ul className="list-disc space-y-1 pl-5">
            {relatorio.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Aviso>
      )}

      {relatorio && (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Cartao titulo="Verificações">
            <ul className="divide-y divide-slate-100">
              {relatorio.verificacoes.map((v) => (
                <li key={v.id} className="flex gap-3 py-3">
                  <IconeStatus status={v.status} />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{v.titulo}</div>
                    <div className="text-sm text-slate-500">{v.descricao}</div>
                    {v.referencia && <div className="mt-1 text-xs text-slate-400">Contexto: {v.referencia}</div>}
                    {v.detalhes.length > 0 && (
                      <ul className={`mt-1.5 space-y-0.5 text-xs ${v.status === "falha" ? "text-red-700" : "text-slate-600"}`}>
                        {v.detalhes.map((d, i) => (
                          <li key={i}>↳ {d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Cartao>
          <div className="space-y-6">
            {relatorio.resultado && (
              <Cartao titulo="Resultado recalculado pelo auditor">
                <GraficoResultado resultado={relatorio.resultado} />
              </Cartao>
            )}
            {relatorio.secoes.length > 0 && (
              <Cartao titulo="Boletins de urna" descricao="Compare com o papel colado na porta de cada seção: o código do BU e os números têm de ser iguais.">
                <ul className="divide-y divide-slate-100 text-sm">
                  {relatorio.secoes.map((s) => {
                    const confere = s.contagemApurada ? s.contagemApurada.every((x, i) => s.contagemBU[i]?.votos === x.votos) : null;
                    return (
                      <li key={s.secao} className="py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">Seção {s.secao}</span>
                          {confere === null ? <Selo>aguardando apuração</Selo> : confere ? <Selo cor="verde">BU = apuração</Selo> : <Selo cor="vermelho">BU ≠ apuração</Selo>}
                        </div>
                        <div className="hash text-xs text-slate-600">código do BU {codigoBU(s.bu)}</div>
                        <div className="text-xs text-slate-500">
                          {s.cedulas} cédulas · {s.desafiadas} de teste · comparecimento {s.comparecimento} · {s.urna}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Cartao>
            )}
            <Cartao titulo="Auditor de linha de comando" descricao="Mesma verificação, fora do navegador. Também compara o hash do software publicado na gênese com o dos arquivos locais.">
              <pre className="hash overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                npm run auditar -- pacote-eleicao.json{"\n"}npm run auditar -- http://127.0.0.1:3000/api/publico/pacote
              </pre>
            </Cartao>
          </div>
        </div>
      )}

      {!relatorio && !progresso && (
        <Cartao titulo="O que é verificado">
          <p className="text-sm text-slate-600">
            Integridade e assinatura de cada bloco, manifesto e hash do software, chaves dos trustees, carga de cada urna (chave
            própria, publicada antes dos votos), zerésima e BU assinados pela urna, ausência de ordem de chegada e de horário,
            credenciais da mesa, provas de conhecimento zero, códigos e figuras, cédulas de teste, comparecimento, soma por seção,
            provas de decifração, BU impresso = apuração e resultado final. Clique em “Executar auditoria”.
          </p>
        </Cartao>
      )}

      {pacote && (
        <Cartao
          titulo="Cadeia de blocos pública"
          descricao="Cada mídia de seção grava, para cada cédula, o código de verificação e as 2 figuras que a urna mostrou ao eleitor. Clique num bloco para ver o conteúdo exato que foi assinado."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Conteúdo</th>
                  <th className="py-2 pr-3">Hash anterior</th>
                  <th className="py-2 pr-3">Hash</th>
                  <th className="py-2">Publicado</th>
                </tr>
              </thead>
              <tbody>
                {pacote.blocos.map((b) => (
                  <FragmentoBloco key={b.numero} b={b} aberto={aberto === b.numero} alternar={() => setAberto(aberto === b.numero ? null : b.numero)} />
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}
    </Pagina>
  );
}

function FragmentoBloco({ b, aberto, alternar }: { b: Bloco; aberto: boolean; alternar: () => void }) {
  return (
    <>
      <tr onClick={alternar} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
        <td className="py-2 pr-3 tabular-nums text-slate-500">{b.numero}</td>
        <td className="py-2 pr-3">
          <Selo cor={b.tipo === "SECAO" ? "azul" : b.tipo === "CARGA" ? "amarelo" : b.tipo === "RESULTADO" ? "roxo" : "cinza"}>{b.tipo}</Selo>
        </td>
        <td className="py-2 pr-3 text-slate-700">{resumoBloco(b)}</td>
        <td className="py-2 pr-3">
          <Hash valor={b.hash_anterior} n={10} />
        </td>
        <td className="py-2 pr-3">
          <Hash valor={b.hash} n={10} />
        </td>
        <td className="py-2 text-xs text-slate-500">{new Date(b.publicado_em).toLocaleTimeString("pt-BR")}</td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={6} className="bg-slate-50 p-3">
            {b.tipo === "SECAO" && <CedulasDaSecao secao={b as Bloco<"SECAO">} />}
            <pre className="hash max-h-96 overflow-auto rounded bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(b, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/** Cada cédula da seção como o eleitor a reconhece: código e figuras. */
function CedulasDaSecao({ secao }: { secao: Bloco<"SECAO"> }) {
  const bu = secao.conteudo?.bu?.conteudo;
  const itens = [
    ...(Array.isArray(bu?.cedulas) ? bu.cedulas : []).map((c) => ({ c, teste: false })),
    ...(Array.isArray(bu?.desafiadas) ? bu.desafiadas : []).map((c) => ({ c, teste: true })),
  ];
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {itens.map(({ c, teste }) => (
        <div key={c.rastreador} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
          <div>
            <div className="hash text-sm font-bold tracking-wider text-slate-900">{c.codigo ? formatarCodigo(c.codigo) : c.rastreador.slice(0, 12)}</div>
            <div className="text-[11px] text-slate-500">{teste ? "cédula de teste (aberta, não contada)" : "voto depositado"}</div>
          </div>
          <div className="flex gap-1.5">
            {(c.figuras ?? []).map((p: string) => (
              <span key={p} title={p} className="flex flex-col items-center text-2xl leading-none">
                {figuraDaPalavra(p)?.figura}
                <span className="mt-0.5 text-[9px] uppercase text-slate-500">{p}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
