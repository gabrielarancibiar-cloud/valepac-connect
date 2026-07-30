import { useState } from "react";
import "./styles.css";

const menuItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "copec", label: "Integración Copec" },
  { id: "copecfuel", label: "CopecFuel" },
  { id: "conciliacion", label: "Conciliación" },
  { id: "configuracion", label: "Configuración" },
];

function Dashboard() {
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Resumen general</span>
          <h1>Dashboard</h1>
          <p>Estado inicial de las integraciones y conciliaciones.</p>
        </div>

        <button className="primary-button">Sincronizar todo</button>
      </div>

      <section className="cards-grid">
        <article className="metric-card">
          <span>Integraciones activas</span>
          <strong>0</strong>
          <small>Copec pendiente de conexión</small>
        </article>

        <article className="metric-card">
          <span>Abonos importados</span>
          <strong>0</strong>
          <small>Sin movimientos sincronizados</small>
        </article>

        <article className="metric-card">
          <span>Monto abonado</span>
          <strong>$0</strong>
          <small>Período actual</small>
        </article>

        <article className="metric-card">
          <span>Diferencias</span>
          <strong>0</strong>
          <small>Conciliación aún no configurada</small>
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
            <div className="connector-icon">C</div>
            <div>
              <strong>Portal Concesionarios Copec</strong>
              <span>Cartola de abonos</span>
            </div>
          </div>

          <span className="status status-off">Sin conectar</span>
        </div>

        <div className="connector-row">
          <div className="connector-name">
            <div className="connector-icon">F</div>
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

function CopecIntegration() {
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Integraciones</span>
          <h1>Portal Concesionarios Copec</h1>
          <p>Obtención automática de cartolas y abonos.</p>
        </div>
      </div>

      <section className="connection-card">
        <div>
          <span className="status status-off">Sin conectar</span>
          <h2>Conector Copec</h2>
          <p>
            La autenticación y lectura de la API se incorporarán en la próxima
            etapa.
          </p>
        </div>

        <button className="primary-button">Conectar</button>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Cartola de abonos</h2>
            <p>Los movimientos sincronizados aparecerán aquí.</p>
          </div>

          <button className="secondary-button" disabled>
            Sincronizar cartola
          </button>
        </div>

        <div className="empty-state">
          <div className="empty-icon">↻</div>
          <h3>No existen movimientos</h3>
          <p>Conecta el Portal Copec para obtener la primera cartola.</p>
        </div>
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
          <p>Se habilitará cuando completemos el conector inicial de Copec.</p>
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");

  const renderPage = () => {
    if (activePage === "dashboard") {
      return <Dashboard />;
    }

    if (activePage === "copec") {
      return <CopecIntegration />;
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
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={activePage === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActivePage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>Versión inicial</span>
          <strong>v0.1</strong>
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
