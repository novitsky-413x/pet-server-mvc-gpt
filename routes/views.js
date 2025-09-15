const express = require('express');
const isAuth = require('../middleware/is-auth');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('landing', { pageTitle: 'Welcome', path: '/' });
});

router.get('/chat', isAuth, (req, res) => {
    res.render('chat', { pageTitle: 'Chat', path: '/chat' });
});

module.exports = router;
