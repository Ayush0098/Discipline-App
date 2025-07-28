import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    time: { type: String, required: true },
    duration: { type: Number, required: true },
    task: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, default: 'pending' },
    subject: String,
    topic: String,
    minutesStudied: Number,
    punishmentId: String,
});

const scheduleSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    date: { type: String, required: true },
    tasks: [taskSchema],
}, { 
    timestamps: true,
    indexes: [
        { fields: { userId: 1, date: 1 }, options: { unique: true } }
    ]
});

// Create a compound unique index on userId and date
scheduleSchema.index({ userId: 1, date: 1 }, { unique: true });

const Schedule = mongoose.model('Schedule', scheduleSchema);
export default Schedule;
