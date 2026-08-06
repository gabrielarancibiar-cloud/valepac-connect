import { consultarCopecFuel } from "../../api/copecfuel/client.js";

const MAXIMO_PAGINAS = 100;

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function tieneValorNumerico(valor) {
  return valor !== null && valor !== undefined && valor !== "" &&
    Number.isFinite(Number(valor));
}

function primerNumero(fila, campos) {
  for (const campo of campos) {
    if (tieneValorNumerico(fila?.[campo])) return numero(fila[campo]);
  }

  return 0;
}

export function normalizarFormaPagoReporte(valor) {
  const nombre = String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Z]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

  if (nombre === "TARJETA DE DEBITO") return "DEBITO";
  if (nombre === "TARJETA DE CREDITO") return "CREDITO";
  if (nombre === "RUT PAY") return "RUTPAY";

  return nombre || "SIN IDENTIFICAR";
}

export function seleccionarUbicacionCopecFuel(sesion, ubicacionSolicitada) {
  const solicitada = String(ubicacionSolicitada || "").trim();

  if (solicitada) {
    return sesion.ubicaciones.find(
      (ubicacion) =>
        ubicacion.ubicacionId === solicitada || ubicacion.codigo === solicitada
    );
  }

  return (
    sesion.ubicaciones.find((ubicacion) => ubicacion.activa) ||
    sesion.ubicaciones[0]
  );
}

export async function obtenerReporteVentasCopecFuel({
  sesion,
  fecha,
  ubicacionId,
}) {
  const fechaIso = String(fecha || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) {
    const error = new Error("La fecha debe usar el formato AAAA-MM-DD.");
    error.status = 400;
    throw error;
  }

  const ubicacion = seleccionarUbicacionCopecFuel(sesion, ubicacionId);

  if (!ubicacion?.ubicacionId) {
    throw new Error("No se encontro una estacion disponible en CopecFuel.");
  }

  const filas = [];
  const clavesVisitadas = new Set();
  let ultimaClave = null;
  let paginasConsultadas = 0;

  do {
    const params = new URLSearchParams({
      cuentaId: sesion.cuentaId,
      clienteId: sesion.clienteId,
      turnoId: fechaIso.replace(/-/g, ""),
      ubicacionId: ubicacion.ubicacionId,
      tipoReporte: "EXCEL_VENTA",
    });

    if (ultimaClave) params.set("last_evaluated_key", ultimaClave);

    const payload = await consultarCopecFuel(
      `WEBRPT1/reportedias?${params.toString()}`,
      sesion
    );
    const data = payload?.data;

    if (!data || !Array.isArray(data.reporteExcel)) {
      throw new Error("CopecFuel no entrego el reporte Excel de ventas esperado.");
    }

    filas.push(...data.reporteExcel);
    paginasConsultadas += 1;

    const nuevaClave = data.last_evaluated_key
      ? String(data.last_evaluated_key)
      : "";

    if (!nuevaClave) {
      ultimaClave = null;
    } else if (clavesVisitadas.has(nuevaClave)) {
      throw new Error("CopecFuel repitio una pagina del reporte de ventas.");
    } else {
      clavesVisitadas.add(nuevaClave);
      ultimaClave = nuevaClave;
    }

    if (paginasConsultadas >= MAXIMO_PAGINAS && ultimaClave) {
      throw new Error("El reporte CopecFuel supero el limite de paginacion.");
    }
  } while (ultimaClave);

  return { filas, paginasConsultadas, ubicacion };
}

export function agruparReporteVentasCopecFuel(filas) {
  const transacciones = new Set();
  const ventasPorPago = new Map();
  let montoCombustible = 0;
  let montoProductos = 0;

  for (const [indice, fila] of filas.entries()) {
    const transaccionId = String(
      fila?.transaccionId || fila?.transaccionCodigo || `fila-${indice}`
    ).trim();
    const formaPagoId = String(fila?.formaPagoId || "").trim();
    const nombre = normalizarFormaPagoReporte(
      fila?.formaPagoNombre || fila?.formaPago
    );
    const clavePago = `${transaccionId}|${formaPagoId}|${nombre}`;
    const montoLinea = numero(fila?.total);
    const categoria = String(fila?.categoriaNombre || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

    transacciones.add(transaccionId);

    if (categoria.includes("COMBUSTIBLE")) montoCombustible += montoLinea;
    else montoProductos += montoLinea;

    const propina = numero(fila?.totalPropina);
    const descuento = numero(fila?.totalDescuentoPago ?? fila?.descuento);
    const totalPago = primerNumero(fila, [
      "totalMontoPagar",
      "totalMontoPagarManual",
      "totalMontoPago",
      "totalDocumento",
      "total",
    ]);
    const totalDocumento = primerNumero(fila, [
      "totalDocumento",
      "totalMontoPagar",
      "totalMontoPago",
      "total",
    ]);
    const monto = Math.max(0, totalPago - propina + descuento);
    const actual = ventasPorPago.get(clavePago);
    const candidato = {
      transaccionId,
      formaPagoId: formaPagoId || null,
      nombre,
      monto,
      propina,
      vuelto: numero(fila?.montoVuelto),
      totalDocumento,
      totalPago,
      descuento,
    };

    if (!actual) {
      ventasPorPago.set(clavePago, candidato);
    } else {
      // Las ventas con varios productos repiten sus totales financieros. Se
      // conserva el valor mayor para contar la transaccion una sola vez.
      actual.monto = Math.max(actual.monto, candidato.monto);
      actual.propina = Math.max(actual.propina, candidato.propina);
      actual.vuelto = Math.max(actual.vuelto, candidato.vuelto);
      actual.totalDocumento = Math.max(
        actual.totalDocumento,
        candidato.totalDocumento
      );
      actual.totalPago = Math.max(actual.totalPago, candidato.totalPago);
      actual.descuento = Math.max(actual.descuento, candidato.descuento);
    }
  }

  const formas = new Map();

  for (const venta of ventasPorPago.values()) {
    const clave = `${venta.formaPagoId || ""}|${venta.nombre}`;

    if (!formas.has(clave)) {
      formas.set(clave, {
        formaPagoId: venta.formaPagoId,
        nombre: venta.nombre,
        numeroVentas: 0,
        monto: 0,
        propina: 0,
        vuelto: 0,
        totalDocumento: 0,
        totalPago: 0,
        descuentos: 0,
      });
    }

    const forma = formas.get(clave);
    forma.numeroVentas += 1;
    forma.monto += venta.monto;
    forma.propina += venta.propina;
    forma.vuelto += venta.vuelto;
    forma.totalDocumento += venta.totalDocumento;
    forma.totalPago += venta.totalPago;
    forma.descuentos += venta.descuento;
  }

  const formasPago = [...formas.values()];

  return {
    cantidadTransacciones: transacciones.size,
    filasReporte: filas.length,
    montoCombustible,
    montoProductos,
    montoTotal: formasPago.reduce((total, forma) => total + forma.monto, 0),
    formasPago,
    vueltosFormasPago: formasPago
      .filter((forma) => forma.vuelto > 0)
      .map((forma) => ({ formaDePago: forma.nombre, monto: forma.vuelto })),
  };
}

