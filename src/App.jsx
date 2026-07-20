import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";

/* ================= Config ================= */
const PASSING_PCT = 80;
const AUDIO_COMPLETE_PCT = 85;
const REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== ConexiÃ³n a Supabase (base de datos) ===== */
const SUPABASE_URL = "https://ereginsabjkoeopydnmi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyZWdpbnNhYmprb2VvcHlkbm1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMjAxODksImV4cCI6MjA5ODg5NjE4OX0._P88jMQp7DP3HyAUZEv1rw5K83M_wrPD69zxfAnobs4";
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};
// Helper genÃ©rico para la API REST de Supabase (PostgREST)
function mimeFromFileName(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  return {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    aac: "audio/aac",
    pdf: "application/pdf",
  }[ext] || "application/octet-stream";
}
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

// Sube un archivo a Supabase Storage y devuelve su URL pÃºblica.
// Los audios van al bucket "audios"; los PDFs/imÃ¡genes al bucket "presentaciones".
async function sbUpload(file) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}_${safe}`;
  const rawType = file.type || mimeFromFileName(safe);
  const extAudio = /\.(mp3|m4a|wav|ogg|aac|opus|mpeg|mpg)$/i.test(safe);
  const esAudio = /^audio\//.test(rawType) || extAudio;
  // Si el navegador reporta un type raro (video/mpeg, application/octet-stream) pero la extensión
  // dice que es audio, normalizamos a audio/mpeg para que el bucket lo acepte.
  const contentType = esAudio && !/^audio\//.test(rawType) ? "audio/mpeg" : rawType;
  const bucket = esAudio ? "audios" : "presentaciones";
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Storage ${res.status}: ${txt}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`;
}

/* ================= Utilidades ================= */
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const phraseKey = (s) => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const ACCESS_PHRASE_KEY = "firmes en la fe sobre la roca";
const normEmail = (s) => String(s || "").trim().toLowerCase();
const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
const hasMeaningfulAnswer = (s) => phraseKey(s).replace(/[^a-z0-9]/g, "").length >= 2;
const STORE = {
  userId: "eje.session.userId",
  adminOpen: "eje.session.adminOpen",
  adminTab: "eje.ui.adminTab",
  mode: "eje.ui.mode",
  selectedExercise: "eje.ui.selectedExercise",
  podiumSection: "eje.ui.podiumSection",
  roleplayRole: "eje.ui.roleplayRole",
  roleplaySession: "eje.ui.roleplaySession",
  roleplayHidden: "eje.ui.roleplayHidden",
};
function readStore(key, fallback = "") {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (value == null || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {}
}
function readStoreJson(key, fallback) {
  try {
    return JSON.parse(readStore(key, ""));
  } catch {
    return fallback;
  }
}
function writeStoreJson(key, value) {
  writeStore(key, JSON.stringify(value));
}
const ROLEPLAY_ROLES = [
  { key: "asesor", label: "Asesor", hint: "Crea sesiones de prÃ¡ctica con cÃ³digo y asignaciÃ³n de casos." },
  { key: "apoyo_interno", label: "Apoyo interno", hint: "Practica con juegos asignados por administraciÃ³n." },
  { key: "apoyo_externo", label: "Apoyo externo", hint: "Practica con juegos asignados por administraciÃ³n." },
  { key: "coordinador", label: "Coordinador", hint: "Consulta PDFs y audios necesarios para el retiro." },
];
const DEFAULT_ASCOS_TYPES = [
  { id: "pregunton", name: "El PreguntÃ³n Eterno", guide: "Solo quiere hacerse notar." },
  { id: "cabeza_dura", name: "El Cabeza Dura", guide: "No entiende razones y no quiere aprender de otros." },
  { id: "timido", name: "El TÃ­mido", guide: "Tiene ideas, pero le cuesta decirlas." },
  { id: "mudo_voluntario", name: "El Mudo Voluntario", guide: "No participa por aburrimiento, inseguridad o actitud distante." },
  { id: "charlatan", name: "El CharlatÃ¡n", guide: "Habla todo el tiempo y se sale del tema." },
  { id: "distraido", name: "El DistraÃ­do", guide: "Salta de un tema a otro y desvÃ­a al grupo." },
  { id: "detallista", name: "El Detallista", guide: "Se enreda en detalles y frena el avance." },
  { id: "gran_tipo", name: "El Gran Tipo", guide: "Siempre quiere ayudar y estÃ¡ dispuesto a escuchar." },
  { id: "profundo", name: "El Calahondo o Profundo", guide: "Habla poco, pero va directo a lo central." },
  { id: "buen_humor", name: "El de Buen Humor", guide: "Ayuda a aliviar tensiones con optimismo." },
  { id: "concreto", name: "El Tipo Concreto", guide: "Aterriza el tema con hechos y experiencias." },
  { id: "positivo", name: "El Hombre Positivo", guide: "Encuentra el lado bueno y defiende a los mÃ¡s dÃ©biles." },
];
const DEFAULT_APOYO_EXTERNO_RESOURCES = [
  {
    id: "apoyo_externo_quiz_html",
    type: "html",
    label: "Quiz - Apoyo Externo",
    url: "/apoyo_externo_quiz.html",
    note: "Juego HTML cargado como prÃ¡ctica editable desde administraciÃ³n.",
  },
];
const DEFAULT_APOYO_INTERNO_RESOURCES = [
  { id: "mat_recepcion", type: "materials", time: "SÃ¡bado 8:00", label: "RecepciÃ³n", materials: "Mesitas, sillas, alfileres, solapines, listas, hojas de bienvenida, afiche Bienvenidos a EJE y mÃºsica de recepciÃ³n." },
  { id: "mat_ingreso", type: "materials", time: "SÃ¡bado 8:55", label: "Ingreso al salÃ³n", materials: "Afiches de bienvenida, escudo de EJE y mÃºsica de entrada." },
  { id: "mat_presentacion", type: "materials", time: "SÃ¡bado 9:00", label: "PresentaciÃ³n", materials: "Cartulinas para solapines, lapiceros, plumones, hojas de resma, alfileres, clips, lanas y crayolas." },
  { id: "mat_reglas", type: "materials", time: "SÃ¡bado 10:05", label: "Reglas y normas", materials: "Sobres para recoger relojes y maletÃ­n con llave." },
  { id: "mat_amigo_secreto", type: "materials", time: "SÃ¡bado 10:20", label: "Amigo secreto", materials: "Dos canastas, papelitos, lapiceros y mÃºsica indicada para la dinÃ¡mica." },
  { id: "mat_juegos", type: "materials", time: "SÃ¡bado 3:05", label: "CuÃ¡les son mis juegos", materials: "Volante de Juegos y lectura o grabaciÃ³n del volante." },
  { id: "mat_mimo", type: "materials", time: "SÃ¡bado 4:55", label: "Mimo: La Caja", materials: "Hojita de difÃ­cil compartir y mÃºsica indicada." },
  { id: "mat_agape", type: "materials", time: "SÃ¡bado 7:00", label: "Ãgape", materials: "Adornos, cadenetas, velas en cada mesa, aparatos de audio, Biblia Lc 24, 13-34 y mÃºsica indicada." },
  { id: "mat_alegria", type: "materials", time: "SÃ¡bado 7:45", label: "Hora de la alegrÃ­a", materials: "Sociodramas, cantos de animaciÃ³n, diapositivas o pelÃ­cula indicada." },
  { id: "mat_confianza", type: "materials", time: "SÃ¡bado 8:45", label: "Confianza", materials: "Itinerario, obstÃ¡culos, lugar preparado para la celebraciÃ³n y mÃºsica indicada." },
  { id: "mat_perdon", type: "materials", time: "SÃ¡bado 9:15", label: "CelebraciÃ³n del perdÃ³n", materials: "Cirio grande, velas, cruz, alfileres, papel de seda, lapiceros, tablitas, fÃ³sforos, cancioneros, hojitas de celebraciÃ³n y mÃºsica indicada." },
  { id: "mat_oracion", type: "materials", time: "Domingo 9:40", label: "Poder de la oraciÃ³n y carta de amor", materials: "Pescaditos y cartas para entregar a asesores de grupo al final del poder de la oraciÃ³n." },
  { id: "mat_mundo", type: "materials", time: "Domingo 12:00", label: "Podemos cambiar el mundo", materials: "MÃºsica SueÃ±o Imposible, Vamos con alegrÃ­a, Id y EnseÃ±ad, y materiales definidos por coordinaciÃ³n." },
  { id: "mat_clausura", type: "materials", time: "Domingo 1:30", label: "EucaristÃ­a de clausura", materials: "Altar preparado, lecturas coordinadas con el director espiritual y materiales litÃºrgicos necesarios." },
];
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
    email: u.email || "",
    passHash: u.pass_hash,
    birthdate: u.birthdate || "",
    retreatDate: u.retreat_date || "",
    expectations: u.expectations || "",
    linkedCanon: u.linked_canon || "",
  }));
}

function mapProgress(progressRows = []) {
  return (progressRows || []).map((p) => ({
    id: p.id,
    userId: p.user_id,
    blockId: p.block_id,
    completed: !!p.completed,
    completedAt: p.completed_at || "",
    openedAt: p.opened_at || "",
    audioPercent: toInt(p.audio_percent, 0),
    audioCompleted: !!p.audio_completed,
    audioCompletedAt: p.audio_completed_at || "",
    createdAt: p.created_at || "",
    updatedAt: p.updated_at || "",
  }));
}

function mapAttendance(attendanceRows = []) {
  return (attendanceRows || []).map((a) => ({
    id: a.id,
    userId: a.user_id,
    blockId: a.block_id,
    attended: !!a.attended,
    createdAt: a.created_at || "",
    updatedAt: a.updated_at || "",
  }));
}

function mapQuestions(questionRows = []) {
  return (questionRows || []).map((q) => ({
    id: q.id,
    userId: q.user_id || "",
    userName: q.user_name || "",
    question: q.question || "",
    status: q.status || "new",
    answer: q.answer || "",
    createdAt: q.created_at || "",
    updatedAt: q.updated_at || "",
  }));
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapRoleplaySessions(sessionRows = []) {
  return (sessionRows || []).map((s) => ({
    id: s.id,
    code: s.code || "",
    roleType: s.role_type || "asesor",
    ownerUserId: s.owner_user_id || "",
    ownerName: s.owner_name || "",
    status: s.status || "open",
    participants: safeJsonArray(s.participants),
    createdAt: s.created_at || "",
    updatedAt: s.updated_at || "",
  }));
}

function mapRoleplayEvents(eventRows = []) {
  return (eventRows || []).map((e) => ({
    id: e.id,
    userId: e.user_id || "",
    userName: e.user_name || "",
    roleType: e.role_type || "",
    resourceId: e.resource_id || "",
    sessionId: e.session_id || "",
    eventType: e.event_type || "open",
    createdAt: e.created_at || "",
  }));
}

async function loadProgress() {
  try {
    const rows = await sbFetch("route_progress?select=*&order=updated_at.desc");
    return mapProgress(rows);
  } catch (e) {
    console.warn("loadProgress Supabase:", e);
    return [];
  }
}

async function loadAttendance() {
  try {
    const rows = await sbFetch("session_attendance?select=*&order=updated_at.desc");
    return mapAttendance(rows);
  } catch (e) {
    console.warn("loadAttendance Supabase:", e);
    return [];
  }
}

async function loadQuestions() {
  try {
    const rows = await sbFetch("question_box?select=*&order=created_at.desc");
    return mapQuestions(rows);
  } catch (e) {
    console.warn("loadQuestions Supabase:", e);
    return [];
  }
}

async function loadRoleplaySessions() {
  try {
    const rows = await sbFetch("roleplay_sessions?select=*&order=created_at.desc");
    return mapRoleplaySessions(rows);
  } catch (e) {
    console.warn("loadRoleplaySessions Supabase:", e);
    return [];
  }
}

async function loadRoleplayEvents() {
  try {
    const rows = await sbFetch("roleplay_events?select=*&order=created_at.desc");
    return mapRoleplayEvents(rows);
  } catch (e) {
    console.warn("loadRoleplayEvents Supabase:", e);
    return [];
  }
}

async function saveBlockProgress(userId, blockId, completed = true) {
  return saveRouteProgress(userId, blockId, { completed });
}

async function saveRouteProgress(userId, blockId, patch = {}) {
  const now = new Date().toISOString();
  const row = {
    id: `${userId}_${blockId}`,
    user_id: userId,
    block_id: blockId,
    updated_at: now,
  };
  if ("completed" in patch) {
    row.completed = !!patch.completed;
    row.completed_at = patch.completed ? now : null;
  }
  if (patch.opened) row.opened_at = now;
  if (patch.audioPercent != null) row.audio_percent = Math.max(0, Math.min(100, toInt(patch.audioPercent, 0)));
  if (patch.audioCompleted != null) {
    row.audio_completed = !!patch.audioCompleted;
    if (patch.audioCompleted) row.audio_completed_at = now;
  }
  const saved = await sbFetch("route_progress?on_conflict=user_id,block_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  return mapProgress(saved)[0] || mapProgress([row])[0];
}

async function saveSessionAttendance(userId, blockId, attended = true) {
  const now = new Date().toISOString();
  const row = {
    id: `${userId}_${blockId}`,
    user_id: userId,
    block_id: blockId,
    attended: !!attended,
    updated_at: now,
  };
  const saved = await sbFetch("session_attendance?on_conflict=user_id,block_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  return mapAttendance(saved)[0] || mapAttendance([row])[0];
}

async function submitQuestion(user, question) {
  const now = new Date().toISOString();
  const row = {
    id: uid(),
    user_id: user?.id || null,
    user_name: user?.name || "",
    question: String(question || "").trim(),
    status: "new",
    created_at: now,
    updated_at: now,
  };
  const saved = await sbFetch("question_box", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return mapQuestions(saved)[0] || mapQuestions([row])[0];
}

async function updateQuestionBox(id, patch = {}) {
  const row = { updated_at: new Date().toISOString() };
  if ("status" in patch) row.status = patch.status;
  if ("answer" in patch) row.answer = patch.answer || null;
  const saved = await sbFetch(`question_box?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return mapQuestions(saved)[0];
}

async function saveRoleplaySession(session) {
  const now = new Date().toISOString();
  const row = {
    id: session.id || uid(),
    code: String(session.code || "").trim().toUpperCase(),
    role_type: session.roleType || "asesor",
    owner_user_id: session.ownerUserId || null,
    owner_name: session.ownerName || null,
    status: session.status || "open",
    participants: session.participants || [],
    updated_at: now,
  };
  const saved = await sbFetch("roleplay_sessions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  return mapRoleplaySessions(saved)[0] || mapRoleplaySessions([row])[0];
}

async function recordRoleplayEvent(user, roleType, resourceId = "", eventType = "open", sessionId = "") {
  const row = {
    id: uid(),
    user_id: user?.id || null,
    user_name: user?.name || "",
    role_type: roleType || "",
    resource_id: resourceId || null,
    session_id: sessionId || null,
    event_type: eventType || "open",
    created_at: new Date().toISOString(),
  };
  const saved = await sbFetch("roleplay_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return mapRoleplayEvents(saved)[0] || mapRoleplayEvents([row])[0];
}

/* ===== Carga: arma el objeto 'data' leyendo las 4 tablas ===== */
async function loadData() {
  try {
    const [configRows, routeRows, exRows, userRows, progress, attendance, questions, roleplaySessions, roleplayEvents] = await Promise.all([
      sbFetch("config?id=eq.main&select=data"),
      sbFetch("route?id=eq.main&select=data"),
      sbFetch("exercises?select=id,data&order=created_at.asc"),
      sbFetch("users?select=*&order=created_at.asc"),
      loadProgress(),
      loadAttendance(),
      loadQuestions(),
      loadRoleplaySessions(),
      loadRoleplayEvents(),
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
      progress,
      attendance,
      questions,
      roleplay: normalizeRoleplay(config.roleplay),
      roleplaySessions,
      roleplayEvents,
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

/* ===== Guardado inteligente: detecta quÃ© cambiÃ³ y actualiza solo esa tabla ===== */
async function saveData(next, prev) {
  const jobs = [];
  const p = prev || {};

  // config (pin, aliases, excluded)
  const cfgNext = { pin: next.pin ?? null, aliases: next.aliases || {}, excluded: next.excluded || [] };
  cfgNext.roleplay = normalizeRoleplay(next.roleplay);
  const cfgPrev = { pin: p.pin ?? null, aliases: p.aliases || {}, excluded: p.excluded || [], roleplay: normalizeRoleplay(p.roleplay) };
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
          id: u.id, name: u.name, email: u.email || null, pass_hash: u.passHash,
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

function latestIso(...values) {
  return values.filter(Boolean).sort().at(-1) || "";
}
function earliestIso(...values) {
  return values.filter(Boolean).sort()[0] || "";
}
function mergeUserProfile(target, source) {
  return {
    ...target,
    email: target.email || source.email || "",
    birthdate: target.birthdate || source.birthdate || "",
    retreatDate: target.retreatDate || source.retreatDate || "",
    expectations: target.expectations || source.expectations || "",
    linkedCanon: target.linkedCanon || source.linkedCanon || "",
  };
}
function mergeProgressRows(a, b, userId, blockId) {
  const x = a || {};
  const y = b || {};
  return {
    ...x,
    ...y,
    id: `${userId}_${blockId}`,
    userId,
    blockId,
    completed: !!(x.completed || y.completed),
    completedAt: latestIso(x.completedAt, y.completedAt),
    openedAt: latestIso(x.openedAt, y.openedAt),
    audioPercent: Math.max(toInt(x.audioPercent, 0), toInt(y.audioPercent, 0)),
    audioCompleted: !!(x.audioCompleted || y.audioCompleted),
    audioCompletedAt: latestIso(x.audioCompletedAt, y.audioCompletedAt),
    createdAt: earliestIso(x.createdAt, y.createdAt),
    updatedAt: latestIso(x.updatedAt, y.updatedAt) || new Date().toISOString(),
  };
}
function mergeAttendanceRows(a, b, userId, blockId) {
  const x = a || {};
  const y = b || {};
  return {
    ...x,
    ...y,
    id: `${userId}_${blockId}`,
    userId,
    blockId,
    attended: !!(x.attended || y.attended),
    createdAt: earliestIso(x.createdAt, y.createdAt),
    updatedAt: latestIso(x.updatedAt, y.updatedAt) || new Date().toISOString(),
  };
}
function mergeProgressForAccounts(rows = [], sourceId, targetId) {
  const byKey = new Map();
  for (const row of rows) {
    const userId = row.userId === sourceId ? targetId : row.userId;
    const key = `${userId}|${row.blockId}`;
    const nextRow = { ...row, userId, id: `${userId}_${row.blockId}` };
    byKey.set(key, mergeProgressRows(byKey.get(key), nextRow, userId, row.blockId));
  }
  return [...byKey.values()];
}
function mergeAttendanceForAccounts(rows = [], sourceId, targetId) {
  const byKey = new Map();
  for (const row of rows) {
    const userId = row.userId === sourceId ? targetId : row.userId;
    const key = `${userId}|${row.blockId}`;
    const nextRow = { ...row, userId, id: `${userId}_${row.blockId}` };
    byKey.set(key, mergeAttendanceRows(byKey.get(key), nextRow, userId, row.blockId));
  }
  return [...byKey.values()];
}
function mergeSessionParticipants(participants = [], source, target) {
  const byUser = new Map();
  for (const p of participants || []) {
    const isSource = p.userId === source.id || (!p.userId && norm(p.userName) === norm(source.name));
    const next = isSource ? { ...p, userId: target.id, userName: target.name } : { ...p };
    const key = next.userId || norm(next.userName);
    const prev = byUser.get(key);
    if (!prev) {
      byUser.set(key, next);
    } else {
      byUser.set(key, {
        ...prev,
        assignedRoleId: prev.assignedRoleId || next.assignedRoleId,
        assignedRole: prev.assignedRole || next.assignedRole,
        guide: prev.guide || next.guide,
        isFacilitator: !!(prev.isFacilitator || next.isFacilitator),
        joinedAt: earliestIso(prev.joinedAt, next.joinedAt) || prev.joinedAt || next.joinedAt,
      });
    }
  }
  return [...byUser.values()];
}
function buildMergedAccountData(data, sourceId, targetId) {
  const users = data.users || [];
  const source = users.find((u) => u.id === sourceId);
  const target = users.find((u) => u.id === targetId);
  if (!source || !target || source.id === target.id) return null;
  const mergedTarget = mergeUserProfile(target, source);
  const mergedSessions = (data.roleplaySessions || []).map((s) => {
    const ownerIsSource = s.ownerUserId === source.id || (!s.ownerUserId && norm(s.ownerName) === norm(source.name));
    return {
      ...s,
      ownerUserId: ownerIsSource ? target.id : s.ownerUserId,
      ownerName: ownerIsSource ? target.name : s.ownerName,
      participants: mergeSessionParticipants(s.participants || [], source, target),
    };
  });
  return {
    ...data,
    users: users.filter((u) => u.id !== source.id).map((u) => (u.id === target.id ? mergedTarget : u)),
    progress: mergeProgressForAccounts(data.progress || [], source.id, target.id),
    attendance: mergeAttendanceForAccounts(data.attendance || [], source.id, target.id),
    questions: (data.questions || []).map((q) => (q.userId === source.id ? { ...q, userId: target.id, userName: target.name } : q)),
    roleplayEvents: (data.roleplayEvents || []).map((e) => (e.userId === source.id ? { ...e, userId: target.id, userName: target.name } : e)),
    roleplaySessions: mergedSessions,
  };
}
async function upsertProgressRow(row) {
  const db = {
    id: `${row.userId}_${row.blockId}`,
    user_id: row.userId,
    block_id: row.blockId,
    completed: !!row.completed,
    completed_at: row.completedAt || null,
    opened_at: row.openedAt || null,
    audio_percent: Math.max(0, Math.min(100, toInt(row.audioPercent, 0))),
    audio_completed: !!row.audioCompleted,
    audio_completed_at: row.audioCompletedAt || null,
    updated_at: new Date().toISOString(),
  };
  return sbFetch("route_progress?on_conflict=user_id,block_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(db),
  });
}
async function upsertAttendanceRow(row) {
  const db = {
    id: `${row.userId}_${row.blockId}`,
    user_id: row.userId,
    block_id: row.blockId,
    attended: !!row.attended,
    updated_at: new Date().toISOString(),
  };
  return sbFetch("session_attendance?on_conflict=user_id,block_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(db),
  });
}
async function persistMergedAccountData(data, source, target, next) {
  const targetProgress = (next.progress || []).filter((p) => p.userId === target.id);
  const targetAttendance = (next.attendance || []).filter((a) => a.userId === target.id);
  const changedSessions = (next.roleplaySessions || []).filter((s) => {
    const before = (data.roleplaySessions || []).find((x) => x.id === s.id);
    return before && JSON.stringify(before) !== JSON.stringify(s);
  });
  await Promise.all([
    ...targetProgress.map(upsertProgressRow),
    ...targetAttendance.map(upsertAttendanceRow),
    ...changedSessions.map(saveRoleplaySession),
    sbFetch(`question_box?user_id=eq.${encodeURIComponent(source.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: target.id, user_name: target.name, updated_at: new Date().toISOString() }),
    }),
    sbFetch(`roleplay_events?user_id=eq.${encodeURIComponent(source.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: target.id, user_name: target.name }),
    }),
  ]);
  await Promise.all([
    sbFetch(`route_progress?user_id=eq.${encodeURIComponent(source.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
    sbFetch(`session_attendance?user_id=eq.${encodeURIComponent(source.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  ]);
  await saveData({ ...data, users: next.users }, data);
}
const emptyData = () => ({
  pin: null,
  aliases: {},
  exercises: [],
  excluded: [],
  route: emptyRoute(),
  users: [],
  progress: [],
  attendance: [],
  questions: [],
  roleplay: emptyRoleplay(),
  roleplaySessions: [],
  roleplayEvents: [],
});
const emptyRoute = () => ({ title: "Ruta de PreparaciÃ³n", blocks: [] });
/* Un bloque de la ruta formativa:
   { id, title, subtitle, pptUrl, resources: [ { id, type: 'game'|'video', label, url, slide } ] }
   slide = nÃºmero de lÃ¡mina donde aparece el recurso (opcional, informativo) */
const emptyBlock = () => ({ id: uid(), title: "", subtitle: "", pptUrl: "", resources: [], locked: false });

const emptyRoleResources = () => ({ resources: [] });
function emptyRoleplay() {
  return {
    participantTypes: DEFAULT_ASCOS_TYPES.map((t) => ({ ...t })),
    asesor: emptyRoleResources(),
    apoyo_interno: { resources: DEFAULT_APOYO_INTERNO_RESOURCES.map((r) => ({ ...r })) },
    apoyo_externo: { resources: DEFAULT_APOYO_EXTERNO_RESOURCES.map((r) => ({ ...r })) },
    coordinador: emptyRoleResources(),
  };
}
function normalizeRoleplay(raw) {
  const base = emptyRoleplay();
  const cfg = raw && typeof raw === "object" ? raw : {};
  const next = { ...base, ...cfg };
  next.participantTypes = safeJsonArray(cfg.participantTypes).length
    ? safeJsonArray(cfg.participantTypes).map((t) => ({
      id: t.id || uid(),
      name: String(t.name || "").trim(),
      guide: String(t.guide || "").trim(),
    })).filter((t) => t.name)
    : base.participantTypes;
  for (const role of ROLEPLAY_ROLES) {
    const roleCfg = cfg[role.key] && typeof cfg[role.key] === "object" ? cfg[role.key] : {};
    const rawResources = safeJsonArray(roleCfg.resources);
    const defaultResources = base[role.key]?.resources || [];
    const missingDefaults = defaultResources.filter((d) =>
      !rawResources.some((r) => r.id === d.id || (r.url && d.url && r.url === d.url))
    );
    const resourcesSource = [...missingDefaults, ...rawResources];
    next[role.key] = {
      ...base[role.key],
      ...roleCfg,
      resources: resourcesSource.map((r) => ({
        id: r.id || uid(),
        type: r.type || (role.key === "coordinador" ? "file" : "wordwall"),
        label: String(r.label || "").trim(),
        url: String(r.url || "").trim(),
        note: String(r.note || "").trim(),
        time: String(r.time || "").trim(),
        materials: String(r.materials || "").trim(),
        html: String(r.html || "").trim(),
      })).filter((r) => r.label || r.url),
    };
  }
  return next;
}

/* ====== Usuarios (perfil de participante) ======
   { id, name, email, passHash, birthdate, retreatDate, expectations, linkedCanon }
   Nota: passHash NO es seguridad real, solo ofusca la clave. El almacenamiento
   del artifact no es privado; esto se comunica al usuario en la interfaz. */
function lightHash(str) {
  // hash simple determinÃ­stico (djb2) â€” evita guardar la clave en texto plano
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
  if (!iso) return "â€”";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });
}

/* ====== NormalizaciÃ³n de URLs para embeber ====== */
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
function directAudioUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  let m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) m = u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m && /drive\.google\.com/.test(u)) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return u;
}
function drivePreviewUrl(url) {
  const u = String(url || "").trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) m = u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m && /drive\.google\.com/.test(u)) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return u;
}
function iframeSrc(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/src=["']([^"']+)["']/i);
  return m ? m[1] : raw;
}
function wordwallEmbedUrl(value) {
  const raw = iframeSrc(value);
  if (!raw || !/wordwall\.net/i.test(raw)) return "";
  if (/\/embed\//i.test(raw)) return raw;
  return raw;
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

  // rÃ¡faga de ruido (para aplausos / redoble)
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

  // ovaciÃ³n: muchos claps solapados que suben y bajan de intensidad
  const applause = (start, dur = 2.6) => {
    const c = ctx;
    // colchÃ³n de "multitud" (ruido rosa suave de fondo)
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

  // Redoble de tambor con tensiÃ³n creciente (tipo Kahoot)
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

  // CelebraciÃ³n del campeÃ³n: fanfarria de trompeta + campanas + OVACIÃ“N con aplausos
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
    // OVACIÃ“N: aplausos sostenidos que arrancan junto con la fanfarria
    applause(t + 0.15, 3.0);
  };

  // Clic corto de reveal (2Âº y 3Âº puesto): "swoosh" ascendente
  const pop = () => {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    tone(392, t, 0.18, "triangle", 0.16, 784);
    noise(t, 0.14, { gain: 0.06, freq: 3000, q: 0.5, curve: 2 });
    // pequeÃ±o aplauso breve
    applause(t + 0.05, 0.7);
  };

  // Sonido corto y positivo al "Mostrar todo" (acorde rÃ¡pido)
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
  const title = cell(0, 0) || "Ejercicio sin tÃ­tulo";
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
      if (q && (mark === "âœ”" || mark === "âœ–")) {
        let qi = questions.findIndex((x) => norm(x) === norm(q));
        if (qi === -1) {
          questions.push(q);
          qi = questions.length - 1;
        }
        answers[qi] = mark === "âœ”" ? 1 : 0;
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
  const first = new Map();
  const best = new Map();
  const counts = new Map();
  for (const s of students) {
    const k = norm(s.raw);
    if (!first.has(k)) first.set(k, s);
    counts.set(k, (counts.get(k) || 0) + 1);
    const prev = best.get(k);
    if (isBetterAttempt(s, prev)) best.set(k, s);
  }
  return {
    title,
    questions,
    students: [...best.entries()].map(([k, s]) => ({
      ...s,
      firstAttempt: attemptSnapshot(first.get(k)),
      bestAttempt: attemptSnapshot(s),
      attemptCount: counts.get(k) || 1,
    })),
  };
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

/* ============ FusiÃ³n de participantes (re-subida) ============
   Combina la lista existente con la nueva: actualiza a quien ya estaba
   (conservando el mejor intento) y agrega a los nuevos.                    */
async function importWordwallResultsFromUrl(url) {
  const cleanUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(cleanUrl)) throw new Error("Pega un link valido de Wordwall.");
  let res;
  try {
    res = await fetch(cleanUrl, { credentials: "omit" });
  } catch {
    throw new Error("Wordwall bloqueo la lectura directa de ese link. Abre el link de resultados y usa Excel o pega el detallado.");
  }
  if (!res.ok) throw new Error("No se pudo leer el link de resultados.");
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const buf = await res.arrayBuffer();
  if (/\.(xlsx|xls)(\?|#|$)/i.test(cleanUrl) || contentType.includes("spreadsheet") || contentType.includes("excel")) {
    const parsed = parseWorkbook(buf);
    if (parsed.students.length) return parsed;
  }
  const text = new TextDecoder("utf-8").decode(buf);
  const entries = parseDetalle(text);
  if (entries.length) {
    return {
      title: "Resultados importados desde Wordwall",
      questions: [],
      fromUrl: true,
      students: entries.map((e, idx) => ({
        raw: e.name,
        order: idx,
        correct: e.correct,
        total: e.correct + e.incorrect,
        answers: {},
        score: e.score,
        submitted: e.submitted,
      })),
    };
  }
  try {
    const parsed = parseWorkbook(buf);
    if (parsed.students.length) return parsed;
  } catch {}
  throw new Error("Ese link abre la vista de resultados, pero no entrega datos importables a la app. Exporta el Excel o pega el detallado de Wordwall.");
}

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
      const firstAttempt = earliestAttemptSnapshot(prev.firstAttempt || attemptSnapshot(prev), s.firstAttempt || attemptSnapshot(s));
      const attemptCount = Math.max(prev.attemptCount || 1, s.attemptCount || 1);
      const better = isBetterAttempt(s, prev);
      if (better) {
        map.set(k, {
          ...prev,
          ...s,
          firstAttempt,
          bestAttempt: s.bestAttempt || attemptSnapshot(s),
          attemptCount,
        });
        updated++;
      } else {
        map.set(k, {
          ...prev,
          firstAttempt,
          bestAttempt: prev.bestAttempt || attemptSnapshot(prev),
          attemptCount,
        });
      }
    }
  }
  return { students: [...map.values()], added, updated };
}
function mergeQuestions(existing, incoming) {
  // preserva las preguntas ya conocidas; si el nuevo trae mÃ¡s, las suma
  if (!incoming || !incoming.length) return existing || [];
  if (!existing || !existing.length) return incoming;
  return incoming.length >= existing.length ? incoming : existing;
}

async function syncExerciseFromResultsUrl(exercise) {
  const resultsUrl = String(exercise?.resultsUrl || "").trim();
  if (!resultsUrl) throw new Error("No tiene link de resultados.");
  const imported = await importWordwallResultsFromUrl(resultsUrl);
  const incoming = (imported.students || []).map((s) => ({ ...s }));
  if (!incoming.length) throw new Error("No se encontraron participantes en ese link.");
  const merged = mergeStudents(exercise.students || [], incoming);
  return {
    exercise: {
      ...exercise,
      students: merged.students,
      questions: mergeQuestions(exercise.questions, imported.questions),
      date: new Date().toISOString(),
      resultsUrl,
    },
    added: merged.added,
    updated: merged.updated,
  };
}

/* ============ Ranking y puntos de campeonato ============ */
function attemptSnapshot(s) {
  if (!s) return null;
  return {
    correct: s.correct ?? 0,
    total: s.total ?? 0,
    score: s.score ?? null,
    submitted: s.submitted || null,
    order: s.order ?? 0,
    answers: s.answers || {},
  };
}
function podiumAttempt(s) {
  const a = s?.firstAttempt;
  return a ? { ...s, ...a } : s;
}
function learningAttempt(s) {
  const a = s?.bestAttempt;
  return a ? { ...s, ...a } : s;
}
function isEarlierAttempt(b, a) {
  if (!a) return true;
  if (!b) return false;
  const tb = attemptTime(b), ta = attemptTime(a);
  if (tb && ta && tb !== ta) return tb < ta;
  return (b.order ?? 0) < (a.order ?? 0);
}
function earliestAttemptSnapshot(a, b) {
  return attemptSnapshot(isEarlierAttempt(b, a) ? b : a);
}
/* Decide si el intento 'b' es mejor que 'a' para conservar al fusionar/deduplicar.
   Prioriza: mÃ¡s aciertos > desempate Wordwall > intento mÃ¡s reciente. */
function isBetterAttempt(b, a) {
  if (!a) return true;
  if ((b.correct ?? 0) !== (a.correct ?? 0)) return (b.correct ?? 0) > (a.correct ?? 0);
  const sb = b.score ?? -1, sa = a.score ?? -1;
  if (sb !== sa) return sb > sa;
  // desempate final: el mÃ¡s reciente (mayor 'submitted' o mayor 'order')
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
function exerciseQuestionTotal(ex) {
  const fromQuestions = (ex?.questions || []).length;
  if (fromQuestions) return fromQuestions;
  return Math.max(0, ...(ex?.students || []).map((s) => toInt((podiumAttempt(s) || s).total, 0)));
}
function rankExercise(ex, aliases, excluded) {
  const byCanon = new Map();
  for (const s of ex.students) {
    const canon = canonicalOf(s.raw, aliases);
    if (isExcluded(canon, excluded)) continue; // fuera del podio/ranking
    const prev = byCanon.get(canon);
    // puntos campeonato: conservar el primer intento; Wordwall solo desempata si hay mismos aciertos
    const rankedAttempt = { ...podiumAttempt(s), canon, bestAttempt: s.bestAttempt, firstAttempt: s.firstAttempt, attemptCount: s.attemptCount };
    if (!prev || isEarlierAttempt(rankedAttempt, prev)) byCanon.set(canon, rankedAttempt);
  }
  const arr = [...byCanon.values()];
  // Regla de orden: SIEMPRE gana quien tiene mÃ¡s aciertos.
  // Wordwall solo se usa como desempate oculto entre quienes tienen los mismos aciertos.
  arr.sort((a, b) => {
    if (b.correct !== a.correct) return b.correct - a.correct;
    if ((b.score ?? -1) !== (a.score ?? -1)) return (b.score ?? -1) - (a.score ?? -1);
    return a.order - b.order;
  });
  return arr.map((s, idx) => ({
    ...s,
    rank: idx + 1,
    points: s.correct || 0,
  }));
}
function buildConsolidated(exercises, aliases, excluded) {
  const map = new Map();
  const totalGames = exercises.length;
  const totalPossible = exercises.reduce((sum, ex) => sum + exerciseQuestionTotal(ex), 0);
  for (const ex of exercises) {
    for (const s of rankExercise(ex, aliases, excluded)) {
      const e =
        map.get(s.canon) || { canon: s.canon, points: 0, score: 0, correct: 0, total: totalPossible, totalGames, missingGames: totalGames, played: 0, detail: [] };
      e.points += s.points;
      e.score += s.score || 0;
      e.correct += s.correct;
      e.played += 1;
      e.missingGames = Math.max(0, totalGames - e.played);
      e.detail.push({ exId: ex.id, title: ex.title, rank: s.rank, points: s.points, correct: s.correct, total: exerciseQuestionTotal(ex) || s.total, score: s.score });
      map.set(s.canon, e);
    }
  }
  const arr = [...map.values()];
  arr.sort((a, b) => b.correct - a.correct || a.missingGames - b.missingGames || (b.score || 0) - (a.score || 0) || a.canon.localeCompare(b.canon, "es"));
  return arr.map((s, i) => ({ ...s, rank: i + 1 }));
}
function emptyConsolidatedStats(canon, exercises) {
  return {
    canon,
    rank: null,
    points: 0,
    score: 0,
    correct: 0,
    total: exercises.reduce((sum, ex) => sum + exerciseQuestionTotal(ex), 0),
    totalGames: exercises.length,
    missingGames: exercises.length,
    played: 0,
    detail: [],
  };
}
function activeRouteBlocks(route) {
  return (route?.blocks || []).filter((b) => !b.locked);
}
function completedBlockSet(progress, userId) {
  return new Set((progress || []).filter((p) => p.userId === userId && p.completed).map((p) => p.blockId));
}
function blockCompleted(progress, userId, blockId) {
  return completedBlockSet(progress, userId).has(blockId);
}
function progressForBlock(progress, userId, blockId) {
  return (progress || []).find((p) => p.userId === userId && p.blockId === blockId) || null;
}
function splitNames(textOrList) {
  if (Array.isArray(textOrList)) return textOrList.map((s) => String(s || "").trim()).filter(Boolean);
  return String(textOrList || "").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
}
function attendedBlock(data, block, user) {
  const row = (data?.attendance || []).find((a) => a.userId === user?.id && a.blockId === block?.id);
  if (row) return !!row.attended;
  const names = splitNames(block?.attendance || block?.attendanceText);
  if (!user || !names.length) return false;
  const options = [user.name, user.linkedCanon].filter(Boolean).map(norm);
  return names.some((name) => options.includes(norm(name)));
}
function findUserStudent(ex, data, user) {
  if (!ex || !user) return null;
  const targets = [user.linkedCanon, user.name].filter(Boolean).map(norm);
  return (ex.students || []).find((s) => targets.includes(norm(canonicalOf(s.raw, data.aliases || {})))) || null;
}
function gameRequirementStatus(resource, data, user) {
  const passing = toInt(resource.passingPct, PASSING_PCT);
  if (!resource.exerciseId) return { linked: false, required: true, passed: false, percent: null, passing, played: false, title: resource.label || "Juego sin vincular", state: "unlinked" };
  const ex = (data.exercises || []).find((e) => e.id === resource.exerciseId);
  if (!ex) return { linked: false, required: true, passed: false, percent: null, passing, played: false, title: resource.label || "Juego sin resultado", state: "missingExercise" };
  const st = findUserStudent(ex, data, user);
  if (!st) return { linked: true, required: true, passed: false, percent: null, passing, played: false, title: ex?.title || resource.label || "Juego" };
  const best = learningAttempt(st);
  const percent = pct(best.correct, best.total);
  return { linked: true, required: true, passed: percent >= passing, percent, passing, played: true, title: ex?.title || resource.label || "Juego" };
}
function blockLearningStatus(data, user, block) {
  const row = progressForBlock(data.progress || [], user?.id, block?.id);
  const attended = attendedBlock(data, block, user);
  const hasAudio = !!block?.audioUrl;
  const audioOk = !hasAudio || attended || !!row?.audioCompleted || (row?.audioPercent || 0) >= AUDIO_COMPLETE_PCT;
  const games = (block?.resources || []).filter((r) => r.type === "game").map((r) => gameRequirementStatus(r, data, user));
  const requiredGames = games.filter((g) => g.required);
  const gamesOk = requiredGames.every((g) => g.passed);
  const requirementsMet = audioOk && gamesOk;
  const attendanceCompletesBlock = attended && !hasAudio && requiredGames.length === 0;
  const completed = (!!row?.completed || attendanceCompletesBlock) && requirementsMet;
  const missing = [];
  if (!audioOk) missing.push("audio");
  if (!gamesOk) missing.push("juegos vinculados y aprobados >=80%");
  return { row, attended, hasAudio, audioOk, games, requiredGames, gamesOk, requirementsMet, attendanceCompletesBlock, completed, missing };
}
function routeProgressStats(data, user) {
  const blocks = activeRouteBlocks(data?.route || emptyRoute());
  const completed = blocks.filter((b) => blockLearningStatus(data, user, b).completed).length;
  return { completed, total: blocks.length, percent: pct(completed, blocks.length) };
}
function unlockedRouteBlocks(data, user) {
  const blocks = data?.route?.blocks || [];
  let priorComplete = true;
  return blocks.map((b) => {
    const adminLocked = !!b.locked;
    const unlocked = priorComplete && !adminLocked;
    const status = blockLearningStatus(data, user, b);
    if (!adminLocked) priorComplete = priorComplete && status.completed;
    return { block: b, unlocked, adminLocked, status };
  });
}
function profileComplete(user) {
  return !!(user?.name && isValidEmail(user?.email) && user?.birthdate && hasMeaningfulAnswer(user?.retreatDate) && user?.expectations);
}
function dashboardRows(data) {
  const users = data.users || [];
  const route = data.route || emptyRoute();
  const consolidated = buildConsolidated(data.exercises || [], data.aliases || {}, data.excluded || []);
  return users.map((u) => {
    const stats = u.linkedCanon ? (consolidated.find((s) => norm(s.canon) === norm(u.linkedCanon)) || emptyConsolidatedStats(u.linkedCanon, data.exercises || [])) : null;
    const routeStats = routeProgressStats(data, u);
    const complete = profileComplete(u);
    const issues = [];
    if (!complete) issues.push("Perfil incompleto");
    if (!u.linkedCanon) issues.push("Sin vÃ­nculo al podio");
    if (routeStats.total > 0 && routeStats.completed === 0) issues.push("Sin avance en ruta");
    else if (routeStats.total > 0 && routeStats.percent < 50) issues.push("Avance bajo");
    if (u.linkedCanon && (!stats || stats.played === 0)) issues.push("Sin resultados");
    return {
      user: u,
      profileComplete: complete,
      route: routeStats,
      stats,
      issues,
      status: issues.length ? issues.join(" Â· ") : "Al dÃ­a",
    };
  });
}
function routeBlockStats(data) {
  const users = data.users || [];
  return activeRouteBlocks(data.route || emptyRoute()).map((b, idx) => {
    const completed = users.filter((u) => blockLearningStatus(data, u, b).completed).length;
    return {
      id: b.id,
      title: b.title || `Bloque ${idx + 1}`,
      completed,
      total: users.length,
      percent: pct(completed, users.length),
    };
  });
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
function formatChampionshipPoints(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
function displayOf(s, consolidated) {
  if (consolidated) {
    const parts = [];
    if (s.totalGames != null) parts.push(`${s.played}/${s.totalGames} juegos`);
    if (s.missingGames > 0) parts.push(`faltan ${s.missingGames}`);
    parts.push(`${s.correct}/${s.total} aciertos`);
    return { main: formatChampionshipPoints(s.points), unit: "pts campeonato", sub: parts.join(" Â· ") };
  }
  const parts = [];
  parts.push(`${s.correct}/${s.total} aciertos`);
  return { main: formatChampionshipPoints(s.points), unit: "pts campeonato", sub: parts.join(" Â· ") };
}

function roleLabel(key) {
  return ROLEPLAY_ROLES.find((r) => r.key === key)?.label || key;
}
function makeJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function nextAscosType(participants = [], participantTypes = []) {
  const options = participantTypes.length ? participantTypes : DEFAULT_ASCOS_TYPES;
  const used = new Map();
  participants.forEach((p) => {
    if (!p.isFacilitator && p.assignedRoleId) used.set(p.assignedRoleId, (used.get(p.assignedRoleId) || 0) + 1);
  });
  return [...options].sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0))[0] || options[0];
}
function sessionHasUser(session, user) {
  return (session?.participants || []).some((p) => p.userId === user?.id);
}
function roleplayStats(data) {
  const sessions = data.roleplaySessions || [];
  const events = data.roleplayEvents || [];
  const sessionParticipants = sessions.flatMap((s) => s.participants || []);
  const userKey = (p) => p.userId || norm(p.userName);
  const eventKey = (e) => e.userId || norm(e.userName);
  const roleUse = {};
  for (const role of ROLEPLAY_ROLES) roleUse[role.key] = { opens: 0, users: new Set(), sessions: 0, participants: 0 };
  sessions.forEach((s) => {
    const key = s.roleType || "asesor";
    if (!roleUse[key]) roleUse[key] = { opens: 0, users: new Set(), sessions: 0, participants: 0 };
    roleUse[key].sessions += 1;
    roleUse[key].participants += (s.participants || []).length;
  });
  events.forEach((e) => {
    const key = e.roleType || "sin_rol";
    if (!roleUse[key]) roleUse[key] = { opens: 0, users: new Set(), sessions: 0, participants: 0 };
    roleUse[key].opens += 1;
    if (eventKey(e)) roleUse[key].users.add(eventKey(e));
  });
  return {
    sessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status !== "closed").length,
    sessionParticipants: sessionParticipants.length,
    uniqueSessionUsers: new Set(sessionParticipants.map(userKey).filter(Boolean)).size,
    resourceOpens: events.length,
    uniqueEventUsers: new Set(events.map(eventKey).filter(Boolean)).size,
    totalUniqueUsers: new Set([...sessionParticipants.map(userKey), ...events.map(eventKey)].filter(Boolean)).size,
    roleUse,
  };
}
function upsertLocalRoleplaySession(data, saved) {
  const rest = (data.roleplaySessions || []).filter((s) => s.id !== saved.id);
  return { ...data, roleplaySessions: [saved, ...rest] };
}
function upsertLocalRoleplayEvent(data, saved) {
  return { ...data, roleplayEvents: [saved, ...((data.roleplayEvents || []).filter((e) => e.id !== saved.id))] };
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
  1: { cls: "pc-gold", h: 218, medal: "ðŸ¥‡", tag: "CAMPEÃ“N" },
  2: { cls: "pc-silver", h: 158, medal: "ðŸ¥ˆ", tag: "SUBCAMPEÃ“N" },
  3: { cls: "pc-bronze", h: 116, medal: "ðŸ¥‰", tag: "3ER PUESTO" },
};
function PodiumColumn({ student, rank, shown, consolidated }) {
  const meta = PODIUM_META[rank];
  const d = displayOf(student, consolidated);
  return (
    <div className="podium-slot">
      <div className={`podium-head ${shown ? "is-shown" : ""}`}>
        {shown ? (
          <div className={`player-card ${meta.cls}`}>
            {rank === 1 && <span className="pc-crown">ðŸ‘‘</span>}
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
    return <div className="empty">AÃºn no hay resultados para mostrar aquÃ­.</div>;

  const labels = ["Revelar el podio", "Revelar 2Âº lugar", "Revelar 1Âº lugar", "Mostrar menciones honorÃ­ficas"];

  return (
    <div style={{ position: "relative" }}>
      <Confetti burst={step >= 3 ? ranked[0]?.canon : null} />
      <div className="stage-topbar">
        <div className="stage-subtitle">{subtitle}</div>
        <button className="mute-btn" onClick={toggleMute} title={muted ? "Activar sonido" : "Silenciar"} aria-label={muted ? "Activar sonido" : "Silenciar"}>
          {muted ? "ðŸ”‡" : "ðŸ”Š"}
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
          <button className="btn btn--ghost" onClick={() => { setStep(0); Sound.chord(); }}>â†º Repetir revelaciÃ³n</button>
        )}
      </div>
      <div className="hint">
        Avanza con <kbd>Espacio</kbd> o <kbd>â†’</kbd>
      </div>

      {step >= maxStep && mentions.length > 0 && (
        <div className="mentions">
          <div className="mentions-title">
            <span className="rule" />
            MENCIONES HONORÃFICAS
            <span className="rule" />
          </div>
          <div className="mentions-row">
            {mentions.map((s) => {
              const d = displayOf(s, consolidated);
              return (
                <div key={s.canon} className="mention-card">
                  <div className="mention-rank">{s.rank}Âº</div>
                  <div className="avatar avatar--sm">{initials(s.canon)}</div>
                  <div>
                    <div className="mention-name">{s.canon}</div>
                    <div className="mention-score">
                      <b>{d.main} {d.unit}</b>
                      {d.sub && <span className="dim"> Â· {d.sub}</span>}
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

/* ================= ExplicaciÃ³n de puntos ================= */
function ScoringInfo({ compact }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`scoring ${compact ? "scoring--compact" : ""}`}>
      <button className="scoring-toggle" onClick={() => setOpen(!open)}>
        <span>âš½ Â¿CÃ³mo se ordena el podio?</span>
        <span className={`chev ${open ? "chev--up" : ""}`}>â–¾</span>
      </button>
      {open && (
        <div className="scoring-body">
          <p>
            Los <b>puntos campeonato</b> son los aciertos del <b>primer intento</b>. Todos los juegos
            de la plataforma cuentan para el consolidado; si falta un juego, suma 0 aciertos en ese juego.
          </p>
          <div className="scoring-grid">
            {[
              ["âœ”", "1 acierto", "1 punto"],
              ["ðŸŽ®", "Juego pendiente", "0 puntos"],
              ["ðŸ“Š", "% aciertos", "sobre todo"],
              ["ðŸ†", "Consolidado", "total"],
            ].map(([ic, l, p]) => (
              <div key={l} className="scoring-item">
                <span className="scoring-ic">{ic}</span>
                <span className="scoring-l">{l}</span>
                <span className="scoring-p">{p}</span>
              </div>
            ))}
          </div>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
            El porcentaje se calcula sobre el total de preguntas de todos los juegos obligatorios,
            no solo sobre los juegos que la persona ya jugÃ³.
          </p>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
            Si dos personas tienen los mismos aciertos, Wordwall puede desempatar el orden interno,
            pero no aparece como puntos campeonato.
          </p>
        </div>
      )}
    </div>
  );
}

/* ================= Tablas y estadÃ­sticas ================= */
function RankBadge({ rank }) {
  if (rank <= 3) return <span className={`rank-badge rb-${rank}`}>{["ðŸ¥‡", "ðŸ¥ˆ", "ðŸ¥‰"][rank - 1]}</span>;
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
                <th>Faltan</th>
                <th>Aciertos</th>
              </>
            ) : (
              <>
                <th className="th-hl">Pts campeonato</th>
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
                  <td className="td-champ"><span className="champ-pill">{formatChampionshipPoints(s.points)}</span></td>
                  <td className="t-num">{s.played}/{s.totalGames || s.played}</td>
                  <td className={s.missingGames ? "t-red t-num" : "t-teal t-num"}>{s.missingGames || 0}</td>
                  <td className="t-num">{s.correct}/{s.total} <span className="dim">({pct(s.correct, s.total)}%)</span></td>
                </>
              ) : (
                <>
                  <td className="td-champ"><span className="champ-pill">{formatChampionshipPoints(s.points)}</span></td>
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
          ? "El puesto se decide por aciertos acumulados del primer intento. Los juegos pendientes cuentan como 0. Toca un nombre para ver su detalle."
          : "El puesto se decide por aciertos del primer intento. Toca un nombre para ver su detalle."}
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
    return <div className="empty">Este ejercicio no tiene detalle por pregunta (se cargÃ³ solo desde el detallado pegado, sin el Excel).</div>;
  return (
    <div className="qgrid">
      {stats.map((s, i) => {
        const p = pct(s.ok, s.total);
        const hard = p < 60;
        return (
          <div key={i} className={`card qcard ${hard ? "qcard--hard" : ""}`}>
            <div className="qrow">
              <div className="qtext">{s.q}</div>
              <div className={`qscore ${hard ? "t-red" : "t-teal"}`}>{s.ok}/{s.total} Â· {p}%</div>
            </div>
            <div className="qbar"><i className={hard ? "bg-red" : "bg-teal"} style={{ width: `${p}%` }} /></div>
            {hard && <div className="qflag">âš  Reforzar en la prÃ³xima sesiÃ³n</div>}
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
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar âœ•</button>
        </div>
        {detail.cons && (
          <div className="consline">
            <span className="t-gold">{formatChampionshipPoints(detail.cons.points)} pts de campeonato</span> Â· puesto {detail.cons.rank} Â· {detail.cons.correct}/{detail.cons.total} aciertos
            {detail.cons.missingGames ? <span className="dim"> Â· faltan {detail.cons.missingGames} juego{detail.cons.missingGames === 1 ? "" : "s"}</span> : ""}
          </div>
        )}
        {detail.perEx.map(({ ex, st }) => (
          <div key={ex.id} className="modal-ex">
            <div className="modal-ex-head">
              {ex.title}
              <span className="dim">
                {" "}â€” {st.correct}/{st.total} Â· puesto {st.rank} Â· {formatChampionshipPoints(st.points)} pts campeonato
              </span>
            </div>
            <div className="modal-qs">
              {(ex.questions || []).map((q, qi) =>
                !st.answers || st.answers[qi] == null ? null : (
                  <div key={qi} className={st.answers[qi] ? "q-ok" : "q-bad"}>
                    {st.answers[qi] ? "âœ”" : "âœ–"} {q}
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
/* ================= Admin: gestiÃ³n de usuarios ================= */
function UsersAdmin({ data, persist, busy }) {
  const users = data.users || [];
  const [confirmDel, setConfirmDel] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [resetOpen, setResetOpen] = useState(null);
  const [resetPass, setResetPass] = useState("");
  const [resetMsg, setResetMsg] = useState(null);
  const [mergeTargetBySource, setMergeTargetBySource] = useState({});
  const [mergeConfirm, setMergeConfirm] = useState(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [userMsg, setUserMsg] = useState(null);

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
    setUserMsg(null);
    try {
      await persist({ ...data, users: users.filter((u) => u.id !== userId) });
      setConfirmDel(null);
      setUserMsg({ ok: true, t: "Perfil eliminado. Ese nombre y correo ya pueden volver a registrarse." });
    } catch {
      setUserMsg({ ok: false, t: "No se pudo eliminar el perfil. Ejecuta el SQL de la versiÃ³n 16 en Supabase y vuelve a intentar." });
    }
  };
  const resetPassword = async (userId) => {
    setResetMsg(null);
    if (resetPass.length < 4) { setResetMsg({ ok: false, userId, t: "La nueva clave debe tener al menos 4 caracteres." }); return; }
    const next = { ...data, users: users.map((u) => (u.id === userId ? { ...u, passHash: lightHash(resetPass) } : u)) };
    try {
      await persist(next);
      setResetMsg({ ok: true, userId, t: "Clave actualizada. Comparte la clave temporal con el participante." });
      setResetPass("");
      setResetOpen(null);
    } catch {
      setResetMsg({ ok: false, userId, t: "No se pudo actualizar la clave." });
    }
  };

  // sugerencia automÃ¡tica: si el nombre del usuario coincide con un canÃ³nico
  const autoMatch = (u) => {
    if (u.linkedCanon) return null;
    return canonicals.find((c) => norm(c) === norm(u.name)) || null;
  };
  const doMerge = async (sourceId) => {
    const targetId = mergeTargetBySource[sourceId] || "";
    const source = users.find((u) => u.id === sourceId);
    const target = users.find((u) => u.id === targetId);
    const next = buildMergedAccountData(data, sourceId, targetId);
    if (!source || !target || !next) {
      setUserMsg({ ok: false, t: "Elige una cuenta principal vÃ¡lida para unificar." });
      return;
    }
    setMergeBusy(true);
    setUserMsg(null);
    try {
      await persistMergedAccountData(data, source, target, next);
      await persist(next);
      setMergeConfirm(null);
      setMergeTargetBySource((prev) => ({ ...prev, [sourceId]: "" }));
      setExpanded(target.id);
      setUserMsg({ ok: true, t: `Cuenta unificada. "${source.name}" se moviÃ³ a "${target.name}" y la duplicada fue eliminada.` });
    } catch (e) {
      console.error("merge accounts:", e);
      setUserMsg({ ok: false, t: "No se pudo unificar. Ejecuta el SQL de la versiÃ³n 16 en Supabase y vuelve a intentar." });
    } finally {
      setMergeBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="dim" style={{ fontSize: 13 }}>
        Perfiles que los participantes crearon. Puedes <b>vincular</b> cada uno con su nombre en los resultados
        del podio para que vea sus puntos. Si el nombre coincide, se sugiere automÃ¡ticamente.
      </div>
      {userMsg && <div className={userMsg.ok ? "ok-inline" : "auth-err"}>{userMsg.t}</div>}
      {users.length === 0 && <div className="empty">AÃºn no hay usuarios registrados.</div>}
      {users.map((u) => {
        const suggestion = autoMatch(u);
        const isOpen = expanded === u.id;
        const mergeTargetId = mergeTargetBySource[u.id] || "";
        const mergeTarget = users.find((x) => x.id === mergeTargetId);
        return (
          <div key={u.id} className="card user-card">
            <div className="user-card-head">
              <div className="user-card-info" onClick={() => setExpanded(isOpen ? null : u.id)}>
                <span className="avatar avatar--xs">{initials(u.name)}</span>
                <div>
                  <div className="user-card-name">{u.name}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {u.linkedCanon
                      ? <>ðŸ”— Vinculado a <b>{u.linkedCanon}</b></>
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
                  <div className="ufield"><span className="uf-l">Correo</span><span className="uf-v">{u.email || "Pendiente"}</span></div>
                  <div className="ufield"><span className="uf-l">ðŸŽ‚ Nacimiento</span><span className="uf-v">{fmtDate(u.birthdate)}{ageFromBirth(u.birthdate) != null ? ` Â· ${ageFromBirth(u.birthdate)} aÃ±os` : ""}</span></div>
                  <div className="ufield"><span className="uf-l">â›ª ViviÃ³ su EJE</span><span className="uf-v">{u.retreatDate || "â€”"}</span></div>
                </div>
                {u.expectations && (
                  <div className="user-expect"><span className="uf-l">ðŸ’­ Expectativas</span><div className="pf-quote">"{u.expectations}"</div></div>
                )}

                <label className="lbl" style={{ marginTop: 12 }}>Vincular con nombre del podio</label>
                <div className="link-row">
                  <select className="inp inp--select" value={u.linkedCanon || ""} onChange={(e) => setLink(u.id, e.target.value)} disabled={busy}>
                    <option value="">â€” Sin vincular â€”</option>
                    {canonicals.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {suggestion && (
                    <button className="btn btn--teal-o btn--sm" onClick={() => setLink(u.id, suggestion)}>
                      Vincular con â€œ{suggestion}â€ (coincide)
                    </button>
                  )}
                </div>

                <div className="admin-merge-box">
                  <div>
                    <label className="lbl">Unificar cuenta duplicada</label>
                    <div className="auth-hint">Usa esto si esta cuenta fue creada por error. El avance, asistencia, preguntas y uso de roles pasarÃ¡n a la cuenta principal.</div>
                  </div>
                  <div className="admin-merge-actions">
                    <select
                      className="inp inp--select"
                      value={mergeTargetId}
                      disabled={busy || mergeBusy}
                      onChange={(e) => {
                        setMergeTargetBySource((prev) => ({ ...prev, [u.id]: e.target.value }));
                        setMergeConfirm(null);
                      }}
                    >
                      <option value="">Elegir cuenta principal</option>
                      {users.filter((x) => x.id !== u.id).map((x) => (
                        <option key={x.id} value={x.id}>{x.name}{x.email ? ` Â· ${x.email}` : ""}</option>
                      ))}
                    </select>
                    {mergeConfirm === u.id ? (
                      <>
                        <button className="btn btn--danger-o btn--sm" disabled={!mergeTarget || busy || mergeBusy} onClick={() => doMerge(u.id)}>
                          Confirmar unificaciÃ³n
                        </button>
                        <button className="btn btn--ghost btn--sm" disabled={mergeBusy} onClick={() => setMergeConfirm(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button className="btn btn--teal-o btn--sm" disabled={!mergeTarget || busy || mergeBusy} onClick={() => setMergeConfirm(u.id)}>
                        Unificar con cuenta principal
                      </button>
                    )}
                  </div>
                  {mergeConfirm === u.id && mergeTarget && (
                    <div className="auth-hint auth-hint--warn">
                      Se conservarÃ¡ <b>{mergeTarget.name}</b> como cuenta principal y se eliminarÃ¡ <b>{u.name}</b>.
                    </div>
                  )}
                </div>

                <div className="admin-reset-box">
                  <div>
                    <label className="lbl">Resetear clave</label>
                    <div className="auth-hint">Crea una clave temporal y compÃ¡rtela con el participante.</div>
                  </div>
                  {resetOpen === u.id ? (
                    <div className="admin-reset-actions">
                      <input className="inp inp--sm" type="password" value={resetPass} onChange={(e) => setResetPass(e.target.value)} placeholder="Nueva clave temporal" />
                      <button className="btn btn--teal-o btn--sm" disabled={busy} onClick={() => resetPassword(u.id)}>Guardar clave</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => { setResetOpen(null); setResetPass(""); }}>Cancelar</button>
                    </div>
                  ) : (
                    <button className="btn btn--ghost btn--sm" onClick={() => { setResetOpen(u.id); setResetMsg(null); }}>
                      Cambiar clave
                    </button>
                  )}
                  {resetMsg?.userId === u.id && <div className={resetMsg.ok ? "ok-inline" : "auth-err"}>{resetMsg.t}</div>}
                </div>

                {confirmDel === u.id ? (
                  <div className="del-confirm" style={{ marginTop: 12 }}>
                    <span>Â¿Eliminar el perfil de {u.name}?</span>
                    <div className="del-confirm-actions">
                      <button className="btn btn--danger-o btn--sm" onClick={() => delUser(u.id)}>SÃ­, eliminar</button>
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

/* ================= Admin: dashboard de aprendizaje ================= */
function AdminDashboard({ data }) {
  const [filters, setFilters] = useState({ block: "actual", attendance: "all", audio: "all", game: "all", unlock: "all", risk: "all" });
  const [alertToast, setAlertToast] = useState("");
  const rows = useMemo(() => dashboardRows(data), [data]);
  const blocks = useMemo(() => routeBlockStats(data), [data]);
  const activeBlocks = activeRouteBlocks(data.route || emptyRoute());
  const enrichedRows = useMemo(() => rows.map((r) => {
    const gates = unlockedRouteBlocks(data, r.user);
    const currentGate = gates.find((g) => !g.status.completed && !g.adminLocked) || gates[gates.length - 1];
    const selectedGate = filters.block === "actual"
      ? currentGate
      : gates.find((g) => g.block.id === filters.block) || currentGate;
    const status = selectedGate?.status || null;
    const games = status?.requiredGames || [];
    const gameState = !games.length ? "nogame" : games.every((g) => g.passed) ? "passed" : games.some((g) => g.played && !g.passed) ? "failed" : "pending";
    const audioState = !status?.hasAudio ? "noaudio" : status.attended ? "exempt" : status.audioOk ? "ok" : "pending";
    const attendanceState = status?.attended ? "present" : "absent";
    const unlockState = selectedGate?.unlocked ? "unlocked" : "locked";
    const riskState = r.issues.length || unlockState === "locked" || audioState === "pending" || gameState === "pending" || gameState === "failed" ? "risk" : "ok";
    return { ...r, gate: selectedGate, blockStatus: status, gameState, audioState, attendanceState, unlockState, riskState };
  }), [rows, data, filters.block]);
  const filteredRows = enrichedRows.filter((r) =>
    (filters.attendance === "all" || r.attendanceState === filters.attendance) &&
    (filters.audio === "all" || r.audioState === filters.audio) &&
    (filters.game === "all" || r.gameState === filters.game) &&
    (filters.unlock === "all" || r.unlockState === filters.unlock) &&
    (filters.risk === "all" || r.riskState === filters.risk)
  );
  const alerts = rows.filter((r) => r.issues.length);
  const registered = rows.length;
  const completeProfiles = rows.filter((r) => r.profileComplete).length;
  const linked = rows.filter((r) => r.user.linkedCanon).length;
  const withResults = rows.filter((r) => r.stats?.played > 0).length;
  const avgRoute = registered ? Math.round(rows.reduce((s, r) => s + r.route.percent, 0) / registered) : 0;
  const resultTotals = rows.reduce((acc, r) => {
    if (r.stats?.total) {
      acc.correct += r.stats.correct;
      acc.total += r.stats.total;
    }
    return acc;
  }, { correct: 0, total: 0 });
  const avgAccuracy = pct(resultTotals.correct, resultTotals.total);
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const attendanceLabels = { all: "Todas", present: "AsistiÃ³", absent: "No asistiÃ³" };
  const audioLabels = { all: "Todos", ok: "Escuchado", pending: "Pendiente", exempt: "Repaso", noaudio: "Sin audio" };
  const gameLabels = { all: "Todos", passed: "Aprobado", pending: "Pendiente", failed: "Bajo 80%", nogame: "Sin juego" };
  const unlockLabels = { all: "Todos", unlocked: "Disponible", locked: "Bloqueado" };
  const riskLabels = { all: "Todos", risk: "Requiere seguimiento", ok: "Al dÃ­a" };
  const labelFor = (map, key) => map[key] || key;
  const alertMessageFor = (r) => {
    const firstName = (r.user.name || "").split(/\s+/)[0] || "hola";
    const blockName = r.gate?.block?.title || "tu bloque actual";
    const needs = [];
    if (!r.profileComplete) needs.push("completar tu perfil");
    if (!r.user.linkedCanon) needs.push("avisar al equipo si tu nombre de juego no coincide con tu perfil");
    if (r.audioState === "pending") needs.push("escuchar el audio de acompaÃ±amiento");
    if (r.gameState === "pending") needs.push("realizar el juego requerido");
    if (r.gameState === "failed") needs.push("reforzar y aprobar el juego con mÃ­nimo 80%");
    if (r.unlockState === "locked") needs.push("cerrar el bloque anterior para desbloquear el siguiente");
    if (!needs.length) needs.push("revisar tu avance");
    return `Hola ${firstName}, te escribimos por tu preparaciÃ³n EJE. En el bloque "${blockName}" tienes pendiente: ${needs.join(", ")}. Entra a la plataforma para continuar tu ruta.`;
  };
  const copyText = async (text, okMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      setAlertToast(okMessage);
      setTimeout(() => setAlertToast(""), 2600);
    } catch {
      setAlertToast("No se pudo copiar automÃ¡ticamente. Selecciona el texto desde la exportaciÃ³n.");
    }
  };
  const copyFilteredAlerts = () => {
    const targets = filteredRows.filter((r) => r.riskState === "risk");
    if (!targets.length) {
      setAlertToast("No hay alertas en el filtro actual.");
      setTimeout(() => setAlertToast(""), 2600);
      return;
    }
    copyText(targets.map(alertMessageFor).join("\n\n---\n\n"), `${targets.length} alerta(s) copiadas.`);
  };

  const exportDashboard = () => {
    const exportRows = filteredRows.map((r) => ({
      Nombre: r.user.name,
      "Perfil completo": r.profileComplete ? "Si" : "No",
      "Vinculo podio": r.user.linkedCanon || "",
      "Bloques completados": `${r.route.completed}/${r.route.total}`,
      "Avance ruta %": r.route.percent,
      "Bloque filtro": r.gate?.block?.title || "",
      Asistencia: labelFor(attendanceLabels, r.attendanceState),
      Audio: labelFor(audioLabels, r.audioState),
      Juego: labelFor(gameLabels, r.gameState),
      Desbloqueo: labelFor(unlockLabels, r.unlockState),
      "Juegos con resultados": r.stats?.played || 0,
      "Juegos pendientes": r.stats?.missingGames ?? "",
      "Aciertos": r.stats ? `${r.stats.correct}/${r.stats.total}` : "",
      "Puntos campeonato": r.stats?.points || 0,
      Estado: r.status,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Dashboard");
    XLSX.writeFile(wb, `dashboard-eje-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="admin-dash">
      <div className="dash-hero card">
        <div>
          <div className="dash-eyebrow">Vista de acompaÃ±amiento</div>
          <div className="dash-title">Dashboard de aprendizaje</div>
          <div className="dim">Monitorea registro, avance de ruta, resultados y personas que necesitan seguimiento.</div>
        </div>
        <div className="dash-actions">
          <button className="btn btn--teal-o btn--sm" onClick={copyFilteredAlerts} disabled={!filteredRows.length}>Copiar alertas filtradas</button>
          <button className="btn btn--gold btn--sm" onClick={exportDashboard} disabled={!filteredRows.length}>Exportar Excel</button>
        </div>
      </div>
      {alertToast && <div className="toast toast--ok">{alertToast}</div>}

      <div className="card dash-filters">
        <div className="dash-panel-head">
          <div>
            <div className="dash-panel-title">Filtros de seguimiento</div>
            <div className="dim">Mostrando {filteredRows.length} de {registered} participantes.</div>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setFilters({ block: "actual", attendance: "all", audio: "all", game: "all", unlock: "all", risk: "all" })}
          >
            Limpiar filtros
          </button>
        </div>
        <div className="filter-row">
          <label className="filter-group">
            <span>Bloque</span>
            <select className="inp inp--sm" value={filters.block} onChange={(e) => setFilter("block", e.target.value)}>
              <option value="actual">Bloque actual de cada participante</option>
              {activeBlocks.map((b, idx) => <option key={b.id} value={b.id}>{idx + 1}. {b.title}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span>Asistencia</span>
            <select className="inp inp--sm" value={filters.attendance} onChange={(e) => setFilter("attendance", e.target.value)}>
              {Object.entries(attendanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span>Audio</span>
            <select className="inp inp--sm" value={filters.audio} onChange={(e) => setFilter("audio", e.target.value)}>
              {Object.entries(audioLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span>Juego</span>
            <select className="inp inp--sm" value={filters.game} onChange={(e) => setFilter("game", e.target.value)}>
              {Object.entries(gameLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span>Acceso</span>
            <select className="inp inp--sm" value={filters.unlock} onChange={(e) => setFilter("unlock", e.target.value)}>
              {Object.entries(unlockLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span>Estado</span>
            <select className="inp inp--sm" value={filters.risk} onChange={(e) => setFilter("risk", e.target.value)}>
              {Object.entries(riskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="dash-kpis">
        <div className="card dash-kpi"><span>{registered}</span><b>Registrados</b><small>Perfiles creados</small></div>
        <div className="card dash-kpi"><span>{pct(completeProfiles, registered)}%</span><b>Perfil completo</b><small>{completeProfiles}/{registered} usuarios</small></div>
        <div className="card dash-kpi"><span>{pct(linked, registered)}%</span><b>Vinculados</b><small>{linked}/{registered} al podio</small></div>
        <div className="card dash-kpi"><span>{avgRoute}%</span><b>Avance ruta</b><small>Promedio general</small></div>
        <div className="card dash-kpi"><span>{withResults}</span><b>Con resultados</b><small>Participaron en juegos</small></div>
        <div className="card dash-kpi"><span>{avgAccuracy}%</span><b>Aciertos</b><small>Promedio acumulado</small></div>
      </div>

      <div className="dash-grid">
        <div className="card dash-panel">
          <div className="dash-panel-head">
            <div>
              <div className="dash-panel-title">Alertas de seguimiento</div>
              <div className="dim">Prioriza a quiÃ©n acompaÃ±ar primero.</div>
            </div>
            <span className="dash-count">{alerts.length}</span>
          </div>
          {alerts.length === 0 ? (
            <div className="empty empty--compact">No hay alertas por ahora.</div>
          ) : (
            <div className="dash-alerts">
              {alerts.slice(0, 8).map((r) => (
                <div className="dash-alert" key={r.user.id}>
                  <span className="avatar avatar--xs">{initials(r.user.name)}</span>
                  <div>
                    <b>{r.user.name}</b>
                    <small>{r.status}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card dash-panel">
          <div className="dash-panel-head">
            <div>
              <div className="dash-panel-title">Avance por bloque</div>
              <div className="dim">Bloques activos, sin contar bloqueados.</div>
            </div>
          </div>
          {blocks.length === 0 ? (
            <div className="empty empty--compact">AÃºn no hay bloques activos.</div>
          ) : (
            <div className="block-stat-list">
              {blocks.map((b) => (
                <div className="block-stat" key={b.id}>
                  <div className="block-stat-head">
                    <b>{b.title}</b>
                    <span>{b.completed}/{b.total} Â· {b.percent}%</span>
                  </div>
                  <span className="mini-bar mini-bar--wide"><i style={{ width: `${b.percent}%` }} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card dash-panel dash-panel--wide">
        <div className="dash-panel-head">
          <div>
            <div className="dash-panel-title">AcompaÃ±amiento por participante</div>
            <div className="dim">Estado general de ruta, resultados y perfil.</div>
          </div>
        </div>
        {registered === 0 ? (
          <div className="empty empty--compact">AÃºn no hay usuarios registrados.</div>
        ) : filteredRows.length === 0 ? (
          <div className="empty empty--compact">No hay participantes con estos filtros.</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Participante</th>
                  <th>Bloque evaluado</th>
                  <th>Asistencia</th>
                  <th>Audio</th>
                  <th>Juego</th>
                  <th>Acceso</th>
                  <th>Alerta</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.user.id}>
                    <td>
                      <span className="cell-person">
                        <span className="avatar avatar--xs">{initials(r.user.name)}</span>
                        <span className="cell-main">
                          <b>{r.user.name}</b>
                          <small>{r.route.completed}/{r.route.total} bloques Â· {r.route.percent}% ruta</small>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="cell-main">
                        <b>{r.gate?.block?.title || "Sin bloque"}</b>
                        <small>{r.blockStatus?.completed ? "Completado" : r.blockStatus?.requirementsMet ? "Listo para cerrar" : "En proceso"}</small>
                      </span>
                    </td>
                    <td><span className={`mini-state mini-state--${r.attendanceState}`}>{labelFor(attendanceLabels, r.attendanceState)}</span></td>
                    <td><span className={`mini-state mini-state--${r.audioState}`}>{labelFor(audioLabels, r.audioState)}</span></td>
                    <td><span className={`mini-state mini-state--${r.gameState}`}>{labelFor(gameLabels, r.gameState)}</span></td>
                    <td><span className={`mini-state mini-state--${r.unlockState}`}>{labelFor(unlockLabels, r.unlockState)}</span></td>
                    <td>
                      <button className="btn btn--ghost btn--sm" onClick={() => copyText(alertMessageFor(r), `Alerta de ${r.user.name} copiada.`)}>
                        Copiar
                      </button>
                    </td>
                    <td><span className={`status-pill ${r.riskState === "risk" ? "status-pill--warn" : "status-pill--ok"}`}>{r.riskState === "risk" ? r.status : "Al dÃ­a"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= Editor de Ruta Formativa (admin) ================= */
function RouteEditor({ data, persist, busy }) {
  const route = data.route || emptyRoute();
  const [title, setTitle] = useState(route.title || "Ruta de PreparaciÃ³n");
  const [blocks, setBlocks] = useState(route.blocks || []);
  const [dirty, setDirty] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // Ã­ndice del bloque a confirmar
  const [uploading, setUploading] = useState(null); // Ã­ndice del bloque subiendo PDF
  const [uploadingAudio, setUploadingAudio] = useState(null);
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
      setUpErr("No se pudo subir el archivo. Revisa tu conexiÃ³n e intÃ©ntalo de nuevo.");
    } finally {
      setUploading(null);
    }
  };

  const uploadAudio = async (bi, file) => {
    if (!file) return;
    const fileName = String(file.name || "").toLowerCase();
    const looksAudio = /^audio\//.test(file.type || "") || /\.(mp3|m4a|wav|ogg|aac|opus)$/i.test(fileName);
    if (!looksAudio) console.warn("El navegador no reconociÃ³ el tipo de audio; se subirÃ¡ igual por extensiÃ³n.", file.type, file.name);
    setUpErr(null);
    setUploadingAudio(bi);
    try {
      const url = await sbUpload(file);
      setBlockField(bi, "audioUrl", url);
    } catch (e) {
      setUpErr("No se pudo subir el audio. Revisa tu conexiÃ³n e intÃ©ntalo de nuevo.");
    } finally {
      setUploadingAudio(null);
    }
  };

  useEffect(() => {
    setTitle(route.title || "Ruta de PreparaciÃ³n");
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
      i === bi ? { ...b, resources: [...(b.resources || []), { id: uid(), type, label: "", url: "", resultsUrl: "", embedUrl: "", slide: "", exerciseId: "", passingPct: PASSING_PCT }] } : b
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
    const resultLinks = new Map();
    const clean = blocks.map((b) => ({
      ...b,
      title: (b.title || "").trim(),
      subtitle: (b.subtitle || "").trim(),
      pptUrl: (b.pptUrl || "").trim(),
      audioUrl: (b.audioUrl || "").trim(),
      attendance: splitNames(b.attendanceText ?? b.attendance),
      resources: (b.resources || []).filter((r) => (r.url || r.resultsUrl || r.embedUrl || "").trim()).map((r) => {
        const cleaned = {
          ...r,
          url: (r.url || "").trim(),
          resultsUrl: (r.resultsUrl || "").trim(),
          embedUrl: (r.embedUrl || "").trim(),
          label: (r.label || "").trim(),
          slide: r.slide,
          exerciseId: r.exerciseId || "",
          passingPct: toInt(r.passingPct, PASSING_PCT),
        };
        if (cleaned.type === "game" && cleaned.exerciseId && cleaned.resultsUrl) resultLinks.set(cleaned.exerciseId, cleaned.resultsUrl);
        return cleaned;
      }),
    }));
    const exercises = (data.exercises || []).map((ex) => resultLinks.has(ex.id) ? { ...ex, resultsUrl: resultLinks.get(ex.id) } : ex);
    await persist({ ...data, exercises, route: { title: title.trim() || "Ruta de PreparaciÃ³n", blocks: clean } });
    setDirty(false);
  };

  return (
    <div className="stack">
      <div className="dim" style={{ fontSize: 13 }}>
        Arma la ruta como una serie de <b>bloques</b> (estaciones de la cancha). Cada bloque puede tener una
        <b> presentaciÃ³n embebida</b> (Google Slides, Canva o PowerPoint online), y <b>botones</b> de juegos de
        Wordwall y videos de YouTube, indicando en quÃ© lÃ¡mina aparecen. Para cada juego usa: link para jugar,
        ejercicio del podio vinculado y, opcionalmente, link de resultados para administraciÃ³n. El Ãºltimo bloque es el <b>gol</b>.
      </div>

      <div className="card">
        <label className="lbl">TÃ­tulo de la ruta</label>
        <input className="inp" value={title} onChange={(e) => mark(() => setTitle(e.target.value))} placeholder="Ej. Camino al Retiro EJE 2026" />
      </div>

      {blocks.length === 0 && <div className="empty">AÃºn no hay bloques. Agrega el primero abajo.</div>}

      {blocks.map((b, bi) => (
        <div key={b.id} className={`card block-edit ${b.locked ? "block-edit--locked" : ""}`}>
          <div className="block-edit-head">
            <div className="block-edit-n">{bi === blocks.length - 1 && blocks.length > 1 ? "ðŸ¥…" : bi + 1}</div>
            <input className="inp" value={b.title} onChange={(e) => setBlockField(bi, "title", e.target.value)} placeholder={`TÃ­tulo del bloque ${bi + 1}`} />
            <div className="block-edit-move">
              <button className="icon-btn" title="Subir" onClick={() => moveBlock(bi, -1)} disabled={bi === 0}>â†‘</button>
              <button className="icon-btn" title="Bajar" onClick={() => moveBlock(bi, 1)} disabled={bi === blocks.length - 1}>â†“</button>
              <button className="icon-btn" title="Eliminar bloque" onClick={() => setConfirmDel(bi)}>âœ•</button>
            </div>
          </div>

          <button className={`lock-toggle ${b.locked ? "lock-toggle--on" : ""}`} onClick={() => toggleLocked(bi)}>
            <span className="lock-ic">{b.locked ? "ðŸ”’" : "ðŸ”“"}</span>
            <span className="lock-txt">
              <b>{b.locked ? "Bloqueado para participantes" : "Visible para participantes"}</b>
              <span className="dim">{b.locked ? "Se muestra con candado; no pueden abrir su contenido." : "Cualquiera puede abrirlo y ver su contenido."}</span>
            </span>
            <span className="lock-switch"><span className="lock-knob" /></span>
          </button>

          {confirmDel === bi && (
            <div className="del-confirm">
              <span>Â¿Eliminar este bloque y sus recursos? No se puede deshacer.</span>
              <div className="del-confirm-actions">
                <button className="btn btn--danger-o btn--sm" onClick={() => removeBlock(bi)}>SÃ­, eliminar</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDel(null)}>Cancelar</button>
              </div>
            </div>
          )}

          <label className="lbl">DescripciÃ³n breve (opcional)</label>
          <input className="inp" value={b.subtitle} onChange={(e) => setBlockField(bi, "subtitle", e.target.value)} placeholder="Ej. Primera sesiÃ³n: los 4 niveles del encuentro" />

          <label className="lbl" style={{ marginTop: 10 }}>PresentaciÃ³n del bloque</label>
          <div className="ppt-input-group">
            <label className="btn btn--teal-o btn--sm ppt-upload-btn">
              {uploading === bi ? "Subiendoâ€¦" : "ðŸ“¤ Subir PDF"}
              <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={uploading === bi} onChange={(e) => { if (e.target.files[0]) uploadPdf(bi, e.target.files[0]); e.target.value = ""; }} />
            </label>
            <span className="dim" style={{ fontSize: 12 }}>â€” o pega un link (Google Slides, Canva, YouTube no) â€”</span>
          </div>
          <input className="inp" value={b.pptUrl} onChange={(e) => setBlockField(bi, "pptUrl", e.target.value)} placeholder="Sube un PDF arriba, o pega aquÃ­ el link de tu presentaciÃ³n" />
          {b.pptUrl && b.pptUrl.includes("/storage/v1/object/public/") && <div className="ok-inline">âœ… PDF subido a la base de datos â€” se verÃ¡ dentro de la app.</div>}
          {b.pptUrl && !isValidUrl(b.pptUrl) && <div className="warn-inline">âš  El link debe empezar con http:// o https://</div>}
          {upErr && uploading === null && <div className="warn-inline">{upErr}</div>}

          <label className="lbl" style={{ marginTop: 10 }}>Audio de acompaÃ±amiento</label>
          <div className="ppt-input-group">
            <label className="btn btn--teal-o btn--sm ppt-upload-btn">
              {uploadingAudio === bi ? "Subiendo audio..." : "Subir audio"}
              <input type="file" accept=".mp3,.m4a,.wav,.ogg,.aac,.opus,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac,audio/*" style={{ display: "none" }} disabled={uploadingAudio === bi} onChange={(e) => { if (e.target.files[0]) uploadAudio(bi, e.target.files[0]); e.target.value = ""; }} />
            </label>
            <span className="dim" style={{ fontSize: 12 }}>Si hay asistencia registrada, este audio queda como repaso opcional.</span>
          </div>
          <input className="inp" value={b.audioUrl || ""} onChange={(e) => setBlockField(bi, "audioUrl", e.target.value)} placeholder="Sube un audio o pega un link MP3/M4A" />

          <div className="ok-inline" style={{ marginTop: 8 }}>
            La asistencia de este bloque se marca desde la pestaÃ±a Asistencia.
          </div>

          <div className="res-edit-groups">
            {(b.resources || []).length > 0 && (
              <div className="res-edit-list">
                {b.resources.map((r, ri) => (
                  <div key={r.id} className={`res-edit res-edit--${r.type}`}>
                    <span className="res-edit-ic">{r.type === "game" ? "ðŸŽ®" : "â–¶ï¸"}</span>
                    <input className="inp inp--sm" value={r.label} onChange={(e) => setResField(bi, ri, "label", e.target.value)} placeholder={r.type === "game" ? "Nombre del juego" : "TÃ­tulo del video"} />
                    <input className="inp inp--sm" value={r.url} onChange={(e) => setResField(bi, ri, "url", e.target.value)} placeholder={r.type === "game" ? "Link para jugar Wordwall" : "Link de YouTube"} />
                    <input className="inp inp--slide" value={r.slide} onChange={(e) => setResField(bi, ri, "slide", e.target.value.replace(/\D/g, ""))} placeholder="LÃ¡m." title="NÂº de lÃ¡mina" />
                    {r.type === "game" && (
                      <>
                        <input className="inp inp--sm res-edit-wide" value={r.resultsUrl || ""} onChange={(e) => setResField(bi, ri, "resultsUrl", e.target.value)} placeholder="Link de ver resultados (admin)" />
                        <select className="inp inp--sm" value={r.exerciseId || ""} onChange={(e) => setResField(bi, ri, "exerciseId", e.target.value)}>
                          <option value="">Vincular con ejercicio del podio</option>
                          {data.exercises.map((ex) => <option key={ex.id} value={ex.id}>{ex.title}</option>)}
                        </select>
                        <input className="inp inp--slide" value={r.passingPct ?? PASSING_PCT} onChange={(e) => setResField(bi, ri, "passingPct", e.target.value.replace(/\D/g, ""))} title="% mÃ­nimo" />
                      </>
                    )}
                    <button className="icon-btn" title="Quitar recurso" onClick={() => removeResource(bi, ri)}>âœ•</button>
                  </div>
                ))}
              </div>
            )}
            <div className="res-add-row">
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource(bi, "game")}>ðŸŽ® + Juego Wordwall</button>
              <button className="btn btn--danger-o btn--sm" onClick={() => addResource(bi, "video")}>â–¶ï¸ + Video YouTube</button>
            </div>
          </div>
        </div>
      ))}

      <button className="btn btn--teal-o add-block-btn" onClick={addBlock}>âš½ + Agregar bloque</button>

      <div className="route-save">
        <button className="btn btn--gold" onClick={save} disabled={busy || !dirty}>
          {dirty ? "Guardar ruta" : "Ruta guardada âœ“"}
        </button>
        {dirty && <span className="dim" style={{ fontSize: 13 }}>Tienes cambios sin guardar.</span>}
      </div>
    </div>
  );
}

/* ================= Editor de ejercicio (admin) ================= */
function ExerciseEditor({ exercise, data, persist, busy, onClose }) {
  const [title, setTitle] = useState(exercise.title);
  const [students, setStudents] = useState(exercise.students.map((s) => ({ ...s })));
  const [resultsUrl, setResultsUrl] = useState(exercise.resultsUrl || "");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlMsg, setUrlMsg] = useState(null);
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
  const applyResultsUrl = async () => {
    setUrlMsg(null);
    if (!resultsUrl.trim()) {
      setUrlMsg({ ok: false, t: "Pega primero el link de resultados de Wordwall." });
      return;
    }
    setUrlBusy(true);
    try {
      const synced = await syncExerciseFromResultsUrl({ ...exercise, resultsUrl: resultsUrl.trim(), students });
      setStudents(synced.exercise.students);
      setUrlMsg({ ok: true, t: `Resultados actualizados: ${synced.added} nuevo(s), ${synced.updated} actualizado(s).` });
    } catch (e) {
      setUrlMsg({ ok: false, t: e.message || "No se pudo actualizar desde ese link." });
    } finally {
      setUrlBusy(false);
    }
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
      e.id === exercise.id ? { ...e, title: title.trim() || e.title, sortBy: "score", resultsUrl: resultsUrl.trim(), students: cleaned } : e
    );
    await persist({ ...data, aliases, exercises });
    onClose();
  };

  return (
    <div className="overlay">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="disp modal-title">EDITAR EJERCICIO</div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cancelar âœ•</button>
        </div>

        <div className="stack">
          <div>
            <label className="lbl">TÃ­tulo</label>
            <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <label className="lbl">Link de resultados Wordwall</label>
            <div className="link-sync-row">
            <input className="inp" value={resultsUrl} onChange={(e) => setResultsUrl(e.target.value)} placeholder="Pega aquÃ­ el link de resultados de Wordwall" />
              <button className="btn btn--teal-o btn--sm" onClick={applyResultsUrl} disabled={urlBusy || !resultsUrl.trim()}>
                {urlBusy ? "Intentando..." : "Intentar actualizar"}
              </button>
            </div>
            {urlMsg && <div className={urlMsg.ok ? "ok-inline" : "warn-inline"}>{urlMsg.t}</div>}
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              Wordwall puede bloquear la lectura directa de su vista de resultados. Si pasa, abre el link, exporta el Excel o pega el detallado.
            </div>
          </div>

          <div className="ok-inline">
            Regla de ranking: primero cuentan los aciertos del primer intento. Si hay empate, Wordwall desempata por rapidez; nunca supera a los aciertos.
          </div>

          <div>
            <button className="btn btn--teal-o btn--sm" onClick={() => setPasteOpen(!pasteOpen)}>
              {pasteOpen ? "Ocultar" : "ðŸ“‹ Pegar detallado de Wordwall para actualizar puntuaciones"}
            </button>
            {pasteOpen && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  className="inp inp--mono"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                  placeholder={"Alumno\tEnviado\tPuntuaciÃ³n\tCorrecto\tIncorrecto\nEly\t19:32 - 27 jun. 2026\t1036\t7\t0"}
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
                  <th>Desempate</th>
                  <th>Aciertos</th>
                  <th>Preguntas</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={i}>
                    <td><b>{s.raw}</b></td>
                    <td><input className="inp inp--cell" value={s.score ?? ""} onChange={(e) => setField(i, "score", e.target.value.replace(/\D/g, ""))} placeholder="â€”" /></td>
                    <td><input className="inp inp--cell inp--xs" value={s.correct} onChange={(e) => setField(i, "correct", e.target.value.replace(/\D/g, ""))} /></td>
                    <td><input className="inp inp--cell inp--xs" value={s.total} onChange={(e) => setField(i, "total", e.target.value.replace(/\D/g, ""))} /></td>
                    <td><button className="icon-btn" title="Quitar participante" onClick={() => removeRow(i)}>âœ•</button></td>
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

/* ================= Asistencia por bloque (admin) ================= */
function AttendanceAdmin({ data, busy, onSave }) {
  const blocks = data.route?.blocks || [];
  const users = data.users || [];
  const [blockId, setBlockId] = useState(blocks.find((b) => !b.locked)?.id || blocks[0]?.id || "");
  const [query, setQuery] = useState("");
  const [present, setPresent] = useState(new Set());

  const block = blocks.find((b) => b.id === blockId) || blocks[0] || null;

  useEffect(() => {
    if (!block && blocks.length) setBlockId(blocks[0].id);
  }, [block, blocks]);

  useEffect(() => {
    if (!block) {
      setPresent(new Set());
      return;
    }
    setPresent(new Set(users.filter((u) => attendedBlock(data, block, u)).map((u) => u.id)));
  }, [blockId, data.attendance, data.users, data.route]);

  const filteredUsers = useMemo(() => {
    const q = norm(query);
    if (!q) return users;
    return users.filter((u) => norm(`${u.name} ${u.linkedCanon || ""}`).includes(q));
  }, [users, query]);

  const presentCount = present.size;
  const visibleIds = filteredUsers.map((u) => u.id);
  const allVisibleMarked = visibleIds.length > 0 && visibleIds.every((id) => present.has(id));

  const toggle = (userId) => {
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const markVisible = (attended) => {
    setPresent((prev) => {
      const next = new Set(prev);
      visibleIds.forEach((id) => {
        if (attended) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  if (!blocks.length) {
    return <div className="empty">Crea primero bloques en la Ruta Formativa para registrar asistencia.</div>;
  }

  return (
    <div className="attendance-admin">
      <div className="card attendance-hero">
        <div>
          <div className="dash-eyebrow">Asistencia por sesiÃ³n</div>
          <div className="dash-title">Control por bloque</div>
          <div className="dim">Marca quiÃ©n asistiÃ³ a cada bloque. Si asistiÃ³, el audio queda como repaso; los juegos siguen siendo obligatorios.</div>
        </div>
        <button className="btn btn--gold btn--sm" onClick={() => onSave(blockId, present)} disabled={busy || !block}>
          Guardar asistencia
        </button>
      </div>

      <div className="card attendance-tools">
        <label className="filter-group">
          <span>Bloque / sesiÃ³n</span>
          <select className="inp" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
            {blocks.map((b, idx) => (
              <option key={b.id} value={b.id}>{idx + 1}. {b.title || `Bloque ${idx + 1}`}{b.locked ? " (bloqueado)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="filter-group">
          <span>Buscar participante</span>
          <input className="inp" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre o nombre vinculado al podio" />
        </label>
        <div className="attendance-actions">
          <button className="btn btn--teal-o btn--sm" onClick={() => markVisible(!allVisibleMarked)}>
            {allVisibleMarked ? "Quitar visibles" : "Marcar visibles"}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => markVisible(false)}>Limpiar visibles</button>
        </div>
      </div>

      <div className="attendance-summary">
        <div className="card dash-kpi"><span>{presentCount}</span><b>Asistieron</b><small>{users.length} participantes registrados</small></div>
        <div className="card dash-kpi"><span>{users.length ? users.length - presentCount : 0}</span><b>No marcados</b><small>Para este bloque</small></div>
        <div className="card dash-kpi"><span>{filteredUsers.length}</span><b>Visibles</b><small>SegÃºn bÃºsqueda actual</small></div>
      </div>

      <div className="card attendance-list">
        {filteredUsers.length === 0 ? (
          <div className="empty empty--compact">No hay participantes con esa bÃºsqueda.</div>
        ) : (
          filteredUsers.map((u) => {
            const checked = present.has(u.id);
            return (
              <button key={u.id} className={`attendance-row ${checked ? "attendance-row--on" : ""}`} onClick={() => toggle(u.id)}>
                <span className="attendance-check">{checked ? "âœ“" : ""}</span>
                <span className="avatar avatar--xs">{initials(u.name)}</span>
                <span className="attendance-person">
                  <b>{u.name}</b>
                  <small>{u.linkedCanon ? `Podio: ${u.linkedCanon}` : "Sin vÃ­nculo al podio"}</small>
                </span>
                <span className={`mini-state ${checked ? "mini-state--present" : "mini-state--absent"}`}>
                  {checked ? "AsistiÃ³" : "No marcado"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ================= Panel de administraciÃ³n ================= */
const QUESTION_STATUS = [
  ["new", "Nueva"],
  ["reviewed", "Revisada"],
  ["answered", "Respondida"],
  ["archived", "Archivada"],
];
const questionStatusLabel = (status) => QUESTION_STATUS.find(([k]) => k === status)?.[1] || "Nueva";

function QuestionBox({ user, questions, onSubmit, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const mine = (questions || []).filter((q) => q.userId === user.id).slice(0, 6);

  const send = async () => {
    setMsg(null);
    if (text.trim().length < 8) {
      setMsg({ ok: false, t: "Escribe una pregunta un poco mÃ¡s completa." });
      return;
    }
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
      setMsg({ ok: true, t: "Pregunta enviada. El equipo la revisarÃ¡." });
    } catch (e) {
      setMsg({ ok: false, t: "No se pudo enviar la pregunta. Intentalo de nuevo." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal--mid" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="disp modal-title">BUZÃ“N DE PREGUNTAS</div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar</button>
        </div>
        <div className="stack">
          <textarea
            className="inp"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe tu pregunta para el equipo de acompaÃ±amiento"
          />
          {msg && <div className={msg.ok ? "ok-inline" : "warn-inline"}>{msg.t}</div>}
          <button className="btn btn--gold" onClick={send} disabled={busy || !text.trim()}>
            {busy ? "Enviando..." : "Enviar pregunta"}
          </button>

          <div className="question-history">
            <div className="requirements-title">Mis preguntas recientes</div>
            {mine.length === 0 ? (
              <div className="empty empty--compact">AÃºn no has enviado preguntas.</div>
            ) : (
              mine.map((q) => (
                <div key={q.id} className="question-item">
                  <div className="question-item-head">
                    <b>{questionStatusLabel(q.status)}</b>
                    <small>{q.createdAt ? new Date(q.createdAt).toLocaleString("es-PE") : ""}</small>
                  </div>
                  <p>{q.question}</p>
                  {q.answer ? <div className="question-answer">{q.answer}</div> : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionsAdmin({ data, busy, onUpdate }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [answers, setAnswers] = useState({});
  const questions = data.questions || [];
  const filtered = useMemo(() => {
    const qn = norm(query);
    return questions.filter((q) => {
      if (filter !== "all" && q.status !== filter) return false;
      if (!qn) return true;
      return norm(`${q.userName} ${q.question} ${q.answer}`).includes(qn);
    });
  }, [questions, filter, query]);
  const counts = useMemo(() => {
    const base = { all: questions.length };
    for (const [k] of QUESTION_STATUS) base[k] = questions.filter((q) => q.status === k).length;
    return base;
  }, [questions]);
  const answerFor = (q) => answers[q.id] ?? q.answer ?? "";

  return (
    <div className="questions-admin">
      <div className="card attendance-hero">
        <div>
          <div className="dash-eyebrow">AcompaÃ±amiento</div>
          <div className="dash-title">BuzÃ³n de preguntas</div>
          <div className="dim">Revisa preguntas generales, marca estados y deja una respuesta visible para el participante.</div>
        </div>
      </div>

      <div className="card attendance-tools questions-tools">
        <label className="filter-group">
          <span>Estado</span>
          <select className="inp" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todas ({counts.all || 0})</option>
            {QUESTION_STATUS.map(([k, t]) => <option key={k} value={k}>{t} ({counts[k] || 0})</option>)}
          </select>
        </label>
        <label className="filter-group">
          <span>Buscar</span>
          <input className="inp" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Participante, pregunta o respuesta" />
        </label>
      </div>

      <div className="questions-list">
        {filtered.length === 0 ? (
          <div className="empty empty--compact">No hay preguntas con ese filtro.</div>
        ) : (
          filtered.map((q) => (
            <div key={q.id} className="card question-admin-row">
              <div className="question-admin-top">
                <span className="cell-person">
                  <span className="avatar avatar--xs">{initials(q.userName || "?")}</span>
                  <span className="cell-main">
                    <b>{q.userName || "Participante"}</b>
                    <small>{q.createdAt ? new Date(q.createdAt).toLocaleString("es-PE") : ""}</small>
                  </span>
                </span>
                <select className="inp inp--sm" value={q.status || "new"} onChange={(e) => onUpdate(q.id, { status: e.target.value, answer: answerFor(q) })} disabled={busy}>
                  {QUESTION_STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </div>
              <p className="question-text">{q.question}</p>
              <textarea
                className="inp"
                rows={3}
                value={answerFor(q)}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                placeholder="Respuesta visible para el participante"
              />
              <div className="row-actions">
                <button className="btn btn--teal-o btn--sm" onClick={() => onUpdate(q.id, { answer: answerFor(q), status: answerFor(q).trim() ? "answered" : q.status })} disabled={busy}>
                  Guardar respuesta
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => onUpdate(q.id, { status: "archived", answer: answerFor(q) })} disabled={busy}>
                  Archivar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RoleplayAdmin({ data, persist, busy }) {
  const [local, setLocal] = useState(() => normalizeRoleplay(data.roleplay));
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState("");
  const [msg, setMsg] = useState("");
  const stats = useMemo(() => roleplayStats(data), [data]);

  useEffect(() => {
    setLocal(normalizeRoleplay(data.roleplay));
    setDirty(false);
  }, [data.roleplay]);

  const mark = (fn) => {
    fn();
    setDirty(true);
    setMsg("");
  };
  const setTypeField = (idx, field, value) => mark(() => setLocal((prev) => ({
    ...prev,
    participantTypes: prev.participantTypes.map((t, i) => (i === idx ? { ...t, [field]: value } : t)),
  })));
  const addType = () => mark(() => setLocal((prev) => ({
    ...prev,
    participantTypes: [...prev.participantTypes, { id: uid(), name: "Nuevo tipo de joven", guide: "" }],
  })));
  const removeType = (idx) => mark(() => setLocal((prev) => ({
    ...prev,
    participantTypes: prev.participantTypes.filter((_, i) => i !== idx),
  })));
  const addResource = (roleKey, type) => mark(() => setLocal((prev) => ({
    ...prev,
    [roleKey]: {
      ...prev[roleKey],
      resources: [...(prev[roleKey]?.resources || []), { id: uid(), type, label: "", url: "", note: "", time: "", materials: "" }],
    },
  })));
  const setResourceField = (roleKey, idx, field, value) => mark(() => setLocal((prev) => ({
    ...prev,
    [roleKey]: {
      ...prev[roleKey],
      resources: (prev[roleKey]?.resources || []).map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    },
  })));
  const removeResource = (roleKey, idx) => mark(() => setLocal((prev) => ({
    ...prev,
    [roleKey]: {
      ...prev[roleKey],
      resources: (prev[roleKey]?.resources || []).filter((_, i) => i !== idx),
    },
  })));
  const uploadResource = async (roleKey, idx, file) => {
    if (!file) return;
    const resource = local[roleKey]?.resources?.[idx];
    if (!resource) return;
    const fileName = String(file.name || "").toLowerCase();
    const looksAudio = /^audio\//.test(file.type || "") || /\.(mp3|m4a|wav|ogg|aac|opus)$/i.test(fileName);
    const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(fileName);
    if (resource.type === "audio" && !looksAudio) console.warn("El navegador no reconociÃ³ el tipo de audio; se subirÃ¡ igual por extensiÃ³n.", file.type, file.name);
    if (resource.type === "file" && !looksPdf) {
      setMsg("El archivo del coordinador debe ser PDF.");
      return;
    }
    const key = `${roleKey}-${idx}`;
    setUploading(key);
    setMsg("");
    try {
      const url = await sbUpload(file);
      setResourceField(roleKey, idx, "url", url);
      if (!resource.label) setResourceField(roleKey, idx, "label", file.name.replace(/\.[^.]+$/, ""));
      setMsg("Archivo subido. Recuerda guardar la configuraciÃ³n.");
    } catch {
      setMsg("No se pudo subir el archivo. Revisa tu conexiÃ³n e intÃ©ntalo otra vez.");
    } finally {
      setUploading("");
    }
  };
  const save = async () => {
    const cleaned = normalizeRoleplay(local);
    await persist({ ...data, roleplay: cleaned });
    setLocal(cleaned);
    setDirty(false);
  };
  const typeOptionsFor = (roleKey) => {
    if (roleKey === "coordinador") return [["file", "PDF"], ["audio", "Audio"]];
    if (roleKey === "apoyo_interno") return [["materials", "Momento/materiales"], ["wordwall", "Wordwall"]];
    if (roleKey === "apoyo_externo") return [["html", "Juego HTML"], ["wordwall", "Wordwall"]];
    return [["wordwall", "Wordwall"]];
  };
  const typeName = (type) => ({
    audio: "Audio",
    file: "PDF",
    html: "Juego HTML",
    materials: "Materiales",
    wordwall: "Wordwall",
  }[type] || "Recurso");
  const renderResourceRows = (roleKey) => {
    const resources = local[roleKey]?.resources || [];
    const typeOptions = typeOptionsFor(roleKey);
    return (
      <div className="role-resource-list">
        {resources.length === 0 && <div className="empty empty--compact">TodavÃ­a no hay recursos para este rol.</div>}
        {resources.map((r, idx) => (
          <div key={r.id} className="role-resource-row">
            {typeOptions.length > 1 ? (
              <select className="inp inp--sm" value={r.type} onChange={(e) => setResourceField(roleKey, idx, "type", e.target.value)}>
                {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : <span className="mini-state">{typeName(r.type)}</span>}
            {r.type === "materials" && (
              <input className="inp inp--sm inp--time" value={r.time || ""} onChange={(e) => setResourceField(roleKey, idx, "time", e.target.value)} placeholder="Momento / hora" />
            )}
            <input className="inp inp--sm" value={r.label} onChange={(e) => setResourceField(roleKey, idx, "label", e.target.value)} placeholder="Nombre visible" />
            {r.type !== "materials" && (
              <input className="inp inp--sm role-resource-url" value={r.url} onChange={(e) => setResourceField(roleKey, idx, "url", e.target.value)} placeholder={r.type === "html" ? "Ruta del HTML, ej. /apoyo_externo_quiz.html" : r.type === "wordwall" ? "Link de Wordwall" : "Link o archivo subido"} />
            )}
            {roleKey === "coordinador" && (
              <label className="btn btn--teal-o btn--sm ppt-upload-btn">
                {uploading === `${roleKey}-${idx}` ? "Subiendo..." : r.type === "audio" ? "Subir audio" : "Subir PDF"}
                <input
                  type="file"
                  accept={r.type === "audio" ? ".mp3,.m4a,.wav,.ogg,.aac,.opus,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac,audio/*" : "application/pdf,.pdf"}
                  style={{ display: "none" }}
                  disabled={uploading === `${roleKey}-${idx}`}
                  onChange={(e) => { if (e.target.files[0]) uploadResource(roleKey, idx, e.target.files[0]); e.target.value = ""; }}
                />
              </label>
            )}
            {r.type === "materials" ? (
              <input className="inp inp--sm role-resource-url" value={r.materials || ""} onChange={(e) => setResourceField(roleKey, idx, "materials", e.target.value)} placeholder="Materiales necesarios" />
            ) : (
              <input className="inp inp--sm" value={r.note || ""} onChange={(e) => setResourceField(roleKey, idx, "note", e.target.value)} placeholder="Nota breve opcional" />
            )}
            <button className="icon-btn" title="Quitar recurso" onClick={() => removeResource(roleKey, idx)}>âœ•</button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="role-admin stack">
      <div className="card dash-hero">
        <div>
          <div className="dash-eyebrow">PrÃ¡ctica por rol</div>
          <div className="dash-title">Juego de roles</div>
          <div className="dim">Configura casos, juegos y materiales. El uso se registra para ver participaciÃ³n desde administraciÃ³n.</div>
        </div>
        <button className="btn btn--gold btn--sm" onClick={save} disabled={busy || !dirty}>
          {dirty ? "Guardar juego de roles" : "Guardado"}
        </button>
      </div>
      {msg && <div className="toast toast--ok">{msg}</div>}

      <div className="dash-kpis">
        <div className="card dash-kpi"><span>{stats.sessions}</span><b>Sesiones asesor</b><small>{stats.activeSessions} abiertas</small></div>
        <div className="card dash-kpi"><span>{stats.sessionParticipants}</span><b>Participantes en sesiones</b><small>{stats.uniqueSessionUsers} Ãºnicos</small></div>
        <div className="card dash-kpi"><span>{stats.resourceOpens}</span><b>Usos de recursos</b><small>{stats.uniqueEventUsers} usuarios</small></div>
        <div className="card dash-kpi"><span>{stats.totalUniqueUsers}</span><b>Alcance total</b><small>Sesiones y recursos</small></div>
      </div>

      <div className="card dash-panel">
        <div className="dash-panel-head">
          <div>
            <div className="dash-panel-title">Uso por rol</div>
            <div className="dim">Sesiones, participantes y aperturas de recursos.</div>
          </div>
        </div>
        <div className="role-usage-grid">
          {ROLEPLAY_ROLES.map((role) => {
            const use = stats.roleUse[role.key] || { opens: 0, users: new Set(), sessions: 0, participants: 0 };
            return (
              <div key={role.key} className="role-usage-card">
                <b>{role.label}</b>
                <span>{use.sessions} sesiones Â· {use.participants} participantes</span>
                <span>{use.opens} aperturas Â· {use.users.size} usuarios</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card dash-panel">
        <div className="dash-panel-head">
          <div>
            <div className="dash-panel-title">Casos para prÃ¡ctica de asesor</div>
            <div className="dim">Basado en el Anexo 4 del Manual AS-COS. Puedes editarlo si quieres ajustar el lenguaje.</div>
          </div>
          <button className="btn btn--teal-o btn--sm" onClick={addType}>+ Agregar caso</button>
        </div>
        <div className="ascos-edit-list">
          {local.participantTypes.map((t, idx) => (
            <div key={t.id} className="ascos-edit-row">
              <input className="inp inp--sm" value={t.name} onChange={(e) => setTypeField(idx, "name", e.target.value)} placeholder="Tipo de joven" />
              <input className="inp inp--sm ascos-guide" value={t.guide} onChange={(e) => setTypeField(idx, "guide", e.target.value)} placeholder="DescripciÃ³n breve" />
              <button className="icon-btn" title="Quitar caso" onClick={() => removeType(idx)}>âœ•</button>
            </div>
          ))}
        </div>
      </div>

      <div className="role-admin-grid">
        <div className="card dash-panel">
          <div className="dash-panel-head">
            <div>
              <div className="dash-panel-title">Apoyo interno</div>
              <div className="dim">Juegos prÃ¡cticos de Wordwall.</div>
            </div>
            <div className="row-actions">
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource("apoyo_interno", "materials")}>+ Momento/materiales</button>
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource("apoyo_interno", "wordwall")}>+ Juego</button>
            </div>
          </div>
          {renderResourceRows("apoyo_interno")}
        </div>
        <div className="card dash-panel">
          <div className="dash-panel-head">
            <div>
              <div className="dash-panel-title">Apoyo externo</div>
              <div className="dim">Juegos prÃ¡cticos de Wordwall.</div>
            </div>
            <div className="row-actions">
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource("apoyo_externo", "html")}>+ Juego HTML</button>
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource("apoyo_externo", "wordwall")}>+ Wordwall</button>
            </div>
          </div>
          {renderResourceRows("apoyo_externo")}
        </div>
        <div className="card dash-panel role-admin-card-wide">
          <div className="dash-panel-head">
            <div>
              <div className="dash-panel-title">Coordinador</div>
              <div className="dim">PDFs y audios requeridos para el retiro.</div>
            </div>
            <div className="row-actions">
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource("coordinador", "file")}>+ PDF</button>
              <button className="btn btn--teal-o btn--sm" onClick={() => addResource("coordinador", "audio")}>+ Audio</button>
            </div>
          </div>
          <div className="admin-helper-strip">
            <span><b>Audio:</b> + Audio â†’ Subir audio â†’ Guardar juego de roles.</span>
            <span><b>PDF:</b> + PDF â†’ Subir PDF â†’ Guardar juego de roles.</span>
          </div>
          <div className="admin-helper-strip">
            <span><b>Google Drive:</b> pega el link con permiso "cualquiera con el enlace" y la app lo convierte para reproducir.</span>
          </div>
          {renderResourceRows("coordinador")}
        </div>
      </div>

      <div className="card dash-panel">
        <div className="dash-panel-head">
          <div>
            <div className="dash-panel-title">Ãšltimas sesiones de asesor</div>
            <div className="dim">CÃ³digos creados por participantes para practicar.</div>
          </div>
        </div>
        {(data.roleplaySessions || []).length === 0 ? (
          <div className="empty empty--compact">AÃºn no hay sesiones creadas.</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr><th>CÃ³digo</th><th>Creador</th><th>Participantes</th><th>Estado</th><th>Creada</th></tr>
              </thead>
              <tbody>
                {(data.roleplaySessions || []).slice(0, 12).map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.code}</b></td>
                    <td>{s.ownerName || "Participante"}</td>
                    <td>{(s.participants || []).length}</td>
                    <td>{s.status === "closed" ? "Cerrada" : "Abierta"}</td>
                    <td>{s.createdAt ? new Date(s.createdAt).toLocaleString("es-PE") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPanel({ data, setData, onExit }) {
  const [tab, setTab] = useState(() => readStore(STORE.adminTab, "dashboard"));
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [titleEdit, setTitleEdit] = useState("");
  const [lbText, setLbText] = useState("");
  const [nameMap, setNameMap] = useState({});
  const [editing, setEditing] = useState(null);
  const [mergeMode, setMergeMode] = useState("new"); // "new" | "merge"
  const [mergeTarget, setMergeTarget] = useState(""); // id del ejercicio a fusionar
  const fileRef = useRef(null);
  useEffect(() => { writeStore(STORE.adminTab, tab); }, [tab]);

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
      setMsg({ ok: false, t: "No se pudo guardar. Revisa tu conexiÃ³n e intÃ©ntalo de nuevo." });
      throw new Error("persist");
    } finally {
      setBusy(false);
    }
  };

  const saveAttendanceBlock = async (targetBlockId, presentIds) => {
    if (!targetBlockId) return;
    setBusy(true);
    setMsg(null);
    try {
      const presentSet = new Set(presentIds);
      const targetBlock = (data.route?.blocks || []).find((b) => b.id === targetBlockId);
      const attendanceOnlyBlock = !!targetBlock && !targetBlock.audioUrl && !(targetBlock.resources || []).some((r) => r.type === "game");
      const savedRows = await Promise.all((data.users || []).map((u) =>
        saveSessionAttendance(u.id, targetBlockId, presentSet.has(u.id))
      ));
      const savedProgressRows = attendanceOnlyBlock
        ? await Promise.all((data.users || []).map((u) =>
            saveBlockProgress(u.id, targetBlockId, presentSet.has(u.id))
          ))
        : [];
      const otherRows = (data.attendance || []).filter((a) => a.blockId !== targetBlockId);
      const otherProgressRows = attendanceOnlyBlock ? (data.progress || []).filter((p) => p.blockId !== targetBlockId) : (data.progress || []);
      const next = {
        ...data,
        attendance: [...otherRows, ...savedRows],
        progress: attendanceOnlyBlock ? [...otherProgressRows, ...savedProgressRows] : otherProgressRows,
      };
      setData(next);
      const count = savedRows.filter((r) => r.attended).length;
      setMsg({ ok: true, t: `Asistencia guardada: ${count} participante(s) marcado(s).${attendanceOnlyBlock ? " Este bloque tambien quedo sincronizado con el avance de ruta." : ""}` });
    } catch (e) {
      setMsg({ ok: false, t: "No se pudo guardar la asistencia. Revisa que las tablas session_attendance y route_progress existan en Supabase." });
    } finally {
      setBusy(false);
    }
  };

  const saveQuestionUpdate = async (questionId, patch) => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await updateQuestionBox(questionId, patch);
      setData((prev) => ({
        ...prev,
        questions: (prev.questions || []).map((q) => (q.id === questionId ? saved : q)),
      }));
      setMsg({ ok: true, t: "Pregunta actualizada." });
    } catch (e) {
      setMsg({ ok: false, t: "No se pudo guardar la pregunta. Revisa que la tabla question_box exista en Supabase." });
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
        setMsg({ ok: false, t: "No se encontraron resultados de alumnos en el archivo. Â¿Es el export de Wordwall ('Resultados por alumno')?" });
        return;
      }
      setParsed(p);
      setTitleEdit(p.title);
      setLbText("");
      const nm = {};
      for (const s of p.students) if (!data.aliases[norm(s.raw)]) nm[norm(s.raw)] = "__new__";
      setNameMap(nm);
      // Â¿existe ya un ejercicio con este tÃ­tulo? â†’ sugerir fusiÃ³n
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
          title: titleEdit.trim() || parsed.title || "Ejercicio sin tÃ­tulo",
          date: new Date().toISOString(),
          sortBy: "score",
          resultsUrl: "",
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
  const exercisesWithResultLinks = useMemo(
    () => (data.exercises || []).filter((ex) => String(ex.resultsUrl || "").trim()),
    [data.exercises]
  );

  const syncAllResultLinks = async () => {
    if (!exercisesWithResultLinks.length) {
      setMsg({ ok: false, t: "Aun no hay ejercicios con link de resultados guardado." });
      return;
    }
    setSyncBusy(true);
    setMsg(null);
    let syncedCount = 0;
    let addedTotal = 0;
    let updatedTotal = 0;
    const failures = [];
    const nextExercises = [];
    for (const ex of data.exercises || []) {
      if (!String(ex.resultsUrl || "").trim()) {
        nextExercises.push(ex);
        continue;
      }
      try {
        const synced = await syncExerciseFromResultsUrl(ex);
        nextExercises.push(synced.exercise);
        syncedCount++;
        addedTotal += synced.added;
        updatedTotal += synced.updated;
      } catch (e) {
        nextExercises.push(ex);
        failures.push(`${ex.title}: ${e.message || "no se pudo leer el link"}`);
      }
    }
    try {
      if (syncedCount > 0) await persist({ ...data, exercises: nextExercises });
      const failText = failures.length ? ` ${failures.length} link(s) no se pudieron leer; usa Excel o pegado rapido para esos casos.` : "";
      setMsg({
        ok: syncedCount > 0,
        t: syncedCount > 0
          ? `Sincronizados ${syncedCount} ejercicio(s): ${addedTotal} nuevo(s), ${updatedTotal} actualizado(s).${failText}`
          : "Wordwall bloqueo la lectura de los links guardados. Abre cada link, exporta Excel o pega el detallado.",
      });
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div className="wrap">
      <div className="admin-head">
        <div className="admin-head-l">
          <span className="admin-badge">âš™ ADMIN</span>
          <div>
            <div className="admin-title">Panel de resultados</div>
            <div className="admin-sub">Sube ejercicios, edÃ­talos y gestiona los nombres del equipo</div>
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onExit}>â† Vista pÃºblica</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "roles" ? "tab--on" : ""}`} onClick={() => setTab("roles")}>Juego de roles</button>
        {[["dashboard", "ðŸ“Š Dashboard"], ["ruta", "ðŸŸï¸ Ruta Formativa"], ["asistencia", "âœ… Asistencia"], ["preguntas", `ðŸ’¬ Preguntas (${(data.questions || []).filter((q) => q.status !== "archived").length})`], ["subir", "â¬† Subir resultados"], ["ejercicios", `ðŸ“‹ Ejercicios (${data.exercises.length})`], ["usuarios", `ðŸ‘¥ Usuarios (${(data.users || []).length})`], ["participantes", "ðŸƒ Participantes"], ["alias", "ðŸ‘¤ Nombres y alias"], ["pin", "ðŸ”’ PIN"]].map(([k, t]) => (
          <button key={k} className={`tab ${tab === k ? "tab--on" : ""}`} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      {msg && <div className={`toast ${msg.ok ? "toast--ok" : "toast--err"}`}>{msg.t}</div>}

      {tab === "dashboard" && <AdminDashboard data={data} />}

      {tab === "ruta" && <RouteEditor data={data} persist={persist} busy={busy} />}

      {tab === "roles" && <RoleplayAdmin data={data} persist={persist} busy={busy} />}

      {tab === "asistencia" && <AttendanceAdmin data={data} busy={busy} onSave={saveAttendanceBlock} />}

      {tab === "preguntas" && <QuestionsAdmin data={data} busy={busy} onUpdate={saveQuestionUpdate} />}

      {tab === "subir" && (
        <div className="stack">
          {!parsed ? (
            <>
              <div className="upload-grid">
                <div className="dropzone" onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}>
                  <div className="opt-badge opt-badge--a">OPCIÃ“N A Â· RECOMENDADA</div>
                  <div className="dropzone-icon">ðŸ“Š</div>
                  <div className="dropzone-title">Sube el Excel de Wordwall</div>
                  <div className="dropzone-sub">Trae el detalle por pregunta. Luego podrÃ¡s pegar el detallado si necesitas completar datos.</div>
                  <span className="dropzone-cta">Elegir archivo .xlsx</span>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
                </div>
                <div className="dropzone dropzone--alt" onClick={startFromPaste} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && startFromPaste()}>
                  <div className="opt-badge opt-badge--b">OPCIÃ“N B</div>
                  <div className="dropzone-icon">ðŸ“‹</div>
                  <div className="dropzone-title">Pega solo el detallado</div>
                  <div className="dropzone-sub">Crea el ejercicio pegando la tabla de Wordwall, sin descargar el Excel.</div>
                  <span className="dropzone-cta dropzone-cta--alt">Pegar detallado</span>
                </div>
              </div>
              <div className="upload-hint">
                ðŸ’¡ Â¿El ejercicio ya existe y solo quieres sumar gente nueva? Sube el Excel igual: al reconocer el tÃ­tulo, te ofrecerÃ¡ <b>fusionar</b> con el existente.
              </div>
            </>
          ) : (
            <>
              <div className="card">
                <div className="step"><span className="step-n">1</span> TÃ­tulo del ejercicio</div>
                <input className="inp" value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)} placeholder="Ej. Refuerzo Segunda SesiÃ³n" />
                {!parsed.fromPaste && (
                  <div className="dim" style={{ fontSize: 13, marginTop: 8 }}>
                    {parsed.students.length} participantes Â· {parsed.questions.length} preguntas detectadas en el Excel
                  </div>
                )}
                {mergeMode === "merge" && mergeTarget && (
                  <div className="detect-banner">
                    ðŸ’¡ Ya existe un ejercicio llamado <b>â€œ{data.exercises.find((e) => e.id === mergeTarget)?.title}â€</b>. Abajo puedes fusionar los resultados o crear uno nuevo.
                  </div>
                )}
              </div>

              <div className="card">
                <div className="step">
                  <span className="step-n">2</span>
                  {parsed.fromPaste ? "Pega el detallado de Wordwall" : "(Opcional) Pega el detallado para actualizar datos"}
                </div>
                <textarea
                  className="inp inp--mono"
                  value={lbText}
                  onChange={(e) => setLbText(e.target.value)}
                  rows={6}
                  placeholder={"Copia la tabla desde Wordwall, con este formato:\nAlumno\tEnviado\tPuntuaciÃ³n\tCorrecto\tIncorrecto\nEly\t19:32 - 27 jun. 2026\t1036\t7\t0"}
                />
                {lbParsed.length > 0 && (
                  <div className="preview">
                    {(parsed.fromPaste ? lbParsed.map((e) => ({ ...e, matched: true })) : lbMatch).map((e, i) => (
                      <div key={i} className={e.matched ? "pv-ok" : "pv-bad"}>
                        {e.name} Â· {e.score != null ? `${e.score} pts` : "sin puntuaciÃ³n"} Â· {e.correct}âœ” {e.incorrect}âœ–{" "}
                        {parsed.fromPaste ? "" : e.matched ? "âœ” coincide con el Excel" : "âœ– no coincide con ningÃºn nombre del Excel"}
                      </div>
                    ))}
                    {!parsed.fromPaste && <div className="dim" style={{ marginTop: 4 }}>Los nombres deben escribirse igual que en el Excel para coincidir.</div>}
                  </div>
                )}
              </div>

              {Object.keys(nameMap).length > 0 && (
                <div className="card">
                  <div className="step"><span className="step-n">3</span> Nombres nuevos â€” asÃ³cialos para que el consolidado no duplique personas</div>
                  <div className="stack" style={{ gap: 8 }}>
                    {Object.keys(nameMap).map((k) => {
                      const raw = (parsed.fromPaste ? lbParsed.find((e) => norm(e.name) === k)?.name : parsed.students.find((s) => norm(s.raw) === k)?.raw) || k;
                      return (
                        <div key={k} className="alias-row">
                          <div className="alias-raw">{raw}</div>
                          <span className="dim">â†’</span>
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
                  Â¿Guardar como nuevo o actualizar uno existente?
                </div>
                {data.exercises.length === 0 ? (
                  <div className="dim" style={{ fontSize: 13 }}>Se crearÃ¡ el primer ejercicio.</div>
                ) : (
                  <>
                    <div className="destino-opts">
                      <label className={`radio-card ${mergeMode === "new" ? "radio-card--on" : ""}`}>
                        <input type="radio" checked={mergeMode === "new"} onChange={() => setMergeMode("new")} />
                        <div>
                          <div className="radio-title">ðŸ†• Crear ejercicio nuevo</div>
                          <div className="radio-sub">Aparece como una entrada aparte en la tabla.</div>
                        </div>
                      </label>
                      <label className={`radio-card ${mergeMode === "merge" ? "radio-card--on" : ""}`}>
                        <input type="radio" checked={mergeMode === "merge"} onChange={() => setMergeMode("merge")} />
                        <div>
                          <div className="radio-title">ðŸ”„ Fusionar con uno existente</div>
                          <div className="radio-sub">Agrega los participantes nuevos y actualiza los que mejoraron.</div>
                        </div>
                      </label>
                    </div>
                    {mergeMode === "merge" && (
                      <div style={{ marginTop: 12 }}>
                        <label className="lbl">Ejercicio a actualizar</label>
                        <select className="inp inp--select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                          <option value="">â€” Elige el ejercicio â€”</option>
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
                                  Se agregarÃ¡n: {nuevos.map((s) => s.raw).join(", ")}
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
          <div className="card sync-card">
            <div>
              <div className="ex-title">Sincronizar links de Wordwall</div>
              <div className="dim" style={{ fontSize: 13 }}>
                Intenta actualizar los ejercicios que tienen link de resultados guardado. Si Wordwall bloquea la lectura, usa Excel o pegado rapido.
              </div>
            </div>
            <button className="btn btn--teal-o btn--sm" onClick={syncAllResultLinks} disabled={busy || syncBusy || exercisesWithResultLinks.length === 0}>
              {syncBusy ? "Intentando..." : `Actualizar ${exercisesWithResultLinks.length} link(s)`}
            </button>
          </div>
          {data.exercises.length === 0 && <div className="empty">AÃºn no hay ejercicios. Sube el primero desde "Subir resultados".</div>}
          {data.exercises.map((ex) => (
            <div key={ex.id} className="card ex-card">
              <div>
                <div className="ex-title">{ex.title}</div>
                <div className="dim" style={{ fontSize: 13 }}>
                  {ex.students.length} participantes Â· {(ex.questions || []).length} preguntas Â· aciertos con desempate Wordwall Â· subido {new Date(ex.date).toLocaleDateString("es-PE")}
                </div>
              </div>
              {confirmDelEx === ex.id ? (
                <div className="ex-actions">
                  <span className="dim" style={{ fontSize: 13, alignSelf: "center" }}>Â¿Seguro?</span>
                  <button className="btn btn--danger-o btn--sm" onClick={() => delExercise(ex.id)}>SÃ­, eliminar</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelEx(null)}>Cancelar</button>
                </div>
              ) : (
                <div className="ex-actions">
                  {ex.resultsUrl && <a className="btn btn--ghost btn--sm" href={ex.resultsUrl} target="_blank" rel="noreferrer">Abrir resultados</a>}
                  <button className="btn btn--teal-o btn--sm" onClick={() => setEditing(ex.id)}>âœŽ Editar</button>
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
            AquÃ­ puedes <b>excluir</b> a alguien del podio y del ranking sin borrar sus datos â€” Ãºtil para ti,
            tu partner o expositores que jugaron solo para probar. Los excluidos no aparecen en ninguna tabla,
            pero puedes volver a incluirlos cuando quieras.
          </div>
          {canonicals.length === 0 && <div className="empty">TodavÃ­a no hay participantes. Sube un ejercicio primero.</div>}
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
                  {on ? "â†© Incluir en el podio" : "ðŸš« Excluir del podio"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "alias" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="dim" style={{ fontSize: 13, marginBottom: 4 }}>
            Cada nombre tal como se escribiÃ³ en Wordwall (izquierda) apunta a la persona real (derecha). Edita el nombre real y guarda para corregir duplicados.
          </div>
          {Object.keys(data.aliases).length === 0 && <div className="empty">TodavÃ­a no hay nombres registrados.</div>}
          {Object.entries(data.aliases).map(([k, v]) => (
            <div key={k} className="alias-row">
              <div className="alias-raw dim">{k}</div>
              <span className="dim">â†’</span>
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
          <div className="step" style={{ marginBottom: 8 }}>Cambiar PIN de administraciÃ³n</div>
          <input className="inp" value={pin1} onChange={(e) => setPin1(e.target.value)} placeholder="Nuevo PIN (mÃ­nimo 4 caracteres)" />
          <button className="btn btn--gold" style={{ marginTop: 12 }} onClick={changePin} disabled={busy}>Actualizar PIN</button>
          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            Nota: esta protecciÃ³n evita cambios accidentales, pero los datos del podio son visibles para cualquiera que tenga el enlace.
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
      <div className="pin-lock">ðŸ”</div>
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
  const icon = r.type === "game" ? "ðŸŽ®" : "â–¶ï¸";
  const cls = r.type === "game" ? "res-btn res-btn--game" : "res-btn res-btn--video";
  if (r.type === "game" && r.url) {
    return (
      <a className={cls} href={r.url} target="_blank" rel="noreferrer">
        <span className="res-ic">{icon}</span>
        <span className="res-txt">
          <span className="res-label">{r.label || "Juego Wordwall"}</span>
          {r.slide ? <span className="res-slide">LÃ¡mina {r.slide}</span> : null}
        </span>
      </a>
    );
  }
  return (
    <button className={cls} onClick={() => onOpen(r)}>
      <span className="res-ic">{icon}</span>
      <span className="res-txt">
        <span className="res-label">{r.label || (r.type === "game" ? "Juego Wordwall" : "Video")}</span>
        {r.slide ? <span className="res-slide">LÃ¡mina {r.slide}</span> : null}
      </span>
    </button>
  );
}

function RouteField({ data, muted, sessionUser, onToggleBlockProgress, onOpenBlock, onAudioProgress, progressBusy }) {
  const [viewer, setViewer] = useState(null); // {type,url,label}
  const [openBlock, setOpenBlock] = useState(null);
  const route = data.route || emptyRoute();
  const blocks = route?.blocks || [];
  const routeStats = routeProgressStats(data, sessionUser);
  const gatedBlocks = unlockedRouteBlocks(data, sessionUser);

  if (!blocks.length) {
    return (
      <div className="empty" style={{ padding: "70px 20px" }}>
        <div style={{ fontSize: 42 }}>âš½</div>
        <div style={{ marginTop: 10 }}>La ruta formativa aÃºn no tiene bloques.<br />Entra al panel de administraciÃ³n para armarla.</div>
      </div>
    );
  }

  return (
    <div className="route">
      <div className="route-intro">
        <span className="route-kick">âš½</span>
        <div>
          <div className="route-title">{route.title || "Ruta de PreparaciÃ³n"}</div>
          <div className="route-sub">Avanza bloque por bloque Â· el Ãºltimo es <b>Â¡GOL!</b></div>
        </div>
      </div>

      <div className="route-progress">
        <div className="route-progress-head">
          <span>Tu avance</span>
          <b>{routeStats.completed}/{routeStats.total} bloques Â· {routeStats.percent}%</b>
        </div>
        <span className="route-progress-bar"><i style={{ width: `${routeStats.percent}%` }} /></span>
      </div>

      <div className="pitch-path">
        <div className="path-line" aria-hidden />
        {gatedBlocks.map(({ block: b, unlocked, adminLocked, status }, i) => {
          const isLast = i === blocks.length - 1;
          const side = i % 2 === 0 ? "left" : "right";
          const resCount = (b.resources || []).length;
          const locked = adminLocked || !unlocked;
          const done = !locked && status.completed;
          return (
            <div key={b.id} className={`station station--${side} ${isLast ? "station--goal" : ""} ${locked ? "station--locked" : ""} ${done ? "station--done" : ""}`}>
              <div className="station-node">
                <span className="station-num">{locked ? "ðŸ”’" : done ? "âœ“" : isLast ? "ðŸ¥…" : i + 1}</span>
              </div>
              <button
                className="station-card"
                onClick={() => {
                  if (locked) return;
                  setOpenBlock(b);
                  onOpenBlock?.(b.id);
                }}
                disabled={locked}
                aria-disabled={locked}
              >
                <div className="station-head">
                  <span className="station-tag">{locked ? "ðŸ”’ BLOQUEADO" : isLast ? "Â¡GOL! Â· BLOQUE FINAL" : `BLOQUE ${i + 1}`}</span>
                  {!locked && (b.pptUrl || resCount > 0) && (
                    <span className="station-meta">
                      {b.pptUrl ? "ðŸ“Š" : ""}{resCount ? ` ${resCount} recurso${resCount === 1 ? "" : "s"}` : ""}
                    </span>
                  )}
                </div>
                <div className="station-title">{b.title || `Bloque ${i + 1}`}</div>
                {b.subtitle && !locked ? <div className="station-desc">{b.subtitle}</div> : null}
                <span className="station-cta">{locked ? (adminLocked ? "Disponible pronto ðŸ”’" : "Completa el bloque anterior ðŸ”’") : done ? "Completado âœ“" : "Abrir bloque â†’"}</span>
              </button>
            </div>
          );
        })}
        <div className="goal-net" aria-hidden>
          <div className="goal-post" />
          <div className="goal-label">âš½ Â¡METISTE GOL! Completaste la ruta ðŸŽ‰</div>
        </div>
      </div>

      {openBlock && (
        <BlockModal
          block={openBlock}
          status={blockLearningStatus(data, sessionUser, openBlock)}
          progressBusy={progressBusy}
          onToggleComplete={(completed) => onToggleBlockProgress(openBlock.id, completed)}
          onAudioProgress={(percent, completed) => onAudioProgress(openBlock.id, percent, completed)}
          onClose={() => setOpenBlock(null)}
          onOpenResource={(r) => setViewer(r)}
        />
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
        <iframe title="PresentaciÃ³n" src={embedUrl} allowFullScreen frameBorder="0" onLoad={() => { setLoaded(true); setFailed(false); }} />
        {failed && (
          <div className="viewer-fallback">
            <div className="vf-ic">ðŸ“Š</div>
            <div className="vf-title">La presentaciÃ³n se abre en pestaÃ±a nueva</div>
            <div className="vf-sub">No se pudo mostrar aquÃ­ dentro. TÃ³cala para verla completa:</div>
            <a className="btn btn--gold btn--lg" href={originalUrl} target="_blank" rel="noreferrer">Abrir presentaciÃ³n â†—</a>
          </div>
        )}
      </div>
      <a className="btn btn--gold ppt-open-btn" href={originalUrl} target="_blank" rel="noreferrer">ðŸ“Š Abrir presentaciÃ³n en pestaÃ±a nueva â†—</a>
    </div>
  );
}

function BlockAudio({ url, percent, completed, onAudioProgress }) {
  const [localPercent, setLocalPercent] = useState(percent || 0);
  const reported = useRef(completed);
  const src = directAudioUrl(url);
  useEffect(() => { setLocalPercent(percent || 0); reported.current = completed; }, [percent, completed]);
  if (!url) return null;
  return (
    <div className={`audio-card ${completed ? "audio-card--done" : ""}`}>
      <div className="audio-head">
        <div>
          <div className="audio-title">Audio de acompaÃ±amiento</div>
          <div className="dim">{completed ? "Escuchado" : `Se marca escuchado al llegar al ${AUDIO_COMPLETE_PCT}%`}</div>
        </div>
        <b>{Math.max(localPercent, percent || 0)}%</b>
      </div>
      <audio
        controls
        src={src}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (!a.duration || !Number.isFinite(a.duration)) return;
          const next = Math.min(100, Math.round((a.currentTime / a.duration) * 100));
          setLocalPercent(next);
          if (next >= AUDIO_COMPLETE_PCT && !reported.current) {
            reported.current = true;
            onAudioProgress(next, true);
          }
        }}
        onEnded={() => {
          setLocalPercent(100);
          if (!reported.current) {
            reported.current = true;
            onAudioProgress(100, true);
          }
        }}
      />
      <span className="route-progress-bar"><i style={{ width: `${Math.max(localPercent, percent || 0)}%` }} /></span>
    </div>
  );
}

function BlockModal({ block, status, progressBusy, onToggleComplete, onAudioProgress, onClose, onOpenResource }) {
  const games = (block.resources || []).filter((r) => r.type === "game");
  const videos = (block.resources || []).filter((r) => r.type === "video");
  const pptEmbed = toEmbedUrl(block.pptUrl);
  const isCompleted = !!status.completed;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-row">
            <span className="block-badge">âš½</span>
            <div className="modal-title">{block.title || "Bloque"}</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar âœ•</button>
        </div>
        {block.subtitle ? <div className="dim" style={{ marginBottom: 14 }}>{block.subtitle}</div> : null}

        {pptEmbed ? (
          <PptFrame embedUrl={pptEmbed} originalUrl={block.pptUrl} />
        ) : (
          <div className="ppt-empty">Este bloque no tiene presentaciÃ³n asignada.</div>
        )}

        {block.audioUrl && (
          <BlockAudio
            url={block.audioUrl}
            percent={status.row?.audioPercent || 0}
            completed={status.audioOk}
            onAudioProgress={onAudioProgress}
          />
        )}

        {status.attended && (
          <div className="attendance-note">Asistencia registrada: el audio queda como repaso opcional. Los juegos siguen siendo obligatorios y deben aprobarse con 80%.</div>
        )}

        {status.requiredGames.length > 0 && (
          <div className="requirements-card">
            <div className="requirements-title">Juegos requeridos para aprobar</div>
            {status.requiredGames.map((g, idx) => (
              <div key={idx} className="requirement-row">
                <span>{g.title}</span>
                <b className={g.passed ? "t-teal" : "t-red"}>
                  {!g.linked ? "Falta vincular resultado" : g.played ? `${g.percent}% / meta ${g.passing}%` : `Pendiente / meta ${g.passing}%`}
                </b>
              </div>
            ))}
          </div>
        )}

        <div className={`block-progress-card ${isCompleted ? "block-progress-card--done" : ""}`}>
          <div>
            <div className="block-progress-title">{isCompleted ? "Bloque completado" : "Avance del bloque"}</div>
            <div className="dim" style={{ fontSize: 13 }}>
              {isCompleted
                ? "Este bloque ya cuenta en tu ruta formativa."
                : status.requirementsMet
                  ? "Ya cumples los requisitos. Registra el cierre para desbloquear el siguiente bloque."
                  : `AÃºn falta: ${status.missing.join(", ")}`}
            </div>
          </div>
          <button
            className={isCompleted ? "btn btn--ghost btn--sm" : "btn btn--teal btn--sm"}
            onClick={() => onToggleComplete(!isCompleted)}
            disabled={progressBusy || (!isCompleted && !status.requirementsMet)}
          >
            {isCompleted ? "Marcar como pendiente" : "Marcar bloque como completado"}
          </button>
        </div>

        {games.length > 0 && (
          <div className="res-group">
            <div className="res-group-title">ðŸŽ® Juegos de Wordwall</div>
            <div className="res-list">
              {games.map((r) => <ResourceButton key={r.id} r={r} onOpen={onOpenResource} />)}
            </div>
          </div>
        )}
        {videos.length > 0 && (
          <div className="res-group">
            <div className="res-group-title">â–¶ï¸ Videos</div>
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
  const src = isVideo ? youtubeEmbed(resource.url) : wordwallEmbedUrl(resource.embedUrl || resource.url) || resource.url;
  const label = resource.label || (isVideo ? "Video" : "Juego Wordwall");
  const openUrl = resource.url || wordwallEmbedUrl(resource.embedUrl);

  return (
    <div className="overlay overlay--dark" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div className="viewer-title">
            {isVideo ? "â–¶ï¸" : "ðŸŽ®"} {label}
            {resource.slide ? <span className="dim"> Â· LÃ¡mina {resource.slide}</span> : null}
          </div>
          <div className="viewer-actions">
            <a className="btn btn--gold btn--sm" href={openUrl} target="_blank" rel="noreferrer">Abrir en pestaÃ±a â†—</a>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar âœ•</button>
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
        <a className="btn btn--gold viewer-open-btn" href={openUrl} target="_blank" rel="noreferrer">
          {isVideo ? "â–¶ï¸" : "ðŸŽ®"} Abrir {label} en pestaÃ±a nueva â†—
        </a>
        <div className="viewer-note dim">
          ðŸ’¡ Si no ves el contenido arriba, usa el botÃ³n dorado. Algunos sitios (como Wordwall) no permiten mostrarse dentro de otras pÃ¡ginas por seguridad.
        </div>
      </div>
    </div>
  );
}

function RoleAudioPlayer({ resource, roleKey, onUse }) {
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState(resource.url ? "idle" : "missing");
  const [error, setError] = useState("");
  const reported = useRef({});
  const title = resource.label || "Audio";
  const rawUrl = String(resource.url || "").trim();
  const src = directAudioUrl(rawUrl);
  const openUrl = drivePreviewUrl(rawUrl);
  const downloadExt = (rawUrl.match(/\.(mp3|m4a|wav|ogg|aac|opus)(?:[?#]|$)/i)?.[1] || "mp3").toLowerCase();
  const downloadName = `${String(title || "audio").replace(/[^a-zA-Z0-9._-]+/g, "_") || "audio"}.${downloadExt}`;
  const report = (eventType) => {
    const key = `${resource.id}-${eventType}`;
    if (reported.current[key]) return;
    reported.current[key] = true;
    onUse(roleKey, resource.id, eventType);
  };

  if (!src) {
    return (
      <div className="role-audio role-audio--error">
        <div className="role-audio-title">Audio sin archivo</div>
        <div className="role-audio-help">El administrador debe subir un audio o pegar un link vÃ¡lido.</div>
      </div>
    );
  }

  return (
    <div className={`role-audio role-audio--${state}`}>
      <div className="role-audio-head">
        <div>
          <div className="role-audio-title">{title}</div>
          <div className="role-audio-help">
            {state === "error"
              ? error || "No se pudo reproducir este audio en el navegador."
              : state === "playing"
                ? "Reproduciendo"
                : state === "ready"
                  ? "Listo para escuchar"
                  : "Cargando audio"}
          </div>
        </div>
        <b>{progress}%</b>
      </div>
      <audio
        controls
        preload="metadata"
        src={src}
        onLoadedMetadata={() => setState("ready")}
        onPlay={() => { setState("playing"); report("play"); }}
        onPause={() => setState((prev) => prev === "playing" ? "ready" : prev)}
        onEnded={() => { setProgress(100); setState("ready"); report("complete"); }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (!a.duration || !Number.isFinite(a.duration)) return;
          setProgress(Math.min(100, Math.round((a.currentTime / a.duration) * 100)));
        }}
        onError={() => {
          setState("error");
          setError("El archivo no cargÃ³. Prueba abrirlo en otra pestaÃ±a o vuelve a subirlo desde administraciÃ³n.");
        }}
      />
      <span className="route-progress-bar"><i style={{ width: `${progress}%` }} /></span>
      <div className="role-audio-actions">
        <a className="btn btn--teal-o btn--sm" href={src} target="_blank" rel="noreferrer" download={downloadName} onClick={() => report("download")}>
          Descargar audio
        </a>
        <a className="btn btn--ghost btn--sm" href={openUrl || src} target="_blank" rel="noreferrer" onClick={() => report("open")}>
          Abrir audio
        </a>
      </div>
    </div>
  );
}

function RoleplayHub({ data, setData, sessionUser }) {
  const roleplay = useMemo(() => normalizeRoleplay(data.roleplay), [data.roleplay]);
  const [selectedRole, setSelectedRole] = useState(() => readStore(STORE.roleplayRole, "asesor"));
  const [joinCode, setJoinCode] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(() => readStore(STORE.roleplaySession, ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [recorded, setRecorded] = useState({});
  const [hiddenSessionIds, setHiddenSessionIds] = useState(() => readStoreJson(STORE.roleplayHidden, []));
  const mySessions = useMemo(() => (data.roleplaySessions || []).filter((s) => sessionHasUser(s, sessionUser)), [data.roleplaySessions, sessionUser]);
  const activePracticeSessions = useMemo(() =>
    mySessions.filter((s) => s.status !== "closed" && !hiddenSessionIds.includes(s.id)),
  [mySessions, hiddenSessionIds]);
  const currentSession = activePracticeSessions.find((s) => s.id === activeSessionId) || activePracticeSessions[0] || null;

  useEffect(() => {
    if (!activeSessionId && activePracticeSessions[0]) setActiveSessionId(activePracticeSessions[0].id);
    if (activeSessionId && !activePracticeSessions.some((s) => s.id === activeSessionId)) setActiveSessionId(activePracticeSessions[0]?.id || "");
  }, [activePracticeSessions, activeSessionId]);
  useEffect(() => { writeStore(STORE.roleplayRole, selectedRole); }, [selectedRole]);
  useEffect(() => { writeStore(STORE.roleplaySession, activeSessionId); }, [activeSessionId]);
  useEffect(() => { writeStoreJson(STORE.roleplayHidden, hiddenSessionIds); }, [hiddenSessionIds]);

  const recordUse = async (roleKey, resourceId, eventType = "open", sessionId = "") => {
    const localKey = `${roleKey}-${resourceId}-${eventType}-${sessionId}`;
    if (recorded[localKey]) return;
    setRecorded((prev) => ({ ...prev, [localKey]: true }));
    try {
      const saved = await recordRoleplayEvent(sessionUser, roleKey, resourceId, eventType, sessionId);
      setData((prev) => upsertLocalRoleplayEvent(prev, saved));
    } catch (e) {
      console.warn("roleplay event:", e);
    }
  };
  const hasResourceEvent = (roleKey, resourceId, eventTypes = []) => {
    const types = eventTypes.length ? eventTypes : ["open"];
    return (data.roleplayEvents || []).some((e) =>
      e.userId === sessionUser?.id &&
      e.roleType === roleKey &&
      e.resourceId === resourceId &&
      types.includes(e.eventType)
    );
  };
  const createSession = async () => {
    setBusy(true);
    setMsg("");
    try {
      const now = new Date().toISOString();
      const saved = await saveRoleplaySession({
        id: uid(),
        code: makeJoinCode(),
        roleType: "asesor",
        ownerUserId: sessionUser.id,
        ownerName: sessionUser.name,
        status: "open",
        participants: [{
          userId: sessionUser.id,
          userName: sessionUser.name,
          assignedRoleId: "asesor",
          assignedRole: "Asesor",
          guide: "Facilita la prÃ¡ctica y acompaÃ±a a quienes interpretan los casos.",
          isFacilitator: true,
          joinedAt: now,
        }],
      });
      setData((prev) => upsertLocalRoleplaySession(prev, saved));
      setActiveSessionId(saved.id);
      setSelectedRole("asesor");
      setMsg(`SesiÃ³n creada. Comparte el cÃ³digo ${saved.code}.`);
    } catch {
      setMsg("No se pudo crear la sesiÃ³n. Revisa que la tabla roleplay_sessions exista en Supabase.");
    } finally {
      setBusy(false);
    }
  };
  const joinSession = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setMsg("");
    try {
      const rows = await sbFetch(`roleplay_sessions?code=eq.${encodeURIComponent(code)}&select=*`);
      const found = mapRoleplaySessions(rows)[0];
      if (!found) {
        setMsg("No encontramos una sesiÃ³n con ese cÃ³digo.");
        return;
      }
      if (found.status === "closed") {
        setMsg("Esa sesiÃ³n ya estÃ¡ cerrada.");
        return;
      }
      let next = found;
      if (!sessionHasUser(found, sessionUser)) {
        const assigned = nextAscosType(found.participants || [], roleplay.participantTypes);
        next = {
          ...found,
          participants: [...(found.participants || []), {
            userId: sessionUser.id,
            userName: sessionUser.name,
            assignedRoleId: assigned.id,
            assignedRole: assigned.name,
            guide: assigned.guide || "",
            isFacilitator: false,
            joinedAt: new Date().toISOString(),
          }],
        };
        next = await saveRoleplaySession(next);
      }
      setData((prev) => upsertLocalRoleplaySession(prev, next));
      setActiveSessionId(next.id);
      setSelectedRole("asesor");
      setJoinCode("");
      setMsg("Te uniste a la sesiÃ³n. Revisa el rol que te tocÃ³.");
    } catch {
      setMsg("No se pudo unir a la sesiÃ³n. Revisa tu conexiÃ³n e intÃ©ntalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };
  const closeSession = async (session) => {
    if (session.ownerUserId !== sessionUser.id) {
      setMsg("Solo quien creÃ³ la prÃ¡ctica puede finalizarla.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const saved = await saveRoleplaySession({ ...session, status: "closed" });
      setData((prev) => upsertLocalRoleplaySession(prev, saved));
      setHiddenSessionIds((prev) => prev.includes(saved.id) ? prev : [...prev, saved.id]);
      setActiveSessionId("");
      setMsg("SesiÃ³n cerrada.");
    } catch {
      setMsg("No se pudo cerrar la sesiÃ³n.");
    } finally {
      setBusy(false);
    }
  };
  const renderResources = (roleKey) => {
    const resources = roleplay[roleKey]?.resources || [];
    if (!resources.length) return <div className="empty empty--compact">TodavÃ­a no hay recursos asignados para este rol.</div>;
    return (
      <div className="role-resource-cards">
        {resources.map((r) => {
          const reviewed = r.type === "materials" && hasResourceEvent(roleKey, r.id, ["review"]);
          const opened = r.type !== "materials" && hasResourceEvent(roleKey, r.id, ["open", "play", "complete"]);
          return (
          <div key={r.id} className={`card role-user-resource role-user-resource--${r.type} ${reviewed || opened ? "role-user-resource--done" : ""}`}>
            <div>
              <div className="role-resource-type">{r.type === "audio" ? "Audio" : r.type === "file" ? "PDF" : r.type === "html" ? "Juego HTML" : r.type === "materials" ? "Materiales" : "Wordwall"}</div>
              <div className="role-resource-title">{r.label || "Recurso"}</div>
              {r.time && <div className="role-resource-time">{r.time}</div>}
              {r.materials && <div className="dim" style={{ fontSize: 13 }}>{r.materials}</div>}
              {r.note && <div className="dim" style={{ fontSize: 13 }}>{r.note}</div>}
              {(reviewed || opened) && <div className="role-resource-status">Registrado</div>}
            </div>
            {r.type === "audio" ? (
              <RoleAudioPlayer resource={r} roleKey={roleKey} onUse={recordUse} />
            ) : r.type === "materials" ? (
              <button className={reviewed ? "btn btn--ghost btn--sm" : "btn btn--teal-o btn--sm"} onClick={() => recordUse(roleKey, r.id, "review")} disabled={reviewed}>
                {reviewed ? "Revisado" : "Marcar como revisado"}
              </button>
            ) : (
              <a className="btn btn--gold btn--sm" href={r.url} target="_blank" rel="noreferrer" onClick={() => recordUse(roleKey, r.id, "open")}>
                Abrir
              </a>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="roleplay-hub">
      <div className="card roleplay-hero">
        <div>
          <div className="dash-eyebrow">PreparaciÃ³n prÃ¡ctica</div>
          <div className="dash-title">Juego de roles</div>
          <div className="dim">Elige tu rol para practicar con sesiones, juegos o materiales asignados por el equipo.</div>
        </div>
        <div className="join-box">
          <input className="inp inp--sm" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && joinSession()} placeholder="CÃ³digo de sesiÃ³n" />
          <button className="btn btn--teal-o btn--sm" onClick={joinSession} disabled={busy || !joinCode.trim()}>Unirme</button>
        </div>
      </div>
      {msg && <div className="toast toast--ok">{msg}</div>}

      <div className="role-selector">
        {ROLEPLAY_ROLES.map((role) => (
          <button key={role.key} className={`role-select-card ${selectedRole === role.key ? "role-select-card--on" : ""}`} onClick={() => setSelectedRole(role.key)}>
            <b>{role.label}</b>
            <span>{role.hint}</span>
          </button>
        ))}
      </div>

      {selectedRole === "asesor" ? (
        <div className="roleplay-grid">
          <div className="card role-session-panel">
            <div className="dash-panel-head">
              <div>
                <div className="dash-panel-title">SesiÃ³n de prÃ¡ctica</div>
                <div className="dim">Crea una sesiÃ³n y comparte el cÃ³digo. TÃº quedas como asesor; quienes entren reciben un caso del manual.</div>
              </div>
              <button className="btn btn--gold btn--sm" onClick={createSession} disabled={busy}>Crear sesiÃ³n</button>
            </div>
            {currentSession ? (
              <>
                <div className="session-code-box">
                  <span>CÃ³digo</span>
                  <b>{currentSession.code}</b>
                  <button className="btn btn--ghost btn--sm" onClick={() => navigator.clipboard?.writeText(currentSession.code)}>Copiar</button>
                </div>
                <div className="session-people">
                  {(currentSession.participants || []).map((p) => (
                    <div key={p.userId || p.userName} className={`session-person ${p.userId === sessionUser.id ? "session-person--me" : ""}`}>
                      <span className="avatar avatar--xs">{initials(p.userName || "?")}</span>
                      <span>
                        <b>{p.userName}</b>
                        <small>{p.assignedRole}{p.guide ? ` Â· ${p.guide}` : ""}</small>
                      </span>
                    </div>
                  ))}
                </div>
                {currentSession.ownerUserId === sessionUser.id && currentSession.status !== "closed" && (
                  <button className="btn btn--danger-o btn--sm" onClick={() => closeSession(currentSession)} disabled={busy}>
                    {busy ? "Finalizando..." : "Finalizar prÃ¡ctica"}
                  </button>
                )}
                {false && currentSession.ownerUserId === sessionUser.id && currentSession.status !== "closed" && (
                  <button className="btn btn--ghost btn--sm" onClick={() => closeSession(currentSession)} disabled={busy}>Cerrar sesiÃ³n</button>
                )}
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setHiddenSessionIds((prev) => prev.includes(currentSession.id) ? prev : [...prev, currentSession.id]);
                    setActiveSessionId("");
                    setMsg("Saliste de esta prÃ¡ctica en tu pantalla.");
                  }}
                  disabled={busy}
                >
                  Salir de esta prÃ¡ctica
                </button>
              </>
            ) : (
              <div className="empty empty--compact">AÃºn no tienes una sesiÃ³n activa. Crea una o Ãºnete con un cÃ³digo.</div>
            )}
          </div>

          <div className="card role-session-panel">
            <div className="dash-panel-title">Casos disponibles</div>
            <div className="ascos-mini-list">
              {roleplay.participantTypes.map((t) => (
                <div key={t.id} className="ascos-mini-item">
                  <b>{t.name}</b>
                  <span>{t.guide}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="card role-resource-panel">
          <div className="dash-panel-head">
            <div>
              <div className="dash-panel-title">{roleLabel(selectedRole)}</div>
              <div className="dim">{selectedRole === "coordinador" ? "Materiales para consultar antes y durante el retiro." : "Juegos prÃ¡cticos asignados por administraciÃ³n."}</div>
            </div>
          </div>
          {selectedRole === "coordinador" && (
            <div className="role-journey-strip">
              <span><b>1</b> Revisa PDFs</span>
              <span><b>2</b> Escucha audios</span>
              <span><b>3</b> Usa abrir audio si el navegador bloquea la reproducciÃ³n</span>
            </div>
          )}
          {selectedRole === "apoyo_interno" && (
            <div className="role-journey-strip">
              <span><b>1</b> Ubica el momento</span>
              <span><b>2</b> Prepara materiales</span>
              <span><b>3</b> Marca revisado</span>
            </div>
          )}
          {renderResources(selectedRole)}
        </div>
      )}
    </div>
  );
}

/* ================= AutenticaciÃ³n de participantes ================= */
function PasswordInput({ value, onChange, placeholder, onEnter, className }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pass-wrap">
      <input
        className={`inp pass-inp ${className || ""}`}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      />
      <button
        type="button"
        className="pass-toggle"
        onClick={() => setShow((s) => !s)}
        title={show ? "Ocultar clave" : "Mostrar clave"}
        aria-label={show ? "Ocultar clave" : "Mostrar clave"}
      >
        {show ? "ðŸ™ˆ" : "ðŸ‘ï¸"}
      </button>
    </div>
  );
}

function AuthScreen({ data, setData, onLogin }) {
  const [tab, setTab] = useState("login"); // login | register | forgot
  const users = data.users || [];

  // login state
  const [lName, setLName] = useState("");
  const [lPass, setLPass] = useState("");
  const [lErr, setLErr] = useState(null);

  // register state
  const [rName, setRName] = useState("");
  const [rEmail, setREmail] = useState("");
  const [rPass, setRPass] = useState("");
  const [rPass2, setRPass2] = useState("");
  const [rBirth, setRBirth] = useState("");
  const [rRetreat, setRRetreat] = useState("");
  const [rExpect, setRExpect] = useState("");
  const [rPhrase, setRPhrase] = useState("");
  const [rErr, setRErr] = useState(null);
  const [fEmail, setFEmail] = useState("");
  const [fName, setFName] = useState("");
  const [fPhrase, setFPhrase] = useState("");
  const [fPass, setFPass] = useState("");
  const [fPass2, setFPass2] = useState("");
  const [fErr, setFErr] = useState(null);
  const [fOk, setFOk] = useState(null);
  const [busy, setBusy] = useState(false);

  const doLogin = () => {
    setLErr(null);
    const loginValue = lName.trim();
    const emailValue = normEmail(loginValue);
    const u = users.find((x) => norm(x.name) === norm(loginValue) || (emailValue && normEmail(x.email) === emailValue));
    if (!u) { setLErr("No encontramos ese perfil. Puedes entrar con tu nombre o correo registrado."); return; }
    if (u.passHash !== lightHash(lPass)) { setLErr("La clave no coincide."); return; }
    onLogin(u.id);
  };

  const doRegister = async () => {
    setRErr(null);
    if (rName.trim().length < 3) { setRErr("Escribe tu nombre y apellido."); return; }
    if (!isValidEmail(rEmail)) { setRErr("Escribe un correo vÃ¡lido."); return; }
    if (users.some((x) => norm(x.name) === norm(rName))) { setRErr("Ya existe alguien con ese nombre. Si eres tÃº, inicia sesiÃ³n."); return; }
    if (users.some((x) => normEmail(x.email) === normEmail(rEmail))) { setRErr("Ya existe un perfil con ese correo. Si eres tÃº, inicia sesiÃ³n o recupera tu clave."); return; }
    if (rPass.length < 4) { setRErr("La clave debe tener al menos 4 caracteres."); return; }
    if (rPass !== rPass2) { setRErr("Las claves no coinciden."); return; }
    if (!hasMeaningfulAnswer(rRetreat)) { setRErr("Escribe una fecha o referencia real de cuÃ¡ndo viviste tu retiro EJE."); return; }
    if (phraseKey(rPhrase) !== ACCESS_PHRASE_KEY) { setRErr("La frase de acceso no coincide."); return; }
    setBusy(true);
    const u = {
      id: uid(),
      name: rName.trim(),
      email: normEmail(rEmail),
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
      setRErr("No se pudo guardar tu registro. IntÃ©ntalo de nuevo.");
      setBusy(false);
    }
  };

  const doReset = async () => {
    setFErr(null);
    setFOk(null);
    const email = normEmail(fEmail);
    const nameValue = fName.trim();
    if (!nameValue) { setFErr("Escribe tu usuario original (el nombre con el que te registraste)."); return; }
    if (!isValidEmail(email)) { setFErr("Escribe el correo con el que creaste tu perfil."); return; }
    const u = users.find((x) => normEmail(x.email) === email);
    if (!u) { setFErr("No encontramos un perfil con ese correo. Pide apoyo al administrador."); return; }
    if (norm(u.name) !== norm(nameValue)) { setFErr("El usuario no coincide con ese correo. Escribe el nombre exacto con el que te registraste."); return; }
    if (phraseKey(fPhrase) !== ACCESS_PHRASE_KEY) { setFErr("La frase de acceso no coincide."); return; }
    if (fPass.length < 4) { setFErr("La nueva clave debe tener al menos 4 caracteres."); return; }
    if (fPass !== fPass2) { setFErr("Las claves no coinciden."); return; }
    setBusy(true);
    try {
      const next = { ...data, users: users.map((x) => (x.id === u.id ? { ...x, passHash: lightHash(fPass) } : x)) };
      await saveData(next, data);
      setData(next);
      setFOk("Clave actualizada. Ya puedes iniciar sesiÃ³n con tu nueva clave.");
      setLName(u.email || u.name);
      setLPass("");
      setFEmail("");
      setFName("");
      setFPhrase("");
      setFPass("");
      setFPass2("");
      setTab("login");
    } catch {
      setFErr("No se pudo actualizar la clave. IntÃ©ntalo otra vez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-tabs">
          <button className={`auth-tab ${tab === "login" ? "auth-tab--on" : ""}`} onClick={() => setTab("login")}>Iniciar sesiÃ³n</button>
          <button className={`auth-tab ${tab === "register" ? "auth-tab--on" : ""}`} onClick={() => setTab("register")}>Crear mi perfil</button>
        </div>

        {tab === "forgot" ? (
          <div className="auth-body">
            <label className="lbl">Usuario original (tu nombre registrado)</label>
            <input className="inp" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Nombre y apellido con el que te registraste" />
            <label className="lbl" style={{ marginTop: 10 }}>Correo registrado</label>
            <input className="inp" type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="tu.correo@email.com" />
            <label className="lbl" style={{ marginTop: 10 }}>Frase de acceso</label>
            <input className="inp" value={fPhrase} onChange={(e) => setFPhrase(e.target.value)} placeholder="Firmes en la fe sobre la roca" />
            <div className="auth-grid" style={{ marginTop: 10 }}>
              <div>
                <label className="lbl">Nueva clave</label>
                <PasswordInput value={fPass} onChange={setFPass} placeholder="MÃ­nimo 4 caracteres" />
              </div>
              <div>
                <label className="lbl">Repite la nueva clave</label>
                <PasswordInput value={fPass2} onChange={setFPass2} placeholder="â€¢â€¢â€¢â€¢" onEnter={doReset} />
              </div>
            </div>
            {fErr && <div className="auth-err">{fErr}</div>}
            {fOk && <div className="ok-inline">{fOk}</div>}
            <button className="btn btn--gold" style={{ marginTop: 14, width: "100%", justifyContent: "center" }} onClick={doReset} disabled={busy}>Actualizar clave</button>
            <button className="btn btn--ghost btn--sm auth-link-btn" onClick={() => setTab("login")}>Volver a iniciar sesiÃ³n</button>
          </div>
        ) : tab === "login" ? (
          <div className="auth-body">
            <label className="lbl">Nombre, apellido o correo</label>
            <input className="inp" value={lName} onChange={(e) => setLName(e.target.value)} placeholder="Como te registraste" onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            <label className="lbl" style={{ marginTop: 10 }}>Tu clave</label>
            <PasswordInput value={lPass} onChange={setLPass} placeholder="â€¢â€¢â€¢â€¢" onEnter={doLogin} />
            {lErr && <div className="auth-err">{lErr}</div>}
            {fOk && <div className="ok-inline">{fOk}</div>}
            <button className="btn btn--gold" style={{ marginTop: 14, width: "100%", justifyContent: "center" }} onClick={doLogin}>Entrar âš½</button>
            <button className="btn btn--ghost btn--sm auth-link-btn" onClick={() => setTab("forgot")}>OlvidÃ© mi clave</button>
          </div>
        ) : (
          <div className="auth-body">
            <label className="lbl">Nombre y apellido *</label>
            <input className="inp" value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Ej. MarÃ­a Fernanda Rojas" />
            <label className="lbl" style={{ marginTop: 10 }}>Correo *</label>
            <input className="inp" type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} placeholder="tu.correo@email.com" />

            <div className="auth-grid">
              <div>
                <label className="lbl">Fecha de nacimiento</label>
                <input className="inp" type="date" value={rBirth} onChange={(e) => setRBirth(e.target.value)} />
              </div>
              <div>
                <label className="lbl">Â¿CuÃ¡ndo viviste tu retiro EJE? *</label>
                <input className="inp" value={rRetreat} onChange={(e) => setRRetreat(e.target.value)} placeholder="Ej. Noviembre 2023" />
                <div className="auth-hint">Debe ser una fecha o referencia real, no solo puntos o guiones.</div>
              </div>
            </div>

            <label className="lbl" style={{ marginTop: 10 }}>Â¿QuÃ© expectativas tienes sobre el retiro?</label>
            <textarea className="inp" rows={3} value={rExpect} onChange={(e) => setRExpect(e.target.value)} placeholder="CuÃ©ntanos quÃ© esperas de esta experienciaâ€¦" />

            <label className="lbl" style={{ marginTop: 10 }}>Frase de acceso *</label>
            <input className="inp" value={rPhrase} onChange={(e) => setRPhrase(e.target.value)} placeholder="Escribela como la recibiste" />
            <div className="auth-hint">No importan mayusculas, minusculas ni tildes.</div>

            <div className="auth-grid" style={{ marginTop: 10 }}>
              <div>
                <label className="lbl">Crea una clave *</label>
                <PasswordInput value={rPass} onChange={setRPass} placeholder="MÃ­nimo 4 caracteres" />
              </div>
              <div>
                <label className="lbl">Repite la clave *</label>
                <PasswordInput value={rPass2} onChange={setRPass2} placeholder="â€¢â€¢â€¢â€¢" />
              </div>
            </div>

            {rErr && <div className="auth-err">{rErr}</div>}
            <div className="auth-privacy">
              ðŸ”’ Tus datos se guardan en esta aplicaciÃ³n para tu preparaciÃ³n. No uses una clave que uses en otros sitios: este espacio es seguro para el equipo, pero no es un banco.
            </div>
            <button className="btn btn--gold" style={{ marginTop: 12, width: "100%", justifyContent: "center" }} onClick={doRegister} disabled={busy}>Crear mi perfil âš½</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Panel del perfil (lo que ve el participante logueado) */
function ProfileCard({ user, data, onClose, onLogout }) {
  const age = ageFromBirth(user.birthdate);
  const myRoute = routeProgressStats(data, user);
  const myStats = useMemo(() => {
    if (!user.linkedCanon) return null;
    const cons = buildConsolidated(data.exercises, data.aliases, data.excluded);
    return cons.find((s) => norm(s.canon) === norm(user.linkedCanon)) || emptyConsolidatedStats(user.linkedCanon, data.exercises || []);
  }, [user, data]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-row">
            <span className="avatar">{initials(user.name)}</span>
            <div>
              <div className="modal-title" style={{ fontSize: 24 }}>{user.name}</div>
              {age != null && <div className="dim" style={{ fontSize: 13 }}>{age} aÃ±os</div>}
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cerrar âœ•</button>
        </div>

        {myStats ? (
          <div className="profile-stats">
            <div className="pstat"><span className="pstat-n t-gold">{formatChampionshipPoints(myStats.points)}</span><span className="pstat-l">pts campeonato</span></div>
            <div className="pstat"><span className="pstat-n">{myStats.rank ? `${myStats.rank}Âº` : "â€”"}</span><span className="pstat-l">en la tabla</span></div>
            <div className="pstat"><span className="pstat-n">{myStats.played}/{myStats.totalGames || myStats.played}</span><span className="pstat-l">juegos</span></div>
            <div className="pstat"><span className="pstat-n">{myStats.correct}/{myStats.total}</span><span className="pstat-l">aciertos</span></div>
          </div>
        ) : (
          <div className="profile-nolink">
            âš½ TodavÃ­a no estÃ¡s vinculado con los resultados del podio. El administrador puede conectarte con tu nombre de juego cuando participes.
          </div>
        )}

        <div className="profile-route">
          <div className="profile-route-head">
            <span>Ruta formativa</span>
            <b>{myRoute.completed}/{myRoute.total} bloques Â· {myRoute.percent}%</b>
          </div>
          <span className="route-progress-bar"><i style={{ width: `${myRoute.percent}%` }} /></span>
        </div>

        <div className="profile-field"><span className="pf-l">Correo</span><span className="pf-v">{user.email || "Pendiente"}</span></div>
        <div className="profile-field"><span className="pf-l">ðŸŽ‚ Nacimiento</span><span className="pf-v">{fmtDate(user.birthdate)}</span></div>
        <div className="profile-field"><span className="pf-l">â›ª ViviÃ³ su EJE</span><span className="pf-v">{user.retreatDate || "â€”"}</span></div>
        {user.expectations && (
          <div className="profile-expect">
            <div className="pf-l" style={{ marginBottom: 4 }}>ðŸ’­ Sus expectativas</div>
            <div className="pf-quote">"{user.expectations}"</div>
          </div>
        )}

        <button className="btn btn--ghost btn--sm" style={{ marginTop: 16 }} onClick={onLogout}>Cerrar sesiÃ³n</button>
      </div>
    </div>
  );
}

function EmailUpdateModal({ user, data, setData, onLogout }) {
  const [email, setEmail] = useState(user.email || "");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const users = data.users || [];

  const saveEmail = async () => {
    setErr(null);
    const clean = normEmail(email);
    if (!isValidEmail(clean)) { setErr("Escribe un correo vÃ¡lido."); return; }
    if (users.some((u) => u.id !== user.id && normEmail(u.email) === clean)) {
      setErr("Ese correo ya estÃ¡ registrado en otro perfil.");
      return;
    }
    setBusy(true);
    try {
      const next = { ...data, users: users.map((u) => (u.id === user.id ? { ...u, email: clean } : u)) };
      await saveData(next, data);
      setData(next);
    } catch {
      setErr("No se pudo guardar el correo. IntÃ©ntalo otra vez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="modal email-update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Actualiza tu correo</div>
            <div className="dim" style={{ fontSize: 13 }}>Lo usaremos para recuperar tu clave y dar seguimiento a tu preparaciÃ³n.</div>
          </div>
        </div>
        <label className="lbl">Correo</label>
        <input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu.correo@email.com" onKeyDown={(e) => e.key === "Enter" && saveEmail()} />
        {err && <div className="auth-err">{err}</div>}
        <div className="email-update-actions">
          <button className="btn btn--gold" onClick={saveEmail} disabled={busy}>Guardar correo</button>
          <button className="btn btn--ghost btn--sm" onClick={onLogout} disabled={busy}>Cerrar sesiÃ³n</button>
        </div>
      </div>
    </div>
  );
}

/* ================= App ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => readStore(STORE.adminOpen, "") === "1" ? "admin" : "public");
  const [mode, setMode] = useState(() => {
    const saved = readStore(STORE.mode, "ruta");
    return ["ruta", "podio", "roles"].includes(saved) ? saved : "ruta";
  }); // ruta | podio | roles
  const [sel, setSel] = useState(() => readStore(STORE.selectedExercise, "consolidado"));
  const [section, setSection] = useState(() => readStore(STORE.podiumSection, "podio"));
  const [studentModal, setStudentModal] = useState(null);
  const [muted, setMuted] = useState(false);
  const [sessionUserId, setSessionUserId] = useState(() => readStore(STORE.userId, ""));
  const [showProfile, setShowProfile] = useState(false);
  const [showQuestionBox, setShowQuestionBox] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);

  const sessionUser = data?.users?.find((u) => u.id === sessionUserId) || null;
  const needsEmailUpdate = !!(sessionUser && !isValidEmail(sessionUser.email));

  useEffect(() => {
    (async () => {
      const savedUserId = readStore(STORE.userId, "");
      const wantsAdmin = readStore(STORE.adminOpen, "") === "1";
      const d = wantsAdmin || savedUserId ? await loadData() : await loadAuthData();
      if (d && savedUserId && !(d.users || []).some((u) => u.id === savedUserId)) {
        writeStore(STORE.userId, "");
        setSessionUserId("");
      }
      if (wantsAdmin) setView("admin");
      setData(d || emptyData());
      setLoading(false);
    })();
  }, []);

  useEffect(() => { writeStore(STORE.userId, sessionUserId); }, [sessionUserId]);
  useEffect(() => {
    if (view === "admin") writeStore(STORE.adminOpen, "1");
    if (view === "public") writeStore(STORE.adminOpen, "");
  }, [view]);
  useEffect(() => { writeStore(STORE.mode, mode); }, [mode]);
  useEffect(() => { writeStore(STORE.selectedExercise, sel); }, [sel]);
  useEffect(() => { writeStore(STORE.podiumSection, section); }, [section]);

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
    writeStore(STORE.userId, uid);
    setLoading(true);
    const d = await loadData();
    if (d) setData(d);
    setLoading(false);
  }, []);

  const handleAdminOk = useCallback(async () => {
    setLoading(true);
    const d = await loadData();
    if (d) setData(d);
    writeStore(STORE.adminOpen, "1");
    setView("admin");
    setLoading(false);
  }, []);

  const handleAdminExit = useCallback(async () => {
    writeStore(STORE.adminOpen, "");
    setView("public");
    if (!sessionUserId) {
      const d = await loadAuthData();
      if (d) setData(d);
    }
  }, [sessionUserId]);

  const handleLogout = useCallback(async () => {
    writeStore(STORE.userId, "");
    writeStore(STORE.roleplaySession, "");
    writeStoreJson(STORE.roleplayHidden, []);
    setSessionUserId("");
    setShowProfile(false);
    setShowQuestionBox(false);
    setMode("ruta");
    const d = await loadAuthData();
    if (d) setData(d);
  }, []);

  const mergeProgressRow = useCallback((saved) => {
    setData((prev) => {
      if (!prev) return prev;
      const rest = (prev.progress || []).filter((p) => !(p.userId === saved.userId && p.blockId === saved.blockId));
      return { ...prev, progress: [...rest, saved] };
    });
  }, []);

  const handleToggleBlockProgress = useCallback(async (blockId, completed) => {
    if (!sessionUserId) return;
    setProgressBusy(true);
    try {
      const saved = await saveBlockProgress(sessionUserId, blockId, completed);
      mergeProgressRow(saved);
    } catch (e) {
      console.error("saveBlockProgress:", e);
      window.alert("No se pudo guardar el avance. Revisa que la tabla route_progress exista en Supabase.");
    } finally {
      setProgressBusy(false);
    }
  }, [sessionUserId, mergeProgressRow]);

  const handleOpenBlock = useCallback(async (blockId) => {
    if (!sessionUserId) return;
    try {
      const saved = await saveRouteProgress(sessionUserId, blockId, { opened: true });
      mergeProgressRow(saved);
    } catch (e) {
      console.warn("open block progress:", e);
    }
  }, [sessionUserId, mergeProgressRow]);

  const handleAudioProgress = useCallback(async (blockId, audioPercent, audioCompleted) => {
    if (!sessionUserId) return;
    try {
      const saved = await saveRouteProgress(sessionUserId, blockId, { audioPercent, audioCompleted });
      mergeProgressRow(saved);
    } catch (e) {
      console.warn("audio progress:", e);
    }
  }, [sessionUserId, mergeProgressRow]);

  const handleSubmitQuestion = useCallback(async (question) => {
    if (!sessionUser) return;
    const saved = await submitQuestion(sessionUser, question);
    setData((prev) => ({ ...prev, questions: [saved, ...((prev?.questions || []).filter((q) => q.id !== saved.id))] }));
  }, [sessionUser]);

  if (loading)
    return (
      <Shell>
        <div className="empty" style={{ padding: 90 }}>Cargando resultadosâ€¦</div>
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
          <span className="sb-sep">Â·</span>
          <span className="sb-label">COPA MUNDIAL Â· PREPARACIÃ“N RETIRO</span>
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
              <text x="430" y="196" textAnchor="middle" className="logo-ballglyph">âš½</text>
            </g>
          </svg>
        </div>
        <div className="hero-sub">PreparaciÃ³n del equipo de servidores</div>
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
              ðŸŸï¸ Ruta Formativa
            </button>
            <button className={`mode-btn ${mode === "podio" ? "mode-btn--on" : ""}`} onClick={() => setMode("podio")}>
              ðŸ† Podio y Resultados
            </button>
            <button className={`mode-btn ${mode === "roles" ? "mode-btn--on" : ""}`} onClick={() => setMode("roles")}>
              Juego de roles
            </button>
            <button className="mode-btn" onClick={() => setShowQuestionBox(true)}>
              ðŸ’¬ BuzÃ³n de preguntas
            </button>
          </div>

          {mode === "ruta" && (
            <RouteField
              data={data}
              muted={muted}
              sessionUser={sessionUser}
              progressBusy={progressBusy}
              onToggleBlockProgress={handleToggleBlockProgress}
              onOpenBlock={handleOpenBlock}
              onAudioProgress={handleAudioProgress}
            />
          )}

          {mode === "roles" && (
            <RoleplayHub data={data} setData={setData} sessionUser={sessionUser} />
          )}

          {mode === "podio" && (
            <>
              <nav className="chipbar">
                <button className={`chip chip--gold ${consolidated ? "chip--on" : ""}`} onClick={() => setSel("consolidado")}>
                  ðŸ† Consolidado
                </button>
                {data.exercises.map((ex) => (
                  <button key={ex.id} className={`chip ${sel === ex.id ? "chip--on" : ""}`} onClick={() => setSel(ex.id)}>
                    {ex.title}
                  </button>
                ))}
              </nav>

              {data.exercises.length === 0 ? (
                <div className="empty" style={{ padding: "70px 20px" }}>
                  <div style={{ fontSize: 42 }}>ðŸŸï¸</div>
                  <div style={{ marginTop: 10 }}>AÃºn no hay resultados cargados.<br />Entra al panel de administraciÃ³n para subir el primer ejercicio.</div>
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
                          ? "ClasificaciÃ³n general Â· puntos por aciertos del primer intento"
                          : `"${currentEx.title}" Â· aciertos del primer intento${hasScores(currentEx) ? " Â· desempate por rapidez Wordwall" : ""}`
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
      {showQuestionBox && sessionUser && (
        <QuestionBox
          user={sessionUser}
          questions={data.questions || []}
          onSubmit={handleSubmitQuestion}
          onClose={() => setShowQuestionBox(false)}
        />
      )}
      {needsEmailUpdate && (
        <EmailUpdateModal
          user={sessionUser}
          data={data}
          setData={setData}
          onLogout={handleLogout}
        />
      )}

      <footer className="foot">
        <button className="btn btn--ghost btn--sm" onClick={async () => { const d = sessionUser ? await loadData() : await loadAuthData(); if (d) setData(d); }}>â†» Actualizar datos</button>
        <button className="btn btn--ghost btn--sm" onClick={() => setView("pin")}>âš™ AdministraciÃ³n</button>
      </footer>
    </Shell>
  );
}

/* ================= Shell + sistema de diseÃ±o ================= */
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
.podium-main{font-family:var(--mono);font-weight:700;font-variant-numeric:tabular-nums;font-size:28px;
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

/* ---------- ExplicaciÃ³n de puntos ---------- */
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

/* ---------- FusiÃ³n ---------- */
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
.champ-pill{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:26px;
  padding:0 9px;border-radius:8px;font-family:var(--mono);font-size:13.5px;font-weight:900;
  background:#FFC53118;color:var(--gold2);border:1px solid #FFC53155;
  box-shadow:none;font-variant-numeric:tabular-nums}
tr.row--top .champ-pill{background:#FFC53124;border-color:#FFC53177}
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
.modal--mid{max-width:620px}
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
.sync-card{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-color:var(--line2)}
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

/* ---------- Pantalla de autenticaciÃ³n ---------- */
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
.auth-hint--warn{background:#FFC53110;border:1px solid #FFC53135;border-radius:10px;padding:9px 11px;color:var(--gold2)}
.auth-hint--warn b{color:var(--text)}
.auth-link-btn{margin:10px auto 0;display:flex}
.pass-wrap{position:relative;display:flex;align-items:center}
.pass-inp{padding-right:44px;width:100%}
.pass-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;
  border:none;cursor:pointer;font-size:17px;padding:6px;border-radius:8px;line-height:1;opacity:.85;transition:var(--tr)}
.pass-toggle:hover{opacity:1;background:#ffffff10}
.email-update-modal{max-width:460px}
.email-update-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

/* ---------- Perfil del participante ---------- */
.profile-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:18px}
.pstat{background:linear-gradient(180deg,var(--card2),var(--bg1));border:1px solid var(--line);border-radius:12px;
  padding:13px 6px;text-align:center;display:flex;flex-direction:column;gap:3px}
.pstat-n{font-family:var(--disp);font-style:italic;font-size:26px;line-height:1}
.pstat-l{font-size:10px;color:var(--dim);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px}
.profile-nolink{background:#FFC5310f;border:1px solid #FFC53133;border-radius:12px;padding:13px 15px;
  font-size:13px;line-height:1.5;margin-bottom:18px}
.profile-route{background:var(--bg0);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:14px}
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
.admin-merge-box{margin-top:12px;background:#FFC5310d;border:1px solid #FFC53135;border-radius:11px;padding:12px;display:grid;gap:9px}
.admin-merge-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.admin-reset-box{margin-top:12px;background:var(--bg0);border:1px solid var(--line);border-radius:11px;padding:12px;display:grid;gap:9px}
.admin-reset-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.admin-reset-actions .inp{max-width:260px}

/* ---------- Dashboard admin ---------- */
.admin-dash{display:grid;gap:16px}
.dash-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;border-color:var(--line2)}
.dash-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dash-eyebrow{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--turf);text-transform:uppercase}
.dash-title{font-family:var(--disp);font-style:italic;text-transform:uppercase;font-size:28px;line-height:1.1;margin:3px 0}
.dash-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:9px}
.dash-kpi{min-height:116px;display:flex;flex-direction:column;justify-content:center;gap:2px}
.dash-kpi span{font-family:var(--disp);font-style:italic;font-size:34px;line-height:1;color:var(--gold2)}
.dash-kpi b{font-size:13px}
.dash-kpi small{color:var(--dim);font-size:11px}
.dash-filters{display:grid;gap:12px;border-color:var(--line2)}
.filter-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.filter-group{display:flex;flex-direction:column;gap:6px}
.filter-group span{font-family:var(--mono);font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--dim)}
.dash-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.dash-panel{display:grid;gap:12px}
.dash-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.dash-panel-title{font-weight:900;font-size:16px}
.dash-count{font-family:var(--disp);font-style:italic;color:var(--hot2);font-size:30px;line-height:1}
.dash-alerts{display:grid;gap:8px}
.dash-alert{display:flex;align-items:center;gap:10px;background:var(--bg0);border:1px solid var(--line);border-radius:11px;padding:10px 12px}
.dash-alert small{display:block;color:var(--dim);font-size:12px}
.block-stat-list{display:grid;gap:11px}
.block-stat{display:grid;gap:6px}
.block-stat-head{display:flex;justify-content:space-between;gap:10px;font-size:13px}
.block-stat-head span{color:var(--dim);font-family:var(--mono);white-space:nowrap}
.mini-bar--wide{width:100%;height:8px}
.dash-table-wrap{overflow:auto}
.dash-table{width:100%;border-collapse:collapse;font-size:13.5px}
.dash-table th{text-align:left;color:var(--dim);font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:9px 10px;border-bottom:1px solid var(--line)}
.dash-table td{padding:11px 10px;border-bottom:1px solid #26355F66;vertical-align:middle}
.dash-table tr:hover td{background:#ffffff05}
.cell-main{display:flex;flex-direction:column;gap:2px;min-width:130px}
.cell-main small{color:var(--dim);font-size:11.5px}
.mini-state{display:inline-flex;align-items:center;white-space:nowrap;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:900;line-height:1.2;border:1px solid var(--line);background:#ffffff08;color:var(--dim)}
.mini-state--present,.mini-state--ok,.mini-state--passed,.mini-state--unlocked{background:#16DB9316;color:var(--turf);border-color:#16DB9344}
.mini-state--exempt,.mini-state--nogame,.mini-state--noaudio{background:#7D8CFF16;color:#AEB7FF;border-color:#7D8CFF44}
.mini-state--pending,.mini-state--failed,.mini-state--locked,.mini-state--absent{background:#FFC53116;color:var(--gold2);border-color:#FFC53144}
.mini-state--failed{background:#FF2E6318;color:var(--hot2);border-color:#FF2E6350}
.status-pill{display:inline-flex;max-width:300px;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;line-height:1.2}
.status-pill--ok{background:#16DB931a;color:var(--turf);border:1px solid #16DB9344}
.status-pill--warn{background:#FFC53116;color:var(--gold2);border:1px solid #FFC53144}
.empty--compact{padding:22px 12px}

/* ---------- Asistencia admin ---------- */
.attendance-admin{display:grid;gap:16px}
.attendance-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;border-color:var(--line2)}
.attendance-tools{display:grid;grid-template-columns:minmax(220px,1.1fr) minmax(220px,1.4fr) auto;gap:12px;align-items:end}
.attendance-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.attendance-summary{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:9px}
.attendance-list{display:grid;gap:8px}
.attendance-row{display:grid;grid-template-columns:28px 30px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;
  text-align:left;color:var(--text);background:var(--bg0);border:1px solid var(--line);border-radius:12px;padding:10px 12px;
  cursor:pointer;transition:var(--tr);font-family:var(--body)}
.attendance-row:hover{border-color:var(--line2);transform:translateY(-1px)}
.attendance-row--on{border-color:#16DB9366;background:#16DB930f}
.attendance-check{width:24px;height:24px;border-radius:7px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;
  color:#03251A;background:#ffffff08;font-weight:900;line-height:1}
.attendance-row--on .attendance-check{background:var(--turf);border-color:var(--turf)}
.attendance-person{display:flex;flex-direction:column;gap:2px;min-width:0}
.attendance-person b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attendance-person small{color:var(--dim);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---------- Preguntas + Wordwall ---------- */
.res-edit-wide{min-width:260px;flex:1.4}
.link-sync-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
.questions-admin{display:grid;gap:16px}
.questions-tools{grid-template-columns:minmax(180px,.7fr) minmax(220px,1.4fr)}
.questions-list{display:grid;gap:12px}
.question-admin-row{display:grid;gap:12px}
.question-admin-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.question-text{margin:0;color:var(--text);font-weight:700}
.question-history{display:grid;gap:8px;margin-top:8px}
.question-item{border:1px solid var(--line);border-radius:12px;background:var(--bg0);padding:10px 12px}
.question-item-head{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--dim);font-size:12px}
.question-item p{margin:6px 0 0;color:var(--text)}
.question-answer{margin-top:8px;border-left:3px solid var(--turf);padding:8px 10px;background:#16DB9310;border-radius:8px;color:var(--silver2)}

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
.route-progress{max-width:520px;margin:0 auto 20px;background:linear-gradient(180deg,var(--card2),var(--card));
  border:1px solid var(--line);border-radius:13px;padding:12px 14px}
.route-progress-head,.profile-route-head{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--dim);margin-bottom:8px}
.route-progress-head b,.profile-route-head b{color:var(--text);font-family:var(--mono);font-size:12px}
.route-progress-bar{display:block;width:100%;height:9px;border-radius:999px;background:#05070F;border:1px solid var(--line);overflow:hidden}
.route-progress-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--turf),var(--gold));transition:width .25s ease}

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
.station--done .station-node{border-color:var(--turf);color:#03251A;background:linear-gradient(180deg,#7EF7C9,var(--turf))}
.station-num{line-height:1}
.station-card{flex:1;text-align:inherit;background:linear-gradient(180deg,var(--card2),var(--card));
  border:1px solid var(--line2);border-radius:14px;padding:13px 16px;cursor:pointer;transition:var(--tr);
  display:flex;flex-direction:column;gap:3px;color:var(--text)}
.station-card:hover{transform:translateY(-2px);border-color:var(--turf);box-shadow:0 10px 30px #00000055}
.station--goal .station-card{border-color:#FFC53166;background:linear-gradient(180deg,#231d0e,#141020)}
.station--goal .station-card:hover{border-color:var(--gold)}
.station--done .station-card{border-color:#16DB9388;box-shadow:0 0 0 1px #16DB9322 inset}
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
.block-progress-card{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
  background:var(--bg0);border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin:0 0 16px}
.block-progress-card--done{border-color:#16DB9366;background:#16DB930f}
.block-progress-title{font-weight:900;font-size:14px}
.audio-card,.requirements-card,.attendance-note{background:var(--bg0);border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin:0 0 14px}
.audio-card{display:grid;gap:10px}
.audio-card--done{border-color:#16DB9366;background:#16DB930f}
.audio-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.audio-title,.requirements-title{font-weight:900;font-size:14px}
.audio-card audio{width:100%}
.attendance-note{color:var(--turf);font-size:13px;font-weight:800;border-color:#16DB9344;background:#16DB930f}
.requirements-card{display:grid;gap:9px}
.requirement-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #26355F66;font-size:13px}
.requirement-row:first-of-type{border-top:0}
.requirement-row span{font-weight:800}
.res-group{margin-top:14px}
.res-group-title{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--dim);
  text-transform:uppercase;margin-bottom:9px}
.res-list{display:flex;flex-wrap:wrap;gap:10px}
.res-btn{display:flex;align-items:center;gap:10px;padding:11px 15px;border-radius:12px;cursor:pointer;
  border:1px solid var(--line2);background:linear-gradient(180deg,var(--card2),var(--card));transition:var(--tr);
  font-family:var(--body);color:var(--text);text-align:left;text-decoration:none}
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

/* estaciÃ³n bloqueada (vista pÃºblica) */
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

/* juego de roles */
.roleplay-hub,.role-admin{display:grid;gap:16px}
.roleplay-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.join-box{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.join-box .inp{width:180px;text-transform:uppercase;font-family:var(--mono);font-weight:900;letter-spacing:1px}
.role-selector{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.role-select-card{border:1px solid var(--line);background:linear-gradient(180deg,var(--card2),var(--card));color:var(--text);
  border-radius:12px;padding:14px;text-align:left;cursor:pointer;transition:var(--tr);display:grid;gap:5px;min-height:112px}
.role-select-card:hover{transform:translateY(-2px);border-color:var(--line2)}
.role-select-card--on{border-color:var(--turf);box-shadow:0 0 0 1px #16DB9344,0 10px 30px #16DB9312}
.role-select-card b{font-size:16px}
.role-select-card span{font-size:12.5px;color:var(--dim);line-height:1.35}
.roleplay-grid,.role-admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.role-admin-card-wide{grid-column:1/-1}
.role-session-panel,.role-resource-panel{display:grid;gap:14px}
.session-code-box{display:flex;align-items:center;gap:12px;background:var(--bg0);border:1px solid var(--line2);border-radius:12px;padding:14px;flex-wrap:wrap}
.session-code-box span{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:var(--dim)}
.session-code-box b{font-family:var(--disp);font-style:italic;font-size:34px;color:var(--gold);letter-spacing:2px}
.session-people{display:grid;gap:8px}
.session-person{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);background:var(--bg0);border-radius:11px;padding:10px 12px}
.session-person--me{border-color:#16DB9366;background:#16DB930f}
.session-person span:last-child{display:grid;gap:2px}
.session-person small{color:var(--dim);font-size:12px;line-height:1.35}
.ascos-mini-list,.ascos-edit-list,.role-resource-list{display:grid;gap:8px}
.ascos-mini-item{border:1px solid var(--line);background:var(--bg0);border-radius:10px;padding:10px 12px;display:grid;gap:4px}
.ascos-mini-item span{font-size:12px;color:var(--dim);line-height:1.35}
.ascos-edit-row,.role-resource-row{display:flex;align-items:center;gap:8px;background:var(--bg0);border:1px solid var(--line);border-radius:10px;padding:8px;flex-wrap:wrap}
.ascos-guide{flex:1;min-width:260px}
.role-resource-url{flex:1;min-width:240px}
.inp--time{width:150px;flex:none}
.role-resource-cards{display:grid;gap:10px}
.role-user-resource{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.role-user-resource--done{border-color:#16DB9366;background:#16DB930d}
.role-user-resource--audio{align-items:stretch}
.role-user-resource audio{min-width:260px;max-width:100%}
.role-resource-type{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:var(--turf);font-weight:900}
.role-resource-time{font-family:var(--mono);font-size:12px;color:var(--gold);font-weight:900;margin-top:2px}
.role-resource-title{font-size:17px;font-weight:900}
.role-resource-status{display:inline-flex;margin-top:7px;font-size:11px;font-weight:900;color:var(--turf);text-transform:uppercase;letter-spacing:1px}
.role-audio{flex:1;min-width:320px;display:grid;gap:9px;background:var(--bg0);border:1px solid var(--line);border-radius:12px;padding:12px}
.role-audio--playing{border-color:#16DB9366;background:#16DB930f}
.role-audio--error{border-color:#FF2E6366;background:#FF2E6310}
.role-audio-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.role-audio-title{font-size:14px;font-weight:900}
.role-audio-help{font-size:12px;color:var(--dim);line-height:1.35}
.role-audio audio{width:100%;min-width:0}
.role-audio-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.role-journey-strip,.admin-helper-strip{display:flex;gap:8px;flex-wrap:wrap;background:var(--bg0);border:1px solid var(--line);border-radius:12px;padding:10px}
.role-journey-strip span,.admin-helper-strip span{font-size:12px;color:var(--dim);background:#FFFFFF08;border:1px solid #FFFFFF10;border-radius:999px;padding:7px 10px}
.role-journey-strip b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--turf);color:#03251A;margin-right:5px}
.admin-helper-strip b{color:var(--gold)}
.role-usage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.role-usage-card{background:var(--bg0);border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;gap:5px}
.role-usage-card b{font-size:14px}
.role-usage-card span{font-size:12px;color:var(--dim)}

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
  .dash-kpis{grid-template-columns:repeat(2,1fr)}
  .dash-grid{grid-template-columns:1fr}
  .dash-title{font-size:24px}
  .dash-table{min-width:820px}
  .attendance-tools{grid-template-columns:1fr}
  .attendance-actions{justify-content:flex-start}
  .attendance-summary{grid-template-columns:1fr}
  .attendance-row{grid-template-columns:28px 30px minmax(0,1fr)}
  .attendance-row .mini-state{grid-column:3}
  .station{width:88%}
  .res-edit{flex-wrap:wrap}
  .inp--sm{min-width:120px}
  .auth-grid{grid-template-columns:1fr}
  .profile-stats{grid-template-columns:repeat(2,1fr)}
  .user-fields{grid-template-columns:1fr}
  .role-selector,.roleplay-grid,.role-admin-grid,.role-usage-grid{grid-template-columns:1fr}
  .roleplay-hero{align-items:flex-start}
  .join-box .inp{width:100%}
  .join-box{width:100%}
  .role-user-resource audio{min-width:0;width:100%}
  .role-audio{min-width:0;width:100%}
  .role-journey-strip span,.admin-helper-strip span{width:100%;border-radius:10px}
}
`;

