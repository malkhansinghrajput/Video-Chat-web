import { Router } from 'express';
import { reportController } from '../controllers/report.controller';
import { adminAuthMiddleware, authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Protected user routes
router.post('/',         authMiddleware as never, (req, res) => reportController.submitReport(req, res));
router.get('/:reportId', authMiddleware as never, (req, res) => reportController.getReport(req, res));

// Admin routes
router.get('/admin/reports',            adminAuthMiddleware, (req, res) => reportController.listReports(req, res));
router.post('/admin/reports/:id/action', adminAuthMiddleware, (req, res) => reportController.actionReport(req, res));
router.get('/admin/bans',               adminAuthMiddleware, (req, res) => reportController.listBans(req, res));
router.delete('/admin/bans/:id',        adminAuthMiddleware, (req, res) => reportController.liftBan(req, res));

export default router;
