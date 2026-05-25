/*! node-domexception dummy */
module.exports = globalThis.DOMException || class DOMException extends Error {
  constructor(message, name) {
    super(message);
    this.name = name || 'Error';
  }
};
