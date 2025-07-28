import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, onSnapshot, addDoc, query, where, writeBatch, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL STATE ---
let db, auth, userId;
let schedule = [];
let tempSchedule = []; // For editing in the modal
let punishmentQueue = [];
let isInitialLoad = true;

// --- DOM ELEMENTS ---
const loadingOverlay = document.getElementById('loading-overlay');
const timelineContainer = document.getElementById('timeline-container');
const punishmentQueueEl = document.getElementById('punishment-queue');
const studyFocusContentEl = document.getElementById('study-focus-content');
const logStudyBtn = document.getElementById('log-study-btn');
const aiCoachMessageEl = document.getElementById('ai-coach-message');
const modalTopicTitle = document.getElementById('modal-topic-title');
const aiSubtopicsContainer = document.getElementById('ai-subtopics-container');
const scheduleEditorList = document.getElementById('schedule-editor-list');

// --- FIREBASE & INITIALIZATION ---
async function initialize() {
    const firebaseConfig = JSON.parse(__firebase_config);
    if (!firebaseConfig || !firebaseConfig.apiKey) {
        console.error("Firebase config is missing.");
        loadingOverlay.innerHTML = "<p>Error: Firebase configuration is missing.</p>";
        return;
    }
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            console.log("Authenticated with UID:", userId);
            await setupUser();
            attachRealtimeListeners();
            setInterval(updateClockAndFocus, 1000);
            loadingOverlay.style.opacity = '0';
            setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
        } else {
            signInAnonymously(auth).catch(err => console.error("Anonymous sign-in failed", err));
        }
    });
    setupEventListeners();
}

async function setupUser() {
    const today = new Date().toISOString().split('T')[0];
    const scheduleDocRef = doc(db, `users/${userId}/schedule/${today}`);
    if (!(await getDoc(scheduleDocRef)).exists()) {
        console.log("No schedule for today. Loading default...");
        const defaultScheduleRef = doc(db, `users/${userId}/settings/defaultSchedule`);
        const defaultScheduleDoc = await getDoc(defaultScheduleRef);
        let scheduleToSet = [];

        if (defaultScheduleDoc.exists()) {
            scheduleToSet = defaultScheduleDoc.data().tasks;
        } else {
            console.log("No default schedule found. Creating one.");
            scheduleToSet = [
                { id: 1, time: '08:00', duration: 5, task: 'Wake Up & Drink Water', type: 'routine', status: 'pending' },
                { id: 2, time: '08:05', duration: 15, task: 'Morning Exercise', type: 'routine', status: 'pending' },
                { id: 3, time: '08:30', duration: 180, task: 'Study Slot 1', type: 'study', subject: 'Maths', topic: 'Calculus - Derivatives', status: 'pending' },
                { id: 4, time: '11:30', duration: 30, task: 'Breakfast', type: 'meal', status: 'pending' },
            ];
            await setDoc(defaultScheduleRef, { tasks: scheduleToSet });
        }
        await setDoc(scheduleDocRef, { tasks: scheduleToSet, createdAt: serverTimestamp() });
    }
}

function attachRealtimeListeners() {
    const today = new Date().toISOString().split('T')[0];
    const scheduleDocRef = doc(db, `users/${userId}/schedule/${today}`);
    onSnapshot(scheduleDocRef, (doc) => {
        if (doc.exists()) {
            schedule = doc.data().tasks.sort((a, b) => a.time.localeCompare(b.time));
            renderTimeline();
            if (isInitialLoad) {
                getDailyKickstart();
                isInitialLoad = false;
            }
        }
    });

    const punishmentsColRef = collection(db, `users/${userId}/punishments`);
    const q = query(punishmentsColRef, where("cleared", "==", false));
    onSnapshot(q, (snapshot) => {
        punishmentQueue = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updatePunishmentQueueUI();
    });
}

// --- UI RENDERING ---
function renderTimeline() {
    timelineContainer.innerHTML = '';
    const now = new Date();
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

    schedule.forEach(item => {
        const [hours, minutes] = item.time.split(':').map(Number);
        const itemTimeInMinutes = hours * 60 + minutes;
        const endTimeInMinutes = itemTimeInMinutes + item.duration;
        const isActive = currentTimeInMinutes >= itemTimeInMinutes && currentTimeInMinutes < endTimeInMinutes;
        
        const card = document.createElement('div');
        card.className = 'timeline-item relative pl-12 pb-6';
        card.id = `task-${item.id}`;

        let statusDotClass = item.status === 'pending' ? (isActive ? 'active' : 'pending') : item.status;
        let cardBg = 'bg-gray-800';
        if (isActive && item.status === 'pending') {
            cardBg = 'bg-blue-900/50 border border-blue-500';
        } else if (item.status !== 'pending') {
            const color = { done: 'green', late: 'orange', skipped: 'red' }[item.status];
            cardBg = `bg-${color}-900/30`;
        }

        let taskText = (item.type === 'study') ? `${item.task}: ${item.subject} - ${item.topic}` : item.task;
        
        let actionButtons = '';
        if (item.status === 'pending') {
            if (item.type === 'study') {
                actionButtons = `
                    <div class="flex items-center gap-1">
                        <input type="number" id="study-minutes-${item.id}" class="w-20 bg-gray-700 text-white rounded-md p-1 text-xs text-center" placeholder="Mins">
                        <button onclick="window.logStudyTime(${item.id})" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-2 rounded-md transition">Log</button>
                    </div>
                `;
            } else {
                actionButtons = `
                    <button onclick="window.updateStatus(${item.id}, 'done')" class="bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-check"></i></button>
                    <button onclick="window.updateStatus(${item.id}, 'late')" class="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-clock"></i></button>
                    <button onclick="window.updateStatus(${item.id}, 'skipped')" class="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-times"></i></button>
                `;
            }
        } else {
             if (item.type === 'study') {
                const percentage = Math.round(((item.minutesStudied || 0) / item.duration) * 100);
                let textColor = 'text-green-400';
                if (percentage < 90) textColor = 'text-orange-400';
                if (percentage < 50) textColor = 'text-red-400';

                actionButtons = `
                    <div class="text-right">
                        <p class="font-semibold ${textColor}">${item.minutesStudied || 0} / ${item.duration} min</p>
                        <button onclick="window.undoStatus(${item.id})" class="text-xs text-gray-400 hover:text-white transition">Undo</button>
                    </div>
                `;
            } else {
                actionButtons = `
                    <button onclick="window.undoStatus(${item.id})" class="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-undo"></i> Undo</button>
                `;
            }
        }

        card.innerHTML = `
            <div class="status-dot ${statusDotClass}"></div>
            <p class="absolute left-0 -top-1 font-roboto-mono text-sm text-gray-400">${item.time}</p>
            <div class="p-4 rounded-xl shadow-md transition ${cardBg}">
                <div class="flex justify-between items-start">
                    <div>
                        <h3 class="font-semibold text-white ${item.status !== 'pending' ? 'line-through' : ''}">${taskText}</h3>
                        <p class="text-xs text-gray-400">${item.duration} minutes</p>
                    </div>
                    <div class="flex gap-2 items-center flex-shrink-0 ml-4">${actionButtons}</div>
                </div>
            </div>`;
        timelineContainer.appendChild(card);
    });
}

function updatePunishmentQueueUI() {
    const clearPunishmentsBtn = document.getElementById('clear-punishments-btn');
    if (punishmentQueue.length === 0) {
        punishmentQueueEl.innerHTML = '<p class="text-gray-400 italic">No punishments queued. Stay disciplined.</p>';
        if(clearPunishmentsBtn) clearPunishmentsBtn.classList.add('hidden');
    } else {
        punishmentQueueEl.innerHTML = punishmentQueue.map(p => `
            <button onclick="window.showPunishmentDetails('${p.id}')" class="w-full text-left bg-gray-800 p-2 rounded-lg text-sm hover:bg-gray-700 transition">
                <p class="text-red-400 font-semibold">${p.punishment}</p>
                <p class="text-xs text-gray-500">For: ${p.task}</p>
            </button>`).join('');
        if(clearPunishmentsBtn) clearPunishmentsBtn.classList.remove('hidden');
    }
}

function updateClockAndFocus() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleTimeString('en-GB');
    document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const activeItem = schedule.find(item => {
        const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
        const [hours, minutes] = item.time.split(':').map(Number);
        const itemTimeInMinutes = hours * 60 + minutes;
        const endTimeInMinutes = itemTimeInMinutes + item.duration;
        return currentTimeInMinutes >= itemTimeInMinutes && currentTimeInMinutes < endTimeInMinutes;
    });

    if (activeItem && activeItem.type === 'study' && activeItem.status === 'pending') {
        studyFocusContentEl.innerHTML = `
            <p class="text-sm text-gray-400">${activeItem.subject}</p>
            <h3 class="text-2xl font-bold text-blue-300">${activeItem.topic}</h3>
            <p class="mt-4 text-sm text-gray-400">Focus on this topic. Good luck.</p>`;
        logStudyBtn.classList.remove('hidden');
        logStudyBtn.onclick = () => window.openModal('study-log-modal', activeItem);
    } else {
        studyFocusContentEl.innerHTML = '<p class="text-gray-500 italic text-center">Not a study slot. Focus on the current task.</p>';
        logStudyBtn.classList.add('hidden');
    }
}

// --- SCHEDULE MANAGEMENT ---
function openScheduleManager() {
    tempSchedule = JSON.parse(JSON.stringify(schedule)); // Create a deep copy for editing
    renderScheduleEditor();
    window.openModal('schedule-manager-modal');
}

function renderScheduleEditor() {
    scheduleEditorList.innerHTML = '';
    tempSchedule.sort((a, b) => a.time.localeCompare(b.time)).forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'flex items-center justify-between bg-gray-800 p-2 rounded';
        itemEl.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="font-roboto-mono text-sm">${item.time}</span>
                <span class="text-white">${item.task}</span>
                <span class="text-xs text-gray-400">(${item.duration} min)</span>
            </div>
            <button onclick="window.deleteTaskFromTempSchedule(${item.id})" class="text-red-500 hover:text-red-400"><i class="fas fa-trash"></i></button>
        `;
        scheduleEditorList.appendChild(itemEl);
    });
}

window.deleteTaskFromTempSchedule = (id) => {
    tempSchedule = tempSchedule.filter(item => item.id !== id);
    renderScheduleEditor();
};

async function handleAddTask(e) {
    e.preventDefault();
    const addTaskForm = document.getElementById('add-task-form');
    const timeEl = document.getElementById('add-task-time');
    const nameEl = document.getElementById('add-task-name');
    const durationEl = document.getElementById('add-task-duration');
    const typeEl = document.getElementById('add-task-type');

    if (!timeEl || !nameEl || !durationEl || !typeEl) {
        const missing = [];
        if (!timeEl) missing.push('add-task-time');
        if (!nameEl) missing.push('add-task-name');
        if (!durationEl) missing.push('add-task-duration');
        if (!typeEl) missing.push('add-task-type');
        console.error(`Form elements not found: ${missing.join(', ')}. Please check your HTML to ensure these elements exist and have the correct IDs.`);
        return;
    }

    const time = timeEl.value;
    const name = nameEl.value.trim();
    const duration = parseInt(durationEl.value, 10);
    const type = typeEl.value;
    
    if (time && name && duration > 0) {
        const newTask = {
            id: Date.now(),
            time,
            task: name,
            duration,
            status: 'pending',
            type: type
        };

        if (type === 'study') {
            const parts = name.split('-').map(s => s.trim());
            if (parts.length > 1) {
                newTask.subject = parts[0];
                newTask.topic = parts.slice(1).join(' - ');
                newTask.task = 'Study Slot';
            } else {
                newTask.subject = 'General';
                newTask.topic = name;
                newTask.task = 'Study Slot';
            }
        }

        tempSchedule.push(newTask);
        renderScheduleEditor();
        addTaskForm.reset();
    }
}


async function saveScheduleForToday() {
    schedule = JSON.parse(JSON.stringify(tempSchedule));
    await saveSchedule();
    renderTimeline(); 
    window.closeModal('schedule-manager-modal');
}

async function saveScheduleAsDefault() {
    const defaultScheduleRef = doc(db, `users/${userId}/settings/defaultSchedule`);
    await setDoc(defaultScheduleRef, { tasks: tempSchedule });
    alert("Default schedule saved!");
    
    schedule = JSON.parse(JSON.stringify(tempSchedule));
    await saveSchedule();
    renderTimeline(); 
    
    window.closeModal('schedule-manager-modal');
}


// --- CORE LOGIC ---
window.logStudyTime = async (id) => {
    const inputEl = document.getElementById(`study-minutes-${id}`);
    if (!inputEl) return;

    const minutesStudied = parseInt(inputEl.value, 10);
    if (isNaN(minutesStudied) || minutesStudied < 0) {
        alert("Please enter a valid number of minutes.");
        return;
    }

    const itemIndex = schedule.findIndex(i => i.id === id);
    if (itemIndex > -1) {
        const task = schedule[itemIndex];
        task.status = 'done';
        task.minutesStudied = minutesStudied;

        const percentageCompleted = (minutesStudied / task.duration) * 100;

        if (percentageCompleted < 90) {
            const punishmentId = await addPunishment(task);
            if (punishmentId) {
                task.punishmentId = punishmentId;
            }
        }
        await saveSchedule();
    }
};

window.updateStatus = async (id, newStatus) => {
    const itemIndex = schedule.findIndex(i => i.id === id);
    if (itemIndex > -1) {
        schedule[itemIndex].status = newStatus;
        if (newStatus === 'skipped' || newStatus === 'late') {
            const punishmentId = await addPunishment(schedule[itemIndex]);
            if (punishmentId) {
                schedule[itemIndex].punishmentId = punishmentId;
            }
        } else {
            delete schedule[itemIndex].punishmentId;
        }
        await saveSchedule();
        if (id === schedule[schedule.length - 1].id) getEndOfDayReport();
    }
};

window.undoStatus = async (id) => {
    const itemIndex = schedule.findIndex(i => i.id === id);
    if (itemIndex > -1) {
        const task = schedule[itemIndex];
        if (task.punishmentId) {
            const punishmentRef = doc(db, `users/${userId}/punishments`, task.punishmentId);
            await deleteDoc(punishmentRef);
            delete schedule[itemIndex].punishmentId;
        }
        schedule[itemIndex].status = 'pending';
        if (schedule[itemIndex].type === 'study') {
            delete schedule[itemIndex].minutesStudied;
        }
        await saveSchedule();
    }
};

async function addPunishment(failedTask) {
    let prompt;
    if (failedTask.type === 'study') {
        const deficitPercent = 100 - Math.round((failedTask.minutesStudied / failedTask.duration) * 100);
        let severity = 'light';
        if (deficitPercent > 60) severity = 'severe';
        else if (deficitPercent > 30) severity = 'moderate';

        prompt = `Act as a brutal drill sergeant. A recruit missed ${deficitPercent}% of their study time for "${failedTask.topic}". Give them a single, high-impact punishment with a "${severity}" difficulty. Be creative and tough. The response must be ONLY the exercise name and reps/duration. No excuses, no explanations. Example: '100 Burpees'.`;

    } else {
        const failureCount = punishmentQueue.filter(p => p.task === failedTask.task).length + 1;
        prompt = `Act as a brutal drill sergeant. A recruit failed the task: "${failedTask.task}". This is their ${failureCount} failure. Give them a single, high-impact punishment. The response must be ONLY the exercise name and reps/duration. No excuses, no explanations. The difficulty should be ${failureCount > 2 ? 'extreme' : 'hard'}. Example: '5 Minute Wall Sit'.`;
    }

    try {
        const punishmentText = await callGemini(prompt);
        const punishmentRef = await addDoc(collection(db, `users/${userId}/punishments`), {
            task: failedTask.task,
            punishment: `✨ ${punishmentText}`,
            cleared: false,
            createdAt: serverTimestamp(),
        });
        return punishmentRef.id;
    } catch (error) {
        console.error("Error generating punishment:", error);
        return null;
    }
}

async function saveSchedule() {
    const today = new Date().toISOString().split('T')[0];
    const scheduleDocRef = doc(db, `users/${userId}/schedule/${today}`);
    await setDoc(scheduleDocRef, { tasks: schedule }, { merge: true });
}

// --- GEMINI API & AI COACH ---
async function callGemini(prompt) {
    const firebaseConfig = JSON.parse(__firebase_config);
    const apiKey = firebaseConfig.apiKey;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        console.error("Gemini API Error:", errorBody);
        throw new Error(`API call failed with status: ${response.status}`);
    }

    const result = await response.json();
    return result.candidates[0].content.parts[0].text;
}

async function getDailyKickstart() {
    if (!schedule || schedule.length === 0) return;
    const keyTasks = schedule.filter(item => item.type === 'study').map(item => item.topic).join(', ');
    const prompt = `My key study topics today are: ${keyTasks}. Give me a short, powerful, one-paragraph motivational message to start my day.`;
    try {
        aiCoachMessageEl.innerHTML = `✨ ${await callGemini(prompt)}`;
    } catch (error) {
        aiCoachMessageEl.textContent = "Focus and execute. You know the mission.";
    }
}

async function getEndOfDayReport() {
    if (!schedule || schedule.length === 0) return;
    const completed = schedule.filter(item => item.status === 'done').length;
    const total = schedule.length;
    const skipped = schedule.filter(item => item.status === 'skipped').length;
    const late = schedule.filter(item => item.status === 'late').length;
    const studyBlocks = schedule.filter(item => item.type === 'study');
    const studyCompleted = studyBlocks.filter(item => item.status === 'done').length;

    let summary = `You completed ${completed} out of ${total} tasks today.`;
    if (skipped > 0) summary += ` You skipped ${skipped} tasks.`;
    if (late > 0) summary += ` You were late on ${late} tasks.`;
    if (studyBlocks.length > 0) summary += ` You finished ${studyCompleted} out of ${studyBlocks.length} study blocks.`;

    const prompt = `Today, I completed ${completed} out of ${total} tasks. I skipped ${skipped} and was late on ${late}. Give me a short, honest, and motivating end-of-day report.`;
    try {
        const aiMessage = await callGemini(prompt);
        alert(`End of Day Report:\n\n${summary}\n\nAI Coach says:\n${aiMessage}`);
    } catch (error) {
        alert(`End of Day Report:\n\n${summary}\n\nAI Coach says: Stay disciplined and improve tomorrow!`);
    }
}

// --- EVENT LISTENERS & MODALS ---
function setupEventListeners() {
    const manageScheduleBtn = document.getElementById('manage-schedule-btn');
    if (manageScheduleBtn) manageScheduleBtn.addEventListener('click', openScheduleManager);

    const addTaskForm = document.getElementById('add-task-form');
    if (addTaskForm) addTaskForm.addEventListener('submit', handleAddTask);

    const saveForTodayBtn = document.getElementById('save-for-today-btn');
    if (saveForTodayBtn) saveForTodayBtn.addEventListener('click', saveScheduleForToday);

    const saveAsDefaultBtn = document.getElementById('save-as-default-btn');
    if (saveAsDefaultBtn) saveAsDefaultBtn.addEventListener('click', saveScheduleAsDefault);
    
    const clearPunishmentsBtn = document.getElementById('clear-punishments-btn');
    if(clearPunishmentsBtn) {
        clearPunishmentsBtn.addEventListener('click', async () => {
            const batch = writeBatch(db);
            punishmentQueue.forEach(p => {
                const punishmentRef = doc(db, `users/${userId}/punishments`, p.id);
                batch.update(punishmentRef, { cleared: true });
            });
            await batch.commit();
        });
    }
}

window.showPunishmentDetails = async (punishmentId) => {
    const punishment = punishmentQueue.find(p => p.id === punishmentId);
    if (!punishment) return;

    const modalTitle = document.getElementById('punishment-modal-title');
    const modalReason = document.getElementById('punishment-modal-reason');
    const modalInstructions = document.getElementById('punishment-modal-instructions');

    modalTitle.textContent = punishment.punishment.replace('✨ ', '');
    modalReason.textContent = `For failing task: ${punishment.task}`;
    modalInstructions.innerHTML = `<p class="italic animate-pulse">Loading instructions from AI Coach...</p>`;
    
    window.openModal('punishment-detail-modal');

    const prompt = `Act as an expert personal trainer. Explain why a user was given the punishment "${punishment.punishment}" for failing the task "${punishment.task}". Then, provide clear, step-by-step instructions on how to perform the exercise with perfect form. Use headings and bullet points for clarity.`;
    try {
        const instructions = await callGemini(prompt);
        // A simple markdown to HTML converter
        let html = instructions
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\n/g, '<br>'); // Newlines
        modalInstructions.innerHTML = html;
    } catch (error) {
        modalInstructions.innerHTML = `<p class="text-red-400">Could not load instructions. Please check your connection.</p>`;
    }
};

window.openModal = async (modalId, studyItem = null) => {
    if (modalId === 'study-log-modal' && studyItem) {
        modalTopicTitle.textContent = studyItem.topic;
        aiSubtopicsContainer.innerHTML = '<p class="text-gray-500 italic animate-pulse">✨ Querying Gemini for a study plan...</p>';
        const prompt = `Break down the study topic "${studyItem.topic}" into a concise list of 5-8 essential sub-topics.`;
        try {
            const subtopicsText = await callGemini(prompt);
            const subtopics = subtopicsText.split('\n').filter(s => s.trim() !== '').map(s => s.replace(/^[*-]\s*/, '').trim());
            aiSubtopicsContainer.innerHTML = subtopics.map(sub => `<label class="flex items-center p-2 rounded-md hover:bg-gray-700 cursor-pointer"><input type="checkbox" class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"><span class="ml-3 text-white">${sub}</span></label>`).join('');
        } catch (error) {
            aiSubtopicsContainer.innerHTML = '<p class="text-red-400">Could not generate sub-topics.</p>';
        }
    }
    document.getElementById(modalId).classList.remove('hidden');
};

window.closeModal = (modalId) => document.getElementById(modalId).classList.add('hidden');

window.submitStudyLog = () => {
    console.log("Study log submitted.");
    window.closeModal('study-log-modal');
    const activeStudyBlock = schedule.find(item => item.type === 'study' && item.status === 'pending');
    if(activeStudyBlock) {
        window.updateStatus(activeStudyBlock.id, 'done');
    }
};

// --- STARTUP ---
initialize();
