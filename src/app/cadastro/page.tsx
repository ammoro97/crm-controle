"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";

function toDefaultName(email: string) {
  const localPart = (email || "").split("@")[0] || "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toResponsavelId(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CadastroPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const nome = toDefaultName(email);
      const responsavelId = toResponsavelId(nome || email);
      const { data, error } = await supabase.auth.signUp({
        email,
        password: senha,
        options: {
          data: {
            nome,
            responsavelId,
          },
        },
      });

      if (error) {
        setError(error.message || "Nao foi possivel criar a conta.");
        return;
      }

      if (!data.user) {
        setError("Nao foi possivel criar a conta.");
        return;
      }

      setSuccess("Conta criada com sucesso. Redirecionando para login...");
      setTimeout(() => {
        router.replace("/login");
      }, 700);
    } catch {
      setError("Falha de rede ao criar conta.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex min-h-[calc(100vh-2rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Comercial Pro</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-slate-100">Criar sua conta</h1>
          <p className="mt-1.5 text-sm text-slate-400">Cadastre seu email e senha para acessar o CRM.</p>
        </div>

        <div className="panel p-6">
          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm text-slate-300">
              Email
              <input
                className="field mt-1.5"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="block text-sm text-slate-300">
              Senha
              <input
                className="field mt-1.5"
                type="password"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
                required
              />
            </label>

            {error ? <p className="text-xs text-rose-300">{error}</p> : null}
            {success ? <p className="text-xs text-emerald-300">{success}</p> : null}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Criando..." : "Cadastrar"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-400">
            Já possui conta?{" "}
            <Link href="/login" className="text-accent hover:text-emerald-300 transition-colors">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
