const mongoose = require("mongoose");

module.exports = mongoose.model(
  "Queue",
  new mongoose.Schema({
    token: Number,
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    patientName: String,
    doctorName: String,
    dept: String,
    phone: String,
    status: { type: String, enum: ["waiting", "serving", "done"] },
    bookedAt: { type: Date, default: Date.now }
  })
);