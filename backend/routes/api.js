import express from 'express';
import Schedule from '../models/Schedule.js';
import Punishment from '../models/Punishment.js';
import fetch from 'node-fetch';

const router = express.Router();

// --- Gemini API Helper ---
const callGemini = async (prompt) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.json();
        console.error("Gemini API Error:", error);
        throw new Error("Failed to call Gemini API");
    }

    const result = await response.json();
    return result.candidates[0].content.parts[0].text;
};

// --- Schedule Routes ---
router.get('/schedule/:userId/:date', async (req, res) => {
    try {
        let schedule = await Schedule.findOne({ userId: req.params.userId, date: req.params.date });
        if (!schedule) {
            // Create a default schedule if none exists for the day
            schedule = new Schedule({
                userId: req.params.userId,
                date: req.params.date,
                tasks: [
                    { id: Date.now(), time: '08:00', duration: 15, task: 'Morning Exercise', type: 'routine', status: 'pending' },
                    { id: Date.now() + 1, time: '09:00', duration: 180, task: 'Study Slot', type: 'study', subject: 'Physics', topic: 'Kinematics', status: 'pending' },
                ]
            });
            await schedule.save();
        }
        res.json(schedule);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put('/schedule/:userId/:date', async (req, res) => {
    try {
        const updatedSchedule = await Schedule.findOneAndUpdate(
            { userId: req.params.userId, date: req.params.date },
            { tasks: req.body.tasks },
            { new: true, upsert: true }
        );
        res.json(updatedSchedule);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- Punishment Routes ---
router.get('/punishments/:userId', async (req, res) => {
    try {
        const punishments = await Punishment.find({ userId: req.params.userId, cleared: false });
        res.json(punishments);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/punishments', async (req, res) => {
    try {
        const { userId, failedTask } = req.body;
        
        let prompt;
        if (failedTask.type === 'study') {
             const deficitPercent = 100 - Math.round((failedTask.minutesStudied / failedTask.duration) * 100);
             let severity = 'light';
             if (deficitPercent > 60) severity = 'severe'; else if (deficitPercent > 30) severity = 'moderate';
             prompt = `Act as a brutal drill sergeant. A recruit missed ${deficitPercent}% of their study time for "${failedTask.topic}". Give them a single, high-impact punishment with a "${severity}" difficulty. Be creative and tough. The response must be ONLY the exercise name and reps/duration. No excuses, no explanations. Example: '100 Burpees'.`;
        } else {
            prompt = `Act as a brutal drill sergeant. A recruit failed the task: "${failedTask.task}". Give them a single, high-impact punishment. The response must be ONLY the exercise name and reps/duration. No excuses, no explanations. The difficulty should be hard. Example: '5 Minute Wall Sit'.`;
        }

        const punishmentText = await callGemini(prompt);

        const newPunishment = new Punishment({
            userId,
            taskId: failedTask.id,
            task: failedTask.task,
            punishment: `✨ ${punishmentText}`,
        });
        await newPunishment.save();
        res.status(201).json(newPunishment);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.delete('/punishments/:id', async (req, res) => {
    try {
        await Punishment.findByIdAndDelete(req.params.id);
        res.json({ message: 'Punishment deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- AI Coach Route ---
router.post('/coach/instructions', async (req, res) => {
    try {
        const { punishment, task } = req.body;
        const prompt = `Act as an expert personal trainer. Explain why a user was given the punishment "${punishment}" for failing the task "${task}". Then, provide clear, step-by-step instructions on how to perform the exercise with perfect form. Use headings and bullet points for clarity.`;
        const instructions = await callGemini(prompt);
        res.json({ instructions });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


export default router;
