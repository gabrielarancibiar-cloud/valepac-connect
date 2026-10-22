/** Los módulos se cargan SOLO después de validar el token. Todas estas funciones son de lectura. */
export async function leerModulo(modulo, periodo) {
  if (modulo === "conciliacion") {
    const { obtenerConciliacionMensual } = await import("../../conciliacion/mensual.js");
    return obtenerConciliacionMensual(periodo);
  }
  if (modulo === "muevo") {
    const { obtenerMes } = await import("../../conciliacion/muevo-empresa.js");
    return obtenerMes(periodo);
  }
  if (modulo === "recompra") {
    const { obtenerMesRecompraLake } = await import("../../conciliacion/muevo-empresa.js");
    return obtenerMesRecompraLake(periodo);
  }
  if (modulo === "m2") {
    const { obtenerM2Produccion } = await import("../../m2.js");
    return obtenerM2Produccion(periodo);
  }
  throw new Error("Módulo desconocido.");
}

/** Si se solicita fecha, se entregan datos diarios, sin confundirlos con el total mensual. */
export function vistaModulo(modulo, datos, fecha = null) {
  if (!fecha) return datos;
  return {
    fecha,
    dia: (datos.dias || []).find(x => x.fecha === fecha) || null,
    resumenMes: datos.resumen || null,
    ...(modulo === "m2" ? {
      productosDia: (datos.diasProductos || []).filter(x => x.fecha === fecha),
      detalleDia: (datos.detalle || []).filter(x => x.fecha === fecha),
      estadoDia: (datos.estados || []).find(x => x.fecha === fecha) || null,
      fuenteDatos: datos.fuenteDatos,
    } : {}),
    ...(modulo === "recompra" ? {
      estadoLakeDia: (datos.estadosLake || []).find(x => x.fecha === fecha) || null,
      fuenteDatos: datos.fuenteDatos,
    } : {}),
    ...(modulo === "conciliacion" ? { criterio: datos.criterio } : {}),
  };
}

export async function obtenerLectura(modulo, consulta, reader = leerModulo) {
  if (modulo !== "resumen") {
    return vistaModulo(modulo, await reader(modulo, consulta.periodo), consulta.fecha);
  }
  const nombres = ["conciliacion", "recompra", "muevo", "m2"];
  const resultados = await Promise.all(nombres.map(nombre => reader(nombre, consulta.periodo)));
  return Object.fromEntries(nombres.map((nombre, idx) => [nombre, vistaModulo(nombre, resultados[idx], consulta.fecha)]));
}
