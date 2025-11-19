// Importamos librerías
const { OpenAI } = require("openai");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const Bot = require("./src/models/bot");
const Contact = require("./src/models/contact");
const MessageFlow = require("./src/models/messageFlow");
const BotMessageFlow = require("./src/models/botMessageFlow");
const Appointment = require("./src/models/appointment");
const Conversation = require("./src/models/conversation");
const Message = require("./src/models/message");
const MessageToSend = require("./src/models/messageToSend");
const AskPreset = require("./src/models/askPreset.js");
const normalizeSpanishPhone = require("./src/utils/normalizeSpanishPhone.js");
const connectDB = require("./src/config/db");
const {
  initializeWhatsAppClient,
  manageSendBotMessageFlow,
} = require("./src/interactors/whatsapp.interactor.js");
require("dotenv").config();
const express = require("express");
const app = express();
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const cors = require("cors");
const { io } = require("socket.io-client");
require("./src/config/logger"); // Importamos el logger para que se inicialice
const {
  BotConnectionStates,
} = require("./src/models/enums/botConnectionState.js");
let socket = null;
const pendingBotStateRequests = new Map();
const messageFlowQueue = new Map();
const askRequestQueue = new Map();
let isProcessMessageFlowQueue = false;
const MAX_CONCURRENT_BOTS = 3;

app.use(express.json());
app.use(cors());

const executeMessageFlowQueue = async () => {
  if (isProcessMessageFlowQueue) return;

  isProcessMessageFlowQueue = true;

  const queueEntries = Array.from(messageFlowQueue.entries());

  // Agrupar en lotes de tamaño máximo
  const batchedEntries = [];
  for (let i = 0; i < queueEntries.length; i += MAX_CONCURRENT_BOTS) {
    batchedEntries.push(queueEntries.slice(i, i + MAX_CONCURRENT_BOTS));
  }

  try {
    for (const batch of batchedEntries) {
      await Promise.all(
        batch.map(async ([key, callbacks]) => {
          const bot = botsInitialized.find((b) => b._id.toString() === key);
          if (!bot) {
            messageFlowQueue.delete(key);
            return;
          }

          try {
            for (const callback of callbacks) {
              await callback();
            }
          } catch (err) {
            console.error(`❌ Error en callbacks del bot ${key}:`, err);
          }

          messageFlowQueue.delete(key);
        })
      );
    }
  } catch (err) {
    console.error("❌ Error procesando la cola de mensajes:", err);
  }

  isProcessMessageFlowQueue = false;

  // Si llegaron nuevos items mientras se procesaba, volver a lanzar
  if (messageFlowQueue.size > 0) {
    executeMessageFlowQueue();
  }
};

const swaggerOptions = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "Bots WhatsApp API",
      version: "1.0.0",
      description: "API para la gestión de bots de WhatsApp",
    },
    servers: [
      {
        url: process.env.API_BASE_URL || `http://localhost:${PORT}`,
        description: "Servidor actual",
      },
    ],
  },
  apis: [__filename], // Este archivo
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Inicializamos variable global de listado de bots inicializados
const botsInitialized = [];

// Conectamos a la base de datos
connectDB();

// Iniciamos el cliente de OpenAI
const openaiClient = new OpenAI({
  // baseURL: "https://models.inference.ai.azure.com",
  apiKey: process.env.OPENAI_API_KEY,
});

const initializeBots = async () => {
  // Recuperamos todos los bots activos de la base de datos
  const bots = await Bot.find({ active: true }).lean();

  // Recorremos todos los bots y los inicializamos
  bots.forEach(async (bot) => {
    const {
      _id,
      name,
      model,
      prompt,
      temperature,
      maxMessageCount,
      delayResponseFrom,
      delayResponseTo,
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
      autoResetTime,
      activeMessagesLimit,
      messagesLimitCount,
      reminders,
      retrySettings,
      validator,
    } = bot;

    if (bot.pendingLogout) {
      const sessionPath = path.join(
        __dirname,
        ".wwebjs_auth",
        `session-${bot._id.toString()}`
      );
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log("Sesión eliminada para botId:", bot._id.toString());
      }
      await Bot.findByIdAndUpdate(
        bot._id,
        { pendingLogout: false },
        { new: true }
      );
    }
    // Iniciamos el cliente de WhatsApp para el bot
    const {
      client: whatsappClient,
      conversationsInMemory,
      activeReminders,
      activeRetryMessages,
    } = await initializeWhatsAppClient({
      botId: _id,
      botName: name,
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
      autoResetTime,
      activeMessagesLimit,
      messagesLimitCount,
      bot,
      pendingBotStateRequests,
      BotMessageFlow,
      BotModel: Bot,
      Appointment,
      Contact,
      Conversation,
      Message,
      MessageToSend,
      messageFlowQueue,
      executeMessageFlowQueue,
      reminders,
      retrySettings,
      validator,
    });

    bot.whatsappClient = whatsappClient;
    bot.conversationsInMemory = conversationsInMemory; // Guardamos las conversaciones en memoria
    bot.activeReminders = activeReminders;
    bot.activeRetryMessages = activeRetryMessages;
    // Agregamos el bot a la lista de bots inicializados
    botsInitialized.push(bot);
  });
};

initializeBots();

app.post("/activar-websocket", (req, res) => {
  const { userId, botId } = req.body;

  const currentBot = botsInitialized.find((b) => b._id?.toString() === botId);

  if (socket?.connected) {
    if (pendingBotStateRequests.has(botId)) {
      pendingBotStateRequests.set(botId, {
        users: pendingBotStateRequests.get(botId).users.concat({
          userId,
          socket,
        }),
      });
    } else {
      pendingBotStateRequests.set(botId, {
        users: [{ userId, socket }],
      });
    }

    return res.json({
      state: currentBot?.connectionState || BotConnectionStates.DISCONNECTED,
      userId,
      qr: currentBot?.qr,
      botId,
    });
  }

  socket = io(process.env.IA_BOTS_API_BASE_URL, {
    path: "/hair-questionary/api/socket.io",
    transports: ["websocket"],
    auth: {
      type: "whatsapp-bots-backend",
    },
  });

  if (pendingBotStateRequests.has(botId)) {
    pendingBotStateRequests.set(botId, {
      users: pendingBotStateRequests.get(botId).users.concat({
        userId,
        socket,
      }),
    });
  } else {
    pendingBotStateRequests.set(botId, {
      users: [{ userId, socket }],
    });
  }

  socket.on("connect", () => {
    console.log("✅ Conectado al backend principal por WebSocket");
  });

  socket.on("whatsapp bot client disconnect", (userId) => {
    pendingBotStateRequests.forEach((bot) => {
      bot.users = bot.users.filter((user) => user.userId !== userId);
    });
    console.log("🔌 Desconectado del backend principal por WebSocket", userId);
  });

  socket.on("disconnect", () => {
    console.log("🔌 Desconectado del backend principal");
  });

  return res.json({
    state: currentBot?.connectionState || BotConnectionStates.DISCONNECTED,
    userId,
    qr: currentBot?.qr,
    botId,
  });
});

/**
 * @swagger
 * /bots:
 *   get:
 *     summary: Obtener todos los bots activos
 *     tags:
 *       - Bots
 *     responses:
 *       200:
 *         description: Lista de bots
 */
app.get("/bots", async (req, res) => {
  try {
    const bots = await Bot.find({}).lean();
    res.json(bots);
  } catch (error) {
    console.error("Error al obtener bots:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /bots:
 *   get:
 *     summary: Obtener todos los bots activos
 *     tags:
 *       - Bots
 *     responses:
 *       200:
 *         description: Lista de bots
 */
app.get("/bots/:id", async (req, res) => {
  try {
    const botId = req.params.id;
    if (!botId) {
      return res.status(400).json({ message: "Bot ID is required" });
    }

    const bot = await Bot.findById(botId).lean();
    res.json(bot);
  } catch (error) {
    console.error("Error al obtener bot:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

/**
 * @swagger
 * /bots:
 *   post:
 *     summary: Crear un nuevo bot
 *     tags:
 *       - Bots
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, model, prompt]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nombre del bot
 *                 example: Mi Bot
 *               active:
 *                 type: boolean
 *                 description: Indica si el bot está activo
 *                 example: true
 *               model:
 *                 type: string
 *                 description: Modelo de OpenAI a utilizar
 *                 example: gpt-4o-mini
 *               prompt:
 *                 type: string
 *                 description: Prompt inicial para el bot
 *                 example: ¿Cómo puedo ayudarte hoy?
 *               phone:
 *                 type: string
 *                 description: Número de teléfono del bot
 *                 example: +1234567890
 *               temperature:
 *                 type: number
 *                 description: Temperatura para el modelo de OpenAI
 *                 example: 0.2
 *               maxMessageCount:
 *                 type: number
 *                 description: Cantidad máxima de mensajes a almacenar en el contexto
 *                 example: 20
 *               delayResponseFrom:
 *                 type: number
 *                 description: Intervalo de tiempo de retraso en segundos para la respuesta del bot
 *                 example: 5
 *               delayResponseTo:
 *                 type: number
 *                 description: Intervalo de tiempo de retraso en segundos para la respuesta del bot
 *                 example: 10
 *               redirectPhone:
 *                 type: string
 *                 description: Número de teléfono al que se redirigirán los mensajes al finalizar la conversacion
 *                 example: 0987654321
 *               messageInitTrigger:
 *                type: string
 *                description: Mensaje que inicia la conversacion
 *                example: Hola :)
 *               botConversationDefaultActive:
 *                 type: boolean
 *                 description: Indica si la conversación está activa por defecto
 *                 example: true
 *               messageManualFinishTrigger:
 *                 type: string
 *                 description: Mensaje que finaliza la conversacion manualmente
 *                 example: Terminar conversacion
 *               activeMessageManualFinishTrigger:
 *                 type: boolean
 *                 description: Indica si la conversacion debe finalizar al recibir el mensaje trigger
 *                 example: true
 *               messageCompleteRedirectTrigger:
 *                 type: string
 *                 description: Mensaje que finaliza la conversacion
 *                 example: Pedido finalizado
 *               messageCompleteResponseFinalizated:
 *                 type: string
 *                 description: Mensaje que se envía al finalizar la conversacion
 *                 example: Tu pedido ha sido finalizado. Si desea realizar una modificación o consulta, por favor contáctenos al número de teléfono *****.
 *               appointmentMessageTrigger:
 *                 type: string
 *                 description: Mensaje que agenda una cita
 *                 example: Cita agendada
 *               activeAppointmentMessageTrigger:
 *                 type: boolean
 *                 description: Indica si la cita debe ser agendada al recibir el mensaje trigger
 *                 example: true
 *               appointmentMessageResponse:
 *                 type: string
 *                 description: Mensaje que se envía al agendar una cita
 *                 example: Tu cita ha sido agendada. Si desea realizar una modificación o consulta, por favor contáctenos al número de teléfono *****.
 *               activeMessageCompleteRedirectTrigger:
 *                 type: boolean
 *                 description: Indica si la conversacion debe finalizar al recibir el mensaje trigger
 *                 example: true
 *               activeAutoReset:
 *                 type: boolean
 *                 description: Indica si el bot debe reiniciarse automáticamente después de un tiempo
 *                 example: true
 *               autoResetTime:
 *                 type: number
 *                 description: Tiempo en horas para reiniciar el bot automáticamente
 *                 example: 3
 *     responses:
 *       201:
 *         description: Bot creado exitosamente
 *       400:
 *         description: Error por parámetros inválidos
 *       500:
 *         description: Error interno
 */
app.post("/bots", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }
    if (!req.body.name) {
      return res.status(400).json({ message: "Name is required" });
    }

    let newBot = await Bot.create(req.body);

    if (!newBot) {
      return res.status(400).json({ message: "Error creating bot" });
    }

    newBot = newBot.toObject();

    const initClient = async () => {
      if (newBot.active) {
        // Iniciar cliente WhatsApp
        const {
          client,
          conversationsInMemory,
          activeReminders,
          activeRetryMessages,
        } = await initializeWhatsAppClient({
          botId: newBot._id,
          botName: newBot.name,
          openaiClient,
          model: newBot.model,
          temperature: newBot.temperature,
          maxMessageCount: newBot.maxMessageCount,
          delayResponseFrom: newBot.delayResponseFrom,
          delayResponseTo: newBot.delayResponseTo,
          prompt: newBot.prompt,
          redirectPhone: newBot.redirectPhone,
          messageInitTrigger: newBot.messageInitTrigger,
          botConversationDefaultActive: newBot.botConversationDefaultActive,
          messageManualFinishTrigger: newBot.messageManualFinishTrigger,
          activeMessageManualFinishTrigger:
            newBot.activeMessageManualFinishTrigger,
          messageCompleteRedirectTrigger: newBot.messageCompleteRedirectTrigger,
          messageCompleteResponseFinalizated:
            newBot.messageCompleteResponseFinalizated,
          activeMessageCompleteRedirectTrigger:
            newBot.activeMessageCompleteRedirectTrigger,
          activeAutoReset: newBot.activeAutoReset,
          activeMessagesLimit: newBot.activeMessagesLimit,
          messagesLimitCount: newBot.messagesLimitCount,
          autoResetTime: newBot.autoResetTime,
          appointmentMessageTrigger: newBot.appointmentMessageTrigger,
          activeAppointmentMessageTrigger:
            newBot.activeAppointmentMessageTrigger,
          appointmentMessageResponse: newBot.appointmentMessageResponse,
          googleRefreshToken: newBot.googleRefreshToken,
          reminders: newBot.reminders,
          retrySettings: newBot.retrySettings,
          validator: newBot.validator,
          bot: newBot,
          pendingBotStateRequests,
          BotMessageFlow,
          BotModel: Bot,
          Appointment,
          Contact,
          messageFlowQueue,
          Conversation,
          Message,
          MessageToSend,
          executeMessageFlowQueue,
        });

        newBot.whatsappClient = client; // Agregar el cliente de WhatsApp al bot
        newBot.conversationsInMemory = conversationsInMemory;
        newBot.activeReminders = activeReminders;
        newBot.activeRetryMessages = activeRetryMessages;

        botsInitialized.push(newBot);
      }
    };

    initClient();

    const { whatsappClient, ...botData } = newBot; // Excluimos el cliente de WhatsApp de la respuesta

    res.status(201).json(botData?._doc || botData);
  } catch (error) {
    console.error("Error al crear el bot:", error);
    res.status(500).json({ message: "Error al crear el bot" });
  }
});

/**
 * @swagger
 * /bots/{id}:
 *   put:
 *     summary: Actualiza un bot existente y reinicia su cliente de WhatsApp
 *     tags:
 *       - Bots
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del bot a actualizar
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nombre del bot
 *                 example: Mi Bot
 *               active:
 *                 type: boolean
 *                 description: Indica si el bot está activo
 *                 example: true
 *               model:
 *                 type: string
 *                 description: Modelo de OpenAI a utilizar
 *                 example: gpt-4o-mini
 *               prompt:
 *                 type: string
 *                 description: Prompt inicial para el bot
 *                 example: ¿Cómo puedo ayudarte hoy?
 *               phone:
 *                 type: string
 *                 description: Número de teléfono del bot
 *                 example: +1234567890
 *               temperature:
 *                 type: number
 *                 description: Temperatura para el modelo de OpenAI
 *                 example: 0.2
 *               maxMessageCount:
 *                 type: number
 *                 description: Cantidad máxima de mensajes a almacenar en el contexto
 *                 example: 20
 *               delayResponseFrom:
 *                 type: number
 *                 description: Intervalo de tiempo de retraso en segundos para la respuesta del bot
 *                 example: 5
 *               delayResponseTo:
 *                 type: number
 *                 description: Intervalo de tiempo de retraso en segundos para la respuesta del bot
 *                 example: 10
 *               redirectPhone:
 *                 type: string
 *                 description: Número de teléfono al que se redirigirán los mensajes al finalizar la conversacion
 *                 example: 0987654321
 *               messageInitTrigger:
 *                type: string
 *                description: Mensaje que inicia la conversacion
 *                example: Hola :)
 *               botConversationDefaultActive:
 *                 type: boolean
 *                 description: Indica si la conversación está activa por defecto
 *                 example: true
 *               messageManualFinishTrigger:
 *                 type: string
 *                 description: Mensaje que finaliza la conversacion manualmente
 *                 example: Terminar conversacion
 *               activeMessageManualFinishTrigger:
 *                 type: boolean
 *                 description: Indica si la conversacion debe finalizar al recibir el mensaje trigger
 *                 example: true
 *               messageCompleteRedirectTrigger:
 *                 type: string
 *                 description: Mensaje que finaliza la conversacion
 *                 example: Pedido finalizado
 *               messageCompleteResponseFinalizated:
 *                 type: string
 *                 description: Mensaje que se envía al finalizar la conversacion
 *                 example: Tu pedido ha sido finalizado. Si desea realizar una modificación o consulta, por favor contáctenos al número de teléfono *****.
 *               activeMessageCompleteRedirectTrigger:
 *                 type: boolean
 *                 description: Indica si la conversacion debe finalizar al recibir el mensaje trigger
 *                 example: true
 *               appointmentMessageTrigger:
 *                 type: string
 *                 description: Mensaje que agenda una cita
 *                 example: Cita agendada
 *               activeAppointmentMessageTrigger:
 *                 type: boolean
 *                 description: Indica si la cita debe ser agendada al recibir el mensaje trigger
 *                 example: true
 *               appointmentMessageResponse:
 *                 type: string
 *                 description: Mensaje que se envía al agendar una cita
 *                 example: Tu cita ha sido agendada. Si desea realizar una modificación o consulta, por favor contáctenos al número de teléfono *****.
 *               activeAutoReset:
 *                 type: boolean
 *                 description: Indica si el bot debe reiniciarse automáticamente después de un tiempo
 *                 example: true
 *               autoResetTime:
 *                 type: number
 *                 description: Tiempo en horas para reiniciar el bot automáticamente
 *                 example: 3
 *     responses:
 *       200:
 *         description: Bot actualizado exitosamente
 *       400:
 *         description: Error por parámetros inválidos
 *       500:
 *         description: Error interno del servidor
 */
app.put("/bots/:id", async (req, res) => {
  const botId = req.params.id;
  if (!botId) {
    return res.status(400).json({ message: "Bot ID is required" });
  }

  if (!req.body) {
    return res.status(400).json({ message: "Body is required" });
  }

  const updatedBot = await Bot.findByIdAndUpdate(botId, req.body, {
    new: true,
  }).lean();

  const botIndex = botsInitialized.findIndex((b) => b._id.toString() === botId);

  if (botIndex !== -1) {
    const botInitalized = botsInitialized[botIndex];
    const oldClient = botInitalized?.whatsappClient;

    botsInitialized[botIndex].connectionState =
      BotConnectionStates.DISCONNECTED;
    const usersToEmit = pendingBotStateRequests.get(botId);
    if (usersToEmit) {
      usersToEmit.users.forEach((user) => {
        user.socket.emit("whatsapp bot state", {
          state: BotConnectionStates.DISCONNECTED,
          userId: user.userId,
          qr: botsInitialized[botIndex]?.qr,
          botId,
        });
      });
    }
    // Destruir cliente actual de WhatsApp (si tiene método `destroy`)
    if (oldClient && typeof oldClient.destroy === "function") {
      await oldClient.destroy(); // Este método puede variar según tu implementación
    }
  }

  const initClient = async () => {
    if (updatedBot.active) {
      if (updatedBot.pendingLogout) {
        const sessionPath = path.join(
          __dirname,
          ".wwebjs_auth",
          `session-${updatedBot._id.toString()}`
        );
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log(
            "Sesión eliminada para botId:",
            updatedBot._id.toString()
          );
        }
        await Bot.findByIdAndUpdate(
          updatedBot._id,
          { pendingLogout: false },
          { new: true }
        );
      }
      const {
        client: newClient,
        conversationsInMemory,
        activeReminders,
        activeRetryMessages,
      } = await initializeWhatsAppClient({
        botId: updatedBot._id,
        botName: updatedBot.name,
        openaiClient,
        model: updatedBot.model,
        temperature: updatedBot.temperature,
        maxMessageCount: updatedBot.maxMessageCount,
        delayResponseFrom: updatedBot.delayResponseFrom,
        delayResponseTo: updatedBot.delayResponseTo,
        prompt: updatedBot.prompt,
        redirectPhone: updatedBot.redirectPhone,
        messageInitTrigger: updatedBot.messageInitTrigger,
        botConversationDefaultActive: updatedBot.botConversationDefaultActive,
        messageManualFinishTrigger: updatedBot.messageManualFinishTrigger,
        activeMessageManualFinishTrigger:
          updatedBot.activeMessageManualFinishTrigger,
        messageCompleteRedirectTrigger:
          updatedBot.messageCompleteRedirectTrigger,
        messageCompleteResponseFinalizated:
          updatedBot.messageCompleteResponseFinalizated,
        activeMessageCompleteRedirectTrigger:
          updatedBot.activeMessageCompleteRedirectTrigger,
        appointmentMessageTrigger: updatedBot.appointmentMessageTrigger,
        activeAppointmentMessageTrigger:
          updatedBot.activeAppointmentMessageTrigger,
        appointmentMessageResponse: updatedBot.appointmentMessageResponse,
        googleRefreshToken: updatedBot.googleRefreshToken,
        reminders: updatedBot.reminders,
        retrySettings: updatedBot.retrySettings,
        validator: updatedBot.validator,
        activeAutoReset: updatedBot.activeAutoReset,
        activeMessagesLimit: updatedBot.activeMessagesLimit,
        messagesLimitCount: updatedBot.messagesLimitCount,
        autoResetTime: updatedBot.autoResetTime,
        bot: botIndex !== -1 ? botsInitialized[botIndex] : updatedBot,
        pendingBotStateRequests,
        BotMessageFlow,
        BotModel: Bot,
        Appointment,
        Contact,
        Conversation,
        Message,
        MessageToSend,
        messageFlowQueue,
        executeMessageFlowQueue,
      });

      if (botIndex !== -1) {
        // Actualizar el cliente de WhatsApp en la lista de bots inicializados
        botsInitialized[botIndex] = {
          ...updatedBot,
          whatsappClient: newClient,
          conversationsInMemory: conversationsInMemory, // Actualizar las conversaciones en memoria
          activeReminders: activeReminders,
          activeRetryMessages: activeRetryMessages,
        };
      } else {
        updatedBot.whatsappClient = newClient; // Agregar el cliente de WhatsApp al bot actualizado
        updatedBot.conversationsInMemory = conversationsInMemory; // Guardamos las conversaciones en memoria
        updatedBot.activeReminders = activeReminders;
        updatedBot.activeRetryMessages = activeRetryMessages;

        // Si el bot no estaba en la lista, lo agregamos
        botsInitialized.push(updatedBot);
      }
    } else {
      // Si el bot no está activo, lo eliminamos de la lista de bots inicializados
      if (botIndex !== -1) {
        botsInitialized.splice(botIndex, 1);
      }
    }
  };

  initClient();

  const { whatsappClient, ...botData } = updatedBot; // Excluimos el cliente de WhatsApp de la respuesta

  return res.status(200).json({
    message: "Bot updated successfully",
    bot: botData,
  });
});

/**
 * @swagger
 * /bots/{id}:
 *   delete:
 *     summary: Elimina un bot y remueve su cliente de WhatsApp
 *     tags:
 *       - Bots
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del bot a eliminar
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bot eliminado exitosamente
 *       400:
 *         description: Error por parámetros inválidos
 *       500:
 *         description: Error interno del servidor
 */
app.delete("/bots/:id", async (req, res) => {
  const botId = req.params.id;
  if (!botId) {
    return res.status(400).json({ message: "Bot ID is required" });
  }

  await Bot.findByIdAndDelete(botId);

  const botIndex = botsInitialized.findIndex((b) => b._id.toString() === botId);

  if (botIndex !== -1) {
    const botInitalized = botsInitialized[botIndex];
    const oldClient = botInitalized?.whatsappClient;

    // Destruir cliente actual de WhatsApp (si tiene método `destroy`)
    if (oldClient && typeof oldClient.destroy === "function") {
      await oldClient.destroy(); // Este método puede variar según tu implementación
    }
    botsInitialized.splice(botIndex, 1); // Eliminar el bot de la lista de bots inicializados
  }

  return res.status(200).json({
    message: "Bot eliminado exitosamente",
  });
});

app.post("/contact", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }
    if (!req.body.name) {
      return res.status(400).json({ message: "Nombre is required" });
    }
    if (!req.body.phone) {
      return res.status(400).json({ message: "Telefono is required" });
    }

    const existingContact = await Contact.findOne({
      phone: normalizeSpanishPhone(req.body.phone.replace(/\D/g, "")),
      botId: req.body.botId,
    }).lean();
    if (existingContact) {
      return res.status(400).json({
        message: "Ya existe un contacto con este número de teléfono",
      });
    }
    const contact = await Contact.create({
      ...req.body,
      phone: normalizeSpanishPhone(req.body.phone.replace(/\D/g, "")),
    });
    res.status(201).json(contact);
  } catch (error) {
    console.error("Error al crear el contacto:", error);
    res.status(500).json({ message: "Error al crear el contacto" });
  }
});
app.post("/contact/bulk", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }
    if (!req.body.contacts) {
      return res.status(400).json({ message: "Contacts is required" });
    }

    let contactsToInsert = req.body.contacts
      .filter((c) => c?.phone?.length)
      .map((c) => ({
        ...c,
        phone: normalizeSpanishPhone(c.phone.replace(/\D/g, "")),
      }));
    const existingContacts = await Contact.find({
      phone: { $in: contactsToInsert.map((c) => c.phone) },
    }).lean();
    if (existingContacts.length > 0) {
      contactsToInsert = contactsToInsert.filter(
        (c) =>
          !existingContacts.some(
            (ec) => ec.phone === c.phone && ec.botId?.toString() === c.botId
          )
      );
    }
    const contacts = await Contact.insertMany(contactsToInsert);
    res.status(201).json(contacts);
  } catch (error) {
    console.error("Error al crear los contactos:", error);
    res.status(500).json({ message: "Error al crear los contactos" });
  }
});
app.get("/contact", async (req, res) => {
  try {
    const { page, items, search, botId } = req.query;
    const query = {
      botId,
      ...(search && { name: { $regex: search, $options: "i" } }),
    };

    const values = await Contact.find(query)
      .skip((page - 1) * items)
      .limit(items)
      .populate([botId ? { path: "botId", select: "name" } : null])
      .sort({ createdAt: -1 })
      .lean();

    const count = await Contact.find(query).countDocuments();

    return res.json({ values, count });
  } catch (error) {
    console.error("Error al obtener bots:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});
app.get("/contact/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findById(id)
      .populate([{ path: "botId", select: "name" }])
      .lean();

    res.json(contact);
  } catch (error) {
    console.error("Error al recuperar contacto:", error);
    res.status(500).json({ error: error.message });
  }
});
app.put("/contact/:id", async (req, res) => {
  try {
    const contactId = req.params.id;
    if (!contactId) {
      return res.status(400).json({ message: "Contact ID is required" });
    }

    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }

    const updatedContact = await Contact.findByIdAndUpdate(
      contactId,
      req.body,
      {
        new: true,
      }
    ).lean();

    res.json(updatedContact);
  } catch (error) {
    console.error("Error al actualizar contacto:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});
app.delete("/contact/:id", async (req, res) => {
  try {
    const contactId = req.params.id;
    if (!contactId) {
      return res.status(400).json({ message: "Contact ID is required" });
    }

    await Contact.findByIdAndDelete(contactId);
    res.status(200).json({ message: "Contacto eliminado exitosamente" });
  } catch (error) {
    console.error("Error al eliminar contacto:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.delete("/contacts", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Se requiere un array de IDs" });
    }

    const result = await Contact.deleteMany({ _id: { $in: ids } });

    res.status(200).json({
      message: `${result.deletedCount} contacto(s) eliminado(s) exitosamente`,
    });
  } catch (error) {
    console.error("Error al eliminar contactos:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.post("/message-flow", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }
    if (!req.body.name) {
      return res.status(400).json({ message: "Nombre is required" });
    }

    const contact = await MessageFlow.create(req.body);
    res.status(201).json(contact);
  } catch (error) {
    console.error("Error al crear el flujo de mensajes:", error);
    res.status(500).json({ message: "Error al crear el flujo de mensajes" });
  }
});
app.get("/message-flow", async (req, res) => {
  try {
    const { page, items, search } = req.query;
    const query = {
      ...(search && { name: { $regex: search, $options: "i" } }),
    };

    const values = await MessageFlow.find(query)
      .skip((page - 1) * items)
      .limit(items)
      .sort({ createdAt: -1 })
      .lean();

    const count = await MessageFlow.find(query).countDocuments();

    return res.json({ values, count });
  } catch (error) {
    console.error("Error al obtener flujo de mensajes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});
app.get("/message-flow/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const messageFlow = await MessageFlow.findById(id).lean();

    res.json(messageFlow);
  } catch (error) {
    console.error("Error al recuperar flujo de mensajes:", error);
    res.status(500).json({ error: error.message });
  }
});
app.put("/message-flow/:id", async (req, res) => {
  try {
    const messageFlowId = req.params.id;
    if (!messageFlowId) {
      return res.status(400).json({ message: "MessageFlow ID is required" });
    }

    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }

    const updatedContact = await MessageFlow.findByIdAndUpdate(
      messageFlowId,
      req.body,
      {
        new: true,
      }
    ).lean();

    res.json(updatedContact);
  } catch (error) {
    console.error("Error al actualizar flujo de mensajes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});
app.delete("/message-flow/:id", async (req, res) => {
  try {
    const messageFlowId = req.params.id;
    if (!messageFlowId) {
      return res.status(400).json({ message: "Message flow ID is required" });
    }

    await MessageFlow.findByIdAndDelete(messageFlowId);
    res.status(200).json({ message: "Contacto eliminado exitosamente" });
  } catch (error) {
    console.error("Error al eliminar flujo de mensajes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.post("/bot-message-flow", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }
    if (!req.body.name) {
      return res.status(400).json({ message: "Nombre is required" });
    }

    const contact = await BotMessageFlow.create(req.body);
    if (contact) {
      const currentBot = botsInitialized.find(
        (b) => b?._id?.toString() === contact?.botId?.toString()
      );
      manageSendBotMessageFlow({
        botId: contact?.botId?.toString(),
        botName: currentBot?.name,
        client: currentBot?.whatsappClient,
        prompt: currentBot?.prompt,
        conversationsInMemory: new Map(),
        maxMessageCount: currentBot?.maxMessageCount,
        BotMessageFlow,
        messageFlowQueue,
        executeMessageFlowQueue,
        Conversation,
        Message,
        Contact,
        Appointment,
        retrySettings: currentBot?.retrySettings,
      });
    }
    res.status(201).json(contact);
  } catch (error) {
    console.error("Error al crear el flujo de mensajes:", error);
    res.status(500).json({ message: "Error al crear el flujo de mensajes" });
  }
});
app.get("/bot-message-flow", async (req, res) => {
  try {
    const { page, items, search, botId } = req.query;
    const query = {
      botId,
      ...(search && { name: { $regex: search, $options: "i" } }),
    };

    const values = await BotMessageFlow.find(query)
      .skip((page - 1) * items)
      .limit(items)
      .populate("contacts")
      .populate("messageFlow")
      .populate("botId")
      .sort({ createdAt: -1 })
      .lean();

    const count = await BotMessageFlow.find(query).countDocuments();

    return res.json({ values, count });
  } catch (error) {
    console.error("Error al obtener flujo de mensajes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});
app.get("/bot-message-flow/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await BotMessageFlow.findById(id)
      .populate("contacts")
      .populate("messageFlow")
      .populate("botId")
      .lean();

    res.json(contact);
  } catch (error) {
    console.error("Error al recuperar flujo de mensajes:", error);
    res.status(500).json({ error: error.message });
  }
});
app.put("/bot-message-flow/:id", async (req, res) => {
  try {
    const contactId = req.params.id;
    if (!contactId) {
      return res
        .status(400)
        .json({ message: "Bot message flow  ID is required" });
    }

    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }

    const updatedContact = await BotMessageFlow.findByIdAndUpdate(
      contactId,
      req.body,
      {
        new: true,
      }
    ).lean();

    if (updatedContact) {
      const currentBot = botsInitialized.find(
        (b) => b?._id?.toString() === updatedContact?.botId?.toString()
      );
      manageSendBotMessageFlow({
        botId: updatedContact?.botId?.toString(),
        botName: currentBot?.name,
        client: currentBot?.whatsappClient,
        prompt: currentBot?.prompt,
        maxMessageCount: currentBot?.maxMessageCount,
        conversationsInMemory: new Map(),
        BotMessageFlow,
        messageFlowQueue,
        executeMessageFlowQueue,
        Conversation,
        Message,
        Contact,
        Appointment,
        retrySettings: currentBot?.retrySettings,
      });
    }

    res.json(updatedContact);
  } catch (error) {
    console.error("Error al actualizar flujo de mensajes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.delete("/bot-message-flow/:id", async (req, res) => {
  try {
    const contactId = req.params.id;
    if (!contactId) {
      return res
        .status(400)
        .json({ message: "Bot message flow ID is required" });
    }

    await BotMessageFlow.findByIdAndDelete(contactId);
    res.status(200).json({ message: "Contacto eliminado exitosamente" });
  } catch (error) {
    console.error("Error al eliminar flujo de mensajes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.get("/appointments", async (req, res) => {
  try {
    const { page, items, fromDate, toDate, scheduled, botId } = req.query;
    const query = {
      ...(botId ? { botId } : {}),
      ...(fromDate ? { start: { $gte: new Date(fromDate) } } : {}),
      ...(toDate ? { end: { $lte: new Date(toDate) } } : {}),
      ...(scheduled ? { scheduled: scheduled === "true" } : {}),
    };

    const values = await Appointment.find(query)
      .skip((page - 1) * items)
      .limit(items)
      .populate([{ path: "botId" }])
      .sort({ start: -1 })
      .lean();

    const valuesWithReminders = values.map((appointment) => {
      const bot = botsInitialized.find(
        (b) => b._id.toString() === appointment.botId?._id?.toString()
      );
      const reminder = (
        bot?.activeReminders?.get(appointment.botId?._id?.toString()) || []
      )?.find(
        (r) => r?.appointmentId?.toString() === appointment?._id?.toString()
      );
      const { timeoutId, ...reminderToSend } = reminder || {};
      return {
        ...appointment,
        reminder: reminderToSend,
      };
    });

    const count = await Appointment.find(query).countDocuments();

    return res.json({ values: valuesWithReminders, count });
  } catch (error) {
    console.error("Error al obtener citas agendadas:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.put("/appointments/:id", async (req, res) => {
  try {
    const appointmentId = req.params.id;
    if (!appointmentId) {
      return res.status(400).json({ message: "Appointment ID is required" });
    }

    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }

    const updated = await Appointment.findByIdAndUpdate(
      appointmentId,
      req.body,
      {
        new: true,
      }
    ).lean();

    res.json(updated);
  } catch (error) {
    console.error("Error al actualizar cita:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.get("/conversations", async (req, res) => {
  try {
    const { fromDate, toDate, active, botId, page = 1, items = 10 } = req.query;

    const matchStage = {};
    if (fromDate || toDate) {
      matchStage.createdAt = {};
      if (fromDate) matchStage.createdAt.$gte = new Date(fromDate);
      if (toDate) matchStage.createdAt.$lte = new Date(toDate);
    }

    const parsedPage = Number(page);
    const parsedItems = Number(items);
    const skip = (parsedPage - 1) * parsedItems;

    const pipeline = [
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),

      // 1) Reducir a 1 doc por conversación (último mensaje), sin sort global
      {
        $group: {
          _id: "$conversationId",
          lastMessage: {
            $top: { sortBy: { createdAt: -1, _id: -1 }, output: "$$ROOT" },
          },
          lastCreatedAt: { $max: "$createdAt" }, // útil para orden
        },
      },

      // 2) Join con conversations para filtrar por active/botId ANTES de paginar
      { $addFields: { conversationObjectId: { $toObjectId: "$_id" } } },
      {
        $lookup: {
          from: "conversations",
          localField: "conversationObjectId",
          foreignField: "_id",
          as: "conversation",
        },
      },
      { $unwind: "$conversation" },

      ...(active === "true" || active === "false"
        ? [{ $match: { "conversation.active": active === "true" } }]
        : []),

      ...(botId
        ? [
            {
              $match: {
                "conversation.botId": new mongoose.Types.ObjectId(botId),
              },
            },
          ]
        : []),

      // 3) Ordenar por último mensaje (set ya reducido a 1 por conv)
      { $sort: { lastCreatedAt: -1 } },

      // 4) Paginar ANTES de lookups pesados
      { $skip: skip },
      { $limit: parsedItems },

      // 5) Bot (solo para la página actual)
      {
        $lookup: {
          from: "bots",
          localField: "conversation.botId",
          foreignField: "_id",
          as: "bot",
        },
      },
      { $unwind: { path: "$bot", preserveNullAndEmptyArrays: true } },

      // 5.1) Contact (match por phone=userId y botId)
      {
        $lookup: {
          from: "contacts",
          let: {
            // "123456789@c.us" -> "123456789"
            normPhone: {
              $arrayElemAt: [
                { $split: ["$conversation.userId", "@c.us"] },
                0
              ]
            },
            botId: "$conversation.botId"
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$phone", "$$normPhone"] },
                    { $eq: ["$botId", "$$botId"] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: "contact"
        }
      },
      { $unwind: { path: "$contact", preserveNullAndEmptyArrays: true } },

      // 6) Traer TODOS los mensajes de esa conversación (orden ASC)
      {
        $lookup: {
          from: "messages",
          let: { conversationId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$conversationId", "$$conversationId"] },
              },
            },
            { $sort: { createdAt: 1, _id: 1 } },
          ],
          as: "messages",
        },
      },

      // 7) Proyección final
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          messages: 1,
          "conversation._id": 1,
          "conversation.userId": 1,
          "conversation.active": 1,
          "conversation.createdAt": 1,
          "bot.name": 1,
          // Contact
          "contact._id": 1,
          "contact.name": 1,
          "contact.phone": 1,
          "contact.email": 1,
          "contact.description": 1,
        },
      },
    ];

    // Conteo total coherente con filtros (sin lookups pesados ni sorts globales)
    const countPipeline = [
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      { $group: { _id: "$conversationId" } },
      { $addFields: { conversationObjectId: { $toObjectId: "$_id" } } },
      {
        $lookup: {
          from: "conversations",
          localField: "conversationObjectId",
          foreignField: "_id",
          as: "conversation",
        },
      },
      { $unwind: "$conversation" },
      ...(active === "true" || active === "false"
        ? [{ $match: { "conversation.active": active === "true" } }]
        : []),
      ...(botId
        ? [
            {
              $match: {
                "conversation.botId": new mongoose.Types.ObjectId(botId),
              },
            },
          ]
        : []),
      { $count: "total" },
    ];

    const [values, countResult] = await Promise.all([
      Message.aggregate(pipeline).allowDiskUse(true),
      Message.aggregate(countPipeline).allowDiskUse(true),
    ]);

    const count = countResult?.[0]?.total ?? 0;
    return res.json({ values, count });
  } catch (error) {
    console.error("Error al obtener conversaciones:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.get("/conversations/ask-presets", async (req, res) => {
  try {
    const askPresets = await AskPreset.find().lean();

    res.json(askPresets);
  } catch (error) {
    console.error("Error al obtener presets:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.get("/conversations/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await Conversation.findById(id)
      .populate("botId", "name") // solo trae el campo `name` del bot
      .lean();

    if (!conversation) {
      return res.status(404).json({ message: "Conversación no encontrada" });
    }

    const contact = await Contact.findOne({
      phone: (conversation.userId || "").split("@c.us")[0],
      botId: conversation.botId?._id|| conversation.botId,
    }).lean();

    const messages = await Message.find({ conversationId: id })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ ...conversation, contact: contact || null, messages });
  } catch (error) {
    console.error("Error al obtener conversación por ID:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.post("/conversations/ask", async (req, res) => {
  let newJobId;
  try {
    console.log("Nueva solicitud en /conversations/ask");
    const { fromDate, toDate, active, botId, prompt, model, jobId } = req.body;
    if (jobId) {
      const response = askRequestQueue.get(jobId);
      if (!response) return res.status(404).json({ error: "not found" });

      return res.status(200).json(response);
    }
    newJobId = crypto.randomUUID();

    askRequestQueue.set(newJobId, {
      jobId: newJobId,
      status: "pending",
      nextPollSeconds: 15,
    });

    setTimeout(() => {
      askRequestQueue.delete(newJobId);
    }, 15 * 60 * 1000); // 15 minutos para completar la solicitud

    res.status(202).json({
      jobId: newJobId,
      status: "pending",
      nextPollSeconds: 15,
    });
    Promise.resolve().then(async () => {
      try {
        const matchStage = {};

        const parseDate = (v) => {
          if (!v) return undefined;
          const d = new Date(v);
          return isNaN(d.getTime()) ? undefined : d;
        };

        let start = parseDate(fromDate);
        let end = parseDate(toDate);

        if (!start && !end) {
          // default: últimos 7 días
          const now = new Date();
          const sevenDaysAgo = new Date(now);
          sevenDaysAgo.setDate(now.getDate() - 7);
          sevenDaysAgo.setHours(0, 0, 0, 0);
          matchStage.createdAt = { $gte: sevenDaysAgo, $lte: now };
        } else {
          // respetar lo que venga (si viene uno solo, no inventamos el otro)
          if (start || end) {
            matchStage.createdAt = {};
            if (start) {
              start.setHours(0, 0, 0, 0);
              matchStage.createdAt.$gte = start;
            }
            if (end) {
              end.setHours(23, 59, 59, 999);
              matchStage.createdAt.$lte = end;
            }
          }
        }

        const pipeline = [
          ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),

          {
            $group: {
              _id: "$conversationId", // conversationId (string)
              lastCreatedAt: { $max: "$createdAt" },
            },
          },

          {
            $lookup: {
              from: "messages",
              let: { conversationId: "$_id", lastCreatedAt: "$lastCreatedAt" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$conversationId", "$$conversationId"] },
                        { $eq: ["$createdAt", "$$lastCreatedAt"] },
                      ],
                    },
                  },
                },
                { $limit: 1 },
              ],
              as: "lastMessage",
            },
          },
          { $unwind: "$lastMessage" },

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
          { $unwind: "$conversation" },

          ...(active === "true" || active === "false"
            ? [{ $match: { "conversation.active": active === "true" } }]
            : []),

          ...(botId
            ? [
                {
                  $match: {
                    "conversation.botId": new mongoose.Types.ObjectId(botId),
                  },
                },
              ]
            : []),

          {
            $lookup: {
              from: "bots",
              localField: "conversation.botId",
              foreignField: "_id",
              as: "bot",
            },
          },
          { $unwind: { path: "$bot", preserveNullAndEmptyArrays: true } },

          // Traer todos los mensajes ordenados por fecha ascendente
          {
            $lookup: {
              from: "messages",
              let: { conversationId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$conversationId", "$$conversationId"] },
                  },
                },
                { $sort: { createdAt: -1 } },
                { $limit: 50 }, // Limitar a los últimos 20 mensajes
                // Opcional: proyectá para achicar
                { $project: { role: 1, content: 1, createdAt: 1 } },
              ],
              as: "messages",
            },
          },

          // { $sort: { lastCreatedAt: -1 } },

          {
            $project: {
              _id: 1,
              lastMessage: 1,
              messages: 1,
              "conversation._id": 1,
              "conversation.userId": 1,
              "conversation.active": 1,
              "conversation.createdAt": 1,
              "bot.name": 1,
            },
          },
        ];

        console.log(
          `[JobId: ${newJobId}] Recuperando conversaciones para preguntar a chats con filtros: ${JSON.stringify(
            matchStage
          )}, active: ${active}, botId: ${botId}`
        );

        const results = await Message.aggregate(pipeline);

        console.log(
          `[JobId: ${newJobId}] Conversaciones para preguntar a chats recuperadas exitosamente - total: ${results.length}`
        );

        const MAX_MSGS_PER_CONV = 20;

        let totalMsgs = 0;

        const blocks = results
          .sort(
            (a, b) =>
              new Date(b.lastMessage?.createdAt) -
              new Date(a.lastMessage?.createdAt)
          )
          .map((c, idx) => {
            const msgs = cleanMessages(c.messages || []);
            // Tomamos últimos N si hay muchos
            const take =
              msgs.length > MAX_MSGS_PER_CONV
                ? msgs.slice(-MAX_MSGS_PER_CONV)
                : msgs;
            totalMsgs += take.length;

            const usuario = String(c.conversation?.userId || "").replace(
              "@c.us",
              ""
            );
            const botName = c.bot?.name || "N/A";

            // etiqueta de referencia lista para copiar/pegar
            const refTag = `[Usuario: ${usuario} | Bot: ${botName}]`;

            // ⬇️ Nuevo header sin número, identificando por Usuario y Bot
            const header =
              `### ${refTag}\n` + // <— encabezado usa SOLO el par Usuario|Bot
              `- Activa: ${c.conversation?.active ? "Sí" : "No"}\n`;

            const transcript = take
              ?.map((m) => {
                const who =
                  m.role === "assistant"
                    ? "Bot"
                    : m.role === "user"
                    ? "Usuario"
                    : "System";
                const ts = m.createdAt
                  ? new Date(m.createdAt)
                      .toISOString()
                      .replace("T", " ")
                      .split(".")[0]
                  : "";
                return `(${ts}) ${who}: ${m.content}`;
              })
              .join("\n");

            return `${header}\n${transcript}`;
          });

        if (!blocks.length) {
          console.log(
            `[JobId: ${newJobId}] No hay conversaciones que coincidan con el filtro`
          );

          askRequestQueue.set(newJobId, {
            jobId: newJobId,
            status: "done",
            answer: "No hay conversaciones que coincidan con el filtro.",
            used: { conversations: 0, messages: 0 },
          });
        }

        const systemGuide = `
Sos un asistente que analiza conversaciones entre un usuario y un bot de WhatsApp.
Vas a responder a la consigna del usuario basándote solo en el contexto provisto.
La fecha de hoy es ${getFormattedDateNow()}.

INSTRUCCIONES DE REFERENCIAS (ESTRICTAS):
- En cada conclusión, incluí la referencia EXACTAMENTE usando el texto entre corchetes del encabezado,
  por ejemplo: [Usuario: 3512345678 | Bot: Trivellini 1].
- NO uses “Conversación N”, NO uses IDs internos, NO inventes otros formatos de referencia.
- Si una conclusión combina varias conversaciones, poné todas las referencias, separadas por coma.

Formato de salida:
- Español.
- Conclusiones claras y, al final de cada oración con datos, la(s) referencia(s) en el formato indicado.

Si te falta información, decilo explícitamente.
`.trim();

        const context = `${systemGuide}

CONSIGNA DEL USUARIO:
"${String(prompt).trim()}"

CONVERSACIONES (resumen y transcripción):
${blocks.join("\n\n")}
`;

        // ===== 3) Llamar a OpenAI Responses (gpt-4.1) =====
        const ai = await openaiClient.responses.create({
          ...getModelAndParams(model || "gpt-4.1", 0.2),
          input: context,
        });

        // En Responses, el helper output_text concatena todos los bloques de texto
        const answer = ai.output_text || "Sin respuesta";
        console.log(
          `[JobId: ${newJobId}] Respuesta generada por IA exitosamente: ${answer}`
        );

        const finalResponse = {
          jobId: newJobId,
          status: "done",
          answer,
          used: {
            conversations: results.length,
            messages: totalMsgs,
          },
        };

        // ✅ Seteamos en la cola el resultado final
        askRequestQueue.set(newJobId, finalResponse);
      } catch (bgErr) {
        console.error(
          "Error en procesamiento de respuesta a pregunta a chats:",
          bgErr
        );
        askRequestQueue.delete(newJobId);
      }
    });
  } catch (error) {
    if (newJobId) {
      askRequestQueue.delete(newJobId);
    }
    console.error("Error al obtener conversaciones:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.post("/conversations/ask-presets", async (req, res) => {
  try {
    const askPreset = await AskPreset.findOne({ key: req.body.key });

    let askPresetSaved;
    if (askPreset) {
      askPresetSaved = await AskPreset.findByIdAndUpdate(
        askPreset._id,
        req.body,
        {
          new: true,
        }
      );
    } else {
      askPresetSaved = await AskPreset.create(req.body);
    }

    res.json(askPresetSaved);
  } catch (error) {
    console.error("Error al guardar preset:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.put("/conversations/deactivate/:id", async (req, res) => {
  try {
    const conversationId = req.params.id;
    if (!conversationId) {
      return res.status(400).json({ message: "Conversation ID is required" });
    }

    const conversation = await Conversation.findById(conversationId).lean();
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    const botInitialized = botsInitialized.find(
      (b) => b?._id?.toString() === conversation.botId?.toString()
    );
    console.log(
      "Bot initialized conversations in memory:",
      botInitialized.conversationsInMemory
    );

    if (botInitialized?.conversationsInMemory) {
      // Actualizar la conversación en memoria del bot
      botInitialized.conversationsInMemory.delete(conversation.userId);
    }

    const updatedConversation = await Conversation.findByIdAndUpdate(
      conversationId,
      {
        active: false,
      },
      {
        new: true,
      }
    ).lean();
    res.json(updatedConversation);
  } catch (error) {
    console.error("Error al actualizar conversación:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

const logsDir = path.join(__dirname, "src", "logs");

function colorizeLogLine(line) {
  if (/error:/i.test(line)) {
    return `<span style="color: #c71010;">${line}</span>`;
  }
  if (/warn:/i.test(line)) {
    return `<span style="color: #b9882e;">${line}</span>`;
  }
  if (/info:/i.test(line)) {
    return `<span style="color: green;">${line}</span>`;
  }
  return line;
}

app.get("/logs", (req, res) => {
  fs.readdir(logsDir, (err, files) => {
    if (err) {
      res.status(500).send("Error al leer el directorio de logs.");
      return;
    }

    const logFiles = files.filter((file) => file.endsWith(".log"));
    const selectedLog = req.query.file;

    if (selectedLog && logFiles.includes(selectedLog)) {
      const logPath = path.join(logsDir, selectedLog);
      fs.readFile(logPath, "utf8", (err, data) => {
        if (err) {
          res.status(500).send("Error al cargar el archivo de logs.");
          return;
        }

        // Invertir el orden de las líneas
        const reversedLines = data.trim().split("\n").reverse();
        const coloredLines = reversedLines.map(colorizeLogLine).join("<br>");

        res.send(`
          <html>
            <head>
              <title>Logs - ${selectedLog}</title>
              <style>
                body { font-family: monospace; background: #f4f4f4; padding: 20px; }
                pre { background: #fff; padding: 10px; border: 1px solid #ccc; overflow-x: auto; }
              </style>
            </head>
            <body>
              <a href="/logs">⬅ Volver a la lista</a>
              <h1>Logs - ${selectedLog}</h1>
              <pre>${coloredLines}</pre>
            </body>
          </html>
        `);
      });
    } else {
      // Ordenar archivos del más nuevo al más viejo por fecha de nombre (opcional)
      const sortedFiles = logFiles.sort().reverse();

      res.send(`
        <html>
          <head>
            <title>Lista de Logs</title>
            <style>
              body { font-family: monospace; background: #f4f4f4; padding: 20px; }
              ul { list-style-type: none; padding: 0; }
              li { margin: 4px 0; }
            </style>
          </head>
          <body>
            <h1>Archivos de Logs Disponibles</h1>
            <ul>
              ${sortedFiles
                .map(
                  (file) => `<li><a href="/logs?file=${file}">${file}</a></li>`
                )
                .join("")}
            </ul>
          </body>
        </html>
      `);
    }
  });
});

app.post("/contact/message-flow", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Body is required" });
    }
    if (!req.body.name) {
      return res.status(400).json({ message: "Nombre is required" });
    }

    if (!req.body.phone) {
      return res.status(400).json({ message: "Telefono is required" });
    }

    const existingContact = await Contact.findOne({
      phone: normalizeSpanishPhone(req.body.phone.replace(/\D/g, "")),
      botId: req.body.botId,
    }).lean();
    if (existingContact) {
      return res.status(400).json({
        message: "Ya existe un contacto con este número de teléfono",
      });
    }

    const contact = await Contact.create({
      ...req.body,
      phone: normalizeSpanishPhone(req.body.phone.replace(/\D/g, "")),
    });
    const bot = await Bot.findById(req.body.botId);
    let updatedBotMessageFlow;
    if (bot.mainBotMessageFlow) {
      updatedBotMessageFlow = await BotMessageFlow.findByIdAndUpdate(
        bot.mainBotMessageFlow,
        {
          $push: { contacts: contact._id },
        },
        { new: true }
      );
    } else {
      updatedBotMessageFlow = await BotMessageFlow.findOneAndUpdate(
        {
          botId: bot._id,
        },
        {
          $push: { contacts: contact._id },
        },
        { new: true }
      );
    }

    if (updatedBotMessageFlow) {
      const currentBot = botsInitialized.find(
        (b) => b?._id?.toString() === bot?._id?.toString()
      );
      manageSendBotMessageFlow({
        botId: bot?._id?.toString(),
        botName: currentBot?.name,
        client: currentBot?.whatsappClient,
        prompt: currentBot?.prompt,
        maxMessageCount: currentBot?.maxMessageCount,
        conversationsInMemory: new Map(),
        BotMessageFlow,
        messageFlowQueue,
        executeMessageFlowQueue,
        Conversation,
        Message,
        Contact,
        Appointment,
        retrySettings: currentBot?.retrySettings,
      });
    }

    res.status(201).json(contact);
  } catch (error) {
    console.error("Error al crear el contacto:", error);
    res.status(500).json({ message: "Error al crear el contacto" });
  }
});

app.post("/contact/message-flow/bulk", async (req, res) => {
  try {
    const { contacts, botId } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res
        .status(400)
        .json({ message: "Se requiere un array de contactos" });
    }

    if (!botId) {
      return res.status(400).json({ message: "El botId es requerido" });
    }

    const bot = await Bot.findById(botId);
    if (!bot) {
      return res.status(404).json({ message: "Bot no encontrado" });
    }

    const createdContacts = [];
    const ignoredContacts = [];

    for (const c of contacts) {
      const { name, phone } = c;

      if (!name || !phone) {
        ignoredContacts.push({ ...c, reason: "Campos requeridos faltantes" });
        continue;
      }

      const normalizedPhone = normalizeSpanishPhone(phone.replace(/\D/g, ""));
      const existing = await Contact.findOne({ phone: normalizedPhone, botId });

      if (existing) {
        ignoredContacts.push({
          ...c,
          phone: normalizedPhone,
          reason: "Contacto duplicado",
        });
        continue;
      }

      const newContact = await Contact.create({
        ...c,
        phone: normalizedPhone,
        botId,
      });

      createdContacts.push(newContact);
    }

    if (createdContacts.length > 0) {
      const contactIds = createdContacts.map((c) => c._id);

      let updatedBotMessageFlow;
      if (bot.mainBotMessageFlow) {
        updatedBotMessageFlow = await BotMessageFlow.findByIdAndUpdate(
          bot.mainBotMessageFlow,
          { $push: { contacts: { $each: contactIds } } },
          { new: true }
        );
      } else {
        updatedBotMessageFlow = await BotMessageFlow.findOneAndUpdate(
          { botId: bot._id },
          { $push: { contacts: { $each: contactIds } } },
          { new: true }
        );
      }

      if (updatedBotMessageFlow) {
        const currentBot = botsInitialized.find(
          (b) => b?._id?.toString() === bot?._id?.toString()
        );
        manageSendBotMessageFlow({
          botId: bot._id.toString(),
          botName: currentBot?.name,
          client: currentBot?.whatsappClient,
          prompt: currentBot?.prompt,
          maxMessageCount: currentBot?.maxMessageCount,
          conversationsInMemory: new Map(),
          BotMessageFlow,
          messageFlowQueue,
          executeMessageFlowQueue,
          Conversation,
          Message,
          Contact,
          Appointment,
          retrySettings: currentBot?.retrySettings,
        });
      }
    }

    res.status(201).json({
      createdCount: createdContacts.length,
      created: createdContacts,
      ignored: ignoredContacts,
      message: `${createdContacts.length} contacto(s) creados correctamente.`,
    });
  } catch (error) {
    console.error("Error en carga masiva de contactos:", error);
    res.status(500).json({ message: "Error en la carga masiva de contactos" });
  }
});

app.put("/bot/:botId/main-message-flow/:botMessageFlowId", async (req, res) => {
  try {
    if (!req.params.botId || !req.params.botMessageFlowId) {
      return res
        .status(400)
        .json({ message: "Bot Id and Bot-message-flow Id is required" });
    }

    const bot = await Bot.findByIdAndUpdate(
      {
        _id: req.params.botId,
      },
      {
        mainBotMessageFlow: req.params.botMessageFlowId,
      },
      {
        new: true,
      }
    );
    res.status(200).json(bot);
  } catch (error) {
    console.error("Error al crear el contacto:", error);
    res.status(500).json({ message: "Error al crear el contacto" });
  }
});

app.post("/bot/external-message", async (req, res) => {
  try {
    // deben llegar los campos botId, texto, contactId o nombre y telefono
    if (!req.body || !req.body.content || !req.body.botId) {
      return res
        .status(400)
        .json({ message: "Content and Bot ID are required" });
    }
    if (!req.body.contactId && (!req.body.name || !req.body.phone)) {
      return res
        .status(400)
        .json({ message: "Contact ID or name and phone are required" });
    }

    const bot = await Bot.findById(req.body.botId);
    if (!bot) {
      return res.status(404).json({ message: "Bot not found" });
    }

    let contact;

    if (req.body.contactId) {
      contact = await Contact.findById(req.body.contactId);
      if (!contact && (!req.body.name || !req.body.phone)) {
        return res
          .status(404)
          .json({ message: "Contact not found and name or phone is required" });
      }
    } else {
      contact = await Contact.findOne({
        botId: bot._id,
        phone: req.body.phone,
      });

      if (!contact) {
        const phone = normalizeSpanishPhone(req.body.phone.replace(/\D/g, ""));
        const contactData = contact || {
          name: req.body.name,
          phone,
          email: req.body.email || "",
          description: req.body.description || "",
          botId: bot._id,
        };

        contact = await Contact.create(contactData);
      }
    }
    // el telefono solo debe tener numeros

    const botInitialized = botsInitialized.find(
      (b) => b?._id?.toString() === bot?._id?.toString()
    );

    responseMessage = {
      content: req.body.content,
      contactId: contact._id?.toString(),
      contactName: contact.name,
      contactPhone: contact.phone,
      contactEmail: contact.email,
      contactDescription: contact.description,
      botId: bot._id?.toString(),
    };

    if (botInitialized?.whatsappClient) {
      const { whatsappClient: client, conversationsInMemory } = botInitialized;

      const chatId = `${normalizeSpanishPhone(
        contact.phone?.replace(/\D/g, "")
      )}@c.us`;
      let conversationInMemory = conversationsInMemory?.get(chatId);
      if (!conversationInMemory) {
        // Si no está en memoria, buscamos la conversación en la base de datos
        conversationInMemory = await Conversation.findOne({
          userId: chatId,
          botId: bot._id,
          active: true,
        });
        if (!conversationInMemory) {
          const conversation = new Conversation({
            userId: chatId,
            botId: bot._id,
            retryMesagesActive: !!bot?.retrySettings?.active,
          });
          await conversation.save();

          conversationInMemory = conversationsInMemory.set(chatId, {
            ...conversation.toObject(),
            messages: [],
          });
        }
      }
      await client.sendMessage(chatId, req.body.content);
      responseMessage.status = "sent";
    } else {
      await MessageToSend.create({
        botId: bot._id,
        contactId: contact._id,
        content: req.body.content,
      });
      responseMessage.status = "queued";
    }
    res.status(200).json(responseMessage);
  } catch (error) {
    console.error("Error al crear el contacto:", error);
    res.status(500).json({ message: "Error al crear el contacto" });
  }
});

app.put("/bot/:id/logout", async (req, res) => {
  try {
    const botId = req.params.id;
    if (!botId) {
      return res.status(400).json({ message: "Bot ID is required" });
    }

    const updatedBot = await Bot.findById(botId);
    const botIndex = botsInitialized.findIndex(
      (b) => b._id.toString() === botId
    );

    const botInitalized = botsInitialized[botIndex];
    if (!botInitalized?.whatsappClient) {
      await Bot.findByIdAndUpdate(
        botId,
        { pendingLogout: true },
        { new: true }
      );
    } else {
      const oldClient = botInitalized?.whatsappClient;
      await oldClient?.logout?.();
      const usersToEmit = pendingBotStateRequests.get(botId);
      if (usersToEmit) {
        usersToEmit.users.forEach((user) => {
          user.socket.emit("whatsapp bot state", {
            state: BotConnectionStates.DISCONNECTED,
            userId: user.userId,
            qr: botsInitialized[botIndex]?.qr,
            botId,
          });
        });
      }
      botsInitialized[botIndex].connectionState =
        BotConnectionStates.DISCONNECTED;
      botsInitialized.splice(botIndex, 1);

      await oldClient?.destroy?.(); // Destruir el cliente de WhatsApp

      // borrar carpeta de sesion guardada por puppetteer
      const sessionPath = path.join(
        __dirname,
        ".wwebjs_auth",
        `session-${botId}`
      );
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log("Sesión eliminada para botId:", botId);
      }

      const initClient = async () => {
        const {
          client: newClient,
          conversationsInMemory,
          activeReminders,
          activeRetryMessages,
        } = await initializeWhatsAppClient({
          botId: updatedBot._id,
          botName: updatedBot.name,
          openaiClient,
          model: updatedBot.model,
          temperature: updatedBot.temperature,
          maxMessageCount: updatedBot.maxMessageCount,
          delayResponseFrom: updatedBot.delayResponseFrom,
          delayResponseTo: updatedBot.delayResponseTo,
          prompt: updatedBot.prompt,
          redirectPhone: updatedBot.redirectPhone,
          messageInitTrigger: updatedBot.messageInitTrigger,
          botConversationDefaultActive: updatedBot.botConversationDefaultActive,
          messageManualFinishTrigger: updatedBot.messageManualFinishTrigger,
          activeMessageManualFinishTrigger:
            updatedBot.activeMessageManualFinishTrigger,
          messageCompleteRedirectTrigger:
            updatedBot.messageCompleteRedirectTrigger,
          messageCompleteResponseFinalizated:
            updatedBot.messageCompleteResponseFinalizated,
          activeMessageCompleteRedirectTrigger:
            updatedBot.activeMessageCompleteRedirectTrigger,
          appointmentMessageTrigger: updatedBot.appointmentMessageTrigger,
          activeAppointmentMessageTrigger:
            updatedBot.activeAppointmentMessageTrigger,
          appointmentMessageResponse: updatedBot.appointmentMessageResponse,
          googleRefreshToken: updatedBot.googleRefreshToken,
          reminders: updatedBot.reminders,
          retrySettings: updatedBot.retrySettings,
          validator: updatedBot.validator,
          activeAutoReset: updatedBot.activeAutoReset,
          activeMessagesLimit: updatedBot.activeMessagesLimit,
          messagesLimitCount: updatedBot.messagesLimitCount,
          autoResetTime: updatedBot.autoResetTime,
          bot: updatedBot,
          pendingBotStateRequests,
          BotMessageFlow,
          BotModel: Bot,
          Appointment,
          Contact,
          Conversation,
          Message,
          MessageToSend,
          messageFlowQueue,
          executeMessageFlowQueue,
        });

        updatedBot.whatsappClient = newClient; // Agregar el cliente de WhatsApp al bot actualizado
        updatedBot.conversationsInMemory = conversationsInMemory; // Guardamos las conversaciones en memoria
        updatedBot.activeReminders = activeReminders;
        updatedBot.activeRetryMessages = activeRetryMessages;
        // Si el bot no estaba en la lista, lo agregamos
        botsInitialized.push(updatedBot);
      };

      initClient();
    }

    return res.status(200).json({
      message: "Bot logged out successfully",
    });
  } catch (error) {
    console.error("Error al cerrar sesión del bot:", error);
    res.status(500).json({ message: "Error al cerrar sesión del bot" });
  }
});

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

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`Servidor Express iniciado en puerto ${PORT}`);
  console.log(
    `Swagger docs en: ${
      process.env.API_BASE_URL || `http://localhost:${PORT}`
    }/api-docs`
  );
});
