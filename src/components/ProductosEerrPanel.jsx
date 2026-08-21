import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  FileSpreadsheet,
  Info,
  PackageOpen,
  Percent,
  RefreshCw,
  TrendingUp,
  Upload,
} from "lucide-react";
import {
  obtenerEerrProductos,
  sincronizarEerrProductos,
} from "../services/productosEerrApi.js";
import ProductosCostosModal from "./ProductosCostosModal.jsx";

const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const numero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 });
const porcentaje = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const COLORES_CATEGORIAS = [
  "#173f78",
  "#ef2b2d",
  "#f5a313",
  "#9850cf",
  "#13a0a0",
  "#39a75a",
  "#64748b",
];

function formatearFecha(valor) {
  if (!valor) return "Sin datos";
  const fecha = new Date(`${valor}T12:00:00`);
  return Number.isNaN(fecha.getTime()) ? valor : fecha.toLocaleDateString("es-CL");
}

function textoMes(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);
  if (!coincidencia) return periodo;
  return new Date(Number(coincidencia[1]), Number(coincidencia[2]) - 1, 1)
    .toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function ValorFinanciero({ valor, pendiente = false }) {
  if (valor === null || valor === undefined || pendiente) {
    return <span className="eerr-pending-value">Pendiente</span>;
  }
  return <>{moneda.format(valor)}</>;
}

function Indicador({ icono: Icono, tono, titulo, valor, detalle }) {
  return (
    <article className="eerr-kpi-card">
      <div className={`eerr-kpi-icon ${tono}`}><Icono size={23} /></div>
      <div>
        <span>{titulo}</span>
        <strong className={tono === "warning" ? "eerr-warning-number" : ""}>{valor}</strong>
        {detalle ? <small>{detalle}</small> : null}
      </div>
    </article>
  );
}

function crearFondoDona(categorias) {
  const validas = categorias.filter((categoria) => Number(categoria.margenBruto || 0) > 0);
  const total = validas.reduce((suma, categoria) => suma + Number(categoria.margenBruto || 0), 0);
  if (total <= 0) return "conic-gradient(#e2e8f0 0 100%)";

  let acumulado = 0;
  const segmentos = validas.map((categoria, indice) => {
    const inicio = acumulado;
    acumulado += (Number(categoria.margenBruto) / total) * 100;
    return `${COLORES_CATEGORIAS[indice % COLORES_CATEGORIAS.length]} ${inicio}% ${acumulado}%`;
  });
  return `conic-gradient(${segmentos.join(", ")})`;
}

export default function ProductosEerrPanel({ periodo, onPeriodoChange }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [mostrarDetalle, setMostrarDetalle] = useState(false);
  const [mostrarCostos, setMostrarCostos] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await obtenerEerrProductos(periodo));
    } catch (errorCarga) {
      setError(errorCarga.message || "No fue posible cargar el EE.RR. Productos.");
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  useEffect(() => { cargar(); }, [cargar]);

  const generarEerr = useCallback(async () => {
    setSincronizando(true);
    setProgreso(null);
    setMensaje("");
    setError("");
    try {
      const resultado = await sincronizarEerrProductos(periodo, `${periodo}-01`, setProgreso);
      if (resultado.errores.length > 0) {
        setError(`Se procesaron ${resultado.completados} de ${resultado.total} días. ${resultado.errores.length} día(s) quedaron pendientes.`);
      } else {
        setMensaje(`EE.RR. generado: ${resultado.completados} día(s) y ${numero.format(resultado.registros)} línea(s) de productos.`);
      }
      await cargar();
    } catch (errorSincronizacion) {
      setError(errorSincronizacion.message || "No fue posible generar el EE.RR.");
    } finally {
      setSincronizando(false);
      setProgreso(null);
    }
  }, [cargar, periodo]);

  const resumen = datos?.resumen || {};
  const productos = datos?.productos || [];
  const categorias = datos?.categorias || [];
  const productosSinCosto = datos?.productosSinCosto || [];
  const incompleto = Number(resumen.productosSinCosto || 0) > 0;
  const maxVentaCategoria = Math.max(1, ...categorias.map((categoria) => Number(categoria.ventaNeta || 0)));
  const productosPorCategoria = useMemo(() => {
    const conteo = new Map();
    for (const producto of productos) {
      conteo.set(producto.categoria, (conteo.get(producto.categoria) || 0) + 1);
    }
    return conteo;
  }, [productos]);
  const totalMargenPositivo = categorias.reduce((suma, categoria) => suma + Math.max(0, Number(categoria.margenBruto || 0)), 0);
  const dona = crearFondoDona(categorias);
  const hoy = new Date();
  const maximoMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="eerr-dashboard">
      <div className="page-header eerr-page-header">
        <div>
          <span className="eyebrow">Estado de resultados</span>
          <h1>Productos no combustible</h1>
          <p>Margen mensual por producto y categoría.</p>
        </div>

        <div className="page-actions eerr-page-actions">
          <label className="eerr-month-control">
            <CalendarDays size={18} />
            <input type="month" value={periodo} max={maximoMes} aria-label="Mes del estado de resultados" onChange={(evento) => onPeriodoChange(evento.target.value)} disabled={cargando || sincronizando} />
          </label>
          <span className={`eerr-period-badge ${datos?.rango?.parcial ? "partial" : "closed"}`}>
            {datos?.rango?.parcial ? "Mes en curso · Parcial" : "Mes cerrado"}
          </span>
          <button type="button" className="secondary-button button-with-icon" onClick={() => setMostrarCostos(true)}>
            <Upload size={17} />Administrar costos
          </button>
          <button type="button" className="primary-button button-with-icon" onClick={generarEerr} disabled={sincronizando}>
            <FileSpreadsheet size={17} />{sincronizando ? "Generando…" : "Generar EE.RR."}
          </button>
        </div>
      </div>

      <div className="eerr-info-banner">
        <Info size={17} />
        <span>Ventas detectadas automáticamente desde API VENTA_PRODUCTO. El cierre definitivo se realiza al terminar el mes.</span>
      </div>

      {progreso ? (
        <div className="sync-progress" aria-live="polite">
          <div><strong>Generando {progreso.actual} de {progreso.total} días</strong><span>{formatearFecha(progreso.fecha)}</span></div>
          <div className="progress-track"><span style={{ width: `${Math.round((progreso.actual / progreso.total) * 100)}%` }} /></div>
        </div>
      ) : null}
      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error ? <div className="feedback error-feedback">{error}</div> : null}

      <section className="eerr-kpi-grid">
        <Indicador icono={DollarSign} tono="blue" titulo="Ventas netas" valor={moneda.format(resumen.ventaNeta || 0)} />
        <Indicador icono={ArrowDownToLine} tono="red" titulo="Costo neto" valor={incompleto ? "Pendiente" : moneda.format(resumen.costoVenta || 0)} detalle={incompleto ? `Parcial ${moneda.format(resumen.costoVentaParcial || 0)}` : null} />
        <Indicador icono={TrendingUp} tono="green" titulo="Margen" valor={incompleto ? "Pendiente" : moneda.format(resumen.margenBruto || 0)} />
        <Indicador icono={Percent} tono="green" titulo="Margen %" valor={incompleto || resumen.margenPorcentaje === null ? "Pendiente" : `${porcentaje.format(resumen.margenPorcentaje)}%`} />
        <Indicador icono={PackageOpen} tono="purple" titulo="Productos vendidos" valor={numero.format(resumen.productosVendidos || 0)} />
        <Indicador icono={AlertTriangle} tono="warning" titulo="Sin costo informado" valor={numero.format(resumen.productosSinCosto || 0)} />
      </section>

      <section className="eerr-visual-grid">
        <article className="panel eerr-chart-panel">
          <div className="eerr-panel-title"><BarChart3 size={19} /><h2>Margen por categoría</h2></div>
          {categorias.length === 0 ? (
            <div className="empty-state compact"><h3>Sin información para graficar</h3><p>Genera el EE.RR. del mes seleccionado.</p></div>
          ) : (
            <div className="eerr-category-bars">
              <div className="eerr-chart-legend"><span><i className="sale" />Venta neta</span><span><i className="cost" />Costo neto</span></div>
              {categorias.map((categoria) => (
                <div className="eerr-bar-row" key={categoria.categoria}>
                  <strong>{categoria.categoria}</strong>
                  <div className="eerr-bar-area">
                    <div className="eerr-bar sale" style={{ width: `${(Number(categoria.ventaNeta || 0) / maxVentaCategoria) * 100}%` }}><span>{moneda.format(categoria.ventaNeta || 0)}</span></div>
                    <div className="eerr-bar cost" style={{ width: `${(Number(categoria.costoVentaParcial || 0) / maxVentaCategoria) * 100}%` }}><span>{moneda.format(categoria.costoVentaParcial || 0)}</span></div>
                  </div>
                  <b className="eerr-bar-margin">{categoria.completo ? moneda.format(categoria.margenBruto || 0) : "Pendiente"}</b>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel eerr-chart-panel">
          <div className="eerr-panel-heading-row">
            <div className="eerr-panel-title"><TrendingUp size={19} /><h2>Composición del margen</h2></div>
            <span className="eerr-informed-costs">Costos informados<strong>{resumen.ventaNeta ? porcentaje.format(((Number(resumen.ventaNeta || 0) - Number(resumen.ventaNetaSinCosto || 0)) / Number(resumen.ventaNeta)) * 100) : "0,0"}%</strong></span>
          </div>
          <div className="eerr-donut-layout">
            <div className="eerr-donut" style={{ background: dona }}><div><strong>{categorias.filter((categoria) => categoria.completo).length}</strong><span>categorías</span></div></div>
            <div className="eerr-donut-legend">
              {categorias.map((categoria, indice) => {
                const margen = Math.max(0, Number(categoria.margenBruto || 0));
                const participacion = totalMargenPositivo > 0 ? (margen / totalMargenPositivo) * 100 : 0;
                return (
                  <div key={categoria.categoria}>
                    <i style={{ background: COLORES_CATEGORIAS[indice % COLORES_CATEGORIAS.length] }} />
                    <span>{categoria.categoria}</span>
                    <strong>{categoria.completo ? `${moneda.format(margen)} (${porcentaje.format(participacion)}%)` : "Costo pendiente"}</strong>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="eerr-source-note"><Info size={16} /><span>Fuente: API VENTA_PRODUCTO. Costos netos con vigencia histórica.</span></div>
        </article>
      </section>

      <section className="eerr-bottom-grid">
        <article className="panel table-panel eerr-category-table-panel">
          <div className="panel-header table-header">
            <div><h2>Resultado por categoría</h2><p>{textoMes(periodo)} · resumen financiero del periodo.</p></div>
            <button type="button" className="icon-button" onClick={cargar} disabled={cargando || sincronizando} title="Actualizar resumen"><RefreshCw className={cargando ? "spin" : ""} size={17} /></button>
          </div>
          <div className="table-wrapper">
            <table className="data-table eerr-category-table">
              <thead><tr><th>Categoría</th><th className="amount-column">Productos</th><th className="amount-column">Unidades</th><th className="amount-column">Venta neta</th><th className="amount-column">Costo neto</th><th className="amount-column">Margen</th><th className="amount-column">Margen %</th><th>Estado</th></tr></thead>
              <tbody>
                {categorias.map((categoria) => (
                  <tr key={categoria.categoria}>
                    <td><strong>{categoria.categoria}</strong></td>
                    <td className="amount-column">{numero.format(productosPorCategoria.get(categoria.categoria) || 0)}</td>
                    <td className="amount-column">{numero.format(categoria.unidades)}</td>
                    <td className="amount-column">{moneda.format(categoria.ventaNeta)}</td>
                    <td className="amount-column"><ValorFinanciero valor={categoria.costoVenta} pendiente={!categoria.completo} /></td>
                    <td className="amount-column eerr-positive-value"><ValorFinanciero valor={categoria.margenBruto} pendiente={!categoria.completo} /></td>
                    <td className="amount-column">{categoria.completo && categoria.margenPorcentaje !== null ? `${porcentaje.format(categoria.margenPorcentaje)}%` : "—"}</td>
                    <td><span className={`status ${categoria.completo ? "status-on" : "status-wait"}`}>{categoria.completo ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{categoria.completo ? "Completo" : `Faltan ${categoria.lineasSinCosto} costos`}</span></td>
                  </tr>
                ))}
              </tbody>
              {categorias.length > 0 ? (
                <tfoot><tr><td><strong>Total general</strong></td><td className="amount-column"><strong>{numero.format(resumen.productosVendidos || 0)}</strong></td><td className="amount-column"><strong>{numero.format(resumen.unidades || 0)}</strong></td><td className="amount-column"><strong>{moneda.format(resumen.ventaNeta || 0)}</strong></td><td className="amount-column"><strong><ValorFinanciero valor={resumen.costoVenta} pendiente={incompleto} /></strong></td><td className="amount-column eerr-positive-value"><strong><ValorFinanciero valor={resumen.margenBruto} pendiente={incompleto} /></strong></td><td className="amount-column"><strong>{!incompleto && resumen.margenPorcentaje !== null ? `${porcentaje.format(resumen.margenPorcentaje)}%` : "—"}</strong></td><td>—</td></tr></tfoot>
              ) : null}
            </table>
          </div>
        </article>

        <aside className="panel eerr-review-panel">
          <h2>Productos por revisar</h2>
          <div className={`eerr-review-box ${incompleto ? "warning" : "complete"}`}>
            {incompleto ? <AlertTriangle size={31} /> : <CheckCircle2 size={31} />}
            <strong>{incompleto ? `${resumen.productosSinCosto} productos sin costo neto` : "Todos los costos informados"}</strong>
            <p>{incompleto ? "Completa los costos para obtener un margen preciso y cerrar el mes." : "El resultado del periodo contiene costos para todos los productos vendidos."}</p>
            <button type="button" className="eerr-review-button" onClick={() => setMostrarCostos(true)}><FileSpreadsheet size={17} />{incompleto ? "Completar costos" : "Administrar costos"}</button>
          </div>
          {mostrarDetalle && productosSinCosto.length > 0 ? (
            <div className="eerr-missing-list">
              {productosSinCosto.map((producto) => <div key={producto.productoId}><strong>{producto.descripcion}</strong><span>{moneda.format(producto.ventaNeta || 0)} en ventas</span></div>)}
            </div>
          ) : null}
        </aside>
      </section>

      <details className="panel eerr-product-detail" open={mostrarDetalle}>
        <summary onClick={(evento) => { evento.preventDefault(); setMostrarDetalle((actual) => !actual); }}>
          <span><strong>Detalle por producto</strong><small>Despliega la trazabilidad completa de ventas, costos y margen.</small></span><span>{productos.length} productos</span>
        </summary>
        <div className="table-wrapper">
          <table className="data-table eerr-products-table">
            <thead><tr><th>Producto</th><th>Categoría</th><th className="amount-column">Unidades</th><th className="amount-column">Venta neta</th><th className="amount-column">Costo venta</th><th className="amount-column">Margen</th><th className="amount-column">Margen %</th><th>Estado</th></tr></thead>
            <tbody>
              {productos.map((producto) => (
                <tr key={producto.productoId}>
                  <td><strong className="table-primary">{producto.descripcion}</strong><span className="table-secondary">{numero.format(producto.transacciones)} transacciones</span></td>
                  <td>{producto.categoria}</td><td className="amount-column">{numero.format(producto.unidades)}</td><td className="amount-column">{moneda.format(producto.ventaNeta)}</td><td className="amount-column"><ValorFinanciero valor={producto.costoVenta} pendiente={!producto.completo} /></td><td className="amount-column eerr-positive-value"><ValorFinanciero valor={producto.margenBruto} pendiente={!producto.completo} /></td><td className="amount-column">{producto.completo && producto.margenPorcentaje !== null ? `${porcentaje.format(producto.margenPorcentaje)}%` : "—"}</td><td><span className={`status ${producto.completo ? "status-on" : "status-wait"}`}>{producto.completo ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{producto.completo ? "Calculado" : "Falta costo"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <ProductosCostosModal
        abierto={mostrarCostos}
        onCerrar={() => setMostrarCostos(false)}
        onCostoActualizado={cargar}
      />
    </div>
  );
}
