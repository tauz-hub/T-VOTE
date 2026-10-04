"use client";

import Link from "next/link";
import { useEleicao } from "@/lib/client/api";
import { Cartao, Estatistica, GraficoResultado, Hash, Pagina, SeloFase } from "@/components/ui";

const ROTEIRO = [
  { href: "/cadastro", titulo: "Cadastrar eleitores", texto: "Caderno de votação (Banco A). Gere eleitores fictícios para testar." },
  { href: "/admin", titulo: "TSE cria a eleição", texto: "Candidatos a Presidente com foto; publica o bloco de gênese." },
  { href: "/apuracao", titulo: "Trustees geram as chaves", texto: "Cada trustee gera sua chave no próprio navegador. A privada nunca sai de lá." },
  { href: "/admin", titulo: "TSE abre a eleição", texto: "Publica a chave conjunta: as urnas já podem receber a carga." },
  { href: "/urna", titulo: "Instalar e carregar a urna", texto: "Pareia com a mesa e faz a carga: a urna gera a própria chave; a pública vai para o quadro." },
  { href: "/mesario", titulo: "Mesário abre a seção", texto: "A urna imprime a zerésima. Daqui até o fim do dia, urna e mesa trabalham sem rede." },
  { href: "/mesario", titulo: "Mesário libera, eleitor vota", texto: "Credencial anônima da mesa, voto cifrado, provas ZK, figuras + código, teste opcional da urna." },
  { href: "/mesario", titulo: "Encerrar a seção e transmitir", texto: "A urna imprime o BU (colado na porta) e a mídia vai ao TSE, que confere tudo antes de publicar." },
  { href: "/admin", titulo: "TSE encerra a eleição", texto: "Lista as seções recebidas e as que ficaram sem mídia." },
  { href: "/apuracao", titulo: "Trustees decifram seção por seção", texto: "Só os três juntos apuram — e cada BU impresso é comparado com a decifração." },
  { href: "/verificar", titulo: "Eleitor confere em casa", texto: "Código do comprovante → as mesmas 2 figuras; comprovante → o que a urna cifrou de verdade." },
  { href: "/auditoria", titulo: "Auditoria independente", texto: "Refaz toda a matemática a partir do pacote público (ou baixe o validador offline)." },
];

export default function Inicio() {
  const { estado } = useEleicao(3000);
  const s = estado?.estatisticas;

  return (
    <Pagina
      titulo="Votação eletrônica criptograficamente verificável"
      subtitulo="protótipo: credencial anônima por assinatura cega, voto cifrado com ElGamal homomórfico, provas de conhecimento zero, quadro público encadeado e assinado, apuração por três trustees e auditor independente."
    >
      <Cartao
        titulo={estado?.existe ? estado.nome : "Nenhuma eleição criada"}
        descricao={estado?.existe ? <>ID {estado.eleicao_id} · protocolo v{estado.versao_protocolo} (seção offline)</> : "Comece pelo cadastro de eleitores e depois crie a eleição no Admin."}
        acoes={<SeloFase fase={estado?.fase} />}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Estatistica rotulo="Eleitores aptos" valor={s?.aptos ?? "—"} />
          <Estatistica rotulo="Compareceram" valor={s?.credenciados ?? "—"} dica="Eleitores que receberam credencial anônima" />
          <Estatistica rotulo="Seções" valor={s ? `${s.secoes_transmitidas}/${s.secoes_carregadas}` : "—"} dica="Mídias recebidas pelo TSE / urnas com carga" />
          <Estatistica rotulo="Cédulas no quadro" valor={s ? `${s.cedulas_publicadas}` : "—"} dica={`${s?.desafiadas_publicadas ?? 0} cédulas de teste · só aparecem depois que a seção transmite`} />
        </div>
        {estado?.cabeca && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <span>
              Cabeça da cadeia: bloco {estado.cabeca.numero} ({estado.cabeca.tipo}) <Hash valor={estado.cabeca.hash} n={16} />
            </span>
            <span>
              Chave do quadro <Hash valor={estado.chave_quadro} n={16} />
            </span>
            {estado.hash_eleicao && (
              <span>
                Hash da eleição <Hash valor={estado.hash_eleicao} n={16} />
              </span>
            )}
          </div>
        )}
        {estado?.resultado && (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Resultado publicado</h3>
            <GraficoResultado resultado={estado.resultado} />
          </div>
        )}
      </Cartao>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Cartao titulo="Roteiro de teste" descricao="Siga na ordem para validar o sistema de ponta a ponta.">
          <ol className="space-y-1">
            {ROTEIRO.map((p, i) => (
              <li key={i}>
                <Link href={p.href} className="group flex gap-3 rounded-lg p-2 hover:bg-slate-50">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
                  <span>
                    <span className="font-medium text-slate-900 group-hover:underline">{p.titulo}</span>
                    <span className="block text-sm text-slate-500">{p.texto}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Cartao>

        <div className="space-y-6">
          <Cartao titulo="Regra de separação">
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                <strong>A seção trabalha sem rede, como hoje.</strong> Urna e mesa só se falam entre si; o TSE recebe a carga antes
                e a mídia (zerésima + BU, assinados pela urna) depois do encerramento.
              </p>
              <p>
                <strong>Quem sabe quem é o eleitor não sabe em quem ele votou.</strong> O caderno (Banco A) guarda identidade e
                comparecimento; a mesa (Banco B) assina às cegas; a urna (Banco D) guarda só cédulas cifradas, sem ordem e sem horário.
              </p>
              <p>
                <strong>Ninguém sozinho apura.</strong> A chave da eleição é a soma das chaves de três trustees.
              </p>
            </div>
          </Cartao>
          <Cartao titulo="Lições de falhas reais">
            <p className="text-sm text-slate-700">
              O protocolo foi desenhado contra falhas já demonstradas em urnas e sistemas de votação — como o TPS 2012, em que a
              ordem dos votos foi reconstruída porque o embaralhamento usava o horário como semente.
            </p>
            <Link href="/seguranca" className="mt-3 inline-block text-sm font-medium text-slate-900 underline">
              Ver casos e mitigações →
            </Link>
          </Cartao>
        </div>
      </div>
    </Pagina>
  );
}
