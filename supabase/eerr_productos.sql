-- EE.RR. mensual de productos no combustibles.
-- Ejecutar una sola vez en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.productos_catalogo (
  producto_id text primary key,
  descripcion text not null,
  categoria text not null default 'SIN CLASIFICAR',
  proveedor text,
  activo boolean not null default true,
  primera_venta date,
  ultima_venta date,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.productos_costos (
  id uuid primary key default gen_random_uuid(),
  producto_id text not null references public.productos_catalogo(producto_id),
  costo_neto numeric(15, 4) not null check (costo_neto >= 0),
  vigente_desde date not null,
  vigente_hasta date,
  proveedor text,
  observacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint productos_costos_rango_valido
    check (vigente_hasta is null or vigente_hasta >= vigente_desde),
  constraint productos_costos_producto_vigencia_unica
    unique (producto_id, vigente_desde)
);

create table if not exists public.productos_ventas (
  identificador_origen text primary key,
  fecha date not null,
  turno_id text not null,
  transaccion_id text,
  transaccion_codigo text,
  producto_id text not null references public.productos_catalogo(producto_id),
  descripcion text not null,
  cantidad numeric(15, 4) not null default 0,
  precio_venta numeric(15, 4) not null default 0,
  venta_bruta numeric(15, 4) not null default 0,
  venta_neta numeric(15, 4),
  forma_pago text,
  codigo_eds text,
  datos_origen jsonb,
  sincronizado_en timestamptz not null default now(),
  creado_en timestamptz not null default now()
);

create table if not exists public.productos_ajustes_mensuales (
  periodo text primary key,
  royalty numeric(15, 4) not null default 0 check (royalty >= 0),
  notas_credito numeric(15, 4) not null default 0 check (notas_credito >= 0),
  observacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint productos_ajustes_periodo_valido
    check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

create index if not exists idx_productos_ventas_fecha
  on public.productos_ventas(fecha);

create index if not exists idx_productos_ventas_producto_fecha
  on public.productos_ventas(producto_id, fecha);

create index if not exists idx_productos_costos_producto_vigencia
  on public.productos_costos(producto_id, vigente_desde desc);

alter table public.productos_catalogo enable row level security;
alter table public.productos_costos enable row level security;
alter table public.productos_ventas enable row level security;
alter table public.productos_ajustes_mensuales enable row level security;

comment on table public.productos_catalogo is
  'Catalogo observado desde la API oficial VENTA_PRODUCTO.';

comment on table public.productos_costos is
  'Historial de costos netos unitarios. Cada cambio crea una nueva vigencia.';

comment on table public.productos_ventas is
  'Lineas diarias de productos no combustibles obtenidas desde CopecFuel.';

comment on table public.productos_ajustes_mensuales is
  'Royalty y notas de credito aplicados solo al resultado general mensual.';

insert into public.productos_catalogo
  (producto_id, descripcion, categoria, proveedor, activo, actualizado_en)
values
  ('6871ec73fafe1412cbcd73bfea032ded5a8', 'AGUA DESMINERALIZADA 5 LTS', 'AGUAS', 'COPEC', true, now()),
  ('da66942a493398b14f06e4b7a3b1d722fc0', 'AGUA VERDE 1 LTS', 'AGUAS', 'COPEC', true, now()),
  ('64305c6ab3c95c42dea44966ab47fda929b', 'AGUA VERDE 5 LTS', 'AGUAS', 'COPEC', true, now()),
  ('81d9a28bcbf54c5ed6006e11fb317d1bac3', 'BIDON GASOLINA 20 LT', 'BIDONES', 'COPEC', true, now()),
  ('7f3ae8f2f197136e16d4a7f86ccc72f628c', 'BLUE MAX 10 LTS', 'BLUEMAX', 'COPEC', true, now()),
  ('5c258aff0e9a5cc587f0ec2d72260f8ebd4', 'COOLANT COPEC, 5L', 'AGUAS', 'COPEC', true, now()),
  ('073897f92c635dfc0278947fddb4788c91d', 'LAVAPARABRISAS COPEC', 'AGUAS', 'COPEC', true, now()),
  ('c3c7d01c5aaa9701bb22a4562aba429b9b4', 'LAVAPARABRISAS, 5LT', 'AGUAS', 'COPEC', true, now()),
  ('8b2284c34611d1abeb4f1afec226d55e9ce', 'MOB. SUP. 2000 FORM. P X1 10W40, 1L', 'LUBRICANTES', 'COPEC', true, now()),
  ('20e7275504753822fad513bcf3855881072', 'MOBIL BRAKE FLUID DO', 'LUBRICANTES', 'COPEC', true, now())
on conflict (producto_id) do update set
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  proveedor = excluded.proveedor,
  activo = excluded.activo,
  actualizado_en = now();

insert into public.productos_costos
  (producto_id, costo_neto, vigente_desde, proveedor, observacion, actualizado_en)
values
  ('6871ec73fafe1412cbcd73bfea032ded5a8', 3033.75, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('da66942a493398b14f06e4b7a3b1d722fc0', 1022.00, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('64305c6ab3c95c42dea44966ab47fda929b', 3208.25, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('81d9a28bcbf54c5ed6006e11fb317d1bac3', 9026.05, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('7f3ae8f2f197136e16d4a7f86ccc72f628c', 10560.00, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('5c258aff0e9a5cc587f0ec2d72260f8ebd4', 5074.75, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('073897f92c635dfc0278947fddb4788c91d', 1086.25, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('c3c7d01c5aaa9701bb22a4562aba429b9b4', 3416.00, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('8b2284c34611d1abeb4f1afec226d55e9ce', 6913.17, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now()),
  ('20e7275504753822fad513bcf3855881072', 2347.29, '2026-08-01', 'COPEC', 'Carga inicial catalogo_productos_costos_preliminar.xlsx', now())
on conflict (producto_id, vigente_desde) do update set
  costo_neto = excluded.costo_neto,
  proveedor = excluded.proveedor,
  observacion = excluded.observacion,
  actualizado_en = now();
