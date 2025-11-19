const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    userId: String,
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bot",
    },
    active: {
      type: Boolean,
      default: true,
    },
    finalizedDate: Date,
    retryMesagesActive: {
      type: Boolean,
      default: false,
    },
    retryMessagesSended: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    }]
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Conversation", conversationSchema);
