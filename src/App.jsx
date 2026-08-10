import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Fuel,
  LayoutDashboard,
  Link2,
  RefreshCw,
  Scale,
  Search,
  Settings,
  Truck,
} from "lucide-react";
import {
  obtenerAbonosCopec,
  sincronizarAbonosCopec,
} from "./services/copecApi.js";
import {
  obtenerConciliacionMensual,
  probarConexionCopecFuel,
  sincronizarMesCopecFuel,
  validarEquipoCopecFuel,
} from "./services/copecFuelApi.js";
import {
  importarVentasMuevoEmpresa,
  obtenerCargosMuevoEmpresa,
  sincronizarMesMuevoEmpresa,
} from "./services/muevoEmpresaApi.js";
import {
  descargarExcelEnRuta,
  eliminarTctTaeManual,
  guardarTctTaeManual,
  obtenerRecompra,
  sincronizarVolumenPropio,
} from "./services/recompraApi.js";
import {
  confirmarGuiaCoseducam,
  crearGuiaCoseducam,
  obtenerCoseducam,
} from "./services/coseducamApi.js";
import "./styles.css";

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "copec", label: "Integración Copec", icon: Link2 },
  { id: "copecfuel", label: "CopecFuel", icon: Fuel },
  { id: "muevo", label: "Cargos Muevo empresa", icon: Database },
  { id: "recompra", label: "Recompra", icon: Fuel },
  { id: "coseducam", label: "Coseducam", icon: Truck },
  { id: "conciliacion", label: "Conciliación", icon: Scale },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

const formatoMoneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const formatoNumero = new Intl.NumberFormat("es-CL");

const formatoLitros = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const formatoPrecioCosto = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

function formatearFecha(valor) {
  if (!valor) return "—";

  const fecha = new Date(`${valor}T12:00:00`);
  return Number.isNaN(fecha.getTime())
    ? valor
    : fecha.toLocaleDateString("es-CL");
}

function formatearFechaHora(valor) {
  if (!valor) return "Sin sincronizaciones";

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? valor
    : fecha.toLocaleString("es-CL", {
        dateStyle: "short",
        timeStyle: "short",
      });
}

const ESTADOS_CONCILIACION = {
  conciliado: { etiqueta: "Conciliado", clase: "status-on" },
  diferencia: { etiqueta: "Con diferencia", clase: "status-off" },
  sin_ventas: { etiqueta: "Sin ventas", clase: "status-wait" },
  sin_abonos: { etiqueta: "Sin abonos", clase: "status-wait" },
  sin_cargos: { etiqueta: "Sin cargos", clase: "status-wait" },
  sin_precio: { etiqueta: "Sin precio costo", clase: "status-wait" },
  sin_datos: { etiqueta: "Sin datos", clase: "status-neutral" },
};

function EstadoConciliacion({ estado }) {
  const configuracion =
    ESTADOS_CONCILIACION[estado] || ESTADOS_CONCILIACION.sin_datos;

  return (
    <span className={`status ${configuracion.clase}`}>
      {estado === "conciliado" ? <CheckCircle2 size={13} /> : null}
      {estado === "diferencia" ? <AlertCircle size={13} /> : null}
      {configuracion.etiqueta}
    </span>
  );
}

function SelectorMes({ periodo, onChange, disabled = false }) {
  const fecha = new Date();
  const maximo = `${fecha.getFullYear()}-${String(
    fecha.getMonth() + 1
  ).padStart(2, "0")}`;

  return (
    <label className="month-filter">
      <span>Mes</span>
      <input
        type="month"
        value={periodo}
        max={maximo}
        onChange={(evento) => onChange(evento.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function ultimoDiaProcesable(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return "";

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const limiteMes = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  const hoy = new Date();
  const hoyLocal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(hoy.getDate()).padStart(2, "0")}`;

  return limiteMes < hoyLocal ? limiteMes : hoyLocal;
}

function SelectorFechaDesde({
  periodo,
  fechaDesde,
  onChange,
  disabled = false,
}) {
  return (
    <label className="month-filter sync-date-filter">
      <span>Procesar desde</span>
      <input
        type="date"
        value={fechaDesde}
        min={`${periodo}-01`}
        max={ultimoDiaProcesable(periodo)}
        title="Solo se reprocesarán los días desde esta fecha; el historial anterior se conservará."
        onChange={(evento) => onChange(evento.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function EstadoCarga({ cargando, error, onReintentar }) {
  if (cargando) {
    return (
      <div className="empty-state compact">
        <RefreshCw className="spin" size={28} />
        <h3>Cargando abonos</h3>
        <p>Consultando la información guardada en Supabase.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state compact error-state">
        <AlertCircle size={30} />
        <h3>No fue posible cargar los datos</h3>
        <p>{error}</p>
        <button className="secondary-button" onClick={onReintentar}>
          Reintentar
        </button>
      </div>
    );
  }

  return null;
}

const ETAPAS_SINCRONIZACION = [
  {
    id: "copecfuel",
    nombre: "Ventas CopecFuel",
    descripcion: "Ventas y medios de pago del mes",
    icono: Fuel,
  },
  {
    id: "muevo",
    nombre: "Detalle Muevo empresa",
    descripcion: "Ventas emitidas por Copec",
    icono: Database,
  },
  {
    id: "recompra",
    nombre: "Recompra",
    descripcion: "Combustibles y abonos Recompra",
    icono: Fuel,
  },
  {
    id: "copec",
    nombre: "Portal Concesionario Copec",
    descripcion: "Abonos y cargos de la cartola",
    icono: Link2,
  },
];

function EstadoSincronizacionGlobal({ resultado, activo }) {
  if (activo) {
    return (
      <span className="status status-wait">
        <RefreshCw className="spin" size={13} /> Procesando
      </span>
    );
  }

  if (!resultado) {
    return <span className="status status-neutral">Pendiente</span>;
  }

  if (resultado.estado === "completado") {
    return (
      <span className="status status-on">
        <CheckCircle2 size={13} /> Completado
      </span>
    );
  }

  if (resultado.estado === "advertencia") {
    return (
      <span className="status status-wait">
        <AlertCircle size={13} /> Con observaciones
      </span>
    );
  }

  return (
    <span className="status status-off">
      <AlertCircle size={13} /> Error
    </span>
  );
}

function Dashboard({
  datos,
  cargando,
  error,
  onActualizar,
  periodoSeleccionado,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
  sincronizandoMes,
  progresoMes,
  resultadosMes,
  mensajeMes,
  errorMes,
  onSincronizarMes,
  requiereCodigo,
  codigo,
  validando,
  solicitandoCodigo,
  onCodigoChange,
  onValidar,
  onSolicitarCodigo,
}) {
  const resumen = datos?.resumen;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Resumen general</span>
          <h1>Dashboard</h1>
          <p>Estado de las integraciones y abonos sincronizados.</p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={sincronizandoMes}
          />
          <SelectorFechaDesde
            periodo={periodoSeleccionado}
            fechaDesde={fechaDesde}
            onChange={onFechaDesdeChange}
            disabled={sincronizandoMes}
          />
          <button
            className="primary-button button-with-icon"
            onClick={() => onSincronizarMes()}
            disabled={sincronizandoMes}
          >
            <RefreshCw className={sincronizandoMes ? "spin" : ""} size={16} />
            {sincronizandoMes
              ? "Sincronizando…"
              : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {mensajeMes ? (
        <div className="feedback success-feedback">{mensajeMes}</div>
      ) : null}
      {errorMes ? (
        <div className="feedback error-feedback">{errorMes}</div>
      ) : null}

      {requiereCodigo ? (
        <section className="validation-card">
          <div>
            <span className="eyebrow">Validación requerida</span>
            <h2>Confirma una vez el equipo CopecFuel</h2>
            <p>
              Ingresa el último código recibido por correo. Al validarlo, la
              sincronización completa del mes continuará automáticamente.
            </p>
          </div>
          <form
            className="validation-form"
            onSubmit={(evento) => {
              evento.preventDefault();
              onValidar();
            }}
          >
            <label htmlFor="codigo-copecfuel-dashboard">Código recibido</label>
            <div>
              <input
                id="codigo-copecfuel-dashboard"
                value={codigo}
                onChange={(evento) => onCodigoChange(evento.target.value)}
                placeholder="e6 3a 7b"
                maxLength={8}
                autoComplete="one-time-code"
                disabled={validando}
                required
              />
              <button
                type="submit"
                className="primary-button"
                disabled={validando || solicitandoCodigo || !codigo.trim()}
              >
                {validando ? "Validando…" : "Validar y continuar"}
              </button>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={onSolicitarCodigo}
              disabled={validando || solicitandoCodigo}
            >
              {solicitandoCodigo ? "Solicitando código…" : "Solicitar un código nuevo"}
            </button>
          </form>
        </section>
      ) : null}

      {sincronizandoMes && progresoMes ? (
        <div className="sync-progress" aria-live="polite">
          <div>
            <strong>{progresoMes.titulo}</strong>
            <span>{progresoMes.detalle}</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progresoMes.porcentaje || 0}%` }} />
          </div>
        </div>
      ) : null}

      <section className="panel global-sync-panel">
        <div className="panel-header">
          <div>
            <h2>Sincronización general</h2>
            <p>
              Un solo proceso actualiza todas las integraciones del mes
              seleccionado.
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onActualizar}
            disabled={cargando || sincronizandoMes}
            aria-label="Actualizar indicadores"
            title="Actualizar indicadores"
          >
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>

        <div className="global-sync-list">
          {ETAPAS_SINCRONIZACION.map((etapa) => {
            const Icono = etapa.icono;
            const resultado = resultadosMes?.[etapa.id];
            const activo = progresoMes?.etapa === etapa.id && sincronizandoMes;

            return (
              <div className="global-sync-row" key={etapa.id}>
                <div className="connector-name">
                  <div className="connector-icon">
                    <Icono size={20} />
                  </div>
                  <div>
                    <strong>{etapa.nombre}</strong>
                    <span>{resultado?.detalle || etapa.descripcion}</span>
                  </div>
                </div>
                <EstadoSincronizacionGlobal
                  resultado={resultado}
                  activo={activo}
                />
              </div>
            );
          })}
        </div>
      </section>

      <EstadoCarga
        cargando={cargando && !datos}
        error={error && !datos ? error : null}
        onReintentar={onActualizar}
      />

      <section className="cards-grid">
        <article className="metric-card">
          <span>Integraciones activas</span>
          <strong>{datos?.conectado ? "2" : "1"}</strong>
          <small>Portal Copec y CopecFuel</small>
        </article>

        <article className="metric-card">
          <span>Abonos importados</span>
          <strong>{formatoNumero.format(resumen?.cantidadAbonos || 0)}</strong>
          <small>{resumen?.periodo || "Sin período"}</small>
        </article>

        <article className="metric-card featured">
          <span>Monto abonado</span>
          <strong>{formatoMoneda.format(resumen?.totalAbonos || 0)}</strong>
          <small>Total del período sincronizado</small>
        </article>

        <article className="metric-card">
          <span>Último movimiento</span>
          <strong className="metric-date">
            {formatearFecha(resumen?.ultimoMovimiento)}
          </strong>
          <small>Última fecha disponible</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Estado de conectores</h2>
            <p>Fuentes de información disponibles.</p>
          </div>
        </div>

        <div className="connector-row">
          <div className="connector-name">
            <div className="connector-icon connected-icon">
              <Database size={20} />
            </div>
            <div>
              <strong>Portal Concesionarios Copec</strong>
              <span>
                Última sincronización: {formatearFechaHora(resumen?.ultimaSincronizacion)}
              </span>
            </div>
          </div>

          <span className="status status-on">
            <CheckCircle2 size={13} /> Conectado
          </span>
        </div>

        <div className="connector-row">
          <div className="connector-name">
            <div className="connector-icon">
              <Fuel size={20} />
            </div>
            <div>
              <strong>CopecFuel</strong>
              <span>Ventas y medios de pago conciliables</span>
            </div>
          </div>

          <span className="status status-on">
            <CheckCircle2 size={13} /> Conectado
          </span>
        </div>
      </section>
    </>
  );
}

function CopecIntegration({
  datos,
  cargando,
  error,
  sincronizando,
  mensaje,
  onActualizar,
  onSincronizar,
  periodoSeleccionado,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
}) {
  const [busqueda, setBusqueda] = useState("");
  const resumen = datos?.resumen;
  const abonosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es-CL");

    if (!termino) return datos?.abonos || [];

    return (datos?.abonos || []).filter((abono) =>
      [
        abono.fecha_movimiento,
        abono.descripcion,
        abono.referencia,
        abono.tipo_movimiento,
        abono.id_eds,
        abono.monto,
      ].some((valor) =>
        String(valor ?? "").toLocaleLowerCase("es-CL").includes(termino)
      )
    );
  }, [busqueda, datos]);

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Integraciones</span>
          <h1>Portal Concesionarios Copec</h1>
          <p>Cartola de abonos obtenida automáticamente desde Copec.</p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={cargando || sincronizando}
          />
          <SelectorFechaDesde
            periodo={periodoSeleccionado}
            fechaDesde={fechaDesde}
            onChange={onFechaDesdeChange}
            disabled={cargando || sincronizando}
          />

          <button
            className="primary-button button-with-icon"
            onClick={onSincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando
              ? "Sincronizando…"
              : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error && datos ? <div className="feedback error-feedback">{error}</div> : null}

      <section className="connection-card">
        <div>
          <span className="status status-on">
            <CheckCircle2 size={13} /> Conectado
          </span>
          <h2>Conector Copec operativo</h2>
          <p>
            Última sincronización: {formatearFechaHora(resumen?.ultimaSincronizacion)}
          </p>
        </div>

        <div className="period-badge">
          <span>Período</span>
          <strong>{resumen?.periodo || "—"}</strong>
        </div>
      </section>

      <section className="mini-cards-grid">
        <article className="mini-card">
          <Database size={19} />
          <div>
            <span>Abonos</span>
            <strong>{formatoNumero.format(resumen?.cantidadAbonos || 0)}</strong>
          </div>
        </article>
        <article className="mini-card">
          <CheckCircle2 size={19} />
          <div>
            <span>Monto total</span>
            <strong>{formatoMoneda.format(resumen?.totalAbonos || 0)}</strong>
          </div>
        </article>
        <article className="mini-card">
          <Clock3 size={19} />
          <div>
            <span>Último movimiento</span>
            <strong>{formatearFecha(resumen?.ultimoMovimiento)}</strong>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Cartola de abonos</h2>
            <p>
              Mostrando {formatoNumero.format(abonosFiltrados.length)} de los
              últimos {formatoNumero.format(datos?.abonos?.length || 0)} movimientos cargados.
            </p>
          </div>

          <div className="table-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar referencia, fecha o monto"
              />
            </label>
            <button
              className="icon-button"
              onClick={onActualizar}
              disabled={cargando}
              aria-label="Actualizar tabla"
              title="Actualizar tabla"
            >
              <RefreshCw className={cargando ? "spin" : ""} size={17} />
            </button>
          </div>
        </div>

        <EstadoCarga
          cargando={cargando && !datos}
          error={error && !datos ? error : null}
          onReintentar={onActualizar}
        />

        {!cargando && !error && abonosFiltrados.length === 0 ? (
          <div className="empty-state compact">
            <Database size={30} />
            <h3>No hay abonos para mostrar</h3>
            <p>Sincroniza la cartola o cambia el texto de búsqueda.</p>
          </div>
        ) : null}

        {abonosFiltrados.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th>Referencia</th>
                  <th>EDS</th>
                  <th className="amount-column">Monto</th>
                </tr>
              </thead>
              <tbody>
                {abonosFiltrados.map((abono) => (
                  <tr key={abono.id}>
                    <td>{formatearFecha(abono.fecha_movimiento)}</td>
                    <td>
                      <strong className="table-primary">
                        {abono.descripcion || "Abono Copec"}
                      </strong>
                      <span className="table-secondary">
                        {abono.tipo_movimiento || "ABONO"}
                      </span>
                    </td>
                    <td>{abono.referencia || "—"}</td>
                    <td>{abono.id_eds || "—"}</td>
                    <td className="amount-column amount-positive">
                      {formatoMoneda.format(Number(abono.monto || 0))}
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

function EstadoMensual({ cargando, error, onReintentar, texto }) {
  if (cargando) {
    return (
      <div className="empty-state compact">
        <RefreshCw className="spin" size={28} />
        <h3>Cargando información mensual</h3>
        <p>{texto || "Preparando el resumen diario del período."}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state compact error-state">
        <AlertCircle size={30} />
        <h3>No fue posible cargar el mes</h3>
        <p>{error}</p>
        <button className="secondary-button" onClick={onReintentar}>
          Reintentar
        </button>
      </div>
    );
  }

  return null;
}

function CopecFuelIntegration({
  datos,
  cargando,
  error,
  sincronizando,
  progreso,
  mensaje,
  requiereCodigo,
  codigo,
  validando,
  solicitandoCodigo,
  periodoSeleccionado,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
  onCodigoChange,
  onValidar,
  onSolicitarCodigo,
  onActualizar,
  onSincronizar,
}) {
  const resumen = datos?.resumen;
  const dias = datos?.dias || [];

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Integraciones</span>
          <h1>CopecFuel</h1>
          <p>Ventas diarias que participan en la conciliación de abonos.</p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={cargando || sincronizando}
          />
          <SelectorFechaDesde
            periodo={periodoSeleccionado}
            fechaDesde={fechaDesde}
            onChange={onFechaDesdeChange}
            disabled={cargando || sincronizando}
          />
          <button
            className="primary-button button-with-icon"
            onClick={onSincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando
              ? "Sincronizando…"
              : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {sincronizando && progreso ? (
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
                width: `${Math.round(
                  (progreso.actual / progreso.total) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error && datos && !requiereCodigo ? (
        <div className="feedback error-feedback">{error}</div>
      ) : null}

      {requiereCodigo ? (
        <section className="validation-card">
          <div>
            <span className="eyebrow">Validación requerida</span>
            <h2>Confirma este equipo</h2>
            <p>
              CopecFuel envió un código de seis caracteres al correo asociado a
              la cuenta. Ingrésalo para continuar con la sincronización.
            </p>
          </div>
          <form
            className="validation-form"
            onSubmit={(evento) => {
              evento.preventDefault();
              onValidar();
            }}
          >
            {error ? (
              <p className="validation-error" role="alert">
                {error}
              </p>
            ) : null}
            <label htmlFor="codigo-copecfuel">Código recibido</label>
            <div>
              <input
                id="codigo-copecfuel"
                value={codigo}
                onChange={(evento) => onCodigoChange(evento.target.value)}
                placeholder="e6 3a 7b"
                maxLength={8}
                autoComplete="one-time-code"
                disabled={validando}
                required
              />
              <button
                type="submit"
                className="primary-button"
                disabled={validando || solicitandoCodigo || !codigo.trim()}
              >
                {validando ? "Validando…" : "Validar y continuar"}
              </button>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={onSolicitarCodigo}
              disabled={validando || solicitandoCodigo}
            >
              {solicitandoCodigo
                ? "Solicitando código…"
                : "Solicitar un código nuevo"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="cards-grid">
        <article className="metric-card">
          <span>Días sincronizados</span>
          <strong>
            {formatoNumero.format(resumen?.diasConVentas || 0)} / {" "}
            {formatoNumero.format(resumen?.diasPeriodo || 0)}
          </strong>
          <small>Resúmenes diarios disponibles</small>
        </article>
        <article className="metric-card">
          <span>Ventas conciliables</span>
          <strong>{formatoNumero.format(resumen?.cantidadVentas || 0)}</strong>
          <small>APP Copec, débito, crédito y Rutpay</small>
        </article>
        <article className="metric-card featured">
          <span>Monto conciliable</span>
          <strong>{formatoMoneda.format(resumen?.montoVentas || 0)}</strong>
          <small>Total CopecFuel del mes</small>
        </article>
        <article className="metric-card">
          <span>Última sincronización</span>
          <strong className="metric-small-date">
            {formatearFechaHora(resumen?.ultimaSincronizacion)}
          </strong>
          <small>Información guardada en Supabase</small>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Ventas conciliables por día</h2>
            <p>Detalle de los medios de pago incluidos en la conciliación.</p>
          </div>
          <button
            className="icon-button"
            onClick={onActualizar}
            disabled={cargando || sincronizando}
            aria-label="Actualizar ventas CopecFuel"
            title="Actualizar"
          >
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>

        {!datos ? (
          <EstadoMensual
            cargando={cargando}
            error={error}
            onReintentar={onActualizar}
          />
        ) : null}

        {datos && dias.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table daily-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="amount-column">APP Copec</th>
                  <th className="amount-column">Débito</th>
                  <th className="amount-column">Crédito</th>
                  <th className="amount-column">Rutpay</th>
                  <th className="amount-column">Ventas</th>
                  <th className="amount-column">Total conciliable</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.fecha} className={!dia.copecFuel.sincronizado ? "row-muted" : ""}>
                    <td>
                      <strong className="table-primary">
                        {formatearFecha(dia.fecha)}
                      </strong>
                      <span className="table-secondary">
                        {dia.copecFuel.sincronizado
                          ? "Sincronizado"
                          : "Pendiente"}
                      </span>
                    </td>
                    <td className="amount-column">
                      {formatoMoneda.format(dia.copecFuel.formasPago.APP_COPEC.monto)}
                    </td>
                    <td className="amount-column">
                      {formatoMoneda.format(dia.copecFuel.formasPago.DEBITO.monto)}
                    </td>
                    <td className="amount-column">
                      {formatoMoneda.format(dia.copecFuel.formasPago.CREDITO.monto)}
                    </td>
                    <td className="amount-column">
                      {formatoMoneda.format(dia.copecFuel.formasPago.RUTPAY.monto)}
                    </td>
                    <td className="amount-column">
                      {formatoNumero.format(dia.copecFuel.cantidadVentas)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoMoneda.format(dia.copecFuel.montoConciliable)}
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

function ConciliacionIntegration({
  datos,
  cargando,
  error,
  periodoSeleccionado,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
  onActualizar,
}) {
  const resumen = datos?.resumen;
  const dias = datos?.dias || [];

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Control financiero</span>
          <h1>Conciliación diaria</h1>
          <p>Comparación diaria entre ventas CopecFuel y abonos del Portal Copec.</p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={cargando}
          />
          <SelectorFechaDesde
            periodo={periodoSeleccionado}
            fechaDesde={fechaDesde}
            onChange={onFechaDesdeChange}
            disabled={cargando}
          />
          <button
            className="secondary-button button-with-icon"
            onClick={onActualizar}
            disabled={cargando}
          >
            <RefreshCw className={cargando ? "spin" : ""} size={16} />
            Actualizar
          </button>
        </div>
      </div>

      {error && datos ? <div className="feedback error-feedback">{error}</div> : null}

      <section className="cards-grid">
        <article className="metric-card">
          <span>Días conciliados</span>
          <strong>{formatoNumero.format(resumen?.diasConciliados || 0)}</strong>
          <small>Coincidencia exacta</small>
        </article>
        <article className="metric-card">
          <span>Con diferencia</span>
          <strong>{formatoNumero.format(resumen?.diasConDiferencia || 0)}</strong>
          <small>Días que requieren revisión</small>
        </article>
        <article className="metric-card">
          <span>Pendientes</span>
          <strong>{formatoNumero.format(resumen?.diasPendientes || 0)}</strong>
          <small>Incluye días sin ventas o sin abonos</small>
        </article>
        <article
          className={`metric-card ${
            Number(resumen?.diferencia || 0) === 0 ? "success-card" : "danger-card"
          }`}
        >
          <span>Diferencia neta</span>
          <strong>{formatoMoneda.format(resumen?.diferencia || 0)}</strong>
          <small>Total acumulado del mes</small>
        </article>
      </section>

      <div className="feedback info-feedback">
        <strong>Regla aplicada:</strong> al abono bruto se descuentan propinas y
        vueltos; luego se compara con APP Copec, débito, crédito y
        Rutpay/Billetera Banco Estado.
      </div>

      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <h2>Resultado por día</h2>
            <p>Listado completo del mes seleccionado.</p>
          </div>
        </div>

        {!datos ? (
          <EstadoMensual
            cargando={cargando}
            error={error}
            onReintentar={onActualizar}
          />
        ) : null}

        {datos && dias.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table daily-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="amount-column">Ventas CopecFuel</th>
                  <th className="amount-column">Abono bruto</th>
                  <th className="amount-column">Propinas</th>
                  <th className="amount-column">Vueltos</th>
                  <th className="amount-column">Abono conciliable</th>
                  <th className="amount-column">Diferencia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.fecha} className={`conciliation-row row-${dia.estado}`}>
                    <td>
                      <strong className="table-primary">
                        {formatearFecha(dia.fecha)}
                      </strong>
                    </td>
                    <td className="amount-column">
                      {formatoMoneda.format(dia.copecFuel.montoConciliable)}
                    </td>
                    <td className="amount-column">
                      {formatoMoneda.format(dia.portalCopec.montoBruto)}
                    </td>
                    <td className="amount-column amount-discount">
                      {formatoMoneda.format(dia.portalCopec.descuentoPropinas)}
                    </td>
                    <td className="amount-column amount-discount">
                      {formatoMoneda.format(dia.portalCopec.descuentoVueltos)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoMoneda.format(dia.portalCopec.montoConciliable)}
                    </td>
                    <td
                      className={`amount-column amount-strong ${
                        dia.diferencia === 0 ? "amount-zero" : "amount-error"
                      }`}
                    >
                      {formatoMoneda.format(dia.diferencia)}
                    </td>
                    <td><EstadoConciliacion estado={dia.estado} /></td>
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

function CargosMuevoEmpresaIntegration({
  datos,
  cargando,
  error,
  mensaje,
  importando,
  sincronizandoCargos,
  progreso,
  periodoSeleccionado,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
  onImportar,
  onSincronizarCargos,
  onActualizar,
}) {
  const resumen = datos?.resumen;
  const dias = datos?.dias || [];

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Conciliador independiente</span>
          <h1>Cargos Muevo empresa</h1>
          <p>
            Ventas emitidas por Copec pagadas en efectivo, credito o debito
            contra cargos Consumo Muevo Empresa, descontando las propinas.
          </p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={cargando || importando || sincronizandoCargos}
          />
          <SelectorFechaDesde
            periodo={periodoSeleccionado}
            fechaDesde={fechaDesde}
            onChange={onFechaDesdeChange}
            disabled={cargando || importando || sincronizandoCargos}
          />
          <label className="secondary-button button-with-icon file-button">
            <Database size={16} />
            {importando ? "Importando..." : "Importar CSV (respaldo)"}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importando || sincronizandoCargos}
              onChange={(evento) => {
                const archivo = evento.target.files?.[0];
                if (archivo) onImportar(archivo);
                evento.target.value = "";
              }}
            />
          </label>
          <button
            className="primary-button button-with-icon"
            onClick={onSincronizarCargos}
            disabled={importando || sincronizandoCargos}
          >
            <RefreshCw
              className={sincronizandoCargos ? "spin" : ""}
              size={16}
            />
            {sincronizandoCargos
              ? progreso
                ? `${progreso.actual}/${progreso.total}`
                : "Sincronizando..."
              : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error && datos ? <div className="feedback error-feedback">{error}</div> : null}

      <div className="feedback info-feedback">
        <strong>Sincronizacion automatica:</strong> obtiene el detalle diario
        directamente desde CopecFuel y los cargos desde el Portal Copec. El
        archivo CSV queda disponible solamente como respaldo.
        <br />
        <strong>Regla aplicada:</strong> se incluyen solamente ventas cuyo RUT
        emisor es 99.520.000-7 y cuya forma de pago es efectivo, tarjeta de
        credito o tarjeta de debito. Al total de cada venta se le descuenta la
        propina y el resultado se compara con los cargos del Portal Copec
        denominados Consumo Muevo Empresa.
      </div>

      <section className="cards-grid">
        <article className="metric-card">
          <span>Dias conciliados</span>
          <strong>{formatoNumero.format(resumen?.diasConciliados || 0)}</strong>
          <small>Coincidencia exacta diaria</small>
        </article>
        <article className="metric-card">
          <span>Ventas conciliables</span>
          <strong>{formatoMoneda.format(resumen?.montoVentas || 0)}</strong>
          <small>
            {formatoNumero.format(resumen?.cantidadVentas || 0)} ventas ·
            Propinas {formatoMoneda.format(resumen?.descuentoPropinas || 0)}
          </small>
        </article>
        <article className="metric-card">
          <span>Cargos Portal Copec</span>
          <strong>{formatoMoneda.format(resumen?.montoCargos || 0)}</strong>
          <small>{formatoNumero.format(resumen?.cantidadCargos || 0)} cargos</small>
        </article>
        <article
          className={`metric-card ${
            Number(resumen?.diferencia || 0) === 0 ? "success-card" : "danger-card"
          }`}
        >
          <span>Diferencia neta</span>
          <strong>{formatoMoneda.format(resumen?.diferencia || 0)}</strong>
          <small>Cargos menos ventas elegibles</small>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Resultado diario</h2>
            <p>Conciliacion separada del mes seleccionado.</p>
          </div>
          <button
            className="icon-button"
            onClick={onActualizar}
            disabled={cargando}
            aria-label="Actualizar Cargos Muevo empresa"
            title="Actualizar"
          >
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>

        {!datos ? (
          <EstadoMensual
            cargando={cargando}
            error={error}
            onReintentar={onActualizar}
            texto="Preparando las ventas y cargos Muevo Empresa."
          />
        ) : null}

        {datos && dias.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table daily-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="amount-column">Ventas</th>
                  <th className="amount-column">Monto bruto</th>
                  <th className="amount-column">Propinas</th>
                  <th className="amount-column">Venta conciliable</th>
                  <th className="amount-column">Cargos</th>
                  <th className="amount-column">Monto cargos</th>
                  <th className="amount-column">Diferencia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.fecha} className={`conciliation-row row-${dia.estado}`}>
                    <td>
                      <strong className="table-primary">
                        {formatearFecha(dia.fecha)}
                      </strong>
                    </td>
                    <td className="amount-column">
                      {formatoNumero.format(dia.ventas.cantidad)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoMoneda.format(dia.ventas.montoBruto)}
                    </td>
                    <td className="amount-column amount-discount">
                      {formatoMoneda.format(dia.ventas.propinas)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoMoneda.format(dia.ventas.monto)}
                    </td>
                    <td className="amount-column">
                      {formatoNumero.format(dia.cargos.cantidad)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoMoneda.format(dia.cargos.monto)}
                    </td>
                    <td
                      className={`amount-column amount-strong ${
                        dia.diferencia === 0 ? "amount-zero" : "amount-error"
                      }`}
                    >
                      {formatoMoneda.format(dia.diferencia)}
                    </td>
                    <td><EstadoConciliacion estado={dia.estado} /></td>
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

function RecompraIntegration({
  datos,
  cargando,
  error,
  mensaje,
  sincronizando,
  progreso,
  periodoSeleccionado,
  onPeriodoChange,
  fechaDesde,
  onFechaDesdeChange,
  onSincronizar,
  onActualizar,
  onGuardarAjuste,
  onEliminarAjuste,
  guardandoAjuste,
  descargandoEnRuta,
  onDescargarEnRuta,
}) {
  const resumen = datos?.resumen;
  const dias = datos?.dias || [];
  const preciosCosto = datos?.preciosCosto || [];
  const ajustesManuales = datos?.ajustesManuales || [];
  const [fechaAjuste, setFechaAjuste] = useState(
    `${periodoSeleccionado}-01`
  );
  const [litrosAjuste, setLitrosAjuste] = useState("");
  const [referenciaAjuste, setReferenciaAjuste] = useState("");
  const [fechaDescargaDesde, setFechaDescargaDesde] = useState(
    `${periodoSeleccionado}-01`
  );
  const [fechaDescargaHasta, setFechaDescargaHasta] = useState(
    ultimoDiaProcesable(periodoSeleccionado)
  );
  const [codigoEdsDescarga, setCodigoEdsDescarga] = useState(() => {
    if (typeof window === "undefined") return "40098";

    return window.localStorage.getItem("valepac-enruta-eds") || "40098";
  });

  useEffect(() => {
    setFechaAjuste(`${periodoSeleccionado}-01`);
    setFechaDescargaDesde(`${periodoSeleccionado}-01`);
    setFechaDescargaHasta(ultimoDiaProcesable(periodoSeleccionado));
  }, [periodoSeleccionado]);

  const guardarAjuste = async (evento) => {
    evento.preventDefault();
    const guardado = await onGuardarAjuste({
      fecha: fechaAjuste,
      litros: litrosAjuste,
      referencia: referenciaAjuste,
    });
    if (!guardado) return;
    setLitrosAjuste("");
    setReferenciaAjuste("");
  };

  const descargarReporte = async (evento) => {
    evento.preventDefault();

    if (typeof window !== "undefined") {
      window.localStorage.setItem("valepac-enruta-eds", codigoEdsDescarga);
    }

    await onDescargarEnRuta({
      fechaDesde: fechaDescargaDesde,
      fechaHasta: fechaDescargaHasta,
      codigoEds: codigoEdsDescarga,
    });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Conciliador independiente</span>
          <h1>Recompra</h1>
          <p>
            Costo de los litros vendidos con medios Recompra contra los abonos
            Recompra del Portal Concesionario.
          </p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={cargando || sincronizando}
          />
          <SelectorFechaDesde
            periodo={periodoSeleccionado}
            fechaDesde={fechaDesde}
            onChange={onFechaDesdeChange}
            disabled={cargando || sincronizando}
          />
          <button
            className="primary-button button-with-icon"
            onClick={onSincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando
              ? progreso
                ? `${progreso.actual}/${progreso.total}`
                : "Sincronizando…"
              : "Sincronizar desde fecha"}
          </button>
        </div>
      </div>

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error && datos ? <div className="feedback error-feedback">{error}</div> : null}

      <div className="feedback info-feedback">
        <strong>Medios incluidos:</strong> APP Copec Empresa, Cupón
        Electrónico, Movimiento Bodega, Tarjeta FFAA, TCT, TCT Manual y
        Storage.
        <br />
        <strong>Regla adicional:</strong> también se incluyen efectivo/dinero,
        crédito y débito cuando la razón social emisora es Copec S.A.
        <br />
        <strong>Productos incluidos:</strong> gasolina 93, gasolina 95,
        gasolina 97 y diésel. BlueMax queda excluido por ahora.
        <br />
        <strong>Regla:</strong> litros vendidos - Volumen Propio de Copec en
        Ruta + fluctuación de VCTG38/VCTG39 + TCT/TAE manual, todo valorizado
        al precio costo vigente del día y comparado con los abonos “Recompra”.
      </div>

      <section className="panel download-report-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Descargar Excel Copec en Ruta</h2>
            <p>
              Genera el mismo detalle de entregas usando las fechas y la
              estación indicadas.
            </p>
          </div>
        </div>

        <form
          className="adjustment-form download-report-form"
          onSubmit={descargarReporte}
        >
          <label>
            <span>Fecha desde</span>
            <input
              type="date"
              value={fechaDescargaDesde}
              max={fechaDescargaHasta || undefined}
              onChange={(evento) => setFechaDescargaDesde(evento.target.value)}
              disabled={descargandoEnRuta}
              required
            />
          </label>
          <label>
            <span>Fecha hasta</span>
            <input
              type="date"
              value={fechaDescargaHasta}
              min={fechaDescargaDesde || undefined}
              onChange={(evento) => setFechaDescargaHasta(evento.target.value)}
              disabled={descargandoEnRuta}
              required
            />
          </label>
          <label className="adjustment-reference">
            <span>Código de estación</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              value={codigoEdsDescarga}
              onChange={(evento) =>
                setCodigoEdsDescarga(
                  evento.target.value.replace(/\D/g, "").slice(0, 6)
                )
              }
              placeholder="Ej. 40098"
              disabled={descargandoEnRuta}
              required
            />
          </label>
          <button
            className="primary-button button-with-icon"
            type="submit"
            disabled={descargandoEnRuta}
          >
            <Download size={16} />
            {descargandoEnRuta ? "Preparando…" : "Descargar Excel"}
          </button>
        </form>
      </section>

      {Number(resumen?.lineasSinPrecio || 0) > 0 ? (
        <div className="feedback error-feedback">
          Hay {formatoNumero.format(resumen.lineasSinPrecio)} línea(s) sin un
          precio costo vigente. Esos días quedan pendientes y no se consideran
          conciliados.
        </div>
      ) : null}

      <section className="cards-grid">
        <article className="metric-card">
          <span>Días conciliados</span>
          <strong>{formatoNumero.format(resumen?.diasConciliados || 0)}</strong>
          <small>Coincidencia exacta diaria</small>
        </article>
        <article className="metric-card">
          <span>Costo Recompra</span>
          <strong>{formatoMoneda.format(resumen?.costoVentas || 0)}</strong>
          <small>
            {formatoLitros.format(resumen?.litros || 0)} litros netos · {" "}
            {formatoNumero.format(resumen?.cantidadVentas || 0)} operaciones
          </small>
        </article>
        <article className="metric-card">
          <span>Abonos Recompra</span>
          <strong>{formatoMoneda.format(resumen?.montoAbonos || 0)}</strong>
          <small>
            {formatoNumero.format(resumen?.cantidadAbonos || 0)} abonos
          </small>
        </article>
        <article
          className={`metric-card ${
            Number(resumen?.diferencia || 0) === 0
              ? "success-card"
              : "danger-card"
          }`}
        >
          <span>Diferencia neta</span>
          <strong>{formatoMoneda.format(resumen?.diferencia || 0)}</strong>
          <small>Abonos menos costo de los litros</small>
        </article>
      </section>

      <section className="panel adjustment-panel">
        <div className="panel-header table-header">
          <div>
            <h2>TCT/TAE no rescatado</h2>
            <p>
              Ingreso manual solo para diésel. Indica los litros; VALEPAC
              calcula automáticamente su valor con el precio costo vigente.
            </p>
          </div>
        </div>

        <form className="adjustment-form" onSubmit={guardarAjuste}>
          <label>
            <span>Fecha</span>
            <input
              type="date"
              value={fechaAjuste}
              min={`${periodoSeleccionado}-01`}
              max={`${periodoSeleccionado}-31`}
              onChange={(evento) => setFechaAjuste(evento.target.value)}
              disabled={guardandoAjuste}
              required
            />
          </label>
          <label>
            <span>Litros diésel</span>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={litrosAjuste}
              onChange={(evento) => setLitrosAjuste(evento.target.value)}
              placeholder="Ej. 250"
              disabled={guardandoAjuste}
              required
            />
          </label>
          <label className="adjustment-reference">
            <span>Referencia u observación</span>
            <input
              type="text"
              value={referenciaAjuste}
              onChange={(evento) => setReferenciaAjuste(evento.target.value)}
              placeholder="Ej. TCT manual turno tarde"
              disabled={guardandoAjuste}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={guardandoAjuste}
          >
            {guardandoAjuste ? "Guardando…" : "Agregar litros"}
          </button>
        </form>

        {ajustesManuales.length > 0 ? (
          <div className="manual-adjustments">
            {ajustesManuales.map((ajuste) => (
              <div className="manual-adjustment-row" key={ajuste.id}>
                <div>
                  <strong>{formatearFecha(ajuste.fecha)}</strong>
                  <span>
                    {formatoLitros.format(ajuste.litros)} L diésel
                    {ajuste.referencia ? ` · ${ajuste.referencia}` : ""}
                  </span>
                </div>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => onEliminarAjuste(ajuste.id)}
                  disabled={guardandoAjuste}
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Resultado diario</h2>
            <p>Conciliación Recompra del mes seleccionado.</p>
          </div>
          <button
            className="icon-button"
            onClick={onActualizar}
            disabled={cargando}
            aria-label="Actualizar Recompra"
            title="Actualizar"
          >
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>

        {!datos ? (
          <EstadoMensual
            cargando={cargando}
            error={error}
            onReintentar={onActualizar}
            texto="Preparando las ventas y abonos Recompra."
          />
        ) : null}

        {datos && dias.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table daily-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="amount-column">Operaciones</th>
                  <th className="amount-column">Litros</th>
                  <th className="amount-column">Costo Recompra</th>
                  <th className="amount-column">Abonos</th>
                  <th className="amount-column">Monto abonos</th>
                  <th className="amount-column">Diferencia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => {
                  const productos = Object.entries(dia.ventas.productos || {})
                    .filter(
                      ([, detalle]) =>
                        Number(detalle.litrosBase || 0) !== 0 ||
                        Number(detalle.volumenPropio || 0) !== 0 ||
                        Number(detalle.fluctuacionMesa || 0) !== 0 ||
                        Number(detalle.tctTaeManual || 0) !== 0
                    )
                    .map(
                      ([producto, detalle]) =>
                        `${producto}: ${formatoLitros.format(
                          detalle.litrosBase || 0
                        )} L base - ${formatoLitros.format(
                          detalle.volumenPropio || 0
                        )} L propio + ${formatoLitros.format(
                          detalle.fluctuacionMesa || 0
                        )} L fluctuación + ${formatoLitros.format(
                          detalle.tctTaeManual || 0
                        )} L TCT/TAE = ${formatoLitros.format(
                          detalle.litros || 0
                        )} L × ${formatoPrecioCosto.format(
                          detalle.precioCosto || 0
                        )} = ${formatoMoneda.format(
                          Math.round(detalle.costo || 0)
                        )}`
                    )
                    .join(" · ");

                  return (
                    <tr
                      key={dia.fecha}
                      className={`conciliation-row row-${dia.estado}`}
                    >
                      <td>
                        <strong className="table-primary">
                          {formatearFecha(dia.fecha)}
                        </strong>
                        {productos ? (
                          <details className="daily-volume-detail">
                            <summary>Ver volúmenes y costos</summary>
                            <span className="table-secondary">{productos}</span>
                          </details>
                        ) : null}
                      </td>
                      <td className="amount-column">
                        {formatoNumero.format(dia.ventas.cantidad)}
                      </td>
                      <td className="amount-column">
                        {formatoLitros.format(dia.ventas.litros || 0)}
                      </td>
                      <td className="amount-column amount-strong">
                        {formatoMoneda.format(dia.ventas.costo || 0)}
                      </td>
                      <td className="amount-column">
                        {formatoNumero.format(dia.abonos.cantidad)}
                      </td>
                      <td className="amount-column amount-strong">
                        {formatoMoneda.format(dia.abonos.monto)}
                      </td>
                      <td
                        className={`amount-column amount-strong ${
                          dia.diferencia === 0 ? "amount-zero" : "amount-error"
                        }`}
                      >
                        {formatoMoneda.format(dia.diferencia)}
                      </td>
                      <td>
                        <EstadoConciliacion estado={dia.estado} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Historial de precios costo</h2>
            <p>
              Cada precio rige desde su fecha de inicio hasta el día anterior
              al siguiente registro.
            </p>
          </div>
        </div>

        {preciosCosto.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table daily-table">
              <thead>
                <tr>
                  <th>Vigente desde</th>
                  <th>Vigente hasta</th>
                  <th className="amount-column">Gas 93SP</th>
                  <th className="amount-column">Gas 95SP</th>
                  <th className="amount-column">Gas 97SP</th>
                  <th className="amount-column">Diésel PDUA1</th>
                </tr>
              </thead>
              <tbody>
                {preciosCosto.map((precio) => (
                  <tr key={`${precio.codigoEds}-${precio.vigenteDesde}`}>
                    <td>
                      <strong className="table-primary">
                        {formatearFecha(precio.vigenteDesde)}
                      </strong>
                    </td>
                    <td>
                      {precio.vigenteHasta
                        ? formatearFecha(precio.vigenteHasta)
                        : "Vigente"}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoPrecioCosto.format(precio.gas93 || 0)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoPrecioCosto.format(precio.gas95 || 0)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoPrecioCosto.format(precio.gas97 || 0)}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoPrecioCosto.format(precio.diesel || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state compact">
            <Database size={26} />
            <h3>Sin precios costo registrados</h3>
            <p>Sincroniza Recompra para obtenerlos desde Portal Copec.</p>
          </div>
        )}
      </section>
    </>
  );
}

const ESTADOS_GUIA_COSEDUCAM = {
  pendiente_guia: { etiqueta: "Pendiente de guía", clase: "status-wait" },
  procesando: { etiqueta: "Procesando", clase: "status-wait" },
  creada: { etiqueta: "Guía creada", clase: "status-on" },
  confirmada: { etiqueta: "Confirmada", clase: "status-on" },
  revision_requerida: {
    etiqueta: "Revisión requerida",
    clase: "status-off",
  },
};

function EstadoGuiaCoseducam({ estado }) {
  const configuracion = ESTADOS_GUIA_COSEDUCAM[estado] || {
    etiqueta: "Sin guía",
    clase: "status-neutral",
  };

  return (
    <span className={`status ${configuracion.clase}`}>
      {["creada", "confirmada"].includes(estado) ? (
        <CheckCircle2 size={13} />
      ) : null}
      {estado === "revision_requerida" ? <AlertCircle size={13} /> : null}
      {configuracion.etiqueta}
    </span>
  );
}

function CoseducamIntegration({
  datos,
  cargando,
  error,
  mensaje,
  procesandoFecha,
  periodoSeleccionado,
  onPeriodoChange,
  onActualizar,
  onCrearGuia,
  onConfirmarGuia,
}) {
  const [direccion, setDireccion] = useState("fuenzalida 31");
  const dias = (datos?.dias || []).filter(
    (dia) => dia.consumo?.litros > 0 || dia.guia
  );
  const resumen = datos?.resumen || {};

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">TCT / TAE</span>
          <h1>Coseducam</h1>
          <p>
            Litros diésel vendidos a Coseducam con medio de pago STORAGE y
            control de sus guías TAE.
          </p>
        </div>

        <div className="page-actions">
          <SelectorMes
            periodo={periodoSeleccionado}
            onChange={onPeriodoChange}
            disabled={Boolean(procesandoFecha)}
          />
          <button
            type="button"
            className="secondary-button icon-button"
            onClick={onActualizar}
            disabled={cargando || Boolean(procesandoFecha)}
          >
            <RefreshCw size={16} className={cargando ? "spin" : ""} />
            Actualizar
          </button>
        </div>
      </div>

      {error ? <div className="feedback error-feedback">{error}</div> : null}
      {mensaje ? (
        <div className="feedback success-feedback">{mensaje}</div>
      ) : null}

      <div className="feedback info-feedback">
        <strong>Regla:</strong> se consideran únicamente ventas diésel,
        STORAGE y cliente Coseducam RUT 96.963.630-1. La guía usa siempre el
        total calculado por el servidor, no un valor digitado manualmente.
      </div>

      {!datos?.confirmacionEnRutaDisponible ? (
        <div className="sync-progress">
          La creación TAE está preparada. La confirmación en En Ruta quedará
          bloqueada hasta registrar en un HAR una guía real disponible en la
          PDA; así evitamos confirmar un documento equivocado.
        </div>
      ) : null}

      <section className="cards-grid coseducam-summary">
        <article className="metric-card">
          <span>Litros STORAGE</span>
          <strong>{formatoLitros.format(resumen.litros || 0)} L</strong>
          <small>{formatoNumero.format(resumen.transacciones || 0)} cargas</small>
        </article>
        <article className="metric-card">
          <span>Días con consumo</span>
          <strong>{formatoNumero.format(resumen.diasConConsumo || 0)}</strong>
          <small>Dentro del mes seleccionado</small>
        </article>
        <article className="metric-card">
          <span>Guías creadas</span>
          <strong>{formatoNumero.format(resumen.guiasCreadas || 0)}</strong>
          <small>Autorizadas en Portal TCT/TAE</small>
        </article>
        <article className="metric-card">
          <span>Pendientes</span>
          <strong>{formatoNumero.format(resumen.pendientes || 0)}</strong>
          <small>Días que todavía no tienen guía</small>
        </article>
      </section>

      <section className="panel coseducam-settings">
        <div>
          <h2>Datos de despacho</h2>
          <p>La dirección se enviará al crear cada autorización.</p>
        </div>
        <label className="field-label">
          <span>Dirección</span>
          <input
            type="text"
            value={direccion}
            onChange={(evento) => setDireccion(evento.target.value)}
            disabled={Boolean(procesandoFecha)}
          />
        </label>
      </section>

      <section className="panel daily-results-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Consumo y guías por día</h2>
            <p>El detalle de las cargas permanece oculto hasta desplegarlo.</p>
          </div>
        </div>

        {cargando && !datos ? (
          <div className="empty-state compact">
            <RefreshCw className="spin" size={28} />
            <h3>Cargando Coseducam</h3>
            <p>Revisando las ventas STORAGE guardadas.</p>
          </div>
        ) : dias.length === 0 ? (
          <div className="empty-state compact">
            <Truck size={28} />
            <h3>Sin consumos STORAGE</h3>
            <p>No se encontraron cargas Coseducam en el mes seleccionado.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table daily-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="amount-column">Litros diésel</th>
                  <th className="amount-column">Cargas</th>
                  <th>Guía</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.fecha}>
                    <td>
                      <strong className="table-primary">
                        {formatearFecha(dia.fecha)}
                      </strong>
                      {dia.consumo?.detalle?.length ? (
                        <details className="coseducam-details">
                          <summary>
                            Ver detalle ({dia.consumo.detalle.length})
                          </summary>
                          <div>
                            {dia.consumo.detalle.map((detalle, indice) => (
                              <span key={`${detalle.transaccion}-${indice}`}>
                                {detalle.transaccion}: {formatoLitros.format(
                                  detalle.litros || 0
                                )} L
                                {detalle.patente ? ` · ${detalle.patente}` : ""}
                              </span>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </td>
                    <td className="amount-column amount-strong">
                      {formatoLitros.format(dia.consumo?.litros || 0)} L
                    </td>
                    <td className="amount-column">
                      {formatoNumero.format(dia.consumo?.transacciones || 0)}
                    </td>
                    <td>
                      {dia.guia?.numeroGuia || "—"}
                      {dia.guia?.codigoAutorizacion ? (
                        <small className="table-secondary">
                          Aut. {dia.guia.codigoAutorizacion}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <EstadoGuiaCoseducam estado={dia.estado} />
                    </td>
                    <td>
                      {dia.estado === "pendiente_guia" ? (
                        <button
                          type="button"
                          className="primary-button compact-button"
                          disabled={Boolean(procesandoFecha)}
                          onClick={() =>
                            onCrearGuia({
                              fecha: dia.fecha,
                              litros: dia.consumo?.litros || 0,
                              direccion,
                            })
                          }
                        >
                          {procesandoFecha === dia.fecha
                            ? "Creando…"
                            : "Crear guía"}
                        </button>
                      ) : dia.estado === "creada" ? (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          disabled={!datos?.confirmacionEnRutaDisponible}
                          title="Pendiente capturar la confirmación real desde En Ruta"
                          onClick={() => onConfirmarGuia(dia)}
                        >
                          Confirmar en Ruta
                        </button>
                      ) : (
                        <span className="table-secondary">Sin acción</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ComingSoon({ title, description }) {
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">VALEPAC Connect</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>

      <section className="panel">
        <div className="empty-state">
          <div className="empty-icon">+</div>
          <h3>Módulo en preparación</h3>
          <p>Se habilitará después de completar la cartola Copec.</p>
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [datosCopec, setDatosCopec] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [datosMensuales, setDatosMensuales] = useState(null);
  const [cargandoMensual, setCargandoMensual] = useState(false);
  const [errorMensual, setErrorMensual] = useState("");
  const [datosMuevo, setDatosMuevo] = useState(null);
  const [cargandoMuevo, setCargandoMuevo] = useState(false);
  const [errorMuevo, setErrorMuevo] = useState("");
  const [mensajeMuevo, setMensajeMuevo] = useState("");
  const [importandoMuevo, setImportandoMuevo] = useState(false);
  const [sincronizandoCargosMuevo, setSincronizandoCargosMuevo] =
    useState(false);
  const [progresoMuevo, setProgresoMuevo] = useState(null);
  const [datosRecompra, setDatosRecompra] = useState(null);
  const [cargandoRecompra, setCargandoRecompra] = useState(false);
  const [errorRecompra, setErrorRecompra] = useState("");
  const [mensajeRecompra, setMensajeRecompra] = useState("");
  const [sincronizandoRecompra, setSincronizandoRecompra] = useState(false);
  const [progresoRecompra, setProgresoRecompra] = useState(null);
  const [guardandoAjusteRecompra, setGuardandoAjusteRecompra] =
    useState(false);
  const [datosCoseducam, setDatosCoseducam] = useState(null);
  const [cargandoCoseducam, setCargandoCoseducam] = useState(false);
  const [errorCoseducam, setErrorCoseducam] = useState("");
  const [mensajeCoseducam, setMensajeCoseducam] = useState("");
  const [procesandoGuiaCoseducam, setProcesandoGuiaCoseducam] =
    useState("");
  const [descargandoEnRuta, setDescargandoEnRuta] = useState(false);
  const [sincronizandoFuel, setSincronizandoFuel] = useState(false);
  const [progresoFuel, setProgresoFuel] = useState(null);
  const [mensajeFuel, setMensajeFuel] = useState("");
  const [requiereCodigoFuel, setRequiereCodigoFuel] = useState(false);
  const [codigoFuel, setCodigoFuel] = useState("");
  const [validandoFuel, setValidandoFuel] = useState(false);
  const [solicitandoCodigoFuel, setSolicitandoCodigoFuel] = useState(false);
  const [sincronizandoGlobal, setSincronizandoGlobal] = useState(false);
  const [progresoGlobal, setProgresoGlobal] = useState(null);
  const [resultadosGlobal, setResultadosGlobal] = useState({});
  const [mensajeGlobal, setMensajeGlobal] = useState("");
  const [errorGlobal, setErrorGlobal] = useState("");
  const [reanudarGlobalTrasValidacion, setReanudarGlobalTrasValidacion] =
    useState(false);
  const [periodoCopec, setPeriodoCopec] = useState(() => {
    const fecha = new Date();
    const periodoActual = `${fecha.getFullYear()}-${String(
      fecha.getMonth() + 1
    ).padStart(2, "0")}`;

    if (typeof window === "undefined") {
      return periodoActual;
    }

    return window.localStorage.getItem("valepac-periodo-copec") || periodoActual;
  });
  const [fechaDesdeSincronizacion, setFechaDesdeSincronizacion] = useState(
    () => {
      const fechaInicial = `${periodoCopec}-01`;

      if (typeof window === "undefined") return fechaInicial;

      const guardada = window.localStorage.getItem(
        "valepac-fecha-desde-sincronizacion"
      );
      const limite = ultimoDiaProcesable(periodoCopec);

      return guardada?.startsWith(`${periodoCopec}-`) && guardada <= limite
        ? guardada
        : fechaInicial;
    }
  );

  const cargarDatosCopec = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      const datos = await obtenerAbonosCopec({
        limite: 100,
        periodo: periodoCopec,
      });
      setDatosCopec(datos);
    } catch (errorCarga) {
      setError(errorCarga.message || "No fue posible cargar los abonos.");
    } finally {
      setCargando(false);
    }
  }, [periodoCopec]);

  const cambiarPeriodoCopec = useCallback((nuevoPeriodo) => {
    if (!/^\d{4}-\d{2}$/.test(nuevoPeriodo)) {
      return;
    }

    setMensaje("");
    setError("");
    setDatosCopec(null);
    setDatosMensuales(null);
    setErrorMensual("");
    setMensajeFuel("");
    setDatosMuevo(null);
    setErrorMuevo("");
    setMensajeMuevo("");
    setProgresoMuevo(null);
    setDatosRecompra(null);
    setErrorRecompra("");
    setMensajeRecompra("");
    setProgresoRecompra(null);
    setDatosCoseducam(null);
    setErrorCoseducam("");
    setMensajeCoseducam("");
    setResultadosGlobal({});
    setProgresoGlobal(null);
    setMensajeGlobal("");
    setErrorGlobal("");
    setReanudarGlobalTrasValidacion(false);
    setPeriodoCopec(nuevoPeriodo);
    const nuevaFechaDesde = `${nuevoPeriodo}-01`;
    setFechaDesdeSincronizacion(nuevaFechaDesde);

    if (typeof window !== "undefined") {
      window.localStorage.setItem("valepac-periodo-copec", nuevoPeriodo);
      window.localStorage.setItem(
        "valepac-fecha-desde-sincronizacion",
        nuevaFechaDesde
      );
    }
  }, []);

  const cambiarFechaDesdeSincronizacion = useCallback(
    (nuevaFecha) => {
      const limite = ultimoDiaProcesable(periodoCopec);

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha) ||
        !nuevaFecha.startsWith(`${periodoCopec}-`) ||
        nuevaFecha < `${periodoCopec}-01` ||
        nuevaFecha > limite
      ) {
        return;
      }

      setFechaDesdeSincronizacion(nuevaFecha);
      setResultadosGlobal({});
      setMensajeGlobal("");
      setErrorGlobal("");

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "valepac-fecha-desde-sincronizacion",
          nuevaFecha
        );
      }
    },
    [periodoCopec]
  );

  useEffect(() => {
    cargarDatosCopec();
  }, [cargarDatosCopec]);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setError("");
    setMensaje("");

    try {
      const resultado = await sincronizarAbonosCopec(
        periodoCopec,
        fechaDesdeSincronizacion
      );
      setMensaje(
        `Sincronización completada: ${formatoNumero.format(resultado.abonosEncontrados || 0)} abonos procesados.`
      );
      await cargarDatosCopec();
    } catch (errorSincronizacion) {
      setError(
        errorSincronizacion.message || "No fue posible sincronizar la cartola."
      );
    } finally {
      setSincronizando(false);
    }
  }, [cargarDatosCopec, fechaDesdeSincronizacion, periodoCopec]);

  const cargarDatosMensuales = useCallback(async () => {
    setCargandoMensual(true);
    setErrorMensual("");

    try {
      const datos = await obtenerConciliacionMensual(periodoCopec);
      setDatosMensuales(datos);
    } catch (errorCarga) {
      setErrorMensual(
        errorCarga.message || "No fue posible cargar el resumen mensual."
      );
    } finally {
      setCargandoMensual(false);
    }
  }, [periodoCopec]);

  useEffect(() => {
    if (["copecfuel", "conciliacion"].includes(activePage)) {
      cargarDatosMensuales();
    }
  }, [activePage, cargarDatosMensuales]);

  const cargarDatosMuevo = useCallback(async () => {
    setCargandoMuevo(true);
    setErrorMuevo("");

    try {
      const datos = await obtenerCargosMuevoEmpresa(periodoCopec);
      setDatosMuevo(datos);
    } catch (errorCarga) {
      setErrorMuevo(
        errorCarga.message ||
          "No fue posible cargar la conciliacion Cargos Muevo empresa."
      );
    } finally {
      setCargandoMuevo(false);
    }
  }, [periodoCopec]);

  useEffect(() => {
    if (activePage === "muevo") {
      cargarDatosMuevo();
    }
  }, [activePage, cargarDatosMuevo]);

  const cargarDatosRecompra = useCallback(async () => {
    setCargandoRecompra(true);
    setErrorRecompra("");

    try {
      const datos = await obtenerRecompra(periodoCopec);
      setDatosRecompra(datos);
    } catch (errorCarga) {
      setErrorRecompra(
        errorCarga.message || "No fue posible cargar la conciliación Recompra."
      );
    } finally {
      setCargandoRecompra(false);
    }
  }, [periodoCopec]);

  useEffect(() => {
    if (activePage === "recompra") {
      cargarDatosRecompra();
    }
  }, [activePage, cargarDatosRecompra]);

  const cargarDatosCoseducam = useCallback(async () => {
    setCargandoCoseducam(true);
    setErrorCoseducam("");

    try {
      const datos = await obtenerCoseducam(periodoCopec);
      setDatosCoseducam(datos);
    } catch (errorCarga) {
      setErrorCoseducam(
        errorCarga.message || "No fue posible cargar los consumos Coseducam."
      );
    } finally {
      setCargandoCoseducam(false);
    }
  }, [periodoCopec]);

  useEffect(() => {
    if (activePage === "coseducam") {
      cargarDatosCoseducam();
    }
  }, [activePage, cargarDatosCoseducam]);

  const crearGuiaDiaCoseducam = useCallback(
    async ({ fecha, litros, direccion }) => {
      const confirmado = window.confirm(
        `Se solicitará una guía TAE para Coseducam por ${formatoLitros.format(
          litros
        )} litros diésel del ${formatearFecha(fecha)}. ¿Deseas continuar?`
      );

      if (!confirmado) return;

      setProcesandoGuiaCoseducam(fecha);
      setErrorCoseducam("");
      setMensajeCoseducam("");

      try {
        const resultado = await crearGuiaCoseducam({
          fecha,
          direccion,
          codigoEds: "40098",
        });
        setMensajeCoseducam(
          `${resultado.mensaje || "Guía creada correctamente."}${
            resultado.numeroGuia ? ` N.º ${resultado.numeroGuia}.` : ""
          }`
        );
        await cargarDatosCoseducam();
      } catch (errorGuia) {
        setErrorCoseducam(
          errorGuia.message || "No fue posible crear la guía Coseducam."
        );
        await cargarDatosCoseducam();
      } finally {
        setProcesandoGuiaCoseducam("");
      }
    },
    [cargarDatosCoseducam]
  );

  const confirmarGuiaDiaCoseducam = useCallback(async (dia) => {
    setErrorCoseducam("");

    try {
      await confirmarGuiaCoseducam({
        fecha: dia.fecha,
        guiaId: dia.guia?.id,
      });
    } catch (errorConfirmacion) {
      setErrorCoseducam(
        errorConfirmacion.message ||
          "La confirmación en En Ruta todavía no está disponible."
      );
    }
  }, []);

  const guardarAjusteRecompra = useCallback(
    async (ajuste) => {
      setGuardandoAjusteRecompra(true);
      setErrorRecompra("");
      setMensajeRecompra("");

      try {
        await guardarTctTaeManual(ajuste);
        setMensajeRecompra(
          "Litros TCT/TAE agregados. El costo se recalculó con el precio vigente."
        );
        await cargarDatosRecompra();
        return true;
      } catch (errorAjuste) {
        setErrorRecompra(
          errorAjuste.message || "No fue posible guardar el ajuste TCT/TAE."
        );
        return false;
      } finally {
        setGuardandoAjusteRecompra(false);
      }
    },
    [cargarDatosRecompra]
  );

  const eliminarAjusteRecompra = useCallback(
    async (id) => {
      setGuardandoAjusteRecompra(true);
      setErrorRecompra("");

      try {
        await eliminarTctTaeManual(id);
        setMensajeRecompra("Ajuste TCT/TAE eliminado.");
        await cargarDatosRecompra();
      } catch (errorAjuste) {
        setErrorRecompra(
          errorAjuste.message || "No fue posible eliminar el ajuste TCT/TAE."
        );
      } finally {
        setGuardandoAjusteRecompra(false);
      }
    },
    [cargarDatosRecompra]
  );

  const descargarReporteEnRuta = useCallback(async (filtros) => {
    setDescargandoEnRuta(true);
    setErrorRecompra("");
    setMensajeRecompra("");

    try {
      const resultado = await descargarExcelEnRuta(filtros);
      setMensajeRecompra(
        `Archivo ${resultado.nombreArchivo} descargado correctamente.`
      );
      return true;
    } catch (errorDescarga) {
      setErrorRecompra(
        errorDescarga.message ||
          "No fue posible descargar el Excel desde Copec en Ruta."
      );
      return false;
    } finally {
      setDescargandoEnRuta(false);
    }
  }, []);

  const importarDetalleMuevo = useCallback(
    async (archivo) => {
      setImportandoMuevo(true);
      setErrorMuevo("");
      setMensajeMuevo("");

      try {
        const resultado = await importarVentasMuevoEmpresa(archivo);
        setMensajeMuevo(
          `Detalle importado: ${formatoNumero.format(
            resultado.ventasGuardadas || 0
          )} ventas conciliables por ${formatoMoneda.format(
            resultado.montoGuardado || 0
          )}. Propinas descontadas: ${formatoMoneda.format(
            resultado.totalPropinas || 0
          )}.`
        );
        await cargarDatosMuevo();
      } catch (errorImportacion) {
        setErrorMuevo(
          errorImportacion.message || "No fue posible importar el archivo CSV."
        );
      } finally {
        setImportandoMuevo(false);
      }
    },
    [cargarDatosMuevo]
  );

  const sincronizarCargosMuevo = useCallback(async () => {
    setSincronizandoCargosMuevo(true);
    setProgresoMuevo(null);
    setErrorMuevo("");
    setMensajeMuevo("");

    try {
      const ventas = await sincronizarMesMuevoEmpresa(
        periodoCopec,
        setProgresoMuevo,
        { fechaDesde: fechaDesdeSincronizacion }
      );
      setProgresoMuevo(null);
      const cargos = await sincronizarAbonosCopec(
        periodoCopec,
        fechaDesdeSincronizacion
      );

      setMensajeMuevo(
        `Sincronizacion automatica completada: ${formatoNumero.format(
          ventas.ventasGuardadas || 0
        )} ventas desde CopecFuel y ${formatoNumero.format(
          cargos.cargosMuevoEncontrados || 0
        )} cargos del Portal Copec.`
      );

      if (ventas.errores.length > 0) {
        setErrorMuevo(
          `${ventas.completados} de ${ventas.total} dias sincronizados. ` +
            `${ventas.errores.length} dia(s) deben reintentarse.`
        );
      }

      await Promise.all([cargarDatosMuevo(), cargarDatosCopec()]);
    } catch (errorSincronizacion) {
      if (errorSincronizacion.requiereCodigoEquipo) {
        setRequiereCodigoFuel(true);
      }

      setErrorMuevo(
        errorSincronizacion.requiereCodigoEquipo
          ? "CopecFuel solicita validar el equipo. Ingresa al menu CopecFuel, valida el codigo recibido y vuelve a sincronizar."
          : errorSincronizacion.message ||
              "No fue posible completar la sincronizacion automatica."
      );
    } finally {
      setSincronizandoCargosMuevo(false);
      setProgresoMuevo(null);
    }
  }, [
    cargarDatosCopec,
    cargarDatosMuevo,
    fechaDesdeSincronizacion,
    periodoCopec,
  ]);

  const sincronizarRecompra = useCallback(async () => {
    setSincronizandoRecompra(true);
    setProgresoRecompra(null);
    setErrorRecompra("");
    setMensajeRecompra("");

    try {
      const ventas = await sincronizarMesMuevoEmpresa(
        periodoCopec,
        setProgresoRecompra,
        { fechaDesde: fechaDesdeSincronizacion }
      );
      setProgresoRecompra(null);
      let volumenPropio = null;
      let volumenPropioError = "";

      try {
        volumenPropio = await sincronizarVolumenPropio(
          periodoCopec,
          fechaDesdeSincronizacion
        );
      } catch (errorVolumen) {
        volumenPropioError =
          errorVolumen.message || "No fue posible actualizar Volumen Propio.";
      }

      const cartola = await sincronizarAbonosCopec(
        periodoCopec,
        fechaDesdeSincronizacion
      );

      setMensajeRecompra(
        `Recompra actualizada: ${formatoNumero.format(
          ventas.ventasRecompraGuardadas || 0
        )} líneas de combustible; ${formatoLitros.format(
          volumenPropio?.litrosVolumenPropio || 0
        )} L de Volumen Propio; ${formatoNumero.format(
          cartola.preciosCosto?.guardados || 0
        )} precio(s) nuevo(s), fluctuaciones y abonos actualizados.`
      );

      if (ventas.errores.length > 0) {
        setErrorRecompra(
          `${ventas.completados} de ${ventas.total} días sincronizados. ` +
            `${ventas.errores.length} día(s) deben reintentarse.`
        );
      } else if (volumenPropioError) {
        setErrorRecompra(
          `Las ventas y abonos se actualizaron, pero falta Volumen Propio: ${volumenPropioError}`
        );
      } else if (cartola.preciosCostoError || cartola.fluctuacionesRecompraError) {
        setErrorRecompra(
          `Recompra quedó parcialmente actualizada: ${
            cartola.preciosCostoError || cartola.fluctuacionesRecompraError
          }`
        );
      }

      await Promise.all([cargarDatosRecompra(), cargarDatosCopec()]);
    } catch (errorSincronizacion) {
      if (errorSincronizacion.requiereCodigoEquipo) {
        setRequiereCodigoFuel(true);
      }

      setErrorRecompra(
        errorSincronizacion.requiereCodigoEquipo
          ? "CopecFuel solicita validar el equipo. Realiza la sincronización desde el Dashboard para ingresar un solo código y continuar."
          : errorSincronizacion.message ||
              "No fue posible sincronizar Recompra."
      );
    } finally {
      setSincronizandoRecompra(false);
      setProgresoRecompra(null);
    }
  }, [
    cargarDatosCopec,
    cargarDatosRecompra,
    fechaDesdeSincronizacion,
    periodoCopec,
  ]);

  const sincronizarCopecFuel = useCallback(async () => {
    setSincronizandoFuel(true);
    setProgresoFuel(null);
    setMensajeFuel("");
    setErrorMensual("");

    try {
      const resultado = await sincronizarMesCopecFuel(
        periodoCopec,
        setProgresoFuel,
        { fechaDesde: fechaDesdeSincronizacion }
      );
      await cargarDatosMensuales();

      if (resultado.errores.length > 0) {
        setErrorMensual(
          `${resultado.completados} de ${resultado.total} días sincronizados. ` +
            `${resultado.errores.length} día(s) deberán reintentarse.`
        );
      } else {
        setMensajeFuel(
          `Mes sincronizado correctamente: ${resultado.completados} días procesados.`
        );
      }
    } catch (errorSincronizacion) {
      if (errorSincronizacion.requiereCodigoEquipo) {
        setReanudarGlobalTrasValidacion(false);
        setRequiereCodigoFuel(true);
        setErrorMensual("");
      } else {
        setErrorMensual(
          errorSincronizacion.message || "No fue posible sincronizar CopecFuel."
        );
      }
    } finally {
      setSincronizandoFuel(false);
      setProgresoFuel(null);
    }
  }, [cargarDatosMensuales, fechaDesdeSincronizacion, periodoCopec]);

  const sincronizarTodoElMes = useCallback(
    async ({ sesionValidada = false } = {}) => {
      const resultados = {};
      let ventasFuel = null;
      const registrarResultado = (etapa, resultado) => {
        resultados[etapa] = resultado;
        setResultadosGlobal((actuales) => ({
          ...actuales,
          [etapa]: resultado,
        }));
      };
      const actualizarProgresoDiario =
        (etapa, titulo, base, amplitud) => (progreso) => {
          const proporcion = progreso?.total
            ? progreso.actual / progreso.total
            : 0;
          setProgresoGlobal({
            etapa,
            titulo,
            detalle: progreso?.fecha
              ? `${progreso.actual} de ${progreso.total} días · ${formatearFecha(
                  progreso.fecha
                )}`
              : "Preparando información",
            porcentaje: Math.round(base + proporcion * amplitud),
          });
        };

      setSincronizandoGlobal(true);
      setResultadosGlobal({});
      setMensajeGlobal("");
      setErrorGlobal("");
      setProgresoGlobal({
        etapa: "copecfuel",
        titulo: "Comprobando la sesión de CopecFuel",
        detalle: "Se solicitará un código solamente si la sesión lo requiere.",
        porcentaje: 3,
      });

      try {
        if (!sesionValidada) {
          const conexion = await probarConexionCopecFuel();

          if (conexion.requiereCodigoEquipo || !conexion.conectado) {
            if (conexion.requiereCodigoEquipo) {
              setReanudarGlobalTrasValidacion(true);
              setRequiereCodigoFuel(true);
              setProgresoGlobal(null);
              registrarResultado("copecfuel", {
                estado: "advertencia",
                detalle: "Esperando el código enviado por correo",
              });
              return;
            }

            throw new Error("CopecFuel no pudo confirmar una sesión activa.");
          }
        }

        setRequiereCodigoFuel(false);
        setReanudarGlobalTrasValidacion(false);

        try {
          setProgresoGlobal({
            etapa: "copecfuel",
            titulo: "Sincronizando ventas CopecFuel",
            detalle: "Preparando ventas y medios de pago",
            porcentaje: 5,
          });
          ventasFuel = await sincronizarMesCopecFuel(
            periodoCopec,
            actualizarProgresoDiario(
              "copecfuel",
              "Sincronizando ventas CopecFuel",
              5,
              35
            ),
            {
              comprobarConexion: false,
              fechaDesde: fechaDesdeSincronizacion,
            }
          );
          const tieneErrores = ventasFuel.errores.length > 0;
          registrarResultado("copecfuel", {
            estado: tieneErrores ? "advertencia" : "completado",
            detalle: `${ventasFuel.completados} de ${ventasFuel.total} días procesados${
              tieneErrores
                ? ` · ${ventasFuel.errores.length} pendiente(s)`
                : ""
            }`,
          });
        } catch (errorSincronizacion) {
          registrarResultado("copecfuel", {
            estado: "error",
            detalle:
              errorSincronizacion.message ||
              "No fue posible sincronizar las ventas.",
          });
        }

        try {
          setProgresoGlobal({
            etapa: "recompra",
            titulo: "Sincronizando Volumen Propio",
            detalle: "Leyendo entregas Concesionario desde Copec en Ruta",
            porcentaje: 82,
          });
          const volumenPropio = await sincronizarVolumenPropio(
            periodoCopec,
            fechaDesdeSincronizacion
          );
          const resultadoAnterior = resultados.recompra;

          registrarResultado("recompra", {
            estado:
              resultadoAnterior?.estado === "error"
                ? "error"
                : resultadoAnterior?.estado || "completado",
            detalle: `${resultadoAnterior?.detalle || "Ventas Recompra actualizadas"} · ${formatoLitros.format(
              volumenPropio.litrosVolumenPropio || 0
            )} L de Volumen Propio`,
          });
        } catch (errorVolumen) {
          const resultadoAnterior = resultados.recompra;
          registrarResultado("recompra", {
            estado:
              resultadoAnterior?.estado === "error" ? "error" : "advertencia",
            detalle: `${resultadoAnterior?.detalle || "Ventas Recompra actualizadas"} · Volumen Propio pendiente: ${
              errorVolumen.message || "no fue posible leer Copec en Ruta"
            }`,
          });
        }

        if (ventasFuel) {
          const tieneErrores = ventasFuel.errores.length > 0;
          registrarResultado("muevo", {
            estado: tieneErrores ? "advertencia" : "completado",
            detalle: `${ventasFuel.completados} de ${ventasFuel.total} días · ${formatoNumero.format(
              ventasFuel.ventasMuevoGuardadas || 0
            )} ventas desde EXCEL_VENTA${
              tieneErrores
                ? ` · ${ventasFuel.errores.length} pendiente(s)`
                : ""
            }`,
          });
          registrarResultado("recompra", {
            estado: tieneErrores ? "advertencia" : "completado",
            detalle: `${formatoNumero.format(
              ventasFuel.ventasRecompraGuardadas || 0
            )} líneas de combustible obtenidas desde EXCEL_VENTA${
              tieneErrores
                ? ` · ${ventasFuel.errores.length} día(s) pendiente(s)`
                : ""
            }`,
          });
        } else try {
          setProgresoGlobal({
            etapa: "muevo",
            titulo: "Sincronizando el detalle Muevo empresa",
            detalle: "Preparando el detalle emitido por Copec",
            porcentaje: 42,
          });
          const ventasMuevo = await sincronizarMesMuevoEmpresa(
            periodoCopec,
            actualizarProgresoDiario(
              "muevo",
              "Sincronizando el detalle Muevo empresa",
              42,
              38
            ),
            { fechaDesde: fechaDesdeSincronizacion }
          );
          const tieneErrores = ventasMuevo.errores.length > 0;
          registrarResultado("muevo", {
            estado: tieneErrores ? "advertencia" : "completado",
            detalle: `${ventasMuevo.completados} de ${ventasMuevo.total} días · ${formatoNumero.format(
              ventasMuevo.ventasGuardadas || 0
            )} ventas${
              tieneErrores
                ? ` · ${ventasMuevo.errores.length} pendiente(s)`
                : ""
            }`,
          });
          registrarResultado("recompra", {
            estado: tieneErrores ? "advertencia" : "completado",
            detalle: `${formatoNumero.format(
              ventasMuevo.ventasRecompraGuardadas || 0
            )} líneas de combustible · costo calculado con precios vigentes${
              tieneErrores
                ? ` · ${ventasMuevo.errores.length} día(s) pendiente(s)`
                : ""
            }`,
          });
        } catch (errorSincronizacion) {
          if (errorSincronizacion.requiereCodigoEquipo) {
            setReanudarGlobalTrasValidacion(true);
            setRequiereCodigoFuel(true);
          }
          registrarResultado("muevo", {
            estado: "error",
            detalle:
              errorSincronizacion.message ||
              "No fue posible sincronizar el detalle.",
          });
          registrarResultado("recompra", {
            estado: "error",
            detalle:
              errorSincronizacion.message ||
              "No fue posible sincronizar las ventas Recompra.",
          });
        }

        try {
          setProgresoGlobal({
            etapa: "copec",
            titulo: "Sincronizando el Portal Concesionario",
            detalle: "Obteniendo abonos y cargos desde una sola cartola",
            porcentaje: 84,
          });
          const cartola = await sincronizarAbonosCopec(
            periodoCopec,
            fechaDesdeSincronizacion
          );
          registrarResultado("copec", {
            estado:
              cartola.preciosCostoError || cartola.fluctuacionesRecompraError
                ? "advertencia"
                : "completado",
            detalle: `${formatoNumero.format(
              cartola.abonosEncontrados || 0
            )} abonos · ${formatoNumero.format(
              cartola.cargosMuevoEncontrados || 0
            )} cargos Muevo · ${formatoNumero.format(
              cartola.preciosCosto?.registrados || 0
            )} precios costo registrados (${formatoNumero.format(
              cartola.preciosCosto?.guardados || 0
            )} nuevos) · ${formatoNumero.format(
              cartola.fluctuacionesRecompra?.guardados || 0
            )} fluctuaciones${
              cartola.preciosCostoError ? " · precios pendientes" : ""
            }${
              cartola.fluctuacionesRecompraError
                ? " · fluctuaciones pendientes"
                : ""
            }`,
          });

          if (cartola.preciosCostoError || cartola.fluctuacionesRecompraError) {
            registrarResultado("recompra", {
              estado: "advertencia",
              detalle: `Ventas guardadas, pero falta completar Portal Copec: ${
                cartola.preciosCostoError || cartola.fluctuacionesRecompraError
              }`,
            });
          }
        } catch (errorSincronizacion) {
          registrarResultado("copec", {
            estado: "error",
            detalle:
              errorSincronizacion.message ||
              "No fue posible sincronizar la cartola.",
          });
        }

        setProgresoGlobal({
          etapa: "actualizacion",
          titulo: "Actualizando conciliaciones",
          detalle: "Preparando los resultados del mes seleccionado",
          porcentaje: 96,
        });
        await Promise.allSettled([
          cargarDatosCopec(),
          cargarDatosMensuales(),
          cargarDatosMuevo(),
          cargarDatosRecompra(),
        ]);

        const cantidadErrores = Object.values(resultados).filter(
          (resultado) => resultado.estado === "error"
        ).length;
        const cantidadAdvertencias = Object.values(resultados).filter(
          (resultado) => resultado.estado === "advertencia"
        ).length;

        if (cantidadErrores > 0 || cantidadAdvertencias > 0) {
          setErrorGlobal(
            `Sincronización terminada con ${cantidadErrores} error(es) y ${cantidadAdvertencias} observación(es). Puedes volver a sincronizar para reintentar los datos pendientes.`
          );
        } else {
          setMensajeGlobal(
            "Todas las integraciones y conciliaciones del mes fueron actualizadas correctamente."
          );
        }
      } catch (errorSincronizacion) {
        setErrorGlobal(
          errorSincronizacion.message ||
            "No fue posible iniciar la sincronización general."
        );
      } finally {
        setSincronizandoGlobal(false);
        setProgresoGlobal(null);
      }
    },
    [
      cargarDatosCopec,
      cargarDatosMensuales,
      cargarDatosMuevo,
      cargarDatosRecompra,
      fechaDesdeSincronizacion,
      periodoCopec,
    ]
  );

  const validarEquipoFuel = useCallback(async () => {
    setValidandoFuel(true);
    setErrorMensual("");
    setErrorGlobal("");

    try {
      const debeReanudarGlobal = reanudarGlobalTrasValidacion;
      await validarEquipoCopecFuel(codigoFuel);
      setRequiereCodigoFuel(false);
      setCodigoFuel("");
      setReanudarGlobalTrasValidacion(false);

      if (debeReanudarGlobal) {
        await sincronizarTodoElMes({ sesionValidada: true });
      } else {
        await sincronizarCopecFuel();
      }
    } catch (errorValidacion) {
      const mensajeError =
        errorValidacion.message || "No fue posible validar el equipo CopecFuel.";

      if (reanudarGlobalTrasValidacion) {
        setErrorGlobal(mensajeError);
      } else {
        setErrorMensual(mensajeError);
      }
    } finally {
      setValidandoFuel(false);
    }
  }, [
    codigoFuel,
    reanudarGlobalTrasValidacion,
    sincronizarCopecFuel,
    sincronizarTodoElMes,
  ]);

  const solicitarNuevoCodigoFuel = useCallback(async () => {
    setSolicitandoCodigoFuel(true);
    setErrorMensual("");
    setErrorGlobal("");
    setMensajeFuel("");

    try {
      const conexion = await probarConexionCopecFuel(true);
      setCodigoFuel("");
      setRequiereCodigoFuel(Boolean(conexion.requiereCodigoEquipo));
      setMensajeFuel(
        conexion.requiereCodigoEquipo
          ? "CopecFuel envió un código nuevo. Utiliza solamente el último correo recibido."
          : "El equipo ya se encuentra conectado."
      );
      if (reanudarGlobalTrasValidacion && conexion.requiereCodigoEquipo) {
        setMensajeGlobal(
          "CopecFuel envió un código nuevo. Utiliza solamente el último correo recibido."
        );
      }
    } catch (errorConexion) {
      const mensajeError =
        errorConexion.message || "No fue posible solicitar un código nuevo.";

      if (reanudarGlobalTrasValidacion) {
        setErrorGlobal(mensajeError);
      } else {
        setErrorMensual(mensajeError);
      }
    } finally {
      setSolicitandoCodigoFuel(false);
    }
  }, [reanudarGlobalTrasValidacion]);

  const renderPage = () => {
    if (activePage === "dashboard") {
      return (
        <Dashboard
          datos={datosCopec}
          cargando={cargando}
          error={error}
          onActualizar={cargarDatosCopec}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          fechaDesde={fechaDesdeSincronizacion}
          onFechaDesdeChange={cambiarFechaDesdeSincronizacion}
          sincronizandoMes={sincronizandoGlobal}
          progresoMes={progresoGlobal}
          resultadosMes={resultadosGlobal}
          mensajeMes={mensajeGlobal}
          errorMes={errorGlobal}
          onSincronizarMes={sincronizarTodoElMes}
          requiereCodigo={
            requiereCodigoFuel && reanudarGlobalTrasValidacion
          }
          codigo={codigoFuel}
          validando={validandoFuel}
          solicitandoCodigo={solicitandoCodigoFuel}
          onCodigoChange={setCodigoFuel}
          onValidar={validarEquipoFuel}
          onSolicitarCodigo={solicitarNuevoCodigoFuel}
        />
      );
    }

    if (activePage === "copec") {
      return (
        <CopecIntegration
          datos={datosCopec}
          cargando={cargando}
          error={error}
          sincronizando={sincronizando}
          mensaje={mensaje}
          onActualizar={cargarDatosCopec}
          onSincronizar={sincronizar}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          fechaDesde={fechaDesdeSincronizacion}
          onFechaDesdeChange={cambiarFechaDesdeSincronizacion}
        />
      );
    }

    if (activePage === "copecfuel") {
      return (
        <CopecFuelIntegration
          datos={datosMensuales}
          cargando={cargandoMensual}
          error={errorMensual}
          sincronizando={sincronizandoFuel}
          progreso={progresoFuel}
          mensaje={mensajeFuel}
          requiereCodigo={requiereCodigoFuel}
          codigo={codigoFuel}
          validando={validandoFuel}
          solicitandoCodigo={solicitandoCodigoFuel}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          fechaDesde={fechaDesdeSincronizacion}
          onFechaDesdeChange={cambiarFechaDesdeSincronizacion}
          onCodigoChange={setCodigoFuel}
          onValidar={validarEquipoFuel}
          onSolicitarCodigo={solicitarNuevoCodigoFuel}
          onActualizar={cargarDatosMensuales}
          onSincronizar={sincronizarCopecFuel}
        />
      );
    }

    if (activePage === "muevo") {
      return (
        <CargosMuevoEmpresaIntegration
          datos={datosMuevo}
          cargando={cargandoMuevo}
          error={errorMuevo}
          mensaje={mensajeMuevo}
          importando={importandoMuevo}
          sincronizandoCargos={sincronizandoCargosMuevo}
          progreso={progresoMuevo}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          fechaDesde={fechaDesdeSincronizacion}
          onFechaDesdeChange={cambiarFechaDesdeSincronizacion}
          onImportar={importarDetalleMuevo}
          onSincronizarCargos={sincronizarCargosMuevo}
          onActualizar={cargarDatosMuevo}
        />
      );
    }

    if (activePage === "recompra") {
      return (
        <RecompraIntegration
          datos={datosRecompra}
          cargando={cargandoRecompra}
          error={errorRecompra}
          mensaje={mensajeRecompra}
          sincronizando={sincronizandoRecompra}
          progreso={progresoRecompra}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          fechaDesde={fechaDesdeSincronizacion}
          onFechaDesdeChange={cambiarFechaDesdeSincronizacion}
          onSincronizar={sincronizarRecompra}
          onActualizar={cargarDatosRecompra}
          onGuardarAjuste={guardarAjusteRecompra}
          onEliminarAjuste={eliminarAjusteRecompra}
          guardandoAjuste={guardandoAjusteRecompra}
          descargandoEnRuta={descargandoEnRuta}
          onDescargarEnRuta={descargarReporteEnRuta}
        />
      );
    }

    if (activePage === "coseducam") {
      return (
        <CoseducamIntegration
          datos={datosCoseducam}
          cargando={cargandoCoseducam}
          error={errorCoseducam}
          mensaje={mensajeCoseducam}
          procesandoFecha={procesandoGuiaCoseducam}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          onActualizar={cargarDatosCoseducam}
          onCrearGuia={crearGuiaDiaCoseducam}
          onConfirmarGuia={confirmarGuiaDiaCoseducam}
        />
      );
    }

    if (activePage === "conciliacion") {
      return (
        <ConciliacionIntegration
          datos={datosMensuales}
          cargando={cargandoMensual}
          error={errorMensual}
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          fechaDesde={fechaDesdeSincronizacion}
          onFechaDesdeChange={cambiarFechaDesdeSincronizacion}
          onActualizar={cargarDatosMensuales}
        />
      );
    }

    return (
      <ComingSoon
        title="Configuración"
        description="Usuarios, credenciales, parámetros y reglas del sistema."
      />
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>VALEPAC</strong>
            <span>Connect</span>
          </div>
        </div>

        <nav className="navigation">
          {menuItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                className={
                  activePage === item.id ? "nav-item active" : "nav-item"
                }
                onClick={() => setActivePage(item.id)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span>Conector Copec</span>
          <strong>Activo</strong>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <strong>VALEPAC Connect</strong>
            <span>Centro de integraciones y conciliación</span>
          </div>

          <div className="user-badge">GA</div>
        </header>

        <div className="content">{renderPage()}</div>
      </main>
    </div>
  );
}
