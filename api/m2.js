import { createClient } from "@supabase/supabase-js";
import { requireAdmin, supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { guardarVentasM2, obtenerM2Mensual } from "../server/m2/margen.js";
import { obtenerVentasOficialesCopecFuel } from "../server/copecfuel/ventasOficiales.js";

function fechaValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
}

function periodoValido(valor) {
  return /^\d{4}-\d{2}$/.test(String(valor || ""));
}

function dataLakeAdmin() {
  const url = String(process.env.DATA_LAKE_SUPABASE_URL || "").trim();
  const key = String(process.env.DATA_LAKE_SUPABASE_SECRET_KEY || "").trim();
  if (!url || !key) {
    const error = new Error("Faltan DATA_LAKE_SUPABASE_URL o DATA_LAKE_SUPABASE_SECRET_KEY en Vercel.");
    error.status = 503;
    throw error;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
  const hasta = periodo === hoy.slice(0, 7) ? hoy : (periodo < hoy.slice(0, 7) ? rango.hasta : null);
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

async function obtenerResumenDataLake(desde, hasta) {
  const dias = diasEntre(desde, hasta);
  if (!dias || dias > 31) {
    const error = new Error("El rango Data Lake debe ser válido y de máximo 31 días.");
    error.status = 400;
    throw error;
  }

  const cliente = dataLakeAdmin();
  const [resumen, archivos] = await Promise.all([
    cliente
      .from("m2_resumen_diario")
      .select("fecha,producto,tipo_venta,segmento,litros,litros_con_costo,transacciones,m2_neto,m2_promedio,actualizado_en")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true }),
    cliente
      .from("raw_archivos")
      .select("fecha,fuente,cantidad_registros,tamano_json_bytes,tamano_comprimido_bytes,procesado,procesado_en,capturado_en")
      .eq("fuente", "COPECFUEL_VENTA_COMBUSTIBLE")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true }),
  ]);

  if (resumen.error) throw new Error(`Data Lake resumen: ${resumen.error.message}`);
  if (archivos.error) throw new Error(`Data Lake archivos: ${archivos.error.message}`);

  return {
    desde,
    hasta,
    filas: Array.isArray(resumen.data) ? resumen.data : [],
    archivos: Array.isArray(archivos.data) ? archivos.data : [],
  };
}

function claveResumen(fila) {
  return `${fila.fecha}|${fila.producto}|${fila.tipo_venta}|${fila.segmento}`;
}

function resumirDetalleLegacy(detalle, filtroFechas = null) {
  const mapa = new Map();
  const permitidas = filtroFechas ? new Set(filtroFechas) : null;
  for (const item of detalle || []) {
    if (permitidas && !permitidas.has(item.fecha)) continue;
    const segmento = item.segmentoCliente === "TAXI_AMIGO" ? "TAXI_AMIGO" : "NORMAL";
    const base = {
      fecha: item.fecha,
      producto: item.producto,
      tipo_venta: item.tipoVenta,
      segmento,
    };
    const clave = claveResumen(base);
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        ...base,
        litros: 0,
        litros_con_costo: 0,
        transaccionesSet: new Set(),
        m2_neto: 0,
      });
    }
    const fila = mapa.get(clave);
    const l = Number(item.litros || 0);
    fila.litros += l;
    if (item.m2Litro != null && item.precioCosto != null) fila.litros_con_costo += l;
    fila.m2_neto += Number(item.m2Neto || 0);
    if (item.transaccionId != null) fila.transaccionesSet.add(String(item.transaccionId));
  }
  return [...mapa.values()].map((fila) => ({
    fecha: fila.fecha,
    producto: fila.producto,
    tipo_venta: fila.tipo_venta,
    segmento: fila.segmento,
    litros: fila.litros,
    litros_con_costo: fila.litros_con_costo,
    transacciones: fila.transaccionesSet.size,
    m2_neto: fila.m2_neto,
    m2_promedio: fila.litros_con_costo > 0 ? fila.m2_neto / fila.litros_con_costo : 0,
  }));
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

function compararResumenes(filasLegacy, filasLake, archivos = []) {
  const a = new Map((filasLegacy || []).map((x) => [claveResumen(x), x]));
  const b = new Map((filasLake || []).map((x) => [claveResumen(x), x]));
  const fechas = [...new Set([...(filasLegacy || []).map((x) => x.fecha), ...(filasLake || []).map((x) => x.fecha)])].sort();
  const archivoPorFecha = new Map((archivos || []).map((x) => [x.fecha, x]));
  return fechas.map((fecha) => {
    const claves = [...new Set([...a.keys(), ...b.keys()].filter((k) => k.startsWith(`${fecha}|`)))];
    let maxDiferenciaLitros = 0;
    let maxDiferenciaM2 = 0;
    for (const clave of claves) {
      const x = a.get(clave) || {};
      const y = b.get(clave) || {};
      maxDiferenciaLitros = Math.max(maxDiferenciaLitros, Math.abs(Number(y.litros || 0) - Number(x.litros || 0)));
      maxDiferenciaM2 = Math.max(maxDiferenciaM2, Math.abs(Number(y.m2_neto || 0) - Number(x.m2_neto || 0)));
    }
    return {
      fecha,
      maxDiferenciaLitros,
      maxDiferenciaM2,
      coincide: maxDiferenciaLitros < 0.001 && maxDiferenciaM2 < 1,
      archivo: archivoPorFecha.get(fecha) || null,
    };
  });
}

async function obtenerM2Produccion(periodo) {
  const rango = rangoPeriodo(periodo);
  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  let lake;
  try {
    lake = await obtenerResumenDataLake(rango.desde, rango.hasta);
  } catch (error) {
    const legacy = await obtenerM2Mensual(periodo);
    return {
      ...legacy,
      fuenteDatos: "LEGACY_FALLBACK",
      fuenteDetalle: `Data Lake no disponible: ${error.message}`,
      diasDataLake: 0,
      diasLegacy: legacy.dias?.length || 0,
    };
  }

  const procesadas = new Set((lake.archivos || []).filter((x) => x.procesado).map((x) => x.fecha));
  const esperadas = fechasEsperadas(periodo);
  const faltantes = esperadas.filter((fecha) => !procesadas.has(fecha));

  if (faltantes.length === 0) {
    return construirRespuestaDesdeResumen(periodo, lake.filas, {
      fuenteDatos: "DATA_LAKE",
      fuenteDetalle: "M2 servido desde m2_resumen_diario.",
      diasDataLake: procesadas.size,
      diasLegacy: 0,
    });
  }

  const legacy = await obtenerM2Mensual(periodo);
  const legacyFaltantes = resumirDetalleLegacy(legacy.detalle, faltantes);
  const filasLakeCubiertas = (lake.filas || []).filter((x) => procesadas.has(x.fecha));
  const combinadas = [...filasLakeCubiertas, ...legacyFaltantes];
  return construirRespuestaDesdeResumen(periodo, combinadas, {
    fuenteDatos: procesadas.size > 0 ? "HIBRIDA" : "LEGACY_FALLBACK",
    fuenteDetalle: procesadas.size > 0
      ? `Data Lake para ${procesadas.size} día(s); respaldo m2_ventas para ${faltantes.length} día(s) aún no procesados.`
      : "Data Lake sin días procesados; usando m2_ventas como respaldo.",
    diasDataLake: procesadas.size,
    diasLegacy: faltantes.length,
  });
}

async function validarDataLakeRango(desde, hasta) {
  const dias = diasEntre(desde, hasta);
  if (!dias || dias > 31) {
    const error = new Error("El rango de validación debe ser válido y de máximo 31 días.");
    error.status = 400;
    throw error;
  }
  if (desde.slice(0, 7) !== hasta.slice(0, 7)) {
    const error = new Error("La validación temporal debe mantenerse dentro de un mismo mes.");
    error.status = 400;
    throw error;
  }
  const periodo = desde.slice(0, 7);
  const [legacy, lake] = await Promise.all([
    obtenerM2Mensual(periodo),
    obtenerResumenDataLake(desde, hasta),
  ]);
  const legacyResumen = resumirDetalleLegacy(legacy.detalle, Array.from({ length: dias }, (_, i) => {
    const d = new Date(`${desde}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  }));
  const comparacion = compararResumenes(legacyResumen, lake.filas, lake.archivos);
  return {
    desde,
    hasta,
    dias: comparacion,
    ok: comparacion.length > 0 && comparacion.every((x) => x.coincide),
  };
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
      if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Método no permitido." });
      const fecha = String(request.body?.fecha || request.query.fecha || "").trim();
      const resultado = await backfillM2Dia(fecha);
      return response.status(200).json({ ok: true, ...resultado });
    }

    if (recurso === "datalake-resumen") {
      if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Método no permitido." });
      const desde = String(request.query.desde || "").trim();
      const hasta = String(request.query.hasta || "").trim();
      const resultado = await obtenerResumenDataLake(desde, hasta);
      return response.status(200).json({ ok: true, ...resultado });
    }

    if (recurso === "datalake-validacion") {
      if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Método no permitido." });
      const desde = String(request.query.desde || "").trim();
      const hasta = String(request.query.hasta || "").trim();
      const resultado = await validarDataLakeRango(desde, hasta);
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
