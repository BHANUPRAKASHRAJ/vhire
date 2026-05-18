require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));

// Add a logger to see incoming requests in your terminal
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

app.use('/api/auth', express.json());
app.use('/api/auth', require('./routes/auth'));

app.use('/api/user', express.json());
app.use('/api/user', require('./routes/user'));

app.use('/api/courses', express.json());
app.use('/api/courses', require('./routes/courses'));

app.use('/api/admin', express.json());
app.use('/api/admin', require('./routes/admin'));

// Enrollment uses multipart/form-data (multer) — no express.json() here
app.use('/api/enrollment', require('./routes/enrollment'));

app.get('/', (req, res) => res.json({ message: 'Vhire API is running', version: 'v2' }));

app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.url} not found` }));

const server = app.listen(process.env.PORT || 5005, () =>
  console.log(`Server running on port ${server.address().port}`)
);
