---
name: diapo
description: Presentaciones HTML de un solo archivo que el usuario edita en el navegador como en Google Slides (arrastrar, escribir, cambiar imágenes, colores y tipografías) y que Claude edita como texto. Usar cuando pida armar, editar, importar o revisar slides, una charla, una clase o un deck con diapo, cuando mencione "diapo" o "pedidos", o cuando el archivo tenga <meta name="generator" content="diapo …">. También para convertir un .pptx de Google Slides o un .pdf a algo editable.
---

# diapo

Comando: `diapo`. Si no está en el PATH, el CLI es el archivo `diapo` que está dos carpetas más arriba de este skill: correlo con `python3 RUTA/diapo`. Cada presentación es un `.html` con carpetas `img/` y `fonts/` al lado; no hace falta internet para verla ni para editarla.

Las ecuaciones se escriben en LaTeX dentro del texto, `$…$` en línea y `$$…$$` en bloque, y se ven con KaTeX sin internet (carpeta `katex/` al lado del archivo). En el HTML queda la fuente: editar la fórmula es editar ese texto. Un `$` suelto seguido de un número (`$5`) no se toma como ecuación.

## Comandos

| Comando | Para qué |
|---|---|
| `diapo nuevo CARPETA --tema oscuro\|claro --titulo "…"` | Presentación nueva con slides de ejemplo. `oscuro` para charlas, `claro` para clases. |
| `diapo nuevo CARPETA --tema … --desde guion.md` | Presentación armada desde un guion en markdown: portada del tema más una slide por bloque. |
| `diapo agregar ARCHIVO.html --desde parte.md [--despues N]` | Suma las slides de un guion a una presentación existente (también importada), después de la slide N. |
| `diapo importar ARCHIVO.pptx [--salida DIR]` | Convierte PowerPoint o Google Slides (Archivo → Descargar → PowerPoint). Respeta posiciones, fuentes (las baja a `fonts/`), imágenes recortadas, notas y links. Pasa las imágenes a WebP (los GIF, a WebP animado) con nombres `sNN-k` por slide e informa cuánto pesaban. |
| `diapo importar ARCHIVO.pdf [--salida DIR] [--tema claro]` | Una imagen por página, con el texto de la página en las notas. El texto no queda editable: si existe el .pptx, importar ese. |
| `diapo ver ARCHIVO.html [--editar] [--modelo sonnet]` | Servidor local. Ctrl+S guarda en el archivo; cuando Claude lo cambia, la página se actualiza sin recargar y Ctrl+Z deshace ese cambio. Trae el panel de chat (tecla C). Lo corre el usuario (sugerirle `! diapo ver …`). |
| `diapo revisar ARCHIVO.html [--slides 3,5-7] [--json]` | Renderiza sin ventana. Lista textos fuera del lienzo, textos que se pisan, cajas desbordadas, imágenes rotas, tipografías que no cargaron, recuadros para completar y pedidos. Deja capturas y hojas de contacto en `.diapo/revision/`. |
| `diapo pedidos ARCHIVO.html [--json]` | Lista los pedidos que dejó con el botón «Pedido». |
| `diapo imagen ARCHIVO.html RUTA\|URL [--hueco N[:K]]` | Trae la imagen a `img/` (WebP, achicada) y reemplaza el recuadro K de la slide N ajustándola a su caja; los recuadros `circulo` o `cubrir` se llenan. Sin `--hueco`, solo la guarda e imprime la ruta. |
| `diapo qr ARCHIVO.html URL [--hueco N[:K]]` | QR en SVG (con `uv` y `segno`), en `img/` y opcionalmente en un recuadro. |
| `diapo config --nombre "…" --mail "…" [--modelo-chat sonnet]` | Lo que va en la portada de las presentaciones nuevas, y el modelo del chat (Opus si no se indica). |
| `diapo pdf ARCHIVO.html [-o salida.pdf]` | Una slide por página, con fondos. |
| `diapo pptx ARCHIVO.html [-o salida.pptx] [--imagenes]` | PowerPoint para subir a Google Slides. Textos editables con su tipografía, tamaño, color, links y viñetas; imágenes nativas (recortes y círculos incluidos); formas, líneas y notas. Lo que PowerPoint no representa va como imagen exacta: ecuaciones (el párrafo entero que las tiene), tablas, SVG y fondos con imagen. `--imagenes`: cada slide como imagen, idéntica pero no editable. |
| `diapo previa ARCHIVO.html` | Copia solo para mirar, en `.diapo/previa/`, más la lista de archivos que usa. Sirve para publicar un artifact. |
| `diapo actualizar ARCHIVO.html` | Reemplaza el motor embebido por el actual. Deja un respaldo. |
| `diapo temas` | Temas disponibles. |

## El archivo por dentro

- `<div id="deck" data-ancho="1280" data-alto="720">` contiene un `<section class="slide" data-titulo="…">` por slide, en orden. `data-titulo` es el nombre en la vista general.
- Todo lo movible es hijo directo de la slide, lleva la clase `el` y `style="left:…px;top:…px;width:…px"` en píxeles del lienzo. `height` solo en imágenes recortadas o cajas fijas. El orden en el HTML es el orden de apilado.
- Texto: `<div class="el cuerpo">` con la clase de un estilo del tema. Links: `<a class="el fuente" href="…" target="_blank" rel="noopener">[sitio]</a>`. Imágenes: `<img class="el" src="img/archivo.jpg" alt="">`. Además están `circulo` (recorte redondo), `cubrir` (recorte que llena la caja) y `sangrado` (se sale del lienzo a propósito).
- `<div class="el hueco" style="…;height:…px">Qué va acá</div>` es un recuadro punteado para pegar una captura. Queda en el lugar y con el tamaño que va a tener la imagen.
- Notas del orador: `<aside class="notas">` al final de la slide. Las leen los dos: es el lugar para el guion, las fuentes y los datos por verificar.
- `<style id="tema">`: colores y tipografías en variables (`--amarillo`, `--f-titulo`…). Usarlas con `var(--…)` en vez de colores sueltos.
- `<style id="estilos">`: estilos de texto. Los que tienen `/* estilo: Nombre */` aparecen en la barra; los que tienen `/* fondo: Nombre */ .slide.clase` son fondos de slide.
- `<style id="motor-css">` y `<script id="motor">` son el motor. No se editan a mano; se reemplazan con `diapo actualizar`.
- Pedidos: atributo `data-pedido="…"` en un elemento o en la slide.

## Guion en markdown (para contenido nuevo)

Para armar varias slides, escribir un guion y dejar que diapo calcule las posiciones: no escribir coordenadas a mano. Cada bloque separado por una línea `---` es una slide.

```markdown
# Título de la slide
Párrafo con **negrita**, *itálica*, `código`, [link](https://…) y $x^2$.

- viñeta
- viñeta

![descripción](ruta/o/https://imagen.png)
[imagen: qué va en este recuadro]
$$ E = mc^2 $$
> una cita
— autor
|||                       ← separa dos columnas
Fuentes: [Autor 2020](https://…), [Otro](https://…)
Notas: lo que dice el orador; puede seguir en varias líneas hasta el final del bloque.
```

- El layout sale del contenido: solo título (y `##` subtítulo) es una divisora; cita sin texto, `cita`; imagen con texto, `titulo-imagen-der`; imagen sola, `imagen-completa`; `|||`, `dos-columnas`; `$$`, `ecuacion`; lo demás, `titulo-texto`. Se fuerza con `<!-- layout: dos-columnas -->` y el fondo con `<!-- fondo: oscura -->`.
- Las clases salen de los estilos del deck, así que sirve para cualquier tema y para decks importados. Si un texto no entra, achica la letra hasta un 70 %; igual correr `diapo revisar` con las slides que imprime.
- Las imágenes locales o por URL se copian a `img/` en WebP; si no se pueden traer, quedan como recuadro.
- En `nuevo --desde`, un primer bloque con solo `#` y `##` completa la portada del tema.
- Después, los ajustes finos se hacen con Edit sobre el HTML, como siempre.

## Trabajar juntos

1. **Antes de escribir el archivo**, si el usuario lo tiene abierto, pedirle que guarde. Si guarda antes de que Claude escriba, su página se actualiza sola con los cambios, sin recargar, y Ctrl+Z los deshace. Si tenía cambios sin guardar, la página le avisa en vez de pisarlos. Al guardar le pregunta si reemplaza la versión de Claude, que igual queda en `.diapo/respaldos/` (se guardan las últimas 50, como mucho una por minuto al guardar, más una antes de cada pedido al chat).
2. **Pedidos**: correr `diapo pedidos ARCHIVO.html`, resolver cada uno y borrar su `data-pedido`. Si un pedido no se entiende o no se puede resolver, dejarlo y decirlo.
3. **Editar con Edit, no reescribir el archivo**. Cambios puntuales, sin reformatear lo demás ni tocar el motor. Para ubicar una slide, buscar su `data-titulo`.
4. **Imágenes**: `diapo imagen` para ponerlas en su recuadro; si se agregan a mano, van en `img/` con ruta relativa. Las de la web, con licencia libre y el origen en las notas. Si falta la imagen, dejar un `hueco` con la descripción de lo que va.
5. **Después de editar**: `diapo revisar ARCHIVO.html --slides N,M` y mirar las capturas (`.diapo/revision/slide-NN.png`) con Read. No dar por buena una slide sin mirarla.
6. **Contenido incremental**: armar la estructura y de a un bloque por vez con el usuario, en su tono. Para varias slides nuevas, guion y `diapo agregar`; para una sola parecida a otra, copiar su estructura.

## El panel de chat (tecla C, con `diapo ver`)

El usuario le pide cambios a Claude sin salir de la presentación. El servidor levanta Claude Code sin ventana (`claude -p`, entrada y salida stream-json, `--safe-mode`) con su cuenta, una conversación por presentación, y le pasa cada mensaje con el contexto: slide, título, líneas del archivo y elemento elegido.

- Corre en Opus salvo `--modelo` o `diapo config --modelo-chat`. Puede leer, buscar en la web (WebSearch, WebFetch), escribir solo en el `.html`, `img/` y `.diapo/` (reglas `Edit(./…)`), y correr `diapo revisar|pedidos|agregar|imagen|qr|pdf`. Otra escritura o comando lo frena el permiso.
- Recibe con cada mensaje el HTML de la slide que se está mirando. Para pedidos grandes escribe `.diapo/guion.md` y usa `diapo agregar`; los datos los verifica en la web y deja la fuente.
- Antes de mandar, la página guarda; antes de cada mensaje, el servidor deja un respaldo. La conversación sigue después de cerrar: la sesión queda en `.diapo/chat.json` y lo que se ve en el panel, en `.diapo/chat-NOMBRE.json`.
- Las reglas del formato y del tono que recibe esa sesión están en `reglas_chat()`, dentro del CLI. Si cambia el formato del archivo, actualizarlas ahí.
- Una sesión de Claude Code normal (esta) edita el mismo archivo igual que siempre; el chat no reemplaza el trabajo desde la terminal.

## Publicar para mirar desde el celular

`diapo previa ARCHIVO.html` imprime `archivo`, `raiz` y `archivos`. Publicar `archivo` con la herramienta Artifact y pasar en `files` cada ruta de `archivos` mapeada a `raiz/ruta`. La copia es solo para mirar: los cambios se hacen en el archivo local.

## Límites

- KaTeX cubre la matemática de LaTeX, no TikZ ni diagramas: esos van como imagen. `revisar` marca las ecuaciones con error de sintaxis.
- No tiene animaciones ni transiciones.
- Abierto como archivo, sin `diapo ver`: Ctrl+S guarda encima en Chrome o Edge, y la primera vez pide elegir el archivo. En Firefox baja una copia.
- Un `.html` que no tenga los bloques `#motor-css` y `#motor` no es formato diapo: `actualizar` no lo toca.
