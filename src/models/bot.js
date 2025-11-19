const mongoose = require("mongoose");

const botSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    model: {
      type: String,
      default: "gpt-4o-mini",
    },
    prompt: {
      type: String,
      required: true,
    },
    temperature: {
      type: Number,
      default: 0.2,
    },
    maxMessageCount: {
      type: Number,
      default: 20,
    },
    delayResponseFrom: {
      type: Number,
      default: 0, // Segundos
    },
    delayResponseTo: {
      type: Number,
      default: 0, // Segundos
    },
    pendingLogout: {
      type: Boolean,
      default: false,
    },
    phone: String,
    redirectPhone: String,
    messageInitTrigger: String,
    botConversationDefaultActive: {
      type: Boolean,
      default: true,
    },
    messageCompleteRedirectTrigger: String,
    messageCompleteResponseFinalizated: String,
    activeMessageCompleteRedirectTrigger: {
      type: Boolean,
      default: false,
    },
    messageManualFinishTrigger: String,
    activeMessageManualFinishTrigger: {
      type: Boolean,
      default: false,
    },
    appointmentMessageTrigger: String,
    activeAppointmentMessageTrigger: {
      type: Boolean,
      default: false,
    },
    appointmentMessageResponse: String,
    activeAutoReset: {
      type: Boolean,
      default: false,
    },
    autoResetTime: Number, // Horas
    activeMessagesLimit: {
      type: Boolean,
      default: false,
    },
    messagesLimitCount: {
      type: Number,
    },
    active: {
      type: Boolean,
      default: false,
    },
    googleAccessToken: String,
    googleRefreshToken: String,
    mainBotMessageFlow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BotMessageFlow",
    },
    reminders: {
      type: [
        {
          waitingFrom: {
            type: Number,
            required: true,
          },
          waitingTo: {
            type: Number,
            required: true,
          },
          message: {
            type: String,
            required: true,
          },
        },
      ],
      default: [],
    },
    retrySettings: {
      type: {
        active: {
          type: Boolean,
          default: false, // si está habilitado o no
        },
        triggerMessageCount: {
          type: Number,
          default: 1, // número de mensajes sin respuesta para activar reintento
        },
        retryCount: {
          type: Number,
          default: 1, // número total de reintentos
        },
        intervalHoursFrom: {
          type: Number,
          default: 1, // hora de inicio del intervalo
        },
        intervalHoursTo: {
          type: Number,
          default: 24, // hora de inicio del intervalo
        },
        noSendHoursFrom: {
          type: Number,
          default: 22, // hora desde la que NO se pueden enviar mensajes (ej: 22hs)
        },
        noSendHoursTo: {
          type: Number,
          default: 8, // hora hasta la que NO se pueden enviar mensajes (ej: 8hs)
        },
        retryPrompt: {
          type: String, // Prompt que se generará el mensaje a enviar en cada reintento
        },
      },
      default: {
        active: false,
        triggerMessageCount: 1,
        retryCount: 1,
        intervalHours: 24,
      },
    },
    validator: {
      type: {
        active: {
          type: Boolean,
          default: false, // si está habilitado o no
        },
        retryCount: {
          type: Number,
          default: 1,
        },
        fallbackMessage: {
          type: String,
        },
        fallbackRedirectNumber: {
          type: String,
        },
        prompt: {
          type: String,
        },
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Bot", botSchema);
