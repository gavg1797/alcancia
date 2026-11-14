/* Configuración de Alcancía.
 * Usa el mismo ID de cliente OAuth de Google que Atril (es público por diseño, no es un secreto).
 * Guía: README.md → «Conectar con Google Sheets». */
window.ALCANCIA_CONFIG = {
  googleClientId: "578654012300-nqaf1rh037cp4i9vc0k8k84hbjpn489v.apps.googleusercontent.com",
  proyecto: "578654012300",
  nombreHoja: "Alcancía - finanzas",
  tipoCambio: 500          // colones por dólar; se cambia en Ajustes
};
