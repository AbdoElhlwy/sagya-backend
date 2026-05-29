/**
 * seed.js - بيانات أولية لقاعدة بيانات سقيا الحرمين
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, initializeDatabase } = require('./database/db');

async function seed() {
  try {
    initializeDatabase();
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log('🌱 بدء زرع البيانات الأولية...');

    // ─── مدير النظام ────────────────────────────────────────
    const existingAdmin = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966500000001');
    
    if (!existingAdmin) {
      const hashedPassword = bcrypt.hashSync('Sagya@2024!', 12);
      db.prepare(`
        INSERT INTO users (uuid, full_name, phone, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      `).run(uuidv4(), 'مدير النظام', '+966500000001', hashedPassword, 'super_admin');
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
        INSERT INTO users (uuid, full_name, phone, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      `).run(uuidv4(), 'مشرف العمليات', '+966500000002', hashedPassword, 'supervisor');
      console.log('✅ تم إنشاء حساب المشرف');
    }

    console.log('\n✨ اكتملت عملية زرع البيانات!');
    console.log('   📱 الهاتف: +966500000001');
    console.log('   🔑 كلمة المرور: Sagya@2024!');

  } catch (err) {
    console.error('❌ خطأ في seed:', err.message);
  }
}

seed();
