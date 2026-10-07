import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Fuel, RefreshCw, TrendingUp, Trash2, Save } from "lucide-react";
import { eliminarCostoBlueMax, guardarCostoBlueMax, obtenerCostosBlueMax, obtenerM2 } from "../services/m2Api.js";

const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const monedaDecimal = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numero = new Intl.NumberFormat("es-CL");
const litros = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

function nombreCategoria(tipo, segmento) {
  return `${tipo === "AUTOSERVICIO" ? "Autoservicio" : "Asistida"} · ${
    segmento === "TAXI_AMIGO" ? "Taxi Amigo" : "Normal"
  }`;
}

function Metrica({ titulo, valor, detalle, destacada = false }) {
  return (
    <article className={`metric-card ${destacada ? "featured" : ""}`}>
      <span>{titulo}</span>
      <strong>{valor}</strong>
      <small>{detalle}</small>
    </article>
  );
}

export default function M2Panel({ periodo, onPeriodoChange }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [costosBlueMax, setCostosBlueMax] = useState([]);
  const [fechaCostoBlueMax, setFechaCostoBlueMax] = useState("");
  const [precioCostoBlueMax, setPrecioCostoBlueMax] = useState("");
  const [guardandoBlueMax, setGuardandoBlueMax] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await obtenerM2(periodo));
    } catch (e) {
      setError(e.message || "No fue posible cargar M2.");
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  const cargarCostosBlueMax = useCallback(async () => {
    try {
      const respuesta = await obtenerCostosBlueMax();
      setCostosBlueMax(respuesta.costos || []);
    } catch (e) {
      setError(e.message || "No fue posible cargar los costos BlueMax.");
    }
  }, []);

  useEffect(() => {
    cargar();
    cargarCostosBlueMax();
  }, [cargar, cargarCostosBlueMax]);

  async function guardarBlueMax(e) {
    e.preventDefault();
    setGuardandoBlueMax(true);
    setError("");
    try {
      const respuesta = await guardarCostoBlueMax({
        fechaVigencia: fechaCostoBlueMax,
        precioCosto: precioCostoBlueMax,
      });
      setCostosBlueMax(respuesta.costos || []);
      setFechaCostoBlueMax("");
      setPrecioCostoBlueMax("");
      await cargar();
    } catch (err) {
      setError(err.message || "No fue posible guardar el costo BlueMax.");
    } finally {
      setGuardandoBlueMax(false);
    }
  }

  async function borrarBlueMax(id) {
    if (!window.confirm("¿Eliminar este costo BlueMax? Las ventas afectadas tomarán el costo vigente anterior.")) return;
    setGuardandoBlueMax(true);
    setError("");
    try {
      const respuesta = await eliminarCostoBlueMax(id);
      setCostosBlueMax(respuesta.costos || []);
      await cargar();
    } catch (err) {
      setError(err.message || "No fue posible eliminar el costo BlueMax.");
    } finally {
      setGuardandoBlueMax(false);
    }
  }

  const categorias = useMemo(() => datos?.categorias || [], [datos]);
  const productos = useMemo(() => datos?.productos || [], [datos]);
  const resumen = datos?.resumen || {};
  const sinCosto = Number(resumen.lineasSinCosto || 0);

  const m2Asistida = categorias
    .filter((x) => x.tipoVenta === "ASISTIDA")
    .reduce((s, x) => s + Number(x.m2Neto || 0), 0);
  const m2Autoservicio = categorias
    .filter((x) => x.tipoVenta === "AUTOSERVICIO")
    .reduce((s, x) => s + Number(x.m2Neto || 0), 0);
  const m2Taxi = categorias
    .filter((x) => x.segmentoCliente === "TAXI_AMIGO")
    .reduce((s, x) => s + Number(x.m2Neto || 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Margen combustibles</span>
          <h1>M2</h1>
          <p>
            Margen neto de Diésel, gasolinas y BlueMax granel emitido por
            Valencia y Pacheco.
          </p>
        </div>
        <div className="page-actions">
          <label className="month-filter">
            <span>Mes</span>
            <input
              type="month"
              value={periodo}
              onChange={(e) => onPeriodoChange(e.target.value)}
              disabled={cargando}
            />
          </label>
          <button className="icon-button" onClick={cargar} disabled={cargando} title="Actualizar M2">
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      <div className="feedback info-feedback">
        <strong>Fórmula:</strong> M2 = ((precio venta − precio costo) / 1,19) × litros.
        Solo considera Crédito documentado, RutPay/Billetera BancoEstado,
        tarjeta de crédito, tarjeta de débito, efectivo y App Copec.
      </div>

      {error ? (
        <div className="feedback error-feedback">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}

      {sinCosto > 0 ? (
        <div className="feedback warning-feedback m2-warning">
          <AlertCircle size={16} />
          {numero.format(sinCosto)} línea(s) no tienen precio costo vigente y no se incluyen en el M2. BlueMax requiere ingresar manualmente su costo vigente en el panel de esta página.
        </div>
      ) : null}

      <section className="panel m2-bluemax-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Costo BlueMax granel</h2>
            <p>Ingresa el costo bruto por litro y la fecha desde la que comienza a regir. El M2 aplicará automáticamente el último costo vigente para cada venta.</p>
          </div>
          <Fuel size={20} />
        </div>
        <form className="m2-bluemax-form" onSubmit={guardarBlueMax}>
          <label>
            <span>Fecha vigencia</span>
            <input type="date" value={fechaCostoBlueMax} onChange={(e) => setFechaCostoBlueMax(e.target.value)} required disabled={guardandoBlueMax} />
          </label>
          <label>
            <span>Costo BlueMax $/L</span>
            <input type="number" min="0.001" step="0.001" placeholder="Ej. 615" value={precioCostoBlueMax} onChange={(e) => setPrecioCostoBlueMax(e.target.value)} required disabled={guardandoBlueMax} />
          </label>
          <button className="primary-button" type="submit" disabled={guardandoBlueMax || !fechaCostoBlueMax || !precioCostoBlueMax}>
            <Save size={16} /> {guardandoBlueMax ? "Guardando..." : "Guardar costo"}
          </button>
        </form>
        <div className="table-wrapper">
          <table className="data-table daily-table m2-cost-table">
            <thead><tr><th>Vigente desde</th><th className="amount-column">Costo $/L</th><th className="amount-column">Acción</th></tr></thead>
            <tbody>
              {costosBlueMax.map((costo) => (
                <tr key={costo.id}>
                  <td><strong className="table-primary">{new Date(`${costo.fecha_vigencia}T12:00:00`).toLocaleDateString("es-CL")}</strong></td>
                  <td className="amount-column">{monedaDecimal.format(Number(costo.precio_costo || 0))}</td>
                  <td className="amount-column"><button type="button" className="icon-button danger" title="Eliminar costo" onClick={() => borrarBlueMax(costo.id)} disabled={guardandoBlueMax}><Trash2 size={15} /></button></td>
                </tr>
              ))}
              {costosBlueMax.length === 0 ? <tr><td colSpan="3" className="empty-table-cell">Aún no hay costos BlueMax ingresados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cards-grid">
        <Metrica
          titulo="M2 total mes"
          valor={moneda.format(resumen.m2Neto || 0)}
          detalle={`${litros.format(resumen.litros || 0)} L · ${numero.format(resumen.transacciones || 0)} transacciones`}
          destacada
        />
        <Metrica titulo="Ventas asistidas" valor={moneda.format(m2Asistida)} detalle="M2 neto asistido" />
        <Metrica titulo="Autoservicio" valor={moneda.format(m2Autoservicio)} detalle="M2 neto autoservicio" />
        <Metrica titulo="Taxi Amigo" valor={moneda.format(m2Taxi)} detalle="Incluye asistido y autoservicio" />
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>M2 por categoría</h2>
            <p>Separación entre modalidad de atención y fidelización.</p>
          </div>
          <TrendingUp size={20} />
        </div>
        <div className="table-wrapper">
          <table className="data-table daily-table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="amount-column">Litros</th>
                <th className="amount-column">Transacciones</th>
                <th className="amount-column">M2 / L</th>
                <th className="amount-column">M2 neto</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((fila) => (
                <tr key={`${fila.tipoVenta}-${fila.segmentoCliente}`}>
                  <td><strong className="table-primary">{nombreCategoria(fila.tipoVenta, fila.segmentoCliente)}</strong></td>
                  <td className="amount-column">{litros.format(fila.litros || 0)}</td>
                  <td className="amount-column">{numero.format(fila.transacciones || 0)}</td>
                  <td className="amount-column">{monedaDecimal.format(fila.m2Litro || 0)}</td>
                  <td className="amount-column amount-strong">{moneda.format(fila.m2Neto || 0)}</td>
                </tr>
              ))}
              {categorias.length === 0 && !cargando ? (
                <tr><td colSpan="5" className="empty-table-cell">No hay ventas M2 sincronizadas para este mes.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>M2 por producto y categoría</h2>
            <p>Detalle de Diésel, G93, G95, G97 y BlueMax.</p>
          </div>
          <Fuel size={20} />
        </div>
        <div className="table-wrapper">
          <table className="data-table daily-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th className="amount-column">Litros</th>
                <th className="amount-column">M2 / L</th>
                <th className="amount-column">M2 neto</th>
                <th className="amount-column">Sin costo</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((fila) => (
                <tr key={`${fila.producto}-${fila.tipoVenta}-${fila.segmentoCliente}`}>
                  <td><strong className="table-primary">{fila.producto}</strong></td>
                  <td>{nombreCategoria(fila.tipoVenta, fila.segmentoCliente)}</td>
                  <td className="amount-column">{litros.format(fila.litros || 0)}</td>
                  <td className="amount-column">{monedaDecimal.format(fila.m2Litro || 0)}</td>
                  <td className="amount-column amount-strong">{moneda.format(fila.m2Neto || 0)}</td>
                  <td className="amount-column">{numero.format(fila.lineasSinCosto || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-header table-header">
          <div>
            <h2>M2 diario por producto</h2>
            <p>El total mensual se construye desde el margen diario de cada combustible.</p>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table daily-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Producto</th>
                <th className="amount-column">Litros</th>
                <th className="amount-column">Transacciones</th>
                <th className="amount-column">M2 / L</th>
                <th className="amount-column">M2 neto</th>
                <th className="amount-column">Sin costo</th>
              </tr>
            </thead>
            <tbody>
              {(datos?.diasProductos || []).map((dia) => (
                <tr key={`${dia.fecha}-${dia.producto}`}>
                  <td><strong className="table-primary">{new Date(`${dia.fecha}T12:00:00`).toLocaleDateString("es-CL")}</strong></td>
                  <td>{dia.producto}</td>
                  <td className="amount-column">{litros.format(dia.litros || 0)}</td>
                  <td className="amount-column">{numero.format(dia.transacciones || 0)}</td>
                  <td className="amount-column">{monedaDecimal.format(dia.m2Litro || 0)}</td>
                  <td className="amount-column amount-strong">{moneda.format(dia.m2Neto || 0)}</td>
                  <td className="amount-column">{numero.format(dia.lineasSinCosto || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
