// routes/donations.js - مسارات التبرعات
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { db, updateStats } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateTrackingNumber } = require('../utils/helpers');

// إنشاء تبرع جديد
router.post('/', [
  body('donor_name').notEmpty().trim().withMessage('اسم المتبرع مطلوب'),
  body('donor_phone').notEmpty().withMessage('رقم الجوال مطلوب'),
  body('donation_type').isIn(['water','meals','prayer_beads','qurans','wheelchairs','general']).withMessage('نوع التبرع غير صالح'),
  body('quantity').isInt({ min: 1 }).withMessage('الكمية يجب أن تكون أكبر من 0')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { donor_name, donor_phone, donation_type, quantity, amount, notes } = req.body;
  const donor_id = req.user?.id || null;
  const tracking_number = generateTrackingNumber('SQ');

  const result = db.prepare(`
    INSERT INTO donations (tracking_number, donor_id, donor_name, donor_phone, donation_type, quantity, amount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tracking_number, donor_id, donor_name.trim(), donor_phone.trim(), donation_type, parseInt(quantity), parseFloat(amount) || 0, notes || null);

  // تحديث الإحصائيات
  const statMap = {
    water: 'total_water_bottles',
    meals: 'total_meals',
    prayer_beads: 'total_prayer_beads'
  };
  if (statMap[donation_type]) updateStats(statMap[donation_type], parseInt(quantity));

  // سجل نشاط إن كان مسجلاً
  if (donor_id) {
    db.prepare(`INSERT INTO activity_logs (user_id, action, details) VALUES (?,?,?)`).run(
      donor_id, 'donation_created', `تبرع بـ ${quantity} من ${donation_type}`
    );
  }

  res.status(201).json({
    success: true,
    message: 'تم استلام تبرعك بنجاح، جزاك الله خيراً',
    data: { tracking_number, donation_id: result.lastInsertRowid }
  });
});

// متابعة التبرع برقم التتبع
router.get('/track/:tracking_number', (req, res) => {
  const donation = db.prepare('SELECT * FROM donations WHERE tracking_number = ?').get(req.params.tracking_number);
  if (!donation) return res.status(404).json({ success: false, message: 'رقم التتبع غير صحيح' });

  const distributions = db.prepare(`
    SELECT dd.*, u.full_name as volunteer_name
    FROM donation_distributions dd
    LEFT JOIN users u ON u.id = dd.volunteer_id
    WHERE dd.donation_id = ?
  `).all(donation.id);

  res.json({ success: true, data: { donation, distributions } });
});

// تبرعات المتبرع
router.get('/my-donations', authenticate, (req, res) => {
  const donations = db.prepare(`
    SELECT * FROM donations WHERE donor_id = ? ORDER BY created_at DESC
  `).all(req.user.id);

  res.json({ success: true, data: donations });
});

// كل التبرعات (للإدارة)
router.get('/all', authenticate, authorize('admin'), (req, res) => {
  const { status, type, page = 1, limit = 20 } = req.query;
  let conditions = [];
  let params = [];
  
  if (status) { conditions.push('d.status = ?'); params.push(status); }
  if (type) { conditions.push('d.donation_type = ?'); params.push(type); }
  
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const donations = db.prepare(`
    SELECT d.*, u.full_name as donor_account_name
    FROM donations d
    LEFT JOIN users u ON u.id = d.donor_id
    ${where}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM donations d ${where}`).get(...params);

  res.json({ success: true, data: donations, total: total.count });
});

// تحديث حالة التبرع (إدارة)
router.patch('/:id/status', authenticate, authorize('admin'), (req, res) => {
  const { status } = req.body;
  if (!['received', 'processing', 'distributed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'الحالة غير صالحة' });
  }

  const updates = status === 'distributed' ? 
    `status = ?, distributed_at = datetime('now')` : `status = ?`;
  const params = status === 'distributed' ? [status, req.params.id] : [status, req.params.id];

  db.prepare(`UPDATE donations SET ${updates} WHERE id = ?`).run(...params);
  res.json({ success: true, message: 'تم تحديث حالة التبرع' });
});

// إحصائيات التبرعات العامة (عداد مباشر)
router.get('/public-stats', (req, res) => {
  const stats = db.prepare('SELECT * FROM stats').all();
  const donations = db.prepare(`
    SELECT donation_type, SUM(quantity) as total FROM donations WHERE status = 'distributed' GROUP BY donation_type
  `).all();

  res.json({ success: true, data: { stats, donations_by_type: donations } });
});

module.exports = router;
