import { Router } from 'express';
import { sessionController } from '../controllers/session.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { sessionInitRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// Public
router.post('/init',     sessionInitRateLimiter, (req, res) => sessionController.init(req, res));
router.get('/validate',                          (req, res) => sessionController.validate(req, res));

// Protected
router.get('/iceservers', authMiddleware as never, (req, res) => sessionController.getIceServers(req, res));

export default router;
