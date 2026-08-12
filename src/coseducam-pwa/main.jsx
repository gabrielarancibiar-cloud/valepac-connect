import React from "react";
import ReactDOM from "react-dom/client";
import AdminGate from "../components/AdminGate.jsx";
import CoseducamPwa from "./CoseducamPwa.jsx";
import "../styles.css";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/coseducam-pwa/sw.js", { scope: "/coseducam-pwa/" })
      .catch(() => null);
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AdminGate
      nombreAplicacion="VALEPAC Coseducam"
      subtituloAplicacion="Acceso operativo"
      descripcionLogin="Ingresa con tu cuenta autorizada."
    >
      {({ administrador, cerrarSesion, procesando }) => (
        <CoseducamPwa
          administrador={administrador}
          onCerrarSesion={cerrarSesion}
          cerrandoSesion={procesando}
        />
      )}
    </AdminGate>
  </React.StrictMode>
);
