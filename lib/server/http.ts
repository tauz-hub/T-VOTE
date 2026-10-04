export class ErroHttp extends Error {
  constructor(
    public status: number,
    message: string,
    public detalhes?: string[],
  ) {
    super(message);
  }
}

/** Envolve um handler: devolve JSON e converte erros em respostas legíveis. */
export function rota(handler: (req: Request) => unknown) {
  return async (req: Request): Promise<Response> => {
    try {
      const r = await handler(req);
      return Response.json(r ?? { ok: true });
    } catch (e) {
      if (e instanceof ErroHttp) return Response.json({ erro: e.message, detalhes: e.detalhes }, { status: e.status });
      console.error(e);
      return Response.json({ erro: "Erro interno no servidor" }, { status: 500 });
    }
  };
}

/** Lê o corpo como JSON com limite de tamanho (entrada estrita, sem surpresas). */
export async function corpoJson<T = Record<string, unknown>>(req: Request, limiteBytes = 1_000_000): Promise<T> {
  const texto = await req.text();
  if (texto.length > limiteBytes) throw new ErroHttp(413, "Requisição grande demais");
  try {
    const v = JSON.parse(texto);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new ErroHttp(400, "JSON inválido");
  }
}
