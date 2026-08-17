import { supabase } from "./supabase.js";

export async function apiFetch(recurso, opciones = {}) {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  if (error || !token) {
    const errorSesion = new Error("Debes iniciar sesión como administrador.");
    errorSesion.code = "ADMIN_AUTH_REQUIRED";
    throw errorSesion;
  }

  const headers = new Headers(opciones.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(recurso, { ...opciones, headers });
}

export async function verificarAdministrador() {
  const respuesta = await apiFetch(
    "/api/copecfuel/oficial?recurso=sesion",
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || "No fue posible validar los permisos administrativos."
    );
    error.status = respuesta.status;
    error.code = payload?.code || null;
    throw error;
  }

  return payload.administrador;
}

export async function verificarAccesoCoseducam() {
  const respuesta = await apiFetch(
    "/api/conciliacion/muevo-empresa?recurso=sesion_coseducam",
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || "No fue posible validar el acceso a Coseducam."
    );
    error.status = respuesta.status;
    error.code = payload?.code || null;
    throw error;
  }

  return payload.usuario;
}
