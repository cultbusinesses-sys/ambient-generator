/**
 * server/index.js
 * ---------------
 * Express server for Ambient Generator backend rendering.
 * Deployed on Railway. Frontend stays on Netlify unchanged.
 *
 * Routes:
 *   GET  /health          — health check (Railway uses this)
 *   POST /api/render      — render audio or video, stream file back
 *   GET  /api/progress/:id — SSE stream of render progress
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const renderRoute = require('./routes/render');

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// CORS — allow your Netlify frontend (and localhost for dev)
// ---------------------------------------------------------------------------
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin) return cb(null, true);
    if (process.env.FRONTEND_URL === '*') return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods:     ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Health check — Railway pings this to know the server is alive
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'ambient-generator-server',
    time:    new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api', renderRoute);

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[Ambient Generator Server] listening on port ${PORT}`);
  console.log(`[CORS] allowed origins: ${allowedOrigins.join(', ') || 'all'}`);
});
