// routes/requests.js - مسارات طلبات الخدمة
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { db, updateStats } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateTrackingNumber, sanitizeInput } = require('../utils/helpers');

// تقديم طلب خدمة (زائر - لا يحتاج تسجيل دخول)
router.post('/', [
  body('visitor_name').notEmpty().trim().withMessage('اسم الزائر مطلوب'),
  body('request_type').isIn(['water','meal','prayer_beads','help','report']).withMessage('نوع الطلب غير صالح'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('الكمية يجب أن تكون أكبر من 0')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { visitor_name, visitor_phone, request_type, quantity, location, latitude, longitude, notes } = req.body;
  const visitor_id = req.user?.id || null;
  const tracking_number = generateTrackingNumber('REQ');

  const result = db.prepare(`
    INSERT INTO service_requests 
    (tracking_number, visitor_id, visitor_name, visitor_phone, request_type, quantity, location, latitude, longitude, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tracking_number, visitor_id, sanitizeInput(visitor_name),
    visitor_phone || null, request_type, parseInt(quantity) || 1,
    location || null, latitude || null, longitude || null, notes || null
  );

  updateStats('total_requests', 1);

  res.status(201).json({
    success: true,
    message: 'تم استلام طلبك، سيتم الرد عليك قريباً إن شاء الله',
    data: { tracking_number, request_id: result.lastInsertRowid }
  });
});

// متابعة الطلب
router.get('/track/:tracking_number', (req, res) => {
  const request = db.prepare(`
    SELECT sr.*, u.full_name as assigned_volunteer_name
    FROM service_requests sr
    LEFT JOIN users u ON u.id = sr.assigned_to
    WHERE sr.tracking_number = ?
  `).get(req.params.tracking_number);

  if (!request) return res.status(404).json({ success: false, message: 'رقم التتبع غير صحيح' });
  res.json({ success: true, data: request });
});

// طلبات الزائر
router.get('/my-requests', authenticate, (req, res) => {
  const requests = db.prepare(`
    SELECT * FROM service_requests WHERE visitor_id = ? ORDER BY created_at DESC
  `).all(req.user.id);
  res.json({ success: true, data: requests });
});

// كل الطلبات (إدارة)
router.get('/all', authenticate, authorize('admin'), (req, res) => {
  const { status, type } = req.query;
  let conditions = [];
  if (status) conditions.push(`sr.status = '${status}'`);
  if (type) conditions.push(`sr.request_type = '${type}'`);
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const requests = db.prepare(`
    SELECT sr.*, u.full_name as assigned_volunteer_name
    FROM service_requests sr
    LEFT JOIN users u ON u.id = sr.assigned_to
    ${where}
    ORDER BY sr.created_at DESC LIMIT 100
  `).all();

  res.json({ success: true, data: requests });
});

// تعيين متطوع لطلب (إدارة)
router.patch('/:id/assign', authenticate, authorize('admin'), (req, res) => {
  const { volunteer_id } = req.body;
  db.prepare(`UPDATE service_requests SET assigned_to = ?, status = 'assigned' WHERE id = ?`)
    .run(volunteer_id, req.params.id);
  res.json({ success: true, message: 'تم تعيين المتطوع بنجاح' });
});

// إتمام الطلب
router.patch('/:id/fulfill', authenticate, authorize('volunteer', 'admin'), (req, res) => {
  db.prepare(`
    UPDATE service_requests SET status = 'fulfilled', fulfilled_at = datetime('now') WHERE id = ?
  `).run(req.params.id);
  res.json({ success: true, message: 'تم إتمام الطلب بنجاح' });
});

module.exports = router;
