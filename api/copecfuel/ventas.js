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

  if (soloDigitos.length === 14) {
    return soloDigitos;
  }

  return null;
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function limpiarTransaccion(transaccion) {
  return {
    transaccionId: transaccion?.transaccionId || null,
    transaccionCodigo:
      transaccion?.transaccionCodigo || transaccion?.transaccionCode || null,
    fechaCierre:
      transaccion?.transaccionFechaCierre || transaccion?.fechaVenta || null,
    turnoId: transaccion?.turnoId || null,
    formaPago: transaccion?.formaPagoNombre || transaccion?.formaPago || null,
    producto:
      transaccion?.productoDescripcion || transaccion?.producto || null,
    cantidad: numero(transaccion?.cantidad || transaccion?.volumen),
    total: numero(
      transaccion?.totalMontoPago ??
        transaccion?.totalMontoPagar ??
        transaccion?.total ??
        transaccion?.monto
    ),
    folio: transaccion?.folio || null,
    tipoDocumento: transaccion?.tipoDocumento || null,
    operacionTipo: transaccion?.operacionTipo || null,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido. Usa GET.",
    });
  }

  try {
    const hoy = fechaChileActual();
    const desde = normalizarFecha(request.query.desde || hoy, false);
    const hasta = normalizarFecha(request.query.hasta || hoy, true);

    if (!desde || !hasta) {
      return response.status(400).json({
        ok: false,
        error:
          "Las fechas deben usar YYYY-MM-DD, YYYYMMDD o YYYYMMDDHHmmss.",
      });
    }

    if (desde > hasta) {
      return response.status(400).json({
        ok: false,
        error: "La fecha desde no puede ser posterior a la fecha hasta.",
      });
    }

    const sesion = await obtenerSesionCopecFuel();

    if (sesion.requiereCodigoEquipo || !sesion.maquinaActiva) {
      return response.status(409).json({
        ok: false,
        error: "CopecFuel requiere validar el equipo antes de consultar ventas.",
      });
    }

    const ubicacionSolicitada = String(request.query.ubicacionId || "");
    const ubicacion = ubicacionSolicitada
      ? sesion.ubicaciones.find(
          (item) => item.ubicacionId === ubicacionSolicitada
        )
      : sesion.ubicaciones.find((item) => item.activa) ||
        sesion.ubicaciones[0];

    if (!ubicacion?.ubicacionId) {
      throw new Error("No se encontro una estacion disponible en CopecFuel.");
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
    const transaccionesExcel = lista(todos.reporteExcel);
    const ventasCombustible = lista(
      todos?.ventaCombustible?.ventaCombustible
    );
    const transacciones =
      transaccionesExcel.length > 0
        ? transaccionesExcel
        : ventasCombustible;
    const formasPago = lista(
      todos?.resumenFormaDePago?.formasDePago ||
        todos?.resumenTurno?.resumenTurno?.formasDePago?.formasDePago
    ).map((forma) => ({
      id: forma.idFormasDePago || null,
      nombre: forma.formaDePago || null,
      numeroVentas:
        numero(forma.combustibleNVentas) + numero(forma.productoNVentas),
      monto: numero(forma.montoTotal ?? forma.totalPago),
    }));

    const montoCalculado = transacciones.reduce(
      (total, transaccion) => total + limpiarTransaccion(transaccion).total,
      0
    );
    const cantidadCalculada = formasPago.reduce(
      (total, forma) => total + forma.numeroVentas,
      0
    );

    return response.status(200).json({
      ok: true,
      mensaje: "Ventas CopecFuel obtenidas correctamente.",
      rango: { desde, hasta },
      estacion: {
        ubicacionId: ubicacion.ubicacionId,
        codigo: ubicacion.codigo,
        direccion: ubicacion.direccion,
      },
      resumen: {
        fechaInicial: resumen.fechaInicial || null,
        fechaFinal: resumen.fechaFinal || null,
        cantidadTransacciones:
          transacciones.length || cantidadCalculada,
        montoCombustible: numero(resumen.montoCombustible),
        montoProductos: numero(resumen.montoProductos),
        montoTotal: numero(resumen.montoTotal) || montoCalculado,
      },
      formasPago,
      ultimasTransacciones: transacciones
        .slice(-20)
        .reverse()
        .map(limpiarTransaccion),
      fechaConsulta: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error consultando ventas CopecFuel:", error);

    return response.status(error?.status || 500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible consultar las ventas CopecFuel.",
    });
  }
}
