# 🤖 Full WhatsApp Bots - Documentación Completa del Proyecto

## 📋 Descripción General

**Full WhatsApp Bots** es una plataforma completa y robusta para la gestión automatizada de conversaciones de WhatsApp a escala empresarial. El sistema utiliza la biblioteca `whatsapp-web.js` para automatizar interacciones a través de WhatsApp Web, integrando inteligencia artificial con OpenAI para proporcionar respuestas contextuales y personalizadas.

## 🏗️ Arquitectura del Sistema

### Stack Tecnológico Principal
- **Backend**: Node.js + Express.js
- **Base de Datos**: MongoDB con Mongoose ODM
- **Inteligencia Artificial**: OpenAI API (GPT modelos)
- **WhatsApp Automation**: whatsapp-web.js
- **API REST**: Endpoints completos para gestión
- **Integraciones**: Google Calendar, Airtable, Cloudinary

### Patrón de Diseño
- **MVC con Interactors**: Controllers → Interactors → Services → Models
- **Sistema de colas**: Gestión concurrente de múltiples bots
- **Event-driven**: Procesamiento basado en eventos de WhatsApp

## 📁 Estructura del Proyecto

```
testing-main/
├── index.js                     # Punto de entrada principal
├── package.json                 # Dependencias y configuración
├── .gitignore                   # Archivos ignorados por Git
├── src/                         # Código fuente
│   ├── config/                  # Configuraciones del sistema
│   │   ├── db.js               # Conexión a base de datos MongoDB
│   │   └── logger.js           # Configuración de logging con Winston
│   ├── models/                  # Modelos de datos (Mongoose)
│   │   ├── bot.js              # Configuración completa del bot
│   │   ├── contact.js          # Contactos de WhatsApp
│   │   ├── conversation.js     # Conversaciones activas
│   │   ├── message.js          # Mensajes individuales
│   │   ├── messageFlow.js      # Flujos de mensajes predefinidos
│   │   ├── botMessageFlow.js   # Flujos específicos por bot
│   │   ├── messageToSend.js    # Cola de mensajes por enviar
│   │   ├── appointment.js      # Gestión de citas/reuniones
│   │   ├── askPreset.js        # Respuestas predefinidas
│   │   └── enums/              # Enumeraciones
│   │       └── botConnectionState.js
│   ├── services/                # Servicios externos
│   │   ├── airtable.service.js # Integración con Airtable CRM
│   │   └── googleCalendar.service.js # Gestión de calendarios
│   ├── utils/                   # Utilidades y helpers
│   │   ├── normalizeSpanishPhone.js # Normalización de teléfonos
│   │   ├── manageQueues.js      # Gestión de colas concurrentes
│   │   └── queue.js            # Sistema de colas
│   └── interactors/             # Lógica de negocio principal
│       └── whatsapp.interactor.js # Interacción con WhatsApp
├── temp/                        # Archivos temporales
└── .wwebjs_auth/               # Sesiones de WhatsApp (auto-generado)
```

## 🚀 Funcionalidades Principales

### 1. Automatización de WhatsApp
- **Múltiples Bots Simultáneos**: Gestión concurrente de hasta 3 bots
- **Autenticación Persistente**: Usando LocalAuth de WhatsApp Web
- **Procesamiento en Tiempo Real**: Respuestas inmediatas a mensajes entrantes

### 2. Inteligencia Artificial Integrada
- **OpenAI GPT Integration**: Respuestas contextuales e inteligentes
- **Configuración de Temperatura**: Control de creatividad de respuestas
- **Context Conversacional**: Mantenimiento de historial de conversación

### 3. Sistema de Flujos Conversacionales
- **Message Flows**: Secuencias predefinidas de mensajes
- **Delays Configurables**: Tiempos de espera entre mensajes
- **Flujos Personalizados por Bot**: Diferentes estrategias por bot

### 4. Gestión de Citas y Recordatorios
- **Google Calendar Integration**: Programación automática de citas
- **Sistema de Recordatorios**: Recordatorios automáticos configurables
- **Reintentos Automáticos**: Reintento si no hay respuesta del usuario

### 5. Lead Generation y CRM
- **Airtable Integration**: Gestión de leads en base de datos externa
- **Calificación Automática**: Sistema de puntuación de leads
- **Validación de Datos**: Verificación de información de contacto

## 🔄 Flujo Principal de la Aplicación

### Proceso: Mensaje WhatsApp → Procesamiento → Respuesta

1. **Inicialización del Sistema**
   ```
   index.js → Conexión MongoDB → Carga de bots activos → Inicio clientes WhatsApp
   ```

2. **Recepción de Mensajes**
   - WhatsApp Web detecta mensaje entrante
   - Sistema extrae información de remitente
   - Verificación de conversación existente

3. **Procesamiento Inteligente**
   - Carga de configuración del bot específico
   - Análisis de contexto conversacional
   - Llamada a OpenAI API con historial relevante

4. **Generación de Respuesta**
   - Procesamiento de respuesta de IA
   - Aplicación de flujos predefinidos (si aplica)
   - Personalización según configuración del bot

5. **Ejecución de Acciones**
   - Envío de respuesta por WhatsApp
   - Almacenamiento en MongoDB
   - Acciones adicionales (citas, recordatorios, CRM)

6. **Gestión de Colas**
   - Procesamiento concurrente de múltiples bots
   - Control de límites de concurrencia
   - Optimización de recursos

## 🎯 Componentes Clave

### Modelo de Bot (`models/bot.js`)
```javascript
{
  name: String,                    // Nombre descriptivo del bot
  model: String,                   // Modelo OpenAI a usar
  temperature: Number,             // Creatividad (0-1)
  prompt: String,                  // System prompt para OpenAI
  triggers: {                      // Configuración de triggers
    startMessage: String,          // Mensaje de inicio
    endMessage: String,            // Mensaje de fin
    redirectUrl: String            // URL para redirección
  },
  reminderConfig: {                // Configuración recordatorios
    enabled: Boolean,
    intervals: [Number],           // Intervalos en minutos
    message: String
  },
  retryConfig: {                   // Configuración reintentos
    enabled: Boolean,
    maxAttempts: Number,
    waitTime: Number
  },
  integrations: {                  // Integraciones externas
    googleCalendar: Boolean,
    airtable: Boolean,
    cloudinary: Boolean
  },
  active: Boolean                  // Estado del bot
}
```

### Modelo de Conversación (`models/conversation.js`)
```javascript
{
  bot: ObjectId,                   // Referencia al bot
  contact: ObjectId,               // Contacto de WhatsApp
  status: String,                  // active, finished, waiting
  lastMessageAt: Date,             // Último mensaje
  retryCount: Number,              // Contador de reintentos
  metadata: Object                 // Información adicional
}
```

### Modelo de Mensaje (`models/message.js`)
```javascript
{
  conversation: ObjectId,          // Conversación asociada
  content: String,                 // Contenido del mensaje
  type: String,                    // text, image, audio, etc.
  direction: String,               // inbound, outbound
  timestamp: Date,                 // Timestamp del mensaje
  metadata: Object                 // Metadata adicional
}
```

### Modelo de Message Flow (`models/messageFlow.js`)
```javascript
{
  name: String,                    // Nombre del flujo
  bot: ObjectId,                   // Bot asociado
  messages: [{
    content: String,               // Contenido del mensaje
    delay: Number,                 // Delay antes de enviar
    conditions: Object             // Condiciones para enviar
  }],
  active: Boolean                  // Estado del flujo
}
```

## 🛠️ Configuración y Despliegue

### Variables de Entorno Requeridas
```env
MONGO_URI=mongodb://localhost:27017/whatsapp-bots
OPENAI_API_KEY=tu_openai_api_key
AIRTABLE_TOKEN=tu_airtable_token
CLOUDINARY_URL=tu_cloudinary_url
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
API_BASE_URL=https://tu-api.com
PORT=3000
NODE_ENV=production
```

### Dependencias Principales
```json
{
  "express": "^4.18.2",
  "mongoose": "^7.2.3",
  "whatsapp-web.js": "^1.19.5",
  "openai": "^4.20.1",
  "qrcode-terminal": "^0.12.0",
  "winston": "^3.10.0",
  "axios": "^1.5.0",
  "cors": "^2.8.5",
  "dotenv": "^16.3.1",
  "moment-timezone": "^0.5.43",
  "airtable": "^0.12.1",
  "cloudinary": "^1.40.0",
  "nodemailer": "^6.9.4",
  "googleapis": "^126.0.1",
  "mime-types": "^2.1.35"
}
```

### Configuración de Logging
- **Sistema**: Winston con rotación diaria
- **Niveles**: info, warn, error, debug
- **Ubicación**: `/logs/`
- **Rotación**: Cada 15 días automáticamente

## 📊 Endpoints Principales

### API REST Completa
- `GET /api/bots` - Listar todos los bots
- `GET /api/bots/:id` - Obtener bot específico
- `POST /api/bots` - Crear nuevo bot
- `PUT /api/bots/:id` - Actualizar bot existente
- `DELETE /api/bots/:id` - Eliminar bot
- `GET /api/conversations` - Listar conversaciones
- `GET /api/conversations/:id` - Obtener conversación específica
- `POST /api/conversations` - Crear nueva conversación
- `GET /api/messages` - Listar mensajes
- `POST /api/messages/send` - Enviar mensaje manual
- `GET /api/appointments` - Listar citas programadas
- `POST /api/appointments` - Crear nueva cita
- `GET /api/stats` - Estadísticas del sistema

### Eventos de WhatsApp
- `qr` - Código QR para autenticación
- `ready` - Cliente listo para recibir mensajes
- `message` - Nuevo mensaje recibido
- `message_ack` - Confirmación de entrega
- `message_create` - Mensaje creado
- `message_revoke_everyone` - Mensaje eliminado

## 🔧 Procesos Especiales

### Sistema de Gestión de Colas
```javascript
// Límite de concurrencia: 3 bots simultáneos
// Procesamiento por lotes para optimizar rendimiento
// Queue con prioridad para mensajes urgentes
const queue = new Queue({
  concurrency: 3,
  autostart: true,
  process: async (job) => {
    // Procesamiento de mensaje
    await processWhatsAppMessage(job.data);
  }
});
```

### Integración con OpenAI
```javascript
// Configuración de retry con backoff exponencial
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    const response = await openai.chat.completions.create({
      model: bot.model,
      messages: conversationHistory,
      temperature: bot.temperature,
      max_tokens: 500
    });
    return response.choices[0].message.content;
  } catch (error) {
    if (attempt === 4) throw error;
    await new Promise(resolve =>
      setTimeout(resolve, Math.pow(2, attempt) * 1000)
    );
  }
}
```

### Procesamiento de Flujos de Mensajes
```javascript
// Ejecución secuencial con delays
for (const step of flow.messages) {
  if (await checkConditions(step.conditions)) {
    await new Promise(resolve =>
      setTimeout(resolve, step.delay * 1000)
    );
    await sendMessage(contact, step.content);
  }
}
```

### Sistema de Recordatorios
```javascript
// Configuración de recordatorios automáticos
const scheduleReminders = (conversation, intervals) => {
  intervals.forEach(async (interval, index) => {
    setTimeout(async () => {
      if (conversation.status === 'waiting') {
        await sendReminder(conversation, bot.reminderConfig.message);
        conversation.retryCount++;
        await conversation.save();
      }
    }, interval * 60 * 1000);
  });
};
```

## 📈 Métricas y Monitoreo

### KPIs Principales
- **Tiempo de Respuesta**: Promedio < 5 segundos
- **Tasa de Conversión**: % de conversaciones exitosas
- **Engagement**: Número de mensajes por conversación
- **Leads Generados**: Contactos calificados por mes
- **Citas Programadas**: Citas confirmadas vía bot
- **Costo por Mensaje**: Uso de tokens OpenAI

### Sistema de Monitoreo
- **Logs en Tiempo Real**: Winston con visualización web
- **Métricas de Rendimiento**: Response time, throughput
- **Alertas Automáticas**: Para errores y caídas
- **Dashboard Web**: Interfaz de monitoreo integrada

## 🔐 Seguridad

### Medidas Implementadas
- **Autenticación de Sesión**: LocalAuth de WhatsApp Web
- **Validación de Inputs**: Sanitización de todos los datos
- **Rate Limiting**: Límites de peticiones por IP
- **CORS Configurado**: Restricción de dominios permitidos
- **Environment Variables**: Configuración sensible protegida
- **Error Handling**: Manejo seguro de excepciones

### Buenas Prácticas
- **Principle of Least Privilege**: Mínimos permisos necesarios
- **Regular Updates**: Actualización constante de dependencias
- **Backup Strategy**: Backups automáticos de MongoDB
- **Audit Logs**: Registro de acciones críticas

## 🚀 Rendimiento y Escalabilidad

### Optimizaciones
- **Connection Pooling**: MongoDB con pool optimizado
- **Lazy Loading**: Carga bajo demanda de datos
- **Caching**: Redis para respuestas frecuentes
- **Compression**: Gzip para respuestas HTTP
- **Queue Management**: Procesamiento asíncrono eficiente

### Escalabilidad
- **Horizontal Scaling**: Soporte para múltiples instancias
- **Load Balancing**: Distribución automática de carga
- **Database Sharding**: MongoDB sharding soportado
- **CDN Integration**: Cloudinary para assets estáticos
- **Microservices Architecture**: Desacoplamiento de servicios

## 🔄 Flujo de Trabajo Recomendado

### Configuración Inicial
1. **Setup Base de Datos**: MongoDB Atlas o local
2. **Configurar Variables de Entorno**: API keys y URLs
3. **Crear Primer Bot**: Configuración básica con OpenAI
4. **Probar Flujo**: Mensajes de prueba y validación
5. **Desplegar**: Producción con monitorización

### Operación Diaria
- **Monitoreo de Logs**: Revisión constante de errores
- **Métricas de Rendimiento**: Análisis de KPIs
- **Actualización de Prompts**: Optimización de respuestas IA
- **Gestión de Colas**: Monitoreo de procesamiento
- **Backups**: Verificación de respaldos automáticos

### Mantenimiento
- **Actualización de Dependencias**: Seguridad y rendimiento
- **Optimización de Base de Datos**: Índices y consultas
- **Testing**: Pruebas unitarias y de integración
- **Documentation**: Actualización de documentación técnica

## 📞 Casos de Uso

### Atención al Cliente Automatizada
- **Respuestas 24/7**: Disponibilidad continua
- **Clasificación de Solicitudes**: Enrutamiento automático
- **Resolución de Dudas Frecuentes**: FAQ automatizado
- **Escalamiento Humano**: Transferencia a operador cuando necesario

### Ventas y Lead Generation
- **Calificación Automática**: Puntuación de prospectos
- **Seguimiento Inteligente**: Recordatorios personalizados
- **Agendamiento de Citas**: Integración con calendarios
- **CRM Integration**: Sincronización con Airtable

### Notificaciones y Comunicaciones
- **Alertas Automáticas**: Estado de pedidos, citas, etc.
- **Campañas Masivas**: Envío controlado de mensajes
- **Encuestas y Feedback**: Recolección de opiniones
- **Documentación Automática**: Generación de tickets

## 🌟 Características Avanzadas

### Inteligencia Artificial Contextual
- **Memoria Conversacional**: Historial persistente
- **Análisis de Sentimientos**: Detección de emociones
- **Generación de Resúmenes**: Compresión de conversaciones largas
- **Traducción Automática**: Soporte multiidioma

### Automatización de Procesos
- **Workflows Personalizados**: Flujos configurable
- **Trigger Events**: Eventos automáticos basados en condiciones
- **Webhooks Integration**: Conexión con sistemas externos
- **API Extensions**: Endpoints personalizados

### Analytics y Reporting
- **Dashboard Interactivo**: Visualización de métricas
- **Reportes Automáticos**: Generación programada
- **Exportación de Datos**: CSV, JSON, PDF
- **Integración BI**: Conexión con herramientas de análisis

---

**Última actualización**: Noviembre 2024
**Versión**: 2.0.0
**Estado**: Producción estable

Este proyecto representa una solución empresarial completa para la automatización de WhatsApp, con capacidades avanzadas de IA, integraciones múltiples y arquitectura escalable para manejar alto volumen de conversaciones.