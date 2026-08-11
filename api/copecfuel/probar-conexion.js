import {
  iniciarSesionCopecFuel,
  obtenerSesionCopecFuel,
} from "./client.js";
import { requireAdmin } from "../_lib/supabaseAdmin.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!(await requireAdmin(request, response))) return;

  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido.",
    });
  }

  try {
    const forzarNuevaSesion =
      request.query?.forzar === "1" || request.body?.forzar === true;
    const sesion = forzarNuevaSesion
      ? await iniciarSesionCopecFuel()
      : await obtenerSesionCopecFuel();

    return response.status(200).json({
      ok: true,
      mensaje: sesion.requiereCodigoEquipo
        ? "Credenciales correctas, pero CopecFuel solicita validar este equipo."
        : "Conexion con CopecFuel realizada correctamente.",
      conectado:
        sesion.usuarioActivo &&
        sesion.maquinaActiva &&
        !sesion.requiereCambioPassword,
      usuarioActivo: sesion.usuarioActivo,
      equipoActivo: sesion.maquinaActiva,
      requiereCodigoEquipo: sesion.requiereCodigoEquipo,
      requiereCambioPassword: sesion.requiereCambioPassword,
      cuentaId: sesion.cuentaId || null,
      clienteId: sesion.clienteId || null,
      ubicaciones: sesion.ubicaciones,
      tokenObtenido: Boolean(sesion.token),
    });
  } catch (error) {
    console.error("Error probando CopecFuel:", error);

    return response.status(error?.status || 500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible conectar con CopecFuel.",
    });
  }
}
