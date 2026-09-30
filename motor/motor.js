/* ============================================================================
   diapo · motor de presentaciones editables (versión 1)
   Navegación, notas, vista general, ventana del presentador, editor, pedidos
   a Claude y guardado. Lo reemplaza `diapo actualizar`; no hace falta tocarlo
   para editar contenido. Los estilos del tema se leen de #tema y #estilos.
   ========================================================================== */
(() => {
'use strict';
const VERSION = '1';
const doc = document, html = doc.documentElement, deck = doc.getElementById('deck');
if (!deck) return;
const W = parseInt(deck.dataset.ancho, 10) || 1280, H = parseInt(deck.dataset.alto, 10) || 720;
const GRID = 10, MARK = '<!--diapo-el-->';
const params = new URLSearchParams(location.search);
const PRES = params.has('presentador');
const PREVIEW = !!window.DIAPO_VISTA_PREVIA;
const ARCHIVO = decodeURIComponent(location.pathname.split('/').pop() || '') || 'presentacion.html';
const KEY = 'diapo:' + location.pathname;
const HEAD_IDS = ['fuentes', 'tema', 'estilos', 'motor-css'];

let slides = [], idx = 0, scale = 1;
let editMode = false, sel = null, editing = null, savedRange = null, dirty = false;
let notesOpen = false, overviewOpen = false, presWin = null, fileHandle = null, t0 = Date.now();
let colorSnapped = false, nudgeSnapped = false, nudgeTimer = 0, hintTimer = 0, swipe = null;
let SERVER = null, saving = false;
const undoStack = [], redoStack = [];

const $ = (s, r = doc) => r.querySelector(s);
const $$ = (s, r = doc) => [...r.querySelectorAll(s)];
function mk(tag, attrs = {}, inner = '') { const n = doc.createElement(tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (inner) n.innerHTML = inner; return n; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const snapV = v => Math.round(v / GRID) * GRID;
const cur = () => slides[idx];
const notesOf = s => (s ? s.querySelector(':scope > aside.notas') : null);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return 'link'; } };
const isText = el => !!el && el.tagName !== 'IMG' && !el.classList.contains('hueco');
function toast(msg, ms = 2600) { const t = $('#aviso'); if (!t) return; t.textContent = msg; t.classList.add('visible'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('visible'), ms); }
function store(op, k, v) { try { if (op === 'get') return sessionStorage.getItem(k); if (op === 'del') sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (_) {} return null; }

/* tamaño del lienzo y de la página impresa */
const lienzoCss = mk('style', { id: 'diapo-lienzo', 'data-ui': '' });
lienzoCss.textContent = `:root{--ancho:${W}px;--alto:${H}px}@page{size:${W}px ${H}px;margin:0}`;
doc.head.appendChild(lienzoCss);

/* lo que ofrece el tema: estilos de texto, fondos de slide, colores y tipografías */
function leerTema() {
  const est = ($('#estilos') || {}).textContent || '', tem = ($('#tema') || {}).textContent || '';
  return {
    estilos: [...est.matchAll(/\/\*\s*estilo:\s*([^*]+?)\s*\*\/\s*\.([\w-]+)\s*[,{]/g)].map(m => [m[2], m[1]]),
    fondos: [...est.matchAll(/\/\*\s*fondo:\s*([^*]+?)\s*\*\/\s*\.slide\.([\w-]+)/g)].map(m => [m[2], m[1]]),
    colores: [...tem.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map(m => m[1]).slice(0, 10),
    fuentes: [...tem.matchAll(/--(f-[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].split(',')[0].replace(/['"]/g, '').trim()])
  };
}
let TEMA = leerTema();

const HELP = `
<h2>Cómo usar esta presentación</h2>
<h3>Presentar</h3>
<p><kbd>→</kbd> <kbd>←</kbd> o espacio: avanzar y volver · <kbd>F</kbd> pantalla completa · <kbd>N</kbd> notas · <kbd>O</kbd> vista general · <kbd>P</kbd> ventana del presentador (notas, reloj y la slide que sigue) · <kbd>B</kbd> pantalla negra · <kbd>C</kbd> chat con Claude (con <code>diapo ver</code>)</p>
<h3>Editar (tecla <kbd>E</kbd>)</h3>
<ul>
<li>Clic selecciona. Arrastrar mueve (imán cada 10&nbsp;px; <kbd>Alt</kbd> sin imán; <kbd>Shift</kbd> en línea recta). La esquina azul cambia el tamaño.</li>
<li>Doble clic o <kbd>Enter</kbd>: escribir. <kbd>Esc</kbd>: terminar. Con una parte del texto marcada, color, negrita y link se aplican solo a esa parte.</li>
<li>Flechas: mover de a 1&nbsp;px (<kbd>Shift</kbd>: 10). <kbd>Supr</kbd>: borrar. <kbd>Ctrl</kbd>+<kbd>D</kbd>: duplicar. <kbd>Tab</kbd>: pasar al elemento siguiente.</li>
<li><kbd>Ctrl</kbd>+<kbd>C</kbd> y <kbd>Ctrl</kbd>+<kbd>V</kbd>: copiar un elemento y pegarlo en otra slide, en el mismo lugar.</li>
<li>Pegar una captura con <kbd>Ctrl</kbd>+<kbd>V</kbd>: si hay un recuadro punteado o una imagen seleccionada, la reemplaza; si no, la agrega. Arrastrar un archivo de imagen hace lo mismo.</li>
<li>Pegar una URL crea un <b>[link]</b>. Pegar texto crea una caja de texto.</li>
<li>Vista general (<kbd>O</kbd>): arrastrá las miniaturas para cambiar el orden.</li>
<li><b>Tema</b>: colores y tipografías de toda la presentación. <b>Fondo</b>: cambia el fondo de la slide entre los que trae el tema.</li>
<li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> rehace.</li>
</ul>
<h3>Trabajar con Claude</h3>
<ul>
<li>Abrila con <code>diapo ver archivo.html</code>: <kbd>Ctrl</kbd>+<kbd>S</kbd> guarda directo y, cuando Claude cambia el archivo, la página se actualiza sola. Si tenías cambios sin guardar, te avisa en vez de pisarlos.</li>
<li><b>Claude</b> (tecla <kbd>C</kbd>) abre un chat al costado. Pedile cambios en castellano: sabe en qué slide estás y qué elemento elegiste. Lo que cambia aparece enseguida y <kbd>Ctrl</kbd>+<kbd>Z</kbd> lo deshace. Antes de mandar, guarda tus cambios. Usa Claude Code con tu cuenta y solo puede modificar esta presentación.</li>
<li><b>Pedido</b> deja un encargo para Claude en el elemento elegido, o en la slide si no hay nada elegido. Claude los ve con <code>diapo pedidos</code> y los borra cuando los resuelve.</li>
<li>Las notas del orador las leen los dos: son el lugar para el guion y los datos.</li>
</ul>
<h3>Guardar sin el servidor</h3>
<p>Abierta como archivo, <kbd>Ctrl</kbd>+<kbd>S</kbd> guarda encima en Chrome o Edge (la primera vez elegís el archivo). <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> guarda como otro archivo. En Firefox baja una copia. Las imágenes pegadas quedan adentro del HTML.</p>
<h3>PDF</h3>
<p><code>diapo pdf archivo.html</code>, o <kbd>Ctrl</kbd>+<kbd>P</kbd> con márgenes «Ninguno» y «Gráficos de fondo» activado.</p>
<h3>El archivo por dentro</h3>
<p>Cada slide es un <code>&lt;section class="slide"&gt;</code>. Cada cosa movible tiene <code>class="el"</code> y <code>left</code>, <code>top</code>, <code>width</code> en píxeles de un lienzo de ${W}×${H}. Las notas van en <code>&lt;aside class="notas"&gt;</code>. Los colores y tipografías, en <code>&lt;style id="tema"&gt;</code>; los estilos de texto, en <code>&lt;style id="estilos"&gt;</code>.</p>
<p class="cerrar"><button type="button" data-cerrar>Cerrar (Esc)</button></p>`;

/* ---------- slides y navegación ---------- */
function refresh() {
  slides = $$(':scope > section.slide', deck);
  slides.forEach((s, i) => { s.dataset.n = i + 1; });
}
function go(i, o = {}) {
  refresh();
  if (!slides.length) return;
  i = Math.max(0, Math.min(slides.length - 1, Number(i) || 0));
  if (editing) endEdit();
  slides.forEach(s => s.classList.remove('actual'));
  idx = i;
  slides[idx].classList.add('actual');
  if (sel && !slides[idx].contains(sel)) select(null);
  try { history.replaceState(null, '', location.pathname + location.search + '#' + (idx + 1)); } catch (_) {}
  renderNotes(); updateCounters(); renderPedidoSlide();
  if (!o.remote) tell({ diapo: 'ir', i: idx });
  if (PRES) renderPresenter();
  positionFrame();
}
const next = () => go(idx + 1);
const prev = () => go(idx - 1);

function tell(msg) {
  try {
    if (PRES) { if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*'); }
    else if (presWin && !presWin.closed) presWin.postMessage(msg, '*');
  } catch (_) {}
}
addEventListener('message', e => {
  const d = e.data;
  if (!d || d.diapo !== 'ir' || typeof d.i !== 'number') return;
  if (PRES ? e.source !== window.opener : e.source !== presWin) return;
  go(d.i, { remote: true });
});

function layout() {
  if (PRES) { layoutPresenter(); return; }
  const bar = $('#barra');
  const top = editMode && bar ? bar.getBoundingClientRect().height : 0;
  const bottom = notesOpen ? $('#notas-panel').getBoundingClientRect().height : 0;
  const cw = chatOpen && $('#chat-panel') ? $('#chat-panel').getBoundingClientRect().width : 0;
  html.style.setProperty('--barra-alto', top + 'px');
  const pad = editMode || PREVIEW || cw || innerWidth < 700 ? 16 : 0;
  const aw = innerWidth - cw - pad * 2, ah = innerHeight - top - bottom - pad * 2;
  scale = Math.max(0.05, Math.min(aw / W, ah / H));
  const x = (innerWidth - cw - W * scale) / 2, y = top + pad + (ah - H * scale) / 2;
  deck.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  positionFrame(); renderPedidoSlide();
}
function updateCounters() {
  const txt = `${idx + 1} / ${slides.length}`;
  const a = $('#pista .p-cont'); if (a) a.textContent = txt;
  const b = $('#barra .cont'); if (b) b.textContent = 'Slide ' + txt;
  const n = $$('[data-pedido]', deck).length;
  const p = $('#barra [data-a="pedidos"]'); if (p) { p.textContent = `Pedidos (${n})`; p.classList.toggle('pedido', n > 0); }
}

/* ---------- notas ---------- */
function renderNotes() {
  const p = $('#notas-panel'); if (!p) return;
  const s = cur(), n = notesOf(s);
  $('.np-titulo', p).textContent = `Notas · slide ${idx + 1}${s && s.dataset.titulo ? ' · ' + s.dataset.titulo : ''}${editMode ? ' · se pueden editar acá' : ''}`;
  const body = $('.np-cuerpo', p);
  body.innerHTML = n ? n.innerHTML : '';
  body.contentEditable = editMode ? 'true' : 'false';
}
function toggleNotes(v) { notesOpen = typeof v === 'boolean' ? v : !notesOpen; html.classList.toggle('con-notas', notesOpen); renderNotes(); layout(); }

/* ---------- vista general ---------- */
function openOverview() {
  if (editing) endEdit();
  refresh();
  const v = $('#vista'); v.innerHTML = '';
  v.appendChild(mk('div', { class: 'vg-cabecera' }, editMode ? 'Vista general · arrastrá una miniatura para cambiar el orden · clic para ir · Esc para cerrar' : 'Vista general · clic para ir · Esc para cerrar'));
  const grid = mk('div', { class: 'vg-grilla' });
  const k = 256 / W;
  slides.forEach((s, i) => {
    const t = mk('div', { class: 'vg-mini' + (i === idx ? ' actual' : ''), draggable: editMode ? 'true' : 'false', 'data-i': String(i) });
    const lienzo = mk('div', { class: 'vg-lienzo' }); lienzo.style.height = Math.round(H * k) + 'px';
    const c = s.cloneNode(true); c.classList.add('actual'); c.style.transform = `scale(${k})`;
    lienzo.appendChild(c); t.appendChild(lienzo);
    const pedidos = (s.dataset.pedido ? 1 : 0) + $$('[data-pedido]', s).length;
    t.appendChild(mk('div', { class: 'vg-rotulo' }, `<b>${i + 1}</b> ${esc(s.dataset.titulo || '')}${pedidos ? ` <span class="vg-pedido">· ${pedidos} pedido${pedidos > 1 ? 's' : ''}</span>` : ''}`));
    grid.appendChild(t);
  });
  v.appendChild(grid);
  overviewOpen = true; html.classList.add('con-vista');
  const a = $('.vg-mini.actual', v); if (a) a.scrollIntoView({ block: 'center' });
}
function closeOverview() { overviewOpen = false; html.classList.remove('con-vista'); $('#vista').innerHTML = ''; }

/* ---------- presentador (segunda ventana) ---------- */
function openPresenter() {
  const url = location.href.split('#')[0].split('?')[0] + '?presentador#' + (idx + 1);
  presWin = window.open(url, 'presentador', 'width=1200,height=760');
  if (!presWin) toast('El navegador bloqueó la ventana: permití las ventanas emergentes para esta página.');
}
function setupPresenter() {
  html.classList.add('presentador');
  doc.title = 'Presentador · ' + doc.title;
  const p = mk('div', { id: 'pres', 'data-ui': '' }, '<div id="p-sig"><div class="p-rot">Siguiente</div><div class="p-sig-lienzo"></div></div><div id="p-reloj"><div class="p-tiempo">00:00</div><div class="p-hora"></div><div class="p-num"></div><button type="button" data-p="reset">Reiniciar tiempo (R)</button></div><div id="p-notas"></div>');
  doc.body.appendChild(p);
  p.addEventListener('click', e => { if (e.target.closest('[data-p="reset"]')) { t0 = Date.now(); tick(); } });
  t0 = Date.now(); setInterval(tick, 1000); tick();
}
function tick() {
  const p = $('#pres'); if (!p) return;
  const s = Math.floor((Date.now() - t0) / 1000);
  $('.p-tiempo', p).textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  $('.p-hora', p).textContent = 'Hora ' + new Date().toTimeString().slice(0, 5);
}
function renderPresenter() {
  if (!$('#pres')) return;
  const n = notesOf(cur());
  $('#p-notas').innerHTML = n && n.innerHTML.trim() ? n.innerHTML : '<p><i>Sin notas</i></p>';
  const box = $('.p-sig-lienzo'); box.innerHTML = '';
  const nx = slides[idx + 1];
  if (nx) { const c = nx.cloneNode(true); c.classList.add('actual'); box.appendChild(c); }
  else box.innerHTML = '<div class="p-fin">Fin</div>';
  $('.p-num').textContent = `Slide ${idx + 1} / ${slides.length}`;
  layoutPresenter();
}
function layoutPresenter() {
  const vw = innerWidth, vh = innerHeight;
  scale = Math.min((vw * 0.6) / W, (vh * 0.58) / H);
  deck.style.transform = `translate(${vw * 0.02}px, ${vh * 0.03}px) scale(${scale})`;
  const box = $('.p-sig-lienzo'); if (!box) return;
  const s2 = (vw * 0.34) / W;
  box.style.width = W * s2 + 'px'; box.style.height = H * s2 + 'px';
  const c = box.firstElementChild;
  if (c && c.classList.contains('slide')) c.style.transform = `scale(${s2})`;
}

/* ---------- ayuda, pantalla negra, pantalla completa ---------- */
function toggleHelp(v) { $('#ayuda').classList.toggle('visible', typeof v === 'boolean' ? v : undefined); }
function toggleBlack() { $('#negro').classList.toggle('visible'); }
function toggleFull() { if (!doc.fullscreenElement) { const r = html.requestFullscreen && html.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } else if (doc.exitFullscreen) doc.exitFullscreen(); }

/* ---------- interfaz ---------- */
function buildUI() {
  const ui = (id, inner = '') => { const n = mk('div', { id, 'data-ui': '' }, inner); doc.body.appendChild(n); return n; };
  const marco = ui('marco', '<div class="m-info"></div><div class="asa" title="Arrastrá para cambiar el tamaño (Shift en imágenes recortadas: libre)"></div>');
  ui('guia-v'); ui('guia-h'); ui('pedido-slide');
  const externo = ui('aviso-externo', '<span class="ae-texto"></span><button type="button" data-ae="recargar">Recargar y perder mis cambios</button><button type="button" data-ae="seguir">Seguir editando</button>');
  const np = ui('notas-panel', '<div class="np-titulo"></div><div class="np-cuerpo"></div>');
  const vista = ui('vista');
  const negro = ui('negro');
  ui('aviso');
  const pista = ui('pista', '<button type="button" data-h="prev" title="Anterior">‹</button><span class="p-cont"></span><button type="button" data-h="next" title="Siguiente">›</button><span class="p-sep"></span><button type="button" data-h="editar" title="Tecla E">Editar</button><button type="button" data-h="notas" title="Tecla N">Notas</button><button type="button" data-h="vista" title="Tecla O">Vista</button><button type="button" data-h="pres" title="Tecla P">Presentador</button><button type="button" data-h="claude" title="Chat con Claude (tecla C)">Claude</button><button type="button" data-h="ayuda" title="Tecla ?">?</button>');
  const ayuda = ui('ayuda', `<div class="caja-ayuda">${HELP}</div>`);

  pista.addEventListener('click', e => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    ({ prev, next, editar: () => toggleEdit(true), notas: () => toggleNotes(), vista: openOverview, pres: openPresenter, claude: () => toggleChat(), ayuda: () => toggleHelp() })[b.dataset.h]();
  });
  ayuda.addEventListener('click', e => { if (e.target === ayuda || e.target.closest('[data-cerrar]')) toggleHelp(false); });
  negro.addEventListener('click', toggleBlack);
  externo.addEventListener('click', e => {
    const b = e.target.closest('[data-ae]'); if (!b) return;
    if (b.dataset.ae === 'recargar') { dirty = false; reopenAfterReload(); location.reload(); }
    else externo.classList.remove('visible');
  });
  $('.np-cuerpo', np).addEventListener('input', e => {
    if (!editMode || !cur()) return;
    let n = notesOf(cur());
    if (!n) { n = mk('aside', { class: 'notas' }); cur().appendChild(n); }
    n.innerHTML = e.target.innerHTML; markDirty();
  });

  vista.addEventListener('click', e => {
    const m = e.target.closest('.vg-mini');
    if (m) { closeOverview(); go(+m.dataset.i); } else if (e.target === vista) closeOverview();
  });
  vista.addEventListener('dragstart', e => { const m = e.target.closest('.vg-mini'); if (!m || !editMode) return; e.dataTransfer.setData('text/x-slide', m.dataset.i); e.dataTransfer.effectAllowed = 'move'; });
  vista.addEventListener('dragover', e => { const m = e.target.closest('.vg-mini'); if (!m || !editMode) return; e.preventDefault(); $$('.vg-mini.sobre', vista).forEach(x => { if (x !== m) x.classList.remove('sobre'); }); m.classList.add('sobre'); });
  vista.addEventListener('dragleave', e => { const m = e.target.closest('.vg-mini'); if (m && !m.contains(e.relatedTarget)) m.classList.remove('sobre'); });
  vista.addEventListener('drop', e => {
    const m = e.target.closest('.vg-mini'); if (!m || !editMode) return;
    e.preventDefault(); e.stopPropagation();
    const from = parseInt(e.dataTransfer.getData('text/x-slide'), 10), to = +m.dataset.i;
    if (Number.isFinite(from)) { moveSlide(from, to); openOverview(); }
  });

  $('.asa', marco).addEventListener('pointerdown', e => {
    if (!sel) return;
    e.preventDefault(); e.stopPropagation();
    const el = sel, sx = e.clientX, sy = e.clientY, ow = el.offsetWidth, oh = el.offsetHeight;
    const isImg = el.tagName === 'IMG', fixedH = !!el.style.height;
    let started = false;
    const mv = ev => {
      if (!started) { snapshot(); started = true; }
      let w = ow + (ev.clientX - sx) / scale, h = oh + (ev.clientY - sy) / scale;
      if (!ev.altKey) { w = snapV(w); h = snapV(h); }
      w = Math.max(16, Math.round(w)); h = Math.max(12, Math.round(h));
      el.style.width = w + 'px';
      if (isImg) { if (fixedH) el.style.height = (ev.shiftKey ? h : Math.round(w * oh / ow)) + 'px'; }
      else if (fixedH) el.style.height = h + 'px';
      positionFrame(); markDirty();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
}

function buildBar() {
  if ($('#barra')) return;
  TEMA = leerTema();
  const sw = TEMA.colores.map(v => `<button type="button" class="muestra" data-a="color-var" data-v="var(--${v})" style="background:var(--${v})" title="${v}"></button>`).join('');
  const estilos = TEMA.estilos.length ? `<select data-a="estilo" title="Estilo">${TEMA.estilos.map(p => `<option value="${p[0]}">${esc(p[1])}</option>`).join('')}<option value="">(sin estilo)</option></select>` : '';
  const fuentes = `<select data-a="fuente" title="Tipografía"><option value="">Tipografía…</option>${TEMA.fuentes.map(f => `<option value="var(--${f[0]})">${esc(f[1])}</option>`).join('')}<option value="Arial, Helvetica, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="'Courier New', monospace">Mono</option></select>`;
  const b = mk('div', { id: 'barra', 'data-ui': '', class: 'sin-sel' }, `
    <div class="g"><button type="button" data-a="guardar" class="principal" title="Guardar (Ctrl+S). Con Shift: guardar como">Guardar</button><button type="button" data-a="deshacer" title="Deshacer (Ctrl+Z)">↶</button><button type="button" data-a="rehacer" title="Rehacer (Ctrl+Shift+Z)">↷</button><span class="cont"></span><span class="servidor"></span></div>
    <div class="g"><span class="r">Slide</span><button type="button" data-a="s-nueva">Nueva</button><button type="button" data-a="s-dup">Duplicar</button><button type="button" data-a="s-antes" title="Mover antes">◀</button><button type="button" data-a="s-despues" title="Mover después">▶</button><button type="button" data-a="s-fondo" title="Cambiar el fondo entre los del tema">Fondo</button><button type="button" data-a="s-titulo" title="Nombre en la vista general">Nombre</button><button type="button" data-a="s-borrar" class="peligro">Borrar</button></div>
    <div class="g"><span class="r">Insertar</span><button type="button" data-a="i-texto">Texto</button><button type="button" data-a="i-titulo">Título</button><button type="button" data-a="i-link">Link</button><button type="button" data-a="i-imagen">Imagen</button><button type="button" data-a="i-hueco" title="Recuadro para pegar una captura">Hueco</button></div>
    <div class="g"><button type="button" data-a="pedido" class="pedido" title="Dejar un pedido a Claude en el elemento elegido o en la slide">Pedido</button><button type="button" data-a="pedidos" title="Ver todos los pedidos">Pedidos (0)</button><button type="button" data-a="claude" class="claude" title="Chat con Claude (C)">Claude</button><button type="button" data-a="tema">Tema</button><button type="button" data-a="notas">Notas</button><button type="button" data-a="vista" title="Vista general (O)">Vista</button><button type="button" data-a="ayuda">Ayuda</button><button type="button" data-a="salir" title="Salir del modo edición (E)">Salir</button></div>
    <div class="g el-only fila"><span class="r">Elemento</span>${estilos}${fuentes}<button type="button" data-a="menos" title="Más chico">A−</button><input data-a="tam" type="number" min="6" max="400" step="1" title="Tamaño en px" aria-label="Tamaño en px"><button type="button" data-a="mas" title="Más grande">A+</button><button type="button" data-a="negrita" title="Negrita"><b>B</b></button><button type="button" data-a="cursiva" title="Cursiva"><i>I</i></button><button type="button" data-a="subrayado" title="Subrayado"><u>U</u></button><button type="button" data-a="al-izq" title="Alinear a la izquierda">Izq</button><button type="button" data-a="al-centro" title="Centrar el texto">Centro</button><button type="button" data-a="al-der" title="Alinear a la derecha">Der</button>${sw}<input data-a="color" type="color" title="Otro color" aria-label="Otro color"><button type="button" data-a="link" title="Poner o cambiar un link">Link…</button><button type="button" data-a="imagen" title="Cambiar la imagen">Imagen…</button><select data-a="mas-acciones" title="Más acciones"><option value="">Más…</option><option value="caja">Borde de caja</option><option value="centrar">Centrar en la slide</option><option value="centrar-v">Centrar también vertical</option><option value="frente">Traer al frente</option><option value="atras">Mandar atrás</option><option value="dup">Duplicar (Ctrl+D)</option></select><button type="button" data-a="borrar" class="peligro" title="Borrar (Supr)">Borrar</button></div>`);
  doc.body.appendChild(b);
  b.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  b.addEventListener('click', e => { const t = e.target.closest('button[data-a]'); if (t) act(t.dataset.a, t, e); });
  const est = $('[data-a="estilo"]', b); if (est) est.addEventListener('change', e => { applyPreset(e.target.value); e.target.blur(); });
  $('[data-a="fuente"]', b).addEventListener('change', e => { if (e.target.value) styleEl('fontFamily', e.target.value); e.target.value = ''; e.target.blur(); });
  $('[data-a="tam"]', b).addEventListener('change', e => { const v = +e.target.value; if (v > 0) styleEl('fontSize', v + 'px'); });
  $('[data-a="mas-acciones"]', b).addEventListener('change', e => { const v = e.target.value; e.target.value = ''; e.target.blur(); if (v) act(v === 'centrar-v' ? 'centrar' : v, null, { shiftKey: v === 'centrar-v' }); });
  const col = $('[data-a="color"]', b);
  col.addEventListener('input', e => { setColor(e.target.value, colorSnapped); colorSnapped = true; });
  col.addEventListener('change', () => { colorSnapped = false; });
  new ResizeObserver(() => layout()).observe(b);
  if (dirty) b.querySelector('[data-a="guardar"]').classList.add('pendiente');
  $('.servidor', b).textContent = SERVER ? '· guarda en el archivo vía diapo ver' : '';
}

function act(a, btn, ev) {
  switch (a) {
    case 'guardar': return save(ev && ev.shiftKey);
    case 'deshacer': return undo();
    case 'rehacer': return redo();
    case 's-nueva': return newSlide();
    case 's-dup': return dupSlide();
    case 's-antes': return moveSlide(idx, idx - 1);
    case 's-despues': return moveSlide(idx, idx + 1);
    case 's-fondo': return cycleBackground();
    case 's-titulo': { const v = prompt('Nombre de la slide (para la vista general):', cur().dataset.titulo || ''); if (v !== null) { snapshot(); cur().dataset.titulo = v; markDirty(); } return; }
    case 's-borrar': return delSlide();
    case 'i-texto': return insert(`<div class="el ${presetFor('cuerpo')}" style="left:${Math.round(W * 0.1)}px;top:${Math.round(H * 0.42)}px;width:${Math.round(W * 0.56)}px">Texto nuevo</div>`, true);
    case 'i-titulo': return insert(`<div class="el ${presetFor('titulo')}" style="left:${Math.round(W * 0.03)}px;top:${Math.round(H * 0.03)}px;width:${Math.round(W * 0.86)}px">Título nuevo</div>`, true);
    case 'i-link': { const u = prompt('URL del link:', 'https://'); if (!u || u === 'https://') return; insert(`<a class="el ${presetFor('fuente')}" href="${esc(u)}" target="_blank" rel="noopener" style="left:40px;top:${H - 80}px">[${esc(host(u))}]</a>`); return; }
    case 'i-imagen': return pickFile(url => placeImage(url));
    case 'i-hueco': return insert(`<div class="el hueco" style="left:${Math.round(W * 0.27)}px;top:${Math.round(H * 0.25)}px;width:${Math.round(W * 0.47)}px;height:${Math.round(H * 0.47)}px">Pegá acá una captura (Ctrl+V)</div>`);
    case 'pedido': return editPedido();
    case 'pedidos': return togglePedidos();
    case 'claude': return toggleChat();
    case 'color-var': return setColor(btn.dataset.v);
    case 'menos': return bump(-2);
    case 'mas': return bump(2);
    case 'negrita': return fmt('bold', 'fontWeight');
    case 'cursiva': return fmt('italic', 'fontStyle');
    case 'subrayado': return fmt('underline', 'textDecoration');
    case 'al-izq': return styleEl('textAlign', 'left');
    case 'al-centro': return styleEl('textAlign', 'center');
    case 'al-der': return styleEl('textAlign', 'right');
    case 'link': return editLink();
    case 'imagen': return sel && pickImage(sel);
    case 'caja': if (sel) { snapshot(); sel.classList.toggle('caja'); markDirty(); positionFrame(); } return;
    case 'centrar': if (sel) { snapshot(); sel.style.left = Math.round((W - sel.offsetWidth) / 2) + 'px'; if (ev && ev.shiftKey) sel.style.top = Math.round((H - sel.offsetHeight) / 2) + 'px'; markDirty(); positionFrame(); } return;
    case 'frente': if (sel) { snapshot(); cur().insertBefore(sel, notesOf(cur())); markDirty(); } return;
    case 'atras': if (sel) { snapshot(); cur().insertBefore(sel, cur().firstElementChild); markDirty(); } return;
    case 'dup': return dupEl();
    case 'borrar': return delEl();
    case 'tema': return toggleTheme();
    case 'notas': return toggleNotes();
    case 'vista': return overviewOpen ? closeOverview() : openOverview();
    case 'ayuda': return toggleHelp();
    case 'salir': return toggleEdit(false);
  }
}
/* el estilo del tema más parecido a uno pedido (cuerpo, titulo, fuente) */
function presetFor(kind) {
  const names = TEMA.estilos.map(p => p[0]);
  const wanted = { cuerpo: ['cuerpo', 'texto', 'body'], titulo: ['titulo', 'mano', 'title'], fuente: ['fuente', 'link'] }[kind] || [kind];
  return wanted.find(n => names.includes(n)) || names.find(n => n.includes(wanted[0])) || '';
}
function cycleBackground() {
  const opts = ['', ...TEMA.fondos.map(f => f[0])];
  if (opts.length < 2) { toast('Este tema no define otros fondos.'); return; }
  const s = cur(); snapshot();
  const now = Math.max(0, opts.findIndex(c => c && s.classList.contains(c)));
  opts.forEach(c => { if (c) s.classList.remove(c); });
  const nx = opts[(now + 1) % opts.length];
  if (nx) s.classList.add(nx);
  markDirty();
  toast('Fondo: ' + (nx ? TEMA.fondos.find(f => f[0] === nx)[1] : 'normal'));
}

/* ---------- modo edición ---------- */
function toggleEdit(v) {
  if (PRES) return;
  if (PREVIEW) { toast('Esta copia es solo para mirar. Para editar, abrí el archivo local con diapo ver.', 4200); return; }
  editMode = typeof v === 'boolean' ? v : !editMode;
  if (editMode) { buildBar(); try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {} }
  else { endEdit(); select(null); ['#tema-panel', '#pedidos-panel'].forEach(s => { const p = $(s); if (p) p.remove(); }); }
  html.classList.toggle('editando', editMode);
  if (overviewOpen) openOverview();
  renderNotes(); updateCounters(); syncBar(); layout();
  if (editMode && !store('get', 'diapo-bienvenida')) { store('set', 'diapo-bienvenida', '1'); toast('Modo edición: clic para elegir, doble clic para escribir, Ctrl+S para guardar. «Ayuda» explica todo.', 4200); }
}

function select(el) {
  if (el && editing && editing !== el) endEdit();
  sel = el || null;
  positionFrame(); syncBar();
}
function positionFrame() {
  chatCtx();
  const f = $('#marco'); if (!f) return;
  if (!editMode || !sel || !sel.isConnected || !cur() || !cur().contains(sel)) { f.style.display = 'none'; return; }
  const r = sel.getBoundingClientRect();
  Object.assign(f.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  $('.m-info', f).textContent = `x ${sel.offsetLeft} · y ${sel.offsetTop} · ${sel.offsetWidth}×${sel.offsetHeight}` + (sel.dataset.pedido ? ' · pedido: ' + sel.dataset.pedido : '');
}
function guides(v, h) {
  const gv = $('#guia-v'), gh = $('#guia-h'), r = deck.getBoundingClientRect();
  gv.style.display = v ? 'block' : 'none'; gh.style.display = h ? 'block' : 'none';
  if (v) Object.assign(gv.style, { left: (r.left + r.width / 2) + 'px', top: r.top + 'px', height: r.height + 'px', width: '1px' });
  if (h) Object.assign(gh.style, { top: (r.top + r.height / 2) + 'px', left: r.left + 'px', width: r.width + 'px', height: '1px' });
}
function syncBar() {
  const b = $('#barra'); if (!b) return;
  b.classList.toggle('sin-sel', !sel);
  updateCounters();
  if (!sel) return;
  const cs = getComputedStyle(sel);
  $('[data-a="tam"]', b).value = Math.round(parseFloat(cs.fontSize));
  $('[data-a="color"]', b).value = toHex(cs.color);
  const est = $('[data-a="estilo"]', b);
  if (est) { const pre = TEMA.estilos.find(p => sel.classList.contains(p[0])); est.value = pre ? pre[0] : ''; }
}
function toHex(rgb) {
  const m = String(rgb).match(/[\d.]+/g); if (!m || m.length < 3) return '#ffffff';
  return '#' + m.slice(0, 3).map(x => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0')).join('');
}
function markDirty() { dirty = true; const b = $('#barra [data-a="guardar"]'); if (b) b.classList.add('pendiente'); }
function markClean() { dirty = false; const b = $('#barra [data-a="guardar"]'); if (b) b.classList.remove('pendiente'); }

/* arrastrar */
deck.addEventListener('pointerdown', e => {
  if (!editMode) { if (e.pointerType === 'touch') swipe = { x: e.clientX, y: e.clientY }; return; }
  if (PRES || e.button !== 0) return;
  const el = e.target.closest('.el');
  if (!el || !cur() || !cur().contains(el)) { endEdit(); select(null); return; }
  if (el === editing) return;
  endEdit();
  e.preventDefault();
  select(el);
  const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
  let moved = false;
  const mv = ev => {
    const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
    if (!moved) { if (Math.abs(dx) + Math.abs(dy) < 3) return; snapshot(); moved = true; }
    let nx = ox + dx, ny = oy + dy, gv = false, gh = false;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) ny = oy; else nx = ox; }
    if (!ev.altKey) {
      nx = snapV(nx); ny = snapV(ny);
      if (Math.abs(nx + w / 2 - W / 2) < 12) { nx = Math.round(W / 2 - w / 2); gv = true; }
      if (Math.abs(ny + h / 2 - H / 2) < 12) { ny = Math.round(H / 2 - h / 2); gh = true; }
    }
    el.style.left = Math.round(nx) + 'px'; el.style.top = Math.round(ny) + 'px';
    guides(gv, gh); positionFrame(); markDirty();
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); guides(false, false); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
addEventListener('pointerup', e => {
  if (!swipe || editMode) { swipe = null; return; }
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next() : prev());
});
doc.addEventListener('pointerdown', e => {
  if (!editMode || deck.contains(e.target) || (e.target.closest && e.target.closest('[data-ui]'))) return;
  endEdit(); select(null);
});
deck.addEventListener('click', e => { if (editMode && e.target.closest('a')) e.preventDefault(); });

/* escribir */
deck.addEventListener('input', () => { if (editing) markDirty(); });
deck.addEventListener('dblclick', e => {
  if (!editMode) return;
  const el = e.target.closest('.el'); if (!el || !cur() || !cur().contains(el)) return;
  if (!isText(el)) { pickImage(el); return; }
  if (editing !== el) { startEdit(el); placeCaret(e.clientX, e.clientY); }
});
function startEdit(el, selectAll = false) {
  if (!isText(el)) return;
  if (editing && editing !== el) endEdit();
  if (editing === el) return;
  sel = el; syncBar();
  snapshot(); untex(el); el._antes = el.innerHTML;
  editing = el; el.contentEditable = 'true'; el.classList.add('escribiendo');
  html.classList.add('escribiendo-texto');
  el.focus({ preventScroll: true });
  if (selectAll) { const r = doc.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  positionFrame();
}
function endEdit() {
  const el = editing; if (!el) return;
  editing = null; savedRange = null;
  el.removeAttribute('contenteditable'); el.classList.remove('escribiendo');
  html.classList.remove('escribiendo-texto');
  if (el.innerHTML === el._antes) undoStack.pop(); else markDirty();
  delete el._antes;
  renderTex(el);
  const s = getSelection(); if (s) s.removeAllRanges();
  positionFrame();
}
function placeCaret(x, y) {
  let r = null;
  if (doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(x, y);
  else if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); if (p) { r = doc.createRange(); r.setStart(p.offsetNode, p.offset); } }
  if (r && editing && editing.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
doc.addEventListener('selectionchange', () => {
  if (!editing) return;
  const s = getSelection();
  if (s && s.rangeCount && editing.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  positionFrame();
});
function restoreRange() {
  if (!editing || !savedRange || savedRange.collapsed || !editing.contains(savedRange.commonAncestorContainer)) return false;
  editing.focus({ preventScroll: true });
  const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange);
  return true;
}
function keepRange() { const s = getSelection(); if (editing && s && s.rangeCount) savedRange = s.getRangeAt(0).cloneRange(); }

/* formato */
function styleEl(prop, val, noSnap) {
  if (!sel) return;
  if (!noSnap) snapshot();
  sel.style[prop] = val;
  markDirty(); positionFrame(); syncBar();
  if (editing) editing.focus({ preventScroll: true });
}
function bump(d) { if (!sel) return; const px = parseFloat(getComputedStyle(sel).fontSize) || 16; styleEl('fontSize', Math.max(6, Math.round(px + d)) + 'px'); }
function fmt(cmd, prop) {
  if (!sel) return;
  if (restoreRange()) { snapshot(); doc.execCommand(cmd); markDirty(); keepRange(); positionFrame(); return; }
  const cs = getComputedStyle(sel);
  if (prop === 'fontWeight') styleEl(prop, +cs.fontWeight >= 600 ? '300' : '700');
  else if (prop === 'fontStyle') styleEl(prop, cs.fontStyle === 'italic' ? 'normal' : 'italic');
  else styleEl(prop, cs.textDecorationLine.includes('underline') ? 'none' : 'underline');
}
function setColor(c, noSnap) {
  if (!sel) return;
  if (restoreRange()) {
    if (!noSnap) snapshot();
    const hex = c.startsWith('var(') ? getComputedStyle(html).getPropertyValue(c.slice(4, -1)).trim() : c;
    doc.execCommand('styleWithCSS', false, true); doc.execCommand('foreColor', false, hex); doc.execCommand('styleWithCSS', false, false);
    markDirty(); keepRange(); return;
  }
  styleEl('color', c, noSnap);
}
function applyPreset(cls) {
  if (!sel) return;
  snapshot();
  TEMA.estilos.forEach(p => sel.classList.remove(p[0]));
  if (cls) sel.classList.add(cls);
  ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'textDecoration', 'lineHeight'].forEach(p => { sel.style[p] = ''; });
  markDirty(); positionFrame(); syncBar();
}
function editLink() {
  if (!sel) return;
  let a = null;
  if (editing && savedRange) { let n = savedRange.startContainer; if (n.nodeType === 3) n = n.parentElement; a = n && n.closest ? n.closest('a') : null; if (a && !editing.contains(a) && a !== editing) a = null; }
  if (!a && sel.tagName === 'A') a = sel;
  if (!a && !editing) { const inner = $$('a', sel); if (inner.length === 1) a = inner[0]; else if (inner.length > 1) { toast('Hay varios links: doble clic y poné el cursor sobre el que querés cambiar.'); return; } }
  if (a) {
    const u = prompt('URL del link (vacío para sacarlo):', a.getAttribute('href') || '');
    if (u === null) return;
    snapshot();
    if (u.trim() === '') { if (a === sel) a.removeAttribute('href'); else a.replaceWith(...a.childNodes); }
    else { a.setAttribute('href', u.trim()); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    markDirty(); return;
  }
  if (editing && savedRange && !savedRange.collapsed) {
    const u = prompt('URL para el texto marcado:', 'https://'); if (!u || u === 'https://') return;
    restoreRange(); snapshot();
    doc.execCommand('createLink', false, u.trim());
    $$('a', editing).forEach(x => { if (x.getAttribute('href') === u.trim()) { x.setAttribute('target', '_blank'); x.setAttribute('rel', 'noopener'); } });
    markDirty(); return;
  }
  toast('Para poner un link: doble clic en el texto, marcá la parte que va con link y apretá «Link…».');
}

/* pedidos a Claude */
function editPedido() {
  if (editing) endEdit();
  const target = sel || cur(); if (!target) return;
  const que = sel ? 'este elemento' : 'esta slide';
  const v = prompt(`Pedido a Claude para ${que} (vacío para borrarlo):`, target.dataset.pedido || '');
  if (v === null) return;
  snapshot();
  if (v.trim()) target.dataset.pedido = v.trim(); else delete target.dataset.pedido;
  markDirty(); positionFrame(); renderPedidoSlide(); updateCounters();
  if ($('#pedidos-panel')) { togglePedidos(); togglePedidos(); }
  toast(v.trim() ? 'Pedido guardado en ' + que + '. Guardá (Ctrl+S) para que Claude lo vea.' : 'Pedido borrado.');
}
function renderPedidoSlide() {
  const b = $('#pedido-slide'); if (!b) return;
  const s = cur();
  if (!editMode || !s || !s.dataset.pedido) { b.style.display = 'none'; return; }
  const r = deck.getBoundingClientRect();
  b.textContent = 'Pedido para esta slide: ' + s.dataset.pedido;
  Object.assign(b.style, { display: 'block', left: (r.left + 8) + 'px', top: (r.top + 8) + 'px' });
}
function describe(el) {
  if (el.tagName === 'SECTION') return 'la slide';
  if (el.tagName === 'IMG') return 'imagen ' + ((el.getAttribute('src') || '').startsWith('data:') ? '(pegada)' : (el.getAttribute('src') || '').split('/').pop());
  const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
  return (el.classList.contains('hueco') ? 'recuadro ' : '') + '«' + (t.length > 40 ? t.slice(0, 40) + '…' : t) + '»';
}
function togglePedidos() {
  let p = $('#pedidos-panel');
  if (p) { p.remove(); return; }
  refresh();
  const items = [];
  slides.forEach((s, i) => { [s, ...$$('[data-pedido]', s)].forEach(el => { if (el.dataset.pedido) items.push({ i, el }); }); });
  p = mk('div', { id: 'pedidos-panel', 'data-ui': '' }, '<div class="tp-cab">Pedidos a Claude <button type="button" data-t="cerrar" title="Cerrar">×</button></div>' +
    (items.length ? items.map((it, k) => `<button type="button" class="pp-item" data-k="${k}"><b>Slide ${it.i + 1}</b> · ${esc(describe(it.el))}<br>${esc(it.el.dataset.pedido)}</button>`).join('') : '<p class="tp-nota">No hay pedidos. Elegí un elemento (o nada, para la slide) y apretá «Pedido».</p>') +
    '<p class="tp-nota">Claude los lee con <code>diapo pedidos</code> y los borra al resolverlos.</p>');
  doc.body.appendChild(p);
  p.addEventListener('click', e => {
    if (e.target.closest('[data-t="cerrar"]')) { p.remove(); return; }
    const b = e.target.closest('.pp-item'); if (!b) return;
    const it = items[+b.dataset.k]; go(it.i); if (it.el.tagName !== 'SECTION') select(it.el);
  });
}

/* elementos */
function insert(h, edit = false) {
  snapshot();
  const t = doc.createElement('template'); t.innerHTML = h.trim();
  const el = t.content.firstElementChild;
  cur().insertBefore(el, notesOf(cur()));
  markDirty(); select(el);
  if (edit) startEdit(el, true);
  return el;
}
function dupEl() {
  if (!sel) return;
  snapshot();
  const c = sel.cloneNode(true);
  c.classList.remove('escribiendo'); c.removeAttribute('contenteditable');
  c.style.left = (sel.offsetLeft + 20) + 'px'; c.style.top = (sel.offsetTop + 20) + 'px';
  sel.after(c); markDirty(); select(c);
}
function delEl() { if (!sel) return; snapshot(); const s = sel; select(null); s.remove(); markDirty(); updateCounters(); }
function nudge(k, d) {
  if (!sel) return;
  if (!nudgeSnapped) { snapshot(); nudgeSnapped = true; }
  clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => { nudgeSnapped = false; }, 800);
  const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
  sel.style.left = (sel.offsetLeft + dx) + 'px'; sel.style.top = (sel.offsetTop + dy) + 'px';
  markDirty(); positionFrame();
}
function cycle(d) { const els = $$(':scope > .el', cur()); if (!els.length) return; const i = els.indexOf(sel); select(els[(i + d + els.length) % els.length]); }
function pasteElement(h) {
  const t = doc.createElement('template'); t.innerHTML = h.trim();
  const el = t.content.firstElementChild;
  if (!el || !el.classList.contains('el')) return;
  el.classList.remove('escribiendo'); el.removeAttribute('contenteditable');
  const twin = $$(':scope > .el', cur()).some(c => c.outerHTML === el.outerHTML);
  snapshot();
  cur().insertBefore(el, notesOf(cur()));
  if (twin) { el.style.left = (el.offsetLeft + 20) + 'px'; el.style.top = (el.offsetTop + 20) + 'px'; }
  markDirty(); select(el);
}

/* imágenes */
function fileToURL(f) {
  return new Promise((res, rej) => {
    if (/gif|svg/.test(f.type)) { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); return; }
    const u = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const MAX = 1600; let w = im.naturalWidth, h = im.naturalHeight;
      if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = doc.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(u);
      let out = c.toDataURL('image/webp', 0.9);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      res(out);
    };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('No pude leer la imagen')); };
    im.src = u;
  });
}
function pickFile(cb) {
  const i = mk('input', { type: 'file', accept: 'image/*' });
  i.addEventListener('change', async () => { const f = i.files && i.files[0]; if (f) { try { cb(await fileToURL(f)); } catch (err) { toast(err.message); } } });
  i.click();
}
function pickImage(el) {
  if (!el || isText(el)) { toast('Seleccioná una imagen o un recuadro punteado.'); return; }
  const src = el.tagName === 'IMG' ? el.getAttribute('src') || '' : '';
  const v = prompt('Ruta o URL de la imagen (por ejemplo img/foto.jpg).\nDejalo vacío para elegir un archivo de tu compu:', src.startsWith('data:') ? '' : src);
  if (v === null) return;
  if (v.trim()) replaceImage(el, v.trim()); else pickFile(url => replaceImage(el, url));
}
function replaceImage(el, src) {
  snapshot();
  if (el.tagName === 'IMG') { el.onload = () => { el.onload = null; positionFrame(); }; el.setAttribute('src', src); markDirty(); select(el); return el; }
  const L = el.offsetLeft, T = el.offsetTop, BW = el.offsetWidth, BH = el.offsetHeight;
  const keep = ['circulo', 'cubrir', 'sangrado'].filter(c => el.classList.contains(c));
  const img = mk('img', { class: ['el', ...keep].join(' '), src, alt: '' });
  if (el.dataset.pedido) img.dataset.pedido = el.dataset.pedido;
  img.style.left = L + 'px'; img.style.top = T + 'px'; img.style.width = BW + 'px';
  if (keep.includes('circulo') || keep.includes('cubrir')) {
    img.style.height = BH + 'px';
    el.replaceWith(img); markDirty(); select(img);
    return img;
  }
  img.onload = () => {
    img.onload = null;
    const r = img.naturalWidth / img.naturalHeight; let w = BW, h = BW / r;
    if (h > BH) { h = BH; w = BH * r; }
    img.style.width = Math.round(w) + 'px'; img.style.left = Math.round(L + (BW - w) / 2) + 'px'; img.style.top = Math.round(T + (BH - h) / 2) + 'px';
    positionFrame();
  };
  el.replaceWith(img); markDirty(); select(img);
  return img;
}
function placeImage(src, x, y) {
  snapshot();
  const img = mk('img', { class: 'el', src, alt: '' });
  img.style.left = Math.round(W * 0.27) + 'px'; img.style.top = Math.round(H * 0.25) + 'px'; img.style.width = Math.round(W * 0.47) + 'px';
  cur().insertBefore(img, notesOf(cur()));
  img.onload = () => {
    img.onload = null;
    const r = img.naturalWidth / img.naturalHeight;
    let w = Math.min(W * 0.5, img.naturalWidth), h = w / r;
    if (h > H * 0.72) { h = H * 0.72; w = h * r; }
    const cx = x == null ? W / 2 : x, cy = y == null ? H / 2 : y;
    img.style.width = Math.round(w) + 'px'; img.style.left = Math.round(cx - w / 2) + 'px'; img.style.top = Math.round(cy - h / 2) + 'px';
    positionFrame();
  };
  markDirty(); select(img);
  return img;
}

/* pegar, copiar, soltar archivos */
const inPanel = t => !!(t && t.closest && t.closest('#barra, #tema-panel, #pedidos-panel, #notas-panel, #chat-panel'));
doc.addEventListener('paste', async e => {
  if (!editMode || PRES || inPanel(e.target)) return;
  const cd = e.clipboardData; if (!cd) return;
  const item = [...cd.items].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (item) {
    e.preventDefault();
    const target = !editing && sel && !isText(sel) ? sel : null;
    try { const url = await fileToURL(item.getAsFile()); if (target) replaceImage(target, url); else placeImage(url); } catch (err) { toast(err.message); }
    return;
  }
  const txt = cd.getData('text/plain');
  if (editing) { e.preventDefault(); doc.execCommand('insertText', false, txt); return; }
  if (!txt) return;
  e.preventDefault();
  if (txt.startsWith(MARK)) { pasteElement(txt.slice(MARK.length)); return; }
  const u = txt.trim();
  if (/^https?:\/\/\S+$/.test(u)) { insert(`<a class="el ${presetFor('fuente')}" href="${esc(u)}" target="_blank" rel="noopener" style="left:40px;top:${H - 80}px">[${esc(host(u))}]</a>`); return; }
  const el = insert(`<div class="el ${presetFor('cuerpo')}" style="left:${Math.round(W * 0.1)}px;top:${Math.round(H * 0.42)}px;width:${Math.round(W * 0.56)}px"></div>`);
  el.textContent = txt; positionFrame();
});
function copyEl(e, cut) {
  if (!editMode || editing || !sel || inPanel(e.target)) return;
  e.preventDefault();
  const c = sel.cloneNode(true); c.removeAttribute('contenteditable'); c.classList.remove('escribiendo');
  e.clipboardData.setData('text/plain', MARK + c.outerHTML);
  if (cut) delEl(); else toast('Elemento copiado: Ctrl+V en cualquier slide.');
}
doc.addEventListener('copy', e => copyEl(e, false));
doc.addEventListener('cut', e => copyEl(e, true));
addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
addEventListener('drop', async e => {
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  if (!editMode) { toast('Para agregar imágenes, entrá al modo edición (E).'); return; }
  const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (!f) return;
  let url; try { url = await fileToURL(f); } catch (err) { toast(err.message); return; }
  const tgt = e.target.closest && e.target.closest('.el');
  if (tgt && cur().contains(tgt) && !isText(tgt)) { replaceImage(tgt, url); return; }
  const r = deck.getBoundingClientRect();
  placeImage(url, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
});

/* slides */
function newSlide() {
  snapshot();
  const t = presetFor('titulo'), c = presetFor('cuerpo');
  const s = mk('section', { class: 'slide', 'data-titulo': 'Nueva' }, `<div class="el ${t}" style="left:${Math.round(W * 0.03)}px;top:${Math.round(H * 0.03)}px;width:${Math.round(W * 0.86)}px">Título</div><div class="el ${c}" style="left:${Math.round(W * 0.05)}px;top:${Math.round(H * 0.22)}px;width:${Math.round(W * 0.9)}px">Texto</div><aside class="notas"></aside>`);
  cur().after(s); refresh(); markDirty(); go(slides.indexOf(s));
}
function dupSlide() {
  snapshot();
  const s = cur().cloneNode(true); s.classList.remove('actual');
  $$('.escribiendo', s).forEach(n => n.classList.remove('escribiendo'));
  $$('[contenteditable]', s).forEach(n => n.removeAttribute('contenteditable'));
  cur().after(s); refresh(); markDirty(); go(slides.indexOf(s));
}
function delSlide() {
  if (slides.length <= 1) return;
  if (!confirm('¿Borrar esta slide?')) return;
  snapshot();
  const i = idx; cur().remove(); refresh(); markDirty(); go(Math.min(i, slides.length - 1));
}
function moveSlide(from, to) {
  refresh();
  if (from === to || from < 0 || to < 0 || from >= slides.length || to >= slides.length) return;
  snapshot();
  const s = slides[from], target = slides[to];
  if (from < to) target.after(s); else target.before(s);
  refresh(); markDirty(); go(slides.indexOf(s));
}

/* deshacer */
/* conTema: el paso también guarda #tema y #estilos (los cambios que llegan de afuera pueden tocarlos) */
function estado(conTema) {
  const s = { h: deck.innerHTML, i: idx };
  if (conTema) { s.t = ($('#tema') || {}).textContent; s.e = ($('#estilos') || {}).textContent; }
  return s;
}
function snapshot(conTema) { undoStack.push(estado(conTema)); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
function restore(st) {
  deck.innerHTML = st.h;
  if (st.t != null) {
    const t = $('#tema'), e = $('#estilos'), antes = (t || {}).textContent + (e || {}).textContent;
    if (t && t.textContent !== st.t) t.textContent = st.t;
    if (e && e.textContent !== st.e) e.textContent = st.e;
    if ((t || {}).textContent + (e || {}).textContent !== antes) rebuildBar();
  }
  $$('[contenteditable]', deck).forEach(n => n.removeAttribute('contenteditable'));
  $$('.escribiendo', deck).forEach(n => n.classList.remove('escribiendo'));
  html.classList.remove('escribiendo-texto');
  sel = null; editing = null; savedRange = null;
  refresh(); go(Math.min(st.i, slides.length - 1)); markDirty(); syncBar();
}
function undo() { if (editing) endEdit(); if (!undoStack.length) { toast('No hay nada para deshacer.'); return; } const st = undoStack.pop(); redoStack.push(estado(st.t != null)); restore(st); }
function redo() { if (!redoStack.length) { toast('No hay nada para rehacer.'); return; } const st = redoStack.pop(); undoStack.push(estado(st.t != null)); restore(st); }
function rebuildBar() {
  TEMA = leerTema();
  const b = $('#barra'); if (!b) return;
  b.remove(); buildBar(); syncBar(); layout();
}

/* tema */
function toggleTheme() {
  let p = $('#tema-panel');
  if (p) { p.remove(); return; }
  const st = $('#tema'); if (!st) { toast('Esta presentación no tiene un bloque de tema.'); return; }
  const vars = [...st.textContent.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)];
  const full = v => v.length === 4 ? '#' + [...v.slice(1)].map(c => c + c).join('') : v.slice(0, 7);
  p = mk('div', { id: 'tema-panel', 'data-ui': '' }, '<div class="tp-cab">Tema <button type="button" data-t="cerrar" title="Cerrar">×</button></div>' +
    vars.map(([, n, v]) => { v = v.trim(); const col = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v); return `<label><span title="${n}">${n}</span>${col ? `<input type="color" data-var="${n}" value="${full(v)}">` : '<i></i>'}<input type="text" data-var="${n}" value="${esc(v)}"></label>`; }).join('') +
    '<p class="tp-nota">Cambia toda la presentación y se guarda con Ctrl+S. Los colores puestos a mano en un elemento no cambian.</p>');
  doc.body.appendChild(p);
  p.addEventListener('input', e => {
    const i = e.target.closest('[data-var]'); if (!i) return;
    const n = i.dataset.var, v = i.value;
    $$('[data-var]', p).forEach(x => { if (x !== i && x.dataset.var === n) { if (x.type === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) x.value = v; } else x.value = v; } });
    setVar(n, v);
  });
  p.addEventListener('click', e => { if (e.target.closest('[data-t="cerrar"]')) p.remove(); });
}
function setVar(n, v) { const st = $('#tema'); if (!st) return; st.textContent = st.textContent.replace(new RegExp(`(--${n}\\s*:\\s*)([^;]+)(;)`), `$1${v}$3`); markDirty(); }

/* guardar */
function serialize() {
  if (editing) endEdit();
  const keep = n => n.matches('meta, title') || (n.matches('link') && /fonts\.(googleapis|gstatic)\.com/.test(n.getAttribute('href') || '')) || (n.matches('style') && HEAD_IDS.includes(n.id));
  const head = [...doc.head.children].filter(keep).map(n => n.outerHTML).join('\n');
  const d = deck.cloneNode(true);
  untex(d);
  d.removeAttribute('style');
  $$('.slide', d).forEach(s => { s.classList.remove('actual'); s.removeAttribute('data-n'); });
  $$('[contenteditable]', d).forEach(n => n.removeAttribute('contenteditable'));
  $$('.escribiendo', d).forEach(n => n.classList.remove('escribiendo'));
  $$('*', d).forEach(n => [...n.attributes].forEach(a => { if (/^data-(gr|gramm|new-gr|lt-)/.test(a.name) || a.name === 'spellcheck') n.removeAttribute(a.name); }));
  const lead = [...doc.childNodes].filter(n => n.nodeType === 8).map(n => `<!--${n.data}-->`).join('\n');
  const titulo = doc.title.replace(/^Presentador · /, '');
  const motor = doc.getElementById('motor').textContent;
  return `<!DOCTYPE html>\n${lead}${lead ? '\n' : ''}<html lang="${esc(html.lang || 'es')}">\n<head>\n${head.replace(/<title>[^<]*<\/title>/, '<title>' + esc(titulo) + '</title>')}\n</head>\n<body>\n${d.outerHTML}\n\n<script id="motor">${motor}<\/script>\n</body>\n</html>\n`;
}
function idb(op, key, val) {
  return new Promise(res => {
    let r; try { r = indexedDB.open('diapo', 1); } catch (_) { res(null); return; }
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const tx = r.result.transaction('h', op === 'set' ? 'readwrite' : 'readonly'), st = tx.objectStore('h');
        const q = op === 'set' ? st.put(val, key) : st.get(key);
        q.onsuccess = () => res(op === 'set' ? true : (q.result || null)); q.onerror = () => res(null);
      } catch (_) { res(null); }
    };
  });
}
async function saveServer(out, force) {
  const q = `archivo=${encodeURIComponent(SERVER.archivo)}&base=${encodeURIComponent(SERVER.hash)}${force ? '&forzar=1' : ''}`;
  const r = await fetch('/__diapo/guardar?' + q, { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: out });
  if (r.status === 409) {
    if (confirm('El archivo cambió afuera mientras editabas (¿Claude?).\n\nAceptar: guardar tu versión igual. La otra queda en .diapo/respaldos.\nCancelar: no guardar todavía.')) return saveServer(out, true);
    return false;
  }
  if (!r.ok) throw new Error('El servidor no pudo guardar (' + r.status + ').');
  const j = await r.json(); SERVER.hash = j.hash;
  return true;
}
async function save(asNew) {
  if (PREVIEW) { toast('Esta copia es solo para mirar: los cambios se guardan en el archivo local.'); return; }
  const out = serialize();
  if (SERVER && !asNew) {
    saving = true;
    try {
      if (await saveServer(out, false)) { markClean(); $('#aviso-externo').classList.remove('visible'); toast('Guardado en ' + SERVER.archivo); }
    } catch (err) { toast(err.message, 4000); }
    finally { saving = false; checkServer(); }
    return;
  }
  if (window.showSaveFilePicker) {
    try {
      let h = asNew ? null : (fileHandle || await idb('get', KEY));
      if (h) {
        let perm = await h.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await h.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') h = null;
      }
      if (!h) {
        h = await window.showSaveFilePicker({ suggestedName: ARCHIVO, types: [{ description: 'Página HTML', accept: { 'text/html': ['.html', '.htm'] } }] });
        if (!asNew) await idb('set', KEY, h);
      }
      const w = await h.createWritable(); await w.write(out); await w.close();
      if (!asNew) fileHandle = h;
      markClean(); toast('Guardado en ' + h.name + (h.name !== ARCHIVO ? ' (ojo: no es el archivo que tenés abierto)' : ''));
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('No pude guardar directo; bajo una copia.', err);
    }
  }
  const a = mk('a', { href: URL.createObjectURL(new Blob([out], { type: 'text/html' })), download: ARCHIVO });
  doc.body.appendChild(a); a.click(); a.remove();
  markClean(); toast('Bajé una copia: reemplazá el archivo original por esa.');
}

/* servidor de `diapo ver`: guardar directo y enterarse de los cambios de Claude */
async function detectServer() {
  if (!/^https?:$/.test(location.protocol) || PREVIEW) return;
  const archivo = decodeURIComponent(location.pathname.replace(/^\/+/, ''));
  try {
    const r = await fetch('/__diapo/estado?archivo=' + encodeURIComponent(archivo), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    SERVER = { archivo, hash: j.hash, chat: !!j.chat, modelo: j.modelo || '' };
    if (Array.isArray(j.historial)) chatLog = j.historial;
    if (j.chat_ocupado) chatSetBusy(true);
  } catch (_) { return; }
  html.classList.add('con-servidor');
  html.classList.toggle('chat-disponible', SERVER.chat);
  const s = $('#barra .servidor'); if (s) s.textContent = '· guarda en el archivo vía diapo ver';
  const es = new EventSource('/__diapo/eventos?archivo=' + encodeURIComponent(archivo));
  es.addEventListener('cambio', ev => {
    let d; try { d = JSON.parse(ev.data); } catch (_) { return; }
    if (saving || d.hash === SERVER.hash) return;
    externalChange(d.hash);
  });
  es.addEventListener('chat', ev => { if (PRES) return; let d; try { d = JSON.parse(ev.data); } catch (_) { return; } chatEvent(d); });
  if (chatWanted || store('get', CHAT_KEY + ':abierto')) toggleChat(true);
}
/* después de guardar: si alguien escribió el archivo mientras tanto, avisar */
async function checkServer() {
  try {
    const r = await fetch('/__diapo/estado?archivo=' + encodeURIComponent(SERVER.archivo), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j.hash) externalChange(j.hash); }
  } catch (_) {}
}
function reopenAfterReload() { store('set', KEY + ':reabrir', JSON.stringify({ editar: editMode, notas: notesOpen, chat: chatOpen })); }
function avisoExterno() {
  const b = $('#aviso-externo');
  $('.ae-texto', b).textContent = 'El archivo cambió afuera (¿Claude?). Tus cambios sin guardar siguen acá.';
  b.classList.add('visible');
}
/* un cambio de afuera se aplica sin recargar, como un paso más: Ctrl+Z lo deshace */
let swapping = null;
function externalChange(h) {
  if (!SERVER || h === SERVER.hash) return;
  if (dirty) { avisoExterno(); return; }
  if (swapping) { swapping.otra = true; return; }
  swapping = { otra: false };
  hotSwap().then(ok => {
    const otra = swapping.otra; swapping = null;
    if (!ok) { reopenAfterReload(); location.reload(); return; }
    if (otra) checkServer();
  });
}
async function hashOf(buf) {
  try { const d = await crypto.subtle.digest('SHA-1', buf); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); } catch (_) { return null; }
}
async function hotSwap() {
  let buf;
  try { const r = await fetch(location.pathname + '?diapo=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return false; buf = await r.arrayBuffer(); } catch (_) { return false; }
  const nd = new DOMParser().parseFromString(new TextDecoder().decode(buf), 'text/html');
  const nuevo = nd.getElementById('deck'), m = nd.getElementById('motor'), mc = nd.getElementById('motor-css');
  if (!nuevo || !m || m.textContent !== doc.getElementById('motor').textContent) return false;
  if (!mc || !$('#motor-css') || mc.textContent !== $('#motor-css').textContent) return false;
  if (nuevo.dataset.ancho !== deck.dataset.ancho || nuevo.dataset.alto !== deck.dataset.alto) return false;
  const h = await hashOf(buf);
  if (dirty) { avisoExterno(); return true; }
  if (editing) endEdit();
  const antes = ($('#tema') || {}).textContent + ($('#estilos') || {}).textContent;
  snapshot(true);
  ['fuentes', 'tema', 'estilos'].forEach(id => { const a = doc.getElementById(id), b = nd.getElementById(id); if (a && b && a.textContent !== b.textContent) a.textContent = b.textContent; });
  if (nd.title && !PRES) doc.title = nd.title;
  deck.innerHTML = nuevo.innerHTML;
  sel = null; refresh();
  renderTex();
  if (($('#tema') || {}).textContent + ($('#estilos') || {}).textContent !== antes) rebuildBar();
  go(Math.min(idx, slides.length - 1), { remote: true });
  if (overviewOpen) openOverview();
  if (h) SERVER.hash = h; else { try { const r = await fetch('/__diapo/estado?archivo=' + encodeURIComponent(SERVER.archivo), { cache: 'no-store' }); SERVER.hash = (await r.json()).hash; } catch (_) {} }
  markClean();
  if (!chatOpen && !PRES) toast('La presentación cambió afuera y ya está al día. Ctrl+Z deshace el cambio.', 3600);
  return true;
}

/* ecuaciones: $…$ y $$…$$ en los textos, con KaTeX de la carpeta katex/ que está al lado del archivo */
const TEX_RE = /\$\$([\s\S]+?)\$\$|\$(?=\S)((?:\\\$|[^$\n])+?)(?<=\S)\$(?!\d)/g;
function loadKatex() {
  if (window.katex) return Promise.resolve(true);
  if (!loadKatex.p) loadKatex.p = new Promise(res => {
    doc.head.appendChild(mk('link', { rel: 'stylesheet', href: 'katex/katex.min.css' }));
    const sc = mk('script', { src: 'katex/katex.min.js' });
    sc.onload = () => res(!!window.katex); sc.onerror = () => res(false);
    doc.head.appendChild(sc);
  });
  return loadKatex.p;
}
function texEl(el) {
  const tw = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest('.tex, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodos = []; while (tw.nextNode()) if (tw.currentNode.nodeValue.includes('$')) nodos.push(tw.currentNode);
  nodos.forEach(n => {
    const t = n.nodeValue; let last = 0, m, hubo = false;
    const frag = doc.createDocumentFragment();
    TEX_RE.lastIndex = 0;
    while ((m = TEX_RE.exec(t))) {
      hubo = true;
      if (m.index > last) frag.appendChild(doc.createTextNode(t.slice(last, m.index)));
      const bloque = m[1] != null, src = bloque ? m[1] : m[2];
      const sp = mk('span', { class: 'tex', 'data-tex': src, contenteditable: 'false' });
      if (bloque) sp.setAttribute('data-bloque', '');
      try { window.katex.render(src, sp, { displayMode: bloque, throwOnError: false }); } catch (_) { sp.textContent = m[0]; sp.classList.add('tex-error'); }
      frag.appendChild(sp); last = m.index + m[0].length;
    }
    if (!hubo) return;
    if (last < t.length) frag.appendChild(doc.createTextNode(t.slice(last)));
    n.parentNode.replaceChild(frag, n);
  });
}
function untex(root) {
  $$('span.tex', root).forEach(sp => { const d = sp.hasAttribute('data-bloque') ? '$$' : '$'; sp.replaceWith(doc.createTextNode(d + sp.dataset.tex + d)); });
  root.normalize();
}
async function renderTex(root = deck) {
  if (!/\$[^$]+\$/.test(root.textContent || '')) return false;
  if (!(await loadKatex())) return false;
  (root.matches && root.matches('.el') ? [root] : $$('.el', root)).forEach(el => { if (el !== editing) texEl(el); });
  positionFrame();
  return true;
}

/* chat con Claude: el servidor de `diapo ver` le pasa los pedidos a Claude Code sin ventana */
const CHAT_KEY = KEY + ':chat';
let chatOpen = false, chatWanted = false, chatBusy = false, chatT0 = 0, chatTimer = 0;
let chatLog = [];
function chatAdd(rol, texto, extra) { chatLog.push({ rol, texto, ...(extra || {}) }); if (chatLog.length > 300) chatLog = chatLog.slice(-300); chatRender(); }
function chatFmt(t) { return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }
function buildChat() {
  const p = mk('div', { id: 'chat-panel', 'data-ui': '' }, `
    <div class="cp-cab"><b>Claude</b><span class="cp-modelo"></span><button type="button" data-c="nueva" title="Empezar otra conversación">Nueva</button><button type="button" data-c="cerrar" title="Cerrar (C)">×</button></div>
    <div class="cp-log" aria-live="polite"></div>
    <div class="cp-ctx"></div>
    <form class="cp-form"><textarea id="chat-texto" rows="3" placeholder="Pedile un cambio. Enter manda; Shift+Enter, otra línea." aria-label="Mensaje para Claude"></textarea>
    <div class="cp-botones"><span class="cp-estado"></span><button type="button" data-c="parar" title="Cortar lo que está haciendo">Parar</button><button type="submit" class="principal">Enviar</button></div></form>`);
  doc.body.appendChild(p);
  const ta = $('textarea', p);
  $('form', p).addEventListener('submit', e => { e.preventDefault(); const v = ta.value; if (!v.trim() || chatBusy) return; ta.value = ''; chatSend(v); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form', p).requestSubmit(); }
    else if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
  });
  p.addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'cerrar') toggleChat(false);
    else if (b.dataset.c === 'parar') chatPost('parar');
    else if (b.dataset.c === 'nueva' && (!chatLog.length || confirm('¿Empezar otra conversación? Claude se olvida de lo que hablaron; los cambios en la presentación quedan.'))) chatPost('nueva');
  });
  new ResizeObserver(() => { if (chatOpen) layout(); }).observe(p);
  return p;
}
function toggleChat(v) {
  if (PRES) return;
  if (PREVIEW) { toast('Esta copia es solo para mirar.'); return; }
  if (!SERVER) { toast('El chat con Claude funciona si abrís la presentación con diapo ver.', 4200); return; }
  if (!SERVER.chat) { toast('No encuentro Claude Code (el comando claude) en esta compu.', 4200); return; }
  chatOpen = typeof v === 'boolean' ? v : !chatOpen; chatWanted = false;
  store(chatOpen ? 'set' : 'del', CHAT_KEY + ':abierto', '1');
  const p = $('#chat-panel') || buildChat();
  html.classList.toggle('con-chat', chatOpen);
  if (chatOpen) { chatRender(); chatCtx(); chatHead(); chatSetBusy(chatBusy); setTimeout(() => $('textarea', p).focus(), 0); }
  layout();
}
function chatHead() { const m = $('#chat-panel .cp-modelo'); if (m) m.textContent = SERVER && SERVER.modelo ? SERVER.modelo : 'Claude Code con tu cuenta'; }
function chatCtxText() {
  const s = cur(); if (!s) return '';
  const t = s.dataset.titulo ? ` «${s.dataset.titulo}»` : '';
  return `Slide ${idx + 1}${t}` + (sel && s.contains(sel) ? ` · elegido: ${describe(sel)}` : '');
}
function chatCtx() { if (!chatOpen) return; const c = $('#chat-panel .cp-ctx'); if (c) c.textContent = 'Va con: ' + chatCtxText(); }
function chatRender() {
  const log = $('#chat-panel .cp-log'); if (!log) return;
  log.innerHTML = chatLog.length ? chatLog.map(m => m.rol === 'yo'
    ? `<div class="cp-yo">${chatFmt(m.texto)}${m.ctx ? `<small>${esc(m.ctx)}</small>` : ''}</div>`
    : `<div class="cp-${m.rol}">${chatFmt(m.texto)}</div>`).join('')
    : '<p class="cp-vacio">Pedile cambios en castellano: «acortá esta frase», «armá una slide con estos tres datos», «resolvé los pedidos». Sabe en qué slide estás y qué elemento elegiste. Lo que cambia aparece enseguida y Ctrl+Z lo deshace.</p>';
  log.scrollTop = log.scrollHeight;
}
function chatSetBusy(b) {
  chatBusy = b;
  const p = $('#chat-panel'); if (!p) return;
  p.classList.toggle('ocupado', b);
  $('button[type="submit"]', p).disabled = b;
  clearInterval(chatTimer);
  const st = $('.cp-estado', p);
  if (b) { chatT0 = chatT0 || Date.now(); const tic = () => { st.textContent = `Claude está trabajando · ${Math.round((Date.now() - chatT0) / 1000)} s`; }; tic(); chatTimer = setInterval(tic, 1000); }
  else { chatT0 = 0; st.textContent = ''; }
}
async function chatPost(que, body) {
  try {
    const r = await fetch(`/__diapo/chat${que ? '/' + que : ''}?archivo=` + encodeURIComponent(SERVER.archivo), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (r.ok) return true;
    const j = await r.json().catch(() => ({}));
    chatAdd('error', j.error || `El servidor respondió ${r.status}.`);
  } catch (_) { chatAdd('error', 'No pude hablar con el servidor de diapo. ¿Sigue abierto diapo ver?'); }
  return false;
}
async function chatSend(texto) {
  texto = String(texto || '').trim(); if (!texto) return false;
  if (!SERVER || !SERVER.chat) { toggleChat(true); return false; }
  if (chatBusy) { toast('Claude todavía está trabajando. Esperá o apretá Parar.'); return false; }
  if (editing) endEdit();
  if (dirty) { await save(); if (dirty) { chatAdd('error', 'Antes de mandar el pedido hay que guardar tus cambios, y no se guardaron. Guardá con Ctrl+S y volvé a mandarlo.'); return false; } }
  const els = cur() ? $$(':scope > .el', cur()) : [];
  const ctx = chatCtxText();
  chatAdd('yo', texto, { ctx });
  chatSetBusy(true);
  const ok = await chatPost('', { texto, ctx, slide: idx + 1, elemento: sel && els.includes(sel) ? els.indexOf(sel) : null });
  if (!ok) chatSetBusy(false);
  return ok;
}
function chatEvent(d) {
  switch (d.tipo) {
    case 'pensando': chatSetBusy(true); break;
    case 'modelo': if (SERVER) SERVER.modelo = d.modelo; chatHead(); break;
    case 'paso': chatAdd('paso', d.texto); break;
    case 'texto': chatAdd('claude', d.texto); break;
    case 'info': chatAdd('info', d.texto); break;
    case 'fin': chatSetBusy(false); if (d.ok) chatAdd('meta', `${d.segundos} s`); else chatAdd('error', d.texto || 'Claude no terminó bien.'); break;
    case 'error': chatSetBusy(false); chatAdd('error', d.texto); break;
    case 'parado': chatSetBusy(false); chatAdd('info', 'Lo paré. El próximo mensaje sigue la misma conversación.'); break;
    case 'nueva': chatSetBusy(false); chatLog = []; chatRender(); break;
  }
}

/* teclado */
addEventListener('keydown', e => {
  const k = e.key, mod = e.ctrlKey || e.metaKey, t = e.target, lk = (k || '').toLowerCase();
  if (mod && lk === 's') { e.preventDefault(); if (!PRES) save(e.shiftKey); return; }
  if (t && t.closest && t.closest('#barra input, #barra select, #tema-panel, #pedidos-panel, #chat-panel, #notas-panel .np-cuerpo[contenteditable="true"]')) return;
  if (PRES) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0); else if (k === 'End') go(slides.length - 1);
    else if (lk === 'r') { t0 = Date.now(); tick(); }
    return;
  }
  if ($('#ayuda').classList.contains('visible')) { if (k === 'Escape' || k === '?' || lk === 'h') { e.preventDefault(); toggleHelp(false); } return; }
  if (overviewOpen) { if (k === 'Escape' || lk === 'o') { e.preventDefault(); closeOverview(); } return; }
  if ($('#negro').classList.contains('visible')) { if (lk === 'b' || k === '.' || k === 'Escape') { e.preventDefault(); toggleBlack(); } return; }
  if (editing) { if (k === 'Escape') { e.preventDefault(); endEdit(); } return; }
  if (editMode) {
    if (mod && lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && lk === 'y') { e.preventDefault(); redo(); return; }
    if (mod && lk === 'd') { e.preventDefault(); dupEl(); return; }
    if (sel && !mod) {
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); delEl(); return; }
      if (k === 'Enter' || k === 'F2') { e.preventDefault(); if (isText(sel)) startEdit(sel, true); else pickImage(sel); return; }
      if (k.startsWith('Arrow')) { e.preventDefault(); nudge(k, e.shiftKey ? 10 : 1); return; }
      if (k === 'Escape') { e.preventDefault(); select(null); return; }
    }
    if (k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); return; }
  }
  if (mod || e.altKey) return;
  switch (k) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': e.preventDefault(); next(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': e.preventDefault(); prev(); break;
    case 'Home': e.preventDefault(); go(0); break;
    case 'End': e.preventDefault(); go(slides.length - 1); break;
    case 'e': case 'E': toggleEdit(); break;
    case 'n': case 'N': toggleNotes(); break;
    case 'o': case 'O': openOverview(); break;
    case 'p': case 'P': openPresenter(); break;
    case 'c': case 'C': toggleChat(); break;
    case 'f': case 'F': toggleFull(); break;
    case 'b': case 'B': case '.': toggleBlack(); break;
    case '?': case 'h': case 'H': toggleHelp(); break;
  }
});
addEventListener('pointermove', () => {
  if (editMode || PRES) return;
  const p = $('#pista'); if (!p) return;
  p.classList.add('visible'); clearTimeout(hintTimer);
  hintTimer = setTimeout(() => p.classList.remove('visible'), 2600);
});

/* inicio */
function init() {
  if (PREVIEW) html.classList.add('vista-previa');
  buildUI();
  refresh();
  if (PRES) setupPresenter();
  const h = parseInt(location.hash.slice(1), 10);
  go(Number.isFinite(h) ? h - 1 : 0, { remote: true });
  layout();
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(layout);
  addEventListener('resize', layout);
  addEventListener('hashchange', () => { const n = parseInt(location.hash.slice(1), 10); if (Number.isFinite(n) && n - 1 !== idx) go(n - 1); });
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  if (!PRES) { const p = $('#pista'); p.classList.add('visible'); hintTimer = setTimeout(() => p.classList.remove('visible'), 4000); }
  const re = store('get', KEY + ':reabrir');
  if (re) { store('del', KEY + ':reabrir'); try { const o = JSON.parse(re); if (o.editar) toggleEdit(true); if (o.notas) toggleNotes(true); if (o.chat) chatWanted = true; } catch (_) {} }
  else if (params.has('editar')) toggleEdit(true);
  detectServer();
  renderTex();
  window.deckAPI = window.diapo = {
    version: VERSION, go, next, prev, serialize, tex: () => renderTex(), save, toggleEdit, moveSlide, undo, redo, openOverview, closeOverview, toggleNotes,
    select: el => select(el), setVar, pedidos: () => $$('[data-pedido]', deck).map(el => ({ slide: slides.indexOf(el.closest('section.slide')) + 1, texto: el.dataset.pedido })),
    get idx() { return idx; }, get total() { refresh(); return slides.length; }, get sel() { return sel; }, get dirty() { return dirty; },
    get editing() { return editing; }, get scale() { return scale; }, get servidor() { return SERVER; },
    chat: { abrir: () => toggleChat(true), cerrar: () => toggleChat(false), enviar: chatSend, get ocupado() { return chatBusy; }, get log() { return chatLog.slice(); } }
  };
}
init();
})();
