const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  role: { type: String, enum: ["patient", "doctor"], required: true },
  email: { type: String, unique: true },
  phone: String,
  password: String,
  fname: String,
  lname: String,

  // patient
  age: Number,
  blood: String,

  // doctor
  spec: String,
  qual: String,
  exp: Number,
  fee: Number,
  avatarColor: String,
  servedCount: { type: Number, default: 0 }
});

module.exports = mongoose.model("User", UserSchema);