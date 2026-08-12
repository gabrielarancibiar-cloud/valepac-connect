function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
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

export function calcularPrecioDieselObservado(filas) {
  const frecuencias = new Map();

  for (const fila of filas || []) {
    const producto = normalizarFormaPagoReporte(
      fila?.productoDescripcion || fila?.productoNombre
    );
    const operacion = normalizarFormaPagoReporte(fila?.operacionTipo);
    const precio = numero(fila?.precio);
    const litros = numero(fila?.cantidad);
    const monto = numero(fila?.total);

    if (
      !producto.includes("DIESEL") ||
      operacion !== "ASISTIDO" ||
      precio <= 0 ||
      litros <= 0 ||
      monto <= 0
    ) {
      continue;
    }

    const clave = String(precio);
    const actual = frecuencias.get(clave) || {
      precio,
      repeticiones: 0,
      litros: 0,
    };
    actual.repeticiones += 1;
    actual.litros += litros;
    frecuencias.set(clave, actual);
  }

  const candidatos = [...frecuencias.values()].sort(
    (a, b) =>
      b.repeticiones - a.repeticiones ||
      b.litros - a.litros ||
      b.precio - a.precio
  );

  return candidatos[0]
    ? {
        ...candidatos[0],
        preciosDistintos: candidatos.length,
        transaccionesRevisadas: candidatos.reduce(
          (total, candidato) => total + candidato.repeticiones,
          0
        ),
        criterio:
          "Moda del precio Diesel en ventas asistidas con litros y total mayores que cero.",
      }
    : null;
}

export function agruparReporteVentasCopecFuel(filas) {
  const transacciones = new Set();
  const ventasPorPago = new Map();
  const montosLineasPorForma = new Map();
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
    // Combustible y productos pueden informar IDs internos de pago distintos
    // para una misma transaccion. La identidad financiera estable es la
    // transaccion mas el nombre normalizado del medio de pago. Se conservan
    // todas las lineas porque la API distribuye venta y propina por linea.
    const clavePago = `${transaccionId}|${nombre}`;
    const claveForma = nombre;
    const montoLinea = numero(fila?.total);
    const categoria = String(fila?.categoriaNombre || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

    transacciones.add(transaccionId);
    montosLineasPorForma.set(
      claveForma,
      numero(montosLineasPorForma.get(claveForma)) + montoLinea
    );

    if (categoria.includes("COMBUSTIBLE")) montoCombustible += montoLinea;
    else montoProductos += montoLinea;

    const propina = numero(fila?.totalPropina);
    const descuento = numero(fila?.totalDescuentoPago ?? fila?.descuento);
    const totalPago = numero(fila?.totalMontoPagar);
    const totalDocumento = numero(fila?.totalDocumento);
    // La API oficial expone el valor de la venta en `total` y la propina en
    // `totalPropina`. La conciliacion suma ambos conceptos mas adelante. No se
    // reemplaza `total` por montoAutorizado porque ese campo puede representar
    // solo una parte de la operacion o venir en cero.
    const monto = montoLinea;
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
      // Una transaccion puede contener combustible y productos, o mas de un
      // producto. Cada fila aporta su `total` y su `totalPropina`. Ambos se
      // suman por linea: para el 10-08-2026 esta regla reproduce exactamente
      // el abono del Portal Copec ($51.891.422) en los medios conciliables.
      actual.monto += candidato.monto;
      if (!actual.formaPagoId && candidato.formaPagoId) {
        actual.formaPagoId = candidato.formaPagoId;
      }
      actual.propina += candidato.propina;
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
    const clave = venta.nombre;

    if (!formas.has(clave)) {
      formas.set(clave, {
        formaPagoId: venta.formaPagoId,
        nombre: venta.nombre,
        numeroVentas: 0,
        monto: 0,
        montoLineas: numero(montosLineasPorForma.get(clave)),
        montoTransacciones: 0,
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
    forma.montoTransacciones += venta.monto;
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
