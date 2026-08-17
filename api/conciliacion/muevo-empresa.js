import { requireCoseducam, supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  iniciarSesionCopec,
  obtenerTokenCopecActual,
} from "../copec/login.js";
import { obtenerVentasOficialesCopecFuel } from "../../server/copecfuel/ventasOficiales.js";

const TAMANO_PAGINA = 1000;
const RUT_COPEC = "995200007";
const RUT_COSEDUCAM = "969636301";
const RUT_COSEDUCAM_SIN_DV = "96963630";
const RUT_COSEDUCAM_FORMATEADO = "96.963.630-1";
const TCT_TAE_BASE_URL = "https://tct-tae-api.copec.cl/tct-tae";
const ENRUTA_BASE_URL = "https://enrutacopec.cl";
// Estados que representan una guia real ya emitida: nunca se reutilizan.
const ESTADOS_GUIA_EMITIDA = new Set(["creada", "confirmada"]);
// Una creacion que quedo en `procesando` mas tiempo que esto solo puede
// deberse a que la funcion murio (timeout o despliegue). Pasado el limite la
// fila deja de bloquear la fecha y puede reutilizarse.
const MINUTOS_PROCESANDO_VENCIDO = 5;
// El Portal TCT/TAE responde en 1-3 s. Un corte de red sin limite propio deja
// la funcion colgada hasta que la mata la plataforma, y eso es justamente lo
// que dejaba la fila en `procesando` para siempre.
const TIEMPO_MAXIMO_PORTAL_MS = 20_000;
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

function redondearLitros(valor) {
  // CopecFuel informa milésimas de litro. Sumar decimales binarios arrastra
  // residuos (501,4999999...), así que toda cifra de consumo se normaliza a
  // milésimas antes de compararse o redondearse.
  return Math.round(numero(valor) * 1000) / 1000;
}

function redondearLitrosGuia(valor) {
  // Regla operacional de la guía: fracción 0,5 o superior sube; menor que 0,5
  // baja. Se aplica sobre el consumo ya normalizado a milésimas.
  return Math.floor(redondearLitros(valor) + 0.5);
}

function normalizarCodigoEds(valor) {
  // "40098", "040098" y "40098 " son la misma estación. Se compara siempre el
  // número, nunca el texto: el código llega desde CopecFuel, desde el body de
  // la solicitud y desde variables de entorno, y cada origen lo escribe
  // distinto.
  const digitos = String(valor ?? "").replace(/\D+/g, "");
  return digitos ? String(Number(digitos)) : "";
}

function mismaEds(valorA, valorB) {
  const izquierda = normalizarCodigoEds(valorA);
  const derecha = normalizarCodigoEds(valorB);

  // Un registro sin código de estación pertenece a la estación consultada:
  // así el mes y la creación de la guía cuentan exactamente los mismos litros.
  if (!izquierda || !derecha) return true;

  return izquierda === derecha;
}

function codigoEdsCoseducam(valor) {
  const solicitado = normalizarCodigoEds(valor);

  if (solicitado) return solicitado;

  const candidatos = [
    process.env.COSEDUCAM_EDS,
    process.env.COPEC_EDS_PRECIOS,
    process.env.COPEC_ID_EDS,
  ];

  return (
    candidatos.map(normalizarCodigoEds).find(Boolean) || "40098"
  );
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

async function leerPreciosDieselObservados(desde, hasta) {
  const registros = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("copecfuel_resumenes")
      .select("fecha_desde, datos_origen, sincronizado_en")
      .gte("fecha_desde", desde)
      .lte("fecha_desde", hasta)
      .order("fecha_desde", { ascending: true })
      .order("sincronizado_en", { ascending: false })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(
        `No se pudieron leer los precios observados CopecFuel: ${error.message}`
      );
    }

    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina);

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  const porFecha = new Map();

  for (const registro of registros) {
    const fecha = normalizarFecha(registro.fecha_desde);
    const observado = registro.datos_origen?.precioDieselObservado;

    if (!fecha || porFecha.has(fecha) || numero(observado?.precio) <= 0) {
      continue;
    }

    porFecha.set(fecha, {
      precio: numero(observado.precio),
      repeticiones: numero(observado.repeticiones),
      transaccionesRevisadas: numero(observado.transaccionesRevisadas),
      preciosDistintos: numero(observado.preciosDistintos),
    });
  }

  return porFecha;
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
        montoBruto: montoVentas,
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
    litros: redondearLitros(venta.cantidad),
    patente:
      String(
        origen.patente || origen.patenteVehiculo || origen["PATENTE"] || ""
      ).trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Coseducam: una sola definicion de "litros del dia" y de "guia vigente".
//
// El defecto que bloqueaba la creacion era tener dos verdades distintas: la
// vista mensual sumaba todas las ventas STORAGE del dia y la creacion sumaba
// solo las de una estacion. Ambas rutinas usan ahora estas funciones, de modo
// que lo que el operador ve en pantalla es exactamente lo que se envia al
// Portal TCT/TAE.
// ---------------------------------------------------------------------------

function seleccionarVentasCoseducam(ventas, codigoEds) {
  return lista(ventas).filter(
    (venta) =>
      esVentaStorageCoseducam(venta) && mismaEds(venta.codigo_eds, codigoEds)
  );
}

function calcularConsumoCoseducam(ventasDia) {
  const litros = redondearLitros(
    lista(ventasDia).reduce((total, venta) => total + numero(venta.cantidad), 0)
  );
  const transacciones = new Set(
    lista(ventasDia)
      .map((venta) => venta.transaccion_id)
      .filter(Boolean)
  );

  return {
    litros,
    // Entero definitivo de la guia. Se calcula aqui y solo aqui.
    litrosGuia: redondearLitrosGuia(litros),
    transacciones: transacciones.size,
    lineas: lista(ventasDia).length,
  };
}

function procesandoVencido(guia) {
  if (guia?.estado !== "procesando") return false;

  const referencia = Date.parse(
    guia.sincronizado_en || guia.creada_en || guia.actualizado_en || ""
  );

  // Sin marca de tiempo utilizable se asume vencida: es preferible permitir el
  // reintento a dejar la fecha bloqueada de forma permanente.
  if (!Number.isFinite(referencia)) return true;

  return Date.now() - referencia > MINUTOS_PROCESANDO_VENCIDO * 60_000;
}

function autorizacionFueEnviada(guia) {
  return Boolean(guia?.respuesta_autorizacion?.autorizacionEnviada);
}

function guiaReutilizable(guia) {
  if (!guia) return false;
  if (ESTADOS_GUIA_EMITIDA.has(guia.estado)) return false;

  return guia.estado === "revision_requerida" || procesandoVencido(guia);
}

const PRIORIDAD_GUIA = {
  confirmada: 5,
  creada: 4,
  procesando: 3,
  revision_requerida: 2,
};

function seleccionarGuiaCoseducam(guias, fecha, codigoEds) {
  const candidatas = lista(guias).filter(
    (guia) => guia.fecha === fecha && mismaEds(guia.codigo_eds, codigoEds)
  );

  if (candidatas.length === 0) return null;

  // Si por cualquier motivo hubiera mas de una fila para el dia, manda siempre
  // la guia realmente emitida. Asi nunca se emite una segunda por leer la fila
  // equivocada.
  return [...candidatas].sort(
    (a, b) =>
      (PRIORIDAD_GUIA[b.estado] || 0) - (PRIORIDAD_GUIA[a.estado] || 0) ||
      String(b.creada_en || b.sincronizado_en || "").localeCompare(
        String(a.creada_en || a.sincronizado_en || "")
      )
  )[0];
}

function presentarGuiaCoseducam(guia) {
  if (!guia) return null;

  const reutilizable = guiaReutilizable(guia);

  return {
    id: guia.id,
    estado: guia.estado,
    litros: numero(guia.litros),
    numeroGuia: guia.numero_guia,
    codigoAutorizacion: guia.codigo_autorizacion,
    mensaje: guia.mensaje,
    creadaEn: guia.creada_en,
    confirmadaEn: guia.confirmada_en,
    // Banderas que usa la interfaz para ofrecer "Reintentar" en vez de dejar
    // el dia sin accion posible.
    puedeReintentar: reutilizable,
    autorizacionEnviada: autorizacionFueEnviada(guia),
    procesandoVencido: procesandoVencido(guia),
  };
}

async function leerGuiasCoseducam(desde, hasta) {
  return leerTabla(
    "coseducam_guias",
    "id, fecha, codigo_eds, litros, estado, numero_guia, codigo_autorizacion, mensaje, creada_en, confirmada_en, sincronizado_en, respuesta_autorizacion",
    desde,
    hasta
  );
}

async function obtenerMesCoseducam(periodo, codigoEdsSolicitado) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const codigoEds = codigoEdsCoseducam(codigoEdsSolicitado);
  const [ventas, guias, preciosDieselObservados] = await Promise.all([
    leerTabla(
      "recompra_ventas",
      "fecha, codigo_eds, transaccion_id, transaccion_codigo, forma_pago, producto, cantidad, datos_origen",
      rango.desde,
      rango.hasta
    ),
    leerGuiasCoseducam(rango.desde, rango.hasta),
    leerPreciosDieselObservados(rango.desde, rango.hasta),
  ]);
  const ventasPorFecha = agruparPorFecha(
    seleccionarVentasCoseducam(ventas, codigoEds)
  );
  const dias = rango.fechas.map((fecha) => {
    const ventasDia = ventasPorFecha.get(fecha) || [];
    const consumo = calcularConsumoCoseducam(ventasDia);
    const guia = seleccionarGuiaCoseducam(guias, fecha, codigoEds);
    const precioDieselObservado = preciosDieselObservados.get(fecha) || null;

    return {
      fecha,
      estado:
        guia?.estado || (consumo.litros > 0 ? "pendiente_guia" : "sin_consumo"),
      consumo: {
        litros: consumo.litros,
        // Entero que se enviara al Portal TCT/TAE. La interfaz lo muestra tal
        // cual; ya no lo recalcula por su cuenta.
        litrosGuia: consumo.litrosGuia,
        transacciones: consumo.transacciones,
        lineas: consumo.lineas,
        precioDieselObservado,
        detalle: ventasDia.map(detalleCoseducam),
      },
      guia: presentarGuiaCoseducam(guia),
    };
  });
  const resumen = dias.reduce(
    (total, dia) => {
      total.litros += dia.consumo.litros;
      total.litrosGuia += dia.consumo.litrosGuia;
      total.transacciones += dia.consumo.transacciones;
      total.diasConConsumo += dia.consumo.litros > 0 ? 1 : 0;
      total.guiasCreadas += ESTADOS_GUIA_EMITIDA.has(dia.estado) ? 1 : 0;
      total.guiasConfirmadas += dia.estado === "confirmada" ? 1 : 0;
      total.pendientes += dia.estado === "pendiente_guia" ? 1 : 0;
      total.porReintentar += dia.guia?.puedeReintentar ? 1 : 0;
      return total;
    },
    {
      litros: 0,
      litrosGuia: 0,
      transacciones: 0,
      diasConConsumo: 0,
      guiasCreadas: 0,
      guiasConfirmadas: 0,
      pendientes: 0,
      porReintentar: 0,
    }
  );

  resumen.litros = redondearLitros(resumen.litros);

  return {
    rango: { desde: rango.desde, hasta: rango.hasta },
    cliente: {
      razonSocial: "COSEDUCAM S.A.",
      rut: RUT_COSEDUCAM_FORMATEADO,
      formaPago: "STORAGE",
      producto: "DIESEL",
    },
    codigoEds,
    reglaRedondeo:
      "Los litros de la guía son enteros: fracción 0,5 o superior sube, menor a 0,5 baja.",
    resumen,
    dias,
    confirmacionEnRutaDisponible: true,
  };
}

async function solicitarTctTae(ruta, { tiempoMaximoMs, ...opciones } = {}) {
  const limite = numero(tiempoMaximoMs) || TIEMPO_MAXIMO_PORTAL_MS;
  const ejecutar = async (token) => {
    // Sin AbortController una conexion colgada mantiene viva la funcion hasta
    // que la mata la plataforma. Ese corte silencioso es lo que dejaba la guia
    // en `procesando` y la fecha bloqueada, sin ningun mensaje para el
    // operador.
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), limite);

    try {
      const respuesta = await fetch(`${TCT_TAE_BASE_URL}${ruta}`, {
        ...opciones,
        signal: controlador.signal,
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
    } catch (error) {
      if (error?.name === "AbortError") {
        const agotado = new Error(
          `El Portal TCT/TAE no respondió dentro de ${Math.round(
            limite / 1000
          )} segundos. No se creó ninguna guía; vuelve a intentarlo.`
        );
        agotado.status = 504;
        agotado.tiempoAgotado = true;
        throw agotado;
      }

      const fallo = new Error(
        `No fue posible comunicarse con el Portal TCT/TAE: ${
          error?.message || "error de red"
        }`
      );
      fallo.status = 502;
      throw fallo;
    } finally {
      clearTimeout(temporizador);
    }
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

function textoPortal(valor) {
  const texto = String(valor ?? "").trim();

  return !texto || /^(null|undefined)$/i.test(texto) ? "" : texto;
}

function primerTextoPortal(objeto, claves) {
  for (const clave of claves) {
    const texto = textoPortal(objeto?.[clave]);

    if (texto) return texto;
  }

  return "";
}

function interpretarAutorizacionTctTae(respuesta) {
  // Copec devuelve `data.error` como cadena vacia cuando la autorizacion sale
  // bien. La version anterior exigia que ese campo fuera SIEMPRE un string y
  // convertia en fallo cualquier respuesta correcta que no lo trajera: la guia
  // quedaba emitida en Copec y marcada como error en VALEPAC, bloqueando el
  // dia. Ahora manda el contenido: primero un error explicito, despues el
  // numero de guia.
  const datos =
    (respuesta && typeof respuesta.data === "object" && respuesta.data) ||
    (respuesta && typeof respuesta === "object" ? respuesta : {}) ||
    {};
  const errorPortal = primerTextoPortal(datos, [
    "error",
    "userMessage",
    "mensaje_error",
    "mensajeError",
  ]);
  const numeroGuia = primerTextoPortal(datos, [
    "numero_guia",
    "numeroGuia",
    "nro_guia",
    "nroGuia",
    "guia",
    "folio",
  ]);
  const codigoAutorizacion = primerTextoPortal(datos, [
    "codigo_autorizacion",
    "codigoAutorizacion",
    "cod_autorizacion",
    "codAutorizacion",
    "autorizacion",
  ]);

  if (errorPortal) {
    return { ok: false, motivo: errorPortal, datos };
  }

  if (numeroGuia || codigoAutorizacion) {
    return {
      ok: true,
      numeroGuia: numeroGuia || null,
      codigoAutorizacion: codigoAutorizacion || null,
      mensaje:
        primerTextoPortal(datos, ["mensaje", "message", "userMessage"]) ||
        "Guía creada correctamente.",
      datos,
    };
  }

  return {
    ok: false,
    motivo:
      "El Portal TCT/TAE respondió sin número de guía ni código de autorización. Revisa en el portal si la guía quedó emitida antes de reintentar.",
    datos,
  };
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

  if (!subproducto) {
    throw new Error("Portal TCT/TAE no devolvió el producto diésel para la guía.");
  }

  return {
    cliente,
    tarjeta,
    subproducto,
    flete: numero(fletePayload?.data?.flete),
  };
}

async function tomarBloqueoGuiaCoseducam({ guiaPrevia, fecha, codigoEds, litros }) {
  const ahora = new Date().toISOString();
  const fila = {
    fecha,
    codigo_eds: codigoEds,
    rut_cliente: RUT_COSEDUCAM_FORMATEADO,
    litros,
    estado: "procesando",
    mensaje: "Solicitando autorización al Portal TCT/TAE.",
    numero_guia: null,
    codigo_autorizacion: null,
    respuesta_autorizacion: { autorizacionEnviada: false, iniciadoEn: ahora },
    respuesta_confirmacion: null,
    creada_en: null,
    confirmada_en: null,
    sincronizado_en: ahora,
  };

  if (guiaPrevia) {
    // Se reutiliza la fila del intento fallido en lugar de rechazar la fecha.
    // El `eq("estado", ...)` actua como bloqueo optimista: si otro proceso ya
    // la tomo, esta actualizacion no afecta ninguna fila.
    const { data, error } = await supabaseAdmin
      .from("coseducam_guias")
      .update(fila)
      .eq("id", guiaPrevia.id)
      .eq("estado", guiaPrevia.estado)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo reutilizar el intento anterior: ${error.message}`
      );
    }

    if (!data) {
      const conflicto = new Error(
        "Otra creación tomó esta fecha hace un instante. Actualiza la pantalla y revisa el estado antes de reintentar."
      );
      conflicto.status = 409;
      throw conflicto;
    }

    return { id: data.id, reutilizada: true };
  }

  const { data, error } = await supabaseAdmin
    .from("coseducam_guias")
    .insert(fila)
    .select("id")
    .single();

  if (error) {
    const conflicto = new Error(
      error.code === "23505"
        ? "Ya hay una creación en curso para esta fecha. Espera a que termine y actualiza la pantalla."
        : `No se pudo iniciar la guía: ${error.message}`
    );
    conflicto.status = error.code === "23505" ? 409 : 500;
    throw conflicto;
  }

  return { id: data.id, reutilizada: false };
}

async function registrarFalloGuiaCoseducam({ id, error, contexto, auditoria }) {
  const mensaje =
    error instanceof Error ? error.message : "Error al crear la guía.";
  const ahora = new Date().toISOString();
  const { error: errorRegistro } = await supabaseAdmin
    .from("coseducam_guias")
    .update({
      estado: "revision_requerida",
      mensaje,
      respuesta_autorizacion: {
        ...auditoria,
        // Dato clave del reintento: si el portal nunca recibio la solicitud, no
        // hay ninguna guia emitida y reintentar es seguro. Si alcanzo a
        // recibirla, la interfaz pide una confirmacion explicita.
        autorizacionEnviada: contexto.autorizacionEnviada,
        error: mensaje,
        fallidoEn: ahora,
        respuesta: contexto.respuesta ?? null,
      },
      sincronizado_en: ahora,
    })
    .eq("id", id);

  if (errorRegistro) {
    console.error(
      "No se pudo registrar el fallo de la guía Coseducam:",
      errorRegistro
    );
  }

  if (error instanceof Error) {
    error.autorizacionEnviada = contexto.autorizacionEnviada;
    error.puedeReintentar = true;
  }
}

async function crearGuiaCoseducam(request) {
  const fecha = normalizarFecha(request.body?.fecha);
  const codigoEds = codigoEdsCoseducam(request.body?.codigoEds);
  const confirmarPrecioObservado =
    request.body?.confirmarPrecioObservado === true;
  const confirmarLitros = request.body?.confirmarLitros === true;
  const forzarReintento = request.body?.forzarReintento === true;
  const litrosEsperadosCrudos = Number(request.body?.litrosEsperados);
  const litrosEsperados = Number.isFinite(litrosEsperadosCrudos)
    ? Math.trunc(litrosEsperadosCrudos)
    : null;

  if (!fecha) {
    const error = new Error(
      "Falta una fecha válida. Usa el formato AAAA-MM-DD."
    );
    error.status = 400;
    throw error;
  }

  if (!codigoEds) {
    const error = new Error("Falta el código de la estación.");
    error.status = 400;
    throw error;
  }

  // 1. Litros del día. Mismo filtro y mismo redondeo que usa la vista mensual.
  const ventas = await leerTabla(
    "recompra_ventas",
    "fecha, codigo_eds, transaccion_id, transaccion_codigo, forma_pago, producto, cantidad, datos_origen",
    fecha,
    fecha
  );
  const ventasElegibles = seleccionarVentasCoseducam(ventas, codigoEds);
  const consumo = calcularConsumoCoseducam(ventasElegibles);
  const litrosCalculados = consumo.litros;
  const litros = consumo.litrosGuia;

  if (litrosCalculados <= 0) {
    const error = new Error(
      `No hay litros STORAGE diésel de Coseducam el ${fechaChilena(
        fecha
      )} en la estación ${codigoEds}. Importa primero los litros del día.`
    );
    error.status = 400;
    throw error;
  }

  if (litros <= 0) {
    const error = new Error(
      `El consumo del día es ${litrosCalculados.toLocaleString(
        "es-CL"
      )} L y redondea a 0 litros enteros, por lo que no puede emitirse una guía.`
    );
    error.status = 400;
    throw error;
  }

  // 2. Red de seguridad: los litros enteros que vio el operador deben ser los
  // mismos que va a solicitar el servidor. Nunca se emite una guía por una
  // cantidad distinta a la que se mostró en pantalla.
  if (
    litrosEsperados !== null &&
    litrosEsperados !== litros &&
    !confirmarLitros
  ) {
    const error = new Error(
      `Los litros cambiaron desde que se cargó la pantalla: ahora corresponden ${litros.toLocaleString(
        "es-CL"
      )} L enteros y no ${litrosEsperados.toLocaleString(
        "es-CL"
      )} L. Confirma el nuevo total para continuar.`
    );
    error.status = 409;
    error.requiereConfirmacionLitros = true;
    error.litrosGuia = litros;
    error.litrosEsperados = litrosEsperados;
    error.litrosCalculados = litrosCalculados;
    throw error;
  }

  // 3. Estado del día. Solo una guía realmente emitida bloquea la fecha.
  const guiasDelDia = await leerGuiasCoseducam(fecha, fecha);
  const guiaPrevia = seleccionarGuiaCoseducam(guiasDelDia, fecha, codigoEds);

  if (guiaPrevia && ESTADOS_GUIA_EMITIDA.has(guiaPrevia.estado)) {
    const error = new Error(
      `El ${fechaChilena(fecha)} ya tiene la guía ${
        guiaPrevia.numero_guia || "emitida"
      } en estado ${guiaPrevia.estado}. No se creó otra.`
    );
    error.status = 409;
    error.guiaExistente = {
      id: guiaPrevia.id,
      estado: guiaPrevia.estado,
      numeroGuia: guiaPrevia.numero_guia,
      litros: numero(guiaPrevia.litros),
    };
    throw error;
  }

  if (guiaPrevia && guiaPrevia.estado === "procesando" && !procesandoVencido(guiaPrevia)) {
    const error = new Error(
      `Hay una creación en curso para el ${fechaChilena(
        fecha
      )}. Espera hasta ${MINUTOS_PROCESANDO_VENCIDO} minutos y vuelve a intentarlo; no se creará una guía duplicada.`
    );
    error.status = 409;
    throw error;
  }

  // Un intento anterior que sí alcanzó a enviar la autorización podría haber
  // dejado una guía emitida en Copec. Ese es el único caso que exige una
  // decisión explícita del operador antes de repetir la solicitud.
  if (guiaPrevia && autorizacionFueEnviada(guiaPrevia) && !forzarReintento) {
    const error = new Error(
      `El intento anterior del ${fechaChilena(
        fecha
      )} alcanzó a enviar la autorización al Portal TCT/TAE y terminó con: "${
        guiaPrevia.mensaje || "sin detalle"
      }". Revisa en el portal si la guía quedó emitida antes de reintentar.`
    );
    error.status = 409;
    error.requiereConfirmacionReintento = true;
    error.autorizacionEnviada = true;
    error.mensajeIntentoAnterior = guiaPrevia.mensaje || null;
    throw error;
  }

  // 4. Precio observado del día.
  const preciosObservados = await leerPreciosDieselObservados(fecha, fecha);
  const precioObservado = Math.round(
    numero(preciosObservados.get(fecha)?.precio)
  );

  if (precioObservado <= 0) {
    const error = new Error(
      "No existe un precio diésel observado para esta fecha. Sincroniza primero las ventas CopecFuel del día."
    );
    error.status = 409;
    error.requiereSincronizacionPrecio = true;
    throw error;
  }

  // 5. Configuración del portal. Todo lo que puede fallar aquí ocurre antes de
  // tomar el bloqueo, de modo que un error de red o de configuración jamás
  // deja la fecha inutilizable.
  const configuracion = await obtenerConfiguracionGuiaCoseducam(codigoEds);
  const precioPortal = Math.round(numero(configuracion.subproducto.precio));
  const precioNoCoincide = precioPortal !== precioObservado;

  if (precioNoCoincide && !confirmarPrecioObservado) {
    const error = new Error(
      `El precio propuesto por Portal TCT/TAE ($${precioPortal.toLocaleString(
        "es-CL"
      )}) no coincide con el precio observado ($${precioObservado.toLocaleString(
        "es-CL"
      )}). Confirma el reemplazo para continuar.`
    );
    error.status = 409;
    error.requiereConfirmacionPrecio = true;
    error.precioPortal = precioPortal;
    error.precioObservado = precioObservado;
    throw error;
  }

  const bloqueo = await tomarBloqueoGuiaCoseducam({
    guiaPrevia,
    fecha,
    codigoEds,
    litros,
  });
  // La guía siempre utiliza el precio observado calculado desde ventas
  // asistidas. El precio sugerido por Portal TCT/TAE se conserva para
  // auditoría.
  const precio = precioObservado;
  const auditoria = {
    litrosCalculados,
    litrosGuia: litros,
    reglaRedondeo: "0,5 o superior hacia arriba; menor a 0,5 hacia abajo",
    precioPortal,
    precioObservado,
    precioAplicado: precio,
    precioReemplazado: precioNoCoincide,
    codigoEds,
    reutilizoIntentoAnterior: bloqueo.reutilizada,
  };
  const contexto = { autorizacionEnviada: false, respuesta: null };

  try {
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
      // Litros y monto salen del mismo entero: el portal no recibe decimales.
      monto: Math.round(litros * precio),
      unidad: String(litros),
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

    auditoria.payload = payloadAutorizacion;
    // A partir de esta línea la solicitud puede haber llegado a Copec. La
    // marca se guarda ANTES de enviarla: si la función muere durante la
    // llamada, la fila conserva la evidencia y el reintento pedirá una
    // confirmación explícita en lugar de arriesgar una guía duplicada.
    contexto.autorizacionEnviada = true;

    await supabaseAdmin
      .from("coseducam_guias")
      .update({
        respuesta_autorizacion: {
          ...auditoria,
          autorizacionEnviada: true,
          solicitadoEn: new Date().toISOString(),
        },
        sincronizado_en: new Date().toISOString(),
      })
      .eq("id", bloqueo.id);

    const respuestaAutorizacion = await solicitarTctTae("/autorizar-consumo", {
      method: "POST",
      body: JSON.stringify(payloadAutorizacion),
    });

    contexto.respuesta = respuestaAutorizacion;

    const resultado = interpretarAutorizacionTctTae(respuestaAutorizacion);

    if (!resultado.ok) {
      throw new Error(resultado.motivo);
    }

    const { error: errorActualizacion } = await supabaseAdmin
      .from("coseducam_guias")
      .update({
        estado: "creada",
        litros,
        numero_guia: resultado.numeroGuia,
        codigo_autorizacion: resultado.codigoAutorizacion,
        mensaje: resultado.mensaje,
        respuesta_autorizacion: {
          ...auditoria,
          autorizacionEnviada: true,
          respuesta: respuestaAutorizacion,
        },
        creada_en: new Date().toISOString(),
        sincronizado_en: new Date().toISOString(),
      })
      .eq("id", bloqueo.id);

    if (errorActualizacion) {
      // La guía existe en Copec: se informa el número para que no se pierda,
      // aunque el registro local haya fallado.
      const error = new Error(
        `La guía ${
          resultado.numeroGuia || resultado.codigoAutorizacion
        } fue autorizada en Copec, pero no pudo registrarse en VALEPAC Connect: ${
          errorActualizacion.message
        }`
      );
      error.numeroGuia = resultado.numeroGuia;
      error.codigoAutorizacion = resultado.codigoAutorizacion;
      throw error;
    }

    return {
      fecha,
      codigoEds,
      litros,
      litrosCalculados,
      numeroGuia: resultado.numeroGuia,
      codigoAutorizacion: resultado.codigoAutorizacion,
      mensaje: resultado.mensaje,
      precioPortal,
      precioObservado,
      precioAplicado: precio,
      precioReemplazado: precioNoCoincide,
      reutilizoIntentoAnterior: bloqueo.reutilizada,
    };
  } catch (error) {
    await registrarFalloGuiaCoseducam({
      id: bloqueo.id,
      error,
      contexto,
      auditoria,
    });

    throw error;
  }
}

async function solicitarMonitorEntregaEnRuta(body, { reintentar = false } = {}) {
  const intentos = reintentar ? 2 : 1;
  let ultimoError;

  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      const respuesta = await fetch(
        `${ENRUTA_BASE_URL}/fetch/elementos/f_MonitorEntrega.aspx`,
        {
          method: "POST",
          headers: {
            Accept: "*/*",
            "Content-Type":
              "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: ENRUTA_BASE_URL,
            Referer: `${ENRUTA_BASE_URL}/MonitorEntrega.aspx`,
            "X-Requested-With": "XMLHttpRequest",
          },
          body: body.toString(),
        }
      );
      const texto = await respuesta.text();

      if (!respuesta.ok) {
        const error = new Error(
          `Copec en Ruta rechazó la solicitud con estado ${respuesta.status}.`
        );
        error.status = respuesta.status;
        throw error;
      }

      return texto;
    } catch (error) {
      ultimoError = error;
      const puedeReintentar =
        intento < intentos &&
        (!error?.status || [502, 503, 504].includes(error.status));

      if (!puedeReintentar) throw error;
    }
  }

  throw ultimoError;
}

function separarRespuestaEnRuta(texto) {
  return String(texto || "")
    .replace(/Â§/g, "§")
    .split("§")
    .map((valor) => valor.trim());
}

async function buscarPedidoEnRuta({ numeroGuia, codigoEds }) {
  const consultar = async (guia, permitirRespuestaNoJson = false) => {
    const texto = await solicitarMonitorEntregaEnRuta(
      new URLSearchParams({
        accion: "gMonitorPedido",
        hr: "",
        pedido: "",
        destinatario: "",
        estacion: codigoEds,
        guia,
        fini: "",
        ffini: "",
        usuario: codigoEds,
        _search: "false",
        nd: String(Date.now()),
        rows: "100",
        page: "1",
        sidx: "CONVERT(DATETIME,FECHA,105)",
        sord: "desc",
      }),
      { reintentar: true }
    );

    try {
      const payload = JSON.parse(texto);
      return lista(payload?.rows);
    } catch {
      // El filtro por guia del portal contiene un defecto SQL y puede
      // responder `0§Incorrect syntax...`. Esa respuesta no significa que la
      // guia no exista: se continua con la bandeja completa de la EDS.
      if (permitirRespuestaNoJson) return [];

      throw new Error(
        "Copec en Ruta respondió sin el listado esperado de guías."
      );
    }
  };
  const encontrar = (filas) =>
    filas.find(
      (fila) =>
        String(fila?.GUIA || "").trim() === numeroGuia &&
        // En Ruta puede escribir la estacion con ceros a la izquierda.
        mismaEds(fila?.ESTACION, codigoEds)
    );
  let pedido = encontrar(await consultar(numeroGuia, true));

  // El portal no siempre aplica el filtro `guia`. Si no devuelve el pedido,
  // se consulta la bandeja reciente de la EDS y se busca la coincidencia
  // exacta. La validacion posterior de RUT, cliente, producto y litros sigue
  // siendo obligatoria antes de confirmar.
  if (!pedido) pedido = encontrar(await consultar(""));

  if (!pedido?.NUMEROPEDIDO) {
    const error = new Error(
      `La guía ${numeroGuia} aún no aparece pendiente en Copec en Ruta. Intenta nuevamente cuando se encuentre disponible.`
    );
    error.status = 409;
    throw error;
  }

  return pedido;
}

async function obtenerDetallePedidoEnRuta(numeroPedido) {
  const texto = await solicitarMonitorEntregaEnRuta(
    new URLSearchParams({
      accion: "infoModificar",
      id: numeroPedido,
    }),
    { reintentar: true }
  );
  const partes = separarRespuestaEnRuta(texto);

  if (partes[0] !== "1" || partes.length < 21) {
    throw new Error(
      "Copec en Ruta no devolvió los datos completos de la guía."
    );
  }

  return {
    rut: partes[1],
    razon: partes[2],
    guia: partes[5],
    tarjeta: partes[6],
    codigoCliente: partes[7],
    codigoProducto: partes[8],
    volumen: numeroChile(partes[9]),
    precio: numeroChile(partes[10]),
    monto: numeroChile(partes[11]),
    direccion: partes[12],
    comunaTexto: partes[13],
    flete: numeroChile(partes[14]),
    comuna: partes[15],
    codigoInstalacion: partes[16],
    responsable: partes[17],
    fechaAutorizacion: partes[18],
    horaAutorizacion: partes[19],
    codigoAutorizacion: partes[20],
  };
}

function validarPedidoCoseducam({ guia, pedido, detalle }) {
  if (normalizarRut(detalle.rut) !== RUT_COSEDUCAM) {
    throw new Error(
      "La guía localizada en Copec en Ruta no pertenece al RUT de Coseducam. No se confirmó."
    );
  }

  if (!normalizarTexto(detalle.razon).includes("COSEDUCAM")) {
    throw new Error(
      "La razón social de la guía no corresponde a Coseducam. No se confirmó."
    );
  }

  if (
    normalizarTexto(pedido?.PRODUCTO) !== "D" &&
    !normalizarTexto(pedido?.PRODUCTO).includes("DIESEL")
  ) {
    throw new Error("La guía localizada no corresponde a diésel.");
  }

  if (
    String(detalle.guia || "").trim() !== String(guia.numero_guia).trim()
  ) {
    throw new Error("El número de guía de En Ruta no coincide con Coseducam.");
  }

  if (!String(detalle.codigoAutorizacion || "").trim()) {
    throw new Error(
      "Copec en Ruta no informó el código interno de autorización de la guía."
    );
  }

  const litrosGuia = redondearLitrosGuia(guia.litros);
  const litrosRegistrados = redondearLitros(guia.litros);
  const volumen = redondearLitros(detalle.volumen);
  // Se acepta el entero de la guía y también el valor tal cual quedó guardado,
  // para que las guías creadas antes del redondeo entero sigan confirmándose.
  const coincide =
    Math.abs(volumen - litrosGuia) <= 0.01 ||
    Math.abs(volumen - litrosRegistrados) <= 0.01;

  if (!coincide) {
    throw new Error(
      `Los litros de En Ruta (${detalle.volumen}) no coinciden con los ${litrosGuia} litros enteros de la guía Coseducam.`
    );
  }
}

async function confirmarGuiaCoseducam(request) {
  const guiaId = String(request.body?.guiaId || "").trim();

  if (!guiaId) {
    const error = new Error("Falta identificar la guía Coseducam a confirmar.");
    error.status = 400;
    throw error;
  }

  const { data: guia, error: errorGuia } = await supabaseAdmin
    .from("coseducam_guias")
    .select(
      "id, fecha, codigo_eds, rut_cliente, litros, estado, numero_guia, codigo_autorizacion"
    )
    .eq("id", guiaId)
    .maybeSingle();

  if (errorGuia) {
    throw new Error(`No se pudo leer la guía Coseducam: ${errorGuia.message}`);
  }

  if (!guia) {
    const error = new Error("La guía Coseducam indicada no existe.");
    error.status = 404;
    throw error;
  }

  if (guia.estado === "confirmada") {
    return {
      fecha: guia.fecha,
      numeroGuia: guia.numero_guia,
      yaConfirmada: true,
      mensaje: "La guía ya estaba confirmada en Copec en Ruta.",
    };
  }

  if (guia.estado !== "creada") {
    const error = new Error(
      `La guía se encuentra en estado ${guia.estado} y no puede confirmarse.`
    );
    error.status = 409;
    throw error;
  }

  if (
    normalizarRut(guia.rut_cliente) !== RUT_COSEDUCAM ||
    !guia.numero_guia ||
    !guia.codigo_autorizacion
  ) {
    const error = new Error(
      "La guía guardada no contiene la identificación completa de Coseducam."
    );
    error.status = 409;
    throw error;
  }

  const numeroGuia = String(guia.numero_guia).trim();
  const codigoEds = String(guia.codigo_eds).trim();
  const pedido = await buscarPedidoEnRuta({ numeroGuia, codigoEds });
  const numeroPedido = String(pedido.NUMEROPEDIDO).trim();
  const detalle = await obtenerDetallePedidoEnRuta(numeroPedido);

  validarPedidoCoseducam({ guia, pedido, detalle });

  // Este es el unico llamado que modifica Copec en Ruta. No se reintenta
  // automaticamente para evitar confirmar dos veces ante una respuesta dudosa.
  const textoConfirmacion = await solicitarMonitorEntregaEnRuta(
    new URLSearchParams({
      accion: "modificarPedido",
      codclie: detalle.codigoCliente,
      codauto: detalle.codigoAutorizacion,
      comuna: detalle.comuna,
      flete: String(detalle.flete),
      desinta: detalle.responsable,
      despro: "DIESEL",
      direccion: detalle.direccion,
      fechaauto: detalle.fechaAutorizacion,
      horaauto: detalle.horaAutorizacion,
      codinsta: detalle.codigoInstalacion,
      pedido: numeroPedido,
      guia: numeroGuia,
      precio: String(detalle.precio),
      codprod: detalle.codigoProducto || "001",
      razon: detalle.razon,
      rut: detalle.rut,
      tarjeta: detalle.tarjeta,
      volumen: String(detalle.volumen),
      tipo: String(process.env.COSEDUCAM_ENRUTA_TIPO || "5"),
      patente: "",
      email: "",
      rutr: "",
    })
  );
  const partesConfirmacion = separarRespuestaEnRuta(textoConfirmacion);

  if (
    partesConfirmacion[0] !== "1" ||
    !normalizarTexto(partesConfirmacion.slice(1).join(" ")).includes(
      "CONFIRMACION EXITOSA"
    )
  ) {
    const error = new Error(
      partesConfirmacion.slice(1).join(" ") ||
        "Copec en Ruta no confirmó la guía."
    );
    error.status = 502;
    throw error;
  }

  const confirmadoEn = new Date().toISOString();
  const respuestaConfirmacion = {
    fuente: "COPEC_EN_RUTA",
    cliente: { rut: detalle.rut, razonSocial: detalle.razon },
    pedido: numeroPedido,
    guia: numeroGuia,
    codigoAutorizacionTctTae: guia.codigo_autorizacion,
    codigoAutorizacionEnRuta: detalle.codigoAutorizacion,
    codigosCoinciden:
      String(guia.codigo_autorizacion || "").trim() ===
      String(detalle.codigoAutorizacion || "").trim(),
    litros: detalle.volumen,
    respuesta: partesConfirmacion.slice(1).join(" "),
    confirmadoEn,
  };
  const mensaje = "Guía Coseducam confirmada correctamente en Copec en Ruta.";
  const { error: errorActualizacion } = await supabaseAdmin
    .from("coseducam_guias")
    .update({
      estado: "confirmada",
      mensaje,
      respuesta_confirmacion: respuestaConfirmacion,
      confirmada_en: confirmadoEn,
      sincronizado_en: confirmadoEn,
    })
    .eq("id", guia.id);

  if (errorActualizacion) {
    throw new Error(
      `La guía fue confirmada en En Ruta, pero no pudo registrarse en VALEPAC Connect: ${errorActualizacion.message}`
    );
  }

  return {
    fecha: guia.fecha,
    numeroGuia,
    numeroPedido,
    mensaje,
  };
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
    // Regla Muevo Empresa: usar solo el campo `total` de la linea oficial.
    // Los demás totales y la propina se conservan dentro del JSON original,
    // pero no participan en este cálculo.
    const monto = numero(fila.total ?? fila.montoBruto ?? fila.monto);

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
        montoBruto: monto,
        montoConciliable: monto,
        campoMontoConciliacion: "total",
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
      (total, venta) => total + numero(venta.monto),
      0
    ),
    totalPropinas: 0,
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
    total: numero(fila.total),
    montoBruto: numero(fila.total),
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
  // Muevo Empresa y Recompra conservan su universo de combustible. Las
  // ventas de productos se incorporan solamente al resumen CopecFuel y a la
  // conciliacion general de abonos.
  const filasDetalle = ventasOficiales.filasCombustible;
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

  const acceso = await requireCoseducam(request, response);

  if (!acceso) return;

  const esOperadorCoseducam = acceso.rol === "operador_coseducam";
  const tipoSolicitado = String(request.query?.tipo || "").trim();
  const accionSolicitada = String(request.body?.accion || "").trim();
  const accionesOperador = new Set([
    "sincronizar_copecfuel",
    "crear_guia_coseducam",
    "reintentar_guia_coseducam",
    "confirmar_guia_coseducam",
  ]);

  try {
    if (request.method === "GET" && request.query?.recurso === "sesion_coseducam") {
      return response.status(200).json({
        ok: true,
        usuario: {
          id: acceso.usuario.id,
          email: acceso.usuario.email,
          rol: acceso.rol,
        },
      });
    }

    if (
      esOperadorCoseducam &&
      ((request.method === "GET" && tipoSolicitado !== "coseducam") ||
        (request.method === "POST" && !accionesOperador.has(accionSolicitada)))
    ) {
      return response.status(403).json({
        ok: false,
        code: "COSEDUCAM_SCOPE_FORBIDDEN",
        error: "Esta cuenta solo puede utilizar las funciones de Coseducam.",
      });
    }

    if (request.method === "GET") {
      const periodo = String(request.query.periodo || "").trim();
      const tipo = String(request.query.tipo || "").trim();
      const esRecompra = tipo === "recompra";
      const esCoseducam = tipo === "coseducam";
      const resultado = esCoseducam
        ? await obtenerMesCoseducam(periodo, request.query?.codigoEds)
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
          ? "Litros diesel vendidos con medio de pago STORAGE al cliente Coseducam, agrupados por dia. El precio observado es la moda diaria del precio Diesel en operaciones asistidas."
          : esRecompra
          ? "Abonos Recompra del Portal Copec menos el costo vigente de los litros netos: ventas Recompra - Volumen Propio + fluctuación de VCTG38/VCTG39 + TCT/TAE manual Diésel. BlueMax queda excluido."
          : "Cargos Consumo Muevo Empresa del Portal Copec menos la suma del campo total de las ventas emitidas por Copec pagadas en efectivo, credito o debito.",
      });
    }

    if (request.method === "POST") {
      if (
        request.body?.accion === "crear_guia_coseducam" ||
        request.body?.accion === "reintentar_guia_coseducam"
      ) {
        // Reintentar es la misma creación: reutiliza la fila del intento
        // fallido en vez de dejar la fecha bloqueada.
        const esReintento =
          request.body.accion === "reintentar_guia_coseducam";
        const resultado = await crearGuiaCoseducam({
          ...request,
          body: esReintento
            ? { ...request.body, forzarReintento: true }
            : request.body,
        });

        return response.status(200).json({
          ok: true,
          mensaje: resultado.mensaje || "Guia Coseducam creada correctamente.",
          reintento: esReintento,
          ...resultado,
        });
      }

      if (request.body?.accion === "confirmar_guia_coseducam") {
        const resultado = await confirmarGuiaCoseducam(request);

        return response.status(200).json({
          ok: true,
          mensaje: resultado.mensaje,
          ...resultado,
        });
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
      requiereConfirmacionPrecio: Boolean(error?.requiereConfirmacionPrecio),
      requiereSincronizacionPrecio: Boolean(error?.requiereSincronizacionPrecio),
      requiereConfirmacionLitros: Boolean(error?.requiereConfirmacionLitros),
      requiereConfirmacionReintento: Boolean(
        error?.requiereConfirmacionReintento
      ),
      autorizacionEnviada: Boolean(error?.autorizacionEnviada),
      puedeReintentar: Boolean(error?.puedeReintentar),
      tiempoAgotado: Boolean(error?.tiempoAgotado),
      precioPortal:
        Number.isFinite(error?.precioPortal) ? error.precioPortal : undefined,
      precioObservado:
        Number.isFinite(error?.precioObservado)
          ? error.precioObservado
          : undefined,
      litrosGuia: Number.isFinite(error?.litrosGuia)
        ? error.litrosGuia
        : undefined,
      litrosEsperados: Number.isFinite(error?.litrosEsperados)
        ? error.litrosEsperados
        : undefined,
      litrosCalculados: Number.isFinite(error?.litrosCalculados)
        ? error.litrosCalculados
        : undefined,
      numeroGuia: error?.numeroGuia || undefined,
      codigoAutorizacion: error?.codigoAutorizacion || undefined,
      guiaExistente: error?.guiaExistente || undefined,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible procesar Cargos Muevo empresa.",
    });
  }
}

// La creación de la guía encadena login Copec, cuatro consultas al Portal
// TCT/TAE y la autorización. Con el límite por defecto la plataforma podía
// cortar la función a mitad de camino y dejar la fecha en `procesando`.
export const config = {
  maxDuration: 60,
};
