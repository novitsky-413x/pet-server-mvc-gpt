const mongoose = require('mongoose');

const uiElementSchema = new mongoose.Schema(
    {
        id: { type: String },
        role: { type: String },
        name: { type: String },
        tag: { type: String },
        type: { type: String },
        text: { type: String },
        placeholder: { type: String },
        href: { type: String },
        value: { type: String },
        checked: { type: Boolean },
        disabled: { type: Boolean },
        visible: { type: Boolean },
        aria: { type: Object },
        attrs: { type: Object },
        cssPath: { type: String },
        xpath: { type: String },
        bounds: {
            x: Number,
            y: Number,
            width: Number,
            height: Number,
        },
        children: [Object],
    },
    { _id: false }
);

const uiSnapshotSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
        url: { type: String, required: true, index: true },
        title: { type: String },
        htmlHash: { type: String, index: true },
        meta: { type: Object },
        elements: [uiElementSchema],
        compressed: { type: Boolean, default: false },
        compressedBlob: { type: Buffer },
    },
    { timestamps: true }
);

module.exports = mongoose.model('UiSnapshot', uiSnapshotSchema);

