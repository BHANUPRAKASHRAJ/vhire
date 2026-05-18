require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ✅ CORS — update origin for production
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// ✅ Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Routes
app.use('/api/auth', express.json(), require('./routes/auth'));
app.use('/api/user', express.json(), require('./routes/user'));
app.use('/api/courses', express.json(), require('./routes/courses'));
app.use('/api/admin', express.json(), require('./routes/admin'));
app.use('/api/enrollment', require('./routes/enrollment')); // multer handles body parsing

// ✅ Health check
app.get('/', (req, res) => res.json({ message: 'Vhire API is running', version: 'v2' }));

// ✅ 404 handler
app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.url} not found` }));

// ✅ Local dev server only (Vercel doesn’t need listen)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5005;
  app.listen(PORT, () => console.log(`Server running locally on port ${PORT}`));
}

// ✅ Export for Vercel
module.exports = app;
