"use client";

import { useCallback, useEffect, useState } from "react";
import type { EstadoPublico } from "../tipos-api";

export class ErroApi extends Error {
  detalhes?: string[];
}

/** GET quando não há corpo; POST JSON quando há. Lança ErroApi com a mensagem do servidor. */
export async function api<T>(url: string, corpo?: unknown, cabecalhos: Record<string, string> = {}): Promise<T> {
  const r = await fetch(
    url,
    corpo === undefined
      ? { cache: "no-store", headers: cabecalhos }
      : { method: "POST", headers: { "content-type": "application/json", ...cabecalhos }, body: JSON.stringify(corpo) },
  );
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new ErroApi(dados.erro ?? `Erro ${r.status}`);
    e.detalhes = dados.detalhes;
    throw e;
  }
  return dados as T;
}

export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroApi && e.detalhes?.length) return `${e.message}: ${e.detalhes.join("; ")}`;
  return e instanceof Error ? e.message : String(e);
}

/** Estado público da eleição, com recarga periódica opcional. */
export function useEleicao(intervaloMs = 0) {
  const [estado, setEstado] = useState<EstadoPublico | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async (): Promise<EstadoPublico | null> => {
    try {
      const e = await api<EstadoPublico>("/api/eleicao");
      setEstado(e);
      setErro(null);
      return e;
    } catch (e) {
      setErro(mensagemDeErro(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    const tick = () => {
      if (ativo) void recarregar();
    };
    tick();
    if (!intervaloMs) return () => void (ativo = false);
    const id = setInterval(tick, intervaloMs);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [recarregar, intervaloMs]);

  return { estado, erro, recarregar };
}
