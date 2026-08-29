/* delivery-mock.js
   TEMPORARY DEMO MODE — lets you click around the whole app without a backend.
   Include this BEFORE delivery-api.js to auto-intercept API calls when
   localStorage "db_demo_mode" is "1".
   Remove this file + its <script> tags once your real backend is connected.
*/

const DEMO_FLAG = "db_demo_mode";

function isDemoMode() {
  return localStorage.getItem(DEMO_FLAG) === "1";
}

const MOCK_PROFILE = {
  name: "Ravi Kumar",
  phone: "9876543210",
  email: "ravi@example.com",
  status: "approved",
  available: true,
  photoUrl: "../images/avatar-placeholder.png",
  vehicleType: "bike",
};

const MOCK_STATS = { totalDelivered: 128, rating: 4.7 };

function mockOrder(i, status) {
  return {
    _id: `mockorder${i}`,
    customerName: ["Anita Sharma", "Vikram Rao", "Priya Nair", "Sanjay Gupta"][i % 4],
    customerPhone: "9123456780",
    area: ["Jubilee Hills", "Banjara Hills", "Madhapur", "Gachibowli"][i % 4],
    locality: ["Jubilee Hills", "Banjara Hills", "Madhapur", "Gachibowli"][i % 4],
    distance: `${1 + i}.${i}km`,
    amount: 120 + i * 15,
    total: 120 + i * 15,
    itemCount: 2 + (i % 3),
    paymentStatus: i % 2 === 0 ? "paid" : "cod",
    paid: i % 2 === 0,
    status: status,
    addressLine1: `${100 + i}, Green Valley Apartments`,
    addressPreview: `${100 + i}, Green Valley Apartments, Road No ${i + 1}`,
    room: `${i + 1}0${i}`,
    apartment: "Green Valley Apartments",
    landmark: "Near City Park",
    lat: 17.385 + i * 0.01,
    lng: 78.4867 + i * 0.01,
    deliveredAt: new Date(Date.now() - i * 86400000).toISOString(),
    items: [
      { name: "Full Cream Milk 1L", qty: 2, price: 66 },
      { name: "Curd 400g", qty: 1, price: 40 },
      { name: "Paneer 200g", qty: 1, price: 80 },
    ],
  };
}

const MOCK_POOL = [mockOrder(0, "pending_pickup"), mockOrder(1, "pending_pickup"), mockOrder(2, "pending_pickup")];
const MOCK_ACTIVE = [mockOrder(3, "accepted"), mockOrder(4, "out_for_delivery")];
const MOCK_HISTORY = [mockOrder(5, "delivered"), mockOrder(6, "delivered"), mockOrder(7, "delivered")];

function delay(ms = 400) {
  return new Promise((res) => setTimeout(res, ms));
}

const MockApi = {
  authApi: {
    sendOtp: async () => {
      await delay();
      return { success: true };
    },
    verifyOtp: async () => {
      await delay();
      return { token: "demo-token-123", status: "approved", profile: MOCK_PROFILE };
    },
    signup: async () => {
      await delay();
      return { success: true };
    },
    me: async () => {
      await delay(200);
      return { status: MOCK_PROFILE.status, profile: MOCK_PROFILE };
    },
  },
  orderApi: {
    getPool: async () => {
      await delay();
      return { orders: MOCK_POOL, maxConcurrentOrders: 3, activeOrderCount: MOCK_ACTIVE.length };
    },
    accept: async (id) => {
      await delay();
      return { success: true, id };
    },
    getActive: async () => {
      await delay();
      return { orders: MOCK_ACTIVE };
    },
    getById: async (id) => {
      await delay(200);
      const all = [...MOCK_POOL, ...MOCK_ACTIVE, ...MOCK_HISTORY];
      const found = all.find((o) => o._id === id) || MOCK_ACTIVE[0];
      return { order: found };
    },
    startDelivery: async () => {
      await delay();
      return { success: true };
    },
    markDelivered: async () => {
      await delay();
      return { success: true };
    },
    getHistory: async () => {
      await delay();
      return { orders: MOCK_HISTORY };
    },
  },
  deliveryApi: {
    updateAvailability: async () => {
      await delay(150);
      return { success: true };
    },
    updateProfile: async () => {
      await delay(150);
      return { success: true };
    },
    getStats: async () => {
      await delay(150);
      return MOCK_STATS;
    },
  },
};

window.__DEMO_MODE__ = isDemoMode();
window.MockApi = MockApi;
window.enterDemoMode = function () {
  localStorage.setItem(DEMO_FLAG, "1");
  localStorage.setItem("db_token", "demo-token-123");
  localStorage.setItem("db_status", "approved");
  localStorage.setItem("db_profile", JSON.stringify(MOCK_PROFILE));
};
window.exitDemoMode = function () {
  localStorage.removeItem(DEMO_FLAG);
  localStorage.removeItem("db_token");
  localStorage.removeItem("db_status");
  localStorage.removeItem("db_profile");
};
