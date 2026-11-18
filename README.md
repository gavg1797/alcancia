# Alcancía · finanzas personales

Alcancía lee tus estados de cuenta del banco, te deja anotar los gastos en efectivo y te muestra en gráficos en qué se va tu dinero. Todo el histórico se guarda en una hoja de cálculo de **tu Google Drive** y se puede descargar en Excel.

**Abrir la app:** https://gavg1797.github.io/alcancia/

## Funciones

- **Estados de cuenta:** sube el PDF, Excel (.xlsx, .xls) o CSV del BCR, Coopenae u otro banco. La app encuentra cada movimiento, separa débitos y créditos y te los muestra para revisar antes de guardar. Los que ya estaban guardados vienen desmarcados para no duplicarlos. Si el PDF tiene contraseña, la pide.
- **Clasificación:** cada movimiento queda como ingreso, gasto, ahorro o inversión, con una categoría (supermercado, servicios, transporte…). Si corriges una categoría, la app lo recuerda para la próxima vez.
- **Efectivo:** el botón **+** agrega un movimiento a mano en segundos.
- **Automáticos:** salario, alquiler, ahorro programado o aportes a una inversión se agregan solos cada semana, quincena, mes o año.
- **Resumen:** ingresos, gastos, ahorros, inversiones y disponible del periodo, con el porcentaje del ingreso que representa cada uno.
- **Gráficos:** circular con el porcentaje de cada categoría de gasto (o cuánto del ingreso se va en gasto, ahorro e inversión) y de barras con lo gastado, ahorrado e invertido por día, mes o año.
- **Colones y dólares:** cada movimiento guarda su moneda; los totales se ven en la que elijas con el tipo de cambio de Ajustes.
- **Histórico en Excel:** Ajustes → *Descargar histórico en Excel* (movimientos, resumen mensual, gastos por categoría y automáticos).

## Dónde se guardan los datos

- **Solo en tu Google Drive**, en la hoja **«Alcancía - finanzas»**, con tres pestañas: `Movimientos`, `Automaticos` y `Ajustes`. Puedes abrirla y editarla en Google Sheets; los cambios aparecen en la app al sincronizar. Para agregar una fila a mano, deja la columna `id` vacía.
- **En vivo:** cada movimiento se guarda en la hoja al instante, y los demás dispositivos conectados a la misma cuenta lo reciben en unos segundos (también los cambios que hagas a mano en Google Sheets). Si dos personas guardan a la vez, la app comprueba la hoja y conserva lo de ambas.
- La app pide **iniciar sesión con Google** para mostrar tus datos y los descarga de tu hoja al entrar. Mientras la sesión está abierta, guarda una copia de trabajo en el navegador para ir rápido.
- **Cerrar sesión** (arriba a la derecha o en Ajustes) guarda los cambios en Google Sheets y **borra todo del dispositivo**. Si no se pudieron guardar (sin internet), avisa antes.
- **Cada cuenta ve solo su información:** si en el mismo navegador entra otra cuenta, lo que quedara de la anterior se borra.
- Arriba se muestra **«Sesión iniciada con tu@correo»**.
- Los estados de cuenta se leen dentro de tu dispositivo. La app no tiene servidor propio: los datos van directo de tu navegador a Google.
- Este repositorio es público, pero solo contiene el código. Nunca contiene tus movimientos.

## Conectar con Google Sheets

Alcancía usa el mismo proyecto de Google Cloud e ID de cliente que [Atril](https://github.com/gavg1797/atril), así que solo falta un paso:

1. Entra a https://console.cloud.google.com/apis/library/sheets.googleapis.com con el proyecto de Atril seleccionado y toca **Habilitar** (Google Sheets API). No cuesta nada.
2. Abre la app y toca **Conectar con Google**. Acepta el permiso de Drive.

**Permiso que pide:** `drive.file`. La app solo puede ver la hoja que ella misma crea, no el resto de tu Drive.

Para usar otro proyecto de Google, sigue la guía «Configurar Google Drive gratis» del README de Atril, habilita además la Google Sheets API y pega el ID de cliente en `config.js`.

## Límites conocidos

- El lector de estados es genérico: busca la fecha, la descripción y las columnas de débitos, créditos y saldo. Revisa siempre la vista previa; si los débitos y créditos salen al revés, usa **Invertir débitos ↔ créditos**.
- Un PDF escaneado (una foto sin texto) no se puede leer. En ese caso descarga el estado en Excel o CSV.
- El tipo de cambio es fijo y se edita en Ajustes; no se actualiza solo.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Página y estilos |
| `core.js` | Lectura de estados, categorías, automáticos y totales |
| `app.js` | Pantallas, gráficos y sincronización con Google Sheets |
| `config.js` | ID de cliente de Google y nombre de la hoja |
| `sw.js` | Permite abrir la app sin conexión |
| `lib/` | Lector de PDF (pdf.js 4.10.38) y de Excel (SheetJS 0.20.3), alojados aquí mismo para no depender de servidores externos |
