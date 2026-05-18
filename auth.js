const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { courses, allAccessPlans } = require('../data/courses');

const router = express.Router();

const DB        = path.join(__dirname, '../data/enrollments.json');
const USERS_DB  = path.join(__dirname, '../data/users.json');
const ADMINS_DB = path.join(__dirname, '../data/admins.json');

const read = () => {
  try {
    return fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf-8')) : [];
  } catch (err) {
    console.error("Error reading enrollments:", err);
    return [];
  }
};
const write      = (d) => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const readUsers = () => {
  try {
    return fs.existsSync(USERS_DB) ? JSON.parse(fs.readFileSync(USERS_DB, 'utf-8')) : [];
  } catch (err) {
    console.error("Error reading users:", err);
    return [];
  }
};
const writeUsers = (d) => fs.writeFileSync(USERS_DB, JSON.stringify(d, null, 2));
const readAdmins = () => fs.existsSync(ADMINS_DB) ? JSON.parse(fs.readFileSync(ADMINS_DB, 'utf-8')) : [];
const writeAdmins = (d) => fs.writeFileSync(ADMINS_DB, JSON.stringify(d, null, 2));

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || 'vhire_admin_secret_2024';

const adminAuth = (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Admin token required' });
  try {
    req.admin = jwt.verify(token, ADMIN_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

const signAdminToken = (admin) =>
  jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, ADMIN_SECRET, { expiresIn: '12h' });

router.post('/signup', async (req, res) => {
  const { name, email, password, inviteCode } = req.body;
  if (!name || !email || !password || !inviteCode)
    return res.status(400).json({ message: 'All fields including invite code are required' });

  if (inviteCode !== 'VHIRE_ADMIN_INVITE_2024')
    return res.status(403).json({ message: 'Invalid invite code' });

  const admins = readAdmins();
  if (admins.find((a) => a.email === email))
    return res.status(409).json({ message: 'Admin with this email already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const admin = { id: Date.now().toString(), name, email, password: hashed, createdAt: new Date().toISOString() };
  writeAdmins([...admins, admin]);

  res.status(201).json({ token: signAdminToken(admin), admin: { id: admin.id, name, email } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email and password are required' });

  const admins = readAdmins();
  const admin = admins.find((a) => a.email === email);
  if (!admin) return res.status(401).json({ message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });

  res.json({ token: signAdminToken(admin), admin: { id: admin.id, name: admin.name, email } });
});

const enrich = (e, users) => {
  const user = users.find((u) => u.id === e.userId);
  let itemName = '';
  let rawAmount = e.amount;

  if (e.type === 'single') {
    const course = courses.find((c) => String(c.id) === String(e.courseId));
    itemName = course?.name || 'Single Course';
    if (!rawAmount && course) rawAmount = course.price;
  } else {
    const plan = allAccessPlans.find((p) => String(p.id) === String(e.planId));
    itemName = plan?.name || `Plan (${e.planId})`;
    if (!rawAmount && plan) rawAmount = plan.price;
  }

  const numericAmount = parseInt(String(rawAmount || 0).replace(/[^0-9]/g, '') || '0', 10);

  return {
    ...e,
    enrollmentId: e.id,
    userName:  user?.name  || e.name  || 'Unknown',
    userEmail: user?.email || '—',
    mobile:    e.mobile    || '—',
    age:       e.age       || '—',
    courseName: e.type === 'single' ? itemName : undefined,
    planName: e.type !== 'single' ? itemName : undefined,
    amount: numericAmount,
    screenshotFile: e.screenshotPath ? path.basename(e.screenshotPath) : undefined
  };
};

router.get('/stats', adminAuth, (req, res) => {
  const users = readUsers();
  const enrollments = read();

  let activeEnrollments = 0;
  let pendingEnrollments = 0;
  let rejectedEnrollments = 0;
  let totalRevenue = 0;
  let pendingRevenue = 0;

  enrollments.forEach(e => {
    const enriched = enrich(e, users);
    if (e.status === 'active') {
      activeEnrollments++;
      totalRevenue += enriched.amount;
    } else if (e.status === 'pending') {
      pendingEnrollments++;
      pendingRevenue += enriched.amount;
    } else if (e.status === 'rejected') {
      rejectedEnrollments++;
    }
  });

  res.json({
    totalUsers: users.length,
    totalEnrollments: enrollments.length,
    pendingEnrollments,
    activeEnrollments,
    rejectedEnrollments,
    totalRevenue,
    pendingRevenue
  });
});

router.get('/enrollments', adminAuth, (req, res) => {
  const { status = 'all' } = req.query;
  const users = readUsers();
  let enrollments = read().map(e => enrich(e, users));
  
  if (status !== 'all') {
    enrollments = enrollments.filter(e => e.status === status);
  }

  enrollments.sort((a, b) => new Date(b.submittedAt || b.purchasedAt || 0) - new Date(a.submittedAt || a.purchasedAt || 0));
  
  res.json(enrollments);
});

router.get('/users', adminAuth, (req, res) => {
  const users = readUsers();
  const enrollments = read().map(e => enrich(e, users));

  const enrichedUsers = users.map(u => {
    const userEnrollments = enrollments.filter(e => e.userId === u.id);
    const activeEnrollments = userEnrollments.filter(e => e.status === 'active');
    const totalPaid = activeEnrollments.reduce((sum, e) => sum + e.amount, 0);
    const activeCourses = activeEnrollments.map(e => e.courseName || e.planName);
    
    const latestEnrollment = userEnrollments.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0];

    return {
      ...u,
      enrollmentCount: userEnrollments.length,
      activeCourses,
      totalPaid,
      mobile: latestEnrollment?.mobile || '—',
      age: latestEnrollment?.age || '—',
      createdAt: u.createdAt || new Date().toISOString()
    };
  });

  res.json(enrichedUsers);
});

router.get('/screenshot/:filename', adminAuth, (req, res) => {
  const { filename } = req.params;
  const enrollment = read().find((e) => 
    (e.screenshotPath && e.screenshotPath.includes(filename)) || e.id === filename
  );

  let filePath = '';
  if (enrollment && enrollment.screenshotPath) {
    filePath = path.resolve(enrollment.screenshotPath);
  } else {
    filePath = path.join(__dirname, '../screenshots', filename); 
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: 'Screenshot file not found' });
  }
});

router.post('/approve/:enrollmentId', adminAuth, (req, res) => {
  const all = read();
  const idx = all.findIndex((e) => e.id === req.params.enrollmentId);
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  all[idx].status = 'active';
  all[idx].approvedAt = new Date().toISOString();
  write(all);
  res.json({ success: true, message: 'Enrollment approved' });
});

router.post('/reject/:enrollmentId', adminAuth, express.json(), (req, res) => {
  const all = read();
  const idx = all.findIndex((e) => e.id === req.params.enrollmentId);
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  all[idx].status = 'rejected';
  all[idx].rejectionReason = req.body?.reason || 'Payment could not be verified.';
  all[idx].rejectedAt = new Date().toISOString();
  write(all);
  res.json({ success: true, message: 'Enrollment rejected' });
});

router.delete('/user/:userId', adminAuth, (req, res) => {
  const users = readUsers();
  const filteredUsers = users.filter(u => u.id !== req.params.userId);
  writeUsers(filteredUsers);

  const enrollments = read();
  const filteredEnrollments = enrollments.filter(e => e.userId !== req.params.userId);
  write(filteredEnrollments);

  res.json({ success: true, message: 'User deleted' });
});

module.exports = router;
