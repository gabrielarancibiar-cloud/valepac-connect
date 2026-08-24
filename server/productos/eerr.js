import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "../../api/_lib/supabaseAdmin.js";
import { obtenerVentasOficialesCopecFuel } from "../copecfuel/ventasOficiales.js";

const TAMANO_PAGINA = 1000;

function texto(valor) {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function numeroOpcional(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : null;
}

function redondearDinero(valor) {
  return Math.round((numero(valor) + Number.EPSILON) * 100) / 100;
}

function normalizarFecha(valor) {
  const fecha = texto(valor);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;

  const fechaUtc = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(fechaUtc.getTime()) &&
    fechaUtc.toISOString().slice(0, 10) === fecha
    ? fecha
    : null;
}

export function obtenerRangoPeriodo(periodo) {
  const coincidencia = texto(periodo).match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);

  if (mes < 1 || mes > 12) return null;

  const ultimoDiaMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const finMes = `${periodo}-${String(ultimoDiaMes).padStart(2, "0")}`;
  const hoyChile = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (periodo > hoyChile.slice(0, 7)) return null;

  const hasta = periodo === hoyChile.slice(0, 7) ? hoyChile : finMes;

  return {
    desde: `${periodo}-01`,
    hasta,
    finMes,
    parcial: hasta !== finMes,
  };
}

function identificadorLinea(fila, fecha, ocurrencia) {
  const base = [
    fecha,
    texto(fila.transaccionId || fila.transaccionCodigo),
    texto(fila.productoId),
    texto(fila.cantidad),
    texto(fila.precio),
    texto(fila.total),
    texto(fila.baseTotal),
    String(ocurrencia),
  ].join("|");

  return `copecfuel-producto-v1|${createHash("sha256")
    .update(base)
    .digest("hex")}`;
}

function productoIdLinea(fila) {
  const informado = texto(fila.productoId);

  if (informado) return informado;

  const descripcion = texto(fila.productoDescripcion || fila.productoNombre);
  return `sin-id-${createHash("sha1")
    .update(descripcion || "producto-sin-identificar")
    .digest("hex")}`;
}

async function registrarSincronizacion(fecha) {
  const { data, error } = await supabaseAdmin
    .from("sincronizaciones")
    .insert({
      integracion: "eerr_productos",
      estado: "procesando",
      periodo: fecha,
      mensaje: "Consultando VENTA_PRODUCTO para EE.RR. Productos.",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`No se pudo iniciar la sincronizacion: ${error.message}`);
  }

  return data.id;
}

async function finalizarSincronizacion(id, cambios) {
  if (!id) return;

  await supabaseAdmin
    .from("sincronizaciones")
    .update({
      ...cambios,
      finalizado_en: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function sincronizarProductosDia(
  fechaSolicitada,
  ventasOficialesExistentes = null
) {
  const fecha = normalizarFecha(fechaSolicitada);

  if (!fecha) {
    const error = new Error("La fecha debe usar el formato AAAA-MM-DD.");
    error.status = 400;
    throw error;
  }

  let sincronizacionId = null;

  try {
    sincronizacionId = await registrarSincronizacion(fecha);

    // El sincronizador general puede entregar la respuesta oficial ya
    // consultada. Asi EE.RR. no hace una segunda llamada a CopecFuel.
    const ventas =
      ventasOficialesExistentes ||
      (await obtenerVentasOficialesCopecFuel(fecha));
    const filas = Array.isArray(ventas.filasProducto)
      ? ventas.filasProducto
      : [];
    const idsProducto = [...new Set(filas.map(productoIdLinea))];
    const { data: catalogoExistente, error: errorCatalogo } = idsProducto.length
      ? await supabaseAdmin
          .from("productos_catalogo")
          .select("producto_id, categoria, proveedor, primera_venta, ultima_venta")
          .in("producto_id", idsProducto)
      : { data: [], error: null };

    if (errorCatalogo) {
      throw new Error(`No se pudo leer el catalogo: ${errorCatalogo.message}`);
    }

    const catalogoPorId = new Map(
      (catalogoExistente || []).map((producto) => [producto.producto_id, producto])
    );
    const catalogoNuevo = new Map();

    for (const fila of filas) {
      const productoId = productoIdLinea(fila);
      const actual = catalogoPorId.get(productoId);
      const previo = catalogoNuevo.get(productoId);

      catalogoNuevo.set(productoId, {
        producto_id: productoId,
        descripcion:
          texto(fila.productoDescripcion || fila.productoNombre) ||
          "Producto sin identificar",
        categoria:
          actual?.categoria || previo?.categoria || "SIN CLASIFICAR",
        proveedor: actual?.proveedor || previo?.proveedor || null,
        activo: true,
        primera_venta:
          [actual?.primera_venta, previo?.primera_venta, fecha]
            .filter(Boolean)
            .sort()[0] || fecha,
        ultima_venta:
          [actual?.ultima_venta, previo?.ultima_venta, fecha]
            .filter(Boolean)
            .sort()
            .at(-1) || fecha,
        actualizado_en: new Date().toISOString(),
      });
    }

    if (catalogoNuevo.size > 0) {
      const { error } = await supabaseAdmin
        .from("productos_catalogo")
        .upsert([...catalogoNuevo.values()], { onConflict: "producto_id" });

      if (error) {
        throw new Error(`No se pudo actualizar el catalogo: ${error.message}`);
      }
    }

    const ocurrencias = new Map();
    const ahora = new Date().toISOString();
    const registros = filas.map((fila) => {
      const firma = [
        texto(fila.transaccionId || fila.transaccionCodigo),
        productoIdLinea(fila),
        texto(fila.cantidad),
        texto(fila.precio),
        texto(fila.total),
        texto(fila.baseTotal),
      ].join("|");
      const ocurrencia = (ocurrencias.get(firma) || 0) + 1;
      ocurrencias.set(firma, ocurrencia);

      return {
        identificador_origen: identificadorLinea(fila, fecha, ocurrencia),
        fecha,
        turno_id: texto(fila.turnoId) || fecha.replace(/-/g, ""),
        transaccion_id: texto(fila.transaccionId) || null,
        transaccion_codigo: texto(fila.transaccionCodigo) || null,
        producto_id: productoIdLinea(fila),
        descripcion:
          texto(fila.productoDescripcion || fila.productoNombre) ||
          "Producto sin identificar",
        cantidad: numero(fila.cantidad),
        precio_venta: numero(fila.precio),
        venta_bruta: numero(fila.total),
        // baseTotal es la venta neta oficial, sin IVA. No se reemplaza por
        // totalDocumento, totalMontoPagar u otros totales financieros.
        venta_neta: numeroOpcional(fila.baseTotal),
        forma_pago: texto(fila.formaPagoNombre) || null,
        codigo_eds: texto(fila.codigoEds || ventas.codigoEds) || null,
        datos_origen: fila,
        sincronizado_en: ahora,
      };
    });

    const { error: errorLimpieza } = await supabaseAdmin
      .from("productos_ventas")
      .delete()
      .eq("fecha", fecha);

    if (errorLimpieza) {
      throw new Error(
        `No se pudo reemplazar el detalle del dia: ${errorLimpieza.message}`
      );
    }

    if (registros.length > 0) {
      const { error } = await supabaseAdmin
        .from("productos_ventas")
        .insert(registros);

      if (error) {
        throw new Error(`No se pudieron guardar las ventas: ${error.message}`);
      }
    }

    const ventaNeta = registros.reduce(
      (total, registro) => total + numero(registro.venta_neta),
      0
    );
    const sinBaseTotal = registros.filter(
      (registro) => registro.venta_neta === null
    ).length;

    await finalizarSincronizacion(sincronizacionId, {
      estado: "completado",
      registros_encontrados: filas.length,
      registros_guardados: registros.length,
      mensaje: "VENTA_PRODUCTO guardada para EE.RR. Productos.",
    });

    return {
      fecha,
      turnoId: ventas.turnoId,
      registros: registros.length,
      productos: catalogoNuevo.size,
      ventaNeta: redondearDinero(ventaNeta),
      lineasSinBaseTotal: sinBaseTotal,
    };
  } catch (error) {
    await finalizarSincronizacion(sincronizacionId, {
      estado: "error",
      mensaje: error instanceof Error ? error.message : "Error desconocido",
    });
    throw error;
  }
}

async function leerPaginado(tabla, campos, configurar) {
  const registros = [];
  let inicio = 0;

  while (true) {
    let consulta = supabaseAdmin
      .from(tabla)
      .select(campos)
      .range(inicio, inicio + TAMANO_PAGINA - 1);
    consulta = configurar ? configurar(consulta) : consulta;
    const { data, error } = await consulta;

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

function costoVigente(costos, productoId, fecha) {
  return costos
    .filter(
      (costo) =>
        costo.producto_id === productoId &&
        costo.vigente_desde <= fecha &&
        (!costo.vigente_hasta || costo.vigente_hasta >= fecha)
    )
    .sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))
    .at(-1);
}

function modaNumerica(valores) {
  const frecuencias = new Map();

  for (const valor of valores) {
    const numeroValor = numeroOpcional(valor);

    if (numeroValor === null) continue;

    const normalizado = Math.round((numeroValor + Number.EPSILON) * 10000) / 10000;
    const clave = String(normalizado);
    const actual = frecuencias.get(clave) || {
      valor: normalizado,
      cantidad: 0,
    };
    actual.cantidad += 1;
    frecuencias.set(clave, actual);
  }

  return [...frecuencias.values()]
    .sort((a, b) => b.cantidad - a.cantidad || b.valor - a.valor)
    .at(0)?.valor ?? null;
}

function fechaChileActual() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function obtenerCatalogoCostosProductos() {
  const [catalogo, costos, ventas] = await Promise.all([
    leerPaginado(
      "productos_catalogo",
      "producto_id, descripcion, categoria, proveedor, activo, primera_venta, ultima_venta",
      (consulta) =>
        consulta
          .eq("activo", true)
          .order("descripcion", { ascending: true })
    ),
    leerPaginado(
      "productos_costos",
      "id, producto_id, costo_neto, vigente_desde, vigente_hasta, proveedor, observacion, creado_en",
      (consulta) => consulta.order("vigente_desde", { ascending: true })
    ),
    leerPaginado(
      "productos_ventas",
      "producto_id, fecha, precio_venta, venta_neta, cantidad, datos_origen",
      (consulta) => consulta.order("fecha", { ascending: true })
    ),
  ]);

  const observaciones = new Map();

  for (const venta of ventas) {
    const productoId = texto(venta.producto_id);

    if (!productoId || !venta.fecha) continue;

    const actual = observaciones.get(productoId);

    if (!actual || venta.fecha > actual.fecha) {
      observaciones.set(productoId, {
        fecha: venta.fecha,
        precios: [],
        ventasNetasUnitarias: [],
        comisionesUnitarias: [],
      });
    }

    const observacion = observaciones.get(productoId);

    if (venta.fecha !== observacion.fecha) continue;

    const precio = numeroOpcional(venta.precio_venta);

    if (precio !== null && precio > 0) {
      observacion.precios.push(precio);
    }

    const cantidad = numero(venta.cantidad);
    const ventaNeta = numeroOpcional(venta.venta_neta);

    if (ventaNeta !== null && cantidad > 0) {
      observacion.ventasNetasUnitarias.push(ventaNeta / cantidad);
    }

    const comisionTotal = numeroOpcional(
      venta.datos_origen?.totalComision ?? venta.datos_origen?.total_comision
    );

    if (comisionTotal !== null && cantidad > 0) {
      observacion.comisionesUnitarias.push(comisionTotal / cantidad);
    }
  }

  const hoy = fechaChileActual();
  const costosPorProducto = new Map();

  for (const costo of costos) {
    const lista = costosPorProducto.get(costo.producto_id) || [];
    lista.push(costo);
    costosPorProducto.set(costo.producto_id, lista);
  }

  const productos = catalogo.map((producto) => {
    const historial = costosPorProducto.get(producto.producto_id) || [];
    const costoActual = costoVigente(historial, producto.producto_id, hoy);
    const observacion = observaciones.get(producto.producto_id);
    const ventaNetaUnitaria = observacion
      ? modaNumerica(observacion.ventasNetasUnitarias)
      : null;
    const comisionUnitaria = observacion
      ? modaNumerica(observacion.comisionesUnitarias)
      : null;
    const costoVigenteActual = costoActual ? numero(costoActual.costo_neto) : null;
    const margenUnitario =
      ventaNetaUnitaria !== null && costoVigenteActual !== null
        ? redondearDinero(
            ventaNetaUnitaria - costoVigenteActual - numero(comisionUnitaria)
          )
        : null;

    return {
      productoId: producto.producto_id,
      codigo: producto.producto_id,
      descripcion: producto.descripcion,
      categoria: producto.categoria,
      proveedor: producto.proveedor,
      primeraVenta: producto.primera_venta,
      ultimaVenta: producto.ultima_venta,
      precioVentaObservado: observacion
        ? modaNumerica(observacion.precios)
        : null,
      ventaNetaUnitariaObservada: ventaNetaUnitaria,
      comisionUnitariaObservada: comisionUnitaria,
      margenUnitarioActual: margenUnitario,
      margenUnitarioPorcentaje:
        margenUnitario !== null && ventaNetaUnitaria !== 0
          ? Math.round((margenUnitario / ventaNetaUnitaria) * 10000) / 100
          : null,
      fechaObservacion: observacion?.fecha || null,
      costoVigente: costoVigenteActual,
      vigenteDesde: costoActual?.vigente_desde || null,
      vigenteHasta: costoActual?.vigente_hasta || null,
      cantidadVigencias: historial.length,
    };
  });

  productos.sort((a, b) => {
    if (a.costoVigente === null && b.costoVigente !== null) return -1;
    if (a.costoVigente !== null && b.costoVigente === null) return 1;
    return a.descripcion.localeCompare(b.descripcion, "es");
  });

  return {
    productos,
    total: productos.length,
    sinCosto: productos.filter((producto) => producto.costoVigente === null)
      .length,
    fechaConsulta: hoy,
  };
}

export async function registrarNuevaVigenciaCosto(entrada = {}) {
  const productoId = texto(entrada.productoId);
  const vigenteDesde = normalizarFecha(entrada.vigenteDesde);
  const vigenteHasta = texto(entrada.vigenteHasta)
    ? normalizarFecha(entrada.vigenteHasta)
    : null;
  const costoNeto = numeroOpcional(entrada.costoNeto);

  if (!productoId) {
    const error = new Error("Debes seleccionar un producto.");
    error.status = 400;
    throw error;
  }

  if (!vigenteDesde) {
    const error = new Error("La vigencia debe usar una fecha real.");
    error.status = 400;
    throw error;
  }

  if (texto(entrada.vigenteHasta) && !vigenteHasta) {
    const error = new Error("El vencimiento debe usar una fecha real.");
    error.status = 400;
    throw error;
  }

  if (vigenteHasta && vigenteHasta < vigenteDesde) {
    const error = new Error(
      "El vencimiento no puede ser anterior al inicio de la vigencia."
    );
    error.status = 400;
    throw error;
  }

  if (costoNeto === null || costoNeto <= 0) {
    const error = new Error("El costo neto debe ser mayor que cero.");
    error.status = 400;
    throw error;
  }

  const { data: producto, error: errorProducto } = await supabaseAdmin
    .from("productos_catalogo")
    .select("producto_id, descripcion, proveedor, activo")
    .eq("producto_id", productoId)
    .maybeSingle();

  if (errorProducto) {
    throw new Error(`No se pudo validar el producto: ${errorProducto.message}`);
  }

  if (!producto || !producto.activo) {
    const error = new Error("El producto no existe o no esta vigente.");
    error.status = 404;
    throw error;
  }

  const { data: existente, error: errorExistente } = await supabaseAdmin
    .from("productos_costos")
    .select("id, costo_neto, vigente_desde, vigente_hasta, proveedor")
    .eq("producto_id", productoId)
    .eq("vigente_desde", vigenteDesde)
    .maybeSingle();

  if (errorExistente) {
    throw new Error(
      `No se pudo revisar el historial de costos: ${errorExistente.message}`
    );
  }

  if (existente) {
    if (
      numero(existente.costo_neto) === costoNeto &&
      (existente.vigente_hasta || null) === vigenteHasta
    ) {
      return {
        productoId,
        descripcion: producto.descripcion,
        costoNeto,
        vigenteDesde,
        vigenteHasta,
        sinCambios: true,
      };
    }

    const error = new Error(
      "Ya existe un costo distinto para este producto en la fecha indicada. Usa otra fecha de vigencia para conservar el historial."
    );
    error.status = 409;
    throw error;
  }

  const { data: costoCreado, error: errorCosto } = await supabaseAdmin
    .from("productos_costos")
    .insert({
      producto_id: productoId,
      costo_neto: costoNeto,
      vigente_desde: vigenteDesde,
      vigente_hasta: vigenteHasta,
      proveedor: texto(entrada.proveedor) || producto.proveedor || null,
      observacion:
        texto(entrada.observacion) ||
        "Actualizacion manual desde VALEPAC Connect",
      actualizado_en: new Date().toISOString(),
    })
    .select("id, producto_id, costo_neto, vigente_desde, vigente_hasta, proveedor, observacion")
    .single();

  if (errorCosto) {
    throw new Error(`No se pudo registrar el costo: ${errorCosto.message}`);
  }

  return {
    productoId,
    descripcion: producto.descripcion,
    costoNeto: numero(costoCreado.costo_neto),
    vigenteDesde: costoCreado.vigente_desde,
    vigenteHasta: costoCreado.vigente_hasta,
    sinCambios: false,
  };
}

function normalizarCategoria(valor) {
  return texto(valor).replace(/\s+/g, " ").toLocaleUpperCase("es");
}

export async function actualizarProductoCatalogo(entrada = {}) {
  const productoId = texto(entrada.productoId || entrada.codigo);
  const categoria = normalizarCategoria(entrada.categoria);
  const proveedor = texto(entrada.proveedor);
  const costoNeto = numeroOpcional(entrada.costoNeto);

  if (!productoId) {
    const error = new Error("Debes seleccionar un producto.");
    error.status = 400;
    throw error;
  }

  if (!categoria && costoNeto === null) {
    const error = new Error("Indica una categoria o un nuevo costo neto.");
    error.status = 400;
    throw error;
  }

  const { data: producto, error: errorProducto } = await supabaseAdmin
    .from("productos_catalogo")
    .select("producto_id, descripcion, categoria, proveedor, activo")
    .eq("producto_id", productoId)
    .maybeSingle();

  if (errorProducto) {
    throw new Error(`No se pudo validar el producto: ${errorProducto.message}`);
  }

  if (!producto || !producto.activo) {
    const error = new Error("El producto no existe o no esta vigente.");
    error.status = 404;
    throw error;
  }

  const cambiosCatalogo = {};
  if (categoria && categoria !== producto.categoria) {
    cambiosCatalogo.categoria = categoria;
  }
  if (proveedor && proveedor !== producto.proveedor) {
    cambiosCatalogo.proveedor = proveedor;
  }

  if (Object.keys(cambiosCatalogo).length > 0) {
    const { error } = await supabaseAdmin
      .from("productos_catalogo")
      .update({ ...cambiosCatalogo, actualizado_en: new Date().toISOString() })
      .eq("producto_id", productoId);

    if (error) {
      throw new Error(`No se pudo actualizar el catalogo: ${error.message}`);
    }
  }

  let costo = null;
  if (costoNeto !== null) {
    costo = await registrarNuevaVigenciaCosto({
      ...entrada,
      productoId,
      proveedor: proveedor || producto.proveedor,
      observacion:
        texto(entrada.observacion) ||
        "Actualizacion desde administrador de costos VALEPAC Connect",
    });
  }

  return {
    productoId,
    descripcion: producto.descripcion,
    categoria: categoria || producto.categoria,
    categoriaActualizada: Boolean(cambiosCatalogo.categoria),
    proveedorActualizado: Boolean(cambiosCatalogo.proveedor),
    costo,
    sinCambios:
      Object.keys(cambiosCatalogo).length === 0 &&
      (!costo || costo.sinCambios),
  };
}

export async function importarCatalogoCostos(filas = []) {
  if (!Array.isArray(filas) || filas.length === 0) {
    const error = new Error("La planilla no contiene filas para importar.");
    error.status = 400;
    throw error;
  }

  if (filas.length > 1000) {
    const error = new Error("La planilla supera el maximo de 1.000 productos.");
    error.status = 400;
    throw error;
  }

  const resultado = {
    recibidos: filas.length,
    actualizados: 0,
    sinCambios: 0,
    errores: [],
  };

  for (const [indice, fila] of filas.entries()) {
    try {
      const actualizado = await actualizarProductoCatalogo({
        productoId: fila.productoId || fila.codigo,
        categoria: fila.categoria,
        proveedor: fila.proveedor,
        costoNeto: fila.costoNeto,
        vigenteDesde: fila.vigenteDesde,
        vigenteHasta: fila.vigenteHasta,
        observacion:
          texto(fila.observacion) || "Importacion desde planilla de costos",
      });

      if (actualizado.sinCambios) resultado.sinCambios += 1;
      else resultado.actualizados += 1;
    } catch (error) {
      resultado.errores.push({
        fila: indice + 2,
        productoId: texto(fila.productoId || fila.codigo) || null,
        producto: texto(fila.descripcion) || null,
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  return resultado;
}

const CONCEPTOS_AJUSTES = new Set([
  "ROYALTY_AGUAS_LUBRICANTES",
  "ROYALTY_BLUEMAX_BIDON",
  "ROYALTY_BIDONES_COMBUSTIBLE",
  "COBRO_FIJO_VENTA_ISLA",
  "NOTA_CREDITO_CONDICION_COMERCIAL",
]);

function tipoConcepto(concepto) {
  return concepto === "NOTA_CREDITO_CONDICION_COMERCIAL"
    ? "NOTA_CREDITO"
    : "CARGO";
}

async function leerAjustesMensuales(periodo) {
  const { data, error } = await supabaseAdmin
    .from("productos_ajustes_documentos")
    .select("id, periodo, tipo, concepto, folio, fecha_emision, monto, observacion, actualizado_en")
    .eq("periodo", periodo)
    .order("fecha_emision", { ascending: true });

  if (error) {
    if (
      ["42P01", "PGRST205"].includes(error.code) ||
      /productos_ajustes_documentos|schema cache/i.test(error.message || "")
    ) {
      return {
        periodo,
        cargos: 0,
        notasCredito: 0,
        documentos: [],
        migracionPendiente: true,
      };
    }
    throw new Error(`No se pudieron leer los ajustes mensuales: ${error.message}`);
  }

  const documentos = (data || []).map((documento) => ({
    id: documento.id,
    periodo: documento.periodo,
    tipo: documento.tipo,
    concepto: documento.concepto,
    folio: documento.folio,
    fechaEmision: documento.fecha_emision,
    monto: numero(documento.monto),
    observacion: documento.observacion || null,
    actualizadoEn: documento.actualizado_en,
  }));

  return {
    periodo,
    cargos: documentos
      .filter((documento) => documento.tipo === "CARGO")
      .reduce((total, documento) => total + documento.monto, 0),
    notasCredito: documentos
      .filter((documento) => documento.tipo === "NOTA_CREDITO")
      .reduce((total, documento) => total + documento.monto, 0),
    documentos,
    actualizadoEn: documentos.map((documento) => documento.actualizadoEn).sort().at(-1) || null,
    migracionPendiente: false,
  };
}

export async function registrarAjustesMensuales(entrada = {}) {
  const periodo = texto(entrada.periodo);
  const documentosEntrada = Array.isArray(entrada.documentos)
    ? entrada.documentos
    : [];

  if (!obtenerRangoPeriodo(periodo)) {
    const error = new Error("El periodo debe usar el formato AAAA-MM y no ser futuro.");
    error.status = 400;
    throw error;
  }

  if (documentosEntrada.length > 100) {
    const error = new Error("El periodo supera el maximo de 100 documentos.");
    error.status = 400;
    throw error;
  }

  const ahora = new Date().toISOString();
  const documentos = documentosEntrada.map((documento, indice) => {
    const concepto = texto(documento.concepto);
    const folio = texto(documento.folio);
    const fechaEmision = normalizarFecha(documento.fechaEmision);
    const monto = numeroOpcional(documento.monto);

    if (!CONCEPTOS_AJUSTES.has(concepto)) {
      const error = new Error(`El concepto del documento ${indice + 1} no es valido.`);
      error.status = 400;
      throw error;
    }
    if (!folio) {
      const error = new Error(`Falta el folio del documento ${indice + 1}.`);
      error.status = 400;
      throw error;
    }
    if (!fechaEmision || fechaEmision.slice(0, 7) !== periodo) {
      const error = new Error(`La fecha del documento ${indice + 1} debe pertenecer al periodo.`);
      error.status = 400;
      throw error;
    }
    if (monto === null || monto <= 0) {
      const error = new Error(`El monto del documento ${indice + 1} debe ser mayor que cero.`);
      error.status = 400;
      throw error;
    }

    return {
      id: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(texto(documento.id))
        ? texto(documento.id)
        : randomUUID(),
      periodo,
      tipo: tipoConcepto(concepto),
      concepto,
      folio,
      fecha_emision: fechaEmision,
      monto,
      observacion: texto(documento.observacion) || null,
      actualizado_en: ahora,
    };
  });

  const { data: existentes, error: errorExistentes } = await supabaseAdmin
    .from("productos_ajustes_documentos")
    .select("id")
    .eq("periodo", periodo);

  if (errorExistentes) {
    throw new Error(`No se pudieron revisar los documentos existentes: ${errorExistentes.message}`);
  }

  if (documentos.length > 0) {
    const { error } = await supabaseAdmin
      .from("productos_ajustes_documentos")
      .upsert(documentos, { onConflict: "id" });

    if (error) {
      throw new Error(`No se pudieron guardar los documentos: ${error.message}`);
    }
  }

  const idsNuevos = new Set(documentos.map((documento) => documento.id));
  const idsEliminar = (existentes || [])
    .map((documento) => documento.id)
    .filter((id) => !idsNuevos.has(id));

  if (idsEliminar.length > 0) {
    const { error } = await supabaseAdmin
      .from("productos_ajustes_documentos")
      .delete()
      .in("id", idsEliminar);

    if (error) {
      throw new Error(`No se pudieron eliminar documentos retirados: ${error.message}`);
    }
  }

  return leerAjustesMensuales(periodo);
}

function acumularGrupo(grupo, venta, costo) {
  grupo.lineas += 1;
  grupo.transacciones.add(venta.transaccion_id || venta.identificador_origen);
  grupo.unidades += numero(venta.cantidad);
  grupo.ventaNeta += numero(venta.venta_neta);
  grupo.ventaBruta += numero(venta.venta_bruta);
  grupo.comisiones += numero(
    venta.datos_origen?.totalComision ??
      venta.datos_origen?.total_comision ??
      venta.datos_origen?.comision
  );

  if (venta.venta_neta === null || venta.venta_neta === undefined) {
    grupo.lineasSinVentaNeta += 1;
  }

  if (!costo) {
    grupo.lineasSinCosto += 1;
    grupo.ventaNetaSinCosto += numero(venta.venta_neta);
    return;
  }

  grupo.costoVentaParcial += numero(venta.cantidad) * numero(costo.costo_neto);
}

function finalizarGrupo(grupo) {
  const completo = grupo.lineasSinCosto === 0 && grupo.lineasSinVentaNeta === 0;
  const costoVentaParcial = redondearDinero(grupo.costoVentaParcial);
  const ventaNeta = redondearDinero(grupo.ventaNeta);
  const comisiones = redondearDinero(grupo.comisiones);
  const margenBruto = completo
    ? redondearDinero(ventaNeta - costoVentaParcial - comisiones)
    : null;

  return {
    ...grupo,
    transacciones: grupo.transacciones.size,
    unidades: Math.round((grupo.unidades + Number.EPSILON) * 1000) / 1000,
    ventaNeta,
    ventaBruta: redondearDinero(grupo.ventaBruta),
    costoVenta: completo ? costoVentaParcial : null,
    costoVentaParcial,
    comisiones,
    margenBruto,
    margenPorcentaje:
      completo && ventaNeta !== 0
        ? Math.round((margenBruto / ventaNeta) * 10000) / 100
        : null,
    completo,
    transaccionesSet: undefined,
  };
}

function nuevoGrupo(campos = {}) {
  return {
    ...campos,
    lineas: 0,
    transacciones: new Set(),
    unidades: 0,
    ventaNeta: 0,
    ventaBruta: 0,
    costoVentaParcial: 0,
    comisiones: 0,
    ventaNetaSinCosto: 0,
    lineasSinCosto: 0,
    lineasSinVentaNeta: 0,
  };
}

export async function obtenerResumenMensualProductos(periodo) {
  const rango = obtenerRangoPeriodo(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM y no ser futuro.");
    error.status = 400;
    throw error;
  }

  const [ventas, catalogo, costos, ajustes] = await Promise.all([
    leerPaginado(
      "productos_ventas",
      "identificador_origen, fecha, transaccion_id, producto_id, descripcion, cantidad, venta_bruta, venta_neta, datos_origen",
      (consulta) =>
        consulta
          .gte("fecha", rango.desde)
          .lte("fecha", rango.hasta)
          .order("fecha", { ascending: true })
    ),
    leerPaginado(
      "productos_catalogo",
      "producto_id, descripcion, categoria, proveedor, activo, primera_venta, ultima_venta",
      (consulta) => consulta.order("descripcion", { ascending: true })
    ),
    leerPaginado(
      "productos_costos",
      "producto_id, costo_neto, vigente_desde, vigente_hasta, proveedor",
      (consulta) =>
        consulta
          .lte("vigente_desde", rango.hasta)
          .order("vigente_desde", { ascending: true })
    ),
    leerAjustesMensuales(periodo),
  ]);

  const catalogoPorId = new Map(
    catalogo.map((producto) => [producto.producto_id, producto])
  );
  const productos = new Map();
  const categorias = new Map();
  const total = nuevoGrupo();

  for (const venta of ventas) {
    const catalogoProducto = catalogoPorId.get(venta.producto_id);
    const categoria = catalogoProducto?.categoria || "SIN CLASIFICAR";
    const costo = costoVigente(costos, venta.producto_id, venta.fecha);

    if (!productos.has(venta.producto_id)) {
      productos.set(
        venta.producto_id,
        nuevoGrupo({
          productoId: venta.producto_id,
          descripcion: catalogoProducto?.descripcion || venta.descripcion,
          categoria,
          proveedor: catalogoProducto?.proveedor || costo?.proveedor || null,
        })
      );
    }

    if (!categorias.has(categoria)) {
      categorias.set(categoria, nuevoGrupo({ categoria }));
    }

    acumularGrupo(productos.get(venta.producto_id), venta, costo);
    acumularGrupo(categorias.get(categoria), venta, costo);
    acumularGrupo(total, venta, costo);
  }

  const detalleProductos = [...productos.values()]
    .map(finalizarGrupo)
    .sort((a, b) => b.ventaNeta - a.ventaNeta);
  const detalleCategorias = [...categorias.values()]
    .map(finalizarGrupo)
    .sort((a, b) => b.ventaNeta - a.ventaNeta);
  const resumen = finalizarGrupo(total);
  const resultadoFinal = resumen.completo
    ? redondearDinero(
        resumen.margenBruto - ajustes.cargos + ajustes.notasCredito
      )
    : null;
  const productosSinCosto = detalleProductos
    .filter((producto) => !producto.completo)
    .map((producto) => ({
      productoId: producto.productoId,
      descripcion: producto.descripcion,
      lineasSinCosto: producto.lineasSinCosto,
      lineasSinVentaNeta: producto.lineasSinVentaNeta,
      ventaNeta: producto.ventaNeta,
    }));
  const ultimaSincronizacion = ventas
    .map((venta) => venta.fecha)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    periodo,
    rango,
    resumen: {
      ...resumen,
      productosVendidos: detalleProductos.length,
      categorias: detalleCategorias.length,
      productosSinCosto: productosSinCosto.length,
      diasConVentas: new Set(ventas.map((venta) => venta.fecha)).size,
      ultimaFechaConVentas: ultimaSincronizacion,
      margenOperacional: resumen.margenBruto,
      cargosMensuales: ajustes.cargos,
      notasCredito: ajustes.notasCredito,
      documentosAjustes: ajustes.documentos,
      cantidadCargos: ajustes.documentos.filter(
        (documento) => documento.tipo === "CARGO"
      ).length,
      cantidadNotasCredito: ajustes.documentos.filter(
        (documento) => documento.tipo === "NOTA_CREDITO"
      ).length,
      resultadoFinal,
      margenFinalPorcentaje:
        resultadoFinal !== null && resumen.ventaNeta !== 0
          ? Math.round((resultadoFinal / resumen.ventaNeta) * 10000) / 100
          : null,
      ajustesActualizadosEn: ajustes.actualizadoEn || null,
      migracionAjustesPendiente: Boolean(ajustes.migracionPendiente),
    },
    categorias: detalleCategorias,
    productos: detalleProductos,
    productosSinCosto,
  };
}
