# Arche Salud — instalación

Web estática (GitHub Pages) que usa el mismo Supabase que el cotizador y Comparativas. Se suben los archivos tal cual, sin pasos de compilación.

```
arche/
├── index.html   ← la página
├── app.js       ← la lógica
├── config.js    ← URL y key de Supabase (ya completos, son los mismos de Comparativas)
├── schema.sql   ← se pega una vez en Supabase
└── lib/         ← Supabase y SheetJS incluidos
```

## 1. Base de datos (2 minutos)

Supabase → proyecto **Cotizador** → **SQL Editor → New query** → pegá todo `schema.sql` → **Run**.
Crea 2 tablas nuevas (`ah_pedidos`, `ah_config`). No toca las del cotizador ni las de Comparativas.

## 2. Publicar

En el repo `mateobengolea/cotizador` → **Add file → Upload files** → arrastrá la carpeta `arche` entera (incluida `lib/`) → **Commit**.
Queda en: **https://mateobengolea.github.io/cotizador/arche/**

## 3. Primer uso

1. Entrá con el mismo usuario de Comparativas. Si ya estás logueado ahí, entra directo.
2. **Importar / Ajustes →** arrastrá `Acumulado_Arche_Salud.xlsx`. Carga todos los pedidos de la hoja Planilla. Si lo volvés a correr, no duplica nada (saltea los N° de pedido que ya están cargados).

## Cómo funciona

- **Nuevo pedido**: escribís el nombre (sugiere afiliados existentes) y tocás la presentación. Se completan solos estos campos: N° de pedido, fecha, iniciales (con la misma regla del Excel: LC, LC2…), receta `ARCHE-XX-MES`, plan y AUT. La forma de entrega se elige cada vez; si la persona ya tiene pedidos, aparece un botón "Usar como el último" que la completa solo si lo tocás. Enter guarda.
- **Precio a sacar** = PVP × 0,93. El PVP y el costo salen de la **Base de marcas del cotizador**, así que se actualizan solos cada vez que subís `precios_combinado.csv`. El factor (0,93) y la lista de costo (CLINIC/SAN por defecto) se cambian en Ajustes.
- Cada pedido guarda el precio, el PVP y el costo del día en que se cargó.
- **Planilla**: todos los pedidos con filtro por mes, búsqueda y "solo sin despachar". El despachado se cambia directo en la tabla y el resto con **Editar**.
- **Resumen**: consumos por persona y por mes. Si hacés click en una persona, ves su historial.
- **Precios**: todas las presentaciones habituales con costo, PVP, precio a sacar y margen. También se puede buscar cualquier otra del catálogo y marcarla como habitual.
- **Exportar a Excel**: Planilla (mismas columnas que el Excel, sin dirección, + precio) y Resumen.

> Para probar sin tocar la base: `…/arche/?demo=1` (los datos quedan solo en ese navegador).
