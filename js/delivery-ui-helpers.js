/* delivery-ui-helpers.js
   Shared: showToast, openModal/closeModal, loading skeleton, empty-state helper.
*/

function ensureToastWrap() {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  return wrap;
}

function showToast(message, type = "info", duration = 2600) {
  const wrap = ensureToastWrap();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  wrap.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/* ---------- Modal ---------- */
function openModal({ title, body, confirmText = "Confirm", cancelText = "Cancel", onConfirm, danger = false }) {
  let overlay = document.querySelector(".modal-overlay");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="cancel">${cancelText}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="confirm">${confirmText}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add("open"));

  overlay.querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    if (onConfirm) onConfirm();
  });

  return overlay;
}

function closeModal() {
  const overlay = document.querySelector(".modal-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 200);
}

/* ---------- Loading skeleton ---------- */
function renderSkeleton(container, count = 3) {
  container.innerHTML = Array.from({ length: count })
    .map(() => `<div class="skeleton sk-card"></div>`)
    .join("");
}

/* ---------- Empty state ---------- */
function renderEmptyState(container, { title, subtitle, icon }) {
  const defaultIcon = `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a4 4 0 0 1 8 0v2"></path></svg>`;
  container.innerHTML = `
    <div class="empty-state">
      ${icon || defaultIcon}
      <div class="es-title">${title}</div>
      <div class="es-sub">${subtitle || ""}</div>
    </div>
  `;
}

/* ---------- Error toast wrapper for fetch calls ---------- */
function handleFetchError(err, fallback = "Something went wrong. Please try again.") {
  console.error(err);
  const msg = (err && err.message) || fallback;
  showToast(msg, "error");
}

window.showToast = showToast;
window.openModal = openModal;
window.closeModal = closeModal;
window.renderSkeleton = renderSkeleton;
window.renderEmptyState = renderEmptyState;
window.handleFetchError = handleFetchError;
