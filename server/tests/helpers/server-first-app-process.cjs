'use strict';

// Load the complete copied entry point. Only the listener is adapted: an ephemeral
// loopback port avoids exposing the synthetic office or colliding with real servers.
const http = require('node:http');
const path = require('node:path');
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (_port, callback) {
  if (arguments.length !== 2 || typeof callback !== 'function') {
    throw new Error('The application listener changed; review the test adapter.');
  }
  return listen.call(this, 0, '127.0.0.1', () => {
    callback();
    process.send({ type: 'ready', port: this.address().port });
  });
};
require(path.join(process.argv[2], 'index.js'));
