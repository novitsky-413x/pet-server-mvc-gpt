const express = require('express');
const isAuth = require('../middleware/is-auth');

const router = express.Router();

router.get('/', (req, res) => {
    if (req.session && req.session.isLoggedIn) {
        return res.render('landing-auth', { pageTitle: 'Home', path: '/' });
    }
    res.render('landing', { pageTitle: 'Welcome', path: '/' });
});

router.get('/chat', isAuth, (req, res) => {
    res.render('chat', { pageTitle: 'Chat', path: '/chat' });
});

module.exports = router;
