/* delivery-layout.js
   Shared: renders topbar + bottom nav + active-tab highlighting.
   Included on every protected page, after delivery-auth.js.
*/

const NAV_ITEMS = [
  {
    key: "home",
    href: "home.html",
    label: "Home",
    badgeId: "nav-badge-home",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H9.5v-6h5v6h3a1 1 0 0 0 1-1V10"/></svg>`,
  },
  {
    key: "active",
    href: "active-orders.html",
    label: "Active",
    badgeId: "nav-badge-active",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2.2"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><path d="M8 13h8"/></svg>`,
  },
  {
    key: "history",
    href: "history.html",
    label: "History",
    badgeId: null,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.36"/><path d="M3 4v5h5"/><path d="M12 7v5.5l4 2.3"/></svg>`,
  },
  {
    key: "account",
    href: "account.html",
    label: "Account",
    badgeId: null,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 20.5c1.4-4 4.6-6 7.5-6s6.1 2 7.5 6"/></svg>`,
  },
];

function currentPageKey() {
  const page = location.pathname.split("/").pop();
  if (page === "home.html") return "home";
  if (["active-orders.html", "order-detail.html"].includes(page)) return "active";
  if (["history.html", "order-history-detail.html"].includes(page)) return "history";
  if (page === "account.html") return "account";
  return "";
}

function renderTopbar() {
  const profile = (window.DeliveryAuth && window.DeliveryAuth.getProfile()) || {};
  const name = profile.name || "Delivery Partner";
  const avatar = profile.photoUrl || "../images/avatar-placeholder.png";
  const isAvailable = profile.available !== false;

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div class="tb-left">
      <a href="home.html" class="tb-logo" data-transition aria-label="Home">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2h5l.6 3.2c.1.5.4.9.8 1.2A5 5 0 0 1 18 10.5V20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9.5a5 5 0 0 1 2.1-4.1c.4-.3.7-.7.8-1.2L9.5 2z"/><path d="M8 13h8"/></svg>
      </a>
      <div class="tb-avatar"><img src="${avatar}" alt="${name}" onerror="this.style.display='none'"></div>
      <div>
        <div class="tb-name">${name}</div>
        <div class="tb-status">
          <span class="status-dot ${isAvailable ? "online" : ""}"></span>
          ${isAvailable ? "Available" : "Unavailable"}
        </div>
      </div>
    </div>
    <button class="tb-bell" id="tb-bell-btn" aria-label="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="dot"></span>
    </button>
  `;
  return topbar;
}

function renderBottomNav() {
  const active = currentPageKey();
  const nav = document.createElement("div");
  nav.className = "bottom-nav";
  nav.innerHTML = NAV_ITEMS.map(
    (item) => `
    <a href="${item.href}" class="nav-btn ${active === item.key ? "active" : ""}" data-key="${item.key}">
      ${item.icon}
      <span>${item.label}</span>
      <span class="nav-label-underline"></span>
      ${item.badgeId ? `<span class="nav-badge" id="${item.badgeId}">0</span>` : ""}
    </a>
  `
  ).join("");
  return nav;
}

function mountLayout() {
  const app = document.getElementById("app");
  if (!app) return;

  // Nav must always render even if profile data or an icon template is
  // malformed — a broken topbar should never take the bottom nav down with it.
  try {
    app.prepend(renderTopbar());
  } catch (err) {
    console.error("[layout] topbar failed to render", err);
  }

  try {
    app.appendChild(renderBottomNav());
  } catch (err) {
    console.error("[layout] bottom nav failed to render", err);
  }

  const bell = document.getElementById("tb-bell-btn");
  if (bell) {
    bell.addEventListener("click", () => {
      bell.classList.remove("has-alert");
    });
  }

  // In case a previous page's fade-out class survived a fast back/forward
  // navigation (bfcache), make sure this page is never stuck invisible.
  app.classList.remove("page-leave");
}

function setNavBadge(key, count) {
  const item = NAV_ITEMS.find((i) => i.key === key);
  if (!item || !item.badgeId) return;
  const el = document.getElementById(item.badgeId);
  if (!el) return;
  el.textContent = count > 99 ? "99+" : count;
  el.classList.toggle("show", count > 0);
}

function flashBellAlert() {
  const bell = document.getElementById("tb-bell-btn");
  if (bell) bell.classList.add("has-alert");
}

document.addEventListener("DOMContentLoaded", mountLayout);

window.DeliveryLayout = { setNavBadge, flashBellAlert };
