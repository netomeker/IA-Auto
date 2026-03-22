import { RuixenMoonChat } from "@/components/ui/ruixen-moon-chat";
import { FormEvent, useEffect, useMemo, useState } from "react";

const PROFILE_CONTEXT = [
  "Workspace: Desenvolvimento web + marketing para produtos digitais.",
  "Stack principal: HTML, CSS, JavaScript, React e Node.js.",
  "Foco do assistente: codigo limpo, debug, performance, copy e funil de venda.",
  "Estilo de resposta: direto, passo a passo, com acoes praticas."
].join("\n");

const AUTH_KEY = "central_ia_auth_v1";
const ACCESS_PASSWORD = "Dev";

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authenticatedUser, setAuthenticatedUser] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTH_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { username?: string };
      if (parsed?.username) {
        setAuthenticatedUser(parsed.username);
      }
    } catch {
      window.localStorage.removeItem(AUTH_KEY);
    }
  }, []);

  const contextWithUser = useMemo(() => {
    if (!authenticatedUser) return PROFILE_CONTEXT;
    return `${PROFILE_CONTEXT}\nUsuario logado: ${authenticatedUser}.`;
  }, [authenticatedUser]);

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const safeName = username.trim() || "Usuario";
    if (password.trim() !== ACCESS_PASSWORD) {
      setAuthError("Senha incorreta. Use a senha configurada.");
      return;
    }
    const payload = { username: safeName, at: new Date().toISOString() };
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
    setAuthenticatedUser(safeName);
    setAuthError("");
    setPassword("");
  };

  if (!authenticatedUser) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-black p-4 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.2),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(167,139,250,0.2),transparent_30%),radial-gradient(circle_at_50%_90%,rgba(34,197,94,0.12),transparent_36%)]" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-black/65 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:p-7">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/85">Acesso privado</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Entrar na Central IA</h1>
          <p className="mt-2 text-sm text-slate-300">Use qualquer nome e a senha de acesso para abrir o sistema.</p>

          <form className="mt-6 space-y-3" onSubmit={handleLogin}>
            <label className="block text-xs text-slate-300">
              Nome
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Seu nome"
                className="mt-1.5 h-11 w-full rounded-xl border border-white/15 bg-white/[0.05] px-3 text-sm text-white outline-none transition focus:border-cyan-300/55 focus:bg-white/[0.08]"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Senha"
                className="mt-1.5 h-11 w-full rounded-xl border border-white/15 bg-white/[0.05] px-3 text-sm text-white outline-none transition focus:border-cyan-300/55 focus:bg-white/[0.08]"
              />
            </label>

            {authError && (
              <div className="rounded-xl border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="h-11 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(56,189,248,0.28)] transition hover:brightness-110"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <RuixenMoonChat
      title={`Central IA - ${authenticatedUser}`}
      subtitle="Especialista em dev e marketing digital. Digite seu pedido e execute mais rapido."
      contextProfile={contextWithUser}
    />
  );
}
