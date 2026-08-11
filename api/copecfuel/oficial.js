import { requireAdmin } from "../_lib/supabaseAdmin.js";
import { obtenerVentasOficialesCopecFuel } from "../../server/copecfuel/ventasOficiales.js";

function fechaValida(valor) {
  const texto = String(valor || "").trim();
  const coincidencia = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!coincidencia) return null;

  const fecha = new Date(
    Date.UTC(
      Number(coincidencia[1]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[3])
    )
  );

  return fecha.toISOString().slice(0, 10) === texto ? texto : null;
}

function camposDisponibles(transacciones) {
  const campos = new Set();

  for (const transaccion of transacciones) {
    if (!transaccion || typeof transaccion !== "object") continue;
    Object.keys(transaccion).forEach((campo) => campos.add(campo));
  }

  return [...campos].sort((a, b) => a.localeCompare(b, "es"));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  const administrador = await requireAdmin(request, response);

  if (!administrador) return;

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido. Usa GET.",
    });
  }

  const recurso = String(request.query?.recurso || "transacciones").trim();

  if (recurso === "sesion") {
    return response.status(200).json({
      ok: true,
      administrador: {
        id: administrador.id,
        email: administrador.email,
      },
    });
  }

  if (recurso !== "transacciones") {
    return response.status(400).json({
      ok: false,
      error: "Recurso no disponible. Por ahora usa transacciones.",
    });
  }

  const fecha = fechaValida(request.query?.fecha);

  if (!fecha) {
    return response.status(400).json({
      ok: false,
      error: "La fecha debe ser real y usar el formato AAAA-MM-DD.",
    });
  }

  const turnoId = fecha.replace(/-/g, "");
  const inspeccionar = String(request.query?.inspeccionar || "") === "1";

  try {
    const ventas = await obtenerVentasOficialesCopecFuel(fecha);
    const reporte = ventas.filas;

    const resultado = {
      ok: true,
      fuente: "API_OFICIAL",
      reportes: ["VENTA_COMBUSTIBLE", "VENTA_PRODUCTO"],
      fecha,
      turnoId,
      cantidad: reporte.length,
      cantidadCombustible: ventas.cantidadCombustible,
      cantidadProductos: ventas.cantidadProductos,
      camposDisponibles: camposDisponibles(reporte),
      estadoCopec: ventas.estadoCopec,
      mensajeCopec: ventas.mensajeCopec,
      fechaConsulta: new Date().toISOString(),
    };

    return response.status(200).json({
      ...resultado,
      transacciones: reporte,
      ...(inspeccionar ? { diagnostico: ventas.diagnostico } : {}),
    });
  } catch (error) {
    console.error("Error consultando API oficial CopecFuel:", error);

    const faltaConfiguracion = /COPEC_FUEL_/i.test(error?.message || "");
    const esTimeout = /30 segundos|no respondio/i.test(error?.message || "");
    const estadoRespuesta = faltaConfiguracion
      ? 500
      : esTimeout
        ? 504
        : error?.status === 400
          ? 400
          : 502;

    return response.status(estadoRespuesta).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible consultar la API oficial de CopecFuel.",
      statusCopec: error?.status || null,
      messageCopec:
        error?.payload?.userMessage ||
        error?.payload?.message ||
        (error instanceof Error ? error.message : null),
      ...(inspeccionar && error?.payload
        ? { respuestaCopec: error.payload }
        : {}),
    });
  }
}
