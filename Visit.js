const mongoose = require("mongoose");

module.exports = mongoose.model(
  "Visit",
  new mongoose.Schema({
    patientId: mongoose.Schema.Types.ObjectId,
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doctorName: String,
    dept: String,
    date: String,
    diagnosis: String,
    rxId: mongoose.Schema.Types.ObjectId
  })
);