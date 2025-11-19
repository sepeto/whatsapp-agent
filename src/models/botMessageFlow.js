const mongoose = require("mongoose");

const botMessageFlowSchema = new mongoose.Schema(
  {
    name: String,
    contacts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Contact",
      },
    ],
    initialDripFrom: Number,
    initialDripTo: Number,
    messagedContacts: {
      type: [String],
      default: [],
    },
    messageSent: {
      type:  [{
        contactId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Contact",
        },
        messageFlow: [String],
      }],
      default: [],
    },
    messageFlow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MessageFlow",
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bot",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("BotMessageFlow", botMessageFlowSchema);
