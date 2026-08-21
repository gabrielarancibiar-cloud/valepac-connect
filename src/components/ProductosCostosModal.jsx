import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  obtenerCatalogoCostosProductos,
  registrarCostoProducto,
} from "../services/productosEerrApi.js";

const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 2,
});

function fechaChileActual() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fechaVisible(valor) {
  if (!valor) return "Sin información";
  const fecha = new Date(`${valor}T12:00:00`);
  return Number.isNaN(fecha.getTime())
    ? valor
    : fecha.toLocaleDateString("es-CL");
}

function numeroCosto(valor) {
  const texto = String(valor || "")
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const normalizado = texto.includes(",")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;
  const resultado = Number(normalizado);

  return Number.isFinite(resultado) ? resultado : null;
}

function codigoCorto(codigo) {
  const valor = String(codigo || "");
  return valor.length > 18 ? `${valor.slice(0, 10)}…${valor.slice(-6)}` : valor;
}

export default function ProductosCostosModal({
  abierto,
  onCerrar,
  onCostoActualizado,
}) {
  const [catalogo, setCatalogo] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [borradores, setBorradores] = useState({});
  const [guardando, setGuardando] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargarCatalogo = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      setCatalogo(await obtenerCatalogoCostosProductos());
    } catch (errorCarga) {
      setError(
        errorCarga.message || "No fue posible cargar el catálogo de productos."
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!abierto) return;
    setBusqueda("");
    setBorradores({});
    setMensaje("");
    cargarCatalogo();
  }, [abierto, cargarCatalogo]);

  useEffect(() => {
    if (!abierto) return undefined;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const cerrarConEscape = (evento) => {
      if (evento.key === "Escape" && !guardando) onCerrar();
    };

    window.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [abierto, guardando, onCerrar]);

  const productos = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");
    const lista = catalogo?.productos || [];

    if (!termino) return lista;

    return lista.filter((producto) =>
      [producto.descripcion, producto.codigo, producto.categoria]
        .filter(Boolean)
        .some((valor) =>
          String(valor).toLocaleLowerCase("es").includes(termino)
        )
    );
  }, [busqueda, catalogo]);

  const actualizarBorrador = (productoId, campo, valor) => {
    setBorradores((actual) => ({
      ...actual,
      [productoId]: {
        costo: actual[productoId]?.costo || "",
        fecha: actual[productoId]?.fecha || fechaChileActual(),
        [campo]: valor,
      },
    }));
  };

  const guardarCosto = async (producto) => {
    const borrador = borradores[producto.productoId] || {};
    const costo = numeroCosto(borrador.costo);
    const fecha = borrador.fecha || fechaChileActual();

    setError("");
    setMensaje("");

    if (costo === null || costo <= 0) {
      setError(`Ingresa un costo neto válido para ${producto.descripcion}.`);
      return;
    }

    const confirmado = window.confirm(
      `Registrar ${moneda.format(costo)} como nuevo costo neto de ${producto.descripcion}, vigente desde ${fechaVisible(fecha)}?\n\nEl historial anterior se conservará sin modificaciones.`
    );

    if (!confirmado) return;

    setGuardando(producto.productoId);

    try {
      const resultado = await registrarCostoProducto({
        productoId: producto.productoId,
        costoNeto: costo,
        vigenteDesde: fecha,
        proveedor: producto.proveedor,
      });

      setMensaje(resultado.mensaje || "Nueva vigencia registrada correctamente.");
      setBorradores((actual) => {
        const siguiente = { ...actual };
        delete siguiente[producto.productoId];
        return siguiente;
      });
      await cargarCatalogo();
      await onCostoActualizado?.();
    } catch (errorGuardado) {
      setError(
        errorGuardado.message || "No fue posible registrar la nueva vigencia."
      );
    } finally {
      setGuardando("");
    }
  };

  if (!abierto) return null;

  return (
    <div
      className="cost-manager-overlay"
      role="presentation"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget && !guardando) onCerrar();
      }}
    >
      <section
        className="cost-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cost-manager-title"
      >
        <header className="cost-manager-header">
          <div>
            <span className="eyebrow">Administración de costos</span>
            <h2 id="cost-manager-title">Productos vigentes</h2>
            <p>
              Consulta precios observados y registra nuevas vigencias de costo
              sin reemplazar el historial.
            </p>
          </div>
          <button
            type="button"
            className="cost-manager-close"
            onClick={onCerrar}
            disabled={Boolean(guardando)}
            aria-label="Cerrar administrador de costos"
          >
            <X size={20} />
          </button>
        </header>

        <div className="cost-manager-toolbar">
          <label className="cost-manager-search">
            <Search size={17} />
            <input
              type="search"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Buscar por nombre, código o categoría"
              autoFocus
            />
          </label>
          <div className="cost-manager-counts">
            <span><strong>{catalogo?.total || 0}</strong> vigentes</span>
            <span className={(catalogo?.sinCosto || 0) > 0 ? "warning" : "complete"}>
              <strong>{catalogo?.sinCosto || 0}</strong> sin costo
            </span>
          </div>
        </div>

        <div className="cost-manager-history-note">
          <History size={17} />
          <span>
            Cada costo guardado crea una nueva vigencia. Los costos anteriores
            permanecen disponibles para recalcular correctamente cada periodo.
          </span>
        </div>

        {mensaje ? (
          <div className="feedback success-feedback">{mensaje}</div>
        ) : null}
        {error ? <div className="feedback error-feedback">{error}</div> : null}

        <div className="cost-manager-table-wrap">
          <table className="cost-manager-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Código</th>
                <th>Precio venta</th>
                <th>Comisión unitaria</th>
                <th>Costo vigente</th>
                <th>Nuevo costo neto</th>
                <th>Vigente desde</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => {
                const borrador = borradores[producto.productoId] || {};
                const sinCosto = producto.costoVigente === null;
                const estaGuardando = guardando === producto.productoId;

                return (
                  <tr key={producto.productoId} className={sinCosto ? "missing-cost" : ""}>
                    <td>
                      <strong>{producto.descripcion}</strong>
                      <span>{producto.categoria || "SIN CLASIFICAR"}</span>
                    </td>
                    <td>
                      <code title={producto.codigo}>{codigoCorto(producto.codigo)}</code>
                    </td>
                    <td>
                      <strong>
                        {producto.precioVentaObservado === null
                          ? "—"
                          : moneda.format(producto.precioVentaObservado)}
                      </strong>
                      <span>
                        {producto.fechaObservacion
                          ? `Observado ${fechaVisible(producto.fechaObservacion)}`
                          : "Sin ventas observadas"}
                      </span>
                    </td>
                    <td>
                      {producto.comisionUnitariaObservada === null
                        ? "—"
                        : moneda.format(producto.comisionUnitariaObservada)}
                    </td>
                    <td>
                      {sinCosto ? (
                        <span className="cost-missing-badge">
                          <AlertTriangle size={13} />Sin costo
                        </span>
                      ) : (
                        <>
                          <strong>{moneda.format(producto.costoVigente)}</strong>
                          <span>Desde {fechaVisible(producto.vigenteDesde)}</span>
                          <small>{producto.cantidadVigencias} vigencia(s)</small>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="cost-manager-money-input">
                        <span>$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={borrador.costo || ""}
                          onChange={(evento) =>
                            actualizarBorrador(
                              producto.productoId,
                              "costo",
                              evento.target.value
                            )
                          }
                          placeholder={
                            sinCosto
                              ? "Costo requerido"
                              : String(producto.costoVigente)
                          }
                          disabled={Boolean(guardando)}
                        />
                      </div>
                    </td>
                    <td>
                      <input
                        className="cost-manager-date-input"
                        type="date"
                        value={borrador.fecha || fechaChileActual()}
                        onChange={(evento) =>
                          actualizarBorrador(
                            producto.productoId,
                            "fecha",
                            evento.target.value
                          )
                        }
                        disabled={Boolean(guardando)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="cost-manager-save"
                        onClick={() => guardarCosto(producto)}
                        disabled={
                          Boolean(guardando) ||
                          numeroCosto(borrador.costo) === null
                        }
                      >
                        {estaGuardando ? (
                          <span className="cost-manager-spinner" />
                        ) : (
                          <Save size={15} />
                        )}
                        {estaGuardando ? "Guardando" : "Guardar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {cargando ? (
            <div className="cost-manager-empty">Cargando productos vigentes…</div>
          ) : null}
          {!cargando && productos.length === 0 ? (
            <div className="cost-manager-empty">
              <CheckCircle2 size={26} />
              No encontramos productos para esta búsqueda.
            </div>
          ) : null}
        </div>

        <footer className="cost-manager-footer">
          <span>
            Precio y comisión: moda unitaria de la última fecha con ventas.
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={onCerrar}
            disabled={Boolean(guardando)}
          >
            Cerrar
          </button>
        </footer>
      </section>
    </div>
  );
}
