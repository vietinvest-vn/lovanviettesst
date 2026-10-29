const money = value => new Intl.NumberFormat("vi-VN").format(value) + "đ";
const $ = selector => document.querySelector(selector);
const grid = $("#productGrid");
const dialog = $("#checkoutDialog");
const checkoutForm = $("#checkoutForm");
let selectedProduct = null;
let currentOrderId = null;

$("#year").textContent = new Date().getFullYear();

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Có lỗi xảy ra. Vui lòng thử lại.");
  return data;
}

function renderProducts(products) {
  grid.replaceChildren();
  for (const product of products) {
    const article = document.createElement("article");
    article.className = "product-card";
    const icon = document.createElement("div");
    icon.className = "product-icon";
    icon.textContent = product.type === "tradingview" ? "↗" : "◈";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = product.type === "tradingview" ? "TRADINGVIEW INDICATOR" : "DIGITAL TOOL";
    const title = document.createElement("h3");
    title.textContent = product.name;
    const description = document.createElement("p");
    description.textContent = product.description;
    const price = document.createElement("div");
    price.className = "price";
    price.textContent = money(product.price);
    const billing = document.createElement("small");
    billing.textContent = product.billing === "tháng" ? " / tháng" : " / một lần";
    price.append(" ", billing);
    const button = document.createElement("button");
    button.className = "button";
    button.type = "button";
    button.textContent = "Mua ngay";
    button.addEventListener("click", () => openCheckout(product));
    article.append(icon, tag, title, description, price, button);
    grid.append(article);
  }
}

function openCheckout(product) {
  selectedProduct = product;
  checkoutForm.reset();
  checkoutForm.elements.productId.value = product.id;
  $("#selectedProduct").textContent = `${product.name} — ${money(product.price)}${product.billing === "tháng" ? "/tháng" : ""}`;
  $("#tvField").hidden = product.type !== "tradingview";
  $("#checkoutError").textContent = "";
  $("#checkoutContent").hidden = false;
  $("#paymentContent").hidden = true;
  dialog.showModal();
}

async function loadProducts() {
  try {
    const { products } = await api("/api/products").then(data => ({ products: data }));
    renderProducts(products);
  } catch (error) {
    grid.textContent = error.message;
  }
}

checkoutForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = checkoutForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  $("#checkoutError").textContent = "";
  const form = new FormData(checkoutForm);
  const payload = Object.fromEntries(form.entries());
  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    currentOrderId = result.order.id;
    $("#paymentSummary").textContent = `Đơn ${result.order.productName} — ${money(result.order.amount)}. ${result.payment.instruction}`;
    $("#qrImage").src = result.payment.qrUrl;
    $("#bankId").textContent = result.payment.bankId;
    $("#bankAccount").textContent = result.payment.accountNumber;
    $("#bankName").textContent = result.payment.accountName;
    $("#bankAmount").textContent = money(result.order.amount);
    $("#transferCode").textContent = result.order.transferCode;
    $("#orderIdDisplay").textContent = result.order.id;
    $("#checkoutContent").hidden = true;
    $("#paymentContent").hidden = false;
  } catch (error) {
    $("#checkoutError").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

$("#copyTransfer").addEventListener("click", async () => {
  const code = $("#transferCode").textContent;
  try {
    await navigator.clipboard.writeText(code);
    $("#copyTransfer").textContent = "Đã sao chép mã";
  } catch {
    window.prompt("Sao chép nội dung chuyển khoản này:", code);
  }
});

$("#closeCheckout").addEventListener("click", () => dialog.close());
$("#newOrder").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});

$("#statusForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const resultBox = $("#statusResult");
  resultBox.textContent = "Đang tra cứu…";
  try {
    const result = await api("/api/orders/status", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    const labels = {
      pending_payment: "Chờ thanh toán",
      paid: "Đã xác nhận thanh toán — đang chờ giao hàng",
      delivered: "Đã giao hàng"
    };
    resultBox.textContent =
      `Sản phẩm: ${result.order.productName}\n` +
      `Trạng thái: ${labels[result.order.status] || result.order.status}\n` +
      `Số tiền: ${money(result.order.amount)}\n` +
      (result.order.adminNote ? `Thông tin giao hàng: ${result.order.adminNote}` : "");
  } catch (error) {
    resultBox.textContent = error.message;
  }
});

loadProducts();
