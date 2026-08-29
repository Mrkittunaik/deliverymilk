/* account.js */

(() => {
  const nameDisplay = document.getElementById("acc-name-display");
  const phoneDisplay = document.getElementById("acc-phone-display");
  const statusBadge = document.getElementById("acc-status-badge");
  const totalOrders = document.getElementById("acc-total-orders");
  const ratingEl = document.getElementById("acc-rating");
  const avatarImg = document.getElementById("acc-avatar-img");
  const avatarUpload = document.getElementById("acc-avatar-upload");
  const avatarFile = document.getElementById("acc-avatar-file");
  const availabilityToggle = document.getElementById("availability-toggle");

  const editBtn = document.getElementById("edit-profile-btn");
  const editView = document.getElementById("edit-profile-view");
  const editForm = document.getElementById("edit-profile-form");
  const editNameInput = document.getElementById("edit-name-input");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  const saveProfileBtn = document.getElementById("save-profile-btn");

  const logoutBtn = document.getElementById("logout-btn");

  function renderProfile(profile) {
    nameDisplay.textContent = profile.name || "Delivery Partner";
    phoneDisplay.textContent = profile.phone || "";
    statusBadge.textContent = profile.status === "approved" ? "Approved" : (profile.status || "Active");
    if (profile.photoUrl) avatarImg.src = profile.photoUrl;
    availabilityToggle.checked = profile.available !== false;
    editNameInput.value = profile.name || "";
  }

  avatarUpload.addEventListener("click", () => avatarFile.click());
  avatarFile.addEventListener("change", async () => {
    const file = avatarFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => (avatarImg.src = e.target.result);
    reader.readAsDataURL(file);

    const fd = new FormData();
    fd.append("photo", file);
    try {
      await deliveryApi.updateProfile(fd);
      showToast("Photo updated", "success");
    } catch (err) {
      handleFetchError(err, "Could not update photo.");
    }
  });

  availabilityToggle.addEventListener("change", async () => {
    const available = availabilityToggle.checked;
    try {
      await deliveryApi.updateAvailability(available);
      const profile = DeliveryAuth.getProfile() || {};
      profile.available = available;
      localStorage.setItem("db_profile", JSON.stringify(profile));
      showToast(available ? "You're now available" : "You're now unavailable", "success");
    } catch (err) {
      availabilityToggle.checked = !available;
      handleFetchError(err, "Could not update availability.");
    }
  });

  editBtn.addEventListener("click", () => {
    editView.classList.add("hidden");
    editForm.classList.remove("hidden");
  });

  cancelEditBtn.addEventListener("click", () => {
    editForm.classList.add("hidden");
    editView.classList.remove("hidden");
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = editNameInput.value.trim();
    if (!name) {
      showToast("Name cannot be empty", "error");
      return;
    }
    saveProfileBtn.disabled = true;
    saveProfileBtn.innerHTML = `<span class="spinner"></span>`;
    try {
      await deliveryApi.updateProfile({ name });
      const profile = DeliveryAuth.getProfile() || {};
      profile.name = name;
      localStorage.setItem("db_profile", JSON.stringify(profile));
      nameDisplay.textContent = name;
      showToast("Profile updated", "success");
      editForm.classList.add("hidden");
      editView.classList.remove("hidden");
    } catch (err) {
      handleFetchError(err, "Could not update profile.");
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.innerHTML = `<span class="btn-label">Save changes</span>`;
    }
  });

  logoutBtn.addEventListener("click", () => {
    openModal({
      title: "Log out?",
      body: "You'll need to log in again to accept orders.",
      confirmText: "Logout",
      danger: true,
      onConfirm: () => {
        closeModal();
        DeliveryAuth.logout();
      },
    });
  });

  // TEMPORARY: demo mode exit control. Remove when backend is connected.
  if (window.__DEMO_MODE__) {
    const banner = document.getElementById("demo-mode-banner");
    const exitLink = document.getElementById("exit-demo-link");
    if (banner) banner.style.display = "block";
    if (exitLink) {
      exitLink.addEventListener("click", (e) => {
        e.preventDefault();
        window.exitDemoMode();
        location.href = "login.html";
      });
    }
  }

  async function load() {
    const cached = DeliveryAuth.getProfile();
    if (cached) renderProfile(cached);

    try {
      const me = await authApi.me();
      const profile = me.profile || me;
      renderProfile(profile);
      localStorage.setItem("db_profile", JSON.stringify(profile));
    } catch (err) {
      handleFetchError(err, "Could not load profile.");
    }

    try {
      const stats = await deliveryApi.getStats();
      totalOrders.textContent = stats.totalDelivered ?? 0;
      ratingEl.textContent = stats.rating != null ? stats.rating.toFixed(1) : "--";
    } catch (err) {
      // stats endpoint optional; fail silently
      console.warn("Could not load stats", err);
    }
  }

  load();
})();
