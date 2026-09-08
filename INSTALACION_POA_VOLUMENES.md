# POA Volúmenes

## Activación

1. Abrir Supabase > SQL Editor.
2. Ejecutar completo `supabase/poa_volumenes.sql` una sola vez.
3. Publicar esta versión de VALEPAC Connect en Vercel.
4. Ingresar al menú **POA Volúmenes**.
5. Elegir un mes y presionar **Sincronizar mes** para completar la historia.

No se requieren variables nuevas en Vercel. El módulo reutiliza las credenciales
de CopecFuel, EnRuta y Supabase que ya utiliza VALEPAC Connect.

## Fuentes

- CopecFuel: ventas de surtidor y medio de pago.
- EnRuta: entregas cerradas/entregadas de tipo TAE y Concesionario.

## Reglas iniciales

- Venta Propia Isla: débito, crédito, App Copec, efectivo/dinero, crédito
  documentado y Rutpay/Billetera Banco Estado.
- Cuenta Empresa: APP COPEC EMPRESA / Muevo Empresa.
- Cupón: CUPON ELECTRONICO.
- FF.AA.: TARJETA FFAA.
- TCT: TCT y TCT MANUAL.
- STORAGE, movimientos de bodega, calibraciones y ventas cero quedan excluidos.
- Gasolina 95 se reparte 50% a G93 y 50% a G97; por lo tanto, su volumen total
  se conserva sin duplicarse.
