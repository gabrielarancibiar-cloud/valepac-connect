import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { sincronizarAbonosCopec } from "../services/copecApi.js";
import {
  clasificarFacturaPortalCopec,
  obtenerDocumentoFacturaPortalCopec,
  obtenerFacturasPortalCopec,
} from "../services/facturasCopecApi.js";

const CATEGORIAS = [
  ["TODAS", "Todas las categorías"],
  ["COMBUSTIBLES", "Combustibles"],
  ["PRODUCTOS_NO_COMBUSTIBLES", "Productos no combustibles"],
  ["COBROS_FIJOS", "Cobros fijos"],
  ["MANTENCIONES", "Mantenciones"],
  ["POR_REVISAR", "Por revisar"],
];

const etiquetasCategoria = Object.fromEntries(CATEGORIAS);
const formatoMoneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const formatoNumero = new Intl.NumberFormat("es-CL");

function formatearFecha(valor) {
  if (!valor) return "—";
  const [anio, mes, dia] = String(valor).slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}-${mes}-${anio}` : valor;
}

export default function FacturasCopecPanel({
  periodo,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
}) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [procesandoId, setProcesandoId] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("TODAS");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      setDatos(await obtenerFacturasPortalCopec(periodo));
    } catch (errorCarga) {
      setError(errorCarga.message || "No fue posible cargar las facturas.");
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const facturasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es-CL");

    return (datos?.facturas || []).filter((factura) => {
      if (
        filtroCategoria !== "TODAS" &&
        factura.categoria !== filtroCategoria
      ) {
        return false;
      }

      if (!termino) return true;

      return [
        factura.numero_documento,
        factura.factura_sd,
        factura.linea_producto,
        factura.clasificacion_origen,
        factura.monto,
        factura.fecha_movimiento,
      ].some((valor) =>
        String(valor ?? "").toLocaleLowerCase("es-CL").includes(termino)
      );
    });
  }, [busqueda, datos, filtroCategoria]);

  const sincronizar = async () => {
    setSincronizando(true);
    setError("");
    setMensaje("");

    try {
      const resultado = await sincronizarAbonosCopec(periodo, fechaDesde);

      if (resultado.facturasError) {
        throw new Error(
          `La cartola se sincronizó, pero las facturas no se guardaron: ${resultado.facturasError}`
        );
      }

      setMensaje(
        `${formatoNumero.format(resultado.facturasGuardadas || 0)} factura(s) actualizadas sin duplicar registros.`
      );
      await cargar();
    } catch (errorSync) {
      setError(errorSync.message || "No fue posible sincronizar las facturas.");
    } finally {
      setSincronizando(false);
    }
  };

  const cambiarCategoria = async (factura, categoria) => {
    setProcesandoId(factura.id);
    setError("");

    try {
      await clasificarFacturaPortalCopec(factura.id, categoria);
      setDatos((actual) => ({
        ...actual,
        facturas: (actual?.facturas || []).map((item) =>
          item.id === factura.id
            ? { ...item, categoria, categoria_origen: "manual" }
            : item
        ),
      }));
      await cargar();
    } catch (errorCategoria) {
      setError(errorCategoria.message || "No fue posible guardar la categoría.");
    } finally {
      setProcesandoId(null);
    }
  };

  const abrirDocumento = async (factura) => {
    const ventana = window.open("about:blank", "_blank", "noopener,noreferrer");
    setProcesandoId(factura.id);
    setError("");

    try {
      const resultado = await obtenerDocumentoFacturaPortalCopec(factura.id);

      if (ventana) {
        ventana.location.replace(resultado.enlace);
      } else {
        window.location.assign(resultado.enlace);
      }
    } catch (errorDocumento) {
      ventana?.close();
      setError(errorDocumento.message || "No fue posible abrir la factura.");
    } finally {
      setProcesandoId(null);
    }
  };

  const resumen = datos?.resumen || {};
  const montoCombustibles =
    resumen.categorias?.COMBUSTIBLES?.monto || 0;
  const montoOtros =
    Number(resumen.montoTotal || 0) - Number(montoCombustibles || 0);

  return (
    <div className="invoice-dashboard">
      <div className="page-header">
        <div>
          <span className="eyebrow">Control de cargos</span>
          <h1>Facturas Portal Copec</h1>
          <p>
            Registro incremental de facturas cargadas en la cartola, con
            clasificación y acceso al documento original.
          </p>
        </div>

        <div className="page-actions">
          <label className="month-filter">
            <span>Mes</span>
            <input
              type="month"
              value={periodo}
              onChange={(evento) => onPeriodoChange(evento.target.value)}
              disabled={cargando || sincronizando}
            />
          </label>
          <label className="month-filter sync-date-filter">
            <span>Procesar desde</span>
            <input
              type="date"
              value={fechaDesde}
              onChange={(evento) => onFechaDesdeChange(evento.target.value)}
              disabled={cargando || sincronizando}
            />
          </label>
          <button
            className="primary-button button-with-icon"
            onClick={sincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando ? "Sincronizando…" : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error ? <div className="feedback error-feedback">{error}</div> : null}

      <div className="feedback info-feedback invoice-rule-note">
        <strong>Clasificación inicial:</strong> combustible se reconoce desde la
        cartola. Los demás cobros quedan disponibles para revisión por documento
        y nunca se reclasifican automáticamente después de un ajuste manual.
      </div>

      <section className="cards-grid invoice-summary-grid">
        <article className="metric-card">
          <span>Facturas del período</span>
          <strong>{formatoNumero.format(resumen.cantidad || 0)}</strong>
          <small>{formatoMoneda.format(resumen.montoTotal || 0)} en cargos</small>
        </article>
        <article className="metric-card">
          <span>Combustibles</span>
          <strong>{formatoMoneda.format(montoCombustibles)}</strong>
          <small>
            {formatoNumero.format(
              resumen.categorias?.COMBUSTIBLES?.cantidad || 0
            )} factura(s)
          </small>
        </article>
        <article className="metric-card">
          <span>Otros cobros clasificados</span>
          <strong>{formatoMoneda.format(montoOtros)}</strong>
          <small>Productos, fijos y mantenciones</small>
        </article>
        <article className={`metric-card ${resumen.pendientes ? "danger-card" : "success-card"}`}>
          <span>Por revisar</span>
          <strong>{formatoNumero.format(resumen.pendientes || 0)}</strong>
          <small>
            {resumen.pendientes
              ? "Requieren abrir documento o clasificar"
              : "Todas las facturas están clasificadas"}
          </small>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Detalle de facturas</h2>
            <p>
              {formatoNumero.format(facturasFiltradas.length)} documento(s)
              visibles del período seleccionado.
            </p>
          </div>
          <div className="table-actions invoice-table-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar factura, línea o monto"
              />
            </label>
            <select
              className="invoice-category-filter"
              value={filtroCategoria}
              onChange={(evento) => setFiltroCategoria(evento.target.value)}
            >
              {CATEGORIAS.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>{etiqueta}</option>
              ))}
            </select>
            <button
              className="icon-button"
              onClick={cargar}
              disabled={cargando}
              aria-label="Actualizar facturas"
              title="Actualizar facturas"
            >
              <RefreshCw className={cargando ? "spin" : ""} size={17} />
            </button>
          </div>
        </div>

        {cargando && !datos ? (
          <div className="empty-state compact">
            <RefreshCw className="spin" size={28} />
            <h3>Cargando facturas</h3>
            <p>Consultando los cargos guardados del período.</p>
          </div>
        ) : null}

        {!cargando && !error && facturasFiltradas.length === 0 ? (
          <div className="empty-state compact">
            <FileText size={30} />
            <h3>No hay facturas para mostrar</h3>
            <p>Sincroniza la cartola o cambia los filtros.</p>
          </div>
        ) : null}

        {facturasFiltradas.length ? (
          <div className="table-wrapper">
            <table className="data-table invoice-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Factura</th>
                  <th>Línea</th>
                  <th className="amount-column">Monto</th>
                  <th>Categoría</th>
                  <th>Documento</th>
                </tr>
              </thead>
              <tbody>
                {facturasFiltradas.map((factura) => (
                  <tr key={factura.id}>
                    <td>{formatearFecha(factura.fecha_movimiento)}</td>
                    <td>
                      <strong className="table-primary">
                        {factura.numero_documento || "Sin número"}
                      </strong>
                      <span className="table-secondary">
                        SD {factura.factura_sd || "—"}
                      </span>
                    </td>
                    <td>
                      <strong className="table-primary">
                        {factura.linea_producto || "Otros"}
                      </strong>
                      <span className="table-secondary">
                        {factura.tipo_documento || "Factura"}
                      </span>
                    </td>
                    <td className="amount-column">
                      <strong>{formatoMoneda.format(factura.monto || 0)}</strong>
                    </td>
                    <td>
                      <select
                        className={`invoice-category-select category-${String(factura.categoria || "POR_REVISAR").toLowerCase()}`}
                        value={factura.categoria || "POR_REVISAR"}
                        onChange={(evento) =>
                          cambiarCategoria(factura, evento.target.value)
                        }
                        disabled={procesandoId === factura.id}
                      >
                        {CATEGORIAS.slice(1).map(([valor, etiqueta]) => (
                          <option key={valor} value={valor}>{etiqueta}</option>
                        ))}
                      </select>
                      <span className="table-secondary">
                        {factura.categoria_origen === "manual"
                          ? "Revisión manual"
                          : factura.confianza_categoria
                            ? `${factura.confianza_categoria}% regla automática`
                            : "Pendiente de revisión"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary-button button-with-icon invoice-document-button"
                        onClick={() => abrirDocumento(factura)}
                        disabled={
                          procesandoId === factura.id || !factura.factura_sd
                        }
                      >
                        {procesandoId === factura.id ? (
                          <RefreshCw className="spin" size={15} />
                        ) : (
                          <ExternalLink size={15} />
                        )}
                        Abrir factura
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="invoice-next-step">
        <AlertCircle size={18} />
        <div>
          <strong>Lectura documental preparada por etapas</strong>
          <p>
            El visor de Copec/Acepta se abre de forma segura. Las facturas que no
            pueden clasificarse con la cartola quedan en “Por revisar”; el texto
            del PDF se incorporará cuando el visor entregue el archivo descargable.
          </p>
        </div>
        <Wrench size={18} />
      </section>
    </div>
  );
}
