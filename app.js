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
  DEFAULT_SUBJECTS, 
  SPECIAL_ROOMS 
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

// Initialize app on DOM Content Loaded
document.addEventListener("DOMContentLoaded", () => {
  // Load saved state or use initial state
  const savedState = loadAppState();
  if (savedState) {
    state = savedState;
    let dirty = false;
    if (!state.subjects) {
      state.subjects = [...DEFAULT_SUBJECTS];
      dirty = true;
    }
    if (!state.assignments || state.assignments.length === 0) {
      const initial = getInitialState();
      state.assignments = initial.assignments;
      dirty = true;
    }
    if (dirty) {
      saveAppState(state);
    }
  } else {
    saveAppState(state);
  }

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

  document.getElementById("btn-reset-system").addEventListener("click", () => {
    if (confirm("確定要重置系統資料嗎？這將會清除所有自訂配課與排課結果，恢復為系統預設值。")) {
      state = getInitialState();
      saveAppState(state);
      renderCurrentTab();
      showConsoleLog("系統資料已重置為初始狀態。");
    }
  });

  document.getElementById("btn-clear-all-data").addEventListener("click", () => {
    if (confirm("確定要清空所有資料嗎？這將會清除全校的所有教師、班級、配課與排課表！後續需要由您自行建立或匯入。")) {
      state = {
        teachers: [],
        classes: [],
        subjects: [],
        assignments: [],
        schedule: null
      };
      saveAppState(state);
      renderCurrentTab();
      showConsoleLog("系統資料已全部清空。");
    }
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

  // Subject template download button
  const downloadSubjectTmplBtn = document.getElementById("btn-download-subject-tmpl");
  if (downloadSubjectTmplBtn) {
    downloadSubjectTmplBtn.addEventListener("click", () => downloadSubjectCSVTemplate());
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
    if (file && file.name.endsWith(".csv")) {
      processCSVFile(file);
    } else {
      alert("請上傳正確的 .csv 檔案格式");
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
  document.getElementById("btn-auto-assign-homeroom").addEventListener("click", autoAssignHomeroomTeachers);
  document.getElementById("btn-auto-assign-subjects").addEventListener("click", autoAssignSubjectTeachers);
  document.getElementById("btn-clear-assignments").addEventListener("click", () => {
    if (confirm("確定要清空所有班級配課資料嗎？這將同時重置排課表！")) {
      state.assignments.forEach(a => a.teacherId = "");
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

  // Viewer Handlers
  document.getElementById("viewer-dimension").addEventListener("change", handleViewerDimensionChange);
  document.getElementById("viewer-target-select").addEventListener("change", () => {
    renderTimetableGrid();
  });
  document.getElementById("btn-export-excel").addEventListener("click", exportTimetableToExcel);
  document.getElementById("btn-print-timetable").addEventListener("click", () => {
    window.print();
  });

  // Initialize Lucide Icons
  lucide.createIcons();

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
  lucide.createIcons();
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

function renderDashboardView() {
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

    const homeroomClassText = t.role === 'homeroom' && t.targetClassId ? ` (${t.targetClassId} 導師)` : '';

    item.innerHTML = `
      <div class="teacher-load-info">
        <span class="teacher-load-name">${t.name}</span>
        <span class="teacher-load-role">${roleLabels[t.role]}${homeroomClassText}</span>
      </div>
      <div class="teacher-load-hours text-right">
        <strong class="${loadClass}">${t.assignedHours} / ${t.baseHours || 0} 節</strong>
        <div style="font-size: 0.7rem; color: var(--text-secondary);">${statusText}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

// ----------------------------------------------------
// SETTINGS FUNCTIONS (TEACHERS & CLASSES)
// ----------------------------------------------------
function renderTeachersTable(filterQuery = "") {
  const tbody = document.getElementById("teacher-list-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };

  const query = filterQuery.toLowerCase().trim();
  const filtered = state.teachers.filter(t => {
    return t.name.toLowerCase().includes(query) || 
           roleLabels[t.role].toLowerCase().includes(query) || 
           t.id.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">沒有符合條件的教師資料</td></tr>`;
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
        <button class="btn btn-secondary btn-icon btn-edit-t" data-id="${t.id}" title="編輯教師">
          <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-danger-outline btn-icon btn-delete-t" data-id="${t.id}" title="刪除教師">
          <i data-lucide="user-minus" style="width: 14px; height: 14px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind edit & delete buttons
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

  lucide.createIcons();
}

function renderClassesAndRooms() {
  // Render Class cards
  const classContainer = document.getElementById("class-cards-container");
  if (classContainer) {
    classContainer.innerHTML = "";
    
    // Sort classes numerically
    const sortedClasses = [...state.classes].sort((a, b) => a.id.localeCompare(b.id));
    
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
          <button class="btn btn-danger-outline btn-icon mt-3 btn-delete-class" data-id="${c.id}" style="padding: 4px; border-radius: 4px;" title="刪除班級">
            <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
          </button>
        `;
        classContainer.appendChild(card);
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
    Object.keys(SPECIAL_ROOMS).forEach(key => {
      const room = SPECIAL_ROOMS[key];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${room.name}</strong></td>
        <td><span class="badge badge-info">${key}課</span></td>
        <td>
          <input type="number" class="input-field input-room-limit" data-room="${key}" value="${room.limit}" min="1" max="10" style="width: 80px;">
        </td>
        <td>全校同時段排入${key}課之班級上限</td>
      `;
      roomTbody.appendChild(tr);
    });

    // Save dynamic room changes
    roomTbody.querySelectorAll(".input-room-limit").forEach(input => {
      input.addEventListener("change", (e) => {
        const roomKey = e.target.getAttribute("data-room");
        const val = parseInt(e.target.value);
        if (SPECIAL_ROOMS[roomKey] && !isNaN(val) && val >= 1) {
          SPECIAL_ROOMS[roomKey].limit = val;
          // Clear current schedule because rules changed
          state.schedule = null;
          saveAppState(state);
          showConsoleLog(`已修改專科教室【${SPECIAL_ROOMS[roomKey].name}】同時段容納上限為 ${val} 班，已重置現有課表。`);
          updateGlobalStats();
        }
      });
    });
  }
}

// Teacher Modal
let activeBusySlots = []; // Local state for edit

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

  // Render busy slots selector mini grid
  renderBusySlotsSelectorGrid();

  modal.classList.add("open");
  lucide.createIcons();
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
      
      btn.addEventListener("click", () => {
        if (activeBusySlots.includes(slotKey)) {
          activeBusySlots = activeBusySlots.filter(s => s !== slotKey);
          btn.classList.remove("busy");
        } else {
          activeBusySlots.push(slotKey);
          btn.classList.add("busy");
        }
      });

      container.appendChild(btn);
    }
  }
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

function openClassModal() {
  const modal = document.getElementById("modal-class");
  const form = document.getElementById("form-class");
  form.reset();
  modal.classList.add("open");
  lucide.createIcons();
}

function handleClassFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("class-id").value.trim();
  const name = document.getElementById("class-name").value.trim();
  const grade = parseInt(document.getElementById("class-grade").value);

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

function processClassCSVFile(file) {
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    try {
      tempImportClasses = parseClassCSV(text);
      if (tempImportClasses.length === 0) {
        alert("無法從 CSV 檔案解析出有效的班級名單。請檢查格式是否符合。");
        return;
      }
      showClassCSVPreviewModal();
    } catch (err) {
      alert("讀取 CSV 檔案出錯，請確認編碼為 UTF-8 或格式正確。");
      console.error(err);
    }
  };
  reader.readAsText(file, "UTF-8");
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
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    try {
      tempImportTeachers = parseTeacherCSV(text);
      if (tempImportTeachers.length === 0) {
        alert("無法從 CSV 檔案解析出有效的教師名單。請檢查格式是否符合。");
        return;
      }
      showCSVPreviewModal();
    } catch (err) {
      alert("讀取 CSV 檔案出錯，請確認編碼為 UTF-8 或格式正確。");
      console.error(err);
    }
  };
  reader.readAsText(file, "UTF-8");
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

// ----------------------------------------------------
// ASSIGNMENTS VIEW FUNCTIONS (ONLINE ASSIGNMENT)
// ----------------------------------------------------
function renderAssignmentsView() {
  // Populate the selector
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

  // Render class assignments table
  renderClassAssignments();
  
  // Render sidebar loads
  renderTeacherLoadsSidebar();
}

function renderClassAssignments() {
  const classId = document.getElementById("select-assign-class").value;
  if (!classId) return;

  const cls = state.classes.find(c => c.id === classId);
  const tbody = document.getElementById("class-subjects-assign-tbody");
  tbody.innerHTML = "";

  // Get subjects template based on grade level
  const classSubjects = state.subjects.filter(s => s.grade === cls.grade);
  const targetHours = classSubjects.reduce((sum, s) => sum + s.weeklyHours, 0);
  
  document.getElementById("class-target-hours").textContent = targetHours;

  // Compute current total hours assigned for this class
  let currentAssigned = 0;
  
  classSubjects.forEach(tmpl => {
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
      const specA = a.specialties.includes(tmpl.subject) ? 1 : 0;
      const specB = b.specialties.includes(tmpl.subject) ? 1 : 0;
      if (specA !== specB) return specB - specA; // Put matching specialties on top
      
      const hrA = a.role === 'homeroom' && a.targetClassId === classId ? 1 : 0;
      const hrB = b.role === 'homeroom' && b.targetClassId === classId ? 1 : 0;
      if (hrA !== hrB) return hrB - hrA; // Put homeroom teacher on top

      return a.name.localeCompare(b.name);
    });

    sortedTeachers.forEach(t => {
      const isHomeroom = t.role === 'homeroom' && t.targetClassId === classId ? " (導師)" : "";
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
      const isMatch = selectedTeacher.specialties.includes(tmpl.subject) || 
                      (selectedTeacher.role === 'homeroom' && selectedTeacher.targetClassId === classId);
      matchIndicator = isMatch 
        ? '<span class="badge badge-success">專長相符</span>' 
        : '<span class="badge badge-danger">專長不符</span>';
    }

    const roomText = tmpl.requiresRoom 
      ? `<span class="badge badge-info">${SPECIAL_ROOMS[tmpl.requiresRoom]?.name}</span>` 
      : '<span style="color: var(--text-secondary);">無</span>';

    const roleLabels = { director: "主任", leader: "組長", homeroom: "導師", subject: "科任", hourly: "鐘點" };
    const teacherRoleText = selectedTeacher 
      ? `<span class="badge badge-secondary">${roleLabels[selectedTeacher.role]}</span>`
      : '—';

    tr.innerHTML = `
      <td><strong>${tmpl.subject}</strong></td>
      <td><strong>${tmpl.weeklyHours} 節</strong></td>
      <td>${roomText}</td>
      <td>${teacherSelectHtml}</td>
      <td>${teacherRoleText}</td>
      <td>${matchIndicator}</td>
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

  // Update tabs header status
  const check = validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
  const tabProgressText = document.getElementById("assign-progress-text");
  const tabProgressBar = document.getElementById("bar-assign-progress-tab");
  const targetHours = check.totalTargetHours || 1;
  const progressPercent = Math.min(100, Math.round((check.totalAssigned / targetHours) * 100));
  
  if (tabProgressText && tabProgressBar) {
    tabProgressText.textContent = `${check.totalAssigned} / ${check.totalTargetHours} 節 (${progressPercent}%)`;
    tabProgressBar.style.width = `${progressPercent}%`;
  }
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

    item.innerHTML = `
      <div class="teacher-load-info">
        <span class="teacher-load-name">${t.name}</span>
        <span class="teacher-load-role">${roleLabels[t.role]}${t.targetClassId ? ` (${t.targetClassId}導)` : ''}</span>
      </div>
      <div class="teacher-load-hours">
        <strong class="${loadClass}">${t.assignedHours} / ${t.baseHours || 0} 節</strong>
      </div>
    `;
    container.appendChild(item);
  });
}

/**
 * Auto assignment Helper 1: Bind homeroom teachers to core subjects in their class
 */
function autoAssignHomeroomTeachers() {
  let count = 0;
  
  state.classes.forEach(c => {
    // Find the teacher who is assigned as homeroom for this class
    const teacher = state.teachers.find(t => t.role === 'homeroom' && t.targetClassId === c.id);
    if (!teacher) return;

    // Get subjects template
    const classSubjects = state.subjects.filter(s => s.grade === c.grade);

    // Homeroom teaches Core subjects: 國語, 數學, 生活 (低年級), 社會 (中高), 綜合, 健康, 閱讀, 彈性
    const homeroomSubjects = ["國語", "數學", "生活", "社會", "綜合", "健康", "閱讀", "彈性"];

    classSubjects.forEach(tmpl => {
      if (homeroomSubjects.includes(tmpl.subject)) {
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

function renderEngineView() {
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
    stepTotal.className = "fail";
    stepTotal.innerHTML = `<i data-lucide="x-circle" class="icon-small text-danger"></i> 全校配課未達 ${check.totalTargetHours} 節 (目前: ${check.totalAssigned}/${check.totalTargetHours} 節)`;
  }

  // Teacher warnings are soft warnings (do not block scheduler, but alert user)
  const teacherWarnings = check.overloadedTeachers.length + check.underloadedTeachers.length;
  if (teacherWarnings === 0) {
    stepTeacher.className = "ok";
    stepTeacher.innerHTML = `<i data-lucide="check-circle" class="icon-small text-success"></i> 全校教師配課負載全部達標`;
  } else {
    stepTeacher.className = "ok"; // still OK to run, but yellow alert
    stepTeacher.innerHTML = `<i data-lucide="alert-circle" class="icon-small text-warning"></i> 有 ${teacherWarnings} 位教師配課未達或超額基本節數 (將使用鐘點/兼課模式)`;
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

  lucide.createIcons();
}

function startSchedulingEngine() {
  const check = validateAssignments(state.teachers, state.assignments, state.classes, state.subjects);
  if (check.totalAssigned < check.totalTargetHours) {
    alert(`配課尚未完成！目前已配 ${check.totalAssigned} 節，還剩 ${check.totalTargetHours - check.totalAssigned} 節未完成指派教師。請先到「線上互動配課」指派所有教師後，再啟動排課。`);
    return;
  }

  const maxBacktracks = parseInt(document.getElementById("engine-max-backtracks").value) || 50000;
  const preferMorningCore = document.getElementById("engine-prefer-morning-core").checked;
  const preferConsecutiveSpecial = document.getElementById("engine-prefer-consecutive-special").checked;

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
        { maxBacktracks, preferMorningCore, preferConsecutiveSpecial },
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
      lucide.createIcons();
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
    Object.keys(SPECIAL_ROOMS).forEach(key => {
      select.innerHTML += `<option value="${key}">${SPECIAL_ROOMS[key].name}</option>`;
    });
  }

  // Restore selection
  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }

  // Render the grid table
  renderTimetableGrid();
}

function handleViewerDimensionChange() {
  const alertBox = document.getElementById("timetable-alert-box");
  const dimension = document.getElementById("viewer-dimension").value;
  
  if (dimension === "class") {
    alertBox.style.display = "flex";
  } else {
    alertBox.style.display = "none";
  }

  renderViewersControls();
}

function renderTimetableGrid() {
  const tbody = document.getElementById("timetable-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!state.schedule) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
      <i data-lucide="calendar-x" style="width: 3rem; height: 3rem; margin-bottom: 1rem; color: var(--warning-color);"></i>
      <p>目前尚無課表資料。請完成 100% 配課後，前往「自動排課引擎」生成課表！</p>
    </td></tr>`;
    lucide.createIcons();
    return;
  }

  const dimension = document.getElementById("viewer-dimension").value;
  const targetId = document.getElementById("viewer-target-select").value;
  
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
      const td = document.createElement("td");
      td.setAttribute("data-day", day);
      td.setAttribute("data-period", p.num);

      // Render content based on selected dimension
      if (dimension === "class") {
        renderClassCell(td, targetId, day, p.num);
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

  lucide.createIcons();
}

function renderClassCell(td, classId, day, period) {
  // Check if slot is disabled/locked for this grade
  const cls = state.classes.find(c => c.id === classId);
  if (cls) {
    if (cls.grade <= 2 && period >= 5 && day !== 2) {
      td.className = "slot-locked";
      td.innerHTML = "下課放學";
      return;
    }
    if (cls.grade >= 3 && cls.grade <= 4 && period >= 5 && (day === 3 || day === 5)) {
      td.className = "slot-locked";
      td.innerHTML = "下課放學";
      return;
    }
    if (cls.grade >= 5 && period >= 5 && day === 3) {
      td.className = "slot-locked";
      td.innerHTML = "下課放學";
      return;
    }
  }

  const cell = state.schedule[classId]?.[`${day}-${period}`];
  if (cell) {
    const teacher = state.teachers.find(t => t.id === cell.teacherId);
    const roomBadge = cell.requiresRoom ? `<span class="timetable-card-room">${SPECIAL_ROOMS[cell.requiresRoom]?.name}</span>` : '';
    
    td.innerHTML = `
      <div class="timetable-card" draggable="true" data-subject="${cell.subject}" data-teacher-id="${cell.teacherId}" data-room="${cell.requiresRoom || ''}">
        <span class="timetable-card-subject">${cell.subject}</span>
        <span class="timetable-card-teacher">${teacher ? teacher.name : cell.teacherId}</span>
        ${roomBadge}
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
    const roomBadge = room ? `<span class="timetable-card-room">${SPECIAL_ROOMS[room]?.name}</span>` : '';
    td.innerHTML = `
      <div class="timetable-card" style="border-left-color: var(--success-color); background-color: var(--success-bg);">
        <span class="timetable-card-subject">${assignedClassId} 班</span>
        <span class="timetable-card-teacher">${subject}</span>
        ${roomBadge}
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
      content += `
        <div class="timetable-card" style="border-left-color: var(--info-color); background-color: var(--info-bg); height: auto; margin-bottom: 2px;">
          <span class="timetable-card-subject">${oc.classId} 班</span>
          <span class="timetable-card-teacher">${oc.subject} (${oc.teacherName})</span>
        </div>
      `;
    });
    td.innerHTML = content;
  }
}

// ----------------------------------------------------
// DRAG & DROP CONTROLLER
// ----------------------------------------------------
function enableDragAndDropEvents(classId) {
  const cards = document.querySelectorAll("#timetable-tbody .timetable-card");
  const cells = document.querySelectorAll("#timetable-tbody td:not(.time-cell):not(.slot-locked)");

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
        requiresRoom: draggedElement.getAttribute("data-room") || null
      };

      const check = validateManualMove(
        state.schedule, 
        state.teachers, 
        classId, 
        dragSourceSlot.day, 
        dragSourceSlot.period, 
        targetDay, 
        targetPeriod, 
        lesson
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
        requiresRoom: draggedElement.getAttribute("data-room") || null
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
        lesson
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
          requiresRoom: lesson.requiresRoom
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
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", `智慧排課系統資料_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function importSystemData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const imported = JSON.parse(evt.target.result);
      if (imported.teachers && imported.classes && imported.assignments) {
        state = imported;
        if (!state.subjects) {
          state.subjects = [...DEFAULT_SUBJECTS];
        }
        saveAppState(state);
        renderCurrentTab();
        alert("系統資料匯入成功！");
      } else {
        alert("匯入的檔案結構不符！必須包含 teachers, classes 與 assignments 欄位。");
      }
    } catch (err) {
      alert("無法解析 JSON 檔案，請確認檔案格式是否正確。");
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
            const roomName = cell.requiresRoom ? ` [${SPECIAL_ROOMS[cell.requiresRoom]?.name}]` : '';
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

  filtered.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.grade} 年級</strong></td>
      <td>${s.subject}</td>
      <td>${s.weeklyHours} 節</td>
      <td>${s.requiresRoom ? `<span class="badge badge-primary">${s.requiresRoom}教室</span>` : '無'}</td>
      <td>
        <button class="btn-delete-subject btn-danger btn-icon-only" data-id="${s.id}" title="刪除科目">
          <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-delete-subject").forEach(btn => {
    btn.onclick = function() {
      const id = btn.getAttribute("data-id");
      if (confirm("確定要刪除此科目設定嗎？這會一併刪除全校各班級該科目的授課配課資料。")) {
        deleteSubject(id);
      }
    };
  });

  lucide.createIcons();
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

function openSubjectModal() {
  const modal = document.getElementById("modal-subject");
  document.getElementById("form-subject").reset();
  modal.classList.add("open");
}

function handleSubjectFormSubmit(e) {
  e.preventDefault();
  const grade = parseInt(document.getElementById("subject-grade").value);
  const name = document.getElementById("subject-name").value.trim();
  const hours = parseInt(document.getElementById("subject-hours").value);
  const room = document.getElementById("subject-room").value || null;

  if (!name || isNaN(grade) || isNaN(hours)) return;

  const subjectId = `${grade}-${name}`;
  const existingIndex = state.subjects.findIndex(s => s.id === subjectId);
  
  const newSub = {
    id: subjectId,
    grade: grade,
    subject: name,
    weeklyHours: hours,
    requiresRoom: room
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
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    try {
      tempImportSubjects = parseSubjectCSV(text);
      if (tempImportSubjects.length === 0) {
        alert("無法從 CSV 檔案解析出有效的科目設定。請檢查格式是否符合。");
        return;
      }
      showSubjectCSVPreviewModal();
    } catch (err) {
      alert("讀取 CSV 檔案出錯，請確認編碼為 UTF-8 或格式正確。");
      console.error(err);
    }
  };
  reader.readAsText(file, "UTF-8");
}

function showSubjectCSVPreviewModal() {
  const modal = document.getElementById("modal-subject-import-confirm");
  const tbody = document.getElementById("subject-csv-preview-tbody");
  tbody.innerHTML = "";

  tempImportSubjects.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.grade} 年級</strong></td>
      <td>${s.subject}</td>
      <td>${s.weeklyHours} 節</td>
      <td>${s.requiresRoom || '無'}</td>
    `;
    tbody.appendChild(tr);
  });

  modal.classList.add("open");

  const confirmBtn = document.getElementById("btn-subject-csv-confirm-save");
  confirmBtn.onclick = function() {
    tempImportSubjects.forEach(newS => {
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
    showConsoleLog(`成功批次匯入 ${tempImportSubjects.length} 個科目設定，課表已重置。`);
  };
}

function downloadSubjectCSVTemplate() {
  const header = "年級,科目名稱,每週節數,特殊教室\n";
  const rows = [
    "1,國語,6,",
    "1,數學,3,",
    "1,生活,6,",
    "3,自然,3,自然",
    "3,電腦,1,電腦",
    "5,英語,3,"
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
