# Cotizaciones + Comparativas — instalación

Web estática (GitHub Pages) + base de datos Supabase con login. No necesita build: se suben los archivos tal cual.

```
comparativas/
├── index.html      ← la página
├── app.js          ← lógica de pantallas
├── parsers.js      ← lectura de Excel / PDF y cálculos
├── config.js       ← ACÁ van la URL y la key de Supabase
├── schema.sql      ← se pega una vez en Supabase
└── lib/            ← librerías (Supabase, SheetJS, pdf.js) incluidas, sin CDN
```

## 1. Base de datos (5 minutos)

1. Entrá a Supabase → proyecto **Cotizador** (se puede usar el mismo; las tablas nuevas empiezan con `cc_` y no tocan las del cotizador).
2. **SQL Editor → New query** → pegá todo `schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: dejá Email habilitado y **desactivá "Allow new users to sign up"**. Esto es importante: si queda activado, cualquiera con la URL podría crearse un usuario y ver los datos.
4. **Authentication → Users → Add user → Create new user**: un usuario por persona (email + contraseña, marcá "Auto confirm user").
5. **Project Settings → API**: copiá **Project URL** y la key **anon public**.

## 2. Configuración

Abrí `config.js` y completá:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
NOMBRE_PROPIO: 'Meta',   // cómo figura nuestra droguería en las actas
```

La anon key es pública por diseño; lo que protege los datos es el login más las políticas de `schema.sql`.

## 3. Publicar en GitHub Pages

En el repo `mateobengolea/cotizador` creá una carpeta `comparativas/` y subí todo el contenido (incluida `lib/`). Queda en:

**https://mateobengolea.github.io/cotizador/comparativas/**

(Si preferís un repo aparte, también funciona igual.)

## 4. Primer uso

1. Ingresá con tu usuario.
2. **Importar / Ajustes →** arrastrá `Acumulado - Cotizaciones Directas 2026.xlsx`. Esto carga:
   - 62 procesos y 1.959 renglones de las hojas de meses.
   - Los adjudicados de las hojas `OC …`.
   - 439 resultados históricos de la hoja `COMPARATIVAS`.
   - Los costos iniciales de la hoja `VLOOKUP`.
   
   Si se vuelve a correr no duplica nada: los procesos que ya existen se saltean.
3. **Comparativas →** arrastrá el PDF del acta. Se lee directo, sin convertirlo antes, y se vincula sola con la cotización por número de expediente.
4. **Costos →** arrastrá el archivo de costos del día. Detecta solas las columnas CODIGO, COSTO, LISTA/LISTAPRE, PSL, PVP, DTOCPA, etc. Sirve `precios_combinado.csv`, el `PRECIOS.XLSX` crudo o la hoja VLOOKUP.

> Si `config.js` queda vacío, la página arranca en **modo demo**: los datos se guardan solo en ese navegador. Sirve para probar sin tocar la base.

## La Planilla (vista tipo Excel)

Es la pantalla principal. Tiene las mismas columnas que la hoja del Excel (R, CANT. ENV, LISTA, CODIGO… Costo META, R [%], Pcio. VENTA, Precio Total, Proceso, Apertura, OC) y pestañas abajo por mes, más *Todas*, *Adjudicados* y una por cada OC.

- Se usa como Excel: flechas, escribir para reemplazar, F2 o doble click para editar, Enter/Tab, Ctrl+C / Ctrl+V desde y hacia Excel, Supr, Ctrl+Z, selección de rangos con suma y promedio abajo, filtro por columna, click en el título para ordenar, ancho de columnas arrastrando.
- Las columnas celestes son fórmulas: la barra fx muestra la fórmula. Las amarillas son "en vivo": costo de hoy, control IGUAL/ACTUALIZAR, posición en el acta, mejor competidor, último ganador histórico y margen para ganar.
- Al escribir un CODIGO se completan solos los datos desde Costos, igual que el BUSCARX del Excel.
- **Hojas nuevas**: el botón ＋ a la izquierda de las pestañas crea una hoja y propone el mes siguiente (ej. NOVIEMBRE 2026). Doble click en una pestaña la renombra; con click derecho se renombra, se inserta otra o se elimina (solo si está vacía).
- La última fila (＋) sirve para agregar renglones: toma el Proceso de la fila de arriba, o el que escribas. Si el proceso no existe, se crea.
- Cambiar el Proceso de una fila la mueve a ese proceso.
- Click derecho en una fila: historial, abrir cotización o acta, duplicar, eliminar.

Las comparativas también se ven como planilla: el acta con precio y marca de cada proveedor, el mejor de cada renglón en verde y el nuestro en negrita.

## Cómo calcula

- **Costo META** = PSL × (1 − dcto. acordado s/PSL) si hay dcto. acordado; si no, COSTO de lista (igual que el Excel).
- **Margen** = 1 − costo / precio (la columna R [%] del Excel).
- **Mejor competidor** = la oferta válida más baja que no es nuestra. En el histórico del Excel se usa la que figura como ganadora.
- **Margen p/ganar** = 1 − costo vigente / precio unitario del mejor competidor. Usa el resultado del mismo proceso si ya está el acta; si no, el último antecedente del mismo código.
- Si el costo de lista difiere más de 30 % del cotizado, se asume que hubo un costo especial negociado. Ese costo se marca con ⚠ y no se usa en los cálculos ni en "Actualizar costos".
