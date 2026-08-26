begin;

alter table public.copec_facturas_cargos
  drop constraint if exists copec_facturas_categoria_valida;

update public.copec_facturas_cargos
set categoria = 'GASTOS_FIJOS',
    actualizado_en = now()
where categoria = 'COBROS_FIJOS';

alter table public.copec_facturas_cargos
  add constraint copec_facturas_categoria_valida check (
    categoria in (
      'COMBUSTIBLES',
      'UNIFORMES',
      'GASTOS_OPERACIONALES',
      'SERVICIOS_BASICOS',
      'SERVICIOS_OPERACION',
      'SUMINISTROS',
      'MANTENCIONES',
      'ROYALTY',
      'PRODUCTOS_NO_COMBUSTIBLES',
      'GASTOS_FIJOS',
      'ARRIENDO',
      'SEGUROS',
      'POR_REVISAR'
    )
  );

commit;
