const API_VERSION = "1";
const API_STABILITY = "stable";

function success(data = {}, message = "OK", extra = {}) {
  return {
    success: true,
    message,
    ...data,
    ...extra,
  };
}

function error(status, code, message, details = {}, requestId = undefined) {
  return {
    status,
    body: {
      success: false,
      message,
      error: {
        code,
        message,
        details: details && typeof details === "object" ? details : {},
      },
      request_id: requestId,
    },
  };
}

function sendError(res, status, code, message, details = {}) {
  const response = error(status, code, message, details, res.req?.requestId);
  return res.status(response.status).json(response.body);
}

module.exports = {
  API_STABILITY,
  API_VERSION,
  error,
  sendError,
  success,
};
