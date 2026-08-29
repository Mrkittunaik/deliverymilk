/* signup.js */

(() => {
  const form = document.getElementById("signup-form");
  const submitBtn = document.getElementById("submit-btn");
  const photoUpload = document.getElementById("photo-upload");
  const photoFile = document.getElementById("photo-file");
  const photoPreview = document.getElementById("photo-preview");
  const photoIcon = document.getElementById("photo-icon");

  photoUpload.addEventListener("click", () => photoFile.click());

  photoFile.addEventListener("change", () => {
    const file = photoFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      photoPreview.src = e.target.result;
      photoPreview.classList.remove("hidden");
      photoIcon.classList.add("hidden");
    };
    reader.readAsDataURL(file);
  });

  function setBtnLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? `<span class="spinner"></span>`
      : `<span class="btn-label">Submit application</span>`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name-input").value.trim();
    const phone = document.getElementById("phone-input").value.trim();
    const email = document.getElementById("email-input").value.trim();
    const password = document.getElementById("password-input").value;
    const vehicle = document.getElementById("vehicle-input").value;

    if (!name || !/^\d{10}$/.test(phone) || !password) {
      showToast("Please fill all required fields correctly", "error");
      return;
    }

    const fd = new FormData();
    fd.append("name", name);
    fd.append("phone", phone);
    if (email) fd.append("email", email);
    fd.append("password", password);
    if (vehicle) fd.append("vehicleType", vehicle);
    if (photoFile.files[0]) fd.append("photo", photoFile.files[0]);

    setBtnLoading(true);
    try {
      await authApi.signup(fd);
      showToast("Application submitted!", "success");
      setTimeout(() => (location.href = "pending-approval.html"), 500);
    } catch (err) {
      handleFetchError(err, "Could not submit application. Try again.");
    } finally {
      setBtnLoading(false);
    }
  });
})();
