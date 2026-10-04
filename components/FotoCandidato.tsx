"use client";

import { useEffect, useState } from "react";
import { sha256Hex } from "@/lib/crypto/codificacao";

type Carga = { tipo: "ok"; url: string } | { tipo: "falha" };

// Cada foto é baixada e conferida uma vez por página.
const cache = new Map<string, Promise<Carga>>();

/** Baixa a foto e só a aceita se o SHA-256 dos bytes for o publicado na gênese. */
function carregarVerificada(hash: string): Promise<Carga> {
  let p = cache.get(hash);
  if (!p) {
    p = fetch(`/api/publico/foto/${hash}`)
      .then(async (r): Promise<Carga> => {
        if (!r.ok) return { tipo: "falha" };
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (sha256Hex(bytes) !== hash) return { tipo: "falha" };
        return { tipo: "ok", url: URL.createObjectURL(new Blob([bytes], { type: r.headers.get("content-type") ?? "image/jpeg" })) };
      })
      .catch((): Carga => ({ tipo: "falha" }));
    cache.set(hash, p);
  }
  return p;
}

const TAMANHOS = {
  sm: "h-8 w-8 rounded-full text-[10px]",
  md: "h-16 w-[3.25rem] rounded text-sm",
  lg: "h-36 w-[7.25rem] rounded text-2xl",
};

function iniciais(nome: string) {
  const partes = nome.split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

export function FotoCandidato({ hash, nome, tamanho = "md", src }: { hash?: string; nome: string; tamanho?: keyof typeof TAMANHOS; src?: string }) {
  const [carga, setCarga] = useState<{ hash: string; r: Carga } | null>(null);

  useEffect(() => {
    if (!hash || src) return;
    let ativo = true;
    void carregarVerificada(hash).then((r) => ativo && setCarga({ hash, r }));
    return () => {
      ativo = false;
    };
  }, [hash, src]);

  const r = carga && carga.hash === hash ? carga.r : null;
  const url = src ?? (r?.tipo === "ok" ? r.url : null);
  const recusada = r?.tipo === "falha";

  return (
    <span
      title={recusada ? "Foto recusada: o arquivo não confere com o hash publicado na gênese" : nome}
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-stone-200 font-semibold text-stone-500 ${TAMANHOS[tamanho]} ${recusada ? "ring-2 ring-red-500" : ""}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagem local já verificada (blob/data URL)
        <img src={url} alt={nome} className="h-full w-full object-cover" />
      ) : (
        iniciais(nome)
      )}
      {recusada && <span className="absolute inset-x-0 bottom-0 bg-red-600 text-center text-[9px] leading-tight text-white">não confere</span>}
    </span>
  );
}

/** Recorta no centro em 4:5 e reduz para 240×300 JPEG — padroniza e descarta metadados (EXIF, localização). */
export async function prepararFoto(arquivo: File): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const proporcao = 240 / 300;
    let sw = img.width;
    let sh = img.height;
    if (sw / sh > proporcao) sw = sh * proporcao;
    else sh = sw / proporcao;
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 300;
    canvas.getContext("2d")!.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, 240, 300);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
