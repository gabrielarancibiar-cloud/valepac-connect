async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    throw error;
  }

  return payload;
}

function obtenerFechasDelMes(periodo) {
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

  return Array.from({ length: ultimoDia }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  );
}

function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

async function sincronizarDia(fecha) {
  const params = new URLSearchParams({ desde: fecha, hasta: fecha });
  let ultimoError;

  for (let intento = 1; intento <= 2; intento += 1) {
    try {
      const respuesta = await fetch(
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
  const respuesta = await fetch(`/api/copecfuel/probar-conexion${sufijo}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  return leerRespuesta(respuesta);
}

export async function validarEquipoCopecFuel(codigo) {
  const body = new URLSearchParams({ codigo: String(codigo || "") });
  const respuesta = await fetch("/api/copecfuel/validar-equipo", {
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
  const respuesta = await fetch(
    `/api/conciliacion/mensual?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  return leerRespuesta(respuesta);
}

export async function sincronizarMesCopecFuel(periodo, onProgreso) {
  const fechas = obtenerFechasDelMes(periodo);

  if (fechas.length === 0) {
    throw new Error("El mes seleccionado no tiene dias disponibles para sincronizar.");
  }

  const conexion = await probarConexionCopecFuel();

  if (conexion.requiereCodigoEquipo || !conexion.conectado) {
    const error = new Error(
      conexion.requiereCodigoEquipo
        ? "CopecFuel envio un codigo al correo. Ingresalo para validar el equipo."
        : "CopecFuel no pudo confirmar una conexion activa."
    );
    error.requiereCodigoEquipo = Boolean(conexion.requiereCodigoEquipo);
    throw error;
  }

  const resultado = {
    total: fechas.length,
    completados: 0,
    errores: [],
  };

  for (const [indice, fecha] of fechas.entries()) {
    onProgreso?.({ actual: indice + 1, total: fechas.length, fecha });

    try {
      await sincronizarDia(fecha);
      resultado.completados += 1;
    } catch (error) {
      resultado.errores.push({
        fecha,
        mensaje: error.message || "No fue posible sincronizar el dia.",
      });
    }
  }

  return resultado;
}
