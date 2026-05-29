// routes/notifications.js - الإشعارات الفورية عبر SSE
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate } = require('../middleware/auth');

// Map لتخزين اتصالات SSE النشطة
const clients = new Map(); // userId => [res, ...]

// SSE - بث الإشعارات الفورية
router.get('/stream', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = req.user.id;
  if (!clients.has(userId)) clients.set(userId, []);
  clients.get(userId).push(res);

  // إرسال ping كل 25 ثانية لمنع timeout
  const pingInterval = setInterval(() => {
    res.write(':ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(pingInterval);
    const userClients = clients.get(userId) || [];
    const idx = userClients.indexOf(res);
    if (idx !== -1) userClients.splice(idx, 1);
    if (userClients.length === 0) clients.delete(userId);
  });

  // إرسال الإشعارات غير المقروءة فور الاتصال
  const unread = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC'
  ).all(userId);

  if (unread.length) {
    res.write(`data: ${JSON.stringify({ type: 'unread', notifications: unread })}\n\n`);
  }
});

// Helper: بث إشعار لمستخدم
function pushNotification(userId, notification) {
  const userClients = clients.get(userId) || [];
  const payload = `data: ${JSON.stringify({ type: 'new', notification })}\n\n`;
  userClients.forEach(res => {
    try { res.write(payload); } catch (_) {}
  });
}

// GET - قائمة الإشعارات (مع تصفح)
router.get('/', authenticate, (req, res) => {
  const { page = 1, limit = 20, unread_only = false } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const condition = unread_only === 'true' ? 'AND is_read = 0' : '';
  const notifications = db.prepare(
    `SELECT * FROM notifications WHERE user_id = ? ${condition}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(req.user.id, parseInt(limit), offset);

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? ${condition}`
  ).get(req.user.id);

  const unreadCount = db.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).get(req.user.id);

  res.json({ success: true, data: notifications, total: total.count, unread_count: unreadCount.count });
});

// تعليم إشعار كمقروء
router.patch('/:id/read', authenticate, (req, res) => {
  db.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);

  res.json({ success: true, message: 'تم تعليم الإشعار كمقروء' });
});

// تعليم الكل كمقروء
router.patch('/read-all', authenticate, (req, res) => {
  db.prepare(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0"
  ).run(req.user.id);

  res.json({ success: true, message: 'تم تعليم كل الإشعارات كمقروءة' });
});

// حذف إشعار
router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true, message: 'تم حذف الإشعار' });
});

module.exports = { router, pushNotification };
