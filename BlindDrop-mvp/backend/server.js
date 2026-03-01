const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const db = require("./db");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* ================= TOKEN GENERATOR ================= */

function generateToken(length = 7) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/* ================= MULTER CONFIG ================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({ storage });

/* ================= TEST ROUTE ================= */

app.get("/test", (req, res) => {
  res.send("Server is working 🚀");
});

/* ================= UPLOAD ================= */

app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  const innerToken = req.body.innerToken;

  if (!file) return res.status(400).send("No file uploaded");
  if (!innerToken) return res.status(400).send("Inner token required");

  const outerToken = generateToken(7);

  const uploadTime = new Date();
  const expiryTime = new Date(uploadTime.getTime() + 7 * 24 * 60 * 60 * 1000);

  const query = `
    INSERT INTO files
    (outer_token, inner_token_hash, file_path, filename, upload_time, expiry_time, size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [
      outerToken,
      innerToken,
      file.path,
      file.originalname,
      uploadTime,
      expiryTime,
      file.size,
    ],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Database error");
      }

      res.json({
        message: "Upload successful 🚀",
        outerToken,
      });
    }
  );
});

/* ================= VERIFY OUTER TOKEN ================= */

app.post("/verify-outer", (req, res) => {
  const outerToken = req.body.outerToken?.trim();

  if (!outerToken) {
    return res.status(400).send("Outer token required");
  }

  const query = "SELECT * FROM files WHERE outer_token = ?";

  db.query(query, [outerToken], (err, results) => {
    if (err) return res.status(500).send("Database error");

    if (results.length === 0) {
      return res.status(404).send("Invalid token");
    }

    const file = results[0];

    res.json({
      filename: file.filename,
      uploadTime: file.upload_time,
      expiryTime: file.expiry_time,
    });
  });
});

/* ================= DOWNLOAD ================= */

app.post("/download", (req, res) => {
  const { outerToken, innerToken } = req.body;

  if (!outerToken || !innerToken) {
    return res.status(400).send("Both tokens required");
  }

  const query = "SELECT * FROM files WHERE outer_token = ?";

  db.query(query, [outerToken], (err, results) => {
    if (err) return res.status(500).send("Database error");

    if (results.length === 0) {
      return res.status(404).send("Invalid outer token");
    }

    const file = results[0];

    if (file.inner_token_hash !== innerToken) {
      return res.status(403).send("Invalid inner token");
    }

    if (new Date() > new Date(file.expiry_time)) {
      return res.status(403).send("File expired");
    }

    res.download(file.file_path, file.filename, (err) => {
      if (err) {
        console.error("Download error:", err);
        return;
      }

      // Delete file after download
      fs.unlink(file.file_path, () => {});

      // Delete DB record
      db.query("DELETE FROM files WHERE outer_token = ?", [outerToken]);

      console.log("File deleted after download ✅");
    });
  });
});

/* ================= AUTO DELETE EXPIRED FILES ================= */

setInterval(() => {
  const now = new Date();

  db.query(
    "SELECT * FROM files WHERE expiry_time < ?",
    [now],
    (err, results) => {
      if (err) return;

      results.forEach((file) => {
        fs.unlink(file.file_path, () => {});
        db.query("DELETE FROM files WHERE id = ?", [file.id]);

        console.log("Expired file deleted:", file.filename);
      });
    }
  );
}, 60 * 1000);

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});