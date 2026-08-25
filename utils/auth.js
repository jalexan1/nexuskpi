/**
 * auth.js — Guard de autenticación con Supabase Auth
 * Todas las páginas protegidas llaman checkAuth() al cargar.
 */

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
    if (!token) return;
    await fetch(`${CONFIG.supabase.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': CONFIG.supabase.anonKey, 'Authorization': `Bearer ${token}` },
    });
    _clearSession();
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
  // Devuelve true si logró renovar, false si el refresh_token también murió
  // (ahí sí toca re-loguearse).
  async refresh() {
    const rToken = _getRefreshToken();
    if (!rToken) return false;
    try {
      const r = await fetch(`${CONFIG.supabase.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': CONFIG.supabase.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rToken }),
      });
      const data = await r.json();
      if (!r.ok) { _clearSession(); return false; }
      saveSession(data);
      return true;
    } catch {
      // Fallo de red renovando: no borramos la sesión, puede ser algo
      // transitorio (wifi, etc.) — se reintentará en el próximo ciclo.
      return false;
    }
  },

  // REST helper para todas las páginas
  async rest(method, path, body = null, extraHeaders = {}) {
    const doCall = () => {
      const token = _getToken();
      const headers = {
        'apikey':        CONFIG.supabase.anonKey,
        'Authorization': `Bearer ${token || CONFIG.supabase.anonKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
        ...extraHeaders,
      };
      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      return fetch(`${CONFIG.supabase.url}/rest/v1/${path}`, opts);
    };

    let r = await doCall();

    // Si el token expiró (401), intentamos renovarlo UNA vez y reintentar
    // la misma petición antes de darla por fallida.
    if (r.status === 401 && _getRefreshToken()) {
      const renovado = await this.refresh();
      if (renovado) r = await doCall();
    }

    if (!r.ok) {
      const txt = await r.text();
      if (r.status === 401) {
        // El refresh también falló (o no había refresh_token): la sesión
        // ya no es válida, mandamos a login en vez de dejar la página
        // rota mostrando errores sueltos.
        _clearSession();
        const base = location.pathname.includes('/pages/') ? '../' : './';
        location.href = base + 'index.html';
      }
      throw new Error(`Supabase ${r.status}: ${txt.slice(0, 200)}`);
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : null;
  },
};

// ── Sesión local ───────────────────────────────────────────────────────────
function _getToken()        { return sessionStorage.getItem('sb_token'); }
function _getRefreshToken() { return sessionStorage.getItem('sb_refresh'); }
function _clearSession() {
  sessionStorage.removeItem('sb_token');
  sessionStorage.removeItem('sb_refresh');
  sessionStorage.removeItem('sb_expires_at');
  sessionStorage.removeItem('sb_user');
  _stopAutoRefresh();
}

function saveSession(authData) {
  sessionStorage.setItem('sb_token',   authData.access_token);
  sessionStorage.setItem('sb_user',    JSON.stringify(authData.user));
  if (authData.refresh_token) sessionStorage.setItem('sb_refresh', authData.refresh_token);
  // expires_in viene en segundos desde que Supabase emitió el token
  if (authData.expires_in) {
    sessionStorage.setItem('sb_expires_at', String(Date.now() + authData.expires_in * 1000));
  }
  _scheduleAutoRefresh();
}

// ── Renovación automática en background ─────────────────────────────────────
// Mientras la pestaña esté abierta, renueva el access_token ~60s antes de
// que expire, para que el usuario nunca vea un 401 aunque lleve horas sin
// tocar el teclado/mouse (dashboards en TV, pantallas de monitoreo, etc.)
let _refreshTimer = null;

function _scheduleAutoRefresh() {
  _stopAutoRefresh();
  const expiresAt = Number(sessionStorage.getItem('sb_expires_at') || 0);
  if (!expiresAt) return;
  const msHastaRenovar = Math.max(expiresAt - Date.now() - 60_000, 5_000);
  _refreshTimer = setTimeout(async () => {
    const ok = await sb.refresh();
    if (ok) _scheduleAutoRefresh(); // encadena la siguiente renovación
  }, msHastaRenovar);
}

function _stopAutoRefresh() {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
}

// Si la página se cargó con una sesión ya guardada (navegación entre KPIs),
// retomamos el ciclo de auto-refresh en vez de esperar al próximo login.
if (_getToken() && _getRefreshToken()) _scheduleAutoRefresh();

function getSession() {
  try {
    const raw = sessionStorage.getItem('sb_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function getRole() {
  const u = getSession();
  return u?.user_metadata?.role || u?.app_metadata?.role || 'viewer';
}

function getUserName() {
  const u = getSession();
  return u?.user_metadata?.nombre || u?.email || 'Usuario';
}

// ── Guard principal ────────────────────────────────────────────────────────
async function checkAuth(rolRequerido = null) {
  const base = location.pathname.includes('/pages/') ? '../' : './';
  if (!_getToken()) { location.href = base + 'index.html'; return null; }
  const user = getSession();
  if (!user) { location.href = base + 'index.html'; return null; }
  if (rolRequerido && getRole() !== rolRequerido) {
    location.href = base + 'pages/menu.html'; return null;
  }
  return user;
}

async function logout() {
  await sb.signOut();
  const base = location.pathname.includes('/pages/') ? '../' : './';
  location.href = base + 'index.html';
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
  const role = getRole();
  el.innerHTML = `
    <div class="user-avatar">${name[0].toUpperCase()}</div>
    <span>${name}</span>
    <span class="badge ${role === 'admin' ? 'badge-warn' : 'badge-info'}" style="font-size:.6rem">${role}</span>
    <button class="btn btn-sm" onclick="logout()">Salir</button>`;
}
