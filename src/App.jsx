import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";

/* ================= Config ================= */
const PTS = [10, 8, 6, 5, 4];
const PTS_PART = 2;
const REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== Conexión a Supabase (base de datos) ===== */
const SUPABASE_URL = "https://ereginsabjkoeopydnmi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyZWdpbnNhYmprb2VvcHlkbm1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMjAxODksImV4cCI6MjA5ODg5NjE4OX0._P88jMQp7DP3HyAUZEv1rw5K83M_wrPD69zxfAnobs4";
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};
// Helper genérico para la API REST de Supabase (PostgREST)
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...SB_HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Sube un archivo (PDF/imagen) a Supabase Storage y devuelve su URL pública
async function sbUpload(file) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}_${safe}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/presentaciones/${encodeURIComponent(path)}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Storage ${res.status}: ${txt}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/presentaciones/${encodeURIComponent(path)}`;
}

/* ================= Utilidades ================= */
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const phraseKey = (s) => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const ACCESS_PHRASE_KEY = "firmes en la fe sobre la roca";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const initials = (name) =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function mapUsers(userRows = []) {
  return (userRows || []).map((u) => ({
    id: u.id,
    name: u.name,
    passHash: u.pass_hash,
    birthdate: u.birthdate || "",
    retreatDate: u.retreat_date || "",
    expectations: u.expectations || "",
    linkedCanon: u.linked_canon || "",
  }));
}

/* ===== Carga: arma el objeto 'data' leyendo las 4 tablas ===== */
async function loadData() {
  try {
    const [configRows, routeRows, exRows, userRows] = await Promise.all([
      sbFetch("config?id=eq.main&select=data"),
      sbFetch("route?id=eq.main&select=data"),
      sbFetch("exercises?select=id,data&order=created_at.asc"),
      sbFetch("users?select=*&order=created_at.asc"),
    ]);
    const config = (configRows && configRows[0] && configRows[0].data) || {};
    const route = (routeRows && routeRows[0] && routeRows[0].data) || emptyRoute();
    const exercises = (exRows || []).map((r) => ({ id: r.id, ...r.data }));
    const users = mapUsers(userRows);
    return {
      pin: config.pin ?? null,
      aliases: config.aliases || {},
      excluded: config.excluded || [],
      route,
      exercises,
      users,
    };
  } catch (e) {
    console.error("loadData Supabase:", e);
    return null;
  }
}

async function loadAuthData() {
  try {
    const [configRows, userRows] = await Promise.all([
      sbFetch("config?id=eq.main&select=data"),
      sbFetch("users?select=*&order=created_at.asc"),
    ]);
    const config = (configRows && configRows[0] && configRows[0].data) || {};
    return {
      ...emptyData(),
      pin: config.pin ?? null,
      aliases: config.aliases || {},
      excluded: config.excluded || [],
      users: mapUsers(userRows),
    };
  } catch (e) {
    console.error("loadAuthData Supabase:", e);
    return null;
  }
}

/* ===== Guardado inteligente: detecta qué cambió y actualiza solo esa tabla ===== */
async function saveData(next, prev) {
  const jobs = [];
  const p = prev || {};

  // config (pin, aliases, excluded)
  const cfgNext = { pin: next.pin ?? null, aliases: next.aliases || {}, excluded: next.excluded || [] };
  const cfgPrev = { pin: p.pin ?? null, aliases: p.aliases || {}, excluded: p.excluded || [] };
  if (JSON.stringify(cfgNext) !== JSON.stringify(cfgPrev)) {
    jobs.push(sbFetch("config?id=eq.main", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ data: cfgNext, updated_at: new Date().toISOString() }),
    }));
  }

  // route
  if (JSON.stringify(next.route || {}) !== JSON.stringify(p.route || {})) {
    jobs.push(sbFetch("route?id=eq.main", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ data: next.route || emptyRoute(), updated_at: new Date().toISOString() }),
    }));
  }

  // exercises: upsert de los cambiados, delete de los eliminados
  const nextEx = next.exercises || [];
  const prevEx = p.exercises || [];
  const prevIds = new Set(prevEx.map((e) => e.id));
  const nextIds = new Set(nextEx.map((e) => e.id));
  for (const ex of nextEx) {
    const before = prevEx.find((e) => e.id === ex.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(ex)) {
      const { id, ...rest } = ex;
      jobs.push(sbFetch("exercises", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id, data: rest }),
      }));
    }
  }
  for (const ex of prevEx) {
    if (!nextIds.has(ex.id)) {
      jobs.push(sbFetch(`exercises?id=eq.${encodeURIComponent(ex.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }));
    }
  }

  // users: upsert de cambiados, delete de eliminados
  const nextUsers = next.users || [];
  const prevUsers = p.users || [];
  const nextUserIds = new Set(nextUsers.map((u) => u.id));
  for (const u of nextUsers) {
    const before = prevUsers.find((x) => x.id === u.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(u)) {
      jobs.push(sbFetch("users", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: u.id, name: u.name, pass_hash: u.passHash,
          birthdate: u.birthdate || null, retreat_date: u.retreatDate || null,
          expectations: u.expectations || null, linked_canon: u.linkedCanon || null,
        }),
      }));
    }
  }
  for (const u of prevUsers) {
    if (!nextUserIds.has(u.id)) {
      jobs.push(sbFetch(`users?id=eq.${encodeURIComponent(u.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }));
    }
  }

  await Promise.all(jobs);
  return next;
}
const emptyData = () => ({ pin: null, aliases: {}, exercises: [], excluded: [], route: emptyRoute(), users: [] });
const emptyRoute = () => ({ title: "Ruta de Preparación", blocks: [] });
/* Un bloque de la ruta formativa:
   { id, title, subtitle, pptUrl, resources: [ { id, type: 'game'|'video', label, url, slide } ] }
   slide = número de lámina donde aparece el recurso (opcional, informativo) */
const emptyBlock = () => ({ id: uid(), title: "", subtitle: "", pptUrl: "", resources: [], locked: false });

/* ====== Usuarios (perfil de participante) ======
   { id, name, passHash, birthdate, retreatDate, expectations, linkedCanon }
   Nota: passHash NO es seguridad real, solo ofusca la clave. El almacenamiento
   del artifact no es privado; esto se comunica al usuario en la interfaz. */
function lightHash(str) {
  // hash simple determinístico (djb2) — evita guardar la clave en texto plano
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  return (h >>> 0).toString(36);
}
function ageFromBirth(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });
}

/* ====== Normalización de URLs para embeber ====== */
function toEmbedUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  // Google Slides: .../presentation/d/ID/edit -> /embed
  let m = u.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false`;
  // Google Docs / Sheets -> /preview
  m = u.match(/docs\.google\.com\/(document|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`;
  // Google Drive archivo (PDF, imagen, etc.): /file/d/ID/view -> /preview
  m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  // Google Drive "open?id=ID" o "uc?id=ID" -> /preview
  m = u.match(/drive\.google\.com\/(?:open|uc)\?[^#]*[?&]?id=([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m && /drive\.google\.com/.test(u)) return `https://drive.google.com/file/d/${m[1]}/preview`;
  // Canva: /design/ID/view -> /view?embed
  m = u.match(/canva\.com\/design\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.canva.com/design/${m[1]}/view?embed`;
  // OneDrive / Office online: si ya trae "embed"/"embedview" lo dejamos tal cual
  // PDF suelto (termina en .pdf): se puede embeber directo en un iframe
  return u; // por defecto, intentamos embeber tal cual
}
function youtubeEmbed(url) {
  const u = String(url || "").trim();
  let m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  return u;
}
function youtubeId(url) {
  const m = String(url || "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
function isValidUrl(url) {
  return /^https?:\/\/.+/.test(String(url || "").trim());
}

/* ================= Motor de sonido (Web Audio, sin archivos) ================= */
const Sound = (() => {
  let ctx = null;
  let muted = false;
  const ensure = () => {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const setMuted = (m) => { muted = m; };
  const isMuted = () => muted;

  const tone = (freq, start, dur, type = "sine", gain = 0.2, glideTo) => {
    const c = ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.05);
  };

  // ráfaga de ruido (para aplausos / redoble)
  const noise = (start, dur, { gain = 0.2, freq = 2000, q = 0.7, type = "bandpass", curve = 1.5 } = {}) => {
    const c = ctx;
    const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = Math.pow(1 - i / d.length, curve);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(start);
  };

  // un "clap" individual: chasquido de ruido muy corto y filtrado
  const clap = (start, gain = 0.5) => {
    const c = ctx;
    const dur = 0.03 + Math.random() * 0.02;
    const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = Math.pow(1 - i / d.length, 4);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1100 + Math.random() * 600;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1600 + Math.random() * 900;
    bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.value = gain * (0.6 + Math.random() * 0.5);
    src.connect(hp).connect(bp).connect(g).connect(c.destination);
    src.start(start);
  };

  // ovación: muchos claps solapados que suben y bajan de intensidad
  const applause = (start, dur = 2.6) => {
    const c = ctx;
    // colchón de "multitud" (ruido rosa suave de fondo)
    const bedLen = Math.floor(c.sampleRate * dur);
    const bed = c.createBuffer(1, bedLen, c.sampleRate);
    const bd = bed.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bedLen; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      const ramp = i < bedLen * 0.15 ? i / (bedLen * 0.15) : Math.pow(1 - (i - bedLen * 0.15) / (bedLen * 0.85), 0.8);
      bd[i] = last * 6 * ramp;
    }
    const bedSrc = c.createBufferSource();
    bedSrc.buffer = bed;
    const bedF = c.createBiquadFilter();
    bedF.type = "bandpass";
    bedF.frequency.value = 1900;
    bedF.Q.value = 0.5;
    const bedG = c.createGain();
    bedG.gain.value = 0.16;
    bedSrc.connect(bedF).connect(bedG).connect(c.destination);
    bedSrc.start(start);
    // claps individuales densos
    let t = start;
    while (t < start + dur) {
      const progress = (t - start) / dur;
      const intensity = progress < 0.2 ? progress / 0.2 : Math.pow(1 - (progress - 0.2) / 0.8, 0.7);
      clap(t, 0.32 * intensity);
      t += 0.012 + Math.random() * 0.045; // densidad de aplausos
    }
  };

  // Redoble de tambor con tensión creciente (tipo Kahoot)
  const suspense = () => {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    let time = t;
    let step = 0.14;
    for (let i = 0; i < 11; i++) {
      noise(time, 0.06, { gain: 0.12 + i * 0.01, freq: 260, q: 1.2, type: "lowpass", curve: 3 });
      tone(150 + i * 12, time, 0.07, "square", 0.05);
      time += step;
      step *= 0.9;
    }
    tone(880, time, 0.18, "sine", 0.12, 1320);
  };

  // Celebración del campeón: fanfarria de trompeta + campanas + OVACIÓN con aplausos
  const celebrate = () => {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    // fanfarria ascendente triunfal
    const melody = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    melody.forEach((f, i) => {
      const at = t + i * 0.13;
      tone(f, at, 0.6, "triangle", 0.24);
      tone(f / 2, at, 0.6, "sawtooth", 0.07);
    });
    // acorde final sostenido + campana
    const chordAt = t + 0.13 * 4;
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, chordAt, 1.0, "triangle", 0.13));
    tone(1568, chordAt, 1.2, "sine", 0.1);
    tone(2093, chordAt + 0.1, 1.0, "sine", 0.06);
    // OVACIÓN: aplausos sostenidos que arrancan junto con la fanfarria
    applause(t + 0.15, 3.0);
  };

  // Clic corto de reveal (2º y 3º puesto): "swoosh" ascendente
  const pop = () => {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    tone(392, t, 0.18, "triangle", 0.16, 784);
    noise(t, 0.14, { gain: 0.06, freq: 3000, q: 0.5, curve: 2 });
    // pequeño aplauso breve
    applause(t + 0.05, 0.7);
  };

  // Sonido corto y positivo al "Mostrar todo" (acorde rápido)
  const chord = () => {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.04, 0.4, "triangle", 0.16));
    tone(1046.5, t + 0.12, 0.5, "sine", 0.1);
  };

  return { ensure, setMuted, isMuted, suspense, celebrate, pop, chord };
})();

/* ============ Parser del Excel exportado de Wordwall ============ */
function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: "array" });
  const name =
    wb.SheetNames.find((n) => norm(n).includes("por alumno")) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    defval: "",
    blankrows: true,
  });
  const cell = (r, c) => String((rows[r] || [])[c] ?? "").trim();
  const title = cell(0, 0) || "Ejercicio sin título";
  const students = [];
  const questions = [];
  let i = 2;
  let order = 0;
  while (i < rows.length) {
    const a = cell(i, 0);
    const isNameRow = a && !cell(i, 1) && !cell(i, 2);
    let headerAt = -1;
    if (isNameRow) {
      for (let k = i + 1; k <= i + 2 && k < rows.length; k++) {
        if (norm(cell(k, 0)) === "pregunta") {
          headerAt = k;
          break;
        }
      }
    }
    if (headerAt === -1) {
      i++;
      continue;
    }
    const raw = a;
    const answers = {};
    let j = headerAt + 1;
    while (j < rows.length) {
      const q = cell(j, 0);
      const mark = cell(j, 2);
      if (!q && !mark) break;
      if (q && (mark === "✔" || mark === "✖")) {
        let qi = questions.findIndex((x) => norm(x) === norm(q));
        if (qi === -1) {
          questions.push(q);
          qi = questions.length - 1;
        }
        answers[qi] = mark === "✔" ? 1 : 0;
      }
      j++;
    }
    const vals = Object.values(answers);
    students.push({
      raw,
      order: order++,
      correct: vals.reduce((s, v) => s + v, 0),
      total: vals.length,
      answers,
      score: null,
      submitted: null,
    });
    i = j + 1;
  }
  const best = new Map();
  for (const s of students) {
    const k = norm(s.raw);
    const prev = best.get(k);
    if (isBetterAttempt(s, prev)) best.set(k, s);
  }
  return { title, questions, students: [...best.values()] };
}

/* ============ Parser del detallado pegado desde Wordwall ============ */
function parseDetalle(text) {
  const out = [];
  for (const lineRaw of String(text).split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (/^alumno\b/i.test(line)) continue;
    let parts = line.split(/\t+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const nums = [];
      while (parts.length && /^\d+$/.test(parts[parts.length - 1]) && nums.length < 3) {
        nums.unshift(parseInt(parts.pop(), 10));
      }
      if (nums.length >= 2) {
        const score = nums.length === 3 ? nums[0] : null;
        const correct = nums.length === 3 ? nums[1] : nums[0];
        const incorrect = nums.length === 3 ? nums[2] : nums[1];
        out.push({
          name: parts[0],
          submitted: parts.slice(1).join(" ") || null,
          score,
          correct,
          incorrect,
        });
        continue;
      }
    }
    const m = line.match(/^(.+?)\s+(\d{1,2}:\d{2}\s*-\s*.+?)\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (m) {
      out.push({ name: m[1].trim(), submitted: m[2].trim(), score: +m[3], correct: +m[4], incorrect: +m[5] });
    }
  }
  return out;
}

/* ============ Fusión de participantes (re-subida) ============
   Combina la lista existente con la nueva: actualiza a quien ya estaba
   (conservando el mejor intento) y agrega a los nuevos.                    */
function mergeStudents(existing, incoming) {
  const map = new Map();
  for (const s of existing) map.set(norm(s.raw), { ...s });
  let added = 0;
  let updated = 0;
  for (const s of incoming) {
    const k = norm(s.raw);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...s });
      added++;
    } else {
      // conserva el mejor resultado: mayor puntaje, luego aciertos, luego más reciente
      if (isBetterAttempt(s, prev)) {
        map.set(k, { ...prev, ...s });
        updated++;
      }
    }
  }
  return { students: [...map.values()], added, updated };
}
function mergeQuestions(existing, incoming) {
  // preserva las preguntas ya conocidas; si el nuevo trae más, las suma
  if (!incoming || !incoming.length) return existing || [];
  if (!existing || !existing.length) return incoming;
  return incoming.length >= existing.length ? incoming : existing;
}

/* ============ Ranking y puntos de campeonato ============ */
/* Decide si el intento 'b' es mejor que 'a' para conservar al fusionar/deduplicar.
   Prioriza: mayor puntaje Wordwall > más aciertos > intento más reciente. */
function isBetterAttempt(b, a) {
  if (!a) return true;
  const sb = b.score ?? -1, sa = a.score ?? -1;
  if (sb !== sa) return sb > sa;
  if ((b.correct ?? 0) !== (a.correct ?? 0)) return (b.correct ?? 0) > (a.correct ?? 0);
  // desempate final: el más reciente (mayor 'submitted' o mayor 'order')
  const tb = attemptTime(b), ta = attemptTime(a);
  if (tb !== ta) return tb > ta;
  return (b.order ?? 0) >= (a.order ?? 0);
}
function attemptTime(s) {
  // intenta extraer una fecha/hora del campo 'submitted' de Wordwall; si no, 0
  if (!s || !s.submitted) return 0;
  const t = Date.parse(s.submitted);
  return isNaN(t) ? 0 : t;
}
function canonicalOf(raw, aliases) {
  return aliases[norm(raw)] || String(raw).trim();
}
function isExcluded(canon, excluded) {
  if (!excluded || !excluded.length) return false;
  return excluded.some((e) => norm(e) === norm(canon));
}
function hasScores(ex) {
  return ex.students.some((s) => s.score != null);
}
function rankExercise(ex, aliases, excluded) {
  const byCanon = new Map();
  for (const s of ex.students) {
    const canon = canonicalOf(s.raw, aliases);
    if (isExcluded(canon, excluded)) continue; // fuera del podio/ranking
    const prev = byCanon.get(canon);
    // conservar el mejor intento: mayor puntaje, luego aciertos, luego más reciente
    if (isBetterAttempt(s, prev)) byCanon.set(canon, { ...s, canon });
  }
  const arr = [...byCanon.values()];
  // Regla de orden: SIEMPRE gana quien tiene más aciertos.
  // El puntaje Wordwall solo desempata entre quienes tienen los mismos aciertos.
  // (El modo "solo aciertos" ignora el desempate por Wordwall y usa el orden de participación.)
  const useScoreTiebreak = ex.sortBy !== "correct";
  arr.sort((a, b) => {
    if (b.correct !== a.correct) return b.correct - a.correct;
    if (useScoreTiebreak && (b.score ?? -1) !== (a.score ?? -1)) return (b.score ?? -1) - (a.score ?? -1);
    return a.order - b.order;
  });
  return arr.map((s, idx) => ({
    ...s,
    rank: idx + 1,
    points: idx < PTS.length ? PTS[idx] : PTS_PART,
  }));
}
function buildConsolidated(exercises, aliases, excluded) {
  const map = new Map();
  for (const ex of exercises) {
    for (const s of rankExercise(ex, aliases, excluded)) {
      const e =
        map.get(s.canon) || { canon: s.canon, points: 0, score: 0, correct: 0, total: 0, played: 0, detail: [] };
      e.points += s.points;
      e.score += s.score || 0;
      e.correct += s.correct;
      e.total += s.total;
      e.played += 1;
      e.detail.push({ exId: ex.id, title: ex.title, rank: s.rank, points: s.points, correct: s.correct, total: s.total, score: s.score });
      map.set(s.canon, e);
    }
  }
  const arr = [...map.values()];
  arr.sort((a, b) => b.points - a.points || b.score - a.score || b.correct - a.correct);
  return arr.map((s, i) => ({ ...s, rank: i + 1 }));
}
function questionStats(ex) {
  return (ex.questions || []).map((q, qi) => {
    let ok = 0,
      bad = 0;
    for (const s of ex.students) {
      if (s.answers && s.answers[qi] === 1) ok++;
      else if (s.answers && s.answers[qi] === 0) bad++;
    }
    return { q, ok, bad, total: ok + bad };
  });
}
function displayOf(s, consolidated) {
  // El número protagonista SIEMPRE son los puntos de campeonato (definen el puesto).
  // El puntaje Wordwall y los aciertos van como apoyo, para explicar el porqué del orden.
  if (consolidated) {
    const parts = [];
    if (s.played != null) parts.push(`${s.played} juego${s.played === 1 ? "" : "s"}`);
    parts.push(`${s.correct}/${s.total} aciertos`);
    return { main: `${s.points}`, unit: "pts campeonato", sub: parts.join(" · ") };
  }
  const parts = [];
  if (s.score != null) parts.push(`${s.score} pts Wordwall`);
  parts.push(`${s.correct}/${s.total} aciertos`);
  return { main: `${s.points}`, unit: "pts campeonato", sub: parts.join(" · ") };
}

/* ================= Confetti ================= */
function Confetti({ burst }) {
  const pieces = useMemo(() => {
    if (!burst || REDUCED) return [];
    const cols = ["#FFC531", "#16DB93", "#FFFFFF", "#FF2E63", "#C9D4E8"];
    return Array.from({ length: 140 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      dur: 2.6 + Math.random() * 2.2,
      size: 6 + Math.random() * 8,
      color: cols[i % cols.length],
      rot: Math.random() * 360,
      drift: -50 + Math.random() * 100,
    }));
  }, [burst]);
  if (!pieces.length) return null;
  return (
    <div className="confetti-layer">
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            top: "-4%",
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.5,
            background: p.color,
            transform: `rotate(${p.rot}deg)`,
            animation: `caer ${p.dur}s ${p.delay}s linear forwards`,
            "--drift": `${p.drift}px`,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

/* ================= Podio ================= */
const PODIUM_META = {
  1: { cls: "pc-gold", h: 218, medal: "🥇", tag: "CAMPEÓN" },
  2: { cls: "pc-silver", h: 158, medal: "🥈", tag: "SUBCAMPEÓN" },
  3: { cls: "pc-bronze", h: 116, medal: "🥉", tag: "3ER PUESTO" },
};
function PodiumColumn({ student, rank, shown, consolidated }) {
  const meta = PODIUM_META[rank];
  const d = displayOf(student, consolidated);
  return (
    <div className="podium-slot">
      <div className={`podium-head ${shown ? "is-shown" : ""}`}>
        {shown ? (
          <div className={`player-card ${meta.cls}`}>
            {rank === 1 && <span className="pc-crown">👑</span>}
            <span className="pc-tag">{meta.tag}</span>
            <div className="pc-avatar-wrap">
              <div className={`avatar ${meta.cls}`}>{initials(student.canon)}</div>
              <span className="pc-medal">{meta.medal}</span>
            </div>
            <div className="podium-name">{student.canon}</div>
            <div className={`podium-main ${meta.cls}-t`}>
              {d.main}<span className="podium-unit">{d.unit}</span>
            </div>
            {d.sub && <div className="podium-sub">{d.sub}</div>}
          </div>
        ) : (
          <div className="player-card player-card--ghost">
            <div className="avatar avatar--ghost">?</div>
            <div className="pc-ghost-label">Por revelar</div>
          </div>
        )}
      </div>
      <div className={`podium-col ${meta.cls} ${shown ? "is-up" : ""}`} style={{ "--h": `${meta.h}px` }}>
        <span className="podium-rank">{rank}</span>
        {rank === 1 && shown && <span className="shine" />}
      </div>
    </div>
  );
}

function PodiumStage({ ranked, subtitle, consolidated, muted, setMuted }) {
  const [step, setStep] = useState(0);
  const [suspense, setSuspense] = useState(false);
  const timer = useRef(null);
  const top3 = ranked.slice(0, 3);
  const mentions = ranked.slice(3, 5);
  const maxStep = 3 + (mentions.length ? 1 : 0);

  useEffect(() => {
    setStep(0);
    setSuspense(false);
    return () => clearTimeout(timer.current);
  }, [ranked]);

  const advance = useCallback(() => {
    if (suspense || step >= maxStep) return;
    const next = step + 1;
    if (next <= 3 && !REDUCED) {
      setSuspense(true);
      Sound.suspense();
      timer.current = setTimeout(() => {
        setSuspense(false);
        setStep(next);
        if (next === 3) Sound.celebrate();
        else Sound.pop();
      }, next === 3 ? 1700 : 1000);
    } else {
      setStep(next);
    }
  }, [step, suspense, maxStep]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    Sound.setMuted(m);
    if (!m) Sound.ensure();
  };

  useEffect(() => {
    const h = (e) => {
      const tag = e.target.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (["Space", "Enter", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [advance]);

  if (!ranked.length)
    return <div className="empty">Aún no hay resultados para mostrar aquí.</div>;

  const labels = ["Revelar el podio", "Revelar 2º lugar", "Revelar 1º lugar", "Mostrar menciones honoríficas"];

  return (
    <div style={{ position: "relative" }}>
      <Confetti burst={step >= 3 ? ranked[0]?.canon : null} />
      <div className="stage-topbar">
        <div className="stage-subtitle">{subtitle}</div>
        <button className="mute-btn" onClick={toggleMute} title={muted ? "Activar sonido" : "Silenciar"} aria-label={muted ? "Activar sonido" : "Silenciar"}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <div className={`stage ${step >= 3 ? "stage--lit" : ""}`}>
        <div className="pitch" aria-hidden>
          <span className="pitch-line pitch-mid" />
          <span className="pitch-circle" />
          <span className="pitch-box" />
        </div>
        {step >= 3 && !REDUCED && (
          <>
            <span className="beam beam--l" />
            <span className="beam beam--r" />
          </>
        )}
        {top3[1] && <PodiumColumn student={top3[1]} rank={2} shown={step >= 2} consolidated={consolidated} />}
        {top3[0] && <PodiumColumn student={top3[0]} rank={1} shown={step >= 3} consolidated={consolidated} />}
        {top3[2] && <PodiumColumn student={top3[2]} rank={3} shown={step >= 1} consolidated={consolidated} />}
        {suspense && (
          <div className="suspense">
            <div className="suspense-dots">
              <i /><i /><i />
            </div>
          </div>
        )}
      </div>
      <div className="stage-floor" />

      <div className="reveal-progress" aria-hidden>
        {Array.from({ length: maxStep }).map((_, i) => (
          <span key={i} className={`dot ${step > i ? "dot--on" : ""}`} />
        ))}
      </div>

      <div className="controls">
        {step < maxStep && (
          <button className="btn btn--gold btn--lg" onClick={advance} disabled={suspense}>
            {step < 3 ? labels[step] : labels[3]}
          </button>
        )}
        {step < maxStep && step > 0 && (
          <button className="btn btn--ghost" onClick={() => { const wasChampHidden = step < 3; setStep(maxStep); if (wasChampHidden) Sound.celebrate(); else Sound.chord(); }}>Mostrar todo</button>
        )}
        {step >= maxStep && (
          <button className="btn btn--ghost" onClick={() => { setStep(0); Sound.chord(); }}>↺ Repetir revelación</button>
        )}
      </div>
      <div className="hint">
        Avanza con <kbd>Espacio</kbd> o <kbd>→</kbd>
      </div>

      {step >= maxStep && mentions.length > 0 && (
        <div className="mentions">
          <div className="mentions-title">
            <span className="rule" />
            MENCIONES HONORÍFICAS
            <span className="rule" />
          </div>
          <div className="mentions-row">
            {mentions.map((s) => {
              const d = displayOf(s, consolidated);
              return (
                <div key={s.canon} className="mention-card">
                  <div className="mention-rank">{s.rank}º</div>
                  <div className="avatar avatar--sm">{initials(s.canon)}</div>
                  <div>
                    <div className="mention-name">{s.canon}</div>
                    <div className="mention-score">
                      <b>{d.main} {d.unit}</b>
                      {d.sub && <span className="dim"> · {d.sub}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Explicación de puntos ================= */
function ScoringInfo({ compact }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`scoring ${compact ? "scoring--compact" : ""}`}>
      <button className="scoring-toggle" onClick={() => setOpen(!open)}>
        <span>⚽ ¿Cómo funcionan los puntos de campeonato?</span>
        <span className={`chev ${open ? "chev--up" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="scoring-body">
          <p>
            Como en un Mundial, en <b>cada ejercicio</b> se reparten puntos según el puesto en que quedes.
            Del 6º lugar en adelante, todos suman 2 puntos por participar. El <b>Consolidado</b> suma los
            puntos de campeonato que cada persona obtuvo en todos los ejercicios para armar la tabla general.
          </p>
          <div className="scoring-grid">
            {[
              ["🥇", "1er lugar", 10],
              ["🥈", "2do lugar", 8],
              ["🥉", "3er lugar", 6],
              ["4️⃣", "4to lugar", 5],
              ["5️⃣", "5to lugar", 4],
              ["⚽", "6º en adelante", 2],
            ].map(([ic, l, p]) => (
              <div key={l} className="scoring-item">
                <span className="scoring-ic">{ic}</span>
                <span className="scoring-l">{l}</span>
                <span className="scoring-p">{p} pts</span>
              </div>
            ))}
          </div>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>¿Cómo se decide el puesto en cada ejercicio?</b> Primero gana quien tiene <b>más aciertos</b>.
            Si dos personas empatan en aciertos, el desempate lo define el <b>puntaje Wordwall</b>, que premia
            con puntos extra a quien respondió más rápido. Así, más aciertos siempre significa mejor puesto.
          </p>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
            <b>Ejemplo:</b> si dos personas hacen 6/7, sube quien tuvo mayor puntaje Wordwall (fue más rápida).
            Pero alguien con 7/7 siempre irá por encima de alguien con 6/7, sin importar la rapidez. La
            ubicación final en la tabla la definen los <b>puntos de campeonato</b> acumulados.
          </p>
        </div>
      )}
    </div>
  );
}

/* ================= Tablas y estadísticas ================= */
function RankBadge({ rank }) {
  if (rank <= 3) return <span className={`rank-badge rb-${rank}`}>{["🥇", "🥈", "🥉"][rank - 1]}</span>;
  return <span className="rank-badge rb-n">{rank}</span>;
}
function FullTable({ rows, consolidated, withScores, onStudent }) {
  return (
    <div className="card card--table">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 52 }}>#</th>
            <th>Participante</th>
            {consolidated ? (
              <>
                <th className="th-hl">Pts campeonato</th>
                <th>Juegos</th>
                <th>Aciertos</th>
                <th>Puntaje Wordwall</th>
              </>
            ) : (
              <>
                <th className="th-hl">Pts campeonato</th>
                {withScores && <th>Puntaje Wordwall</th>}
                <th>Aciertos</th>
                <th style={{ minWidth: 110 }}>%</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.canon} className={s.rank <= 3 ? "row--top" : ""} onClick={() => onStudent(s.canon)}>
              <td><RankBadge rank={s.rank} /></td>
              <td>
                <span className="cell-person">
                  <span className="avatar avatar--xs">{initials(s.canon)}</span>
                  <b>{s.canon}</b>
                </span>
              </td>
              {consolidated ? (
                <>
                  <td className="td-champ"><span className="champ-pill">{s.points}</span></td>
                  <td className="t-num">{s.played}</td>
                  <td className="t-num">{s.correct}/{s.total} <span className="dim">({pct(s.correct, s.total)}%)</span></td>
                  <td className="t-num dim">{s.score || "—"}</td>
                </>
              ) : (
                <>
                  <td className="td-champ"><span className="champ-pill">{s.points}</span></td>
                  {withScores && <td className="t-teal">{s.score ?? "—"}</td>}
                  <td className="t-num">{s.correct}/{s.total}</td>
                  <td>
                    <span className="mini-bar"><i style={{ width: `${pct(s.correct, s.total)}%` }} /></span>
                    <span className="mini-bar-label">{pct(s.correct, s.total)}%</span>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-note">
        {consolidated
          ? "El puesto se decide por los pts de campeonato acumulados. Toca un nombre para ver su detalle."
          : "El puesto se decide por los pts de campeonato (10·8·6·5·4·2), asignados según el puntaje Wordwall. Toca un nombre para ver su detalle."}
      </div>
    </div>
  );
}

function StatsQuestions({ ex }) {
  const stats = useMemo(
    () => questionStats(ex).sort((a, b) => a.ok / (a.total || 1) - b.ok / (b.total || 1)),
    [ex]
  );
  if (!stats.length)
    return <div className="empty">Este ejercicio no tiene detalle por pregunta (se cargó solo desde el detallado pegado, sin el Excel).</div>;
  return (
    <div className="qgrid">
      {stats.map((s, i) => {
        const p = pct(s.ok, s.total);
        const hard = p < 60;
        return (
          <div key={i} className={`card qcard ${hard ? "qcard--hard" : ""}`}>
            <div className="qrow">
              <div className="qtext">{s.q}</div>
              <div className={`qscore ${hard ? "t-red" : "t-teal"}`}>{s.ok}/{s.total} · {p}%</div>
            </div>
            <div className="qbar"><i className={hard ? "bg-red" : "bg-teal"} style={{ width: `${p}%` }} /></div>
            {hard && <div className="qflag">⚠ Reforzar en la próxima sesión</div>}
          </div>
        );
      })}
    </div>
  );
}

function StudentModal({ canon, data, onClose }) {
  const detail = useMemo(() => {
    const cons = buildConsolidated(data.exercises, data.aliases).find((s) => s.canon === canon);
    const perEx = data.exercises
      .map((ex) => {
        const st = rankExercise(ex, data.aliases).find((s) => s.canon === canon);
        return st ? { ex, st } : null;
      })
      .filter(Boolean);
    return { cons, perEx };
  }, [canon, data]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-row">
            <span className="avatar">{initials(canon)}</span>
            <div className="disp modal-title">{canon}</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar ✕</button>
        </div>
        {detail.cons && (
          <div className="consline">
            <span className="t-gold">{detail.cons.points} pts de campeonato</span> · puesto {detail.cons.rank} · {detail.cons.correct}/{detail.cons.total} aciertos
            {detail.cons.score ? <span className="dim"> · {detail.cons.score} pts Wordwall acumulados</span> : ""}
          </div>
        )}
        {detail.perEx.map(({ ex, st }) => (
          <div key={ex.id} className="modal-ex">
            <div className="modal-ex-head">
              {ex.title}
              <span className="dim">
                {" "}— {st.score != null ? `${st.score} pts · ` : ""}{st.correct}/{st.total} · puesto {st.rank} · {st.points} pts campeonato
              </span>
            </div>
            <div className="modal-qs">
              {(ex.questions || []).map((q, qi) =>
                !st.answers || st.answers[qi] == null ? null : (
                  <div key={qi} className={st.answers[qi] ? "q-ok" : "q-bad"}>
                    {st.answers[qi] ? "✔" : "✖"} {q}
                  </div>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Editor de ejercicio ================= */
/* ================= Admin: gestión de usuarios ================= */
function UsersAdmin({ data, persist, busy }) {
  const users = data.users || [];
  const [confirmDel, setConfirmDel] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const canonicals = useMemo(() => {
    const set = new Set(Object.values(data.aliases));
    for (const ex of data.exercises) for (const s of ex.students) set.add(canonicalOf(s.raw, data.aliases));
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [data]);

  const setLink = async (userId, canon) => {
    const next = { ...data, users: users.map((u) => (u.id === userId ? { ...u, linkedCanon: canon } : u)) };
    try { await persist(next); } catch {}
  };
  const delUser = async (userId) => {
    try { await persist({ ...data, users: users.filter((u) => u.id !== userId) }); setConfirmDel(null); } catch {}
  };

  // sugerencia automática: si el nombre del usuario coincide con un canónico
  const autoMatch = (u) => {
    if (u.linkedCanon) return null;
    return canonicals.find((c) => norm(c) === norm(u.name)) || null;
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="dim" style={{ fontSize: 13 }}>
        Perfiles que los participantes crearon. Puedes <b>vincular</b> cada uno con su nombre en los resultados
        del podio para que vea sus puntos. Si el nombre coincide, se sugiere automáticamente.
      </div>
      {users.length === 0 && <div className="empty">Aún no hay usuarios registrados.</div>}
      {users.map((u) => {
        const suggestion = autoMatch(u);
        const isOpen = expanded === u.id;
        return (
          <div key={u.id} className="card user-card">
            <div className="user-card-head">
              <div className="user-card-info" onClick={() => setExpanded(isOpen ? null : u.id)}>
                <span className="avatar avatar--xs">{initials(u.name)}</span>
                <div>
                  <div className="user-card-name">{u.name}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {u.linkedCanon
                      ? <>🔗 Vinculado a <b>{u.linkedCanon}</b></>
                      : <span style={{ color: "var(--gold)" }}>Sin vincular al podio</span>}
                  </div>
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => setExpanded(isOpen ? null : u.id)}>
                {isOpen ? "Ocultar" : "Ver / editar"}
              </button>
            </div>

            {isOpen && (
              <div className="user-card-body">
                <div className="user-fields">
                  <div className="ufield"><span className="uf-l">🎂 Nacimiento</span><span className="uf-v">{fmtDate(u.birthdate)}{ageFromBirth(u.birthdate) != null ? ` · ${ageFromBirth(u.birthdate)} años` : ""}</span></div>
                  <div className="ufield"><span className="uf-l">⛪ Vivió su EJE</span><span className="uf-v">{u.retreatDate || "—"}</span></div>
                </div>
                {u.expectations && (
                  <div className="user-expect"><span className="uf-l">💭 Expectativas</span><div className="pf-quote">"{u.expectations}"</div></div>
                )}

                <label className="lbl" style={{ marginTop: 12 }}>Vincular con nombre del podio</label>
                <div className="link-row">
                  <select className="inp inp--select" value={u.linkedCanon || ""} onChange={(e) => setLink(u.id, e.target.value)} disabled={busy}>
                    <option value="">— Sin vincular —</option>
                    {canonicals.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {suggestion && (
                    <button className="btn btn--teal-o btn--sm" onClick={() => setLink(u.id, suggestion)}>
                      Vincular con “{suggestion}” (coincide)
                    </button>
                  )}
                </div>

                {confirmDel === u.id ? (
                  <div className="del-confirm" style={{ marginTop: 12 }}>
                    <span>¿Eliminar el perfil de {u.name}?</span>
                    <div className="del-confirm-actions">
                      <button className="btn btn--danger-o btn--sm" onClick={() => delUser(u.id)}>Sí, eliminar</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDel(null)}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn--danger-o btn--sm" style={{ marginTop: 12 }} onClick={() => setConfirmDel(u.id)}>Eliminar perfil</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================= Editor de Ruta Formativa (admin) ================= */
function RouteEditor({ data, persist, busy }) {
  const route = data.route || emptyRoute();
  const [title, setTitle] = useState(route.title || "Ruta de Preparación");
  const [blocks, setBlocks] = useState(route.blocks || []);
  const [dirty, setDirty] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // índice del bloque a confirmar
  const [uploading, setUploading] = useState(null); // índice del bloque subiendo PDF
  const [upErr, setUpErr] = useState(null);

  const uploadPdf = async (bi, file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { setUpErr("Debe ser un archivo PDF."); return; }
    setUpErr(null);
    setUploading(bi);
    try {
      const url = await sbUpload(file);
      setBlockField(bi, "pptUrl", url);
    } catch (e) {
      setUpErr("No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setUploading(null);
    }
  };

  useEffect(() => {
    setTitle(route.title || "Ruta de Preparación");
    setBlocks(route.blocks || []);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.route]);

  const mark = (fn) => { fn(); setDirty(true); };
  const setBlockField = (bi, field, val) =>
    mark(() => setBlocks((prev) => prev.map((b, i) => (i === bi ? { ...b, [field]: val } : b))));
  const addBlock = () => mark(() => setBlocks((prev) => [...prev, { ...emptyBlock(), title: `Bloque ${prev.length + 1}` }]));
  const removeBlock = (bi) => {
    mark(() => setBlocks((prev) => prev.filter((_, i) => i !== bi)));
    setConfirmDel(null);
  };
  const toggleLocked = (bi) =>
    mark(() => setBlocks((prev) => prev.map((b, i) => (i === bi ? { ...b, locked: !b.locked } : b))));
  const moveBlock = (bi, dir) => {
    const ni = bi + dir;
    if (ni < 0 || ni >= blocks.length) return;
    mark(() => setBlocks((prev) => {
      const next = [...prev];
      [next[bi], next[ni]] = [next[ni], next[bi]];
      return next;
    }));
  };
  const addResource = (bi, type) =>
    mark(() => setBlocks((prev) => prev.map((b, i) =>
      i === bi ? { ...b, resources: [...(b.resources || []), { id: uid(), type, label: "", url: "", slide: "" }] } : b
    )));
  const setResField = (bi, ri, field, val) =>
    mark(() => setBlocks((prev) => prev.map((b, i) =>
      i === bi ? { ...b, resources: b.resources.map((r, j) => (j === ri ? { ...r, [field]: val } : r)) } : b
    )));
  const removeResource = (bi, ri) =>
    mark(() => setBlocks((prev) => prev.map((b, i) =>
      i === bi ? { ...b, resources: b.resources.filter((_, j) => j !== ri) } : b
    )));

  const save = async () => {
    const clean = blocks.map((b) => ({
      ...b,
      title: (b.title || "").trim(),
      subtitle: (b.subtitle || "").trim(),
      pptUrl: (b.pptUrl || "").trim(),
      resources: (b.resources || []).filter((r) => (r.url || "").trim()).map((r) => ({ ...r, url: r.url.trim(), label: (r.label || "").trim(), slide: r.slide })),
    }));
    await persist({ ...data, route: { title: title.trim() || "Ruta de Preparación", blocks: clean } });
    setDirty(false);
  };

  return (
    <div className="stack">
      <div className="dim" style={{ fontSize: 13 }}>
        Arma la ruta como una serie de <b>bloques</b> (estaciones de la cancha). Cada bloque puede tener una
        <b> presentación embebida</b> (Google Slides, Canva o PowerPoint online), y <b>botones</b> de juegos de
        Wordwall y videos de YouTube, indicando en qué lámina aparecen. El último bloque es el <b>gol</b>.
      </div>

      <div className="card">
        <label className="lbl">Título de la ruta</label>
        <input className="inp" value={title} onChange={(e) => mark(() => setTitle(e.target.value))} placeholder="Ej. Camino al Retiro EJE 2026" />
      </div>

      {blocks.length === 0 && <div className="empty">Aún no hay bloques. Agrega el primero abajo.</div>}

      {blocks.map((b, bi) => (
        <div key={b.id} className={`card block-edit ${b.locked ? "block-edit--locked" : ""}`}>
          <div className="block-edit-head">
            <div className="block-edit-n">{bi === blocks.length - 1 && blocks.length > 1 ? "🥅" : bi + 1}</div>
            <input className="inp" value={b.title} onChange={(e) => setBlockField(bi, "title", e.target.value)} placeholder={`Título del bloque ${bi + 1}`} />
            <div className="block-edit-move">
              <button className="icon-btn" title="Subir" onClick={() => moveBlock(bi, -1)} disabled={bi === 0}>↑</button>
              <button className="icon-btn" title="Bajar" onClick={() => moveBlock(bi, 1)} disabled={bi === blocks.length - 1}>↓</button>
              <button className="icon-btn" title="Eliminar bloque" onClick={() => setConfirmDel(bi)}>✕</button>
            </div>
          </div>

          <button className={`lock-toggle ${b.locked ? "lock-toggle--on" : ""}`} onClick={() => toggleLocked(bi)}>
            <span className="lock-ic">{b.locked ? "🔒" : "🔓"}</span>
            <span className="lock-txt">
              <b>{b.locked ? "Bloqueado para participantes" : "Visible para participantes"}</b>
              <span className="dim">{b.locked ? "Se muestra con candado; no pueden abrir su contenido." : "Cualquiera puede abrirlo y ver su contenido."}</span>
            </span>
            <span className="lock-switch"><span className="lock-knob" /></span>
          </button>

          {confirmDel === bi && (
            <div className="del-confirm">
              <span>¿Eliminar este bloque y sus recursos? No se puede deshacer.</span>
              <div className="del-confirm-actions">
                <button className="btn btn--danger-o btn--sm" onClick={() => removeBlock(bi)}>Sí, eliminar</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDel(null)}>Cancelar</button>
              </div>
            </div>
          )}

          <label className="lbl">Descripción breve (opcional)</label>
          <input className="inp" value={b.subtitle} onChange={(e) => setBlockField(bi, "subtitle", e.target.value)} placeholder="Ej. Primera sesión: los 4 niveles del encuentro" />

          <label className="lbl" style={{ marginTop: 10 }}>Presentación del bloque</label>
          <div className="ppt-input-group">
            <label className="btn btn--teal-o btn--sm ppt-upload-btn">
              {uploading === bi ? "Subiendo…" : "📤 Subir PDF"}
              <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={uploading === bi} onChange={(e) => { if (e.target.files[0]) uploadPdf(bi, e.target.files[0]); e.target.value = ""; }} />
            </label>
            <span className="dim" style={{ fontSize: 12 }}>— o pega un link (Google Slides, Canva, YouTube no) —</span>
          </div>
          <input className="inp" value={b.pptUrl} onChange={(e) => setBlockField(bi, "pptUrl", e.target.value)} placeholder="Sube un PDF arriba, o pega aquí el link de tu presentación" />
          {b.pptUrl && b.pptUrl.includes("/storage/v1/object/public/") && <div className="ok-inline">✅ PDF subido a la base de datos — se verá dentro de la app.</div>}
          {b.pptUrl && !isValidUrl(b.pptUrl) && <div className="warn-inline">⚠ El link debe empezar con http:// o https://</div>}
          {upErr && uploading === null && <div className="warn-inline">{upErr}</div>}

          <div className="res-edit-groups">
            {(b.resources || []).length > 0 && (
              <div className="res-edit-list">
                {b.resources.map((r, ri) => (
                  <div key={r.id} className={`res-edit res-edit--${r.type}`}>
                    <span className="res-edit-ic">{r.type === "game" ? "🎮" : "▶️"}</span>
                    <input className="inp inp--sm" value={r.label} onChange={(e) => setResField(bi, ri, "label", e.target.value)} placeholder={r.type === "game" ? "Nombre del juego" : "Título del video"} />
                    <input className="inp inp--sm" value={r.url} onChange={(e) => setResField(bi, ri, "url", e.target.value)} placeholder={r.type === "game" ? "Link de Wordwall" : "Link de YouTube"} />
                    <input className="inp inp--slide" value={r.slide} onChange={(e) => setResField(bi, ri, "slide", e.target.value.replace(/\D/g, ""))} placeholder="Lám." title="Nº de lámina" />
                    <button className="icon-btn" title="Quitar recurso" onClick={() => removeResource(bi, ri)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="res-add-row">
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource(bi, "game")}>🎮 + Juego Wordwall</button>
              <button className="btn btn--danger-o btn--sm" onClick={() => addResource(bi, "video")}>▶️ + Video YouTube</button>
            </div>
          </div>
        </div>
      ))}

      <button className="btn btn--teal-o add-block-btn" onClick={addBlock}>⚽ + Agregar bloque</button>

      <div className="route-save">
        <button className="btn btn--gold" onClick={save} disabled={busy || !dirty}>
          {dirty ? "Guardar ruta" : "Ruta guardada ✓"}
        </button>
        {dirty && <span className="dim" style={{ fontSize: 13 }}>Tienes cambios sin guardar.</span>}
      </div>
    </div>
  );
}

/* ================= Editor de ejercicio (admin) ================= */
function ExerciseEditor({ exercise, data, persist, busy, onClose }) {
  const [title, setTitle] = useState(exercise.title);
  const [sortBy, setSortBy] = useState(exercise.sortBy || "score");
  const [students, setStudents] = useState(exercise.students.map((s) => ({ ...s })));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [newName, setNewName] = useState("");

  const setField = (idx, field, val) =>
    setStudents((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: val } : s)));
  const removeRow = (idx) => setStudents((prev) => prev.filter((_, i) => i !== idx));
  const addRow = () => {
    const name = newName.trim();
    if (!name) return;
    setStudents((prev) => [...prev, { raw: name, order: prev.length, correct: 0, total: 0, answers: {}, score: null, submitted: null }]);
    setNewName("");
  };
  const applyPaste = () => {
    const entries = parseDetalle(pasteText);
    if (!entries.length) return;
    setStudents((prev) => {
      const next = prev.map((s) => ({ ...s }));
      entries.forEach((e, idx) => {
        const st = next.find((s) => norm(s.raw) === norm(e.name));
        if (st) {
          st.score = e.score;
          st.submitted = e.submitted;
          st.order = idx;
          if (!st.total) {
            st.correct = e.correct;
            st.total = e.correct + e.incorrect;
          }
        } else {
          next.push({ raw: e.name, order: idx, correct: e.correct, total: e.correct + e.incorrect, answers: {}, score: e.score, submitted: e.submitted });
        }
      });
      return next;
    });
    setPasteText("");
    setPasteOpen(false);
  };
  const save = async () => {
    const aliases = { ...data.aliases };
    for (const s of students) if (!aliases[norm(s.raw)]) aliases[norm(s.raw)] = String(s.raw).trim();
    const cleaned = students.map((s) => ({
      ...s,
      score: s.score === "" || s.score == null ? null : toInt(s.score, null),
      correct: toInt(s.correct, 0),
      total: toInt(s.total, 0),
    }));
    const exercises = data.exercises.map((e) =>
      e.id === exercise.id ? { ...e, title: title.trim() || e.title, sortBy, students: cleaned } : e
    );
    await persist({ ...data, aliases, exercises });
    onClose();
  };

  return (
    <div className="overlay">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="disp modal-title">EDITAR EJERCICIO</div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cancelar ✕</button>
        </div>

        <div className="stack">
          <div>
            <label className="lbl">Título</label>
            <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <label className="lbl">Criterio de desempate</label>
            <div className="seg">
              <button className={`seg-btn ${sortBy === "score" ? "seg-btn--on" : ""}`} onClick={() => setSortBy("score")}>
                Aciertos + desempate Wordwall
              </button>
              <button className={`seg-btn ${sortBy === "correct" ? "seg-btn--on" : ""}`} onClick={() => setSortBy("correct")}>
                Solo aciertos
              </button>
            </div>
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              {sortBy === "score"
                ? "Gana quien tiene más aciertos; si empatan, decide el mayor puntaje Wordwall (rapidez)."
                : "Gana quien tiene más aciertos; si empatan, se respeta el orden de participación."}
            </div>
          </div>

          <div>
            <button className="btn btn--teal-o btn--sm" onClick={() => setPasteOpen(!pasteOpen)}>
              {pasteOpen ? "Ocultar" : "📋 Pegar detallado de Wordwall para actualizar puntuaciones"}
            </button>
            {pasteOpen && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  className="inp inp--mono"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                  placeholder={"Alumno\tEnviado\tPuntuación\tCorrecto\tIncorrecto\nEly\t19:32 - 27 jun. 2026\t1036\t7\t0"}
                />
                <button className="btn btn--teal btn--sm" style={{ marginTop: 8 }} onClick={applyPaste}>Aplicar a la tabla</button>
              </div>
            )}
          </div>

          <div className="card card--table">
            <table className="tbl tbl--edit">
              <thead>
                <tr>
                  <th>Participante</th>
                  <th>Puntuación</th>
                  <th>Aciertos</th>
                  <th>Preguntas</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={i}>
                    <td><b>{s.raw}</b></td>
                    <td><input className="inp inp--cell" value={s.score ?? ""} onChange={(e) => setField(i, "score", e.target.value.replace(/\D/g, ""))} placeholder="—" /></td>
                    <td><input className="inp inp--cell inp--xs" value={s.correct} onChange={(e) => setField(i, "correct", e.target.value.replace(/\D/g, ""))} /></td>
                    <td><input className="inp inp--cell inp--xs" value={s.total} onChange={(e) => setField(i, "total", e.target.value.replace(/\D/g, ""))} /></td>
                    <td><button className="icon-btn" title="Quitar participante" onClick={() => removeRow(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row-add">
            <input className="inp" style={{ maxWidth: 280 }} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()} placeholder="Nombre del nuevo participante" />
            <button className="btn btn--teal-o btn--sm" onClick={addRow}>+ Agregar</button>
          </div>

          <div className="row-actions">
            <button className="btn btn--gold" onClick={save} disabled={busy}>Guardar cambios</button>
            <button className="btn btn--ghost" onClick={onClose}>Descartar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= Panel de administración ================= */
function AdminPanel({ data, setData, onExit }) {
  const [tab, setTab] = useState("subir");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [titleEdit, setTitleEdit] = useState("");
  const [lbText, setLbText] = useState("");
  const [nameMap, setNameMap] = useState({});
  const [editing, setEditing] = useState(null);
  const [mergeMode, setMergeMode] = useState("new"); // "new" | "merge"
  const [mergeTarget, setMergeTarget] = useState(""); // id del ejercicio a fusionar
  const fileRef = useRef(null);

  const canonicals = useMemo(() => {
    const set = new Set(Object.values(data.aliases));
    for (const ex of data.exercises) for (const s of ex.students) set.add(canonicalOf(s.raw, data.aliases));
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [data]);

  const persist = async (next) => {
    setBusy(true);
    setMsg(null);
    try {
      await saveData(next, data);
      setData(next);
      setMsg({ ok: true, t: "Guardado correctamente." });
    } catch (e) {
      setMsg({ ok: false, t: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." });
      throw new Error("persist");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file) => {
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const p = parseWorkbook(buf);
      if (!p.students.length) {
        setMsg({ ok: false, t: "No se encontraron resultados de alumnos en el archivo. ¿Es el export de Wordwall ('Resultados por alumno')?" });
        return;
      }
      setParsed(p);
      setTitleEdit(p.title);
      setLbText("");
      const nm = {};
      for (const s of p.students) if (!data.aliases[norm(s.raw)]) nm[norm(s.raw)] = "__new__";
      setNameMap(nm);
      // ¿existe ya un ejercicio con este título? → sugerir fusión
      const twin = data.exercises.find((e) => norm(e.title) === norm(p.title));
      if (twin) {
        setMergeMode("merge");
        setMergeTarget(twin.id);
      } else {
        setMergeMode("new");
        setMergeTarget("");
      }
    } catch {
      setMsg({ ok: false, t: "No se pudo leer el archivo. Debe ser el .xlsx exportado desde Wordwall." });
    }
  };

  const startFromPaste = () => {
    setParsed({ title: "", questions: [], students: [], fromPaste: true });
    setTitleEdit("");
    setLbText("");
    setNameMap({});
    setMergeMode("new");
    setMergeTarget("");
  };

  const lbParsed = useMemo(() => (lbText.trim() ? parseDetalle(lbText) : []), [lbText]);
  const lbMatch = useMemo(() => {
    if (!parsed) return [];
    return lbParsed.map((e) => {
      const hit = parsed.students.find((s) => norm(s.raw) === norm(e.name));
      return { ...e, matched: !!hit };
    });
  }, [lbParsed, parsed]);

  useEffect(() => {
    if (!parsed || !parsed.fromPaste) return;
    const nm = {};
    for (const e of lbParsed) if (!data.aliases[norm(e.name)]) nm[norm(e.name)] = nameMap[norm(e.name)] || "__new__";
    setNameMap(nm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lbText]);

  const saveExercise = async () => {
    if (!parsed) return;
    if (parsed.fromPaste && !lbParsed.length) {
      setMsg({ ok: false, t: "Pega primero el detallado de Wordwall." });
      return;
    }
    const aliases = { ...data.aliases };
    const allNames = parsed.fromPaste ? lbParsed.map((e) => e.name) : parsed.students.map((s) => s.raw);
    for (const raw of allNames) {
      const k = norm(raw);
      if (aliases[k]) continue;
      const choice = nameMap[k];
      aliases[k] = choice && choice !== "__new__" ? choice : String(raw).trim();
    }
    let students;
    if (parsed.fromPaste) {
      students = lbParsed.map((e, idx) => ({
        raw: e.name,
        order: idx,
        correct: e.correct,
        total: e.correct + e.incorrect,
        answers: {},
        score: e.score,
        submitted: e.submitted,
      }));
    } else {
      students = parsed.students.map((s) => ({ ...s }));
      lbMatch.forEach((e, idx) => {
        const st = students.find((s) => norm(s.raw) === norm(e.name));
        if (st) {
          st.score = e.score;
          st.submitted = e.submitted;
          st.order = idx;
        }
      });
    }

    try {
      if (mergeMode === "merge" && mergeTarget) {
        // fusionar con el ejercicio existente
        const target = data.exercises.find((e) => e.id === mergeTarget);
        const { students: merged, added, updated } = mergeStudents(target.students, students);
        const exercises = data.exercises.map((e) =>
          e.id === mergeTarget
            ? { ...e, students: merged, questions: mergeQuestions(e.questions, parsed.questions), date: new Date().toISOString() }
            : e
        );
        await persist({ ...data, aliases, exercises });
        setMsg({ ok: true, t: `Fusionado en "${target.title}": ${added} nuevo(s), ${updated} actualizado(s).` });
      } else {
        const ex = {
          id: uid(),
          title: titleEdit.trim() || parsed.title || "Ejercicio sin título",
          date: new Date().toISOString(),
          sortBy: "score",
          students,
          questions: parsed.questions,
        };
        await persist({ ...data, aliases, exercises: [...data.exercises, ex] });
      }
      setParsed(null);
      setLbText("");
      setMergeMode("new");
      setMergeTarget("");
    } catch {}
  };

  const [confirmDelEx, setConfirmDelEx] = useState(null);
  const delExercise = async (id) => {
    try {
      await persist({ ...data, exercises: data.exercises.filter((e) => e.id !== id) });
      setConfirmDelEx(null);
    } catch {}
  };

  const [pin1, setPin1] = useState("");
  const changePin = async () => {
    if (pin1.trim().length < 4) {
      setMsg({ ok: false, t: "El PIN debe tener al menos 4 caracteres." });
      return;
    }
    try {
      await persist({ ...data, pin: pin1.trim() });
      setPin1("");
    } catch {}
  };

  const [aliasCanon, setAliasCanon] = useState({});
  const saveAlias = async (rawKey) => {
    const v = (aliasCanon[rawKey] ?? data.aliases[rawKey] ?? "").trim();
    if (!v) return;
    try {
      await persist({ ...data, aliases: { ...data.aliases, [rawKey]: v } });
    } catch {}
  };

  const excludedSet = data.excluded || [];
  const toggleExcluded = async (canon) => {
    const on = excludedSet.some((e) => norm(e) === norm(canon));
    const next = on ? excludedSet.filter((e) => norm(e) !== norm(canon)) : [...excludedSet, canon];
    try {
      await persist({ ...data, excluded: next });
    } catch {}
  };

  const editingEx = data.exercises.find((e) => e.id === editing);

  return (
    <div className="wrap">
      <div className="admin-head">
        <div className="admin-head-l">
          <span className="admin-badge">⚙ ADMIN</span>
          <div>
            <div className="admin-title">Panel de resultados</div>
            <div className="admin-sub">Sube ejercicios, edítalos y gestiona los nombres del equipo</div>
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onExit}>← Vista pública</button>
      </div>

      <div className="tabs">
        {[["ruta", "🏟️ Ruta Formativa"], ["subir", "⬆ Subir resultados"], ["ejercicios", `📋 Ejercicios (${data.exercises.length})`], ["usuarios", `👥 Usuarios (${(data.users || []).length})`], ["participantes", "🏃 Participantes"], ["alias", "👤 Nombres y alias"], ["pin", "🔒 PIN"]].map(([k, t]) => (
          <button key={k} className={`tab ${tab === k ? "tab--on" : ""}`} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      {msg && <div className={`toast ${msg.ok ? "toast--ok" : "toast--err"}`}>{msg.t}</div>}

      {tab === "ruta" && <RouteEditor data={data} persist={persist} busy={busy} />}

      {tab === "subir" && (
        <div className="stack">
          {!parsed ? (
            <>
              <div className="upload-grid">
                <div className="dropzone" onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}>
                  <div className="opt-badge opt-badge--a">OPCIÓN A · RECOMENDADA</div>
                  <div className="dropzone-icon">📊</div>
                  <div className="dropzone-title">Sube el Excel de Wordwall</div>
                  <div className="dropzone-sub">Trae el detalle por pregunta. Luego podrás pegar el detallado para sumar el puntaje con bonus.</div>
                  <span className="dropzone-cta">Elegir archivo .xlsx</span>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
                </div>
                <div className="dropzone dropzone--alt" onClick={startFromPaste} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && startFromPaste()}>
                  <div className="opt-badge opt-badge--b">OPCIÓN B</div>
                  <div className="dropzone-icon">📋</div>
                  <div className="dropzone-title">Pega solo el detallado</div>
                  <div className="dropzone-sub">Crea el ejercicio pegando la tabla de Wordwall, sin descargar el Excel.</div>
                  <span className="dropzone-cta dropzone-cta--alt">Pegar detallado</span>
                </div>
              </div>
              <div className="upload-hint">
                💡 ¿El ejercicio ya existe y solo quieres sumar gente nueva? Sube el Excel igual: al reconocer el título, te ofrecerá <b>fusionar</b> con el existente.
              </div>
            </>
          ) : (
            <>
              <div className="card">
                <div className="step"><span className="step-n">1</span> Título del ejercicio</div>
                <input className="inp" value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)} placeholder="Ej. Refuerzo Segunda Sesión" />
                {!parsed.fromPaste && (
                  <div className="dim" style={{ fontSize: 13, marginTop: 8 }}>
                    {parsed.students.length} participantes · {parsed.questions.length} preguntas detectadas en el Excel
                  </div>
                )}
                {mergeMode === "merge" && mergeTarget && (
                  <div className="detect-banner">
                    💡 Ya existe un ejercicio llamado <b>“{data.exercises.find((e) => e.id === mergeTarget)?.title}”</b>. Abajo puedes fusionar los resultados o crear uno nuevo.
                  </div>
                )}
              </div>

              <div className="card">
                <div className="step">
                  <span className="step-n">2</span>
                  {parsed.fromPaste ? "Pega el detallado de Wordwall" : "(Recomendado) Pega el detallado para incluir la Puntuación con bonus"}
                </div>
                <textarea
                  className="inp inp--mono"
                  value={lbText}
                  onChange={(e) => setLbText(e.target.value)}
                  rows={6}
                  placeholder={"Copia la tabla desde Wordwall, con este formato:\nAlumno\tEnviado\tPuntuación\tCorrecto\tIncorrecto\nEly\t19:32 - 27 jun. 2026\t1036\t7\t0"}
                />
                {lbParsed.length > 0 && (
                  <div className="preview">
                    {(parsed.fromPaste ? lbParsed.map((e) => ({ ...e, matched: true })) : lbMatch).map((e, i) => (
                      <div key={i} className={e.matched ? "pv-ok" : "pv-bad"}>
                        {e.name} · {e.score != null ? `${e.score} pts` : "sin puntuación"} · {e.correct}✔ {e.incorrect}✖{" "}
                        {parsed.fromPaste ? "" : e.matched ? "✔ coincide con el Excel" : "✖ no coincide con ningún nombre del Excel"}
                      </div>
                    ))}
                    {!parsed.fromPaste && <div className="dim" style={{ marginTop: 4 }}>Los nombres deben escribirse igual que en el Excel para coincidir.</div>}
                  </div>
                )}
              </div>

              {Object.keys(nameMap).length > 0 && (
                <div className="card">
                  <div className="step"><span className="step-n">3</span> Nombres nuevos — asócialos para que el consolidado no duplique personas</div>
                  <div className="stack" style={{ gap: 8 }}>
                    {Object.keys(nameMap).map((k) => {
                      const raw = (parsed.fromPaste ? lbParsed.find((e) => norm(e.name) === k)?.name : parsed.students.find((s) => norm(s.raw) === k)?.raw) || k;
                      return (
                        <div key={k} className="alias-row">
                          <div className="alias-raw">{raw}</div>
                          <span className="dim">→</span>
                          <select className="inp inp--select" value={nameMap[k]} onChange={(e) => setNameMap({ ...nameMap, [k]: e.target.value })}>
                            <option value="__new__">Registrar como persona nueva: "{String(raw).trim()}"</option>
                            {canonicals.map((c) => (
                              <option key={c} value={c}>Es la misma persona que: {c}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={`card destino ${mergeMode === "merge" ? "destino--merge" : ""}`}>
                <div className="step">
                  <span className="step-n">{Object.keys(nameMap).length > 0 ? "4" : "3"}</span>
                  ¿Guardar como nuevo o actualizar uno existente?
                </div>
                {data.exercises.length === 0 ? (
                  <div className="dim" style={{ fontSize: 13 }}>Se creará el primer ejercicio.</div>
                ) : (
                  <>
                    <div className="destino-opts">
                      <label className={`radio-card ${mergeMode === "new" ? "radio-card--on" : ""}`}>
                        <input type="radio" checked={mergeMode === "new"} onChange={() => setMergeMode("new")} />
                        <div>
                          <div className="radio-title">🆕 Crear ejercicio nuevo</div>
                          <div className="radio-sub">Aparece como una entrada aparte en la tabla.</div>
                        </div>
                      </label>
                      <label className={`radio-card ${mergeMode === "merge" ? "radio-card--on" : ""}`}>
                        <input type="radio" checked={mergeMode === "merge"} onChange={() => setMergeMode("merge")} />
                        <div>
                          <div className="radio-title">🔄 Fusionar con uno existente</div>
                          <div className="radio-sub">Agrega los participantes nuevos y actualiza los que mejoraron.</div>
                        </div>
                      </label>
                    </div>
                    {mergeMode === "merge" && (
                      <div style={{ marginTop: 12 }}>
                        <label className="lbl">Ejercicio a actualizar</label>
                        <select className="inp inp--select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                          <option value="">— Elige el ejercicio —</option>
                          {data.exercises.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.title} ({e.students.length} participantes)
                            </option>
                          ))}
                        </select>
                        {mergeTarget && (() => {
                          const t = data.exercises.find((e) => e.id === mergeTarget);
                          const incoming = parsed.fromPaste
                            ? lbParsed.map((e) => ({ raw: e.name }))
                            : parsed.students;
                          const existingKeys = new Set(t.students.map((s) => norm(s.raw)));
                          const nuevos = incoming.filter((s) => !existingKeys.has(norm(s.raw)));
                          return (
                            <div className="merge-preview">
                              <span className="mp-pill mp-add">+{nuevos.length} nuevo(s)</span>
                              <span className="mp-pill mp-keep">{t.students.length} ya registrado(s)</span>
                              {nuevos.length > 0 && (
                                <div className="dim" style={{ fontSize: 12.5, marginTop: 6, width: "100%" }}>
                                  Se agregarán: {nuevos.map((s) => s.raw).join(", ")}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="row-actions">
                <button
                  className="btn btn--gold"
                  onClick={saveExercise}
                  disabled={busy || (mergeMode === "merge" && !mergeTarget)}
                >
                  {mergeMode === "merge" ? "Fusionar resultados" : "Guardar ejercicio"}
                </button>
                <button className="btn btn--ghost" onClick={() => setParsed(null)}>Descartar</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "ejercicios" && (
        <div className="stack" style={{ gap: 10 }}>
          {data.exercises.length === 0 && <div className="empty">Aún no hay ejercicios. Sube el primero desde "Subir resultados".</div>}
          {data.exercises.map((ex) => (
            <div key={ex.id} className="card ex-card">
              <div>
                <div className="ex-title">{ex.title}</div>
                <div className="dim" style={{ fontSize: 13 }}>
                  {ex.students.length} participantes · {(ex.questions || []).length} preguntas · orden por {ex.sortBy === "correct" ? "aciertos" : "aciertos (desempate Wordwall)"} · subido {new Date(ex.date).toLocaleDateString("es-PE")}
                </div>
              </div>
              {confirmDelEx === ex.id ? (
                <div className="ex-actions">
                  <span className="dim" style={{ fontSize: 13, alignSelf: "center" }}>¿Seguro?</span>
                  <button className="btn btn--danger-o btn--sm" onClick={() => delExercise(ex.id)}>Sí, eliminar</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelEx(null)}>Cancelar</button>
                </div>
              ) : (
                <div className="ex-actions">
                  <button className="btn btn--teal-o btn--sm" onClick={() => setEditing(ex.id)}>✎ Editar</button>
                  <button className="btn btn--danger-o btn--sm" onClick={() => setConfirmDelEx(ex.id)}>Eliminar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "usuarios" && <UsersAdmin data={data} persist={persist} busy={busy} />}

      {tab === "participantes" && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="dim" style={{ fontSize: 13 }}>
            Aquí puedes <b>excluir</b> a alguien del podio y del ranking sin borrar sus datos — útil para ti,
            tu partner o expositores que jugaron solo para probar. Los excluidos no aparecen en ninguna tabla,
            pero puedes volver a incluirlos cuando quieras.
          </div>
          {canonicals.length === 0 && <div className="empty">Todavía no hay participantes. Sube un ejercicio primero.</div>}
          {canonicals.map((canon) => {
            const on = excludedSet.some((e) => norm(e) === norm(canon));
            const games = data.exercises.filter((ex) => ex.students.some((s) => canonicalOf(s.raw, data.aliases) === canon)).length;
            return (
              <div key={canon} className={`card part-card ${on ? "part-card--off" : ""}`}>
                <div className="part-info">
                  <span className="avatar avatar--xs">{initials(canon)}</span>
                  <div>
                    <div className="part-name">{canon} {on && <span className="part-badge">EXCLUIDO</span>}</div>
                    <div className="dim" style={{ fontSize: 12 }}>{games} ejercicio{games === 1 ? "" : "s"} jugado{games === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <button
                  className={on ? "btn btn--teal btn--sm" : "btn btn--danger-o btn--sm"}
                  onClick={() => toggleExcluded(canon)}
                  disabled={busy}
                >
                  {on ? "↩ Incluir en el podio" : "🚫 Excluir del podio"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "alias" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="dim" style={{ fontSize: 13, marginBottom: 4 }}>
            Cada nombre tal como se escribió en Wordwall (izquierda) apunta a la persona real (derecha). Edita el nombre real y guarda para corregir duplicados.
          </div>
          {Object.keys(data.aliases).length === 0 && <div className="empty">Todavía no hay nombres registrados.</div>}
          {Object.entries(data.aliases).map(([k, v]) => (
            <div key={k} className="alias-row">
              <div className="alias-raw dim">{k}</div>
              <span className="dim">→</span>
              <input className="inp" style={{ width: 240 }} value={aliasCanon[k] ?? v} onChange={(e) => setAliasCanon({ ...aliasCanon, [k]: e.target.value })} />
              {(aliasCanon[k] ?? v) !== v && (
                <button className="btn btn--teal btn--sm" onClick={() => saveAlias(k)} disabled={busy}>Guardar</button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "pin" && (
        <div className="card" style={{ maxWidth: 420 }}>
          <div className="step" style={{ marginBottom: 8 }}>Cambiar PIN de administración</div>
          <input className="inp" value={pin1} onChange={(e) => setPin1(e.target.value)} placeholder="Nuevo PIN (mínimo 4 caracteres)" />
          <button className="btn btn--gold" style={{ marginTop: 12 }} onClick={changePin} disabled={busy}>Actualizar PIN</button>
          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            Nota: esta protección evita cambios accidentales, pero los datos del podio son visibles para cualquiera que tenga el enlace.
          </div>
        </div>
      )}

      {editingEx && <ExerciseEditor exercise={editingEx} data={data} persist={persist} busy={busy} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PinGate({ data, setData, onOk, onCancel }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const creating = !data.pin;
  const submit = async () => {
    setErr(null);
    if (creating) {
      if (val.trim().length < 4) {
        setErr("El PIN debe tener al menos 4 caracteres.");
        return;
      }
      setBusy(true);
      try {
        const next = { ...data, pin: val.trim() };
        await saveData(next, data);
        setData(next);
        onOk();
      } catch (e) {
        setErr("No se pudo guardar: " + (e && e.message ? e.message : "error desconocido"));
      } finally {
        setBusy(false);
      }
    } else {
      if (val === data.pin) onOk();
      else setErr("PIN incorrecto.");
    }
  };
  return (
    <div className="card pin-card">
      <div className="pin-lock">🔐</div>
      <div className="disp pin-title">{creating ? "CREA TU PIN DE ADMIN" : "ACCESO ADMIN"}</div>
      {creating && (
        <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
          Es la primera vez que se abre el panel. Define un PIN para proteger la carga de resultados.
        </div>
      )}
      <input
        className="inp inp--pin"
        type="password"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="PIN"
        autoFocus
      />
      {err && <div className="t-red" style={{ fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div className="row-actions" style={{ justifyContent: "center", marginTop: 16 }}>
        <button className="btn btn--gold" onClick={submit} disabled={busy}>{creating ? "Crear y entrar" : "Entrar"}</button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/* ================= Ruta Formativa (cancha) ================= */
function ResourceButton({ r, onOpen }) {
  const icon = r.type === "game" ? "🎮" : "▶️";
  const cls = r.type === "game" ? "res-btn res-btn--game" : "res-btn res-btn--video";
  return (
    <button className={cls} onClick={() => onOpen(r)}>
      <span className="res-ic">{icon}</span>
      <span className="res-txt">
        <span className="res-label">{r.label || (r.type === "game" ? "Juego Wordwall" : "Video")}</span>
        {r.slide ? <span className="res-slide">Lámina {r.slide}</span> : null}
      </span>
    </button>
  );
}

function RouteField({ route, muted }) {
  const [viewer, setViewer] = useState(null); // {type,url,label}
  const [openBlock, setOpenBlock] = useState(null);
  const blocks = route?.blocks || [];

  if (!blocks.length) {
    return (
      <div className="empty" style={{ padding: "70px 20px" }}>
        <div style={{ fontSize: 42 }}>⚽</div>
        <div style={{ marginTop: 10 }}>La ruta formativa aún no tiene bloques.<br />Entra al panel de administración para armarla.</div>
      </div>
    );
  }

  return (
    <div className="route">
      <div className="route-intro">
        <span className="route-kick">⚽</span>
        <div>
          <div className="route-title">{route.title || "Ruta de Preparación"}</div>
          <div className="route-sub">Avanza bloque por bloque · el último es <b>¡GOL!</b></div>
        </div>
      </div>

      <div className="pitch-path">
        <div className="path-line" aria-hidden />
        {blocks.map((b, i) => {
          const isLast = i === blocks.length - 1;
          const side = i % 2 === 0 ? "left" : "right";
          const resCount = (b.resources || []).length;
          const locked = !!b.locked;
          return (
            <div key={b.id} className={`station station--${side} ${isLast ? "station--goal" : ""} ${locked ? "station--locked" : ""}`}>
              <div className="station-node">
                <span className="station-num">{locked ? "🔒" : isLast ? "🥅" : i + 1}</span>
              </div>
              <button
                className="station-card"
                onClick={() => (locked ? null : setOpenBlock(b))}
                disabled={locked}
                aria-disabled={locked}
              >
                <div className="station-head">
                  <span className="station-tag">{locked ? "🔒 BLOQUEADO" : isLast ? "¡GOL! · BLOQUE FINAL" : `BLOQUE ${i + 1}`}</span>
                  {!locked && (b.pptUrl || resCount > 0) && (
                    <span className="station-meta">
                      {b.pptUrl ? "📊" : ""}{resCount ? ` ${resCount} recurso${resCount === 1 ? "" : "s"}` : ""}
                    </span>
                  )}
                </div>
                <div className="station-title">{b.title || `Bloque ${i + 1}`}</div>
                {b.subtitle && !locked ? <div className="station-desc">{b.subtitle}</div> : null}
                <span className="station-cta">{locked ? "Disponible pronto 🔒" : "Abrir bloque →"}</span>
              </button>
            </div>
          );
        })}
        <div className="goal-net" aria-hidden>
          <div className="goal-post" />
          <div className="goal-label">⚽ ¡METISTE GOL! Completaste la ruta 🎉</div>
        </div>
      </div>

      {openBlock && (
        <BlockModal block={openBlock} onClose={() => setOpenBlock(null)} onOpenResource={(r) => setViewer(r)} />
      )}
      {viewer && <ContentViewer resource={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function PptFrame({ embedUrl, originalUrl }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    timer.current = setTimeout(() => { if (!loaded) setFailed(true); }, 3500);
    return () => clearTimeout(timer.current);
  }, [loaded]);
  return (
    <div className="ppt-block">
      <div className="ppt-frame">
        <iframe title="Presentación" src={embedUrl} allowFullScreen frameBorder="0" onLoad={() => { setLoaded(true); setFailed(false); }} />
        {failed && (
          <div className="viewer-fallback">
            <div className="vf-ic">📊</div>
            <div className="vf-title">La presentación se abre en pestaña nueva</div>
            <div className="vf-sub">No se pudo mostrar aquí dentro. Tócala para verla completa:</div>
            <a className="btn btn--gold btn--lg" href={originalUrl} target="_blank" rel="noreferrer">Abrir presentación ↗</a>
          </div>
        )}
      </div>
      <a className="btn btn--gold ppt-open-btn" href={originalUrl} target="_blank" rel="noreferrer">📊 Abrir presentación en pestaña nueva ↗</a>
    </div>
  );
}

function BlockModal({ block, onClose, onOpenResource }) {
  const games = (block.resources || []).filter((r) => r.type === "game");
  const videos = (block.resources || []).filter((r) => r.type === "video");
  const pptEmbed = toEmbedUrl(block.pptUrl);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-row">
            <span className="block-badge">⚽</span>
            <div className="modal-title">{block.title || "Bloque"}</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar ✕</button>
        </div>
        {block.subtitle ? <div className="dim" style={{ marginBottom: 14 }}>{block.subtitle}</div> : null}

        {pptEmbed ? (
          <PptFrame embedUrl={pptEmbed} originalUrl={block.pptUrl} />
        ) : (
          <div className="ppt-empty">Este bloque no tiene presentación asignada.</div>
        )}

        {games.length > 0 && (
          <div className="res-group">
            <div className="res-group-title">🎮 Juegos de Wordwall</div>
            <div className="res-list">
              {games.map((r) => <ResourceButton key={r.id} r={r} onOpen={onOpenResource} />)}
            </div>
          </div>
        )}
        {videos.length > 0 && (
          <div className="res-group">
            <div className="res-group-title">▶️ Videos</div>
            <div className="res-list">
              {videos.map((r) => <ResourceButton key={r.id} r={r} onOpen={onOpenResource} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContentViewer({ resource, onClose }) {
  const isVideo = resource.type === "video";
  const src = isVideo ? youtubeEmbed(resource.url) : resource.url;
  const label = resource.label || (isVideo ? "Video" : "Juego Wordwall");

  return (
    <div className="overlay overlay--dark" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div className="viewer-title">
            {isVideo ? "▶️" : "🎮"} {label}
            {resource.slide ? <span className="dim"> · Lámina {resource.slide}</span> : null}
          </div>
          <div className="viewer-actions">
            <a className="btn btn--gold btn--sm" href={resource.url} target="_blank" rel="noreferrer">Abrir en pestaña ↗</a>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar ✕</button>
          </div>
        </div>
        <div className="viewer-frame">
          <iframe
            title={label}
            src={src}
            allowFullScreen
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
        <a className="btn btn--gold viewer-open-btn" href={resource.url} target="_blank" rel="noreferrer">
          {isVideo ? "▶️" : "🎮"} Abrir {label} en pestaña nueva ↗
        </a>
        <div className="viewer-note dim">
          💡 Si no ves el contenido arriba, usa el botón dorado. Algunos sitios (como Wordwall) no permiten mostrarse dentro de otras páginas por seguridad.
        </div>
      </div>
    </div>
  );
}

/* ================= Autenticación de participantes ================= */
function AuthScreen({ data, setData, onLogin }) {
  const [tab, setTab] = useState("login"); // login | register
  const users = data.users || [];

  // login state
  const [lName, setLName] = useState("");
  const [lPass, setLPass] = useState("");
  const [lErr, setLErr] = useState(null);

  // register state
  const [rName, setRName] = useState("");
  const [rPass, setRPass] = useState("");
  const [rPass2, setRPass2] = useState("");
  const [rBirth, setRBirth] = useState("");
  const [rRetreat, setRRetreat] = useState("");
  const [rExpect, setRExpect] = useState("");
  const [rPhrase, setRPhrase] = useState("");
  const [rErr, setRErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const doLogin = () => {
    setLErr(null);
    const u = users.find((x) => norm(x.name) === norm(lName));
    if (!u) { setLErr("No encontramos ese nombre. ¿Ya te registraste?"); return; }
    if (u.passHash !== lightHash(lPass)) { setLErr("La clave no coincide."); return; }
    onLogin(u.id);
  };

  const doRegister = async () => {
    setRErr(null);
    if (rName.trim().length < 3) { setRErr("Escribe tu nombre y apellido."); return; }
    if (users.some((x) => norm(x.name) === norm(rName))) { setRErr("Ya existe alguien con ese nombre. Si eres tú, inicia sesión."); return; }
    if (rPass.length < 4) { setRErr("La clave debe tener al menos 4 caracteres."); return; }
    if (rPass !== rPass2) { setRErr("Las claves no coinciden."); return; }
    if (phraseKey(rPhrase) !== ACCESS_PHRASE_KEY) { setRErr("La frase de acceso no coincide."); return; }
    setBusy(true);
    const u = {
      id: uid(),
      name: rName.trim(),
      passHash: lightHash(rPass),
      birthdate: rBirth || "",
      retreatDate: rRetreat.trim(),
      expectations: rExpect.trim(),
      linkedCanon: "",
    };
    try {
      const next = { ...data, users: [...users, u] };
      await saveData(next, data);
      setData(next);
      onLogin(u.id);
    } catch {
      setRErr("No se pudo guardar tu registro. Inténtalo de nuevo.");
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-tabs">
          <button className={`auth-tab ${tab === "login" ? "auth-tab--on" : ""}`} onClick={() => setTab("login")}>Iniciar sesión</button>
          <button className={`auth-tab ${tab === "register" ? "auth-tab--on" : ""}`} onClick={() => setTab("register")}>Crear mi perfil</button>
        </div>

        {tab === "login" ? (
          <div className="auth-body">
            <label className="lbl">Nombre y apellido</label>
            <input className="inp" value={lName} onChange={(e) => setLName(e.target.value)} placeholder="Como te registraste" onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            <label className="lbl" style={{ marginTop: 10 }}>Tu clave</label>
            <input className="inp" type="password" value={lPass} onChange={(e) => setLPass(e.target.value)} placeholder="••••" onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            {lErr && <div className="auth-err">{lErr}</div>}
            <button className="btn btn--gold" style={{ marginTop: 14, width: "100%", justifyContent: "center" }} onClick={doLogin}>Entrar ⚽</button>
          </div>
        ) : (
          <div className="auth-body">
            <label className="lbl">Nombre y apellido *</label>
            <input className="inp" value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Ej. María Fernanda Rojas" />

            <div className="auth-grid">
              <div>
                <label className="lbl">Fecha de nacimiento</label>
                <input className="inp" type="date" value={rBirth} onChange={(e) => setRBirth(e.target.value)} />
              </div>
              <div>
                <label className="lbl">¿Cuándo viviste tu retiro EJE?</label>
                <input className="inp" value={rRetreat} onChange={(e) => setRRetreat(e.target.value)} placeholder="Ej. Noviembre 2023" />
              </div>
            </div>

            <label className="lbl" style={{ marginTop: 10 }}>¿Qué expectativas tienes sobre el retiro?</label>
            <textarea className="inp" rows={3} value={rExpect} onChange={(e) => setRExpect(e.target.value)} placeholder="Cuéntanos qué esperas de esta experiencia…" />

            <label className="lbl" style={{ marginTop: 10 }}>Frase de acceso *</label>
            <input className="inp" value={rPhrase} onChange={(e) => setRPhrase(e.target.value)} placeholder="Escribela como la recibiste" />
            <div className="auth-hint">No importan mayusculas, minusculas ni tildes.</div>

            <div className="auth-grid" style={{ marginTop: 10 }}>
              <div>
                <label className="lbl">Crea una clave *</label>
                <input className="inp" type="password" value={rPass} onChange={(e) => setRPass(e.target.value)} placeholder="Mínimo 4 caracteres" />
              </div>
              <div>
                <label className="lbl">Repite la clave *</label>
                <input className="inp" type="password" value={rPass2} onChange={(e) => setRPass2(e.target.value)} placeholder="••••" />
              </div>
            </div>

            {rErr && <div className="auth-err">{rErr}</div>}
            <div className="auth-privacy">
              🔒 Tus datos se guardan en esta aplicación para tu preparación. No uses una clave que uses en otros sitios: este espacio es seguro para el equipo, pero no es un banco.
            </div>
            <button className="btn btn--gold" style={{ marginTop: 12, width: "100%", justifyContent: "center" }} onClick={doRegister} disabled={busy}>Crear mi perfil ⚽</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Panel del perfil (lo que ve el participante logueado) */
function ProfileCard({ user, data, onClose, onLogout }) {
  const age = ageFromBirth(user.birthdate);
  const myStats = useMemo(() => {
    if (!user.linkedCanon) return null;
    const cons = buildConsolidated(data.exercises, data.aliases, data.excluded);
    return cons.find((s) => norm(s.canon) === norm(user.linkedCanon)) || null;
  }, [user, data]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-row">
            <span className="avatar">{initials(user.name)}</span>
            <div>
              <div className="modal-title" style={{ fontSize: 24 }}>{user.name}</div>
              {age != null && <div className="dim" style={{ fontSize: 13 }}>{age} años</div>}
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar ✕</button>
        </div>

        {myStats ? (
          <div className="profile-stats">
            <div className="pstat"><span className="pstat-n t-gold">{myStats.points}</span><span className="pstat-l">pts campeonato</span></div>
            <div className="pstat"><span className="pstat-n">{myStats.rank}º</span><span className="pstat-l">en la tabla</span></div>
            <div className="pstat"><span className="pstat-n">{myStats.played}</span><span className="pstat-l">juego{myStats.played === 1 ? "" : "s"}</span></div>
            <div className="pstat"><span className="pstat-n">{myStats.correct}/{myStats.total}</span><span className="pstat-l">aciertos</span></div>
          </div>
        ) : (
          <div className="profile-nolink">
            ⚽ Todavía no estás vinculado con los resultados del podio. El administrador puede conectarte con tu nombre de juego cuando participes.
          </div>
        )}

        <div className="profile-field"><span className="pf-l">🎂 Nacimiento</span><span className="pf-v">{fmtDate(user.birthdate)}</span></div>
        <div className="profile-field"><span className="pf-l">⛪ Vivió su EJE</span><span className="pf-v">{user.retreatDate || "—"}</span></div>
        {user.expectations && (
          <div className="profile-expect">
            <div className="pf-l" style={{ marginBottom: 4 }}>💭 Sus expectativas</div>
            <div className="pf-quote">"{user.expectations}"</div>
          </div>
        )}

        <button className="btn btn--ghost btn--sm" style={{ marginTop: 16 }} onClick={onLogout}>Cerrar sesión</button>
      </div>
    </div>
  );
}

/* ================= App ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("public");
  const [mode, setMode] = useState("ruta"); // ruta | podio
  const [sel, setSel] = useState("consolidado");
  const [section, setSection] = useState("podio");
  const [studentModal, setStudentModal] = useState(null);
  const [muted, setMuted] = useState(false);
  const [sessionUserId, setSessionUserId] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  const sessionUser = data?.users?.find((u) => u.id === sessionUserId) || null;

  useEffect(() => {
    (async () => {
      const d = await loadAuthData();
      setData(d || emptyData());
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (data && sel !== "consolidado" && !data.exercises.find((e) => e.id === sel)) setSel("consolidado");
  }, [data, sel]);

  const currentEx = data?.exercises.find((e) => e.id === sel) || null;
  const ranked = useMemo(() => {
    if (!data) return [];
    if (sel === "consolidado") return buildConsolidated(data.exercises, data.aliases, data.excluded);
    return currentEx ? rankExercise(currentEx, data.aliases, data.excluded) : [];
  }, [data, sel, currentEx]);

  const handleLogin = useCallback(async (uid) => {
    setSessionUserId(uid);
    setLoading(true);
    const d = await loadData();
    if (d) setData(d);
    setLoading(false);
  }, []);

  const handleAdminOk = useCallback(async () => {
    setLoading(true);
    const d = await loadData();
    if (d) setData(d);
    setView("admin");
    setLoading(false);
  }, []);

  const handleAdminExit = useCallback(async () => {
    setView("public");
    if (!sessionUserId) {
      const d = await loadAuthData();
      if (d) setData(d);
    }
  }, [sessionUserId]);

  const handleLogout = useCallback(async () => {
    setSessionUserId(null);
    setShowProfile(false);
    setMode("ruta");
    const d = await loadAuthData();
    if (d) setData(d);
  }, []);

  if (loading)
    return (
      <Shell>
        <div className="empty" style={{ padding: 90 }}>Cargando resultados…</div>
      </Shell>
    );

  if (view === "pin")
    return (
      <Shell>
        <PinGate data={data} setData={setData} onOk={handleAdminOk} onCancel={() => setView("public")} />
      </Shell>
    );

  if (view === "admin")
    return (
      <Shell>
        <AdminPanel data={data} setData={setData} onExit={handleAdminExit} />
      </Shell>
    );

  const consolidated = sel === "consolidado";

  return (
    <Shell>
      <header className="hero">
        <div className="scoreboard">
          <span className="sb-dot" />
          <span className="sb-live">EN VIVO</span>
          <span className="sb-sep">·</span>
          <span className="sb-label">COPA MUNDIAL · PREPARACIÓN RETIRO</span>
        </div>
        <div className="hero-title">
          <svg className="logo-svg" viewBox="0 0 520 220" role="img" aria-label="EJE 2026">
            <defs>
              <linearGradient id="lgSilver" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="46%" stopColor="#CDD7F2" />
                <stop offset="100%" stopColor="#7E8DC0" />
              </linearGradient>
              <linearGradient id="lgGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFE58A" />
                <stop offset="52%" stopColor="#FFC531" />
                <stop offset="100%" stopColor="#C98A1B" />
              </linearGradient>
              <filter id="lgShadow" x="-20%" y="-20%" width="140%" height="150%">
                <feDropShadow dx="0" dy="5" stdDeviation="0" floodColor="#05070F" floodOpacity="1" />
                <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#000000" floodOpacity="0.55" />
              </filter>
              <filter id="lgGoldGlow" x="-30%" y="-30%" width="160%" height="170%">
                <feDropShadow dx="0" dy="3" stdDeviation="10" floodColor="#FFC531" floodOpacity="0.4" />
              </filter>
            </defs>
            <text x="260" y="118" textAnchor="middle" className="logo-eje" fill="url(#lgSilver)" filter="url(#lgShadow)">EJE</text>
            <text x="235" y="196" textAnchor="middle" className="logo-year" fill="url(#lgGold)" filter="url(#lgGoldGlow)">2026</text>
            <g className="logo-ball" style={{ transformOrigin: "430px 178px" }}>
              <text x="430" y="196" textAnchor="middle" className="logo-ballglyph">⚽</text>
            </g>
          </svg>
        </div>
        <div className="hero-sub">Preparación del equipo de servidores</div>
      </header>

      <div className="userbar">
        {sessionUser ? (
          <button className="user-chip" onClick={() => setShowProfile(true)}>
            <span className="avatar avatar--xs">{initials(sessionUser.name)}</span>
            <span className="user-chip-name">{sessionUser.name.split(" ")[0]}</span>
            <span className="user-chip-badge">Mi perfil</span>
          </button>
        ) : (
          <span className="user-chip user-chip--login">
            Cuenta requerida
          </span>
        )}
      </div>

      {sessionUser ? (
        <>
          <div className="mode-switch">
            <button className={`mode-btn ${mode === "ruta" ? "mode-btn--on" : ""}`} onClick={() => setMode("ruta")}>
              🏟️ Ruta Formativa
            </button>
            <button className={`mode-btn ${mode === "podio" ? "mode-btn--on" : ""}`} onClick={() => setMode("podio")}>
              🏆 Podio y Resultados
            </button>
          </div>

          {mode === "ruta" && <RouteField route={data.route || emptyRoute()} muted={muted} />}

          {mode === "podio" && (
            <>
              <nav className="chipbar">
                <button className={`chip chip--gold ${consolidated ? "chip--on" : ""}`} onClick={() => setSel("consolidado")}>
                  🏆 Consolidado
                </button>
                {data.exercises.map((ex) => (
                  <button key={ex.id} className={`chip ${sel === ex.id ? "chip--on" : ""}`} onClick={() => setSel(ex.id)}>
                    {ex.title}
                  </button>
                ))}
              </nav>

              {data.exercises.length === 0 ? (
                <div className="empty" style={{ padding: "70px 20px" }}>
                  <div style={{ fontSize: 42 }}>🏟️</div>
                  <div style={{ marginTop: 10 }}>Aún no hay resultados cargados.<br />Entra al panel de administración para subir el primer ejercicio.</div>
                </div>
              ) : (
                <>
                  <div className="seg seg--center">
                    {[["podio", "Podio"], ["tabla", "Tabla completa"], ...(currentEx && (currentEx.questions || []).length ? [["preguntas", "Por pregunta"]] : [])].map(([k, t]) => (
                      <button key={k} className={`seg-btn ${section === k ? "seg-btn--on" : ""}`} onClick={() => setSection(k)}>{t}</button>
                    ))}
                  </div>

                  {(consolidated || (currentEx && hasScores(currentEx))) && <ScoringInfo />}

                  {section === "podio" && (
                    <PodiumStage
                      ranked={ranked}
                      consolidated={consolidated}
                      muted={muted}
                      setMuted={setMuted}
                      subtitle={
                        consolidated
                          ? "Clasificación general · puntos de campeonato"
                          : `"${currentEx.title}"${currentEx.sortBy === "correct" ? " · orden por aciertos" : hasScores(currentEx) ? " · aciertos (desempate por puntaje Wordwall)" : " · orden por aciertos"}`
                      }
                    />
                  )}
                  {section === "tabla" && <FullTable rows={ranked} consolidated={consolidated} withScores={currentEx ? hasScores(currentEx) : false} onStudent={setStudentModal} />}
                  {section === "preguntas" && currentEx && <StatsQuestions ex={currentEx} />}
                </>
              )}
            </>
          )}
        </>
      ) : (
        <AuthScreen
          data={data}
          setData={setData}
          onLogin={handleLogin}
        />
      )}

      {studentModal && <StudentModal canon={studentModal} data={data} onClose={() => setStudentModal(null)} />}
      {showProfile && sessionUser && (
        <ProfileCard
          user={sessionUser}
          data={data}
          onClose={() => setShowProfile(false)}
          onLogout={handleLogout}
        />
      )}

      <footer className="foot">
        <button className="btn btn--ghost btn--sm" onClick={async () => { const d = sessionUser ? await loadData() : await loadAuthData(); if (d) setData(d); }}>↻ Actualizar datos</button>
        <button className="btn btn--ghost btn--sm" onClick={() => setView("pin")}>⚙ Administración</button>
      </footer>
    </Shell>
  );
}

/* ================= Shell + sistema de diseño ================= */
function Shell({ children }) {
  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="stadium" aria-hidden>
        <svg className="stadium-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMin slice">
          <defs>
            <radialGradient id="sky" cx="50%" cy="0%" r="95%">
              <stop offset="0%" stopColor="#1A2650" />
              <stop offset="50%" stopColor="#0C1330" />
              <stop offset="100%" stopColor="#05070F" />
            </radialGradient>
            <linearGradient id="stand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1B2748" />
              <stop offset="100%" stopColor="#0E1630" />
            </linearGradient>
            <radialGradient id="spotG" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFC531" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#FFC531" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="spotT" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#16DB93" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#16DB93" stopOpacity="0" />
            </radialGradient>
            <pattern id="crowd" width="15" height="15" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.5" fill="#3A4E86" opacity="0.55" />
              <circle cx="10" cy="9" r="1.5" fill="#4A5EA0" opacity="0.4" />
              <circle cx="7" cy="13" r="1.2" fill="#FF2E63" opacity="0.18" />
            </pattern>
          </defs>
          <rect width="1440" height="900" fill="url(#sky)" />
          <path d="M-40 300 Q720 90 1480 300 L1480 470 Q720 300 -40 470 Z" fill="url(#stand)" opacity="0.92" />
          <path d="M-40 300 Q720 90 1480 300 L1480 470 Q720 300 -40 470 Z" fill="url(#crowd)" opacity="0.85" />
          <path d="M-40 470 Q720 300 1480 470 L1480 640 Q720 470 -40 640 Z" fill="url(#stand)" opacity="0.78" />
          <path d="M-40 470 Q720 300 1480 470 L1480 640 Q720 470 -40 640 Z" fill="url(#crowd)" opacity="0.6" />
          {/* torres de luz */}
          <g opacity="0.9">
            <rect x="150" y="150" width="8" height="130" fill="#26355F" />
            <rect x="116" y="118" width="76" height="36" rx="6" fill="#111A38" stroke="#3A4E86" />
            <circle cx="128" cy="130" r="3.5" fill="#FFE58A" /><circle cx="140" cy="130" r="3.5" fill="#FFE58A" />
            <circle cx="152" cy="130" r="3.5" fill="#FFE58A" /><circle cx="164" cy="130" r="3.5" fill="#FFE58A" />
            <circle cx="176" cy="130" r="3.5" fill="#FFE58A" />
            <circle cx="128" cy="142" r="3.5" fill="#FFE58A" /><circle cx="140" cy="142" r="3.5" fill="#FFE58A" />
            <circle cx="152" cy="142" r="3.5" fill="#FFE58A" /><circle cx="164" cy="142" r="3.5" fill="#FFE58A" />
            <circle cx="176" cy="142" r="3.5" fill="#FFE58A" />
            <rect x="1282" y="150" width="8" height="130" fill="#26355F" />
            <rect x="1248" y="118" width="76" height="36" rx="6" fill="#111A38" stroke="#3A4E86" />
            <circle cx="1260" cy="130" r="3.5" fill="#FFE58A" /><circle cx="1272" cy="130" r="3.5" fill="#FFE58A" />
            <circle cx="1284" cy="130" r="3.5" fill="#FFE58A" /><circle cx="1296" cy="130" r="3.5" fill="#FFE58A" />
            <circle cx="1308" cy="130" r="3.5" fill="#FFE58A" />
            <circle cx="1260" cy="142" r="3.5" fill="#FFE58A" /><circle cx="1272" cy="142" r="3.5" fill="#FFE58A" />
            <circle cx="1284" cy="142" r="3.5" fill="#FFE58A" /><circle cx="1296" cy="142" r="3.5" fill="#FFE58A" />
            <circle cx="1308" cy="142" r="3.5" fill="#FFE58A" />
          </g>
          <circle cx="154" cy="137" r="260" fill="url(#spotG)" />
          <circle cx="1286" cy="137" r="260" fill="url(#spotT)" />
        </svg>
        <div className="stadium-fade" />
      </div>
      <span className="flood flood--l" aria-hidden />
      <span className="flood flood--r" aria-hidden />
      <div className="wrap">{children}</div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Outfit:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;700&display=swap');

:root{
  --bg0:#05070F; --bg1:#0A1024; --bg2:#0E1630;
  --card:#111A38; --card2:#16223F; --line:#26355F; --line2:#3A4E86;
  --turf:#16DB93; --turf2:#5CF0B8;
  --hot:#FF2E63; --hot2:#FF6B93;
  --gold:#FFC531; --gold2:#FFE58A;
  --silver:#C9D4E8; --silver2:#EFF3FB;
  --bronze:#E08A4E; --bronze2:#F5B784;
  --text:#EAF0FF; --dim:#8A96C4; --dim2:#5A6799;
  --disp:'Anton',Impact,sans-serif;
  --body:'Outfit',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'Space Grotesk',ui-monospace,monospace;
  --r:16px; --tr:.2s cubic-bezier(.3,.7,.3,1);
}
*{box-sizing:border-box}
.app{min-height:100vh;position:relative;overflow-x:hidden;color:var(--text);
  font-family:var(--body);font-size:15px;line-height:1.5;
  background:var(--bg0);padding:26px 16px 48px}
.app::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(900px 420px at 18% -8%, #FF2E6318, transparent 60%),
    radial-gradient(900px 420px at 82% -8%, #16DB9318, transparent 60%),
    radial-gradient(1200px 700px at 50% 120%, #16223F, transparent 70%),
    linear-gradient(180deg,var(--bg0),var(--bg1) 55%,var(--bg0))}
.app::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.4;
  background:repeating-linear-gradient(0deg,#ffffff05 0 1px,transparent 1px 3px)}
.wrap{max-width:960px;margin:0 auto;position:relative;z-index:2}
.dim{color:var(--dim)}
.flood{display:none}

/* ---------- Estadio ---------- */
.stadium{position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.stadium-svg{position:absolute;top:0;left:0;width:100%;height:64vh;min-height:480px}
.stadium-fade{position:absolute;top:0;left:0;right:0;height:64vh;min-height:480px;
  background:linear-gradient(180deg,transparent 38%,var(--bg0) 94%)}

/* ---------- Scoreboard / hero ---------- */
.hero{text-align:center;margin-bottom:22px;position:relative}
.scoreboard{display:inline-flex;align-items:center;gap:9px;background:#0A1024cc;
  border:1px solid var(--line);border-radius:999px;padding:6px 15px;margin-bottom:16px;
  font-family:var(--mono);font-size:11px;letter-spacing:1.5px;font-weight:700;
  box-shadow:0 6px 24px #00000055, inset 0 1px 0 #ffffff0d}
.sb-dot{width:8px;height:8px;border-radius:50%;background:var(--hot);
  box-shadow:0 0 0 0 #FF2E6399;animation:pulseDot 1.6s ease-out infinite}
@keyframes pulseDot{0%{box-shadow:0 0 0 0 #FF2E6399}70%{box-shadow:0 0 0 7px #FF2E6300}100%{box-shadow:0 0 0 0 #FF2E6300}}
.sb-live{color:var(--hot2)}
.sb-sep{color:var(--dim2)}
.sb-label{color:var(--dim)}

.hero-title{margin:0;display:flex;justify-content:center;padding:4px 0}
.logo-svg{width:min(440px,86vw);height:auto;overflow:visible}
.logo-eje{font-family:var(--disp);font-size:118px;font-style:italic;letter-spacing:4px}
.logo-year{font-family:var(--disp);font-size:72px;font-style:italic;letter-spacing:6px}
.logo-ballglyph{font-size:52px;font-style:normal}
.logo-ball{animation:roll 4s linear infinite}
@keyframes roll{to{transform:rotate(360deg)}}
.hero-sub{color:var(--dim);font-size:14px;margin-top:10px;letter-spacing:.3px;text-align:center}

/* ---------- Botones ---------- */
.btn{font-family:var(--body);font-weight:800;font-size:14px;border-radius:12px;
  padding:11px 20px;cursor:pointer;border:1px solid transparent;transition:var(--tr);
  display:inline-flex;align-items:center;gap:7px;letter-spacing:.2px}
.btn:disabled{opacity:.5;cursor:default}
.btn--gold{background:linear-gradient(180deg,var(--gold2),var(--gold));color:#241800;
  box-shadow:0 6px 20px #FFC53140, inset 0 1px 0 #fff9;text-transform:uppercase;letter-spacing:.6px}
.btn--gold:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 30px #FFC53155, inset 0 1px 0 #fff9}
.btn--gold:active:not(:disabled){transform:translateY(0)}
.btn--lg{padding:15px 32px;font-size:15px;border-radius:14px}
.btn--sm{padding:8px 14px;font-size:13px;border-radius:10px}
.btn--ghost{background:#ffffff08;color:var(--dim);border-color:var(--line)}
.btn--ghost:hover{color:var(--text);border-color:var(--line2);background:#ffffff10}
.btn--teal{background:var(--turf);color:#03251A;box-shadow:0 4px 16px #16DB9333}
.btn--teal:hover{filter:brightness(1.08);transform:translateY(-1px)}
.btn--teal-o{background:#16DB930d;color:var(--turf);border-color:#16DB9355}
.btn--teal-o:hover{background:#16DB931a}
.btn--danger-o{background:#FF2E630d;color:var(--hot2);border-color:#FF2E6355}
.btn--danger-o:hover{background:#FF2E631a}
.icon-btn{background:transparent;border:1px solid transparent;color:var(--dim);border-radius:9px;
  width:32px;height:32px;cursor:pointer;transition:var(--tr)}
.icon-btn:hover{color:var(--hot2);border-color:#FF2E6355;background:#FF2E6312}

/* ---------- Chips / segmentos ---------- */
.chipbar{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:22px}
.chip{border-radius:12px;padding:10px 18px;font-family:var(--body);font-weight:700;font-size:14px;
  background:#ffffff08;color:var(--dim);border:1px solid var(--line);cursor:pointer;transition:var(--tr)}
.chip:hover{color:var(--text);border-color:var(--line2);transform:translateY(-1px)}
.chip--on{background:var(--turf);border-color:transparent;color:#03251A;font-weight:800;
  box-shadow:0 6px 18px #16DB9338}
.chip--gold.chip--on{background:linear-gradient(180deg,var(--gold2),var(--gold));color:#241800;
  box-shadow:0 6px 18px #FFC53140}
.seg{display:inline-flex;gap:4px;background:#0A1024cc;border:1px solid var(--line);border-radius:14px;padding:5px}
.seg--center{display:flex;width:fit-content;margin:0 auto 22px}
.seg-btn{border:none;background:transparent;color:var(--dim);border-radius:10px;padding:9px 18px;
  font-family:var(--body);font-weight:700;font-size:14px;cursor:pointer;transition:var(--tr)}
.seg-btn:hover{color:var(--text)}
.seg-btn--on{background:var(--card2);color:var(--text);box-shadow:inset 0 0 0 1px var(--line2)}

/* ---------- Escenario / podio ---------- */
.stage-topbar{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:10px;position:relative}
.stage-subtitle{text-align:center;color:var(--dim);font-size:13px;
  font-family:var(--mono);letter-spacing:1px;text-transform:uppercase}
.mute-btn{position:absolute;right:0;top:50%;transform:translateY(-50%);
  width:38px;height:38px;border-radius:11px;border:1px solid var(--line);background:#ffffff08;
  font-size:17px;cursor:pointer;transition:var(--tr);display:flex;align-items:center;justify-content:center}
.mute-btn:hover{border-color:var(--line2);background:#ffffff12;transform:translateY(-50%) scale(1.05)}
.stage{position:relative;display:flex;align-items:flex-end;justify-content:center;gap:3%;
  min-height:410px;padding:20px 10px 0;transition:background .8s ease}
.podium-slot{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;
  justify-content:flex-end;width:min(31%,214px)}
.stage--lit{background:radial-gradient(ellipse 66% 64% at 50% 90%, #FFC53128, transparent 68%)}
.stage-floor{height:4px;border-radius:4px;margin-top:2px;
  background:linear-gradient(90deg,transparent,var(--turf) 12%,var(--line2) 50%,var(--turf) 88%,transparent);
  box-shadow:0 6px 30px #16DB9322}
.beam{position:absolute;top:-10%;width:160px;height:120%;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,#FFC5312e,transparent 76%);animation:beamIn 1s .1s ease forwards;
  mix-blend-mode:screen}
.beam--l{left:9%;transform:skewX(16deg)}
.beam--r{right:9%;transform:skewX(-16deg)}
@keyframes beamIn{to{opacity:1}}

.pitch{position:absolute;left:50%;bottom:0;transform:translateX(-50%) perspective(560px) rotateX(54deg);
  transform-origin:bottom center;width:120%;height:200px;border-radius:50% 50% 0 0 / 60% 60% 0 0;
  background:repeating-linear-gradient(90deg,#149E6B 0 44px,#12855C 44px 88px);
  box-shadow:0 -2px 40px #0a3a2555 inset;opacity:.4;overflow:hidden;pointer-events:none;z-index:1}
.pitch-line{position:absolute;background:#eafff7cc}
.pitch-mid{left:0;right:0;top:0;height:3px}
.pitch-circle{position:absolute;left:50%;top:-2px;transform:translateX(-50%);width:130px;height:130px;
  border:3px solid #eafff7aa;border-radius:50%}
.pitch-box{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:230px;height:78px;
  border:3px solid #eafff799;border-bottom:none;border-radius:6px 6px 0 0}

.podium-head{width:100%;display:flex;justify-content:center;min-height:196px;margin-bottom:12px;
  opacity:0;transform:translateY(22px) scale(.94);transition:opacity .5s ease, transform .55s cubic-bezier(.2,.9,.3,1.15)}
.podium-head.is-shown{opacity:1;transform:none}

/* tarjeta de jugador */
.player-card{position:relative;width:100%;border-radius:18px;padding:24px 12px 16px;text-align:center;
  display:flex;flex-direction:column;align-items:center;gap:9px;
  background:linear-gradient(180deg,var(--card2),var(--card));
  border:1px solid var(--line2);overflow:visible;
  box-shadow:0 16px 44px #00000070, inset 0 1px 0 #ffffff12}
.pc-gold{border-color:#FFC53188;
  background:linear-gradient(180deg,#231D0E,#141020);
  box-shadow:0 20px 60px #FFC53130, 0 0 0 1px #FFC53144, inset 0 1px 0 #ffffff18}
.pc-silver{border-color:#C9D4E877}
.pc-bronze{border-color:#E08A4E77}
.player-card::before{content:'';position:absolute;inset:0 0 auto 0;height:55%;pointer-events:none;opacity:.6;
  border-radius:18px 18px 0 0;
  background:linear-gradient(180deg,#ffffff10,transparent)}
.pc-crown{position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:30px;z-index:3;
  filter:drop-shadow(0 3px 6px #0008);animation:crownBob 2.4s ease-in-out infinite}
@keyframes crownBob{0%,100%{transform:translateX(-50%) translateY(0) rotate(-4deg)}50%{transform:translateX(-50%) translateY(-4px) rotate(4deg)}}
.pc-tag{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:2px;
  padding:4px 11px;border-radius:999px;text-transform:uppercase;position:relative;z-index:2}
.pc-gold .pc-tag{background:#FFC5312a;color:var(--gold2);border:1px solid #FFC53177}
.pc-silver .pc-tag{background:#C9D4E822;color:var(--silver2);border:1px solid #C9D4E866}
.pc-bronze .pc-tag{background:#E08A4E22;color:var(--bronze2);border:1px solid #E08A4E66}
.pc-avatar-wrap{position:relative;margin:2px 0 8px}
.pc-medal{position:absolute;bottom:-8px;right:-10px;font-size:24px;filter:drop-shadow(0 2px 4px #0009)}
.player-card--ghost{align-items:center;justify-content:center;min-height:150px;gap:10px;
  border-style:dashed;border-color:var(--line);background:#ffffff04;box-shadow:none}
.player-card--ghost::before,.player-card--ghost::after{display:none}
.pc-ghost-label{font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--dim2)}
.podium-name{font-family:var(--disp);font-size:clamp(17px,3vw,25px);letter-spacing:.5px;
  line-height:1.05;word-break:break-word;text-transform:uppercase;font-style:italic;
  max-width:100%;position:relative;z-index:2}
.podium-main{font-family:var(--mono);font-weight:700;font-variant-numeric:tabular-nums;font-size:36px;
  line-height:1;display:flex;align-items:baseline;justify-content:center;gap:5px;margin-top:2px;
  filter:drop-shadow(0 2px 10px #00000066)}
.podium-unit{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
  color:var(--dim);-webkit-text-fill-color:var(--dim)}
.podium-sub{color:var(--dim);font-size:11px;font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:.3px;margin-top:1px}
.pc-gold-t{color:var(--gold2)} .pc-silver-t{color:var(--silver2)} .pc-bronze-t{color:var(--bronze2)}

.podium-col{position:relative;width:100%;height:18px;border-radius:14px 14px 0 0;overflow:hidden;
  transition:height .8s cubic-bezier(.2,.9,.3,1.12), box-shadow .8s ease;
  display:flex;justify-content:center;background:linear-gradient(180deg,#1B2748,#111A38)}
.podium-col.is-up{height:var(--h)}
.podium-col::before{content:'';position:absolute;inset:0;opacity:0;transition:opacity .5s ease}
.podium-col.is-up::before{opacity:1}
.podium-col::after{content:'';position:absolute;inset:0;opacity:.35;pointer-events:none;
  background:linear-gradient(180deg,#ffffff14,transparent 40%)}
.pc-gold.is-up{box-shadow:0 -10px 54px #FFC53155}
.pc-gold::before{background:linear-gradient(158deg,var(--gold2) 0%,var(--gold) 40%,#C98A1B 82%,#8A6415 100%)}
.pc-silver.is-up{box-shadow:0 -10px 46px #C9D4E840}
.pc-silver::before{background:linear-gradient(158deg,var(--silver2) 0%,var(--silver) 42%,#8B96AC 82%,#6C7690 100%)}
.pc-bronze.is-up{box-shadow:0 -10px 42px #E08A4E40}
.pc-bronze::before{background:linear-gradient(158deg,var(--bronze2) 0%,var(--bronze) 44%,#95602F 84%,#714821 100%)}
.podium-rank{position:relative;z-index:2;font-family:var(--disp);font-size:64px;font-style:italic;
  color:#05070F;margin-top:8px;opacity:0;transition:opacity .5s .25s ease;
  text-shadow:0 2px 0 #ffffff30;-webkit-text-stroke:1px #00000022}
.podium-col.is-up .podium-rank{opacity:.9}
.shine{position:absolute;z-index:1;top:0;bottom:0;width:48%;pointer-events:none;
  background:linear-gradient(105deg,transparent 0%,#ffffff66 50%,transparent 100%);
  animation:sweep 2.8s .6s ease-in-out infinite}
@keyframes sweep{0%{left:-60%}55%,100%{left:120%}}

.avatar{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  font-family:var(--disp);font-size:22px;letter-spacing:1px;font-style:italic;
  background:var(--bg1);color:var(--text);border:2px solid var(--line2);
  box-shadow:0 6px 16px #00000066;transform:rotate(-3deg)}
.avatar.pc-gold{border-color:var(--gold);color:var(--gold2);background:linear-gradient(160deg,#2A2410,#1A1608)}
.avatar.pc-silver{border-color:var(--silver);color:var(--silver2);background:linear-gradient(160deg,#232A3C,#161B28)}
.avatar.pc-bronze{border-color:var(--bronze);color:var(--bronze2);background:linear-gradient(160deg,#2A1F14,#1A130B)}
.avatar--ghost{opacity:.5;border-style:dashed;color:var(--dim);font-size:26px;transform:none}
.avatar--sm{width:42px;height:42px;font-size:16px;border-radius:11px}
.avatar--xs{width:30px;height:30px;font-size:12px;border-width:1px;border-radius:9px;flex:none;transform:none}

.suspense{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:3}
.suspense-dots{display:flex;gap:13px}
.suspense-dots i{width:13px;height:13px;border-radius:50%;background:var(--gold);animation:bounceDot 1s infinite}
.suspense-dots i:nth-child(2){animation-delay:.15s}
.suspense-dots i:nth-child(3){animation-delay:.3s}
@keyframes bounceDot{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-12px);opacity:1}}

.reveal-progress{display:flex;gap:8px;justify-content:center;margin-top:18px}
.dot{width:26px;height:5px;border-radius:3px;background:var(--line);transition:var(--tr)}
.dot--on{background:var(--gold);box-shadow:0 0 10px #FFC53188}
.controls{display:flex;justify-content:center;gap:10px;margin-top:16px;flex-wrap:wrap}
.hint{text-align:center;color:var(--dim2);font-size:12px;margin-top:9px;font-family:var(--mono)}
kbd{background:var(--card2);border:1px solid var(--line2);border-bottom-width:2px;border-radius:6px;
  padding:1px 7px;font-size:11px;font-family:var(--mono)}

.mentions{margin-top:32px;animation:fadeUp .6s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.mentions-title{display:flex;align-items:center;justify-content:center;gap:14px;
  font-family:var(--disp);letter-spacing:3px;color:var(--turf);font-size:20px;margin-bottom:15px;
  font-style:italic;text-transform:uppercase}
.mentions-title .rule{width:70px;height:2px;background:linear-gradient(90deg,transparent,#16DB9377)}
.mentions-title .rule:last-child{transform:scaleX(-1)}
.mentions-row{display:flex;justify-content:center;gap:14px;flex-wrap:wrap}
.mention-card{display:flex;align-items:center;gap:12px;background:linear-gradient(180deg,var(--card2),var(--card));
  border:1px solid var(--line);border-radius:14px;padding:12px 18px;min-width:220px;transition:var(--tr)}
.mention-card:hover{border-color:var(--line2);transform:translateY(-2px)}
.mention-rank{font-family:var(--disp);font-size:30px;color:var(--turf);width:38px;text-align:center;font-style:italic}
.mention-name{font-weight:800}
.mention-score{color:var(--turf);font-size:13px;font-family:var(--mono);font-variant-numeric:tabular-nums}

/* ---------- Explicación de puntos ---------- */
.scoring{margin:0 auto 22px;max-width:640px}
.scoring-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;
  background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:14px;
  color:var(--text);padding:13px 17px;font-family:var(--body);font-weight:700;font-size:14px;cursor:pointer;
  transition:var(--tr)}
.scoring-toggle:hover{border-color:var(--line2);transform:translateY(-1px)}
.chev{color:var(--dim);transition:transform var(--tr)}
.chev--up{transform:rotate(180deg)}
.scoring-body{background:var(--card);border:1px solid var(--line);border-top:none;
  border-radius:0 0 14px 14px;padding:17px;margin-top:-4px;animation:fadeUp .3s ease}
.scoring-body p{margin:0 0 12px}
.scoring-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:8px}
.scoring-item{display:flex;flex-direction:column;align-items:center;gap:3px;
  background:linear-gradient(180deg,var(--card2),var(--bg1));
  border:1px solid var(--line);border-radius:12px;padding:12px 6px;text-align:center}
.scoring-ic{font-size:22px}
.scoring-l{font-size:12px;color:var(--dim);font-family:var(--mono)}
.scoring-p{font-weight:800;color:var(--gold);font-family:var(--mono);font-variant-numeric:tabular-nums}

/* ---------- Fusión ---------- */
.detect-banner{margin-top:12px;background:#FFC5311a;border:1px solid #FFC53155;border-radius:12px;
  padding:11px 14px;font-size:13px;line-height:1.5}
.destino--merge{border-color:#16DB9355}
.destino-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.radio-card{display:flex;gap:11px;align-items:flex-start;padding:14px;border:1px solid var(--line);
  border-radius:13px;cursor:pointer;background:var(--bg1);transition:var(--tr)}
.radio-card:hover{border-color:var(--line2)}
.radio-card--on{border-color:var(--turf);background:#16DB930f;box-shadow:0 0 0 1px #16DB9355}
.radio-card input{margin-top:3px;accent-color:var(--turf);flex:none}
.radio-title{font-weight:800;font-size:13.5px}
.radio-sub{color:var(--dim);font-size:12px;margin-top:2px}
.merge-preview{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.mp-pill{font-size:12px;font-weight:700;border-radius:999px;padding:5px 12px;font-family:var(--mono);font-variant-numeric:tabular-nums}
.mp-add{background:#16DB9322;color:var(--turf);border:1px solid #16DB9355}
.mp-keep{background:#ffffff0a;color:var(--dim);border:1px solid var(--line)}

/* ---------- Cards / tablas ---------- */
.card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:var(--r);padding:17px}
.card--table{padding:6px 6px 12px;overflow-x:auto}
.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{text-align:left;color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:1.4px;
  font-weight:700;font-family:var(--mono);padding:13px 12px 11px;border-bottom:1px solid var(--line)}
.tbl td{padding:11px 12px;border-bottom:1px solid #26355F55}
.tbl tbody tr{cursor:pointer;transition:background var(--tr)}
.tbl tbody tr:hover{background:#ffffff08}
.tbl tbody tr:last-child td{border-bottom:none}
.row--top{background:#FFC5310a}
.tbl--edit tbody tr{cursor:default}
.tbl-note{color:var(--dim);font-size:12px;padding:11px 12px 0;font-family:var(--mono)}
.cell-person{display:flex;align-items:center;gap:10px}
.t-gold{color:var(--gold);font-weight:800;font-family:var(--mono);font-variant-numeric:tabular-nums}
.t-teal{color:var(--turf);font-weight:800;font-family:var(--mono);font-variant-numeric:tabular-nums}
.t-red{color:var(--hot2)}
.t-num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.th-hl{color:var(--gold)!important}
.td-champ{padding-left:12px}
.champ-pill{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:30px;
  padding:0 10px;border-radius:9px;font-family:var(--disp);font-style:italic;font-size:19px;
  background:linear-gradient(180deg,var(--gold2),var(--gold));color:#241800;
  box-shadow:0 3px 12px #FFC53133, inset 0 1px 0 #fff8;font-variant-numeric:tabular-nums}
tr.row--top .champ-pill{box-shadow:0 4px 16px #FFC53155, inset 0 1px 0 #fff8}
.rank-badge{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
  border-radius:10px;font-size:16px;font-weight:800;font-family:var(--disp);font-style:italic}
.rb-n{background:var(--card2);border:1px solid var(--line2);color:var(--dim)}
.mini-bar{display:inline-block;vertical-align:middle;width:72px;height:6px;background:var(--bg0);
  border-radius:3px;overflow:hidden;margin-right:8px}
.mini-bar i{display:block;height:100%;background:var(--turf);border-radius:3px}
.mini-bar-label{font-size:12px;color:var(--dim);font-family:var(--mono);font-variant-numeric:tabular-nums}

/* ---------- Preguntas ---------- */
.qgrid{display:grid;gap:10px}
.qcard{padding:13px 16px}
.qcard--hard{border-color:#FF2E6377}
.qrow{display:flex;justify-content:space-between;gap:14px;align-items:baseline}
.qtext{font-size:14px;font-weight:500}
.qscore{white-space:nowrap;font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:700;font-size:14px}
.qbar{height:7px;background:var(--bg0);border-radius:4px;margin-top:10px;overflow:hidden}
.qbar i{display:block;height:100%;border-radius:4px;transition:width .6s ease}
.bg-teal{background:var(--turf)} .bg-red{background:var(--hot)}
.qflag{color:var(--hot2);font-size:12px;margin-top:8px;font-weight:600}

/* ---------- Modales ---------- */
.overlay{position:fixed;inset:0;background:#03050Ccc;backdrop-filter:blur(5px);z-index:80;
  display:flex;align-items:center;justify-content:center;padding:14px;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal{background:var(--bg1);border:1px solid var(--line2);border-radius:20px;max-width:680px;width:100%;
  max-height:88vh;overflow-y:auto;padding:24px;box-shadow:0 30px 90px #000000aa;animation:popUp .25s ease}
.modal--wide{max-width:820px}
@keyframes popUp{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
.modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.modal-title-row{display:flex;align-items:center;gap:12px}
.modal-title{font-family:var(--disp);font-size:30px;font-style:italic;text-transform:uppercase;letter-spacing:.5px}
.consline{color:var(--text);margin-bottom:16px;font-size:14px}
.modal-ex{margin-bottom:18px}
.modal-ex-head{font-weight:800;margin-bottom:7px}
.modal-qs{display:grid;gap:4px;font-size:13px}
.q-ok{color:var(--text)} .q-bad{color:var(--hot2)}

/* ---------- Admin ---------- */
.admin-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.admin-head-l{display:flex;align-items:center;gap:14px}
.admin-badge{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:2px;
  padding:8px 12px;border-radius:10px;background:#FFC5311a;color:var(--gold);border:1px solid #FFC53155;white-space:nowrap}
.admin-title{font-family:var(--disp);font-size:32px;font-style:italic;color:var(--text);letter-spacing:.5px;line-height:1}
.admin-sub{color:var(--dim);font-size:13px;margin-top:2px}
.tabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap;background:#0A1024cc;border:1px solid var(--line);
  border-radius:14px;padding:5px;width:fit-content}
.tab{border:none;background:transparent;color:var(--dim);border-radius:10px;padding:9px 15px;
  font-family:var(--body);font-weight:700;font-size:13px;cursor:pointer;transition:var(--tr)}
.tab:hover{color:var(--text);background:#ffffff08}
.tab--on{background:var(--turf);color:#03251A;font-weight:800}
.tab--on:hover{background:var(--turf)}
.toast{border-radius:12px;padding:11px 15px;margin-bottom:14px;font-size:14px;font-weight:600;animation:fadeUp .3s ease}
.toast--ok{background:#16DB931e;border:1px solid #16DB9388;color:#8DF3CE}
.toast--err{background:#FF2E631e;border:1px solid #FF2E6388;color:#FFB3C6}
.stack{display:grid;gap:16px}
.upload-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:14px}
.dropzone{position:relative;border:2px dashed var(--line2);border-radius:18px;padding:30px 22px 24px;
  text-align:center;cursor:pointer;background:linear-gradient(180deg,var(--card2),var(--card));transition:var(--tr);
  display:flex;flex-direction:column;align-items:center}
.dropzone:hover{border-color:var(--gold);transform:translateY(-3px);box-shadow:0 16px 40px #00000066}
.dropzone--alt:hover{border-color:var(--turf)}
.opt-badge{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:1.5px;
  padding:4px 10px;border-radius:999px;margin-bottom:10px}
.opt-badge--a{background:#FFC5311f;color:var(--gold);border:1px solid #FFC53155}
.opt-badge--b{background:#ffffff0a;color:var(--dim);border:1px solid var(--line)}
.dropzone-icon{font-size:36px}
.dropzone-title{font-weight:800;margin:8px 0 4px;font-size:16px}
.dropzone-sub{color:var(--dim);font-size:13px;line-height:1.5;max-width:280px}
.dropzone-cta{margin-top:14px;font-family:var(--body);font-weight:800;font-size:13px;
  padding:9px 18px;border-radius:11px;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#241800;
  box-shadow:0 4px 14px #FFC53133}
.dropzone-cta--alt{background:#16DB931a;color:var(--turf);border:1px solid #16DB9355;box-shadow:none}
.upload-hint{background:#FFC5310f;border:1px solid #FFC53133;border-radius:12px;padding:12px 15px;
  font-size:13px;line-height:1.55;color:var(--text)}
.step{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:800;font-size:14px;margin-bottom:11px}
.step-n{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;
  border-radius:8px;background:var(--gold);color:#241800;font-size:13px;font-weight:800;font-family:var(--disp);font-style:italic}
.preview{margin-top:10px;font-size:13px;font-family:var(--mono);font-variant-numeric:tabular-nums;display:grid;gap:2px}
.pv-ok{color:var(--turf)} .pv-bad{color:var(--hot2)}
.alias-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.alias-raw{min-width:145px;font-weight:700}
.ex-card{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;transition:var(--tr)}
.ex-card:hover{border-color:var(--line2);transform:translateY(-1px)}
.ex-title{font-weight:800;font-size:15px}
.ex-actions{display:flex;gap:8px}
.part-card{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;transition:var(--tr)}
.part-card:hover{border-color:var(--line2)}
.part-card--off{opacity:.62;background:linear-gradient(180deg,#1a1420,#140e18)}
.part-info{display:flex;align-items:center;gap:11px}
.part-name{font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px}
.part-badge{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:1.5px;
  padding:2px 8px;border-radius:999px;background:#FF2E6322;color:var(--hot2);border:1px solid #FF2E6355}
.row-actions{display:flex;gap:10px;flex-wrap:wrap}
.row-add{display:flex;gap:8px;align-items:center;flex-wrap:wrap}

/* ---------- Inputs ---------- */
.inp{width:100%;background:var(--bg0);border:1px solid var(--line);border-radius:11px;color:var(--text);
  padding:11px 13px;font-size:14px;font-family:var(--body);transition:var(--tr)}
.inp:hover{border-color:var(--line2)}
.inp:focus{outline:none;border-color:var(--turf);box-shadow:0 0 0 3px #16DB9322}
.inp::placeholder{color:var(--dim2)}
.inp--mono{font-family:var(--mono);font-size:12.5px;resize:vertical}
.inp--select{width:auto;min-width:230px}
.inp--cell{width:96px;padding:7px 9px;font-family:var(--mono)}
.inp--xs{width:64px}
.inp--pin{text-align:center;letter-spacing:8px;font-size:20px;font-family:var(--mono)}
.lbl{display:block;color:var(--dim);font-size:12px;margin-bottom:6px;font-family:var(--mono);letter-spacing:.5px}

/* ---------- PIN / misc ---------- */
.pin-card{max-width:390px;margin:70px auto;text-align:center;padding:30px 26px}
.pin-lock{font-size:36px;margin-bottom:8px}
.pin-title{font-family:var(--disp);font-size:28px;font-style:italic;text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px}
.empty{text-align:center;color:var(--dim);padding:60px 20px;line-height:1.7}
.foot{text-align:center;margin-top:52px}
.confetti-layer{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:60}
@keyframes caer{0%{transform:translateY(0) translateX(0) rotate(0)}100%{transform:translateY(108vh) translateX(var(--drift)) rotate(720deg);opacity:.8}}

button:focus-visible,.inp:focus-visible{outline:2px solid var(--turf);outline-offset:2px}

/* ---------- Barra de usuario ---------- */
.userbar{display:flex;justify-content:center;margin-bottom:14px}
.user-chip{display:inline-flex;align-items:center;gap:9px;background:linear-gradient(180deg,var(--card2),var(--card));
  border:1px solid var(--line2);border-radius:999px;padding:6px 8px 6px 6px;cursor:pointer;transition:var(--tr);
  font-family:var(--body);color:var(--text);font-weight:700;font-size:13px}
.user-chip:hover{border-color:var(--turf);transform:translateY(-1px)}
.user-chip--login{padding:9px 18px;color:var(--dim)}
.user-chip--login:hover{color:var(--text)}
.user-chip-name{font-weight:800}
.user-chip-badge{font-family:var(--mono);font-size:10px;letter-spacing:1px;color:var(--turf);
  background:#16DB931a;border:1px solid #16DB9344;border-radius:999px;padding:3px 9px}

/* ---------- Pantalla de autenticación ---------- */
.auth{max-width:520px;margin:20px auto 0}
.auth-card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line2);
  border-radius:20px;overflow:hidden;box-shadow:0 20px 60px #00000066}
.auth-tabs{display:flex;border-bottom:1px solid var(--line)}
.auth-tab{flex:1;border:none;background:transparent;color:var(--dim);padding:15px;font-family:var(--body);
  font-weight:800;font-size:14px;cursor:pointer;transition:var(--tr)}
.auth-tab:hover{color:var(--text);background:#ffffff05}
.auth-tab--on{color:var(--text);box-shadow:inset 0 -3px 0 var(--turf)}
.auth-body{padding:22px}
.auth-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.auth-err{color:var(--hot2);font-size:13px;margin-top:10px;background:#FF2E6314;border:1px solid #FF2E6344;
  border-radius:9px;padding:9px 12px}
.auth-privacy{font-size:12px;color:var(--dim);background:var(--bg0);border:1px solid var(--line);
  border-radius:10px;padding:11px 13px;margin-top:14px;line-height:1.5}
.auth-hint{font-size:12px;color:var(--dim);margin-top:6px}

/* ---------- Perfil del participante ---------- */
.profile-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:18px}
.pstat{background:linear-gradient(180deg,var(--card2),var(--bg1));border:1px solid var(--line);border-radius:12px;
  padding:13px 6px;text-align:center;display:flex;flex-direction:column;gap:3px}
.pstat-n{font-family:var(--disp);font-style:italic;font-size:26px;line-height:1}
.pstat-l{font-size:10px;color:var(--dim);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px}
.profile-nolink{background:#FFC5310f;border:1px solid #FFC53133;border-radius:12px;padding:13px 15px;
  font-size:13px;line-height:1.5;margin-bottom:18px}
.profile-field{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #26355F55}
.pf-l{color:var(--dim);font-size:13px}
.pf-v{font-weight:700;font-size:14px;text-align:right}
.profile-expect{padding:14px 0 4px}
.pf-quote{font-style:italic;color:var(--text);background:var(--bg0);border-left:3px solid var(--turf);
  border-radius:0 10px 10px 0;padding:12px 15px;font-size:14px;line-height:1.55;margin-top:4px}

/* ---------- Admin usuarios ---------- */
.user-card{padding:0;overflow:hidden}
.user-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px}
.user-card-info{display:flex;align-items:center;gap:11px;cursor:pointer;flex:1}
.user-card-name{font-weight:800;font-size:15px}
.user-card-body{padding:0 16px 16px;border-top:1px solid var(--line)}
.user-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
.ufield{display:flex;flex-direction:column;gap:2px;background:var(--bg0);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.uf-l{color:var(--dim);font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px}
.uf-v{font-weight:700;font-size:13.5px}
.user-expect{margin-top:10px}
.link-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}

/* ---------- Switch de modo Ruta / Podio ---------- */
.mode-switch{display:flex;gap:8px;justify-content:center;margin-bottom:22px;flex-wrap:wrap}
.mode-btn{font-family:var(--body);font-weight:800;font-size:14px;border-radius:13px;padding:12px 22px;
  cursor:pointer;border:1px solid var(--line);background:#ffffff06;color:var(--dim);transition:var(--tr)}
.mode-btn:hover{color:var(--text);border-color:var(--line2);transform:translateY(-1px)}
.mode-btn--on{background:linear-gradient(180deg,var(--card2),var(--card));color:var(--text);
  border-color:var(--turf);box-shadow:0 6px 20px #16DB9322, inset 0 0 0 1px #16DB9333}

/* ---------- Ruta formativa (cancha) ---------- */
.route{position:relative}
.route-intro{display:flex;align-items:center;gap:14px;justify-content:center;margin-bottom:26px}
.route-kick{font-size:32px;animation:roll 5s linear infinite}
.route-title{font-family:var(--disp);font-style:italic;font-size:30px;letter-spacing:.5px;text-transform:uppercase}
.route-sub{color:var(--dim);font-size:13px;font-family:var(--mono)}

.pitch-path{position:relative;padding:10px 0 40px;
  background:
    linear-gradient(180deg,#0d3a26 0%,#0a2e1e 100%);
  border-radius:20px;border:1px solid #1c6b47;overflow:hidden;
  box-shadow:inset 0 0 80px #05170e}
.pitch-path::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(180deg,#ffffff08 0 60px,transparent 60px 120px)}
.pitch-path::after{content:'';position:absolute;left:50%;top:26px;transform:translateX(-50%);
  width:120px;height:120px;border:2px solid #ffffff2a;border-radius:50%;pointer-events:none}
.path-line{position:absolute;left:50%;top:0;bottom:60px;width:3px;transform:translateX(-50%);
  background:repeating-linear-gradient(180deg,#ffffff55 0 12px,transparent 12px 24px);z-index:1}

.station{position:relative;z-index:2;display:flex;align-items:center;gap:14px;margin:22px 0;padding:0 18px;width:56%}
.station--left{margin-right:auto;flex-direction:row}
.station--right{margin-left:auto;flex-direction:row-reverse;text-align:right}
.station-node{width:44px;height:44px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#1a2348,#111a38);border:3px solid var(--turf);
  font-family:var(--disp);font-style:italic;font-size:20px;color:var(--turf2);
  box-shadow:0 4px 16px #16DB9333, 0 0 0 6px #0a2e1e;z-index:3}
.station--goal .station-node{border-color:var(--gold);color:var(--gold2);font-size:22px;
  box-shadow:0 4px 20px #FFC53144, 0 0 0 6px #0a2e1e}
.station-num{line-height:1}
.station-card{flex:1;text-align:inherit;background:linear-gradient(180deg,var(--card2),var(--card));
  border:1px solid var(--line2);border-radius:14px;padding:13px 16px;cursor:pointer;transition:var(--tr);
  display:flex;flex-direction:column;gap:3px;color:var(--text)}
.station-card:hover{transform:translateY(-2px);border-color:var(--turf);box-shadow:0 10px 30px #00000055}
.station--goal .station-card{border-color:#FFC53166;background:linear-gradient(180deg,#231d0e,#141020)}
.station--goal .station-card:hover{border-color:var(--gold)}
.station-head{display:flex;align-items:center;gap:8px;justify-content:space-between}
.station--right .station-head{flex-direction:row-reverse}
.station-tag{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--turf)}
.station--goal .station-tag{color:var(--gold2)}
.station-meta{font-size:11px;color:var(--dim);font-family:var(--mono)}
.station-title{font-family:var(--disp);font-style:italic;font-size:19px;letter-spacing:.3px;line-height:1.1;text-transform:uppercase;color:var(--text)}
.station-desc{color:var(--dim);font-size:13px;line-height:1.4}
.station-cta{color:var(--turf);font-size:12px;font-weight:700;margin-top:3px}
.station--goal .station-cta{color:var(--gold2)}

.goal-net{position:relative;z-index:2;margin:30px auto 0;width:70%;text-align:center}
.goal-post{height:60px;border:4px solid #ffffffcc;border-bottom:none;border-radius:8px 8px 0 0;
  background:repeating-linear-gradient(90deg,#ffffff10 0 8px,transparent 8px 16px),repeating-linear-gradient(180deg,#ffffff10 0 8px,transparent 8px 16px)}
.goal-label{margin-top:10px;font-family:var(--disp);font-style:italic;font-size:18px;color:var(--gold2);letter-spacing:.5px}

/* modal de bloque + visor */
.block-badge{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;
  font-size:20px;background:#16DB931a;border:1px solid #16DB9355}
.ppt-frame{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;
  border:1px solid var(--line2);background:#000;margin-bottom:12px}
.ppt-frame iframe{position:absolute;inset:0;width:100%;height:100%}
.ppt-block{margin-bottom:16px}
.ppt-open-btn{display:flex;width:100%;justify-content:center}
.viewer-open-btn{display:flex;width:calc(100% - 36px);margin:12px 18px 0;justify-content:center}
.viewer-fallback{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;text-align:center;padding:24px;background:linear-gradient(180deg,var(--card2),var(--bg1))}
.vf-ic{font-size:44px}
.vf-title{font-family:var(--disp);font-style:italic;font-size:22px;letter-spacing:.3px}
.vf-sub{color:var(--dim);font-size:14px;max-width:340px;line-height:1.5}
.viewer-fallback .btn{margin-top:6px}
.ppt-empty{background:var(--bg0);border:1px dashed var(--line2);border-radius:12px;padding:24px;
  text-align:center;color:var(--dim);font-size:13px;margin-bottom:16px}
.res-group{margin-top:14px}
.res-group-title{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--dim);
  text-transform:uppercase;margin-bottom:9px}
.res-list{display:flex;flex-wrap:wrap;gap:10px}
.res-btn{display:flex;align-items:center;gap:10px;padding:11px 15px;border-radius:12px;cursor:pointer;
  border:1px solid var(--line2);background:linear-gradient(180deg,var(--card2),var(--card));transition:var(--tr);
  font-family:var(--body);color:var(--text);text-align:left}
.res-btn:hover{transform:translateY(-2px);box-shadow:0 8px 22px #00000055}
.res-btn--game:hover{border-color:var(--turf)}
.res-btn--video:hover{border-color:var(--hot)}
.res-ic{font-size:20px}
.res-txt{display:flex;flex-direction:column;line-height:1.2}
.res-label{font-weight:700;font-size:14px}
.res-slide{font-size:11px;color:var(--dim);font-family:var(--mono)}

.overlay--dark{background:#02040acc}
.viewer{background:var(--bg1);border:1px solid var(--line2);border-radius:18px;width:100%;max-width:1000px;
  max-height:92vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 90px #000000aa;animation:popUp .25s ease}
.viewer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.viewer-title{font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px}
.viewer-actions{display:flex;gap:8px}
.viewer-frame{position:relative;width:100%;aspect-ratio:16/9;background:#000;flex:none}
.viewer-frame iframe{position:absolute;inset:0;width:100%;height:100%}
.viewer-note{padding:10px 18px;font-size:12px;text-align:center}

/* editor de ruta */
.block-edit{border-color:var(--line2)}
.block-edit--locked{border-color:#FFC53155;background:linear-gradient(180deg,#1c1810,#141020)}
.block-edit-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.block-edit-n{width:34px;height:34px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;
  font-family:var(--disp);font-style:italic;font-size:17px;background:var(--turf);color:#03251A}
.block-edit-move{display:flex;gap:4px;flex:none}
.lock-toggle{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;
  background:var(--bg0);border:1px solid var(--line);border-radius:11px;padding:11px 14px;margin-bottom:12px;transition:var(--tr)}
.lock-toggle:hover{border-color:var(--line2)}
.lock-toggle--on{background:#FFC5310d;border-color:#FFC53155}
.lock-ic{font-size:20px;flex:none}
.lock-txt{display:flex;flex-direction:column;flex:1;line-height:1.3;font-size:13.5px}
.lock-txt .dim{font-size:12px}
.lock-switch{flex:none;width:44px;height:24px;border-radius:999px;background:var(--line);position:relative;transition:var(--tr)}
.lock-toggle--on .lock-switch{background:var(--gold)}
.lock-knob{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:var(--tr)}
.lock-toggle--on .lock-knob{left:22px}
.del-confirm{background:#FF2E6314;border:1px solid #FF2E6355;border-radius:11px;padding:12px 14px;margin-bottom:12px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13.5px}
.del-confirm-actions{display:flex;gap:8px;flex:none}

/* estación bloqueada (vista pública) */
.station--locked .station-node{border-color:#5A6799;color:var(--dim)}
.station--locked .station-card{opacity:.72;cursor:not-allowed;border-color:var(--line);
  background:linear-gradient(180deg,#12172b,#0d1120)}
.station--locked .station-card:hover{transform:none;border-color:var(--line);box-shadow:none}
.station--locked .station-tag{color:var(--dim)}
.station--locked .station-cta{color:var(--dim2)}
.station--locked .station-title{color:var(--dim)}
.res-edit-groups{margin-top:14px}
.res-edit-list{display:grid;gap:8px;margin-bottom:10px}
.res-edit{display:flex;align-items:center;gap:8px;padding:8px;border-radius:10px;
  background:var(--bg0);border:1px solid var(--line)}
.res-edit--game{border-left:3px solid var(--turf)}
.res-edit--video{border-left:3px solid var(--hot)}
.res-edit-ic{font-size:18px;flex:none}
.inp--sm{padding:8px 10px;font-size:13px}
.inp--slide{width:60px;flex:none;padding:8px;text-align:center;font-family:var(--mono)}
.res-add-row{display:flex;gap:8px;flex-wrap:wrap}
.add-block-btn{justify-self:center;margin:0 auto;display:block}
.route-save{display:flex;align-items:center;gap:12px;position:sticky;bottom:0;padding:14px 0;
  background:linear-gradient(180deg,transparent,var(--bg0) 40%)}
.warn-inline{color:var(--gold2);font-size:12px;margin-top:6px}
.ok-inline{color:var(--turf);font-size:12px;margin-top:6px}
.ppt-input-group{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.ppt-upload-btn{cursor:pointer;position:relative}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
}
@media (max-width:560px){
  .stage{min-height:340px;gap:2%}
  .podium-head{min-height:150px}
  .player-card{padding:12px 8px}
  .avatar{width:46px;height:46px;font-size:18px}
  .podium-rank{font-size:48px}
  .podium-name{font-size:16px}
  .mention-card{min-width:180px;padding:10px 14px}
  .destino-opts{grid-template-columns:1fr}
  .scoring-grid{grid-template-columns:repeat(2,1fr)}
  .ht-line{-webkit-text-stroke:0}
  .logo-svg{width:min(360px,90vw)}
  .upload-grid{grid-template-columns:1fr}
  .station{width:88%}
  .res-edit{flex-wrap:wrap}
  .inp--sm{min-width:120px}
  .auth-grid{grid-template-columns:1fr}
  .profile-stats{grid-template-columns:repeat(2,1fr)}
  .user-fields{grid-template-columns:1fr}
}
`;
