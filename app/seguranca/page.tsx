import { Aviso, Cartao, Pagina, Selo } from "@/components/ui";

type Caso = {
  caso: string;
  local: string;
  falha: string;
  mitigacao: string[];
  verificacao: string;
};

const CASOS: Caso[] = [
  {
    caso: "TPS 2012 — ordem dos votos reconstruída pelo horário",
    local: "Brasil · urna eletrônica · equipe da UnB (Aranha et al.)",
    falha:
      "O Registro Digital do Voto (RDV) embaralhava os votos com rand()/srand(), um gerador não criptográfico de semente de 32 bits, semeado com time() — o horário em segundos da inicialização, que aparecia na zerésima. Com informação pública, a equipe recuperou a ordem exata dos votos em simulações de 10, 16, 21 e 475 eleitores. Cruzada com a ordem de comparecimento (mesário mal-intencionado, ou eleitor com horário conhecido), essa ordem quebra o sigilo do voto.",
    mitigacao: [
      "Não existe embaralhamento para semear: o BU traz as cédulas em ordem de rastreador, que é o hash de cifras aleatórias. Não há semente nenhuma para recuperar.",
      "Toda aleatoriedade vem de crypto.getRandomValues (CSPRNG do sistema operacional). Math.random é proibido por regra de lint.",
      "Nenhuma cédula tem horário ou número sequencial: a memória da urna é uma tabela WITHOUT ROWID indexada por (urna, rastreador), não há log por voto, o journal do SQLite é DELETE (o WAL guardaria a ordem de escrita) e secure_delete zera páginas apagadas.",
      "A chave de cada cédula depositada é destruída na hora: nem a urna guarda como abri-la.",
      "O caderno não grava qual eleitor foi liberado em que horário, e a mesa assina a credencial às cegas: não há sequência de comparecimento no sistema para cruzar.",
      "Mesmo se alguém ligasse um eleitor a uma cifra, decifrar uma cédula individual exige os três trustees — e cada trustee só decifra a soma recalculada por ele mesmo.",
    ],
    verificacao: "Cédulas sem ordem de chegada e sem horário",
  },
  {
    caso: "TPS 2017 — chave no código e bibliotecas sem verificação",
    local: "Brasil · urna eletrônica · equipe de Aranha et al.",
    falha:
      "A chave simétrica que protegia as mídias de instalação estava escrita no código-fonte e era a mesma em todas as urnas. Duas bibliotecas eram carregadas sem assinatura ou verificação de integridade, o que permitiu injetar código, quebrar o sigilo de votos selecionados (manipulando chaves geradas em tempo de execução) e alterar as mensagens exibidas ao eleitor.",
    mitigacao: [
      "Nenhuma chave no código. Todas são geradas por eleição: cada urna gera a sua (Ed25519) dentro dela na carga, cada mesa a sua (RSA), o quadro a dele, e a chave da eleição é a soma de três chaves geradas cada uma no navegador do próprio trustee. O auditor recusa duas urnas com a mesma chave.",
      "A chave privada do quadro fica fora do banco; quem só tem acesso ao banco não consegue reassinar a cadeia.",
      "O hash do software criptográfico é publicado no bloco de gênese; o auditor de linha de comando compara com o hash dos seus próprios arquivos.",
      "O que o eleitor vê também é selado: a gênese publica o SHA-256 da foto de cada candidato, e a urna recusa exibir uma foto cujo arquivo não confere — trocar a imagem no servidor não engana o eleitor.",
      "Se a urna for adulterada para cifrar outra opção, o teste do eleitor pega: o comprovante traz a chave daquela cédula e, em casa, o computador do eleitor refaz a cifração e mostra o que a urna cifrou de verdade.",
    ],
    verificacao: "Manifesto da eleição (gênese) · Carga das urnas · Cédulas de teste",
  },
  {
    caso: "Hursti hack — contagem pré-carregada",
    local: "EUA, 2005 · Diebold, condado de Leon (Flórida)",
    falha:
      "O cartão de memória da máquina de apuração podia vir com contagens pré-carregadas, que somavam zero no relatório inicial e desviavam votos durante a apuração.",
    mitigacao: [
      "O resultado oficial é a decifração da soma homomórfica das cédulas de cada seção, com provas. O contador da urna só imprime o BU — e o auditor compara o BU impresso com a decifração.",
      "A zerésima é assinada pela urna com a chave publicada na carga e diz quantas cédulas há na memória (zero); o BU aponta para ela.",
    ],
    verificacao: "Mídias das seções · BU impresso = apuração · Resultado final",
  },
  {
    caso: "Washington D.C. — injeção de comandos no piloto de voto pela Internet",
    local: "EUA, 2010 · Universidade de Michigan",
    falha:
      "Durante o teste público, pesquisadores exploraram uma injeção de comandos no envio de arquivos de cédula, obtiveram controle do servidor e alteraram os votos.",
    mitigacao: [
      "Sem shell, sem envio de arquivos ao servidor: entrada JSON estrita, com limite de tamanho, e cada cédula reconstruída campo a campo antes de entrar no quadro.",
      "A urna não está em rede durante a votação: fala só com a mesa e com a própria memória. O TSE recebe a mídia depois, e a recusa se não conferir com a carga.",
      "Mesmo com o servidor do TSE comprometido, alterar votos é detectável: cada cédula é assinada pela credencial, cada BU pela urna e cada bloco pelo quadro.",
    ],
    verificacao: "Assinatura de cada cédula · Assinatura do quadro em cada bloco",
  },
  {
    caso: "Helios — Fiat-Shamir fraco",
    local: "2012 · Bernhard, Pereira e Warinschi (ASIACRYPT)",
    falha:
      "As provas não interativas calculavam o desafio sem incluir todo o enunciado no hash. Em certas eleições, isso permitia forjar provas, travar a apuração ou adulterar o resultado.",
    mitigacao: [
      "Fiat-Shamir forte: o desafio inclui domínio, hash da eleição, credencial, índice da opção, chave pública, cifras e todos os compromissos.",
      "Como a credencial entra no contexto, copiar a cédula de outro eleitor para votar igual a ele não funciona.",
    ],
    verificacao: "Provas de conhecimento zero · Decifração parcial dos trustees",
  },
  {
    caso: "Moscou — ElGamal com chaves de 256 bits",
    local: "Rússia, 2019 · sistema baseado em blockchain · Pierrick Gaudry",
    falha:
      "O sistema usava três cifrações ElGamal encadeadas com chaves de 256 bits sobre corpos finitos. As chaves privadas foram recuperadas em minutos. O grupo tinha ordem par, o que ainda vazava um bit da mensagem. A blockchain não compensou a criptografia fraca.",
    mitigacao: [
      "Grupo padronizado ristretto255 (RFC 9496), de ordem prima, com cerca de 128 bits de segurança. Nenhum parâmetro “caseiro”.",
      "RSA-2048 nas mesas e Ed25519 nas urnas e no quadro, por bibliotecas maduras e auditadas (@noble).",
      "Sem marketing de blockchain: uma cadeia de hashes assinada, simples de verificar.",
    ],
    verificacao: "Manifesto da eleição (gênese)",
  },
  {
    caso: "Swiss Post — prova de embaralhamento com alçapão",
    local: "Suíça, 2019 · Lewis, Pereira e Teague",
    falha:
      "Os parâmetros de compromisso da prova de embaralhamento admitiam um alçapão: quem o conhecesse produziria provas válidas mesmo tendo trocado votos.",
    mitigacao: [
      "Apuração homomórfica, sem mixnet: não há embaralhamento a provar.",
      "O único gerador do sistema é o gerador padrão do ristretto255. Não existe segundo gerador escolhido por alguém.",
      "Especificação, código e auditor abertos: qualquer pessoa pode refazer as verificações.",
    ],
    verificacao: "Provas de conhecimento zero",
  },
];

const RESIDUAIS = [
  [
    "“O código da urna é o publicado?”",
    "A urna compara o código em execução com o hash da gênese — mas software adulterado pode mentir sobre si mesmo (a urna do laboratório mente). O que pega código malicioso é o teste do eleitor, conferido FORA da urna, e a auditoria independente. Em produção: build reprodutível e hardware com raiz de confiança (boot medido/TPM).",
  ],
  [
    "Urna adulterada que troca votos",
    "O teste pega com probabilidade: com 10% dos eleitores testando, uma urna que troca 50 votos é pega em 99,5% das vezes. Ela não sabe quem vai testar porque se compromete (código + figuras + conferência) antes da decisão.",
  ],
  [
    "Urna adulterada que vaza o voto (canal subliminar)",
    "A urna vê o voto, como a de hoje. Adulterada, ela pode escolher a aleatoriedade para que as figuras “contem” o candidato. A verificação de integridade não depende da urna; o sigilo contra uma urna adulterada, sim. Mitigação futura: aleatoriedade de um segundo aparelho independente (re-cifração).",
  ],
  [
    "Duas cédulas com o mesmo código (colisão)",
    "Só código + figuras = 41 bits: uma urna preparada acharia duas cédulas com os mesmos. Por isso há a conferência (40 bits) impressa antes da decisão — 81 bits no total — e o validador a mostra para o eleitor comparar.",
  ],
  [
    "Insider com as chaves da urna e da mesa",
    "Consegue fabricar uma seção matematicamente perfeita: o auditor não percebe. Quem percebe é o eleitor (código some) e o BU em papel colado na escola. Por isso o BU impresso e as fotos dos fiscais continuam essenciais.",
  ],
  [
    "Dois eleitores com o mesmo código (clash)",
    "Uma urna adulterada poderia mostrar a dois eleitores o código da MESMA cédula e usar a credencial do segundo para outro voto. Cada um, sozinho, acha “o seu” código. Pega quem compara comprovantes (fiscais coletando códigos voluntariamente).",
  ],
  ["Coerção presencial", "Foto da tela ou alguém dentro da cabine estão fora do alcance da criptografia."],
  ["Mesa desonesta", "O comparecimento impresso no BU é o contador da mesa da seção. No mundo real, ele precisa bater com o caderno assinado em papel."],
  ["Conluio dos 3 trustees", "Juntos, poderiam decifrar uma cifra individual. Ainda precisariam saber qual cifra é de qual eleitor — e o eleitor que publica o próprio código daria essa ligação. Por isso o código não deve ir junto do nome."],
  ["Disponibilidade 3-de-3", "Se um trustee perder a chave, não há apuração. Em produção: limiar t-de-n com geração distribuída (Pedersen DKG)."],
  ["Seções pequenas", "O BU de cada seção é público, como hoje: numa seção com poucos eleitores votando igual, o resultado da seção diz muito sobre cada um."],
  ["Chave do quadro no mesmo servidor", "Em produção: HSM, mais testemunhas externas que assinam periodicamente a cabeça da cadeia."],
  ["Assinatura cega simplificada", "Usamos RSA-FDH. Em produção: RSABSSA (RFC 9474)."],
  ["Operadores sem autenticação", "As telas de mesário e admin não têm login neste protótipo."],
  ["Código não auditado", "protótipo, sem certificação. Não utilizar em eleições reais."],
];

export default function Seguranca() {
  return (
    <Pagina
      titulo="Lições de falhas reais"
      subtitulo="Casos documentados de falhas em urnas e sistemas de votação, o que cada um ensina e como este protótiporesponde. A última coluna mostra qual verificação do auditor detectaria a repetição do problema."
    >
      <Aviso tipo="alerta" titulo="Sobre a cadeia de blocos">
        As seções votam sem rede, como hoje. A cadeia do TSE só recebe a carga de cada urna (chaves públicas, antes dos votos) e a mídia de
        cada seção (zerésima + BU assinados pela urna, depois do encerramento). Qualquer pessoa baixa o pacote público e o confere em casa,
        sem internet, com o código-fonte do validador. A cadeia não guarda horário nem ordem de chegada de cédulas.
      </Aviso>

      <Cartao titulo="E se a urna mostrar uma coisa na tela e gravar outra?" descricao="O ponto mais importante — e por que a conferência tem de ser feita FORA da urna.">
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            Nenhuma máquina prova a própria honestidade: se a urna está adulterada, tudo o que ela mostra na tela — inclusive “verificação ok” —
            pode ser mentira. O laboratório tem uma urna assim (<span className="font-mono">/laboratorio/urna</span>) e ela passa na auditoria
            matemática. O protocolo não confia na tela; ele obriga a urna a se comprometer antes e deixa o eleitor conferir depois, fora dela:
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>Compromisso antes da decisão.</strong> Depois que o eleitor confirma, a urna cifra, sela e mostra código + figuras + conferência
              (81 bits) — antes de saber se ele vai depositar ou testar.
            </li>
            <li>
              <strong>Teste com chave impressa.</strong> Se o eleitor testa, a urna imprime o que diz ter cifrado, a <em>chave daquela cédula</em> e
              assina tudo. A cédula de teste é anulada e vai aberta para o BU.
            </li>
            <li>
              <strong>Conferência fora da urna.</strong> Em casa, o validador (código aberto, sem internet) refaz a cifração com a chave do papel.
              Se a urna mentiu, a conta mostra o candidato real, e a assinatura dela no papel é prova para qualquer juiz.
            </li>
            <li>
              <strong>Voto depositado nunca é aberto.</strong> A chave dele é destruída; ele só é contado dentro da soma da seção, que os 3 trustees
              decifram com provas.
            </li>
          </ol>
        </div>
      </Cartao>

      <div className="space-y-4">
        {CASOS.map((c) => (
          <Cartao key={c.caso} titulo={c.caso} descricao={c.local}>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">O que aconteceu</div>
                <p className="text-sm text-slate-700">{c.falha}</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Como o TAI-VOTE responde</div>
                <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
                  {c.mitigacao.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Verificação no auditor: <Selo cor="azul">{c.verificacao}</Selo>
            </div>
          </Cartao>
        ))}
      </div>

      <Cartao titulo="Riscos que continuam abertos" descricao="Dizer o que o protótiponão resolve faz parte da segurança.">
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {RESIDUAIS.map(([t, d]) => (
            <div key={t} className="text-sm">
              <div className="font-medium text-slate-900">{t}</div>
              <div className="text-slate-600">{d}</div>
            </div>
          ))}
        </div>
      </Cartao>

      <Cartao titulo="Fontes">
        <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
          <li>Aranha, Karam, Miranda, Scarel — “Vulnerabilidades no software da urna eletrônica brasileira” (TPS 2012).</li>
          <li>TSE — “Esquenta Teste da Urna: em 2012, plano de ataque contribuiu para tornar a votação ainda mais segura” (2023).</li>
          <li>Aranha et al. — “The return of software vulnerabilities in the Brazilian voting machine” (TPS 2017), Computers &amp; Security, 2019.</li>
          <li>Bernhard, Pereira, Warinschi — “How not to prove yourself: pitfalls of the Fiat-Shamir heuristic and applications to Helios”, ASIACRYPT 2012.</li>
          <li>Gaudry — “Breaking the encryption scheme of the Moscow Internet voting system”, Financial Cryptography 2020.</li>
          <li>Lewis, Pereira, Teague — análise do sistema SwissPost-Scytl (“Ceci n’est pas une preuve”), 2019.</li>
          <li>Wolchok et al. — “Attacking the Washington, D.C. Internet voting system”, Financial Cryptography 2012.</li>
        </ul>
      </Cartao>
    </Pagina>
  );
}
