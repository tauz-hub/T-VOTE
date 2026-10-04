"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Pacote, conferirTesteDoPapel } from "@/lib/auditoria";
import { mensagemDeErro } from "@/lib/client/api";
import { baixarPacote } from "@/lib/client/protocolo";
import { CHAVE_COMPROVANTE_PARA_CONFERIR } from "@/lib/client/laboratorio";
import { type TesteDoPapel, lerAssinatura, lerTestesDoComprovante } from "@/lib/comprovante";
import { chaveTesteParaTexto, formatarCodigo, formatarConferencia, lerChaveTeste, lerCodigo } from "@/lib/crypto/palavras";
import type { Bloco, Opcao } from "@/lib/crypto/quadro";
import { FotoCandidato } from "@/components/FotoCandidato";
import { Aviso, Botao, Cartao, Pagina, Selo } from "@/components/ui";

/** Uma linha do formulário: o que o eleitor digitou, como digitou. */
type Linha = { codigo: string; chave: string; declarado: string; assinatura: string };
const vazia = (): Linha => ({ codigo: "", chave: "", declarado: "", assinatura: "" });
type Resultado = ReturnType<typeof conferirTesteDoPapel>;

const deTestes = (t: TesteDoPapel): Linha => ({
  codigo: lerCodigo(t.codigo) ? formatarCodigo(lerCodigo(t.codigo)!) : t.codigo,
  chave: t.chave ? chaveTesteParaTexto(t.chave) : "",
  declarado: t.declarado,
  assinatura: t.assinatura,
});

function OpcaoComFoto({ o, rotulo }: { o?: Opcao; rotulo: string }) {
  return (
    <div className="flex items-center gap-3">
      {o?.tipo === "candidato" && <FotoCandidato tamanho="md" hash={o.foto} nome={o.nome} />}
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</div>
        <div className="text-lg font-bold text-slate-900">{o ? `${o.numero ? `${o.numero} — ` : ""}${o.nome}` : "—"}</div>
      </div>
    </div>
  );
}

export default function ConferirTeste() {
  const [pacote, setPacote] = useState<Pacote | null>(null);
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([vazia()]);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // o pacote público (a cadeia inteira) — a conta é toda feita neste navegador
  useEffect(() => {
    let ativo = true;
    baixarPacote()
      .then((p) => {
        if (!ativo) return;
        setPacote(p);
        // vindo do laboratório ("Conferir em casa"): o texto do comprovante já chega preenchido
        try {
          const vindo = localStorage.getItem(CHAVE_COMPROVANTE_PARA_CONFERIR);
          if (vindo) {
            localStorage.removeItem(CHAVE_COMPROVANTE_PARA_CONFERIR);
            setTexto(vindo);
            setLinhas(lerTestesDoComprovante(vindo).map(deTestes));
          }
        } catch {
          // sem localStorage: o eleitor cola o texto à mão
        }
      })
      .catch((e) => ativo && setErro(mensagemDeErro(e)));
    return () => {
      ativo = false;
    };
  }, []);

  const opcoes = (pacote?.blocos[0] as Bloco<"GENESE"> | undefined)?.conteudo?.opcoes ?? [];
  const valorDaOpcao = (o: Opcao) => (o.tipo === "candidato" ? o.numero! : o.tipo);

  function lerTexto() {
    setErro(null);
    setResultados(null);
    const t = lerTestesDoComprovante(texto);
    if (t.length === 0) return setErro("Não achei nenhum “TESTE DA URNA” no texto. Cole a parte do comprovante que começa com TESTE DA URNA.");
    setLinhas(t.map(deTestes));
  }

  const alterar = (i: number, campo: keyof Linha, valor: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  function conferir() {
    setErro(null);
    if (!pacote) return setErro("O pacote público ainda não foi carregado.");
    setResultados(
      linhas.map((l) =>
        conferirTesteDoPapel(pacote, {
          codigo: l.codigo,
          chave: lerChaveTeste(l.chave) ?? "",
          declarado: l.declarado,
          assinatura: l.assinatura.trim() ? lerAssinatura(l.assinatura) || l.assinatura : undefined,
        }),
      ),
    );
  }

  const veredito = resultados
    ? resultados.some((r) => r.veredito === "fraude")
      ? "fraude"
      : resultados.every((r) => r.veredito === "legitima")
        ? "legitima"
        : "inconclusivo"
    : null;
  const secoes = [...new Set((resultados ?? []).map((r) => r.secao).filter(Boolean))];

  return (
    <Pagina
      titulo="Conferir o teste da urna"
      subtitulo="Você testou a urna na hora de votar? Passe aqui os dados do teste impressos no comprovante. O seu computador refaz a cifração com a chave do papel e diz se a urna foi honesta — sem confiar nela nem no TSE, e sem revelar o seu voto."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Cartao titulo="1. Cole o texto do comprovante (opcional)" descricao="Copie a parte que começa em “TESTE DA URNA” — pode ser mais de um teste. Os campos abaixo são preenchidos sozinhos.">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={6}
              placeholder={"TESTE DA URNA 1 — ANULADO, NÃO É VOTO\nA urna declara que a cédula testada continha:\n80 — …\nCÓDIGO DO TESTE: 001 0001 APRT9\n…"}
              className="hash w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
            <Botao variante="secundario" onClick={lerTexto} disabled={!texto.trim()} className="mt-2">
              Ler o comprovante
            </Botao>
          </Cartao>

          <Cartao titulo="2. Dados de cada teste" descricao="Como estão impressos no papel. A declaração assinada é opcional: com ela, uma eventual mentira da urna vira prova para qualquer pessoa.">
            <div className="space-y-5">
              {linhas.map((l, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">Teste {i + 1}</span>
                    {linhas.length > 1 && (
                      <button onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-slate-500 underline">
                        remover
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Código do teste
                      <input
                        value={l.codigo}
                        onChange={(e) => alterar(i, "codigo", e.target.value)}
                        placeholder="001 0001 APRT9"
                        className={`hash mt-1 block w-full rounded-lg border px-3 py-2 uppercase tracking-wider ${l.codigo && !lerCodigo(l.codigo) ? "border-red-400" : "border-slate-300"}`}
                      />
                    </label>
                    <label className="text-sm">
                      A urna declarou que continha
                      <select value={l.declarado} onChange={(e) => alterar(i, "declarado", e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2">
                        <option value="">— escolha o que está no papel —</option>
                        {opcoes.map((o) => (
                          <option key={valorDaOpcao(o)} value={valorDaOpcao(o)}>
                            {o.numero ? `${o.numero} — ` : ""}
                            {o.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block text-sm">
                    Chave do teste
                    <input
                      value={l.chave}
                      onChange={(e) => alterar(i, "chave", e.target.value)}
                      placeholder="XXXX XXXX XXXX XXXX XXXX XXXX XX"
                      className={`hash mt-1 block w-full rounded-lg border px-3 py-2 uppercase tracking-wider ${l.chave && !lerChaveTeste(l.chave) ? "border-red-400" : "border-slate-300"}`}
                    />
                  </label>
                  <label className="block text-sm">
                    Declaração assinada pela urna <span className="text-slate-400">(opcional)</span>
                    <textarea
                      value={l.assinatura}
                      onChange={(e) => alterar(i, "assinatura", e.target.value)}
                      rows={2}
                      placeholder="aed51fff08e7…"
                      className="hash mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </label>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Botao variante="secundario" onClick={() => setLinhas((ls) => [...ls, vazia()])} disabled={linhas.length >= 10}>
                  + outro teste
                </Botao>
                <Botao onClick={conferir} disabled={!pacote || linhas.every((l) => !lerCodigo(l.codigo) || !lerChaveTeste(l.chave))}>
                  {pacote ? "Conferir a urna" : "Carregando a cadeia pública…"}
                </Botao>
              </div>
            </div>
          </Cartao>

          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          {veredito && (
            <div
              className={`rounded-xl border-2 p-5 ${veredito === "legitima" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : veredito === "fraude" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}
            >
              <div className="text-xl font-bold">
                {veredito === "legitima"
                  ? `✓ A urna ${secoes.length === 1 ? `da seção ${secoes[0]} ` : ""}passou ${resultados!.length > 1 ? `nos seus ${resultados!.length} testes` : "no seu teste"}`
                  : veredito === "fraude"
                    ? "✕ FRAUDE: a urna não foi honesta no seu teste"
                    : "… Não deu para concluir"}
              </div>
              <div className="mt-1 text-sm">
                {veredito === "legitima"
                  ? "Ela cifrou exatamente o que mostrou, sem saber que você ia testar. Cada eleitor que testa é uma chance de pegar uma urna adulterada."
                  : veredito === "fraude"
                    ? "Guarde o comprovante: ele é assinado pela urna. Leve-o à Justiça Eleitoral ou aos fiscais — a conta abaixo pode ser refeita por qualquer pessoa, sem revelar voto nenhum."
                    : "Veja o motivo em cada teste abaixo."}
              </div>
            </div>
          )}

          {resultados?.map((r, i) => (
            <Cartao
              key={i}
              titulo={`Teste ${i + 1}${r.codigo ? ` — ${formatarCodigo(r.codigo)}` : ""}`}
              acoes={
                <Selo cor={r.veredito === "legitima" ? "verde" : r.veredito === "fraude" ? "vermelho" : "amarelo"}>
                  {r.veredito === "legitima" ? "urna honesta" : r.veredito === "fraude" ? "fraude" : "inconclusivo"}
                </Selo>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <OpcaoComFoto o={"declarada" in r ? r.declarada : undefined} rotulo="A urna disse (no papel)" />
                {"real" in r && <OpcaoComFoto o={r.real} rotulo="Refeito no seu computador" />}
              </div>
              <p className={`mt-3 text-sm ${r.veredito === "fraude" ? "font-semibold text-red-800" : "text-slate-700"}`}>{r.motivo}</p>
              {"seloOk" in r && (
                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  {r.real && (
                    <li>
                      {r.seloOk ? "✓" : "✕"} a cédula refeita é a que a urna selou com este código, antes de você decidir testar
                      {r.urna ? ` (${r.urna})` : ""}
                    </li>
                  )}
                  {r.conferencia && (
                    <li>
                      • conferência gravada: <span className="hash font-semibold">{formatarConferencia(r.conferencia)}</span> — tem de ser a mesma do papel
                    </li>
                  )}
                  <li>
                    {r.assinatura === "ok"
                      ? "✓ a declaração do papel tem assinatura válida desta urna — vale como prova para qualquer pessoa"
                      : r.assinatura === "invalida"
                        ? "✕ a assinatura digitada não confere (erro de digitação ou papel falso)"
                        : "• declaração assinada não informada (opcional)"}
                  </li>
                </ul>
              )}
            </Cartao>
          ))}
        </div>

        <div className="space-y-4">
          <Aviso titulo="Como funciona">
            <ol className="mt-1 list-decimal space-y-1 pl-4">
              <li>Na urna, antes de você decidir, ela mostrou o código e a conferência daquela cédula.</li>
              <li>Você apertou TESTAR: ela abriu a cédula, anulou e imprimiu a chave dela.</li>
              <li>Aqui, o seu computador cifra cada candidato com essa chave. Só um dá exatamente a cédula que a urna selou — esse é o que estava dentro.</li>
              <li>Se for diferente do que a urna disse, ela mentiu. A assinatura dela no papel prova isso.</li>
            </ol>
          </Aviso>
          <Aviso titulo="O seu voto continua secreto">
            O teste só abre a cédula de TESTE, que foi anulada. A chave do seu voto depositado foi destruída na urna: nem você, nem ninguém, consegue
            abri-lo. Para conferir o voto (código e figuras), use{" "}
            <Link href="/verificar" className="underline">
              Verificar voto
            </Link>
            .
          </Aviso>
          <Aviso titulo="Sem depender deste site">
            A mesma conta roda no <a href="/validador.html" className="underline">validador offline</a> (um arquivo HTML, sem internet) e na linha de
            comando:
            <pre className="hash mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">npm run verificar -- pacote.json 0010001APRT9 &quot;G20M …&quot;</pre>
          </Aviso>
          <Aviso tipo="alerta" titulo="O que um teste aprovado significa">
            Que a urna foi honesta naquela cédula — e ela não tinha como saber que você ia testar. Uma urna que troque votos é pega com chance cada vez
            maior a cada eleitor que testa: com 10% testando, quem troca 50 votos é pego em 99,5% das vezes.
          </Aviso>
        </div>
      </div>
    </Pagina>
  );
}
