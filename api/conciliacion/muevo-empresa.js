import { requireAdmin, supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  iniciarSesionCopec,
  obtenerTokenCopecActual,
} from "../copec/login.js";
import { obtenerVentasOficialesCopecFuel } from "../../server/copecfuel/ventasOficiales.js";

const TAMANO_PAGINA = 1000;
const RUT_COPEC = "995200007";
const RUT_COSEDUCAM = "969636301";
const RUT_COSEDUCAM_SIN_DV = "96963630";
const TCT_TAE_BASE_URL = "https://tct-tae-api.copec.cl/tct-tae";
const ENRUTA_BASE_URL = "https://enrutacopec.cl";
const FORMAS_PAGO = new Set([
  "EFECTIVO",
  "CREDITO",
  "DEBITO",
  "TARJETA DE CREDITO",
  "TARJETA DE DEBITO",
]);
const FORMAS_PAGO_RECOMPRA = new Set([
  "APP COPEC EMPRESA",
  "CUPON ELECTRONICO",
  "MOVIMIENTO BODEGA",
  "TARJETA FFAA",
  "TCT",
  "TCT MANUAL",
  "STORAGE",
]);
const FORMAS_PAGO_COPEC_RECOMPRA = new Set([
  "DINERO",
  "EFECTIVO",
  "CREDITO",
  "DEBITO",
  "TARJETA DE CREDITO",
  "TARJETA DE DEBITO",
]);

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Z]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizarRut(valor) {
  return String(valor || "")
    .replace(/[^0-9K]/gi, "")
    .toUpperCase();
}

function esRazonSocialCopec(valor) {
  const razonSocial = normalizarTexto(valor);

  return (
    razonSocial === "COPEC S A" ||
    razonSocial === "COPEC SA" ||
    razonSocial.endsWith(" COPEC S A") ||
    razonSocial.endsWith(" COPEC SA")
  );
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function numeroChile(valor) {
  if (typeof valor === "number") return numero(valor);

  const texto = String(valor || "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const resultado = Number(texto);
  return Number.isFinite(resultado) ? resultado : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarFecha(valor) {
  const texto = String(valor || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

  const coincidencia = texto.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s|$)/);
  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`
    : null;
}

function fechaChilena(valor) {
  const fecha = normalizarFecha(valor);
  return fecha ? fecha.split("-").reverse().join("-") : "";
}

function clasificarProductoEnRuta(valor) {
  const producto = normalizarTexto(valor);

  if (["D", "DIESEL", "PETROLEO DIESEL"].includes(producto)) return "DIESEL";
  if (["93", "G93", "GAS 93", "GASOLINA 93"].includes(producto)) {
    return "GASOLINA 93";
  }
  if (["95", "G95", "GAS 95", "GASOLINA 95"].includes(producto)) {
    return "GASOLINA 95";
  }
  if (["97", "G97", "GAS 97", "GASOLINA 97"].includes(producto)) {
    return "GASOLINA 97";
  }

  return null;
}

function clasificarProductoRecompra(valor) {
  const producto = normalizarTexto(valor);

  if (!producto || producto.includes("BLUEMAX") || producto.includes("BLUE MAX")) {
    return null;
  }

  if (producto.includes("DIESEL")) return "DIESEL";

  for (const octanaje of ["93", "95", "97"]) {
    if (
      new RegExp(`(^| )${octanaje}( |$)`).test(producto) &&
      (producto.includes("GAS") || producto.includes("GASOLINA"))
    ) {
      return `GASOLINA ${octanaje}`;
    }
  }

  return null;
}

function rangoMes(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);

  if (mes < 1 || mes > 12) return null;

  const diasMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const hoyChile = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const dias =
    periodo === hoyChile.slice(0, 7)
      ? Math.min(diasMes, Number(hoyChile.slice(8, 10)))
      : diasMes;
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(dias).padStart(2, "0")}`;
  const fechas = Array.from({ length: dias }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  );

  return { desde, hasta, fechas };
}

async function leerTabla(tabla, campos, desde, hasta) {
  const registros = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from(tabla)
      .select(campos)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    }

    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina);

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  return registros;
}

function agruparPorFecha(registros) {
  return registros.reduce((grupos, registro) => {
    if (!grupos.has(registro.fecha)) grupos.set(registro.fecha, []);
    grupos.get(registro.fecha).push(registro);
    return grupos;
  }, new Map());
}

async function obtenerMes(periodo) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [ventas, cargos] = await Promise.all([
    leerTabla(
      "muevo_empresa_ventas",
      "fecha, codigo_eds, transaccion_id, forma_pago, monto, datos_origen",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "muevo_empresa_cargos",
      "fecha, codigo_eds, descripcion, referencia, monto",
      rango.desde,
      rango.hasta
    ),
  ]);
  const ventasPorFecha = agruparPorFecha(ventas);
  const cargosPorFecha = agruparPorFecha(cargos);
  const dias = rango.fechas.map((fecha) => {
    const ventasDia = ventasPorFecha.get(fecha) || [];
    const cargosDia = cargosPorFecha.get(fecha) || [];
    const montoVentas = ventasDia.reduce(
      (total, registro) => total + numero(registro.monto),
      0
    );
    const propinasVentas = ventasDia.reduce(
      (total, registro) =>
        total + numero(registro.datos_origen?.propina),
      0
    );
    const montoVentasBruto = ventasDia.reduce(
      (total, registro) =>
        total +
        numero(
          registro.datos_origen?.montoBruto ??
            numero(registro.monto) + numero(registro.datos_origen?.propina)
        ),
      0
    );
    const montoCargos = cargosDia.reduce(
      (total, registro) => total + numero(registro.monto),
      0
    );
    const diferencia = montoCargos - montoVentas;
    let estado = "diferencia";

    if (montoVentas === 0 && montoCargos === 0) estado = "sin_datos";
    else if (montoVentas === 0) estado = "sin_ventas";
    else if (montoCargos === 0) estado = "sin_cargos";
    else if (diferencia === 0) estado = "conciliado";

    const formasPago = ventasDia.reduce((grupos, venta) => {
      const nombre = normalizarTexto(venta.forma_pago);

      if (!grupos[nombre]) grupos[nombre] = { cantidad: 0, monto: 0 };
      grupos[nombre].cantidad += 1;
      grupos[nombre].monto += numero(venta.monto);
      return grupos;
    }, {});

    return {
      fecha,
      estado,
      ventas: {
        cantidad: ventasDia.length,
        montoBruto: montoVentasBruto,
        propinas: propinasVentas,
        monto: montoVentas,
        formasPago,
      },
      cargos: {
        cantidad: cargosDia.length,
        monto: montoCargos,
      },
      diferencia,
    };
  });
  const resumen = dias.reduce(
    (total, dia) => {
      total.diasConciliados += dia.estado === "conciliado" ? 1 : 0;
      total.diasConDiferencia += dia.estado === "diferencia" ? 1 : 0;
      total.diasPendientes +=
        ["sin_ventas", "sin_cargos"].includes(dia.estado) ? 1 : 0;
      total.cantidadVentas += dia.ventas.cantidad;
      total.montoVentasBruto += dia.ventas.montoBruto;
      total.descuentoPropinas += dia.ventas.propinas;
      total.montoVentas += dia.ventas.monto;
      total.cantidadCargos += dia.cargos.cantidad;
      total.montoCargos += dia.cargos.monto;
      total.diferencia += dia.diferencia;
      return total;
    },
    {
      diasConciliados: 0,
      diasConDiferencia: 0,
      diasPendientes: 0,
      cantidadVentas: 0,
      montoVentasBruto: 0,
      descuentoPropinas: 0,
      montoVentas: 0,
      cantidadCargos: 0,
      montoCargos: 0,
      diferencia: 0,
    }
  );

  return { rango: { desde: rango.desde, hasta: rango.hasta }, resumen, dias };
}

function esAbonoRecompra(movimiento) {
  const datos = movimiento?.datos_origen || {};
  const contenido = normalizarTexto(
    [
      movimiento?.descripcion,
      movimiento?.tipo_movimiento,
      movimiento?.referencia,
      JSON.stringify(datos),
    ].join(" ")
  );

  return numero(movimiento?.monto) > 0 && contenido.includes("RECOMPRA");
}

async function leerAbonosRecompra(desde, hasta) {
  const registros = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("copec_movimientos")
      .select(
        "id, fecha_movimiento, descripcion, referencia, tipo_movimiento, monto, id_eds, datos_origen"
      )
      .gte("fecha_movimiento", desde)
      .lte("fecha_movimiento", hasta)
      .order("fecha_movimiento", { ascending: true })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(`No se pudieron leer los abonos Recompra: ${error.message}`);
    }

    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina.filter(esAbonoRecompra));

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  return registros.map((registro) => ({
    ...registro,
    fecha: registro.fecha_movimiento,
  }));
}

async function leerPreciosCosto(hasta) {
  const { data, error } = await supabaseAdmin
    .from("copec_precios_costo")
    .select(
      "codigo_eds, fecha_vigencia, localidad, gas_93sp, gas_95sp, gas_97sp, diesel_pdua1"
    )
    .lte("fecha_vigencia", hasta)
    .order("fecha_vigencia", { ascending: true });

  if (error) {
    throw new Error(`No se pudieron leer los precios costo: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function leerAjustesRecompra(desde, hasta) {
  return leerTabla(
    "recompra_ajustes",
    "id, identificador_origen, fecha, codigo_eds, tipo, producto, litros, referencia, descripcion, fuente",
    desde,
    hasta
  );
}

function campoPrecioProducto(producto) {
  const nombre = normalizarTexto(producto);

  if (nombre === "GASOLINA 93") return "gas_93sp";
  if (nombre === "GASOLINA 95") return "gas_95sp";
  if (nombre === "GASOLINA 97") return "gas_97sp";
  if (nombre === "DIESEL") return "diesel_pdua1";
  return null;
}

function precioVigenteParaVenta(venta, precios) {
  const campo = campoPrecioProducto(venta.producto);

  if (!campo) return null;

  const vigente = precios
    .filter(
      (precio) =>
        String(precio.codigo_eds || "") === String(venta.codigo_eds || "") &&
        precio.fecha_vigencia <= venta.fecha
    )
    .at(-1);
  const valor = numero(vigente?.[campo]);

  return vigente && valor > 0
    ? {
        valor,
        fechaVigencia: vigente.fecha_vigencia,
        localidad: vigente.localidad,
      }
    : null;
}

function diaAnterior(fecha) {
  const valor = new Date(`${fecha}T12:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() - 1);
  return valor.toISOString().slice(0, 10);
}

function prepararHistorialPrecios(precios) {
  return precios
    .map((precio, indice) => ({
      codigoEds: precio.codigo_eds,
      localidad: precio.localidad,
      vigenteDesde: precio.fecha_vigencia,
      vigenteHasta: precios[indice + 1]
        ? diaAnterior(precios[indice + 1].fecha_vigencia)
        : null,
      gas93: numero(precio.gas_93sp),
      gas95: numero(precio.gas_95sp),
      gas97: numero(precio.gas_97sp),
      diesel: numero(precio.diesel_pdua1),
    }))
    .reverse()
    .slice(0, 30);
}

async function obtenerMesRecompra(periodo) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [ventas, abonos, precios, ajustes] = await Promise.all([
    leerTabla(
      "recompra_ventas",
      "fecha, codigo_eds, transaccion_id, forma_pago, producto, cantidad, monto",
      rango.desde,
      rango.hasta
    ),
    leerAbonosRecompra(rango.desde, rango.hasta),
    leerPreciosCosto(rango.hasta),
    leerAjustesRecompra(rango.desde, rango.hasta),
  ]);
  const ventasPorFecha = agruparPorFecha(ventas);
  const abonosPorFecha = agruparPorFecha(abonos);
  const ajustesPorFecha = agruparPorFecha(ajustes);
  const dias = rango.fechas.map((fecha) => {
    const ventasDia = ventasPorFecha.get(fecha) || [];
    const abonosDia = abonosPorFecha.get(fecha) || [];
    const ajustesDia = ajustesPorFecha.get(fecha) || [];
    const transacciones = new Set(
      ventasDia.map((venta) => String(venta.transaccion_id || ""))
    );
    const montoVentaReferencia = ventasDia.reduce(
      (total, venta) => total + numero(venta.monto),
      0
    );
    const productosBase = new Map();

    for (const venta of ventasDia) {
      const producto = String(venta.producto || "Sin identificar");
      const actual = productosBase.get(producto) || {
        producto,
        codigoEds: venta.codigo_eds,
        litrosBase: 0,
        lineas: 0,
      };
      actual.litrosBase += numero(venta.cantidad);
      actual.lineas += 1;
      productosBase.set(producto, actual);
    }

    const ajustesProducto = new Map();

    for (const ajuste of ajustesDia) {
      const producto = String(ajuste.producto || "DIESEL");
      const actual = ajustesProducto.get(producto) || {
        codigoEds: ajuste.codigo_eds,
        volumenPropio: 0,
        fluctuacionMesa: 0,
        tctTaeManual: 0,
      };
      const litrosAjuste = numero(ajuste.litros);

      if (ajuste.tipo === "volumen_propio") {
        actual.volumenPropio += litrosAjuste;
      } else if (ajuste.tipo === "fluctuacion_mesa") {
        actual.fluctuacionMesa += litrosAjuste;
      } else if (ajuste.tipo === "tct_tae_manual") {
        actual.tctTaeManual += litrosAjuste;
      }

      ajustesProducto.set(producto, actual);
    }

    const nombresProducto = new Set([
      ...productosBase.keys(),
      ...ajustesProducto.keys(),
    ]);
    const detallesCosto = [...nombresProducto].map((producto) => {
      const base = productosBase.get(producto) || {};
      const ajuste = ajustesProducto.get(producto) || {};
      const codigoEds =
        base.codigoEds ||
        ajuste.codigoEds ||
        process.env.COPEC_EDS_PRECIOS ||
        process.env.COPEC_ID_EDS ||
        "40098";
      const litrosBase = numero(base.litrosBase);
      const volumenPropio = numero(ajuste.volumenPropio);
      const fluctuacionMesa = numero(ajuste.fluctuacionMesa);
      const tctTaeManual = numero(ajuste.tctTaeManual);
      const litrosNetos =
        litrosBase - volumenPropio + fluctuacionMesa + tctTaeManual;
      const precio = precioVigenteParaVenta(
        { fecha, codigo_eds: codigoEds, producto },
        precios
      );
      const costoExacto = precio ? litrosNetos * precio.valor : 0;

      return {
        producto,
        codigoEds,
        lineas: numero(base.lineas),
        litrosBase,
        volumenPropio,
        fluctuacionMesa,
        tctTaeManual,
        litrosNetos,
        precio,
        costoExacto,
      };
    });
    const litrosBase = detallesCosto.reduce(
      (total, detalle) => total + detalle.litrosBase,
      0
    );
    const volumenPropio = detallesCosto.reduce(
      (total, detalle) => total + detalle.volumenPropio,
      0
    );
    const fluctuacionMesa = detallesCosto.reduce(
      (total, detalle) => total + detalle.fluctuacionMesa,
      0
    );
    const tctTaeManual = detallesCosto.reduce(
      (total, detalle) => total + detalle.tctTaeManual,
      0
    );
    const litros = detallesCosto.reduce(
      (total, detalle) => total + detalle.litrosNetos,
      0
    );
    const costoExacto = detallesCosto.reduce(
      (total, detalle) => total + detalle.costoExacto,
      0
    );
    const costoVentas = Math.round(costoExacto);
    const lineasSinPrecio = detallesCosto.filter(
      (detalle) => Math.abs(detalle.litrosNetos) > 0 && !detalle.precio
    ).length;
    const montoAbonos = abonosDia.reduce(
      (total, abono) => total + numero(abono.monto),
      0
    );
    const diferencia = montoAbonos - costoVentas;
    let estado = "diferencia";

    if (ventasDia.length > 0 && lineasSinPrecio > 0) estado = "sin_precio";
    else if (costoVentas === 0 && montoAbonos === 0) estado = "sin_datos";
    else if (costoVentas === 0) estado = "sin_ventas";
    else if (montoAbonos === 0) estado = "sin_abonos";
    else if (diferencia === 0) estado = "conciliado";

    const formasPago = ventasDia.reduce((grupos, venta) => {
      const nombre = normalizarTexto(venta.forma_pago);

      if (!grupos[nombre]) grupos[nombre] = { cantidad: 0, litros: 0, costo: 0 };
      grupos[nombre].cantidad += 1;
      grupos[nombre].litros += numero(venta.cantidad);
      return grupos;
    }, {});
    const productos = detallesCosto.reduce((grupos, detalle) => {
      grupos[detalle.producto] = {
        litrosBase: detalle.litrosBase,
        volumenPropio: detalle.volumenPropio,
        fluctuacionMesa: detalle.fluctuacionMesa,
        tctTaeManual: detalle.tctTaeManual,
        litros: detalle.litrosNetos,
        costo: detalle.costoExacto,
        precioCosto: detalle.precio?.valor || null,
        fechaVigencia: detalle.precio?.fechaVigencia || null,
      };
      return grupos;
    }, {});

    return {
      fecha,
      estado,
      ventas: {
        cantidad: transacciones.size,
        lineas: ventasDia.length,
        litrosBase,
        volumenPropio,
        fluctuacionMesa,
        tctTaeManual,
        litros,
        montoVentaReferencia,
        costoExacto,
        costo: costoVentas,
        ajusteRedondeo: costoVentas - costoExacto,
        lineasSinPrecio,
        formasPago,
        productos,
      },
      ajustes: ajustesDia.map((ajuste) => ({
        id: ajuste.id,
        tipo: ajuste.tipo,
        producto: ajuste.producto,
        litros: numero(ajuste.litros),
        referencia: ajuste.referencia,
        descripcion: ajuste.descripcion,
        fuente: ajuste.fuente,
      })),
      abonos: {
        cantidad: abonosDia.length,
        monto: montoAbonos,
      },
      diferencia,
    };
  });
  const resumen = dias.reduce(
    (total, dia) => {
      total.diasConciliados += dia.estado === "conciliado" ? 1 : 0;
      total.diasConDiferencia += dia.estado === "diferencia" ? 1 : 0;
      total.diasPendientes +=
        ["sin_ventas", "sin_abonos", "sin_precio"].includes(dia.estado)
          ? 1
          : 0;
      total.cantidadVentas += dia.ventas.cantidad;
      total.litrosBase += dia.ventas.litrosBase;
      total.volumenPropio += dia.ventas.volumenPropio;
      total.fluctuacionMesa += dia.ventas.fluctuacionMesa;
      total.tctTaeManual += dia.ventas.tctTaeManual;
      total.litros += dia.ventas.litros;
      total.montoVentaReferencia += dia.ventas.montoVentaReferencia;
      total.costoVentas += dia.ventas.costo;
      total.lineasSinPrecio += dia.ventas.lineasSinPrecio;
      total.cantidadAbonos += dia.abonos.cantidad;
      total.montoAbonos += dia.abonos.monto;
      total.diferencia += dia.diferencia;
      return total;
    },
    {
      diasConciliados: 0,
      diasConDiferencia: 0,
      diasPendientes: 0,
      cantidadVentas: 0,
      litrosBase: 0,
      volumenPropio: 0,
      fluctuacionMesa: 0,
      tctTaeManual: 0,
      litros: 0,
      montoVentaReferencia: 0,
      costoVentas: 0,
      lineasSinPrecio: 0,
      cantidadAbonos: 0,
      montoAbonos: 0,
      diferencia: 0,
    }
  );

  return {
    rango: { desde: rango.desde, hasta: rango.hasta },
    resumen,
    dias,
    preciosCosto: prepararHistorialPrecios(precios),
    ajustesManuales: ajustes
      .filter((ajuste) => ajuste.tipo === "tct_tae_manual")
      .map((ajuste) => ({
        id: ajuste.id,
        fecha: ajuste.fecha,
        producto: ajuste.producto,
        litros: numero(ajuste.litros),
        referencia: ajuste.referencia,
        descripcion: ajuste.descripcion,
      })),
  };
}

function obtenerRutCoseducam(venta) {
  const origen = venta?.datos_origen || {};
  const candidatos = [
    origen.clienteRutRut,
    origen.rutEmpresaReceptor,
    origen.rutCliente,
    origen.rut_cliente,
    origen["RUT CLIENTE"],
  ];

  return candidatos.map(normalizarRut).find((rut) => rut === RUT_COSEDUCAM);
}

function esVentaStorageCoseducam(venta) {
  const origen = venta?.datos_origen || {};
  const razonesSociales = [
    origen.clienteRutRazonSocial,
    origen.razonSocialReceptor,
    origen.razonSocialCliente,
    origen["RAZON SOCIAL CLIENTE"],
  ].map(normalizarTexto);

  return (
    normalizarTexto(venta?.forma_pago) === "STORAGE" &&
    clasificarProductoRecompra(venta?.producto) === "DIESEL" &&
    (Boolean(obtenerRutCoseducam(venta)) ||
      razonesSociales.some((razon) => razon.includes("COSEDUCAM")))
  );
}

function detalleCoseducam(venta) {
  const origen = venta?.datos_origen || {};

  return {
    transaccion:
      venta.transaccion_codigo || venta.transaccion_id || "Sin referencia",
    producto: venta.producto || "DIESEL",
    litros: numero(venta.cantidad),
    patente:
      String(
        origen.patente || origen.patenteVehiculo || origen["PATENTE"] || ""
      ).trim() || null,
  };
}

async function obtenerMesCoseducam(periodo) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [ventas, guias] = await Promise.all([
    leerTabla(
      "recompra_ventas",
      "fecha, codigo_eds, transaccion_id, transaccion_codigo, forma_pago, producto, cantidad, datos_origen",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "coseducam_guias",
      "id, fecha, codigo_eds, litros, estado, numero_guia, codigo_autorizacion, mensaje, creada_en, confirmada_en",
      rango.desde,
      rango.hasta
    ),
  ]);
  const ventasElegibles = ventas.filter(esVentaStorageCoseducam);
  const ventasPorFecha = agruparPorFecha(ventasElegibles);
  const guiaPorFecha = new Map(guias.map((guia) => [guia.fecha, guia]));
  const dias = rango.fechas.map((fecha) => {
    const ventasDia = ventasPorFecha.get(fecha) || [];
    const transacciones = new Set(
      ventasDia.map((venta) => venta.transaccion_id).filter(Boolean)
    );
    const litros = ventasDia.reduce(
      (total, venta) => total + numero(venta.cantidad),
      0
    );
    const guia = guiaPorFecha.get(fecha) || null;

    return {
      fecha,
      estado: guia?.estado || (litros > 0 ? "pendiente_guia" : "sin_consumo"),
      consumo: {
        litros,
        transacciones: transacciones.size,
        lineas: ventasDia.length,
        detalle: ventasDia.map(detalleCoseducam),
      },
      guia: guia
        ? {
            id: guia.id,
            estado: guia.estado,
            litros: numero(guia.litros),
            numeroGuia: guia.numero_guia,
            codigoAutorizacion: guia.codigo_autorizacion,
            mensaje: guia.mensaje,
            creadaEn: guia.creada_en,
            confirmadaEn: guia.confirmada_en,
          }
        : null,
    };
  });
  const resumen = dias.reduce(
    (total, dia) => {
      total.litros += dia.consumo.litros;
      total.transacciones += dia.consumo.transacciones;
      total.diasConConsumo += dia.consumo.litros > 0 ? 1 : 0;
      total.guiasCreadas += ["creada", "confirmada"].includes(dia.estado)
        ? 1
        : 0;
      total.guiasConfirmadas += dia.estado === "confirmada" ? 1 : 0;
      total.pendientes += dia.estado === "pendiente_guia" ? 1 : 0;
      return total;
    },
    {
      litros: 0,
      transacciones: 0,
      diasConConsumo: 0,
      guiasCreadas: 0,
      guiasConfirmadas: 0,
      pendientes: 0,
    }
  );

  return {
    rango: { desde: rango.desde, hasta: rango.hasta },
    cliente: {
      razonSocial: "COSEDUCAM S.A.",
      rut: "96.963.630-1",
      formaPago: "STORAGE",
      producto: "DIESEL",
    },
    resumen,
    dias,
    confirmacionEnRutaDisponible: false,
  };
}

async function solicitarTctTae(ruta, opciones = {}) {
  const ejecutar = async (token) => {
    const respuesta = await fetch(`${TCT_TAE_BASE_URL}${ruta}`, {
      ...opciones,
      headers: {
        Accept: "application/json",
        Origin: "https://tct-tae.copec.cl",
        Referer: "https://tct-tae.copec.cl/",
        token,
        ...(opciones.body ? { "Content-Type": "application/json" } : {}),
        ...(opciones.headers || {}),
      },
    });
    const texto = await respuesta.text();
    let payload = null;

    try {
      payload = texto ? JSON.parse(texto) : {};
    } catch {
      payload = { raw: texto.slice(0, 500) };
    }

    return { respuesta, payload };
  };

  let token = obtenerTokenCopecActual();

  if (!token) {
    token = (await iniciarSesionCopec()).accessToken;
  }

  let resultado = await ejecutar(token);

  if ([401, 403].includes(resultado.respuesta.status)) {
    token = (await iniciarSesionCopec()).accessToken;
    resultado = await ejecutar(token);
  }

  if (!resultado.respuesta.ok) {
    const error = new Error(
      resultado.payload?.userMessage ||
        resultado.payload?.message ||
        `Portal TCT/TAE rechazó la solicitud con estado ${resultado.respuesta.status}.`
    );
    error.status = resultado.respuesta.status;
    throw error;
  }

  return resultado.payload;
}

async function obtenerConfiguracionGuiaCoseducam(codigoEds) {
  const clientePayload = await solicitarTctTae(
    `/obtener-clientes-autorizacion?RUT=${RUT_COSEDUCAM_SIN_DV}`
  );
  const cliente = lista(clientePayload?.data?.clientes)[0];

  if (!cliente?.codigo_sin_digito) {
    throw new Error("Portal TCT/TAE no devolvió el cliente Coseducam.");
  }

  const codigoCliente = cliente.codigo_sin_digito;
  const [tarjetasPayload, subproductosPayload, fletePayload] =
    await Promise.all([
      solicitarTctTae(
        `/obtener-tarjetas-cliente?CODCLIENTE=${encodeURIComponent(
          codigoCliente
        )}&PRODUCTO=TAE&IDEDS=${encodeURIComponent(codigoEds)}`
      ),
      solicitarTctTae(
        `/obtener-subproductos?CODPRODUCTO=001&IDEDS=${encodeURIComponent(
          codigoEds
        )}`
      ),
      solicitarTctTae(
        `/obtener-flete?RUT=${RUT_COSEDUCAM_SIN_DV}&IDEDS=${encodeURIComponent(
          codigoEds
        )}`
      ),
    ]);
  const tarjetas = lista(tarjetasPayload?.data?.tarjetas);
  const tarjetaPreferida = String(
    process.env.COSEDUCAM_TARJETA_TAE || "1-424517-00668-9-4"
  ).trim();
  const tarjeta =
    tarjetas.find((item) => item.numero_tarjeta === tarjetaPreferida) ||
    tarjetas.find(
      (item) =>
        normalizarTexto(item.tipo_tae) === "TAE DESPACHO" &&
        normalizarTexto(item.producto).includes("DIESEL")
    );
  const subproducto = lista(subproductosPayload?.data?.subproductos).find(
    (item) => String(item.codigo) === "001"
  );

  if (!tarjeta) {
    throw new Error("No se encontró una tarjeta TAE Despacho diésel para Coseducam.");
  }

  if (!subproducto || numero(subproducto.precio) <= 0) {
    throw new Error("No fue posible obtener el precio diésel vigente para la guía.");
  }

  return {
    cliente,
    tarjeta,
    subproducto,
    flete: numero(fletePayload?.data?.flete),
  };
}

async function crearGuiaCoseducam(request) {
  const fecha = normalizarFecha(request.body?.fecha);
  const codigoEds = String(
    request.body?.codigoEds || process.env.COPEC_ID_EDS || "40098"
  ).trim();

  if (!fecha || !codigoEds) {
    const error = new Error("Falta una fecha válida o el código de la estación.");
    error.status = 400;
    throw error;
  }

  const ventas = await leerTabla(
    "recompra_ventas",
    "fecha, codigo_eds, transaccion_id, transaccion_codigo, forma_pago, producto, cantidad, datos_origen",
    fecha,
    fecha
  );
  const ventasElegibles = ventas.filter(
    (venta) =>
      esVentaStorageCoseducam(venta) &&
      (!venta.codigo_eds || String(venta.codigo_eds) === codigoEds)
  );
  const litros = ventasElegibles.reduce(
    (total, venta) => total + numero(venta.cantidad),
    0
  );

  if (litros <= 0) {
    const error = new Error(
      "No existen litros STORAGE diésel de Coseducam para la fecha seleccionada."
    );
    error.status = 400;
    throw error;
  }

  const { data: guiaExistente, error: errorConsulta } = await supabaseAdmin
    .from("coseducam_guias")
    .select("id, estado, numero_guia, codigo_autorizacion")
    .eq("fecha", fecha)
    .eq("codigo_eds", codigoEds)
    .maybeSingle();

  if (errorConsulta) {
    throw new Error(`No se pudo validar la guía existente: ${errorConsulta.message}`);
  }

  if (guiaExistente) {
    const error = new Error(
      `La fecha ya tiene una guía en estado ${guiaExistente.estado}. No se creó otra.`
    );
    error.status = 409;
    throw error;
  }

  const { data: bloqueo, error: errorBloqueo } = await supabaseAdmin
    .from("coseducam_guias")
    .insert({
      fecha,
      codigo_eds: codigoEds,
      rut_cliente: "96.963.630-1",
      litros,
      estado: "procesando",
      mensaje: "Solicitando autorización al Portal TCT/TAE.",
    })
    .select("id")
    .single();

  if (errorBloqueo) {
    const error = new Error(
      errorBloqueo.code === "23505"
        ? "Ya existe un proceso de guía para esta fecha."
        : `No se pudo iniciar la guía: ${errorBloqueo.message}`
    );
    error.status = errorBloqueo.code === "23505" ? 409 : 500;
    throw error;
  }

  try {
    const configuracion = await obtenerConfiguracionGuiaCoseducam(codigoEds);
    const precio = Math.round(numero(configuracion.subproducto.precio));
    const payloadAutorizacion = {
      id_eds: String(parseInt(codigoEds, 10)),
      codigo_cliente: String(
        parseInt(configuracion.cliente.codigo_sin_digito, 10)
      ),
      numero_tarjeta: configuracion.tarjeta.numero_tarjeta,
      cod_producto: "001",
      precio,
      rut: process.env.COPEC_RUT_CONCESIONARIO || "78229820-8",
      nombre_rut:
        process.env.COPEC_NOMBRE_CONCESIONARIO || "VALENCIA Y PACHECO LTDA.",
      cod_motivo: "0002",
      monto: Math.ceil(litros * precio),
      unidad: litros.toFixed(2),
      cod_subproducto: "001",
      direccion: String(
        request.body?.direccion ||
          process.env.COSEDUCAM_DIRECCION ||
          "fuenzalida 31"
      ).trim(),
      cod_comuna: process.env.COSEDUCAM_COD_COMUNA || "13501",
      flete: Math.round(configuracion.flete),
      orden_compra: "",
      comuna: process.env.COSEDUCAM_COMUNA || "Melipilla",
      tae_retiro: false,
    };
    const respuestaAutorizacion = await solicitarTctTae("/autorizar-consumo", {
      method: "POST",
      body: JSON.stringify(payloadAutorizacion),
    });
    const datos = respuestaAutorizacion?.data || {};

    if (!respuestaAutorizacion?.data || typeof datos.error !== "string") {
      throw new Error(
        "Portal TCT/TAE respondió sin confirmar el resultado de la autorización."
      );
    }

    const errorCopec = String(datos.error || "").trim();

    if (errorCopec) {
      throw new Error(errorCopec);
    }

    const numeroGuia = String(datos.numero_guia || "").trim() || null;
    const codigoAutorizacion =
      String(datos.codigo_autorizacion || "").trim() || null;

    if (!numeroGuia && !codigoAutorizacion) {
      throw new Error(
        "Portal TCT/TAE no devolvió número de guía ni código de autorización."
      );
    }

    const mensaje =
      String(datos.mensaje || "").trim() || "Guía creada correctamente.";
    const { error: errorActualizacion } = await supabaseAdmin
      .from("coseducam_guias")
      .update({
        estado: "creada",
        numero_guia: numeroGuia,
        codigo_autorizacion: codigoAutorizacion,
        mensaje,
        respuesta_autorizacion: respuestaAutorizacion,
        creada_en: new Date().toISOString(),
        sincronizado_en: new Date().toISOString(),
      })
      .eq("id", bloqueo.id);

    if (errorActualizacion) {
      throw new Error(
        `La autorización respondió, pero no pudo registrarse: ${errorActualizacion.message}`
      );
    }

    return {
      fecha,
      litros,
      numeroGuia,
      codigoAutorizacion,
      mensaje,
    };
  } catch (error) {
    await supabaseAdmin
      .from("coseducam_guias")
      .update({
        estado: "revision_requerida",
        mensaje:
          error instanceof Error ? error.message : "Error al crear la guía.",
        sincronizado_en: new Date().toISOString(),
      })
      .eq("id", bloqueo.id);

    throw error;
  }
}

function confirmarGuiaCoseducam() {
  const error = new Error(
    "La guía fue preparada, pero aún falta capturar en un HAR la confirmación real desde la PDA de En Ruta. No se enviaron cambios."
  );
  error.status = 409;
  error.requiereCapturaEnRuta = true;
  throw error;
}

export async function guardarVentas(filas, opciones = {}) {
  if (filas.length > 10000) {
    const error = new Error("La sincronizacion supera el maximo de 10.000 ventas.");
    error.status = 400;
    throw error;
  }

  const registros = new Map();

  for (const fila of filas) {
    const rutEmisor = normalizarRut(fila.rutEmisor);
    const formaPago = normalizarTexto(fila.formaPago);
    const fecha = normalizarFecha(fila.fecha);
    const transaccionId = String(fila.transaccionId || "").trim();
    const montoBruto = numero(fila.montoBruto ?? fila.monto);
    const propina = numero(fila.propina);
    const monto = Math.max(0, montoBruto - propina);

    if (
      rutEmisor !== RUT_COPEC ||
      !FORMAS_PAGO.has(formaPago) ||
      !fecha ||
      !transaccionId ||
      monto <= 0
    ) {
      continue;
    }

    const identificador = `muevo-venta-v1|${transaccionId}`;
    registros.set(identificador, {
      identificador_origen: identificador,
      fecha,
      codigo_eds: String(fila.codigoEds || "").trim() || null,
      transaccion_id: transaccionId,
      transaccion_codigo:
        String(fila.transaccionCodigo || "").trim() || null,
      rut_emisor: "99.520.000-7",
      razon_social_emisor:
        String(fila.razonSocialEmisor || "Copec S.A.").trim(),
      forma_pago: formaPago,
      tipo_documento: String(fila.tipoDocumento || "").trim() || null,
      descripcion_documento:
        String(fila.descripcionDocumento || "").trim() || null,
      folio: String(fila.folio || "").trim() || null,
      monto,
      datos_origen: {
        ...fila,
        montoBruto,
        propina,
        montoConciliable: monto,
      },
      sincronizado_en: new Date().toISOString(),
    });
  }

  const ventas = [...registros.values()];

  if (ventas.length === 0 && !opciones.permitirVacio) {
    const error = new Error(
      "No se encontraron ventas emitidas por Copec pagadas en efectivo, credito o debito."
    );
    error.status = 400;
    throw error;
  }

  if (opciones.reemplazarFecha) {
    let eliminacion = supabaseAdmin
      .from("muevo_empresa_ventas")
      .delete()
      .eq("fecha", opciones.reemplazarFecha);

    if (opciones.codigoEds) {
      eliminacion = eliminacion.eq("codigo_eds", opciones.codigoEds);
    }

    const { error: errorEliminacion } = await eliminacion;

    if (errorEliminacion) {
      throw new Error(
        `No se pudo reemplazar el detalle diario: ${errorEliminacion.message}`
      );
    }
  }

  if (ventas.length > 0) {
    const { error } = await supabaseAdmin
      .from("muevo_empresa_ventas")
      .upsert(ventas, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudieron guardar las ventas: ${error.message}`);
    }
  }

  return {
    ventasRecibidas: filas.length,
    ventasGuardadas: ventas.length,
    montoBrutoGuardado: ventas.reduce(
      (total, venta) => total + numero(venta.datos_origen?.montoBruto),
      0
    ),
    totalPropinas: ventas.reduce(
      (total, venta) => total + numero(venta.datos_origen?.propina),
      0
    ),
    montoGuardado: ventas.reduce(
      (total, venta) => total + numero(venta.monto),
      0
    ),
  };
}

export async function guardarVentasRecompra(filas, opciones = {}) {
  const registros = new Map();

  for (const fila of filas) {
    const formaPago = normalizarTexto(
      fila.formaPagoNombre || fila.formaPago
    );
    const razonSocialEmisor = String(
      fila.clienteRazonSocial ||
        fila.razonSocialEmisor ||
        fila.razon_social_emisor ||
        fila["RAZON SOCIAL EMISOR"] ||
        ""
    ).trim();
    const esMedioRecompra = FORMAS_PAGO_RECOMPRA.has(formaPago);
    const esPagoEmitidoPorCopec =
      FORMAS_PAGO_COPEC_RECOMPRA.has(formaPago) &&
      esRazonSocialCopec(razonSocialEmisor);
    const productoOriginal = String(
      fila.productoDescripcion || fila.productoNombre || fila.producto || ""
    ).trim();
    const producto = clasificarProductoRecompra(productoOriginal);
    const fecha = normalizarFecha(opciones.fecha || fila.fecha);
    const transaccionId = String(fila.transaccionId || "").trim();
    const monto = numero(fila.total);

    if (
      (!esMedioRecompra && !esPagoEmitidoPorCopec) ||
      !producto ||
      !fecha ||
      !transaccionId ||
      monto <= 0
    ) {
      continue;
    }

    const productoId = String(fila.productoId || "").trim();
    const identificador = [
      "recompra-venta-v1",
      transaccionId,
      productoId || producto,
      String(fila.surtidorId || ""),
      monto.toFixed(2),
    ].join("|");

    registros.set(identificador, {
      identificador_origen: identificador,
      fecha,
      codigo_eds: String(opciones.codigoEds || "").trim() || null,
      transaccion_id: transaccionId,
      transaccion_codigo:
        String(fila.transaccionCodigo || "").trim() || null,
      forma_pago: formaPago,
      producto_id: productoId || null,
      producto,
      categoria: String(fila.categoriaNombre || "").trim() || null,
      cantidad: numero(fila.cantidad),
      monto,
      datos_origen: {
        ...fila,
        valepacReglaRecompra: esMedioRecompra
          ? "medio_pago_recompra"
          : "pago_emitido_por_copec",
        valepacRazonSocialEmisor: razonSocialEmisor || null,
      },
      sincronizado_en: new Date().toISOString(),
    });
  }

  const ventas = [...registros.values()];

  if (opciones.reemplazarFecha) {
    let eliminacion = supabaseAdmin
      .from("recompra_ventas")
      .delete()
      .eq("fecha", opciones.reemplazarFecha);

    if (opciones.codigoEds) {
      eliminacion = eliminacion.eq("codigo_eds", opciones.codigoEds);
    }

    const { error: errorEliminacion } = await eliminacion;

    if (errorEliminacion) {
      throw new Error(
        `No se pudo reemplazar el detalle Recompra: ${errorEliminacion.message}`
      );
    }
  }

  if (ventas.length > 0) {
    const { error } = await supabaseAdmin
      .from("recompra_ventas")
      .upsert(ventas, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudieron guardar las ventas Recompra: ${error.message}`);
    }
  }

  return {
    ventasRecompraGuardadas: ventas.length,
    montoRecompraGuardado: ventas.reduce(
      (total, venta) => total + numero(venta.monto),
      0
    ),
  };
}

async function importarVentas(request) {
  const filas = Array.isArray(request.body?.ventas)
    ? request.body.ventas
    : [];

  if (filas.length === 0) {
    const error = new Error("El archivo no contiene ventas elegibles.");
    error.status = 400;
    throw error;
  }

  return guardarVentas(filas);
}

export function adaptarVentaCopecFuel(fila, fecha, ubicacion) {
  return {
    transaccionId: fila.transaccionId,
    transaccionCodigo: fila.transaccionCodigo,
    codigoEds: fila.codigoEds || ubicacion.codigo || null,
    fecha,
    rutEmisor: fila.clienteRut,
    razonSocialEmisor: fila.clienteRazonSocial,
    formaPago: fila.formaPagoNombre || fila.formaPago,
    tipoDocumento: fila.tipoDocumento,
    descripcionDocumento: fila.descripcionDocumento,
    folio: fila.folio,
    montoBruto: numero(
      fila.totalMontoPagar ??
        fila.totalMontoPagarManual ??
        fila.totalMontoPago ??
        fila.total
    ),
    propina: numero(fila.totalPropina),
    fuente: "api_oficial_venta_combustible",
    datosCopecFuel: fila,
  };
}

async function sincronizarVentasCopecFuel(request) {
  const fecha = normalizarFecha(request.body?.fecha || request.query?.fecha);

  if (!fecha) {
    const error = new Error("La fecha debe usar el formato AAAA-MM-DD.");
    error.status = 400;
    throw error;
  }

  const ventasOficiales = await obtenerVentasOficialesCopecFuel(fecha);
  const filasDetalle = ventasOficiales.filas;
  const ubicacion = {
    codigo: ventasOficiales.codigoEds,
    ubicacionId: ventasOficiales.clienteId,
  };

  const filas = filasDetalle.map((fila) =>
    adaptarVentaCopecFuel(fila, fecha, ubicacion)
  );
  const [resultado, resultadoRecompra] = await Promise.all([
    guardarVentas(filas, {
      reemplazarFecha: fecha,
      codigoEds: ubicacion.codigo || null,
      permitirVacio: true,
    }),
    guardarVentasRecompra(filasDetalle, {
      fecha,
      reemplazarFecha: fecha,
      codigoEds: ubicacion.codigo || null,
    }),
  ]);

  return {
    fecha,
    estacion: ubicacion.codigo || ubicacion.ubicacionId,
    fuente: "API_OFICIAL_VENTA_COMBUSTIBLE",
    paginasConsultadas: 1,
    registrosDetalle: filasDetalle.length,
    diagnostico: ventasOficiales.diagnostico,
    ...resultado,
    ...resultadoRecompra,
  };
}

function separarTsv(texto) {
  const lineas = String(texto || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((linea) => linea.trim());

  if (lineas.length < 2) return [];

  const encabezados = lineas[0].split("\t").map(normalizarTexto);

  return lineas.slice(1).map((linea) => {
    const valores = linea.split("\t");
    return Object.fromEntries(
      encabezados.map((encabezado, indice) => [
        encabezado,
        String(valores[indice] ?? "").trim(),
      ])
    );
  });
}

function validarSolicitudExcelEnRuta({ fechaDesde, fechaHasta, codigoEds }) {
  if (!fechaDesde || !fechaHasta) {
    const error = new Error("Indica una fecha desde y una fecha hasta validas.");
    error.status = 400;
    throw error;
  }

  if (fechaDesde > fechaHasta) {
    const error = new Error(
      "La fecha desde no puede ser posterior a la fecha hasta."
    );
    error.status = 400;
    throw error;
  }

  if (!/^\d{4,6}$/.test(codigoEds)) {
    const error = new Error(
      "El codigo de estacion debe contener entre 4 y 6 numeros."
    );
    error.status = 400;
    throw error;
  }

  const milisegundosDia = 24 * 60 * 60 * 1000;
  const diasSolicitados =
    Math.round(
      (Date.parse(`${fechaHasta}T00:00:00Z`) -
        Date.parse(`${fechaDesde}T00:00:00Z`)) /
        milisegundosDia
    ) + 1;

  if (!Number.isFinite(diasSolicitados) || diasSolicitados > 366) {
    const error = new Error(
      "El rango del reporte no puede superar los 366 dias."
    );
    error.status = 400;
    throw error;
  }
}

async function obtenerExcelEnRuta({ fechaDesde, fechaHasta, codigoEds }) {
  const desde = normalizarFecha(fechaDesde);
  const hasta = normalizarFecha(fechaHasta);
  const estacion = String(codigoEds || "").trim();

  validarSolicitudExcelEnRuta({
    fechaDesde: desde,
    fechaHasta: hasta,
    codigoEds: estacion,
  });

  const body = new URLSearchParams({
    accion: "infoExcel",
    hr: "",
    pedido: "",
    destinatario: "",
    estacion,
    tipo: "0",
    estado: "0",
    guia: "",
    fini: fechaChilena(desde),
    ffini: fechaChilena(hasta),
    usuario: estacion,
  });
  const respuestaGeneracion = await fetch(
    `${ENRUTA_BASE_URL}/fetch/elementos/f_MonitorPedido.aspx`,
    {
      method: "POST",
      headers: {
        Accept: "text/html, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: ENRUTA_BASE_URL,
        Referer: `${ENRUTA_BASE_URL}/MonitorPedido.aspx`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    }
  );
  const respuestaTexto = await respuestaGeneracion.text();
  const nombreArchivo = respuestaTexto.match(/Excel_[0-9A-Za-z]+/)?.[0];

  if (!respuestaGeneracion.ok || !nombreArchivo) {
    throw new Error(
      `Copec en Ruta no pudo generar el detalle (estado ${respuestaGeneracion.status}).`
    );
  }

  const respuestaArchivo = await fetch(
    `${ENRUTA_BASE_URL}/pdf/${nombreArchivo}.xls`,
    {
      headers: {
        Accept: "application/vnd.ms-excel, text/plain, */*",
        Referer: `${ENRUTA_BASE_URL}/MonitorPedido.aspx`,
      },
    }
  );

  if (!respuestaArchivo.ok) {
    throw new Error(
      `Copec en Ruta no pudo descargar el detalle (estado ${respuestaArchivo.status}).`
    );
  }

  return {
    bytes: await respuestaArchivo.arrayBuffer(),
    nombreArchivo: `${nombreArchivo}.xls`,
    fechaDesde: desde,
    fechaHasta: hasta,
    codigoEds: estacion,
  };
}

async function sincronizarVolumenPropioEnRuta(request) {
  const periodo = String(
    request.body?.periodo || request.query?.periodo || ""
  ).trim();
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const fechaDesdeSolicitada = String(
    request.body?.fechaDesde || request.query?.fechaDesde || ""
  ).trim();
  const desdeSincronizacion =
    /^\d{4}-\d{2}-\d{2}$/.test(fechaDesdeSolicitada) &&
    fechaDesdeSolicitada.startsWith(`${periodo}-`) &&
    fechaDesdeSolicitada >= rango.desde &&
    fechaDesdeSolicitada <= rango.hasta
      ? fechaDesdeSolicitada
      : rango.desde;

  const codigoEds = String(
    request.body?.codigoEds ||
      process.env.ENRUTA_EDS ||
      process.env.COPEC_EDS_PRECIOS ||
      (process.env.COPEC_ID_EDS !== "*" ? process.env.COPEC_ID_EDS : "") ||
      "40098"
  ).trim();
  const { bytes } = await obtenerExcelEnRuta({
    fechaDesde: desdeSincronizacion,
    fechaHasta: rango.hasta,
    codigoEds,
  });
  const texto = new TextDecoder("windows-1252").decode(bytes);
  const filas = separarTsv(texto);
  const registros = new Map();

  for (const fila of filas) {
    const estado = normalizarTexto(fila.ESTADO);
    const tipo = normalizarTexto(fila.TIPO);
    const fecha = normalizarFecha(fila["FECHA ESTADO"]);
    const producto = clasificarProductoEnRuta(fila.PRODUCTO);
    const litros = numeroChile(fila["LITROS ENTREGADOS"]);

    if (
      !["CERRADO", "ENTREGADO"].includes(estado) ||
      tipo !== "CONCESIONARIO" ||
      !fecha ||
      fecha < desdeSincronizacion ||
      !producto ||
      litros <= 0
    ) {
      continue;
    }

    const identificador = [
      "enruta-volumen-propio-v1",
      codigoEds,
      fila["NUMERO PEDIDO"],
      fila.DTE,
      producto,
    ].join("|");
    registros.set(identificador, {
      identificador_origen: identificador,
      fecha,
      codigo_eds: codigoEds,
      tipo: "volumen_propio",
      producto,
      litros,
      referencia: fila.DTE || fila["NUMERO PEDIDO"] || null,
      descripcion: `Volumen Propio ${fila.DESTINATARIO || "Copec en Ruta"}`,
      fuente: "copec_en_ruta",
      datos_origen: fila,
      sincronizado_en: new Date().toISOString(),
    });
  }

  const { error: errorLimpieza } = await supabaseAdmin
    .from("recompra_ajustes")
    .delete()
    .eq("tipo", "volumen_propio")
    .eq("codigo_eds", codigoEds)
    .gte("fecha", desdeSincronizacion)
    .lte("fecha", rango.hasta);

  if (errorLimpieza) {
    throw new Error(
      `No se pudo actualizar Volumen Propio: ${errorLimpieza.message}`
    );
  }

  const volumenes = [...registros.values()];

  if (volumenes.length > 0) {
    const { error } = await supabaseAdmin
      .from("recompra_ajustes")
      .upsert(volumenes, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudo guardar Volumen Propio: ${error.message}`);
    }
  }

  return {
    periodo,
    fechaDesde: desdeSincronizacion,
    estacion: codigoEds,
    filasDescargadas: filas.length,
    entregasGuardadas: volumenes.length,
    litrosVolumenPropio: volumenes.reduce(
      (total, registro) => total + numero(registro.litros),
      0
    ),
  };
}

async function guardarAjusteTctTae(request) {
  const fecha = normalizarFecha(request.body?.fecha);
  const litros = numeroChile(request.body?.litros);
  const referencia = String(request.body?.referencia || "").trim();
  const codigoEds = String(
    request.body?.codigoEds ||
      process.env.COPEC_EDS_PRECIOS ||
      (process.env.COPEC_ID_EDS !== "*" ? process.env.COPEC_ID_EDS : "") ||
      "40098"
  ).trim();

  if (!fecha || litros <= 0) {
    const error = new Error(
      "Indica una fecha valida y una cantidad de litros mayor que cero."
    );
    error.status = 400;
    throw error;
  }

  const identificador = [
    "tct-tae-manual-v1",
    codigoEds,
    fecha,
    normalizarTexto(referencia || "SIN REFERENCIA"),
    litros.toFixed(3),
  ].join("|");
  const { data, error } = await supabaseAdmin
    .from("recompra_ajustes")
    .upsert(
      {
        identificador_origen: identificador,
        fecha,
        codigo_eds: codigoEds,
        tipo: "tct_tae_manual",
        producto: "DIESEL",
        litros,
        referencia: referencia || null,
        descripcion: "TCT/TAE no rescatado en surtidor validador",
        fuente: "ingreso_manual",
        datos_origen: {
          regla: "Solo Diesel; el valor se calcula con el precio costo vigente.",
        },
        sincronizado_en: new Date().toISOString(),
      },
      { onConflict: "identificador_origen" }
    )
    .select("id, fecha, producto, litros, referencia, descripcion")
    .single();

  if (error) {
    throw new Error(`No se pudo guardar el ajuste TCT/TAE: ${error.message}`);
  }

  return data;
}

async function eliminarAjusteTctTae(request) {
  const id = String(request.body?.id || "").trim();

  if (!id) {
    const error = new Error("Falta identificar el ajuste TCT/TAE.");
    error.status = 400;
    throw error;
  }

  const { error } = await supabaseAdmin
    .from("recompra_ajustes")
    .delete()
    .eq("id", id)
    .eq("tipo", "tct_tae_manual");

  if (error) {
    throw new Error(`No se pudo eliminar el ajuste TCT/TAE: ${error.message}`);
  }

  return { id };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  if (!(await requireAdmin(request, response))) return;

  try {
    if (request.method === "GET") {
      const periodo = String(request.query.periodo || "").trim();
      const tipo = String(request.query.tipo || "").trim();
      const esRecompra = tipo === "recompra";
      const esCoseducam = tipo === "coseducam";
      const resultado = esCoseducam
        ? await obtenerMesCoseducam(periodo)
        : esRecompra
          ? await obtenerMesRecompra(periodo)
          : await obtenerMes(periodo);

      return response.status(200).json({
        ok: true,
        conciliador: esCoseducam
          ? "Coseducam"
          : esRecompra
            ? "Recompra"
            : "Cargos Muevo empresa",
        periodo,
        ...resultado,
        criterio: esCoseducam
          ? "Litros diesel vendidos con medio de pago STORAGE al cliente Coseducam, agrupados por dia."
          : esRecompra
          ? "Abonos Recompra del Portal Copec menos el costo vigente de los litros netos: ventas Recompra - Volumen Propio + fluctuación de VCTG38/VCTG39 + TCT/TAE manual Diésel. BlueMax queda excluido."
          : "Cargos Consumo Muevo Empresa del Portal Copec menos ventas emitidas por Copec pagadas en efectivo, credito o debito, descontando sus propinas.",
      });
    }

    if (request.method === "POST") {
      if (request.body?.accion === "crear_guia_coseducam") {
        const resultado = await crearGuiaCoseducam(request);

        return response.status(200).json({
          ok: true,
          mensaje: resultado.mensaje || "Guia Coseducam creada correctamente.",
          ...resultado,
        });
      }

      if (request.body?.accion === "confirmar_guia_coseducam") {
        confirmarGuiaCoseducam();
      }

      if (request.body?.accion === "descargar_excel_enruta") {
        const archivo = await obtenerExcelEnRuta({
          fechaDesde: request.body?.fechaDesde,
          fechaHasta: request.body?.fechaHasta,
          codigoEds: request.body?.codigoEds,
        });

        response.setHeader("Content-Type", "application/vnd.ms-excel");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${archivo.nombreArchivo}"`
        );
        response.setHeader("Content-Length", archivo.bytes.byteLength);

        return response.status(200).send(Buffer.from(archivo.bytes));
      }

      if (request.body?.accion === "sincronizar_enruta") {
        const resultado = await sincronizarVolumenPropioEnRuta(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Volumen Propio sincronizado desde Copec en Ruta.",
          ...resultado,
        });
      }

      if (request.body?.accion === "guardar_tct_tae") {
        const ajuste = await guardarAjusteTctTae(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Ajuste TCT/TAE guardado correctamente.",
          ajuste,
        });
      }

      if (request.body?.accion === "eliminar_tct_tae") {
        const resultado = await eliminarAjusteTctTae(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Ajuste TCT/TAE eliminado.",
          ...resultado,
        });
      }

      if (request.body?.accion === "sincronizar_copecfuel") {
        const resultado = await sincronizarVentasCopecFuel(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Ventas Muevo Empresa sincronizadas desde CopecFuel.",
          ...resultado,
        });
      }

      const resultado = await importarVentas(request);

      return response.status(200).json({
        ok: true,
        mensaje: "Detalle de ventas Muevo Empresa importado correctamente.",
        ...resultado,
      });
    }

    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido.",
    });
  } catch (error) {
    console.error("Error en Cargos Muevo empresa:", error);

    return response.status(error?.status || 500).json({
      ok: false,
      requiereCodigoEquipo: Boolean(error?.requiereCodigoEquipo),
      requiereCapturaEnRuta: Boolean(error?.requiereCapturaEnRuta),
      error:
        error instanceof Error
          ? error.message
          : "No fue posible procesar Cargos Muevo empresa.",
    });
  }
}
