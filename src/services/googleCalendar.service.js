const axios = require("axios");
const nodemailer = require("nodemailer");
const moment = require("moment-timezone");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const API_BASE_URL = process.env.API_BASE_URL;

// SMTP env
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM;
const MAIL_NOTIFICATION_TO = process.env.MAIL_NOTIFICATION_TO;

async function getValidAccessToken({ refreshToken }) {
  if (!refreshToken)
    throw new Error("Usuario no vinculado a Google");

  // Refrescar access_token
  const res = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const { access_token } = res.data;

  return access_token;
}

async function saveGoogleCalendarDate({
  refreshToken,
  summary,
  description,
  start,
  end,
  invalidCredentialsCallback,
  botName,
}) {
  try {
    const accessToken = await getValidAccessToken({ refreshToken });

    const response = await axios.post(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        summary,
        description,
        start: { dateTime: start, timeZone: API_BASE_URL?.includes?.("localhost") ? "America/Argentina/Buenos_Aires" :"Europe/Madrid" },
        end: { dateTime: end, timeZone: API_BASE_URL?.includes?.("localhost") ? "America/Argentina/Buenos_Aires" :"Europe/Madrid" },
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log("Evento creado:", response.data);

    return response.data;
  } catch (err) {
     const errorData = err.response?.data;

    if (
      errorData?.error === "invalid_grant" ||
      errorData?.error_description?.includes("Token has been expired or revoked")
    ) {
      console.warn("Refresh token inválido o expirado");
      await sendTokenExpiredEmail({
        to: MAIL_NOTIFICATION_TO,
        when: moment().tz("Europe/Madrid").format("DD/MM/YYYY HH:mm:ss"),
        botName,
        details:
          errorData?.error_description ||
          errorData?.error ||
          err.message,
      });
      invalidCredentialsCallback?.(); // lógica de borrado
    } 
    console.error(err.response?.data || err.message);
    return null; // Retornar null en caso de error
  }
}

async function sendTokenExpiredEmail({ to, when, botName, details }) {
  if (!to || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("[sendTokenExpiredEmail] Falta config SMTP o destinatario; se omite envío.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true para 465, false para el resto
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const subject = "Tu vinculación con Google caducó";
  const text = [
    `Hola,`,
    "",
    "Tu acceso a Google (refresh token) ha expirado o fue revocado.",
    "Por favor vuelve a vincular tu cuenta para seguir creando eventos en Google Calendar.",
    "",
    `Fecha/hora del evento: ${when ?? "N/D"}`,
    `Nombre del bot: ${botName ?? "N/D"}`,
    details ? `Detalles técnicos: ${details}` : "",
    "",
    "— Equipo de Soporte",
  ].join("\n");

  try {
    await transporter.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text,
    });
    console.log("[sendTokenExpiredEmail] Notificación enviada a", to);
  } catch (e) {
    console.error("[sendTokenExpiredEmail] Error al enviar email:", e.message);
  }
}

module.exports = {
  saveGoogleCalendarDate,
  sendTokenExpiredEmail
};
