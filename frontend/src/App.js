import React, { useState, useEffect, useCallback } from 'react';

// --- Configuration ---
// In a real MERN app, this would be in a .env file on the server.
// For this environment, we define it here.
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001'; // Your backend server URL
// TODO: Replace with real authentication logic.
// For now, try to get userId from localStorage or another auth provider.
const USER_ID = localStorage.getItem('userId') || 'guest-user';

// --- Helper Hooks ---
const useClock = () => {
    const [time, setTime] = useState(new Date());
    useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);
    return time;
};

// --- API Service ---
const api = {
    getSchedule: (userId, date) => fetch(`${API_BASE_URL}/api/schedule/${userId}/${date}`).then(res => res.json()),
    updateSchedule: (userId, date, tasks) => fetch(`${API_BASE_URL}/api/schedule/${userId}/${date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks }),
    }).then(res => res.json()),
    getPunishments: (userId) => fetch(`${API_BASE_URL}/api/punishments/${userId}`).then(res => res.json()),
    createPunishment: (userId, failedTask) => fetch(`${API_BASE_URL}/api/punishments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, failedTask }),
    }).then(res => res.json()),
    deletePunishment: (punishmentId) => fetch(`${API_BASE_URL}/api/punishments/${punishmentId}`, { method: 'DELETE' }),
    getPunishmentInstructions: (punishment, task) => fetch(`${API_BASE_URL}/api/coach/instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ punishment, task }),
    }).then(res => res.json()),
};

// --- Main App Component ---
export default function App() {
    const [schedule, setSchedule] = useState([]);
    const [punishments, setPunishments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTask, setActiveTask] = useState(null);
    const [selectedPunishment, setSelectedPunishment] = useState(null);
    
    const time = useClock();
    const today = new Date().toISOString().split('T')[0];

    const fetchData = useCallback(async () => {
        try {
            const scheduleData = await api.getSchedule(USER_ID, today);
            const punishmentData = await api.getPunishments(USER_ID);
            setSchedule(scheduleData.tasks.sort((a, b) => a.time.localeCompare(b.time)));
            setPunishments(punishmentData);
        } catch (error) {
            console.error("Failed to fetch data:", error);
        } finally {
            setLoading(false);
        }
    }, [today]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        const now = time.getHours() * 60 + time.getMinutes();
        const currentTask = schedule.find(item => {
            const [h, m] = item.time.split(':');
            const start = parseInt(h) * 60 + parseInt(m);
            const end = start + item.duration;
            return now >= start && now < end;
        });
        setActiveTask(currentTask);
    }, [time, schedule]);

    const handleUpdateStatus = async (taskId, newStatus) => {
        let newSchedule = [...schedule];
        const taskIndex = newSchedule.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        const task = newSchedule[taskIndex];
        task.status = newStatus;

        if (newStatus === 'skipped' || newStatus === 'late') {
            const newPunishment = await api.createPunishment(USER_ID, task);
            task.punishmentId = newPunishment._id;
            setPunishments(prev => [...prev, newPunishment]);
        }
        
        await api.updateSchedule(USER_ID, today, newSchedule);
        setSchedule(newSchedule);
    };

    const handleLogStudyTime = async (taskId, minutes) => {
        let newSchedule = [...schedule];
        const taskIndex = newSchedule.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        const task = newSchedule[taskIndex];
        task.status = 'done';
        task.minutesStudied = minutes;

        if ((minutes / task.duration) * 100 < 90) {
            const newPunishment = await api.createPunishment(USER_ID, task);
            task.punishmentId = newPunishment._id;
            setPunishments(prev => [...prev, newPunishment]);
        }

        await api.updateSchedule(USER_ID, today, newSchedule);
        setSchedule(newSchedule);
    };

    const handleUndo = async (taskId) => {
        let newSchedule = [...schedule];
        const taskIndex = newSchedule.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;

        const task = newSchedule[taskIndex];
        if (task.punishmentId) {
            await api.deletePunishment(task.punishmentId);
            setPunishments(prev => prev.filter(p => p._id !== task.punishmentId));
            delete task.punishmentId;
        }
        task.status = 'pending';
        if (task.type === 'study') delete task.minutesStudied;

        await api.updateSchedule(USER_ID, today, newSchedule);
        setSchedule(newSchedule);
    };

    if (loading) {
        return <div className="bg-gray-900 text-white h-screen flex items-center justify-center">Loading Discipline Engine...</div>;
    }

    return (
        <div className="flex flex-col lg:flex-row h-screen max-w-7xl mx-auto p-4 gap-4 bg-gray-900 text-gray-200">
            <Timeline 
                schedule={schedule} 
                activeTask={activeTask} 
                onUpdateStatus={handleUpdateStatus} 
                onLogStudy={handleLogStudyTime}
                onUndo={handleUndo}
                time={time}
            />
            <SidePanel punishments={punishments} onPunishmentClick={setSelectedPunishment} />
            {selectedPunishment && <PunishmentModal punishment={selectedPunishment} onClose={() => setSelectedPunishment(null)} />}
        </div>
    );
}

// --- Child Components ---

const Timeline = ({ schedule, activeTask, onUpdateStatus, onLogStudy, onUndo, time }) => (
    <main className="w-full lg:w-2/3 bg-gray-800/50 rounded-2xl p-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Today's Timeline</h1>
                <p className="text-sm text-gray-400">{time.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <p className="font-mono text-3xl font-bold text-blue-400">{time.toLocaleTimeString()}</p>
        </div>
        <div className="relative">
            {schedule.map(item => <TaskCard key={item.id} item={item} isActive={activeTask?.id === item.id} onUpdateStatus={onUpdateStatus} onLogStudy={onLogStudy} onUndo={onUndo} />)}
        </div>
    </main>
);

const TaskCard = ({ item, isActive, onUpdateStatus, onLogStudy, onUndo }) => {
    const [minutes, setMinutes] = useState('');
    
    const statusDotClass = { pending: 'border-gray-500', done: 'bg-green-500 border-green-500', late: 'bg-orange-500 border-orange-500', skipped: 'bg-red-500 border-red-500' }[item.status] || 'border-gray-500';
    const cardBg = isActive && item.status === 'pending' ? 'bg-blue-900/50 border border-blue-500' : { done: 'bg-green-900/30', late: 'bg-orange-900/30', skipped: 'bg-red-900/30' }[item.status] || 'bg-gray-800';

    return (
        <div className="timeline-item relative pl-12 pb-6">
            <div className={`absolute left-4 top-4 h-4 w-4 rounded-full border-2 ${isActive && item.status === 'pending' ? 'bg-blue-500 border-blue-500 shadow-lg shadow-blue-500/50' : statusDotClass}`}></div>
            <p className="absolute left-0 -top-1 font-mono text-sm text-gray-400">{item.time}</p>
            <div className={`p-4 rounded-xl shadow-md transition ${cardBg}`}>
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className={`font-semibold text-white ${item.status !== 'pending' ? 'line-through' : ''}`}>{item.type === 'study' ? `${item.task}: ${item.subject} - ${item.topic}` : item.task}</h3>
                        <p className="text-xs text-gray-400">{item.duration} minutes</p>
                    </div>
                    <div className="flex gap-2 items-center flex-shrink-0 ml-4">
                        {item.status === 'pending' ? (
                            item.type === 'study' ? (
                                <div className="flex items-center gap-1">
                                    <input type="number" value={minutes} onChange={e => setMinutes(e.target.value)} className="w-20 bg-gray-700 text-white rounded-md p-1 text-xs text-center" placeholder="Mins" />
                                    <button onClick={() => onLogStudy(item.id, parseInt(minutes))} className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-2 rounded-md transition">Log</button>
                                </div>
                            ) : (
                                <>
                                    <button onClick={() => onUpdateStatus(item.id, 'done')} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-1 px-2 rounded-md transition">✓</button>
                                    <button onClick={() => onUpdateStatus(item.id, 'late')} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-1 px-2 rounded-md transition">⏱</button>
                                    <button onClick={() => onUpdateStatus(item.id, 'skipped')} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded-md transition">×</button>
                                </>
                            )
                        ) : (
                            item.type === 'study' ? (
                                <div className="text-right">
                                    <p className="font-semibold text-green-400">{item.minutesStudied || 0} / {item.duration} min</p>
                                    <button onClick={() => onUndo(item.id)} className="text-xs text-gray-400 hover:text-white transition">Undo</button>
                                </div>
                            ) : (
                                <button onClick={() => onUndo(item.id)} className="bg-gray-500 hover:bg-gray-600 text-white text-xs font-bold py-1 px-2 rounded-md transition">Undo</button>
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const SidePanel = ({ punishments, onPunishmentClick }) => (
    <aside className="w-full lg:w-1/3 flex flex-col gap-4">
        <div className="bg-gray-800/50 rounded-2xl p-6">
            <h2 className="text-xl font-bold text-white mb-4">AI Coach</h2>
            <div className="bg-gray-800 p-4 rounded-lg text-sm text-gray-300 italic min-h-[100px]">Today is the day to build the discipline you want for tomorrow. Execute.</div>
        </div>
        <div className="bg-gray-800/50 rounded-2xl p-6 flex-grow flex flex-col">
            <h2 className="text-xl font-bold text-white mb-4">Punishment Queue</h2>
            <div className="space-y-2 overflow-y-auto flex-grow">
                {punishments.length > 0 ? punishments.map(p => (
                    <button key={p._id} onClick={() => onPunishmentClick(p)} className="w-full text-left bg-gray-800 p-2 rounded-lg text-sm hover:bg-gray-700 transition">
                        <p className="text-red-400 font-semibold">{p.punishment.replace('✨ ', '')}</p>
                        <p className="text-xs text-gray-500">For: {p.task}</p>
                    </button>
                )) : <p className="text-gray-400 italic">No punishments queued.</p>}
            </div>
        </div>
    </aside>
);

const PunishmentModal = ({ punishment, onClose }) => {
    const [instructions, setInstructions] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchInstructions = async () => {
            setLoading(true);
            try {
                const data = await api.getPunishmentInstructions(punishment.punishment, punishment.task);
                setInstructions(data.instructions);
            } catch (error) {
                setInstructions("Could not load instructions.");
            } finally {
                setLoading(false);
            }
        };
        fetchInstructions();
    }, [punishment]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-2xl h-5/6 flex flex-col">
                <h2 className="text-2xl font-bold text-red-400 mb-2">{punishment.punishment.replace('✨ ', '')}</h2>
                <p className="text-sm text-gray-400 mb-4">Reason: For failing task: {punishment.task}</p>
                <div className="flex-grow overflow-y-auto bg-gray-900 p-4 rounded-lg space-y-4 text-gray-300">
                    {loading ? <p>Loading instructions...</p> : <div dangerouslySetInnerHTML={{ __html: instructions.replace(/\n/g, '<br/>') }} />}
                </div>
                <div className="flex justify-end gap-4 mt-6">
                    <button onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg">Close</button>
                </div>
            </div>
        </div>
    );
};
