const Airtable = require("airtable");
const cloudinary = require("cloudinary").v2;

const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
  process.env.AIRTABLE_BASE
);

const baseRecoverYoutHair = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN_RECOVER_YOUR_HAIR }).base(
  process.env.AIRTABLE_BASE_RECOVER_YOUR_HAIR
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function crearLeadAirtableSDK({
  nombre,
  telefono,
  descripcion,
  fotoUrls = [],
  fechaPrimeraLlamada,
  horaPrimeraLlamada,
  airtableUserBase = 'default',
}) {
  try {
    console.log(
      "Creando lead en Airtable:",
      JSON.stringify({ nombre, telefono, descripcion })
    );
    const cfg = airtableUserBase === 'default'
    ? {
        base: base,
        table: process.env.AIRTABLE_TABLE,
        commentsField: 'Comentarios 1',
        dateField: 'Fecha 1ª llamada',
        timeField: 'Hora 1ª llamada',
      }
    : {
        base: baseRecoverYoutHair,
        table: process.env.AIRTABLE_TABLE_RECOVER_YOUR_HAIR,
        commentsField: 'Comentarios',
        dateField: 'Fecha llamada',
        timeField: 'Hora llamada',
      };
    const fields = {
      Nombre: nombre,
      Telefono: telefono,
      [cfg.commentsField]: descripcion || "",
    };

    let uploads = [];
    if (fotoUrls.length > 0) {
      uploads = await Promise.all(
        fotoUrls.map((dataUri) =>
          cloudinary.uploader.upload(dataUri, {
            folder: "leads-temp",
            resource_type: "image",
          })
        )
      );

      const nuevasFotos = uploads.map((u) => ({
        url: u.secure_url,
        filename: u.original_filename,
      }));

      fields["Fotos"] = nuevasFotos;
    }

    if (fechaPrimeraLlamada) {
      fields[cfg.dateField] = fechaPrimeraLlamada; // Formato YYYY-MM-DD
    }
    if (horaPrimeraLlamada) {
      fields[cfg.timeField] = horaPrimeraLlamada; // Formato HH:mm
    }

    const [record] = await cfg
      .base(cfg.table)
      .create([{ fields }]);

    console.log("Lead creado en Airtable:", record.getId());

    if (uploads.length > 0) {
      setTimeout(() => {
        Promise.all(
          uploads.map((u) =>
            cloudinary.uploader.destroy(u.public_id, { resource_type: "image" })
          )
        )
          .then(() => console.log("✅ Imágenes borradas de Cloudinary"))
          .catch((err) =>
            console.error("❌ Error borrando en Cloudinary", err)
          );
      }, 5000);
    }

    return record.getId();
  } catch (error) {
    console.error("Error creando lead en Airtable:", error);
  }
}

// 👉 Nueva función para actualizar un lead existente
async function actualizarLeadAirtableSDK(
  id,
  { nombre, telefono, fotoUrls = [], fechaPrimeraLlamada, horaPrimeraLlamada, airtableUserBase = 'default' }
) {
  try {
    console.log("Actualizando lead en Airtable ID:", id);
    const fields = {};

    if (nombre) fields["Nombre"] = nombre;
    if (telefono) fields["Telefono"] = telefono;
    let uploads = [];
    if (fotoUrls.length > 0) {
      // 1) Traer fotos actuales
      const recordActual = await (airtableUserBase === 'default' ? base : baseRecoverYoutHair)(airtableUserBase === 'default' ? process.env.AIRTABLE_TABLE : process.env.AIRTABLE_TABLE_RECOVER_YOUR_HAIR).find(id);
      const fotosExistentes = recordActual.fields["Fotos"] || [];

      console.log("Fotos existentes en Airtable:", fotosExistentes);

      // 2) Subir todas a Cloudinary (todavía no las borres)
      console.log("Subiendo nuevas fotos a Cloudinary...");
      uploads = await Promise.all(
        fotoUrls.map((dataUri) =>
          cloudinary.uploader.upload(dataUri, {
            folder: "leads-temp",
            resource_type: "image",
          })
        )
      );

      // 3) Preparar objetos para Airtable
      console.log("Nuevas fotos subidas a Cloudinary:", uploads);
      const nuevasFotos = uploads.map((u) => ({
        url: u.secure_url,
        filename: u.original_filename,
      }));

      // 4) Concatenar fotos antiguas con nuevas
      fields["Fotos"] = [...fotosExistentes, ...nuevasFotos];
    }
    if (fechaPrimeraLlamada) {
      fields[airtableUserBase === 'default' ? "Fecha 1ª llamada" : "Fecha llamada"] = fechaPrimeraLlamada; // Formato YYYY-MM-DD
    }
    if (horaPrimeraLlamada) {
      fields[airtableUserBase === 'default' ? "Hora 1ª llamada" : "Hora llamada"] = horaPrimeraLlamada; // Formato HH:mm
    }

    const [record] = await (airtableUserBase === 'default' ? base : baseRecoverYoutHair)(airtableUserBase === 'default' ? process.env.AIRTABLE_TABLE : process.env.AIRTABLE_TABLE_RECOVER_YOUR_HAIR).update([
      { id, fields },
    ]);

    console.log("Lead actualizado en Airtable:", record.getId());

    if (uploads.length > 0) {
      setTimeout(() => {
        Promise.all(
          uploads.map((u) =>
            cloudinary.uploader.destroy(u.public_id, { resource_type: "image" })
          )
        )
          .then(() => console.log("✅ Imágenes borradas de Cloudinary"))
          .catch((err) =>
            console.error("❌ Error borrando en Cloudinary", err)
          );
      }, 5000);
    }

    return record.getId();
  } catch (error) {
    console.error("Error actualizando lead en Airtable:", error);
  }
}

function q(str = "") {
  return String(str).replace(/"/g, '\\"');
}

async function buscarLeadsPorNombreTelefono({ nombre, telefono, airtableUserBase = 'default', }) {
  try {
    const table = (airtableUserBase === 'default' ? base : baseRecoverYoutHair)(airtableUserBase === 'default' ? process.env.AIRTABLE_TABLE : process.env.AIRTABLE_TABLE_RECOVER_YOUR_HAIR);

    console.log("Buscando en Airtable:", JSON.stringify({ nombre, telefono }));

    // AND({Nombre}="Juan", {Telefono}="644158601")
    const filterByFormula = `AND({Nombre}="${q(nombre)}", {Telefono}="${q(
      telefono
    )}")`;

    const records = await table
      .select({
        filterByFormula,
        fields: [
          "Nombre",
          "Telefono",
          "Fotos",
          (airtableUserBase === 'default' ? "Fecha 1ª llamada" : "Fecha llamada"),
          (airtableUserBase === 'default' ? "Hora 1ª llamada" : "Hora llamada"),
        ],
        maxRecords: 50, // ajustá si hace falta
      })
      .all();

    console.log(
      `Airtable: encontrados ${records.length} leads para`,
      JSON.stringify({ nombre, telefono })
    );
    if (records.length === 0) return null;

    // Airtable devuelve en orden ASC por defecto (del más viejo al más nuevo)
    const ultimo = records[records.length - 1];
    return { id: ultimo.id, fields: ultimo.fields };
  } catch (error) {
    console.error("Error buscando leads en Airtable:", error);
    return null;
  }
}

module.exports = {
  crearLeadAirtableSDK,
  actualizarLeadAirtableSDK,
  buscarLeadsPorNombreTelefono,
};
