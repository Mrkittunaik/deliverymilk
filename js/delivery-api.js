/* delivery-api.js
   Shared fetch wrapper: JWT header, base URL, error handling.
   Exposes: authApi, orderApi, deliveryApi (all attached to window)
*/

const API_BASE = "/api"; // adjust to full backend origin if hosted separately, e.g. "https://your-backend.onrender.com/api"

function getToken() {
  return localStorage.getItem("db_token") || "";
}

async function request(path, { method = "GET", body, auth = true, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw { networkError: true, message: "Network error. Please check your connection." };
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no JSON body, or the host returned non-JSON (e.g. an HTML fallback page) */
  }

  if (res.status === 401) {
    localStorage.removeItem("db_token");
    localStorage.removeItem("db_status");
    if (!location.pathname.endsWith("login.html")) {
      location.href = "login.html";
    }
    throw { status: 401, message: "Session expired. Please log in again." };
  }

  if (!res.ok) {
    throw {
      status: res.status,
      message: (data && (data.message || data.error)) || "Something went wrong.",
      data,
    };
  }

  // Guard against hosts (e.g. a static site with no backend wired up yet)
  // that respond 200 with no JSON body or an unexpected shape.
  if (data === null || typeof data !== "object") {
    throw {
      status: res.status,
      message: "Unexpected response from server. The backend may not be connected yet.",
      apiNotConfigured: true,
    };
  }

  return data;
}

/* ---------------- authApi ---------------- */
const authApi = {
  sendOtp: (phone) => request("/delivery/auth/send-otp", { method: "POST", body: { phone }, auth: false }),
  verifyOtp: (phone, otp) => request("/delivery/auth/verify-otp", { method: "POST", body: { phone, otp }, auth: false }),
  signup: (formData) => request("/delivery/auth/signup", { method: "POST", body: formData, isForm: true, auth: false }),
  me: () => request("/delivery/me"),
  logout: () => {
    localStorage.removeItem("db_token");
    localStorage.removeItem("db_status");
  },
};

/* ---------------- orderApi ---------------- */
const orderApi = {
  getPool: () => request("/orders/pool"),
  accept: (orderId) => request(`/orders/${orderId}/accept`, { method: "POST" }),
  getActive: () => request("/orders/active"),
  getById: (orderId) => request(`/orders/${orderId}`),
  startDelivery: (orderId) => request(`/orders/${orderId}/start`, { method: "POST" }),
  markDelivered: (orderId, payload) =>
    request(`/orders/${orderId}/deliver`, { method: "POST", body: payload }),
  getHistory: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders/history${qs ? `?${qs}` : ""}`);
  },
};

/* ---------------- deliveryApi ---------------- */
const deliveryApi = {
  updateAvailability: (available) =>
    request("/delivery/availability", { method: "POST", body: { available } }),
  updateProfile: (payload) => request("/delivery/profile", { method: "PATCH", body: payload }),
  getStats: () => request("/delivery/stats"),
};

/* --- TEMPORARY DEMO MODE SWITCH ---
   If delivery-mock.js was loaded and demo mode is on, use mock implementations
   instead of hitting the real backend. Remove this block when going live. */
if (window.__DEMO_MODE__ && window.MockApi) {
  window.authApi = window.MockApi.authApi;
  window.orderApi = window.MockApi.orderApi;
  window.deliveryApi = window.MockApi.deliveryApi;
} else {
  window.authApi = authApi;
  window.orderApi = orderApi;
  window.deliveryApi = deliveryApi;
}
