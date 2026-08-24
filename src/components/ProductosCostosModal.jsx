import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, History, Save, Search, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import {
  actualizarProductoCatalogo,
  importarCostosProductos,
  obtenerCatalogoCostosProductos,
} from "../services/productosEerrApi.js";

const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency", currency: "CLP", maximumFractionDigits: 2,
});

function fechaChileActual() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function fechaVisible(valor) {
  if (!valor) return "Sin información";
  const fecha = new Date(`${valor}T12:00:00`);
  return Number.isNaN(fecha.getTime()) ? valor : fecha.toLocaleDateString("es-CL");
}

function numeroCosto(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const original = String(valor ?? "").replace(/\$/g, "").replace(/\s/g, "").trim();
  if (!original) return null;
  let normalizado = original;
  if (original.includes(",") && original.includes(".")) normalizado = original.replace(/\./g, "").replace(",", ".");
  else if (original.includes(",")) normalizado = original.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(original)) normalizado = original.replace(/\./g, "");
  const resultado = Number(normalizado);
  return Number.isFinite(resultado) ? resultado : null;
}

function codigoCorto(codigo) {
  const valor = String(codigo || "");
  return valor.length > 18 ? `${valor.slice(0, 10)}…${valor.slice(-6)}` : valor;
}

function claveEncabezado(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valorColumna(fila, aliases) {
  const entradas = Object.entries(fila);
  for (const alias of aliases) {
    const encontrada = entradas.find(([encabezado]) => claveEncabezado(encabezado) === alias);
    if (encontrada && encontrada[1] !== "") return encontrada[1];
  }
  return "";
}

function fechaPlanilla(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  if (typeof valor === "number") {
    const partes = XLSX.SSF.parse_date_code(valor);
    if (partes) return `${partes.y}-${String(partes.m).padStart(2, "0")}-${String(partes.d).padStart(2, "0")}`;
  }
  const cadena = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cadena)) return cadena;
  const coincidencia = cadena.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2].padStart(2, "0")}-${coincidencia[1].padStart(2, "0")}`
    : null;
}

export default function ProductosCostosModal({ abierto, onCerrar, onCostoActualizado }) {
  const [catalogo, setCatalogo] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [borradores, setBorradores] = useState({});
  const [guardando, setGuardando] = useState("");
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);
  const archivoRef = useRef(null);

  const cargarCatalogo = useCallback(async () => {
    setCargando(true); setError("");
    try { setCatalogo(await obtenerCatalogoCostosProductos()); }
    catch (errorCarga) { setError(errorCarga.message || "No fue posible cargar el catálogo de productos."); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => {
    if (!abierto) return;
    setBusqueda(""); setBorradores({}); setMensaje(""); cargarCatalogo();
  }, [abierto, cargarCatalogo]);

  useEffect(() => {
    if (!abierto) return undefined;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cerrarConEscape = (evento) => {
      if (evento.key === "Escape" && !guardando && !importando) onCerrar();
    };
    window.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [abierto, guardando, importando, onCerrar]);

  const productos = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");
    const lista = catalogo?.productos || [];
    if (!termino) return lista;
    return lista.filter((producto) => [producto.descripcion, producto.codigo, producto.categoria]
      .filter(Boolean).some((valor) => String(valor).toLocaleLowerCase("es").includes(termino)));
  }, [busqueda, catalogo]);

  const actualizarBorrador = (producto, campo, valor) => {
    setBorradores((actual) => ({
      ...actual,
      [producto.productoId]: {
        costo: actual[producto.productoId]?.costo || "",
        fecha: actual[producto.productoId]?.fecha || fechaChileActual(),
        vencimiento: actual[producto.productoId]?.vencimiento || "",
        categoria: actual[producto.productoId]?.categoria ?? producto.categoria ?? "SIN CLASIFICAR",
        [campo]: valor,
      },
    }));
  };

  const guardarProducto = async (producto) => {
    const borrador = borradores[producto.productoId] || {};
    const costo = numeroCosto(borrador.costo);
    const categoria = String(borrador.categoria ?? producto.categoria ?? "SIN CLASIFICAR").trim();
    const categoriaCambio = categoria !== (producto.categoria || "SIN CLASIFICAR");
    const fecha = borrador.fecha || fechaChileActual();
    setError(""); setMensaje("");
    if (!categoria) return setError(`Ingresa una categoría para ${producto.descripcion}.`);
    if (!categoriaCambio && costo === null) return setError("No existen cambios para guardar.");
    if (costo !== null && costo <= 0) return setError(`Ingresa un costo neto válido para ${producto.descripcion}.`);
    const detalleCosto = costo === null ? "sin crear una nueva vigencia de costo" : `y registrar ${moneda.format(costo)} desde ${fechaVisible(fecha)}`;
    if (!window.confirm(`Actualizar ${producto.descripcion} en la categoría ${categoria} ${detalleCosto}?\n\nEl historial anterior se conservará.`)) return;

    setGuardando(producto.productoId);
    try {
      const resultado = await actualizarProductoCatalogo({
        productoId: producto.productoId,
        categoria,
        proveedor: producto.proveedor,
        costoNeto: costo,
        vigenteDesde: costo === null ? undefined : fecha,
        vigenteHasta: costo === null ? undefined : borrador.vencimiento || null,
      });
      setMensaje(resultado.mensaje || "Producto actualizado correctamente.");
      setBorradores((actual) => { const siguiente = { ...actual }; delete siguiente[producto.productoId]; return siguiente; });
      await cargarCatalogo();
      await onCostoActualizado?.();
    } catch (errorGuardado) {
      setError(errorGuardado.message || "No fue posible actualizar el producto.");
    } finally { setGuardando(""); }
  };

  const importarPlanilla = async (evento) => {
    const archivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!archivo) return;
    setImportando(true); setError(""); setMensaje("");
    try {
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellDates: true });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const crudas = XLSX.utils.sheet_to_json(hoja, { defval: "", raw: true });
      const porCodigo = new Map((catalogo?.productos || []).map((producto) => [String(producto.codigo), producto]));
      const porNombre = new Map((catalogo?.productos || []).map((producto) => [claveEncabezado(producto.descripcion), producto]));
      const filas = crudas.map((fila) => {
        const codigo = String(valorColumna(fila, ["productoid", "codigo", "codigoproducto", "idproducto"]) || "").trim();
        const descripcion = String(valorColumna(fila, ["producto", "descripcion", "nombreproducto"]) || "").trim();
        const producto = porCodigo.get(codigo) || porNombre.get(claveEncabezado(descripcion));
        const costo = numeroCosto(valorColumna(fila, ["costoneto", "costo", "preciocosto", "costounitario"]));
        return {
          productoId: producto?.productoId || codigo,
          descripcion: descripcion || producto?.descripcion || "",
          categoria: String(valorColumna(fila, ["categoria", "familia", "tipoproducto"]) || producto?.categoria || "").trim(),
          proveedor: String(valorColumna(fila, ["proveedor"]) || producto?.proveedor || "").trim(),
          costoNeto: costo,
          vigenteDesde: fechaPlanilla(valorColumna(fila, ["vigentedesde", "vigencia", "fechadesde", "iniciovigencia"])),
          vigenteHasta: fechaPlanilla(valorColumna(fila, ["vigentehasta", "vencimiento", "fechahasta", "finvigencia"])),
        };
      }).filter((fila) => fila.productoId && (fila.categoria || fila.costoNeto !== null));
      if (filas.length === 0) throw new Error("No se reconocieron filas. Incluye Código, Categoría, Costo neto y Vigente desde.");
      const sinFecha = filas.find((fila) => fila.costoNeto !== null && !fila.vigenteDesde);
      if (sinFecha) throw new Error(`Falta Vigente desde para ${sinFecha.descripcion || sinFecha.productoId}.`);
      if (!window.confirm(`Se procesarán ${filas.length} producto(s) desde ${archivo.name}.\n\nLos costos existentes no serán reemplazados. ¿Continuar?`)) return;
      const resultado = await importarCostosProductos(filas);
      setMensaje(resultado.mensaje);
      if (resultado.errores?.length) setError(`La planilla terminó con ${resultado.errores.length} fila(s) pendiente(s). Primera observación: fila ${resultado.errores[0].fila}, ${resultado.errores[0].mensaje}`);
      await cargarCatalogo();
      await onCostoActualizado?.();
    } catch (errorImportacion) {
      setError(errorImportacion.message || "No fue posible importar la planilla.");
    } finally { setImportando(false); }
  };

  if (!abierto) return null;

  return (
    <div className="cost-manager-overlay" role="presentation" onMouseDown={(evento) => {
      if (evento.target === evento.currentTarget && !guardando && !importando) onCerrar();
    }}>
      <section className="cost-manager-modal" role="dialog" aria-modal="true" aria-labelledby="cost-manager-title">
        <header className="cost-manager-header">
          <div><span className="eyebrow">Administración de costos</span><h2 id="cost-manager-title">Productos vigentes</h2><p>Actualiza categorías, carga una planilla y registra nuevas vigencias sin reemplazar el historial.</p></div>
          <button type="button" className="cost-manager-close" onClick={onCerrar} disabled={Boolean(guardando) || importando} aria-label="Cerrar administrador de costos"><X size={20} /></button>
        </header>

        <div className="cost-manager-toolbar">
          <label className="cost-manager-search"><Search size={17} /><input type="search" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Buscar por nombre, código o categoría" autoFocus /></label>
          <div className="cost-manager-import-area">
            <input ref={archivoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importarPlanilla} />
            <button type="button" className="secondary-button button-with-icon" onClick={() => archivoRef.current?.click()} disabled={importando || Boolean(guardando)}><Upload size={16} />{importando ? "Importando…" : "Importar planilla"}</button>
            <div className="cost-manager-counts"><span><strong>{catalogo?.total || 0}</strong> vigentes</span><span className={(catalogo?.sinCosto || 0) > 0 ? "warning" : "complete"}><strong>{catalogo?.sinCosto || 0}</strong> sin costo</span></div>
          </div>
        </div>

        <div className="cost-manager-history-note"><History size={17} /><span>Columnas admitidas: Código, Producto, Categoría, Costo neto, Vigente desde, Vencimiento y Proveedor. Cada costo crea una nueva vigencia.</span></div>
        {mensaje ? <div className="feedback success-feedback">{mensaje}</div> : null}
        {error ? <div className="feedback error-feedback">{error}</div> : null}

        <div className="cost-manager-table-wrap">
          <table className="cost-manager-table">
            <thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Precio venta</th><th>Comisión unitaria</th><th>Costo vigente</th><th>Nuevo costo neto</th><th>Vigente desde</th><th>Vencimiento</th><th>Acción</th></tr></thead>
            <tbody>
              {productos.map((producto) => {
                const borrador = borradores[producto.productoId] || {};
                const sinCosto = producto.costoVigente === null;
                const estaGuardando = guardando === producto.productoId;
                const categoriaActual = borrador.categoria ?? producto.categoria ?? "SIN CLASIFICAR";
                const tieneCambio = categoriaActual !== (producto.categoria || "SIN CLASIFICAR") || numeroCosto(borrador.costo) !== null;
                return (
                  <tr key={producto.productoId} className={sinCosto ? "missing-cost" : ""}>
                    <td><strong>{producto.descripcion}</strong><span>{producto.proveedor || "Sin proveedor"}</span></td>
                    <td><code title={producto.codigo}>{codigoCorto(producto.codigo)}</code></td>
                    <td><input className="cost-manager-category-input" type="text" value={categoriaActual} onChange={(evento) => actualizarBorrador(producto, "categoria", evento.target.value)} disabled={Boolean(guardando) || importando} /></td>
                    <td><strong>{producto.precioVentaObservado === null ? "—" : moneda.format(producto.precioVentaObservado)}</strong><span>{producto.fechaObservacion ? `Observado ${fechaVisible(producto.fechaObservacion)}` : "Sin ventas observadas"}</span></td>
                    <td>{producto.comisionUnitariaObservada === null ? "—" : moneda.format(producto.comisionUnitariaObservada)}</td>
                    <td>{sinCosto ? <span className="cost-missing-badge"><AlertTriangle size={13} />Sin costo</span> : <><strong>{moneda.format(producto.costoVigente)}</strong><span>Desde {fechaVisible(producto.vigenteDesde)}</span><small>{producto.cantidadVigencias} vigencia(s)</small></>}</td>
                    <td><div className="cost-manager-money-input"><span>$</span><input type="text" inputMode="decimal" value={borrador.costo || ""} onChange={(evento) => actualizarBorrador(producto, "costo", evento.target.value)} placeholder={sinCosto ? "Costo requerido" : String(producto.costoVigente)} disabled={Boolean(guardando) || importando} /></div></td>
                    <td><input className="cost-manager-date-input" type="date" value={borrador.fecha || fechaChileActual()} onChange={(evento) => actualizarBorrador(producto, "fecha", evento.target.value)} disabled={Boolean(guardando) || importando} /></td>
                    <td><input className="cost-manager-date-input" type="date" value={borrador.vencimiento || ""} onChange={(evento) => actualizarBorrador(producto, "vencimiento", evento.target.value)} disabled={Boolean(guardando) || importando} /></td>
                    <td><button type="button" className="cost-manager-save" onClick={() => guardarProducto(producto)} disabled={Boolean(guardando) || importando || !tieneCambio}>{estaGuardando ? <span className="cost-manager-spinner" /> : <Save size={15} />}{estaGuardando ? "Guardando" : "Guardar"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cargando ? <div className="cost-manager-empty">Cargando productos vigentes…</div> : null}
          {!cargando && productos.length === 0 ? <div className="cost-manager-empty"><CheckCircle2 size={26} />No encontramos productos para esta búsqueda.</div> : null}
        </div>

        <footer className="cost-manager-footer"><span><FileSpreadsheet size={14} /> Precio y comisión: moda unitaria de la última fecha con ventas.</span><button type="button" className="secondary-button" onClick={onCerrar} disabled={Boolean(guardando) || importando}>Cerrar</button></footer>
      </section>
    </div>
  );
}
