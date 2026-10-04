// Valores padrão do formulário de nova eleição (cargo: Presidente da República).
export const NOME_ELEICAO_PADRAO = "Presidente da República — demonstração 2026";

export const MAX_CANDIDATOS = 20;

// Fotos: TSE, Portal de Dados Abertos (Candidatos 2026), licença CC BY — ver public/candidatos/CREDITOS.md
export const CANDIDATOS_PADRAO: { numero: string; nome: string; partido: string; foto: string }[] = [
  { numero: "13", nome: "Luiz Inácio Lula da Silva", partido: "PT", foto: "padrao:13" },
  { numero: "14", nome: "Renan Santos", partido: "Missão", foto: "padrao:14" },
  { numero: "16", nome: "Hertz Dias", partido: "PSTU", foto: "padrao:16" },
  { numero: "21", nome: "Edmilson Costa", partido: "PCB", foto: "padrao:21" },
  { numero: "22", nome: "Flávio Bolsonaro", partido: "PL", foto: "padrao:22" },
  { numero: "27", nome: "Clariana Barão", partido: "DC", foto: "padrao:27" },
  { numero: "29", nome: "Rui Costa Pimenta", partido: "PCO", foto: "padrao:29" },
  { numero: "30", nome: "Romeu Zema", partido: "Novo", foto: "padrao:30" },
  { numero: "35", nome: "Wilson Grassi", partido: "Democrata", foto: "padrao:35" },
  { numero: "55", nome: "Ronaldo Caiado", partido: "PSD", foto: "padrao:55" },
  { numero: "70", nome: "Augusto Cury", partido: "Avante", foto: "padrao:70" },
  { numero: "80", nome: "Samara Martins", partido: "Unidade Popular", foto: "padrao:80" },
];
