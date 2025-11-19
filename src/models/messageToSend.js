const mongoose = require("mongoose");

const messageToSendSchema = new mongoose.Schema(
  {
    content: String,
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bot",
    },
    contactId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Contact",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("MessageToSend", messageToSendSchema);
