import { useMemo, useState } from "react";
import { Braces, Download, RefreshCw, Search } from "lucide-react";
import { consultarTransaccionesOficiales } from "../services/copecFuelApi.js";
import { descargarExcelTransacciones } from "../utils/exportarExcel.js";

const COLUMNAS_CONFIRMADAS = [
  { campo: "turnoId", etiqueta: "Turno" },
  { campo: "transaccionCodigo", etiqueta: "Transacción" },
  { campo: "transaccionTipo", etiqueta: "Tipo" },
  { campo: "transaccionFechaCierre", etiqueta: "Fecha cierre" },
  { campo: "posNumero", etiqueta: "POS" },
  { campo: "usuarioPagoNombre", etiqueta: "Usuario pago" },
];

function fechaChileActual() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mostrarValor(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

export default function CopecFuelOfficialPanel() {
  const [fecha, setFecha] = useState(fechaChileActual);
  const [consultando, setConsultando] = useState(false);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [mostrarJson, setMostrarJson] = useState(false);
  const transacciones = datos?.transacciones || [];
  const columnas = useMemo(
    () =>
      COLUMNAS_CONFIRMADAS.filter((columna) =>
        transacciones.some((fila) =>
          Object.prototype.hasOwnProperty.call(fila || {}, columna.campo)
        )
      ),
    [transacciones]
  );
  const vistaJson = useMemo(() => {
    if (!mostrarJson || !datos) return "";
    return JSON.stringify(datos.respuestaOriginal || datos, null, 2);
  }, [datos, mostrarJson]);

  const consultar = async (evento) => {
    evento.preventDefault();
    setConsultando(true);
    setError("");
    setMostrarJson(false);

    try {
      const resultado = await consultarTransaccionesOficiales(fecha, true);
      setDatos(resultado);
    } catch (errorConsulta) {
      setDatos(null);
      setError(
        `${errorConsulta.message || "No fue posible consultar CopecFuel."}${
          errorConsulta.statusCopec
            ? ` Estado Copec: ${errorConsulta.statusCopec}.`
            : ""
        }`
      );
    } finally {
      setConsultando(false);
    }
  };

  const descargarExcel = () => {
    setError("");

    try {
      descargarExcelTransacciones(transacciones, datos?.fecha || fecha);
    } catch (errorDescarga) {
      setError(
        errorDescarga.message || "No fue posible preparar el archivo Excel."
      );
    }
  };

  return (
    <section className="panel official-api-panel">
      <div className="panel-header table-header">
        <div>
          <span className="eyebrow">API oficial · Fuente productiva</span>
          <h2>Ventas de combustible y productos</h2>
          <p>
            Consulta directa de VENTA_COMBUSTIBLE y VENTA_PRODUCTO. El botón superior
            Sincronizar guarda esta misma información y actualiza CopecFuel,
            Muevo Empresa, Recompra, Coseducam y Conciliación.
          </p>
        </div>
        <form className="official-api-form" onSubmit={consultar}>
          <label>
            <span>Fecha</span>
            <input
              type="date"
              value={fecha}
              max={fechaChileActual()}
              onChange={(evento) => setFecha(evento.target.value)}
              disabled={consultando}
              required
            />
          </label>
          <button
            type="submit"
            className="primary-button button-with-icon"
            disabled={consultando || !fecha}
          >
            {consultando ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            {consultando ? "Consultando…" : "Consultar ventas"}
          </button>
        </form>
      </div>

      {error ? (
        <div className="feedback error-feedback" role="alert">
          {error}
        </div>
      ) : null}

      {datos ? (
        <>
          <div className="official-api-summary">
            <div>
              <span>Transacciones</span>
              <strong>{datos.cantidad?.toLocaleString("es-CL") || 0}</strong>
            </div>
            <div>
              <span>Combustible</span>
              <strong>
                {datos.cantidadCombustible?.toLocaleString("es-CL") || 0}
              </strong>
            </div>
            <div>
              <span>Productos</span>
              <strong>
                {datos.cantidadProductos?.toLocaleString("es-CL") || 0}
              </strong>
            </div>
            <div>
              <span>Turno consultado</span>
              <strong>{datos.turnoId}</strong>
            </div>
            <div>
              <span>Fuente</span>
              <strong>API oficial</strong>
            </div>
            <div className="official-api-actions">
              <button
                type="button"
                className="secondary-button button-with-icon"
                onClick={descargarExcel}
                disabled={transacciones.length === 0}
              >
                <Download size={16} />
                Descargar Excel
              </button>
              <button
                type="button"
                className="secondary-button button-with-icon"
                onClick={() => setMostrarJson((actual) => !actual)}
              >
                <Braces size={16} />
                {mostrarJson ? "Ocultar JSON" : "Ver JSON"}
              </button>
            </div>
          </div>

          <details className="official-fields">
            <summary>
              Campos encontrados ({datos.camposDisponibles?.length || 0})
            </summary>
            <div>
              {(datos.camposDisponibles || []).map((campo) => (
                <code key={campo}>{campo}</code>
              ))}
            </div>
          </details>

          {mostrarJson ? (
            <pre className="official-json">{vistaJson}</pre>
          ) : null}

          {transacciones.length === 0 ? (
            <div className="empty-state compact">
              <Search size={26} />
              <h3>Fecha sin transacciones</h3>
              <p>CopecFuel respondió correctamente con un reporte vacío.</p>
            </div>
          ) : (
            <div className="table-wrapper official-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {columnas.map((columna) => (
                      <th key={columna.campo}>{columna.etiqueta}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transacciones.slice(0, 100).map((fila, indice) => (
                    <tr
                      key={
                        fila.transaccionId ||
                        fila.transaccionCodigo ||
                        `transaccion-${indice}`
                      }
                    >
                      {columnas.map((columna) => (
                        <td key={columna.campo}>
                          {mostrarValor(fila[columna.campo])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {transacciones.length > 100 ? (
                <p className="table-footnote">
                  Se muestran las primeras 100 transacciones. El botón Ver JSON
                  conserva la respuesta completa para análisis.
                </p>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
