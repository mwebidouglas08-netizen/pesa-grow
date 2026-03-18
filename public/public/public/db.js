const API = window.location.origin;

window.PG = {
  Auth: {
    async login(email, password) {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({email, password})
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      localStorage.setItem('pg_token', d.token);
      localStorage.setItem('pg_user', JSON.stringify(d.user));
      return d.user;
    },
    async register(data) {
      const r = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      localStorage.setItem('pg_token', d.token);
      localStorage.setItem('pg_user', JSON.stringify(d.user));
      return d.user;
    },
    async getMe() {
      const u = localStorage.getItem('pg_user');
      return u ? JSON.parse(u) : null;
    },
    logout() {
      localStorage.clear();
      window.location.href = 'index.html';
    }
  },
  hash: s => btoa(unescape(encodeURIComponent(s + '_pesagrow_salt_2024'))),
  DB: {
    async getAll() { return []; },
    async getByIndex() { return []; },
    async get() { return null; },
    async put() { return null; }
  },
  Investments: { async create() {}, async tick() {} },
  Deposits: { async submit() {} },
  Withdrawals: { async submit() {} },
  addTransaction: async () => {},
  addNotification: async () => {},
  seedDefaults: async () => {},
  genId: () => 'PG' + Date.now().toString(36).toUpperCase(),
  now: () => new Date().toISOString(),
  fmt: (n, d=2) => (+(n||0)).toFixed(d),
  fmtKES: n => 'KES ' + (+(n||0)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
};
