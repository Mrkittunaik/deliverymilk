/* delivery-auth.js
   Shared: token storage, status check (pending/approved/blocked), redirect guard.
   Must be included FIRST on every protected page (before delivery-layout.js).
*/

const DeliveryAuth = (() => {
  const PAGE = location.pathname.split("/").pop();
  const PUBLIC_PAGES = ["login.html", "signup.html"];
  const STATUS_PAGES = {
    pending: "pending-approval.html",
    blocked: "blocked.html",
  };

  function getToken() {
    return localStorage.getItem("db_token");
  }

  function setSession(token, status, profile) {
    localStorage.setItem("db_token", token);
    localStorage.setItem("db_status", status);
    if (profile) localStorage.setItem("db_profile", JSON.stringify(profile));
  }

  function getProfile() {
    try {
      return JSON.parse(localStorage.getItem("db_profile") || "null");
    } catch (e) {
      return null;
    }
  }

  function getStatus() {
    return localStorage.getItem("db_status");
  }

  function logout() {
    localStorage.removeItem("db_token");
    localStorage.removeItem("db_status");
    localStorage.removeItem("db_profile");
    location.href = "login.html";
  }

  function routeForStatus(status) {
    if (status === "pending") return "pending-approval.html";
    if (status === "blocked") return "blocked.html";
    return "home.html";
  }

  // Runs the guard: verifies token + refreshes status against server.
  async function guard() {
    if (PUBLIC_PAGES.includes(PAGE)) return; // login/signup don't need a guard
    if (window.__DEMO_MODE__) return; // temporary demo mode skips the auth guard entirely

    const token = getToken();
    if (!token) {
      location.href = "login.html";
      return;
    }

    // Optimistic local status check first (avoids flash of wrong page)
    const localStatus = getStatus();
    if (localStatus === "blocked" && PAGE !== "blocked.html") {
      location.href = "blocked.html";
      return;
    }
    if (localStatus === "pending" && PAGE !== "pending-approval.html") {
      location.href = "pending-approval.html";
      return;
    }

    // Verify against server (source of truth)
    try {
      const me = await window.authApi.me();
      const status = me.status || me.deliveryStatus;
      localStorage.setItem("db_status", status);
      if (me.profile) localStorage.setItem("db_profile", JSON.stringify(me.profile));

      const expectedPage = routeForStatus(status);
      const onStatusPage = Object.values(STATUS_PAGES).includes(PAGE);

      if (status === "blocked" && PAGE !== "blocked.html") {
        location.href = "blocked.html";
      } else if (status === "pending" && PAGE !== "pending-approval.html") {
        location.href = "pending-approval.html";
      } else if (status === "approved" && onStatusPage) {
        location.href = "home.html";
      }
    } catch (err) {
      // if /me fails with 401, request() already redirects to login.
      // Other errors: allow page to render, individual pages handle fetch errors.
      console.warn("Auth check failed:", err);
    }
  }

  return { getToken, setSession, getProfile, getStatus, logout, guard };
})();

window.DeliveryAuth = DeliveryAuth;
DeliveryAuth.guard();
