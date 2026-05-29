// routes/tasks.js - مسارات إدارة المهام
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');

// إنشاء مهمة (إدارة)
router.post('/', authenticate, authorize('admin'), [
  body('title').notEmpty().trim().withMessage('عنوان المهمة مطلوب'),
  body('task_type').notEmpty().withMessage('نوع المهمة مطلوب'),
  body('priority').optional().isIn(['low','normal','high','urgent'])
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { title, description, task_type, assigned_to, priority, location, due_date, points_reward } = req.body;

  const result = db.prepare(`
    INSERT INTO tasks (title, description, task_type, assigned_to, created_by, priority, location, due_date, points_reward)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), description || null, task_type,
    assigned_to || null, req.user.id,
    priority || 'normal', location || null, due_date || null,
    parseInt(points_reward) || 10
  );

  // إشعار للمتطوع
  if (assigned_to) {
    db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)`).run(
      assigned_to, 'مهمة جديدة', `تم تعيين مهمة لك: ${title}`, 'task'
    );
  }

  res.status(201).json({ success: true, message: 'تم إنشاء المهمة', data: { task_id: result.lastInsertRowid } });
});

// كل المهام (إدارة)
router.get('/all', authenticate, authorize('admin'), (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT t.*, u.full_name as assigned_to_name, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN users c ON c.id = t.created_by
  `;
  if (status) query += ` WHERE t.status = '${status}'`;
  query += ' ORDER BY t.created_at DESC';

  const tasks = db.prepare(query).all();
  res.json({ success: true, data: tasks });
});

// تفاصيل مهمة
router.get('/:id', authenticate, (req, res) => {
  const task = db.prepare(`
    SELECT t.*, u.full_name as assigned_to_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.id = ?
  `).get(req.params.id);

  if (!task) return res.status(404).json({ success: false, message: 'المهمة غير موجودة' });
  res.json({ success: true, data: task });
});

// تحديث مهمة
router.put('/:id', authenticate, authorize('admin'), (req, res) => {
  const { title, description, assigned_to, priority, status, location, due_date } = req.body;
  
  db.prepare(`
    UPDATE tasks SET 
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      assigned_to = COALESCE(?, assigned_to),
      priority = COALESCE(?, priority),
      status = COALESCE(?, status),
      location = COALESCE(?, location),
      due_date = COALESCE(?, due_date),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(title, description, assigned_to, priority, status, location, due_date, req.params.id);

  res.json({ success: true, message: 'تم تحديث المهمة' });
});

// حذف مهمة
router.delete('/:id', authenticate, authorize('admin'), (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'تم حذف المهمة' });
});

module.exports = router;
