import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Download,
  Fuel,
  RefreshCw,
  Route,
  TrendingUp,
} from "lucide-react";
import { sincronizarMesCopecFuel } from "../services/copecFuelApi.js";
import { obtenerPoaVolumenes } from "../services/poaApi.js";
import { sincronizarVolumenPropio } from "../services/recompraApi.js";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const litros = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const metrosCubicos = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function mostrarM3(valor) {
  const numero = Number(valor || 0);
  return numero > 0 ? metrosCubicos.format(numero / 1000) : "—";
}

function fechaLegible(valor) {
  if (!valor) return "Sin datos sincronizados";
  const fecha = new Date(`${valor}T12:00:00`);
  return Number.isNaN(fecha.getTime()) ? valor : fecha.toLocaleDateString("es-CL");
}

function exportarPoa(datos) {
  const filas = [
    ["Grupo", "Canal", ...MESES, "Total anual"],
    ["TOTAL", "Total productos", ...(datos.mesesTotales || []), datos.resumen?.volumenTotal || 0],
    ...(datos.filas || []).map((fila) => [fila.grupo, fila.etiqueta, ...fila.meses, fila.total]),
  ];
  const contenido = filas
    .map((fila) => fila.map((valor) => `"${String(valor ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  const archivo = new Blob(["\uFEFF", contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `POA_volumenes_${datos.anio}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Indicador({ icono: Icono, titulo, valor, detalle, tono = "blue" }) {
  return (
    <article className="poa-kpi">
      <span className={`poa-kpi-icon ${tono}`}><Icono size={22} /></span>
      <div>
        <small>{titulo}</small>
        <strong>{valor}</strong>
        <span>{detalle}</span>
      </div>
    </article>
  );
}

export default function PoaVolumenesPanel({ periodo }) {
  const anioActual = new Date().getFullYear();
  const mesActual = `${anioActual}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [anio, setAnio] = useState(Number(String(periodo || anioActual).slice(0, 4)) || anioActual);
  const [mesSincronizar, setMesSincronizar] = useState(
    /^\d{4}-\d{2}$/.test(String(periodo || ""))
      ? periodo
      : mesActual
  );
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);

    try {
      setDatos(await obtenerPoaVolumenes(anio));
    } catch (errorCarga) {
      setError(errorCarga.message || "No fue posible cargar los volúmenes POA.");
    } finally {
      setCargando(false);
    }
  }, [anio]);

  useEffect(() => { cargar(); }, [cargar]);

  const sincronizarMes = useCallback(async () => {
    setSincronizando(true);
    setError("");
    setMensaje("");
    setProgreso(null);

    try {
      const resultadoCopecFuel = await sincronizarMesCopecFuel(
        mesSincronizar,
        setProgreso,
        { fechaDesde: `${mesSincronizar}-01`, alcance: "poa" }
      );
      const resultadoEnRuta = await sincronizarVolumenPropio(
        mesSincronizar,
        `${mesSincronizar}-01`
      );
      const errores = resultadoCopecFuel.errores?.length || 0;
      setMensaje(
        `${resultadoCopecFuel.completados} de ${resultadoCopecFuel.total} día(s) CopecFuel procesados y ${resultadoEnRuta?.poa?.entregasIncluidas || 0} entrega(s) EnRuta incorporadas.`
      );
      if (errores) {
        const detalle = resultadoCopecFuel.errores
          .map((pendiente) => `${pendiente.fecha}: ${pendiente.mensaje}`)
          .join(" · ");
        setError(`${errores} día(s) pendientes después de los reintentos. ${detalle}`);
      }
      setAnio(Number(mesSincronizar.slice(0, 4)));
      await cargar();
    } catch (errorSincronizacion) {
      setError(errorSincronizacion.message || "No fue posible sincronizar el mes POA.");
    } finally {
      setSincronizando(false);
      setProgreso(null);
    }
  }, [cargar, mesSincronizar]);

  const resumen = datos?.resumen || {};
  const filas = datos?.filas || [];
  const anios = useMemo(
    () => Array.from({ length: 7 }, (_, indice) => anioActual + 2 - indice),
    [anioActual]
  );
  const progresoTexto = progreso
    ? `Procesando ${progreso.fecha} · ${progreso.actual} de ${progreso.total}`
    : "";

  return (
    <div className="poa-dashboard">
      <div className="page-header poa-page-header">
        <div>
          <span className="eyebrow">Plan operacional anual</span>
          <h1>POA · Volúmenes de combustible</h1>
          <p>Historia mensual de litros por producto y canal de venta.</p>
        </div>

        <div className="page-actions poa-actions">
          <label className="poa-control">
            <span>Año a visualizar</span>
            <select value={anio} onChange={(evento) => { setError(""); setAnio(Number(evento.target.value)); }} disabled={cargando || sincronizando}>
              {anios.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
            </select>
          </label>
          <button type="button" className="secondary-button button-with-icon" onClick={() => { setError(""); cargar(); }} disabled={cargando || sincronizando}>
            <RefreshCw size={17} className={cargando ? "spin" : ""} />Actualizar
          </button>
          <button type="button" className="secondary-button button-with-icon" onClick={() => datos && exportarPoa(datos)} disabled={!datos || cargando}>
            <Download size={17} />Exportar CSV
          </button>
        </div>
      </div>

      <section className="poa-sync-card">
        <div>
          <CalendarDays size={20} />
          <div>
            <strong>Completar historia mensual</strong>
            <span>Actualiza ventas CopecFuel y entregas TAE/Concesionario desde EnRuta.</span>
          </div>
        </div>
        <div className="poa-sync-actions">
          <input type="month" value={mesSincronizar} max={mesActual} onChange={(evento) => setMesSincronizar(evento.target.value)} disabled={sincronizando} />
          <button type="button" className="primary-button button-with-icon" onClick={sincronizarMes} disabled={sincronizando || !mesSincronizar}>
            <RefreshCw size={17} className={sincronizando ? "spin" : ""} />
            {sincronizando ? "Sincronizando…" : "Sincronizar mes"}
          </button>
        </div>
      </section>

      {progresoTexto ? <div className="feedback info">{progresoTexto}</div> : null}
      {mensaje ? <div className="feedback success">{mensaje}</div> : null}
      {error ? <div className="feedback error">{error}</div> : null}

      <section className="poa-kpis">
        <Indicador icono={Fuel} titulo="Volumen registrado" valor={`${litros.format(resumen.volumenTotal || 0)} L`} detalle={`${metrosCubicos.format((resumen.volumenTotal || 0) / 1000)} m³`} />
        <Indicador icono={Fuel} titulo="Diesel" valor={`${litros.format(resumen.diesel || 0)} L`} detalle="DSL · todos los canales" tono="navy" />
        <Indicador icono={BarChart3} titulo="Gasolinas" valor={`${litros.format(resumen.gasolinas || 0)} L`} detalle="G93 + G97 + distribución G95" tono="amber" />
        <Indicador icono={TrendingUp} titulo="Proyección anual base" valor={`${litros.format(resumen.proyeccionAnual || 0)} L`} detalle={`Promedio de ${resumen.mesesConDatos || 0} mes(es) con datos × 12`} tono="green" />
      </section>

      <section className="poa-table-card">
        <header>
          <div>
            <h2>Historia {anio} · Volumen (m³)</h2>
            <p>Los valores mensuales se muestran en metros cúbicos; el archivo exportado conserva litros.</p>
          </div>
          <div className="poa-coverage">
            <span>Datos hasta</span>
            <strong>{fechaLegible(datos?.cobertura?.hasta)}</strong>
          </div>
        </header>

        <div className="poa-table-scroll">
          <table className="poa-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Canal</th>
                {MESES.map((mes) => <th key={mes}>{mes}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="poa-grand-total">
                <td>Total</td>
                <td>Total productos</td>
                {(datos?.mesesTotales || Array(12).fill(0)).map((valor, indice) => <td key={MESES[indice]}>{mostrarM3(valor)}</td>)}
                <td>{mostrarM3(resumen.volumenTotal)}</td>
              </tr>
              {filas.map((fila, indice) => {
                const inicioGrupo = indice === 0 || filas[indice - 1]?.grupo !== fila.grupo;
                const cantidadGrupo = filas.filter((otra) => otra.grupo === fila.grupo).length;

                return (
                  <tr key={`${fila.grupo}-${fila.canal}-${fila.combustible || "todos"}`} className={fila.esTotal ? "poa-group-total" : ""}>
                    {inicioGrupo ? <td className="poa-product-cell" rowSpan={cantidadGrupo}>{fila.grupo}</td> : null}
                    <td>{fila.etiqueta}</td>
                    {fila.meses.map((valor, mes) => <td key={`${fila.canal}-${mes}`}>{mostrarM3(valor)}</td>)}
                    <td>{mostrarM3(fila.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="poa-rules">
        <Route size={21} />
        <div>
          <strong>Fuentes y reglas aplicadas</strong>
          <p><b>Isla:</b> débito, crédito, App Copec, efectivo/dinero, crédito documentado y Rutpay. <b>Cuenta Empresa:</b> APP COPEC EMPRESA. <b>EnRuta:</b> TAE y Concesionario. Gasolina 95 se distribuye 50% en G93 y 50% en G97.</p>
          {datos?.cobertura?.fuentes?.length ? <span>Fuentes presentes: {datos.cobertura.fuentes.join(" + ")}</span> : <span><AlertTriangle size={14} /> Sin información; sincroniza un mes para comenzar.</span>}
        </div>
      </section>
    </div>
  );
}
