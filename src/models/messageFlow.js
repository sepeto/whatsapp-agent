const mongoose = require("mongoose");

const messageFlowSchema = new mongoose.Schema(
  {
    name: String,
    messages: [{
      text: String,
      delayBeforeFrom: Number, // Minutos
      delayBeforeTo: Number, // Minutos
    }],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("MessageFlow", messageFlowSchema);
