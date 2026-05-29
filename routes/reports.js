// routes/reports.js - سقيا الحرمين | التقارير
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(__dirname, '../uploads');

// ═══ تقرير المتطوعين ═══
router.get('/volunteers', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const { status, city, from_date, to_date } = req.query;
  
  let query = `
    SELECT va.*, u.email, u.last_login
    FROM volunteer_applications va
    LEFT JOIN users u ON va.user_id = u.id
    WHERE 1=1
  `;
  const params = [];
  
  if (status) { query += ' AND va.status = ?'; params.push(status); }
  if (city) { query += ' AND va.city LIKE ?'; params.push(`%${city}%`); }
  if (from_date) { query += ' AND va.created_at >= ?'; params.push(from_date); }
  if (to_date) { query += ' AND va.created_at <= ?'; params.push(to_date + ' 23:59:59'); }
  
  query += ' ORDER BY va.created_at DESC';
  
  const data = db.prepare(query).all(...params);
  const summary = {
    total: data.length,
    approved: data.filter(v => v.status === 'approved').length,
    pending: data.filter(v => v.status === 'pending').length,
    rejected: data.filter(v => v.status === 'rejected').length
  };
  
  res.json({ success: true, data, summary });
});

// ═══ تقرير التبرعات ═══
router.get('/donations', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const { from_date, to_date, type, status } = req.query;
  
  let query = 'SELECT * FROM donations WHERE 1=1';
  const params = [];
  
  if (type) { query += ' AND donation_type = ?'; params.push(type); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (from_date) { query += ' AND created_at >= ?'; params.push(from_date); }
  if (to_date) { query += ' AND created_at <= ?'; params.push(to_date + ' 23:59:59'); }
  
  query += ' ORDER BY created_at DESC';
  
  const data = db.prepare(query).all(...params);
  const totalAmount = data.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalQty = data.reduce((sum, d) => sum + (d.quantity || 0), 0);
  
  res.json({
    success: true,
    data,
    summary: {
      total_records: data.length,
      total_amount: totalAmount,
      total_quantity: totalQty,
      by_type: data.reduce((acc, d) => {
        acc[d.donation_type] = (acc[d.donation_type] || 0) + 1;
        return acc;
      }, {})
    }
  });
});

// ═══ تقرير المهام ═══
router.get('/tasks', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const { status, from_date, to_date } = req.query;
  
  let query = `
    SELECT t.*, u.full_name as assigned_to_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE 1=1
  `;
  const params = [];
  
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (from_date) { query += ' AND t.created_at >= ?'; params.push(from_date); }
  if (to_date) { query += ' AND t.created_at <= ?'; params.push(to_date + ' 23:59:59'); }
  
  query += ' ORDER BY t.created_at DESC';
  
  const data = db.prepare(query).all(...params);
  res.json({ success: true, data });
});

// ═══ تقرير الحملات ═══
router.get('/campaigns', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  const data = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  res.json({ success: true, data });
});

// ═══ Export CSV ═══
router.get('/export/:type', authenticate, authorize('admin'), async (req, res) => {
  const { type } = req.params;
  
  let data = [];
  let headers = [];
  let filename = `sagya_${type}_${new Date().toISOString().split('T')[0]}`;

  switch (type) {
    case 'volunteers':
      data = db.prepare('SELECT id, full_name, phone, nationality, city, age, profession, status, points, badge, created_at FROM volunteer_applications ORDER BY created_at DESC').all();
      headers = ['ID', 'الاسم', 'الجوال', 'الجنسية', 'المدينة', 'العمر', 'المهنة', 'الحالة', 'النقاط', 'الوسام', 'تاريخ التسجيل'];
      break;
    case 'donations':
      data = db.prepare('SELECT id, tracking_number, donor_name, donor_phone, donation_type, quantity, amount, status, created_at FROM donations ORDER BY created_at DESC').all();
      headers = ['ID', 'رقم التتبع', 'اسم المتبرع', 'الجوال', 'نوع التبرع', 'الكمية', 'المبلغ', 'الحالة', 'التاريخ'];
      break;
    case 'tasks':
      data = db.prepare('SELECT id, title, task_type, status, priority, location, due_date, created_at FROM tasks ORDER BY created_at DESC').all();
      headers = ['ID', 'العنوان', 'النوع', 'الحالة', 'الأولوية', 'الموقع', 'تاريخ الاستحقاق', 'تاريخ الإنشاء'];
      break;
    default:
      return res.status(400).json({ success: false, message: 'نوع التقرير غير معروف' });
  }

  // Build CSV
  const csvLines = [headers.join(',')];
  data.forEach(row => {
    const values = Object.values(row).map(v => {
      if (v === null || v === undefined) return '';
      const str = String(v).replace(/"/g, '""');
      return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
    });
    csvLines.push(values.join(','));
  });

  const csv = '\ufeff' + csvLines.join('\n'); // BOM for Arabic Excel
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
});

// ═══ سجل التقارير ═══
router.get('/history', authenticate, authorize('admin'), async (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, u.full_name as generated_by_name
    FROM reports r
    LEFT JOIN users u ON r.generated_by = u.id
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all();
  res.json({ success: true, data: reports });
});

module.exports = router;
