const { logError } = require("../logger");

function friendlyMessage(error, fallbackMessage = "Unable to complete this request.") {
  if (error.code === "ECONNREFUSED" || error.code === "ECONNABORTED" || !error.response) {
    return "Blockchain service is currently unavailable. Please make sure the Vorliq blockchain API is running.";
  }

  return error.response?.data?.message || error.response?.data?.error || fallbackMessage;
}

function handleRouteError(res, error, context, fallbackMessage) {
  const message = friendlyMessage(error, fallbackMessage);
  logError(`${context}: ${error.message}`);
  return res.status(error.response?.status || 503).json({
    success: false,
    message,
  });
}

module.exports = {
  handleRouteError,
};
