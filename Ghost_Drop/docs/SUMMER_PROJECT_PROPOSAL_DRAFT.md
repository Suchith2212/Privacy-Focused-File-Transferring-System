# Ghost Drop Summer Project Proposal Draft

## Working Title
**Ghost Drop: A Deployable Privacy-Preserving Temporary File Sharing Platform**

## 1. Objective and Motivation
Ghost Drop is intended to solve a practical privacy problem: **how to share sensitive files temporarily without requiring users to log into personal accounts on untrusted or shared machines**. In university labs, libraries, hostels, cybercafes, shared offices, and borrowed laptops, users often transfer files through Gmail, Google Drive, WhatsApp Web, or USB devices. These methods are convenient, but they create real risks such as credential theft, forgotten sessions, malware transfer, overexposed cloud links, and long-lived data copies.

Ghost Drop addresses this by offering a **temporary vault-based sharing system**. A sender uploads files into an expiring vault and receives a public-facing **outer token** for vault discovery. Actual access is controlled by private **inner tokens**: a **MAIN** token gives full vault control, while **SUB** tokens can be restricted to specific files. The goal is not just to build a database-backed application, but to create a usable privacy-preserving sharing system for short-lived, controlled file exchange in risky computing environments.

The target audience includes students using shared campus systems, privacy-conscious users working on public computers, and small teams that need temporary document exchange without permanent accounts or open cloud links. These users are likely to adopt such a system because it reduces both credential exposure and long-term data persistence.

## 2. Project Summary
Ghost Drop is a security-oriented systems project built on a real application need. The current implementation combines secure file upload and download, Google Drive-backed encrypted file storage, MySQL-based metadata and access control, QR-based vault discovery, CAPTCHA and rate limiting for abuse prevention, role-based APIs, tamper-evident audit logging, and database performance optimization.

This makes Ghost Drop more than a programming exercise. It is already a functional prototype with a coherent security model, a clear user problem, and a meaningful technical roadmap toward deployment.

## 3. Work Completed in the Course
The project evolved through the database course assignments, with each stage adding a new systems layer.

**Assignment 1** established the core product idea, schema, and security model. The design introduced the main entities required for temporary file transfer: `vaults`, `inner_tokens`, `files`, `file_metadata`, `file_key_access`, `sessions`, `auth_attempts`, `download_logs`, `captcha_tracking`, and `expiry_jobs`. The central idea was clear from the beginning: privacy-first sharing without permanent login, enforced through token-based access and automatic expiry.

**Assignment 2** expanded the work in two directions. In **Module A**, a custom B+ tree was implemented from scratch in Python and then integrated with Ghost Drop data paths to model realistic indexes such as outer-token lookup, expiry-range lookup, and vault-file access patterns. In **Module B**, Ghost Drop was extended into a local authenticated web application with login, session validation, RBAC mapping from `MAIN` and `SUB` tokens to `admin` and `user`, protected CRUD through a `portfolio_entries` table, integrity-hash-based tamper detection, audit logging, and SQL indexing evidence.

**Assignment 3** focused on transaction management and ACID validation. The earlier B+ tree work was extended into a transactional engine supporting `BEGIN`, `COMMIT`, `ROLLBACK`, write-ahead logging, crash recovery, schema validation, and foreign-key consistency checks. Stress and concurrency testing validated atomicity, consistency, isolation, and durability on Ghost Drop-style multi-table workflows.

**Assignment 4** addressed scalability through sharding. A routing layer based on `vault_id` was designed using hash-based partitioning, single-shard routing for most writes and point reads, and scatter-gather logic for cross-shard lookups such as `outer_token` discovery. This established a realistic path for future horizontal scaling.

Together, these assignments show that Ghost Drop is not an isolated classroom database. It connects schema design, indexing, transactions, security, and distributed scaling within one continuous application.

## 4. Current Implementation
The current Ghost Drop codebase already supports a substantial end-to-end workflow. The backend uses **Node.js and Express**, metadata and access control are managed in **MySQL**, file blobs are stored in **Google Drive**, and the frontend is implemented with static **HTML, CSS, and JavaScript** served by the backend.

Users can create vaults, upload multiple files, access vaults by token or QR scan, manage SUB tokens, restrict file access, and perform single-file or batch downloads. On the security side, the system includes PBKDF2-based token verification, encrypted file handling, session-aware abuse protection, CAPTCHA challenges, rate limiting, tamper detection for protected records, and audit logging. The project also includes benchmark-backed indexing improvements for important access paths.

This means Ghost Drop already demonstrates a meaningful application outcome: it offers a privacy-aware temporary file transfer workflow rather than merely storing records in a database.

## 5. Research Context and Distinction
Ghost Drop is related to prior work on self-destructing data, secure sharing over untrusted storage, and privacy-preserving use of public terminals, but it takes a more application-driven and deployable direction.

The **Vanish** system by Geambasu et al. introduced the idea of self-destructing data, where access becomes unavailable after a chosen period. This directly supports Ghost Drop’s temporary-sharing motivation. However, Ghost Drop differs by building a full user-facing workflow around temporary access, including vault creation, selective sharing, one-time download behavior, expiry control, and a modern web interface.

**Plutus** by Kallahalla et al. addressed secure file sharing on untrusted storage and showed how cryptographic controls can reduce dependence on the storage server. Similarly, **SiRiUS** by Goh et al. demonstrated secure remote storage with cryptographic access control layered over untrusted file systems. These systems strongly motivate Ghost Drop’s trust model, but they are primarily storage-security architectures. Ghost Drop instead targets a lighter, more usable scenario: **temporary exchange of files by ordinary users through a web application**, while still preserving restricted access, integrity checks, and practical deployment.

Another closely related direction is **Secure Mobile Computing via Public Terminals** by Balfanz and colleagues, which studies how users can safely access sensitive information through shared terminals by relying on a more trusted personal device. That work is especially relevant because Ghost Drop is also motivated by insecure public or shared machines. Ghost Drop differs in focus: instead of secure terminal interaction alone, it provides a complete temporary file-sharing platform designed for these risky environments.

Therefore, Ghost Drop’s contribution is not simply stronger cryptography than prior systems. Its contribution is the integration of **temporary access, practical usability, controlled sharing, tamper evidence, and deployment-oriented engineering** in a single platform that addresses a concrete real-world use case.

## 6. Why Summer Work Is Needed
Although the current prototype is technically strong, it is not yet production-ready. The remaining gaps are mainly in deployment and operational maturity: secure secret management, HTTPS/TLS, database SSL, persistent session storage instead of in-memory sessions, containerization, structured observability, staging, and repeatable deployment/testing pipelines.

This makes Ghost Drop well suited for a summer project. The conceptual core and prototype implementation already exist, but the next stage requires higher-end systems engineering rather than basic feature building. The summer effort would focus on turning a strong academic prototype into a secure and deployable demonstration platform.

## 7. Proposed Summer Work
The summer extension will focus on four major goals:

- **Deployment hardening:** remove exposed secrets, adopt managed configuration, enforce HTTPS, secure database transport, and validate production environment settings.
- **Infrastructure and reliability:** containerize the stack with Docker, introduce persistent session storage such as Redis, and support graceful shutdown and restart handling.
- **Observability and validation:** add structured logging, health checks, monitoring, staging deployment, and repeatable integration/load testing.
- **Scalability integration:** continue the sharding work from Assignment 4 and align it with the live Ghost Drop backend for a realistic distributed deployment path.

## 8. Estimated Timeline
The proposed summer extension is expected to require approximately **6-8 weeks** of focused work, with an average commitment of **4-5 hours per day**. This is realistic because the remaining work involves implementation, deployment hardening, testing, and validation rather than only adding features.

A reasonable timeline is:

- **Weeks 1-2:** security hardening, secret cleanup, HTTPS planning, and database connection hardening
- **Weeks 3-4:** Docker-based deployment, persistent session handling, Redis integration, and reliability improvements
- **Weeks 5-6:** structured logging, monitoring, health checks, staging deployment, and integration/load testing
- **Weeks 7-8:** sharding refinement, deployment documentation, final validation, and preparation of a deployable demonstration

If development moves faster, a basic workable result may be reached in about **4 weeks**, but **6-8 weeks** is the more realistic estimate for a polished outcome.

## 9. Expected Outcome
By the end of the summer, Ghost Drop should evolve from a strong database-systems prototype into a deployable privacy-preserving file sharing platform. The final outcome should demonstrate not only schema design, indexing, transactions, tamper detection, and distributed scaling, but also secure deployment, persistent state handling, observability, and a realistic user-facing workflow.

Academically, the project is valuable because it connects multiple database and systems topics in one coherent application. Practically, it is valuable because it addresses a real privacy and security problem faced by users in shared or risky computing environments.

## 10. Selected References
1. Roxana Geambasu, Tadayoshi Kohno, Amit A. Levy, and Henry M. Levy, *Vanish: Increasing Data Privacy with Self-Destructing Data*, USENIX Security 2009. [USENIX](https://www.usenix.org/conference/usenixsecurity09/technical-sessions/presentation/vanish-increasing-data-privacy-self)
2. Mahesh Kallahalla, Erik Riedel, Ram Swaminathan, Qian Wang, and Kevin Fu, *Plutus: Scalable Secure File Sharing on Untrusted Storage*, FAST 2003. [USENIX](https://www.usenix.org/conference/fast-03/plutus-scalable-secure-file-sharing-untrusted-storage)
3. Eu-Jin Goh, Hovav Shacham, Nagendra Modadugu, and Dan Boneh, *SiRiUS: Securing Remote Untrusted Storage*, NDSS 2003. [PDF](https://crypto.stanford.edu/~nagendra/papers/sirius.pdf)
4. Dirk Balfanz and colleagues, *Secure Mobile Computing via Public Terminals*, Pervasive 2006. [Microsoft Research PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/pervasive2006-securemobilecomputing.pdf)

## 11. Conclusion
Ghost Drop is a meaningful summer project because it already has a strong technical base, a clearly defined user problem, and a realistic path to deployment-focused improvement. The work completed so far covers schema design, custom indexing, RBAC APIs, tamper detection, ACID validation, and sharding. The proposed summer effort would convert these foundations into a robust, secure, and deployable system with clear practical relevance.
