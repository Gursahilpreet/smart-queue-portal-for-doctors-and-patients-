const mongoose = require("mongoose");

module.exports = mongoose.model(
  "Prescription",
  new mongoose.Schema({
    patientId: mongoose.Schema.Types.ObjectId,
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doctorName: String,
    dept: String,
    date: String,
    diagnosis: String,
    bimari: String,
    complaint: String,
    meds: String,
    notes: String
  })
);