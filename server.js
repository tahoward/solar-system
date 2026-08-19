import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './src/utils/Logger.js';

/**
 * Serves the production build over HTTP.
 *
 * Only needed for running the built output outside a static host; development goes through
 * Vite's own server instead.
 */

/**
 * This file's own path.
 *
 * Reconstructed from the module URL because `__filename` is a CommonJS variable and this is an
 * ES module, where it does not exist.
 *
 * @type {string}
 */
const __filename = fileURLToPath(import.meta.url);

/**
 * The directory this file sits in, which is also the project root.
 *
 * Paths are resolved against this rather than the working directory, so the server can be
 * started from anywhere.
 *
 * @type {string}
 */
const __dirname = path.dirname(__filename);

/** @type {import('express').Express} The Express application. */
const app = express();

/**
 * Port to listen on.
 *
 * Taken from the environment where set, so a host that assigns one is respected; 3000 otherwise.
 *
 * @type {number|string}
 */
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'dist')));

/**
 * Serves the page for anything the static middleware did not match.
 *
 * Registered after the static handler, so real files win and only unmatched paths reach here.
 *
 * @param {import('express').Request} req - The request.
 * @param {import('express').Response} res - The response.
 * @returns {void}
 */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  log.info('Server', `🚀 Solar System running at: http://localhost:${PORT}`);
  log.info('Server', `📁 Serving from: ${path.join(__dirname, 'dist')}`);
});