# Drive Uploader

Aplicación web que envía varios archivos a una carpeta específica de Google Drive
en una sola operación, sin navegar por la interfaz de Drive: eliges el destino una
vez, arrastras todo y se va de un jalón.

**Aplicación en línea:** https://juqntx.github.io/Entregable-03-PyDA/

---

## Qué hace

1. **Elige el destino.** Escribes el nombre de una carpeta y la aplicación la busca
   en tu Drive. Si no existe, la crea al momento de enviar. También puedes indicar
   la carpeta por su identificador.
2. **Suelta los archivos.** Arrastras varios a la vez o los seleccionas desde tu
   equipo. Se acumulan en una cola que puedes revisar y depurar antes de enviar.
3. **Envía todo de una vez.** Cada archivo muestra su propio avance como fondo de
   la fila, además de una barra del progreso total.
4. **Revisa el resultado.** Una tabla consulta la carpeta destino y muestra lo que
   Drive reporta —nombre, tipo, tamaño y fecha de modificación— para confirmar que
   los archivos llegaron sin salir de la aplicación.

## Tecnologías

| Componente | Función en el proyecto |
|---|---|
| HTML5 | Estructura de la interfaz y API de arrastrar y soltar |
| CSS3 | Identidad visual, variables de color y consultas de medios |
| JavaScript (ES6+) | Cola de archivos, `async/await`, `fetch` y `XMLHttpRequest` |
| Bootstrap 5.3 | Rejilla responsiva, botones, campos, barra de progreso y tabla |
| Google Identity Services | Autorización mediante OAuth 2.0 |
| Google Drive API v3 | Servicio RESTful de terceros |

Bootstrap y las tipografías se cargan desde CDN. No hay dependencias que instalar
ni proceso de compilación: son tres archivos estáticos.

## Endpoints consumidos

| Operación | Método y ruta |
|---|---|
| Buscar la carpeta destino | `GET /drive/v3/files?q=...` |
| Crear la carpeta si no existe | `POST /drive/v3/files` |
| Subir cada archivo | `POST /upload/drive/v3/files?uploadType=multipart` |
| Listar el contenido de la carpeta | `GET /drive/v3/files?q='ID' in parents` |

## Permisos

La aplicación solicita únicamente el alcance `drive.file`, que limita el acceso a
los archivos que ella misma crea. No puede leer ni modificar el resto del Drive
del usuario.

Como consecuencia, el listado muestra los archivos enviados desde esta aplicación,
no los que ya estuvieran en la carpeta desde antes. Es el comportamiento esperado
del permiso, no una falla.

## Configuración

El identificador de cliente se define al inicio de `app.js`:

```javascript
const CONFIG = {
  CLIENT_ID: '',
  ...
};
```

Mientras esté vacío, la aplicación arranca en **modo demostración**: la interfaz
funciona completa, los envíos se simulan y el listado muestra datos de ejemplo.
Sirve para revisar el diseño sin configurar nada.

Para conectarla a Drive:

1. Crea un proyecto en Google Cloud Console.
2. Habilita la **Google Drive API** en la biblioteca de APIs.
3. Configura la pantalla de consentimiento como *Externa*, agrega el alcance
   `.../auth/drive.file` y registra tu cuenta como usuario de prueba.
4. Crea una credencial de tipo **ID de cliente de OAuth → Aplicación web**.
5. En *Orígenes autorizados de JavaScript* registra el origen desde el que servirás
   la página. El origen es protocolo y dominio, sin la ruta del repositorio.
6. Copia el identificador en `CONFIG.CLIENT_ID`.

## Ejecución local

OAuth rechaza los orígenes `file://`, así que la página debe servirse por HTTP:

```bash
python3 -m http.server 8000
```

Luego abre `http://localhost:8000`. Ese mismo origen debe estar registrado en la
credencial.

## Estructura

```
├── index.html    Estructura de la interfaz
├── estilos.css   Estilos propios, complementarios a Bootstrap
└── app.js        Autorización, cola de archivos y consumo de la API
```

## Contexto

Proyecto desarrollado para la asignatura de Programación y Diseño de Aplicaciones
de la Escuela Bancaria y Comercial.
