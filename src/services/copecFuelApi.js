import { apiFetch } from "../lib/api.js";

async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    error.statusCopec = payload?.statusCopec || null;
    error.messageCopec = payload?.messageCopec || null;
    error.payload = payload;
    error.requiereCodigoEquipo =
      Boolean(payload?.requiereCodigoEquipo) ||
      /validar.*equipo|codigo.*equipo/i.test(error.message);
    throw error;
  }

  return payload;
}

export async function consultarTransaccionesOficiales(fecha, inspeccionar = true) {
  const params = new URLSearchParams({
    recurso: "transacciones",
    fecha,
  });

  if (inspeccionar) params.set("inspeccionar", "1");

  const respuesta = await apiFetch(
    `/api/copecfuel/oficial?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  const payload = await leerRespuesta(respuesta);

  if (!Array.isArray(payload.transacciones)) {
    payload.transacciones = Array.isArray(
      payload.respuestaOriginal?.data?.reporteCombustible
    )
      ? payload.respuestaOriginal.data.reporteCombustible
      : [];
  }

  return payload;
}

function obtenerFechasDelMes(periodo, fechaDesde) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return [];

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const cantidadDias = new Date(anio, mes, 0).getDate();
  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(
    hoy.getMonth() + 1
  ).padStart(2, "0")}`;
  let ultimoDia = cantidadDias;

  if (periodo > periodoActual) return [];
  if (periodo === periodoActual) ultimoDia = hoy.getDate();

  const fechas = Array.from({ length: ultimoDia }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  );
  const inicio = String(fechaDesde || "").startsWith(`${periodo}-`)
    ? fechaDesde
    : `${periodo}-01`;

  return fechas.filter((fecha) => fecha >= inicio);
}

function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

async function sincronizarDia(fecha) {
  const params = new URLSearchParams({ desde: fecha, hasta: fecha });
  let ultimoError;

  for (let intento = 1; intento <= 2; intento += 1) {
    try {
      const respuesta = await apiFetch(
        `/api/copecfuel/sincronizar?${params.toString()}`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        }
      );

      return await leerRespuesta(respuesta);
    } catch (error) {
      ultimoError = error;

      if (![502, 503, 504].includes(error.status) || intento === 2) {
        throw error;
      }

      await esperar(700);
    }
  }

  throw ultimoError;
}

export async function probarConexionCopecFuel(forzarNuevaSesion = false) {
  const params = new URLSearchParams();

  if (forzarNuevaSesion) {
    params.set("forzar", "1");
  }

  const sufijo = params.toString() ? `?${params.toString()}` : "";
  const respuesta = await apiFetch(`/api/copecfuel/probar-conexion${sufijo}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  return leerRespuesta(respuesta);
}

export async function validarEquipoCopecFuel(codigo) {
  const body = new URLSearchParams({ codigo: String(codigo || "") });
  const respuesta = await apiFetch("/api/copecfuel/validar-equipo", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  });

  return leerRespuesta(respuesta);
}

export async function obtenerConciliacionMensual(periodo) {
  const params = new URLSearchParams({ periodo });
  const respuesta = await apiFetch(
    `/api/conciliacion/mensual?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  return leerRespuesta(respuesta);
}

export async function sincronizarMesCopecFuel(
  periodo,
  onProgreso,
  { comprobarConexion = false, fechaDesde } = {}
) {
  const fechas = obtenerFechasDelMes(periodo, fechaDesde);

  if (fechas.length === 0) {
    throw new Error("El mes seleccionado no tiene dias disponibles para sincronizar.");
  }

  // La sincronizacion productiva usa COPEC_FUEL_VENTAS_TOKEN en el backend.
  // Se conserva el parametro por compatibilidad con llamadas existentes, pero
  // ya no se abre una sesion WEBRPT1 ni se solicita codigo por correo.
  void comprobarConexion;

  const resultado = {
    total: fechas.length,
    completados: 0,
    ventasMuevoGuardadas: 0,
    montoMuevoGuardado: 0,
    propinasMuevo: 0,
    ventasRecompraGuardadas: 0,
    montoRecompraGuardado: 0,
    errores: [],
  };

  for (const [indice, fecha] of fechas.entries()) {
    onProgreso?.({ actual: indice + 1, total: fechas.length, fecha });

    try {
      const dia = await sincronizarDia(fecha);
      resultado.completados += 1;
      resultado.ventasMuevoGuardadas += Number(
        dia?.muevo?.ventasGuardadas || 0
      );
      resultado.montoMuevoGuardado += Number(
        dia?.muevo?.montoGuardado || 0
      );
      resultado.propinasMuevo += Number(dia?.muevo?.totalPropinas || 0);
      resultado.ventasRecompraGuardadas += Number(
        dia?.recompra?.ventasRecompraGuardadas || 0
      );
      resultado.montoRecompraGuardado += Number(
        dia?.recompra?.montoRecompraGuardado || 0
      );
    } catch (error) {
      if (error.requiereCodigoEquipo) {
        throw error;
      }

      resultado.errores.push({
        fecha,
        mensaje: error.message || "No fue posible sincronizar el dia.",
      });
    }
  }

  return resultado;
}
