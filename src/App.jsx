import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Fuel,
  LayoutDashboard,
  Link2,
  RefreshCw,
  Scale,
  Search,
  Settings,
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
} from "./services/muevoEmpresaApi.js";
import "./styles.css";

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "copec", label: "Integración Copec", icon: Link2 },
  { id: "copecfuel", label: "CopecFuel", icon: Fuel },
  { id: "muevo", label: "Cargos Muevo empresa", icon: Database },
  { id: "conciliacion", label: "Conciliación", icon: Scale },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

const formatoMoneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const formatoNumero = new Intl.NumberFormat("es-CL");

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

function Dashboard({ datos, cargando, error, onActualizar }) {
  const resumen = datos?.resumen;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Resumen general</span>
          <h1>Dashboard</h1>
          <p>Estado de las integraciones y abonos sincronizados.</p>
        </div>

        <button
          className="secondary-button button-with-icon"
          onClick={onActualizar}
          disabled={cargando}
        >
          <RefreshCw className={cargando ? "spin" : ""} size={16} />
          Actualizar datos
        </button>
      </div>

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

          <button
            className="primary-button button-with-icon"
            onClick={onSincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando ? "Sincronizando…" : "Sincronizar mes"}
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
          <button
            className="primary-button button-with-icon"
            onClick={onSincronizar}
            disabled={sincronizando}
          >
            <RefreshCw className={sincronizando ? "spin" : ""} size={16} />
            {sincronizando ? "Sincronizando…" : "Sincronizar mes"}
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
  periodoSeleccionado,
  onPeriodoChange,
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
          <label className="secondary-button button-with-icon file-button">
            <Database size={16} />
            {importando ? "Importando..." : "Importar detalle CSV"}
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
            {sincronizandoCargos ? "Sincronizando..." : "Sincronizar cargos"}
          </button>
        </div>
      </div>

      {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
      {error && datos ? <div className="feedback error-feedback">{error}</div> : null}

      <div className="feedback info-feedback">
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
  const [sincronizandoFuel, setSincronizandoFuel] = useState(false);
  const [progresoFuel, setProgresoFuel] = useState(null);
  const [mensajeFuel, setMensajeFuel] = useState("");
  const [requiereCodigoFuel, setRequiereCodigoFuel] = useState(false);
  const [codigoFuel, setCodigoFuel] = useState("");
  const [validandoFuel, setValidandoFuel] = useState(false);
  const [solicitandoCodigoFuel, setSolicitandoCodigoFuel] = useState(false);
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
    setPeriodoCopec(nuevoPeriodo);

    if (typeof window !== "undefined") {
      window.localStorage.setItem("valepac-periodo-copec", nuevoPeriodo);
    }
  }, []);

  useEffect(() => {
    cargarDatosCopec();
  }, [cargarDatosCopec]);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setError("");
    setMensaje("");

    try {
      const resultado = await sincronizarAbonosCopec(periodoCopec);
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
  }, [cargarDatosCopec, periodoCopec]);

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
    setErrorMuevo("");
    setMensajeMuevo("");

    try {
      const resultado = await sincronizarAbonosCopec(periodoCopec);
      setMensajeMuevo(
        `Portal Copec sincronizado: ${formatoNumero.format(
          resultado.cargosMuevoEncontrados || 0
        )} cargos Consumo Muevo Empresa procesados.`
      );
      await Promise.all([cargarDatosMuevo(), cargarDatosCopec()]);
    } catch (errorSincronizacion) {
      setErrorMuevo(
        errorSincronizacion.message ||
          "No fue posible sincronizar los cargos del Portal Copec."
      );
    } finally {
      setSincronizandoCargosMuevo(false);
    }
  }, [cargarDatosCopec, cargarDatosMuevo, periodoCopec]);

  const sincronizarCopecFuel = useCallback(async () => {
    setSincronizandoFuel(true);
    setProgresoFuel(null);
    setMensajeFuel("");
    setErrorMensual("");

    try {
      const resultado = await sincronizarMesCopecFuel(
        periodoCopec,
        setProgresoFuel
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
  }, [cargarDatosMensuales, periodoCopec]);

  const validarEquipoFuel = useCallback(async () => {
    setValidandoFuel(true);
    setErrorMensual("");

    try {
      await validarEquipoCopecFuel(codigoFuel);
      setRequiereCodigoFuel(false);
      setCodigoFuel("");
      await sincronizarCopecFuel();
    } catch (errorValidacion) {
      setErrorMensual(
        errorValidacion.message || "No fue posible validar el equipo CopecFuel."
      );
    } finally {
      setValidandoFuel(false);
    }
  }, [codigoFuel, sincronizarCopecFuel]);

  const solicitarNuevoCodigoFuel = useCallback(async () => {
    setSolicitandoCodigoFuel(true);
    setErrorMensual("");
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
    } catch (errorConexion) {
      setErrorMensual(
        errorConexion.message || "No fue posible solicitar un código nuevo."
      );
    } finally {
      setSolicitandoCodigoFuel(false);
    }
  }, []);

  const renderPage = () => {
    if (activePage === "dashboard") {
      return (
        <Dashboard
          datos={datosCopec}
          cargando={cargando}
          error={error}
          onActualizar={cargarDatosCopec}
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
          periodoSeleccionado={periodoCopec}
          onPeriodoChange={cambiarPeriodoCopec}
          onImportar={importarDetalleMuevo}
          onSincronizarCargos={sincronizarCargosMuevo}
          onActualizar={cargarDatosMuevo}
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
