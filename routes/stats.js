// routes/stats.js - الإحصائيات العامة
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');

router.get('/public', (req, res) => {
  const stats = db.prepare('SELECT stat_key, stat_value FROM stats').all();
  const statsObj = {};
  stats.forEach(s => { statsObj[s.stat_key] = s.stat_value; });

  const totalDonations = db.prepare('SELECT COUNT(*) as count FROM donations').get();
  const distributedDonations = db.prepare(`SELECT COUNT(*) as count FROM donations WHERE status = 'distributed'`).get();
  const totalVolunteers = db.prepare(`SELECT COUNT(*) as count FROM volunteer_applications WHERE status = 'approved'`).get();
  const totalRequests = db.prepare('SELECT COUNT(*) as count FROM service_requests').get();

  res.json({
    success: true,
    data: {
      ...statsObj,
      total_donations: totalDonations.count,
      distributed_donations: distributedDonations.count,
      approved_volunteers: totalVolunteers.count,
      total_service_requests: totalRequests.count
    }
  });
});

module.exports = router;
