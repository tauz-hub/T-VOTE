"use client";

import { Selo } from "./ui";

export type Eleitor = {
  id: number;
  nome: string;
  documento: string;
  secao: string;
  apto: number;
  situacao: "apto" | "habilitado" | "credenciado";
};

export function SeloSituacao({ e }: { e: Eleitor }) {
  if (!e.apto) return <Selo cor="vermelho">Inapto</Selo>;
  if (e.situacao === "credenciado") return <Selo cor="verde">Compareceu</Selo>;
  if (e.situacao === "habilitado") return <Selo cor="amarelo">Código pendente</Selo>;
  return <Selo>Apto</Selo>;
}
