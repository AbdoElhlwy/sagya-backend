// routes/auth.js - سقيا الحرمين | مسارات المصادقة
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { db } = require('../database/db');
const { generateToken, generateRefreshToken, authenticate, revokeRefreshToken, revokeAllTokens, logAudit } = require('../middleware/auth');
const { generateUUID, sanitizeInput } = require('../utils/helpers');

// ═══ OTP Helper ═══
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTP(phone, code) {
  const provider = process.env.SMS_PROVIDER || 'mock';
  
  if (provider === 'mock' || process.env.NODE_ENV === 'development') {
    console.log(`📱 [OTP Mock] Phone: ${phone} | Code: ${code}`);
    return true;
  }
  
  // Twilio
  if (provider === 'twilio') {
    try {
      const client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      await client.messages.create({
        body: `رمز التحقق الخاص بك في سقيا الحرمين: ${code}\nصالح لمدة 5 دقائق`,
        from: process.env.TWILIO_PHONE,
        to: phone
      });
      return true;
    } catch (e) { console.error('Twilio error:', e.message); return false; }
  }
  
  // Unifonic / Msegat / Taqnyat - all use similar REST API
  if (['unifonic', 'msegat', 'taqnyat'].includes(provider)) {
    try {
      const axios = require('axios');
      const urls = {
        unifonic: 'https://el.unifonic.com/rest/SMS/messages',
        msegat: 'https://www.msegat.com/gw/sendsms.php',
        taqnyat: 'https://api.taqnyat.sa/v1/messages'
      };
      await axios.post(urls[provider], {
        AppSid: process.env.SMS_APP_SID,
        SenderID: process.env.SMS_SENDER_ID,
        Body: `رمز التحقق: ${code} - سقيا الحرمين`,
        Recipient: phone
      }, { headers: { Authorization: `Bearer ${process.env.SMS_API_KEY}` } });
      return true;
    } catch (e) { console.error('SMS error:', e.message); return false; }
  }
  
  return false;
}

// ═══ تسجيل الدخول ═══
router.post('/login', [
  body('phone').notEmpty().withMessage('رقم الجوال مطلوب'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { phone, password, device_id, device_name, fcm_token, expo_push_token } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone.trim());
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'رقم الجوال أو كلمة المرور غير صحيحة' });
  }

  if (!user.is_active) {
    return res.status(403).json({ success: false, message: 'هذا الحساب موقوف، يرجى التواصل مع الإدارة' });
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(429).json({ success: false, message: `الحساب مقفل مؤقتاً، حاول بعد ${remaining} دقيقة` });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  
  if (!isValid) {
    const newAttempts = (user.failed_attempts || 0) + 1;
    const maxAttempts = 5;
    
    if (newAttempts >= maxAttempts) {
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare(`UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?`)
        .run(newAttempts, lockedUntil, user.id);
      return res.status(429).json({ success: false, message: 'تم قفل الحساب مؤقتاً لمدة 15 دقيقة بسبب المحاولات المتكررة' });
    }
    
    db.prepare(`UPDATE users SET failed_attempts = ? WHERE id = ?`).run(newAttempts, user.id);
    return res.status(401).json({ success: false, message: 'رقم الجوال أو كلمة المرور غير صحيحة', remaining: maxAttempts - newAttempts });
  }

  // Reset failed attempts
  db.prepare(`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = datetime('now'), last_ip = ? WHERE id = ?`)
    .run(req.ip, user.id);

  // Save device info
  if (device_id) {
    db.prepare(`
      INSERT INTO devices (user_id, device_id, device_name, fcm_token, expo_push_token, last_seen)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, device_id) DO UPDATE SET device_name=excluded.device_name, fcm_token=excluded.fcm_token, expo_push_token=excluded.expo_push_token, last_seen=datetime('now')
    `).run(user.id, device_id, device_name || 'Unknown', fcm_token, expo_push_token);
  }

  // Update push tokens on user
  if (fcm_token || expo_push_token) {
    db.prepare(`UPDATE users SET fcm_token = COALESCE(?, fcm_token), expo_push_token = COALESCE(?, expo_push_token) WHERE id = ?`)
      .run(fcm_token, expo_push_token, user.id);
  }

  let volunteerData = null;
  if (user.role === 'volunteer') {
    volunteerData = db.prepare('SELECT status, points, badge, qr_code_url, membership_number FROM volunteer_applications WHERE user_id = ?').get(user.id);
  }

  const token = generateToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id, device_id);

  logAudit(user.id, 'LOGIN', 'user', user.id, req);

  res.json({
    success: true,
    message: 'تم تسجيل الدخول بنجاح',
    data: {
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        uuid: user.uuid,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        volunteer: volunteerData
      }
    }
  });
});

// ═══ تسجيل حساب جديد ═══
router.post('/register', [
  body('full_name').notEmpty().trim().withMessage('الاسم الكامل مطلوب'),
  body('phone').notEmpty().withMessage('رقم الجوال مطلوب'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { full_name, phone, email, password, role = 'visitor', device_id, fcm_token, expo_push_token } = req.body;

  if (['admin', 'supervisor'].includes(role)) {
    return res.status(403).json({ success: false, message: 'لا يمكن إنشاء هذا النوع من الحسابات' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone.trim());
  if (existing) {
    return res.status(409).json({ success: false, message: 'رقم الجوال مسجل مسبقاً' });
  }

  const hashedPassword = bcrypt.hashSync(password, 12);
  const uuid = generateUUID();

  const result = db.prepare(`
    INSERT INTO users (uuid, full_name, phone, email, password_hash, role, fcm_token, expo_push_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid, sanitizeInput(full_name), phone.trim(), email?.trim() || null, hashedPassword, role, fcm_token || null, expo_push_token || null);

  const newUser = db.prepare('SELECT id, uuid, full_name, phone, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = generateToken(newUser.id, newUser.role);
  const refreshToken = generateRefreshToken(newUser.id, device_id);

  logAudit(newUser.id, 'REGISTER', 'user', newUser.id, req);

  res.status(201).json({
    success: true,
    message: 'تم إنشاء الحساب بنجاح',
    data: { token, refresh_token: refreshToken, user: newUser }
  });
});

// ═══ دخول الإدارة ═══
router.post('/admin-login', [
  body('phone').notEmpty(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { phone, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE phone = ? AND role IN ('admin', 'supervisor') AND is_active = 1`).get(phone.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(429).json({ success: false, message: 'الحساب مقفل مؤقتاً' });
  }

  db.prepare(`UPDATE users SET last_login = datetime('now'), last_ip = ?, failed_attempts = 0 WHERE id = ?`)
    .run(req.ip, user.id);

  const token = generateToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id);

  logAudit(user.id, 'ADMIN_LOGIN', 'user', user.id, req);

  res.json({
    success: true,
    message: 'مرحباً بك في لوحة التحكم',
    data: {
      token,
      refresh_token: refreshToken,
      user: { id: user.id, full_name: user.full_name, phone: user.phone, role: user.role }
    }
  });
});

// ═══ طلب OTP ═══
router.post('/otp/send', [
  body('phone').notEmpty().withMessage('رقم الجوال مطلوب')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { phone } = req.body;
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Invalidate old OTPs
  db.prepare(`UPDATE otp_codes SET is_used = 1 WHERE phone = ?`).run(phone.trim());

  // Create new OTP
  db.prepare(`INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)`).run(phone.trim(), code, expiresAt);

  const sent = await sendOTP(phone.trim(), code);

  // In development, return code in response for testing
  const isDev = process.env.NODE_ENV === 'development' || process.env.SMS_PROVIDER === 'mock';
  
  res.json({
    success: true,
    message: 'تم إرسال رمز التحقق',
    ...(isDev && { debug_code: code, note: 'Development mode only' })
  });
});

// ═══ التحقق من OTP ═══
router.post('/otp/verify', [
  body('phone').notEmpty(),
  body('code').notEmpty().isLength({ min: 6, max: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'رمز التحقق غير صحيح' });
  }

  const { phone, code } = req.body;

  const otp = db.prepare(`
    SELECT * FROM otp_codes 
    WHERE phone = ? AND code = ? AND is_used = 0 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(phone.trim(), code);

  if (!otp) {
    // Track failed attempts
    db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ? AND is_used = 0`).run(phone.trim());
    return res.status(400).json({ success: false, message: 'رمز التحقق غير صحيح أو منتهي الصلاحية' });
  }

  if (otp.attempts >= 3) {
    return res.status(429).json({ success: false, message: 'تجاوزت عدد المحاولات، طلب رمزاً جديداً' });
  }

  // Mark as used
  db.prepare(`UPDATE otp_codes SET is_used = 1 WHERE id = ?`).run(otp.id);

  // Find or create user
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone.trim());
  
  if (!user) {
    const uuid = generateUUID();
    const tempPassword = bcrypt.hashSync(generateUUID(), 10);
    const result = db.prepare(`INSERT INTO users (uuid, full_name, phone, password_hash, role) VALUES (?, ?, ?, ?, 'visitor')`)
      .run(uuid, phone.trim(), phone.trim(), tempPassword);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }

  const token = generateToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    success: true,
    message: 'تم التحقق بنجاح',
    data: {
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        uuid: user.uuid,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        is_new: !user.full_name || user.full_name === user.phone
      }
    }
  });
});

// ═══ تجديد التوكن ═══
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ success: false, message: 'Refresh token مطلوب' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'sagya_haramain_secret_CHANGE_IN_PROD_2024';
    const decoded = jwt.verify(refresh_token, JWT_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ success: false, message: 'نوع التوكن غير صحيح' });
    }

    const stored = db.prepare('SELECT id FROM refresh_tokens WHERE user_id = ? AND token = ? AND expires_at > datetime("now")').get(decoded.id, refresh_token);
    if (!stored) {
      return res.status(401).json({ success: false, message: 'تم إبطال هذه الجلسة' });
    }

    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'الحساب غير نشط' });
    }

    const newToken = generateToken(user.id, user.role);
    res.json({ success: true, data: { token: newToken } });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Refresh token منتهي أو غير صالح' });
  }
});

// ═══ تسجيل الخروج ═══
router.post('/logout', authenticate, async (req, res) => {
  const { refresh_token, all_devices } = req.body;

  if (all_devices) {
    revokeAllTokens(req.user.id);
    logAudit(req.user.id, 'LOGOUT_ALL', 'user', req.user.id, req);
    return res.json({ success: true, message: 'تم تسجيل الخروج من كل الأجهزة' });
  }

  if (refresh_token) {
    revokeRefreshToken(req.user.id, refresh_token);
  }

  logAudit(req.user.id, 'LOGOUT', 'user', req.user.id, req);
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
});

// ═══ تغيير كلمة المرور ═══
router.put('/change-password', authenticate, [
  body('old_password').notEmpty(),
  body('new_password').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { old_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!bcrypt.compareSync(old_password, user.password_hash)) {
    return res.status(400).json({ success: false, message: 'كلمة المرور القديمة غير صحيحة' });
  }

  const newHash = bcrypt.hashSync(new_password, 12);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(newHash, req.user.id);

  logAudit(req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id, req);
  res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
});

// ═══ بيانات المستخدم الحالي ═══
router.get('/me', authenticate, async (req, res) => {
  const user = db.prepare('SELECT id, uuid, full_name, phone, email, role, avatar_url, created_at FROM users WHERE id = ?').get(req.user.id);
  
  if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

  let volunteerData = null;
  if (user.role === 'volunteer') {
    volunteerData = db.prepare('SELECT * FROM volunteer_applications WHERE user_id = ?').get(user.id);
  }

  res.json({ success: true, data: { ...user, volunteer: volunteerData } });
});

module.exports = router;
