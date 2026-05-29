// middleware/auth.js - سقيا الحرمين | المصادقة والأمان
const jwt = require('jsonwebtoken');

const JWT_SECRET      = process.env.JWT_SECRET || 'sagya_haramain_secret_CHANGE_IN_PROD_2024';
const JWT_EXPIRES_IN  = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXP = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

function generateToken(userId, role) {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function generateRefreshToken(userId, deviceId = null) {
  const token = jwt.sign({ id: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXP });
  try {
    const { db } = require('../database/db');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT OR REPLACE INTO refresh_tokens (user_id, token, device_id, expires_at) VALUES (?, ?, ?, ?)`)
      .run(userId, token, deviceId, expiresAt);
  } catch (_) {}
  return token;
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'لم يتم توفير توكن المصادقة', code: 'NO_TOKEN' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type === 'refresh') {
      return res.status(401).json({ success: false, message: 'نوع التوكن غير صحيح' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'توكن غير صالح', code: 'INVALID_TOKEN' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    // super_admin له كل الصلاحيات دائماً
    if (req.user.role === 'super_admin') return next();
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بهذا الإجراء', code: 'FORBIDDEN' });
    }
    next();
  };
}

function revokeRefreshToken(userId, token) {
  try {
    const { db } = require('../database/db');
    db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ? AND token = ?`).run(userId, token);
  } catch (_) {}
}

function revokeAllTokens(userId) {
  try {
    const { db } = require('../database/db');
    db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).run(userId);
  } catch (_) {}
}

// Audit log helper
function logAudit(userId, action, entityType, entityId, req) {
  try {
    const { db } = require('../database/db');
    db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userId, action, entityType, entityId, req?.ip, req?.headers?.['user-agent']);
  } catch (_) {}
}

module.exports = {
  generateToken,
  generateRefreshToken,
  authenticate,
  authorize,
  revokeRefreshToken,
  revokeAllTokens,
  logAudit
};
