'use strict';

// Passenger loads app.js using require(). Keep this wrapper CommonJS, while
// server/package.json retains type=module for the Express application.
module.exports = import('./server/index.js').catch(error => {
  console.error('Push API startup failed:', error.message);
  process.exitCode = 1;
});
