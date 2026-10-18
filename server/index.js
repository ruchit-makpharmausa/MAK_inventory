import { createApp } from './app.js';
import { closePool } from './database.js';

const port = Number(process.env.PORT || 3001);
const app = createApp();
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`MAK Inventory listening at http://localhost:${port} (SQL Server)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(async () => { await closePool(); process.exit(0); }));
}
