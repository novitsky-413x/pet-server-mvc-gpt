const mongoose = require('mongoose');

const testStepSchema = new mongoose.Schema(
    {
        index: { type: Number, required: true },
        action: { type: String, required: true },
        selector: { type: String },
        details: { type: Object },
        expected: { type: String },
    },
    { _id: false }
);

const testCaseSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
        snapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'UiSnapshot', index: true },
        url: { type: String, index: true },
        title: { type: String, required: true },
        description: { type: String },
        priority: { type: String, enum: ['P0', 'P1', 'P2', 'P3'], default: 'P2' },
        tags: [{ type: String }],
        steps: [testStepSchema],
        negative: { type: Boolean, default: false },
        preconditions: { type: String },
        postconditions: { type: String },
        source: { type: String, enum: ['url', 'doc', 'manual'], default: 'url' },
        llmModel: { type: String },
    },
    { timestamps: true }
);

module.exports = mongoose.model('TestCase', testCaseSchema);

