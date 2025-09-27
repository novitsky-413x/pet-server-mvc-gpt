const express = require('express');
const isAuth = require('../middleware/is-auth');
const https = require('https');

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

// Public route serving the latest game client HTML from GitHub
router.get('/game', async (req, res, next) => {
    const rawBase = 'https://raw.githubusercontent.com/novitsky-413x/c-dungeon/main/';
    const htmlUrl = rawBase + 'webclient.html';

    function fetchWithRedirect(url, maxRedirects = 3) {
        return new Promise((resolve, reject) => {
            const get = (targetUrl, redirectsLeft) => {
                https
                    .get(targetUrl, (resp) => {
                        const status = resp.statusCode || 0;
                        if (status >= 300 && status < 400 && resp.headers.location && redirectsLeft > 0) {
                            resp.resume();
                            return get(resp.headers.location, redirectsLeft - 1);
                        }
                        if (status < 200 || status > 299) {
                            return reject(new Error('Failed to fetch: ' + status));
                        }
                        const chunks = [];
                        resp.on('data', (d) => chunks.push(d));
                        resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                    })
                    .on('error', reject);
            };
            get(url, maxRedirects);
        });
    }

    try {
        let html = await fetchWithRedirect(htmlUrl);
        // Ensure relative asset URLs resolve against the GitHub raw base
        if (html.includes('<head')) {
            html = html.replace(
                /<head(\s*[^>]*)>/i,
                (m) => `${m}<base href="${rawBase}">`
            );
        } else {
            html = `<head><base href="${rawBase}"></head>` + html;
        }
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
