// utils/helpers.js - دوال مساعدة
const { v4: uuidv4 } = require('uuid');

// توليد رقم تتبع فريد
function generateTrackingNumber(prefix = 'SQ') {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${year}-${random}`;
}

// حساب مستوى الشارة بناءً على النقاط
function calculateBadge(points) {
  if (points >= 1000) return 'خادم ضيوف الرحمن الذهبي';
  if (points >= 500) return 'خادم ضيوف الرحمن';
  if (points >= 200) return 'متطوع متميز';
  if (points >= 100) return 'متطوع نشط';
  if (points >= 50) return 'متطوع مبتدئ';
  return 'none';
}

// توليد UUID
function generateUUID() {
  return uuidv4();
}

// تنسيق التاريخ بالعربية
function formatDateAr(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// بناء رابط الصورة
function buildImageUrl(req, filePath) {
  if (!filePath) return null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${filePath}`;
}

// التحقق من رقم الجوال السعودي
function validateSaudiPhone(phone) {
  return /^(\+966|966|0)?5[0-9]{8}$/.test(phone.replace(/\s/g, ''));
}

// تنظيف نص الإدخال
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, '');
}

module.exports = {
  generateTrackingNumber,
  calculateBadge,
  generateUUID,
  formatDateAr,
  buildImageUrl,
  validateSaudiPhone,
  sanitizeInput
};
