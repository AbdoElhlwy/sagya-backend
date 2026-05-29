// server.js - سقيا الحرمين | الخادم الرئيسي - الإصدار الإنتاجي
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { initializeDatabase } = require('./database/db');
const errorHandler = require('./middleware/errorHandler');

// استيراد المسارات
const authRoutes         = require('./routes/auth');
const userRoutes         = require('./routes/users');
const volunteerRoutes    = require('./routes/volunteers');
const donationRoutes     = require('./routes/donations');
const requestRoutes      = require('./routes/requests');
const taskRoutes         = require('./routes/tasks');
const adminRoutes        = require('./routes/admin');
const statsRoutes        = require('./routes/stats');
const { router: notifRoutes } = require('./routes/notifications');
const leaderboardRoutes  = require('./routes/leaderboard');
const qrRoutes           = require('./routes/qr');
const campaignRoutes     = require('./routes/campaigns');
const paymentRoutes      = require('./routes/payments');
const nusukRoutes        = require('./routes/nusuk');
const reportRoutes       = require('./routes/reports');

const app  = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// ===== تهيئة مجلدات الرفع =====
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads');
['id_photos','personal_photos','task_proofs','donation_receipts','qr_codes','reports'].forEach(dir => {
  const fullPath = path.join(uploadsDir, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ===== Middleware =====
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));
app.use(compression());

if (NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// CORS
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Device-ID']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, message: 'طلبات كثيرة جداً، يرجى المحاولة لاحقاً' },
  standardHeaders: true,
  legacyHeaders: false
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'محاولات كثيرة جداً، يرجى المحاولة بعد 15 دقيقة' }
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// خدمة الملفات الثابتة
app.use('/uploads', express.static(uploadsDir));

// ===== المسارات الرئيسية =====
// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({
    success: true,
    app: 'سقيا الحرمين',
    description: 'نسعى لسقيا ضيوف الرحمن',
    version: '2.1.0',
    status: 'running',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      api: '/api',
      docs: 'https://github.com/sagya-haramain'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Sagya Backend is running',
    version: '2.1.0',
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// ===== API Routes =====
app.use('/api/auth',         authRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/volunteers',   volunteerRoutes);
app.use('/api/donations',    donationRoutes);
app.use('/api/requests',     requestRoutes);
app.use('/api/tasks',        taskRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/stats',        statsRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/leaderboard',  leaderboardRoutes);
app.use('/api/qr',           qrRoutes);
app.use('/api/campaigns',    campaignRoutes);
app.use('/api/payments',     paymentRoutes);
app.use('/api/nusuk',        nusukRoutes);
app.use('/api/reports',      reportRoutes);

// QR Verification - Public
app.get('/verify/:code', (req, res) => {
  const { db } = require('./database/db');
  const { code } = req.params;
  
  try {
    const qr = db.prepare(`
      SELECT q.*, va.full_name, va.phone, va.city, va.status as vol_status,
             va.points, va.badge, va.created_at as joined_at, u.avatar_url
      FROM qr_codes q
      LEFT JOIN volunteer_applications va ON q.volunteer_id = va.id
      LEFT JOIN users u ON va.user_id = u.id
      WHERE q.code = ? AND q.is_active = 1
    `).get(code);

    if (!qr) {
      return res.json({
        success: false,
        status: 'not_found',
        message: 'رمز QR غير موجود أو ملغي'
      });
    }

    res.json({
      success: true,
      status: qr.vol_status === 'approved' ? 'verified' : 'not_verified',
      data: {
        full_name: qr.full_name,
        membership_number: qr.membership_number,
        status: qr.vol_status,
        city: qr.city,
        badge: qr.badge,
        points: qr.points,
        joined_at: qr.joined_at,
        verified_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التحقق' });
  }
});

// 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'المسار غير موجود',
    path: req.originalUrl,
    hint: 'تحقق من /health للتأكد من عمل السيرفر'
  });
});

// Error handler
app.use(errorHandler);

// ===== تشغيل الخادم =====
async function start() {
  await initializeDatabase();

  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🕌 ══════════════════════════════════════════ 🕌');
    console.log('     سقيا الحرمين - Backend API v2.1.0');
    console.log('     نسعى لسقيا ضيوف الرحمن');
    console.log('🕌 ══════════════════════════════════════════ 🕌');
    console.log(`✅ البيئة:    ${NODE_ENV}`);
    console.log(`✅ المنفذ:    ${PORT}`);
    console.log(`📊 الصحة:    /health`);
    console.log('══════════════════════════════════════════');
    console.log('');
  });
}

start().catch(err => {
  console.error('❌ فشل تشغيل الخادم:', err);
  process.exit(1);
});

module.exports = app;
