"use client";

import { useState } from "react";
import { setSessionToken } from "@/lib/session-token";

export type AuthUser = { id: string; name: string; email: string };

export const DEMO_CREDENTIALS = { email: "ana@fluxo.local", password: "fluxo1234" };

type Mode = "login" | "register";

function Glyph({ name }: { name: "layers" | "calendar" | "book" | "spark" | "arrow" | "eye" | "eye-off" }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "layers":
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
    case "book":
      return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 19a2 2 0 0 1 2-2h14M8 7h8" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "eye-off":
      return <svg {...common}><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-3.2 4.1M6.2 6.2A17.6 17.6 0 0 0 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8" /></svg>;
    default:
      return <svg {...common}><path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3Z" /></svg>;
  }
}

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser, token: string, workspace: unknown) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const authenticate = async (payload: { name?: string; email: string; password: string }, target: Mode) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${target}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = (await response.json().catch(() => ({}))) as {
        user?: AuthUser;
        token?: string;
        workspace?: unknown;
        message?: string;
      };
      if (!response.ok || !data.user || !data.token || !data.workspace) {
        setError(data.message ?? "Não foi possível iniciar a sessão. Tente novamente.");
        return;
      }
      // O ambiente já veio na própria resposta do login: não há uma segunda
      // chamada de rede capaz de invalidar a transição.
      setSessionToken(data.token);
      onAuthenticated(data.user, data.token, data.workspace);
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (busy) return;
    if (mode === "register") {
      void authenticate({ name: name.trim(), email: email.trim(), password }, "register");
    } else {
      void authenticate({ email: email.trim(), password }, "login");
    }
  };

  const useDemo = (event?: React.MouseEvent) => {
    if (event) event.preventDefault();
    if (busy) return;
    setMode("login");
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
    void authenticate({ email: DEMO_CREDENTIALS.email, password: DEMO_CREDENTIALS.password }, "login");
  };

  return (
    <main className="auth-shell">
      <section className="auth-hero" aria-hidden="true">
        <div className="auth-orb auth-orb-one" />
        <div className="auth-orb auth-orb-two" />
        <div className="auth-hero-content">
          <div className="auth-brand"><span className="auth-brand-mark">F</span>fluxo<span className="auth-brand-dot">.</span></div>
          <h1>Seus estudos, organizados em ciclos.</h1>
          <p>Planeje temas por dia da semana, registre cada sessão e acompanhe sua evolução — tudo em um ambiente só seu.</p>
          <ul className="auth-features">
            <li><span><Glyph name="layers" /></span><div><strong>Ciclos e temas</strong><small>Rotina semanal com vários ciclos convivendo no mesmo calendário.</small></div></li>
            <li><span><Glyph name="book" /></span><div><strong>Diário de estudos</strong><small>Retome exatamente de onde parou, com salvamento automático.</small></div></li>
            <li><span><Glyph name="calendar" /></span><div><strong>Histórico e dashboard</strong><small>Planejado, realizado e pendências em uma leitura simples.</small></div></li>
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-brand"><span className="auth-brand-mark">F</span>fluxo<span className="auth-brand-dot">.</span></div>
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Entrar</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Criar conta</button>
          </div>

          <div className="auth-heading">
            <h2>{mode === "login" ? "Bem-vindo de volta" : "Crie seu ambiente de estudos"}</h2>
            <p>{mode === "login" ? "Entre para continuar de onde parou." : "Cada conta tem seus próprios temas, ciclos, tarefas e histórico."}</p>
          </div>

          <div
            className="auth-form"
            role="form"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          >
            {mode === "register" ? (
              <label className="auth-field">
                <span>Nome</span>
                <input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Como quer ser chamado?" autoComplete="name" autoFocus />
              </label>
            ) : null}
            <label className="auth-field">
              <span>E-mail</span>
              <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" autoComplete="email" autoFocus={mode === "login"} />
            </label>
            <label className="auth-field">
              <span>Senha</span>
              <div className="auth-password">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "register" ? "Mínimo de 8 caracteres" : "Sua senha"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
                <button type="button" onClick={() => setShowPassword((previous) => !previous)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                  <Glyph name={showPassword ? "eye-off" : "eye"} />
                </button>
              </div>
            </label>

            {error ? <p className="auth-error" role="alert">{error}</p> : null}

            <button type="button" className="auth-submit" disabled={busy} onClick={submit}>
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"} <Glyph name="arrow" />
            </button>
          </div>

          <div className="auth-divider"><span>ou</span></div>

          <button type="button" className="auth-demo" onClick={useDemo} disabled={busy}>
            <Glyph name="spark" /> Explorar com a conta de demonstração
          </button>
          <p className="auth-demo-hint">{DEMO_CREDENTIALS.email} · senha {DEMO_CREDENTIALS.password}</p>

          <p className="auth-footnote">Seus dados ficam isolados por conta. Nenhuma informação é compartilhada entre usuários.</p>
        </div>
      </section>
    </main>
  );
}
