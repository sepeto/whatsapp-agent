const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema({
  botId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Bot",
    required: true,
  },
  summary: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  start: {
    type: Date,
    required: true,
  },
  end: {
    type: Date,
    required: true,
  },
  scheduled: {
    type: Boolean,
    default: false, // Por defecto asumimos que aún no fue agendada
  },
  googleEventId: {
    type: String, // Guardá esto si necesitás editar/eliminar el evento después
  },
  chatId: {
    type: String, // ID del chat de WhatsApp donde se creó la cita
  },
  userName: {
    type: String, // Nombre del usuario que creó la cita
  },
  conversationId: {
   type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
  },
  sendReminder: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  dateString: String,
  timeString: String,
});

module.exports = mongoose.model("Appointment", appointmentSchema);