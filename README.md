# Registro de gastos

Aplicación web para registrar ingresos, gastos, pagos hechos y próximos pagos, con totales por mes, previsión del mes siguiente y resumen de todo el año. Tiene cuentas de usuario y libros que se pueden compartir con otras personas.

## Cómo arrancarla

```
npm install
npm start
```

Después abre <http://localhost:3000> y crea tu cuenta.

## Base de datos

La conexión se configura en el archivo `.env` (copia `.env.example` como `.env`). Ese archivo no se sube a GitHub.

- **Con MongoDB Atlas o propio:** rellena `MONGODB_USER`, `MONGODB_PASSWORD`, `MONGODB_HOST` (por ejemplo `cluster0.abcde.mongodb.net`) y `MONGODB_DB`. La contraseña se escribe tal cual, aunque tenga símbolos. También vale la cadena completa en `MONGODB_URI`.
- **En Atlas** hay que crear el usuario en *Database Access* y permitir tu IP en *Network Access*.
- **Sin configurar nada:** si esos datos están vacíos, la app arranca un MongoDB local y guarda los datos en `data/mongo`. Sirve para uso personal en este equipo; para que otras personas entren desde internet conviene usar Atlas.

## Cómo se usa

- **Libros:** cada cuenta empieza con un libro «Personal». Puedes crear más («Casa», «Viaje»…), cada uno con su moneda.
- **Moneda:** el selector de la cabecera cambia la moneda del libro (soles por defecto, dólares o cualquier otra). Solo cambia el símbolo; no convierte los montos.
- **Admin:** la primera cuenta registrada (o las de `ADMIN_EMAILS`) ve una pestaña «Admin» con el espacio usado y libre en MongoDB y la lista de usuarios. Desde ahí puede crear cuentas y eliminarlas (al eliminar una cuenta se borran también sus libros y movimientos).
- **Menú:** el botón de las tres rayas abre el menú con las secciones (Mes, Año, Compartir, Admin), el libro, la moneda y la sesión.
- **Mes:** ingresos, gastos, balance y lo que falta por pagar, la previsión del mes siguiente y tres secciones: Calendario, Pendientes (vencidos y próximos 30 días) y Movimientos.
- **Calendario:** un punto rojo marca los días con pagos sin hacer y uno gris los días con movimientos ya pagados o ingresos. Al tocar un día se ven sus movimientos y se puede añadir uno en esa fecha.
- **Movimientos:** tocar un movimiento lo abre para editarlo o eliminarlo; el botón de al lado lo marca como pagado o cobrado.
- **Repetir cada mes:** al crear un gasto o ingreso fijo (alquiler, salario…) elige durante cuántos meses se repite; así aparece en los meses futuros y en el total del año.
- **Año:** totales anuales, gráfica mes a mes y reparto por categorías.
- **Compartir:** el propietario de un libro invita a otra persona por su correo (debe estar registrada) con acceso de «solo ver» o «puede editar».

## Publicarla en Render

1. Sube el proyecto a GitHub.
2. En Render: **New + → Blueprint**, elige el repositorio. Render lee `render.yaml` y pide tres datos: `MONGODB_USER`, `MONGODB_PASSWORD` y `MONGODB_HOST` (los mismos de tu `.env`).
3. En MongoDB Atlas, **Network Access → Add IP Address**: añade las IP de salida de tu servicio (en Render: *Connect → Outbound*) o `0.0.0.0/0` para permitir cualquiera.

Con el plan gratuito el servicio se duerme tras 15 minutos sin visitas y la primera carga después tarda cerca de un minuto.

## Instalarla como app

La interfaz es una PWA: se puede instalar en el ordenador o en el móvil y se abre en su propia ventana, con el icono de N.F.T.A Corp.

- **Ordenador (Chrome o Edge):** botón «Instalar app» de la cabecera, o el icono de instalar en la barra de direcciones.
- **Android:** menú del navegador → «Instalar aplicación».
- **iPhone/iPad (Safari):** Compartir → «Añadir a pantalla de inicio».

Los navegadores solo permiten instalar desde `http://localhost` o desde una dirección **https**. Para instalarla en el móvil hay que publicar la app en un servidor con https.

Al cambiar archivos de `public/`, sube el número de versión de `CACHE` en `public/sw.js` para que los dispositivos descarguen la versión nueva.

## Estructura

- `server/` — API con Express y Mongoose (`auth.js` cuentas y sesión, `routes.js` libros, movimientos y resumen, `models.js` esquemas).
- `public/` — interfaz web sin paso de compilación (`index.html`, `app.js`, `styles.css`), más `manifest.webmanifest`, `sw.js` e `icons/` para la instalación.
- `imag/` — logo original del que salen los iconos.
