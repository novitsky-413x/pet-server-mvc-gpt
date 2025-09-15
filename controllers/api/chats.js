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

exports.rename = async (req, res, next) => {
    try {
        const chatId = req.params.id;
        const title = (req.body && req.body.title) || '';
        if (!Types.ObjectId.isValid(chatId)) return res.status(404).json({ error: { code: 'not_found' } });
        if (!title || typeof title !== 'string' || title.length > 200) {
            return res.status(400).json({ error: { code: 'bad_request', message: 'valid title required' } });
        }
        const chat = await Chat.findOneAndUpdate(
            { _id: chatId, userId: req.user._id },
            { $set: { title } },
            { new: true }
        ).lean();
        if (!chat) return res.status(404).json({ error: { code: 'not_found' } });
        res.json({ item: chat });
    } catch (err) {
        next(err);
    }
};

exports.remove = async (req, res, next) => {
    try {
        const chatId = req.params.id;
        if (!Types.ObjectId.isValid(chatId)) return res.status(404).json({ error: { code: 'not_found' } });
        const chat = await Chat.findOneAndDelete({ _id: chatId, userId: req.user._id }).lean();
        if (!chat) return res.status(404).json({ error: { code: 'not_found' } });
        await Message.deleteMany({ chatId: chat._id });
        res.status(204).end();
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

        // Auto-generate title from the first user message
        try {
            const isDefaultTitle = !chat.title || chat.title === 'New chat';
            if (isDefaultTitle) {
                const totalMessages = await Message.countDocuments({ chatId: chat._id });
                if (totalMessages === 1) {
                    const makeTitle = (text) => {
                        if (!text) return 'New chat';
                        let t = String(text)
                            .replace(/\r?\n+/g, ' ')
                            .replace(/```[\s\S]*?```/g, '')
                            .replace(/`([^`]+)`/g, '$1')
                            .replace(/<think>[\s\S]*?<\/think>/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
                        if (t.length > 80) t = t.slice(0, 80);
                        return t || 'New chat';
                    };
                    const newTitle = makeTitle(content);
                    await Chat.updateOne(
                        { _id: chat._id },
                        { $set: { title: newTitle, updatedAt: new Date() } }
                    );
                    // reflect the change in local variable to prevent races
                    chat.title = newTitle;
                }
            }
        } catch (_) {}

        // Build recent history (cap ~20 messages)
        const history = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 }).limit(60).lean();
        const messages = history.map((m) => ({ role: m.role, content: m.content }));

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        });

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 90_000);
        let full = '';
        let pending = '';
        let inThink = false;

        req.on('close', () => {
            try {
                abortController.abort();
            } catch (_) {}
        });

        try {
            const THINK_OPEN = '<think>';
            const THINK_CLOSE = '</think>';
            const longestPrefixKeep = (buffer, needle) => {
                const max = Math.min(buffer.length, needle.length - 1);
                for (let k = max; k >= 1; k--) {
                    if (needle.startsWith(buffer.slice(-k))) return k;
                }
                return 0;
            };
            for await (const rawDelta of together.streamingChat({
                messages,
                signal: abortController.signal,
            })) {
                // Emit both visible content and <think> content as a separate SSE event
                let visible = '';
                let thinkOut = '';
                pending += rawDelta;
                while (pending.length) {
                    if (inThink) {
                        const endIdx = pending.indexOf(THINK_CLOSE);
                        if (endIdx === -1) {
                            // emit all but the longest suffix that could be the start of a closing tag
                            const keep = longestPrefixKeep(pending, THINK_CLOSE);
                            const emitLen = Math.max(0, pending.length - keep);
                            if (emitLen > 0) {
                                thinkOut += pending.slice(0, emitLen);
                                pending = pending.slice(emitLen);
                            }
                            break;
                        }
                        thinkOut += pending.slice(0, endIdx);
                        pending = pending.slice(endIdx + THINK_CLOSE.length);
                        inThink = false;
                        continue;
                    } else {
                        const startIdx = pending.indexOf(THINK_OPEN);
                        if (startIdx === -1) {
                            // no tag, emit all but the longest suffix that could start an opening tag
                            const keep = longestPrefixKeep(pending, THINK_OPEN);
                            const emitLen = Math.max(0, pending.length - keep);
                            if (emitLen > 0) {
                                visible += pending.slice(0, emitLen);
                                pending = pending.slice(emitLen);
                            }
                            break;
                        } else {
                            // emit content before tag
                            visible += pending.slice(0, startIdx);
                            pending = pending.slice(startIdx + THINK_OPEN.length); // skip '<think>'
                            inThink = true;
                            continue;
                        }
                    }
                }
                if (visible) {
                    full += visible;
                    res.write(`data: ${visible}\n\n`);
                }
                if (thinkOut) {
                    res.write('event: think\n');
                    res.write(`data: ${thinkOut}\n\n`);
                }
            }
        } catch (err) {
            // surface a lightweight error event and end
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: 'stream_failed' })}\n\n`);
        } finally {
            clearTimeout(timeout);
        }

        // Flush any remaining buffered text
        if (pending) {
            if (inThink) {
                res.write('event: think\n');
                res.write(`data: ${pending}\n\n`);
            } else {
                full += pending;
                res.write(`data: ${pending}\n\n`);
            }
            pending = '';
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
