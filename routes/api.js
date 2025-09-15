const express = require('express');
const router = express.Router();
const apiAuth = require('../middleware/apiAuth');
const chatsController = require('../controllers/api/chats');

router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

router.get('/chats', apiAuth, chatsController.list);
router.post('/chats', apiAuth, chatsController.create);
router.get('/chats/:id/messages', apiAuth, chatsController.messages);
router.post('/chats/:id/messages/stream', apiAuth, chatsController.stream);

module.exports = router;
