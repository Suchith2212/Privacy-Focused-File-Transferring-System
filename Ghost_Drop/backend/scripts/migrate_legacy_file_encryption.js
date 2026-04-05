require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { getConnection, query } = require("../src/config/db");
const { uploadBuffer, downloadBuffer, deleteFile } = require("../src/services/driveService");
const {
  buildStoragePath,
  buildPlainFileHash,
  generateFileKey,
  encryptFileBuffer,
  wrapFileKeyForToken,
  FILE_KEY_WRAP_VERSION
} = require("../src/services/fileSecurityMetadata");

function parseArgs(argv) {
  const out = {
    limit: Number(process.env.MIGRATION_LIMIT || 100),
    dryRun: false,
    secretsPath: process.env.TOKEN_SECRETS_FILE || ""
  };

  argv.forEach((arg) => {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--limit=")) out.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--secrets=")) out.secretsPath = arg.slice("--secrets=".length);
  });

  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 100;
  return out;
}

function loadTokenSecrets(secretsPath) {
  if (!secretsPath) {
    return {
      innerTokenById: {},
      mainTokenByOuterToken: {}
    };
  }

  const absPath = path.resolve(process.cwd(), secretsPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Secrets file not found: ${absPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(absPath, "utf8"));
  return {
    innerTokenById: parsed.innerTokenById || {},
    mainTokenByOuterToken: parsed.mainTokenByOuterToken || {}
  };
}

async function addColumnIfMissing(tableName, columnName, definitionSql) {
  const rows = await query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );
  if (rows.length > 0) return;
  await query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

async function ensureFileCryptoColumns() {
  await addColumnIfMissing("files", "file_auth_tag", "file_auth_tag CHAR(32) NULL AFTER file_key_iv");
  await addColumnIfMissing("files", "file_plain_hash", "file_plain_hash CHAR(64) NULL AFTER file_hmac");
  await addColumnIfMissing("file_key_access", "key_wrap_iv", "key_wrap_iv CHAR(24) NULL AFTER encrypted_file_key");
  await addColumnIfMissing("file_key_access", "key_wrap_tag", "key_wrap_tag CHAR(32) NULL AFTER key_wrap_iv");
  await addColumnIfMissing("file_key_access", "key_wrap_salt", "key_wrap_salt CHAR(32) NULL AFTER key_wrap_tag");
  await addColumnIfMissing("file_key_access", "key_wrap_iterations", "key_wrap_iterations INT NULL AFTER key_wrap_salt");
  await addColumnIfMissing("file_key_access", "key_wrap_version", "key_wrap_version SMALLINT NULL AFTER key_wrap_iterations");
}

function resolveTokenValue(accessRow, tokenSecrets) {
  if (tokenSecrets.innerTokenById[accessRow.inner_token_id]) {
    return tokenSecrets.innerTokenById[accessRow.inner_token_id];
  }

  if (accessRow.token_type === "SUB" && accessRow.sub_inner_token) {
    return accessRow.sub_inner_token;
  }

  if (accessRow.token_type === "MAIN" && tokenSecrets.mainTokenByOuterToken[accessRow.outer_token]) {
    return tokenSecrets.mainTokenByOuterToken[accessRow.outer_token];
  }

  return "";
}

async function fetchLegacyFiles(limit) {
  return query(
    `
    SELECT
      f.file_id,
      f.vault_id,
      v.outer_token,
      f.drive_file_id,
      f.original_filename,
      f.mime_type,
      f.file_size,
      COALESCE(fm.relative_path, fm.original_filename, f.original_filename) AS relative_path,
      f.file_auth_tag,
      f.file_plain_hash
    FROM files f
    JOIN vaults v ON v.vault_id = f.vault_id
    LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
    WHERE f.status = 'ACTIVE'
      AND (f.file_auth_tag IS NULL OR f.file_plain_hash IS NULL)
    ORDER BY f.created_at ASC
    LIMIT ?
    `,
    [limit]
  );
}

async function fetchAccessRows(conn, fileId) {
  const [rows] = await conn.execute(
    `
    SELECT
      a.access_id,
      a.inner_token_id,
      t.token_type,
      v.outer_token,
      s.sub_inner_token
    FROM file_key_access a
    JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
    JOIN vaults v ON v.vault_id = t.vault_id
    LEFT JOIN sub_token_secrets s ON s.inner_token_id = a.inner_token_id
    WHERE a.file_id = ?
      AND t.status = 'ACTIVE'
    `,
    [fileId]
  );
  return rows;
}

async function migrateFileRow(fileRow, tokenSecrets, dryRun) {
  const conn = await getConnection();
  let uploadedReplacement = null;

  try {
    const plaintext = await downloadBuffer(fileRow.drive_file_id);
    const fileKey = generateFileKey();
    const encrypted = encryptFileBuffer(plaintext, fileKey);
    const plainHash = buildPlainFileHash(plaintext);

    if (!dryRun) {
      uploadedReplacement = await uploadBuffer({
        buffer: encrypted.ciphertext,
        fileName: fileRow.original_filename,
        mimeType: fileRow.mime_type || "application/octet-stream",
        relativePath: fileRow.relative_path || fileRow.original_filename
      });
    }

    await conn.beginTransaction();

    const accessRows = await fetchAccessRows(conn, fileRow.file_id);
    if (accessRows.length === 0) {
      throw new Error("No active file_key_access rows found.");
    }

    for (const accessRow of accessRows) {
      const tokenValue = resolveTokenValue(accessRow, tokenSecrets);
      if (!tokenValue) {
        throw new Error(
          `Missing token value for token ${accessRow.inner_token_id} (${accessRow.token_type}) in vault ${accessRow.outer_token}`
        );
      }
      const wrapped = wrapFileKeyForToken(fileKey, tokenValue);

      if (!dryRun) {
        await conn.execute(
          `
          UPDATE file_key_access
          SET encrypted_file_key = ?,
              key_wrap_iv = ?,
              key_wrap_tag = ?,
              key_wrap_salt = ?,
              key_wrap_iterations = ?,
              key_wrap_version = ?
          WHERE access_id = ?
          `,
          [
            wrapped.wrappedFileKeyHex,
            wrapped.wrapIvHex,
            wrapped.wrapTagHex,
            wrapped.wrapSaltHex,
            wrapped.wrapIterations,
            wrapped.wrapVersion || FILE_KEY_WRAP_VERSION,
            accessRow.access_id
          ]
        );
      }
    }

    if (!dryRun) {
      await conn.execute(
        `
        UPDATE files
        SET drive_file_id = ?,
            storage_path = ?,
            file_key_iv = ?,
            file_auth_tag = ?,
            file_plain_hash = ?,
            file_size = ?,
            mime_type = ?
        WHERE file_id = ?
        `,
        [
          uploadedReplacement.id,
          buildStoragePath(uploadedReplacement, fileRow.original_filename),
          encrypted.ivHex,
          encrypted.authTagHex,
          plainHash,
          plaintext.length,
          fileRow.mime_type || "application/octet-stream",
          fileRow.file_id
        ]
      );
    }

    await conn.commit();

    if (!dryRun) {
      await deleteFile(fileRow.drive_file_id).catch(() => {});
    }

    return {
      fileId: fileRow.file_id,
      status: "migrated"
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (uploadedReplacement?.id) {
      await deleteFile(uploadedReplacement.id).catch(() => {});
    }
    return {
      fileId: fileRow.file_id,
      status: "failed",
      error: err.message
    };
  } finally {
    conn.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokenSecrets = loadTokenSecrets(args.secretsPath);

  await ensureFileCryptoColumns();

  const legacyFiles = await fetchLegacyFiles(args.limit);
  if (legacyFiles.length === 0) {
    console.log("No legacy plaintext files found.");
    return;
  }

  console.log(`Found ${legacyFiles.length} legacy file(s). Starting migration...`);
  if (args.dryRun) {
    console.log("Dry run enabled: no DB updates or Drive writes will be committed.");
  }

  const results = [];
  for (const row of legacyFiles) {
    // eslint-disable-next-line no-await-in-loop
    const result = await migrateFileRow(row, tokenSecrets, args.dryRun);
    results.push(result);
    if (result.status === "migrated") {
      console.log(`Migrated ${row.file_id}`);
    } else {
      console.log(`Failed ${row.file_id}: ${result.error}`);
    }
  }

  const migrated = results.filter((r) => r.status === "migrated").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log("Migration summary:");
  console.log(`- Migrated: ${migrated}`);
  console.log(`- Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Migration crashed:", err.message);
  process.exit(1);
});
