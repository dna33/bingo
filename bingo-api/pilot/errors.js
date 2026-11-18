module.exports = function failure(status, message) {
  return Object.assign(new Error(message), { status });
};
