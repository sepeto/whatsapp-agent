// Importamos librerías
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const mime = require("mime-types");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const normalizeSpanishPhone = require("../utils/normalizeSpanishPhone.js");
const {
  crearLeadAirtableSDK,
  actualizarLeadAirtableSDK,
  buscarLeadsPorNombreTelefono,
} = require("../services/airtable.service.js");
const { getQueueForKey, cleanupQueue } = require("../utils/manageQueues.js");

require("dotenv").config();
const {
  BotConnectionStates,
} = require("../models/enums/botConnectionState.js");
const {
  saveGoogleCalendarDate,
} = require("../services/googleCalendar.service.js");
const { clear } = require("console");
const activeReminders = new Map(); // Mapa para almacenar recordatorios activos por botId
const activeRetryMessages = new Map();
const API_BASE_URL = process.env.API_BASE_URL;
const airtableBotsEnabled =
  process.env.AIRTABLE_BOTS_ENABLED?.split?.(",") || [];
const RECOVER_YOUR_HAIR_BOT_ID = "68222c52df502d159ec50432";

async function deleteSession(clientId, deleteSessionAttempts = 5) {
  const rootDir = path.resolve(__dirname, "../../");
  const sessionPath = path.join(rootDir, ".wwebjs_auth", "session-" + clientId);

  for (let i = 0; i < deleteSessionAttempts; i++) {
    try {
      if (fs.existsSync(sessionPath)) {
        await fs.promises.rm(sessionPath, { recursive: true, force: true });
        console.log(`✅ Sesión eliminada para ${clientId}`);
      }
      return;
    } catch (err) {
      if (["EPERM", "EBUSY"].includes(err.code)) {
        console.warn(
          `⚠️ Archivo bloqueado, reintentando en 500ms... (${
            i + 1
          }/${deleteSessionAttempts})`
        );
        await new Promise((res) => setTimeout(res, 500));
      } else {
        console.error("❌ Error al eliminar sesión:", err);
        break;
      }
    }
  }

  console.error(
    `❌ No se pudo eliminar la sesión ${clientId} después de ${deleteSessionAttempts} intentos`
  );
}

const initializeWhatsAppClient = async ({
  botId: botIdMongoose,
  botName,
  openaiClient,
  model,
  temperature,
  maxMessageCount,
  delayResponseFrom,
  delayResponseTo,
  prompt,
  redirectPhone,
  messageInitTrigger,
  botConversationDefaultActive,
  messageManualFinishTrigger,
  activeMessageManualFinishTrigger,
  messageCompleteRedirectTrigger,
  messageCompleteResponseFinalizated,
  activeMessageCompleteRedirectTrigger,
  appointmentMessageTrigger,
  activeAppointmentMessageTrigger,
  appointmentMessageResponse,
  googleRefreshToken,
  activeAutoReset,
  activeMessagesLimit,
  messagesLimitCount,
  reminders,
  retrySettings,
  validator,
  autoResetTime,
  bot: currentBot,
  pendingBotStateRequests,
  attemps = 0,
  maxAttemps = 3,
  BotMessageFlow,
  Appointment,
  Contact,
  Conversation,
  Message,
  MessageToSend,
  messageFlowQueue,
  executeMessageFlowQueue,
  BotModel,
}) => {
  try {
    if (attemps >= maxAttemps) {
      console.error(
        `Error: Fallaron ${maxAttemps} intentos de inicialización. Abortando.`
      );
      throw new Error(
        "No se pudo inicializar el cliente de WhatsApp después de múltiples intentos"
      );
    }

    const botId = botIdMongoose?.toString?.(); // Convertimos el botId a string para evitar problemas de comparación
    if (currentBot) {
      currentBot.connectionState = BotConnectionStates.INITIALIZING;
      const usersToEmit = pendingBotStateRequests.get(botId);
      if (usersToEmit) {
        usersToEmit.users.forEach((user) => {
          user.socket.emit("whatsapp bot state", {
            state: BotConnectionStates.INITIALIZING,
            userId: user.userId,
            qr: currentBot.qr,
            botId,
          });
        });
      }
    }

    let isInitializing = true; // Bandera para indicar si la aplicación está en proceso de inicialización
    const conversationsInMemory = new Map(); // Mapa para almacenar conversaciones en memoria
    const conversationsInResponseProcess = new Map(); // Mapa para almacenar conversaciones en proceso de generacion de respuesta
    const conversationInSaveAppointmentProcess = new Map(); // Mapa para almacenar conversaciones en proceso de guardado de cita

    // Iniciamos el cliente de WhatsApp
    let client = new Client({
      authStrategy: new LocalAuth({ clientId: botId }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    // Mostramos QR
    client.on("qr", (qr) => {
      qrcode.generate(qr, { small: true });
      console.log(`📲 [${botName}] Escanea el QR con WhatsApp`);
      if (currentBot) {
        currentBot.connectionState = BotConnectionStates.QR_GENERATED;
        currentBot.qr = qr; // Guardamos el QR en el bot
        const usersToEmit = pendingBotStateRequests.get(botId);
        if (usersToEmit) {
          usersToEmit.users.forEach((user) => {
            user.socket.emit("whatsapp bot state", {
              state: BotConnectionStates.QR_GENERATED,
              userId: user.userId,
              qr,
              botId,
            });
          });
        }
      }
    });

    // Confirmamos conexión
    client.on("ready", () => {
      console.log(`✅ [${botName}] Bot conectado a WhatsApp`);

      if (currentBot) {
        currentBot.connectionState =
          BotConnectionStates.CONNECTED_AND_INITIALIZING;
        const usersToEmit = pendingBotStateRequests.get(botId?.toString?.());
        if (usersToEmit) {
          usersToEmit.users.forEach((user) => {
            user.socket.emit("whatsapp bot state", {
              state: BotConnectionStates.CONNECTED_AND_INITIALIZING,
              userId: user.userId,
              qr: currentBot.qr,
              botId,
            });
          });
        }
      }
      initializeApp(async () => {
        isInitializing = false;
        if (currentBot) {
          manageSendBotMessageFlow({
            botId,
            botName,
            client,
            prompt,
            conversationsInMemory,
            maxMessageCount,
            BotMessageFlow,
            messageFlowQueue,
            executeMessageFlowQueue,
            Conversation,
            Message,
            Contact,
            retrySettings,
            Appointment,
          });
          manageRetryMessages({
            retrySettings,
            Conversation,
            Message,
            Contact,
            openaiClient,
            model,
            client,
            botId: botIdMongoose?.toString?.(),
            botName,
            prompt,
          });
          const invalidCredentialsCallback = async () => {
            console.warn(
              `❌ [${botName}] Refresh token inválido, se eliminarán las credenciales...`
            );
            console.log("botId", botId);
            await BotModel.findByIdAndUpdate(botId, {
              googleAccessToken: null,
              googleRefreshToken: null,
            });
            console.warn(`❌ [${botName}] Credenciales eliminadas`);
          };
          // if (googleRefreshToken) {
          manageAppointmentsAndReminders({
            botId,
            botName,
            Appointment,
            reminders,
            googleRefreshToken,
            invalidCredentialsCallback,
            client,
          });
          // }
          currentBot.connectionState = BotConnectionStates.CONNECTED_AND_READY;
          const usersToEmit = pendingBotStateRequests.get(botId?.toString?.());
          if (usersToEmit) {
            usersToEmit.users.forEach((user) => {
              user.socket.emit("whatsapp bot state", {
                state: BotConnectionStates.CONNECTED_AND_READY,
                userId: user.userId,
                qr: currentBot.qr,
                botId,
              });
            });
          }
          manageMessageToSend({
            botId,
            botName,
            client,
            MessageToSend,
            conversationsInMemory,
            Conversation,
            retrySettings,
          });
        }
      }, botName);
    });

    client.on("message_create", async (msg) => {
      if (isInitializing) {
        console.log(
          `[${botName}] Aplicación en inicialización, ignorando mensajes...`
        );
        return; // Ignorar el mensaje
      }

      // Procesar el mensaje si la aplicación ya está inicializada
      // console.log(`[${botName}] Mensaje recibido de usuario ${msg.from}: `, msg.body);
      const userId = msg.fromMe ? msg.to : msg.from;
      const messageId = msg.id.id;
      const fromMe = msg.fromMe; // Verificamos si el mensaje es del propio bot

      let conversation = await getConversation(
        userId,
        botId,
        conversationsInMemory,
        Conversation
      );
      const conversationInactive =
        (conversation && !conversation.active) ||
        (!conversation && !botConversationDefaultActive); // Bandera para verificar si la conversación está inactiva

      if (
        !fromMe &&
        conversation &&
        msg.hasMedia &&
        airtableBotsEnabled?.includes(botId?.toString?.()) &&
        (!conversationInactive ||
          (conversation.updatedAt &&
            moment.utc().diff(moment.utc(conversation.updatedAt), "minutes") <=
              15))
      ) {
        Promise.resolve().then(async () => {
          try {
            const media = await msg.downloadMedia();
            const mimeType = media.mimetype;
            if (mimeType.startsWith("image/")) {
              const base64Image = `data:${media.mimetype};base64,${media.data}`;
              const contact = await Contact.findOne({
                phone: userId?.split?.("@c.us")?.[0],
                botId: botIdMongoose,
              });

              if (contact) {
                const key = generateUniqueKey(
                  botIdMongoose?.toString?.(),
                  contact?.phone || userId
                );
                const queue = getQueueForKey(key);

                queue
                  .enqueue(async () => {
                    const freshContact =
                      contact ||
                      (await Contact.findOne({
                        phone: userId?.split?.("@c.us")?.[0],
                        botId: botIdMongoose,
                      }));

                    if (!freshContact) return;

                    const leadFounded = await buscarLeadsPorNombreTelefono({
                      nombre: freshContact.name,
                      telefono: freshContact.phone,
                      airtableUserBase:
                          botIdMongoose?.toString?.() ===
                          RECOVER_YOUR_HAIR_BOT_ID
                            ? "recover-your-hair"
                            : "default",
                    });

                    if (leadFounded) {
                      await actualizarLeadAirtableSDK(leadFounded.id, {
                        fotoUrls: [base64Image],
                        airtableUserBase:
                          botIdMongoose?.toString?.() ===
                          RECOVER_YOUR_HAIR_BOT_ID
                            ? "recover-your-hair"
                            : "default",
                      });
                    } else {
                      await crearLeadAirtableSDK({
                        nombre: freshContact.name,
                        telefono: freshContact.phone,
                        descripcion: freshContact.description,
                        fotoUrls: [base64Image],
                        airtableUserBase:
                          botIdMongoose?.toString?.() ===
                          RECOVER_YOUR_HAIR_BOT_ID
                            ? "recover-your-hair"
                            : "default",
                      });
                    }
                  })
                  .finally(() => {
                    cleanupQueue(key);
                  });
              }
            }
          } catch (err) {
            console.error(
              "Error al procesar y guardar la imagen en Airtable",
              err
            );
          }
        });
      }

      if (
        conversationInSaveAppointmentProcess.has(userId) &&
        (!fromMe ||
          !msg.body
            ?.toLowerCase?.()
            ?.includes(appointmentMessageTrigger?.toLowerCase?.()))
      ) {
        console.log(
          `⏳ [${botName}] Conversación ${userId} en proceso de guardado de cita, ignorando mensajes...`
        );
        return; // Ignorar el mensaje
      }

      const userIdIndexInActiveRetryMessages = (
        activeRetryMessages.get(botIdMongoose?.toString()) || []
      ).findIndex((c) => c.userId === userId?.split?.("@c.us")?.[0]);
      if (userIdIndexInActiveRetryMessages !== -1) {
        const retryMessages = activeRetryMessages.get(
          botIdMongoose?.toString()
        )[userIdIndexInActiveRetryMessages];
        if (retryMessages?.timeoutId)
          clearTimeout(
            activeRetryMessages.get(botIdMongoose?.toString())[
              userIdIndexInActiveRetryMessages
            ]?.timeoutId
          );
        activeRetryMessages
          .get(botIdMongoose?.toString())
          ?.splice(userIdIndexInActiveRetryMessages, 1);
      }
      if (
        (conversation && !conversation.active) ||
        (!conversation && !botConversationDefaultActive)
      ) {
        if (!fromMe) return; // Si el mensaje es del usuario y la conversación no está activa, ignoramos el mensaje
        if (
          !messageInitTrigger?.length ||
          !msg.body
            ?.toLowerCase?.()
            ?.startsWith(messageInitTrigger?.toLowerCase?.())
        )
          return; // Si el mensaje no contiene el trigger, ignoramos el mensaje
      } else if (
        conversation?.active &&
        activeMessageManualFinishTrigger &&
        fromMe &&
        msg.body
          ?.toLowerCase?.()
          ?.startsWith(messageManualFinishTrigger?.toLowerCase?.())
      ) {
        // Si el mensaje es del bot y contiene el trigger de finalización manual
        await Conversation.findByIdAndUpdate(conversation._id, {
          active: false,
        });
        conversationsInMemory.delete(userId); // Limpiamos la conversación de memoria
        console.log(
          `✅ [${botName}] Conversación finalizada manualmente ${userId}`
        );
        return;
      } else if (
        conversation?.active &&
        activeAppointmentMessageTrigger &&
        // googleRefreshToken &&
        fromMe &&
        msg.body
          ?.toLowerCase?.()
          ?.includes(appointmentMessageTrigger?.toLowerCase?.())
      ) {
        // Si el mensaje es del bot y contiene el trigger de cita
        // const chatId = redirectPhone + "@c.us";
        // await client.sendMessage(chatId, appointmentMessageResponse);
        const invalidCredentialsCallback = async () => {
          console.warn(
            `❌ [${botName}] Refresh token inválido, se eliminarán las credenciales...`
          );
          console.log("botIdMongoose", botIdMongoose);
          await BotModel.findByIdAndUpdate(botIdMongoose, {
            googleAccessToken: null,
            googleRefreshToken: null,
          });
          console.warn(`❌ [${botName}] Credenciales eliminadas`);
        };
        let contactMessage = await Contact.findOne({
          phone: userId?.split?.("@c.us")?.[0],
          botId: botIdMongoose,
        });
        if (!contactMessage) {
          const msgContact = await msg.getContact();
          if (msgContact)
            contactMessage = {
              name: msgContact.name || msgContact.pushname || "Unknown",
            };
        }
        const savedAppointment = await saveAppointment({
          messageText: msg.body,
          refreshToken: googleRefreshToken,
          model,
          openaiClient,
          invalidCredentialsCallback,
          Appointment,
          botId: botIdMongoose,
          summary: `${botName}@${contactMessage?.name || "Unknown"}-${
            userId?.split?.("@c.us")?.[0]
          }`,
          chatId: userId,
          userName: contactMessage?.name,
          botName,
          conversationId: conversation?._id?.toString(),
        });

        if (
          savedAppointment &&
          airtableBotsEnabled?.includes(botIdMongoose?.toString?.())
        ) {
          if (contactMessage?.name && contactMessage?.phone) {
            const leadFounded = await buscarLeadsPorNombreTelefono({
              nombre: contactMessage.name,
              telefono: contactMessage.phone,
              airtableUserBase:
                  botIdMongoose?.toString?.() === RECOVER_YOUR_HAIR_BOT_ID
                    ? "recover-your-hair"
                    : "default",
            });
            if (leadFounded) {
              await actualizarLeadAirtableSDK(leadFounded.id, {
                fechaPrimeraLlamada: savedAppointment.dateString,
                horaPrimeraLlamada: savedAppointment.timeString,
                airtableUserBase:
                  botIdMongoose?.toString?.() === RECOVER_YOUR_HAIR_BOT_ID
                    ? "recover-your-hair"
                    : "default",
              });
            } else {
              await crearLeadAirtableSDK({
                nombre: contactMessage.name,
                telefono: contactMessage.phone,
                descripcion: contactMessage.description,
                fechaPrimeraLlamada: savedAppointment.dateString,
                horaPrimeraLlamada: savedAppointment.timeString,
                airtableUserBase:
                  botIdMongoose?.toString?.() === RECOVER_YOUR_HAIR_BOT_ID
                    ? "recover-your-hair"
                    : "default",
              });
            }
          }
        }

        if (savedAppointment) {
          const appointments = await Appointment.find({
            botId,
            // scheduled: true,
            start: {
              $gte: new Date(),
            },
          })?.lean?.();
          manageScheduleReminders({
            appointments,
            reminders,
            client,
            botId,
            botName,
            Appointment,
          });
        }

        console.log(
          `✅ [${botName}] Cita guardada a partir del mensaje (${msg.body})`
        );
        conversationsInMemory.delete(userId); // Limpiamos la conversación de memoria
        await Conversation.findByIdAndUpdate(conversation._id, {
          active: false,
        });
        conversationInSaveAppointmentProcess.delete(userId);
        return;
      }

      conversationsInResponseProcess.set(userId, messageId); // Marcar que la conversación está en proceso de respuesta

      try {
        // Detectamos mensajes de texto
        if (msg.hasMedia) {
          const media = await msg.downloadMedia();
          const mimeType = media.mimetype;

          // Procesamos AUDIOS (opus, ogg, mp3, m4a)
          if (mimeType.startsWith("audio/")) {
            console.log(
              `🎙️ [${botName}] Audio recibido. Procesando con Whisper...`
            );
            const transcription = await processAudio(media, openaiClient);
            console.log(`📝 [${botName}] Transcripción:`, transcription);
            if (transcription) {
              const response = await chatWithGPT(
                userId,
                transcription,
                null,
                messageId,
                {
                  model,
                  temperature,
                  openaiClient,
                  maxMessageCount,
                  botId,
                  botName,
                  prompt,
                  delayResponseFrom,
                  delayResponseTo,
                  redirectPhone,
                  messageInitTrigger,
                  messageCompleteRedirectTrigger,
                  messageManualFinishTrigger,
                  messageCompleteResponseFinalizated,
                  activeMessageCompleteRedirectTrigger,
                  activeAutoReset,
                  activeMessagesLimit,
                  messagesLimitCount,
                  autoResetTime,
                  conversationsInResponseProcess,
                  conversationsInMemory,
                  conversationInSaveAppointmentProcess,
                  activeAppointmentMessageTrigger,
                  appointmentMessageTrigger,
                  client,
                  fromMe,
                  conversationInactive,
                  Conversation,
                  Message,
                  Contact,
                  retrySettings,
                  validator,
                  Appointment,
                }
              );
              // await msg.reply(`📝 Transcripción: ${transcription}\n🤖 Respuesta: ${response}`);
              if (response) await msg.reply(`${response}`);
              if (response)
                console.log(
                  `🤖 [${botName}] Respuesta al usuario ${userId}: ${response}`
                );
            } else {
              // await msg.reply("❌ No se pudo transcribir el audio.");
            }

            // Procesamos IMÁGENES
          } else if (mimeType.startsWith("image/")) {
            // await msg.reply(
            //   `⚠️ Procesamiento de imágenes deshabilitado temporalmente.`
            // );
            console.log("🖼️ Imagen recibida. Analizando con GPT-4o...");
            const base64Image = `data:${media.mimetype};base64,${media.data}`;
            const response = await chatWithGPT(
              userId,
              media?.body || "",
              base64Image,
              messageId,
              {
                model,
                temperature,
                openaiClient,
                maxMessageCount,
                botId,
                botName,
                prompt,
                delayResponseFrom,
                delayResponseTo,
                redirectPhone,
                messageInitTrigger,
                messageCompleteRedirectTrigger,
                messageManualFinishTrigger,
                messageCompleteResponseFinalizated,
                activeMessageCompleteRedirectTrigger,
                activeAutoReset,
                activeMessagesLimit,
                messagesLimitCount,
                autoResetTime,
                conversationsInResponseProcess,
                conversationsInMemory,
                conversationInSaveAppointmentProcess,
                activeAppointmentMessageTrigger,
                appointmentMessageTrigger,
                client,
                fromMe,
                conversationInactive,
                Conversation,
                Message,
                Contact,
                retrySettings,
                validator,
                Appointment,
              }
            );

            if (response) await msg.reply(`${response}`);
            // Generando descripcion de la imagen, omitien la imagen y usandola en el contexto
            //
            // const description = await processImage(base64Image, openaiClient);
            // console.log(`📝 Descripción de la imagen:`, description);
            // if (description) {
            //   await chatWithGPT(userId, description, null, messageId, {
            //     model,
            //     temperature,
            //     openaiClient,
            //     maxMessageCount,
            //     botId,
            //     botName,
            //     prompt,
            //     delayResponseFrom,
            //     delayResponseTo,
            //     redirectPhone,
            //     messageInitTrigger,
            //     messageCompleteRedirectTrigger,
            //     messageCompleteResponseFinalizated,
            //     activeMessageCompleteRedirectTrigger,
            //     activeAutoReset,
            //     autoResetTime,
            //     conversationsInResponseProcess,
            //     conversationsInMemory,
            //     client,
            //     fromMe: true,
            //     conversationInactive,
            //   });
            //   const response = await chatWithGPT(
            //     userId,
            //     "Te he enviado la imagen",
            //     null,
            //     messageId,
            //     {
            //       model,
            //       temperature,
            //       openaiClient,
            //       maxMessageCount,
            //       botId,
            //       botName,
            //       prompt,
            //       delayResponseFrom,
            //       delayResponseTo,
            //       redirectPhone,
            //       messageInitTrigger,
            //       messageCompleteRedirectTrigger,
            //       messageCompleteResponseFinalizated,
            //       activeMessageCompleteRedirectTrigger,
            //       activeAutoReset,
            //       autoResetTime,
            //       conversationsInResponseProcess,
            //       conversationsInMemory,
            //       client,
            //       fromMe,
            //       conversationInactive,
            //     }
            //   );
            //  await msg.reply(`${response}`);
            // } else {
            //   // await msg.reply('❌ No se pudo analizar la imagen.');
            // }
          } else {
            // await msg.reply(`⚠️ Tipo de archivo no soportado.`);
          }
        } else {
          // Procesamos TEXTO
          console.log(
            `💬 [${botName}] Mensaje recibido de usuario ${userId}: ${msg.body}`
          );
          const response = await chatWithGPT(
            userId,
            msg.body,
            null,
            messageId,
            {
              model,
              temperature,
              openaiClient,
              maxMessageCount,
              botId,
              botName,
              prompt,
              delayResponseFrom,
              delayResponseTo,
              redirectPhone,
              messageInitTrigger,
              messageCompleteRedirectTrigger,
              messageManualFinishTrigger,
              messageCompleteResponseFinalizated,
              activeMessageCompleteRedirectTrigger,
              activeAutoReset,
              activeMessagesLimit,
              messagesLimitCount,
              autoResetTime,
              conversationsInResponseProcess,
              conversationsInMemory,
              conversationInSaveAppointmentProcess,
              activeAppointmentMessageTrigger,
              appointmentMessageTrigger,
              client,
              fromMe,
              conversationInactive,
              Conversation,
              Message,
              Contact,
              retrySettings,
              validator,
              Appointment,
            }
          );
          if (response)
            console.log(
              `🤖 [${botName}] Respuesta al usuario ${userId}: ${response}`
            );
          if (response) {
            if (msg.fromMe) {
              // 👤 Bot envió el mensaje original, respondemos sin quote
              await client.sendMessage(msg.to, response);
            } else {
              // 👥 Usuario envió el mensaje, respondemos con quote
              await msg.reply(response);
            }
          }
        }
      } catch (error) {
        console.error(
          `🚨 Error en chat con usuario ${msg.from}: ${error.message}`
        );
        // await msg.reply("❌ Ocurrió un error al procesar tu mensaje.");
      }
    });

    client.on("disconnected", (reason) => {
      console.log("Cliente desconectado:", reason);

      // Verificar si la desconexión fue por desvinculación manual
      if (["unpaired", "logout"].includes(reason.toLowerCase())) {
        console.log("El dispositivo fue desvinculado desde el teléfono");

        // Eliminar la sesión anterior
        deleteSession(botId);

        if (currentBot) {
          currentBot.connectionState = BotConnectionStates.DISCONNECTED;
          const usersToEmit = pendingBotStateRequests.get(botId);
          if (usersToEmit) {
            usersToEmit.users.forEach((user) => {
              user.socket.emit("whatsapp bot state", {
                state: BotConnectionStates.DISCONNECTED,
                userId: user.userId,
                qr: null,
                botId,
              });
            });
          }
        }
      }
    });

    try {
      await client.initialize();
      return {
        client,
        conversationsInMemory,
        activeReminders,
        activeRetryMessages,
      };
    } catch (err) {
      console.error("Error al inicializar el cliente:", err);
      await client
        ?.destroy()
        .catch((e) => console.log("Error al destruir cliente:", e));
      // Limpiar recursos y reintentar o salir
      deleteSession(botId); // Limpiar sesión anterior
      console.log(
        `Reintentando inicialización en 5 segundos... (${
          attemps + 1
        }/${maxAttemps})`
      );
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Esperar 5 segundos antes de reintentar
      return await initializeWhatsAppClient({
        botId: botIdMongoose,
        botName,
        openaiClient,
        model,
        temperature,
        maxMessageCount,
        delayResponseFrom,
        delayResponseTo,
        prompt,
        redirectPhone,
        messageInitTrigger,
        botConversationDefaultActive,
        messageManualFinishTrigger,
        activeMessageManualFinishTrigger,
        messageCompleteRedirectTrigger,
        messageCompleteResponseFinalizated,
        activeMessageCompleteRedirectTrigger,
        appointmentMessageTrigger,
        activeAppointmentMessageTrigger,
        appointmentMessageResponse,
        googleRefreshToken,
        reminders,
        retrySettings,
        validator,
        activeAutoReset,
        activeMessagesLimit,
        messagesLimitCount,
        autoResetTime,
        bot: currentBot,
        pendingBotStateRequests,
        attemps: attemps + 1,
        maxAttemps,
        BotModel,
        Appointment,
        Contact,
        Conversation,
        Message,
        MessageToSend,
      });
    }
  } catch (err) {
    console.log(err);
  }
};

async function initializeApp(setIsInitialized, botName) {
  console.log(`[${botName}] Inicializando aplicación...`);

  // Simula algún proceso de inicialización, como la carga de la base de datos, etc.
  await new Promise((resolve) => setTimeout(resolve, 60000)); // Espera 60 segundos (simulación)

  // Marcar como inicializada
  setIsInitialized?.();

  console.log(
    `[${botName}] Aplicación inicializada y lista para recibir mensajes.`
  );
}

async function saveMessage(
  userId,
  role,
  content,
  imageContent,
  messageId,
  {
    botId,
    prompt,
    conversationsInMemory,
    maxMessageCount,
    messageInitTrigger,
    botConversationDefaultActive,
    openaiClient,
    Conversation,
    Message,
    retrySettings,
    Contact,
    Appointment,
  }
) {
  console.log(`[${botId}] Guardando mensaje de ${role} (${userId}):`, content);
  const contactUser = await Contact.findOne({
    phone: userId.split("@c.us")[0],
    botId,
  }).lean();
  const contactVariables = contactUser
    ? {
        nombre: contactUser.name,
        telefono: contactUser.phone,
        email: contactUser.email,
        descripcion: contactUser.description,
      }
    : null;
  // Verificamos si la conversación ya está en memoria
  let conversationInMemory = conversationsInMemory.get(userId);
  // console.log(`[${botId}] Conversación en memoria:`, conversationInMemory);
  if (
    conversationInMemory?.finalizedDate &&
    conversationInMemory.finalizedDate < new Date()
  ) {
    // Si la conversación ha sido finalizada, la eliminamos de memoria
    conversationsInMemory.delete(userId);
    const conversationDb = await Conversation.findOne({
      userId,
      botId,
      active: true,
    });
    manageExpiredConversations(conversationDb, Conversation);
  }

  if (conversationInMemory)
    await compareAndUpdatePrompt({
      conversationInMemory,
      prompt,
      conversationId: conversationInMemory._id,
      Conversation,
      Message,
    });

  if (!conversationInMemory) {
    // Si no está en memoria, buscamos la conversación en la base de datos
    let conversation = await Conversation.findOne({
      userId,
      botId,
      active: true,
    });
    const isExpired = await manageExpiredConversations(
      conversation,
      Conversation
    );
    if (isExpired) conversation = null;

    if (!conversation) {
      // Si no existe en la base de datos, creamos una nueva conversación
      conversation = new Conversation({
        userId,
        botId,
        retryMesagesActive: !!retrySettings?.active,
      });
      await conversation.save(); // Guardamos la conversación en la base de datos

      const messageToSave = new Message({
        role: "system",
        content: prompt,
        conversationId: conversation._id, // Asociamos el mensaje con la conversación
        userId,
      });

      messageToSave.save();
      conversationInMemory = { ...conversation.toObject(), messages: [] }; // Convertimos el documento en objeto
      conversationInMemory.messages.push(messageToSave); // Añadimos el mensaje a la conversación en memoria
    } else {
      conversationInMemory = { ...conversation.toObject() }; // Convertimos el documento en objeto
      const conversationMessages = await Message.find({
        conversationId: conversation._id,
      })
        .limit(maxMessageCount)
        .sort({ createdAt: -1 })
        .lean();

      conversationInMemory.messages = (conversationMessages || []).reverse(); // Añadimos los mensajes a la conversación en memoria
    }

    await compareAndUpdatePrompt({
      conversationInMemory,
      prompt,
      conversationId: conversation._id,
      Conversation,
      Message,
    });

    // Cargamos la conversación en memoria
    conversationsInMemory.set(userId, conversationInMemory);
  }

  const messageImageAssistant = imageContent
    ? `Envié una imagen. ${content}`
    : content;

  // Creamos el nuevo mensaje
  const message = {
    role,
    content: messageImageAssistant,
    conversationId: conversationInMemory._id,
    userId,
    messageId,
  };

  // Añadimos el mensaje a la conversación en memoria
  if (!conversationInMemory?.messages) conversationInMemory.messages = [];
  conversationInMemory.messages.push(message);

  const messageToSave = new Message(message);
  messageToSave.save();

  let messageImageDescriptionSaved;
  if (imageContent) {
    const imageDescription = await processImage(imageContent, openaiClient);
    if (imageDescription) {
      const messageDescriptionToSave = {
        role: "assistant",
        content: `El usuario envió una imágen para analizar y esta es la descripción luego de analizar la imágen: ${imageDescription}`,
        conversationId: conversationInMemory._id,
        userId,
        messageId,
      };

      // Añadimos el mensaje a la conversación en memoria
      if (!conversationInMemory?.messages) conversationInMemory.messages = [];
      conversationInMemory.messages.push(messageDescriptionToSave);

      const newMessageToSave = new Message(messageDescriptionToSave);
      messageImageDescriptionSaved = await newMessageToSave.save();
    } else {
      console.error("❌ Error al procesar la imagen");
    }
  }

  // Retornamos los últimos 20 mensajes de la conversación

  let conversationContext = conversationInMemory.messages.slice(
    -maxMessageCount
  );
  const systemMessageIndex = conversationContext.findIndex(
    (m) => m.role === "system"
  );
  const unavailableSlots = await getUnavailableSlots({ Appointment, botId });

  if (systemMessageIndex === -1) {
    conversationContext.unshift({
      role: "system",
      content: replaceVariablesInPrompt(
        prompt,
        contactVariables,
        unavailableSlots
      ),
    });
  } else {
    conversationContext[systemMessageIndex].content = replaceVariablesInPrompt(
      prompt,
      contactVariables,
      unavailableSlots
    ); // Actualizamos el mensaje de sistema con el nuevo prompt
    // muevo el mensaje de sistema al inicio
    const systemMessage = conversationContext.splice(systemMessageIndex, 1)[0];
    conversationContext.unshift(systemMessage);
  }

  if (imageContent) {
    conversationContext = conversationContext.slice(
      0,
      conversationContext.length - (messageImageDescriptionSaved ? 2 : 1)
    ); // Eliminamos el último mensaje (el de la imagen) para evitar duplicados
    conversationContext.push({
      role: "user",
      content: [
        { type: "input_text", text: content },
        { type: "input_image", image_url: imageContent },
      ],
    });
  }

  return {
    currentConversation: conversationContext.map((c) => ({
      role: c.role,
      content: c.content,
    })),
    finalizedDate: conversationInMemory.finalizedDate,
  };
}

// Manejamos mensajes entrantes

// 🔊 Función para procesar audios con Whisper
async function processAudio(media, openaiClient) {
  const audioPath = `./temp/audio.${mime.extension(media.mimetype)}`;
  fs.writeFileSync(audioPath, Buffer.from(media.data, "base64"));

  try {
    const transcription = await openaiClient.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      language: "es",
    });
    return transcription.text;
  } catch (error) {
    console.error("❌ Error en Whisper:", error.message);
    return null;
  } finally {
    fs.unlinkSync(audioPath); // Limpiar archivo temporal
  }
}

// 🖼️ Función para procesar imágenes con GPT-4o Vision
async function processImage(base64Image, openaiClient) {
  // const imagePath = `./temp/image.${mime.extension(media.mimetype)}`;
  // fs.writeFileSync(imagePath, Buffer.from(media.data, 'base64'));

  try {
    const visionResponse = await openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Actúa como un experto en análisis visual.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe detalladamente lo que ves en esta imagen.",
            },
            {
              type: "image_url",
              image_url: {
                url: base64Image,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });
    return visionResponse.choices[0]?.message?.content;
  } catch (error) {
    console.error("❌ Error en GPT-4o Vision:", error.message);
    return null;
  } finally {
    // fs.unlinkSync(imagePath); // Limpiar archivo temporal
  }
}

// 💬 Función para enviar texto a GPT-4o
async function chatWithGPT(
  userId,
  userMessage,
  userImageMessage,
  messageId,
  {
    model,
    temperature,
    openaiClient,
    maxMessageCount,
    delayResponseFrom,
    delayResponseTo,
    botId,
    botName,
    prompt,
    redirectPhone,
    botConversationDefaultActive,
    messageInitTrigger,
    messageCompleteRedirectTrigger,
    messageManualFinishTrigger,
    messageCompleteResponseFinalizated,
    activeMessageCompleteRedirectTrigger,
    activeAutoReset,
    activeMessagesLimit,
    messagesLimitCount,
    autoResetTime,
    conversationsInResponseProcess,
    conversationsInMemory,
    conversationInSaveAppointmentProcess,
    activeAppointmentMessageTrigger,
    appointmentMessageTrigger,
    client,
    fromMe,
    conversationInactive,
    Conversation,
    Message,
    Contact,
    retrySettings,
    validator,
    Appointment,
  }
) {
  // if (
  //   !fromMe &&
  //   userImageMessage &&
  //   airtableBotsEnabled?.includes(botId?.toString?.())
  // ) {
  //   const contact = await Contact.findOne({
  //     phone: userId.split("@c.us")[0],
  //     botId,
  //   }).lean();

  //   if (contact) {
  //     const leadFounded = await buscarLeadsPorNombreTelefono({
  //       nombre: contact.name,
  //       telefono: contact.phone,
  //     });
  //     if (leadFounded) {
  //       await actualizarLeadAirtableSDK(leadFounded.id, {
  //         fotoUrls: [userImageMessage],
  //       });
  //     } else {
  //       await crearLeadAirtableSDK({
  //         nombre: contact.name,
  //         telefono: contact.phone,
  //         fotoUrls: [userImageMessage],
  //       });
  //     }
  //   }
  // }
  // Guardamos el mensaje del usuario y obtenemos la conversación actual
  const { currentConversation, finalizedDate } = await saveMessage(
    userId,
    fromMe ? "assistant" : "user",
    userMessage,
    userImageMessage,
    messageId,
    {
      botId,
      prompt,
      conversationsInMemory,
      maxMessageCount,
      openaiClient,
      Conversation,
      Message,
      retrySettings,
      Contact,
      Appointment,
    }
  );

  const isMessageInitTrigger =
    conversationInactive &&
    userMessage
      ?.toLowerCase?.()
      ?.startsWith(messageInitTrigger?.toLowerCase?.());
  if (fromMe && !isMessageInitTrigger) return; // Si el mensaje es del bot, existe initTrigger y no es initTrigger no procesamos el mensaje

  // Verificamos si la conversación ha sido finalizada
  if (finalizedDate) {
    const chatId =
      normalizeSpanishPhone(`${redirectPhone}`?.replace(/\D/g, "")) + "@c.us";

    client
      .sendMessage(chatId, userMessage)
      .then(() =>
        console.log(`[${botName}] 📤 Mensaje reenviado:`, userMessage)
      )
      .catch((err) =>
        console.error(
          `[${botName}] ❌ Error al reenviar mensaje: "${userMessage}" (${err})`
        )
      );

    return messageCompleteResponseFinalizated;
  }

  try {
    // Esperamos el tiempo de respuesta antes de enviar el mensaje
    if (!fromMe)
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          generarIntervaloAleatorio(delayResponseFrom, delayResponseTo) * 1000
        )
      ); // Esperamos el tiempo de respuesta antes de enviar el mensaje
    // Verificamos si la conversación está en proceso de respuesta
    if (
      isConversationInResponseProcess({
        userId,
        messageId,
        conversationsInResponseProcess,
      })
    )
      return null;

    console.log("currentConversation", JSON.stringify(currentConversation[0]));

    // Generamos respuesta con ia
    const chatResponse = await openaiClient.responses.create({
      ...(userImageMessage
        ? { model: "gpt-4o" }
        : getModelAndParams(model, temperature)),
      input: currentConversation,
      // temperature,
      // max_tokens: 4096,
      // top_p: 1
    });

    if (
      isConversationInResponseProcess({
        userId,
        messageId,
        conversationsInResponseProcess,
      })
    )
      return null;

    let botMessage = chatResponse?.output_text?.trim();

    if (validator?.active) {
      const contact = await Contact.findOne({
        phone: userId.split("@c.us")[0],
        botId,
      }).lean();

      if (
        isConversationInResponseProcess({
          userId,
          messageId,
          conversationsInResponseProcess,
        })
      )
        return null;

      const validateResult = await validateResponse({
        openaiClient,
        modelParams: userImageMessage
          ? { model: "gpt-4o" }
          : getModelAndParams(model, temperature),
        messages: [
          ...(currentConversation.length > 5 ? [currentConversation[0]] : []),
          ...currentConversation.slice(-5),
        ],
        validator,
        contact: contact || { phone: userId.split("@c.us")[0] },
        lastMessage: chatResponse?.output_text?.trim(),
        whatsappClient: client,
        botId,
        Appointment,
        generateResponse: async (validatorResponse) =>
          openaiClient.responses.create({
            ...(userImageMessage
              ? { model: "gpt-4o" }
              : getModelAndParams(model, temperature)),
            input: [
              {
                ...currentConversation[0],
                content: `${currentConversation[0]?.content} \n\n ${validatorResponse}`,
              },
              ...currentConversation.slice(1),
            ],
            // temperature,
            // max_tokens: 4096,
            // top_p: 1
          }),
        isConversationInResponseProcess: () =>
          isConversationInResponseProcess({
            userId,
            messageId,
            conversationsInResponseProcess,
          }),
      });
      if (validateResult?.ok && validateResult?.newResponse) {
        botMessage = validateResult.newResponse;
      }
      if (!validateResult?.ok) return null;
    }

    if (
      conversationsInResponseProcess.has(userId) &&
      conversationsInResponseProcess.get(userId) !== messageId
    ) {
      return null;
    }
    // Guardamos la respuesta del bot
    await saveMessage(userId, "assistant", botMessage, null, null, {
      botId,
      prompt,
      conversationsInMemory,
      maxMessageCount,
      openaiClient,
      Conversation,
      Message,
      Contact,
      retrySettings,
      Appointment,
    });

    if (
      conversationsInResponseProcess.has(userId) &&
      conversationsInResponseProcess.get(userId) !== messageId
    ) {
      return null;
    }

    if (
      conversationsInMemory.get(userId) &&
      activeAppointmentMessageTrigger &&
      // googleRefreshToken &&
      botMessage
        ?.toLowerCase?.()
        ?.includes(appointmentMessageTrigger?.toLowerCase?.())
    ) {
      console.log(
        `[${botName}]💬 Iniciando proceso de guardado de cita para el número ${userId}...`
      );
      conversationInSaveAppointmentProcess.set(userId, true);
      return botMessage;
    }

    if (
      activeMessageCompleteRedirectTrigger &&
      botMessage
        ?.toLowerCase?.()
        ?.includes(messageCompleteRedirectTrigger?.toLowerCase?.()) &&
      conversationsInMemory.get(userId)
    ) {
      // Verificamos si el mensaje contiene el trigger (no case sensitive)
      await saveMessage(
        userId,
        "assistant",
        messageCompleteResponseFinalizated,
        null,
        null,
        {
          botId,
          prompt,
          conversationsInMemory,
          maxMessageCount,
          openaiClient,
          Conversation,
          Message,
          Contact,
          retrySettings,
          Appointment,
        }
      );

      const indexOf = botMessage
        .toLowerCase()
        .indexOf(messageCompleteRedirectTrigger.toLowerCase());
      const orderDetails = botMessage.substring(indexOf);
      console.log(`[${botName}] Reenviando datos`, orderDetails);

      // Convertir el número en ID de WhatsApp
      const chatId =
        normalizeSpanishPhone(`${redirectPhone}`.replace(/\D/g, "")) + "@c.us";
      client
        .sendMessage(
          chatId,
          `[${userId?.split?.("@c.us")?.[0]}] ` + orderDetails
        )
        .then(() =>
          console.log(`📤 [${botName}] Mensaje reenviado:`, orderDetails)
        )
        .catch((err) =>
          console.error(
            `❌ Error al reenviar mensaje: "${orderDetails}" (${err})`
          )
        );

      let conversationInMemory = conversationsInMemory.get(userId);

      if (activeAutoReset) {
        // Establecer fecha finalizacion despues de 3 horas
        const finalizedDate = new Date(
          Date.now() + autoResetTime * 60 * 60 * 1000
        ); // autoResetTime en horas
        conversationInMemory.finalizedDate = finalizedDate;
        const conversationDb = await Conversation.updateOne(
          { userId, botId, active: true },
          { finalizedDate }
        );
        if (conversationDb) {
          console.log(
            `✅ [${botName}] Conversación actualizada en la base de datos`
          );
        } else {
          console.error(
            `❌ [${botName}] Error al actualizar la conversación en la base de datos`
          );
        }
      }

      return messageCompleteResponseFinalizated;
    }

    if (activeMessagesLimit && messagesLimitCount > 0) {
      // Verificamos si la conversación ha alcanzado el límite de mensajes
      const conversationInMemory = await getConversation(
        userId,
        botId,
        conversationsInMemory
      );
      const conversationMessages = (
        conversationInMemory?.messages || []
      ).filter(
        (m) =>
          m.role === "assistant" &&
          !m.content?.startsWith?.(
            "El usuario envió una imágen para analizar y esta es la descripción luego de analizar la imágen: "
          ) &&
          !m.content
            ?.toLowerCase?.()
            .startsWith?.(messageInitTrigger?.toLowerCase?.())
      );
      if (
        conversationInMemory &&
        conversationMessages.length >= messagesLimitCount
      ) {
        // Si se ha alcanzado el límite, finalizamos la conversación
        await Conversation.updateOne(
          { userId, botId, active: true },
          { active: false }
        );
        conversationsInMemory.delete(userId); // Limpiamos la conversación de memoria
        console.log(
          `✅ [${botName} (usuario: ${
            userId?.split?.("@c.us")?.[0]
          })] Conversación finalizada por límite de mensajes (${messagesLimitCount})`
        );
        return botMessage;
      }
    }
    return botMessage;
  } catch (error) {
    console.error(`❌ [${botName}] Error en GPT-4o:`, error.message);
    return null;
    // return `❌ Ocurrió un error al consultar a la IA.`;
  }
}

async function manageExpiredConversations(conversation, Conversation) {
  if (conversation) {
    if (conversation.finalizedDate && conversation.finalizedDate < new Date()) {
      // Si la conversación ha sido finalizada, la eliminamos de base de datos
      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { active: false, finalizedDate: null } }
      );
      return true; // Conversación eliminada
    }

    return false; // Conversación activa
  }
}

async function getConversation(
  userId,
  botId,
  conversationsInMemory,
  Conversation
) {
  let conversationInMemory = conversationsInMemory.get(userId);
  if (conversationInMemory) {
    // Si la conversación está en memoria, la retornamos
    return conversationInMemory;
  }

  // Si no está en memoria, buscamos la conversación en la base de datos que se haya actualizado recientemente
  const conversation = await Conversation.findOne({
    userId,
    botId,
  })
    .sort({ updatedAt: -1 })
    .lean();

  return conversation;
}

async function manageMessageToSend({
  MessageToSend,
  botId,
  botName,
  client,
  conversationsInMemory,
  Conversation,
  retrySettings,
}) {
  const messageToSendArray = await MessageToSend.find({
    botId,
  })
    .populate("contactId")
    .lean();

  if (!messageToSendArray?.length) return;
  try {
    for (const messageToSend of messageToSendArray) {
      if (
        !messageToSend?.contactId?.phone ||
        !messageToSend?.content ||
        !messageToSend?.botId
      ) {
        console.warn(
          `⚠️ [${botName}] Mensaje pendiente incompleto, omitiendo:`,
          messageToSend
        );
        continue;
      }
      console.log(
        `⏳ [${botName}] Enviando mensaje pendiente a ${messageToSend.contactId?.phone}:`,
        messageToSend.content
      );
      await sendMessageToSend({
        messageToSend,
        client,
        botName,
        conversationsInMemory,
        Conversation,
        retrySettings,
      });
      // Eliminamos el mensaje enviado
      await MessageToSend.deleteOne({ _id: messageToSend._id });
    }
  } catch (error) {
    console.error(
      `❌ [${botName}] Error al enviar mensaje a ${chatId}:`,
      error.message
    );
  }
}

async function sendMessageToSend({
  messageToSend,
  client,
  botName,
  conversationsInMemory,
  Conversation,
  retrySettings,
}) {
  if (!messageToSend) return;

  const { botId, content, contactId } = messageToSend;

  try {
    // Verificamos si el contacto existe en memoria
    const chatId =
      normalizeSpanishPhone(`${contactId.phone}`.replace(/\D/g, "")) + "@c.us"; // Convertimos el número en ID de WhatsApp
    let conversationInMemory = conversationsInMemory.get(chatId);
    if (!conversationInMemory) {
      // Si no está en memoria, buscamos la conversación en la base de datos
      conversationInMemory = await Conversation.findOne({
        userId: chatId,
        botId,
        active: true,
      });
      if (!conversationInMemory) {
        const conversation = new Conversation({
          userId: chatId,
          botId,
          retryMesagesActive: !!retrySettings?.active,
        });
        await conversation.save();
        conversationInMemory = conversationsInMemory.set(chatId, {
          ...conversation.toObject(),
          messages: [],
        });
      }
    }
    await client.sendMessage(chatId, content);
    console.log(`📤 [${botName}] Mensaje enviado a ${chatId}: ${content}`);
  } catch (error) {
    console.error(
      `❌ [${botName}] Error al enviar mensaje a ${chatId}:`,
      error.message
    );
  }
}

async function manageSendBotMessageFlow({
  botId,
  botName,
  client,
  prompt,
  conversationsInMemory,
  maxMessageCount,
  BotMessageFlow,
  messageFlowQueue,
  executeMessageFlowQueue,
  Conversation,
  Message,
  Contact,
  retrySettings,
  Appointment,
}) {
  if (messageFlowQueue.has(botId?.toString?.())) {
    messageFlowQueue.get(botId?.toString?.()).push(() =>
      sendBotMessageFlow({
        botId,
        botName,
        client,
        prompt,
        conversationsInMemory,
        maxMessageCount,
        BotMessageFlow,
        Conversation,
        Message,
        Contact,
        retrySettings,
        Appointment,
      })
    );
  } else {
    messageFlowQueue.set(botId?.toString?.(), []);
    messageFlowQueue.get(botId?.toString?.()).push(() =>
      sendBotMessageFlow({
        botId,
        botName,
        client,
        prompt,
        conversationsInMemory,
        maxMessageCount,
        BotMessageFlow,
        Conversation,
        Message,
        Contact,
        retrySettings,
        Appointment,
      })
    );
  }
  executeMessageFlowQueue?.();
}

async function sendBotMessageFlow({
  botId,
  botName,
  client,
  prompt,
  conversationsInMemory,
  maxMessageCount,
  BotMessageFlow,
  Conversation,
  Message,
  Contact,
  retrySettings,
  Appointment,
}) {
  const botMessageFlows = await BotMessageFlow.find({ botId })
    .populate("contacts")
    .populate("messageFlow")
    .populate("botId")
    .lean();
  if (botMessageFlows.length > 0) {
    console.log(
      `⏳ [${botName}] Esperando 10 segundos antes de enviar mensajes a los contactos...`
    );
    await new Promise((resolve) => setTimeout(resolve, 10 * 1000)); // Esperamos 1 minuto antes de enviar mensajes a los contactos
    for await (const botMessageFlow of botMessageFlows || []) {
      const { initialDripFrom, initialDripTo } = botMessageFlow;
      for await (const contact of botMessageFlow?.contacts || []) {
        if (
          !botMessageFlow.messagedContacts?.includes(contact._id?.toString())
        ) {
          try {
            const chatId =
              normalizeSpanishPhone(`${contact.phone}`.replace(/\D/g, "")) +
              "@c.us";
            const botMessageFlowUpdated = await BotMessageFlow.findOne({
              _id: botMessageFlow._id,
            })
              .populate("messageFlow")
              .lean();
            for await (const [index, flowMessage] of (
              botMessageFlowUpdated?.messageFlow?.messages ||
              botMessageFlow?.messageFlow?.messages ||
              []
            ).entries()) {
              if (
                flowMessage?.text?.length &&
                !botMessageFlow.messageSent?.some(
                  (msg) =>
                    msg.contactId?.toString() === contact._id?.toString() &&
                    (msg.messageFlow || [])?.some(
                      (m) => m === flowMessage._id?.toString()
                    )
                )
              ) {
                const { delayBeforeFrom, delayBeforeTo } = flowMessage;
                const randomInterval = generarIntervaloAleatorio(
                  delayBeforeFrom,
                  delayBeforeTo
                );
                let flowMessageText = flowMessage.text
                  .replaceAll("{nombre}", contact.name)
                  .replaceAll("{telefono}", contact.phone)
                  .replaceAll("{email}", contact.email)
                  .replaceAll("{descripcion}", contact.description);
                console.log(
                  `📤 Enviando mensaje a ${contact.name} (${contact.phone}), "${flowMessageText}"`
                );
                // Enviamos el mensaje al contacto
                await client.sendMessage(chatId, flowMessageText);
                await saveMessage(
                  chatId,
                  "assistant",
                  flowMessageText,
                  null,
                  null,
                  {
                    botId,
                    prompt,
                    conversationsInMemory,
                    maxMessageCount,
                    openaiClient: null,
                    Conversation,
                    Message,
                    Contact,
                    retrySettings,
                    Appointment,
                  }
                );
                // Guardamos el mensaje enviado en el flujo
                await BotMessageFlow.updateOne(
                  {
                    _id: botMessageFlow._id,
                    "messageSent.contactId": contact._id,
                  },
                  {
                    $addToSet: {
                      "messageSent.$.messageFlow": flowMessage._id.toString(),
                    },
                  }
                ).then(async (res) => {
                  if (res.matchedCount === 0) {
                    // No existía el contactId, lo agregamos
                    await BotMessageFlow.updateOne(
                      { _id: botMessageFlow._id },
                      {
                        $push: {
                          messageSent: {
                            contactId: contact._id,
                            messageFlow: [flowMessage._id.toString()],
                          },
                        },
                      }
                    );
                  }
                });
                console.log(
                  `📤 Mensaje enviado a ${contact.name} (${contact.phone})`
                );
                console.log(
                  `⏳ [${botName}] Esperando ${randomInterval} minutos antes de enviar proximo mensaje...`
                );
                if (index < botMessageFlow?.messageFlow?.messages?.length - 1) {
                  // Si no es el último mensaje, esperamos el intervalo aleatorio
                  await new Promise((resolve) =>
                    setTimeout(resolve, randomInterval * 60 * 1000)
                  ); // Esperamos el intervalo aleatorio
                }
              }
            }
            await BotMessageFlow.updateOne(
              { _id: botMessageFlow._id },
              { $push: { messagedContacts: contact._id?.toString() } }
            );
            const interval = generarIntervaloAleatorio(
              initialDripFrom,
              initialDripTo
            );
            console.log(
              `⏳ [${botName}] Esperando ${interval} minutos para enviar mensajes al próximo contacto...`
            );
            // Esperamos el intervalo aleatorio antes de enviar el mensaje
            await new Promise((resolve) =>
              setTimeout(resolve, interval * 60 * 1000)
            ); // Goteo inicial
          } catch (error) {
            console.error(
              `❌ [${botName}] Error al enviar mensaje a ${contact.name} (${contact.phone}): ${error.message}`
            );
          }
        }
      }
    }
  }
}

async function compareAndUpdatePrompt({
  conversationInMemory,
  prompt,
  conversationId,
  Conversation,
  Message,
}) {
  const messagePrompt =
    conversationInMemory.messages.find((m) => m.role === "system") ||
    (await Message.findOne({
      conversationId,
      role: "system",
    })
      .sort({ createdAt: -1 })
      .lean());

  if (messagePrompt && messagePrompt.content !== prompt) {
    // Si el mensaje de sistema no coincide con el prompt, lo actualizamos
    await Message.updateOne({ _id: messagePrompt._id }, { content: prompt });
    const messagePromptInMemoryIndex = conversationInMemory.messages.findIndex(
      (m) => m.role === "system"
    );
    if (messagePromptInMemoryIndex !== -1) {
      conversationInMemory.messages[messagePromptInMemoryIndex].content =
        prompt;
    }
  }
}

function generarIntervaloAleatorio(desde, hasta) {
  if (desde > hasta) {
    return Math.floor(Math.random() * (hasta - (hasta - 1) + 1)) + hasta - 1;
  }

  return Math.floor(Math.random() * (hasta - desde + 1)) + desde;
}

async function managePendingAppointments({
  botId,
  botName,
  Appointment,
  googleRefreshToken,
  invalidCredentialsCallback,
}) {
  const appointments = await Appointment.find({
    botId,
    scheduled: false,
  }).lean();

  if (appointments.length === 0) {
    console.log(`🗓️ [${botName}] No hay citas pendientes.`);
    return;
  }

  console.log(
    `🗓️ [${botName}] Encontradas ${appointments.length} citas pendientes.`
  );

  for (const appointment of appointments) {
    try {
      const { summary, description } = appointment;
      const start = `${appointment.dateString}T${appointment.timeString}:00`;
      const end = moment(
        `${appointment.dateString} ${appointment.timeString}`,
        "YYYY-MM-DD HH:mm"
      )
        .add(30, "minutes")
        .format("YYYY-MM-DD[T]HH:mm:00");
      const saveGoogleCalendarResponse = await saveGoogleCalendarDate({
        refreshToken: googleRefreshToken,
        summary,
        description,
        start,
        end,
        invalidCredentialsCallback,
        botName,
      });

      if (saveGoogleCalendarResponse) {
        console.log(
          `✅ [${botName}] Cita guardada correctamente: ${saveGoogleCalendarResponse?._id}`
        );
        await Appointment.updateOne(
          { _id: appointment._id },
          {
            scheduled: true,
            googleEventId: saveGoogleCalendarResponse?.id || null,
          }
        )
          .then(() => {
            console.log(
              `✅ [${botName}] Cita actualizada en la base de datos: ${appointment._id}`
            );
          })
          .catch((err) => {
            console.error(
              `❌ [${botName}] Error al actualizar la cita en la base de datos: ${err.message}`
            );
          });
      } else {
        console.error(
          `❌ [${botName}] Error al guardar la cita: ${appointment._id}`
        );
      }
    } catch (error) {
      console.error(
        `❌ [${botName}] Error al procesar la cita ${appointment._id}: ${error.message}`
      );
    }
  }
}

const saveAppointment = async ({
  messageText,
  refreshToken,
  model,
  openaiClient,
  invalidCredentialsCallback,
  Appointment,
  botId,
  generateAppointmentAttempts = 3,
  summary: summaryCustom,
  chatId,
  userName,
  botName,
  conversationId,
}) => {
  const fechaActual = new Date().toISOString();

  const chatResponse = await openaiClient.responses.create({
    ...getModelAndParams(model, 0.2),
    input: [
      {
        role: "system",
        content: "Eres un asistente que ayuda a programar citas.",
      },
      {
        role: "user",
        content: `
La fecha del día de hoy es ${fechaActual} UTC. 
Necesito que a partir de este texto me devuelvas un objeto JSON con la siguiente estructura:
{ 
  "summary": "Resumen de la cita", 
  "description": "Descripción de la cita", 
  "dateString": "Fecha en formato YYYY-MM-DD (sin zona horaria, interpretada tal cual se menciona en el texto)", 
  "timeString": "Hora en formato HH:mm (sin conversiones, la misma que aparece en el texto)" 
}.

IMPORTANTE:
- No conviertas entre zonas horarias. 
- No sumes ni restes horas. 
- Si el texto dice "mañana a las 19:30", debes devolver "dateString" con la fecha correspondiente al día de mañana respecto a ${fechaActual}, y "timeString" con "19:30". 
- Interpreta la hora del texto como si ya estuviera en UTC.

Este es el texto: "${messageText}"
    `,
      },
    ],
    // temperature: 0.2,
    // max_tokens: 4096,
    // top_p: 1
  });
  const appointmentData = chatResponse?.output_text?.trim();
  if (!appointmentData) {
    console.error("❌ No se pudo obtener la cita");
    return null;
  } else {
    console.log("🗓️ Cita obtenida:", appointmentData);
    const appointment = extractAppointmentData(appointmentData);
    if (!appointment) {
      console.error(
        `❌ No se pudo extraer la cita, reintentando... Quedan ${generateAppointmentAttempts} reintentos`
      );
      return await saveAppointment({
        messageText,
        refreshToken,
        model,
        openaiClient,
        invalidCredentialsCallback,
        Appointment,
        botId,
        generateAppointmentAttempts: generateAppointmentAttempts - 1,
        summary: summaryCustom,
        userName,
        botName,
        conversationId,
      });
    }
    const { summary, description, dateString, timeString } = appointment;

    console.log(
      `🗓️ Cita extraída: ${summary} - ${description} - ${dateString} - ${timeString}`
    );

    const start = `${dateString}T${timeString}:00`;
    const end = moment(`${dateString} ${timeString}`, "YYYY-MM-DD HH:mm")
      .add(30, "minutes")
      .format("YYYY-MM-DD[T]HH:mm:00");

    let saveGoogleCalendarResponse;
    if (refreshToken) {
      saveGoogleCalendarResponse = await saveGoogleCalendarDate({
        refreshToken,
        summary: summaryCustom || summary,
        description,
        start,
        end,
        invalidCredentialsCallback,
        botName,
      });
    }

    const appointmentSaved = new Appointment({
      botId,
      summary: summaryCustom || summary,
      description,
      start: moment.utc(start, "YYYY-MM-DDTHH:mm:ss"),
      end: moment.utc(end, "YYYY-MM-DDTHH:mm:ss"),
      dateString,
      timeString,
      scheduled: !!saveGoogleCalendarResponse,
      googleEventId: saveGoogleCalendarResponse?.id || null,
      chatId: chatId || null,
      userName: userName || null,
      conversationId,
    })
      .save()
      .then((savedAppointment) => {
        console.log("✅ Cita guardada:", savedAppointment);
        return savedAppointment;
      })
      .catch((err) => {
        console.error("❌ Error al guardar la cita:", err.message);
        return null;
      });

    return appointmentSaved;
  }
};

function extractAppointmentData(rawText) {
  const tryParse = (jsonText) => {
    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  };

  // 1. Intentar extraer entre ```json y ```
  const blockMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
  if (blockMatch) {
    const parsed = tryParse(blockMatch[1]);
    if (parsed) return parsed;
  }

  // 2. Si falla, intentar extraer cualquier bloque JSON entre llaves
  const jsonLikeMatch = rawText.match(/{[\s\S]*}/);
  if (jsonLikeMatch) {
    const parsed = tryParse(jsonLikeMatch[0]);
    if (parsed) return parsed;
  }

  // 3. Si todo falla, devolver null
  return null;
}

function scheduleReminder({
  appointment,
  reminder,
  client,
  botId,
  botName,
  Appointment,
}) {
  const tz = API_BASE_URL?.includes?.("localhost")
    ? "America/Argentina/Buenos_Aires"
    : "Europe/Madrid";
  const now = moment().tz(tz);
  const { start, chatId } = appointment;
  if (!start || !chatId) {
    console.error(
      `❌ [${botName}] Cita incompleta para programar recordatorio: ${JSON.stringify(
        appointment
      )}`
    );
    return;
  }

  if (appointment.sendReminder === false) {
    console.log(
      `[${botName}] Recordatorio cancelado en la cita ${JSON.stringify(
        appointment
      )}`
    );
    return;
  }

  const minutesBefore = generarIntervaloAleatorio(
    reminder.waitingFrom,
    reminder.waitingTo
  );
  const reminderTime = moment.utc(start).subtract(minutesBefore, "minutes");

  const message = reminder.message
    .replaceAll("{nombre}", appointment.userName || "")
    .replaceAll("{fecha}", appointment.dateString || "")
    .replaceAll("{hora}", appointment.timeString || "");

  const targetDateLocal = reminderTime.clone().tz(tz).format("YYYY-MM-DD");
  const hhmm = reminderTime.format("HH:mm");
  const targetLocal = moment.tz(
    `${targetDateLocal} ${hhmm}`,
    "YYYY-MM-DD HH:mm",
    tz
  );
  const timeoutMinutes = targetLocal.clone().diff(now, "minutes", true);

  console.log(
    `⏰ [${botId}] Programando recordatorio para ${chatId} el ${reminderTime.format(
      "YYYY-MM-DD HH:mm"
    )} (${tz}), ` +
      `equivalente a ${minutesBefore} minutos antes de la cita "${appointment.summary}". ` +
      `(faltan ~${Math.max(
        0,
        Math.round(timeoutMinutes)
      )} minutos) => ${message}`
  );

  if (targetLocal.isAfter(now)) {
    const delayMs = Math.max(0, targetLocal.clone().diff(now));

    const timeoutId = setTimeout(async () => {
      try {
        const appointmentReminder = await Appointment.findById(appointment._id);
        if (appointmentReminder.sendReminder === false) {
          console.log(
            `[${botName}] Recordatorio cancelado en la cita ${JSON.stringify(
              appointment
            )}`
          );
          return;
        }

        await client?.sendMessage(
          `${normalizeSpanishPhone(
            chatId?.split("@c.us")?.[0]?.replace(/\D/g, "")
          )}@c.us`,
          message
        );
        console.log(`✅ [${botName}] Mensaje enviado a ${chatId}: ${message}`);
      } catch (error) {
        console.error(
          `❌ [${botName}] Error al enviar mensaje a ${chatId}: ${error.message}`
        );
      }
      // marcar como enviado
    }, delayMs);

    if (!activeReminders.has(botId)) {
      activeReminders.set(botId, []);
    }
    activeReminders.get(botId).push({
      timeoutId,
      scheduledAt: `${reminderTime.format("YYYY-MM-DD HH:mm")} (${tz})`,
      message,
      chatId,
      appointmentId: appointment._id?.toString?.(),
    });
  } else {
    console.warn(
      `⚠️ [${botName}] La hora del recordatorio (${reminderTime.format(
        "YYYY-MM-DD HH:mm"
      )}) ya ha pasado. No se programará el recordatorio.`
    );
  }
}

function cleanTimeouts(botId) {
  if (activeReminders.has(botId)) {
    activeReminders
      .get(botId)
      .forEach(({ timeoutId }) => clearTimeout(timeoutId));
    activeReminders.delete(botId);
  }
}

function manageScheduleReminders({
  appointments,
  reminders,
  client,
  botId,
  botName,
  Appointment,
}) {
  cleanTimeouts(botId?.toString?.());
  if (!appointments?.length || !reminders?.length) {
    console.log(`🗓️ [${botName}] No hay recordatorios para programar.`);
    return;
  }

  for (const appointment of appointments) {
    for (const reminder of reminders) {
      scheduleReminder({
        appointment,
        reminder,
        botId: botId?.toString?.(),
        client,
        botName,
        Appointment,
      });
    }
  }
}

async function manageAppointmentsAndReminders({
  botId,
  botName,
  Appointment,
  reminders,
  googleRefreshToken,
  invalidCredentialsCallback,
  client,
}) {
  await managePendingAppointments({
    botId,
    botName,
    Appointment,
    googleRefreshToken,
    invalidCredentialsCallback,
  });
  const appointments = await Appointment.find({
    botId,
    // scheduled: true,
    start: {
      $gte: new Date(),
    },
  })?.lean?.();
  manageScheduleReminders({
    appointments,
    reminders,
    client,
    botId,
    botName,
    Appointment,
  });
}

async function manageRetryMessages({
  retrySettings,
  Conversation,
  Message,
  Contact,
  openaiClient,
  model,
  client,
  botId,
  botName,
  prompt,
}) {
  try {
    console.log(`🔄 [${botName}] Verificando mensajes para reintentar...`);
    cleanRetryMessageTimeouts(botId);
    if (retrySettings?.active) {
      const activeConversations = await Conversation.find({
        botId,
        active: true,
        retryMesagesActive: true,
      }).lean();
      const conversationsToRetry = activeConversations.filter(
        (conversation) =>
          conversation.retryMessagesSended?.length < retrySettings.retryCount
      );
      console.log(
        `🔄 [${botName}] Hay ${conversationsToRetry?.length} conversaciones activas con reintentos pendientes.`
      );
      if (conversationsToRetry?.length) {
        const messagesGroupedByConversations =
          await getMessagesGroupedByConversation(
            conversationsToRetry.map((c) => c._id?.toString?.()),
            Message
          );
        console.log(
          `🔄 [${botName}] Se encontraron ${messagesGroupedByConversations?.length} conversaciones activas con reintentos pendientes que cuentan con mensajes recibidos/enviados.`
        );
        for (const conversationMessages of messagesGroupedByConversations) {
          const messages = cleanMessages(conversationMessages.messages || []);
          const intervaloAleatorio = generarIntervaloAleatorio(
            retrySettings.intervalHoursFrom,
            retrySettings.intervalHoursTo
          );
          const isUserSended = (activeRetryMessages.get(botId) || []).some(
            (c) =>
              c.userId ===
              conversationMessages.conversation?.userId?.split?.("@c.us")?.[0]
          );
          console.log(
            `🔄 [${botName}] Conversación ${conversationMessages.conversation?._id?.toString?.()} con telefono ${
              conversationMessages.conversation?.userId?.split?.(
                "@c.us"
              )?.[0] || ""
            } tiene ${messages.length} mensajes. ${
              isUserSended
                ? "Ya se ha programado un reintento, por lo que por el momento no se necesita generar un nuevo mensaje."
                : ""
            }`
          );
          if (
            messages.length >= retrySettings.triggerMessageCount &&
            !isUserSended
          ) {
            const TZ = "Europe/Madrid";

            const now = moment().tz(TZ);

            let fechaTarget = moment(messages[0].createdAt)
              .add(intervaloAleatorio, "hours")
              .tz(TZ); // Calculamos la fecha objetivo en horario de Madrid

            const { noSendHoursFrom: from, noSendHoursTo: to } = retrySettings;

            if (
              typeof from === "number" &&
              typeof to === "number" &&
              from !== to
            ) {
              const hES = fechaTarget.hour();
              const cruzaMedianoche = from > to;

              // Validar si está dentro de la ventana prohibida
              const enVentana = cruzaMedianoche
                ? hES >= from || hES < to
                : hES >= from && hES < to;

              if (enVentana) {
                if (cruzaMedianoche && hES >= from) {
                  // Si cruza medianoche y estamos en el tramo de la noche → mañana a 'to'
                  fechaTarget.add(1, "day");
                }
                fechaTarget.hour(to).minute(0).second(0).millisecond(0);
              }
            }

            if (fechaTarget.valueOf() - now.valueOf() < 0) {
              const fechaActual = moment().tz(TZ); // Calculamos la fecha objetivo en horario de Madrid
              const hNow = fechaActual.hour();
              const cruzaMedianoche = from > to;

              // Verificar si AHORA estamos dentro de la ventana prohibida
              const enVentanaAhora = cruzaMedianoche
                ? hNow >= from || hNow < to
                : hNow >= from && hNow < to;

              if (enVentanaAhora) {
                // Mover al próximo horario permitido "from"
                if (cruzaMedianoche && hNow >= from) {
                  fechaActual.add(1, "day");
                }
                fechaTarget = fechaActual
                  .clone()
                  .hour(from)
                  .minute(0)
                  .second(0)
                  .millisecond(0);
              } else {
                // Si no estamos en ventana prohibida, programar inmediatamente
                fechaTarget = fechaActual.clone();
              }
            }

            const delayMs = Math.max(0, fechaTarget.valueOf() - now.valueOf());

            console.log("Ahora (España):", now.format("YYYY-MM-DD HH:mm:ss"));
            console.log(
              "Hora reintento (España):",
              fechaTarget.format("YYYY-MM-DD HH:mm:ss")
            );
            console.log("Delay ms:", delayMs);

            const timeoutId = setTimeout(async () => {
              console.log(
                `🔄 [${botName}] Reintentando mensajes de la conversación ${conversationMessages.conversation?._id?.toString?.()} con telefono ${
                  conversationMessages.conversation?.userId?.split?.(
                    "@c.us"
                  )?.[0] || ""
                }...`
              );
              try {
                const conversation = await Conversation.findById(
                  conversationMessages.conversation?._id?.toString?.()
                );
                if (!conversation?.active)
                  console.log(
                    `🤖 [${botName}] Se cancela el mensaje de reintento para la conversación ${conversationMessages.conversation?._id?.toString?.()} con telefono ${
                      conversationMessages.conversation?.userId?.split?.(
                        "@c.us"
                      )?.[0] || ""
                    } porque la conversación ya no está activa.`
                  );
                if (!conversation.active) return;

                const contact = await Contact.findOne({
                  phone:
                    conversationMessages.conversation?.userId.split("@c.us")[0],
                  botId,
                }).lean();
                let retryPrompt = retrySettings.retryPrompt;
                let botPrompt = prompt;
                if (contact) {
                  retryPrompt = retryPrompt
                    .replaceAll("{nombre}", contact.name || "")
                    .replaceAll("{telefono}", contact.phone || "")
                    .replaceAll("{email}", contact.email || "")
                    .replaceAll("{descripcion}", contact.description || "")
                    .replaceAll("{ahora}", getFormattedDateNow());
                  botPrompt = botPrompt
                    .replaceAll("{nombre}", contact.name || "")
                    .replaceAll("{telefono}", contact.phone || "")
                    .replaceAll("{email}", contact.email || "")
                    .replaceAll("{descripcion}", contact.description || "")
                    .replaceAll("{ahora}", getFormattedDateNow());
                }
                console.log(
                  `🔄 [${botName}] Generando mensaje para reintentar la conversación ${conversationMessages.conversation?._id?.toString?.()} con telefono ${
                    conversationMessages.conversation?.userId?.split?.(
                      "@c.us"
                    )?.[0] || ""
                  }...`
                );
                console.log(
                  `Se utiliza el siguiente prompt para generar el mensaje de reintento: ${retryPrompt} \n\n El siguiente es el prompt principal que se utilizó en la conversación: ${botPrompt}`
                );
                const chatResponse = await openaiClient.responses.create({
                  ...getModelAndParams(model, 0.2),
                  input: [
                    {
                      role: "system",
                      content: `${retryPrompt} \n\n El siguiente es el prompt principal que se utilizó en la conversación: ${botPrompt}`,
                    },
                    ...messages.reverse().map((m) => ({
                      role: m.role,
                      content: m.content,
                    })),
                  ],
                  // temperature: 0.2,
                  // max_tokens: 4096,
                  // top_p: 1
                });
                const messageToSend = chatResponse?.output_text?.trim();
                if (!messageToSend) {
                  console.warn(
                    `⚠️ [${botName}] No se generó respuesta para la conversación ${conversationMessages.conversation?._id?.toString?.()} con telefono ${
                      conversationMessages.conversation?.userId?.split?.(
                        "@c.us"
                      )?.[0] || ""
                    }`
                  );
                  return;
                } else {
                  console.log(
                    `🤖 [${botName}] Respuesta generada para la conversación ${conversationMessages.conversation?._id?.toString?.()} con telefono ${
                      conversationMessages.conversation?.userId?.split?.(
                        "@c.us"
                      )?.[0] || ""
                    }: ${messageToSend}`
                  );
                }
                const messageSended = await client?.sendMessage(
                  `${normalizeSpanishPhone(
                    conversationMessages.conversation?.userId?.replace(
                      /\D/g,
                      ""
                    )
                  )}@c.us`,
                  messageToSend
                );

                const messageToSave = new Message({
                  role: "assistant",
                  content: messageToSend,
                  conversationId:
                    conversationMessages.conversation?._id?.toString?.(),
                  userId: conversationMessages.conversation?.userId,
                  // messageId,
                });
                const savedMessage = await messageToSave.save();

                await Conversation.findByIdAndUpdate(
                  conversationMessages.conversation?._id?.toString?.(),
                  {
                    $push: {
                      retryMessagesSended: savedMessage._id,
                    },
                  }
                );
              } catch (err) {
                console.error(
                  `❌ [${botName}] Error al reintentar mensajes de la conversación ${conversationMessages.conversationId}: ${err.message}`
                );
              }
            }, Math.max(0, delayMs));

            if (!activeRetryMessages.has(botId)) {
              activeRetryMessages.set(botId, []);
            }
            activeRetryMessages.get(botId).push({
              timeoutId,
              userId:
                conversationMessages.conversation?.userId?.split?.(
                  "@c.us"
                )?.[0],
            });
          }
        }
      }

      const timeoutId = setTimeout(() => {
        manageRetryMessages({
          retrySettings,
          Conversation,
          Message,
          Contact,
          openaiClient,
          model,
          client,
          botId,
          botName,
          prompt,
        });
      }, retrySettings.intervalHoursFrom * 60 * 60 * 1000);

      if (!activeRetryMessages.has(botId)) {
        activeRetryMessages.set(botId, []);
      }
      activeRetryMessages.get(botId).push({ timeoutId });
    }
  } catch (err) {
    console.error(
      `❌ [${botName}] Error al gestionando el reintento de mensajes: ${err.message}`
    );
  }
}

function cleanRetryMessageTimeouts(botId) {
  if (activeRetryMessages.has(botId)) {
    activeRetryMessages.get(botId).forEach(({ timeoutId }) => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    activeRetryMessages.delete(botId);
  }
}

async function getMessagesGroupedByConversation(conversationIds, Message) {
  const results = await Message.aggregate([
    {
      $match: {
        conversationId: { $in: conversationIds },
      },
    },
    {
      $sort: {
        conversationId: 1,
        createdAt: -1,
      },
    },
    {
      $group: {
        _id: "$conversationId",
        messages: {
          $push: {
            _id: "$_id",
            role: "$role",
            content: "$content",
            createdAt: "$createdAt",
          },
        },
      },
    },
    {
      $addFields: {
        conversationObjectId: { $toObjectId: "$_id" },
      },
    },
    {
      $lookup: {
        from: "conversations",
        localField: "conversationObjectId",
        foreignField: "_id",
        as: "conversation",
      },
    },
    {
      $unwind: "$conversation",
    },
    {
      $project: {
        _id: 0,
        conversationId: "$_id",
        messages: 1,
        conversation: {
          _id: "$conversation._id",
          userId: "$conversation.userId",
          botId: "$conversation.botId",
          active: "$conversation.active",
          finalizedDate: "$conversation.finalizedDate",
          retryMessagesSended: "$conversation.retryMessagesSended",
          createdAt: "$conversation.createdAt",
          updatedAt: "$conversation.updatedAt",
        },
      },
    },
    {
      $sort: { conversationId: 1 },
    },
  ]);

  return results;
}

const cleanMessages = (messages) => {
  const cleaned = [];
  let previousMessage = null;

  for (const current of messages) {
    if (current.role === "system") continue;

    const isDuplicate =
      previousMessage &&
      current.role === "assistant" &&
      previousMessage.role === "assistant" &&
      current.content === previousMessage.content &&
      Math.abs(
        new Date(current.createdAt) - new Date(previousMessage.createdAt)
      ) < 3000; // 3 seconds

    if (!isDuplicate) {
      cleaned.push(current);
      previousMessage = current;
    }
  }

  return cleaned;
};

const replaceVariablesInPrompt = (prompt, variables, unavailableSlots = "") => {
  if (!variables || typeof variables !== "object") return prompt;

  prompt = prompt
    .replaceAll("{ahora}", getFormattedDateNow())
    .replaceAll("{fechas_no_disponibles}", JSON.stringify(unavailableSlots));

  return Object.entries(variables).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{${key}}`, value);
  }, prompt);
};

function getFormattedDateNow() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const day = now.getDate(); // sin padStart
  const month = now.getMonth() + 1; // sin padStart
  const year = now.getFullYear();

  const daysOfWeek = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ];
  const dayOfWeek = daysOfWeek[now.getDay()];

  return `${dayOfWeek} ${hours}:${minutes} ${day}/${month}/${year}`;
}

function getModelAndParams(modelParam, temperature = 0.2) {
  const [model, ...params] = modelParam.split(",").map((s) => s.trim());
  const modelObject = {
    model,
    ...(!params.length ? { temperature } : {}),
    ...(params.length > 0 &&
    params.find((p) => p?.startsWith("reasoning_effort"))
      ? {
          reasoning: {
            effort: params
              .find((p) => p.startsWith("reasoning_effort"))
              ?.split(":")[1]
              ?.trim(),
          },
        }
      : {}),
    ...(params.length > 0 && params.find((p) => p?.startsWith("verbosity"))
      ? {
          text: {
            verbosity: params
              .find((p) => p.startsWith("verbosity"))
              ?.split(":")[1]
              ?.trim(),
          },
        }
      : {}),
  };
  return modelObject;
}

const validateResponse = async ({
  openaiClient,
  modelParams,
  messages,
  validator,
  contact,
  lastMessage,
  whatsappClient,
  generateResponse,
  isConversationInResponseProcess,
  botId,
  Appointment,
}) => {
  const {
    retryCount = 1,
    fallbackMessage = "Ahora mismo no podemos atender esta solicitud. Te llamaremos en breves.",
    fallbackRedirectNumber,
    prompt: validatorPrompt = "",
  } = validator || {};

  const MAX_TRIES = Math.max(1, Number.isFinite(retryCount) ? retryCount : 1);

  let lastReason = "Respuesta no válida";
  let tries = 0;

  // Prompt de sistema + formato de salida en JSON estrictamente
  const systemInstruction = `
Eres un validador estricto. Debes analizar la información de la conversación y determinar si la respuesta de assistant cumple el criterio.
Devuelve **exclusivamente** un JSON con esta forma exacta (sin texto adicional):
{
  "isCorrect": boolean,
  "reason": string
}
- "isCorrect": true si la respuesta es correcta, false si no lo es.
- "reason": explica por qué (claro y corto).
`;

  let newResponse = lastMessage;
  const lastFailedResponses = [];
  for (tries = 1; tries <= MAX_TRIES; tries++) {
    if (tries > 1) {
      try {
        lastFailedResponses.push({
          respuestaInvalida: newResponse,
          razonInvalidez: lastReason,
        });
        const newPrompt = `REGLA MUY IMPORTANTE: la ultima respuesta "${newResponse}" fallo en la validación. Genera una nueva respuesta que cumpla los requisitos "${validatorPrompt}" y sobre todo que no vuelva a repetir la razón del último fallo "${lastReason}". Te dejo las respuestas inválidas anteriores para que no repitas los mismos errores: "${JSON.stringify(
          lastFailedResponses
        )}". Contesta de nuevo a la conversación teniendo en cuenta todo lo anterior.\n\n`;
        const response = await generateResponse(newPrompt);
        newResponse = response?.output_text?.trim();
      } catch (err) {
        console.error("Error generando nueva respuesta:", err?.message || err);
        try {
          if (whatsappClient && fallbackRedirectNumber) {
            const report = [
              `⚠️ Error generando nueva respuesta`,
              `Motivo: ${err?.message || err}`,
              contact?.name ? `Contacto: ${contact?.name}` : null,
              contact?.phone ? `Tel: ${contact?.phone}` : null,
              contact?.email ? `Email: ${contact?.email}` : null,
              `Respuesta recibida: ${newResponse}`,
              `Reintentos n°: ${tries}`,
            ]
              .filter(Boolean)
              .join("\n");
            console.log(
              `Notificando al número de redirección ${fallbackRedirectNumber}:\n${report}`
            );
            await whatsappClient.sendMessage(
              normalizeSpanishPhone(
                `${fallbackRedirectNumber}`.replace(/\D/g, "")
              ) + "@c.us",
              report
            );
          }
        } catch (err) {
          console.error(
            "Error notificando al número de redirección:",
            err?.message || err
          );
        }
        try {
          await whatsappClient.sendMessage(
            normalizeSpanishPhone(`${contact?.phone}`.replace(/\D/g, "")) +
              "@c.us",
            fallbackMessage
          );
        } catch (e) {
          console.error("Error enviando fallback al usuario:", e?.message || e);
        }
        return {
          ok: false,
          reason: "Error generando nueva respuesta",
          tries,
        };
      }
    }

    if (isConversationInResponseProcess()) return null;

    console.log(
      `Validando respuesta "${newResponse}" (reintento ${tries}) con el siguiente prompt:`
    );
    console.log(validatorPrompt);

    const unavailableSlots = await getUnavailableSlots({ Appointment, botId });

    const systemContent =
      (validatorPrompt || "")
        .replaceAll(
          "{conversacion}",
          JSON.stringify([
            ...messages,
            { role: "assistant", content: newResponse },
          ])
        )
        .replaceAll("{nombre}", contact?.name || "")
        .replaceAll("{telefono}", contact?.phone || "")
        .replaceAll("{email}", contact?.email || "")
        .replaceAll("{descripcion}", contact?.description || "")
        .replaceAll("{ahora}", getFormattedDateNow())
        .replaceAll(
          "{fechas_no_disponibles}",
          JSON.stringify(unavailableSlots)
        ) +
      "\n\n" +
      systemInstruction;

    let openaiResponse;
    try {
      openaiResponse = await openaiClient.responses.create({
        ...modelParams,
        input: [
          {
            role: "system",
            content: systemContent,
          },
        ],
      });
    } catch (err) {
      console.error(
        "Error llamando al modelo para validación:",
        err?.message || err
      );
      try {
        if (whatsappClient && fallbackRedirectNumber) {
          const report = [
            `⚠️ Error llamando al modelo para validación`,
            `Motivo: ${err?.message || err}`,
            contact?.name ? `Contacto: ${contact?.name}` : null,
            contact?.phone ? `Tel: ${contact?.phone}` : null,
            contact?.email ? `Email: ${contact?.email}` : null,
            `Respuesta recibida: ${newResponse}`,
            `Reintentos n°: ${tries}`,
          ]
            .filter(Boolean)
            .join("\n");
          console.log(
            `Notificando al número de redirección ${fallbackRedirectNumber}:\n${report}`
          );
          await whatsappClient.sendMessage(
            normalizeSpanishPhone(
              `${fallbackRedirectNumber}`.replace(/\D/g, "")
            ) + "@c.us",
            report
          );
        }
      } catch (err) {
        console.error(
          "Error notificando al número de redirección:",
          err?.message || err
        );
      }
      try {
        await whatsappClient.sendMessage(
          normalizeSpanishPhone(`${contact?.phone}`.replace(/\D/g, "")) +
            "@c.us",
          fallbackMessage
        );
      } catch (e) {
        console.error("Error enviando fallback al usuario:", e?.message || e);
      }
      return {
        ok: false,
        reason: "Error llamando al modelo para validación",
        tries,
      };
    }

    if (isConversationInResponseProcess()) return null;

    const raw = openaiResponse?.output_text;
    const parsed = extractJSON(raw);
    const isCorrect = !!parsed?.isCorrect;
    lastReason = parsed?.reason || "Respuesta no válida";

    if (isCorrect) {
      console.log(
        `✅ Respuesta validada correctamente en el intento ${tries}:`,
        JSON.stringify(parsed)
      );
      return {
        ok: true,
        reason: parsed?.reason || "Respuesta válida",
        tries,
        result: parsed,
        newResponse,
      };
    }
    console.log(`❌ Respuesta no válida en el intento ${tries}:`, lastReason);

    try {
      if (whatsappClient && fallbackRedirectNumber) {
        const report = [
          `⚠️ Validación fallida`,
          `Motivo: ${lastReason}`,
          contact?.name ? `Contacto: ${contact?.name}` : null,
          contact?.phone ? `Tel: ${contact?.phone}` : null,
          contact?.email ? `Email: ${contact?.email}` : null,
          `Respuesta recibida: ${newResponse}`,
          `Reintentos n°: ${tries}`,
        ]
          .filter(Boolean)
          .join("\n");
        console.log(
          `Notificando al número de redirección ${fallbackRedirectNumber}:\n${report}`
        );
        await whatsappClient.sendMessage(
          normalizeSpanishPhone(
            `${fallbackRedirectNumber}`.replace(/\D/g, "")
          ) + "@c.us",
          report
        );
      }
    } catch (err) {
      console.error(
        "Error notificando al número de redirección:",
        err?.message || err
      );
    }
    // Si no fue correcto y aún hay reintentos, podés agregar lógica para pedir aclaración, etc.
    // En este ejemplo, simplemente reintenta la evaluación con el mismo prompt/datos.
  }

  // Se agotaron los reintentos → enviar fallback al contacto y notificar al número de redirección
  console.log(
    `❌ Respuesta no validada tras ${MAX_TRIES} intentos. Último resultado:`,
    lastReason
  );
  try {
    if (whatsappClient && contact?.phone) {
      console.log(`Enviando mensaje de fallback al usuario ${contact?.phone}`);
      await whatsappClient.sendMessage(
        normalizeSpanishPhone(`${contact?.phone}`.replace(/\D/g, "")) + "@c.us",
        fallbackMessage
      );
    }
  } catch (err) {
    // No interrumpimos el flujo si falla el envío de fallback al usuario
    console.error("Error enviando fallback al usuario:", err?.message || err);
  }

  // try {
  //   if (whatsappClient && fallbackRedirectNumber) {
  //     const report = [
  //       `⚠️ Validación fallida`,
  //       `Motivo: ${lastReason}`,
  //       contact?.name ? `Contacto: ${contact?.name}` : null,
  //       contact?.phone ? `Tel: ${contact?.phone}` : null,
  //       contact?.email ? `Email: ${contact?.email}` : null,
  //       `Respuesta recibida: ${lastMessage}`,
  //       `Reintentos realizados: ${MAX_TRIES}`,
  //     ]
  //       .filter(Boolean)
  //       .join("\n");
  //     console.log(
  //       `Notificando al número de redirección ${fallbackRedirectNumber}:\n${report}`
  //     );
  //     await whatsappClient.sendMessage(
  //       normalizeSpanishPhone(`${fallbackRedirectNumber}`.replace(/\D/g, "")) +
  //         "@c.us",
  //       report
  //     );
  //   }
  // } catch (err) {
  //   console.error(
  //     "Error notificando al número de redirección:",
  //     err?.message || err
  //   );
  // }

  return {
    ok: false,
    reason: lastReason,
    tries: MAX_TRIES,
  };
};

// Helper: extrae JSON aunque el modelo devuelva texto con algo de rodeo
function extractJSON(text) {
  if (!text) return null;
  try {
    // Caso ideal: el texto es JSON puro
    return JSON.parse(text);
  } catch (_) {
    // fallback: intenta encontrar el primer bloque {...}
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (__) {
        return null;
      }
    }
    return null;
  }
}

function isConversationInResponseProcess({
  conversationsInResponseProcess,
  userId,
  messageId,
}) {
  const inResponseProcess =
    conversationsInResponseProcess.has(userId) &&
    conversationsInResponseProcess.get(userId) !== messageId;

  if (inResponseProcess)
    console.log(
      `Se interrumple proceso de respuesta debido a que se recibió del usuario un nuevo mensaje y se genera un proceso para responder este nuevo mensaje (${userId})`
    );
  return inResponseProcess;
}

async function getUnavailableSlots({ Appointment, botId }) {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const appointments = await Appointment.find({
      botId,
      // scheduled: true,
      start: { $gte: now, $lt: in7Days },
    })
      .select({ dateString: 1, timeString: 1, start: 1, _id: 0 })
      .sort({ start: 1 })
      .lean();

    // Normaliza "12.30" -> "12:30"
    const normalizeTime = (t = "") => t.replace(".", ":").slice(0, 5);

    const unavailableSlots = (appointments || []).map((a) => {
      const time = normalizeTime(a.timeString); // "HH:mm"

      // start: tal cual dateString + timeString
      const start = `${a.dateString}T${time}:00`;

      // end: mismo formato, sumando 30 min con moment
      const end = moment(`${a.dateString} ${time}`, "YYYY-MM-DD HH:mm")
        .add(30, "minutes")
        .format("YYYY-MM-DD[T]HH:mm:00");

      return { start, end };
    });

    console.log(
      `[${botId.toString()}] Fechas no disponibles: ${JSON.stringify(
        unavailableSlots
      )}`
    );

    return unavailableSlots;
  } catch (err) {
    console.error(
      `[${botId.toString()}] Error al recuperar citas: ${err.message}`
    );
  }
}

function generateUniqueKey(botId, phone) {
  // const timestamp = Date.now(); // milisegundos actuales
  // const random = Math.random().toString(36).slice(2, 8); // string aleatorio
  return `${botId}:${phone}`;
}

module.exports = { initializeWhatsAppClient, manageSendBotMessageFlow };
