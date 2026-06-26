const multer = require("multer");

const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_MAX_FILES_PER_UPLOAD = 20;

const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || DEFAULT_MAX_FILE_SIZE_MB);
const maxFilesPerUpload = Number(process.env.MAX_FILES_PER_UPLOAD || DEFAULT_MAX_FILES_PER_UPLOAD);

const limits = {
  files:
    Number.isFinite(maxFilesPerUpload) && maxFilesPerUpload > 0
      ? maxFilesPerUpload
      : DEFAULT_MAX_FILES_PER_UPLOAD
};
limits.fileSize =
  Number.isFinite(maxFileSizeMb) && maxFileSizeMb > 0
    ? maxFileSizeMb * 1024 * 1024
  : DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits
});

module.exports = upload;
