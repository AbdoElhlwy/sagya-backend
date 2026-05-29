// routes/users.js
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { uploadPersonalPhoto } = require('../middleware/upload');

// الملف الشخصي
router.get('/profile', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, uuid, full_name, phone, email, role, avatar_url, created_at FROM users WHERE id = ?').get(req.user.id);
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user.id);
  const activity = db.prepare('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user.id);
  res.json({ success: true, data: { user, notifications, activity } });
});

// تحديث الملف الشخصي
router.put('/profile', authenticate, (req, res) => {
  const { full_name, email } = req.body;
  db.prepare(`UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), updated_at = datetime('now') WHERE id = ?`)
    .run(full_name || null, email || null, req.user.id);
  res.json({ success: true, message: 'تم تحديث الملف الشخصي' });
});

// رفع صورة شخصية
router.post('/avatar', authenticate, (req, res, next) => {
  uploadPersonalPhoto(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'لم يتم رفع صورة' });
    
    const avatarPath = `personal_photos/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarPath, req.user.id);
    res.json({ success: true, message: 'تم تحديث الصورة الشخصية', data: { avatar_url: avatarPath } });
  });
});

// الإشعارات
router.get('/notifications', authenticate, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ success: true, data: notifications });
});

router.patch('/notifications/:id/read', authenticate, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
