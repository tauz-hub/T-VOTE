"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, mensagemDeErro } from "@/lib/client/api";
import { type Eleitor, SeloSituacao } from "@/components/eleitor";
import { Aviso, Botao, Campo, Cartao, Pagina } from "@/components/ui";

export default function Cadastro() {
  const [eleitores, setEleitores] = useState<Eleitor[]>([]);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState({ nome: "", documento: "", secao: "0001" });
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async (termo: string) => {
    const r = await api<{ eleitores: Eleitor[] }>(`/api/registro/eleitores?busca=${encodeURIComponent(termo)}`);
    setEleitores(r.eleitores);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void carregar(busca), 200);
    return () => clearTimeout(id);
  }, [busca, carregar]);

  async function cadastrar(ev: FormEvent) {
    ev.preventDefault();
    setOcupado(true);
    try {
      const { eleitor } = await api<{ eleitor: Eleitor }>("/api/registro/eleitores", form);
      setMsg({ tipo: "ok", texto: `${eleitor.nome} cadastrado(a) — documento ${eleitor.documento}` });
      setForm({ nome: "", documento: "", secao: form.secao });
      await carregar(busca);
    } catch (e) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function gerarFicticios() {
    setOcupado(true);
    try {
      const { criados } = await api<{ criados: number }>("/api/admin/ficticios", { quantidade: 20 });
      setMsg({ tipo: "ok", texto: `${criados} eleitores fictícios cadastrados` });
      await carregar(busca);
    } catch (e) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function alternarAptidao(e: Eleitor) {
    try {
      await api("/api/registro/aptidao", { id: e.id, apto: !e.apto });
      await carregar(busca);
    } catch (err) {
      setMsg({ tipo: "erro", texto: mensagemDeErro(err) });
    }
  }

  return (
    <Pagina
      titulo="Cadastro de eleitores"
      subtitulo="Banco A — registro eleitoral. Responde apenas “esta pessoa pode votar?” e “já compareceu?”. Nenhuma informação de voto chega aqui."
    >
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <Cartao titulo="Novo eleitor">
            <form onSubmit={cadastrar} className="space-y-3">
              <Campo rotulo="Nome completo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
              <Campo
                rotulo="Documento"
                dica="CPF ou título de eleitor (somente números/letras são guardados)"
                value={form.documento}
                onChange={(e) => setForm({ ...form, documento: e.target.value })}
                required
              />
              <Campo rotulo="Seção" value={form.secao} onChange={(e) => setForm({ ...form, secao: e.target.value })} />
              <Botao type="submit" disabled={ocupado} className="w-full">
                Cadastrar
              </Botao>
            </form>
          </Cartao>
          <Cartao titulo="Dados de teste" descricao="Cadastra 20 eleitores com nomes e documentos fictícios.">
            <Botao variante="secundario" onClick={gerarFicticios} disabled={ocupado} className="w-full">
              Gerar 20 eleitores fictícios
            </Botao>
          </Cartao>
          {msg && <Aviso tipo={msg.tipo === "ok" ? "ok" : "erro"}>{msg.texto}</Aviso>}
        </div>

        <Cartao
          titulo={`Eleitores (${eleitores.length}${eleitores.length === 500 ? "+" : ""})`}
          acoes={<input placeholder="Buscar por nome ou documento" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Seção</th>
                  <th className="py-2 pr-3">Situação</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {eleitores.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 text-slate-400">{e.id}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{e.nome}</td>
                    <td className="hash py-2 pr-3 text-slate-600">{e.documento}</td>
                    <td className="py-2 pr-3 text-slate-600">{e.secao}</td>
                    <td className="py-2 pr-3">
                      <SeloSituacao e={e} />
                    </td>
                    <td className="py-2 text-right">
                      {e.situacao !== "credenciado" && (
                        <button onClick={() => alternarAptidao(e)} className="text-xs text-slate-500 underline hover:text-slate-900">
                          {e.apto ? "marcar inapto" : "marcar apto"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {eleitores.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Nenhum eleitor encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Cartao>
      </div>
    </Pagina>
  );
}
