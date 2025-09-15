const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
    {
        chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
        role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
        content: { type: String, required: true },
        model: { type: String },
        tokens: { type: Number },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
