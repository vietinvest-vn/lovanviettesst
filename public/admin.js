const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("vi-VN").format(value) + "đ";

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Yêu cầu thất bại.");
  return data;
}

function showLoggedIn() {
  $("#loginPanel").hidden = true;
  $("#ordersPanel").hidden = false;
  $("#logoutButton").hidden = false;
  loadOrders();
}
function showLoggedOut() {
  $("#loginPanel").hidden = false;
  $("#ordersPanel").hidden = true;
  $("#logoutButton").hidden = true;
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  $("#loginMessage").textContent = "";
  try {
    const form = new FormData(event.currentTarget);
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    event.currentTarget.reset();
    showLoggedIn();
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: JSON.stringify({}) }); }
  finally { showLoggedOut(); }
});
$("#refreshButton").addEventListener("click", loadOrders);

async function loadOrders() {
  const list = $("#ordersList");
  const message = $("#ordersMessage");
  list.replaceChildren();
  message.textContent = "Đang tải đơn hàng…";
  try {
    const { orders } = await api("/api/admin/orders");
    message.textContent = `Có ${orders.length} đơn hàng gần nhất.`;
    if (!orders.length) {
      list.textContent = "Chưa có đơn hàng.";
      return;
    }
    for (const order of orders) list.append(renderOrder(order));
  } catch (error) {
    message.textContent = error.message;
    if (error.message.includes("đăng nhập")) showLoggedOut();
  }
}

function renderOrder(order) {
  const card = document.createElement("article");
  card.className = "panel admin-order";
  const title = document.createElement("h2");
  title.textContent = `${order.productName} — ${money(order.amount)}`;
  const details = document.createElement("div");
  details.className = "order-details";
  const rows = [
    ["Mã đơn", order.id],
    ["Khách hàng", order.customerName],
    ["Email", order.email],
    ["Username TradingView", order.tradingviewUsername || "Không áp dụng"],
    ["Mã chuyển khoản", order.transferCode],
    ["Trạng thái", ({
      pending_payment: "Chờ thanh toán",
      paid: "Đã xác nhận thanh toán",
      delivered: "Đã giao hàng"
    })[order.status] || order.status],
    ["Tạo lúc", new Date(order.createdAt).toLocaleString("vi-VN")]
  ];
  for (const [label, value] of rows) {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    p.append(strong, document.createTextNode(value || ""));
    details.append(p);
  }
  card.append(title, details);

  if (order.status === "pending_payment") {
    const confirmButton = document.createElement("button");
    confirmButton.className = "button";
    confirmButton.textContent = "Xác nhận đã nhận tiền";
    confirmButton.addEventListener("click", async () => {
      if (!window.confirm("Chỉ tiếp tục nếu bạn đã kiểm tra tài khoản ngân hàng và xác nhận nhận đúng số tiền cho mã chuyển khoản này.")) return;
      confirmButton.disabled = true;
      try {
        await api(`/api/admin/orders/${encodeURIComponent(order.id)}/paid`, {
          method: "POST", body: JSON.stringify({})
        });
        await loadOrders();
      } catch (error) { alert(error.message); confirmButton.disabled = false; }
    });
    card.append(confirmButton);
  } else if (order.status === "paid") {
    const label = document.createElement("label");
    label.textContent = order.productType === "tradingview"
      ? "Ghi chú cấp quyền (ví dụ: đã cấp quyền username TradingView …)"
      : "Ghi chú giao file (nên dùng kênh gửi riêng an toàn, không dán liên kết công khai)";
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.maxLength = 2000;
    textarea.placeholder = "Nhập thông tin giao hàng khách có thể xem khi tra cứu đơn…";
    label.append(textarea);
    const deliver = document.createElement("button");
    deliver.className = "button";
    deliver.textContent = "Đánh dấu đã giao";
    deliver.addEventListener("click", async () => {
      if (!textarea.value.trim()) return alert("Hãy nhập ghi chú giao hàng.");
      if (!confirm("Bạn đã thực sự cấp quyền/giao sản phẩm cho khách chưa?")) return;
      deliver.disabled = true;
      try {
        await api(`/api/admin/orders/${encodeURIComponent(order.id)}/deliver`, {
          method: "POST", body: JSON.stringify({ note: textarea.value.trim() })
        });
        await loadOrders();
      } catch (error) { alert(error.message); deliver.disabled = false; }
    });
    card.append(label, deliver);
  } else if (order.status === "delivered" && order.adminNote) {
    const note = document.createElement("p");
    note.textContent = "Ghi chú giao hàng: " + order.adminNote;
    card.append(note);
  }
  return card;
}

api("/api/admin/me").then(showLoggedIn).catch(showLoggedOut);
