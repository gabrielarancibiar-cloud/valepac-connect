import { requireAdmin, supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { sincronizarM2LakeDia } from "../server/m2Lake/sync.js";

function fechaValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
}

function periodoValido(valor) {
  return /^\d{4}-\d{2}$/.test(String(valor || ""));
}

function diasEntre(desde, hasta) {
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return null;
  const inicio = new Date(`${desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`);
  return Math.floor((fin - inicio) / 86400000) + 1;
}

function rangoPeriodo(periodo) {
  if (!periodoValido(periodo)) return null;
  const [anio, mes] = periodo.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimo).padStart(2, "0")}` };
}

function fechaChileHoy() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function fechasEsperadas(periodo) {
  const rango = rangoPeriodo(periodo);
  if (!rango) return [];
  const hoy = fechaChileHoy();
  const mesHoy = hoy.slice(0, 7);
  const hasta = periodo === mesHoy ? hoy : (periodo < mesHoy ? rango.hasta : null);
  if (!hasta) return [];

  const fechas = [];
  let cursor = new Date(`${rango.desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`);
  while (cursor <= fin) {
    fechas.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return fechas;
}

async function obtenerResumenOperacional(desde, hasta) {
  const dias = diasEntre(desde, hasta);
  if (!dias || dias > 31) {
    const error = new Error("El rango M2 debe ser válido y de máximo 31 días.");
    error.status = 400;
    throw error;
  }

  const [resumen, estados] = await Promise.all([
    supabaseAdmin
      .from("m2_resumen_diario")
      .select("fecha,producto,tipo_venta,segmento,litros,litros_con_costo,transacciones,m2_neto,m2_promedio,actualizado_en")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true }),
    supabaseAdmin
      .from("m2_estado_diario")
      .select("fecha,estado,cantidad_registros,filas_resumen,tamano_json_bytes,tamano_comprimido_bytes,capturado_en,procesado_en,actualizado_en")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true }),
  ]);

  if (resumen.error) throw new Error(`M2 resumen: ${resumen.error.message}`);
  if (estados.error) throw new Error(`M2 estado diario: ${estados.error.message}`);

  return {
    desde,
    hasta,
    filas: Array.isArray(resumen.data) ? resumen.data : [],
    estados: Array.isArray(estados.data) ? estados.data : [],
  };
}

function acumulador(extra = {}) {
  return { ...extra, litros: 0, litrosConCosto: 0, transacciones: 0, m2Neto: 0, lineasSinCosto: 0 };
}

function sumarAcumulador(acc, fila) {
  const l = Number(fila.litros || 0);
  const lc = Number(fila.litros_con_costo ?? l);
  acc.litros += l;
  acc.litrosConCosto += lc;
  acc.transacciones += Number(fila.transacciones || 0);
  acc.m2Neto += Number(fila.m2_neto || 0);
  if (lc + 0.000001 < l) acc.lineasSinCosto += 1;
}

function cerrarAcumulador(acc) {
  return {
    ...acc,
    m2Litro: acc.litrosConCosto > 0 ? acc.m2Neto / acc.litrosConCosto : 0,
  };
}

function construirRespuestaDesdeResumen(periodo, filas, meta = {}) {
  const rango = rangoPeriodo(periodo);
  const resumen = acumulador();
  const categorias = new Map();
  const productos = new Map();
  const dias = new Map();
  const diasProductos = new Map();

  const detalle = (filas || []).map((fila) => {
    const item = {
      fecha: fila.fecha,
      producto: fila.producto,
      litros: Number(fila.litros || 0),
      litrosConCosto: Number(fila.litros_con_costo ?? fila.litros ?? 0),
      transacciones: Number(fila.transacciones || 0),
      m2Neto: Number(fila.m2_neto || 0),
      m2Litro: Number(fila.m2_promedio || 0),
      precioCosto: 0,
      tipoVenta: fila.tipo_venta,
      segmentoCliente: fila.segmento === "TAXI_AMIGO" ? "TAXI_AMIGO" : "NORMAL",
      lineasSinCosto: Number(fila.litros_con_costo ?? fila.litros ?? 0) + 0.000001 < Number(fila.litros || 0) ? 1 : 0,
      esResumenDataLake: true,
    };

    sumarAcumulador(resumen, fila);

    const cKey = `${item.tipoVenta}|${item.segmentoCliente}`;
    if (!categorias.has(cKey)) categorias.set(cKey, acumulador({ tipoVenta: item.tipoVenta, segmentoCliente: item.segmentoCliente }));
    sumarAcumulador(categorias.get(cKey), fila);

    const pKey = `${item.producto}|${item.tipoVenta}|${item.segmentoCliente}`;
    if (!productos.has(pKey)) productos.set(pKey, acumulador({ producto: item.producto, tipoVenta: item.tipoVenta, segmentoCliente: item.segmentoCliente }));
    sumarAcumulador(productos.get(pKey), fila);

    if (!dias.has(item.fecha)) dias.set(item.fecha, acumulador({ fecha: item.fecha }));
    sumarAcumulador(dias.get(item.fecha), fila);

    const dpKey = `${item.fecha}|${item.producto}`;
    if (!diasProductos.has(dpKey)) diasProductos.set(dpKey, acumulador({ fecha: item.fecha, producto: item.producto }));
    sumarAcumulador(diasProductos.get(dpKey), fila);

    return item;
  });

  return {
    rango,
    formula: "((precio_venta - precio_costo) / 1.19) * litros",
    resumen: cerrarAcumulador(resumen),
    categorias: [...categorias.values()].map(cerrarAcumulador),
    productos: [...productos.values()].map(cerrarAcumulador),
    dias: [...dias.values()].map(cerrarAcumulador).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    diasProductos: [...diasProductos.values()].map(cerrarAcumulador).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.producto.localeCompare(b.producto)),
    detalle,
    ...meta,
  };
}

async function obtenerM2Produccion(periodo) {
  const rango = rangoPeriodo(periodo);
  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const datos = await obtenerResumenOperacional(rango.desde, rango.hasta);
  const procesadas = new Set(
    (datos.estados || [])
      .filter((x) => String(x.estado || "").toUpperCase() === "PROCESADO")
      .map((x) => x.fecha)
  );
  const esperadas = fechasEsperadas(periodo);
  const faltantes = esperadas.filter((fecha) => !procesadas.has(fecha));
  const filasProcesadas = (datos.filas || []).filter((x) => procesadas.has(x.fecha));

  return construirRespuestaDesdeResumen(periodo, filasProcesadas, {
    fuenteDatos: "M2_LAKE",
    fuenteDetalle: faltantes.length
      ? `M2 Lake activo. Faltan ${faltantes.length} día(s) por archivar/procesar.`
      : "M2 Lake activo y al día.",
    arquitectura: "Resumen operativo en Supabase VALEPAC Connect · JSON histórico comprimido en Supabase Data Lake.",
    diasDataLake: procesadas.size,
    diasFaltantes: faltantes,
    estados: datos.estados,
  });
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
    const error = new Error("La fecha de vigencia no es válida.");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(precio) || precio <= 0) {
    const error = new Error("El precio costo BlueMax debe ser mayor a cero.");
    error.status = 400;
    throw error;
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
    const error = new Error("Identificador de costo BlueMax inválido.");
    error.status = 400;
    throw error;
  }

  const { error } = await supabaseAdmin
    .from("m2_bluemax_costos")
    .delete()
    .eq("id", numero)
    .eq("codigo_eds", "40098");
  if (error) throw new Error(`No se pudo eliminar el costo BlueMax: ${error.message}`);
}

function mensajeError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "No fue posible procesar M2."; }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (!(await requireAdmin(request, response))) return;

  try {
    const recurso = String(request.query.recurso || "").trim();

    if (recurso === "lake-sync") {
      if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Método no permitido." });
      const fecha = String(request.body?.fecha || request.query.fecha || "").trim();
      const resultado = await sincronizarM2LakeDia(fecha);
      return response.status(200).json({ ok: true, ...resultado });
    }

    if (recurso === "bluemax-costos") {
      if (request.method === "GET") return response.status(200).json({ ok: true, costos: await listarCostosBlueMax() });
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

    if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Método no permitido." });

    const periodo = String(request.query.periodo || "").trim();
    const resultado = await obtenerM2Produccion(periodo);
    return response.status(200).json({ ok: true, ...resultado });
  } catch (error) {
    return response.status(error?.status || 500).json({ ok: false, error: mensajeError(error) });
  }
}
