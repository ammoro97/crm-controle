"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await login(email, senha);
    if (!result.success) {
      setError(result.message || "Nao foi possivel autenticar.");
      setLoading(false);
      return;
    }

    router.replace("/leads");
  };

  return (
    <section className="flex min-h-[calc(100vh-2rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Comercial Pro</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-slate-100">Entrar na sua conta</h1>
          <p className="mt-1.5 text-sm text-slate-400">Autentique-se para continuar.</p>
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

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-400">
            Ainda não tem conta?{" "}
            <Link href="/cadastro" className="text-accent hover:text-emerald-300 transition-colors">
              Criar cadastro
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
