// routes/leaderboard.js - لوحة المتصدرين
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate } = require('../middleware/auth');

// أفضل المتطوعين نقاطاً (عام)
router.get('/volunteers', (req, res) => {
  const { limit = 10, period } = req.query;

  let dateCondition = '';
  if (period === 'week') {
    dateCondition = "AND pl.created_at >= datetime('now', '-7 days')";
  } else if (period === 'month') {
    dateCondition = "AND pl.created_at >= datetime('now', '-30 days')";
  }

  const leaders = db.prepare(`
    SELECT 
      va.full_name,
      va.city,
      va.badge,
      ${period ? `SUM(CASE WHEN pl.id IS NOT NULL ${dateCondition} THEN pl.points ELSE 0 END)` : 'va.points'} as total_points,
      COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as completed_tasks
    FROM volunteer_applications va
    LEFT JOIN points_log pl ON pl.volunteer_id = va.user_id
    LEFT JOIN tasks t ON t.assigned_to = va.user_id
    WHERE va.status = 'approved'
    GROUP BY va.id
    ORDER BY total_points DESC
    LIMIT ?
  `).all(parseInt(limit));

  // إضافة الترتيب
  const ranked = leaders.map((v, i) => ({ rank: i + 1, ...v }));

  res.json({ success: true, data: ranked, period: period || 'all_time' });
});

// ترتيب المتطوع الحالي
router.get('/my-rank', authenticate, (req, res) => {
  const myPoints = db.prepare(
    'SELECT points FROM volunteer_applications WHERE user_id = ?'
  ).get(req.user.id);

  if (!myPoints) {
    return res.status(404).json({ success: false, message: 'لم يتم العثور على ملف التطوع' });
  }

  const rank = db.prepare(`
    SELECT COUNT(*) + 1 as rank 
    FROM volunteer_applications 
    WHERE points > ? AND status = 'approved'
  `).get(myPoints.points);

  const total = db.prepare(
    "SELECT COUNT(*) as count FROM volunteer_applications WHERE status = 'approved'"
  ).get();

  res.json({
    success: true,
    data: {
      rank: rank.rank,
      total_volunteers: total.count,
      points: myPoints.points,
      percentile: Math.round((1 - rank.rank / total.count) * 100)
    }
  });
});

module.exports = router;
