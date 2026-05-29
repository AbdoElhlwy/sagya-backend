// database/seed.js - بيانات تجريبية
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initializeDatabase } = require('./db');

async function seed() {
  console.log('🌱 بدء إدراج البيانات التجريبية...\n');
  const db = await initializeDatabase();
  const pw = bcrypt.hashSync('123456', 12);

  const ins = db.prepare('INSERT OR IGNORE INTO users (uuid, full_name, phone, email, password_hash, role) VALUES (?,?,?,?,?,?)');
  ins.run(uuidv4(), 'مدير سقيا الحرمين',  '+966500000000', 'admin@sagya.sa',     pw, 'admin');
  ins.run(uuidv4(), 'أحمد المتطوع',         '+966511111111', 'volunteer@sagya.sa', pw, 'volunteer');
  ins.run(uuidv4(), 'محمد المتبرع',          '+966522222222', 'donor@sagya.sa',     pw, 'donor');

  const a = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966500000000');
  const v = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966511111111');
  const d = db.prepare('SELECT id FROM users WHERE phone = ?').get('+966522222222');

  db.prepare('INSERT OR IGNORE INTO volunteer_applications (user_id,full_name,phone,nationality,national_id,city,age,profession,experience,status,points,badge) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    v.id,'أحمد المتطوع','+966511111111','سعودي','1234567890','مكة المكرمة',28,'موظف','خبرة 3 سنوات','approved',150,'خادم ضيوف الرحمن');

  db.prepare('INSERT OR IGNORE INTO donations (tracking_number,donor_id,donor_name,donor_phone,donation_type,quantity,amount,status) VALUES (?,?,?,?,?,?,?,?)').run('SQ-2024-001',d.id,'محمد المتبرع','+966522222222','water',500,1000,'distributed');
  db.prepare('INSERT OR IGNORE INTO donations (tracking_number,donor_id,donor_name,donor_phone,donation_type,quantity,amount,status) VALUES (?,?,?,?,?,?,?,?)').run('SQ-2024-002',d.id,'محمد المتبرع','+966522222222','meals',100,2000,'processing');

  db.prepare('INSERT OR IGNORE INTO service_requests (tracking_number,visitor_name,visitor_phone,request_type,quantity,location,status) VALUES (?,?,?,?,?,?,?)').run('REQ-2024-001','زائر من ماليزيا','+601234567890','water',5,'المسجد الحرام','fulfilled');
  db.prepare('INSERT OR IGNORE INTO service_requests (tracking_number,visitor_name,visitor_phone,request_type,quantity,location,status) VALUES (?,?,?,?,?,?,?)').run('REQ-2024-002','زائر من مصر','+201234567890','meal',2,'فندق قريب','pending');

  db.prepare('INSERT OR IGNORE INTO tasks (title,description,task_type,assigned_to,created_by,status,priority,location,points_reward) VALUES (?,?,?,?,?,?,?,?,?)').run('توزيع مياه زمزم','توزيع 100 عبوة','water_distribution',v.id,a.id,'completed','high','باب الملك عبدالعزيز',20);
  db.prepare('INSERT OR IGNORE INTO tasks (title,description,task_type,assigned_to,created_by,status,priority,location,points_reward) VALUES (?,?,?,?,?,?,?,?,?)').run('توزيع وجبات إفطار','توزيع وجبات الإفطار','meal_distribution',v.id,a.id,'in_progress','urgent','المسجد الحرام',30);

  db.prepare('INSERT OR IGNORE INTO partners (name,website) VALUES (?,?)').run('رئاسة شؤون المسجد الحرام','https://presidency.gov.sa');

  db._db.run("UPDATE stats SET stat_value=15000 WHERE stat_key='total_water_bottles'");
  db._db.run("UPDATE stats SET stat_value=3200  WHERE stat_key='total_meals'");
  db._db.run("UPDATE stats SET stat_value=800   WHERE stat_key='total_prayer_beads'");
  db._save();

  console.log('✅ البيانات التجريبية جاهزة!\n');
  console.log('🔑 بيانات الدخول:');
  console.log('   مدير    | +966500000000 | 123456');
  console.log('   متطوع   | +966511111111 | 123456');
  console.log('   متبرع   | +966522222222 | 123456\n');
  process.exit(0);
}

seed().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
