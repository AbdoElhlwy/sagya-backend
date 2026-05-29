// middleware/upload.js - رفع الملفات بأمان
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5MB

// أنواع الملفات المسموح بها
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// امتدادات خطيرة ممنوعة
const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.sh', '.php', '.py', '.js', '.html', '.htm', '.sql', '.zip', '.rar'];

function createStorage(subDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_PATH, subDir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueName = `${uuidv4()}${ext}`;
      cb(null, uniqueName);
    }
  });
}

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  
  // منع الملفات الخطيرة
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return cb(new Error('نوع الملف غير مسموح به'), false);
  }
  
  // السماح فقط بالصور
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('يُسمح فقط برفع صور JPG أو PNG أو WebP'), false);
  }
  
  cb(null, true);
}

const baseOptions = {
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
};

// رفع صورة شخصية واحدة
const uploadPersonalPhoto = multer({
  storage: createStorage('personal_photos'),
  ...baseOptions
}).single('personal_photo');

// رفع صورة هوية واحدة
const uploadIdPhoto = multer({
  storage: createStorage('id_photos'),
  ...baseOptions
}).single('id_photo');

// رفع صور متعددة (صورة شخصية + هوية)
const uploadVolunteerPhotos = multer({
  storage: createStorage('personal_photos'),
  ...baseOptions
}).fields([
  { name: 'personal_photo', maxCount: 1 },
  { name: 'id_photo', maxCount: 1 }
]);

// رفع إثبات مهمة
const uploadTaskProof = multer({
  storage: createStorage('task_proofs'),
  ...baseOptions
}).single('proof_photo');

// معالج أخطاء multer
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'حجم الملف يتجاوز الحد المسموح (5MB)' });
    }
    return res.status(400).json({ success: false, message: 'خطأ في رفع الملف: ' + err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
}

module.exports = {
  uploadPersonalPhoto,
  uploadIdPhoto,
  uploadVolunteerPhotos,
  uploadTaskProof,
  handleUploadError
};
