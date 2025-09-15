const Chat = require('../../models/Chat');
const Message = require('../../models/Message');
const together = require('../../services/together');
const { Types } = require('mongoose');

exports.list = async (req, res, next) => {
    try {
        const chats = await Chat.find({ userId: req.user._id }).sort({ updatedAt: -1 }).lean();
        res.json({ items: chats });
    } catch (err) {
        next(err);
    }
};

exports.create = async (req, res, next) => {
    try {
        const title = (req.body && req.body.title) || 'New chat';
        const chat = await Chat.create({ userId: req.user._id, title });
        res.status(201).json({ item: chat });
    } catch (err) {
        next(err);
    }
};

exports.messages = async (req, res, next) => {
    try {
        const chatId = req.params.id;
        if (!Types.ObjectId.isValid(chatId)) return res.status(404).json({ error: { code: 'not_found' } });
        const chat = await Chat.findOne({ _id: chatId, userId: req.user._id }).lean();
        if (!chat) return res.status(404).json({ error: { code: 'not_found' } });
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const before = req.query.before ? new Date(req.query.before) : null;
        const query = { chatId };
        if (before) query.createdAt = { $lt: before };
        const items = await Message.find(query).sort({ createdAt: -1 }).limit(limit).lean();
        res.json({ items: items.reverse() });
    } catch (err) {
        next(err);
    }
};

exports.stream = async (req, res, next) => {
    try {
        const chatId = req.params.id;
        const { content } = req.body || {};
        if (!content || typeof content !== 'string')
            return res.status(400).json({ error: { code: 'bad_request', message: 'content required' } });
        if (!Types.ObjectId.isValid(chatId)) return res.status(404).json({ error: { code: 'not_found' } });
        const chat = await Chat.findOne({ _id: chatId, userId: req.user._id });
        if (!chat) return res.status(404).json({ error: { code: 'not_found' } });

        // Persist user message first
        const userMsg = await Message.create({ chatId: chat._id, role: 'user', content });

        // Build recent history (cap ~20 messages)
        const history = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 }).limit(40).lean();
        const messages = history.map((m) => ({ role: m.role, content: m.content }));

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        });

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 90_000);
        let full = '';

        req.on('close', () => {
            try {
                abortController.abort();
            } catch (_) {}
        });

        try {
            for await (const delta of together.streamingChat({ messages, signal: abortController.signal })) {
                full += delta;
                res.write(`data: ${delta}\n\n`);
            }
        } catch (err) {
            // surface a lightweight error event and end
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: 'stream_failed' })}\n\n`);
        } finally {
            clearTimeout(timeout);
        }

        if (full) {
            await Message.create({
                chatId: chat._id,
                role: 'assistant',
                content: full,
                model: process.env.TOGETHER_MODEL,
            });
            await Chat.updateOne({ _id: chat._id }, { $set: { updatedAt: new Date() } });
        }

        res.write('event: done\n');
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        next(err);
    }
};
