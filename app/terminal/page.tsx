import { TerminalMesario } from "@/components/TerminalMesario";

// Só o terminal do mesário, sem menus: para abrir numa janela separada, ao lado
// da janela da urna, como os dois aparelhos da seção.
export default function Terminal() {
  return <TerminalMesario quiosque />;
}
