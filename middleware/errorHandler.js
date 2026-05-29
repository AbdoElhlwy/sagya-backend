// middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  console.error('❌ Error:', err.message);
  
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'بيانات JSON غير صالحة' });
  }
  
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'حدث خطأ في الخادم' 
    : err.message;
  
  res.status(statusCode).json({ success: false, message });
}

module.exports = errorHandler;
