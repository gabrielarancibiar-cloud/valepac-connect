import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  consultarCopecFuel,
  obtenerSesionCopecFuel,
} from "./client.js";

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

  return `${valores.year}${valores.month}${valores.day}`;
}

function normalizarFecha(valor, finDelDia = false) {
  const soloDigitos = String(valor || "").replace(/\D/g, "");

  if (soloDigitos.length === 8) {
    return `${soloDigitos}${finDelDia ? "235959" : "000000"}`;
  }

  return soloDigitos.length === 14 ? soloDigitos : null;
}

function fechaSql(fechaCopecFuel) {
  return `${fechaCopecFuel.slice(0, 4)}-${fechaCopecFuel.slice(
    4,
    6
  )}-${fechaCopecFuel.slice(6, 8)}`;
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
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
  const nombreNormalizado = normalizarNombreFormaPago(nombre);

  return [
    "DEBITO",
    "CREDITO",
    "APP COPEC",
    "RUTPAY",
    "RUT PAY",
  ].includes(nombreNormalizado);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido.",
    });
  }

  let sincronizacionId = null;

  try {
    const hoy = fechaChileActual();
    const desde = normalizarFecha(request.query.desde || hoy, false);
    const hasta = normalizarFecha(request.query.hasta || hoy, true);

    if (!desde || !hasta || desde > hasta) {
      return response.status(400).json({
        ok: false,
        error: "El rango de fechas no es valido.",
      });
    }

    const { data: sincronizacion, error: errorInicio } = await supabaseAdmin
      .from("sincronizaciones")
      .insert({
        integracion: "copecfuel",
        estado: "procesando",
        periodo: `${fechaSql(desde)} a ${fechaSql(hasta)}`,
        mensaje: "Consultando ventas CopecFuel.",
      })
      .select("id")
      .single();

    if (errorInicio) {
      throw new Error(
        `No se pudo iniciar la sincronizacion: ${errorInicio.message}`
      );
    }

    sincronizacionId = sincronizacion.id;

    const sesion = await obtenerSesionCopecFuel();

    if (sesion.requiereCodigoEquipo || !sesion.maquinaActiva) {
      throw new Error(
        "CopecFuel requiere validar el equipo antes de sincronizar."
      );
    }

    const ubicacionSolicitada = String(request.query.ubicacionId || "");
    const ubicacion = ubicacionSolicitada
      ? sesion.ubicaciones.find(
          (item) => item.ubicacionId === ubicacionSolicitada
        )
      : sesion.ubicaciones.find((item) => item.activa) ||
        sesion.ubicaciones[0];

    if (!ubicacion?.ubicacionId) {
      throw new Error("No se encontro una estacion disponible.");
    }

    const params = new URLSearchParams({
      fechaHoraDesde: desde,
      fechaHoraHasta: hasta,
      ubicacionId: ubicacion.ubicacionId,
      clienteId: sesion.clienteId,
      cuentaId: sesion.cuentaId,
    });

    const payload = await consultarCopecFuel(
      `WEBRPT1/reporteturnofechahora?${params.toString()}`,
      sesion
    );

    const data = payload?.data || {};
    const todos = data.todos || {};
    const resumen = todos.resumen || {};
    const formasPagoOrigen = lista(
      todos?.resumenFormaDePago?.formasDePago ||
        todos?.resumenTurno?.resumenTurno?.formasDePago?.formasDePago
    );
    const formasPago = formasPagoOrigen.map((forma) => ({
      formaPagoId: forma.idFormasDePago
        ? String(forma.idFormasDePago)
        : null,
      nombre: String(forma.formaDePago || "Sin identificar"),
      numeroVentas:
        numero(forma.combustibleNVentas) + numero(forma.productoNVentas),
      monto: numero(forma.montoTotal ?? forma.totalPago),
      datosOrigen: forma,
    }));
    const cantidadTransacciones = formasPago.reduce(
      (total, forma) => total + forma.numeroVentas,
      0
    );
    const identificadorResumen = [
      ubicacion.ubicacionId,
      desde,
      hasta,
    ].join("|");
    const registroResumen = {
      identificador_origen: identificadorResumen,
      ubicacion_id: ubicacion.ubicacionId,
      codigo_eds: ubicacion.codigo || null,
      direccion: ubicacion.direccion || null,
      rango_desde: desde,
      rango_hasta: hasta,
      fecha_desde: fechaSql(desde),
      fecha_hasta: fechaSql(hasta),
      cantidad_transacciones: cantidadTransacciones,
      monto_combustible: numero(resumen.montoCombustible),
      monto_productos: numero(resumen.montoProductos),
      monto_total: numero(resumen.montoTotal),
      datos_origen: {
        resumen,
        formasPago: formasPagoOrigen,
      },
      sincronizado_en: new Date().toISOString(),
    };

    const { data: resumenGuardado, error: errorResumen } =
      await supabaseAdmin
        .from("copecfuel_resumenes")
        .upsert(registroResumen, {
          onConflict: "identificador_origen",
        })
        .select("id")
        .single();

    if (errorResumen) {
      throw new Error(
        `No se pudo guardar el resumen: ${errorResumen.message}`
      );
    }

    const registrosFormasPago = formasPago.map((forma) => ({
      resumen_id: resumenGuardado.id,
      identificador_origen: `${identificadorResumen}|${
        forma.formaPagoId || forma.nombre
      }`,
      forma_pago_id: forma.formaPagoId,
      nombre: forma.nombre,
      numero_ventas: forma.numeroVentas,
      monto: forma.monto,
      incluir_conciliacion: esFormaPagoConciliable(forma.nombre),
      datos_origen: forma.datosOrigen,
      sincronizado_en: new Date().toISOString(),
    }));

    const formasConciliables = formasPago.filter((forma) =>
      esFormaPagoConciliable(forma.nombre)
    );
    const ventasConciliables = formasConciliables.reduce(
      (total, forma) => total + forma.numeroVentas,
      0
    );
    const montoConciliable = formasConciliables.reduce(
      (total, forma) => total + forma.monto,
      0
    );

    if (registrosFormasPago.length > 0) {
      const { error: errorFormas } = await supabaseAdmin
        .from("copecfuel_formas_pago")
        .upsert(registrosFormasPago, {
          onConflict: "identificador_origen",
        });

      if (errorFormas) {
        throw new Error(
          `No se pudieron guardar los medios de pago: ${errorFormas.message}`
        );
      }
    }

    await supabaseAdmin
      .from("sincronizaciones")
      .update({
        estado: "completado",
        registros_encontrados: cantidadTransacciones,
        registros_guardados: 1 + registrosFormasPago.length,
        mensaje: "Ventas CopecFuel sincronizadas correctamente.",
        finalizado_en: new Date().toISOString(),
      })
      .eq("id", sincronizacionId);

    return response.status(200).json({
      ok: true,
      mensaje: "Ventas CopecFuel sincronizadas correctamente.",
      rango: { desde, hasta },
      estacion: ubicacion.codigo || ubicacion.ubicacionId,
      cantidadTransacciones,
      montoTotal: registroResumen.monto_total,
      formasPagoGuardadas: registrosFormasPago.length,
      conciliacion: {
        formasPago: formasConciliables.map((forma) => forma.nombre),
        cantidadVentas: ventasConciliables,
        monto: montoConciliable,
      },
      fechaSincronizacion: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error sincronizando CopecFuel:", error);

    if (sincronizacionId) {
      await supabaseAdmin
        .from("sincronizaciones")
        .update({
          estado: "error",
          mensaje:
            error instanceof Error ? error.message : "Error desconocido",
          finalizado_en: new Date().toISOString(),
        })
        .eq("id", sincronizacionId);
    }

    return response.status(error?.status || 500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible sincronizar CopecFuel.",
    });
  }
}
