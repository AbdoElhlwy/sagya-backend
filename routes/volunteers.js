// routes/volunteers.js - مسارات التطوع
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const QRCode = require('qrcode');
const path = require('path');
const { db, updateStats } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadVolunteerPhotos, handleUploadError } = require('../middleware/upload');
const { calculateBadge, sanitizeInput } = require('../utils/helpers');

// تقديم طلب تطوع (لا يحتاج تسجيل دخول)
router.post('/apply', (req, res, next) => {
  uploadVolunteerPhotos(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    next();
  });
}, [
  body('full_name').notEmpty().trim().withMessage('الاسم الكامل مطلوب'),
  body('phone').notEmpty().withMessage('رقم الجوال مطلوب'),
  body('nationality').notEmpty().withMessage('الجنسية مطلوبة'),
  body('national_id').notEmpty().withMessage('رقم الهوية مطلوب'),
  body('city').notEmpty().withMessage('المدينة مطلوبة'),
  body('age').isInt({ min: 16, max: 70 }).withMessage('العمر يجب أن يكون بين 16 و 70')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { full_name, phone, nationality, national_id, city, age, profession, experience, password } = req.body;

  // التحقق من عدم وجود طلب سابق
  const existing = db.prepare('SELECT id FROM volunteer_applications WHERE phone = ?').get(phone.trim());
  if (existing) {
    return res.status(409).json({ success: false, message: 'تم تقديم طلب تطوع بهذا الرقم مسبقاً' });
  }

  // إنشاء حساب للمتطوع إن لم يكن موجوداً
  let userId = null;
  const bcrypt = require('bcryptjs');
  const { generateUUID } = require('../utils/helpers');
  
  const existingUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone.trim());
  if (existingUser) {
    userId = existingUser.id;
  } else if (password) {
    const hashedPw = bcrypt.hashSync(password, 12);
    const result = db.prepare(`
      INSERT INTO users (uuid, full_name, phone, password_hash, role) VALUES (?,?,?,?,?)
    `).run(generateUUID(), sanitizeInput(full_name), phone.trim(), hashedPw, 'volunteer');
    userId = result.lastInsertRowid;
  }

  // مسارات الصور
  const personalPhotoPath = req.files?.personal_photo?.[0]?.filename 
    ? `personal_photos/${req.files.personal_photo[0].filename}` : null;
  const idPhotoPath = req.files?.id_photo?.[0]?.filename 
    ? `id_photos/${req.files.id_photo[0].filename}` : null;

  const result = db.prepare(`
    INSERT INTO volunteer_applications 
    (user_id, full_name, phone, nationality, national_id, city, age, profession, experience, personal_photo_url, id_photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, sanitizeInput(full_name), phone.trim(), nationality,
    national_id, city, parseInt(age), profession || null,
    experience || null, personalPhotoPath, idPhotoPath
  );

  res.status(201).json({
    success: true,
    message: 'تم تقديم طلب التطوع بنجاح، سيتم مراجعته وإبلاغك بالنتيجة',
    data: { application_id: result.lastInsertRowid }
  });
});

// متابعة حالة الطلب برقم الجوال
router.get('/status/:phone', (req, res) => {
  const app = db.prepare(`
    SELECT id, full_name, status, rejection_reason, points, badge, created_at
    FROM volunteer_applications WHERE phone = ?
  `).get(req.params.phone);

  if (!app) {
    return res.status(404).json({ success: false, message: 'لا يوجد طلب تطوع بهذا الرقم' });
  }

  res.json({ success: true, data: app });
});

// مهام المتطوع
router.get('/my-tasks', authenticate, authorize('volunteer'), (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, u.full_name as assigned_by_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.assigned_to = ?
    ORDER BY t.created_at DESC
  `).all(req.user.id);

  res.json({ success: true, data: tasks });
});

// قبول أو رفض مهمة
router.patch('/tasks/:taskId/respond', authenticate, authorize('volunteer'), (req, res) => {
  const { action, reason } = req.body;
  const { taskId } = req.params;

  if (!['accepted', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'الإجراء غير صالح' });
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND assigned_to = ?').get(taskId, req.user.id);
  if (!task) return res.status(404).json({ success: false, message: 'المهمة غير موجودة' });

  db.prepare(`
    UPDATE tasks SET status = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?
  `).run(action, reason || null, taskId);

  res.json({ success: true, message: action === 'accepted' ? 'تم قبول المهمة' : 'تم رفض المهمة' });
});

// رفع إثبات إنجاز المهمة
const { uploadTaskProof } = require('../middleware/upload');
router.post('/tasks/:taskId/complete', authenticate, authorize('volunteer'), (req, res, next) => {
  uploadTaskProof(req, res, (err) => {
    if (err) return handleUploadError(err, req, res, next);
    
    const { taskId } = req.params;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND assigned_to = ?').get(taskId, req.user.id);
    if (!task) return res.status(404).json({ success: false, message: 'المهمة غير موجودة' });

    const proofPath = req.file ? `task_proofs/${req.file.filename}` : null;
    
    db.prepare(`
      UPDATE tasks SET status = 'completed', proof_photo_url = ?, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(proofPath, taskId);

    // إضافة نقاط
    const pointsToAdd = task.points_reward || 10;
    db.prepare(`
      UPDATE volunteer_applications SET points = points + ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(pointsToAdd, req.user.id);

    // تسجيل النقاط
    db.prepare(`
      INSERT INTO points_log (volunteer_id, points, reason, task_id) VALUES (?,?,?,?)
    `).run(req.user.id, pointsToAdd, `إنجاز مهمة: ${task.title}`, taskId);

    // تحديث الشارة
    const volApp = db.prepare('SELECT points FROM volunteer_applications WHERE user_id = ?').get(req.user.id);
    const newBadge = calculateBadge(volApp.points + pointsToAdd);
    db.prepare('UPDATE volunteer_applications SET badge = ? WHERE user_id = ?').run(newBadge, req.user.id);

    res.json({ success: true, message: 'تم رفع إثبات الإنجاز وإضافة النقاط', data: { points_earned: pointsToAdd } });
  });
});

// ملف المتطوع وإحصائياته
router.get('/my-profile', authenticate, authorize('volunteer'), (req, res) => {
  const profile = db.prepare(`
    SELECT va.*, u.email, u.avatar_url
    FROM volunteer_applications va
    JOIN users u ON u.id = va.user_id
    WHERE va.user_id = ?
  `).get(req.user.id);

  const completedTasks = db.prepare(`
    SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'completed'
  `).get(req.user.id);

  const pointsHistory = db.prepare(`
    SELECT * FROM points_log WHERE volunteer_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(req.user.id);

  res.json({ 
    success: true, 
    data: { 
      profile, 
      stats: { completed_tasks: completedTasks.count },
      points_history: pointsHistory
    }
  });
});

// كل المتطوعين (للإدارة)
router.get('/all', authenticate, authorize('admin'), (req, res) => {
  const status = req.query.status || null;
  let query = `
    SELECT va.*, u.email, u.is_active
    FROM volunteer_applications va
    LEFT JOIN users u ON u.id = va.user_id
  `;
  if (status) query += ` WHERE va.status = '${status}'`;
  query += ' ORDER BY va.created_at DESC';
  
  const volunteers = db.prepare(query).all();
  res.json({ success: true, data: volunteers });
});

module.exports = router;
