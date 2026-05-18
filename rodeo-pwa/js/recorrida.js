/**
 * recorrida.js — Grabación de audio para recorridas de campo
 *
 * Usa la Web MediaRecorder API (disponible en Chrome Android, Safari iOS 14.5+).
 * El audio se guarda como Blob en IndexedDB y se reproduce localmente.
 * No requiere red para grabar ni reproducir.
 */

import db, { crearMetadatos, DEVICE_ID } from './db.js';
import { sincronizarMedia } from './sync.js';

// ─── Estado interno ───────────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let streamActual  = null;
let timerInterval = null;
let segundos      = 0;
let audioContext  = null;
let analyser      = null;
let animFrame     = null;
let blobActual    = null;

// ─── Init del módulo ──────────────────────────────────────────────────────────
export function inicializarRecorrida(onToast) {
  const btnRec       = document.getElementById('btn-rec');
  const btnGuardar   = document.getElementById('btn-rec-guardar');
  const btnDescartar = document.getElementById('btn-rec-descartar');

  if (!btnRec) return;

  btnRec.addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      iniciarGrabacion(onToast);
    } else if (mediaRecorder.state === 'recording') {
      detenerGrabacion();
    }
  });

  btnGuardar.addEventListener('click', () => guardarRecorrida(onToast));
  btnDescartar.addEventListener('click', () => descartarRecorrida());
}

// ─── Iniciar grabación ────────────────────────────────────────────────────────
async function iniciarGrabacion(onToast) {
  try {
    streamActual = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      }
    });
  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Permiso de micrófono denegado. Habilitalo desde la configuración del navegador.'
      : `Error al acceder al micrófono: ${err.message}`;
    onToast(msg, 'error', 5000);
    return;
  }

  audioChunks = [];
  blobActual  = null;

  // Determinar formato soportado
  const mimeType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find(t => MediaRecorder.isTypeSupported(t)) || '';

  mediaRecorder = new MediaRecorder(streamActual, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 32_000,  // 32 kbps — voz de campo perfectamente inteligible, 75% más liviano
  });

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const tipo = mimeType || 'audio/webm';
    blobActual = new Blob(audioChunks, { type: tipo });
    mostrarPreview(blobActual);
    detenerWaveform();
    detenerTimer();
    setEstado('listo');
  };

  mediaRecorder.start(250); // chunk cada 250ms

  iniciarTimer();
  iniciarWaveform(streamActual);
  setEstado('grabando');

  // Ocultar preview anterior
  document.getElementById('rec-preview').classList.add('oculto');
}

// ─── Detener grabación ────────────────────────────────────────────────────────
function detenerGrabacion() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (streamActual) {
    streamActual.getTracks().forEach(t => t.stop());
    streamActual = null;
  }
}

// ─── Guardar en IndexedDB ─────────────────────────────────────────────────────
async function guardarRecorrida(onToast) {
  if (!blobActual) return;

  const btn = document.getElementById('btn-rec-guardar');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const operador = localStorage.getItem('rodeo_operador') || 'Operador';
    const recorrida = {
      ...crearMetadatos(),
      fecha: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
      hora:  new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }),
      duracion_seg: segundos,
      operador,
      audio_blob: blobActual,
      audio_tipo: blobActual.type,
      audio_size: blobActual.size,
      storage_url: null,   // se rellena tras subir al NAS
      storage_key: null,
    };

    const id = await db.recorridas.add(recorrida);
    onToast(`✓ Recorrida guardada (${formatearTiempo(segundos)})`, 'exito', 3000);

    // ⚠️ Capturar referencia al blob ANTES de descartarRecorrida()
    // porque descartarRecorrida() pone blobActual = null
    const blobParaSubir = blobActual;
    descartarRecorrida();
    await cargarListaRecorridas();

    // Subida en background al NAS (MinIO) — no bloquea la UI
    subirAudioEnBackground(id, blobParaSubir, operador, onToast);

  } catch (err) {
    onToast(`✗ Error al guardar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar recorrida';
  }
}

// ─── Subida al NAS via proxy Vercel (evita CORS de MinIO) ─────────────────────
async function subirAudioEnBackground(recorridaId, blob, operador, onToast) {
  if (!navigator.onLine) {
    console.log('[Recorrida] Sin red — audio queda local hasta reconectar');
    return;
  }
  if (!blob) {
    console.warn('[Recorrida] blob es null — no se puede subir');
    return;
  }

  try {
    // Convertir blob → base64 (necesario para enviarlo como JSON al proxy)
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]); // quitar "data:...;base64,"
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Subir via proxy Vercel → MinIO (server-side, sin CORS)
    const resp = await fetch('/api/subir-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo:     'audio',
        base64:   base64,
        mimeType: blob.type || 'audio/webm',
        operador: operador,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`subir-media HTTP ${resp.status}: ${txt.slice(0,200)}`);
    }

    const result = await resp.json();
    if (!result.ok) throw new Error(result.error || 'Error desconocido en subir-media');
    const { publicUrl, objectKey } = result;

    // Actualizar registro local con la URL
    const recorridaActualizada = await db.recorridas.get(recorridaId);
    await db.recorridas.update(recorridaId, {
      storage_url:  publicUrl,
      storage_key:  objectKey,
    });

    // Sincronizar metadata a Sheets para que aparezca en otros dispositivos
    if (recorridaActualizada) {
      await sincronizarMedia('recorrida', {
        ...recorridaActualizada,
        storage_url: publicUrl,
        storage_key: objectKey,
      });
    }

    onToast('☁ Audio subido al servidor', 'info', 2500);
    await cargarListaRecorridas();

  } catch (err) {
    console.error('[Recorrida] Subida fallida:', err.message);
    onToast(`✗ Error al subir audio: ${err.message}`, 'error');
  }
}

// ─── Descartar ────────────────────────────────────────────────────────────────
function descartarRecorrida() {
  blobActual = null;
  audioChunks = [];
  segundos = 0;
  actualizarTimer(0);

  const preview = document.getElementById('rec-preview');
  const audio   = document.getElementById('rec-audio');
  if (audio.src) { URL.revokeObjectURL(audio.src); audio.src = ''; }
  preview.classList.add('oculto');

  document.getElementById('rec-canvas').classList.add('oculto');
  setEstado('listo');
}

// ─── Mostrar preview del audio grabado ───────────────────────────────────────
function mostrarPreview(blob) {
  const url   = URL.createObjectURL(blob);
  const audio = document.getElementById('rec-audio');
  audio.src   = url;

  document.getElementById('rec-canvas').classList.add('oculto');
  document.getElementById('rec-preview').classList.remove('oculto');
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function iniciarTimer() {
  segundos = 0;
  actualizarTimer(0);
  timerInterval = setInterval(() => {
    segundos++;
    actualizarTimer(segundos);
  }, 1000);
}

function detenerTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function actualizarTimer(seg) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  document.getElementById('rec-timer').textContent =
    `${m}:${s.toString().padStart(2, '0')}`;
}

function formatearTiempo(seg) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Waveform (visualizador de ondas) ────────────────────────────────────────
function iniciarWaveform(stream) {
  const canvas  = document.getElementById('rec-canvas');
  canvas.classList.remove('oculto');

  const ctx     = canvas.getContext('2d');
  const W       = canvas.offsetWidth;
  const H       = canvas.height;
  canvas.width  = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser     = audioContext.createAnalyser();
  analyser.fftSize = 256;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const bufLen  = analyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    animFrame = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArr);

    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--gris-claro').trim() || '#f3f4f6';
    ctx.fillRect(0, 0, W, H);

    ctx.lineWidth   = 2.5;
    ctx.strokeStyle = '#dc2626';
    ctx.beginPath();

    const slice = W / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = dataArr[i] / 128;
      const y = (v * H) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }

  draw();
}

function detenerWaveform() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
}

// ─── Estado visual ────────────────────────────────────────────────────────────
function setEstado(estado) {
  const btnRec   = document.getElementById('btn-rec');
  const btnIcono = document.getElementById('btn-rec-icono');
  const btnTexto = document.getElementById('btn-rec-texto');
  const recEst   = document.getElementById('rec-estado');
  const recTimer = document.getElementById('rec-timer');

  if (estado === 'grabando') {
    btnRec.classList.add('grabando');
    btnIcono.textContent  = '⏹';
    btnTexto.textContent  = 'Detener';
    recEst.textContent    = '● Grabando...';
    recEst.classList.add('grabando');
    recTimer.classList.add('grabando');
  } else {
    btnRec.classList.remove('grabando');
    btnIcono.textContent  = '🎙';
    btnTexto.textContent  = 'Iniciar recorrida';
    recEst.textContent    = 'Listo para grabar';
    recEst.classList.remove('grabando');
    recTimer.classList.remove('grabando');
  }
}

// ─── Cargar historial de recorridas ──────────────────────────────────────────
export async function cargarListaRecorridas() {
  const lista = document.getElementById('lista-recorridas');
  if (!lista) return;

  let recorridas = [];
  try {
    recorridas = await db.recorridas.orderBy('timestamp_local').reverse().toArray();
  } catch {
    lista.innerHTML = '<p class="sin-historial">Sin recorridas grabadas</p>';
    return;
  }

  if (!recorridas.length) {
    lista.innerHTML = '<p class="sin-historial">Sin recorridas grabadas</p>';
    return;
  }

  lista.innerHTML = recorridas.map((r, i) => `
    <div class="recorrida-item">
      <div class="recorrida-item-header">
        <div class="recorrida-fecha">${r.fecha} ${r.hora}</div>
        <div class="recorrida-duracion">${formatearTiempo(r.duracion_seg)}</div>
      </div>
      <div class="recorrida-operador">👤 ${r.operador}</div>
      <audio
        class="recorrida-player"
        controls
        data-id="${r.id}"
        preload="none"
      ></audio>
    </div>
  `).join('');

  // Cargar blob en cada player (IndexedDB → ObjectURL)
  recorridas.forEach(async (r, i) => {
    const audioEl = lista.querySelectorAll('.recorrida-player')[i];
    if (!audioEl || !r.audio_blob) return;
    const url = URL.createObjectURL(r.audio_blob);
    audioEl.src = url;
    // Liberar URL cuando se descargue el componente
    audioEl.onended = () => {}; // mantener para replay
  });
}
