"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@crm.local");
  const [senha, setSenha] = useState("123456");
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
    <section className="mx-auto max-w-md pt-10">
      <div className="panel p-5">
        <h1 className="text-lg font-semibold text-slate-100">Entrar no CRM</h1>
        <p className="mt-1 text-sm text-slate-400">Autentique-se para continuar.</p>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <label className="text-sm">
            Email
            <input
              className="field mt-1"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Senha
            <input
              className="field mt-1"
              type="password"
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
              required
            />
          </label>

          {error ? <p className="text-xs text-rose-300">{error}</p> : null}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </section>
  );
}
