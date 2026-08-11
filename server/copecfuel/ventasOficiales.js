import { consultarTransaccionesOficialesCopecFuel } from "../../api/copecfuel/client.js";

function texto(valor) {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function leerRuta(objeto, ruta) {
  return String(ruta)
    .split(".")
    .reduce(
      (actual, segmento) =>
        actual !== null && actual !== undefined ? actual[segmento] : undefined,
      objeto
    );
}

function primerValor(objeto, rutas) {
  for (const ruta of rutas) {
    const valor = leerRuta(objeto, ruta);

    if (valor !== null && valor !== undefined && texto(valor) !== "") {
      return valor;
    }
  }

  return null;
}

function primerTexto(objeto, rutas) {
  return texto(primerValor(objeto, rutas));
}

function primerNumero(objeto, rutas) {
  for (const ruta of rutas) {
    const valor = leerRuta(objeto, ruta);

    if (
      valor !== null &&
      valor !== undefined &&
      valor !== "" &&
      Number.isFinite(Number(valor))
    ) {
      return numero(valor);
    }
  }

  return 0;
}

function normalizarFecha(fecha) {
  const valor = texto(fecha);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const error = new Error("La fecha debe usar el formato AAAA-MM-DD.");
    error.status = 400;
    throw error;
  }

  const fechaUtc = new Date(`${valor}T00:00:00.000Z`);

  if (Number.isNaN(fechaUtc.getTime()) || fechaUtc.toISOString().slice(0, 10) !== valor) {
    const error = new Error("La fecha indicada no es valida.");
    error.status = 400;
    throw error;
  }

  return valor;
}

function codigoEdsDesdeTransaccion(fila) {
  const codigo = primerTexto(fila, [
    "codigoEds",
    "edsCodigo",
    "estacionCodigo",
    "ubicacionCodigo",
    "codigoEstacion",
    "eds.codigo",
    "estacion.codigo",
  ]);

  if (codigo) return codigo;

  const transaccionCodigo = primerTexto(fila, [
    "transaccionCodigo",
    "codigoTransaccion",
  ]);
  const coincidencia = transaccionCodigo.match(/^(\d{5})/);

  return coincidencia?.[1] || "";
}

function codigoEdsConfigurado() {
  const candidatos = [
    process.env.COPEC_FUEL_EDS_CODIGO,
    process.env.COPEC_EDS_CODIGO,
    process.env.COPEC_ID_EDS,
  ];

  return candidatos.map(texto).find((valor) => valor && valor !== "*") || "";
}

/**
 * Convierte cada transaccion oficial al mismo contrato de datos que ya usan
 * las conciliaciones. Se conserva el objeto original y solo se agregan alias
 * canonicos; asi los modulos actuales no dependen del Excel.
 */
export function normalizarVentaOficial(
  filaOriginal,
  fecha,
  codigoEds = "",
  categoriaForzada = ""
) {
  const fila = filaOriginal && typeof filaOriginal === "object" ? filaOriginal : {};
  const propina = primerNumero(fila, [
    "totalPropina",
    "propina",
    "montoPropina",
  ]);
  const descuento = primerNumero(fila, [
    "totalDescuentoPago",
    "descuento",
    "montoDescuento",
  ]);
  const totalPagoInformado = primerNumero(fila, [
    "totalMontoPagar",
    "totalMontoPagarManual",
    "totalMontoPago",
    "montoAutorizado",
    "totalPago",
  ]);
  const totalDocumentoInformado = primerNumero(fila, [
    "totalDocumento",
    "montoDocumento",
    "montoVenta",
  ]);
  const totalLineaInformado = primerNumero(fila, [
    "total",
    "productoTotal",
    "montoProducto",
    "importe",
  ]);
  const totalDocumento =
    totalDocumentoInformado ||
    Math.max(0, totalPagoInformado - propina + descuento) ||
    totalLineaInformado;
  const total = totalLineaInformado || totalDocumento;
  const totalMontoPagar =
    totalPagoInformado || Math.max(0, totalDocumento + propina - descuento);
  const clienteRut = primerTexto(fila, [
    "clienteRut",
    "rutEmisor",
    "emisorRut",
    "documentoEmisorRut",
    "empresa.rut",
  ]);
  const clienteRazonSocial = primerTexto(fila, [
    "clienteRazonSocial",
    "razonSocialEmisor",
    "emisorRazonSocial",
    "documentoEmisorRazonSocial",
    "empresa.razonSocial",
  ]);
  const rutClienteFinal = primerTexto(fila, [
    "clienteRutRut",
    "rutEmpresaReceptor",
    "rutCliente",
    "rut_cliente",
    "receptorRut",
    "empresaPagoRut",
    "cliente.rut",
    "clienteRut",
  ]);
  const razonSocialClienteFinal = primerTexto(fila, [
    "clienteRutRazonSocial",
    "razonSocialReceptor",
    "razonSocialCliente",
    "receptorRazonSocial",
    "empresaPagoRazonSocial",
    "cliente.razonSocial",
    "clienteRazonSocial",
  ]);
  const productoDescripcion = primerTexto(fila, [
    "productoDescripcion",
    "productoNombre",
    "producto",
    "combustibleNombre",
    "subproductoNombre",
    "articuloDescripcion",
  ]);

  return {
    ...fila,
    turnoId: primerValor(fila, ["turnoId"]) || fecha.replace(/-/g, ""),
    transaccionId: primerTexto(fila, [
      "transaccionId",
      "idTransaccion",
      "transaccionCodigo",
    ]),
    transaccionCodigo: primerTexto(fila, [
      "transaccionCodigo",
      "codigoTransaccion",
      "transaccionId",
    ]),
    codigoEds: codigoEdsDesdeTransaccion(fila) || codigoEds || null,
    fecha,
    formaPagoId: primerTexto(fila, [
      "formaPagoId",
      "medioPagoId",
      "pago.id",
    ]),
    formaPagoNombre: primerTexto(fila, [
      "formaPagoNombre",
      "formaPago",
      "medioPagoNombre",
      "medioPago",
      "pago.nombre",
    ]),
    clienteRut,
    clienteRazonSocial,
    clienteRutRut: rutClienteFinal,
    clienteRutRazonSocial: razonSocialClienteFinal,
    rutCliente: rutClienteFinal,
    razonSocialCliente: razonSocialClienteFinal,
    tipoDocumento: primerTexto(fila, [
      "tipoDocumento",
      "documentoTipo",
      "dteTipo",
    ]),
    descripcionDocumento: primerTexto(fila, [
      "descripcionDocumento",
      "documentoDescripcion",
      "dteDescripcion",
    ]),
    folio: primerTexto(fila, ["folio", "documentoFolio", "dteFolio"]),
    productoId: primerTexto(fila, [
      "productoId",
      "combustibleId",
      "subproductoId",
      "articuloId",
    ]),
    productoDescripcion,
    productoNombre: productoDescripcion,
    categoriaNombre:
      categoriaForzada ||
      primerTexto(fila, ["categoriaNombre", "categoria", "familiaNombre"]) ||
      "COMBUSTIBLE",
    cantidad: primerNumero(fila, [
      "cantidad",
      "litros",
      "volumen",
      "cantidadProducto",
    ]),
    total,
    totalDocumento,
    totalMontoPagar,
    totalMontoPago: totalMontoPagar,
    // Conserva si CopecFuel informo realmente un total financiero. Este dato
    // permite distinguirlo de un total reconstruido desde las lineas.
    totalMontoPagarInformado: totalPagoInformado || null,
    totalDocumentoInformado: totalDocumentoInformado || null,
    totalPropina: propina,
    montoVuelto: primerNumero(fila, ["montoVuelto", "vuelto"]),
    totalDescuentoPago: descuento,
    fuenteValepac:
      categoriaForzada === "PRODUCTO"
        ? "API_OFICIAL_VENTA_PRODUCTO"
        : "API_OFICIAL_VENTA_COMBUSTIBLE",
  };
}

function diagnosticarFilas(filas) {
  const conValor = (campo) =>
    filas.filter((fila) => {
      const valor = fila?.[campo];
      return typeof valor === "number" ? valor > 0 : texto(valor) !== "";
    }).length;

  return {
    transaccionesConId: conValor("transaccionId"),
    transaccionesConFormaPago: conValor("formaPagoNombre"),
    transaccionesConMonto: conValor("total"),
    transaccionesConProducto: conValor("productoDescripcion"),
    transaccionesConLitros: conValor("cantidad"),
    transaccionesConRutCliente: conValor("clienteRutRut"),
  };
}

export async function obtenerVentasOficialesCopecFuel(fechaSolicitada) {
  const fecha = normalizarFecha(fechaSolicitada);
  const turnoId = fecha.replace(/-/g, "");
  const tiposReporte = ["VENTA_COMBUSTIBLE", "VENTA_PRODUCTO"];
  let payload;

  try {
    payload = await consultarTransaccionesOficialesCopecFuel(
      turnoId,
      tiposReporte
    );
  } catch (error) {
    // Compatibilidad con versiones del servicio que aceptan el arreglo, pero
    // permiten solicitar un solo tipo de reporte por llamada.
    if (![400, 422].includes(error?.status)) throw error;

    payload = await consultarTransaccionesOficialesCopecFuel(turnoId, [
      "VENTA_COMBUSTIBLE",
    ]);
  }
  const datos = payload?.data || {};
  const reporteCombustible = datos.reporteCombustible;
  let reporteProducto =
    datos.reporteProducto ||
    datos.reporteProductos ||
    datos.reporteVentaProducto ||
    datos.ventaProducto;

  if (!Array.isArray(reporteCombustible)) {
    const error = new Error(
      "CopecFuel respondio sin data.reporteCombustible en la API oficial."
    );
    error.status = 502;
    error.payload = payload;
    throw error;
  }

  // Algunas versiones del endpoint aceptan ambos reportes en una solicitud;
  // otras devuelven solamente uno. En ese caso se consulta VENTA_PRODUCTO por
  // separado reutilizando el mismo token, sin iniciar otra sesion ni solicitar
  // una segunda validacion de equipo.
  if (!Array.isArray(reporteProducto)) {
    const payloadProducto = await consultarTransaccionesOficialesCopecFuel(
      turnoId,
      ["VENTA_PRODUCTO"]
    );
    const datosProducto = payloadProducto?.data || {};

    reporteProducto =
      datosProducto.reporteProducto ||
      datosProducto.reporteProductos ||
      datosProducto.reporteVentaProducto ||
      datosProducto.ventaProducto;

    if (!Array.isArray(reporteProducto)) {
      const arreglos = Object.values(datosProducto).filter(Array.isArray);

      if (arreglos.length === 1) reporteProducto = arreglos[0];
    }

    if (!Array.isArray(reporteProducto)) {
      const error = new Error(
        "CopecFuel respondio sin el arreglo de VENTA_PRODUCTO. Se conservaron los datos existentes."
      );
      error.status = 502;
      error.payload = payloadProducto;
      throw error;
    }
  }

  const codigoEds =
    [...reporteCombustible, ...reporteProducto]
      .map(codigoEdsDesdeTransaccion)
      .find(Boolean) || codigoEdsConfigurado();
  const filasCombustible = reporteCombustible.map((fila) =>
    normalizarVentaOficial(fila, fecha, codigoEds, "COMBUSTIBLE")
  );
  const filasProducto = reporteProducto.map((fila) =>
    normalizarVentaOficial(fila, fecha, codigoEds, "PRODUCTO")
  );
  const filas = [...filasCombustible, ...filasProducto];
  const diagnostico = diagnosticarFilas(filas);

  if (
    filas.length > 0 &&
    (diagnostico.transaccionesConId === 0 ||
      diagnostico.transaccionesConFormaPago === 0 ||
      diagnostico.transaccionesConMonto === 0)
  ) {
    const error = new Error(
      "La API oficial respondio, pero faltan identificadores, medios de pago o montos. No se reemplazaron datos existentes."
    );
    error.status = 502;
    error.diagnostico = diagnostico;
    throw error;
  }

  return {
    fecha,
    turnoId,
    clienteId: texto(process.env.COPEC_FUEL_CLIENTE_ID),
    codigoEds: codigoEds || null,
    filas,
    filasCombustible,
    filasProducto,
    cantidad: filas.length,
    cantidadCombustible: filasCombustible.length,
    cantidadProductos: filasProducto.length,
    diagnostico: {
      ...diagnostico,
      combustible: diagnosticarFilas(filasCombustible),
      productos: diagnosticarFilas(filasProducto),
    },
    estadoCopec: payload?.statusCode || null,
    mensajeCopec: payload?.userMessage || payload?.message || null,
  };
}
