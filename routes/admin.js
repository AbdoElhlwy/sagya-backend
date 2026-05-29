// routes/admin.js - مسارات لوحة التحكم
const express = require('express');
const { pushNotification } = require('./notifications');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const { calculateBadge } = require('../utils/helpers');

// Dashboard - الإحصائيات الشاملة
router.get('/dashboard', authenticate, authorize('admin'), (req, res) => {
  const totalVolunteers = db.prepare(`SELECT COUNT(*) as count FROM volunteer_applications WHERE status = 'approved'`).get();
  const pendingVolunteers = db.prepare(`SELECT COUNT(*) as count FROM volunteer_applications WHERE status = 'pending'`).get();
  const totalDonors = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'donor'`).get();
  const totalRequests = db.prepare(`SELECT COUNT(*) as count FROM service_requests`).get();
  const pendingRequests = db.prepare(`SELECT COUNT(*) as count FROM service_requests WHERE status = 'pending'`).get();
  const totalDonations = db.prepare(`SELECT SUM(amount) as total, COUNT(*) as count FROM donations`).get();
  const totalTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks`).get();
  const completedTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'`).get();

  // الإحصائيات حسب النوع
  const donationsByType = db.prepare(`
    SELECT donation_type, COUNT(*) as count, SUM(quantity) as total_qty, SUM(amount) as total_amount
    FROM donations GROUP BY donation_type
  `).all();

  const requestsByType = db.prepare(`
    SELECT request_type, COUNT(*) as count FROM service_requests GROUP BY request_type
  `).all();

  // آخر النشاطات
  const recentVolunteers = db.prepare(`
    SELECT va.full_name, va.city, va.status, va.created_at
    FROM volunteer_applications va ORDER BY va.created_at DESC LIMIT 5
  `).all();

  const recentDonations = db.prepare(`
    SELECT donor_name, donation_type, quantity, amount, tracking_number, created_at
    FROM donations ORDER BY created_at DESC LIMIT 5
  `).all();

  const recentRequests = db.prepare(`
    SELECT visitor_name, request_type, status, tracking_number, created_at
    FROM service_requests ORDER BY created_at DESC LIMIT 5
  `).all();

  res.json({
    success: true,
    data: {
      summary: {
        total_volunteers: totalVolunteers.count,
        pending_volunteers: pendingVolunteers.count,
        total_donors: totalDonors.count,
        total_requests: totalRequests.count,
        pending_requests: pendingRequests.count,
        total_donations_amount: totalDonations.total || 0,
        total_donations_count: totalDonations.count,
        total_tasks: totalTasks.count,
        completed_tasks: completedTasks.count
      },
      donations_by_type: donationsByType,
      requests_by_type: requestsByType,
      recent: { volunteers: recentVolunteers, donations: recentDonations, requests: recentRequests }
    }
  });
});

// قبول / رفض متطوع
router.patch('/volunteers/:id/review', authenticate, authorize('admin'), (req, res) => {
  const { action, rejection_reason } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'الإجراء غير صالح' });
  }

  const volApp = db.prepare('SELECT * FROM volunteer_applications WHERE id = ?').get(req.params.id);
  if (!volApp) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

  db.prepare(`
    UPDATE volunteer_applications SET status = ?, rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(action, rejection_reason || null, req.params.id);

  // تحديث دور المستخدم وإرسال إشعار
  if (volApp.user_id) {
    if (action === 'approved') {
      db.prepare(`UPDATE users SET role = 'volunteer', updated_at = datetime('now') WHERE id = ?`).run(volApp.user_id);
    }
    
    const msg = action === 'approved' 
      ? 'تهانينا! تم قبول طلب تطوعك. مرحباً بك في فريق سقيا الحرمين'
      : `عذراً، تم رفض طلب تطوعك. السبب: ${rejection_reason || 'غير محدد'}`;
    
    const notifResult = db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)`).run(
      volApp.user_id, 'نتيجة طلب التطوع', msg, action === 'approved' ? 'success' : 'warning'
    );
    // إرسال إشعار فوري SSE إن كان المستخدم متصلاً
    pushNotification(volApp.user_id, {
      id: notifResult.lastInsertRowid,
      title: 'نتيجة طلب التطوع',
      message: msg,
      type: action === 'approved' ? 'success' : 'warning'
    });
  }

  // تحديث إحصائية المتطوعين
  if (action === 'approved') {
    db.prepare(`UPDATE stats SET stat_value = stat_value + 1 WHERE stat_key = 'total_volunteers'`).run();
  }

  res.json({ success: true, message: action === 'approved' ? 'تم قبول المتطوع' : 'تم رفض الطلب' });
});

// تعيين مهمة لمتطوع
router.post('/assign-task', authenticate, authorize('admin'), (req, res) => {
  const { task_id, volunteer_id } = req.body;
  if (!task_id || !volunteer_id) {
    return res.status(400).json({ success: false, message: 'معرّف المهمة والمتطوع مطلوبان' });
  }

  db.prepare(`UPDATE tasks SET assigned_to = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?`)
    .run(volunteer_id, task_id);

  const task = db.prepare('SELECT title FROM tasks WHERE id = ?').get(task_id);
  db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)`).run(
    volunteer_id, 'مهمة جديدة', `تم تعيين مهمة لك: ${task?.title}`, 'task'
  );

  res.json({ success: true, message: 'تم تعيين المهمة بنجاح' });
});

// تقرير يومي
router.get('/reports/daily', authenticate, authorize('admin'), (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  
  const donations = db.prepare(`
    SELECT * FROM donations WHERE DATE(created_at) = ?
  `).all(date);

  const requests = db.prepare(`
    SELECT * FROM service_requests WHERE DATE(created_at) = ?
  `).all(date);

  const tasks = db.prepare(`
    SELECT t.*, u.full_name as volunteer_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE DATE(t.updated_at) = ?
  `).all(date);

  res.json({ success: true, data: { date, donations, requests, tasks } });
});

// تقرير شهري
router.get('/reports/monthly', authenticate, authorize('admin'), (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const donationsSummary = db.prepare(`
    SELECT donation_type, COUNT(*) as count, SUM(quantity) as total_qty, SUM(amount) as total_amount
    FROM donations WHERE strftime('%Y-%m', created_at) = ?
    GROUP BY donation_type
  `).all(monthStr);

  const requestsSummary = db.prepare(`
    SELECT request_type, status, COUNT(*) as count
    FROM service_requests WHERE strftime('%Y-%m', created_at) = ?
    GROUP BY request_type, status
  `).all(monthStr);

  const volunteersSummary = db.prepare(`
    SELECT status, COUNT(*) as count FROM volunteer_applications
    WHERE strftime('%Y-%m', created_at) = ? GROUP BY status
  `).all(monthStr);

  res.json({
    success: true,
    data: { month: monthStr, donations: donationsSummary, requests: requestsSummary, volunteers: volunteersSummary }
  });
});

// تصدير CSV
router.get('/export/:type', authenticate, authorize('admin'), (req, res) => {
  const { type } = req.params;
  let data, headers, filename;

  if (type === 'donations') {
    data = db.prepare('SELECT tracking_number, donor_name, donor_phone, donation_type, quantity, amount, status, created_at FROM donations ORDER BY created_at DESC').all();
    headers = 'رقم التتبع,اسم المتبرع,الجوال,نوع التبرع,الكمية,المبلغ,الحالة,التاريخ';
    filename = 'donations.csv';
  } else if (type === 'volunteers') {
    data = db.prepare('SELECT full_name, phone, nationality, city, age, profession, status, points, badge, created_at FROM volunteer_applications ORDER BY created_at DESC').all();
    headers = 'الاسم,الجوال,الجنسية,المدينة,العمر,المهنة,الحالة,النقاط,الشارة,تاريخ التقديم';
    filename = 'volunteers.csv';
  } else if (type === 'requests') {
    data = db.prepare('SELECT tracking_number, visitor_name, visitor_phone, request_type, quantity, location, status, created_at FROM service_requests ORDER BY created_at DESC').all();
    headers = 'رقم التتبع,اسم الزائر,الجوال,نوع الطلب,الكمية,الموقع,الحالة,التاريخ';
    filename = 'requests.csv';
  } else {
    return res.status(400).json({ success: false, message: 'نوع التصدير غير صالح' });
  }

  const csvRows = ['\uFEFF' + headers]; // BOM for Arabic
  data.forEach(row => {
    csvRows.push(Object.values(row).map(v => `"${v || ''}"`).join(','));
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvRows.join('\n'));
});

// إدارة المستخدمين
router.get('/users', authenticate, authorize('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT id, uuid, full_name, phone, email, role, is_active, created_at FROM users ORDER BY created_at DESC
  `).all();
  res.json({ success: true, data: users });
});

router.patch('/users/:id/toggle', authenticate, authorize('admin'), (req, res) => {
  const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, req.params.id);
  res.json({ success: true, message: user.is_active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب' });
});

// الشركاء
router.get('/partners', (req, res) => {
  const partners = db.prepare('SELECT * FROM partners WHERE is_active = 1').all();
  res.json({ success: true, data: partners });
});

module.exports = router;
