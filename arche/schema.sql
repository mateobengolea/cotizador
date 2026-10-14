-- =====================================================================
--  Arche Salud — pedidos (Meta)
--  Pegar TODO este archivo en Supabase → SQL Editor → Run.
--  Tablas con prefijo ah_ para no mezclarse con las del cotizador (kv_store)
--  ni con las de comparativas (cc_). Se puede volver a correr sin romper nada.
-- =====================================================================

-- ---------- Pedidos (una fila por pedido, como la hoja "Planilla") ----------
create table if not exists ah_pedidos (
  id          bigint generated always as identity primary key,
  numero      integer unique,            -- N° Pedido
  fecha       date,
  afiliado    text not null,
  iniciales   text,
  receta      text,                      -- ej. ARCHE-KC-OCTUBRE
  producto    text,                      -- presentación
  codigo      text,                      -- código del producto en el cotizador
  despachado  text,                      -- Si / Si OCA / No / vacío
  entrega     text,                      -- Retira x Arce / Domicilio
  plan        text,                      -- ej. Plan Novo
  aut         text,                      -- ej. Receta Solidaria
  costo       numeric,                   -- foto al momento de cargar el pedido
  pvp         numeric,
  precio      numeric,                   -- precio al que se saca (PVP × factor)
  obs         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists ah_pedidos_fecha_idx    on ah_pedidos(fecha);
create index if not exists ah_pedidos_afiliado_idx on ah_pedidos(afiliado);

-- ---------- Configuración (factor de precio, lista de costo, etc.) ----------
create table if not exists ah_config (
  clave text primary key,
  valor jsonb
);

-- ---------- updated_at automático ----------
create or replace function ah_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists ah_ped_touch on ah_pedidos;
create trigger ah_ped_touch before update on ah_pedidos for each row execute function ah_touch();

-- ---------- Seguridad: solo usuarios logueados (los mismos de Comparativas) ----------
do $$
declare t text;
begin
  foreach t in array array['ah_pedidos','ah_config']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_auth', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t||'_auth', t);
  end loop;
end $$;
