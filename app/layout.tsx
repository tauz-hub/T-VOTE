import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAI-VOTE — votação verificável",
  description: "protótipo de votação eletrônica criptograficamente verificável",
};

// Sem fontes ou scripts externos: a aplicação não faz nenhuma requisição para
// fora da rede eleitoral.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          TAI-VOTE · protótipo — não utilizar em eleições reais · rede eleitoral local (127.0.0.1)
        </footer>
      </body>
    </html>
  );
}
