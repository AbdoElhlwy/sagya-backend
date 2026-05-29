/**
 * seed.js - بيانات أولية لقاعدة بيانات سقيا الحرمين
 * تشغيل: node seed.js
 */
const bcrypt = require('bcryptjs');

// استخدام نفس إعداد قاعدة البيانات
const { getDb } = require('./database/db');

async function seed() {
  const db = getDb();
  console.log('🌱 بدء زرع البيانات الأولية...');

  // ─── مدير النظام (Super Admin) ────────────────────────────
  const existingAdmin = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966500000001');
  
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync('Sagya@2024!', 12);
    db.prepare(`
      INSERT INTO users (name, phone, password, role, is_verified, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
    `).run('مدير النظام', '+966500000001', hashedPassword, 'super_admin');
    console.log('✅ تم إنشاء مدير النظام');
    console.log('   📱 الهاتف: +966500000001');
    console.log('   🔑 كلمة المرور: Sagya@2024!');
    console.log('   ⚠️  يرجى تغيير كلمة المرور فور تسجيل الدخول!');
  } else {
    console.log('ℹ️  مدير النظام موجود مسبقاً');
  }

  // ─── مشرف ────────────────────────────────────────────────
  const existingSupervisor = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966500000002');
  
  if (!existingSupervisor) {
    const hashedPassword = bcrypt.hashSync('Sagya@Sup2024!', 12);
    db.prepare(`
      INSERT INTO users (name, phone, password, role, is_verified, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
    `).run('مشرف العمليات', '+966500000002', hashedPassword, 'supervisor');
    console.log('✅ تم إنشاء حساب المشرف');
  }

  // ─── إعدادات التطبيق ──────────────────────────────────────
  const settingsToSeed = [
    ['app_name', 'سقيا الحرمين'],
    ['app_version', '2.1.0'],
    ['organization_name', 'مؤسسة سقيا الحرمين'],
    ['organization_phone', '+966500000000'],
    ['organization_email', 'info@sagya-haramain.org'],
    ['organization_website', 'https://sagya-haramain.org'],
    ['primary_color', '#0B3D1E'],
    ['gold_color', '#D4AF37'],
    ['otp_length', '6'],
    ['otp_expiry_minutes', '10'],
    ['max_login_attempts', '5'],
    ['lockout_duration_minutes', '15'],
    ['jwt_expiry', '7d'],
    ['payment_sandbox', 'true'],
    ['default_donation_amounts', '50,100,250,500,1000'],
  ];

  const upsertSetting = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `);

  for (const [key, value] of settingsToSeed) {
    upsertSetting.run(key, value);
  }
  console.log('✅ تم زرع إعدادات التطبيق');

  // ─── حملة نموذجية ────────────────────────────────────────
  const existingCampaign = db.prepare('SELECT id FROM campaigns LIMIT 1').get();
  
  if (!existingCampaign) {
    db.prepare(`
      INSERT INTO campaigns (title, description, goal_amount, raised_amount, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      'حملة سقيا رمضان 1446',
      'توفير مياه الشرب الطازجة لضيوف الرحمن خلال شهر رمضان المبارك',
      100000,
      0,
      '2025-03-01',
      '2025-03-31',
      'active'
    );
    console.log('✅ تم إنشاء حملة نموذجية');
  }

  // ─── موقع نموذجي ─────────────────────────────────────────
  const existingLocation = db.prepare('SELECT id FROM locations LIMIT 1').get();
  
  if (!existingLocation) {
    db.prepare(`
      INSERT INTO locations (name, name_ar, type, latitude, longitude, address, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(
      'Masjid Al-Haram Gate 1',
      'باب الملك - المسجد الحرام',
      'distribution_point',
      21.4225,
      39.8262,
      'المسجد الحرام، مكة المكرمة'
    );
    
    db.prepare(`
      INSERT INTO locations (name, name_ar, type, latitude, longitude, address, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(
      'Al-Masaa Distribution Point',
      'نقطة توزيع المسعى',
      'distribution_point',
      21.4228,
      39.8248,
      'المسعى، المسجد الحرام'
    );
    console.log('✅ تم إنشاء نقاط التوزيع');
  }

  console.log('\n✨ اكتملت عملية زرع البيانات!');
  console.log('\n📌 بيانات الدخول للإدارة:');
  console.log('   🌐 لوحة التحكم: https://sagya-admin.vercel.app');
  console.log('   📱 الهاتف: +966500000001');
  console.log('   🔑 كلمة المرور: Sagya@2024!');
  console.log('\n⚠️  تذكير: هذه بيانات مؤقتة - يجب تغييرها فور النشر!');
}

seed().catch(console.error);
