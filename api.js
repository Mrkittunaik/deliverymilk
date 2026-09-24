/* ============================================================
   API CLIENT — connects deliverymilk (partner app) to the same
   real backend as miLKadmin and milkwebapp (pakkabackend).
   Endpoints match milkwebapp/js/api.js's deliveryApi/authApi/ordersApi.
   ============================================================ */
(function (global) {
  "use strict";

  const API_BASE = (global.MILK_API_BASE || 'https://pakkabackend.onrender.com') + '/api';
  const SOCKET_BASE = (global.MILK_API_BASE || 'https://pakkabackend.onrender.com');
  const TOKEN_KEY = 'pd_delivery_token';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function getTokenRole() {
    const token = getToken();
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])).role || null; } catch (e) { return null; }
  }
  function getTokenUserId() {
    const token = getToken();
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])).id || null; } catch (e) { return null; }
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function requestForm(path, formData) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API_BASE + path, { method: 'POST', headers, body: formData });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `Upload failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const get = (path) => request('GET', path);
  const post = (path, body) => request('POST', path, body);
  const put = (path, body) => request('PUT', path, body);
  const patch = (path, body) => request('PATCH', path, body);
  const del = (path) => request('DELETE', path);

  const Api = {
    getToken, setToken, getTokenRole, getTokenUserId,

    // ---- auth (delivery partner) ----
    deliveryLogin: (phone, password) => post('/auth/delivery/login', { phone, password }),
    deliveryRegister: (payload) => post('/auth/delivery/register', payload),

    // ---- self profile ----
    me: () => get('/delivery-boys/me'),
    updateLocation: (lat, lng) => patch('/delivery-boys/me/location', { lat, lng }),
    uploadMyImage: (file, field) => {
      const form = new FormData();
      form.append('image', file);
      form.append('field', field || 'avatar');
      return requestForm('/delivery-boys/me/image', form);
    },

    // ---- orders ----
    // "my" orders = orders assigned to / offered to this partner. The
    // backend scopes /orders to the caller's role via the JWT, same as
    // it does for the customer webapp and the admin panel.
    listMyOrders: () => get('/orders'),
    getOrder: (id) => get(`/orders/${id}`),
    respondToOrder: (id, action) => patch(`/orders/${id}/respond`, { action }), // action: 'accept' | 'reject'
    updateOrderStatus: (id, status) => patch(`/orders/${id}/status`, { status }),

    // ---- realtime ----
    // Mirrors miLKadmin/api.js's retry pattern for a slow/cold-starting
    // backend, since this app can't assume socket.io has finished loading.
    connectSocket(handlers, onReady) {
      let attempts = 0;
      const maxAttempts = 15;
      const tryConnect = () => {
        if (typeof io === 'undefined') {
          attempts++;
          if (attempts >= maxAttempts) {
            console.warn('Socket.IO client still not loaded after retries — staying on polling.');
            return;
          }
          setTimeout(tryConnect, 2000);
          return;
        }
        const socket = io(SOCKET_BASE, { auth: { token: getToken() } });
        Object.keys(handlers || {}).forEach(evt => socket.on(evt, handlers[evt]));
        if (typeof onReady === 'function') {
          socket.on('connect', () => onReady(socket));
        }
      };
      tryConnect();
      return null;
    }
  };

  global.Api = Api;
})(window);
