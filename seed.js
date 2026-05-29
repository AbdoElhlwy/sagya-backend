/**
 * seed.js - بيانات أولية لقاعدة بيانات سقيا الحرمين
 * تشغيل: node seed.js
 */
const bcrypt = require('bcryptjs');
const { db, initializeDatabase } = require('./database/db');

async function seed() {
  // تهيئة قاعدة البيانات أولاً
  initializeDatabase();
  
  console.log('🌱 بدء زرع البيانات الأولية...');

  try {
    // ─── مدير النظام ────────────────────────────────────────
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

    // ─── حملة نموذجية ────────────────────────────────────────
    const existingCampaign = db.prepare('SELECT id FROM campaigns LIMIT 1').get();
    
    if (!existingCampaign) {
      db.prepare(`
        INSERT INTO campaigns (title, description, goal_amount, raised_amount, start_date, end_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        'حملة سقيا رمضان 1446',
        'توفير مياه الشرب الطازجة لضيوف الرحمن',
        100000, 0,
        '2025-03-01', '2025-03-31',
        'active'
      );
      console.log('✅ تم إنشاء حملة نموذجية');
    }

    console.log('\n✨ اكتملت عملية زرع البيانات!');
    console.log('\n📌 بيانات الدخول:');
    console.log('   📱 الهاتف: +966500000001');
    console.log('   🔑 كلمة المرور: Sagya@2024!');

  } catch (err) {
    console.error('❌ خطأ في seed:', err.message);
  }
}

seed();
