/**
 * app.js - UI Event Controllers, Auto-Assign logic, Drag & Drop editor, and Excel Exporter.
 */

import { 
  saveAppState, 
  loadAppState, 
  getInitialState, 
  validateAssignments, 
  parseTeacherCSV,
  parseClassCSV,
  parseSubjectCSV,
  parseRoomCSV,
  DEFAULT_ROOMS,
  SPECIAL_ROOMS,
  DEFAULT_ENGINE_SETTINGS,
  getSubjectColorHue
} from './data.js';

import { 
  runScheduler, 
  validateManualMove 
} from './scheduler.js';

// Application State
let state = getInitialState();

// Drag and drop tracking variables
let draggedElement = null;
let dragSourceSlot = null; // { day, period }
let dragSourceClass = null;

// Helper for safe Lucide icons creation
function safeCreateIcons() {
  if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
    try {
      lucide.createIcons();
    } catch (e) {
      console.warn("Lucide createIcons failed:", e);
    }
  }
}

// Initialize app on DOM Content Loaded
document.addEventListener("DOMContentLoaded", () => {
  // Load saved state or use initial state
  const savedState = loadAppState();
  if (savedState) {
    state = savedState;
    let dirty = false;
    if (!state.teachers || !Array.isArray(state.teachers)) {
      state.teachers = [];
      dirty = true;
    }
    if (!state.classes || !Array.isArray(state.classes)) {
      state.classes = [];
      dirty = true;
    }
    if (!state.subjects || !Array.isArray(state.subjects)) {
      state.subjects = [];
      dirty = true;
    }
    if (!state.assignments || !Array.isArray(state.assignments)) {
      state.assignments = [];
      dirty = true;
    }
    // Migrate the old single `lockedSlot` field to the new `lockedSlots`
    // array (supports locking more than one period for multi-hour subjects).
    state.assignments.forEach(a => {
      if (!Array.isArray(a.lockedSlots)) {
        a.lockedSlots = a.lockedSlot ? [a.lockedSlot] : [];
        delete a.lockedSlot;
        dirty = true;
      }
    });
    if (!state.rooms || typeof state.rooms !== 'object' || Array.isArray(state.rooms)) {
      state.rooms = {};
      dirty = true;
    }
    if (!state.engineSettings || typeof state.engineSettings !== 'object' || Array.isArray(state.engineSettings)) {
      state.engineSettings = { ...DEFAULT_ENGINE_SETTINGS };
      dirty = true;
    } else {
      // Backfill any settings keys missing from an older saved state
      Object.keys(DEFAULT_ENGINE_SETTINGS).forEach(key => {
        if (!(key in state.engineSettings)) {
          state.engineSettings[key] = DEFAULT_ENGINE_SETTINGS[key];
          dirty = true;
        }
      });
    }
    if (dirty) {
      saveAppState(state);
    }
  } else {
    state = getInitialState();
    saveAppState(state);
  }

  // Synchronize teacher assigned hours validation on startup
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  // Bind sidebar menu tabs
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const tabId = item.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  // Theme Toggle Handler
  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    
    const themeText = document.getElementById("theme-text");
    themeText.textContent = newTheme === "dark" ? "切換亮色模式" : "切換深色模式";
    
    // Save theme preference or let it match system
    localStorage.setItem("scheduler_theme", newTheme);
  });

  // Check saved theme
  const savedTheme = localStorage.getItem("scheduler_theme");
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
    const themeText = document.getElementById("theme-text");
    themeText.textContent = savedTheme === "dark" ? "切換亮色模式" : "切換深色模式";
  }

  // Backup & Import Data Handlers
  document.getElementById("btn-export-data").addEventListener("click", exportSystemData);
  
  const importFileBtn = document.getElementById("btn-import-data");
  const importFileInput = document.getElementById("import-data-file");
  importFileBtn.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", importSystemData);

  // This wipes every teacher/class/subject/assignment/schedule with no undo,
  // so a plain OK/Cancel confirm() is too easy to click through by habit -
  // require typing a confirmation word before it proceeds. Uses the app's
  // own modal (not window.prompt(), which Electron does not reliably
  // support - it silently no-ops in this app's renderer, making the
  // clear-data button appear completely broken).
  document.getElementById("btn-clear-all-data").addEventListener("click", () => {
    const teacherCount = state.teachers.length;
    const classCount = state.classes.length;
    document.getElementById("confirm-clear-data-message").textContent =
      `此操作將清空全校所有教師 (${teacherCount} 位)、班級 (${classCount} 班)、科目、配課與排課表紀錄，且無法復原！`;

    const input = document.getElementById("confirm-clear-data-input");
    input.value = "";
    document.getElementById("btn-confirm-clear-data").disabled = true;

    document.getElementById("modal-confirm-clear-data").classList.add("open");
    input.focus();
  });

  const confirmClearInput = document.getElementById("confirm-clear-data-input");
  const confirmClearBtn = document.getElementById("btn-confirm-clear-data");
  confirmClearInput.addEventListener("input", () => {
    confirmClearBtn.disabled = confirmClearInput.value.trim() !== "清空";
  });
  confirmClearInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !confirmClearBtn.disabled) confirmClearBtn.click();
  });

  confirmClearBtn.addEventListener("click", () => {
    if (confirmClearInput.value.trim() !== "清空") return; // defensive: button should already be disabled
    state = getInitialState();
    saveAppState(state);
    closeAllModals();
    renderCurrentTab();
    showConsoleLog("已清空瀏覽器中的所有暫存紀錄。");
  });

  // Settings Handlers: Tab Sub buttons
  const subTabBtns = document.querySelectorAll(".tab-sub-btn");
  subTabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      subTabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const subTabId = btn.getAttribute("data-sub-tab");
      document.querySelectorAll(".sub-tab-pane").forEach(pane => {
        pane.classList.remove("active");
      });
      document.getElementById(`sub-tab-${subTabId}`).classList.add("active");
      
      if (subTabId === "classes") {
        renderClassesAndRooms();
      } else if (subTabId === "subjects") {
        renderSubjects();
      }
    });
  });

  // Teacher manual add/edit handler
  document.getElementById("btn-add-teacher").addEventListener("click", () => openTeacherModal());
  document.getElementById("teacher-role").addEventListener("change", (e) => {
    toggleHomeroomClassInput(e.target.value);
  });

  // Class manual add handler
  document.getElementById("btn-add-class").addEventListener("click", () => openClassModal());
  document.getElementById("form-class").addEventListener("submit", handleClassFormSubmit);

  // Class CSV import handler
  const classCsvBtn = document.getElementById("btn-import-class");
  const classCsvInput = document.getElementById("class-csv-file-input");
  if (classCsvBtn && classCsvInput) {
    classCsvBtn.addEventListener("click", () => classCsvInput.click());
    classCsvInput.addEventListener("change", handleClassCSVSelect);
  }

  // Subject manual add handler
  document.getElementById("btn-add-subject").addEventListener("click", () => openSubjectModal());
  document.getElementById("form-subject").addEventListener("submit", handleSubjectFormSubmit);

  // Subject CSV import handler
  const subjectCsvBtn = document.getElementById("btn-import-subject-csv");
  const subjectCsvInput = document.getElementById("subject-csv-file-input");
  if (subjectCsvBtn && subjectCsvInput) {
    subjectCsvBtn.addEventListener("click", () => subjectCsvInput.click());
    subjectCsvInput.addEventListener("change", handleSubjectCSVSelect);
  }

  // Room manual add/edit handler
  const btnAddRoom = document.getElementById("btn-add-room");
  if (btnAddRoom) {
    btnAddRoom.addEventListener("click", () => openRoomModal());
  }
  const formRoom = document.getElementById("form-room");
  if (formRoom) {
    formRoom.addEventListener("submit", handleRoomFormSubmit);
  }

  // Room CSV import handler
  const roomCsvBtn = document.getElementById("btn-import-room");
  const roomCsvInput = document.getElementById("room-csv-file-input");
  if (roomCsvBtn && roomCsvInput) {
    roomCsvBtn.addEventListener("click", () => roomCsvInput.click());
    roomCsvInput.addEventListener("change", handleRoomCSVSelect);
  }

  // Subject template download button
  const downloadSubjectTmplBtn = document.getElementById("btn-download-subject-tmpl");
  if (downloadSubjectTmplBtn) {
    downloadSubjectTmplBtn.addEventListener("click", () => downloadSubjectCSVTemplate());
  }

  // Room template download button
  const downloadRoomTmplBtn = document.getElementById("btn-download-room-tmpl");
  if (downloadRoomTmplBtn) {
    downloadRoomTmplBtn.addEventListener("click", () => downloadRoomCSVTemplate());
  }

  // Search subject filter event
  const searchSubjectInput = document.getElementById("search-subject");
  if (searchSubjectInput) {
    searchSubjectInput.addEventListener("input", renderSubjects);
  }

  // CSV Drag and drop / file selector handlers
  const csvDropZone = document.getElementById("csv-drop-zone");
  const csvFileInput = document.getElementById("csv-file-input");
  
  csvDropZone.addEventListener("click", () => csvFileInput.click());
  csvFileInput.addEventListener("change", handleCSVSelect);
  
  csvDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    csvDropZone.classList.add("dragover");
  });
  
  csvDropZone.addEventListener("dragleave", () => {
    csvDropZone.classList.remove("dragover");
  });
  
  csvDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    csvDropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) {
      processCSVFile(file);
    } else {
      alert("請上傳正確的 .csv, .xlsx 或 .xls 檔案格式");
    }
  });

  document.getElementById("btn-download-teacher-min").addEventListener("click", () => {
    downloadTeacherMinCSVTemplate();
  });
  document.getElementById("btn-download-teacher-full").addEventListener("click", () => {
    downloadCSVTemplate();
  });
  document.getElementById("btn-download-class-tmpl").addEventListener("click", () => {
    downloadClassCSVTemplate();
  });

  // Teacher form submit
  document.getElementById("form-teacher").addEventListener("submit", handleTeacherFormSubmit);

  // Copy busy slots from another teacher
  document.getElementById("btn-copy-busy-slots").addEventListener("click", () => {
    const sourceId = document.getElementById("teacher-copy-busy-source").value;
    if (!sourceId) {
      alert("請先選擇要複製的教師。");
      return;
    }
    copyBusySlotsFromTeacher(sourceId);
  });

  // End busy-slots grid drag-painting wherever the mouse is released
  document.addEventListener("mouseup", () => {
    busySlotsPainting = false;
    roomBusySlotsPainting = false;
  });

  // Close Modals
  document.querySelectorAll(".btn-close-modal").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      closeAllModals();
    });
  });

  // Settings Search Teacher
  document.getElementById("search-teacher").addEventListener("input", (e) => {
    renderTeachersTable(e.target.value);
  });

  // Assignments Handlers
  document.getElementById("select-assign-class").addEventListener("change", () => {
    renderClassAssignments();
  });
  document.getElementById("btn-assign-mode-class").addEventListener("click", () => setAssignMode("class"));
  document.getElementById("btn-assign-mode-teacher").addEventListener("click", () => setAssignMode("teacher"));
  const btnUnassigned = document.getElementById("btn-assign-mode-unassigned");
  if (btnUnassigned) btnUnassigned.addEventListener("click", () => setAssignMode("unassigned"));
  const btnOverview = document.getElementById("btn-assign-mode-teacher-overview");
  if (btnOverview) btnOverview.addEventListener("click", () => setAssignMode("teacher-overview"));

  const gradeFilter = document.getElementById("select-unassigned-grade-filter");
  if (gradeFilter) gradeFilter.addEventListener("change", () => renderUnassignedAssignments());

  const searchInput = document.getElementById("input-unassigned-search");
  if (searchInput) searchInput.addEventListener("input", () => renderUnassignedAssignments());

  // Overview Filters Handlers
  const roleOverviewFilter = document.getElementById("select-overview-role-filter");
  if (roleOverviewFilter) roleOverviewFilter.addEventListener("change", () => renderTeacherOverviewAssignments());

  const statusOverviewFilter = document.getElementById("select-overview-status-filter");
  if (statusOverviewFilter) statusOverviewFilter.addEventListener("change", () => renderTeacherOverviewAssignments());

  const searchOverviewInput = document.getElementById("input-overview-search");
  if (searchOverviewInput) searchOverviewInput.addEventListener("input", () => renderTeacherOverviewAssignments());

  const btnExportOverviewExcel = document.getElementById("btn-export-teacher-overview-excel");
  if (btnExportOverviewExcel) btnExportOverviewExcel.addEventListener("click", () => exportTeacherOverviewExcel());

  const btnCopyAllSummary = document.getElementById("btn-copy-all-teacher-summary");
  if (btnCopyAllSummary) btnCopyAllSummary.addEventListener("click", () => copyAllTeacherSummaries());
  
  // Grade-wide lock tool (e.g. 本土語言拆班 - lock same subject to one slot across a whole grade)
  const gradeLockGrade = document.getElementById("grade-lock-grade");
  if (gradeLockGrade) gradeLockGrade.addEventListener("change", () => populateGradeLockSubjects());
  const btnApplyGradeLock = document.getElementById("btn-apply-grade-lock");
  if (btnApplyGradeLock) btnApplyGradeLock.addEventListener("click", () => applyGradeLock());
  const btnClearGradeLock = document.getElementById("btn-clear-grade-lock");
  if (btnClearGradeLock) btnClearGradeLock.addEventListener("click", () => clearGradeLock());

  document.getElementById("select-assign-teacher").addEventListener("change", () => renderTeacherBatchAssignments());
  document.getElementById("select-assign-teacher-subject").addEventListener("change", () => renderTeacherBatchAssignments());
  document.getElementById("btn-batch-select-all").addEventListener("click", () => batchAssignSelectAll(true));
  document.getElementById("btn-batch-deselect-all").addEventListener("click", () => batchAssignSelectAll(false));

  document.getElementById("btn-auto-assign-homeroom").addEventListener("click", autoAssignHomeroomTeachers);
  document.getElementById("btn-auto-assign-subjects").addEventListener("click", autoAssignSubjectTeachers);
  document.getElementById("btn-clear-assignments").addEventListener("click", () => {
    if (confirm("確定要清空所有班級配課資料嗎？這將同時重置排課表！")) {
      state.assignments.forEach(a => { a.teacherId = ""; a.lockedSlots = []; });
      state.schedule = null;
      saveAppState(state);
      renderCurrentTab();
    }
  });

  // Engine Handlers
  document.getElementById("btn-start-scheduling").addEventListener("click", startSchedulingEngine);
  document.getElementById("btn-clear-console").addEventListener("click", () => {
    const consoleOutput = document.getElementById("engine-console-output");
    consoleOutput.innerHTML = "[Ready] 系統排課引擎已就緒，等待指令...";
  });

  // Persist engine requirement/restriction settings as soon as they change,
  // so switching tabs mid-edit doesn't silently discard them.
  [
    "engine-max-backtracks", "engine-prefer-morning-core", "engine-prefer-consecutive-special",
    "engine-max-same-subject-per-day", "engine-max-teacher-weekly-hours", "engine-homeroom-min-free-periods",
    "engine-prefer-director-half-day"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      state.engineSettings = readEngineSettingsForm();
      saveAppState(state);
    });
  });

  // Viewer Handlers
  document.getElementById("viewer-dimension").addEventListener("change", handleViewerDimensionChange);
  document.getElementById("viewer-target-select").addEventListener("change", () => {
    renderTimetableGrid();
  });

  // Segmented dimension-switch buttons drive the hidden #viewer-dimension
  // select (so the existing dimension-keyed render logic is untouched) and
  // mirror the active state visually.
  document.querySelectorAll(".viewer-dimension-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const dimension = btn.getAttribute("data-dimension");
      document.querySelectorAll(".viewer-dimension-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const dimensionSelect = document.getElementById("viewer-dimension");
      dimensionSelect.value = dimension;
      dimensionSelect.dispatchEvent(new Event("change"));
    });
  });
  document.getElementById("btn-export-excel").addEventListener("click", exportTimetableToExcel);
  document.getElementById("btn-print-timetable").addEventListener("click", () => {
    window.print();
  });

  // Initialize Lucide Icons
  safeCreateIcons();

  // Load first tab view
  renderCurrentTab();
});

// Current view selector
let currentTab = "dashboard";

function switchTab(tabId) {
  currentTab = tabId;
  
  // Update sidebar active state
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
    if (item.getAttribute("data-tab") === tabId) {
      item.classList.add("active");
    }
  });

  // Update view panel visibility
  document.querySelectorAll(".tab-pane").forEach(pane => {
    pane.classList.remove("active");
  });
  document.getElementById(`tab-${tabId}`).classList.add("active");

  // Update headers
  const titles = {
    dashboard: { title: "系統儀表板", desc: "全校排課狀態、教師配課負擔與核心指標預覽" },
    settings: { title: "教師與班級設定", desc: "匯入名單、編輯教師屬性、管理專科教室容量" },
    assignments: { title: "線上互動配課", desc: "指定各班級每週科目授課教師，自動匹配專長" },
    engine: { title: "自動排課引擎", desc: "執行啟發式回溯演算法，自動排定無衝突的全校課表" },
    viewer: { title: "課表檢視與微調", desc: "檢視班級、教師或教室課表，支援拖拉微調與 Excel 導出" }
  };

  document.getElementById("current-tab-title").textContent = titles[tabId].title;
  document.getElementById("current-tab-desc").textContent = titles[tabId].desc;

  // Refresh tab data
  renderCurrentTab();
}

function renderCurrentTab() {
  // Update universal dashboard figures
  updateGlobalStats();

  if (currentTab === "dashboard") {
    renderDashboardView();
  } else if (currentTab === "settings") {
    // Determine which subtab is active
    const activeSubTab = document.querySelector(".tab-sub-btn.active").getAttribute("data-sub-tab");
    if (activeSubTab === "teachers") {
      renderTeachersTable();
    } else if (activeSubTab === "classes") {
      renderClassesAndRooms();
    } else if (activeSubTab === "subjects") {
      renderSubjects();
    }
  } else if (currentTab === "assignments") {
    renderAssignmentsView();
  } else if (currentTab === "engine") {
    renderEngineView();
  } else if (currentTab === "viewer") {
    renderViewersControls();
  }

  // Update icons
  safeCreateIcons();
}

// ----------------------------------------------------
// DASHBOARD FUNCTIONS
// ----------------------------------------------------
function updateGlobalStats() {
  const check = validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
  
  // Total assigned progress
  const targetHours = check.totalTargetHours || 1;
  const progressPercent = Math.min(100, Math.round((check.totalAssigned / targetHours) * 100));
  const progressBar = document.getElementById("bar-assign-progress");
  if (progressBar) progressBar.style.width = `${progressPercent}%`;
  
  const progressText = document.getElementById("stat-assign-progress");
  if (progressText) progressText.textContent = `${progressPercent}%`;
  
  const detailText = document.getElementById("stat-assign-detail");
  if (detailText) detailText.textContent = `已分配: ${check.totalAssigned} / ${check.totalTargetHours} 節`;

  // Timetable scheduling state
  const schedStatus = document.getElementById("stat-schedule-status");
  const schedDetail = document.getElementById("stat-schedule-detail");
  const schedIndicator = document.getElementById("indicator-schedule");
  
  if (state.schedule) {
    schedStatus.textContent = "已完成排課";
    schedDetail.textContent = "課表無衝突，可進行檢視與微調";
    schedIndicator.className = "status-indicator success";
  } else {
    schedStatus.textContent = "尚未排課";
    schedDetail.textContent = progressPercent === 100 ? "配課已完成，可啟動排課" : "需配課完成後方能啟動排課";
    schedIndicator.className = "status-indicator warning";
  }

  // Teacher warning count
  const totalWarnings = check.overloadedTeachers.length + check.underloadedTeachers.length;
  const teacherStatus = document.getElementById("stat-teacher-status");
  const teacherDetail = document.getElementById("stat-teacher-detail");
  if (teacherStatus && teacherDetail) {
    teacherStatus.textContent = `${totalWarnings} 位異常`;
    teacherDetail.textContent = `未達標: ${check.underloadedTeachers.length} 人 | 超載: ${check.overloadedTeachers.length} 人`;
  }
}

/**
 * Renders the dashboard's "系統基本規格矩陣" table from the actual imported
 * data (state.classes / state.subjects) instead of fixed placeholder
 * numbers - so before any classes exist, class counts and period subtotals
 * correctly show as empty/zero rather than a fake reference school's stats.
 */
function renderDashboardSpecMatrix() {
  const tbody = document.getElementById("dashboard-spec-matrix-tbody");
  if (!tbody) return;

  const bands = [
    { label: "低年級 (1-2年級)", grades: [1, 2], limitText: "僅週二上全天 (第 5-7 節可排)；其餘四天半天" },
    { label: "中年級 (3-4年級)", grades: [3, 4], limitText: "週三、週五上半天；週一、二、四全天" },
    { label: "高年級 (5-6年級)", grades: [5, 6], limitText: "僅週三上半天；其餘四天全天" }
  ];

  const gradeTargetHours = (grade) =>
    state.subjects.filter(s => s.grade === grade).reduce((sum, s) => sum + s.weeklyHours, 0);

  let totalClasses = 0;
  let totalHours = 0;
  let rowsHtml = "";

  bands.forEach(band => {
    const bandClasses = state.classes.filter(c => band.grades.includes(c.grade))
      .sort((a, b) => a.id.localeCompare(b.id));
    const classCountText = bandClasses.length > 0
      ? `${bandClasses.length} 班 (${bandClasses.map(c => c.name).join(', ')})`
      : "尚未建立班級";

    const gradesWithSubjects = band.grades.filter(g => state.subjects.some(s => s.grade === g));
    const perClassHoursSet = [...new Set(gradesWithSubjects.map(gradeTargetHours))];
    let perClassHoursText = "—";
    if (perClassHoursSet.length === 1) {
      perClassHoursText = `${perClassHoursSet[0]} 節`;
    } else if (perClassHoursSet.length > 1) {
      perClassHoursText = `${Math.min(...perClassHoursSet)}~${Math.max(...perClassHoursSet)} 節`;
    }

    const bandSubtotal = bandClasses.reduce((sum, c) => sum + gradeTargetHours(c.grade), 0);
    totalClasses += bandClasses.length;
    totalHours += bandSubtotal;

    rowsHtml += `
      <tr>
        <td>${band.label}</td>
        <td>${classCountText}</td>
        <td>${perClassHoursText}</td>
        <td>${bandSubtotal} 節</td>
        <td>${band.limitText}</td>
      </tr>
    `;
  });

  rowsHtml += `
    <tr class="table-total">
      <td>全校總計</td>
      <td>${totalClasses} 班</td>
      <td>—</td>
      <td><strong>${totalHours} 節</strong></td>
      <td>全校每週排課總額限制</td>
    </tr>
  `;

  tbody.innerHTML = rowsHtml;
}

function renderDashboardView() {
  renderDashboardSpecMatrix();

  // 編制基本數: total contracted base hours of non-hourly staff.
  // 鐘點教師補足: total hours actually covered by hourly/part-time teachers.
  const establishmentHours = state.teachers
    .filter(t => t.role !== 'hourly')
    .reduce((sum, t) => sum + (t.baseHours || 0), 0);
  const hourlyHours = state.teachers
    .filter(t => t.role === 'hourly')
    .reduce((sum, t) => sum + (t.assignedHours || 0), 0);
  const establishmentEl = document.getElementById("stat-establishment-hours");
  const hourlyEl = document.getElementById("stat-hourly-hours");
  if (establishmentEl) establishmentEl.textContent = `編制基本數: ${establishmentHours} 節`;
  if (hourlyEl) hourlyEl.textContent = `鐘點教師補足: ${hourlyHours} 節`;

  const container = document.getElementById("dashboard-teacher-loads");
  if (!container) return;

  container.innerHTML = "";

  // Sort teachers: show director/leader/homeroom/subject with mismatch first, then hourly
  const sorted = [...state.teachers].sort((a, b) => {
    if (a.role === 'hourly' && b.role !== 'hourly') return 1;
    if (a.role !== 'hourly' && b.role === 'hourly') return -1;
    
    // Non-hourly: sort by load deviation
    const devA = Math.abs(a.assignedHours - a.baseHours);
    const devB = Math.abs(b.assignedHours - b.baseHours);
    return devB - devA;
  });

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  sorted.forEach(t => {
    const item = document.createElement("div");
    item.className = "teacher-load-item";
    
    let loadClass = "load-status-exact";
    let statusText = "剛好達標";

    if (t.role === 'hourly') {
      loadClass = "load-status-hourly";
      statusText = "鐘點授課";
    } else if (t.assignedHours < t.baseHours) {
      loadClass = "load-status-under";
      statusText = `不足 ${t.baseHours - t.assignedHours} 節`;
    } else if (t.assignedHours > t.baseHours) {
      loadClass = "load-status-over";
      statusText = `超授 ${t.assignedHours - t.baseHours} 節`;
    }

    const summaryStr = formatTeacherAssignmentSummary(t);
    const homeroomClassText = t.role === 'homeroom' && t.targetClassId
      ? ` (${state.classes.find(c => c.id === t.targetClassId)?.name || t.targetClassId})`
      : '';

    item.innerHTML = `
      <div class="teacher-load-info" style="flex: 1;">
        <div class="flex-justify-between align-items-center">
          <span class="teacher-load-name">${t.name}</span>
          <span class="teacher-load-role">${roleLabels[t.role]}${homeroomClassText}</span>
        </div>
        <div class="text-secondary mt-1" style="font-size: 0.8rem; word-break: break-all;">
          ${summaryStr}
        </div>
      </div>
      <div class="teacher-load-hours text-right ml-3" style="min-width: 90px;">
        <strong class="${loadClass}">${t.assignedHours} / ${t.baseHours || 0} 節</strong>
        <div style="font-size: 0.7rem; color: var(--text-secondary);">${statusText}</div>
      </div>
    `;
    item.style.cursor = "pointer";
    item.title = `點擊查看 ${t.name} 老師詳細配課清單`;
    item.addEventListener("click", () => openTeacherAssignmentDetailModal(t.id));
    container.appendChild(item);
  });
}

// ----------------------------------------------------
// SETTINGS FUNCTIONS (TEACHERS & CLASSES)
// ----------------------------------------------------
/**
 * Updates a "共 N 筆" list-count badge, or "顯示 X / Y 筆" when a search
 * filter is actively narrowing the list, so users can tell data is loaded
 * without having to count table rows themselves.
 */
function updateListCountBadge(elementId, shownCount, totalCount) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = shownCount === totalCount ? `共 ${totalCount} 筆` : `顯示 ${shownCount} / ${totalCount} 筆`;
}

function renderTeachersTable(filterQuery = "") {
  const tbody = document.getElementById("teacher-list-tbody");
  if (!tbody) return;

  // Always sync teacher assigned hours validation first
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  tbody.innerHTML = "";
  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  const query = filterQuery.toLowerCase().trim();
  const filtered = state.teachers.filter(t => {
    return t.name.toLowerCase().includes(query) || 
           roleLabels[t.role].toLowerCase().includes(query) || 
           t.id.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    const emptyText = state.teachers.length === 0
      ? "尚無教師資料，請點擊右上角「手動新增教師」或使用「Excel / CSV 批次匯入」建立教師名單"
      : "查無符合搜尋條件的教師，請確認姓名/職務/編號拼寫";
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">${emptyText}</td></tr>`;
    updateListCountBadge("teacher-list-count", 0, state.teachers.length);
    return;
  }

  filtered.forEach(t => {
    const tr = document.createElement("tr");
    
    // Busy slots badges count
    const busyCount = t.busySlots ? t.busySlots.length : 0;
    const busyBadge = busyCount > 0 
      ? `<span class="badge badge-danger">${busyCount} 時段忙碌</span>` 
      : `<span class="badge badge-success">無限制</span>`;

    // Homeroom class badge
    const classBadge = t.targetClassId 
      ? `<span class="badge badge-primary">${t.targetClassId} 班</span>` 
      : '<span style="color: var(--text-secondary); font-size: 0.8rem;">—</span>';

    // Specialties badges
    const specBadges = t.specialties && t.specialties.length > 0
      ? t.specialties.map(s => `<span class="badge badge-info mr-1" style="margin-right: 3px;">${s}</span>`).join('')
      : '<span style="color: var(--text-secondary); font-size: 0.8rem;">未設定</span>';

    tr.innerHTML = `
      <td><strong>${t.id}</strong></td>
      <td>${t.name}</td>
      <td><span class="badge badge-secondary">${roleLabels[t.role]}</span></td>
      <td><strong>${t.baseHours} 節</strong></td>
      <td>${classBadge}</td>
      <td>${specBadges}</td>
      <td>${busyBadge}</td>
      <td>
        <button class="btn btn-secondary btn-icon btn-view-t-detail mr-1" data-id="${t.id}" title="查看配課明細">
          <i data-lucide="list-checks" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-secondary btn-icon btn-edit-t mr-1" data-id="${t.id}" title="編輯教師">
          <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-danger-outline btn-icon btn-delete-t" data-id="${t.id}" title="刪除教師">
          <i data-lucide="user-minus" style="width: 14px; height: 14px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind view detail, edit & delete buttons
  tbody.querySelectorAll(".btn-view-t-detail").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      openTeacherAssignmentDetailModal(id);
    });
  });

  tbody.querySelectorAll(".btn-edit-t").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      openTeacherModal(id);
    });
  });

  tbody.querySelectorAll(".btn-delete-t").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const name = state.teachers.find(t => t.id === id)?.name;
      if (confirm(`確定要刪除教師 ${name} (${id}) 嗎？其相關的班級配課也會被清除！`)) {
        // Remove from teachers
        state.teachers = state.teachers.filter(t => t.id !== id);
        // Clear related assignments
        state.assignments = state.assignments.filter(a => a.teacherId !== id);
        // Clear schedule
        state.schedule = null;
        saveAppState(state);
        renderCurrentTab();
      }
    });
  });

  updateListCountBadge("teacher-list-count", filtered.length, state.teachers.length);
  safeCreateIcons();
}

function ensureRoomExists(roomKey) {
  if (!roomKey || typeof roomKey !== 'string') return null;
  const key = roomKey.trim();
  if (!key || ["無", "不需要", "null", "無須", "-", "none"].includes(key.toLowerCase())) return null;

  if (!state.rooms) state.rooms = {};
  
  if (!state.rooms[key]) {
    let displayName = key;
    if (!displayName.endsWith("教室") && !displayName.endsWith("館") && !displayName.endsWith("場") && !displayName.endsWith("室") && !displayName.endsWith("中心")) {
      displayName = key + "教室";
    }
    state.rooms[key] = {
      name: displayName,
      limit: 1,
      busySlots: []
    };
    showConsoleLog(`自動依據科目資料建立專科教室【${displayName}】(代碼: ${key}，同時段上限: 1 班)`);
  }
  return key;
}

function renderClassesAndRooms() {
  // Render Class cards
  const classContainer = document.getElementById("class-cards-container");
  if (classContainer) {
    classContainer.innerHTML = "";
    
    // Sort classes numerically
    const sortedClasses = [...state.classes].sort((a, b) => a.id.localeCompare(b.id));
    updateListCountBadge("class-list-count", sortedClasses.length, sortedClasses.length);

    if (sortedClasses.length === 0) {
      classContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); width: 100%; padding: 2rem;">目前尚無班級資料，請點擊右上角手動新增班級。</div>`;
    } else {
      sortedClasses.forEach(c => {
        const targetHours = c.grade <= 2 ? 23 : (c.grade <= 4 ? 29 : 32);
        
        // Calculate current assigned hours for this class
        const assigned = state.assignments
          .filter(a => a.classId === c.id)
          .reduce((sum, a) => sum + a.weeklyHours, 0);

        const statusClass = assigned === targetHours ? 'badge-success' : (assigned > targetHours ? 'badge-danger' : 'badge-warning');

        const card = document.createElement("div");
        card.className = "class-card";
        card.innerHTML = `
          <span class="class-card-name">${c.name}</span>
          <span class="class-card-desc">級別: ${c.grade} 年級</span>
          <span class="badge ${statusClass} mt-2" style="font-size: 0.7rem;">配課: ${assigned} / ${targetHours} 節</span>
          <div class="flex gap-1 mt-3">
            <button class="btn btn-secondary-outline btn-icon btn-edit-class" data-id="${c.id}" style="padding: 4px; border-radius: 4px;" title="編輯班級">
              <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i>
            </button>
            <button class="btn btn-danger-outline btn-icon btn-delete-class" data-id="${c.id}" style="padding: 4px; border-radius: 4px;" title="刪除班級">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
          </div>
        `;
        classContainer.appendChild(card);
      });

      // Bind edit class buttons
      classContainer.querySelectorAll(".btn-edit-class").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          openClassModal(id);
        });
      });

      // Bind delete class buttons
      classContainer.querySelectorAll(".btn-delete-class").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          const name = state.classes.find(c => c.id === id)?.name;
          if (confirm(`確定要刪除班級 ${name} (${id}) 嗎？該班級的所有配課與排課表都會被清空！`)) {
            // Remove from classes
            state.classes = state.classes.filter(c => c.id !== id);
            // Remove assignments
            state.assignments = state.assignments.filter(a => a.classId !== id);
            // Clear schedule
            state.schedule = null;
            saveAppState(state);
            renderCurrentTab();
            showConsoleLog(`已手動刪除班級 ${name} (${id})`);
          }
        });
      });
    }
  }

  // Render Rooms limit list
  const roomTbody = document.getElementById("room-list-tbody");
  if (roomTbody) {
    roomTbody.innerHTML = "";
    const rooms = state.rooms || {};
    const keys = Object.keys(rooms);

    if (keys.length === 0) {
      roomTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">目前尚無專科教室。將於匯入科目 CSV 時自動由「特殊教室」欄位擷取建立，或可點擊右上方「新增專科教室」手動新增。</td></tr>`;
    } else {
      keys.forEach(key => {
        const room = rooms[key];
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${room.name}</strong></td>
          <td><span class="badge badge-info">${key}</span></td>
          <td>
            <input type="number" class="input-field input-room-limit" data-room="${key}" value="${room.limit}" min="1" max="10" style="width: 80px;">
          </td>
          <td>
            全校同時段排入「${room.name}」之班級上限 (${room.limit} 班)
            ${room.busySlots && room.busySlots.length > 0 ? `<br><span class="badge bg-warning" style="font-size:11px; margin-top:4px;"><i data-lucide="lock" class="icon-small"></i> 禁止排課 ${room.busySlots.length} 節</span>` : ''}
          </td>
          <td>
            <button class="btn btn-secondary btn-icon btn-edit-room mr-1" data-room="${key}" title="編輯教室">
              <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
            </button>
            <button class="btn btn-danger-outline btn-icon btn-delete-room" data-room="${key}" title="刪除教室">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </td>
        `;
        roomTbody.appendChild(tr);
      });

      // Save dynamic room changes
      roomTbody.querySelectorAll(".input-room-limit").forEach(input => {
        input.addEventListener("change", (e) => {
          const roomKey = e.target.getAttribute("data-room");
          const val = parseInt(e.target.value);
          if (state.rooms[roomKey] && !isNaN(val) && val >= 1) {
            state.rooms[roomKey].limit = val;
            state.schedule = null;
            saveAppState(state);
            showConsoleLog(`已修改專科教室【${state.rooms[roomKey].name}】同時段容納上限為 ${val} 班，已重置現有課表。`);
            updateGlobalStats();
          }
        });
      });

      // Edit room buttons
      roomTbody.querySelectorAll(".btn-edit-room").forEach(btn => {
        btn.addEventListener("click", () => {
          const roomKey = btn.getAttribute("data-room");
          openRoomModal(roomKey);
        });
      });

      // Delete room buttons
      roomTbody.querySelectorAll(".btn-delete-room").forEach(btn => {
        btn.addEventListener("click", () => {
          const roomKey = btn.getAttribute("data-room");
          deleteRoom(roomKey);
        });
      });
    }
  }
}

// ----------------------------------------------------
// ROOM MANAGEMENT FUNCTIONS
// ----------------------------------------------------
// Room Modal
let activeRoomBusySlots = []; // Local state for edit
let roomBusySlotsPainting = false; // True while mouse is held down dragging over the grid
let roomBusySlotsPaintValue = false; // The busy/free state being painted onto cells during a drag

function openRoomModal(roomKey = null) {
  const modal = document.getElementById("modal-room");
  if (!modal) return;
  const form = document.getElementById("form-room");
  const title = document.getElementById("modal-room-title");
  const actionInput = document.getElementById("room-form-action");
  const oldKeyInput = document.getElementById("room-old-key");
  const keyInput = document.getElementById("room-key");
  const nameInput = document.getElementById("room-name");
  const limitInput = document.getElementById("room-limit");

  form.reset();
  activeRoomBusySlots = [];

  if (roomKey && state.rooms && state.rooms[roomKey]) {
    const r = state.rooms[roomKey];
    title.textContent = `編輯專科教室: ${r.name}`;
    actionInput.value = "edit";
    oldKeyInput.value = roomKey;
    keyInput.value = roomKey;
    nameInput.value = r.name;
    limitInput.value = r.limit;
    activeRoomBusySlots = r.busySlots ? [...r.busySlots] : [];
  } else {
    title.textContent = "新增專科教室";
    actionInput.value = "create";
    oldKeyInput.value = "";
    keyInput.value = "";
    nameInput.value = "";
    limitInput.value = "1";
  }

  renderRoomBusySlotsGrid();

  modal.classList.add("open");
  safeCreateIcons();
}

/**
 * Renders the room's "禁止排課時段" mini calendar grid, mirroring the
 * teacher busy-slots selector (renderBusySlotsSelectorGrid) including
 * click-or-drag painting.
 */
function renderRoomBusySlotsGrid() {
  const container = document.getElementById("room-busy-slots-grid");
  if (!container) return;
  container.innerHTML = "";

  const days = ["節次", "一", "二", "三", "四", "五"];
  days.forEach(d => {
    const el = document.createElement("div");
    el.className = "busy-slot-label font-bold text-center";
    el.style.justifyContent = "center";
    el.textContent = d;
    container.appendChild(el);
  });

  for (let period = 1; period <= 7; period++) {
    const label = document.createElement("div");
    label.className = "busy-slot-label";
    label.textContent = `第 ${period} 節`;
    container.appendChild(label);

    for (let day = 1; day <= 5; day++) {
      const slotKey = `${day}-${period}`;
      const isBusy = activeRoomBusySlots.includes(slotKey);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `busy-slot-btn ${isBusy ? 'busy' : ''}`;
      btn.setAttribute("data-slot", slotKey);
      btn.title = `星期${day} 第${period}節`;

      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        roomBusySlotsPainting = true;
        roomBusySlotsPaintValue = !activeRoomBusySlots.includes(slotKey);
        applyRoomBusySlotPaint(slotKey, btn, roomBusySlotsPaintValue);
      });

      btn.addEventListener("mouseenter", () => {
        if (!roomBusySlotsPainting) return;
        applyRoomBusySlotPaint(slotKey, btn, roomBusySlotsPaintValue);
      });

      container.appendChild(btn);
    }
  }
}

/**
 * Sets a single room busy-slot cell to busy/free in both the local edit
 * state (activeRoomBusySlots) and its button's visual class, without toggling.
 */
function applyRoomBusySlotPaint(slotKey, btn, busy) {
  const idx = activeRoomBusySlots.indexOf(slotKey);
  if (busy && idx === -1) {
    activeRoomBusySlots.push(slotKey);
    btn.classList.add("busy");
  } else if (!busy && idx !== -1) {
    activeRoomBusySlots.splice(idx, 1);
    btn.classList.remove("busy");
  }
}

function handleRoomFormSubmit(e) {
  e.preventDefault();
  const action = document.getElementById("room-form-action").value;
  const oldKey = document.getElementById("room-old-key").value;
  const key = document.getElementById("room-key").value.trim();
  const name = document.getElementById("room-name").value.trim();
  const limit = parseInt(document.getElementById("room-limit").value) || 1;

  if (!key || !name) return;

  if (!state.rooms) state.rooms = {};

  const busySlots = [...activeRoomBusySlots];

  if (action === "create") {
    if (state.rooms[key]) {
      alert(`教室代碼/簡稱「${key}」已存在！請改用其他代碼。`);
      return;
    }
    state.rooms[key] = { name, limit, busySlots };
    showConsoleLog(`已成功新增專科教室【${name}】(${key})，容量上限: ${limit} 班，禁止排課時段: ${busySlots.length} 節`);
  } else {
    if (oldKey !== key && state.rooms[key]) {
      alert(`教室代碼/簡稱「${key}」已被其他教室使用！`);
      return;
    }
    if (oldKey !== key) {
      delete state.rooms[oldKey];
      state.subjects.forEach(s => {
        if (s.requiresRoom === oldKey) s.requiresRoom = key;
      });
      state.assignments.forEach(a => {
        if (a.requiresRoom === oldKey) a.requiresRoom = key;
      });
    }
    state.rooms[key] = { name, limit, busySlots };
    showConsoleLog(`已更新專科教室設定【${name}】(${key})，容量上限: ${limit} 班，禁止排課時段: ${busySlots.length} 節`);
  }

  state.schedule = null;
  saveAppState(state);
  closeAllModals();
  renderClassesAndRooms();
  renderSubjects();
  showConsoleLog("專科教室設定已更新。");
}

function deleteRoom(key) {
  if (!state.rooms || !state.rooms[key]) return;
  const rName = state.rooms[key].name;

  if (confirm(`確定要刪除專科教室【${rName}】(${key}) 嗎？連動需要該教室的科目設定將一併改為「不需要專科教室」。`)) {
    delete state.rooms[key];
    
    state.subjects.forEach(s => {
      if (s.requiresRoom === key) s.requiresRoom = null;
    });
    state.assignments.forEach(a => {
      if (a.requiresRoom === key) a.requiresRoom = null;
    });

    state.schedule = null;
    saveAppState(state);
    renderClassesAndRooms();
    renderSubjects();
    showConsoleLog(`已刪除專科教室【${rName}】(${key})。`);
  }
}

// Teacher Modal
let activeBusySlots = []; // Local state for edit
let busySlotsPainting = false; // True while mouse is held down dragging over the busy-slots grid
let busySlotsPaintValue = false; // The busy/free state being painted onto cells during a drag

function openTeacherModal(teacherId = null) {
  const modal = document.getElementById("modal-teacher");
  const form = document.getElementById("form-teacher");
  const title = document.getElementById("modal-teacher-title");
  const actionInput = document.getElementById("teacher-form-action");
  
  form.reset();
  activeBusySlots = [];

  // Populate homeroom class select
  const classSelect = document.getElementById("teacher-homeroom-class");
  classSelect.innerHTML = `<option value="">-- 無 --</option>`;
  state.classes.forEach(c => {
    // Only show classes not already assigned to another homeroom teacher (unless editing current teacher)
    const isAssigned = state.teachers.some(t => t.targetClassId === c.id && t.id !== teacherId);
    if (!isAssigned) {
      classSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    }
  });

  if (teacherId) {
    // Edit mode
    const t = state.teachers.find(x => x.id === teacherId);
    title.textContent = `編輯教師: ${t.name}`;
    actionInput.value = "edit";
    
    document.getElementById("teacher-id").value = t.id;
    document.getElementById("teacher-id").disabled = true; // Cannot edit ID
    document.getElementById("teacher-name").value = t.name;
    document.getElementById("teacher-role").value = t.role;
    document.getElementById("teacher-base-hours").value = t.baseHours;
    
    toggleHomeroomClassInput(t.role);
    if (t.role === 'homeroom') {
      document.getElementById("teacher-homeroom-class").value = t.targetClassId || "";
    }
    
    document.getElementById("teacher-specialties").value = t.specialties ? t.specialties.join("; ") : "";
    activeBusySlots = t.busySlots ? [...t.busySlots] : [];
  } else {
    // Create mode
    title.textContent = "手動新增教師";
    actionInput.value = "create";
    document.getElementById("teacher-id").disabled = false;
    toggleHomeroomClassInput("director");
  }

  // Populate "copy busy slots from another teacher" source select (excludes self)
  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };
  const copySourceSelect = document.getElementById("teacher-copy-busy-source");
  copySourceSelect.innerHTML = `<option value="">-- 從其他教師複製不排課時段 --</option>`;
  state.teachers
    .filter(t => t.id !== teacherId)
    .forEach(t => {
      const count = t.busySlots ? t.busySlots.length : 0;
      copySourceSelect.innerHTML += `<option value="${t.id}">${t.name} (${roleLabels[t.role] || t.role})，已設定 ${count} 節</option>`;
    });

  // Render busy slots selector mini grid
  renderBusySlotsSelectorGrid();

  modal.classList.add("open");
  safeCreateIcons();
}

function toggleHomeroomClassInput(role) {
  const group = document.getElementById("form-group-homeroom-class");
  if (role === 'homeroom') {
    group.style.display = 'flex';
  } else {
    group.style.display = 'none';
    document.getElementById("teacher-homeroom-class").value = "";
  }
}

function renderBusySlotsSelectorGrid() {
  const container = document.getElementById("busy-slots-grid");
  container.innerHTML = "";
  
  // Header row
  const days = ["節次", "一", "二", "三", "四", "五"];
  days.forEach(d => {
    const el = document.createElement("div");
    el.className = "busy-slot-label font-bold text-center";
    el.style.justifyContent = "center";
    el.textContent = d;
    container.appendChild(el);
  });

  // Periods rows
  for (let period = 1; period <= 7; period++) {
    // label
    const label = document.createElement("div");
    label.className = "busy-slot-label";
    label.textContent = `第 ${period} 節`;
    container.appendChild(label);

    // Days buttons
    for (let day = 1; day <= 5; day++) {
      const slotKey = `${day}-${period}`;
      const isBusy = activeBusySlots.includes(slotKey);
      
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `busy-slot-btn ${isBusy ? 'busy' : ''}`;
      btn.setAttribute("data-slot", slotKey);
      btn.title = `星期${day} 第${period}節`;

      // Drag-to-select: mousedown starts painting and sets the opposite of the
      // clicked cell's current state; dragging over other cells while the
      // button is held paints them to that same value. This also covers a
      // plain single click, since mousedown always fires first.
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // avoid text-selection drag while painting
        busySlotsPainting = true;
        busySlotsPaintValue = !activeBusySlots.includes(slotKey);
        applyBusySlotPaint(slotKey, btn, busySlotsPaintValue);
      });

      btn.addEventListener("mouseenter", () => {
        if (!busySlotsPainting) return;
        applyBusySlotPaint(slotKey, btn, busySlotsPaintValue);
      });

      container.appendChild(btn);
    }
  }
}

/**
 * Sets a single busy-slot cell to busy/free in both the local edit state
 * (activeBusySlots) and its button's visual class, without toggling.
 */
function applyBusySlotPaint(slotKey, btn, busy) {
  const idx = activeBusySlots.indexOf(slotKey);
  if (busy && idx === -1) {
    activeBusySlots.push(slotKey);
    btn.classList.add("busy");
  } else if (!busy && idx !== -1) {
    activeBusySlots.splice(idx, 1);
    btn.classList.remove("busy");
  }
}

/**
 * Copies another teacher's busySlots into the currently-edited teacher's
 * local edit state (e.g. for homeroom teachers of the same grade who share
 * identical non-teaching periods), then re-renders the grid.
 */
function copyBusySlotsFromTeacher(sourceTeacherId) {
  const source = state.teachers.find(t => t.id === sourceTeacherId);
  if (!source) return;

  if (activeBusySlots.length > 0 &&
      !confirm(`確定要用「${source.name}」的不排課時段設定覆蓋目前已勾選的內容嗎？`)) {
    return;
  }

  activeBusySlots = source.busySlots ? [...source.busySlots] : [];
  renderBusySlotsSelectorGrid();
  showConsoleLog(`已複製教師【${source.name}】的不排課時段設定 (${activeBusySlots.length} 節)。`);
}

function handleTeacherFormSubmit(e) {
  e.preventDefault();
  const action = document.getElementById("teacher-form-action").value;
  const id = document.getElementById("teacher-id").value.trim().toUpperCase();
  const name = document.getElementById("teacher-name").value.trim();
  const role = document.getElementById("teacher-role").value;
  const baseHoursInput = document.getElementById("teacher-base-hours").value;
  const targetClassId = document.getElementById("teacher-homeroom-class").value;
  const specialtiesText = document.getElementById("teacher-specialties").value;
  
  const defaultHours = { 'director': 3, 'leader': 9, 'homeroom': 16, 'subject': 20, 'hourly': 0 };
  const baseHours = baseHoursInput ? parseInt(baseHoursInput) : defaultHours[role];

  const specialties = specialtiesText 
    ? specialtiesText.split(';').map(s => s.trim()).filter(Boolean) 
    : [];

  const teacherData = {
    id,
    name,
    role,
    baseHours: isNaN(baseHours) ? defaultHours[role] : baseHours,
    assignedHours: 0,
    targetClassId: role === 'homeroom' ? targetClassId : null,
    specialties,
    busySlots: [...activeBusySlots]
  };

  if (action === "create") {
    // Check duplication
    if (state.teachers.some(t => t.id === id)) {
      alert("教師編號已存在！請使用其他編號。");
      return;
    }
    state.teachers.push(teacherData);
    showConsoleLog(`已成功手動新增教師 ${name} (${id})`);
  } else {
    // Edit mode
    const idx = state.teachers.findIndex(t => t.id === id);
    if (idx !== -1) {
      // Preserve assigned hours
      teacherData.assignedHours = state.teachers[idx].assignedHours;
      state.teachers[idx] = teacherData;
      showConsoleLog(`已成功儲存教師資料修改: ${name} (${id})`);
    }
  }

  // Force schedule clear because constraints changed
  state.schedule = null;
  saveAppState(state);
  closeAllModals();
  renderCurrentTab();
}

function closeAllModals() {
  document.querySelectorAll(".modal").forEach(modal => {
    modal.classList.remove("open");
  });
}

function openClassModal(classId = null) {
  const modal = document.getElementById("modal-class");
  const form = document.getElementById("form-class");
  const title = document.getElementById("modal-class-title");
  const actionInput = document.getElementById("class-form-action");
  const oldIdInput = document.getElementById("class-old-id");
  const idInput = document.getElementById("class-id");
  const nameInput = document.getElementById("class-name");
  const gradeInput = document.getElementById("class-grade");
  const idEditHint = document.getElementById("class-id-edit-hint");

  form.reset();

  const cls = classId ? state.classes.find(c => c.id === classId) : null;

  if (cls) {
    title.textContent = `編輯班級: ${cls.name}`;
    actionInput.value = "edit";
    oldIdInput.value = cls.id;
    idInput.value = cls.id;
    idInput.disabled = true;
    if (idEditHint) idEditHint.style.display = "block";
    nameInput.value = cls.name;
    gradeInput.value = cls.grade;
  } else {
    title.textContent = "手動新增班級";
    actionInput.value = "create";
    oldIdInput.value = "";
    idInput.disabled = false;
    if (idEditHint) idEditHint.style.display = "none";
  }

  modal.classList.add("open");
  safeCreateIcons();
}

function handleClassFormSubmit(e) {
  e.preventDefault();
  const action = document.getElementById("class-form-action").value;
  const oldId = document.getElementById("class-old-id").value;
  const id = document.getElementById("class-id").value.trim();
  const name = document.getElementById("class-name").value.trim();
  const grade = parseInt(document.getElementById("class-grade").value);

  if (!id || !name || isNaN(grade)) return;

  if (action === "edit") {
    const cls = state.classes.find(c => c.id === oldId);
    if (!cls) {
      alert("找不到原始班級資料！");
      return;
    }

    const oldGrade = cls.grade;
    cls.name = name;
    cls.grade = grade;

    if (grade !== oldGrade) {
      // Grade changed: drop assignments for subjects that no longer belong
      // to this class under the new grade's subject template.
      const newGradeSubjects = state.subjects.filter(s => s.grade === grade);
      state.assignments = state.assignments.filter(a =>
        a.classId !== id || newGradeSubjects.some(s => s.subject === a.subject)
      );
      // Add empty assignments for subjects newly applicable under the new grade.
      newGradeSubjects.forEach(tmpl => {
        const exists = state.assignments.some(a => a.classId === id && a.subject === tmpl.subject);
        if (!exists) {
          state.assignments.push({
            id: `${id}-${tmpl.subject}`,
            classId: id,
            subject: tmpl.subject,
            weeklyHours: tmpl.weeklyHours,
            teacherId: "",
            requiresRoom: tmpl.requiresRoom
          });
        }
      });
    }

    state.schedule = null;
    saveAppState(state);
    closeAllModals();
    renderCurrentTab();
    showConsoleLog(`已成功更新班級 ${name} (${id})`);
    return;
  }

  if (state.classes.some(c => c.id === id)) {
    alert("班級 ID 已存在！請使用其他 ID。");
    return;
  }

  const newClassObj = { id, name, grade };
  state.classes.push(newClassObj);

  // Initialize assignments for this class
  const classSubjects = state.subjects.filter(s => s.grade === grade);

  classSubjects.forEach(tmpl => {
    state.assignments.push({
      id: `${id}-${tmpl.subject}`,
      classId: id,
      subject: tmpl.subject,
      weeklyHours: tmpl.weeklyHours,
      teacherId: "",
      requiresRoom: tmpl.requiresRoom
    });
  });

  // Force schedule clear because constraints changed
  state.schedule = null;
  saveAppState(state);
  closeAllModals();
  renderCurrentTab();
  showConsoleLog(`已成功手動新增班級 ${name} (${id})`);
}

// ----------------------------------------------------
// CSV IMPORT FUNCTIONS
// ----------------------------------------------------
let tempImportTeachers = []; // Holds list before saving
let tempImportClasses = [];  // Holds list before saving
let tempImportRooms = [];    // Holds list before saving

function handleCSVSelect(e) {
  const file = e.target.files[0];
  if (file) {
    processCSVFile(file);
  }
}

function handleClassCSVSelect(e) {
  const file = e.target.files[0];
  if (file) {
    processClassCSVFile(file);
  }
}

function handleRoomCSVSelect(e) {
  const file = e.target.files[0];
  if (file) {
    processRoomCSVFile(file);
  }
}

// Helper: Reads CSV or Excel (.xlsx, .xls) file and converts to CSV string
function readFileAsCSVText(file, callback) {
  const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      let text = "";
      if (isExcel) {
        if (typeof XLSX === "undefined") {
          alert("SheetJS (XLSX) 解析模組未載入");
          return;
        }
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        text = XLSX.utils.sheet_to_csv(worksheet);
      } else {
        text = evt.target.result;
      }
      callback(null, text);
    } catch (err) {
      callback(err, null);
    }
  };

  if (isExcel) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file, "UTF-8");
  }
}

function processClassCSVFile(file) {
  readFileAsCSVText(file, (err, text) => {
    if (err) {
      alert("讀取檔案出錯，請確認檔案格式是否正確。");
      console.error(err);
      return;
    }
    try {
      tempImportClasses = parseClassCSV(text);
      if (tempImportClasses.length === 0) {
        alert("無法從檔案解析出有效的班級名單。請檢查格式是否符合。");
        return;
      }
      showClassCSVPreviewModal();
    } catch (err) {
      alert("解析檔案內容出錯，請確認格式正確。");
      console.error(err);
    }
  });
}

function showClassCSVPreviewModal() {
  const modal = document.getElementById("modal-class-import-confirm");
  const tbody = document.getElementById("class-csv-preview-tbody");
  tbody.innerHTML = "";

  tempImportClasses.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.id}</strong></td>
      <td>${c.name}</td>
      <td>${c.grade} 年級</td>
    `;
    tbody.appendChild(tr);
  });

  modal.classList.add("open");

  const confirmBtn = document.getElementById("btn-class-csv-confirm-save");
  confirmBtn.onclick = function() {
    tempImportClasses.forEach(newC => {
      const idx = state.classes.findIndex(c => c.id === newC.id);
      if (idx !== -1) {
        state.classes[idx] = newC;
      } else {
        state.classes.push(newC);
      }

      // Automatically initialize assignments for this class
      const classSubjects = state.subjects.filter(s => s.grade === newC.grade);

      classSubjects.forEach(tmpl => {
        const exists = state.assignments.some(a => a.classId === newC.id && a.subject === tmpl.subject);
        if (!exists) {
          state.assignments.push({
            id: `${newC.id}-${tmpl.subject}`,
            classId: newC.id,
            subject: tmpl.subject,
            weeklyHours: tmpl.weeklyHours,
            teacherId: "",
            requiresRoom: tmpl.requiresRoom
          });
        }
      });
    });

    state.schedule = null;
    saveAppState(state);
    closeAllModals();
    renderCurrentTab();
    showConsoleLog(`成功批次匯入 ${tempImportClasses.length} 個班級名單，課表已重置。`);
  };
}

function processCSVFile(file) {
  readFileAsCSVText(file, (err, text) => {
    if (err) {
      alert("讀取檔案出錯，請確認檔案格式是否正確。");
      console.error(err);
      return;
    }
    try {
      tempImportTeachers = parseTeacherCSV(text);
      if (tempImportTeachers.length === 0) {
        alert("無法從檔案解析出有效的教師名單。請檢查格式是否符合。");
        return;
      }
      showCSVPreviewModal();
    } catch (err) {
      alert("解析檔案內容出錯，請確認格式正確。");
      console.error(err);
    }
  });
}

function showCSVPreviewModal() {
  const modal = document.getElementById("modal-import-confirm");
  const tbody = document.getElementById("csv-preview-tbody");
  tbody.innerHTML = "";
  
  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  tempImportTeachers.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${t.id}</strong></td>
      <td>${t.name}</td>
      <td>${roleLabels[t.role]}</td>
      <td>${t.baseHours} 節</td>
      <td>${t.targetClassId || '無'}</td>
      <td>${t.specialties.join("; ")}</td>
    `;
    tbody.appendChild(tr);
  });

  modal.classList.add("open");

  // Hook confirmation button
  const confirmBtn = document.getElementById("btn-csv-confirm-save");
  confirmBtn.onclick = function() {
    // Add or override
    tempImportTeachers.forEach(newT => {
      const idx = state.teachers.findIndex(t => t.id === newT.id);
      if (idx !== -1) {
        // Keep busy slots and assigned hours if editing existing
        newT.busySlots = state.teachers[idx].busySlots;
        state.teachers[idx] = newT;
      } else {
        state.teachers.push(newT);
      }
    });

    // Clear schedule because data changed
    state.schedule = null;
    saveAppState(state);
    closeAllModals();
    renderCurrentTab();
    showConsoleLog(`成功批次匯入 ${tempImportTeachers.length} 名教師名單，課表已重置。`);
  };
}

function downloadCSVTemplate() {
  const header = "教師編號,姓名,身分職務,基本節數,帶班班級,專長科目\n";
  const rows = [
    "T001,陳主任,主任,3,,社會;閱讀",
    "T005,李組長,組長,9,,數學;彈性",
    "T012,鄭老師,導師,16,101,國語;數學;生活;綜合;閱讀;健康;彈性",
    "T027,戴體育,科任,20,,體育;健康",
    "T031,鐘電腦,鐘點,0,,電腦;彈性"
  ].join("\n");
  
  const csvContent = "\uFEFF" + header + rows; // Add UTF-8 BOM for Excel Chinese reading
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "智慧排課_教師匯入範本_完整.csv");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadTeacherMinCSVTemplate() {
  const header = "姓名,身分職務\n";
  const rows = [
    "陳主任,主任",
    "王組長,組長",
    "李組長,組長",
    "鄭老師,導師",
    "戴體育,科任",
    "鐘音樂,鐘點"
  ].join("\n");
  
  const csvContent = "\uFEFF" + header + rows;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "智慧排課_教師匯入範本_極簡.csv");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadClassCSVTemplate() {
  const header = "班級ID,班級名稱,年級\n";
  const rows = [
    "101,101 班,1",
    "102,102 班,1",
    "301,301 班,3",
    "501,501 班,5"
  ].join("\n");
  
  const csvContent = "\uFEFF" + header + rows;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "智慧排課_班級匯入範本.csv");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function processRoomCSVFile(file) {
  readFileAsCSVText(file, (err, text) => {
    if (err) {
      alert("讀取檔案出錯，請確認檔案格式是否正確。");
      console.error(err);
      return;
    }
    try {
      tempImportRooms = parseRoomCSV(text);
      if (tempImportRooms.length === 0) {
        alert("無法從檔案解析出有效的專科教室名單。請檢查格式是否符合。");
        return;
      }
      showRoomCSVPreviewModal();
    } catch (err) {
      alert("解析檔案內容出錯，請確認格式正確。");
      console.error(err);
    }
  });
}

function showRoomCSVPreviewModal() {
  const modal = document.getElementById("modal-room-import-confirm");
  const tbody = document.getElementById("room-csv-preview-tbody");
  tbody.innerHTML = "";

  tempImportRooms.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${r.key}</strong></td>
      <td>${r.name}</td>
      <td>${r.limit} 班</td>
    `;
    tbody.appendChild(tr);
  });

  modal.classList.add("open");

  const confirmBtn = document.getElementById("btn-room-csv-confirm-save");
  confirmBtn.onclick = function() {
    if (!state.rooms) state.rooms = {};

    tempImportRooms.forEach(newR => {
      const existing = state.rooms[newR.key];
      state.rooms[newR.key] = {
        name: newR.name,
        limit: newR.limit,
        busySlots: existing?.busySlots || []
      };
    });

    state.schedule = null;
    saveAppState(state);
    closeAllModals();
    renderClassesAndRooms();
    renderSubjects();
    showConsoleLog(`成功批次匯入 ${tempImportRooms.length} 間專科教室設定，課表已重置。`);
  };
}

function downloadRoomCSVTemplate() {
  const header = "代碼/簡稱,教室全稱,同時段容納上限\n";
  const rows = [
    "電腦,電腦教室,1",
    "體育,體育館,2",
    "音樂,音樂教室,1",
    "美勞,美勞教室,1"
  ].join("\n");

  const csvContent = "﻿" + header + rows;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "智慧排課_專科教室匯入範本.csv");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ----------------------------------------------------
// ASSIGNMENTS VIEW FUNCTIONS (ONLINE ASSIGNMENT)
// ----------------------------------------------------
let currentAssignMode = "class"; // "class", "teacher", or "unassigned"

function updateUnassignedBadge() {
  const badge = document.getElementById("unassigned-badge-count");
  if (!badge) return;
  
  let unassignedCount = 0;
  state.classes.forEach(c => {
    const classSubjects = state.subjects.filter(s => s.grade === c.grade);
    classSubjects.forEach(tmpl => {
      const assign = state.assignments.find(a => a.classId === c.id && a.subject === tmpl.subject);
      if (!assign || !assign.teacherId) {
        unassignedCount++;
      }
    });
  });

  if (unassignedCount > 0) {
    badge.textContent = unassignedCount;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

function setAssignMode(mode) {
  currentAssignMode = mode;
  const btnClass = document.getElementById("btn-assign-mode-class");
  const btnTeacher = document.getElementById("btn-assign-mode-teacher");
  const btnUnassigned = document.getElementById("btn-assign-mode-unassigned");
  const btnOverview = document.getElementById("btn-assign-mode-teacher-overview");

  const viewClass = document.getElementById("view-assign-by-class");
  const viewTeacher = document.getElementById("view-assign-by-teacher");
  const viewUnassigned = document.getElementById("view-assign-unassigned");
  const viewOverview = document.getElementById("view-assign-teacher-overview");

  if (btnClass) btnClass.className = mode === "class" ? "btn btn-sm btn-primary flex-1 btn-icon-text" : "btn btn-sm btn-secondary flex-1 btn-icon-text";
  if (btnTeacher) btnTeacher.className = mode === "teacher" ? "btn btn-sm btn-primary flex-1 btn-icon-text" : "btn btn-sm btn-secondary flex-1 btn-icon-text";
  if (btnUnassigned) btnUnassigned.className = mode === "unassigned" ? "btn btn-sm btn-primary flex-1 btn-icon-text" : "btn btn-sm btn-secondary flex-1 btn-icon-text";
  if (btnOverview) btnOverview.className = mode === "teacher-overview" ? "btn btn-sm btn-primary flex-1 btn-icon-text" : "btn btn-sm btn-secondary flex-1 btn-icon-text";

  if (viewClass) viewClass.style.display = mode === "class" ? "block" : "none";
  if (viewTeacher) viewTeacher.style.display = mode === "teacher" ? "block" : "none";
  if (viewUnassigned) viewUnassigned.style.display = mode === "unassigned" ? "block" : "none";
  if (viewOverview) viewOverview.style.display = mode === "teacher-overview" ? "block" : "none";

  if (mode === "class") {
    renderClassAssignments();
  } else if (mode === "teacher") {
    renderTeacherBatchAssignments();
  } else if (mode === "unassigned") {
    renderUnassignedAssignments();
  } else if (mode === "teacher-overview") {
    renderTeacherOverviewAssignments();
  }

  updateUnassignedBadge();
}

function renderAssignmentsView() {
  // Populate class selector
  const select = document.getElementById("select-assign-class");
  const currentVal = select.value;
  select.innerHTML = "";
  
  // Sort classes
  const sorted = [...state.classes].sort((a, b) => a.id.localeCompare(b.id));
  sorted.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });

  // Preserve previous selection if valid
  if (currentVal && state.classes.some(c => c.id === currentVal)) {
    select.value = currentVal;
  }

  // Render view based on current assignment mode
  setAssignMode(currentAssignMode);
  
  // Render sidebar loads
  renderTeacherLoadsSidebar();
}

/**
 * Render Unassigned Class Subjects View (未配課班級課程對照表與教師配對)
 */
function renderUnassignedAssignments() {
  const tbody = document.getElementById("unassigned-subjects-tbody");
  const countBadge = document.getElementById("unassigned-items-count");
  const hoursBadge = document.getElementById("unassigned-hours-count");
  const gradeFilter = document.getElementById("select-unassigned-grade-filter")?.value || "all";
  const searchText = (document.getElementById("input-unassigned-search")?.value || "").trim().toLowerCase();

  if (!tbody) return;

  // Always sync teacher assigned hours validation first
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  // Collect all unassigned class subjects
  const unassignedList = [];
  let totalUnassignedHours = 0;

  // Sort classes
  const sortedClasses = [...state.classes].sort((a, b) => a.id.localeCompare(b.id));

  sortedClasses.forEach(c => {
    if (gradeFilter !== "all" && String(c.grade) !== gradeFilter) return;

    const classSubjects = state.subjects.filter(s => s.grade === c.grade);
    classSubjects.forEach(tmpl => {
      const assign = state.assignments.find(a => a.classId === c.id && a.subject === tmpl.subject);
      const isAssigned = Boolean(assign && assign.teacherId);

      if (!isAssigned) {
        // Match search filter
        if (searchText) {
          const matchClass = c.name.toLowerCase().includes(searchText) || c.id.toLowerCase().includes(searchText);
          const matchSubject = tmpl.subject.toLowerCase().includes(searchText);
          if (!matchClass && !matchSubject) return;
        }

        unassignedList.push({
          classObj: c,
          subjectTmpl: tmpl,
          assignment: assign || null
        });
        totalUnassignedHours += tmpl.weeklyHours;
      }
    });
  });

  if (countBadge) countBadge.textContent = unassignedList.length;
  if (hoursBadge) hoursBadge.textContent = totalUnassignedHours;

  if (unassignedList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center p-4 text-success">
          <i data-lucide="check-circle" class="panel-icon mb-2" style="font-size:2rem;"></i>
          <div>🎉 無待配課的班級課程！全校所有班級科目皆已成功完成授課教師配對。</div>
        </td>
      </tr>
    `;
    safeCreateIcons();
    updateUnassignedBadge();
    return;
  }

  // Generate table rows
  tbody.innerHTML = "";

  unassignedList.forEach(item => {
    const c = item.classObj;
    const s = item.subjectTmpl;

    // Room text
    const roomText = s.requiresRoom ? `${state.rooms[s.requiresRoom]?.name || s.requiresRoom}` : "-";

    // Teacher Dropdown Options
    let teacherOptions = `<option value="">-- 請選擇配對教師 --</option>`;
    
    // Sort teachers: matching specialty first, then name
    const sortedTeachers = [...state.teachers].sort((a, b) => {
      const aMatch = (a.specialties || []).includes(s.subject) ? 1 : 0;
      const bMatch = (b.specialties || []).includes(s.subject) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return a.name.localeCompare(b.name);
    });

    sortedTeachers.forEach(t => {
      const isSpecialty = (t.specialties || []).includes(s.subject);
      const star = isSpecialty ? "⭐ " : "";
      const isOver = t.role !== "hourly" && t.assignedHours > t.baseHours;
      const overText = isOver ? ` (超 ${t.assignedHours - t.baseHours} 節)` : "";
      teacherOptions += `<option value="${t.id}">${star}${t.name} (${roleLabels[t.role] || t.role}) [已配:${t.assignedHours}/${t.baseHours}節]${overText}</option>`;
    });

    // Specialty matching info
    const specialtyTeachers = sortedTeachers.filter(t => (t.specialties || []).includes(s.subject));
    const specialtyText = specialtyTeachers.length > 0 
      ? `<span class="badge bg-success" title="專長教師: ${specialtyTeachers.map(t => t.name).join(', ')}">⭐ 專長教師 (${specialtyTeachers.length}位)</span>`
      : `<span class="text-muted" style="font-size:12px;">一般領域</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.name}</strong></td>
      <td><span class="badge bg-secondary">${s.subject}</span></td>
      <td style="text-align: center;"><strong>${s.weeklyHours}</strong> 節</td>
      <td><span class="text-muted" style="font-size: 13px;">${roomText}</span></td>
      <td>
        <select class="select-field select-unassigned-teacher" data-class-id="${c.id}" data-subject="${s.subject}" style="width: 100%; max-width: 320px;">
          ${teacherOptions}
        </select>
      </td>
      <td>${specialtyText}</td>
    `;

    tbody.appendChild(tr);
  });

  // Attach Change Event Listeners to teacher selects in unassigned table
  tbody.querySelectorAll(".select-unassigned-teacher").forEach(select => {
    select.addEventListener("change", (e) => {
      const classId = e.target.getAttribute("data-class-id");
      const subject = e.target.getAttribute("data-subject");
      const newTeacherId = e.target.value;

      if (!classId || !subject) return;

      const tmpl = state.subjects.find(st => st.subject === subject && st.grade === state.classes.find(cls => cls.id === classId)?.grade);
      let assign = state.assignments.find(a => a.classId === classId && a.subject === subject);

      if (newTeacherId) {
        if (!assign) {
          assign = {
            id: `${classId}-${subject}`,
            classId: classId,
            subject: subject,
            weeklyHours: tmpl ? tmpl.weeklyHours : 1,
            teacherId: newTeacherId,
            requiresRoom: tmpl ? tmpl.requiresRoom : null
          };
          state.assignments.push(assign);
        } else {
          assign.teacherId = newTeacherId;
        }

        const teacherObj = state.teachers.find(t => t.id === newTeacherId);
        showConsoleLog(`已成功配對【${classId} 班 ${subject}】至 ${teacherObj ? teacherObj.name : newTeacherId} 老師。`);
      } else {
        if (assign) {
          assign.teacherId = "";
        }
      }

      state.schedule = null;
      saveAppState(state);
      validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
      renderUnassignedAssignments();
      renderTeacherLoadsSidebar();
      updateUnassignedBadge();
    });
  });

  updateUnassignedBadge();
  safeCreateIcons();
}

/**
 * Render Teacher Batch Assignment View (科任教師為主配課)
 * 選擇教師 -> 選擇科目 -> 列出有該科目的班級並批次勾選
 */
function renderTeacherBatchAssignments() {
  const teacherSelect = document.getElementById("select-assign-teacher");
  const subjectSelect = document.getElementById("select-assign-teacher-subject");
  const tbody = document.getElementById("teacher-batch-assign-tbody");
  const summaryText = document.getElementById("batch-teacher-load-text");
  if (!teacherSelect || !subjectSelect || !tbody) return;

  // Always sync teacher assigned hours validation first
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  // 1. Populate Teacher Dropdown
  const prevTeacherId = teacherSelect.value;
  teacherSelect.innerHTML = "";
  if (state.teachers.length === 0) {
    teacherSelect.innerHTML = `<option value="">-- 無教師資料 --</option>`;
    subjectSelect.innerHTML = `<option value="">-- 無科目 --</option>`;
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-secondary py-4">請先新增或匯入教師資料</td></tr>`;
    if (summaryText) summaryText.textContent = "尚無教師資料";
    return;
  }

  state.teachers.forEach(t => {
    const loadStr = t.role !== 'hourly' ? ` (${t.assignedHours}/${t.baseHours}節)` : ` (鐘點)`;
    teacherSelect.innerHTML += `<option value="${t.id}" ${prevTeacherId === t.id ? 'selected' : ''}>${t.name} (${roleLabels[t.role]})${loadStr}</option>`;
  });

  const selectedTeacherId = teacherSelect.value;
  const selectedTeacher = state.teachers.find(t => t.id === selectedTeacherId);

  // 2. Populate Subject Dropdown based on unique subjects in state.subjects
  const prevSubject = subjectSelect.value;
  subjectSelect.innerHTML = "";
  
  const uniqueSubjectNames = Array.from(new Set(state.subjects.map(s => s.subject))).sort();
  if (uniqueSubjectNames.length === 0) {
    subjectSelect.innerHTML = `<option value="">-- 無科目 --</option>`;
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-secondary py-4">請先新增或匯入科目資料</td></tr>`;
    if (summaryText) summaryText.textContent = "尚無科目資料";
    return;
  }

  uniqueSubjectNames.forEach(subj => {
    const isSpecialty = selectedTeacher && selectedTeacher.specialties.includes(subj) ? " ⭐" : "";
    subjectSelect.innerHTML += `<option value="${subj}" ${prevSubject === subj ? 'selected' : ''}>${subj}${isSpecialty}</option>`;
  });

  const selectedSubject = subjectSelect.value || uniqueSubjectNames[0];

  // Update summary header
  if (selectedTeacher && summaryText) {
    const isSpecMatch = selectedTeacher.specialties.includes(selectedSubject);
    const specBadge = isSpecMatch ? '<span class="badge badge-success ml-2">專長相符 ⭐</span>' : '<span class="badge badge-warning ml-2">非專長科目</span>';
    summaryText.innerHTML = `目前教師：<strong>${selectedTeacher.name}</strong> (${roleLabels[selectedTeacher.role]}) | 已配節數：<strong class="text-primary">${selectedTeacher.assignedHours}</strong> / ${selectedTeacher.baseHours || 0} 節 ${specBadge}`;
  }

  // 3. Collect and render matching classes
  tbody.innerHTML = "";
  const matchingTemplates = state.subjects.filter(s => s.subject === selectedSubject);
  const matchingGrades = matchingTemplates.map(s => s.grade);
  const targetClasses = state.classes.filter(c => matchingGrades.includes(c.grade)).sort((a, b) => a.id.localeCompare(b.id));

  if (targetClasses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-secondary py-4">全校無任何班級在課程計畫中包含【${selectedSubject}】科目</td></tr>`;
    return;
  }

  targetClasses.forEach(c => {
    const tmpl = matchingTemplates.find(s => s.grade === c.grade);
    if (!tmpl) return;

    let assign = state.assignments.find(a => a.classId === c.id && a.subject === selectedSubject);
    if (!assign) {
      assign = {
        id: `${c.id}-${selectedSubject}`,
        classId: c.id,
        subject: selectedSubject,
        weeklyHours: tmpl.weeklyHours,
        teacherId: "",
        requiresRoom: tmpl.requiresRoom
      };
      state.assignments.push(assign);
    }

    const isAssignedToCurrent = selectedTeacher && assign.teacherId === selectedTeacher.id;

    let statusHtml = '<span class="badge badge-secondary">未指派</span>';
    if (assign.teacherId) {
      if (isAssignedToCurrent) {
        statusHtml = '<span class="badge badge-success">✓ 指派給本教師</span>';
      } else {
        const otherT = state.teachers.find(t => t.id === assign.teacherId);
        statusHtml = `<span class="badge badge-warning">已被 ${otherT ? otherT.name : '其他教師'} 指派</span>`;
      }
    }

    const roomNameStr = (state.rooms || SPECIAL_ROOMS)[tmpl.requiresRoom]?.name || tmpl.requiresRoom;
    const roomText = tmpl.requiresRoom 
      ? `<span class="badge badge-info">${roomNameStr}</span>` 
      : '<span style="color: var(--text-secondary);">無</span>';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" class="checkbox-batch-assign" data-class-id="${c.id}" ${isAssignedToCurrent ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
      </td>
      <td><strong>${c.name}</strong></td>
      <td>${c.grade} 年級</td>
      <td><strong>${tmpl.weeklyHours} 節</strong></td>
      <td>${roomText}</td>
      <td>${statusHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Re-bind Checkbox Handlers
  tbody.querySelectorAll(".checkbox-batch-assign").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const classId = e.target.getAttribute("data-class-id");
      const isChecked = e.target.checked;
      
      const assign = state.assignments.find(a => a.classId === classId && a.subject === selectedSubject);
      if (assign && selectedTeacher) {
        if (isChecked) {
          assign.teacherId = selectedTeacher.id;
        } else {
          if (assign.teacherId === selectedTeacher.id) {
            assign.teacherId = "";
          }
        }
        state.schedule = null;
        saveAppState(state);

        renderTeacherBatchAssignments();
        renderTeacherLoadsSidebar();
        updateGlobalStats();
      }
    });
  });

  // Update overall progress bar in tab header
  const check = validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
  const tabProgressText = document.getElementById("assign-progress-text");
  const tabProgressBar = document.getElementById("bar-assign-progress-tab");
  const overallTargetHours = check.totalTargetHours || 1;
  const progressPercent = Math.min(100, Math.round((check.totalAssigned / overallTargetHours) * 100));
  
  if (tabProgressText && tabProgressBar) {
    tabProgressText.textContent = `${check.totalAssigned} / ${check.totalTargetHours} 節 (${progressPercent}%)`;
    tabProgressBar.style.width = `${progressPercent}%`;
  }
}

/**
 * Batch Select All / Deselect All for current teacher & subject
 */
function batchAssignSelectAll(selectAll) {
  const teacherSelect = document.getElementById("select-assign-teacher");
  const subjectSelect = document.getElementById("select-assign-teacher-subject");
  if (!teacherSelect || !subjectSelect) return;

  const teacherId = teacherSelect.value;
  const subjectName = subjectSelect.value;
  if (!teacherId || !subjectName) return;

  const matchingTemplates = state.subjects.filter(s => s.subject === subjectName);
  const matchingGrades = matchingTemplates.map(s => s.grade);
  const targetClasses = state.classes.filter(c => matchingGrades.includes(c.grade));

  targetClasses.forEach(c => {
    const tmpl = matchingTemplates.find(s => s.grade === c.grade);
    if (!tmpl) return;

    let assign = state.assignments.find(a => a.classId === c.id && a.subject === subjectName);
    if (!assign) {
      assign = {
        id: `${c.id}-${subjectName}`,
        classId: c.id,
        subject: subjectName,
        weeklyHours: tmpl.weeklyHours,
        teacherId: "",
        requiresRoom: tmpl.requiresRoom
      };
      state.assignments.push(assign);
    }

    if (selectAll) {
      assign.teacherId = teacherId;
    } else {
      if (assign.teacherId === teacherId) {
        assign.teacherId = "";
      }
    }
  });

  state.schedule = null;
  saveAppState(state);

  renderTeacherBatchAssignments();
  renderTeacherLoadsSidebar();
  updateGlobalStats();
}

/**
 * Helper: Find homeroom teacher for a given class object or class ID
 */
function getHomeroomTeacherForClass(c) {
  if (!c) return null;
  const classObj = typeof c === 'string' ? state.classes.find(cls => cls.id === c) : c;
  if (!classObj) return null;

  return state.teachers.find(t => 
    (t.role === 'homeroom' && t.targetClassId === classObj.id) ||
    (classObj.homeroomTeacherId && t.id === classObj.homeroomTeacherId) ||
    (classObj.teacherId && t.id === classObj.teacherId) ||
    (classObj.teacher && t.name === classObj.teacher)
  ) || null;
}

function renderClassAssignments() {
  const classId = document.getElementById("select-assign-class").value;
  if (!classId) return;

  // Always sync teacher assigned hours validation first
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const cls = state.classes.find(c => c.id === classId);
  const tbody = document.getElementById("class-subjects-assign-tbody");
  tbody.innerHTML = "";

  // Get homeroom teacher for this class
  const classHomeroomTeacher = getHomeroomTeacherForClass(cls);

  // Get subjects template based on grade level
  const classSubjects = state.subjects.filter(s => s.grade === cls.grade);
  const classTargetHours = classSubjects.reduce((sum, s) => sum + s.weeklyHours, 0);
  
  document.getElementById("class-target-hours").textContent = classTargetHours;

  // Compute current total hours assigned for this class
  let currentAssigned = 0;
  
  classSubjects.forEach(tmpl => {
    const isHomeroomMain = Boolean(tmpl.isHomeroomMain);

    // Find if an assignment exists in state
    let assign = state.assignments.find(a => a.classId === classId && a.subject === tmpl.subject);
    
    if (!assign) {
      // Create empty assignment
      assign = {
        id: `${classId}-${tmpl.subject}`,
        classId: classId,
        subject: tmpl.subject,
        weeklyHours: tmpl.weeklyHours,
        teacherId: "",
        requiresRoom: tmpl.requiresRoom
      };
      state.assignments.push(assign);
    }
    
    if (assign.teacherId) {
      currentAssigned += assign.weeklyHours;
    }

    // Build select dropdown of teachers
    const tr = document.createElement("tr");
    
    let teacherSelectHtml = `<select class="select-field select-assign-teacher" data-assign-id="${assign.id}">`;
    teacherSelectHtml += `<option value="">-- 未指派 --</option>`;
    
    // Sort teachers: name order, but prioritize homeroom or matching specialties
    const sortedTeachers = [...state.teachers].sort((a, b) => {
      const isA_Homeroom = classHomeroomTeacher && a.id === classHomeroomTeacher.id;
      const isB_Homeroom = classHomeroomTeacher && b.id === classHomeroomTeacher.id;

      if (isHomeroomMain) {
        if (isA_Homeroom && !isB_Homeroom) return -1;
        if (!isA_Homeroom && isB_Homeroom) return 1;
      }

      const specA = a.specialties.includes(tmpl.subject) ? 1 : 0;
      const specB = b.specialties.includes(tmpl.subject) ? 1 : 0;
      if (specA !== specB) return specB - specA; // Put matching specialties on top
      
      if (isA_Homeroom !== isB_Homeroom) return isB_Homeroom - isA_Homeroom; // Put homeroom teacher on top

      return a.name.localeCompare(b.name);
    });

    sortedTeachers.forEach(t => {
      const isHomeroom = classHomeroomTeacher && t.id === classHomeroomTeacher.id ? " (導師)" : "";
      const isSpecialty = t.specialties.includes(tmpl.subject) ? " ⭐" : "";
      
      // Compute loading status text helper
      const loadLeft = t.role !== 'hourly' ? ` (已配: ${t.assignedHours}/${t.baseHours}節)` : " (鐘點)";
      
      teacherSelectHtml += `<option value="${t.id}" ${assign.teacherId === t.id ? 'selected' : ''}>${t.name}${isHomeroom}${isSpecialty}${loadLeft}</option>`;
    });
    
    teacherSelectHtml += `</select>`;

    // Specialty matching indicator
    const selectedTeacher = state.teachers.find(t => t.id === assign.teacherId);
    let matchIndicator = '<span class="badge badge-warning">未指派</span>';
    if (selectedTeacher) {
      const isClassHomeroom = classHomeroomTeacher && selectedTeacher.id === classHomeroomTeacher.id;
      const isMatch = (isHomeroomMain && isClassHomeroom) || selectedTeacher.specialties.includes(tmpl.subject);
      matchIndicator = isMatch 
        ? '<span class="badge badge-success">專長相符</span>' 
        : '<span class="badge badge-danger">專長不符</span>';
    }

    const roomNameStr = (state.rooms || SPECIAL_ROOMS)[tmpl.requiresRoom]?.name || tmpl.requiresRoom;
    const roomText = tmpl.requiresRoom 
      ? `<span class="badge badge-info">${roomNameStr}</span>` 
      : '<span style="color: var(--text-secondary);">無</span>';

    const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };
    const teacherRoleText = selectedTeacher
      ? `<span class="badge badge-secondary">${roleLabels[selectedTeacher.role]}</span>`
      : '—';

    // Locked-slot cell: e.g. 本土語言拆班需鎖定同年級各班於同一時段。A subject
    // can have more than one weekly period, so up to `weeklyHours` slots can
    // each be locked independently.
    const dayNames = ["", "一", "二", "三", "四", "五"];
    const lockedSlots = assign.lockedSlots || [];
    let lockCellHtml;
    if (!assign.teacherId) {
      lockCellHtml = `<span class="text-secondary" style="font-size:11px;">請先指派教師</span>`;
    } else {
      const lockedBadges = lockedSlots.map((slot, idx) => `
        <span class="badge bg-warning" style="font-size:11px;">
          <i data-lucide="lock" class="icon-small"></i> 週${dayNames[slot.day]} 第${slot.period}節
          <button type="button" class="btn-unlock-assign-slot" data-assign-id="${assign.id}" data-slot-index="${idx}" title="解除此節鎖定" style="border:none;background:none;cursor:pointer;color:inherit;padding:0 0 0 4px;">✕</button>
        </span>
      `).join('');

      const addRowHtml = lockedSlots.length < tmpl.weeklyHours ? `
        <div class="flex gap-1 align-items-center flex-wrap mt-1">
          <select class="select-field select-lock-day" data-assign-id="${assign.id}" style="width:60px; padding:2px 4px; font-size:11px;">
            <option value="1">週一</option>
            <option value="2">週二</option>
            <option value="3">週三</option>
            <option value="4">週四</option>
            <option value="5">週五</option>
          </select>
          <select class="select-field select-lock-period" data-assign-id="${assign.id}" style="width:56px; padding:2px 4px; font-size:11px;">
            <option value="1">1節</option>
            <option value="2">2節</option>
            <option value="3">3節</option>
            <option value="4">4節</option>
            <option value="5">5節</option>
            <option value="6">6節</option>
            <option value="7">7節</option>
          </select>
          <button type="button" class="btn btn-xs btn-secondary-outline btn-lock-assign" data-assign-id="${assign.id}" title="新增鎖定節次">
            <i data-lucide="lock"></i> ${lockedSlots.length > 0 ? '再鎖一節' : '鎖定此時段'}
          </button>
        </div>
      ` : '';

      lockCellHtml = `
        <div class="flex align-items-center gap-1 flex-wrap">${lockedBadges}</div>
        ${addRowHtml}
        ${lockedSlots.length > 0 ? `<div class="text-secondary" style="font-size:10px;">已鎖定 ${lockedSlots.length}/${tmpl.weeklyHours} 節</div>` : ''}
      `;
    }

    tr.innerHTML = `
      <td><strong>${tmpl.subject}</strong> ${isHomeroomMain ? '<span class="badge badge-info" style="font-size: 0.65rem; padding: 2px 4px;">導師主科</span>' : ''}</td>
      <td><strong>${tmpl.weeklyHours} 節</strong></td>
      <td>${roomText}</td>
      <td>${teacherSelectHtml}</td>
      <td>${teacherRoleText}</td>
      <td>${matchIndicator}</td>
      <td>${lockCellHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("class-assigned-hours").textContent = currentAssigned;

  // Re-bind select change listeners
  tbody.querySelectorAll(".select-assign-teacher").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const assignId = e.target.getAttribute("data-assign-id");
      const teacherId = e.target.value;

      const assign = state.assignments.find(a => a.id === assignId);
      if (assign) {
        assign.teacherId = teacherId;
        // Schedule is invalidated when assignment changes
        state.schedule = null;
        saveAppState(state);

        // Dynamic re-render
        renderClassAssignments();
        renderTeacherLoadsSidebar();
        updateGlobalStats();
      }
    });
  });

  // Re-bind per-assignment lock/unlock buttons
  tbody.querySelectorAll(".btn-lock-assign").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const assignId = e.currentTarget.getAttribute("data-assign-id");
      const row = e.currentTarget.closest("tr");
      const daySel = row.querySelector(".select-lock-day");
      const periodSel = row.querySelector(".select-lock-period");
      const assign = state.assignments.find(a => a.id === assignId);
      const dayNames = ["", "一", "二", "三", "四", "五"];
      if (assign && daySel && periodSel) {
        const day = parseInt(daySel.value);
        const period = parseInt(periodSel.value);
        if (!Array.isArray(assign.lockedSlots)) assign.lockedSlots = [];

        if (assign.lockedSlots.some(s => s.day === day && s.period === period)) {
          alert(`週${dayNames[day]} 第${period}節已經鎖定過了，請選擇其他時段。`);
          return;
        }

        if (assign.lockedSlots.length >= assign.weeklyHours) {
          alert(`「${assign.subject}」每週僅 ${assign.weeklyHours} 節，鎖定節數已達上限。`);
          return;
        }

        assign.lockedSlots.push({ day, period });
        state.schedule = null;
        saveAppState(state);
        renderClassAssignments();
        showConsoleLog(`已鎖定「${assign.subject}」於週${dayNames[day]} 第${period}節 (${assign.lockedSlots.length}/${assign.weeklyHours} 節已鎖定)，請重新執行自動排課引擎以套用。`);
      }
    });
  });

  tbody.querySelectorAll(".btn-unlock-assign-slot").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const assignId = e.currentTarget.getAttribute("data-assign-id");
      const slotIndex = parseInt(e.currentTarget.getAttribute("data-slot-index"));
      const assign = state.assignments.find(a => a.id === assignId);
      if (assign && Array.isArray(assign.lockedSlots) && assign.lockedSlots[slotIndex]) {
        const removed = assign.lockedSlots[slotIndex];
        assign.lockedSlots.splice(slotIndex, 1);
        state.schedule = null;
        saveAppState(state);
        renderClassAssignments();
        const dayNames = ["", "一", "二", "三", "四", "五"];
        showConsoleLog(`已解除「${assign.subject}」於週${dayNames[removed.day]} 第${removed.period}節的鎖定，請重新執行自動排課引擎以套用。`);
      }
    });
  });

  populateGradeLockSubjects();
  safeCreateIcons();

  // Update tabs header status
  const check = validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
  const tabProgressText = document.getElementById("assign-progress-text");
  const tabProgressBar = document.getElementById("bar-assign-progress-tab");
  const overallTargetHours = check.totalTargetHours || 1;
  const progressPercent = Math.min(100, Math.round((check.totalAssigned / overallTargetHours) * 100));
  
  if (tabProgressText && tabProgressBar) {
    tabProgressText.textContent = `${check.totalAssigned} / ${check.totalTargetHours} 節 (${progressPercent}%)`;
    tabProgressBar.style.width = `${progressPercent}%`;
  }
}

/**
 * Refresh the subject dropdown in the grade-wide lock tool to match the
 * currently selected grade's subject list.
 */
function populateGradeLockSubjects() {
  const gradeSel = document.getElementById("grade-lock-grade");
  const subjectSel = document.getElementById("grade-lock-subject");
  if (!gradeSel || !subjectSel) return;

  const grade = parseInt(gradeSel.value);
  const prevValue = subjectSel.value;
  const subjectsForGrade = state.subjects.filter(s => s.grade === grade);

  subjectSel.innerHTML = subjectsForGrade.map(s => `<option value="${s.subject}">${s.subject}</option>`).join('');

  if (subjectsForGrade.some(s => s.subject === prevValue)) {
    subjectSel.value = prevValue;
  }
}

/**
 * Lock a subject to one fixed day/period across every class in a grade -
 * e.g. 本土語言 split-class courses that must run simultaneously so
 * students can regroup across their original homeroom classes.
 */
function applyGradeLock() {
  const grade = parseInt(document.getElementById("grade-lock-grade").value);
  const subject = document.getElementById("grade-lock-subject").value;
  const day = parseInt(document.getElementById("grade-lock-day").value);
  const period = parseInt(document.getElementById("grade-lock-period").value);
  const statusEl = document.getElementById("grade-lock-status");
  const dayNames = ["", "一", "二", "三", "四", "五"];

  if (!subject) {
    if (statusEl) statusEl.innerHTML = `<span class="text-warning">請先選擇科目。</span>`;
    return;
  }

  const gradeClasses = state.classes.filter(c => c.grade === grade);
  const targetAssignments = state.assignments.filter(a =>
    gradeClasses.some(c => c.id === a.classId) && a.subject === subject
  );

  if (targetAssignments.length === 0) {
    if (statusEl) statusEl.innerHTML = `<span class="text-warning">找不到「${grade}年級」的「${subject}」配課紀錄。</span>`;
    return;
  }

  const missingTeacher = targetAssignments.filter(a => !a.teacherId);
  if (missingTeacher.length > 0) {
    if (statusEl) statusEl.innerHTML = `<span class="text-warning">⚠️ 以下班級尚未指派教師，無法鎖定：${missingTeacher.map(a => a.classId).join('、')}。請先完成配課再鎖定。</span>`;
    return;
  }

  // Each assignment may already carry its own locked slots (e.g. from
  // per-assignment locking, or a previous grade-wide lock at another
  // period) - append this slot rather than overwriting, skipping any
  // assignment that's already at its weekly-hours cap or already has this
  // exact slot locked.
  let appliedCount = 0;
  let skippedCount = 0;
  targetAssignments.forEach(a => {
    if (!Array.isArray(a.lockedSlots)) a.lockedSlots = [];
    const alreadyLocked = a.lockedSlots.some(s => s.day === day && s.period === period);
    if (alreadyLocked || a.lockedSlots.length >= a.weeklyHours) {
      skippedCount++;
      return;
    }
    a.lockedSlots.push({ day, period });
    appliedCount++;
  });

  // The current schedule (if any) doesn't yet honor this lock - require regeneration.
  state.schedule = null;
  saveAppState(state);
  renderClassAssignments();

  const skippedNote = skippedCount > 0 ? `（${skippedCount} 個班級已達鎖定節數上限或已鎖定該時段，已略過）` : '';
  if (statusEl) statusEl.innerHTML = `<span class="text-success">✅ 已將 ${appliedCount} 個班級的「${subject}」鎖定於週${dayNames[day]} 第${period}節。${skippedNote}請重新執行自動排課引擎以套用。</span>`;
  showConsoleLog(`已鎖定 ${grade}年級「${subject}」共 ${appliedCount} 班於週${dayNames[day]}第${period}節。${skippedNote}`);
}

/**
 * Clear the grade-wide lock previously applied by applyGradeLock() at the
 * currently-selected day/period (mirrors the Apply button's slot pair, so
 * only that one locked period is removed - other locked periods on the
 * same multi-hour subject are left untouched).
 */
function clearGradeLock() {
  const grade = parseInt(document.getElementById("grade-lock-grade").value);
  const subject = document.getElementById("grade-lock-subject").value;
  const day = parseInt(document.getElementById("grade-lock-day").value);
  const period = parseInt(document.getElementById("grade-lock-period").value);
  const statusEl = document.getElementById("grade-lock-status");
  const dayNames = ["", "一", "二", "三", "四", "五"];

  const gradeClasses = state.classes.filter(c => c.grade === grade);
  const targetAssignments = state.assignments.filter(a =>
    gradeClasses.some(c => c.id === a.classId) && a.subject === subject &&
    Array.isArray(a.lockedSlots) && a.lockedSlots.some(s => s.day === day && s.period === period)
  );

  if (targetAssignments.length === 0) {
    if (statusEl) statusEl.innerHTML = `「${grade}年級」的「${subject}」在週${dayNames[day]} 第${period}節目前沒有鎖定設定。`;
    return;
  }

  targetAssignments.forEach(a => {
    a.lockedSlots = a.lockedSlots.filter(s => !(s.day === day && s.period === period));
  });
  state.schedule = null;
  saveAppState(state);
  renderClassAssignments();

  if (statusEl) statusEl.innerHTML = `已清除 ${targetAssignments.length} 個班級的「${subject}」於週${dayNames[day]} 第${period}節的鎖定設定。`;
  showConsoleLog(`已清除 ${grade}年級「${subject}」於週${dayNames[day]} 第${period}節的鎖定設定 (${targetAssignments.length} 筆)。`);
}

function renderTeacherLoadsSidebar() {
  const container = document.getElementById("teacher-load-list-container");
  if (!container) return;

  container.innerHTML = "";
  
  // Re-run validation to get up-to-date hours
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  state.teachers.forEach(t => {
    const item = document.createElement("div");
    item.className = "teacher-load-item";
    
    let loadClass = "load-status-exact";
    if (t.role === 'hourly') {
      loadClass = "load-status-hourly";
    } else if (t.assignedHours < t.baseHours) {
      loadClass = "load-status-under";
    } else if (t.assignedHours > t.baseHours) {
      loadClass = "load-status-over";
    }

    const summaryStr = formatTeacherAssignmentSummary(t);

    item.innerHTML = `
      <div class="teacher-load-info" style="flex: 1;">
        <div class="flex-justify-between align-items-center mb-1">
          <div>
            <span class="teacher-load-name">${t.name}</span>
            <span class="teacher-load-role" style="margin-left: 4px;">${roleLabels[t.role]}${t.targetClassId ? ` (${t.targetClassId}導)` : ''}</span>
          </div>
          <strong class="${loadClass}">${t.assignedHours} / ${t.baseHours || 0} 節</strong>
        </div>
        <div class="text-secondary mt-1" style="font-size: 0.75rem; word-break: break-all; line-height: 1.3;">
          ${summaryStr}
        </div>
      </div>
    `;
    item.style.cursor = "pointer";
    item.title = `點擊查看 ${t.name} 老師詳細配課清單`;
    item.addEventListener("click", () => openTeacherAssignmentDetailModal(t.id));
    container.appendChild(item);
  });
}

/**
 * Auto assignment Helper 1: Bind homeroom teachers to core subjects in their class
 */
function autoAssignHomeroomTeachers() {
  let count = 0;
  
  state.classes.forEach(c => {
    // Find the teacher who is assigned as homeroom for this class via helper
    const teacher = getHomeroomTeacherForClass(c);
    if (!teacher) return;

    // Get subjects template
    const classSubjects = state.subjects.filter(s => s.grade === c.grade);

    classSubjects.forEach(tmpl => {
      const isHomeroom = Boolean(tmpl.isHomeroomMain);

      if (isHomeroom) {
        // Find or create assignment
        let assign = state.assignments.find(a => a.classId === c.id && a.subject === tmpl.subject);
        if (!assign) {
          assign = {
            id: `${c.id}-${tmpl.subject}`,
            classId: c.id,
            subject: tmpl.subject,
            weeklyHours: tmpl.weeklyHours,
            teacherId: teacher.id,
            requiresRoom: tmpl.requiresRoom
          };
          state.assignments.push(assign);
        } else {
          assign.teacherId = teacher.id;
        }
        count++;
      }
    });
  });

  state.schedule = null;
  saveAppState(state);
  renderCurrentTab();
  showConsoleLog(`「導師一鍵綁定」完成：共自動指派了 ${count} 門導師班級主科。`);
}

/**
 * Auto assignment Helper 2: Assign specialized classes (music, art, pe, science, computer) to subject/hourly teachers
 */
function autoAssignSubjectTeachers() {
  let count = 0;
  
  // Sort assignments that are not assigned yet
  state.assignments.forEach(assign => {
    if (assign.teacherId !== "") return; // Skip already assigned
    
    // Find best match teacher for this subject
    // Priority:
    // 1. Teachers with this specialty
    // 2. T.assignedHours < T.baseHours (excluding hourly)
    // 3. Select teacher with least workload
    let candidates = state.teachers.filter(t => t.specialties.includes(assign.subject));
    
    if (candidates.length === 0) {
      // Fallback: If no specialist, search by role general match (e.g. subject teachers)
      candidates = state.teachers.filter(t => t.role === 'subject' || t.role === 'hourly');
    }

    if (candidates.length > 0) {
      // Recalculate workloads
      validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

      // Sort candidates to select the one with most capacity
      candidates.sort((a, b) => {
        // Hourly has lowest priority in order to respect formal teachers basic hours
        if (a.role === 'hourly' && b.role !== 'hourly') return 1;
        if (a.role !== 'hourly' && b.role === 'hourly') return -1;
        
        if (a.role !== 'hourly' && b.role !== 'hourly') {
          const deficitA = a.baseHours - a.assignedHours;
          const deficitB = b.baseHours - b.assignedHours;
          return deficitB - deficitA; // Select teacher with highest deficit
        }
        
        return a.assignedHours - b.assignedHours; // Hourly: select lowest assigned
      });

      const selected = candidates[0];
      assign.teacherId = selected.id;
      // Immediately reflect assignedHours increment locally
      selected.assignedHours += assign.weeklyHours;
      count++;
    }
  });

  state.schedule = null;
  saveAppState(state);
  renderCurrentTab();
  showConsoleLog(`「科任專長自動匹配」完成：共自動指派了 ${count} 門科任/鐘點科目。`);
}

// ----------------------------------------------------
// AUTO-SCHEDULING ENGINE VIEW
// ----------------------------------------------------
function showConsoleLog(msg) {
  const consoleOutput = document.getElementById("engine-console-output");
  if (!consoleOutput) return;

  // Append with time or simple header
  const time = new Date().toLocaleTimeString();
  consoleOutput.innerHTML += `\n[${time}] ${msg}`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

/**
 * Populates the engine settings form fields from state.engineSettings
 * (falls back to defaults for any missing keys).
 */
function populateEngineSettingsForm() {
  const settings = { ...DEFAULT_ENGINE_SETTINGS, ...(state.engineSettings || {}) };

  document.getElementById("engine-max-backtracks").value = settings.maxBacktracks;
  document.getElementById("engine-prefer-morning-core").checked = settings.preferMorningCore;
  document.getElementById("engine-prefer-consecutive-special").checked = settings.preferConsecutiveSpecial;
  document.getElementById("engine-max-same-subject-per-day").value = settings.maxSameSubjectPerDay;
  document.getElementById("engine-max-teacher-weekly-hours").value = settings.maxTeacherWeeklyHours;
  document.getElementById("engine-homeroom-min-free-periods").value = settings.homeroomMinFreePeriods;
  document.getElementById("engine-prefer-director-half-day").checked = settings.preferDirectorHalfDay;
}

/**
 * Reads the current engine settings form values into a plain settings object.
 */
function readEngineSettingsForm() {
  return {
    maxBacktracks: parseInt(document.getElementById("engine-max-backtracks").value) || DEFAULT_ENGINE_SETTINGS.maxBacktracks,
    preferMorningCore: document.getElementById("engine-prefer-morning-core").checked,
    preferConsecutiveSpecial: document.getElementById("engine-prefer-consecutive-special").checked,
    maxSameSubjectPerDay: parseInt(document.getElementById("engine-max-same-subject-per-day").value) || DEFAULT_ENGINE_SETTINGS.maxSameSubjectPerDay,
    maxTeacherWeeklyHours: parseInt(document.getElementById("engine-max-teacher-weekly-hours").value) || DEFAULT_ENGINE_SETTINGS.maxTeacherWeeklyHours,
    homeroomMinFreePeriods: (() => {
      const v = parseInt(document.getElementById("engine-homeroom-min-free-periods").value);
      return Number.isNaN(v) || v < 0 ? DEFAULT_ENGINE_SETTINGS.homeroomMinFreePeriods : v;
    })(),
    preferDirectorHalfDay: document.getElementById("engine-prefer-director-half-day").checked
  };
}

function renderEngineView() {
  populateEngineSettingsForm();
  const check = validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
  
  const stepTotal = document.getElementById("check-step-total-hours");
  const stepTeacher = document.getElementById("check-step-teacher-errors");
  const stepBusy = document.getElementById("check-step-busy-slots");
  const currentAssignedSpan = document.getElementById("check-current-assigned");

  if (currentAssignedSpan) currentAssignedSpan.textContent = check.totalAssigned;

  if (check.totalAssigned === check.totalTargetHours) {
    stepTotal.className = "ok";
    stepTotal.innerHTML = `<i data-lucide="check-circle" class="icon-small text-success"></i> 全校配課已達 ${check.totalTargetHours} 節 (目前: ${check.totalAssigned}/${check.totalTargetHours} 節)`;
  } else {
    stepTotal.className = "ok";
    stepTotal.innerHTML = `<i data-lucide="info" class="icon-small text-primary"></i> 已配課 ${check.totalAssigned} / ${check.totalTargetHours} 節 (排課引擎將直接依此配課結果進行排課)`;
  }

  // Teacher warnings are soft warnings (do not block scheduler, but alert user)
  const teacherWarnings = check.overloadedTeachers.length + check.underloadedTeachers.length;
  if (teacherWarnings === 0) {
    stepTeacher.className = "ok";
    stepTeacher.innerHTML = `<i data-lucide="check-circle" class="icon-small text-success"></i> 全校教師配課負載全部達標`;
  } else {
    stepTeacher.className = "ok"; // still OK to run, but yellow alert
    stepTeacher.innerHTML = `<i data-lucide="info" class="icon-small text-primary"></i> 有 ${teacherWarnings} 位教師與基本節數不同 (不影響排課，直接以配課結果排課)`;
  }

  // Busy slots logic check
  // Check if any homeroom teacher is busy during their own homeroom class standard slots
  let busyConflicts = 0;
  state.teachers.forEach(t => {
    if (t.role === 'homeroom' && t.targetClassId && t.busySlots) {
      // If homeroom teacher is busy for too many periods, it is problematic
      if (t.busySlots.length > 15) {
        busyConflicts++;
      }
    }
  });

  if (busyConflicts === 0) {
    stepBusy.className = "ok";
    stepBusy.innerHTML = `<i data-lucide="check-circle" class="icon-small text-success"></i> 教師不可排課時段正常`;
  } else {
    stepBusy.className = "fail";
    stepBusy.innerHTML = `<i data-lucide="x-circle" class="icon-small text-danger"></i> 部分教師設定了過多忙碌時段 (${busyConflicts} 人)，可能導致引擎無解`;
  }

  safeCreateIcons();
}

function startSchedulingEngine() {
  const validAssignments = state.assignments.filter(a => Boolean(a.teacherId));
  if (validAssignments.length === 0) {
    alert("目前尚未有任何已指派教師的配課資料！請先至「線上互動配課」進行配課指派後，再啟動自動排課。");
    return;
  }

  const engineSettings = readEngineSettingsForm();
  state.engineSettings = engineSettings;
  saveAppState(state);

  const btn = document.getElementById("btn-start-scheduling");
  btn.disabled = true;
  btn.textContent = "排課引擎運算中...";

  const consoleOutput = document.getElementById("engine-console-output");
  consoleOutput.innerHTML = "";

  showConsoleLog("開始自動排課任務。");
  
  // Wrap solver in a tiny setTimeout to let UI update and not feel frozen
  setTimeout(() => {
    try {
      const schedule = runScheduler(
        state.teachers,
        state.classes,
        state.assignments,
        { ...engineSettings, rooms: state.rooms, subjects: state.subjects },
        showConsoleLog
      );

      if (schedule) {
        state.schedule = schedule;
        saveAppState(state);
        
        // Log to dev_history.log in workspace
        logDevHistory(
          "自動排課引擎成功產生無衝突課表",
          "完成自動排課",
          "MODIFIED",
          "data.js / scheduler.js",
          "自動排課成功"
        );

        alert("排課成功！系統即將轉入課表檢視畫面。");
        switchTab("viewer");
      } else {
        alert("自動排課失敗。系統無法在規定的回溯次數內找到無衝突解。請檢查控制台日誌，放寬限制後再試。");
      }
    } catch (e) {
      alert("自動排課發生異常錯誤：" + e.message);
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="play-circle"></i> <span>啟動智慧自動排課</span>`;
      safeCreateIcons();
    }
  }, 100);
}

// ----------------------------------------------------
// TIMETABLE VIEWER & DRAG & DROP FUNCTIONS
// ----------------------------------------------------
function renderViewersControls() {
  const select = document.getElementById("viewer-target-select");
  const dimension = document.getElementById("viewer-dimension").value;
  const label = document.getElementById("label-viewer-target");
  
  const currentVal = select.value;
  select.innerHTML = "";

  if (dimension === "class") {
    label.textContent = "選擇班級：";
    const sorted = [...state.classes].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
  } else if (dimension === "teacher") {
    label.textContent = "選擇教師：";
    const sorted = [...state.teachers].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(t => {
      select.innerHTML += `<option value="${t.id}">${t.name} (${t.role === 'hourly' ? '鐘點' : '專科'})</option>`;
    });
  } else if (dimension === "room") {
    label.textContent = "選擇教室：";
    const rooms = state.rooms || DEFAULT_ROOMS;

    // Some room references may only exist as free text on subjects/
    // assignments/schedule cells (e.g. imported before the room was
    // formally registered in state.rooms) - include those too, otherwise
    // this dropdown ends up empty and the room-centric view shows nothing.
    const roomKeys = new Set(Object.keys(rooms));
    state.subjects.forEach(s => { if (s.requiresRoom) roomKeys.add(s.requiresRoom); });
    state.assignments.forEach(a => { if (a.requiresRoom) roomKeys.add(a.requiresRoom); });
    if (state.schedule) {
      Object.values(state.schedule).forEach(classSchedule => {
        Object.values(classSchedule).forEach(cell => {
          if (cell && cell.requiresRoom) roomKeys.add(cell.requiresRoom);
        });
      });
    }

    [...roomKeys].sort((a, b) => a.localeCompare(b)).forEach(key => {
      select.innerHTML += `<option value="${key}">${rooms[key]?.name || key}</option>`;
    });
  }

  // Restore selection
  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }

  updateTimetableAlertMessage();

  // Render the grid table
  renderTimetableGrid();
}

function handleViewerDimensionChange() {
  updateTimetableAlertMessage();
  renderViewersControls();
}

/**
 * Updates the info banner above the timetable to match the active dimension.
 * Previously this note only appeared in class mode and was simply hidden
 * otherwise, which could read as "the page is broken" when dragging a card in
 * teacher/room mode did nothing - now it always explains what the current
 * mode does, and is kept in sync on both dimension change and initial load.
 */
function updateTimetableAlertMessage() {
  const alertMsg = document.getElementById("timetable-alert-message");
  const dimension = document.getElementById("viewer-dimension").value;
  if (!alertMsg) return;

  alertMsg.textContent = dimension === "class"
    ? "手動調整模式：點擊並拖曳課程方塊以調課。系統會自動驗證衝突。"
    : "目前為僅供檢視模式，無法拖曳調整課程。如需調整課程，請切換回「班級課表」。";
}

/**
 * Sets the large heading above the timetable (e.g. "101 班 課表") so the
 * table is self-explanatory once separated from the dropdown selection above
 * it - useful when printed, screenshotted, or scrolled past the controls.
 */
function updateTimetableTitle(dimension, targetId) {
  const titleEl = document.getElementById("timetable-title");
  if (!titleEl) return;

  if (!targetId) {
    titleEl.textContent = "";
    return;
  }

  if (dimension === "class") {
    const cls = state.classes.find(c => c.id === targetId);
    titleEl.textContent = cls ? `${cls.name} 課表` : "";
  } else if (dimension === "teacher") {
    const t = state.teachers.find(x => x.id === targetId);
    titleEl.textContent = t ? `${t.name} 老師 課表` : "";
  } else if (dimension === "room") {
    const room = (state.rooms || SPECIAL_ROOMS)[targetId];
    titleEl.textContent = `${room?.name || targetId} 課表`;
  }
}

/**
 * Renders the subject color legend above the timetable, plus markers for
 * locked/busy states. Computed from the whole school schedule (not just the
 * currently-selected class/teacher/room) so the legend stays stable while
 * switching between targets - the same color always means the same subject.
 */
function renderTimetableLegend() {
  const container = document.getElementById("timetable-legend");
  if (!container) return;

  if (!state.schedule) {
    container.innerHTML = "";
    return;
  }

  const subjectsPresent = new Set();
  Object.values(state.schedule).forEach(classSchedule => {
    Object.values(classSchedule).forEach(cell => {
      if (cell && cell.subject) subjectsPresent.add(cell.subject);
    });
  });

  if (subjectsPresent.size === 0) {
    container.innerHTML = "";
    return;
  }

  const subjectSwatches = [...subjectsPresent].sort((a, b) => a.localeCompare(b)).map(subject => `
    <div class="timetable-legend-item">
      <span class="timetable-legend-swatch subject-hue-${getSubjectColorHue(subject)}" style="background-color: var(--subject-${getSubjectColorHue(subject)}); border-radius: 3px;"></span>
      <span>${subject}</span>
    </div>
  `).join('');

  container.innerHTML = `
    ${subjectSwatches}
    <div class="timetable-legend-item">
      <span class="timetable-legend-swatch is-locked"></span>
      <span>已鎖定固定時段</span>
    </div>
    <div class="timetable-legend-item">
      <span class="timetable-legend-swatch is-busy"></span>
      <span>教師不可排課 (會議/忙碌)</span>
    </div>
  `;
}

function renderTimetableGrid() {
  const tbody = document.getElementById("timetable-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const dimension = document.getElementById("viewer-dimension").value;
  const targetId = document.getElementById("viewer-target-select").value;
  updateTimetableTitle(dimension, targetId);
  renderTimetableLegend();

  if (!state.schedule) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
      <i data-lucide="calendar-x" style="width: 3rem; height: 3rem; margin-bottom: 1rem; color: var(--warning-color);"></i>
      <p>目前尚無課表資料。請完成 100% 配課後，前往「自動排課引擎」生成課表！</p>
    </td></tr>`;
    safeCreateIcons();
    return;
  }

  if (!targetId) return;

  const periodsTiming = [
    { num: 1, time: "08:40 - 09:20" },
    { num: 2, time: "09:30 - 10:10" },
    { num: 3, time: "10:20 - 11:00" },
    { num: 4, time: "11:10 - 11:50" },
    { num: 0, time: "11:50 - 13:30", label: "午餐與午休 (Lunch Break)" },
    { num: 5, time: "13:30 - 14:10" },
    { num: 6, time: "14:20 - 15:00" },
    { num: 7, time: "15:10 - 15:50" }
  ];

  const targetClass = dimension === "class" ? state.classes.find(c => c.id === targetId) : null;

  periodsTiming.forEach(p => {
    const tr = document.createElement("tr");

    // Lunch row
    if (p.num === 0) {
      tr.className = "lunch-row";
      tr.innerHTML = `
        <td class="time-cell">${p.time}</td>
        <td colspan="5">${p.label}</td>
      `;
      tbody.appendChild(tr);
      return;
    }

    // Regular Period Row
    tr.innerHTML = `
      <td class="time-cell">
        <strong>第 ${p.num} 節</strong>
        <span>${p.time}</span>
      </td>
    `;

    // 5 Days column
    for (let day = 1; day <= 5; day++) {
      // Periods 6 & 7: if the whole afternoon (5-7) is dismissed for this
      // class's grade, they're already covered by period 5's rowspan cell.
      if (dimension === "class" && p.num >= 6 && isClassAfternoonLocked(targetClass, day)) {
        continue;
      }

      const td = document.createElement("td");
      td.setAttribute("data-day", day);
      td.setAttribute("data-period", p.num);

      // Render content based on selected dimension
      if (dimension === "class") {
        if (p.num === 5 && isClassAfternoonLocked(targetClass, day)) {
          td.className = "slot-locked";
          td.rowSpan = 3;
        } else {
          renderClassCell(td, targetId, day, p.num);
        }
      } else if (dimension === "teacher") {
        renderTeacherCell(td, targetId, day, p.num);
      } else if (dimension === "room") {
        renderRoomCell(td, targetId, day, p.num);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  // Enable drag and drop events only in class center view
  if (dimension === "class") {
    enableDragAndDropEvents(targetId);
  }

  safeCreateIcons();
}

/**
 * Whether the whole afternoon (periods 5-7) is dismissed / has no class
 * for this class's grade on the given day. The lock is all-or-nothing
 * across periods 5-7, so checking a single period is enough.
 */
function isClassAfternoonLocked(cls, day) {
  if (!cls) return false;
  if (cls.grade <= 2) return day !== 2;
  if (cls.grade >= 3 && cls.grade <= 4) return day === 3 || day === 5;
  if (cls.grade >= 5) return day === 3;
  return false;
}

function renderClassCell(td, classId, day, period) {
  // Check if slot is disabled/locked for this grade
  const cls = state.classes.find(c => c.id === classId);
  if (period >= 5 && isClassAfternoonLocked(cls, day)) {
    td.className = "slot-locked";
    return;
  }

  const cell = state.schedule[classId]?.[`${day}-${period}`];
  if (cell) {
    const teacher = state.teachers.find(t => t.id === cell.teacherId);
    const teacherName = teacher ? teacher.name : cell.teacherId;
    const roomNameStr = cell.requiresRoom ? ((state.rooms || SPECIAL_ROOMS)[cell.requiresRoom]?.name || cell.requiresRoom) : '';
    const colorClass = `subject-hue-${getSubjectColorHue(cell.subject)}`;
    const isLocked = Boolean(cell.locked);
    const lockIconHtml = isLocked ? '<i data-lucide="lock" class="timetable-card-lock-icon"></i>' : '';

    if (isLocked) td.classList.add("cell-pinned");

    // Split layout (70% subject/teacher | 30% room, all centered) when a
    // special room is assigned; otherwise the original stacked layout.
    const innerHtml = cell.requiresRoom ? `
        ${lockIconHtml}
        <div class="timetable-card-main-col">
          <span class="timetable-card-subject">${cell.subject}</span>
          <span class="timetable-card-teacher">${teacherName}</span>
        </div>
        <div class="timetable-card-room-col">
          <span class="timetable-card-room">${roomNameStr}</span>
        </div>
      ` : `
        ${lockIconHtml}
        <span class="timetable-card-subject">${cell.subject}</span>
        <span class="timetable-card-teacher">${teacherName}</span>
      `;

    td.innerHTML = `
      <div class="timetable-card ${cell.requiresRoom ? 'has-room' : ''} ${colorClass} ${isLocked ? 'pinned' : ''}" draggable="${isLocked ? 'false' : 'true'}" data-subject="${cell.subject}" data-teacher-id="${cell.teacherId}" data-room="${cell.requiresRoom || ''}" data-locked="${isLocked}" title="${isLocked ? '此課程已鎖定固定時段' : ''}">
        ${innerHtml}
      </div>
    `;
  }
}

function renderTeacherCell(td, teacherId, day, period) {
  // Search through all classes to see if this teacher is teaching
  let assignedClassId = null;
  let subject = null;
  let room = null;

  for (const classId in state.schedule) {
    const cell = state.schedule[classId][`${day}-${period}`];
    if (cell && cell.teacherId === teacherId) {
      assignedClassId = classId;
      subject = cell.subject;
      room = cell.requiresRoom;
      break;
    }
  }

  // Check if teacher has busy slots configuration
  const teacher = state.teachers.find(t => t.id === teacherId);
  const isBusy = teacher && teacher.busySlots.includes(`${day}-${period}`);

  if (isBusy) {
    td.style.backgroundColor = "var(--danger-bg)";
    td.style.color = "var(--danger-color)";
    td.style.textAlign = "center";
    td.style.verticalAlign = "middle";
    td.style.fontSize = "0.75rem";
    td.style.fontWeight = "600";
    td.textContent = "行政會議/忙碌";
    return;
  }

  if (assignedClassId) {
    const roomNameStr = room ? ((state.rooms || SPECIAL_ROOMS)[room]?.name || room) : '';
    const colorClass = `subject-hue-${getSubjectColorHue(subject)}`;

    // Split layout (70% class/subject | 30% room, all centered) when a
    // special room is assigned; otherwise the original stacked layout.
    const innerHtml = room ? `
        <div class="timetable-card-main-col">
          <span class="timetable-card-subject">${assignedClassId} 班</span>
          <span class="timetable-card-teacher">${subject}</span>
        </div>
        <div class="timetable-card-room-col">
          <span class="timetable-card-room">${roomNameStr}</span>
        </div>
      ` : `
        <span class="timetable-card-subject">${assignedClassId} 班</span>
        <span class="timetable-card-teacher">${subject}</span>
      `;

    td.innerHTML = `
      <div class="timetable-card ${room ? 'has-room' : ''} ${colorClass}">
        ${innerHtml}
      </div>
    `;
  }
}

function renderRoomCell(td, roomKey, day, period) {
  // Find which class is using this room at this period
  const occupiedClasses = [];

  for (const classId in state.schedule) {
    const cell = state.schedule[classId][`${day}-${period}`];
    if (cell && cell.requiresRoom === roomKey) {
      const teacher = state.teachers.find(t => t.id === cell.teacherId);
      occupiedClasses.push({ classId, subject: cell.subject, teacherName: teacher ? teacher.name : cell.teacherId });
    }
  }

  if (occupiedClasses.length > 0) {
    let content = "";
    occupiedClasses.forEach(oc => {
      const colorClass = `subject-hue-${getSubjectColorHue(oc.subject)}`;
      content += `
        <div class="timetable-card ${colorClass}" style="height: auto; margin-bottom: 2px;">
          <span class="timetable-card-subject">${oc.classId} 班</span>
          <span class="timetable-card-teacher">${oc.subject} (${oc.teacherName})</span>
        </div>
      `;
    });
    td.innerHTML = content;
    return;
  }

  // No class occupies this slot - if the room is marked as禁止排課 here, say so.
  const room = (state.rooms || SPECIAL_ROOMS)[roomKey];
  if (room?.busySlots?.includes(`${day}-${period}`)) {
    td.className = "slot-locked";
    td.innerHTML = `<span style="font-size: 0.7rem;">禁止排課</span>`;
  }
}

// ----------------------------------------------------
// DRAG & DROP CONTROLLER
// ----------------------------------------------------
function enableDragAndDropEvents(classId) {
  const cards = document.querySelectorAll("#timetable-tbody .timetable-card");
  const cells = document.querySelectorAll("#timetable-tbody td:not(.time-cell):not(.slot-locked):not(.cell-pinned)");

  cards.forEach(card => {
    card.addEventListener("dragstart", (e) => {
      draggedElement = card;
      dragSourceClass = classId;
      
      const parentTd = card.parentElement;
      dragSourceSlot = {
        day: parseInt(parentTd.getAttribute("data-day")),
        period: parseInt(parentTd.getAttribute("data-period"))
      };
      
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", card.getAttribute("data-subject"));
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      // Remove all drop highlight classes from cells
      cells.forEach(c => {
        c.classList.remove("drop-allowed", "drop-conflict");
      });
      draggedElement = null;
      dragSourceSlot = null;
      dragSourceClass = null;
    });
  });

  cells.forEach(cell => {
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!draggedElement) return;

      const targetDay = parseInt(cell.getAttribute("data-day"));
      const targetPeriod = parseInt(cell.getAttribute("data-period"));

      // Skip checking if it's the exact source slot
      if (dragSourceSlot.day === targetDay && dragSourceSlot.period === targetPeriod) {
        return;
      }

      // Prepare fake lesson model to validate
      const lesson = {
        subject: draggedElement.getAttribute("data-subject"),
        teacherId: draggedElement.getAttribute("data-teacher-id"),
        requiresRoom: draggedElement.getAttribute("data-room") || null,
        locked: draggedElement.getAttribute("data-locked") === "true"
      };

      const check = validateManualMove(
        state.schedule,
        state.teachers,
        classId,
        dragSourceSlot.day,
        dragSourceSlot.period,
        targetDay,
        targetPeriod,
        lesson,
        showConsoleLog,
        state.rooms,
        state.engineSettings,
        state.subjects
      );

      cell.classList.remove("drop-allowed", "drop-conflict");
      if (check.valid) {
        cell.classList.add("drop-allowed");
      } else {
        cell.classList.add("drop-conflict");
        cell.title = check.reason; // Set tooltip
      }
    });

    cell.addEventListener("dragleave", () => {
      cell.classList.remove("drop-allowed", "drop-conflict");
    });

    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!draggedElement) return;

      const targetDay = parseInt(cell.getAttribute("data-day"));
      const targetPeriod = parseInt(cell.getAttribute("data-period"));

      cell.classList.remove("drop-allowed", "drop-conflict");

      if (dragSourceSlot.day === targetDay && dragSourceSlot.period === targetPeriod) {
        return;
      }

      const lesson = {
        subject: draggedElement.getAttribute("data-subject"),
        teacherId: draggedElement.getAttribute("data-teacher-id"),
        requiresRoom: draggedElement.getAttribute("data-room") || null,
        locked: draggedElement.getAttribute("data-locked") === "true"
      };

      // Perform validation check
      const check = validateManualMove(
        state.schedule,
        state.teachers,
        classId,
        dragSourceSlot.day,
        dragSourceSlot.period,
        targetDay,
        targetPeriod,
        lesson,
        showConsoleLog,
        state.rooms,
        state.engineSettings,
        state.subjects
      );

      if (check.valid) {
        // Swap or move lessons in state.schedule
        const sourceKey = `${dragSourceSlot.day}-${dragSourceSlot.period}`;
        const targetKey = `${targetDay}-${targetPeriod}`;

        const tempTarget = state.schedule[classId][targetKey] || null;

        // Apply swap
        state.schedule[classId][targetKey] = {
          subject: lesson.subject,
          teacherId: lesson.teacherId,
          requiresRoom: lesson.requiresRoom,
          locked: false
        };

        if (tempTarget) {
          state.schedule[classId][sourceKey] = tempTarget;
        } else {
          delete state.schedule[classId][sourceKey];
        }

        saveAppState(state);
        renderTimetableGrid();
        
        // Log change to local dev log
        logDevHistory(
          `手動拖曳調整班級 ${classId} 課表，時段 ${sourceKey} ↔ ${targetKey}`,
          `課表拖拉調課`,
          "MODIFIED",
          "data.js",
          `手動調課成功。調課項目：${lesson.subject}，教師：${lesson.teacherId}`
        );

        showConsoleLog(`[Manual Adjust] 班級 ${classId} 課表已調整：${sourceKey} 與 ${targetKey} 互換完成。`);
      } else {
        alert(`無法調整課表！原因：${check.reason}`);
      }
    });
  });
}

// Helper to write logs locally in Workspace (runs via network log/ajax on real site, or writes inside node)
// Since this is client-only SPA, we also save history logs in `state.history` and output them to local console.
function logDevHistory(userPrompt, strategy, action, file, status) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logEntry = `
## [${timestamp}] - [${userPrompt}]

*   **使用者提示詞 / 需求 (User Prompt):**
    > ${userPrompt}

*   **實作策略與動機 (Implementation Strategy):**
    *   ${strategy}

*   **受影響檔案與變更 (Files Affected & Actions):**
    *   \`[${action}]\` \`${file}\`: ${status}

*   **目前狀態 (Current Status):** 已完成 Completed
`;
  console.log("Logged history entry:", logEntry);
}

// ----------------------------------------------------
// EXPORT SYSTEM STATE & TIMETABLE EXCEL EXPORTER
// ----------------------------------------------------
function exportSystemData() {
  const jsonContent = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", `智慧排課系統暫存紀錄_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showConsoleLog("成功將瀏覽器中的全校紀錄匯出為 JSON 檔案！");
}

function importSystemData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const imported = JSON.parse(evt.target.result);
      if (Array.isArray(imported.teachers) && Array.isArray(imported.classes)) {
        state = {
          teachers: imported.teachers || [],
          classes: imported.classes || [],
          subjects: imported.subjects || [],
          assignments: imported.assignments || [],
          schedule: imported.schedule || null
        };
        saveAppState(state);
        renderCurrentTab();
        alert("系統 JSON 紀錄資料匯入成功！");
        showConsoleLog("已成功載入外置 JSON 紀錄資料。");
      } else {
        alert("匯入的檔案結構不符！需為包含 teachers 與 classes 陣列的智慧排課 JSON 紀錄檔。");
      }
    } catch (err) {
      alert("無法解析 JSON 檔案，請確認檔案格式是否正確。");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file, "UTF-8");
}

function exportTimetableToExcel() {
  if (!state.schedule) {
    alert("目前無排課資料，無法匯出！");
    return;
  }

  // Create standard workbook
  const wb = XLSX.utils.book_new();

  // 1. Generate sheets for each class
  const sortedClasses = [...state.classes].sort((a, b) => a.id.localeCompare(b.id));
  
  sortedClasses.forEach(cls => {
    const data = [
      ["國小課表 - " + cls.name, "", "", "", "", ""],
      ["節次 / 時間", "星期一", "星期二", "星期三", "星期四", "星期五"]
    ];

    const periodsTiming = [
      { num: 1, time: "1 (08:40 - 09:20)" },
      { num: 2, time: "2 (09:30 - 10:10)" },
      { num: 3, time: "3 (10:20 - 11:00)" },
      { num: 4, time: "4 (11:10 - 11:50)" },
      { num: 0, time: "午休 / 午餐" },
      { num: 5, time: "5 (13:30 - 14:10)" },
      { num: 6, time: "6 (14:20 - 15:00)" },
      { num: 7, time: "7 (15:10 - 15:50)" }
    ];

    periodsTiming.forEach(p => {
      if (p.num === 0) {
        data.push([p.time, "午餐與休息", "午餐與休息", "午餐與休息", "午餐與休息", "午餐與休息"]);
        return;
      }

      const row = [p.time];
      for (let day = 1; day <= 5; day++) {
        // Check if locked
        if (cls.grade <= 2 && p.num >= 5 && day !== 2) {
          row.push("下課放學");
        } else if (cls.grade >= 3 && cls.grade <= 4 && p.num >= 5 && (day === 3 || day === 5)) {
          row.push("下課放學");
        } else if (cls.grade >= 5 && p.num >= 5 && day === 3) {
          row.push("下課放學");
        } else {
          const cell = state.schedule[cls.id]?.[`${day}-${p.num}`];
          if (cell) {
            const t = state.teachers.find(x => x.id === cell.teacherId);
            const rName = (state.rooms || SPECIAL_ROOMS)[cell.requiresRoom]?.name || cell.requiresRoom;
            const roomName = cell.requiresRoom ? ` [${rName}]` : '';
            row.push(`${cell.subject}\n(${t ? t.name : cell.teacherId})${roomName}`);
          } else {
            row.push("");
          }
        }
      }
      data.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, cls.name);
  });

  // 2. Generate sheets for each Teacher
  const sortedTeachers = [...state.teachers].sort((a, b) => a.name.localeCompare(b.name));
  
  sortedTeachers.forEach(t => {
    const data = [
      ["教師個人授課表 - " + t.name + ` (${t.role})`, "", "", "", "", ""],
      ["節次 / 時間", "星期一", "星期二", "星期三", "星期四", "星期五"]
    ];

    const periodsTiming = [
      { num: 1, time: "1 (08:40 - 09:20)" },
      { num: 2, time: "2 (09:30 - 10:10)" },
      { num: 3, time: "3 (10:20 - 11:00)" },
      { num: 4, time: "4 (11:10 - 11:50)" },
      { num: 0, time: "午休" },
      { num: 5, time: "5 (13:30 - 14:10)" },
      { num: 6, time: "6 (14:20 - 15:00)" },
      { num: 7, time: "7 (15:10 - 15:50)" }
    ];

    periodsTiming.forEach(p => {
      if (p.num === 0) {
        data.push([p.time, "午休", "午休", "午休", "午休", "午休"]);
        return;
      }

      const row = [p.time];
      for (let day = 1; day <= 5; day++) {
        // Is teacher busy?
        const isBusy = t.busySlots && t.busySlots.includes(`${day}-${p.num}`);
        
        if (isBusy) {
          row.push("行政會議/忙碌");
        } else {
          // Find class taught
          let taught = null;
          for (const classId in state.schedule) {
            const cell = state.schedule[classId][`${day}-${p.num}`];
            if (cell && cell.teacherId === t.id) {
              taught = `${classId} 班\n(${cell.subject})`;
              break;
            }
          }
          row.push(taught || "");
        }
      }
      data.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, t.name.replace(/[\*\?\/\\\[\]]/g, '')); // Excel sheet name limits
  });

  // Write Excel file
  XLSX.writeFile(wb, "國小智慧自動排課系統_全校課表.xlsx");
}

// ----------------------------------------------------
// SUBJECTS MANAGEMENT FUNCTIONS
// ----------------------------------------------------
function renderSubjects() {
  const tbody = document.getElementById("subject-list-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const query = document.getElementById("search-subject")?.value.trim().toLowerCase() || "";
  
  const gradeHours = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  state.subjects.forEach(s => {
    if (gradeHours[s.grade] !== undefined) {
      gradeHours[s.grade] += s.weeklyHours;
    }
  });

  const warnings = [];
  const limits = { 1: 23, 2: 23, 3: 29, 4: 29, 5: 32, 6: 32 };
  for (let g = 1; g <= 6; g++) {
    if (gradeHours[g] > limits[g]) {
      warnings.push(`${g} 年級總配課節數 (${gradeHours[g]} 節) 已超出排課時段上限 (${limits[g]} 節)，這將導致自動排課無解！`);
    }
  }

  const warningDiv = document.getElementById("subject-hours-warning");
  const warningMsg = document.getElementById("subject-warning-message");
  if (warningDiv && warningMsg) {
    if (warnings.length > 0) {
      warningDiv.style.display = "flex";
      warningMsg.innerHTML = warnings.join("<br>");
    } else {
      warningDiv.style.display = "none";
    }
  }

  const filtered = state.subjects.filter(s => {
    const matchName = s.subject.toLowerCase().includes(query);
    const matchGrade = `${s.grade}`.includes(query) || `${s.grade}年級`.includes(query);
    return matchName || matchGrade;
  });

  filtered.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));

  updateListCountBadge("subject-list-count", filtered.length, state.subjects.length);

  if (filtered.length === 0) {
    const emptyText = state.subjects.length === 0
      ? "尚無科目資料，請點擊右上角「手動新增科目」或使用「匯入科目 Excel / CSV」建立科目清單"
      : "查無符合搜尋條件的科目，請確認科目名稱/年級拼寫";
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">${emptyText}</td></tr>`;
    return;
  }

  const connectModeLabels = { none: '不連排', full: '全部連排', partial: '2節連排+分散' };

  filtered.forEach(s => {
    const isHomeroom = Boolean(s.isHomeroomMain);
    const connectMode = s.connectMode || 'none';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.grade} 年級</strong></td>
      <td>${s.subject}</td>
      <td>${s.weeklyHours} 節</td>
      <td>
        <button class="btn-toggle-homeroom ${isHomeroom ? 'badge badge-info' : 'badge badge-secondary'}" data-id="${s.id}" style="border: none; cursor: pointer; padding: 4px 8px;" title="點擊切換是否由導師優先授課">
          ${isHomeroom ? '★ 導師主要科目' : '科任/專科科目'}
        </button>
      </td>
      <td>${s.requiresRoom ? `<span class="badge badge-primary">${s.requiresRoom}教室</span>` : '無'}</td>
      <td>${s.domain ? `<span class="badge badge-secondary">${s.domain}</span>` : '—'}</td>
      <td>${connectMode !== 'none' ? `<span class="badge badge-info">${connectModeLabels[connectMode]}</span>` : '—'}</td>
      <td>
        <button class="btn-edit-subject btn-secondary btn-icon-only mr-1" data-id="${s.id}" title="編輯科目">
          <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
        </button>
        <button class="btn-delete-subject btn-danger btn-icon-only" data-id="${s.id}" title="刪除科目">
          <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-edit-subject").forEach(btn => {
    btn.onclick = function() {
      const id = btn.getAttribute("data-id");
      openSubjectModal(id);
    };
  });

  tbody.querySelectorAll(".btn-toggle-homeroom").forEach(btn => {
    btn.onclick = function() {
      const id = btn.getAttribute("data-id");
      const target = state.subjects.find(s => s.id === id);
      if (target) {
        target.isHomeroomMain = !Boolean(target.isHomeroomMain);
        saveAppState(state);
        renderSubjects();
        showConsoleLog(`已切換【${target.grade}年級 ${target.subject}】授課屬性為: ${target.isHomeroomMain ? '導師主要科目' : '科任/專科科目'}`);
      }
    };
  });

  tbody.querySelectorAll(".btn-delete-subject").forEach(btn => {
    btn.onclick = function() {
      const id = btn.getAttribute("data-id");
      if (confirm("確定要刪除此科目設定嗎？這會一併刪除全校各班級該科目的授課配課資料。")) {
        deleteSubject(id);
      }
    };
  });

  safeCreateIcons();
}

function deleteSubject(id) {
  const index = state.subjects.findIndex(s => s.id === id);
  if (index !== -1) {
    const target = state.subjects[index];
    state.subjects.splice(index, 1);
    
    state.assignments = state.assignments.filter(a => {
      const cls = state.classes.find(c => c.id === a.classId);
      if (cls && cls.grade === target.grade && a.subject === target.subject) {
        return false;
      }
      return true;
    });

    state.schedule = null;
    saveAppState(state);
    renderSubjects();
    showConsoleLog(`已刪除科目設定: ${target.grade}年級 ${target.subject}`);
  }
}

function openSubjectModal(subjectId = null) {
  const modal = document.getElementById("modal-subject");
  const form = document.getElementById("form-subject");
  const title = document.getElementById("modal-subject-title");
  const actionInput = document.getElementById("subject-form-action");
  const oldIdInput = document.getElementById("subject-old-id");
  form.reset();

  const isHomeroomCb = document.getElementById("subject-is-homeroom");
  if (isHomeroomCb) isHomeroomCb.checked = true;

  const roomSelect = document.getElementById("subject-room");
  if (roomSelect) {
    roomSelect.innerHTML = `<option value="">-- 不需要 --</option>`;
    const rooms = state.rooms || DEFAULT_ROOMS;
    Object.keys(rooms).forEach(key => {
      const room = rooms[key];
      roomSelect.innerHTML += `<option value="${key}">${room.name} (${key})</option>`;
    });
  }

  // Domain suggestions are never built-in - only names already in use (from
  // manual entry or file import) are offered, so the list reflects whatever
  // naming convention this school's own data actually uses.
  const domainSuggestions = document.getElementById("subject-domain-suggestions");
  if (domainSuggestions) {
    const usedDomains = [...new Set(state.subjects.map(s => s.domain).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    domainSuggestions.innerHTML = usedDomains.map(d => `<option value="${d}"></option>`).join('');
  }

  const sub = subjectId ? state.subjects.find(s => s.id === subjectId) : null;
  const domainInput = document.getElementById("subject-domain");
  const connectModeSelect = document.getElementById("subject-connect-mode");

  if (sub) {
    if (title) title.textContent = `編輯科目: ${sub.grade}年級 ${sub.subject}`;
    if (actionInput) actionInput.value = "edit";
    if (oldIdInput) oldIdInput.value = sub.id;
    document.getElementById("subject-grade").value = sub.grade;
    document.getElementById("subject-name").value = sub.subject;
    document.getElementById("subject-hours").value = sub.weeklyHours;
    if (roomSelect) roomSelect.value = sub.requiresRoom || "";
    if (isHomeroomCb) isHomeroomCb.checked = Boolean(sub.isHomeroomMain);
    if (domainInput) domainInput.value = sub.domain || "";
    if (connectModeSelect) connectModeSelect.value = sub.connectMode || "none";
  } else {
    if (title) title.textContent = "手動新增科目";
    if (actionInput) actionInput.value = "create";
    if (oldIdInput) oldIdInput.value = "";
    if (domainInput) domainInput.value = "";
    if (connectModeSelect) connectModeSelect.value = "none";
  }

  modal.classList.add("open");
  safeCreateIcons();
}

function handleSubjectFormSubmit(e) {
  e.preventDefault();
  const action = document.getElementById("subject-form-action").value;
  const oldId = document.getElementById("subject-old-id").value;

  const grade = parseInt(document.getElementById("subject-grade").value);
  const name = document.getElementById("subject-name").value.trim();
  const hours = parseInt(document.getElementById("subject-hours").value);
  const rawRoom = document.getElementById("subject-room").value || null;
  const room = rawRoom ? ensureRoomExists(rawRoom) : null;
  const isHomeroomCb = document.getElementById("subject-is-homeroom");
  const isHomeroomMain = isHomeroomCb ? isHomeroomCb.checked : true;
  const domain = document.getElementById("subject-domain")?.value.trim() || null;
  const connectMode = document.getElementById("subject-connect-mode")?.value || "none";

  if (!name || isNaN(grade) || isNaN(hours)) return;

  const newId = `${grade}-${name}`;

  if (action === "edit") {
    const sub = state.subjects.find(s => s.id === oldId);
    if (!sub) {
      alert("找不到原始科目資料！");
      return;
    }
    if (newId !== oldId && state.subjects.some(s => s.id === newId)) {
      alert(`科目「${name}」於${grade}年級已存在，請使用不同名稱或年級。`);
      return;
    }

    const oldGrade = sub.grade;
    const oldName = sub.subject;

    sub.id = newId;
    sub.grade = grade;
    sub.subject = name;
    sub.weeklyHours = hours;
    sub.requiresRoom = room;
    sub.isHomeroomMain = isHomeroomMain;
    sub.domain = domain;
    sub.connectMode = connectMode;

    if (grade === oldGrade) {
      // Same grade: rename/update the matching assignment for every class of this grade.
      state.classes.forEach(c => {
        if (c.grade !== grade) return;
        const assign = state.assignments.find(a => a.classId === c.id && a.subject === oldName);
        if (assign) {
          assign.id = `${c.id}-${name}`;
          assign.subject = name;
          assign.weeklyHours = hours;
          assign.requiresRoom = room;
        } else {
          state.assignments.push({
            id: `${c.id}-${name}`,
            classId: c.id,
            subject: name,
            weeklyHours: hours,
            teacherId: "",
            requiresRoom: room
          });
        }
      });
    } else {
      // Grade changed: this subject no longer applies to the old grade's classes.
      const oldGradeClassIds = state.classes.filter(c => c.grade === oldGrade).map(c => c.id);
      state.assignments = state.assignments.filter(a =>
        !(oldGradeClassIds.includes(a.classId) && a.subject === oldName)
      );
      // Give the new grade's classes a matching (empty) assignment.
      state.classes.forEach(c => {
        if (c.grade !== grade) return;
        const exists = state.assignments.some(a => a.classId === c.id && a.subject === name);
        if (!exists) {
          state.assignments.push({
            id: `${c.id}-${name}`,
            classId: c.id,
            subject: name,
            weeklyHours: hours,
            teacherId: "",
            requiresRoom: room
          });
        }
      });
    }

    state.schedule = null;
    saveAppState(state);
    closeAllModals();
    renderSubjects();
    renderClassesAndRooms();
    renderClassAssignments();
    showConsoleLog(`已成功更新科目: ${grade}年級 ${name} (${hours} 節)`);
    return;
  }

  // Create / upsert-by-id (only reachable when creating a brand-new subject)
  const existingIndex = state.subjects.findIndex(s => s.id === newId);

  const newSub = {
    id: newId,
    grade: grade,
    subject: name,
    weeklyHours: hours,
    requiresRoom: room,
    isHomeroomMain: isHomeroomMain,
    domain: domain,
    connectMode: connectMode
  };

  if (existingIndex !== -1) {
    state.subjects[existingIndex] = newSub;
  } else {
    state.subjects.push(newSub);
  }

  state.classes.forEach(c => {
    if (c.grade === grade) {
      let assign = state.assignments.find(a => a.classId === c.id && a.subject === name);
      if (assign) {
        assign.weeklyHours = hours;
        assign.requiresRoom = room;
      } else {
        state.assignments.push({
          id: `${c.id}-${name}`,
          classId: c.id,
          subject: name,
          weeklyHours: hours,
          teacherId: "",
          requiresRoom: room
        });
      }
    }
  });

  state.schedule = null;
  saveAppState(state);
  closeAllModals();
  renderSubjects();
  renderClassesAndRooms();
  showConsoleLog(`手動儲存科目: ${grade}年級 ${name} (${hours} 節)`);
}

let tempImportSubjects = [];

function handleSubjectCSVSelect(e) {
  const file = e.target.files[0];
  if (file) {
    processSubjectCSVFile(file);
  }
}

function processSubjectCSVFile(file) {
  readFileAsCSVText(file, (err, text) => {
    if (err) {
      alert("讀取檔案出錯，請確認檔案格式是否正確。");
      console.error(err);
      return;
    }
    try {
      tempImportSubjects = parseSubjectCSV(text);
      if (tempImportSubjects.length === 0) {
        alert("無法從檔案解析出有效的科目設定。請檢查格式是否符合。");
        return;
      }
      showSubjectCSVPreviewModal();
    } catch (err) {
      alert("解析檔案內容出錯，請確認格式正確。");
      console.error(err);
    }
  });
}

function showSubjectCSVPreviewModal() {
  const modal = document.getElementById("modal-subject-import-confirm");
  const tbody = document.getElementById("subject-csv-preview-tbody");
  tbody.innerHTML = "";

  const connectModeLabels = { none: '不連排', full: '全部連排', partial: '2節連排+分散' };
  tempImportSubjects.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.grade} 年級</strong></td>
      <td>${s.subject}</td>
      <td>${s.weeklyHours} 節</td>
      <td>${s.requiresRoom || '無'}</td>
      <td><span class="badge ${s.isHomeroomMain ? 'badge-info' : 'badge-secondary'}">${s.isHomeroomMain ? '是' : '否'}</span></td>
      <td>${s.domain || '—'}</td>
      <td>${connectModeLabels[s.connectMode || 'none']}</td>
    `;
    tbody.appendChild(tr);
  });

  modal.classList.add("open");

  const confirmBtn = document.getElementById("btn-subject-csv-confirm-save");
  confirmBtn.onclick = function() {
    const newlyCreatedRooms = [];
    tempImportSubjects.forEach(newS => {
      if (newS.requiresRoom) {
        const roomExistedBefore = Boolean(state.rooms && state.rooms[newS.requiresRoom]);
        newS.requiresRoom = ensureRoomExists(newS.requiresRoom);
        if (newS.requiresRoom && !roomExistedBefore) {
          newlyCreatedRooms.push(state.rooms[newS.requiresRoom].name);
        }
      }

      const idx = state.subjects.findIndex(s => s.id === newS.id);
      if (idx !== -1) {
        state.subjects[idx] = newS;
      } else {
        state.subjects.push(newS);
      }

      state.classes.forEach(c => {
        if (c.grade === newS.grade) {
          let assign = state.assignments.find(a => a.classId === c.id && a.subject === newS.subject);
          if (assign) {
            assign.weeklyHours = newS.weeklyHours;
            assign.requiresRoom = newS.requiresRoom;
          } else {
            state.assignments.push({
              id: `${c.id}-${newS.subject}`,
              classId: c.id,
              subject: newS.subject,
              weeklyHours: newS.weeklyHours,
              teacherId: "",
              requiresRoom: newS.requiresRoom
            });
          }
        }
      });
    });

    state.schedule = null;
    saveAppState(state);
    closeAllModals();
    renderSubjects();
    renderClassesAndRooms();
    showConsoleLog(`成功批次匯入 ${tempImportSubjects.length} 個科目設定，專科教室與授課屬性已更新，課表已重置。`);

    if (newlyCreatedRooms.length > 0) {
      // Surface the newly-created rooms immediately by switching to the
      // "班級與專科教室" sub-tab, where the room management table lives -
      // otherwise the rooms exist in state but stay out of sight on the
      // "科目設定管理" sub-tab the user is currently on.
      const classesSubTabBtn = document.querySelector('.tab-sub-btn[data-sub-tab="classes"]');
      if (classesSubTabBtn) classesSubTabBtn.click();

      alert(`科目匯入完成！系統已自動依「特殊教室」欄位新增 ${newlyCreatedRooms.length} 個專科教室：${newlyCreatedRooms.join('、')}。\n已為您切換到「班級與專科教室」頁籤，請確認各教室的同時段容納上限是否正確。`);
    }
  };
}

function downloadSubjectCSVTemplate() {
  const header = "年級,科目名稱,每週節數,特殊教室,導師主要科目,領域,連排方式\n";
  const rows = [
    "1,國語,6,,是,語文,",
    "1,數學,3,,是,,",
    "1,生活,6,,是,,",
    "3,自然,3,自然,否,自然科學,部分連排",
    "3,電腦,1,電腦,否,,",
    "5,英語,3,,否,語文,全部連排"
  ].join("\n");
  
  const csvContent = "\uFEFF" + header + rows;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "智慧排課_科目匯入範本.csv");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ----------------------------------------------------
// TEACHER ASSIGNMENT OVERVIEW & DETAIL FUNCTIONS
// ----------------------------------------------------
/**
 * Build the one-line assignment summary text for a teacher,
 * e.g. "張主任：已配 3 節，101健康(1)、301體育(2)"
 */
function formatTeacherAssignmentSummary(teacher) {
  const assigned = state.assignments.filter(a => a.teacherId === teacher.id);

  if (assigned.length === 0) {
    return `${teacher.name}：尚未配課`;
  }

  const items = assigned.map(a => {
    const cls = state.classes.find(c => c.id === a.classId);
    const className = cls ? cls.name : a.classId;
    return `${className}${a.subject}(${a.weeklyHours})`;
  });

  return `${teacher.name}：已配 ${teacher.assignedHours} 節，${items.join('、')}`;
}

/**
 * Render Full Teacher Assignment Overview Mode (全校教師配課明細總覽)
 */
function renderTeacherOverviewAssignments() {
  const container = document.getElementById("teacher-overview-list-container");
  if (!container) return;

  // Always sync teacher assigned hours validation first
  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const roleFilter = document.getElementById("select-overview-role-filter")?.value || "all";
  const statusFilter = document.getElementById("select-overview-status-filter")?.value || "all";
  const searchText = (document.getElementById("input-overview-search")?.value || "").trim().toLowerCase();

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  // Calculate statistics across all teachers
  let totalCount = 0;
  let exactCount = 0;
  let underCount = 0;
  let overCount = 0;

  state.teachers.forEach(t => {
    if (t.role === 'hourly') {
      exactCount++;
    } else if (t.assignedHours === t.baseHours) {
      exactCount++;
    } else if (t.assignedHours < t.baseHours) {
      underCount++;
    } else if (t.assignedHours > t.baseHours) {
      overCount++;
    }
  });

  const statTotal = document.getElementById("stat-overview-total-count");
  const statExact = document.getElementById("stat-overview-exact-count");
  const statUnder = document.getElementById("stat-overview-under-count");
  const statOver = document.getElementById("stat-overview-over-count");

  if (statTotal) statTotal.textContent = state.teachers.length;
  if (statExact) statExact.textContent = exactCount;
  if (statUnder) statUnder.textContent = underCount;
  if (statOver) statOver.textContent = overCount;

  // Filter teachers
  const filteredTeachers = state.teachers.filter(t => {
    // Role filter
    if (roleFilter !== "all" && t.role !== roleFilter) return false;

    // Status filter
    if (statusFilter !== "all") {
      if (t.role === 'hourly') {
        if (statusFilter !== "exact") return false;
      } else {
        if (statusFilter === "exact" && t.assignedHours !== t.baseHours) return false;
        if (statusFilter === "under" && t.assignedHours >= t.baseHours) return false;
        if (statusFilter === "over" && t.assignedHours <= t.baseHours) return false;
      }
    }

    // Search text
    if (searchText) {
      const teacherMatch = t.name.toLowerCase().includes(searchText) || 
                           t.id.toLowerCase().includes(searchText) || 
                           (roleLabels[t.role] || "").toLowerCase().includes(searchText);

      // Check assigned subjects match
      const assigned = state.assignments.filter(a => a.teacherId === t.id);
      const assignmentMatch = assigned.some(a => {
        const c = state.classes.find(cls => cls.id === a.classId);
        return (c && c.name.toLowerCase().includes(searchText)) || a.subject.toLowerCase().includes(searchText);
      });

      if (!teacherMatch && !assignmentMatch) return false;
    }

    return true;
  });

  if (filteredTeachers.length === 0) {
    container.innerHTML = `
      <div class="glass-card p-5 text-center text-secondary">
        <i data-lucide="search-x" class="panel-icon mb-2" style="font-size: 2.5rem;"></i>
        <div>沒有符合篩選條件的教師配課紀錄</div>
      </div>
    `;
    safeCreateIcons();
    return;
  }

  // Sort teachers
  filteredTeachers.sort((a, b) => {
    if (a.role === 'hourly' && b.role !== 'hourly') return 1;
    if (a.role !== 'hourly' && b.role === 'hourly') return -1;

    const devA = Math.abs(a.assignedHours - a.baseHours);
    const devB = Math.abs(b.assignedHours - b.baseHours);
    if (devA !== devB) return devB - devA;

    return a.id.localeCompare(b.id);
  });

  const rowsHtml = filteredTeachers.map(t => {
    const assigned = state.assignments.filter(a => a.teacherId === t.id);

    // Status text & badge class
    let statusBadgeHtml = '';
    if (t.role === 'hourly') {
      statusBadgeHtml = `<span class="badge bg-info" style="font-size:11px;">鐘點授課</span>`;
    } else if (t.assignedHours === t.baseHours) {
      statusBadgeHtml = `<span class="badge bg-success" style="font-size:11px;">✓ 達標</span>`;
    } else if (t.assignedHours < t.baseHours) {
      statusBadgeHtml = `<span class="badge bg-warning" style="font-size:11px;">⚠️ 不足 ${t.baseHours - t.assignedHours} 節</span>`;
    } else {
      statusBadgeHtml = `<span class="badge bg-danger" style="font-size:11px;">⚡ 超授 ${t.assignedHours - t.baseHours} 節</span>`;
    }

    // Column 3: all assignment details merged into one cell, comma-separated (e.g. 101健康(1), 301體育(2))
    const detailText = assigned.length > 0
      ? assigned.map(a => {
          const cls = state.classes.find(c => c.id === a.classId);
          const className = cls ? cls.name : a.classId;
          return `${className}${a.subject}(${a.weeklyHours})`;
        }).join(', ')
      : '';
    const detailCellHtml = detailText
      ? `<td class="teacher-overview-detail-cell">${detailText}</td>`
      : `<td class="teacher-overview-detail-cell text-secondary style-italic">尚未配課</td>`;

    return `
      <tr class="teacher-overview-row" data-teacher-id="${t.id}" title="點擊查看 ${t.name} 老師詳細配課表格">
        <td style="white-space:nowrap;">
          <div class="flex align-items-center gap-2 flex-wrap">
            <strong style="color: var(--text-light);">${t.name}</strong>
            <span class="badge bg-secondary" style="font-size:11px;">${roleLabels[t.role] || t.role}</span>
            ${t.targetClassId ? `<span class="badge bg-info" style="font-size:11px;">${t.targetClassId} 導師</span>` : ''}
          </div>
        </td>
        <td style="white-space:nowrap;">
          <strong>${t.assignedHours}</strong> / ${t.baseHours || 0} 節
          <div class="mt-1">${statusBadgeHtml}</div>
        </td>
        ${detailCellHtml}
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="table teacher-overview-table">
      <thead>
        <tr>
          <th style="min-width:150px;">教師姓名</th>
          <th style="min-width:110px;">已配節數</th>
          <th>配課明細（班級科目(節數)）</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  // Row click opens the detail modal
  container.querySelectorAll(".teacher-overview-row").forEach(row => {
    row.addEventListener("click", () => {
      const teacherId = row.getAttribute("data-teacher-id");
      if (teacherId) openTeacherAssignmentDetailModal(teacherId);
    });
  });

  safeCreateIcons();
}

/**
 * Copy all filtered teacher summaries to clipboard
 */
function copyAllTeacherSummaries() {
  const roleFilter = document.getElementById("select-overview-role-filter")?.value || "all";
  const statusFilter = document.getElementById("select-overview-status-filter")?.value || "all";
  const searchText = (document.getElementById("input-overview-search")?.value || "").trim().toLowerCase();

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  const filtered = state.teachers.filter(t => {
    if (roleFilter !== "all" && t.role !== roleFilter) return false;
    if (statusFilter !== "all") {
      if (t.role === 'hourly') {
        if (statusFilter !== "exact") return false;
      } else {
        if (statusFilter === "exact" && t.assignedHours !== t.baseHours) return false;
        if (statusFilter === "under" && t.assignedHours >= t.baseHours) return false;
        if (statusFilter === "over" && t.assignedHours <= t.baseHours) return false;
      }
    }
    if (searchText) {
      const teacherMatch = t.name.toLowerCase().includes(searchText) || 
                           t.id.toLowerCase().includes(searchText) || 
                           (roleLabels[t.role] || "").toLowerCase().includes(searchText);
      const assigned = state.assignments.filter(a => a.teacherId === t.id);
      const assignmentMatch = assigned.some(a => {
        const c = state.classes.find(cls => cls.id === a.classId);
        return (c && c.name.toLowerCase().includes(searchText)) || a.subject.toLowerCase().includes(searchText);
      });
      if (!teacherMatch && !assignmentMatch) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    alert("目前沒有可複製的教師配課摘要！");
    return;
  }

  const summaries = filtered.map(t => formatTeacherAssignmentSummary(t)).join("\n");

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(summaries).then(() => {
      alert(`已成功複製 ${filtered.length} 位教師的配課摘要文字！`);
      showConsoleLog(`已複製 ${filtered.length} 位教師配課摘要。`);
    }).catch(() => {
      fallbackCopyText(summaries, filtered.length);
    });
  } else {
    fallbackCopyText(summaries, filtered.length);
  }
}

function fallbackCopyText(text, count) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand("copy");
    alert(`已成功複製 ${count} 位教師的配課摘要文字！`);
  } catch (err) {
    alert("複製失敗，請手動全選文字複製。");
  }
  document.body.removeChild(textArea);
}

/**
 * Export Full Teacher Assignment Breakdown Overview to Excel (.xlsx)
 */
function exportTeacherOverviewExcel() {
  if (typeof XLSX === "undefined") {
    alert("SheetJS (XLSX) 匯出模組未載入，無法匯出 Excel 檔案。");
    return;
  }

  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  // Mirror the on-screen table: one row per teacher, all assignment records merged into one comma-separated column
  const exportData = state.teachers.map(t => {
    const teacherAssignments = state.assignments.filter(a => a.teacherId === t.id);

    let statusText = "剛好達標";
    if (t.role === 'hourly') {
      statusText = "鐘點兼任";
    } else if (t.assignedHours < t.baseHours) {
      statusText = `不足 ${t.baseHours - t.assignedHours} 節`;
    } else if (t.assignedHours > t.baseHours) {
      statusText = `超授 ${t.assignedHours - t.baseHours} 節`;
    }

    const detailText = teacherAssignments.map(assign => {
      const cls = state.classes.find(c => c.id === assign.classId);
      const className = cls ? cls.name : assign.classId;
      return `${className}${assign.subject}(${assign.weeklyHours})`;
    }).join(', ');

    return {
      "教師編號": t.id,
      "教師姓名": t.name,
      "職務身分": roleLabels[t.role] || t.role,
      "已配節數": t.assignedHours,
      "基本節數": t.baseHours || 0,
      "負擔狀態": statusText,
      "帶班班級": t.targetClassId || "無",
      "配課明細": detailText || "尚未配課"
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "教師配課總覽表");

  const todayStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `全校教師配課明細總覽_${todayStr}.xlsx`);
  showConsoleLog("已成功匯出「全校教師配課明細總覽」Excel 試算表！");
}

/**
 * Open Single Teacher Assignment Detail Modal
 */
function openTeacherAssignmentDetailModal(teacherId) {
  const teacher = state.teachers.find(t => t.id === teacherId);
  if (!teacher) return;

  validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);

  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };
  const teacherAssignments = state.assignments.filter(a => a.teacherId === teacher.id);

  const modal = document.getElementById("modal-teacher-assignment-detail");
  const title = document.getElementById("modal-teacher-detail-title");
  const body = document.getElementById("modal-teacher-detail-body");

  if (!modal || !body) return;

  title.innerHTML = `<i data-lucide="user-check" class="panel-icon text-primary"></i> ${teacher.name} 老師 - 配課明細表`;

  let statusBadge = '';
  if (teacher.role === 'hourly') {
    statusBadge = `<span class="badge bg-info">鐘點授課 (${teacher.assignedHours} 節)</span>`;
  } else if (teacher.assignedHours === teacher.baseHours) {
    statusBadge = `<span class="badge bg-success">剛好達標 (${teacher.assignedHours}/${teacher.baseHours} 節)</span>`;
  } else if (teacher.assignedHours < teacher.baseHours) {
    statusBadge = `<span class="badge bg-warning">不足 ${teacher.baseHours - teacher.assignedHours} 節 (${teacher.assignedHours}/${teacher.baseHours} 節)</span>`;
  } else {
    statusBadge = `<span class="badge bg-danger">超授 ${teacher.assignedHours - teacher.baseHours} 節 (${teacher.assignedHours}/${teacher.baseHours} 節)</span>`;
  }

  let tableHtml = "";
  if (teacherAssignments.length === 0) {
    tableHtml = `<div class="p-4 text-center text-muted style-italic">目前尚無排定任何班級課程。</div>`;
  } else {
    tableHtml = `
      <table class="table mt-3">
        <thead>
          <tr>
            <th>授課班級</th>
            <th>科目名稱</th>
            <th style="text-align:center;">每週節數</th>
            <th>特殊教室</th>
            <th>類別/專長</th>
          </tr>
        </thead>
        <tbody>
          ${teacherAssignments.map(assign => {
            const cls = state.classes.find(c => c.id === assign.classId);
            const tmpl = state.subjects.find(s => s.subject === assign.subject && (cls ? s.grade === cls.grade : true));
            const isHomeroomMain = Boolean(tmpl && tmpl.isHomeroomMain);
            const isClassHomeroom = cls && (teacher.targetClassId === cls.id || teacher.id === cls.homeroomTeacherId);
            const isSpecMatch = (teacher.specialties || []).includes(assign.subject);

            let typeBadge = '<span class="badge bg-secondary">一般科目</span>';
            if (isHomeroomMain && isClassHomeroom) {
              typeBadge = '<span class="badge bg-success">導師主科</span>';
            } else if (isSpecMatch) {
              typeBadge = '<span class="badge bg-success">⭐ 專長相符</span>';
            }

            const roomText = assign.requiresRoom 
              ? `<span class="badge bg-info">${(state.rooms || SPECIAL_ROOMS)[assign.requiresRoom]?.name || assign.requiresRoom}</span>`
              : '-';

            return `
              <tr>
                <td><strong>${cls ? cls.name : assign.classId}</strong></td>
                <td><span class="badge bg-secondary">${assign.subject}</span></td>
                <td style="text-align:center;"><strong>${assign.weeklyHours}</strong> 節</td>
                <td>${roomText}</td>
                <td>${typeBadge}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  const summaryStr = formatTeacherAssignmentSummary(teacher);

  body.innerHTML = `
    <div class="glass-card p-3 mb-3 flex-justify-between align-items-center" style="background: rgba(255,255,255,0.03);">
      <div>
        <div class="flex align-items-center gap-2">
          <strong style="font-size: 1.1rem;">${teacher.name} (${teacher.id})</strong>
          <span class="badge bg-secondary">${roleLabels[teacher.role] || teacher.role}</span>
          ${teacher.targetClassId ? `<span class="badge bg-info">${teacher.targetClassId} 導師</span>` : ''}
        </div>
        <div class="text-secondary style-italic mt-1" style="font-size: 13px;">
          專長科目：${(teacher.specialties || []).join('; ') || '無'}
        </div>
      </div>
      <div>${statusBadge}</div>
    </div>

    <div class="p-3 mb-3 rounded-lg" style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); font-size: 0.9rem;">
      <span class="text-secondary style-italic block mb-1" style="font-size:11px;">配課摘要清單（簡明文字）：</span>
      <span class="text-light font-bold" style="letter-spacing: 0.3px;">${summaryStr}</span>
    </div>

    <h4><i data-lucide="book-open" class="icon-small text-primary mr-1"></i> 已指派班級與課程明細 (共 ${teacherAssignments.length} 門，${teacher.assignedHours} 節)：</h4>
    ${tableHtml}
  `;

  modal.classList.add("open");
  safeCreateIcons();
}

