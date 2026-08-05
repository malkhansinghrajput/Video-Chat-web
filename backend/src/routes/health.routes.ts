import { Router } from 'express';
import { healthController, analyticsController } from '../controllers/health.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Health probes (public)
router.get('/',        (req, res) => healthController.basic(req, res));
router.get('/live',    (req, res) => healthController.liveness(req, res));
router.get('/ready',   (req, res) => healthController.readiness(req, res));
router.get('/detailed',(req, res) => healthController.detailed(req, res));

// Analytics (admin only in prod, open in dev)
router.get('/analytics/live', (req, res) => analyticsController.getLiveStats(req, res));

export default router;
