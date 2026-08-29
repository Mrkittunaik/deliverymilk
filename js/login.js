/* login.js */

(() => {
  const phoneStep = document.getElementById("phone-step");
  const otpStep = document.getElementById("otp-step");
  const phoneInput = document.getElementById("phone-input");
  const sendOtpBtn = document.getElementById("send-otp-btn");
  const verifyOtpBtn = document.getElementById("verify-otp-btn");
  const changeNumberBtn = document.getElementById("change-number-btn");
  const otpBoxes = Array.from(document.querySelectorAll(".otp-box"));
  const otpPhoneDisplay = document.getElementById("otp-phone-display");

  let currentPhone = "";

  function setBtnLoading(btn, loading, label) {
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<span class="spinner"></span>`
      : `<span class="btn-label">${label}</span>`;
  }

  sendOtpBtn.addEventListener("click", async () => {
    const phone = phoneInput.value.trim();
    if (!/^\d{10}$/.test(phone)) {
      showToast("Enter a valid 10-digit mobile number", "error");
      return;
    }
    currentPhone = phone;

    setBtnLoading(sendOtpBtn, true, "Send OTP");
    try {
      await authApi.sendOtp(phone);
      showToast("OTP sent", "success");
      otpPhoneDisplay.textContent = `+91 ${phone}`;
      phoneStep.classList.add("hidden");
      otpStep.classList.remove("hidden");
      otpBoxes[0].focus();
    } catch (err) {
      handleFetchError(err, "Could not send OTP. Try again.");
    } finally {
      setBtnLoading(sendOtpBtn, false, "Send OTP");
    }
  });

  changeNumberBtn.addEventListener("click", () => {
    otpStep.classList.add("hidden");
    phoneStep.classList.remove("hidden");
    otpBoxes.forEach((b) => (b.value = ""));
  });

  // OTP box auto-advance
  otpBoxes.forEach((box, idx) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/\D/g, "");
      if (box.value && idx < otpBoxes.length - 1) otpBoxes[idx + 1].focus();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && idx > 0) {
        otpBoxes[idx - 1].focus();
      }
    });
  });

  verifyOtpBtn.addEventListener("click", async () => {
    const otp = otpBoxes.map((b) => b.value).join("");
    if (otp.length !== 6) {
      showToast("Enter the full 6-digit OTP", "error");
      return;
    }

    setBtnLoading(verifyOtpBtn, true, "Verify");
    try {
      const res = await authApi.verifyOtp(currentPhone, otp);
      const token = res.token;
      const status = res.status || res.deliveryStatus;
      const profile = res.profile || res.delivery || null;

      localStorage.setItem("db_token", token);
      localStorage.setItem("db_status", status);
      if (profile) localStorage.setItem("db_profile", JSON.stringify(profile));

      if (status === "approved") {
        location.href = "home.html";
      } else if (status === "pending") {
        location.href = "pending-approval.html";
      } else if (status === "blocked") {
        location.href = "blocked.html";
      } else {
        location.href = "home.html";
      }
    } catch (err) {
      handleFetchError(err, "Invalid OTP. Try again.");
    } finally {
      setBtnLoading(verifyOtpBtn, false, "Verify");
    }
  });

  // TEMPORARY: demo login button. Remove when backend is connected.
  const demoBtn = document.getElementById("demo-login-btn");
  if (demoBtn) {
    demoBtn.addEventListener("click", () => {
      window.enterDemoMode();
      showToast("Demo mode on — using sample data", "success");
      setTimeout(() => (location.href = "home.html"), 400);
    });
  }
})();
