const multer = require("multer");

const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 0);
const maxFilesPerUpload = Number(process.env.MAX_FILES_PER_UPLOAD || 5000);

const limits = {
  files: Number.isFinite(maxFilesPerUpload) && maxFilesPerUpload > 0 ? maxFilesPerUpload : 5000
};
if (Number.isFinite(maxFileSizeMb) && maxFileSizeMb > 0) {
  limits.fileSize = maxFileSizeMb * 1024 * 1024;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits
});

module.exports = upload;
