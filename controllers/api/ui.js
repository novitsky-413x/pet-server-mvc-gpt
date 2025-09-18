const { Types } = require('mongoose');
const UiSnapshot = require('../../models/UiSnapshot');
const TestCase = require('../../models/TestCase');
const { scrapeUrlToSnapshot } = require('../../services/scraper');
const { summarizeUi, generateTestCases } = require('../../services/llm-ui');

exports.createSnapshot = async (req, res, next) => {
    try {
        const { url } = req.body || {};
        if (!url || typeof url !== 'string') return res.status(400).json({ error: { code: 'bad_request', message: 'url required' } });
        const snapshot = await scrapeUrlToSnapshot({ url, userId: req.user?._id });
        // Try UI summarization, but don't fail snapshot creation if model/config missing
        let uiMap = { pages: [], components: [], actions: [] };
        const hasTogether = !!process.env.TOGETHER_API_KEY && !!process.env.TOGETHER_MODEL;
        if (hasTogether) {
            try {
                uiMap = await summarizeUi(snapshot.elements);
            } catch (e) {
                // best-effort summarization; keep empty map on failure
                console.warn('summarizeUi failed:', e && e.message ? e.message : e);
            }
        }
        await UiSnapshot.updateOne({ _id: snapshot._id }, { $set: { 'meta.uiMap': uiMap } });
        res.status(201).json({ item: await UiSnapshot.findById(snapshot._id).lean() });
    } catch (err) {
        next(err);
    }
};

exports.getSnapshot = async (req, res, next) => {
    try {
        const id = req.params.id;
        if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: { code: 'not_found' } });
        const snap = await UiSnapshot.findOne({ _id: id, userId: req.user?._id }).lean();
        if (!snap) return res.status(404).json({ error: { code: 'not_found' } });
        res.json({ item: snap });
    } catch (err) {
        next(err);
    }
};

exports.generateTests = async (req, res, next) => {
    try {
        const { snapshotId, goals } = req.body || {};
        if (!Types.ObjectId.isValid(snapshotId)) return res.status(400).json({ error: { code: 'bad_request', message: 'snapshotId required' } });
        const snap = await UiSnapshot.findOne({ _id: snapshotId, userId: req.user?._id }).lean();
        if (!snap) return res.status(404).json({ error: { code: 'not_found' } });
        const tests = await generateTestCases({ url: snap.url, title: snap.title, uiMap: snap?.meta?.uiMap || { pages: [], components: [], actions: [] }, goals });
        const created = await TestCase.insertMany(
            tests.map((t, i) => ({
                userId: req.user?._id,
                snapshotId: snap._id,
                url: snap.url,
                title: t.title || `Test ${i + 1}`,
                description: t.description || '',
                priority: t.priority || 'P2',
                tags: Array.isArray(t.tags) ? t.tags : [],
                steps: Array.isArray(t.steps) ? t.steps.map((s, idx) => ({
                    index: s.index ?? idx + 1,
                    action: s.action || '',
                    selector: s.selector || '',
                    details: s.details || {},
                    expected: s.expected || '',
                })) : [],
                negative: !!t.negative,
                preconditions: t.preconditions || '',
                postconditions: t.postconditions || '',
                source: 'url',
                llmModel: process.env.TOGETHER_MODEL,
            }))
        );
        res.status(201).json({ items: created });
    } catch (err) {
        next(err);
    }
};

exports.listTests = async (req, res, next) => {
    try {
        const { snapshotId } = req.query || {};
        const q = { userId: req.user?._id };
        if (snapshotId && Types.ObjectId.isValid(snapshotId)) q.snapshotId = snapshotId;
        const items = await TestCase.find(q).sort({ createdAt: -1 }).lean();
        res.json({ items });
    } catch (err) {
        next(err);
    }
};

