import { apiFetch } from "../lib/api.js";

async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function obtenerEerrProductos(periodo) {
  const params = new URLSearchParams({
    recurso: "productos_eerr",
    periodo,
  });
  const respuesta = await apiFetch(
    `/api/copecfuel/oficial?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  return leerRespuesta(respuesta);
}

function fechasDesde(periodo, fechaDesde) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return [];

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const ultimoDiaMes = new Date(anio, mes, 0).getDate();
  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(
    hoy.getMonth() + 1
  ).padStart(2, "0")}`;

  if (periodo > periodoActual) return [];

  const ultimoDia =
    periodo === periodoActual ? Math.min(ultimoDiaMes, hoy.getDate()) : ultimoDiaMes;
  const inicio = String(fechaDesde || "").startsWith(`${periodo}-`)
    ? fechaDesde
    : `${periodo}-01`;

  return Array.from({ length: ultimoDia }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  ).filter((fecha) => fecha >= inicio);
}

function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

async function sincronizarDia(fecha) {
  let ultimoError;

  for (let intento = 1; intento <= 2; intento += 1) {
    try {
      const respuesta = await apiFetch(
        "/api/copecfuel/oficial?recurso=productos_eerr",
        {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accion: "sincronizar_dia", fecha }),
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

export async function sincronizarEerrProductos(
  periodo,
  fechaDesde,
  onProgreso
) {
  const fechas = fechasDesde(periodo, fechaDesde);

  if (fechas.length === 0) {
    throw new Error("El periodo no tiene dias disponibles para sincronizar.");
  }

  const resultado = {
    total: fechas.length,
    completados: 0,
    registros: 0,
    errores: [],
  };

  for (const [indice, fecha] of fechas.entries()) {
    onProgreso?.({ actual: indice + 1, total: fechas.length, fecha });

    try {
      const dia = await sincronizarDia(fecha);
      resultado.completados += 1;
      resultado.registros += Number(dia.registros || 0);
    } catch (error) {
      resultado.errores.push({
        fecha,
        mensaje: error.message || "No fue posible sincronizar el dia.",
      });
    }
  }

  return resultado;
}
