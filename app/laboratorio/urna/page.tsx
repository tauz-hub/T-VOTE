"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Urna } from "@/components/Urna";

// Laboratório: urna com software adulterado na carga (ataque interno). Sem
// parâmetro, é a urna que o técnico instala pelo teclado; com ?u=<id>, é uma das
// urnas de exemplo criadas em Admin → Laboratório de ataques.
function UrnaDoLaboratorio() {
  const u = useSearchParams().get("u") ?? undefined;
  return <Urna perfil="laboratorio" idLaboratorio={u} key={u ?? "manual"} />;
}

export default function UrnaAdulterada() {
  return (
    <Suspense>
      <UrnaDoLaboratorio />
    </Suspense>
  );
}
