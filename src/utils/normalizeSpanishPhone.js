function normalizeSpanishPhone(numero) {
  // Eliminar espacios, guiones o paréntesis
  let limpio = numero.replace(/[\s\-()]/g, '');

  // Validar si tiene exactamente 9 dígitos y empieza por 6 o 7
  const esMovilEspanol = /^[67]\d{8}$/.test(limpio);

  if (esMovilEspanol) {
    return '34' + limpio;
  }

  return limpio; // Devuelve el número tal cual si no aplica
}

module.exports = normalizeSpanishPhone;