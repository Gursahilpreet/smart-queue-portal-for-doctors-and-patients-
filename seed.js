require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const Counter = require("./models/Counter");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await User.deleteMany();
  await Counter.deleteMany();

  const pw = await bcrypt.hash("1234", 10);

  await User.insertMany([
    { role: "patient", email: "patient@demo", password: pw, fname: "Demo", lname: "Patient" },
    { role: "doctor", email: "doctor@demo", password: pw, fname: "Demo", lname: "Doctor", spec: "General" }
  ]);

  await Counter.create({ name: "token", value: 100 });

  console.log("✅ Seeded");
  process.exit();
})();