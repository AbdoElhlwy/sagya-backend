// database/db.js - سقيا الحرمين | قاعدة البيانات الإنتاجية
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sagya.db');
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

class SyncDB {
  constructor(sqlJs, data) {
    this._db = new sqlJs.Database(data);
    this._saveDebounce = null;
  }

  _save() {
    try {
      const data = this._db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }

  _scheduleSave() {
    if (this._saveDebounce) clearTimeout(this._saveDebounce);
    this._saveDebounce = setTimeout(() => this._save(), 200);
  }

  pragma(str) {
    this._db.run(`PRAGMA ${str}`);
    return this;
  }

  exec(sql) {
    this._db.run(sql);
    this._scheduleSave();
    return this;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        self._db.run(sql, flat);
        const res = self._db.exec('SELECT last_insert_rowid() as id');
        const lastInsertRowid = res[0]?.values[0]?.[0] ?? 0;
        self._scheduleSave();
        return { lastInsertRowid, changes: 1 };
      },
      get(...params) {
        const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const res = self._db.exec(sql, flat);
        if (!res[0]) return undefined;
        const { columns, values } = res[0];
        if (!values[0]) return undefined;
        const obj = {};
        columns.forEach((col, i) => { obj[col] = values[0][i]; });
        return obj;
      },
      all(...params) {
        const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const res = self._db.exec(sql, flat);
        if (!res[0]) return [];
        const { columns, values } = res[0];
        return values.map(row => {
          const obj = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
      }
    };
  }
}

let _syncDb = null;

async function initializeDatabase() {
  if (_syncDb) return _syncDb;

  const SQL = await initSqlJs();
  let data;
  if (fs.existsSync(DB_PATH)) {
    data = fs.readFileSync(DB_PATH);
  }

  _syncDb = new SyncDB(SQL, data);

  _syncDb.pragma('journal_mode = WAL');
  _syncDb.pragma('foreign_keys = ON');

  const run = (sql) => _syncDb._db.run(sql);

  // ═══ USERS ═══
  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'visitor',
    avatar_url TEXT,
    is_active INTEGER DEFAULT 1,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    last_login TEXT,
    last_ip TEXT,
    fcm_token TEXT,
    expo_push_token TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ DEVICES ═══
  run(`CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT,
    device_model TEXT,
    os_version TEXT,
    app_version TEXT,
    fcm_token TEXT,
    expo_push_token TEXT,
    last_seen TEXT DEFAULT (datetime('now')),
    is_trusted INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, device_id)
  )`);

  // ═══ OTP ═══
  run(`CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    is_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ REFRESH TOKENS ═══
  run(`CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    device_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, token)
  )`);

  // ═══ VOLUNTEERS ═══
  run(`CREATE TABLE IF NOT EXISTS volunteer_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    membership_number TEXT UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    nationality TEXT NOT NULL,
    national_id TEXT NOT NULL,
    city TEXT NOT NULL,
    age INTEGER NOT NULL,
    profession TEXT,
    experience TEXT,
    skills TEXT,
    availability TEXT,
    id_photo_url TEXT,
    personal_photo_url TEXT,
    status TEXT DEFAULT 'pending',
    level TEXT DEFAULT 'new',
    rejection_reason TEXT,
    qr_code_url TEXT,
    qr_code TEXT UNIQUE,
    points INTEGER DEFAULT 0,
    badge TEXT DEFAULT 'none',
    approved_at TEXT,
    approved_by INTEGER,
    latitude REAL,
    longitude REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ QR CODES ═══
  run(`CREATE TABLE IF NOT EXISTS qr_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volunteer_id INTEGER NOT NULL,
    code TEXT UNIQUE NOT NULL,
    membership_number TEXT,
    is_active INTEGER DEFAULT 1,
    generated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    scan_count INTEGER DEFAULT 0,
    last_scanned TEXT
  )`);

  // ═══ DONATIONS ═══
  run(`CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_number TEXT UNIQUE NOT NULL,
    donor_id INTEGER,
    donor_name TEXT NOT NULL,
    donor_phone TEXT NOT NULL,
    donation_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'SAR',
    notes TEXT,
    receipt_url TEXT,
    payment_status TEXT DEFAULT 'pending',
    payment_method TEXT,
    payment_ref TEXT,
    payment_gateway TEXT,
    status TEXT DEFAULT 'received',
    distributed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ PAYMENTS ═══
  run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donation_id INTEGER,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'SAR',
    gateway TEXT NOT NULL,
    gateway_ref TEXT,
    payment_intent TEXT,
    status TEXT DEFAULT 'pending',
    metadata TEXT,
    webhook_received INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ CAMPAIGNS ═══
  run(`CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    campaign_type TEXT DEFAULT 'water',
    target_amount REAL DEFAULT 0,
    current_amount REAL DEFAULT 0,
    target_bottles INTEGER DEFAULT 0,
    current_bottles INTEGER DEFAULT 0,
    location TEXT,
    latitude REAL,
    longitude REAL,
    start_date TEXT,
    end_date TEXT,
    image_url TEXT,
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ SERVICE REQUESTS ═══
  run(`CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_number TEXT UNIQUE NOT NULL,
    visitor_id INTEGER,
    visitor_name TEXT NOT NULL,
    visitor_phone TEXT,
    request_type TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    location TEXT,
    latitude REAL,
    longitude REAL,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    assigned_to INTEGER,
    fulfilled_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ TASKS ═══
  run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    task_type TEXT NOT NULL,
    assigned_to INTEGER,
    created_by INTEGER,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    location TEXT,
    latitude REAL,
    longitude REAL,
    due_date TEXT,
    proof_photo_url TEXT,
    points_reward INTEGER DEFAULT 10,
    rejection_reason TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ TASK ASSIGNMENTS ═══
  run(`CREATE TABLE IF NOT EXISTS task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    volunteer_id INTEGER NOT NULL,
    status TEXT DEFAULT 'assigned',
    notes TEXT,
    assigned_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    UNIQUE(task_id, volunteer_id)
  )`);

  // ═══ LOCATIONS ═══
  run(`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volunteer_id INTEGER,
    task_id INTEGER,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ NOTIFICATIONS ═══
  run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    action_url TEXT,
    is_read INTEGER DEFAULT 0,
    sent_push INTEGER DEFAULT 0,
    sent_sms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ AUDIT LOGS ═══
  run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    old_values TEXT,
    new_values TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ SETTINGS ═══
  run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ STATS ═══
  run(`CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_key TEXT UNIQUE NOT NULL,
    stat_value INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ POINTS LOG ═══
  run(`CREATE TABLE IF NOT EXISTS points_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volunteer_id INTEGER,
    points INTEGER NOT NULL,
    reason TEXT NOT NULL,
    task_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ VERIFICATION LOGS (Nusuk) ═══
  run(`CREATE TABLE IF NOT EXISTS verification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permit_number TEXT,
    passport_number TEXT,
    visitor_type TEXT,
    status TEXT,
    checked_by INTEGER,
    result TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══ REPORTS ═══
  run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    title TEXT,
    file_url TEXT,
    generated_by INTEGER,
    parameters TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Initialize stats
  const statKeys = [
    'total_water_bottles','total_meals','total_prayer_beads',
    'total_volunteers','total_donors','total_requests','total_donations_amount'
  ];
  statKeys.forEach(k => {
    _syncDb._db.run(`INSERT OR IGNORE INTO stats (stat_key, stat_value) VALUES (?, 0)`, [k]);
  });

  // Default settings
  const defaultSettings = [
    ['app_name', 'سقيا الحرمين'],
    ['app_slogan', 'نسعى لسقيا ضيوف الرحمن'],
    ['primary_color', '#0B3D1E'],
    ['gold_color', '#D4AF37'],
    ['sms_provider', 'mock'],
    ['payment_mode', 'sandbox'],
    ['otp_expiry_minutes', '5'],
    ['max_login_attempts', '5'],
    ['lockout_minutes', '15']
  ];
  defaultSettings.forEach(([key, value]) => {
    _syncDb._db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  });

  _syncDb._scheduleSave();
  console.log('✅ Database initialized - All tables ready');
  return _syncDb;
}

function updateStats(key, increment = 1) {
  if (!_syncDb) return;
  _syncDb._db.run(
    `UPDATE stats SET stat_value = stat_value + ?, updated_at = datetime('now') WHERE stat_key = ?`,
    [increment, key]
  );
  _syncDb._scheduleSave();
}

const dbProxy = new Proxy({}, {
  get(target, prop) {
    if (!_syncDb) throw new Error('Database not initialized');
    return _syncDb[prop];
  }
});

module.exports = { db: dbProxy, initializeDatabase, updateStats };
