"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { mensagemDeErro } from "@/lib/client/api";
import { baixarPacote } from "@/lib/client/protocolo";
import {
  type ItemVerificacaoEleitor,
  type Pacote,
  type SituacaoSecao,
  boletimDaSecao,
  cargasDosBlocos,
  conferirDeclaracaoTeste,
  reproduzirTeste,
  verificarMinhaCedula,
} from "@/lib/auditoria";
import { idSecao, lerChaveTeste, lerCodigo, secaoDoCodigo } from "@/lib/crypto/palavras";
import { type Opcao, type Recibo, verificarRecibo } from "@/lib/crypto/quadro";
import type { DeclaracaoTeste } from "@/lib/crypto/secao";
import { Aviso, Botao, Cartao, IconeStatus, Pagina, Selo } from "@/components/ui";
import { CodigoVerificacao, FigurasDaCedula, HashCompleto } from "@/components/Palavras";

type Resultado = {
  encontrada: boolean;
  tipo: "cedula" | "desafiada" | null;
  itens: ItemVerificacaoEleitor[];
  opcaoRevelada?: Opcao;
  figuras?: string[];
  codigo?: string;
  conferencia?: string;
  rastreador?: string;
  secao?: string;
  codigoBU?: string;
  situacaoSecao?: SituacaoSecao;
};

type Modo = "codigo" | "bu" | "avancado";

/**
 * Tudo aqui é calculado NESTE navegador, a partir do pacote público (a cadeia
 * de blocos): o servidor só entrega os blocos. O mesmo código roda no validador
 * offline e no auditor de linha de comando.
 */
async function consultarCodigo(c: string): Promise<Resultado> {
  const r = verificarMinhaCedula(await baixarPacote(), c);
  return {
    encontrada: r.encontrada,
    tipo: r.tipo,
    itens: r.itens,
    ...(r.encontrada
      ? {
          figuras: r.figuras?.map((f) => f.palavra),
          codigo: r.codigo,
          conferencia: r.conferencia,
          rastreador: r.rastreador,
          secao: r.secao,
          codigoBU: r.codigoBU,
          opcaoRevelada: "opcaoRevelada" in r ? r.opcaoRevelada : undefined,
        }
      : { secao: r.secao, situacaoSecao: r.situacaoSecao }),
  };
}

function Verificador() {
  const params = useSearchParams();
  const [modo, setModo] = useState<Modo>("codigo");
  const [codigo, setCodigo] = useState(params.get("r") ?? "");
  const [zona, setZona] = useState("");
  const [secaoBU, setSecaoBU] = useState("");
  const [entrada, setEntrada] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [bu, setBu] = useState<ReturnType<typeof boletimDaSecao> | null>(null);
  const [avancado, setAvancado] = useState<{ titulo: string; ok: boolean; texto: string; fraude?: boolean }[] | null>(null);
  const [mesmas, setMesmas] = useState<boolean | null>(null);
  const [chaveTeste, setChaveTeste] = useState("");
  const [reproducao, setReproducao] = useState<ReturnType<typeof reproduzirTeste> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // link vindo da urna (/verificar?r=<código>): a busca já começa ao abrir
  const [codigoInicial] = useState(() => lerCodigo(params.get("r") ?? ""));
  const [ocupado, setOcupado] = useState(codigoInicial !== null);

  function limpar() {
    setReproducao(null);
    setErro(null);
    setResultado(null);
    setBu(null);
    setAvancado(null);
    setMesmas(null);
  }

  async function executar(acao: () => Promise<void>) {
    limpar();
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const buscarPorCodigo = () =>
    executar(async () => {
      const c = lerCodigo(codigo);
      if (!c) throw new Error("Digite os 12 caracteres do código impresso no comprovante (ex.: 001 0001 K7Q2M).");
      setResultado(await consultarCodigo(c));
    });

  const buscarBU = () =>
    executar(async () => {
      if (!zona || !secaoBU) throw new Error("Informe a zona e a seção");
      setBu(boletimDaSecao(await baixarPacote(), idSecao(zona, secaoBU)));
    });

  /** O eleitor refaz o teste no próprio computador, com a chave impressa no comprovante (parte do teste). */
  async function refazerTeste() {
    setErro(null);
    setReproducao(null);
    try {
      const semente = lerChaveTeste(chaveTeste);
      if (!semente) throw new Error("Digite os 26 caracteres da chave impressa no comprovante (parte do teste).");
      if (!resultado?.codigo) throw new Error("Busque primeiro o código do teste impresso no comprovante.");
      setReproducao(reproduzirTeste(await baixarPacote(), resultado.codigo, semente));
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  /** Auditores: hash, recibo JSON (assinado pela urna) ou declaração de teste JSON. */
  const conferirAvancado = () =>
    executar(async () => {
      const texto = entrada.trim();
      const pacote: Pacote = await baixarPacote();
      if (texto.startsWith("{")) {
        const obj = JSON.parse(texto) as Partial<Recibo> & Partial<DeclaracaoTeste>;
        if (obj.tipo === "DECLARACAO_TESTE") {
          const r = conferirDeclaracaoTeste(pacote, obj as DeclaracaoTeste);
          const nome = (o?: Opcao) => (o ? `${o.numero ? `${o.numero} — ` : ""}${o.nome}` : "?");
          setAvancado([
            { titulo: "Assinatura da urna na declaração", ok: !!r.assinaturaValida, texto: r.assinaturaValida ? "a declaração foi mesmo feita pela urna da carga" : "assinatura inválida" },
            ...(r.encontrada
              ? [
                  { titulo: "O que a urna DECLAROU", ok: true, texto: nome(r.declarada) },
                  { titulo: "O que a cédula continha DE VERDADE (aberta no BU)", ok: !!r.aberturaValida, texto: nome(r.revelada) },
                  {
                    titulo: r.fraude ? "FRAUDE: a urna mentiu no teste" : "A urna disse a verdade",
                    ok: !r.fraude,
                    fraude: r.fraude,
                    texto: r.fraude
                      ? "Declaração assinada ≠ abertura publicada. Isto é prova criptográfica contra a urna — qualquer pessoa confere, e não revela nenhum voto (a cédula de teste não foi contada)."
                      : "declaração = abertura publicada",
                  },
                ]
              : [{ titulo: "Cédula de teste no BU", ok: false, texto: r.motivo }]),
          ]);
          return;
        }
        const recibo = obj as Recibo;
        const carga = cargasDosBlocos(pacote.blocos).get(recibo.secao);
        const ok = !!carga && verificarRecibo(recibo, carga.carga.chave_urna);
        const r = verificarMinhaCedula(pacote, recibo.rastreador);
        setAvancado([{ titulo: "Recibo assinado pela urna da seção", ok, texto: ok ? `seção ${recibo.secao}: a urna aceitou esta cédula` : "assinatura inválida ou seção desconhecida" }]);
        setResultado(await consultarCodigo(recibo.rastreador).then((x) => ({ ...x, itens: r.itens })));
        return;
      }
      const hex = texto.replace(/\s+/g, "").toLowerCase();
      if (!/^[0-9a-f]{8,64}$/.test(hex)) throw new Error("Informe o hash (8+ caracteres), o recibo JSON ou a declaração de teste JSON.");
      setResultado(await consultarCodigo(hex));
    });

  useEffect(() => {
    if (!codigoInicial) return;
    let ativo = true;
    consultarCodigo(codigoInicial)
      .then((r) => ativo && setResultado(r))
      .catch((e) => ativo && setErro(mensagemDeErro(e)))
      .finally(() => ativo && setOcupado(false));
    return () => {
      ativo = false;
    };
  }, [codigoInicial]);

  const abas: { id: Modo; rotulo: string }[] = [
    { id: "codigo", rotulo: "Conferir meu voto" },
    { id: "bu", rotulo: "Boletim da seção" },
    { id: "avancado", rotulo: "Avançado (auditores)" },
  ];
  const secaoDigitada = lerCodigo(codigo) ? secaoDoCodigo(lerCodigo(codigo)!) : null;
  const nomeOpcao = (o?: Opcao) => (o ? `${o.numero ? `${o.numero} — ` : ""}${o.nome}` : "?");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {abas.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setModo(a.id);
                limpar();
              }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${modo === a.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>

        {modo === "codigo" && (
          <Cartao titulo="Conferir meu voto" descricao="Digite o código de 12 caracteres do comprovante (ou do teste impresso no comprovante). Vão aparecer as 2 figuras gravadas no BU da sua seção.">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lerCodigo(codigo) && buscarPorCodigo()}
                placeholder="ex.: 001 0001 K7Q2M"
                maxLength={20}
                className="hash flex-1 rounded-lg border border-slate-300 px-3 py-3 text-2xl uppercase tracking-widest"
              />
              <Botao onClick={buscarPorCodigo} disabled={ocupado || !lerCodigo(codigo)} className="px-6 py-3 text-base">
                {ocupado ? "Buscando…" : "Buscar"}
              </Botao>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {secaoDigitada
                ? `Zona ${secaoDigitada.zona} · Seção ${secaoDigitada.secao} — confira com o seu título de eleitor.`
                : "Os 3 primeiros números são a zona e os 4 seguintes, a seção. Espaços não importam; O vale 0 e I vale 1."}
            </p>
          </Cartao>
        )}

        {modo === "bu" && (
          <Cartao titulo="Boletim da seção" descricao="Compare o BU publicado com o papel colado na porta da sua seção (ou a foto dele): o código do BU e os números têm de ser iguais.">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Zona
                <input value={zona} inputMode="numeric" maxLength={3} onChange={(e) => setZona(e.target.value.replace(/\D/g, ""))} className="hash mt-1 block w-24 rounded-lg border border-slate-300 px-3 py-2 text-lg" />
              </label>
              <label className="text-sm">
                Seção
                <input value={secaoBU} inputMode="numeric" maxLength={4} onChange={(e) => setSecaoBU(e.target.value.replace(/\D/g, ""))} className="hash mt-1 block w-28 rounded-lg border border-slate-300 px-3 py-2 text-lg" />
              </label>
              <Botao onClick={buscarBU} disabled={ocupado || !zona || !secaoBU}>
                Ver o BU publicado
              </Botao>
            </div>
          </Cartao>
        )}

        {modo === "avancado" && (
          <Cartao titulo="Avançado" descricao="Para auditores e fiscais: hash completo da cédula, recibo JSON copiado da urna, ou a declaração de teste JSON (“Copiar declaração assinada” no teste).">
            <textarea
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              rows={4}
              placeholder='hash (3f9a1c0b…), recibo {"tipo":"RECIBO_CEDULA",…} ou declaração {"tipo":"DECLARACAO_TESTE",…}'
              className="hash w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
            <Botao onClick={conferirAvancado} disabled={ocupado || !entrada.trim()} className="mt-3">
              {ocupado ? "Verificando…" : "Verificar na cadeia pública"}
            </Botao>
          </Cartao>
        )}

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {avancado && (
          <Cartao titulo="Resultado">
            <ul className="space-y-3">
              {avancado.map((i) => (
                <li key={i.titulo} className={`flex items-start gap-3 ${i.fraude ? "rounded-lg bg-red-50 p-3 ring-1 ring-red-200" : ""}`}>
                  <IconeStatus status={i.ok ? "ok" : "falha"} />
                  <div>
                    <div className={`font-medium ${i.fraude ? "text-red-900" : "text-slate-900"}`}>{i.titulo}</div>
                    <div className="text-sm text-slate-600">{i.texto}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        {bu && (
          <Cartao titulo={`BU da seção ${bu.secao}`} descricao="Calculado neste navegador a partir da cadeia pública.">
            {!bu.encontrada ? (
              <Aviso tipo={bu.situacao === "aguardando_midia" ? "alerta" : "erro"}>
                {bu.situacao === "aguardando_midia"
                  ? "A urna desta seção recebeu carga, mas a mídia ainda não chegou ao TSE. Se a seção já encerrou e o BU está na porta da escola, cobre a transmissão."
                  : "Nenhuma urna com essa zona e seção recebeu carga nesta eleição."}
              </Aviso>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-50 p-4 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Código do BU</div>
                  <div className="hash text-3xl font-bold tracking-wider text-slate-900">{bu.codigo}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {bu.urna} · bloco {bu.bloco} · encerrada em {new Date(bu.encerrada_em).toLocaleString("pt-BR")}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="py-1.5">Opção</th>
                      <th className="py-1.5 text-right">BU impresso</th>
                      <th className="py-1.5 text-right">Apuração criptográfica</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bu.contagem.map((x, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5">{nomeOpcao(bu.opcoes[x.opcao])}</td>
                        <td className="py-1.5 text-right tabular-nums">{x.votos}</td>
                        <td className={`py-1.5 text-right tabular-nums ${bu.apurada && bu.apurada[i]?.votos !== x.votos ? "font-bold text-red-700" : ""}`}>
                          {bu.apurada ? bu.apurada[i]?.votos : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Selo cor="cinza">comparecimento {bu.comparecimento}</Selo>
                  <Selo cor="cinza">{bu.cedulas} cédulas</Selo>
                  <Selo cor="cinza">{bu.desafiadas} de teste</Selo>
                  <Selo cor={bu.assinaturaOk ? "verde" : "vermelho"}>{bu.assinaturaOk ? "assinado pela urna da carga" : "assinatura da urna INVÁLIDA"}</Selo>
                  <Selo cor={bu.somaOk ? "verde" : "vermelho"}>{bu.somaOk ? "soma das cédulas confere" : "soma NÃO confere"}</Selo>
                  {bu.confere !== null && <Selo cor={bu.confere ? "verde" : "vermelho"}>{bu.confere ? "BU impresso = apuração" : "BU impresso ≠ apuração"}</Selo>}
                </div>
                <p className="text-sm text-slate-600">
                  Se o código do BU ou os números forem diferentes do papel da porta da escola, a seção publicada não é a que a urna imprimiu:
                  fotografe o papel e leve à fiscalização.
                </p>
              </div>
            )}
          </Cartao>
        )}

        {resultado && (
          <Cartao
            titulo={resultado.tipo === "desafiada" ? "Cédula de teste" : resultado.encontrada ? "Seu voto" : "Código não encontrado"}
            descricao="Verificação feita neste navegador, a partir da cadeia pública — sem confiar no servidor nem na urna."
          >
            {resultado.figuras && (
              <div className="mb-5 rounded-xl bg-slate-50 p-5 text-center">
                {resultado.codigo && (
                  <div className="mb-4">
                    <CodigoVerificacao codigo={resultado.codigo} conferencia={resultado.conferencia} tamanho="medio" />
                  </div>
                )}
                <div className="mb-3 text-base font-semibold text-slate-800">Figuras gravadas para este código</div>
                <FigurasDaCedula nomes={resultado.figuras} />
              </div>
            )}

            {resultado.tipo === "cedula" && resultado.figuras && mesmas === null && (
              <div className="mb-5 space-y-3 text-center">
                <div className="text-lg font-bold text-slate-900">São as mesmas figuras que apareceram na urna — e a mesma conferência do papel?</div>
                <div className="flex flex-wrap justify-center gap-3">
                  <Botao variante="sucesso" onClick={() => setMesmas(true)} className="px-6 py-3 text-base">
                    ✓ Sim, são as mesmas
                  </Botao>
                  <Botao variante="perigo" onClick={() => setMesmas(false)} className="px-6 py-3 text-base">
                    ✕ Não, são diferentes
                  </Botao>
                </div>
              </div>
            )}
            {resultado.tipo === "cedula" && mesmas === true && (
              <div className="mb-5 rounded-lg bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
                <div className="text-lg font-bold">✓ Este é o seu voto: está no BU da sua seção, válido e na cadeia</div>
                <div className="text-sm">O que a urna mostrou é o que está gravado. Nos detalhes abaixo, veja se ele já entrou na apuração.</div>
              </div>
            )}
            {resultado.tipo === "cedula" && mesmas === false && (
              <div className="mb-5 rounded-lg bg-red-50 p-4 text-red-900 ring-1 ring-red-200">
                <div className="text-lg font-bold">✕ Figuras ou conferência diferentes</div>
                <div className="text-sm">
                  Confira se digitou o código certo. Se estiver certo, guarde o comprovante e leve à fiscalização: o que a urna mostrou não é o
                  que foi gravado. A assinatura da urna impressa no papel prova o que ela entregou.
                </div>
              </div>
            )}

            {resultado.tipo === "desafiada" && (
              <div className="mb-5 space-y-3">
                <div className="rounded-xl border-2 border-slate-900 p-4">
                  <div className="text-sm font-bold text-slate-900">Refaça o teste no seu computador</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Digite a <strong>chave da cédula de teste</strong> impressa no seu papel. Este navegador recifra cada candidato com ela e procura qual
                    dá exatamente a cédula que a urna selou com este código — antes de você decidir testar.
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={chaveTeste}
                      onChange={(e) => setChaveTeste(e.target.value)}
                      placeholder="XXXX XXXX XXXX XXXX XXXX XXXX XX"
                      className="hash flex-1 rounded-lg border border-slate-300 px-3 py-2 uppercase tracking-wider"
                    />
                    <Botao onClick={refazerTeste} disabled={!lerChaveTeste(chaveTeste)}>
                      Refazer a cifração
                    </Botao>
                  </div>
                  {reproducao && !reproducao.encontrada && <div className="mt-3 text-sm text-red-700">{reproducao.motivo}</div>}
                  {reproducao?.encontrada && (
                    <div className={`mt-3 rounded-lg p-3 text-sm ${reproducao.indice !== null && reproducao.seloOk ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
                      {reproducao.indice !== null ? (
                        <>
                          <div className="text-lg font-bold">Com a SUA chave, a cédula de teste é: {nomeOpcao(reproducao.opcao)}</div>
                          <div>
                            Cifrar {nomeOpcao(reproducao.opcao)} com a chave do papel dá, bit a bit, as cifras da cédula publicada
                            {reproducao.seloOk ? " — que é a mesma que a urna selou com este código e esta conferência." : ", mas o selo da urna NÃO confere."}
                          </div>
                          <div className="mt-1 text-xs">
                            {reproducao.aberturaPublicadaIgual ? "A abertura publicada pela urna usa a mesma chave." : "⚠ A urna publicou outra chave no BU."}
                          </div>
                        </>
                      ) : (
                        <div className="font-bold">✕ A chave do papel não abre a cédula que a urna selou com este código: a urna imprimiu uma chave falsa ou trocou a cédula — prova contra a urna.</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-xl bg-slate-50 p-4 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Pela abertura publicada no BU, a cédula de teste continha</div>
                  <div className="text-2xl font-bold text-slate-900">{nomeOpcao(resultado.opcaoRevelada)}</div>
                  <div className="mt-1 text-xs text-slate-500">recalculado aqui a partir da cadeia pública — a urna não participa desta conta</div>
                </div>
                {mesmas === null && (
                  <div className="space-y-3 text-center">
                    <div className="text-lg font-bold text-slate-900">É o mesmo candidato que a urna mostrou e imprimiu no comprovante?</div>
                    <div className="flex flex-wrap justify-center gap-3">
                      <Botao variante="sucesso" onClick={() => setMesmas(true)} className="px-6 py-3 text-base">
                        ✓ Sim, é o mesmo
                      </Botao>
                      <Botao variante="perigo" onClick={() => setMesmas(false)} className="px-6 py-3 text-base">
                        ✕ Não, a urna disse outro
                      </Botao>
                    </div>
                  </div>
                )}
                {mesmas === true && (
                  <div className="rounded-lg bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
                    <div className="text-lg font-bold">✓ A urna disse a verdade no seu teste</div>
                    <div className="text-sm">Ela cifrou exatamente o que mostrou — e não sabia se você ia testar ou votar.</div>
                  </div>
                )}
                {mesmas === false && (
                  <div className="rounded-lg bg-red-50 p-4 text-red-900 ring-1 ring-red-200">
                    <div className="text-lg font-bold">✕ FRAUDE DETECTADA: a urna mentiu no teste</div>
                    <div className="text-sm">
                      Ela mostrou um candidato e cifrou outro. O comprovante traz a declaração assinada pela urna: em “Avançado”, cole a
                      declaração (ou entregue o papel à fiscalização) — a assinatura prova a mentira para qualquer pessoa, sem revelar voto algum.
                    </div>
                  </div>
                )}
              </div>
            )}

            {!resultado.encontrada && (
              <Aviso tipo={resultado.situacaoSecao === "aguardando_midia" ? "alerta" : "erro"} titulo={`Seção ${resultado.secao ?? "?"}`}>
                {resultado.situacaoSecao === "aguardando_midia"
                  ? "A urna desta seção ainda não entregou a mídia ao TSE. O voto aparece aqui depois que a seção encerra e transmite — volte mais tarde com o mesmo código."
                  : resultado.situacaoSecao === "transmitida"
                    ? "A mídia desta seção JÁ chegou e este código NÃO está nela. Confira a digitação. Se estiver certa, guarde o comprovante: a assinatura da urna nele prova que ela aceitou a cédula — leve à fiscalização."
                    : "Nenhuma urna com essa zona e seção recebeu carga nesta eleição. Confira o código."}
              </Aviso>
            )}

            {resultado.itens.length > 0 && (
              <details open={resultado.tipo !== "cedula" || mesmas !== null} className="group">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Detalhes da verificação</summary>
                <ul className="mt-3 space-y-3">
                  {resultado.itens.map((i) => (
                    <li key={i.titulo} className="flex items-start gap-3">
                      <IconeStatus status={i.status} />
                      <div>
                        <div className="font-medium text-slate-900">{i.titulo}</div>
                        <div className="text-sm text-slate-500">{i.detalhe}</div>
                      </div>
                    </li>
                  ))}
                </ul>
                {resultado.codigoBU && <div className="mt-3 text-sm text-slate-600">Código do BU da seção: <span className="hash font-semibold">{resultado.codigoBU}</span> — compare com o papel da porta da escola.</div>}
                {resultado.rastreador && (
                  <div className="mt-4">
                    <HashCompleto valor={resultado.rastreador} rotulo="Hash completo da cédula (auditoria)" />
                  </div>
                )}
              </details>
            )}
            {resultado.tipo === "cedula" && (
              <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
                Nada aqui diz <strong>em quem</strong> você votou: código e figuras saem do selo da urna sobre uma cifra aleatória, não do voto.
                Por isso o comprovante não serve para vender ou coagir voto.
              </p>
            )}
          </Cartao>
        )}
      </div>

      <div className="space-y-4">
        <Aviso titulo="Como conferir">
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>Digite o código do comprovante: devem aparecer as 2 figuras que a urna mostrou e a conferência impressa no papel.</li>
            <li>Se você testou a urna, digite o código e a chave do teste impresso no comprovante: o seu computador refaz a cifração e mostra o que ela cifrou.</li>
            <li>Em “Boletim da seção”, compare o BU publicado com o papel da porta da escola.</li>
          </ol>
        </Aviso>
        <Aviso titulo="Sem depender deste site">
          Baixe o pacote público (<a href="/api/publico/pacote?baixar" className="underline">pacote.json</a>) e rode o validador com o código-fonte,
          no seu computador e sem internet:
          <pre className="hash mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">npm run verificar -- pacote.json 0010001K7Q2M</pre>
          ou abra o <a href="/validador.html" className="underline">validador offline</a> (um único arquivo HTML).
        </Aviso>
        <Aviso tipo="alerta" titulo="O que esta verificação NÃO faz">
          Não mostra em quem você votou e não gera nada que convença outra pessoa disso. Essa é a proteção contra compra de votos e coerção.
          (A cédula de TESTE mostra o conteúdo porque não é contada.)
        </Aviso>
      </div>
    </div>
  );
}

export default function Verificar() {
  return (
    <Pagina titulo="Verificar meu voto" subtitulo="Confira em casa, sem confiar na urna nem no TSE: o código do comprovante, o comprovante e o BU da sua seção.">
      <Suspense>
        <Verificador />
      </Suspense>
    </Pagina>
  );
}
