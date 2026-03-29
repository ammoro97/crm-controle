"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type RegisterResponse = {
  success?: boolean;
  message?: string;
};

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
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, senha }),
      });
      const data = (await response.json()) as RegisterResponse;

      if (!response.ok || !data.success) {
        setError(data.message || "Nao foi possivel criar a conta.");
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
    <section className="mx-auto max-w-md pt-10">
      <div className="panel p-5">
        <h1 className="text-lg font-semibold text-slate-100">Criar conta</h1>
        <p className="mt-1 text-sm text-slate-400">Cadastre seu email e senha para acessar o CRM.</p>

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
          {success ? <p className="text-xs text-emerald-300">{success}</p> : null}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Criando..." : "Cadastrar"}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-400">
          Ja possui conta?{" "}
          <Link href="/login" className="text-emerald-300 hover:text-emerald-200">
            Entrar
          </Link>
        </p>
      </div>
    </section>
  );
}

