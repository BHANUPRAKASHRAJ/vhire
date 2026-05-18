const express = require('express');
const { courses, allAccessPlans } = require('../data/courses');

const router = express.Router();

router.get('/plans', (req, res) => res.json(allAccessPlans));

router.get('/', (req, res) =>
  res.json(courses.map(({ id, name, price, category, duration, description }) =>
    ({ id, name, price, category, duration, description })
  ))
);

router.get('/:id', (req, res) => {
  const course = courses.find((c) => c.id === parseInt(req.params.id));
  if (!course) return res.status(404).json({ message: 'Course not found' });
  res.json(course);
});

module.exports = router;
