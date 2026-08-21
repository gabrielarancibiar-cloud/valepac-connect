import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import {
  obtenerEerrProductos,
  sincronizarEerrProductos,
} from "../services/productosEerrApi.js";

const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const numero = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 3,
});

const porcentaje = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function ultimoDiaProcesable(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return "";

  const ultimoDia = new Date(
    Number(coincidencia[1]),
    Number(coincidencia[2]),
    0
  ).getDate();
  const limiteMes = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  const hoy = new Date();
  const hoyLocal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(hoy.getDate()).padStart(2, "0")}`;

  return limiteMes < hoyLocal ? limiteMes : hoyLocal;
}

function formatearFecha(valor) {
  if (!valor) return "Sin datos";
  const fecha = new Date(`${valor}T12:00:00`);
  return Number.isNaN(fecha.getTime()) ? valor : fecha.toLocaleDateString("es-CL");
}

function ValorFinanciero({ valor, pendiente = false }) {
  if (valor === null || valor === undefined || pendiente) {
    return <span className="eerr-pending-value">Pendiente de costo</span>;
  }

  return <>{moneda.format(valor)}</>;
}

export default function ProductosEerrPanel({
  periodo,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
}) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      setDatos(await obtenerEerrProductos(periodo));
    } catch (errorCarga) {
      setError(
        errorCarga.message || "No fue posible cargar el EE.RR. Productos."
      );
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setProgreso(null);
    setMensaje("");
    setError("");

    try {
      const resultado = await sincronizarEerrProductos(
        periodo,
        fechaDesde,
        setProgreso
      );

      if (resultado.errores.length > 0) {
        setError(
          `Se procesaron ${resultado.completados} de ${resultado.total} días. ` +
            `${resultado.errores.length} día(s) quedaron pendientes.`
        );
      } else {
        setMensaje(
          `EE.RR. actualizado: ${resultado.completados} día(s) y ` +
            `${numero.format(resultado.registros)} línea(s) de productos.`
        );
      }

      await cargar();
    } catch (errorSincronizacion) {
      setError(
        errorSincronizacion.message || "No fue posible sincronizar las ventas."
      );
    } finally {
      setSincronizando(false);
      setProgreso(null);
    }
  }, [cargar, fechaDesde, periodo]);

  const resumen = datos?.resumen || {};
  const productos = datos?.productos || [];
  const incompleto = Number(resumen.productosSinCosto || 0) > 0;
  const hoy = new Date();
  const maximoMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(
    2,
    "0"
  )}`;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Estado de resultados</span>
          <h1>Productos no combustibles</h1>
          <p>
            Margen mensual calculado con venta neta de CopecFuel y costo neto
            vigente por producto.
          </p>
        </div>

        <div className="page-actions">
          <label className="month-filter">
            <span>Mes</span>
            <input
              type="month"
              value={periodo}
              max={maximoMes}
              onChange={(evento) => onPeriodoChange(evento.target.value)}
              disabled={cargando || sincronizando}
            />
          </label>
          <label className="month-filter sync-date-filter">
            <span>Procesar desde</span>
            <input
              type="date"
              value={fechaDesde}
              min={`${periodo}-01`}
              max={ultimoDiaProcesable(periodo)}
              onChange={(evento) => onFechaDesdeChange(evento.target.value)}
              disabled={cargando || sincronizando}
            />
          </label>
          <button
            type="button"
            className="primary-button button-with-icon"
            onClick={sincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando ? "Sincronizando…" : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {progreso ? (
        <div className="sync-progress" aria-live="polite">
          <div>
            <strong>
              Sincronizando {progreso.actual} de {progreso.total} días
            </strong>
            <span>{formatearFecha(progreso.fecha)}</span>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${Math.round((progreso.actual / progreso.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error ? <div className="feedback error-feedback">{error}</div> : null}

      {datos?.rango?.parcial ? (
        <div className="feedback eerr-partial-feedback">
          Vista parcial del mes en curso, con información hasta el {" "}
          {formatearFecha(datos.rango.hasta)}.
        </div>
      ) : null}

      {incompleto ? (
        <div className="feedback eerr-cost-warning">
          <AlertCircle size={17} />
          Hay {resumen.productosSinCosto} producto(s) vendidos sin costo vigente.
          El costo y el margen total permanecen pendientes para no mostrar un
          resultado incompleto como definitivo.
        </div>
      ) : null}

      <section className="cards-grid">
        <article className="metric-card">
          <span>Venta neta</span>
          <strong>{moneda.format(resumen.ventaNeta || 0)}</strong>
          <small>Base neta oficial, sin IVA</small>
        </article>
        <article className="metric-card">
          <span>Costo de venta</span>
          <strong className={incompleto ? "metric-pending" : ""}>
            <ValorFinanciero valor={resumen.costoVenta} pendiente={incompleto} />
          </strong>
          <small>
            {incompleto
              ? `Costo parcial ${moneda.format(resumen.costoVentaParcial || 0)}`
              : "Cantidad por costo neto vigente"}
          </small>
        </article>
        <article className="metric-card featured">
          <span>Margen bruto</span>
          <strong className={incompleto ? "metric-pending" : ""}>
            <ValorFinanciero valor={resumen.margenBruto} pendiente={incompleto} />
          </strong>
          <small>Venta neta menos costo de venta</small>
        </article>
        <article className="metric-card">
          <span>Margen</span>
          <strong className={incompleto ? "metric-pending" : ""}>
            {incompleto || resumen.margenPorcentaje === null
              ? "Pendiente"
              : `${porcentaje.format(resumen.margenPorcentaje)}%`}
          </strong>
          <small>
            {numero.format(resumen.productosVendidos || 0)} productos vendidos
          </small>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Margen por producto</h2>
            <p>
              Cierre mensual auditable por categoría, unidades, ventas y costo.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={cargar}
            disabled={cargando || sincronizando}
            title="Actualizar resumen"
            aria-label="Actualizar resumen"
          >
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>

        {cargando && !datos ? (
          <div className="empty-state compact">
            <RefreshCw className="spin" size={28} />
            <h3>Cargando EE.RR.</h3>
            <p>Calculando ventas, costos y margen del periodo.</p>
          </div>
        ) : null}

        {!cargando && datos && productos.length === 0 ? (
          <div className="empty-state compact">
            <h3>Sin ventas de productos</h3>
            <p>Sincroniza el periodo para obtener VENTA_PRODUCTO.</p>
          </div>
        ) : null}

        {productos.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table eerr-products-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th className="amount-column">Unidades</th>
                  <th className="amount-column">Venta neta</th>
                  <th className="amount-column">Costo venta</th>
                  <th className="amount-column">Margen bruto</th>
                  <th className="amount-column">Margen</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((producto) => (
                  <tr key={producto.productoId}>
                    <td>
                      <strong className="table-primary">
                        {producto.descripcion}
                      </strong>
                      <span className="table-secondary">
                        {numero.format(producto.transacciones)} transacciones
                      </span>
                    </td>
                    <td>{producto.categoria}</td>
                    <td className="amount-column">
                      {numero.format(producto.unidades)}
                    </td>
                    <td className="amount-column">
                      {moneda.format(producto.ventaNeta)}
                    </td>
                    <td className="amount-column">
                      <ValorFinanciero
                        valor={producto.costoVenta}
                        pendiente={!producto.completo}
                      />
                    </td>
                    <td className="amount-column amount-strong">
                      <ValorFinanciero
                        valor={producto.margenBruto}
                        pendiente={!producto.completo}
                      />
                    </td>
                    <td className="amount-column">
                      {producto.completo && producto.margenPorcentaje !== null
                        ? `${porcentaje.format(producto.margenPorcentaje)}%`
                        : "—"}
                    </td>
                    <td>
                      {producto.completo ? (
                        <span className="status status-on">
                          <CheckCircle2 size={13} />
                          Calculado
                        </span>
                      ) : (
                        <span className="status status-wait">
                          <AlertCircle size={13} />
                          Falta costo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
