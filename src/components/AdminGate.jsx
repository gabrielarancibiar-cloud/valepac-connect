import { useCallback, useEffect, useState } from "react";
import { LockKeyhole, LogIn, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { verificarAdministrador } from "../lib/api.js";

export default function AdminGate({
  children,
  nombreAplicacion = "VALEPAC Connect",
  subtituloAplicacion = "Acceso administrativo",
  tituloLogin = "Iniciar sesión",
  descripcionLogin = "Ingresa con la cuenta administradora autorizada.",
}) {
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [administrador, setAdministrador] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const comprobarSesion = useCallback(async (sesion) => {
    if (!sesion?.access_token) {
      setAdministrador(null);
      setCargando(false);
      return;
    }

    try {
      const admin = await verificarAdministrador();
      setAdministrador(admin);
      setError("");
    } catch (errorValidacion) {
      setAdministrador(null);
      setError(
        errorValidacion.message ||
          "La cuenta no tiene permisos para administrar VALEPAC Connect."
      );
      await supabase.auth.signOut();
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let activo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (activo) comprobarSesion(data?.session);
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (evento, sesion) => {
        if (!activo) return;

        if (evento === "SIGNED_OUT") {
          setAdministrador(null);
          setCargando(false);
          return;
        }

        if (evento === "SIGNED_IN" || evento === "TOKEN_REFRESHED") {
          window.setTimeout(() => {
            if (activo) comprobarSesion(sesion);
          }, 0);
        }
      }
    );

    return () => {
      activo = false;
      suscripcion?.subscription?.unsubscribe();
    };
  }, [comprobarSesion]);

  const iniciarSesion = async (evento) => {
    evento.preventDefault();
    setProcesando(true);
    setError("");

    try {
      const { data, error: errorLogin } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (errorLogin) throw errorLogin;
      await comprobarSesion(data?.session);
      setPassword("");
    } catch (errorLogin) {
      setError(
        /invalid login credentials/i.test(errorLogin?.message || "")
          ? "Correo o contraseña incorrectos."
          : errorLogin?.message || "No fue posible iniciar sesión."
      );
    } finally {
      setProcesando(false);
    }
  };

  const cerrarSesion = async () => {
    setProcesando(true);
    await supabase.auth.signOut();
    setAdministrador(null);
    setProcesando(false);
  };

  if (cargando) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-loading">
          <RefreshCw className="spin" size={28} />
          <strong>Validando sesión administrativa…</strong>
        </section>
      </main>
    );
  }

  if (!administrador) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">V</div>
            <div>
              <strong>{nombreAplicacion}</strong>
              <span>{subtituloAplicacion}</span>
            </div>
          </div>
          <div className="auth-heading">
            <LockKeyhole size={28} />
            <div>
              <h1>{tituloLogin}</h1>
              <p>{descripcionLogin}</p>
            </div>
          </div>

          {error ? (
            <div className="feedback error-feedback" role="alert">
              {error}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={iniciarSesion}>
            <label>
              <span>Correo</span>
              <input
                type="email"
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
                autoComplete="username"
                disabled={procesando}
                required
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(evento) => setPassword(evento.target.value)}
                autoComplete="current-password"
                disabled={procesando}
                required
              />
            </label>
            <button
              type="submit"
              className="primary-button button-with-icon"
              disabled={procesando}
            >
              {procesando ? (
                <RefreshCw className="spin" size={16} />
              ) : (
                <LogIn size={16} />
              )}
              {procesando ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return children({ administrador, cerrarSesion, procesando });
}
