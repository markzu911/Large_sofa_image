import express from 'express';
import { NextApiRequest, NextApiResponse } from 'next';

// 1. Next.js API route config for 20mb limit
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

// 2. Express router setup for 20mb limit if used in Express context
const router = express.Router();
router.use(express.json({ limit: '20mb' }));
router.use(express.urlencoded({ limit: '20mb', extended: true }));

export { router };

// Default handler for Next.js compatibility
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ status: 'ok', message: 'Proxy endpoint active with 20mb limit' });
}
