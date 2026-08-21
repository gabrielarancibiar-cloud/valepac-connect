import { createHash } from "node:crypto";
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
      "producto_id, fecha, precio_venta, cantidad, datos_origen",
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
      comisionUnitariaObservada: observacion
        ? modaNumerica(observacion.comisionesUnitarias)
        : null,
      fechaObservacion: observacion?.fecha || null,
      costoVigente: costoActual ? numero(costoActual.costo_neto) : null,
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
    .select("id, costo_neto, vigente_desde")
    .eq("producto_id", productoId)
    .eq("vigente_desde", vigenteDesde)
    .maybeSingle();

  if (errorExistente) {
    throw new Error(
      `No se pudo revisar el historial de costos: ${errorExistente.message}`
    );
  }

  if (existente) {
    if (numero(existente.costo_neto) === costoNeto) {
      return {
        productoId,
        descripcion: producto.descripcion,
        costoNeto,
        vigenteDesde,
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
      proveedor: texto(entrada.proveedor) || producto.proveedor || null,
      observacion:
        texto(entrada.observacion) ||
        "Actualizacion manual desde VALEPAC Connect",
      actualizado_en: new Date().toISOString(),
    })
    .select("id, producto_id, costo_neto, vigente_desde, proveedor, observacion")
    .single();

  if (errorCosto) {
    throw new Error(`No se pudo registrar el costo: ${errorCosto.message}`);
  }

  return {
    productoId,
    descripcion: producto.descripcion,
    costoNeto: numero(costoCreado.costo_neto),
    vigenteDesde: costoCreado.vigente_desde,
    sinCambios: false,
  };
}

function acumularGrupo(grupo, venta, costo) {
  grupo.lineas += 1;
  grupo.transacciones.add(venta.transaccion_id || venta.identificador_origen);
  grupo.unidades += numero(venta.cantidad);
  grupo.ventaNeta += numero(venta.venta_neta);
  grupo.ventaBruta += numero(venta.venta_bruta);

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
  const margenBruto = completo
    ? redondearDinero(ventaNeta - costoVentaParcial)
    : null;

  return {
    ...grupo,
    transacciones: grupo.transacciones.size,
    unidades: Math.round((grupo.unidades + Number.EPSILON) * 1000) / 1000,
    ventaNeta,
    ventaBruta: redondearDinero(grupo.ventaBruta),
    costoVenta: completo ? costoVentaParcial : null,
    costoVentaParcial,
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

  const [ventas, catalogo, costos] = await Promise.all([
    leerPaginado(
      "productos_ventas",
      "identificador_origen, fecha, transaccion_id, producto_id, descripcion, cantidad, venta_bruta, venta_neta",
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
    },
    categorias: detalleCategorias,
    productos: detalleProductos,
    productosSinCosto,
  };
}
