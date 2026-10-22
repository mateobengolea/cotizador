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
   
   Si se vuelve a correr no duplica nada: los procesos que ya existen se saltean.
3. **Comparativas →** arrastrá el PDF del acta. Se lee directo, sin convertirlo antes, y se vincula sola con la cotización por número de expediente.
4. **Costos**: se toman **solos del cotizador** (los precios por lista que se suben ahí cada día con `precios_combinado.csv`, más marca, laboratorio, PVP y stock de la Base de marcas). Se leen al abrir la página, con ⟳ o con *Releer del cotizador* en la pestaña Costos. No hay carga manual.

> Si `config.js` queda vacío, la página arranca en **modo demo**: los datos se guardan solo en ese navegador. Sirve para probar sin tocar la base.

## Importar un pedido de cotización (PDF de Bionexo)

En **Planilla** o **Cotizaciones**, tocá **Importar PDF**. También podés arrastrar el PDF sobre la planilla.

1. Se leen solos el expediente (por ejemplo, E247546 → EXPTE 247546), la apertura, la condición de pago, el mantenimiento de oferta y todos los renglones con código del cliente (MED…), cantidad, unidad y marcas.
   Sirven los **dos formatos** de Bionexo: el pedido clásico a dos columnas ("Marcas preferidas") y el nuevo **"Reporte de cotización"** (Artículo / Marca Solicitada / Cant. solicitada / Embalaje). En el nuevo, la apertura es el *Vencimiento* y el expediente sale del título; no trae forma de pago, así que la Condición queda para completar.
2. Para cada renglón la web propone el producto, en este orden:
   - **ya cotizado**: el mismo código MED o la misma descripción que ya cotizaste antes. Es la sugerencia más segura.
   - **historial**: un producto de la misma droga y concentración que ya cotizaste.
   - **costos**: un producto de la lista de costos.
3. Revisás, cambiás lo que haga falta con el desplegable y destildás lo que no vas a cotizar. Si el producto no está entre las sugerencias (o dice *sin producto*), tocá **🔍** (o *Buscar otro producto…* en el desplegable) y buscalo por código, nombre, droga o laboratorio en todo el catálogo del cotizador.
4. Elegís la **Lista de costos** (ISSN_NQN por defecto): los costos salen solo de esa lista. Si un producto no está en ella, se marca "no está en …" y queda sin costo.
5. **Crear cotización** arma la hoja con el costo de hoy y el último margen usado para cada producto, o el margen objetivo.

Lo que elegís queda aprendido: el pedido del mes siguiente reconoce los mismos códigos MED y propone los mismos productos.

## Cargar una orden de compra (PDF del ISSN)

Con **Importar PDF** (o arrastrando el PDF a la planilla) se detecta solo si es pedido, acta u OC.

1. Se leen el número de OC (ej. 172 - 11046), la fecha, el expediente, la condición, el vencimiento, el total y cada renglón (código MED, cantidad, precio e importe).
2. Se busca la cotización del expediente y se empareja cada renglón con el nuestro, por código MED, precio y producto. El control muestra **precio OK** o la diferencia contra lo cotizado.
3. **Cargar OC**:
   - Marca esos renglones como adjudicados (Adj. = Sí, OC = 11046).
   - Opcionalmente marca el resto como No adjudicados.
   - Pone la cotización como *adjudicada* o *parcial*.
   - Crea la pestaña **OC 11046** con los renglones y las cantidades de la orden, como las hojas OC del Excel.

Si en la pestaña de una OC cambiás la CANT. ENV, se cambia la cantidad de la orden, no la cotizada. Para borrar una orden entera, usá el botón **Eliminar OC** de su pestaña.

## La Planilla (vista tipo Excel)

Es la pantalla principal. Tiene las mismas columnas que la hoja del Excel (R, CANT. ENV, LISTA, CODIGO… Costo META, R [%], Pcio. VENTA, Precio Total, Proceso, Apertura, OC) y pestañas abajo por mes, más *Todas*, *Adjudicados* y una por cada OC.

- Se usa como Excel: flechas, escribir para reemplazar, F2 o doble click para editar, Enter/Tab, Ctrl+C / Ctrl+V desde y hacia Excel, Supr, Ctrl+Z, selección de rangos con suma y promedio abajo, filtro por columna, click en el título para ordenar, ancho de columnas arrastrando.
- Las columnas celestes son fórmulas: la barra fx muestra la fórmula. Las amarillas son "en vivo": costo de hoy, control IGUAL/ACTUALIZAR, posición en el acta, mejor competidor, último ganador histórico y margen para ganar.
- **Lista de costos por cotización**: cada cotización tiene su lista (ISSN_NQN por defecto; se elige al crearla o importar el pedido y se cambia en su encabezado, con opción de pasar todos los renglones y recalcular). Los renglones nuevos toman esa lista. El costo se busca solo en la lista del renglón: si el producto no está, el control muestra **NO EN LISTA** y no se toma de otra. Cambiar la LISTA de un renglón actualiza su costo.
- Al escribir un CODIGO se completan solos los datos desde Costos (de la lista de la cotización), igual que el BUSCARX del Excel.
- **Hojas nuevas**: el botón ＋ a la izquierda de las pestañas crea una hoja y propone el mes siguiente (ej. NOVIEMBRE 2026). Doble click en una pestaña la renombra; con click derecho se renombra, se inserta otra o se elimina (solo si está vacía).
- La última fila (＋) sirve para agregar renglones: toma el Proceso de la fila de arriba, o el que escribas. Si el proceso no existe, se crea.
- Cambiar el Proceso de una fila la mueve a ese proceso.
- Click derecho en una fila: historial, abrir cotización o acta, duplicar, eliminar.
- **Ocultar filas y columnas**: click derecho en una fila → *Ocultar fila* (o Ctrl+9); click derecho en la letra o el título de una columna → *Ocultar columna* (o Ctrl+0). Shift+click en las letras selecciona varias. Donde hay ocultas aparece una línea verde: doble click ahí las vuelve a mostrar, o usá el link "mostrar" de la barra de abajo. Las filas y columnas ocultas se guardan y valen para todos.
- **Formato como en Excel**: la barra de arriba tiene negrita, cursiva, subrayado (Ctrl+B / Ctrl+I / Ctrl+U), color de relleno, color de fuente, bordes (inferior, superior, todos, externos, sin borde), alineación, copiar formato (🖌) y borrar formato. Se aplica a las celdas seleccionadas (click en el número de fila para seleccionar el renglón entero), queda guardado y lo ven todos. *Exportar a Excel* baja los datos sin los colores.

Las comparativas también se ven como planilla: el acta con precio y marca de cada proveedor, el mejor de cada renglón en verde y el nuestro en negrita. **Se pueden corregir a mano** precios, marcas, descripción y cantidad: el precio va como total del renglón (o NC si no cotizó), y se recalculan al instante posiciones, mejor competidor y márgenes. Ctrl+Z deshace.

## Cómo calcula

- **Costo META** = PSL × (1 − dcto. acordado s/PSL) si hay dcto. acordado; si no, COSTO de lista (igual que el Excel).
- **Margen** = 1 − costo / precio (la columna R [%] del Excel).
- **Mejor competidor** = la oferta válida más baja que no es nuestra. En el histórico del Excel se usa la que figura como ganadora.
- **Margen p/ganar** = 1 − costo vigente / precio unitario del mejor competidor. Usa el resultado del mismo proceso si ya está el acta; si no, el último antecedente del mismo código.
- Si el costo de lista difiere más de 30 % del cotizado, se asume que hubo un costo especial negociado. Ese costo se marca con ⚠ y no se usa en los cálculos ni en "Actualizar costos".
