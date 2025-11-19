const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    name: String,
    phone: {
      type: String,
      unique: true,
      required: true,
    },
    email: String,
    description: String,
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bot",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Contact", contactSchema);
