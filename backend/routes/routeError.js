const { logError } = require("../logger");
const { sendError } = require("../utils/apiResponse");

function friendlyMessage(error, fallbackMessage = "Unable to complete this request.") {
  if (error.code === "ECONNREFUSED" || error.code === "ECONNABORTED" || !error.response) {
    return "Blockchain service is currently unavailable. Please make sure the Vorliq blockchain API is running.";
  }

  return error.response?.data?.message || error.response?.data?.error || fallbackMessage;
}

function handleRouteError(res, error, context, fallbackMessage) {
  const message = friendlyMessage(error, fallbackMessage);
  const requestId = res.req?.requestId || "unknown";
  logError(`[${requestId}] ${context}: ${error.message}`);
  return sendError(res, error.response?.status || error.status || 503, "UPSTREAM_ERROR", message);
}

module.exports = {
  handleRouteError,
};
