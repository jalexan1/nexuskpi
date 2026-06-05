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

  // REST helper para todas las páginas
  async rest(method, path, body = null, extraHeaders = {}) {
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
    const r = await fetch(`${CONFIG.supabase.url}/rest/v1/${path}`, opts);
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Supabase ${r.status}: ${txt.slice(0, 200)}`);
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : null;
  },
};

// ── Sesión local ───────────────────────────────────────────────────────────
function _getToken()    { return sessionStorage.getItem('sb_token'); }
function _clearSession(){ sessionStorage.removeItem('sb_token'); sessionStorage.removeItem('sb_user'); }

function saveSession(authData) {
  sessionStorage.setItem('sb_token', authData.access_token);
  sessionStorage.setItem('sb_user',  JSON.stringify(authData.user));
}

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
