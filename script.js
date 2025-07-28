import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  addDoc,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL STATE ---
let db, auth, userId;
let schedule = [];
let punishmentQueue = [];
let confirmationTimer = null;
let unsubscribeSchedule, unsubscribePunishments;
let isInitialLoad = true;

// --- HABIT REMINDER STATE ---
let habitReminderTimeout = null;
let habitConfirmationTimeout = null;
let currentHabitTask = null;

// --- DOM ELEMENTS ---
const loadingOverlay = document.getElementById("loading-overlay");
const timelineContainer = document.getElementById("timeline-container");
const punishmentQueueEl = document.getElementById("punishment-queue");
const studyFocusContentEl = document.getElementById("study-focus-content");
const logStudyBtn = document.getElementById("log-study-btn");
const modal = document.getElementById("study-log-modal");
const modalTopicTitle = document.getElementById("modal-topic-title");
const aiSubtopicsContainer = document.getElementById("ai-subtopics-container");
const alarmSound = document.getElementById("alarm-sound");
const aiCoachMessageEl = document.getElementById("ai-coach-message");
const clearPunishmentsBtn = document.getElementById("clear-punishments-btn");

// --- FIREBASE & INITIALIZATION ---

async function initialize() {
  const appId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";
  const firebaseConfig =
    typeof __firebase_config !== "undefined"
      ? JSON.parse(__firebase_config)
      : undefined;

  if (!firebaseConfig || !firebaseConfig.apiKey) {
    console.error("Firebase config is missing or invalid!");
    loadingOverlay.innerHTML =
      "<p>Error: Firebase configuration is missing. Please check index.html</p>";
    return;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      userId = user.uid;
      console.log("User authenticated with UID:", userId);
      await setupUser();
      attachRealtimeListeners();
      setInterval(updateClockAndFocus, 1000);
      loadingOverlay.style.opacity = "0";
      setTimeout(() => (loadingOverlay.style.display = "none"), 500);
    } else {
      console.log("No user signed in. Attempting to sign in...");
      try {
        if (
          typeof __initial_auth_token !== "undefined" &&
          __initial_auth_token
        ) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Authentication failed:", error);
        loadingOverlay.innerHTML =
          "<p>Error: Authentication failed. Please check Firebase settings and refresh.</p>";
      }
    }
  });
  // ...existing code...

  async function setupUser() {
    const today = new Date().toISOString().split("T")[0];
    const userDocRef = doc(db, `users/${userId}/schedule/${today}`);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      console.log("No schedule for today. Creating one...");
      const defaultSchedule = [
        {
          id: 1,
          time: "08:00",
          duration: 5,
          task: "Wake Up & Drink Water",
          type: "routine",
          status: "pending",
        },
        {
          id: 2,
          time: "08:05",
          duration: 15,
          task: "Morning Exercise",
          type: "routine",
          status: "pending",
        },
        {
          id: 3,
          time: "08:20",
          duration: 10,
          task: "Brush & Skincare",
          type: "routine",
          status: "pending",
        },
        {
          id: 4,
          time: "08:30",
          duration: 180,
          task: "Study Slot 1",
          type: "study",
          subject: "Maths",
          topic: "Calculus - Derivatives",
          status: "pending",
        },
        {
          id: 5,
          time: "11:30",
          duration: 30,
          task: "Breakfast",
          type: "meal",
          status: "pending",
        },
        {
          id: 6,
          time: "12:00",
          duration: 180,
          task: "Study Slot 2",
          type: "study",
          subject: "Chemistry",
          topic: "Organic - Alkanes",
          status: "pending",
        },
        {
          id: 7,
          time: "15:00",
          duration: 20,
          task: "Lunch",
          type: "meal",
          status: "pending",
        },
        {
          id: 8,
          time: "15:20",
          duration: 190,
          task: "Sports Break",
          type: "break",
          status: "pending",
        },
        {
          id: 9,
          time: "18:30",
          duration: 15,
          task: "Post-Play Meal",
          type: "meal",
          details: "Oats and a glass of milk",
          status: "pending",
        },
        {
          id: 10,
          time: "18:45",
          duration: 5,
          task: "Face Wash & Mouthwash",
          type: "routine",
          status: "pending",
        },
        {
          id: 11,
          time: "18:50",
          duration: 40,
          task: "Nap Session",
          type: "break",
          status: "pending",
        },
        {
          id: 12,
          time: "19:30",
          duration: 120,
          task: "Study Slot 3",
          type: "study",
          subject: "Physics",
          topic: "Kinematics",
          status: "pending",
        },
        {
          id: 13,
          time: "21:30",
          duration: 180,
          task: "Study Slot 4",
          type: "study",
          subject: "Revision",
          topic: "Review Todays Notes",
          status: "pending",
        },
        {
          id: 14,
          time: "00:30",
          duration: 15,
          task: "Plan Next Day",
          type: "routine",
          status: "pending",
        },
        {
          id: 15,
          time: "00:45",
          duration: 5,
          task: "Final Skincare",
          type: "routine",
          status: "pending",
        },
      ];
      await setDoc(userDocRef, {
        tasks: defaultSchedule,
        createdAt: serverTimestamp(),
      });
    }
  }

  function attachRealtimeListeners() {
    const today = new Date().toISOString().split("T")[0];
    const scheduleDocRef = doc(db, `users/${userId}/schedule/${today}`);
    const punishmentsColRef = collection(db, `users/${userId}/punishments`);

    if (unsubscribeSchedule) unsubscribeSchedule();
    unsubscribeSchedule = onSnapshot(scheduleDocRef, (doc) => {
      if (doc.exists()) {
        schedule = doc
          .data()
          .tasks.sort((a, b) => a.time.localeCompare(b.time));
        renderTimeline();

        if (isInitialLoad) {
          getDailyKickstart();
          isInitialLoad = false;
        }
      }
    });

    if (unsubscribePunishments) unsubscribePunishments();
    const q = query(punishmentsColRef, where("cleared", "==", false));
    unsubscribePunishments = onSnapshot(q, (snapshot) => {
      punishmentQueue = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      updatePunishmentQueue();
    });
  }

  // --- RENDER & UI FUNCTIONS ---

  function renderTimeline() {
    timelineContainer.innerHTML = "";
    const now = new Date();
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

    schedule.forEach((item) => {
      const [hours, minutes] = item.time.split(":").map(Number);
      const itemTimeInMinutes = hours * 60 + minutes;
      const endTimeInMinutes = itemTimeInMinutes + item.duration;

      let isActive =
        currentTimeInMinutes >= itemTimeInMinutes &&
        currentTimeInMinutes < endTimeInMinutes;

      const card = document.createElement("div");
      card.className = `timeline-item relative pl-12 pb-6`;
      card.id = `task-${item.id}`;

      let statusDotClass = "pending";
      if (isActive && item.status === "pending") statusDotClass = "active";
      else if (item.status !== "pending") statusDotClass = item.status;

      let cardBg = "bg-gray-800";
      if (isActive && item.status === "pending")
        cardBg = "bg-blue-900/50 border border-blue-500";
      if (item.status === "done") cardBg = "bg-green-900/30";
      if (item.status === "late") cardBg = "bg-orange-900/30";
      if (item.status === "skipped") cardBg = "bg-red-900/30";

      let taskText = item.task;
      if (item.type === "study")
        taskText = `${item.task}: ${item.subject} - ${item.topic}`;
      if (item.details)
        taskText += ` <span class="text-sm text-gray-400">(${item.details})</span>`;

      let actionButtons = "";
      if (item.status === "pending") {
        actionButtons = `
                <button onclick="window.updateStatus(${item.id}, 'done')" class="bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-check"></i></button>
                <button onclick="window.updateStatus(${item.id}, 'late')" class="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-clock"></i></button>
                <button onclick="window.updateStatus(${item.id}, 'skipped')" class="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded-md transition"><i class="fas fa-times"></i></button>
            `;
      }

      card.innerHTML = `
            <div class="status-dot ${statusDotClass}"></div>
            <p class="absolute left-0 -top-1 font-roboto-mono text-sm text-gray-400">${
              item.time
            }</p>
            <div class="p-4 rounded-xl shadow-md transition ${cardBg}">
                <div class="flex justify-between items-start">
                    <div>
                        <h3 class="font-semibold text-white ${
                          item.status !== "pending" ? "line-through" : ""
                        }">${taskText}</h3>
                        <p class="text-xs text-gray-400">${
                          item.duration
                        } minutes</p>
                    </div>
                    <div class="flex gap-2 items-center flex-shrink-0 ml-4">
                        ${actionButtons}
                    </div>
                </div>
            </div>
        `;
      timelineContainer.appendChild(card);
    });
  }

  function updatePunishmentQueue() {
    if (punishmentQueue.length === 0) {
      punishmentQueueEl.innerHTML =
        '<p class="text-gray-400 italic">No punishments queued. Stay disciplined.</p>';
      clearPunishmentsBtn.classList.add("hidden");
    } else {
      punishmentQueueEl.innerHTML = punishmentQueue
        .map(
          (p) => `
            <div class="bg-gray-800 p-2 rounded-lg text-sm">
                <p class="text-red-400 font-semibold">${p.punishment}</p>
                <p class="text-xs text-gray-500">For: ${p.task}</p>
            </div>
        `
        )
        .join("");
      clearPunishmentsBtn.classList.remove("hidden");
    }
  }

  function updateClockAndFocus() {
    const now = new Date();
    document.getElementById("current-time").textContent =
      now.toLocaleTimeString("en-GB");
    document.getElementById("current-date").textContent =
      now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

    const activeItem = schedule.find((item) => {
      const [hours, minutes] = item.time.split(":").map(Number);
      const itemTimeInMinutes = hours * 60 + minutes;
      const endTimeInMinutes = itemTimeInMinutes + item.duration;
      return (
        currentTimeInMinutes >= itemTimeInMinutes &&
        currentTimeInMinutes < endTimeInMinutes
      );
    });

    if (
      activeItem &&
      activeItem.type === "study" &&
      activeItem.status === "pending"
    ) {
      studyFocusContentEl.innerHTML = `
            <p class="text-sm text-gray-400">${activeItem.subject}</p>
            <h3 class="text-2xl font-bold text-blue-300">${activeItem.topic}</h3>
            <p class="mt-4 text-sm text-gray-400">Focus on this topic for the current session. Good luck.</p>
        `;
      logStudyBtn.classList.remove("hidden");
      logStudyBtn.onclick = () => openModal(activeItem);
    } else if (!activeItem || activeItem.type !== "study") {
      studyFocusContentEl.innerHTML =
        '<p class="text-gray-500 italic text-center">Not a study slot. Focus on the current task.</p>';
      logStudyBtn.classList.add("hidden");
    }
  }

  // --- CORE LOGIC & EVENT HANDLERS ---

  window.updateStatus = async (id, newStatus) => {
    const itemIndex = schedule.findIndex((i) => i.id === id);
    if (itemIndex > -1) {
      schedule[itemIndex].status = newStatus;

      const today = new Date().toISOString().split("T")[0];
      const scheduleDocRef = doc(db, `users/${userId}/schedule/${today}`);
      await updateDoc(scheduleDocRef, { tasks: schedule });

      if (newStatus === "skipped" || newStatus === "late") {
        await addPunishment(schedule[itemIndex].task);
      }

      if (id === schedule[schedule.length - 1].id && newStatus === "done") {
        await getEndOfDayReport();
      }
    }
  };

  async function addPunishment(taskName) {
    // Count how many times this task was failed today
    const failCount = punishmentQueue.filter((p) => p.task === taskName).length;
    const recentPunishments = punishmentQueue
      .map((p) => p.punishment)
      .slice(-5)
      .join(", ");
    let severity = "normal";
    if (failCount >= 2 && failCount < 4) severity = "hard";
    if (failCount >= 4) severity = "extreme";
    const prompt = `As a strict fitness coach, generate a single, specific punishment exercise for a user who failed the task: "${taskName}". The user has recently done these exercises: ${recentPunishments}. Avoid suggesting those. The punishment should be ${severity} in difficulty. If the user has failed this task ${failCount} times today, escalate the punishment. Respond with only the exercise name and reps/duration.`;
    try {
      const punishmentText = await callGemini(prompt);
      await addDoc(collection(db, `users/${userId}/punishments`), {
        task: taskName,
        punishment: `✨ ${punishmentText}`,
        cleared: false,
        createdAt: serverTimestamp(),
        severity,
        failCount,
      });
    } catch (error) {
      console.error("Error generating punishment:", error);
      await addDoc(collection(db, `users/${userId}/punishments`), {
        task: taskName,
        punishment: "✨ (AI Error) 30 Burpees",
        cleared: false,
        createdAt: serverTimestamp(),
        severity,
        failCount,
      });
    }
  }

  clearPunishmentsBtn.addEventListener("click", async () => {
    const batch = writeBatch(db);
    punishmentQueue.forEach((p) => {
      const punishmentRef = doc(db, `users/${userId}/punishments`, p.id);
      batch.update(punishmentRef, { cleared: true });
    });
    await batch.commit();
    console.log("Punishments cleared.");
  });

  // --- GEMINI API INTEGRATION ---
  async function callGemini(prompt, isJson = false) {
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };

    const firebaseConfig =
      typeof __firebase_config !== "undefined"
        ? JSON.parse(__firebase_config)
        : {};
    const apiKey = firebaseConfig.apiKey;

    if (!apiKey) {
      throw new Error("API Key is missing from firebaseConfig in index.html");
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    if (isJson) {
      payload.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            subtopics: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
          },
        },
      };
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // --- ADDED: Enhanced error logging ---
      const errorBody = await response.json().catch(() => ({
        error: { message: "Could not parse error response." },
      }));
      console.error("Gemini API Error Body:", errorBody);
      throw new Error(
        `API call failed with status: ${response.status}. Message: ${
          errorBody.error?.message || "No specific message."
        }`
      );
    }

    const result = await response.json();
    if (
      result.candidates &&
      result.candidates.length > 0 &&
      result.candidates[0].content &&
      result.candidates[0].content.parts &&
      result.candidates[0].content.parts.length > 0
    ) {
      const text = result.candidates[0].content.parts[0].text;
      return isJson ? JSON.parse(text) : text;
    } else {
      throw new Error("Invalid response structure from API");
    }
  }

  // --- AI COACH FUNCTIONS ---
  async function getDailyKickstart() {
    if (!schedule || schedule.length === 0) return;
    const keyTasks = schedule
      .filter((item) => item.type === "study" || item.task.includes("Exercise"))
      .slice(0, 3)
      .map((item) => item.task)
      .join(", ");
    const prompt = `You are a motivational coach named 'Discipline Engine'. My schedule today includes: ${keyTasks}. Give me a short, powerful, one-paragraph motivational message to start my day strong. Be inspiring but firm.`;
    try {
      const message = await callGemini(prompt);
      aiCoachMessageEl.innerHTML = `✨ ${message}`;
    } catch (error) {
      console.error("Error fetching daily kickstart:", error);
      aiCoachMessageEl.textContent = "Focus and execute. You know the mission.";
    }
  }

  async function getEndOfDayReport() {
    aiCoachMessageEl.innerHTML = "✨ Generating your end-of-day report...";
    const doneCount = schedule.filter((i) => i.status === "done").length;
    const lateCount = schedule.filter((i) => i.status === "late").length;
    const skippedCount = schedule.filter((i) => i.status === "skipped").length;
    const performanceSummary = `Tasks Done: ${doneCount}, Tasks Late: ${lateCount}, Tasks Skipped: ${skippedCount}. Punishments earned: ${punishmentQueue.length}.`;

    const prompt = `You are a discipline coach reviewing my day. Here is my performance: ${performanceSummary}. Write a brief, constructive end-of-day report. Acknowledge successes, be firm about failures, and provide a single, critical piece of advice for tomorrow.`;
    try {
      const report = await callGemini(prompt);
      aiCoachMessageEl.innerHTML = `✨ ${report}`;
    } catch (error) {
      console.error("Error fetching end-of-day report:", error);
      aiCoachMessageEl.textContent =
        "Day complete. Review your performance and prepare for tomorrow.";
    }
  }

  // --- MODAL FUNCTIONS ---
  window.openModal = async (studyItem) => {
    modal.classList.remove("hidden");
    modalTopicTitle.textContent = studyItem.topic;
    aiSubtopicsContainer.innerHTML =
      '<p class="text-gray-500 italic animate-pulse">✨ Querying Gemini for a study plan...</p>';

    const prompt = `Act as an expert tutor. Break down the study topic "${studyItem.topic}" from the subject "${studyItem.subject}" into a concise list of 5-8 essential sub-topics for a single study session. These should be logical, sequential, and actionable.`;

    try {
      const response = await callGemini(prompt, true);
      const subtopics = response.subtopics;
      if (subtopics && subtopics.length > 0) {
        aiSubtopicsContainer.innerHTML = subtopics
          .map(
            (sub, index) => `
                <label for="subtopic-${index}" class="flex items-center p-2 rounded-md hover:bg-gray-700 cursor-pointer">
                    <input id="subtopic-${index}" type="checkbox" class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500">
                    <span class="ml-3 text-white">${sub}</span>
                </label>
            `
          )
          .join("");
      } else {
        aiSubtopicsContainer.innerHTML =
          '<p class="text-red-400">Could not generate sub-topics. Please try again.</p>';
      }
    } catch (error) {
      console.error("Error fetching sub-topics:", error);
      aiSubtopicsContainer.innerHTML = `<p class="text-red-400">Error: ${error.message}. Using fallback.`;
    }
  };

  window.closeModal = () => {
    modal.classList.add("hidden");
  };

  window.submitStudyLog = () => {
    console.log("Study log submitted.");
    closeModal();
    const activeStudyBlock = schedule.find(
      (item) => item.type === "study" && item.status === "pending"
    );
    if (activeStudyBlock) {
      window.updateStatus(activeStudyBlock.id, "done");
    }
  };

  // --- START THE APP ---
  initialize();

  // --- ADVANCED HABIT TRACKING & CONFIRMATION ---
  function scheduleHabitReminders() {
    // Find all routine/meal tasks for today
    if (!schedule || schedule.length === 0) return;
    const now = new Date();
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    schedule.forEach((item) => {
      if (
        (item.type === "routine" || item.type === "meal") &&
        item.status === "pending"
      ) {
        const [hours, minutes] = item.time.split(":").map(Number);
        const itemTimeInMinutes = hours * 60 + minutes;
        const msUntil = (itemTimeInMinutes - currentTimeInMinutes) * 60 * 1000;
        if (msUntil > 0) {
          setTimeout(() => triggerHabitReminder(item), msUntil);
        }
      }
    });
  }

  function triggerHabitReminder(task) {
    currentHabitTask = task;
    // Show browser notification if possible
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Reminder: ${task.task}`);
    }
    // Start confirmation timer
    startHabitConfirmationTimer(task);
  }

  function startHabitConfirmationTimer(task) {
    // Show a UI prompt (simple alert for now, can be improved)
    if (
      confirm(`Did you complete: ${task.task}? You have 5 minutes to confirm.`)
    ) {
      window.updateStatus(task.id, "done");
      return;
    }
    // If not confirmed, start 5-minute timer
    habitConfirmationTimeout = setTimeout(() => {
      playAlarm();
      window.updateStatus(task.id, "skipped");
      alert(`Task skipped: ${task.task}. Punishment assigned.`);
    }, 5 * 60 * 1000);
  }

  function playAlarm() {
    if (alarmSound) {
      alarmSound.play();
    }
  }

  // Request notification permission on load
  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
  }

  // Schedule habit reminders after schedule loads
  setTimeout(() => scheduleHabitReminders(), 3000);
  // --- LONG-TERM STUDY PLANNER LOGIC ---
  const openPlannerBtn = document.getElementById("open-study-planner-btn");
  const plannerModal = document.getElementById("study-planner-modal");
  const closePlannerBtn = document.getElementById("close-study-planner-btn");
  const plannerForm = document.getElementById("study-planner-form");

  // --- CALENDAR & ANALYTICS MODAL LOGIC ---
  const openAnalyticsBtn = document.getElementById("open-analytics-btn");
  const analyticsModal = document.getElementById("analytics-modal");
  const closeAnalyticsBtn = document.getElementById("close-analytics-btn");
  if (openAnalyticsBtn && analyticsModal && closeAnalyticsBtn) {
    openAnalyticsBtn.addEventListener("click", () => {
      analyticsModal.classList.remove("hidden");
    });
    closeAnalyticsBtn.addEventListener("click", () => {
      analyticsModal.classList.add("hidden");
    });
  }

  // --- DIGITAL WELLBEING LOGIC ---
  const wellbeingForm = document.getElementById("wellbeing-form");
  const wellbeingResult = document.getElementById("wellbeing-result");
  const SCREEN_TIME_LIMIT = 120; // minutes
  if (wellbeingForm && wellbeingResult) {
    wellbeingForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const minutes = parseInt(
        document.getElementById("wellbeing-screen-time").value,
        10
      );
      if (isNaN(minutes)) {
        wellbeingResult.textContent = "Please enter a valid number.";
        return;
      }
      if (minutes > SCREEN_TIME_LIMIT) {
        wellbeingResult.textContent = `Limit exceeded! (${minutes} min). Assigning punishment...`;
        await addPunishment("Exceeded screen time limit");
      } else {
        wellbeingResult.textContent = `Good job! Screen time within limit (${minutes} min).`;
      }
    });
  }

  if (openPlannerBtn && plannerModal && closePlannerBtn && plannerForm) {
    openPlannerBtn.addEventListener("click", () => {
      plannerModal.classList.remove("hidden");
    });
    closePlannerBtn.addEventListener("click", () => {
      plannerModal.classList.add("hidden");
    });
    plannerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const subject = document.getElementById("planner-subject").value.trim();
      const mainTopic = document
        .getElementById("planner-main-topic")
        .value.trim();
      const startDate = document.getElementById("planner-start-date").value;
      const endDate = document.getElementById("planner-end-date").value;
      const userSubtopicsRaw = document
        .getElementById("planner-user-subtopics")
        .value.trim();
      let userSubtopics = [];
      if (userSubtopicsRaw) {
        userSubtopics = userSubtopicsRaw.split("\n").map((line) => {
          const [topic, date] = line.split("|").map((s) => s.trim());
          return { topic, targetDate: date || null };
        });
      }
      if (!subject || !mainTopic || !startDate || !endDate) {
        alert("Please fill in all required fields.");
        return;
      }
      let aiSubtopics = [];
      try {
        // AI breakdown of main topic into sub-topics
        const prompt = `Break down the topic '${mainTopic}' in '${subject}' into a logical, ordered list of 8-15 essential sub-topics for a long-term study plan. For each, estimate the number of days required (1-3) to master it. Respond as a JSON array of objects: [{\"subtopic\": string, \"days\": number}]`;
        const aiResponse = await callGemini(prompt, true);
        aiSubtopics = aiResponse.subtopics || [];
      } catch (err) {
        alert(
          "AI breakdown failed, please try again or enter sub-topics manually."
        );
        return;
      }
      // Merge user sub-topics if provided
      let allSubtopics = aiSubtopics.map((s) => ({
        subtopic: s.subtopic,
        days: s.days,
        targetDate: null,
      }));
      if (userSubtopics.length > 0) {
        allSubtopics = userSubtopics
          .map((s) => ({
            subtopic: s.topic,
            days: 1,
            targetDate: s.targetDate || null,
          }))
          .concat(allSubtopics);
      }
      try {
        const userGoalsRef = collection(db, `users/${userId}/studyGoals`);
        await addDoc(userGoalsRef, {
          subject,
          mainTopic,
          startDate,
          endDate,
          subtopics: allSubtopics,
          createdAt: serverTimestamp(),
        });
        // --- AUTO-ALLOCATE SUBTOPICS TO DAILY SCHEDULE ---
        await allocateSubtopicsToSchedule(
          subject,
          startDate,
          endDate,
          allSubtopics
        );
        alert("Study goal saved and scheduled!");
        plannerModal.classList.add("hidden");
        plannerForm.reset();
      } catch (err) {
        alert("Error saving goal: " + err.message);
      }
    });
  }

  // --- AUTO-ALLOCATE SUBTOPICS TO DAILY SCHEDULE ---
  async function allocateSubtopicsToSchedule(
    subject,
    startDate,
    endDate,
    subtopics
  ) {
    // Get all dates between startDate and endDate
    const days = [];
    let current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
      days.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    // Distribute subtopics across days (one per study slot per day)
    let subIdx = 0;
    for (const day of days) {
      if (subIdx >= subtopics.length) break;
      // Get the schedule doc for this day
      const scheduleDocRef = doc(db, `users/${userId}/schedule/${day}`);
      let scheduleDoc = await getDoc(scheduleDocRef);
      let tasks = [];
      if (scheduleDoc.exists()) {
        tasks = scheduleDoc.data().tasks;
      } else {
        // If no schedule, create a default one (copy from today)
        const today = new Date().toISOString().split("T")[0];
        const todayDoc = await getDoc(
          doc(db, `users/${userId}/schedule/${today}`)
        );
        tasks = todayDoc.exists() ? todayDoc.data().tasks : [];
      }
      // Find study slots for this day
      const studySlots = tasks.filter(
        (t) => t.type === "study" && t.subject === subject
      );
      for (let slot of studySlots) {
        if (subIdx >= subtopics.length) break;
        slot.subject = subject;
        slot.topic = subtopics[subIdx].subtopic;
        slot.status = "pending";
        subIdx++;
      }
      await setDoc(
        scheduleDocRef,
        { tasks, updatedAt: serverTimestamp() },
        { merge: true }
      );
      if (subIdx >= subtopics.length) break;
    }
  }
}
