import {
  requireAdminOrWorker,
  supabaseAdmin,
} from "../_lib/supabaseAdmin.js";
import {
  agruparReporteVentasCopecFuel,
  calcularPrecioDieselObservado,
} from "../../server/copecfuel/reporteVentas.js";
import { obtenerVentasOficialesCopecFuel } from "../../server/copecfuel/ventasOficiales.js";
import {
  adaptarVentaCopecFuel,
  guardarVentas,
  guardarVentasRecompra,
} from "../conciliacion/muevo-empresa.js";

function fechaChileActual() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valores = Object.fromEntries(
    partes
      .filter((parte) => parte.type !== "literal")
      .map((parte) => [parte.type, parte.value])
  );

  return `${valores.year}-${valores.month}-${valores.day}`;
}

function normalizarFecha(valor) {
  const texto = String(valor || "").trim();
  const soloDigitos = texto.replace(/\D/g, "");

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  if (soloDigitos.length >= 8) {
    return `${soloDigitos.slice(0, 4)}-${soloDigitos.slice(4, 6)}-${soloDigitos.slice(6, 8)}`;
  }

  return null;
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function normalizarNombreFormaPago(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Z]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function esFormaPagoConciliable(nombre) {
  return [
    "DEBITO",
    "CREDITO",
    "TARJETA DE DEBITO",
    "TARJETA DE CREDITO",
    "APP COPEC",
    "RUTPAY",
    "RUT PAY",
    "BILLETERA BANCO ESTADO",
  ].includes(normalizarNombreFormaPago(nombre));
}

async function guardarResumenDiario({
  fecha,
  codigoEds,
  clienteId,
  reporte,
  diagnostico,
  precioDieselObservado,
}) {
  const identificadorNuevo = [
    "api-oficial-venta-combustible-v1",
    clienteId || "sin-cliente",
    codigoEds || "sin-eds",
    fecha,
  ].join("|");
  let consultaExistente = supabaseAdmin
    .from("copecfuel_resumenes")
    .select("id, identificador_origen")
    .eq("fecha_desde", fecha)
    .eq("fecha_hasta", fecha)
    .order("sincronizado_en", { ascending: false })
    .limit(1);

  if (codigoEds) consultaExistente = consultaExistente.eq("codigo_eds", codigoEds);

  const { data: existentes, error: errorExistente } = await consultaExistente;

  if (errorExistente) {
    throw new Error(`No se pudo localizar el resumen diario: ${errorExistente.message}`);
  }

  const existente = existentes?.[0] || null;
  const identificadorOrigen = existente?.identificador_origen || identificadorNuevo;
  const registro = {
    identificador_origen: identificadorOrigen,
    ubicacion_id: clienteId || codigoEds || "API_OFICIAL",
    codigo_eds: codigoEds || null,
    direccion: null,
    rango_desde: `${fecha.replace(/-/g, "")}000000`,
    rango_hasta: `${fecha.replace(/-/g, "")}235959`,
    fecha_desde: fecha,
    fecha_hasta: fecha,
    cantidad_transacciones: reporte.cantidadTransacciones,
    monto_combustible: reporte.montoCombustible,
    monto_productos: reporte.montoProductos,
    monto_total: reporte.montoTotal,
    datos_origen: {
      fuente: "API_OFICIAL_VENTAS_COPECFUEL",
      reportes: ["VENTA_COMBUSTIBLE", "VENTA_PRODUCTO"],
      filasReporte: reporte.filasReporte,
      formasPago: reporte.formasPago,
      vueltosFormasPago: reporte.vueltosFormasPago,
      diagnostico,
      precioDieselObservado,
      reglaMonto:
        "Se suma la columna total de cada linea de venta. Las propinas se conservan separadas y se agregan al calcular la conciliacion.",
    },
    sincronizado_en: new Date().toISOString(),
  };
  let resumenGuardado;

  if (existente?.id) {
    const { data, error } = await supabaseAdmin
      .from("copecfuel_resumenes")
      .update(registro)
      .eq("id", existente.id)
      .select("id")
      .single();

    if (error) throw new Error(`No se pudo actualizar el resumen: ${error.message}`);
    resumenGuardado = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from("copecfuel_resumenes")
      .insert(registro)
      .select("id")
      .single();

    if (error) throw new Error(`No se pudo guardar el resumen: ${error.message}`);
    resumenGuardado = data;
  }

  const formas = reporte.formasPago.map((forma) => ({
    resumen_id: resumenGuardado.id,
    identificador_origen: `${identificadorOrigen}|${
      forma.formaPagoId || forma.nombre
    }`,
    forma_pago_id: forma.formaPagoId,
    nombre: forma.nombre,
    numero_ventas: forma.numeroVentas,
    monto: forma.monto,
    incluir_conciliacion: esFormaPagoConciliable(forma.nombre),
    datos_origen: {
      fuente: "API_OFICIAL_VENTAS_COPECFUEL",
      propina: forma.propina,
      montoVuelto: forma.vuelto,
      montoLineas: forma.montoLineas,
      montoTransacciones: forma.montoTransacciones,
      totalDocumento: forma.totalDocumento,
      totalPago: forma.totalPago,
      descuentos: forma.descuentos,
    },
    sincronizado_en: new Date().toISOString(),
  }));

  const { error: errorLimpieza } = await supabaseAdmin
    .from("copecfuel_formas_pago")
    .delete()
    .eq("resumen_id", resumenGuardado.id);

  if (errorLimpieza) {
    throw new Error(`No se pudo reemplazar el detalle de pagos: ${errorLimpieza.message}`);
  }

  if (formas.length > 0) {
    const { error } = await supabaseAdmin
      .from("copecfuel_formas_pago")
      .upsert(formas, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudieron guardar los medios de pago: ${error.message}`);
    }
  }

  return { resumenId: resumenGuardado.id, formas };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  if (!(await requireAdminOrWorker(request, response))) return;

  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  let sincronizacionId = null;

  try {
    const hoy = fechaChileActual();
    const desde = normalizarFecha(request.query.desde || hoy);
    const hasta = normalizarFecha(request.query.hasta || request.query.desde || hoy);

    if (!desde || !hasta || desde !== hasta) {
      return response.status(400).json({
        ok: false,
        error: "La API oficial procesa una fecha por solicitud.",
      });
    }

    const { data: sincronizacion, error: errorInicio } = await supabaseAdmin
      .from("sincronizaciones")
      .insert({
        integracion: "copecfuel_oficial",
        estado: "procesando",
        periodo: desde,
        mensaje:
          "Consultando VENTA_COMBUSTIBLE y VENTA_PRODUCTO en la API oficial.",
      })
      .select("id")
      .single();

    if (errorInicio) {
      throw new Error(`No se pudo iniciar la sincronizacion: ${errorInicio.message}`);
    }

    sincronizacionId = sincronizacion.id;

    const ventasOficiales = await obtenerVentasOficialesCopecFuel(desde);
    const filas = ventasOficiales.filas;
    const filasCombustible = ventasOficiales.filasCombustible;
    const reporte = agruparReporteVentasCopecFuel(filas);
    const precioDieselObservado = calcularPrecioDieselObservado(
      filasCombustible
    );
    const ubicacion = {
      codigo: ventasOficiales.codigoEds,
      ubicacionId: ventasOficiales.clienteId,
    };
    const filasMuevo = filasCombustible.map((fila) =>
      adaptarVentaCopecFuel(fila, desde, ubicacion)
    );
    const [resultadoMuevo, resultadoRecompra] = await Promise.all([
      guardarVentas(filasMuevo, {
        reemplazarFecha: desde,
        codigoEds: ventasOficiales.codigoEds,
        permitirVacio: true,
      }),
      guardarVentasRecompra(filasCombustible, {
        fecha: desde,
        reemplazarFecha: desde,
        codigoEds: ventasOficiales.codigoEds,
      }),
    ]);
    const { formas } = await guardarResumenDiario({
      fecha: desde,
      codigoEds: ventasOficiales.codigoEds,
      clienteId: ventasOficiales.clienteId,
      reporte,
      diagnostico: ventasOficiales.diagnostico,
      precioDieselObservado,
    });
    const formasConciliables = reporte.formasPago.filter((forma) =>
      esFormaPagoConciliable(forma.nombre)
    );
    const montoBrutoConciliable = formasConciliables.reduce(
      (total, forma) => total + numero(forma.monto),
      0
    );
    const propinasConciliables = formasConciliables.reduce(
      (total, forma) => total + numero(forma.propina),
      0
    );
    const vueltosConciliables = formasConciliables.reduce(
      (total, forma) => total + numero(forma.vuelto),
      0
    );
    const montoConciliable =
      montoBrutoConciliable + propinasConciliables;

    await supabaseAdmin
      .from("sincronizaciones")
      .update({
        estado: "completado",
        registros_encontrados: ventasOficiales.cantidad,
        registros_guardados:
          1 +
          formas.length +
          numero(resultadoMuevo.ventasGuardadas) +
          numero(resultadoRecompra.ventasRecompraGuardadas),
        mensaje:
          "Ventas de combustible y productos sincronizadas desde la API oficial CopecFuel.",
        finalizado_en: new Date().toISOString(),
      })
      .eq("id", sincronizacionId);

    return response.status(200).json({
      ok: true,
      mensaje:
        "CopecFuel, Muevo Empresa, Recompra, Coseducam y Conciliacion fueron alimentados desde la API oficial.",
      fuente: "API_OFICIAL_VENTAS_COPECFUEL",
      rango: { desde, hasta },
      turnoId: ventasOficiales.turnoId,
      estacion: ventasOficiales.codigoEds,
      cantidadTransacciones: reporte.cantidadTransacciones,
      filasReporte: reporte.filasReporte,
      filasCombustible: ventasOficiales.cantidadCombustible,
      filasProductos: ventasOficiales.cantidadProductos,
      montoTotal: reporte.montoTotal,
      formasPagoGuardadas: formas.length,
      diagnostico: ventasOficiales.diagnostico,
      precioDieselObservado,
      muevo: resultadoMuevo,
      recompra: resultadoRecompra,
      coseducam: {
        fuente: "recompra_ventas",
        actualizado: true,
      },
      conciliacion: {
        formasPago: formasConciliables.map((forma) => forma.nombre),
        cantidadVentas: formasConciliables.reduce(
          (total, forma) => total + numero(forma.numeroVentas),
          0
        ),
        montoBruto: montoBrutoConciliable,
        propinasIncluidas: propinasConciliables,
        vueltosADescontarDelAbono: vueltosConciliables,
        monto: montoConciliable,
      },
      fechaSincronizacion: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error sincronizando la API oficial CopecFuel:", error);

    if (sincronizacionId) {
      await supabaseAdmin
        .from("sincronizaciones")
        .update({
          estado: "error",
          mensaje: error instanceof Error ? error.message : "Error desconocido",
          finalizado_en: new Date().toISOString(),
        })
        .eq("id", sincronizacionId);
    }

    return response.status(error?.status || 500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible sincronizar la API oficial CopecFuel.",
      diagnostico: error?.diagnostico || null,
      statusCopec: error?.status || null,
      messageCopec:
        error?.payload?.userMessage || error?.payload?.message || null,
    });
  }
}
