import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './src/utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  log.info('Server', `🚀 Solar System running at: http://localhost:${PORT}`);
  log.info('Server', `📁 Serving from: ${path.join(__dirname, 'dist')}`);
});