/**
 * seed.js - بيانات أولية لقاعدة بيانات سقيا الحرمين
 */
const bcrypt = require('bcryptjs');
const { db, initializeDatabase } = require('./database/db');

async function seed() {
  try {
    // تهيئة قاعدة البيانات أولاً وانتظار اكتمالها
    initializeDatabase();
    
    // انتظر ثانية للتأكد من اكتمال التهيئة
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('🌱 بدء زرع البيانات الأولية...');

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

    const existingSupervisor = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966500000002');
    if (!existingSupervisor) {
      const hashedPassword = bcrypt.hashSync('Sagya@Sup2024!', 12);
      db.prepare(`
        INSERT INTO users (name, phone, password, role, is_verified, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
      `).run('مشرف العمليات', '+966500000002', hashedPassword, 'supervisor');
      console.log('✅ تم إنشاء حساب المشرف');
    }

    console.log('\n✨ اكتملت عملية زرع البيانات!');
    console.log('   📱 الهاتف: +966500000001');
    console.log('   🔑 كلمة المرور: Sagya@2024!');

  } catch (err) {
    console.error('❌ خطأ في seed:', err.message);
    // لا نوقف السيرفر بسبب خطأ في الـ seed
  }
}

seed();
