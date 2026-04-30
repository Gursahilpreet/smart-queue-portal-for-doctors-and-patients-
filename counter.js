const mongoose = require("mongoose");

module.exports = mongoose.model(
  "Counter",
  new mongoose.Schema({
    name: String,
    value: Number
  })
);