import mongoose from 'mongoose';

const punishmentSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    taskId: { type: Number, required: true },
    task: { type: String, required: true },
    punishment: { type: String, required: true },
    cleared: { type: Boolean, default: false },
}, { timestamps: true });

const Punishment = mongoose.model('Punishment', punishmentSchema);
export default Punishment;
