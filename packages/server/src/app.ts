import express from 'express';
import cors from 'cors';
import { configRouter } from './routes/config';
import { emailRouter } from './routes/email';
import { processRouter } from './routes/process';

export const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/config', configRouter);
app.use('/api/email', emailRouter);
app.use('/api/process', processRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'operational', timestamp: Date.now() });
});
