/* history.js */

(() => {
  const list = document.getElementById("history-list");
  const fromDate = document.getElementById("from-date");
  const toDate = document.getElementById("to-date");
  const filterBtn = document.getElementById("filter-btn");

  function rowHtml(order) {
    const id = order._id || order.id;
    const date = order.deliveredAt
      ? new Date(order.deliveredAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : "";
    return `
      <div class="hist-row" data-id="${id}">
        <div class="hr-left">
          <div class="hr-area">${order.area || order.locality || "Order"}</div>
          <div class="hr-date">${date}</div>
        </div>
        <div class="hr-amount">₹${order.amount ?? order.total ?? "--"}</div>
      </div>
    `;
  }

  function render(orders) {
    if (!orders.length) {
      renderEmptyState(list, {
        title: "No delivery history yet",
        subtitle: "Completed deliveries will show up here.",
      });
      return;
    }
    list.innerHTML = orders.map(rowHtml).join("");
    document.querySelectorAll(".hist-row").forEach((row) => {
      row.addEventListener("click", () => {
        window.appNavigate(`order-history-detail.html?id=${row.dataset.id}`);
      });
    });
  }

  async function load() {
    renderSkeleton(list, 4);
    const params = {};
    if (fromDate.value) params.from = fromDate.value;
    if (toDate.value) params.to = toDate.value;

    try {
      const res = await orderApi.getHistory(params);
      render(res.orders || res || []);
    } catch (err) {
      handleFetchError(err, "Could not load history.");
      renderEmptyState(list, {
        title: err && err.apiNotConfigured ? "Backend not connected" : "Couldn't load history",
        subtitle: err && err.apiNotConfigured ? "This app isn't linked to a backend yet." : "Try again later.",
      });
    }
  }

  filterBtn.addEventListener("click", load);

  load();
})();
