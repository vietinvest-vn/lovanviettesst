
const menuToggle = document.getElementById("menuToggle");
const nav = document.getElementById("nav");

const productDialog = document.getElementById("productDialog");
const dialogTitle = document.getElementById("dialogTitle");
const closeDialog = document.getElementById("closeDialog");

// Năm hiện tại ở chân trang
document.getElementById("year").textContent =
  new Date().getFullYear();

// Menu dành cho điện thoại
menuToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");

  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute(
    "aria-label",
    isOpen ? "Đóng menu" : "Mở menu"
  );

  menuToggle.textContent = isOpen ? "✕" : "☰";
});

// Đóng menu sau khi chọn liên kết
nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Mở menu");
    menuToggle.textContent = "☰";
  });
});

// Hiển thị thông tin sản phẩm khi nhấn nút
document.querySelectorAll(".buy-btn").forEach((button) => {
  button.addEventListener("click", () => {
    dialogTitle.textContent = button.dataset.product;

    if (typeof productDialog.showModal === "function") {
      productDialog.showModal();
    } else {
      alert("Bạn đã chọn: " + button.dataset.product);
    }
  });
});

// Đóng hộp thoại
closeDialog.addEventListener("click", () => {
  productDialog.close();
});

// Nhấn bên ngoài hộp thoại để đóng
productDialog.addEventListener("click", (event) => {
  if (event.target === productDialog) {
    productDialog.close();
  }
});
