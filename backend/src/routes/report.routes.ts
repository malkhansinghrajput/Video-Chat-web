import { Router } from 'express';
import { reportController, adminController } from '../controllers/report.controller';
import { adminAuthMiddleware, authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Protected user routes
router.post('/',         authMiddleware as never, (req, res) => reportController.submitReport(req, res));
router.get('/:reportId', authMiddleware as never, (req, res) => reportController.getReport(req, res));

// Admin routes (TODO: add admin JWT auth in production)
router.get('/admin/reports',         adminAuthMiddleware, (req, res) => adminController.listReports(req, res));
router.post('/admin/reports/:id/action', adminAuthMiddleware, (req, res) => adminController.takeAction(req, res));
router.get('/admin/bans',             adminAuthMiddleware, (req, res) => adminController.listBans(req, res));
router.delete('/admin/bans/:id',      adminAuthMiddleware, (req, res) => adminController.revokeBan(req, res));

export default router;
