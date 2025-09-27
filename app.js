require('dotenv').config();
const mongoPass = process.env.MONGO_PASS;
const mongoUser = process.env.MONGO_USER;
const mongoAddr = process.env.MONGO_ADDR;
const MONGODB_URI = `mongodb+srv://${mongoUser}:${mongoPass}@${mongoAddr}/pet-server-mvc-gpt`;
// const MONGODB_URI = `mongodb+srv://${mongoUser}:${mongoPass}@${mongoAddr}/pet-server-mvc-gpt?retryWrites=true`;

const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const csrf = require('csurf');
const flash = require('connect-flash');
const multer = require('multer');

const errorController = require('./controllers/error');
const User = require('./models/user');

const app = express();
const store = new MongoDBStore({
    uri: MONGODB_URI,
    collection: 'sessions',
});
const csrfProtection = csrf();
const fileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'images');
    },
    filename: (req, file, cb) => {
        cb(null, new Date().toISOString().replace(/:/g, '-') + '-' + file.originalname);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpg' || file.mimetype === 'image/jpeg') {
        cb(null, true);
    } else {
        cb(null, false);
    }
};

app.set('view engine', 'ejs');
app.set('views', 'views');

const authRoutes = require('./routes/auth');
const viewRoutes = require('./routes/views');
const apiRoutes = require('./routes/api');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({ secret: 'my secret', resave: false, saveUninitialized: false, store: store }));
app.use(multer({ storage: fileStorage, fileFilter: fileFilter }).single('image'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(csrfProtection);
app.use(flash());

// --- WebSocket reverse proxy for game client ---
// If the embedded game client connects to /ws on this host, forward to target
// Set GAME_WS_TARGET like wss://runcode.at or ws://127.0.0.1:4000
try {
    const http = require('http');
    const httpProxy = require('http-proxy');
    const wsTarget = process.env.GAME_WS_TARGET || '';
    const server = http.createServer(app);
    if (wsTarget) {
        const proxy = httpProxy.createProxyServer({ target: wsTarget, changeOrigin: true, ws: true });
        server.on('upgrade', (req, socket, head) => {
            try {
                // Only proxy /ws path to game server
                if ((req.url || '').startsWith('/ws')) {
                    proxy.ws(req, socket, head);
                }
            } catch (e) {}
        });
        // Replace default app.listen with server.listen when proxy enabled
        app.set('serverWithWs', server);
    }
} catch (e) {
    // http-proxy not installed or environment does not support ws; ignore
}

app.use((req, res, next) => {
    res.locals.isAuthenticated = req.session && req.session.isLoggedIn;
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
    next();
});

app.use((req, res, next) => {
    // throw new Error('Sync Dummy');
    if (!req.session.user) {
        return next();
    }
    User.findById(req.session.user._id)
        .then((user) => {
            if (!user) {
                return next();
            }
            req.user = user;
            next();
        })
        .catch((err) => {
            next(new Error(err));
        });
});

app.use(authRoutes);
app.use(viewRoutes);
app.use('/api', apiRoutes);

app.get('/500', errorController.get500);

app.use(errorController.get404);

app.use((error, req, res, next) => {
    res.status(500).render('500', {
        pageTitle: 'Error!',
        path: '/500',
        isAuthenticated: req.session ? req.session.isLoggedIn : false,
        csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : '',
    });
});

mongoose
    .connect(MONGODB_URI)
    .then((result) => {
        const s = app.get('serverWithWs');
        if (s && s.listen) {
            s.listen(3000);
        } else {
            app.listen(3000);
        }
    })
    .catch((err) => {
        console.log(err);
    });
