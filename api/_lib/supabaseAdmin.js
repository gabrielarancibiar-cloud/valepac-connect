import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel."
  );
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },

    global: {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
      },
    },
  }
);

function obtenerBearer(request) {
  const authorization = String(request.headers?.authorization || "").trim();
  const coincidencia = authorization.match(/^Bearer\s+(.+)$/i);
  return coincidencia?.[1]?.trim() || "";
}

function correosAdministradores() {
  return new Set(
    String(process.env.VALEPAC_ADMIN_EMAILS || "")
      .split(",")
      .map((correo) => correo.trim().toLowerCase())
      .filter(Boolean)
  );
}

function correosOperadoresCoseducam() {
  return new Set(
    String(process.env.VALEPAC_COSEDUCAM_EMAILS || "")
      .split(",")
      .map((correo) => correo.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function requireAdmin(request, response) {
  const token = obtenerBearer(request);

  if (!token) {
    response.status(401).json({
      ok: false,
      code: "ADMIN_AUTH_REQUIRED",
      error: "Debes iniciar sesión como administrador.",
    });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const usuario = data?.user;

  if (error || !usuario?.email) {
    response.status(401).json({
      ok: false,
      code: "ADMIN_SESSION_INVALID",
      error: "La sesión administrativa venció o no es válida.",
    });
    return null;
  }

  const permitidos = correosAdministradores();

  if (permitidos.size === 0) {
    response.status(500).json({
      ok: false,
      code: "ADMIN_NOT_CONFIGURED",
      error: "Falta configurar VALEPAC_ADMIN_EMAILS en Vercel.",
    });
    return null;
  }

  if (!permitidos.has(usuario.email.toLowerCase())) {
    response.status(403).json({
      ok: false,
      code: "ADMIN_FORBIDDEN",
      error: "Esta cuenta no tiene permisos de administrador.",
    });
    return null;
  }

  return usuario;
}

export async function requireCoseducam(request, response) {
  const token = obtenerBearer(request);

  if (!token) {
    response.status(401).json({
      ok: false,
      code: "COSEDUCAM_AUTH_REQUIRED",
      error: "Debes iniciar sesión para operar Coseducam.",
    });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const usuario = data?.user;

  if (error || !usuario?.email) {
    response.status(401).json({
      ok: false,
      code: "COSEDUCAM_SESSION_INVALID",
      error: "La sesión venció o no es válida.",
    });
    return null;
  }

  const email = usuario.email.toLowerCase();
  const administradores = correosAdministradores();
  const operadores = correosOperadoresCoseducam();

  if (administradores.has(email)) {
    return { usuario, rol: "administrador" };
  }

  if (operadores.has(email)) {
    return { usuario, rol: "operador_coseducam" };
  }

  response.status(403).json({
    ok: false,
    code: "COSEDUCAM_FORBIDDEN",
    error: "Esta cuenta no está autorizada para operar Coseducam.",
  });
  return null;
}
