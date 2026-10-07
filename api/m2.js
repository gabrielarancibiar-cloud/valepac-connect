import { requireAdmin, supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { guardarVentasM2, obtenerM2Mensual } from "../server/m2/margen.js";
import { obtenerVentasOficialesCopecFuel } from "../server/copecfuel/ventasOficiales.js";

function fechaValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
}


async function backfillM2Dia(fecha) {
  if (!fechaValida(fecha)) {
    const e = new Error("La fecha de backfill no es válida.");
    e.status = 400;
    throw e;
  }

  const ventasOficiales = await obtenerVentasOficialesCopecFuel(fecha, {
    soloCombustible: true,
  });

  const resultado = await guardarVentasM2(ventasOficiales.filasCombustible, {
    fecha,
    reemplazarFecha: fecha,
    codigoEds: ventasOficiales.codigoEds || "40098",
  });

  return {
    fecha,
    estacion: ventasOficiales.codigoEds || "40098",
    turnoId: ventasOficiales.turnoId,
    filasCombustible: ventasOficiales.cantidadCombustible,
    ...resultado,
  };
}

function mensajeError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "No fue posible procesar M2.";
  }
}

async function listarCostosBlueMax() {
  const { data, error } = await supabaseAdmin
    .from("m2_bluemax_costos")
    .select("id,codigo_eds,fecha_vigencia,precio_costo,observacion,creado_en,actualizado_en")
    .eq("codigo_eds", "40098")
    .order("fecha_vigencia", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los costos BlueMax: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

async function guardarCostoBlueMax(body) {
  const fecha = String(body?.fechaVigencia || "").trim();
  const precio = Number(body?.precioCosto);
  const observacion = String(body?.observacion || "").trim() || null;
  if (!fechaValida(fecha)) {
    const e = new Error("La fecha de vigencia no es válida."); e.status = 400; throw e;
  }
  if (!Number.isFinite(precio) || precio <= 0) {
    const e = new Error("El precio costo BlueMax debe ser mayor a cero."); e.status = 400; throw e;
  }
  const { data, error } = await supabaseAdmin
    .from("m2_bluemax_costos")
    .upsert({
      codigo_eds: "40098",
      fecha_vigencia: fecha,
      precio_costo: precio,
      observacion,
      actualizado_en: new Date().toISOString(),
    }, { onConflict: "codigo_eds,fecha_vigencia" })
    .select("id,codigo_eds,fecha_vigencia,precio_costo,observacion,creado_en,actualizado_en")
    .single();
  if (error) throw new Error(`No se pudo guardar el costo BlueMax: ${error.message}`);
  return data;
}

async function eliminarCostoBlueMax(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) {
    const e = new Error("Identificador de costo BlueMax inválido."); e.status = 400; throw e;
  }
  const { error } = await supabaseAdmin
    .from("m2_bluemax_costos")
    .delete()
    .eq("id", numero)
    .eq("codigo_eds", "40098");
  if (error) throw new Error(`No se pudo eliminar el costo BlueMax: ${error.message}`);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (!(await requireAdmin(request, response))) return;

  try {
    const recurso = String(request.query.recurso || "").trim();

    if (recurso === "backfill") {
      if (request.method !== "POST") {
        return response.status(405).json({ ok: false, error: "Método no permitido." });
      }
      const fecha = String(request.body?.fecha || request.query.fecha || "").trim();
      const resultado = await backfillM2Dia(fecha);
      return response.status(200).json({ ok: true, ...resultado });
    }

    if (recurso === "bluemax-costos") {
      if (request.method === "GET") {
        return response.status(200).json({ ok: true, costos: await listarCostosBlueMax() });
      }
      if (request.method === "POST") {
        const costo = await guardarCostoBlueMax(request.body || {});
        return response.status(200).json({ ok: true, costo, costos: await listarCostosBlueMax() });
      }
      if (request.method === "DELETE") {
        await eliminarCostoBlueMax(request.query.id);
        return response.status(200).json({ ok: true, costos: await listarCostosBlueMax() });
      }
      return response.status(405).json({ ok: false, error: "Método no permitido." });
    }

    if (request.method !== "GET") {
      return response.status(405).json({ ok: false, error: "Método no permitido." });
    }

    const periodo = String(request.query.periodo || "").trim();
    const resultado = await obtenerM2Mensual(periodo);
    return response.status(200).json({ ok: true, ...resultado });
  } catch (error) {
    return response.status(error?.status || 500).json({
      ok: false,
      error: mensajeError(error),
    });
  }
}
