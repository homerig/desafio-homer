import { loadEnvFile } from 'node:process';
try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const { openDatabase } = await import('./db.js');
const { createApp } = await import('./app.js');
const db = openDatabase();
const { app, stop } = createApp(db);
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`CumpleApp lista en http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stop(); server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
});
