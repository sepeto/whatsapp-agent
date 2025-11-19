const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const AskPreset = new Schema(
  {
    key: String,
    prompt: String,
    model: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("AskPreset", AskPreset);
