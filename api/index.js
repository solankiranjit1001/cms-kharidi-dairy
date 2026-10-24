// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
import { handle } from '../lib/router.js';

export default function handler(req, res) {
  return handle(req, res);
}
