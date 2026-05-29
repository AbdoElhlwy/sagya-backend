// routes/qr.js - سقيا الحرمين | نظام QR Code
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { db } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateUUID } = require('../utils/helpers');
const path = require('path');
const fs = require('fs');

const QR_BASE_URL = process.env.APP_URL || 'https://sagya-backend.onrender.com';
const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(__dirname, '../uploads');

// توليد QR لمتطوع
router.post('/generate/:volunteer_id', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const volunteer = db.prepare('SELECT * FROM volunteer_applications WHERE id = ?').get(req.params.volunteer_id);
    if (!volunteer) return res.status(404).json({ success: false, message: 'المتطوع غير موجود' });

    const code = generateUUID().replace(/-/g, '').substring(0, 16).toUpperCase();
    const memberNum = volunteer.membership_number || `SH-${String(volunteer.id).padStart(5, '0')}`;
    const verifyUrl = `${QR_BASE_URL}/verify/${code}`;

    // Generate QR image
    const qrDir = path.join(UPLOADS_PATH, 'qr_codes');
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
    const filename = `qr_${volunteer.id}_${Date.now()}.png`;
    const qrPath = path.join(qrDir, filename);

    await QRCode.toFile(qrPath, verifyUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#0B3D1E', light: '#FFFFFF' }
    });

    const qrUrl = `/uploads/qr_codes/${filename}`;

    // Deactivate old QR codes
    db.prepare(`UPDATE qr_codes SET is_active = 0 WHERE volunteer_id = ?`).run(volunteer.id);

    // Save new QR
    const result = db.prepare(`
      INSERT INTO qr_codes (volunteer_id, code, membership_number, is_active)
      VALUES (?, ?, ?, 1)
    `).run(volunteer.id, code, memberNum);

    // Update volunteer
    db.prepare(`UPDATE volunteer_applications SET qr_code_url = ?, qr_code = ?, membership_number = ? WHERE id = ?`)
      .run(qrUrl, code, memberNum, volunteer.id);

    res.json({
      success: true,
      message: 'تم توليد QR بنجاح',
      data: {
        code,
        membership_number: memberNum,
        qr_url: qrUrl,
        verify_url: verifyUrl,
        volunteer_name: volunteer.full_name
      }
    });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ success: false, message: 'خطأ في توليد QR: ' + err.message });
  }
});

// التحقق من QR (مسار عام)
router.get('/verify/:code', async (req, res) => {
  const { code } = req.params;
  
  const qr = db.prepare(`
    SELECT q.*, va.full_name, va.phone, va.city, va.status as vol_status,
           va.points, va.badge, va.created_at as joined_at, va.nationality,
           va.profession, va.approved_at, u.avatar_url
    FROM qr_codes q
    LEFT JOIN volunteer_applications va ON q.volunteer_id = va.id
    LEFT JOIN users u ON va.user_id = u.id
    WHERE q.code = ?
  `).get(code);

  if (!qr) {
    return res.json({ success: false, status: 'not_found', message: 'رمز QR غير موجود' });
  }

  if (!qr.is_active) {
    return res.json({ success: false, status: 'revoked', message: 'تم إلغاء هذا الرمز' });
  }

  // Log scan
  db.prepare(`UPDATE qr_codes SET scan_count = scan_count + 1, last_scanned = datetime('now') WHERE code = ?`).run(code);

  const statusMap = {
    approved: 'verified',
    pending: 'pending',
    rejected: 'rejected'
  };

  res.json({
    success: true,
    status: statusMap[qr.vol_status] || 'unknown',
    data: {
      full_name: qr.full_name,
      membership_number: qr.membership_number,
      status: qr.vol_status,
      city: qr.city,
      nationality: qr.nationality,
      profession: qr.profession,
      badge: qr.badge,
      points: qr.points,
      joined_at: qr.joined_at,
      approved_at: qr.approved_at,
      avatar_url: qr.avatar_url,
      verified_at: new Date().toISOString()
    }
  });
});

// إلغاء QR
router.delete('/:volunteer_id', authenticate, authorize('admin'), async (req, res) => {
  db.prepare(`UPDATE qr_codes SET is_active = 0 WHERE volunteer_id = ?`).run(req.params.volunteer_id);
  db.prepare(`UPDATE volunteer_applications SET qr_code_url = NULL, qr_code = NULL WHERE id = ?`).run(req.params.volunteer_id);
  res.json({ success: true, message: 'تم إلغاء QR بنجاح' });
});

// قائمة QR للمتطوع
router.get('/volunteer/:volunteer_id', authenticate, async (req, res) => {
  const codes = db.prepare(`SELECT * FROM qr_codes WHERE volunteer_id = ? ORDER BY generated_at DESC`).all(req.params.volunteer_id);
  res.json({ success: true, data: codes });
});

module.exports = router;
