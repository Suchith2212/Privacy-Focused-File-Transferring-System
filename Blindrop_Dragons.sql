create database blinddrop;
use blinddrop;
-- =====================================================
-- DATABASE: Secure Vault System
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================
-- 1. VAULTS (Outer Tokens)
-- =====================================================
CREATE TABLE vaults (
    vault_id CHAR(36) PRIMARY KEY,
    outer_token VARCHAR(32) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    status ENUM('ACTIVE','EXPIRED','DELETED') NOT NULL,
    CHECK (expires_at > created_at)
);

-- =====================================================
-- 2. INNER TOKENS
-- =====================================================
CREATE TABLE inner_tokens (
    inner_token_id CHAR(36) PRIMARY KEY,
    vault_id CHAR(36) NOT NULL,
    token_type ENUM('MAIN','SUB') NOT NULL,
    token_hash CHAR(64) NOT NULL,         -- SHA-256
    salt CHAR(32) NOT NULL,
    key_iterations INT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    status ENUM('ACTIVE','REVOKED') NOT NULL,
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 3. FILES (Encrypted storage reference)
-- =====================================================
CREATE TABLE files (
    file_id CHAR(36) PRIMARY KEY,
    vault_id CHAR(36) NOT NULL,
    storage_path TEXT NOT NULL,
    file_key_iv CHAR(32) NOT NULL,
    file_hmac CHAR(32) NOT NULL,
    status ENUM('ACTIVE','DELETED') NOT NULL,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 4. FILE METADATA
-- =====================================================
CREATE TABLE file_metadata (
    metadata_id CHAR(36) PRIMARY KEY,
    file_id CHAR(36) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_at TIMESTAMP NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(file_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 5. FILE KEY ACCESS (which inner token can open file)
-- =====================================================
CREATE TABLE file_key_access (
    access_id CHAR(36) PRIMARY KEY,
    file_id CHAR(36) NOT NULL,
    inner_token_id CHAR(36) NOT NULL,
    encrypted_file_key CHAR(64) NOT NULL,   -- SHA-256 encrypted key
    FOREIGN KEY (file_id) REFERENCES files(file_id)
        ON DELETE CASCADE,
    FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 6. SESSIONS
-- =====================================================
CREATE TABLE sessions (
    session_id CHAR(36) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_activity TIMESTAMP NULL
);

-- =====================================================
-- 7. AUTH ATTEMPTS
-- =====================================================
CREATE TABLE auth_attempts (
    attempt_id CHAR(36) PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    vault_id CHAR(36) NOT NULL,
    attempt_time TIMESTAMP NOT NULL,
    success BOOLEAN NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        ON DELETE CASCADE,
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 8. DOWNLOAD LOGS
-- =====================================================
CREATE TABLE download_logs (
    download_id CHAR(36) PRIMARY KEY,
    file_id CHAR(36) NOT NULL,
    inner_token_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    download_time TIMESTAMP NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(file_id)
        ON DELETE CASCADE,
    FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id)
        ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 9. CAPTCHA TRACKING
-- =====================================================
CREATE TABLE captcha_tracking (
    captcha_id CHAR(36) PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    attempts INT NOT NULL,
    required BOOLEAN NOT NULL,
    last_attempt TIMESTAMP NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        ON DELETE CASCADE
);

-- =====================================================
-- 10. AUDIT LOGS
-- =====================================================




CREATE TABLE expiry_jobs (
    job_id CHAR(36) PRIMARY KEY,
    vault_id CHAR(36) UNIQUE NOT NULL,
    scheduled_time TIMESTAMP NOT NULL,
    processed BOOLEAN NOT NULL,
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO vaults VALUES ('7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', 'soq1NXgc8ibv2g', '2026-01-29 10:30:46', '2026-02-05 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('6d7c0b77-2273-4154-b90b-3a43f4f59c82', 'sGrQhO7hz-PgZg', '2026-01-27 10:30:46', '2026-02-03 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('ac2a67d8-d769-4231-81f8-1e918eb395b0', 'yVv8JqRFp7-CPg', '2026-01-23 10:30:46', '2026-01-30 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 'v3qogScTBndfbw', '2026-01-18 10:30:46', '2026-01-25 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('a175007b-e9cd-46b1-90da-96169514ec8f', 'Zygbp4fiB58zqA', '2026-02-14 10:30:46', '2026-02-21 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '3SlagA1Mm9EYjQ', '2026-01-25 10:30:46', '2026-02-01 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('b7454b74-9062-436f-a9d8-bbdcb96f3eac', 'Y9FDcdRJzL2Sbg', '2026-01-21 10:30:46', '2026-01-28 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 'hJY-TUhjSJo3MA', '2026-02-10 10:30:46', '2026-02-17 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('fbd3b069-75b7-484e-8050-6b20d8d7a0e8', 'QGURqAEisBShUg', '2026-01-26 10:30:46', '2026-02-02 10:30:46', 'ACTIVE');
INSERT INTO vaults VALUES ('60059fa4-b21b-4ada-9ebe-5593eddc5594', 'oQoy-Jkk1kdZeA', '2026-01-19 10:30:46', '2026-01-26 10:30:46', 'ACTIVE');

-- inner_tokens
INSERT INTO inner_tokens VALUES ('0d5009cf-2a6e-490b-aabf-25a1ef8429bc', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', 'MAIN', '9c6cacd59dfc2af5a9a496a8bc94746386e227b8985382ef6036ba95dc1914cc', 'f356ea5878dcbe89923af1734f7dbb75', '250000', '2026-01-29 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('82aebcac-5146-4cf4-a5bf-56e05f5eb917', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', 'SUB', 'b3a2d3da6288d07cc1ef30c87b0eab3ea867ec30d06750296c6a7012e02a9f31', '2c17ba507b0dd6b1a8bb8cc38a718b90', '250000', '2026-01-30 09:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('d42b27e8-265b-4ab7-aa9a-f2cd3c1570a9', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', 'SUB', 'c9e4d3db4307cd944e5e5af6b08a92c1b64337a90190e466ed7b25d8d2639266', 'b5c490c2a44b5e5d943dac21aec94470', '250000', '2026-01-30 02:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 'MAIN', '6c5364fd8980f86e22405d496a434e8252bee3d653ed32d0f8e933de14f78637', '16d906edca088212e6a929ac2ba979df', '250000', '2026-01-27 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('576032ff-1908-42b9-87be-e5c8f7b6a699', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 'SUB', '4017fdcde300cb80453205d11e6d287a5054509fb7fc98507ffa9e6ec5d511ee', '494d14f88d9df993683e4ae119da437a', '250000', '2026-01-27 11:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('4fb74e06-450d-4c0f-a3b5-58231451040c', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 'SUB', '6ace7300a1ce0d083637372068b262ee1f47d2c5f5dd6c32018c597bced430da', 'baba908ca4ca9c00b94e6559a2bfff20', '250000', '2026-01-27 14:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('1ada1aa0-708a-424b-937d-1827a3daabad', 'ac2a67d8-d769-4231-81f8-1e918eb395b0', 'MAIN', '4e6c3a54104a36f736dce89562fc9f757bad41f3fad2bbf320a4c5c7c266aead', '4994f6ae3279605b52506bcd66b10897', '250000', '2026-01-23 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 'MAIN', '110841239d7e908473c28500afa143f58a5e865ca184dede2a910fd633fd8b63', '6b1993be57972fd831d94c4794fe87d3', '250000', '2026-01-18 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('c5518146-fed4-4371-a9be-cc1c10a8a95c', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 'SUB', 'be09d4ce320f5a7ddc37749b06b8269ec768f425eef890edfed49e5c3a2f87d3', 'bbed1fceda127d76631a6da18c6eb1ac', '250000', '2026-01-19 07:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('97e7a4f9-3ee3-475f-b26c-f7d0bdfe7adc', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 'SUB', '9a4a132f1bc76673b6302f9289ef6b4e03a7824fd75947be69f12aab8f1350aa', '45cc1e96d80b519835796c7ca9790136', '250000', '2026-01-18 23:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('416c6242-314b-4d1c-ab03-5da9024937a0', 'a175007b-e9cd-46b1-90da-96169514ec8f', 'MAIN', '11df493fbce7fafe24d9d9d03387e44f55d9dbaef4496f58cff615d4859ed85a', '9c12acdf704a910f888d5612869160b4', '250000', '2026-02-14 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('9c9afbd9-e75a-4e38-b70b-3b72685e3043', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', 'MAIN', '64c2f8065ed269fb5325a2622b2d2af8b9503cc2b0c5a01aa968472e68cf69c6', '33457d4db2135e32c4c0a6bbf13629c0', '250000', '2026-01-25 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('79c0ad81-1408-4fa6-92fe-5a9eec103957', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', 'MAIN', 'ac33e0b1de7f5dab6a9d65578be4d6c032b6512d6b789465887a845c79f0da40', '3d806a152daff31d448d4450edea13a2', '250000', '2026-01-21 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('9c682900-966f-43a5-b546-1f3343238ea2', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', 'SUB', '2ae4da74d8786cebf8b65c883931ce8a1ba655b48fea6bca206fccbb18533615', 'c34510faacbbf7a99adb848f78636886', '250000', '2026-01-22 04:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('1e5c1140-adbc-41b7-9357-4e54c96ba7db', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 'MAIN', 'e92c581fbb230391482c7a54cb0c0c226e5cdc3ff9306527e6ef20d440963f5b', 'b28f86d169e956db5f2fd1f43101a6de', '250000', '2026-02-10 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('b84e82e8-7222-4ecc-9b1c-36b51791b512', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 'SUB', '928b4a894570baaac0ba6159e866ff5849d3cd01ff0e728e7c191f35a0fa5aef', 'a7848777bb67697125d95aae9816c3c2', '250000', '2026-02-11 03:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('2df95e4d-0029-468d-b00c-cab8c0e39fad', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 'SUB', 'c33b05d9578589c5d1be3af55ec58b490e6e4ea2051b043861dcc1b38884180d', '0da4c3bb25123ef9d6c3a022d1cf7817', '250000', '2026-02-11 01:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('3a23c964-37c4-49df-846b-e631acff7dc3', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', 'MAIN', 'b53be7bc59c12aa33ccf97a94581bde897d20619872d92d3eebe622fa13c9b93', 'acfafd1700669003dd29a38e56ce1c00', '250000', '2026-01-26 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('a59285b2-5791-454b-acba-36cc80ea0677', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', 'SUB', '53c6c1e3e3e9567833b4485382b0a3af28806833951514de73a1ca5fffbe2578', '275fd234b1e8d861845fc2336ab2893d', '250000', '2026-01-26 21:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('1ed76d74-47ce-434f-bbaa-7ed0dd0ca7a3', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', 'SUB', 'b2e9eb0352d487a172c450f06242eca281def17d4706215330242e0f07842bbf', '1257a6c41308be860403e85acaed7af1', '250000', '2026-01-26 13:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('5fab33c0-bbe0-490f-a714-7b46669324e7', '60059fa4-b21b-4ada-9ebe-5593eddc5594', 'MAIN', 'e0b5ac1bf281fb983684795f6ba27ec11fa745337c027904ba667ce30d4738f0', '3c73220822345b7b9eb8a78f68271a42', '250000', '2026-01-19 10:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('beda7329-5a66-4487-9db8-48d0ffd6a838', '60059fa4-b21b-4ada-9ebe-5593eddc5594', 'SUB', 'ca042401d4fa22446c26cd4e5c27ca878dc375c30ec17e3f81f9f255354b0db9', 'b032ee68b5f5e17084b894148e4c17ca', '250000', '2026-01-20 06:30:46', 'ACTIVE');
INSERT INTO inner_tokens VALUES ('cf6c6da5-16f1-436e-ab2c-2e4b634ccb56', '60059fa4-b21b-4ada-9ebe-5593eddc5594', 'SUB', '09cff7a7543fdc32c58f547672e6b4d5b73a6d6386e28645b8fa881013b1e034', '20a91ee5dad5dd25063a2fcbd984fe7a', '250000', '2026-01-19 22:30:46', 'ACTIVE');

-- files
INSERT INTO files VALUES ('27e11b3b-d988-431c-9a8b-fb65dbb2ef56', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', 's3://blindrop-secure/7c106e0e-b9a8-431b-a5cb-bca1d8791ad7/27e11b3b-d988-431c-9a8b-fb65dbb2ef56.enc', '2ae1eea08d6bb865720c92e34a1501a9', 'a678b2e5ddcb618b3df71f89b4192768', 'ACTIVE', NULL);
INSERT INTO files VALUES ('347c076f-5c5d-4df0-a2b2-79ca8d77028e', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', 's3://blindrop-secure/7c106e0e-b9a8-431b-a5cb-bca1d8791ad7/347c076f-5c5d-4df0-a2b2-79ca8d77028e.enc', 'c3b35a0c4bfab5049d78ec882827980c', 'c531035be2f23c13a21af91e6096c4dd', 'ACTIVE', NULL);
INSERT INTO files VALUES ('b732bdea-5a42-460d-a5be-605b8bdd7a02', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 's3://blindrop-secure/6d7c0b77-2273-4154-b90b-3a43f4f59c82/b732bdea-5a42-460d-a5be-605b8bdd7a02.enc', '83a10f2db474000aeac3ebe20df92713', 'fd47e25b1ecce1aa59b9e0695f5f043b', 'ACTIVE', NULL);
INSERT INTO files VALUES ('690a2406-1490-4431-937d-6fba85983fa9', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 's3://blindrop-secure/6d7c0b77-2273-4154-b90b-3a43f4f59c82/690a2406-1490-4431-937d-6fba85983fa9.enc', '45c8e34dcd3e7ee486cb3e086c15a5b2', '8dbcb1ecf25be3278349dd73304a0b1b', 'ACTIVE', NULL);
INSERT INTO files VALUES ('538ab8b5-3c69-4c32-914f-16f456c57011', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 's3://blindrop-secure/6d7c0b77-2273-4154-b90b-3a43f4f59c82/538ab8b5-3c69-4c32-914f-16f456c57011.enc', 'dddbf2cfb28efd9a039a4a5f3ac54332', 'ed43138f45b434c32a8093159bfba744', 'ACTIVE', NULL);
INSERT INTO files VALUES ('baef6ed4-0ba8-45bd-8eef-8cceca9e30f7', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', 's3://blindrop-secure/6d7c0b77-2273-4154-b90b-3a43f4f59c82/baef6ed4-0ba8-45bd-8eef-8cceca9e30f7.enc', '67cf445d9ffcbc3cdcd0cf0f75ac7f79', '1bde58c71c7513206164c4bd56f07675', 'ACTIVE', NULL);
INSERT INTO files VALUES ('c4a1a64a-1b04-4bba-9506-c656a5fa9b6a', 'ac2a67d8-d769-4231-81f8-1e918eb395b0', 's3://blindrop-secure/ac2a67d8-d769-4231-81f8-1e918eb395b0/c4a1a64a-1b04-4bba-9506-c656a5fa9b6a.enc', '3971c8e10491cd86d2cab480315c184a', '5673882cdf539751bd3636e68f2466bf', 'ACTIVE', NULL);
INSERT INTO files VALUES ('4788a0af-1a49-49e0-b0a7-1a793e690d82', 'ac2a67d8-d769-4231-81f8-1e918eb395b0', 's3://blindrop-secure/ac2a67d8-d769-4231-81f8-1e918eb395b0/4788a0af-1a49-49e0-b0a7-1a793e690d82.enc', 'f2f3b09052f43b6eecca03e11c4de7cf', '9365e4e2c58e7afacb73eb185f90f295', 'ACTIVE', NULL);
INSERT INTO files VALUES ('f5d5eb27-9994-4e99-b95a-887821319657', 'ac2a67d8-d769-4231-81f8-1e918eb395b0', 's3://blindrop-secure/ac2a67d8-d769-4231-81f8-1e918eb395b0/f5d5eb27-9994-4e99-b95a-887821319657.enc', 'e6d8817d69d54903bf92b2fdda9a9834', '25ee017420e11188381f96894426c05f', 'ACTIVE', NULL);
INSERT INTO files VALUES ('38cd1069-aef1-43c8-8c8b-7ec4b21d5edd', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 's3://blindrop-secure/9e1b5df7-2dee-455e-9a1c-2b7e6353c17f/38cd1069-aef1-43c8-8c8b-7ec4b21d5edd.enc', 'd2a1d2af4eb1871e9656d1a3d7e7f949', 'fd880c12c951e0e42d6572ec12e6f2fd', 'ACTIVE', NULL);
INSERT INTO files VALUES ('060e86ec-904a-488d-9511-b293ab93c49c', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 's3://blindrop-secure/9e1b5df7-2dee-455e-9a1c-2b7e6353c17f/060e86ec-904a-488d-9511-b293ab93c49c.enc', '1529c4b80dc153a930d1e6a5564e8c86', 'd39a341864667b4409fe9125cc5134de', 'ACTIVE', NULL);
INSERT INTO files VALUES ('8ae98efe-55e7-4d28-a042-fd2dba0d3635', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', 's3://blindrop-secure/9e1b5df7-2dee-455e-9a1c-2b7e6353c17f/8ae98efe-55e7-4d28-a042-fd2dba0d3635.enc', '766924d7bcc4cdf9529f91a86e7e8460', 'c77959b96a5633a1d088c1e80aef5c5e', 'ACTIVE', NULL);
INSERT INTO files VALUES ('052230c8-5677-4e41-a7e0-ba73eeec26da', 'a175007b-e9cd-46b1-90da-96169514ec8f', 's3://blindrop-secure/a175007b-e9cd-46b1-90da-96169514ec8f/052230c8-5677-4e41-a7e0-ba73eeec26da.enc', '59a1eb0694182fcc9cafc32ffbe61d56', 'aa0af19f51d75ed2c73256827458c4d3', 'ACTIVE', NULL);
INSERT INTO files VALUES ('56b04a67-536e-48d2-9f13-cca61ffdbd5d', 'a175007b-e9cd-46b1-90da-96169514ec8f', 's3://blindrop-secure/a175007b-e9cd-46b1-90da-96169514ec8f/56b04a67-536e-48d2-9f13-cca61ffdbd5d.enc', 'ca14b1659b9219f708ed94d1278f7c53', '864e92e7f89cf9a30dc9b414ce3ddda3', 'ACTIVE', NULL);
INSERT INTO files VALUES ('cc691158-916c-41cf-964f-139c3675772a', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', 's3://blindrop-secure/18c489be-3dcf-4ee5-b1c6-7ea94fbf741f/cc691158-916c-41cf-964f-139c3675772a.enc', '31818f59947532566b325033d22a95c0', '2575d611077b95cf792923ae44e87bd5', 'ACTIVE', NULL);
INSERT INTO files VALUES ('79e0b8b9-65c0-42a5-b408-fa652f9ee13a', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', 's3://blindrop-secure/18c489be-3dcf-4ee5-b1c6-7ea94fbf741f/79e0b8b9-65c0-42a5-b408-fa652f9ee13a.enc', '92a2bce920fc8020a9615bdbeaef8a1b', 'b2d90d4b20c79333488c1def6524a839', 'ACTIVE', NULL);
INSERT INTO files VALUES ('e2328bee-afb1-4f6e-839b-0a70646d76be', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', 's3://blindrop-secure/18c489be-3dcf-4ee5-b1c6-7ea94fbf741f/e2328bee-afb1-4f6e-839b-0a70646d76be.enc', '5758197c5d6343637a9446e3960a16b9', '57eecfed39c1b03d320fadce4fb39f8f', 'ACTIVE', NULL);
INSERT INTO files VALUES ('3aac6392-f805-43de-a85b-8126d709c849', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', 's3://blindrop-secure/18c489be-3dcf-4ee5-b1c6-7ea94fbf741f/3aac6392-f805-43de-a85b-8126d709c849.enc', '2f25b55105915203978cd9c8c2d21549', '83555b2b5ddd1f898d59de4d5239f60e', 'ACTIVE', NULL);
INSERT INTO files VALUES ('332dc8b7-67f2-4961-8c1a-07e8f1ec2505', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', 's3://blindrop-secure/b7454b74-9062-436f-a9d8-bbdcb96f3eac/332dc8b7-67f2-4961-8c1a-07e8f1ec2505.enc', '0df3ac6c44a5151c5d26dbeb64940ca0', 'd9594ba13773a0208b32593f17b73f77', 'ACTIVE', NULL);
INSERT INTO files VALUES ('362a4439-80ae-4376-9d43-87bf0161bb5c', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', 's3://blindrop-secure/b7454b74-9062-436f-a9d8-bbdcb96f3eac/362a4439-80ae-4376-9d43-87bf0161bb5c.enc', '7a59fcb5701616766748292ae9bb3923', '47061bd87e9a988194fb4c814588c9f3', 'ACTIVE', NULL);
INSERT INTO files VALUES ('c1849e94-e6c1-4061-bf00-4863d2812b83', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 's3://blindrop-secure/b7656e56-4cd6-4534-bffe-6cb89c5b4e17/c1849e94-e6c1-4061-bf00-4863d2812b83.enc', 'a4fb0cf299266b65bf6b89dee708df4d', '44c3140c43b8e08d5d5f0b7516ef397c', 'ACTIVE', NULL);
INSERT INTO files VALUES ('e01754b6-ca10-42fb-a053-519ab284cff5', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 's3://blindrop-secure/b7656e56-4cd6-4534-bffe-6cb89c5b4e17/e01754b6-ca10-42fb-a053-519ab284cff5.enc', '039eba8748db924bb762370a993033b8', '6d6f4b584d999bcf14bf566e14c060ee', 'ACTIVE', NULL);
INSERT INTO files VALUES ('53af4c5d-4764-4fed-b50d-39124a4e323a', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', 's3://blindrop-secure/b7656e56-4cd6-4534-bffe-6cb89c5b4e17/53af4c5d-4764-4fed-b50d-39124a4e323a.enc', 'cd360cd1fb9f70b9600615affe751c18', '4d8db50d71e9aba067c762b93be262bc', 'ACTIVE', NULL);
INSERT INTO files VALUES ('31b2d0a8-bf62-4cf0-bd60-9fbf9cacf379', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', 's3://blindrop-secure/fbd3b069-75b7-484e-8050-6b20d8d7a0e8/31b2d0a8-bf62-4cf0-bd60-9fbf9cacf379.enc', 'b825aa45f4ea00baf5caf9cf3042909e', '8356057a7762bd5dfa97ae1ad49b3e41', 'ACTIVE', NULL);
INSERT INTO files VALUES ('8890bf1e-b92a-4be9-8b10-0b4a13821137', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', 's3://blindrop-secure/fbd3b069-75b7-484e-8050-6b20d8d7a0e8/8890bf1e-b92a-4be9-8b10-0b4a13821137.enc', '329eb229b3f9a56b2b4d45fa909c52f5', '1f97b5e527ff8a6b5cf6f6fdf9f64f53', 'ACTIVE', NULL);
INSERT INTO files VALUES ('f7c67187-71e3-45e5-8373-c2f88620913e', '60059fa4-b21b-4ada-9ebe-5593eddc5594', 's3://blindrop-secure/60059fa4-b21b-4ada-9ebe-5593eddc5594/f7c67187-71e3-45e5-8373-c2f88620913e.enc', 'fe936c6bfdf04b0fd89d1d1232edfbab', '19732e713e5dfd1a19eae2324c0755db', 'ACTIVE', NULL);
INSERT INTO files VALUES ('6ccd011f-89d7-4235-a180-fc1b56a0b47f', '60059fa4-b21b-4ada-9ebe-5593eddc5594', 's3://blindrop-secure/60059fa4-b21b-4ada-9ebe-5593eddc5594/6ccd011f-89d7-4235-a180-fc1b56a0b47f.enc', 'a9c49880bcfc55ca4c77c3ab7de3d6ca', 'f9b68f7dabb9d9b07c5cd14d395f1583', 'ACTIVE', NULL);
INSERT INTO files VALUES ('f08869ef-cc29-41d8-92ad-0bb3161dcace', '60059fa4-b21b-4ada-9ebe-5593eddc5594', 's3://blindrop-secure/60059fa4-b21b-4ada-9ebe-5593eddc5594/f08869ef-cc29-41d8-92ad-0bb3161dcace.enc', 'ed558a2e7d856bfb9141930737903285', '8b2e07440bcf838fa5f33a8aff6f527f', 'ACTIVE', NULL);

-- file_metadata
INSERT INTO file_metadata VALUES ('0e1ebb8f-7a07-4e4e-a9e8-a00c84924b43', '27e11b3b-d988-431c-9a8b-fb65dbb2ef56', 'Invoice_March.pdf', 'application/pdf', '821062', '2026-02-01 01:30:46');
INSERT INTO file_metadata VALUES ('706a6143-f2c2-43fc-b4aa-1ba3d87acacc', '347c076f-5c5d-4df0-a2b2-79ca8d77028e', 'Passport.pdf', 'application/pdf', '3675884', '2026-01-29 19:30:46');
INSERT INTO file_metadata VALUES ('dc44e04d-e31e-46a1-8834-95975aaeed3b', 'b732bdea-5a42-460d-a5be-605b8bdd7a02', 'Project_Report.pdf', 'application/pdf', '4943306', '2026-01-29 08:30:46');
INSERT INTO file_metadata VALUES ('75a3ec44-f093-4764-b05b-b4034235cf56', '690a2406-1490-4431-937d-6fba85983fa9', 'Degree_Certificate.pdf', 'application/pdf', '4454108', '2026-01-28 16:30:46');
INSERT INTO file_metadata VALUES ('d9ce6efa-d7bd-4fbf-8115-400e3dd0277e', '538ab8b5-3c69-4c32-914f-16f456c57011', 'Aadhaar.pdf', 'application/pdf', '3981806', '2026-01-29 14:30:46');
INSERT INTO file_metadata VALUES ('084a1534-fc01-4891-9707-acc26ec8c1f1', 'baef6ed4-0ba8-45bd-8eef-8cceca9e30f7', 'Bank_Statement.pdf', 'application/pdf', '464785', '2026-01-29 20:30:46');
INSERT INTO file_metadata VALUES ('ad93a2dc-e3b7-47fb-9f3f-d289ae0b0e50', 'c4a1a64a-1b04-4bba-9506-c656a5fa9b6a', 'Degree_Certificate.pdf', 'application/pdf', '4793121', '2026-01-23 16:30:46');
INSERT INTO file_metadata VALUES ('d214d556-69bb-4aef-9010-99ed8c4e1398', '4788a0af-1a49-49e0-b0a7-1a793e690d82', 'Project_Report.pdf', 'application/pdf', '4080510', '2026-01-25 23:30:46');
INSERT INTO file_metadata VALUES ('1707d7a6-4fb8-4e61-8a9c-7e6ffe04fcd1', 'f5d5eb27-9994-4e99-b95a-887821319657', 'Degree_Certificate.pdf', 'application/pdf', '4670291', '2026-01-26 08:30:46');
INSERT INTO file_metadata VALUES ('3a6059b9-a5c8-4818-a783-31ae1a04a1ca', '38cd1069-aef1-43c8-8c8b-7ec4b21d5edd', 'Project_Report.pdf', 'application/pdf', '1189325', '2026-01-20 12:30:46');
INSERT INTO file_metadata VALUES ('0ed2c724-cd10-4d5d-9d53-b2f78efc3e14', '060e86ec-904a-488d-9511-b293ab93c49c', 'Invoice_March.pdf', 'application/pdf', '4097347', '2026-01-20 22:30:46');
INSERT INTO file_metadata VALUES ('ad0deea7-1706-427c-966d-6fe056a133d7', '8ae98efe-55e7-4d28-a042-fd2dba0d3635', 'Aadhaar.pdf', 'application/pdf', '672054', '2026-01-18 20:30:46');
INSERT INTO file_metadata VALUES ('191d2055-5a36-4ad1-9bef-bbcd375c9881', '052230c8-5677-4e41-a7e0-ba73eeec26da', 'Aadhaar.pdf', 'application/pdf', '2291159', '2026-02-17 09:30:46');
INSERT INTO file_metadata VALUES ('2383a5c8-0305-481f-9eb3-af1fa597bd89', '56b04a67-536e-48d2-9f13-cca61ffdbd5d', 'Bank_Statement.pdf', 'application/pdf', '501060', '2026-02-14 18:30:46');
INSERT INTO file_metadata VALUES ('97c6d02c-07fc-4d19-a860-774ecc0bc938', 'cc691158-916c-41cf-964f-139c3675772a', 'Invoice_March.pdf', 'application/pdf', '2157377', '2026-01-26 06:30:46');
INSERT INTO file_metadata VALUES ('9c1efcb1-06b3-41ff-a1c9-c7e41a96c72b', '79e0b8b9-65c0-42a5-b408-fa652f9ee13a', 'Medical_Report.pdf', 'application/pdf', '2221082', '2026-01-26 18:30:46');
INSERT INTO file_metadata VALUES ('cd05742d-43bc-4184-b2b4-b2223449750a', 'e2328bee-afb1-4f6e-839b-0a70646d76be', 'Resume.docx', 'application/pdf', '4303891', '2026-01-25 20:30:46');
INSERT INTO file_metadata VALUES ('f695de7b-a962-4b10-9c5b-9e1afde11e32', '3aac6392-f805-43de-a85b-8126d709c849', 'Project_Report.pdf', 'application/pdf', '1139540', '2026-01-26 16:30:46');
INSERT INTO file_metadata VALUES ('bddf99c8-2de1-43f5-8943-8f19aaf9438d', '332dc8b7-67f2-4961-8c1a-07e8f1ec2505', 'Aadhaar.pdf', 'application/pdf', '202669', '2026-01-23 15:30:46');
INSERT INTO file_metadata VALUES ('81a7402e-01b1-4848-ad50-0026197f35e6', '362a4439-80ae-4376-9d43-87bf0161bb5c', 'Aadhaar.pdf', 'application/pdf', '4726635', '2026-01-21 16:30:46');
INSERT INTO file_metadata VALUES ('c96ffd94-7651-47b1-9cd8-a46df13f11aa', 'c1849e94-e6c1-4061-bf00-4863d2812b83', 'Invoice_March.pdf', 'application/pdf', '2963634', '2026-02-11 00:30:46');
INSERT INTO file_metadata VALUES ('b344dc9b-7c87-488d-9af3-1b648d80e3a4', 'e01754b6-ca10-42fb-a053-519ab284cff5', 'Medical_Report.pdf', 'application/pdf', '658342', '2026-02-12 04:30:46');
INSERT INTO file_metadata VALUES ('7f04bf6f-532a-47a8-a8f5-a3970965e38a', '53af4c5d-4764-4fed-b50d-39124a4e323a', 'Resume.docx', 'application/pdf', '1056302', '2026-02-12 08:30:46');
INSERT INTO file_metadata VALUES ('a97c0a75-4971-47b2-8705-7208ee84c9b2', '31b2d0a8-bf62-4cf0-bd60-9fbf9cacf379', 'Degree_Certificate.pdf', 'application/pdf', '4207752', '2026-01-28 12:30:46');
INSERT INTO file_metadata VALUES ('cc8b5fa3-7718-4447-b29e-dc74797d8c75', '8890bf1e-b92a-4be9-8b10-0b4a13821137', 'Degree_Certificate.pdf', 'application/pdf', '4175001', '2026-01-26 20:30:46');
INSERT INTO file_metadata VALUES ('83ccbd7a-4935-4253-96ac-1e6bd2ea248e', 'f7c67187-71e3-45e5-8373-c2f88620913e', 'Aadhaar.pdf', 'application/pdf', '3938321', '2026-01-19 13:30:46');
INSERT INTO file_metadata VALUES ('667a52a5-9006-4f1d-8001-4846ee83f4a6', '6ccd011f-89d7-4235-a180-fc1b56a0b47f', 'Degree_Certificate.pdf', 'application/pdf', '4191012', '2026-01-19 20:30:46');
INSERT INTO file_metadata VALUES ('e0c095c6-c860-4880-8962-e7e22ba0b2a9', 'f08869ef-cc29-41d8-92ad-0bb3161dcace', 'Invoice_March.pdf', 'application/pdf', '2146502', '2026-01-20 19:30:46');

-- file_key_access
INSERT INTO file_key_access VALUES ('80a8faa8-36f7-41e3-9977-726ac112e17a', '27e11b3b-d988-431c-9a8b-fb65dbb2ef56', '0d5009cf-2a6e-490b-aabf-25a1ef8429bc', '2024e9b23dfd229272720741ad24531057dc6678a9fdd38f8392e5e9f8565339');
INSERT INTO file_key_access VALUES ('af33dda1-8412-4ca0-9f19-230d3617e21d', '27e11b3b-d988-431c-9a8b-fb65dbb2ef56', '82aebcac-5146-4cf4-a5bf-56e05f5eb917', '381068c45b053d11b51244b984bae6bae61b4bc7450d95e2a51a53884e2c4f23');
INSERT INTO file_key_access VALUES ('84dd99e0-961e-4b77-83ac-178b1e543b0e', '347c076f-5c5d-4df0-a2b2-79ca8d77028e', '0d5009cf-2a6e-490b-aabf-25a1ef8429bc', 'b90ab1013f8243334c396756f0948cc9237b673cdb10f64baa8b39afff8e12b3');
INSERT INTO file_key_access VALUES ('a2313a8d-bff6-4325-94f9-335cd8266779', 'b732bdea-5a42-460d-a5be-605b8bdd7a02', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', '93a33a329aafc3726647e29d2e40b36b67cfaeae35bec8b9153f82b1862814ad');
INSERT INTO file_key_access VALUES ('5f673568-6151-42da-971e-5f267c902b69', 'b732bdea-5a42-460d-a5be-605b8bdd7a02', '4fb74e06-450d-4c0f-a3b5-58231451040c', '7696e27ce562969ea76d0a3f772cd6c9ee675fc0a04a92954c07f34d9d929a14');
INSERT INTO file_key_access VALUES ('bcfff240-bb9d-4a46-acca-a4c1fb88f7ad', '690a2406-1490-4431-937d-6fba85983fa9', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', 'd0aec5413834c341ca433e5863d4f29d70f03519b97f57da5d159d4a911f8ea8');
INSERT INTO file_key_access VALUES ('b464d702-f0a4-49e4-982a-e2f6b3f9fe18', '690a2406-1490-4431-937d-6fba85983fa9', '4fb74e06-450d-4c0f-a3b5-58231451040c', 'c80b32c92161db6ebf3dc06c26467122288fc2c4013525b49e880b8fb5d34834');
INSERT INTO file_key_access VALUES ('1e7f1b3f-66a1-4da4-b333-c6a40bba9998', '538ab8b5-3c69-4c32-914f-16f456c57011', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', '20040b1466e2e6d67d5d18fbf6baf5c5abfc19639c7e6a757c7f26bbd243b492');
INSERT INTO file_key_access VALUES ('feb4529c-ceef-44cf-b04c-4bd325b660d1', '538ab8b5-3c69-4c32-914f-16f456c57011', '576032ff-1908-42b9-87be-e5c8f7b6a699', 'e011c2ec70b8ccf7d9ea5317938da0f22a87f09d59b99401de8537141c0fbc30');
INSERT INTO file_key_access VALUES ('dcea40d4-b6b6-4d44-9f67-36fb748495be', 'baef6ed4-0ba8-45bd-8eef-8cceca9e30f7', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', '5403919e8c9531879d2bbc6446de452b39be03386a8d6e34bb6f15e98bd84b3d');
INSERT INTO file_key_access VALUES ('1ee3be83-013e-473b-94a8-9d262ee81c6a', 'c4a1a64a-1b04-4bba-9506-c656a5fa9b6a', '1ada1aa0-708a-424b-937d-1827a3daabad', '704342e1a2ae7e5d38624b215fa22ff8ed54f6d59d10b0626938984990432381');
INSERT INTO file_key_access VALUES ('6070d72a-639b-4189-9e50-5d2da45a5346', '4788a0af-1a49-49e0-b0a7-1a793e690d82', '1ada1aa0-708a-424b-937d-1827a3daabad', 'e37b9395dabc8734845b101d7443d6a8151c17a81412539d8b2828ea3781c94b');
INSERT INTO file_key_access VALUES ('26573394-5082-4e46-ba39-3c3e14d8e29d', 'f5d5eb27-9994-4e99-b95a-887821319657', '1ada1aa0-708a-424b-937d-1827a3daabad', '67f010dce50010e8e4dc6ac769b440db692e4e6bceee3eed9db32bbc7958a22a');
INSERT INTO file_key_access VALUES ('a0d74c32-3817-496d-813d-26195cc7fb3a', '38cd1069-aef1-43c8-8c8b-7ec4b21d5edd', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '57850579eff741dfe1864d76f66833e95b7c6e9196c36b45c8368996b2ac01a8');
INSERT INTO file_key_access VALUES ('66086a5b-8ecd-4bbb-b620-4a18b64f70e1', '38cd1069-aef1-43c8-8c8b-7ec4b21d5edd', 'c5518146-fed4-4371-a9be-cc1c10a8a95c', 'e505b37765c9f027f9ef01dca7af38a4d910e9447a4db5aaebd2d00bcc26651b');
INSERT INTO file_key_access VALUES ('d098d618-46dc-4ab3-883a-ca0f87b735f5', '060e86ec-904a-488d-9511-b293ab93c49c', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '80b94fb74a55885badc7af65d671bd0ee8a76935a662b183342a1d17972466be');
INSERT INTO file_key_access VALUES ('c54a0bff-5b0d-4f47-9626-6ec5a0f86d83', '060e86ec-904a-488d-9511-b293ab93c49c', 'c5518146-fed4-4371-a9be-cc1c10a8a95c', '2df9957d059193fa81e81f2121b4c365ef7a1fede5583e7fa6c99f0d862a36b7');
INSERT INTO file_key_access VALUES ('0c1a8a02-1d9c-4d86-a637-e3b6616ffc9c', '8ae98efe-55e7-4d28-a042-fd2dba0d3635', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '478c7adff01aa860956988d27e99cbba51929752149f1f65c583dfc601422e2c');
INSERT INTO file_key_access VALUES ('d8e71f3e-430c-4a49-b5f2-89e97538f12f', '052230c8-5677-4e41-a7e0-ba73eeec26da', '416c6242-314b-4d1c-ab03-5da9024937a0', '71eba21d93b59f6b7a2e337115a5b6ca994dff967888737bba1925e63963d84c');
INSERT INTO file_key_access VALUES ('bc92e262-474e-4779-b666-b013e77b1acb', '56b04a67-536e-48d2-9f13-cca61ffdbd5d', '416c6242-314b-4d1c-ab03-5da9024937a0', '9de7c7302275ccd91a9d57531dc1b68c5a3715f398358784be8471bda8fbecd4');
INSERT INTO file_key_access VALUES ('35159c1c-0168-47de-a699-7564e814b674', 'cc691158-916c-41cf-964f-139c3675772a', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', 'dca99c204f8860603499ba9342739d336c119a1b6d596ad421663c82e0316bcb');
INSERT INTO file_key_access VALUES ('3860771d-fb1e-4152-abd5-7f18bf99e86f', '79e0b8b9-65c0-42a5-b408-fa652f9ee13a', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '94d8168f9cea746ef53738768594b7601e3088a8f3f91dd43670707161e61d87');
INSERT INTO file_key_access VALUES ('e4bdb45f-24a5-4740-98a1-9e67e5cf9564', 'e2328bee-afb1-4f6e-839b-0a70646d76be', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '3286ca93bbd27000bf7b7f4e3cdd09b9247b8a68f136e03fc510cd92ce3a5ed4');
INSERT INTO file_key_access VALUES ('5c186d65-9f60-49fe-85f7-2dd34d7b57c7', '3aac6392-f805-43de-a85b-8126d709c849', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '309256beec949da8dd473dc9d2e1c44a1156ad7a03efe7514d0b789256b6b82b');
INSERT INTO file_key_access VALUES ('ea4b7ebf-35cc-451c-8900-a3b3c1ef9b1e', '332dc8b7-67f2-4961-8c1a-07e8f1ec2505', '79c0ad81-1408-4fa6-92fe-5a9eec103957', 'b4ca15215727ca11f38981db029342fe6c1770e37a862aa0bdca8f6929d8b58d');
INSERT INTO file_key_access VALUES ('290fbeb8-8f1f-4625-8b63-772332211cfa', '332dc8b7-67f2-4961-8c1a-07e8f1ec2505', '9c682900-966f-43a5-b546-1f3343238ea2', 'd2732bae72ddc105451dd0fc0c0031c4796e5f3c7b0a1e87448ebcb361604c0e');
INSERT INTO file_key_access VALUES ('106c38b9-b279-4089-b844-9b69659a6b32', '362a4439-80ae-4376-9d43-87bf0161bb5c', '79c0ad81-1408-4fa6-92fe-5a9eec103957', 'fb5199c82bd00b7dd3a57f7a3c385ae6a9e97cf32252629d5f78789881da2c7e');
INSERT INTO file_key_access VALUES ('63908c86-2e33-49fe-9e02-bd76bba2b926', 'c1849e94-e6c1-4061-bf00-4863d2812b83', '1e5c1140-adbc-41b7-9357-4e54c96ba7db', '332accc00326065012cbec675f261e1e4a34a533a99c4753ee9c361a0f630bb1');
INSERT INTO file_key_access VALUES ('11c7435f-6001-4e4e-9a89-533f039e14d1', 'c1849e94-e6c1-4061-bf00-4863d2812b83', 'b84e82e8-7222-4ecc-9b1c-36b51791b512', 'f109c114607926ab2212012ca47c67bddb2084d702ac9844ca1e30b1c43a2908');
INSERT INTO file_key_access VALUES ('03a991a6-a0ae-4b70-a630-1fa71c920bec', 'e01754b6-ca10-42fb-a053-519ab284cff5', '1e5c1140-adbc-41b7-9357-4e54c96ba7db', '1412779791c7c153d013388bbb5f0463d937106c9cd6e8adef502d7656074331');
INSERT INTO file_key_access VALUES ('05e797f5-e83f-48c1-bd70-398e7ccaa198', 'e01754b6-ca10-42fb-a053-519ab284cff5', 'b84e82e8-7222-4ecc-9b1c-36b51791b512', '2c5dae05f0b32edd40179e644f2aa6c72a23c93954973b7484f6e9846bb6a2f8');
INSERT INTO file_key_access VALUES ('dbab55ed-ea7b-4311-b6cb-783b1659c956', '53af4c5d-4764-4fed-b50d-39124a4e323a', '1e5c1140-adbc-41b7-9357-4e54c96ba7db', 'cb3f96c5ddae86dd97ef93f70a710348f264e0ff4bfcee2c593975796407e95f');
INSERT INTO file_key_access VALUES ('e9417865-7a17-40fc-9510-867488d29042', '53af4c5d-4764-4fed-b50d-39124a4e323a', 'b84e82e8-7222-4ecc-9b1c-36b51791b512', '019e720a5d514c418330c03f35a19c5fd2954e1e74c24bc71cf54e08682fbb9b');
INSERT INTO file_key_access VALUES ('3f5c0f34-898b-4c93-8074-3003f01fae05', '31b2d0a8-bf62-4cf0-bd60-9fbf9cacf379', '3a23c964-37c4-49df-846b-e631acff7dc3', '986ded5bf9d668640e53ceb5296422d196acfd5e949c581c41ebfed3c734fdea');
INSERT INTO file_key_access VALUES ('8419a85b-66af-4189-8918-9df98f6150bd', '31b2d0a8-bf62-4cf0-bd60-9fbf9cacf379', 'a59285b2-5791-454b-acba-36cc80ea0677', 'abc411898bb66673eea78747e98d516207370fa9d74da4cdd2c41b36512f4608');
INSERT INTO file_key_access VALUES ('cf672cb2-2289-41ca-b996-097c84a487de', '8890bf1e-b92a-4be9-8b10-0b4a13821137', '3a23c964-37c4-49df-846b-e631acff7dc3', '4afe5ea44e651d52b0319b0bd04f91ecdc7f58788c17593f2d3d916970dda45e');
INSERT INTO file_key_access VALUES ('2bd6288a-99ec-4c48-a447-3b98e096feed', '8890bf1e-b92a-4be9-8b10-0b4a13821137', '1ed76d74-47ce-434f-bbaa-7ed0dd0ca7a3', '7e28111d5bc2fc0b583c7829d460dee7206be071fc86ff26d1f835d090452c18');
INSERT INTO file_key_access VALUES ('c652f130-fea7-43be-aaf4-f80d2a884a58', 'f7c67187-71e3-45e5-8373-c2f88620913e', '5fab33c0-bbe0-490f-a714-7b46669324e7', '8a8ca28150f649456df3d8dc980ae4fec2f2716d46e06618f54a499274aefc83');
INSERT INTO file_key_access VALUES ('37dd0f19-b6db-4aa4-8a0b-df96796a916f', '6ccd011f-89d7-4235-a180-fc1b56a0b47f', '5fab33c0-bbe0-490f-a714-7b46669324e7', 'b524f4b989ade9a10fe341ecb661d7af88d89cf6d84e903039d87b65da445c4d');
INSERT INTO file_key_access VALUES ('8896d3c5-015f-44df-874e-3b27cad4583c', '6ccd011f-89d7-4235-a180-fc1b56a0b47f', 'cf6c6da5-16f1-436e-ab2c-2e4b634ccb56', '1e7bcce2fd729fad4581b24f3d5e8ab8565ce5bab80419707f705dd828b81721');
INSERT INTO file_key_access VALUES ('35d1ccae-878a-4e3f-bec2-b7b523cd9e02', 'f08869ef-cc29-41d8-92ad-0bb3161dcace', '5fab33c0-bbe0-490f-a714-7b46669324e7', 'cff72214953914bf824493d173cc39ae3ecef48a410dcf598440e2a6f36fb4c8');
INSERT INTO file_key_access VALUES ('11e0ca78-acd0-4023-a9b9-470390656079', 'f08869ef-cc29-41d8-92ad-0bb3161dcace', 'cf6c6da5-16f1-436e-ab2c-2e4b634ccb56', '4d65d054c398079429da651938852bf169a1c98adccd96df47b0bf1307078c4e');

-- sessions
INSERT INTO sessions VALUES ('50865a64-06e6-4acd-a0e2-f95fec73f234', '219.108.10.80', 'Edge Windows', '2026-02-14 11:30:46', NULL);
INSERT INTO sessions VALUES ('22b2cfc7-ae3a-4608-9f9c-61042e02a87e', '204.67.20.204', 'Edge Windows', '2026-02-12 23:30:46', NULL);
INSERT INTO sessions VALUES ('2e6663c6-41f6-4cb0-8213-a8b98191a1d4', '99.233.247.106', 'Chrome Android', '2026-02-14 08:30:46', NULL);
INSERT INTO sessions VALUES ('139fec76-4c5d-486a-9846-431732196b07', '234.158.226.236', 'Firefox Linux', '2026-02-14 18:30:46', NULL);
INSERT INTO sessions VALUES ('1f53cacd-530e-4a91-8d2d-4a804584c682', '250.55.16.135', 'Firefox Linux', '2026-02-13 08:30:46', NULL);
INSERT INTO sessions VALUES ('1a8b87cb-2ed0-435c-80eb-f7d0d53b6689', '85.121.160.77', 'Safari iPhone', '2026-02-14 07:30:46', NULL);
INSERT INTO sessions VALUES ('6a023310-7097-4858-8110-c2eeb31b60ae', '67.127.109.234', 'Chrome/121 Windows', '2026-02-12 16:30:46', NULL);
INSERT INTO sessions VALUES ('58f10215-29f6-412f-8d04-064498df58ed', '162.123.98.54', 'Chrome Android', '2026-02-12 13:30:46', NULL);
INSERT INTO sessions VALUES ('1b893e69-36a1-4aad-a567-e660d6aa6b5b', '73.108.133.232', 'Chrome Android', '2026-02-14 16:30:46', NULL);
INSERT INTO sessions VALUES ('2e74d43c-9ccf-437b-89cd-235a61efce75', '105.182.245.121', 'Firefox Linux', '2026-02-14 17:30:46', NULL);
INSERT INTO sessions VALUES ('f830c30f-7843-4b9e-adb0-ff41d6caa374', '151.47.179.46', 'Safari iPhone', '2026-02-12 20:30:46', NULL);
INSERT INTO sessions VALUES ('168c7df1-2b8d-4e9a-a835-7d51afa48094', '102.167.107.193', 'Chrome/121 Windows', '2026-02-12 22:30:46', NULL);
INSERT INTO sessions VALUES ('0b8879db-e8a1-48d7-8fff-0696378d36e0', '155.150.133.220', 'Firefox Linux', '2026-02-12 23:30:46', NULL);
INSERT INTO sessions VALUES ('dd6a5c1a-ce35-4776-b9ca-be9fc1c6e6ab', '78.160.83.15', 'Edge Windows', '2026-02-13 16:30:46', NULL);
INSERT INTO sessions VALUES ('c3bc6d5c-ca7f-4649-ad04-459df889528e', '84.186.50.17', 'Safari iPhone', '2026-02-12 19:30:46', NULL);
INSERT INTO sessions VALUES ('b32cd956-d268-4900-89f1-065bb776cc12', '255.73.87.14', 'Chrome Android', '2026-02-13 01:30:46', NULL);
INSERT INTO sessions VALUES ('715f1c33-d609-417f-974f-33d14d07a25c', '160.182.131.177', 'Safari macOS', '2026-02-14 05:30:46', NULL);
INSERT INTO sessions VALUES ('781199a5-4c20-4964-92c0-651a5e570e04', '14.12.242.132', 'Chrome Android', '2026-02-15 00:30:46', NULL);
INSERT INTO sessions VALUES ('08395b20-c747-4c71-8ace-3919792f8179', '221.215.24.96', 'Edge Windows', '2026-02-13 11:30:46', NULL);
INSERT INTO sessions VALUES ('72a2d9ba-5861-42dd-9525-84f172571aa9', '136.218.202.23', 'Chrome Android', '2026-02-12 15:30:46', NULL);

-- auth_attempts
INSERT INTO auth_attempts VALUES ('d1c95396-ae5a-4b1f-a577-419eac5be281', '50865a64-06e6-4acd-a0e2-f95fec73f234', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-14 12:07:46', FALSE);
INSERT INTO auth_attempts VALUES ('484d1e6e-84ee-4492-95ef-d5fda44043bc', '50865a64-06e6-4acd-a0e2-f95fec73f234', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-14 12:08:46', FALSE);
INSERT INTO auth_attempts VALUES ('a7d7cc72-745c-475e-85a2-102a52bd1ac1', '50865a64-06e6-4acd-a0e2-f95fec73f234', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-14 12:22:46', FALSE);
INSERT INTO auth_attempts VALUES ('79f36460-dc07-47d1-ac56-ef7f3bd77ee8', '22b2cfc7-ae3a-4608-9f9c-61042e02a87e', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-02-13 00:01:46', FALSE);
INSERT INTO auth_attempts VALUES ('02fb7f3e-d00d-4037-9ce0-986b52acb75c', '22b2cfc7-ae3a-4608-9f9c-61042e02a87e', '60059fa4-b21b-4ada-9ebe-5593eddc5594', '2026-02-13 00:02:46', TRUE);
INSERT INTO auth_attempts VALUES ('088249de-e12a-4809-859f-5cfed0815a11', '2e6663c6-41f6-4cb0-8213-a8b98191a1d4', 'a175007b-e9cd-46b1-90da-96169514ec8f', '2026-02-14 09:14:46', TRUE);
INSERT INTO auth_attempts VALUES ('8d26d0f7-d7f1-40cd-9c16-4e2f0e1ecb12', '139fec76-4c5d-486a-9846-431732196b07', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-14 18:38:46', FALSE);
INSERT INTO auth_attempts VALUES ('cb113331-f106-4107-a814-d035772eb8b7', '1f53cacd-530e-4a91-8d2d-4a804584c682', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-13 09:14:46', TRUE);
INSERT INTO auth_attempts VALUES ('26b51c7b-23be-4380-af5d-3d4887007532', '1f53cacd-530e-4a91-8d2d-4a804584c682', 'a175007b-e9cd-46b1-90da-96169514ec8f', '2026-02-13 08:56:46', TRUE);
INSERT INTO auth_attempts VALUES ('61129c92-3b5c-41cb-b54e-baf0ef1e2c3e', '1a8b87cb-2ed0-435c-80eb-f7d0d53b6689', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-14 07:41:46', TRUE);
INSERT INTO auth_attempts VALUES ('814552e3-3c37-4327-8e29-0880cc91c7b2', '6a023310-7097-4858-8110-c2eeb31b60ae', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', '2026-02-12 16:57:46', FALSE);
INSERT INTO auth_attempts VALUES ('fb529c12-1ae6-4088-bd57-3009cfbf60e6', '6a023310-7097-4858-8110-c2eeb31b60ae', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-02-12 17:30:46', TRUE);
INSERT INTO auth_attempts VALUES ('8a817a78-606b-4a21-8add-83a869802ce8', '58f10215-29f6-412f-8d04-064498df58ed', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', '2026-02-12 14:00:46', TRUE);
INSERT INTO auth_attempts VALUES ('93acdfab-0d54-4e40-8ab7-14884de66f60', '1b893e69-36a1-4aad-a567-e660d6aa6b5b', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', '2026-02-14 16:43:46', TRUE);
INSERT INTO auth_attempts VALUES ('db02194c-2a3a-4de8-b302-16e1a632a5e9', '1b893e69-36a1-4aad-a567-e660d6aa6b5b', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-14 16:51:46', FALSE);
INSERT INTO auth_attempts VALUES ('80bfa509-6774-47ff-939c-b7081de8974e', '1b893e69-36a1-4aad-a567-e660d6aa6b5b', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', '2026-02-14 16:42:46', FALSE);
INSERT INTO auth_attempts VALUES ('13619923-5173-45c3-ae31-1f8f1fdc1dea', '2e74d43c-9ccf-437b-89cd-235a61efce75', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-14 18:11:46', FALSE);
INSERT INTO auth_attempts VALUES ('dd901090-6803-4bdd-9063-e2deac90be09', '2e74d43c-9ccf-437b-89cd-235a61efce75', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-14 18:20:46', FALSE);
INSERT INTO auth_attempts VALUES ('20563e9f-8aca-422e-b11f-4856f13822d1', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-12 20:33:46', TRUE);
INSERT INTO auth_attempts VALUES ('c6c47bbc-23bb-4b89-9c73-7c630be8ee3b', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-12 21:23:46', FALSE);
INSERT INTO auth_attempts VALUES ('4ba05a00-f1e2-4f9f-80a1-3a26c959f619', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-12 21:21:46', TRUE);
INSERT INTO auth_attempts VALUES ('334dceaa-72ad-4de8-bde9-9b121b3b8da2', '168c7df1-2b8d-4e9a-a835-7d51afa48094', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', '2026-02-12 23:00:46', TRUE);
INSERT INTO auth_attempts VALUES ('9715f492-a147-40e5-9a69-526bf34b7da1', '168c7df1-2b8d-4e9a-a835-7d51afa48094', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-02-12 22:33:46', TRUE);
INSERT INTO auth_attempts VALUES ('963cd16f-5fa4-4b29-bf25-e5f449dd436e', '0b8879db-e8a1-48d7-8fff-0696378d36e0', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', '2026-02-13 00:18:46', FALSE);
INSERT INTO auth_attempts VALUES ('67c9dd55-e8d8-4470-9d71-daf3bcf5bc67', '0b8879db-e8a1-48d7-8fff-0696378d36e0', '60059fa4-b21b-4ada-9ebe-5593eddc5594', '2026-02-13 00:02:46', FALSE);
INSERT INTO auth_attempts VALUES ('aba51fd0-5a68-435f-baf9-b1a62f3810d6', '0b8879db-e8a1-48d7-8fff-0696378d36e0', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-02-13 00:28:46', FALSE);
INSERT INTO auth_attempts VALUES ('e9935da6-d3c4-4549-b1bc-631c49a8335d', 'dd6a5c1a-ce35-4776-b9ca-be9fc1c6e6ab', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-02-13 16:48:46', TRUE);
INSERT INTO auth_attempts VALUES ('104ba32b-e8a7-49f3-8b02-3e1bda402745', 'c3bc6d5c-ca7f-4649-ad04-459df889528e', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', '2026-02-12 20:15:46', TRUE);
INSERT INTO auth_attempts VALUES ('24b6345c-907a-4cd2-83b5-cdc61c635079', 'c3bc6d5c-ca7f-4649-ad04-459df889528e', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', '2026-02-12 20:17:46', TRUE);
INSERT INTO auth_attempts VALUES ('9cd55fca-9be3-4c80-8469-e78ad00eef3f', 'b32cd956-d268-4900-89f1-065bb776cc12', 'a175007b-e9cd-46b1-90da-96169514ec8f', '2026-02-13 02:07:46', TRUE);
INSERT INTO auth_attempts VALUES ('482edd98-b595-4f62-b7b5-fa07cb9adcf4', 'b32cd956-d268-4900-89f1-065bb776cc12', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', '2026-02-13 01:55:46', FALSE);
INSERT INTO auth_attempts VALUES ('2ad5d12b-82c9-4a63-b5ff-ae476ea869aa', '715f1c33-d609-417f-974f-33d14d07a25c', '60059fa4-b21b-4ada-9ebe-5593eddc5594', '2026-02-14 05:56:46', TRUE);
INSERT INTO auth_attempts VALUES ('1b8bb11a-7b32-459d-b0fa-9027e0830e35', '781199a5-4c20-4964-92c0-651a5e570e04', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-15 00:58:46', TRUE);
INSERT INTO auth_attempts VALUES ('01122580-072a-42f6-9cf9-8f72a308a36c', '781199a5-4c20-4964-92c0-651a5e570e04', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-02-15 01:05:46', FALSE);
INSERT INTO auth_attempts VALUES ('2fc05f45-2892-430d-aecb-1285270c0e81', '08395b20-c747-4c71-8ace-3919792f8179', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', '2026-02-13 12:28:46', FALSE);
INSERT INTO auth_attempts VALUES ('1be323fe-0440-4eeb-907a-88c7f455ccd3', '08395b20-c747-4c71-8ace-3919792f8179', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-13 11:43:46', FALSE);
INSERT INTO auth_attempts VALUES ('7fc0f2aa-e468-4757-a7fb-e8e44e2e890e', '08395b20-c747-4c71-8ace-3919792f8179', '60059fa4-b21b-4ada-9ebe-5593eddc5594', '2026-02-13 11:58:46', FALSE);
INSERT INTO auth_attempts VALUES ('df9aa997-d841-4ea2-af02-7f3cdcf6e133', '72a2d9ba-5861-42dd-9525-84f172571aa9', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-02-12 15:34:46', FALSE);

-- captcha_tracking
INSERT INTO captcha_tracking VALUES ('2364ef58-69f4-4808-a2a4-5abd96cfcca4', '50865a64-06e6-4acd-a0e2-f95fec73f234', TRUE, TRUE, '2026-02-14 11:35:46');
INSERT INTO captcha_tracking VALUES ('406b818b-c423-4453-a810-2da0278ec6f3', '22b2cfc7-ae3a-4608-9f9c-61042e02a87e', TRUE, FALSE, '2026-02-12 23:35:46');
INSERT INTO captcha_tracking VALUES ('16b66f1f-f4cf-4e82-992d-f98b8bd602b3', '2e6663c6-41f6-4cb0-8213-a8b98191a1d4', TRUE, TRUE, '2026-02-14 08:35:46');
INSERT INTO captcha_tracking VALUES ('310e1d8c-b8c7-4a50-8b8e-d935af596e03', '139fec76-4c5d-486a-9846-431732196b07', TRUE, TRUE, '2026-02-14 18:35:46');
INSERT INTO captcha_tracking VALUES ('92c62075-e2f4-47ce-a24a-e930409f04b2', '1f53cacd-530e-4a91-8d2d-4a804584c682', TRUE, TRUE, '2026-02-13 08:35:46');
INSERT INTO captcha_tracking VALUES ('d2d12e3e-a0a1-4a77-9af3-8d853f8afbb7', '1a8b87cb-2ed0-435c-80eb-f7d0d53b6689', TRUE, FALSE, '2026-02-14 07:35:46');
INSERT INTO captcha_tracking VALUES ('3ee26e02-a425-40b6-ad62-45a2bfef3ac6', '6a023310-7097-4858-8110-c2eeb31b60ae', TRUE, TRUE, '2026-02-12 16:35:46');
INSERT INTO captcha_tracking VALUES ('2716331e-aee7-4645-8e42-a65868c5a02c', '58f10215-29f6-412f-8d04-064498df58ed', TRUE, FALSE, '2026-02-12 13:35:46');
INSERT INTO captcha_tracking VALUES ('294ac16c-bcd0-4db4-9504-da716823b359', '1b893e69-36a1-4aad-a567-e660d6aa6b5b', TRUE, FALSE, '2026-02-14 16:35:46');
INSERT INTO captcha_tracking VALUES ('11543773-2f9b-4067-85cc-c0402750bc52', '2e74d43c-9ccf-437b-89cd-235a61efce75', TRUE, TRUE, '2026-02-14 17:35:46');
INSERT INTO captcha_tracking VALUES ('227e0b19-e621-48e3-b7a6-333e1d1e3bc5', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', TRUE, FALSE, '2026-02-12 20:35:46');
INSERT INTO captcha_tracking VALUES ('4ac6b362-c5de-4376-8c52-4d239b5b58e4', '168c7df1-2b8d-4e9a-a835-7d51afa48094', TRUE, TRUE, '2026-02-12 22:35:46');
INSERT INTO captcha_tracking VALUES ('42dacf5a-c608-4cd9-a4b1-fca1897476f2', '0b8879db-e8a1-48d7-8fff-0696378d36e0', TRUE, TRUE, '2026-02-12 23:35:46');
INSERT INTO captcha_tracking VALUES ('15c66761-94d8-4496-9344-1575f40d353b', 'dd6a5c1a-ce35-4776-b9ca-be9fc1c6e6ab', TRUE, TRUE, '2026-02-13 16:35:46');
INSERT INTO captcha_tracking VALUES ('598c89e0-bec3-4569-af1b-f047450d691c', 'c3bc6d5c-ca7f-4649-ad04-459df889528e', TRUE, TRUE, '2026-02-12 19:35:46');
INSERT INTO captcha_tracking VALUES ('410203f0-2657-49a3-b1ef-70a6ae3c943f', 'b32cd956-d268-4900-89f1-065bb776cc12', TRUE, TRUE, '2026-02-13 01:35:46');
INSERT INTO captcha_tracking VALUES ('e9de5b65-889c-4413-84cc-e3eb282b2002', '715f1c33-d609-417f-974f-33d14d07a25c', TRUE, FALSE, '2026-02-14 05:35:46');
INSERT INTO captcha_tracking VALUES ('dba3c686-deef-42c5-aa12-af08ebdf0c7d', '781199a5-4c20-4964-92c0-651a5e570e04', TRUE, TRUE, '2026-02-15 00:35:46');
INSERT INTO captcha_tracking VALUES ('c1ee714b-aa0a-42c2-9188-25a2a30dd333', '08395b20-c747-4c71-8ace-3919792f8179', TRUE, TRUE, '2026-02-13 11:35:46');
INSERT INTO captcha_tracking VALUES ('236ab09a-f3ff-4ee6-9fb6-74f085045b0b', '72a2d9ba-5861-42dd-9525-84f172571aa9', TRUE, TRUE, '2026-02-12 15:35:46');

-- download_logs
INSERT INTO download_logs VALUES ('e77c0d8c-1492-4f27-9680-e0732fa386c1', 'baef6ed4-0ba8-45bd-8eef-8cceca9e30f7', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', '08395b20-c747-4c71-8ace-3919792f8179', '2026-02-14 12:30:46');
INSERT INTO download_logs VALUES ('a9ff2bba-643b-4472-827e-531985b89f7d', 'b732bdea-5a42-460d-a5be-605b8bdd7a02', '4fb74e06-450d-4c0f-a3b5-58231451040c', '1a8b87cb-2ed0-435c-80eb-f7d0d53b6689', '2026-02-15 07:30:46');
INSERT INTO download_logs VALUES ('66d84815-d720-4252-8516-8eaa75abe58b', '538ab8b5-3c69-4c32-914f-16f456c57011', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', '1b893e69-36a1-4aad-a567-e660d6aa6b5b', '2026-02-14 18:30:46');
INSERT INTO download_logs VALUES ('6512e340-691a-4831-bfc9-e481be6a3dd4', '53af4c5d-4764-4fed-b50d-39124a4e323a', '1e5c1140-adbc-41b7-9357-4e54c96ba7db', '2e6663c6-41f6-4cb0-8213-a8b98191a1d4', '2026-02-13 18:30:46');
INSERT INTO download_logs VALUES ('8a1b32a8-e9ee-4203-9980-bba889fc0260', '347c076f-5c5d-4df0-a2b2-79ca8d77028e', '0d5009cf-2a6e-490b-aabf-25a1ef8429bc', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', '2026-02-13 11:30:46');
INSERT INTO download_logs VALUES ('ab0d42b2-900a-402b-bca7-51b204829540', '31b2d0a8-bf62-4cf0-bd60-9fbf9cacf379', '3a23c964-37c4-49df-846b-e631acff7dc3', '58f10215-29f6-412f-8d04-064498df58ed', '2026-02-15 02:30:46');
INSERT INTO download_logs VALUES ('2796e4df-06b1-4530-aa65-dda79da32915', '8890bf1e-b92a-4be9-8b10-0b4a13821137', '3a23c964-37c4-49df-846b-e631acff7dc3', 'b32cd956-d268-4900-89f1-065bb776cc12', '2026-02-14 10:30:46');
INSERT INTO download_logs VALUES ('4639b1fd-1e44-40a9-a7d9-8504e9d3a0a4', '6ccd011f-89d7-4235-a180-fc1b56a0b47f', '5fab33c0-bbe0-490f-a714-7b46669324e7', '0b8879db-e8a1-48d7-8fff-0696378d36e0', '2026-02-14 11:30:46');
INSERT INTO download_logs VALUES ('a50b3c58-864c-43f9-994f-1b45164cbee1', '8ae98efe-55e7-4d28-a042-fd2dba0d3635', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', '2026-02-13 14:30:46');
INSERT INTO download_logs VALUES ('0e4fa01f-266e-4e94-b441-2a106aef059f', 'c1849e94-e6c1-4061-bf00-4863d2812b83', 'b84e82e8-7222-4ecc-9b1c-36b51791b512', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', '2026-02-13 12:30:46');
INSERT INTO download_logs VALUES ('8a846740-b857-4254-8f45-d772aa28a75f', 'f7c67187-71e3-45e5-8373-c2f88620913e', '5fab33c0-bbe0-490f-a714-7b46669324e7', 'f830c30f-7843-4b9e-adb0-ff41d6caa374', '2026-02-13 22:30:46');
INSERT INTO download_logs VALUES ('b0f107cf-0d1f-45d8-ae46-d9f0573c5ee0', '052230c8-5677-4e41-a7e0-ba73eeec26da', '416c6242-314b-4d1c-ab03-5da9024937a0', 'c3bc6d5c-ca7f-4649-ad04-459df889528e', '2026-02-13 18:30:46');
INSERT INTO download_logs VALUES ('b308404b-6d46-4474-b69e-67b1faecd332', '060e86ec-904a-488d-9511-b293ab93c49c', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '715f1c33-d609-417f-974f-33d14d07a25c', '2026-02-15 00:30:46');
INSERT INTO download_logs VALUES ('f51b2855-d001-4d5c-941b-1adc391fa2b9', '347c076f-5c5d-4df0-a2b2-79ca8d77028e', '0d5009cf-2a6e-490b-aabf-25a1ef8429bc', 'c3bc6d5c-ca7f-4649-ad04-459df889528e', '2026-02-13 20:30:46');
INSERT INTO download_logs VALUES ('06dc3bd0-cc04-4250-b5d2-77b9e7dd81f5', '6ccd011f-89d7-4235-a180-fc1b56a0b47f', '5fab33c0-bbe0-490f-a714-7b46669324e7', '58f10215-29f6-412f-8d04-064498df58ed', '2026-02-15 00:30:46');
INSERT INTO download_logs VALUES ('000e5721-5e17-4069-9287-3325f1241278', 'cc691158-916c-41cf-964f-139c3675772a', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '50865a64-06e6-4acd-a0e2-f95fec73f234', '2026-02-13 11:30:46');
INSERT INTO download_logs VALUES ('4fd58ff6-1040-446d-8145-1e0776551af5', '060e86ec-904a-488d-9511-b293ab93c49c', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '72a2d9ba-5861-42dd-9525-84f172571aa9', '2026-02-14 03:30:46');
INSERT INTO download_logs VALUES ('58691d7f-4bd9-4fd0-924e-3bae3245dec9', '79e0b8b9-65c0-42a5-b408-fa652f9ee13a', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '2e74d43c-9ccf-437b-89cd-235a61efce75', '2026-02-13 11:30:46');
INSERT INTO download_logs VALUES ('2ebb40f8-769c-4fe0-9058-02013379e97b', 'c4a1a64a-1b04-4bba-9506-c656a5fa9b6a', '1ada1aa0-708a-424b-937d-1827a3daabad', '1b893e69-36a1-4aad-a567-e660d6aa6b5b', '2026-02-14 13:30:46');
INSERT INTO download_logs VALUES ('d63dca7f-92d5-41be-ba3b-a08b002c11fb', '79e0b8b9-65c0-42a5-b408-fa652f9ee13a', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '0b8879db-e8a1-48d7-8fff-0696378d36e0', '2026-02-13 17:30:46');
INSERT INTO download_logs VALUES ('b404cd78-6f16-4c44-b9b2-bb02d4de6a6a', 'f7c67187-71e3-45e5-8373-c2f88620913e', '5fab33c0-bbe0-490f-a714-7b46669324e7', '22b2cfc7-ae3a-4608-9f9c-61042e02a87e', '2026-02-14 00:30:46');
INSERT INTO download_logs VALUES ('e032b380-1042-4fc4-af75-ca2bcc548dbf', '8ae98efe-55e7-4d28-a042-fd2dba0d3635', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '72a2d9ba-5861-42dd-9525-84f172571aa9', '2026-02-15 09:30:46');
INSERT INTO download_logs VALUES ('c2a576d7-b14d-4a30-b244-56821b8e6f8a', '8890bf1e-b92a-4be9-8b10-0b4a13821137', '1ed76d74-47ce-434f-bbaa-7ed0dd0ca7a3', '22b2cfc7-ae3a-4608-9f9c-61042e02a87e', '2026-02-14 20:30:46');
INSERT INTO download_logs VALUES ('95d5ce7c-110e-4857-8047-27aeefec1f68', '060e86ec-904a-488d-9511-b293ab93c49c', '6ee792e6-1e49-4ce1-aa6e-e45a17ccc105', '715f1c33-d609-417f-974f-33d14d07a25c', '2026-02-14 05:30:46');
INSERT INTO download_logs VALUES ('858f3641-87ca-45ec-a886-56ff83193204', '53af4c5d-4764-4fed-b50d-39124a4e323a', 'b84e82e8-7222-4ecc-9b1c-36b51791b512', '781199a5-4c20-4964-92c0-651a5e570e04', '2026-02-13 16:30:46');
INSERT INTO download_logs VALUES ('9a9d8bfe-5687-4d35-84ec-095fe19a56c9', '538ab8b5-3c69-4c32-914f-16f456c57011', 'b8d4f5d4-de66-4daa-aa9f-d12d9e0ff88e', 'b32cd956-d268-4900-89f1-065bb776cc12', '2026-02-13 16:30:46');
INSERT INTO download_logs VALUES ('b411e3ed-2eb0-465f-a734-fc873ae5ba4a', 'c4a1a64a-1b04-4bba-9506-c656a5fa9b6a', '1ada1aa0-708a-424b-937d-1827a3daabad', 'c3bc6d5c-ca7f-4649-ad04-459df889528e', '2026-02-13 15:30:46');
INSERT INTO download_logs VALUES ('abfc0e6f-1bb8-4f32-b571-3a9998e81dfd', 'cc691158-916c-41cf-964f-139c3675772a', '9c9afbd9-e75a-4e38-b70b-3b72685e3043', '2e6663c6-41f6-4cb0-8213-a8b98191a1d4', '2026-02-14 02:30:46');
INSERT INTO download_logs VALUES ('68df2c3e-3c7a-443b-90e5-bc688910d1c0', '538ab8b5-3c69-4c32-914f-16f456c57011', '576032ff-1908-42b9-87be-e5c8f7b6a699', '2e6663c6-41f6-4cb0-8213-a8b98191a1d4', '2026-02-13 16:30:46');
INSERT INTO download_logs VALUES ('c7abd42d-4f02-4219-a739-2cc772f426f7', 'f5d5eb27-9994-4e99-b95a-887821319657', '1ada1aa0-708a-424b-937d-1827a3daabad', '1f53cacd-530e-4a91-8d2d-4a804584c682', '2026-02-13 23:30:46');

-- expiry_jobs
INSERT INTO expiry_jobs VALUES ('c352101f-24ed-437c-a9f0-45cd498dc809', '7c106e0e-b9a8-431b-a5cb-bca1d8791ad7', '2026-02-05 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('00cb4246-957a-4601-b5b1-23e8634ce170', '6d7c0b77-2273-4154-b90b-3a43f4f59c82', '2026-02-03 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('5d211e89-3d11-4e6c-a759-03943993d726', 'ac2a67d8-d769-4231-81f8-1e918eb395b0', '2026-01-30 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('c53c7e3c-54c4-47d1-bfe0-947c2f31e095', '9e1b5df7-2dee-455e-9a1c-2b7e6353c17f', '2026-01-25 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('f26b536f-0167-409a-8ee3-9b043e676190', 'a175007b-e9cd-46b1-90da-96169514ec8f', '2026-02-21 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('b5089253-9952-43a8-b3da-f9039fc3f7f6', '18c489be-3dcf-4ee5-b1c6-7ea94fbf741f', '2026-02-01 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('3551c4df-e829-4f4f-9d4a-f032a6bd60fb', 'b7454b74-9062-436f-a9d8-bbdcb96f3eac', '2026-01-28 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('aa52d591-1ed3-4887-aeac-c63ea51584c0', 'b7656e56-4cd6-4534-bffe-6cb89c5b4e17', '2026-02-17 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('07569de2-4eda-4c65-8f4c-76da24f2545e', 'fbd3b069-75b7-484e-8050-6b20d8d7a0e8', '2026-02-02 10:30:46', FALSE);
INSERT INTO expiry_jobs VALUES ('27716a68-a64e-4b8a-aa4a-048e09f9a487', '60059fa4-b21b-4ada-9ebe-5593eddc5594', '2026-01-26 10:30:46', FALSE);




show tables;
drop table audit_logs;

