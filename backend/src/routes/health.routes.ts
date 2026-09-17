import { Router } from 'express';
import { healthController, analyticsController } from '../controllers/health.controller';
import { adminAuthMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Health probes (public - minimal info only)
router.get('/',      (req, res) => healthController.basic(req, res));
router.get('/live',  (req, res) => healthController.liveness(req, res));
router.get('/ready', (req, res) => healthController.readiness(req, res));

// Detailed health - admin only (contains internal stats)
router.get('/detailed', adminAuthMiddleware, (req, res) => healthController.detailed(req, res));

// Live analytics - admin only (full internal stats)
router.get('/analytics/live', adminAuthMiddleware, (req, res) => analyticsController.getLiveStats(req, res));

// Public online count - safe subset for the landing page (no auth required)
router.get('/analytics/count', (req, res) => analyticsController.getPublicCount(req, res));

export default router;