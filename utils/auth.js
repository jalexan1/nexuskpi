/**
 * auth.js — Guard de autenticación con Supabase Auth · Plataforma L&S
 *
 * CAMBIO (login único):
 *  - La sesión se guarda en localStorage con la MISMA clave y formato que usa
 *    la librería oficial @supabase/supabase-js (`sb-<proyecto>-auth-token`).
 *    Portal de Despachos (React) usa esa librería; al estar ambas apps en el
 *    mismo dominio, comparten la sesión: se inicia sesión una sola vez.
 *  - El rol ya no sale de user_metadata (editable por el propio usuario):
 *    sale de core.accesos (función core.fn_mis_aplicaciones), por aplicación.
 *    Si el esquema core aún no está desplegado, se usa el rol anterior
 *    (modo compatibilidad) para no romper nada durante la transición.
 *  - Cierre por inactividad (30 min) compartido con Despachos.
 *
 * La interfaz pública NO cambia: sb.rest, sb.signIn, sb.signOut, sb.refresh,
 * checkAuth, getRole, getSession, getUserName, logout, renderUser,
 * saveSession, _getToken, _getRefreshToken, _clearSession, applyTheme, setTheme.
 */

// ── Claves de almacenamiento compartidas ─────────────────────────────────────
const SB_STORAGE_KEY = `sb-${new URL(CONFIG.supabase.url).hostname.split('.')[0]}-auth-token`;
const LS_ACCESOS     = 'ls_accesos';            // cache de core.fn_mis_aplicaciones
const LS_ACTIVIDAD   = 'ls_ultima_actividad';   // inactividad compartida entre apps
const INACTIVIDAD_MS = 30 * 60 * 1000;
const ACCESOS_TTL_MS = 5 * 60 * 1000;

// Limpieza del formato anterior (sessionStorage) — se ejecuta una vez por pestaña
['sb_token', 'sb_refresh', 'sb_expires_at', 'sb_user'].forEach(k => { try { sessionStorage.removeItem(k); } catch {} });

// ── Cliente Supabase mínimo (sin SDK — fetch puro) ─────────────────────────
const sb = {
  async signIn(email, password) {
    const r = await fetch(`${CONFIG.supabase.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': CONFIG.supabase.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Error de autenticación');
    return data;
  },

  async signOut() {
    const token = _getToken();
    _clearSession();                 // primero local: "Salir" siempre cierra, aun sin red
    if (!token) return;
    try {
      await fetch(`${CONFIG.supabase.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { 'apikey': CONFIG.supabase.anonKey, 'Authorization': `Bearer ${token}` },
      });
    } catch {}
  },

  async getUser() {
    const token = _getToken();
    if (!token) return null;
    const r = await fetch(`${CONFIG.supabase.url}/auth/v1/user`, {
      headers: { 'apikey': CONFIG.supabase.anonKey, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) { _clearSession(); return null; }
    return r.json();
  },

  // Pide un access_token nuevo usando el refresh_token guardado.
  // Si otra app/pestaña ya renovó la sesión (misma clave compartida), no
  // vuelve a renovar: evita "carreras" entre Despachos y NexusKPI.
  async refresh(rTokenEsperado) {
    const actual = _leerSesion();
    const rToken = actual?.refresh_token;
    if (!rToken) return false;
    if (rTokenEsperado && rToken !== rTokenEsperado && _segundosRestantes(actual) > 60) return true;
    try {
      const r = await fetch(`${CONFIG.supabase.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': CONFIG.supabase.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rToken }),
      });
      const data = await r.json();
      if (!r.ok) {
        // ¿Otra app renovó mientras tanto? Entonces la sesión sigue viva.
        const ahora = _leerSesion();
        if (ahora?.refresh_token && ahora.refresh_token !== rToken) { _scheduleAutoRefresh(); return true; }
        _clearSession(); return false;
      }
      saveSession(data);
      return true;
    } catch {
      // Fallo de red renovando: no borramos la sesión, puede ser algo
      // transitorio (wifi, etc.) — se reintentará en el próximo ciclo.
      return false;
    }
  },

  // REST helper para todas las páginas
  // opts.noRedirect = true → si la sesión falla, NO navega a login (para
  // procesos largos como el ETL, donde eso mataría el proceso a medias sin
  // dejar rastro). El llamador recibe el error normal y decide qué hacer.
  // Para esquemas distintos de public: extraHeaders {'Accept-Profile':'despachos'}
  // (lectura) o {'Content-Profile':'core'} (escritura / rpc).
  async rest(method, path, body = null, extraHeaders = {}, opts = {}) {
    const doCall = () => {
      const token = _getToken();
      const headers = {
        'apikey':        CONFIG.supabase.anonKey,
        'Authorization': `Bearer ${token || CONFIG.supabase.anonKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
        ...extraHeaders,
      };
      const callOpts = { method, headers };
      if (body) callOpts.body = JSON.stringify(body);
      return fetch(`${CONFIG.supabase.url}/rest/v1/${path}`, callOpts);
    };

    // Token vencido o por vencer → renovar antes de llamar
    const s = _leerSesion();
    if (s && _segundosRestantes(s) < 30) await this.refresh(s.refresh_token);

    let r = await doCall();

    // Si el token expiró (401), intentamos renovarlo UNA vez y reintentar
    // la misma petición antes de darla por fallida.
    if (r.status === 401 && _getRefreshToken()) {
      const renovado = await this.refresh();
      if (renovado) r = await doCall();
    }

    if (!r.ok) {
      const txt = await r.text();
      if (r.status === 401 && !opts.noRedirect) {
        _clearSession();
        location.href = _base() + 'index.html';
      }
      throw new Error(`Supabase ${r.status}: ${txt.slice(0, 200)}`);
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : null;
  },
};

// ── Sesión compartida (formato @supabase/supabase-js) ───────────────────────
function _leerSesion() {
  try {
    const raw = localStorage.getItem(SB_STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.access_token && s.refresh_token ? s : null;
  } catch { return null; }
}
function _segundosRestantes(s) { return (Number(s?.expires_at || 0)) - Math.floor(Date.now() / 1000); }
function _base() { return location.pathname.includes('/pages/') ? '../' : './'; }

function _getToken()        { return _leerSesion()?.access_token || null; }
function _getRefreshToken() { return _leerSesion()?.refresh_token || null; }
function _clearSession() {
  try {
    localStorage.removeItem(SB_STORAGE_KEY);
    localStorage.removeItem(LS_ACCESOS);
  } catch {}
  _stopAutoRefresh();
}

function saveSession(authData) {
  const expires_at = authData.expires_at
    || Math.floor(Date.now() / 1000) + Number(authData.expires_in || 3600);
  const sesion = {
    access_token:  authData.access_token,
    token_type:    authData.token_type || 'bearer',
    expires_in:    authData.expires_in,
    expires_at,
    refresh_token: authData.refresh_token,
    user:          authData.user,
  };
  localStorage.setItem(SB_STORAGE_KEY, JSON.stringify(sesion));
  _marcarActividad();
  _scheduleAutoRefresh();
}

// ── Renovación automática en background ─────────────────────────────────────
// Mientras la pestaña esté abierta, renueva el access_token ~60s antes de
// que expire (dashboards en TV, pantallas de monitoreo, etc.)
let _refreshTimer = null;

function _scheduleAutoRefresh() {
  _stopAutoRefresh();
  const s = _leerSesion();
  if (!s) return;
  const msHastaRenovar = Math.max((_segundosRestantes(s) - 60) * 1000, 5_000);
  _refreshTimer = setTimeout(async () => {
    const ok = await sb.refresh(s.refresh_token);
    if (ok) _scheduleAutoRefresh();
  }, msHastaRenovar);
}

function _stopAutoRefresh() {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
}

// ── Inactividad compartida con Despachos ────────────────────────────────────
function _marcarActividad() { try { localStorage.setItem(LS_ACTIVIDAD, String(Date.now())); } catch {} }
function _inactividadVencida() {
  const ultima = Number(localStorage.getItem(LS_ACTIVIDAD) || 0);
  return ultima > 0 && Date.now() - ultima > INACTIVIDAD_MS;
}
(function _vigilarInactividad() {
  let ultimo = 0;
  const marcar = () => { const t = Date.now(); if (t - ultimo > 15000) { ultimo = t; _marcarActividad(); } };
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(e => window.addEventListener(e, marcar, { passive: true }));
  setInterval(() => {
    // Pantallas de monitoreo (TV): no se cierran si la página lo pide
    if (window.NKPI_SIN_INACTIVIDAD) { _marcarActividad(); return; }
    if (_getToken() && _inactividadVencida()) { _clearSession(); location.href = _base() + 'index.html?motivo=inactividad'; }
  }, 30000);
})();

// Si la página se cargó con una sesión ya guardada (navegación entre KPIs o
// viniendo de Despachos), retomamos el ciclo de auto-refresh.
if (_getToken() && _getRefreshToken()) _scheduleAutoRefresh();

// ── Usuario y accesos ───────────────────────────────────────────────────────
function getSession() {
  return _leerSesion()?.user || null;
}

function _leerAccesos() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_ACCESOS) || 'null');
    const u = getSession();
    return a && u && a.uid === u.id ? a : null;
  } catch { return null; }
}

// Carga los accesos del usuario desde core.fn_mis_aplicaciones().
// modo 'plataforma' = esquema core desplegado; 'compat' = aún no (usa rol anterior).
async function cargarAccesos(forzar = false) {
  const u = getSession();
  if (!u) return null;
  const cache = _leerAccesos();
  if (!forzar && cache && Date.now() - cache.ts < ACCESOS_TTL_MS) return cache;
  let registro;
  try {
    const apps = await sb.rest('POST', 'rpc/fn_mis_aplicaciones', {}, { 'Content-Profile': 'core' }, { noRedirect: true });
    registro = { uid: u.id, modo: 'plataforma', apps: apps || [], ts: Date.now() };
  } catch (e) {
    const msg = String(e.message || '');
    // Esquema core no expuesto / función inexistente → modo compatibilidad
    if (/PGRST106|PGRST202|42883|3F000|schema|404|406/i.test(msg)) {
      registro = { uid: u.id, modo: 'compat', apps: [], ts: Date.now() };
    } else if (cache) {
      return cache;        // error de red: seguimos con lo último conocido
    } else {
      throw e;
    }
  }
  localStorage.setItem(LS_ACCESOS, JSON.stringify(registro));
  return registro;
}

// Aplicación de la página actual: op_* → OPERATIVIDAD; resto → KPI
function _appActual() {
  const f = location.pathname.split('/').pop() || '';
  return f.startsWith('op_') ? 'OPERATIVIDAD' : 'KPI';
}

function _rolLegado() {
  const u = getSession();
  return u?.app_metadata?.role || u?.user_metadata?.role || 'viewer';
}

function getRole(app = _appActual()) {
  const a = _leerAccesos();
  if (!a || a.modo === 'compat') return _rolLegado();
  const acc = a.apps.find(x => x.codigo === app);
  if (acc) return acc.rol;
  // Admin de cualquier app de la plataforma = admin (pantallas de administración)
  return a.apps.some(x => x.rol === 'admin') && app === 'PLATAFORMA' ? 'admin' : null;
}

function esAdminPlataforma() {
  const a = _leerAccesos();
  if (!a || a.modo === 'compat') return _rolLegado() === 'admin';
  return a.apps.some(x => x.rol === 'admin');
}

function getUserName() {
  const u = getSession();
  return u?.user_metadata?.nombre || u?.email || 'Usuario';
}

// ── Guard principal ────────────────────────────────────────────────────────
// checkAuth()          → requiere sesión y acceso a la app de la página
// checkAuth('admin')   → además rol admin en esa app
// checkAuth(null,{app:'PLATAFORMA'}) → solo sesión (launcher)
async function checkAuth(rolRequerido = null, opts = {}) {
  const base = _base();
  if (!_getToken() || !getSession()) { location.href = base + 'index.html'; return null; }
  if (_inactividadVencida()) { _clearSession(); location.href = base + 'index.html?motivo=inactividad'; return null; }
  _marcarActividad();

  // Token vencido al abrir la página (p. ej. volvió después de un rato)
  const s = _leerSesion();
  if (_segundosRestantes(s) < 30) {
    const ok = await sb.refresh(s.refresh_token);
    if (!ok) { location.href = base + 'index.html'; return null; }
  }

  let accesos;
  try { accesos = await cargarAccesos(); }
  catch { accesos = null; }

  const app = opts.app || _appActual();
  if (app !== 'PLATAFORMA' && accesos && accesos.modo === 'plataforma') {
    const rol = getRole(app);
    if (!rol) { location.href = base + 'pages/plataforma.html?sinAcceso=' + app; return null; }
  }
  if (rolRequerido) {
    const ok = app === 'PLATAFORMA' ? esAdminPlataforma() : getRole(app) === rolRequerido;
    if (!ok) { location.href = base + 'pages/plataforma.html'; return null; }
  }
  return getSession();
}

async function logout() {
  await sb.signOut();
  location.href = _base() + 'index.html';
}

// ── Tema ───────────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = localStorage.getItem('nkpi_theme') || '';
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('nkpi_theme', t);
}

// ── Topbar user render ─────────────────────────────────────────────────────
function renderUser() {
  const el = document.getElementById('topbarUser');
  if (!el) return;
  const name = getUserName();
  const role = getRole() || '—';
  const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  el.innerHTML = `
    <a class="btn btn-sm" href="${_base()}pages/plataforma.html" title="Todas las aplicaciones">▦ Plataforma</a>
    <div class="user-avatar">${esc(name[0].toUpperCase())}</div>
    <span>${esc(name)}</span>
    <span class="badge ${role === 'admin' ? 'badge-warn' : 'badge-info'}" style="font-size:.6rem">${esc(role)}</span>
    <button class="btn btn-sm" onclick="logout()">Salir</button>`;
}
