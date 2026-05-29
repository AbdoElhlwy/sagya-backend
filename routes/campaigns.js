// routes/campaigns.js - سقيا الحرمين | الحملات
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateUUID } = require('../utils/helpers');

// قائمة الحملات
router.get('/', async (req, res) => {
  const { status = 'active', page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM campaigns';
  let params = [];
  
  if (status !== 'all') {
    query += ' WHERE status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  
  const campaigns = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM campaigns' + (status !== 'all' ? ' WHERE status = ?' : '')).get(...(status !== 'all' ? [status] : []));
  
  res.json({ success: true, data: campaigns, total: total.count });
});

// حملة واحدة
router.get('/:id', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'الحملة غير موجودة' });
  res.json({ success: true, data: campaign });
});

// إنشاء حملة (admin)
router.post('/', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const {
    title, description, campaign_type = 'water',
    target_amount = 0, target_bottles = 0,
    location, latitude, longitude,
    start_date, end_date, image_url
  } = req.body;

  if (!title) return res.status(400).json({ success: false, message: 'عنوان الحملة مطلوب' });

  const result = db.prepare(`
    INSERT INTO campaigns (title, description, campaign_type, target_amount, target_bottles, location, latitude, longitude, start_date, end_date, image_url, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description, campaign_type, target_amount, target_bottles, location, latitude, longitude, start_date, end_date, image_url, req.user.id);

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'تم إنشاء الحملة', data: campaign });
});

// تحديث حملة
router.put('/:id', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'الحملة غير موجودة' });

  const { title, description, status, target_amount, current_amount, target_bottles, current_bottles, location, start_date, end_date } = req.body;

  db.prepare(`
    UPDATE campaigns SET 
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      status = COALESCE(?, status),
      target_amount = COALESCE(?, target_amount),
      current_amount = COALESCE(?, current_amount),
      target_bottles = COALESCE(?, target_bottles),
      current_bottles = COALESCE(?, current_bottles),
      location = COALESCE(?, location),
      start_date = COALESCE(?, start_date),
      end_date = COALESCE(?, end_date),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(title, description, status, target_amount, current_amount, target_bottles, current_bottles, location, start_date, end_date, req.params.id);

  res.json({ success: true, message: 'تم تحديث الحملة' });
});

// حذف حملة
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  db.prepare(`UPDATE campaigns SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
  res.json({ success: true, message: 'تم إلغاء الحملة' });
});

module.exports = router;
