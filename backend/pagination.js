const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePagination(query = {}, defaultLimit = DEFAULT_LIMIT) {
  const rawLimit = query.limit ?? defaultLimit;
  const rawOffset = query.offset ?? 0;
  const limit = Number.parseInt(rawLimit, 10);
  const offset = Number.parseInt(rawOffset, 10);

  if (!Number.isInteger(limit) || limit <= 0) {
    const error = new Error("limit must be a positive integer");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(offset) || offset < 0) {
    const error = new Error("offset must be zero or greater");
    error.status = 400;
    throw error;
  }

  return {
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  };
}

function paginationParams(req, defaultLimit) {
  return parsePagination(req.query, defaultLimit);
}

function applyPagination(items, req, defaultLimit) {
  const { limit, offset } = paginationParams(req, defaultLimit);
  const total = items.length;
  return {
    items: items.slice(offset, offset + limit),
    total,
    limit,
    offset,
    has_more: offset + limit < total,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  applyPagination,
  paginationParams,
  parsePagination,
};
