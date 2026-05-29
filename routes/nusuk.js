// routes/nusuk.js - سقيا الحرمين | التكامل مع نسك (مستقبلي)
// ⚠️ تنبيه: هذا الوحدة جاهزة للربط المستقبلي مع منصة نسك.
// الربط الرسمي يتطلب موافقات رسمية وحساب مطور معتمد من نسك.
// حالياً تعمل في وضع Mock للتطوير فقط.

const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');

const NUSUK_PROVIDER = process.env.NUSUK_PROVIDER || 'mock';
const NUSUK_API_URL  = process.env.NUSUK_API_URL  || 'https://api.nusuk.sa/v1';
const NUSUK_API_KEY  = process.env.NUSUK_API_KEY  || '';

// ═══ Mock Provider (للتطوير) ═══
const mockVerify = (permitNumber, passportNumber) => {
  // بيانات وهمية للتطوير فقط
  if (permitNumber === 'MOCK-ERROR') {
    return { found: false, status: 'not_found', message: 'رقم التصريح غير موجود' };
  }
  
  const mockVisitors = {
    'H-2024-001': { type: 'hajj', name: 'محمد عبدالله', nationality: 'SA', status: 'approved', permit_date: '2024-06-01', expiry_date: '2024-07-15' },
    'U-2024-001': { type: 'umrah', name: 'فاطمة أحمد', nationality: 'EG', status: 'approved', permit_date: '2024-11-01', expiry_date: '2024-11-30' },
    'V-2024-001': { type: 'visitor', name: 'Ahmed Hassan', nationality: 'US', status: 'approved', permit_date: '2024-01-01', expiry_date: '2024-12-31' },
  };

  const visitor = mockVisitors[permitNumber];
  if (!visitor) {
    return { found: false, status: 'not_found', message: 'رقم التصريح غير موجود في النظام' };
  }

  // Check expiry
  if (new Date(visitor.expiry_date) < new Date()) {
    return { found: true, status: 'expired', visitor: { ...visitor, permit_number: permitNumber } };
  }

  return { found: true, status: 'approved', visitor: { ...visitor, permit_number: permitNumber } };
};

// ═══ التحقق من تصريح الزائر ═══
router.post('/verify', authenticate, async (req, res) => {
  const { permit_number, passport_number } = req.body;

  if (!permit_number) {
    return res.status(400).json({ success: false, message: 'رقم التصريح مطلوب' });
  }

  let result;

  if (NUSUK_PROVIDER === 'mock' || !NUSUK_API_KEY) {
    // Mock mode
    result = mockVerify(permit_number, passport_number);
  } else {
    // Real Nusuk API (يُفعّل عند توفر المفتاح الرسمي)
    try {
      const axios = require('axios');
      const response = await axios.post(`${NUSUK_API_URL}/permits/verify`, {
        permit_number,
        passport_number
      }, {
        headers: {
          'Authorization': `Bearer ${NUSUK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      result = response.data;
    } catch (err) {
      console.error('Nusuk API error:', err.message);
      return res.status(503).json({ success: false, message: 'خطأ في الاتصال بمنصة نسك' });
    }
  }

  // Log verification
  db.prepare(`
    INSERT INTO verification_logs (permit_number, passport_number, visitor_type, status, checked_by, result)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    permit_number,
    passport_number || null,
    result.visitor?.type || null,
    result.status,
    req.user.id,
    JSON.stringify(result)
  );

  const visitorTypeMap = {
    hajj: 'حاج',
    umrah: 'معتمر',
    visitor: 'زائر'
  };

  const statusMap = {
    approved: { label: 'معتمد', color: '#28a745' },
    expired: { label: 'منتهي', color: '#dc3545' },
    not_found: { label: 'غير موجود', color: '#6c757d' },
    suspended: { label: 'موقوف', color: '#dc3545' },
    pending_review: { label: 'تحت المراجعة', color: '#ffc107' }
  };

  const statusInfo = statusMap[result.status] || statusMap['not_found'];

  res.json({
    success: true,
    is_mock: NUSUK_PROVIDER === 'mock',
    data: {
      found: result.found,
      status: result.status,
      status_label: statusInfo.label,
      status_color: statusInfo.color,
      visitor: result.visitor ? {
        ...result.visitor,
        type_label: visitorTypeMap[result.visitor.type] || result.visitor.type
      } : null,
      message: result.message || (result.found ? 'تم التحقق من الزائر بنجاح' : 'لم يتم العثور على الزائر'),
      verified_at: new Date().toISOString()
    }
  });
});

// ═══ سجل التحققات ═══
router.get('/logs', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  const logs = db.prepare(`
    SELECT vl.*, u.full_name as checked_by_name
    FROM verification_logs vl
    LEFT JOIN users u ON vl.checked_by = u.id
    ORDER BY vl.created_at DESC
    LIMIT ? OFFSET ?
  `).all(parseInt(limit), offset);
  
  const total = db.prepare('SELECT COUNT(*) as count FROM verification_logs').get();
  
  res.json({ success: true, data: logs, total: total.count });
});

// ═══ إحصائيات التحقق ═══
router.get('/stats', authenticate, authorize('admin'), async (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM verification_logs').get();
  const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM verification_logs GROUP BY status`).all();
  const byType = db.prepare(`SELECT visitor_type, COUNT(*) as count FROM verification_logs WHERE visitor_type IS NOT NULL GROUP BY visitor_type`).all();
  const today = db.prepare(`SELECT COUNT(*) as count FROM verification_logs WHERE created_at > date('now')`).get();
  
  res.json({
    success: true,
    note: NUSUK_PROVIDER === 'mock' ? 'يعمل في وضع المحاكاة' : 'يعمل مع API نسك الرسمي',
    data: { total: total.count, today: today.count, by_status: byStatus, by_type: byType }
  });
});

module.exports = router;
