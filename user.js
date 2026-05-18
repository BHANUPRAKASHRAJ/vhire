const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const router = express.Router();
const DB = path.join(__dirname, '../data/enrollments.json');
const { courses, allAccessPlans } = require('../data/courses');

// Screenshots dir
const screenshotsDir = path.join(__dirname, '../data/screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

// Multer
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, screenshotsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Helpers
const read = () => fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf-8')) : [];
const write = (data) => fs.writeFileSync(DB, JSON.stringify(data, null, 2));

// Get userId from token — returns null if invalid
const getUserId = (req) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.id;
  } catch {
    return null;
  }
};

// POST /api/enrollment/single
router.post('/single', upload.single('paymentScreenshot'), (req, res) => {
  console.log('BODY:', req.body);
  console.log('FILE:', req.file);

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: 'Please login again' });
  if (!req.file) return res.status(400).json({ message: 'Payment screenshot is required' });

  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  const all = read();

  if (all.some((e) => e.fileHash === fileHash))
    return res.status(409).json({ message: 'This screenshot was already used. Upload a new one.' });

  const entry = {
    id: Date.now().toString(),
    userId,
    type: 'single',
    courseId: req.body.courseId || null,
    planId: null,
    name: req.body.name || '',
    age: req.body.age || '',
    mobile: req.body.mobile || '',
    status: 'pending',
    fileHash,
    screenshotFile: req.file.filename,
    screenshotPath: req.file.path,
    amount: req.body.amount || 0,
    submittedAt: new Date().toISOString(),
    expiresAt: null,
  };

  write([...all, entry]);
  res.status(201).json({ success: true, status: 'pending' });
});

// POST /api/enrollment/plan
router.post('/plan', upload.single('paymentScreenshot'), (req, res) => {
  console.log('BODY:', req.body);
  console.log('FILE:', req.file);

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: 'Please login again' });
  if (!req.file) return res.status(400).json({ message: 'Payment screenshot is required' });

  const { planId, duration } = req.body;
  if (!planId) return res.status(400).json({ message: 'planId is required' });

  const plan = allAccessPlans.find((p) => String(p.id) === String(planId));
  const months = parseInt(duration) || (plan ? plan.duration : 3);
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + months);

  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  const all = read();

  if (all.some((e) => e.fileHash === fileHash))
    return res.status(409).json({ message: 'This screenshot was already used. Upload a new one.' });

  const entry = {
    id: Date.now().toString(),
    userId,
    type: 'plan',
    courseId: null,
    planId,
    name: req.body.name || '',
    age: req.body.age || '',
    mobile: req.body.mobile || '',
    status: 'pending',
    duration: months,
    fileHash,
    screenshotFile: req.file.filename,
    screenshotPath: req.file.path,
    amount: plan ? plan.price : 0,
    submittedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  write([...all, entry]);
  res.status(201).json({ success: true, status: 'pending', expiresAt: entry.expiresAt });
});

// GET /api/enrollment/my-courses
router.get('/my-courses', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const now = new Date();
  const result = read()
    .filter((e) => e.userId === userId)
    .map((e) => {
      let status = e.status;
      if (status === 'active' && e.expiresAt && new Date(e.expiresAt) <= now) status = 'expired';
      if (e.type === 'single') {
        const course = courses.find((c) => String(c.id) === String(e.courseId));
        return { ...e, status, courseName: course?.name || 'Course', courseLink: status === 'active' ? course?.link : null };
      }
      const plan = allAccessPlans.find((p) => String(p.id) === String(e.planId));
      return { ...e, status, planName: plan?.name || 'Plan' };
    });

  res.json(result);
});

// GET /api/enrollment/check/:courseId
router.get('/check/:courseId', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const now = new Date();
  const courseId = req.params.courseId;
  const course = courses.find((c) => String(c.id) === String(courseId));
  if (!course) return res.status(404).json({ message: 'Course not found' });

  const enrollments = read().filter((e) => e.userId === userId);

  const single = enrollments.find((e) => e.type === 'single' && String(e.courseId) === String(courseId));
  if (single) {
    if (single.status === 'active') return res.json({ hasAccess: true, reason: 'single', courseLink: course.link });
    if (single.status === 'pending') return res.json({ hasAccess: false, reason: 'pending' });
    if (single.status === 'rejected') return res.json({ hasAccess: false, reason: 'rejected', rejectionReason: single.rejectionReason });
  }

  const plans = enrollments.filter((e) => e.type === 'plan');
  const pendingPlan = plans.find((e) => e.status === 'pending');
  if (pendingPlan) return res.json({ hasAccess: false, reason: 'pending' });

  const activePlan = plans.find((e) => e.status === 'active' && new Date(e.expiresAt) > now);
  if (activePlan) return res.json({ hasAccess: true, reason: 'plan', expiresAt: activePlan.expiresAt, courseLink: course.link });

  const rejectedPlan = plans.find((e) => e.status === 'rejected');
  if (rejectedPlan) return res.json({ hasAccess: false, reason: 'rejected', rejectionReason: rejectedPlan.rejectionReason });

  const expiredPlan = plans.filter((e) => e.status === 'active').sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt))[0];
  if (expiredPlan) return res.json({ hasAccess: false, reason: 'expired', expiresAt: expiredPlan.expiresAt });

  res.json({ hasAccess: false, reason: 'none' });
});

module.exports = router;
