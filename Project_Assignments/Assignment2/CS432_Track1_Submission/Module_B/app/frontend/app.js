const $ = (id) => document.getElementById(id);

const state = {
  uploadFiles: [],
  uploadMoreFiles: [],
  outerToken: "",
  innerToken: "",
  tokenType: "",
  sessionToken: "",
  sessionRole: "",
  accessibleFiles: [],
  portfolioEntries: [],
  portfolioTamperedCount: 0,
  editingPortfolioEntryId: "",
  fileSearchQuery: "",
  currentFolderPath: "",
  selectedFileIds: new Set(),
  subTokens: [],
  createdSubTokens: {},
  editingSubTokenId: "",
  pendingAction: null,
  toastTimer: null,
  captchaRequestInFlight: false,
  captchaSolvedUntil: 0,
  scannerStream: null,
  scannerActive: false,
  scannerFrameId: 0,
  barcodeDetector: null
};

function initIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

function hardenSensitiveInputs() {
  // Best-effort autofill mitigation for token-like secrets.
  const sensitiveIds = ["uploadInnerToken", "accessInnerToken", "subInnerTokenInput", "captchaAnswer"];
  sensitiveIds.forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.setAttribute("autocomplete", "new-password");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-lpignore", "true");
    input.setAttribute("data-1p-ignore", "true");
    input.value = "";
    input.readOnly = true;
    input.addEventListener(
      "focus",
      () => {
        input.readOnly = false;
      },
      { once: true }
    );
  });

  // Some browsers inject autofill values after paint; clear once more.
  setTimeout(() => {
    sensitiveIds.forEach((id) => {
      const input = $(id);
      if (input && document.activeElement !== input) input.value = "";
    });
  }, 160);
}

function prepareButtons() {
  // Wrap button content once so loading states can swap in a spinner consistently.
  document.querySelectorAll(".btn").forEach((btn) => {
    if (btn.dataset.prepared === "true") return;
    const wrapper = document.createElement("span");
    wrapper.className = "btn-content";
    while (btn.firstChild) wrapper.appendChild(btn.firstChild);
    btn.appendChild(wrapper);
    btn.dataset.prepared = "true";
  });
}

function setButtonBusy(button, busy) {
  if (!button) return;
  const label = button.querySelector(".btn-content span:last-child");
  if (busy) {
    button.disabled = true;
    button.classList.add("btn-loading");
    if (!button.querySelector(".btn-spinner")) {
      const spinner = document.createElement("span");
      spinner.className = "btn-spinner";
      spinner.setAttribute("aria-hidden", "true");
      button.appendChild(spinner);
    }
    if (label && !button.dataset.originalLabel) {
      button.dataset.originalLabel = label.textContent;
      if (button.dataset.loadingText) label.textContent = button.dataset.loadingText;
    }
  } else {
    button.disabled = false;
    button.classList.remove("btn-loading");
    const spinner = button.querySelector(".btn-spinner");
    if (spinner) spinner.remove();
    if (label && button.dataset.originalLabel) {
      label.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }
}

function showToast(message) {
  // Non-blocking status feedback replaces intrusive alert dialogs.
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 220);
  }, 2200);
}

function show(el, visible) {
  if (el) el.classList.toggle("hidden", !visible);
}

function animatePanel(el) {
  if (!el) return;
  el.classList.remove("panel-enter");
  // Force reflow so repeated transitions can replay.
  void el.offsetWidth;
  el.classList.add("panel-enter");
}

function setError(message, options = {}) {
  const box = $("globalError");
  box.textContent = message;
  box.classList.toggle("security-alert", Boolean(options.securityAlert));
  show(box, true);
}

function clearError() {
  const box = $("globalError");
  box.textContent = "";
  box.classList.remove("security-alert");
  show(box, false);
}

function switchView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  $(viewId).classList.add("active");
  animatePanel($(viewId));
  clearError();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchSubView(viewId) {
  document.querySelectorAll("#vaultContentArea article").forEach((section) => section.classList.add("hidden"));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.remove("active"));
  $(viewId).classList.remove("hidden");
  animatePanel($(viewId));
  if (viewId === "subViewFiles") $("navFiles").classList.add("active");
  if (viewId === "subViewPortfolio") $("navPortfolio").classList.add("active");
  if (viewId === "subViewManage") $("navManage").classList.add("active");
  if (viewId === "subViewUploadMore") $("navUploadMore").classList.add("active");
}

function bindActionCard(cardId, action) {
  const card = $(cardId);
  card.onclick = action;
  card.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  };
}

function formatRemaining(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function prettyBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.payload = data;
    throw err;
  }
  return data;
}

async function requestCaptcha() {
  if (state.captchaRequestInFlight) return;
  if (!$("captchaCard").classList.contains("hidden")) return;
  try {
    state.captchaRequestInFlight = true;
    const data = await fetchJson(`/api/security/captcha`);
    $("captchaQuestion").textContent = `Anti-Brute Force Check: Solve ${data.question}`;
    $("captchaCard").dataset.challengeId = data.challengeId;
    $("captchaAnswer").value = "";
    show($("captchaCard"), true);
  } catch {
    setError("Failed to load security check.");
  } finally {
    state.captchaRequestInFlight = false;
  }
}

function withCaptchaRetry(action) {
  if (Date.now() < state.captchaSolvedUntil) {
    action();
    return;
  }
  state.pendingAction = action;
  requestCaptcha();
}

$("captchaForm").onsubmit = async (e) => {
  e.preventDefault();
  const submitBtn = e.submitter || $("captchaForm").querySelector('button[type="submit"]');
  setButtonBusy(submitBtn, true);
  try {
    const challengeId = $("captchaCard").dataset.challengeId;
    const answer = $("captchaAnswer").value.trim();
    await fetchJson(`/api/security/captcha/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, answer })
    });
    state.captchaSolvedUntil = Date.now() + 9 * 60 * 1000;
    show($("captchaCard"), false);
    if (state.pendingAction) {
      const action = state.pendingAction;
      state.pendingAction = null;
      action();
    }
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
  } finally {
    setButtonBusy(submitBtn, false);
  }
};

function closeScanner(clearStatus = false) {
  state.scannerActive = false;
  if (state.scannerFrameId) cancelAnimationFrame(state.scannerFrameId);
  state.scannerFrameId = 0;
  const video = $("scannerVideo");
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach((track) => track.stop());
    state.scannerStream = null;
  }
  if (clearStatus) $("scannerStatus").textContent = "";
  show($("scannerCard"), false);
}

async function scanQrFrame() {
  if (!state.scannerActive) return;
  const video = $("scannerVideo");
  if (
    state.barcodeDetector &&
    video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA
  ) {
    try {
      const codes = await state.barcodeDetector.detect(video);
      const qr = codes.find((code) => code.rawValue);
      if (qr?.rawValue) {
        $("accessOuterToken").value = qr.rawValue.trim();
        $("scannerStatus").textContent = "Outer token scanned successfully.";
        closeScanner();
        showToast("Outer token scanned");
        $("outerTokenForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        return;
      }
    } catch {
      $("scannerStatus").textContent = "Scanning failed for this frame. Keep the QR steady.";
    }
  }
  state.scannerFrameId = requestAnimationFrame(scanQrFrame);
}

async function openScanner() {
  clearError();
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    setError("Camera access is not supported in this browser.");
    return;
  }
  if (!("BarcodeDetector" in window)) {
    setError("QR scanning needs a browser with BarcodeDetector support.");
    return;
  }

  try {
    state.barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
    $("scannerStatus").textContent = "Opening camera...";
    show($("scannerCard"), true);
    state.scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    $("scannerVideo").srcObject = state.scannerStream;
    await $("scannerVideo").play();
    state.scannerActive = true;
    $("scannerStatus").textContent = "Camera ready. Align the QR inside the frame.";
    scanQrFrame();
  } catch (err) {
    closeScanner(true);
    setError(err.message || "Unable to open the camera for scanning.");
  }
}

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const percent = Math.round((evt.loaded / evt.total) * 100);
      onProgress(percent);
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        const err = new Error(data.error || "Upload failed");
        err.payload = data;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}

function renderFileSelection(files, listId, stateKey) {
  state[stateKey] = Array.from(files);
  const list = $(listId);
  list.innerHTML = "";
  state[stateKey].forEach((f) => {
    const li = document.createElement("li");
    const path = f.webkitRelativePath || f.name;
    li.textContent = `${path} (${prettyBytes(f.size)})`;
    list.appendChild(li);
  });
}

function setupDropzone({ zoneId, listId, stateKey, fileInputIds }) {
  const zone = $(zoneId);
  const inputs = fileInputIds.map((id) => $(id));

  inputs.forEach((input) => {
    input.onchange = () => renderFileSelection(input.files || [], listId, stateKey);
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });

  zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-dragover");
    // Browser folder drag support varies; treat any drop payload as file selection.
    if (!e.dataTransfer?.files?.length) return;
    renderFileSelection(e.dataTransfer.files, listId, stateKey);
  });
}

function initDropzones() {
  $("pickFilesBtnNew").onclick = () => $("uploadFilesNew").click();
  $("pickFolderBtnNew").onclick = () => $("uploadFolderNew").click();
  $("pickFilesBtnMore").onclick = () => $("uploadFilesMore").click();
  if ($("pickFolderBtnMore")) $("pickFolderBtnMore").onclick = () => $("uploadFolderMore").click();

  setupDropzone({
    zoneId: "dropzoneNew",
    listId: "selectedFilesNew",
    stateKey: "uploadFiles",
    fileInputIds: ["uploadFilesNew", "uploadFolderNew"]
  });

  setupDropzone({
    zoneId: "dropzoneMore",
    listId: "selectedFilesMore",
    stateKey: "uploadMoreFiles",
    fileInputIds: ["uploadFilesMore", "uploadFolderMore"]
  });
}

function renderStatusKV(data) {
  const grid = $("publicInfoGrid");
  grid.innerHTML = "";

  const items = [
    { label: "Status", value: data.status, className: data.status === "ACTIVE" ? "success" : "error" },
    { label: "Active Files", value: String(data.activeFileCount) },
    { label: "Expires", value: new Date(data.expiresAt).toLocaleString() },
    { label: "Time Left", value: formatRemaining(data.remainingSeconds) }
  ];

  items.forEach((item) => {
    const box = document.createElement("div");
    box.className = "kv";

    const span = document.createElement("span");
    span.textContent = item.label;
    const strong = document.createElement("strong");
    strong.textContent = item.value;
    if (item.className) strong.classList.add(item.className);

    box.appendChild(span);
    box.appendChild(strong);
    grid.appendChild(box);
  });
}

function renderFilesSkeleton(rows = 4) {
  const container = $("filesList");
  container.innerHTML = "";
  for (let i = 0; i < rows; i += 1) {
    const row = document.createElement("div");
    row.className = "skeleton-row";
    container.appendChild(row);
  }
}

function createButton({ text, icon, className }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  const iconEl = document.createElement("i");
  iconEl.setAttribute("data-lucide", icon);
  const label = document.createElement("span");
  label.textContent = text;
  btn.appendChild(iconEl);
  btn.appendChild(label);
  return btn;
}

function normalizePath(input) {
  return String(input || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function filePath(file) {
  return normalizePath(file.relative_path || file.original_filename);
}

function pathParts(file) {
  return filePath(file).split("/").filter(Boolean);
}

function buildFolderView(files, folderPath, searchQuery) {
  const currentPath = normalizePath(folderPath);
  const currentSegments = currentPath ? currentPath.split("/") : [];
  const query = searchQuery.trim().toLowerCase();

  if (query) {
    return {
      folders: [],
      files: files.filter((file) => {
        const path = filePath(file);
        return `${path} ${file.mime_type}`.toLowerCase().includes(query);
      })
    };
  }

  const folderMap = new Map();
  const visibleFiles = [];

  files.forEach((file) => {
    const parts = pathParts(file);
    const matchesFolder = currentSegments.every((segment, index) => parts[index] === segment);
    if (!matchesFolder) return;

    if (parts.length > currentSegments.length + 1) {
      const nextFolder = parts[currentSegments.length];
      const folderKey = currentPath ? `${currentPath}/${nextFolder}` : nextFolder;
      const existing = folderMap.get(folderKey) || { path: folderKey, name: nextFolder, fileCount: 0 };
      existing.fileCount += 1;
      folderMap.set(folderKey, existing);
      return;
    }

    visibleFiles.push(file);
  });

  return {
    folders: Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    files: visibleFiles.sort((a, b) => filePath(a).localeCompare(filePath(b)))
  };
}

function renderFolderBreadcrumbs() {
  const toolbar = $("folderToolbar");
  const breadcrumbs = $("folderBreadcrumbs");
  const hasFolders = state.accessibleFiles.some((file) => pathParts(file).length > 1);
  show(toolbar, hasFolders && !state.fileSearchQuery.trim());
  if (!hasFolders || state.fileSearchQuery.trim()) {
    breadcrumbs.innerHTML = "";
    return;
  }

  const segments = normalizePath(state.currentFolderPath).split("/").filter(Boolean);
  const crumbs = [{ label: "Vault Root", path: "" }];
  let running = "";
  segments.forEach((segment) => {
    running = running ? `${running}/${segment}` : segment;
    crumbs.push({ label: segment, path: running });
  });

  breadcrumbs.innerHTML = "";
  crumbs.forEach((crumb) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `crumb-btn ${crumb.path === normalizePath(state.currentFolderPath) ? "active" : ""}`;
    button.textContent = crumb.label;
    button.onclick = () => {
      state.currentFolderPath = crumb.path;
      renderFilesList();
    };
    breadcrumbs.appendChild(button);
  });
}

function renderFilesList() {
  const container = $("filesList");
  const emptyState = $("filesEmpty");
  container.innerHTML = "";
  show(emptyState, false);

  if (state.accessibleFiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No files found in this vault.";
    container.appendChild(empty);
    show($("selectedCount"), false);
    return;
  }

  const { folders, files } = buildFolderView(
    state.accessibleFiles,
    state.currentFolderPath,
    state.fileSearchQuery
  );
  renderFolderBreadcrumbs();

  if (folders.length === 0 && files.length === 0) {
    show(emptyState, true);
    show($("selectedCount"), false);
    return;
  }

  folders.forEach((folder) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "folder-row";
    row.onclick = () => {
      state.currentFolderPath = folder.path;
      renderFilesList();
    };

    const info = document.createElement("div");
    info.className = "file-info-group";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", "folder");
    const details = document.createElement("div");
    details.className = "file-details";
    const title = document.createElement("strong");
    title.textContent = folder.name;
    const meta = document.createElement("span");
    meta.className = "muted small";
    meta.textContent = `${folder.fileCount} nested item${folder.fileCount === 1 ? "" : "s"}`;
    details.appendChild(title);
    details.appendChild(meta);
    info.appendChild(icon);
    info.appendChild(details);

    const arrow = document.createElement("i");
    arrow.setAttribute("data-lucide", "chevron-right");

    row.appendChild(info);
    row.appendChild(arrow);
    container.appendChild(row);
  });

  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "file-row";

    const infoGroup = document.createElement("div");
    infoGroup.className = "file-info-group";

    if (state.tokenType === "MAIN") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "file-sel";
      checkbox.value = f.file_id;
      checkbox.checked = state.selectedFileIds.has(f.file_id);
      checkbox.setAttribute("aria-label", `Select ${filePath(f)}`);
      infoGroup.appendChild(checkbox);
    }

    const details = document.createElement("div");
    details.className = "file-details";

    const title = document.createElement("strong");
    title.textContent = pathParts(f).slice(-1)[0] || filePath(f) || f.original_filename;
    const meta = document.createElement("span");
    meta.className = "muted small";
    meta.textContent = `${prettyBytes(f.file_size)}${pathParts(f).length > 1 ? ` | ${filePath(f)}` : ""}`;

    const tags = document.createElement("div");
    tags.className = "file-meta-tags";
    const typeTag = document.createElement("span");
    typeTag.className = "file-tag";
    typeTag.textContent = f.mime_type || "unknown/type";
    tags.appendChild(typeTag);

    details.appendChild(title);
    details.appendChild(meta);
    details.appendChild(tags);
    infoGroup.appendChild(details);

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const downloadBtn = createButton({
      text: "Download",
      icon: "download",
      className: "btn btn-secondary btn-inline"
    });
    downloadBtn.onclick = () => downloadFile(f, downloadBtn);
    actions.appendChild(downloadBtn);

    row.appendChild(infoGroup);
    row.appendChild(actions);
    container.appendChild(row);
  });

  updateSelectionCount();
  prepareButtons();
  initIcons();
}

function updateSelectionCount() {
  const chip = $("selectedCount");
  if (!chip || state.tokenType !== "MAIN") {
    show(chip, false);
    return;
  }
  const selected = state.selectedFileIds.size;
  chip.textContent = `${selected} file${selected === 1 ? "" : "s"} selected`;
  show(chip, true);
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${state.sessionToken}`,
    ...extra
  };
}

async function fetchSessionJson(url, options = {}) {
  const headers = authHeaders(options.headers || {});
  return fetchJson(url, { ...options, headers });
}

async function establishPortfolioSession(outerToken, innerToken) {
  const session = await fetchJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outerToken, innerToken })
  });
  state.sessionToken = session.sessionToken;
  state.sessionRole = session.role;
  return session;
}

function resetPortfolioEditor() {
  state.editingPortfolioEntryId = "";
  $("portfolioEditorTitle").textContent = state.sessionRole === "admin" ? "Create Portfolio Entry" : "Update Portfolio Entry";
  $("portfolioEditorHint").textContent =
    state.sessionRole === "admin"
      ? "Admin users can create entries and optionally assign ownership to a SUB member."
      : "Users can update only the entries returned for their own member account.";
  $("portfolioForm").reset();
  $("portfolioOwnerTokenId").value = "";
  $("savePortfolioBtn").querySelector(".btn-content span:last-child").textContent =
    state.sessionRole === "admin" ? "Save Entry" : "Save Update";
  show($("cancelPortfolioEditBtn"), false);
  show($("portfolioOwnerField"), state.sessionRole === "admin");
  show($("portfolioEditorCard"), state.sessionRole === "admin");
}

function beginPortfolioEdit(entry) {
  state.editingPortfolioEntryId = entry.entryId;
  $("portfolioEditorTitle").textContent = "Edit Portfolio Entry";
  $("portfolioEditorHint").textContent = "Update the selected entry and save the change through the secured Module B API.";
  $("portfolioTitle").value = entry.title || "";
  $("portfolioContent").value = entry.content || "";
  $("portfolioOwnerTokenId").value = entry.ownerTokenId || "";
  show($("portfolioOwnerField"), state.sessionRole === "admin");
  show($("cancelPortfolioEditBtn"), true);
  show($("portfolioEditorCard"), true);
  $("savePortfolioBtn").querySelector(".btn-content span:last-child").textContent = "Save Update";
}

function renderPortfolioSummary() {
  const summary = $("portfolioSummary");
  summary.innerHTML = "";
  const stats = [
    { label: "Role", value: state.sessionRole || "unavailable" },
    { label: "Visible Entries", value: String(state.portfolioEntries.length) },
    { label: "Tampered Hidden", value: String(state.portfolioTamperedCount) }
  ];

  stats.forEach((stat) => {
    const card = document.createElement("div");
    card.className = "portfolio-stat";
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    card.appendChild(label);
    card.appendChild(value);
    summary.appendChild(card);
  });

  $("portfolioRoleBadge").textContent = state.sessionRole === "admin" ? "Admin Session" : "User Session";
  $("portfolioRoleBadge").className = `badge ${state.sessionRole === "admin" ? "badge-main" : "badge-sub"}`;
}

function renderPortfolioList() {
  const list = $("portfolioList");
  const empty = $("portfolioEmpty");
  list.innerHTML = "";
  show(empty, state.portfolioEntries.length === 0);

  state.portfolioEntries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "portfolio-card";

    const head = document.createElement("div");
    head.className = "portfolio-card-head";
    const titleWrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const meta = document.createElement("div");
    meta.className = "portfolio-meta";
    meta.innerHTML =
      `<span>Status: ${entry.status}</span><span>Owner: ${entry.ownerTokenId}</span><span>Updated: ${new Date(entry.updatedAt).toLocaleString()}</span>`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "portfolio-actions";
    const editBtn = createButton({ text: "Edit", icon: "pencil", className: "btn btn-secondary btn-inline" });
    editBtn.onclick = () => beginPortfolioEdit(entry);
    actions.appendChild(editBtn);

    if (state.sessionRole === "admin") {
      const deleteBtn = createButton({ text: "Delete", icon: "trash-2", className: "btn btn-secondary btn-inline" });
      deleteBtn.style.background = "#ffe4e6";
      deleteBtn.style.color = "#9f1239";
      deleteBtn.onclick = () => deletePortfolioEntry(entry.entryId);
      actions.appendChild(deleteBtn);
    }

    head.appendChild(titleWrap);
    head.appendChild(actions);

    const content = document.createElement("div");
    content.className = "portfolio-content";
    content.textContent = entry.content;

    card.appendChild(head);
    card.appendChild(content);
    list.appendChild(card);
  });

  prepareButtons();
  initIcons();
}

async function loadPortfolio() {
  if (!state.sessionToken) return;
  $("portfolioList").innerHTML = "<div class='skeleton-row'></div><div class='skeleton-row'></div>";
  try {
    const data = await fetchSessionJson("/api/portfolio");
    state.portfolioEntries = data.entries || [];
    state.portfolioTamperedCount = Number(data.tamperedCount || 0);
    renderPortfolioSummary();
    renderPortfolioList();
    if (!state.editingPortfolioEntryId) {
      resetPortfolioEditor();
    }
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
    $("portfolioList").innerHTML = "";
  }
}

async function submitPortfolioForm(e) {
  e.preventDefault();
  const submitBtn = e.submitter || $("portfolioForm").querySelector('button[type="submit"]');
  const payload = {
    title: $("portfolioTitle").value.trim(),
    content: $("portfolioContent").value.trim()
  };
  const ownerTokenId = $("portfolioOwnerTokenId").value.trim();
  if (ownerTokenId) payload.ownerTokenId = ownerTokenId;

  if (!payload.title || !payload.content) {
    setError("Portfolio title and content are required.");
    return;
  }

  setButtonBusy(submitBtn, true);
  try {
    if (state.editingPortfolioEntryId) {
      await fetchSessionJson(`/api/portfolio/${encodeURIComponent(state.editingPortfolioEntryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showToast("Portfolio entry updated");
    } else {
      await fetchSessionJson("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      showToast("Portfolio entry created");
    }
    resetPortfolioEditor();
    await loadPortfolio();
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
  } finally {
    setButtonBusy(submitBtn, false);
  }
}

async function deletePortfolioEntry(entryId) {
  if (!confirm("Delete this portfolio entry?")) return;
  try {
    await fetchSessionJson(`/api/portfolio/${encodeURIComponent(entryId)}`, {
      method: "DELETE"
    });
    if (state.editingPortfolioEntryId === entryId) resetPortfolioEditor();
    showToast("Portfolio entry deleted");
    await loadPortfolio();
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
  }
}

function renderVaultView(data) {
  state.fileSearchQuery = "";
  state.currentFolderPath = "";
  state.selectedFileIds = new Set();
  $("fileSearch").value = "";
  state.subTokens = [];
  state.createdSubTokens = {};
  closeSubTokenEditor();
  $("vaultMeta").textContent = `Expires: ${new Date(data.expiresAt).toLocaleString()} (${formatRemaining(data.remainingSeconds)} left)`;
  $("tokenTypeBadge").textContent = data.tokenType === "MAIN" ? "MAIN Access" : "SUB Access";
  $("tokenTypeBadge").className = `badge ${data.tokenType === "MAIN" ? "badge-main" : "badge-sub"}`;

  const isMain = data.tokenType === "MAIN";
  show($("navPortfolio"), Boolean(state.sessionToken));
  show($("navManage"), isMain);
  show($("navUploadMore"), isMain);
  show($("selectedCount"), isMain);

  resetPortfolioEditor();
  renderPortfolioSummary();
  switchSubView("subViewFiles");
  renderFilesList();
}

async function downloadFile(f, button) {
  setButtonBusy(button, true);
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(f.file_id)}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outerToken: state.outerToken, innerToken: state.innerToken })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.captchaRequired) {
        withCaptchaRetry(() => downloadFile(f, button));
        return;
      }
      throw new Error(errData.error || "Download failed");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = f.original_filename;
    anchor.click();
    window.URL.revokeObjectURL(url);

    const data = await fetchJson(
      `/api/files/${encodeURIComponent(state.outerToken)}/list?innerToken=${encodeURIComponent(state.innerToken)}`
    );
    state.accessibleFiles = data.files;
    renderFilesList();
    showToast("File download started");
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
  } finally {
    setButtonBusy(button, false);
  }
}

async function loadSubTokens() {
  // Show skeleton placeholders while scoped-token metadata is loading.
  const list = $("subTokensList");
  list.innerHTML = "<div class='skeleton-row'></div><div class='skeleton-row'></div>";

  try {
    const data = await fetchJson(
      `/api/files/${encodeURIComponent(state.outerToken)}/sub-tokens?mainInnerToken=${encodeURIComponent(state.innerToken)}`
    );
    state.subTokens = (data.subTokens || []).map((st) => ({
      ...st,
      fileIds: st.file_ids ? String(st.file_ids).split(",").filter(Boolean) : []
    }));
    list.innerHTML = "";

    if (!state.subTokens.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "No scoped tokens created yet.";
      list.appendChild(empty);
      closeSubTokenEditor();
      return;
    }

    state.subTokens.forEach((st) => {
      const item = document.createElement("div");
      item.className = "sub-token-item";

      const info = document.createElement("div");
      info.className = "st-info";
      const title = document.createElement("strong");
      const tokenValue = st.sub_inner_token || state.createdSubTokens[st.inner_token_id];
      if (tokenValue) state.createdSubTokens[st.inner_token_id] = tokenValue;
      title.textContent = tokenValue ? `Token: ${tokenValue}` : "Token: [Encrypted]";
      const files = document.createElement("span");
      files.className = "muted small";
      files.textContent = `Files: ${st.files || "No files mapped"}`;
      info.appendChild(title);
      info.appendChild(files);

      const actions = document.createElement("div");
      actions.className = "sub-token-actions";
      const editBtn = createButton({ text: "Edit Files", icon: "pencil", className: "btn btn-secondary btn-inline" });
      editBtn.onclick = () => openSubTokenEditor(st.inner_token_id);

      if (!tokenValue) {
        const setValueBtn = createButton({ text: "Set Value", icon: "key-round", className: "btn btn-secondary btn-inline" });
        setValueBtn.onclick = () => setSubTokenValue(st.inner_token_id);
        actions.appendChild(setValueBtn);
      }

      const revokeBtn = createButton({ text: "Revoke", icon: "shield-x", className: "btn btn-secondary btn-inline" });
      revokeBtn.style.background = "#ffe4e6";
      revokeBtn.style.color = "#9f1239";
      revokeBtn.onclick = () => revokeSubToken(st.inner_token_id);
      actions.appendChild(editBtn);
      actions.appendChild(revokeBtn);

      item.appendChild(info);
      item.appendChild(actions);
      list.appendChild(item);
    });

    if (state.editingSubTokenId) openSubTokenEditor(state.editingSubTokenId);
    prepareButtons();
    initIcons();
  } catch {
    setError("Failed to load tokens");
    list.innerHTML = "";
  }
}

async function setSubTokenValue(tokenId) {
  const value = prompt("Enter the SUB inner token value for this record:");
  if (!value) return;
  try {
    const res = await fetchJson(
      `/api/files/${encodeURIComponent(state.outerToken)}/sub-tokens/${encodeURIComponent(tokenId)}/secret`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainInnerToken: state.innerToken, subInnerToken: value.trim() })
      }
    );
    state.createdSubTokens[tokenId] = res.subInnerToken;
    showToast("Sub-token value stored");
    loadSubTokens();
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
  }
}

function closeSubTokenEditor() {
  state.editingSubTokenId = "";
  $("subTokenFilePicker").innerHTML = "";
  $("subTokenEditorMeta").textContent = "";
  show($("subTokenEditor"), false);
}

function openSubTokenEditor(tokenId) {
  const token = state.subTokens.find((t) => t.inner_token_id === tokenId);
  if (!token) return;
  state.editingSubTokenId = tokenId;
  const picker = $("subTokenFilePicker");
  picker.innerHTML = "";

  const tokenValue = token.sub_inner_token || state.createdSubTokens[token.inner_token_id] || "[Encrypted]";
  $("subTokenEditorMeta").textContent = `Editing token: ${tokenValue}`;

  if (!state.accessibleFiles.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = "No files available to map.";
    picker.appendChild(empty);
    show($("subTokenEditor"), true);
    return;
  }

  state.accessibleFiles
    .slice()
    .sort((a, b) => filePath(a).localeCompare(filePath(b)))
    .forEach((file) => {
    const option = document.createElement("label");
    option.className = "token-file-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "sub-token-file";
    input.value = file.file_id;
    input.checked = token.fileIds.includes(file.file_id);

    const text = document.createElement("span");
    text.textContent = filePath(file);

    option.appendChild(input);
    option.appendChild(text);
    picker.appendChild(option);
    });

  show($("subTokenEditor"), true);
  initIcons();
}

$("uploadForm").onsubmit = async (e) => {
  e.preventDefault();
  const submitBtn = e.submitter || $("uploadForm").querySelector('button[type="submit"]');
  if (state.uploadFiles.length === 0) {
    setError("Please select files.");
    return;
  }

  const formData = new FormData();
  formData.append("innerToken", $("uploadInnerToken").value.trim());
  formData.append("expiresInDays", $("uploadExpiryDays").value);
  state.uploadFiles.forEach((f) => {
    const path = f.webkitRelativePath || f.name;
    formData.append("files", f, path);
    formData.append("relativePaths", path);
  });

  setButtonBusy(submitBtn, true);
  $("uploadProgressBar").style.width = "0%";
  $("uploadProgressLabel").textContent = "0%";

  try {
    show($("uploadProgressWrap"), true);
    const data = await uploadWithProgress(`/api/files/new-vault-upload`, formData, (p) => {
      $("uploadProgressBar").style.width = `${p}%`;
      $("uploadProgressLabel").textContent = `${p}%`;
    });

    $("resultOuterToken").textContent = data.outerToken;
    $("resultInnerToken").textContent = $("uploadInnerToken").value.trim();
    $("resultExpiresAt").textContent = new Date(data.expiresAt).toLocaleString();

    const qr = await fetchJson(`/api/vaults/${encodeURIComponent(data.outerToken)}/qr`);
    $("outerTokenQr").src = qr.qrDataUrl;

    show($("uploadResultCard"), true);
    state.outerToken = data.outerToken;
    state.innerToken = $("uploadInnerToken").value.trim();
    showToast("Vault created successfully");
  } catch (err) {
    if (err.payload?.captchaRequired) {
      withCaptchaRetry(() => $("uploadForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })));
    } else {
      setError(err.message, { securityAlert: err.payload?.securityAlert });
    }
  } finally {
    show($("uploadProgressWrap"), false);
    setButtonBusy(submitBtn, false);
  }
};

$("goToVaultBtn").onclick = () => {
  $("accessOuterToken").value = state.outerToken;
  $("accessInnerToken").value = state.innerToken;
  $("outerTokenForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
};

$("outerTokenForm").onsubmit = async (e) => {
  if (e) e.preventDefault();
  const submitBtn = e?.submitter || $("outerTokenForm").querySelector('button[type="submit"]');
  const outerToken = $("accessOuterToken").value.trim();

  setButtonBusy(submitBtn, true);
  show($("publicVaultInfo"), true);
  $("publicInfoGrid").innerHTML = "<div class='skeleton-row'></div><div class='skeleton-row'></div>";

  try {
    const data = await fetchJson(`/api/vaults/${encodeURIComponent(outerToken)}/public-info`);
    renderStatusKV(data);
    state.outerToken = outerToken;
    clearError();
  } catch (err) {
    show($("publicVaultInfo"), false);
    if (err.payload?.captchaRequired) {
      withCaptchaRetry(() => $("outerTokenForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })));
    } else {
      setError(err.message, { securityAlert: err.payload?.securityAlert });
    }
  } finally {
    setButtonBusy(submitBtn, false);
  }
};

$("innerTokenForm").onsubmit = async (e) => {
  e.preventDefault();
  const submitBtn = e.submitter || $("innerTokenForm").querySelector('button[type="submit"]');
  const innerToken = $("accessInnerToken").value.trim();

  setButtonBusy(submitBtn, true);
  renderFilesSkeleton();

  try {
    const data = await fetchJson(`/api/vaults/${encodeURIComponent(state.outerToken)}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ innerToken })
    });

    state.innerToken = innerToken;
    state.tokenType = data.tokenType;
    state.accessibleFiles = data.files;
    await establishPortfolioSession(state.outerToken, innerToken);

    renderVaultView(data);
    switchView("viewVaultDetails");
    showToast("Vault unlocked");
  } catch (err) {
    if (err.payload?.captchaRequired) {
      withCaptchaRetry(() => $("innerTokenForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })));
    } else {
      setError(err.message, { securityAlert: err.payload?.securityAlert });
    }
  } finally {
    setButtonBusy(submitBtn, false);
  }
};

$("uploadMoreForm").onsubmit = async (e) => {
  e.preventDefault();
  const submitBtn = e.submitter || $("uploadMoreForm").querySelector('button[type="submit"]');
  if (state.uploadMoreFiles.length === 0) {
    setError("Please choose at least one file to upload.");
    return;
  }

  const formData = new FormData();
  formData.append("innerToken", state.innerToken);
  state.uploadMoreFiles.forEach((f) => {
    const path = f.webkitRelativePath || f.name;
    formData.append("files", f, path);
    formData.append("relativePaths", path);
  });

  setButtonBusy(submitBtn, true);
  $("uploadMoreProgressBar").style.width = "0%";

  try {
    show($("uploadMoreProgressWrap"), true);
    await uploadWithProgress(`/api/files/${encodeURIComponent(state.outerToken)}/upload`, formData, (p) => {
      $("uploadMoreProgressBar").style.width = `${p}%`;
    });

    state.uploadMoreFiles = [];
    $("selectedFilesMore").innerHTML = "";
    showToast("Files added successfully");

    const data = await fetchJson(
      `/api/files/${encodeURIComponent(state.outerToken)}/list?innerToken=${encodeURIComponent(state.innerToken)}`
    );
    state.accessibleFiles = data.files;
    switchSubView("subViewFiles");
    renderFilesList();
  } catch (err) {
    if (err.payload?.captchaRequired) {
      withCaptchaRetry(() => $("uploadMoreForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })));
    } else {
      setError(err.message, { securityAlert: err.payload?.securityAlert });
    }
  } finally {
    show($("uploadMoreProgressWrap"), false);
    setButtonBusy(submitBtn, false);
  }
};

$("subTokenForm").onsubmit = async (e) => {
  e.preventDefault();
  const submitBtn = e.submitter || $("subTokenForm").querySelector('button[type="submit"]');
  const selected = Array.from(state.selectedFileIds);
  if (selected.length === 0) {
    setError("Select files in the Files tab first.");
    return;
  }

  setButtonBusy(submitBtn, true);
  try {
    const subInnerToken = $("subInnerTokenInput").value.trim();
    const res = await createSubTokenWithConflictHandling(subInnerToken, selected);
    $("subInnerTokenInput").value = "";
    state.createdSubTokens[res.subTokenId] = res.subInnerToken;
    const movedCount = Number(res.reassignedConflicts || 0);
    showToast(
      movedCount > 0
        ? `Sub-token created. ${movedCount} file mapping(s) reassigned.`
        : `Sub-token created: ${res.subInnerToken}`
    );
    loadSubTokens();
    if (!$("subViewPortfolio").classList.contains("hidden")) loadPortfolio();
  } catch (err) {
    if (!err.silent) setError(err.message, { securityAlert: err.payload?.securityAlert });
  } finally {
    setButtonBusy(submitBtn, false);
  }
};

async function revokeSubToken(tokenId) {
  if (!confirm("Revoke access?")) return;
  try {
    await fetchJson(`/api/files/${encodeURIComponent(state.outerToken)}/sub-tokens/${tokenId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mainInnerToken: state.innerToken })
    });
    showToast("Sub-token revoked");
    loadSubTokens();
    if (!$("subViewPortfolio").classList.contains("hidden")) loadPortfolio();
  } catch (err) {
    setError(err.message, { securityAlert: err.payload?.securityAlert });
  }
}

async function createSubTokenWithConflictHandling(subInnerToken, fileIds) {
  try {
    return await fetchJson(`/api/files/${encodeURIComponent(state.outerToken)}/sub-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mainInnerToken: state.innerToken,
        subInnerToken,
        fileIds
      })
    });
  } catch (err) {
    const isConflict = err.payload?.code === "FILE_ALREADY_SCOPED" && Array.isArray(err.payload?.conflicts);
    if (!isConflict) throw err;

    const conflictLines = err.payload.conflicts
      .slice(0, 6)
      .map((c) => {
        const tokenLabel = c.current_sub_inner_token ? `token ${c.current_sub_inner_token}` : "another SUB token";
        return `- ${c.original_filename || c.file_id} is already in ${tokenLabel}`;
      })
      .join("\n");
    const extraCount = Math.max(0, err.payload.conflicts.length - 6);
    const suffix = extraCount > 0 ? `\n...and ${extraCount} more` : "";
    const message = `${err.payload.action || "Selected files are already scoped."}\n\n${conflictLines}${suffix}\n\nContinue and reassign these files?`;
    if (!confirm(message)) {
      const cancelErr = new Error("Sub-token creation cancelled.");
      cancelErr.silent = true;
      throw cancelErr;
    }

    return fetchJson(`/api/files/${encodeURIComponent(state.outerToken)}/sub-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mainInnerToken: state.innerToken,
        subInnerToken,
        fileIds,
        forceReassign: true
      })
    });
  }
}

function bindNavigation() {
  $("brandLogo").onclick = () => switchView("viewLanding");
  $("scanOuterTokenBtn").onclick = () => openScanner();
  $("closeScannerBtn").onclick = () => closeScanner();

  bindActionCard("goUpload", () => {
    show($("uploadResultCard"), false);
    $("uploadForm").reset();
    $("selectedFilesNew").innerHTML = "";
    state.uploadFiles = [];
    switchView("viewUpload");
  });

  bindActionCard("goAccess", () => {
    show($("publicVaultInfo"), false);
    $("outerTokenForm").reset();
    state.sessionToken = "";
    state.sessionRole = "";
    state.portfolioEntries = [];
    state.portfolioTamperedCount = 0;
    state.editingPortfolioEntryId = "";
    state.fileSearchQuery = "";
    state.currentFolderPath = "";
    state.selectedFileIds = new Set();
    state.subTokens = [];
    state.createdSubTokens = {};
    closeSubTokenEditor();
    resetPortfolioEditor();
    $("fileSearch").value = "";
    switchView("viewAccess");
  });

  bindActionCard("goFeatures", () => switchView("viewFeatures"));
  $("goFeaturesTop").onclick = () => switchView("viewFeatures");

  document.querySelectorAll(".back-btn").forEach((btn) => {
    btn.onclick = () => switchView("viewLanding");
  });

  $("navFiles").onclick = () => switchSubView("subViewFiles");
  $("navPortfolio").onclick = async () => {
    switchSubView("subViewPortfolio");
    await loadPortfolio();
  };
  $("navManage").onclick = () => {
    switchSubView("subViewManage");
    loadSubTokens();
  };
  $("navUploadMore").onclick = () => switchSubView("subViewUploadMore");

  $("logoutBtn").onclick = () => {
    closeScanner(true);
    state.outerToken = "";
    state.innerToken = "";
    state.sessionToken = "";
    state.sessionRole = "";
    state.portfolioEntries = [];
    state.portfolioTamperedCount = 0;
    state.editingPortfolioEntryId = "";
    state.fileSearchQuery = "";
    state.currentFolderPath = "";
    state.selectedFileIds = new Set();
    state.createdSubTokens = {};
    state.subTokens = [];
    closeSubTokenEditor();
    resetPortfolioEditor();
    $("fileSearch").value = "";
    switchView("viewLanding");
  };

  $("refreshPortfolioBtn").onclick = () => loadPortfolio();
  $("portfolioForm").onsubmit = submitPortfolioForm;
  $("cancelPortfolioEditBtn").onclick = () => resetPortfolioEditor();

  $("saveSubTokenFilesBtn").onclick = async () => {
    if (!state.editingSubTokenId) return;
    const saveBtn = $("saveSubTokenFilesBtn");
    const selected = Array.from(document.querySelectorAll(".sub-token-file:checked")).map((el) => el.value);
    setButtonBusy(saveBtn, true);
    try {
      await fetchJson(
        `/api/files/${encodeURIComponent(state.outerToken)}/sub-tokens/${encodeURIComponent(state.editingSubTokenId)}/files`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mainInnerToken: state.innerToken, fileIds: selected })
        }
      );
      showToast("Sub-token files updated");
      await loadSubTokens();
      if (!$("subViewPortfolio").classList.contains("hidden")) await loadPortfolio();
    } catch (err) {
      setError(err.message, { securityAlert: err.payload?.securityAlert });
    } finally {
      setButtonBusy(saveBtn, false);
    }
  };

  $("cancelSubTokenEditBtn").onclick = () => closeSubTokenEditor();

  $("fileSearch").addEventListener("input", (e) => {
    state.fileSearchQuery = e.target.value || "";
    renderFilesList();
  });

  $("filesList").addEventListener("change", (e) => {
    if (e.target.classList.contains("file-sel")) {
      if (e.target.checked) state.selectedFileIds.add(e.target.value);
      else state.selectedFileIds.delete(e.target.value);
      updateSelectionCount();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.scannerActive) {
      closeScanner();
      return;
    }
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      $("fileSearch").focus();
    }
  });
}

function bootstrap() {
  hardenSensitiveInputs();
  prepareButtons();
  initIcons();
  bindNavigation();
  initDropzones();
  switchView("viewLanding");
}

bootstrap();
