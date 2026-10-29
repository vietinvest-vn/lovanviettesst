require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === "production";
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("ERROR: SESSION_SECRET must be set in .env and be at least 32 characters.");
  process.exit(1);
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD === "replace-this-with-a-strong-password") {
  console.error("ERROR: Set ADMIN_USERNAME and a strong ADMIN_PASSWORD in .env.");
  process.exit(1);
}
if (!process.env.BANK_ID || !process.env.BANK_ACCOUNT || !process.env.BANK_ACCOUNT_NAME) {
  console.warn("WARNING: Set BANK_ID, BANK_ACCOUNT, and BANK_ACCOUNT_NAME in .env before accepting real orders.");
}

const dataDir = process.env.VERCEL ? "/tmp/lv-data" : path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "store.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    tradingview_username TEXT,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    transfer_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    admin_note TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    delivered_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
`);
try { db.exec("ALTER TABLE orders ADD COLUMN phone TEXT"); } catch {}

const PRODUCTS = [
  { id: "lv-trend-pro", name: "LV Trend Pro", type: "tradingview", price: 299000, billing: "tháng", description: "Chỉ báo hỗ trợ quan sát xu hướng và phân tích kỹ thuật." },
  { id: "lv-smart-signal", name: "LV Smart Signal", type: "tradingview", price: 399000, billing: "tháng", description: "Công cụ tham khảo tín hiệu và xây dựng kế hoạch giao dịch." },
  { id: "lv-market-structure", name: "LV Market Structure", type: "file", price: 499000, billing: "một lần", description: "Tool/file hỗ trợ quan sát cấu trúc thị trường." },
  { id: "lv-advanced-pro", name: "LV Advanced Pro", type: "tradingview", price: 1000000, billing: "tháng", description: "Bộ công cụ nâng cao hỗ trợ phân tích xu hướng, cấu trúc thị trường và vùng giá." },
  { id: "lv-ultimate-pro", name: "LV Ultimate Pro", type: "tradingview", price: 1500000, billing: "tháng", description: "Gói công cụ phân tích nâng cao dành cho trader." }
];

const productById = new Map(PRODUCTS.map(p => [p.id, p]));
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
const SQLiteStore = SQLiteStoreFactory(session);

app.disable("x-powered-by");
app.set("trust proxy", IS_PROD ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://img.vietqr.io"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(session({
  name: "lv_admin_session",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir, table: "sessions" }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút." }
});
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Bạn đã tạo quá nhiều đơn. Vui lòng thử lại sau." }
});

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
function requireAdmin(req, res, next) {
  if (!req.session || req.session.isAdmin !== true) {
    return res.status(401).json({ error: "Vui lòng đăng nhập trang quản trị." });
  }
  next();
}
function sameOriginForWrites(req, res, next) {
  const origin = req.get("origin");
  if (!origin) return res.status(403).json({ error: "Thiếu Origin; yêu cầu bị từ chối." });
  try {
    if (new URL(origin).origin !== new URL(SITE_URL).origin) {
      return res.status(403).json({ error: "Origin không hợp lệ." });
    }
  } catch {
    return res.status(403).json({ error: "Origin không hợp lệ." });
  }
  next();
}
function publicOrder(row) {
  return {
    id: row.id,
    productName: row.product_name,
    amount: row.amount,
    transferCode: row.transfer_code,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    deliveredAt: row.delivered_at,
    adminNote: row.status === "delivered" ? row.admin_note : null
  };
}
function makeTransferCode() {
  return "LV" + crypto.randomBytes(5).toString("hex").toUpperCase();
}
function makeQrUrl(amount, transferCode) {
  const bank = encodeURIComponent(process.env.BANK_ID || "");
  const account = encodeURIComponent(process.env.BANK_ACCOUNT || "");
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: transferCode,
    accountName: process.env.BANK_ACCOUNT_NAME || ""
  });
  return `https://img.vietqr.io/image/${bank}-${account}-compact2.png?${params.toString()}`;
}

const ADMIN_COOKIE="lv_admin";
function signAdminToken(username){
  const payload=Buffer.from(JSON.stringify({u:username,exp:Date.now()+1000*60*60*8})).toString("base64url");
  const sig=crypto.createHmac("sha256",process.env.SESSION_SECRET).update(payload).digest("base64url");
  return payload+"."+sig;
}
function verifyAdminToken(token){
  if(!token||typeof token!=="string")return null;
  const parts=token.split(".");
  if(parts.length!==2)return null;
  const sig=crypto.createHmac("sha256",process.env.SESSION_SECRET).update(parts[0]).digest("base64url");
  if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(parts[1])))return null;
  try{
    const data=JSON.parse(Buffer.from(parts[0],"base64url").toString());
    if(data.exp<Date.now())return null;
    return data.u;
  }catch{return null;}
}
function getAdminCookie(req){
  const raw=req.headers.cookie||"";
  const m=raw.match(new RegExp("(?:^|; )"+ADMIN_COOKIE+"=([^;]+)"));
  return m?decodeURIComponent(m[1]):null;
}
function requireAdmin(req,res,next){
  const user=verifyAdminToken(getAdminCookie(req));
  if(!user||user!==process.env.ADMIN_USERNAME){
    return res.status(401).json({error:"Vui lòng đăng nhập trang quản trị."});
  }
  req.adminUser=user;
  next();
}

app.get("/api/products", (req, res) => {
  res.json(PRODUCTS.map(({ id, name, type, price, billing, description }) =>
    ({ id, name, type, price, billing, description })
  ));
});

app.post("/api/orders", orderLimiter, (req, res) => {
  const customerName = cleanText(req.body.name || req.body.customerName, 100);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const phone = cleanText(req.body.phone, 30);
  const tradingviewUsername = cleanText(req.body.tradingViewUsername || req.body.tradingviewUsername, 100);
  const productId = cleanText(req.body.productId, 80);
  const product = productById.get(productId);

  if (customerName.length < 2) return res.status(400).json({ error: "Vui lòng nhập họ tên hợp lệ." });
  if (!validEmail(email)) return res.status(400).json({ error: "Vui lòng nhập email hợp lệ." });
  if (!product) return res.status(400).json({ error: "Sản phẩm không hợp lệ." });
  if (product.type === "tradingview" && tradingviewUsername.length < 2) {
    return res.status(400).json({ error: "Vui lòng nhập username TradingView để cấp quyền thủ công." });
  }
  if (!process.env.BANK_ID || !process.env.BANK_ACCOUNT || !process.env.BANK_ACCOUNT_NAME) {
    return res.status(503).json({ error: "Cửa hàng chưa cấu hình thông tin ngân hàng. Vui lòng liên hệ người bán." });
  }

  const id = crypto.randomUUID();
  const transferCode = makeTransferCode();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO orders
    (id, customer_name, email, phone, tradingview_username, product_id, product_name,
     product_type, amount, transfer_code, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?)
  `).run(
    id, customerName, email, phone || null, tradingviewUsername || null, product.id, product.name,
    product.type, product.price, transferCode, createdAt
  );

  res.status(201).json({
    order: {
      id,
      productName: product.name,
      amount: product.price,
      transferCode,
      status: "pending_payment",
      createdAt
    },
    payment: {
      bankId: process.env.BANK_ID,
      accountNumber: process.env.BANK_ACCOUNT,
      accountName: process.env.BANK_ACCOUNT_NAME,
      qrUrl: makeQrUrl(product.price, transferCode),
      instruction: `Chuyển đúng ${product.price} VND và ghi nội dung ${transferCode}. Chỉ thanh toán một lần cho đơn này.`
    }
  });
});

app.post("/api/orders/status", orderLimiter, (req, res) => {
  const id = cleanText(req.body.orderId, 50);
  const email = cleanText(req.body.email, 254).toLowerCase();
  if (!id || !validEmail(email)) return res.status(400).json({ error: "Nhập mã đơn và email hợp lệ." });

  const row = db.prepare("SELECT * FROM orders WHERE id = ? AND email = ?").get(id, email);
  if (!row) return res.status(404).json({ error: "Không tìm thấy đơn với mã đơn và email này." });
  res.json({ order: publicOrder(row) });
});

app.post("/api/admin/login", loginLimiter, sameOriginForWrites, async (req, res) => {
  const username = cleanText(req.body.username, 100);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const expectedUser = process.env.ADMIN_USERNAME;

  const usernameOk = username.length === expectedUser.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser));
  const passwordOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." });
  }

  const token=signAdminToken(expectedUser);
  res.cookie(ADMIN_COOKIE,token,{httpOnly:true,secure:IS_PROD,sameSite:"strict",maxAge:1000*60*60*8,path:"/"});
  res.json({ok:true,username:expectedUser});
app.post("/api/admin/logout", requireAdmin, sameOriginForWrites, (req, res) => {
  res.clearCookie(ADMIN_COOKIE,{httpOnly:true,secure:IS_PROD,sameSite:"strict",path:"/"});
  res.json({ok:true});
    res.json({ ok: true });
  });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ ok: true, username: req.adminUser });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 300").all();
  res.json({ orders: rows.map(row => ({
    ...publicOrder(row),
    customerName: row.customer_name,
    email: row.email,
    phone: row.phone,
    tradingviewUsername: row.tradingview_username,
    productType: row.product_type,
    adminNote: row.admin_note
  })) });
});

app.post("/api/admin/orders/:id/paid", requireAdmin, sameOriginForWrites, (req, res) => {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
  if (row.status !== "pending_payment") {
    return res.status(409).json({ error: "Chỉ đơn đang chờ thanh toán mới được xác nhận." });
  }
  const result = db.prepare(`
    UPDATE orders SET status = 'paid', paid_at = ?
    WHERE id = ? AND status = 'pending_payment'
  `).run(new Date().toISOString(), row.id);
  if (!result.changes) return res.status(409).json({ error: "Đơn đã được cập nhật ở nơi khác." });
  res.json({ ok: true });
});

app.post("/api/admin/orders/:id/deliver", requireAdmin, sameOriginForWrites, (req, res) => {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
  if (row.status !== "paid") {
    return res.status(409).json({ error: "Chỉ giao sản phẩm sau khi đã xác nhận thanh toán." });
  }
  const note = cleanText(req.body.note, 2000);
  if (!note) return res.status(400).json({ error: "Nhập ghi chú giao hàng hoặc thông tin cấp quyền." });

  const result = db.prepare(`
    UPDATE orders SET status = 'delivered', delivered_at = ?, admin_note = ?
    WHERE id = ? AND status = 'paid'
  `).run(new Date().toISOString(), note, row.id);
  if (!result.changes) return res.status(409).json({ error: "Đơn đã được cập nhật ở nơi khác." });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  index: "index.html"
}));

app.use((req, res) => {
  res.status(404).json({ error: "Không tìm thấy đường dẫn." });
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  res.status(500).json({ error: "Có lỗi máy chủ. Vui lòng thử lại sau." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LV Indicator Pro is running at ${SITE_URL}`);
    console.log("Admin page: /admin.html");
  });
}
module.exports = app;
