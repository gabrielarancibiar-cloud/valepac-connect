-- Volumenes mensuales para proyeccion anual de ventas (POA).
-- Ejecutar una sola vez en Supabase > SQL Editor.

create table if not exists public.poa_volumenes_diarios (
  identificador_origen text primary key,
  fecha date not null,
  codigo_eds text,
  fuente text not null check (fuente in ('COPECFUEL', 'ENRUTA')),
  combustible text not null check (combustible in ('DSL', 'G93', 'G97')),
  canal text not null check (
    canal in (
      'VENTA_PROPIA_ISLA',
      'VENTA_PROPIA_CAMION',
      'CUPON',
      'FFAA',
      'CUENTA_EMPRESA',
      'TCT',
      'TAE'
    )
  ),
  litros numeric(18, 3) not null default 0 check (litros >= 0),
  transacciones integer not null default 0 check (transacciones >= 0),
  datos_origen jsonb,
  sincronizado_en timestamptz not null default now(),
  creado_en timestamptz not null default now()
);

create index if not exists idx_poa_volumenes_fecha
  on public.poa_volumenes_diarios(fecha);

create index if not exists idx_poa_volumenes_eds_fecha
  on public.poa_volumenes_diarios(codigo_eds, fecha);

create index if not exists idx_poa_volumenes_clasificacion
  on public.poa_volumenes_diarios(combustible, canal, fecha);

alter table public.poa_volumenes_diarios enable row level security;

comment on table public.poa_volumenes_diarios is
  'Volumen diario agregado para POA. CopecFuel aporta ventas de isla y EnRuta aporta TAE y camion de reparto.';

comment on column public.poa_volumenes_diarios.litros is
  'Litros exactos con tres decimales. Gasolina 95 se distribuye 50% en G93 y 50% en G97.';
