require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

// Models
const Product = require("./server/models/Product");
const Order = require("./server/models/Order");
const Contact = require("./server/models/Contact");

const app = express();

// Middlewares
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

// Log
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch((err) => console.error("MongoDB Error:", err));

// Admin user
let users = [];
const initAdmin = async () => {
  if (users.length === 0) {
    const hashed = await bcrypt.hash("admin123", 10);
    users.push({
      _id: "1",
      username: "admin",
      password: hashed,
      dp: "/default-dp.jpg",
    });
    console.log("Admin → admin / admin123");
  }
};
initAdmin();

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest =
      req.body.type === "dp" ? "public/admin-dp/" : "public/uploads/";
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// JWT Auth
const auth = (req, res, next) => {
  let token = req.header("Authorization");
  if (token && token.startsWith("Bearer ")) token = token.slice(7);
  if (!token) return res.status(401).json({ msg: "No token" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ msg: "Invalid token" });
  }
};

// ====================== PUBLIC ROUTES ======================

app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ msg: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ====================== ADMIN ROUTES ======================

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  const user = users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ msg: "Invalid credentials" });
  }
  const token = jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET || "secretkey",
    { expiresIn: "12h" }
  );
  res.json({ token, user: { username: user.username, dp: user.dp } });
});

app.get("/api/admin/products", auth, async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ msg: "Error" });
  }
});

app.post(
  "/api/admin/products",
  auth,
  upload.array("images", 5),
  async (req, res) => {
    try {
      const { name, description, price, discount, stock, category, tags } =
        req.body;

      if (!name || !price || !stock) {
        return res.status(400).json({ msg: "Name, price and stock required" });
      }

      let parsedTags = [];
      if (tags) {
        try {
          parsedTags = JSON.parse(tags);
        } catch (e) {
          parsedTags = [];
        }
      }

      const images = req.files
        ? req.files.map((f) => `/uploads/${f.filename}`)
        : [];

      const newProduct = new Product({
        name: name.trim(),
        description: description || "",
        price: parseFloat(price),
        discount: parseFloat(discount) || 0,
        stock: parseInt(stock),
        category: category || "",
        tags: parsedTags,
        images,
      });

      await newProduct.save();
      res.json({ msg: "Product added!", product: newProduct });
    } catch (err) {
      console.error("Product save error:", err);
      res.status(500).json({ msg: "Failed to add product" });
    }
  }
);

// ====================== ORDERS ROUTES ======================

app.post("/api/orders", async (req, res) => {
  try {
    const { productId, buyer, qty, subtotal, gst, delivery, total } = req.body;

    const product = await Product.findById(productId);
    if (!product || product.stock < qty) {
      return res.status(400).json({ msg: "Insufficient stock" });
    }

    const order = new Order({
      productId,
      productName: product.name,
      buyer,
      qty,
      subtotal,
      gst,
      delivery,
      total,
    });

    await order.save();

    // Stock update
    product.stock -= qty;
    await product.save();

    res.json(order);
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ msg: "Order failed" });
  }
});

// YE DO ROUTES MISSING THAY → AB ADD KAR DIYE!
app.get("/api/admin/orders", auth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ msg: "Error fetching orders" });
  }
});

app.put("/api/admin/orders/:id", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ msg: "Order not found" });

    const oldStatus = order.status;
    order.status = req.body.status;
    order.updatedAt = new Date();

    if (req.body.status === "Rejected" && oldStatus === "Pending") {
      const product = await Product.findById(order.productId);
      if (product) {
        product.stock += order.qty;
        await product.save();
      }
    }

    await order.save();
    res.json({ msg: "Updated!", order });
  } catch (err) {
    res.status(500).json({ msg: "Error" });
  }
});

// ====================== CONTACT ======================

app.post("/api/contact", async (req, res) => {
  try {
    const { name, phone, email, message } = req.body;
    if (!name || !phone || !message)
      return res.status(400).json({ msg: "Required fields" });

    const newMsg = new Contact({ name, phone, email, message });
    await newMsg.save();
    res.json({ msg: "Sent!" });
  } catch (err) {
    res.status(500).json({ msg: "Error" });
  }
});

// YE ROUTE BHI MISSING THA → AB ADD KAR DIYA!
app.get("/api/admin/contact", auth, async (req, res) => {
  try {
    const messages = await Contact.find().sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    console.error("Error fetching contact messages:", err);
    res.status(500).json({ msg: "Error fetching messages" });
  }
});

// ====================== STATIC FILES ======================

app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "admin", "login.html"))
);
app.get("/admin/*", (req, res) =>
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"))
);

app.use((req, res) => res.status(404).send("Not Found"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\nSERVER RUNNING ON PORT ${PORT}!`);
  console.log(`Website → http://localhost:${PORT}`);
  console.log(`Admin → http://localhost:${PORT}/admin`);
});
