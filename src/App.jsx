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
import "./styles.css";

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "copec", label: "Integración Copec", icon: Link2 },
  { id: "copecfuel", label: "CopecFuel", icon: Fuel },
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
          <strong>{datos?.conectado ? "1" : "0"}</strong>
          <small>Portal Concesionarios Copec</small>
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
              <span>Ventas y liquidaciones</span>
            </div>
          </div>

          <span className="status status-wait">Próximamente</span>
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
          <label className="month-filter">
            <span>Mes de la cartola</span>
            <input
              type="month"
              value={periodoSeleccionado}
              onChange={(evento) => onPeriodoChange(evento.target.value)}
              disabled={cargando || sincronizando}
            />
          </label>

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
        <ComingSoon
          title="CopecFuel"
          description="Conector para ventas, transacciones y liquidaciones."
        />
      );
    }

    if (activePage === "conciliacion") {
      return (
        <ComingSoon
          title="Conciliación"
          description="Comparación automática entre ventas y abonos consolidados."
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
