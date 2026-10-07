import { supabaseAdmin } from "../../api/_lib/supabaseAdmin.js";

const TAMANO_PAGINA = 1000;
const RUT_VALENCIA_PACHECO = "782298208";
const RAZON_VALENCIA_PACHECO = "VALENCIA Y PACHECO LIMITADA";
const MEDIOS_PAGO_M2 = new Set([
  "CREDITO DOCUMENTADO",
  "RUTPAY",
  "RUT PAY",
  "BILLETERA BANCO ESTADO",
  "TARJETA DE CREDITO",
  "TARJETA DE DEBITO",
  "EFECTIVO",
  "DINERO",
  "APP COPEC",
]);

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

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

function normalizarFecha(valor) {
  const texto = String(valor || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const digitos = texto.replace(/\D/g, "");
  return digitos.length >= 8
    ? `${digitos.slice(0, 4)}-${digitos.slice(4, 6)}-${digitos.slice(6, 8)}`
    : null;
}

function clasificarProducto(valor) {
  const producto = normalizarTexto(valor);
  if (producto.includes("BLUEMAX") || producto.includes("BLUE MAX")) return "BLUEMAX";
  if (producto.includes("DIESEL")) return "DIESEL";
  for (const octanaje of ["93", "95", "97"]) {
    if (new RegExp(`(^| )${octanaje}( |$)`).test(producto)) {
      return `GASOLINA ${octanaje}`;
    }
  }
  return null;
}

function esValenciaPacheco(fila) {
  const rut = normalizarRut(fila.clienteRut || fila.rutEmisor || fila.rut_emisor);
  const razon = normalizarTexto(
    fila.clienteRazonSocial || fila.razonSocialEmisor || fila.razon_social_emisor
  );
  return rut === RUT_VALENCIA_PACHECO || razon === RAZON_VALENCIA_PACHECO;
}

function clasificarMedioPago(valor) {
  const medio = normalizarTexto(valor);
  if (!MEDIOS_PAGO_M2.has(medio)) return null;
  if (["RUTPAY", "RUT PAY", "BILLETERA BANCO ESTADO"].includes(medio)) {
    return "RUTPAY / BILLETERA BANCO ESTADO";
  }
  if (medio === "CREDITO DOCUMENTADO") {
    return "CREDITO DOCUMENTADO";
  }
  if (["EFECTIVO", "DINERO"].includes(medio)) {
    return "EFECTIVO / DINERO";
  }
  return medio;
}

function tipoOperacion(fila) {
  const operacion = normalizarTexto(fila.operacionTipo);
  if (operacion === "AUTOSERVICIO") return "AUTOSERVICIO";
  return "ASISTIDA";
}

function segmentoCliente(fila) {
  return normalizarTexto(fila.autorizadorFidelidadNombre) === "TAXI AMIGO"
    ? "TAXI_AMIGO"
    : "NORMAL";
}

export async function guardarVentasM2(filas, opciones = {}) {
  const fechaForzada = normalizarFecha(opciones.fecha);
  const registros = new Map();
  const diagnostico = {
    recibidas: Array.isArray(filas) ? filas.length : 0,
    elegibles: 0,
    excluidas: {
      fecha: 0,
      producto: 0,
      medioPago: 0,
      transaccionId: 0,
      emisor: 0,
      litros: 0,
      precioVenta: 0,
    },
    mediosPagoNoM2: {},
  };

  for (const fila of Array.isArray(filas) ? filas : []) {
    const fecha = fechaForzada || normalizarFecha(fila.fecha);
    const producto = clasificarProducto(
      fila.productoDescripcion || fila.productoNombre || fila.producto
    );
    const medioPagoOriginal = normalizarTexto(fila.formaPagoNombre || fila.formaPago);
    const medioPago = clasificarMedioPago(medioPagoOriginal);
    const transaccionId = String(fila.transaccionId || "").trim();
    const productoId = String(fila.productoId || "").trim();
    const litros = numero(fila.cantidad);
    const precioVenta = numero(fila.precio);

    if (!fecha) { diagnostico.excluidas.fecha += 1; continue; }
    if (!producto) { diagnostico.excluidas.producto += 1; continue; }
    if (!medioPago) {
      diagnostico.excluidas.medioPago += 1;
      const clave = medioPagoOriginal || "SIN MEDIO";
      diagnostico.mediosPagoNoM2[clave] = (diagnostico.mediosPagoNoM2[clave] || 0) + 1;
      continue;
    }
    if (!transaccionId) { diagnostico.excluidas.transaccionId += 1; continue; }
    if (!esValenciaPacheco(fila)) { diagnostico.excluidas.emisor += 1; continue; }
    if (litros <= 0) { diagnostico.excluidas.litros += 1; continue; }
    if (precioVenta <= 0) { diagnostico.excluidas.precioVenta += 1; continue; }

    diagnostico.elegibles += 1;

    const identificador = [
      "m2-venta-v1",
      transaccionId,
      productoId || producto,
      String(fila.surtidorId || ""),
      litros.toFixed(3),
    ].join("|");

    registros.set(identificador, {
      identificador_origen: identificador,
      fecha,
      codigo_eds: String(opciones.codigoEds || fila.codigoEds || "40098").trim(),
      transaccion_id: transaccionId,
      transaccion_codigo: String(fila.transaccionCodigo || "").trim() || null,
      producto_id: productoId || null,
      producto,
      litros,
      precio_venta: precioVenta,
      medio_pago: medioPago,
      tipo_venta: tipoOperacion(fila),
      segmento_cliente: segmentoCliente(fila),
      tipo_documento: String(fila.tipoDocumento || "").trim() || null,
      descripcion_documento: String(fila.descripcionDocumento || "").trim() || null,
      folio: String(fila.folio || "").trim() || null,
      rut_emisor: "78.229.820-8",
      razon_social_emisor: RAZON_VALENCIA_PACHECO,
      autorizador_fidelidad: String(fila.autorizadorFidelidadNombre || "").trim() || null,
      datos_origen: fila,
      sincronizado_en: new Date().toISOString(),
    });
  }

  const ventas = [...registros.values()];

  if (opciones.reemplazarFecha) {
    let eliminacion = supabaseAdmin
      .from("m2_ventas")
      .delete()
      .eq("fecha", opciones.reemplazarFecha);

    if (opciones.codigoEds) eliminacion = eliminacion.eq("codigo_eds", opciones.codigoEds);
    const { error } = await eliminacion;
    if (error) throw new Error(`No se pudo reemplazar M2 del día: ${error.message}`);
  }

  if (ventas.length > 0) {
    const { error } = await supabaseAdmin
      .from("m2_ventas")
      .upsert(ventas, { onConflict: "identificador_origen" });
    if (error) throw new Error(`No se pudieron guardar ventas M2: ${error.message}`);
  }

  return {
    ventasRecibidas: Array.isArray(filas) ? filas.length : 0,
    ventasGuardadas: ventas.length,
    litrosGuardados: ventas.reduce((total, venta) => total + numero(venta.litros), 0),
    diagnostico,
  };
}

function rangoMes(periodo) {
  const match = String(periodo || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const anio = Number(match[1]);
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) return null;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(ultimo).padStart(2, "0")}`;
  return { desde, hasta };
}

async function leerVentas(desde, hasta) {
  const registros = [];
  let inicio = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("m2_ventas")
      .select("fecha,codigo_eds,transaccion_id,producto,litros,precio_venta,medio_pago,tipo_venta,segmento_cliente,tipo_documento,descripcion_documento,folio")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + TAMANO_PAGINA - 1);
    if (error) throw new Error(`No se pudieron leer las ventas M2: ${error.message}`);
    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }
  return registros;
}

async function leerPreciosCosto(hasta) {
  const { data, error } = await supabaseAdmin
    .from("copec_precios_costo")
    .select("codigo_eds,fecha_vigencia,localidad,gas_93sp,gas_95sp,gas_97sp,diesel_pdua1")
    .lte("fecha_vigencia", hasta)
    .order("fecha_vigencia", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los precios costo M2: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

async function leerCostosBlueMax(hasta) {
  const { data, error } = await supabaseAdmin
    .from("m2_bluemax_costos")
    .select("codigo_eds,fecha_vigencia,precio_costo")
    .lte("fecha_vigencia", hasta)
    .order("fecha_vigencia", { ascending: true });
  if (error) {
    if (String(error.message || "").includes("m2_bluemax_costos")) return [];
    throw new Error(`No se pudieron leer los costos BlueMax M2: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
}

function campoCosto(producto) {
  if (producto === "DIESEL") return "diesel_pdua1";
  if (producto === "GASOLINA 93") return "gas_93sp";
  if (producto === "GASOLINA 95") return "gas_95sp";
  if (producto === "GASOLINA 97") return "gas_97sp";
  return null;
}

function costoVigente(venta, precios, costosBlueMax) {
  if (venta.producto === "BLUEMAX") {
    const vigente = costosBlueMax
      .filter(
        (precio) =>
          String(precio.codigo_eds || "") === String(venta.codigo_eds || "") &&
          precio.fecha_vigencia <= venta.fecha
      )
      .at(-1);
    const valor = numero(vigente?.precio_costo);
    return vigente && valor > 0
      ? { valor, fechaVigencia: vigente.fecha_vigencia, fuente: "MANUAL_BLUEMAX" }
      : null;
  }

  const campo = campoCosto(venta.producto);
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
    ? { valor, fechaVigencia: vigente.fecha_vigencia, fuente: "RECOMPRA" }
    : null;
}

function crearAcumulador(clave = {}) {
  return {
    ...clave,
    litros: 0,
    litrosConCosto: 0,
    ventaBruta: 0,
    costoBruto: 0,
    m2Neto: 0,
    transacciones: new Set(),
    lineas: 0,
    lineasSinCosto: 0,
  };
}

function acumular(acumulador, detalle) {
  acumulador.litros += detalle.litros;
  acumulador.ventaBruta += detalle.precioVenta * detalle.litros;
  if (detalle.precioCosto != null) {
    acumulador.litrosConCosto += detalle.litros;
    acumulador.costoBruto += detalle.precioCosto * detalle.litros;
    acumulador.m2Neto += detalle.m2Neto;
  } else {
    acumulador.lineasSinCosto += 1;
  }
  acumulador.lineas += 1;
  acumulador.transacciones.add(detalle.transaccionId);
}

function cerrarAcumulador(acumulador) {
  const litrosConCosto = acumulador.litrosConCosto;
  return {
    ...acumulador,
    transacciones: acumulador.transacciones.size,
    m2Litro: litrosConCosto > 0 ? acumulador.m2Neto / litrosConCosto : 0,
  };
}

export async function obtenerM2Mensual(periodo) {
  const rango = rangoMes(periodo);
  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [ventas, precios, costosBlueMax] = await Promise.all([
    leerVentas(rango.desde, rango.hasta),
    leerPreciosCosto(rango.hasta),
    leerCostosBlueMax(rango.hasta),
  ]);

  const detalle = ventas.map((venta) => {
    const litros = numero(venta.litros);
    const precioVenta = numero(venta.precio_venta);
    const costo = costoVigente(venta, precios, costosBlueMax);
    const precioCosto = costo?.valor ?? null;
    const m2Litro = precioCosto == null ? null : (precioVenta - precioCosto) / 1.19;
    const m2Neto = m2Litro == null ? 0 : m2Litro * litros;
    return {
      fecha: venta.fecha,
      transaccionId: venta.transaccion_id,
      producto: venta.producto,
      litros,
      precioVenta,
      precioCosto,
      fechaCosto: costo?.fechaVigencia || null,
      fuenteCosto: costo?.fuente || null,
      m2Litro,
      m2Neto,
      medioPago: venta.medio_pago,
      tipoVenta: venta.tipo_venta,
      segmentoCliente: venta.segmento_cliente,
      documento: venta.descripcion_documento || venta.tipo_documento,
      folio: venta.folio,
    };
  });

  const resumen = crearAcumulador();
  const dias = new Map();
  const categorias = new Map();
  const productos = new Map();
  const diasProductos = new Map();

  for (const item of detalle) {
    acumular(resumen, item);

    if (!dias.has(item.fecha)) dias.set(item.fecha, crearAcumulador({ fecha: item.fecha }));
    acumular(dias.get(item.fecha), item);

    const claveCategoria = `${item.tipoVenta}|${item.segmentoCliente}`;
    if (!categorias.has(claveCategoria)) {
      categorias.set(
        claveCategoria,
        crearAcumulador({ tipoVenta: item.tipoVenta, segmentoCliente: item.segmentoCliente })
      );
    }
    acumular(categorias.get(claveCategoria), item);

    const claveDiaProducto = `${item.fecha}|${item.producto}`;
    if (!diasProductos.has(claveDiaProducto)) {
      diasProductos.set(
        claveDiaProducto,
        crearAcumulador({ fecha: item.fecha, producto: item.producto })
      );
    }
    acumular(diasProductos.get(claveDiaProducto), item);

    const claveProducto = `${item.producto}|${item.tipoVenta}|${item.segmentoCliente}`;
    if (!productos.has(claveProducto)) {
      productos.set(
        claveProducto,
        crearAcumulador({
          producto: item.producto,
          tipoVenta: item.tipoVenta,
          segmentoCliente: item.segmentoCliente,
        })
      );
    }
    acumular(productos.get(claveProducto), item);
  }

  return {
    rango,
    formula: "((precio_venta - precio_costo) / 1.19) * litros",
    resumen: cerrarAcumulador(resumen),
    categorias: [...categorias.values()].map(cerrarAcumulador),
    productos: [...productos.values()].map(cerrarAcumulador),
    dias: [...dias.values()].map(cerrarAcumulador).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    diasProductos: [...diasProductos.values()]
      .map(cerrarAcumulador)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.producto.localeCompare(b.producto)),
    detalle,
  };
}
