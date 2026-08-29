/* pending-approval.js */

(() => {
  const refreshBtn = document.getElementById("refresh-status-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const supportLink = document.getElementById("support-link");

  supportLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "mailto:support@example.com";
  });

  logoutBtn.addEventListener("click", () => {
    DeliveryAuth.logout();
  });

  async function checkStatus(showFeedback = true) {
    try {
      const me = await authApi.me();
      const status = me.status || me.deliveryStatus;
      localStorage.setItem("db_status", status);
      if (me.profile) localStorage.setItem("db_profile", JSON.stringify(me.profile));

      if (status === "approved") {
        showToast("You're approved!", "success");
        setTimeout(() => (location.href = "home.html"), 600);
      } else if (status === "blocked") {
        location.href = "blocked.html";
      } else if (showFeedback) {
        showToast("Still under review. Check back soon.", "info");
      }
    } catch (err) {
      if (showFeedback) handleFetchError(err, "Could not check status.");
    }
  }

  refreshBtn.addEventListener("click", () => checkStatus(true));

  // Real-time approval push
  DeliverySocket.on("delivery:approved", () => {
    showToast("You're approved!", "success");
    setTimeout(() => (location.href = "home.html"), 600);
  });

  // Polling fallback every 30s
  setInterval(() => checkStatus(false), 30000);
})();
