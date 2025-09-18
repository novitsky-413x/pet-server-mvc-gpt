const express = require('express');
const router = express.Router();
const apiAuth = require('../middleware/apiAuth');
const chatsController = require('../controllers/api/chats');
const uiController = require('../controllers/api/ui');

router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

router.get('/chats', apiAuth, chatsController.list);
router.post('/chats', apiAuth, chatsController.create);
router.get('/chats/:id/messages', apiAuth, chatsController.messages);
router.post('/chats/:id/messages/stream', apiAuth, chatsController.stream);
router.patch('/chats/:id', apiAuth, chatsController.rename);
router.delete('/chats/:id', apiAuth, chatsController.remove);

// UI snapshots and test generation
router.post('/ui/snapshots', apiAuth, uiController.createSnapshot);
router.get('/ui/snapshots/:id', apiAuth, uiController.getSnapshot);
router.post('/ui/tests', apiAuth, uiController.generateTests);
router.get('/ui/tests', apiAuth, uiController.listTests);

module.exports = router;
