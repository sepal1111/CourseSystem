/**
 * data.js - Data models, default configurations, CSV parser, and State persistence.
 */

// Empty initial data configurations; state will be loaded from CSV imports or user input
export const DEFAULT_CLASSES = [];
export const DEFAULT_ROOMS = {};
export const SPECIAL_ROOMS = DEFAULT_ROOMS;
export const DEFAULT_SUBJECTS = [];
export const DEFAULT_TEACHERS = [];

/**
 * Parses teacher CSV content
 * CSV schema: 教師編號,姓名,身分職務,基本節數,帶班班級,專長科目
 */
export function parseTeacherCSV(csvText) {
  const lines = csvText.split('\n');
  if (lines.length === 0) return [];
  
  const roleMap = { 
    '主任': 'director', '組長': 'leader', '導師': 'homeroom', '科任': 'subject', '鐘點': 'hourly',
    'director': 'director', 'leader': 'leader', 'homeroom': 'homeroom', 'subject': 'subject', 'hourly': 'hourly'
  };
  const defaultHours = { 'director': 3, 'leader': 9, 'homeroom': 16, 'subject': 20, 'hourly': 0 };
  
  const firstLine = lines[0].trim();
  const headers = firstLine.split(',').map(h => h.trim());
  const headerText = firstLine.toLowerCase();
  
  const hasHeader = ["姓名", "name", "職", "身分", "角色", "role", "編號", "id", "代碼"].some(k => headerText.includes(k));
  
  let idIdx = 0, nameIdx = 1, roleIdx = 2, hoursIdx = 3, classIdx = 4, specIdx = 5;
  let startIndex = 1;
  
  if (hasHeader) {
    const idCol = headers.findIndex(h => {
      const lower = h.toLowerCase();
      return lower.includes("編號") || lower.includes("id") || lower.includes("代碼");
    });
    const nameCol = headers.findIndex(h => {
      const lower = h.toLowerCase();
      return (lower.includes("姓名") || lower.includes("名字") || lower.includes("name") || lower === "教師") 
        && !lower.includes("編號") && !lower.includes("id") && !lower.includes("代碼");
    });
    const roleCol = headers.findIndex(h => h.includes("職務") || h.includes("職位") || h.includes("身分") || h.includes("角色"));
    const hoursCol = headers.findIndex(h => h.includes("節數") || h.includes("授課") || h.includes("基本"));
    const classCol = headers.findIndex(h => h.includes("班級") || h.includes("帶班") || h.includes("導師班"));
    const specCol = headers.findIndex(h => h.includes("專長") || h.includes("科目") || h.includes("學科"));
    
    if (idCol !== -1) idIdx = idCol;
    if (nameCol !== -1) nameIdx = nameCol;
    if (roleCol !== -1) roleIdx = roleCol;
    if (hoursCol !== -1) hoursIdx = hoursCol;
    if (classCol !== -1) classIdx = classCol;
    if (specCol !== -1) specIdx = specCol;
    startIndex = 1;
  } else {
    startIndex = 0;
    const dummyRow = firstLine.split(',');
    if (dummyRow.length === 2) {
      // Simplest: Name, Role (姓名、職位)
      idIdx = -1; // Auto-generate
      nameIdx = 0;
      roleIdx = 1;
      hoursIdx = -1;
      classIdx = -1;
      specIdx = -1;
    } else if (dummyRow.length === 3) {
      // ID, Name, Role (編號、姓名、職位) or Name, Role, hours
      // Let's check if Column 0 contains digit or looks like T001
      const isCol0Id = /^[A-Za-z0-9]+$/.test(dummyRow[0].trim()) && !roleMap[dummyRow[0].trim()];
      if (isCol0Id) {
        idIdx = 0;
        nameIdx = 1;
        roleIdx = 2;
      } else {
        idIdx = -1;
        nameIdx = 0;
        roleIdx = 1;
        hoursIdx = 2;
      }
      classIdx = -1;
      specIdx = -1;
    }
  }
  
  const teachers = [];
  let generatedIdCounter = 1;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = line.split(',').map(item => {
      let trimmed = item?.trim() || "";
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        trimmed = trimmed.substring(1, trimmed.length - 1).trim();
      }
      return trimmed;
    });

    const nameVal = nameIdx !== -1 ? row[nameIdx] : "";
    if (!nameVal) continue;

    let idVal = idIdx !== -1 ? row[idIdx] : "";
    if (!idVal || idVal === nameVal || !/^[A-Za-z0-9]+$/.test(idVal)) {
      idVal = `T${String(generatedIdCounter++).padStart(3, '0')}`;
    }

    const roleStr = roleIdx !== -1 ? row[roleIdx] : '鐘點';
    const role = roleMap[roleStr] || 'hourly';
    
    const baseHours = (hoursIdx !== -1 && row[hoursIdx]) ? parseInt(row[hoursIdx]) : defaultHours[role];
    const targetClassId = (classIdx !== -1 && row[classIdx]) ? row[classIdx] : null;
    const specialties = (specIdx !== -1 && row[specIdx]) ? row[specIdx].split(';').map(s => s.trim()).filter(Boolean) : [];

    teachers.push({
      id: idVal,
      name: nameVal,
      role: role,
      baseHours: isNaN(baseHours) ? defaultHours[role] : baseHours,
      assignedHours: 0,
      targetClassId: role === 'homeroom' ? targetClassId : null,
      specialties: specialties,
      busySlots: []
    });
  }
  return teachers;
}

/**
 * Parses class CSV content
 * CSV schema: 班級ID,班級名稱,年級
 */
export function parseClassCSV(csvText) {
  const lines = csvText.split('\n');
  if (lines.length === 0) return [];
  
  const classes = [];
  
  const firstLine = lines[0].trim();
  const headers = firstLine.split(',').map(h => h.trim());
  const headerText = firstLine.toLowerCase();
  
  const hasHeader = ["id", "編號", "代碼", "名稱", "班級", "年級", "級別", "grade"].some(k => headerText.includes(k));
  
  let idIdx = 0, nameIdx = 1, gradeIdx = 2;
  let startIndex = 1;
  
  if (hasHeader) {
    const idCol = headers.findIndex(h => h.includes("ID") || h.includes("編號") || h.includes("代碼"));
    const nameCol = headers.findIndex(h => h.includes("名稱") || h.includes("名字") || h.includes("班級"));
    const gradeCol = headers.findIndex(h => h.includes("年級") || h.includes("級別") || h.includes("年"));
    
    if (idCol !== -1) idIdx = idCol;
    if (nameCol !== -1) nameIdx = nameCol;
    if (gradeCol !== -1) gradeIdx = gradeCol;
    startIndex = 1;
  } else {
    startIndex = 0;
    const dummyRow = firstLine.split(',');
    if (dummyRow.length === 2) {
      idIdx = 0;
      nameIdx = 0;
      gradeIdx = 1;
    } else {
      idIdx = 0;
      nameIdx = 1;
      gradeIdx = 2;
    }
  }
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const row = line.split(',').map(item => {
      let trimmed = item?.trim() || "";
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        trimmed = trimmed.substring(1, trimmed.length - 1).trim();
      }
      return trimmed;
    });
    
    const idVal = row[idIdx];
    const nameVal = row[nameIdx];
    if (!idVal) continue;
    
    let gradeVal = parseInt(row[gradeIdx]);
    if (isNaN(gradeVal)) {
      const firstChar = idVal.charAt(0);
      gradeVal = parseInt(firstChar);
      if (isNaN(gradeVal) || gradeVal < 1 || gradeVal > 6) {
        gradeVal = 1;
      }
    }
    
    classes.push({
      id: idVal,
      name: nameVal || `${idVal} 班`,
      grade: gradeVal
    });
  }
  return classes;
}

/**
 * Validates course assignments and sums assigned hours per teacher
 * Returns indicators about overloaded or underloaded staff
 */
export function validateAssignments(teachers, assignments, classes = [], subjects = []) {
  // Reset counts
  teachers.forEach(t => t.assignedHours = 0);

  // Sum hours
  assignments.forEach(assign => {
    const teacher = teachers.find(t => t.id === assign.teacherId);
    if (teacher) {
      teacher.assignedHours += assign.weeklyHours;
    }
  });

  // Calculate dynamic target hours
  let totalTargetHours = 0;
  classes.forEach(c => {
    totalTargetHours += subjects
      .filter(s => s.grade === c.grade)
      .reduce((sum, s) => sum + s.weeklyHours, 0);
  });

  const totalAssigned = assignments.filter(assign => Boolean(assign.teacherId)).reduce((sum, assign) => sum + assign.weeklyHours, 0);
  const unassignedHours = totalTargetHours - totalAssigned;

  const overloadedTeachers = teachers.filter(t => t.role !== 'hourly' && t.assignedHours > t.baseHours);
  const underloadedTeachers = teachers.filter(t => t.role !== 'hourly' && t.assignedHours < t.baseHours);

  return {
    isComplete: unassignedHours === 0 && totalTargetHours > 0,
    totalTargetHours,
    totalAssigned,
    unassignedHours: Math.max(0, unassignedHours),
    overloadedTeachers,
    underloadedTeachers
  };
}

/**
 * LocalStorage state managers
 */
const STORAGE_KEY = "course_scheduler_state";

export function saveAppState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error("Failed to save state to localStorage", e);
    return false;
  }
}

export function loadAppState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data);
  } catch (e) {
    console.error("Failed to load state from localStorage", e);
    return null;
  }
}

export function getInitialState() {
  return {
    teachers: [],
    classes: [],
    subjects: [],
    assignments: [],
    rooms: { ...DEFAULT_ROOMS },
    schedule: null
  };
}

/**
 * Parses subject CSV content
 * CSV schema: 年級,科目名稱,每週節數,特殊教室
 */
export function parseSubjectCSV(csvText) {
  const lines = csvText.split('\n');
  if (lines.length === 0) return [];
  
  const subjects = [];
  
  const firstLine = lines[0].trim();
  const headers = firstLine.split(',').map(h => h.trim());
  const headerText = firstLine.toLowerCase();
  
  const hasHeader = ["年級", "grade", "科目", "名稱", "subject", "節數", "hours"].some(k => headerText.includes(k));
  
  let gradeIdx = 0, nameIdx = 1, hoursIdx = 2, roomIdx = 3, homeroomIdx = 4;
  let startIndex = 1;
  
  if (hasHeader) {
    const gradeCol = headers.findIndex(h => h.includes("年級") || h.includes("年") || h.includes("grade"));
    const nameCol = headers.findIndex(h => h.includes("科目") || h.includes("名稱") || h.includes("subject"));
    const hoursCol = headers.findIndex(h => h.includes("節數") || h.includes("時數") || h.includes("hours"));
    const roomCol = headers.findIndex(h => h.includes("教室") || h.includes("room") || h.includes("特殊"));
    const homeroomCol = headers.findIndex(h => h.includes("導師") || h.includes("主科") || h.includes("屬性"));
    
    if (gradeCol !== -1) gradeIdx = gradeCol;
    if (nameCol !== -1) nameIdx = nameCol;
    if (hoursCol !== -1) hoursIdx = hoursCol;
    if (roomCol !== -1) roomIdx = roomCol;
    if (homeroomCol !== -1) homeroomIdx = homeroomCol;
    startIndex = 1;
  } else {
    startIndex = 0;
  }
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const row = line.split(',').map(item => {
      let trimmed = item?.trim() || "";
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        trimmed = trimmed.substring(1, trimmed.length - 1).trim();
      }
      return trimmed;
    });
    
    const gradeVal = parseInt(row[gradeIdx]);
    const nameVal = row[nameIdx];
    const hoursVal = parseInt(row[hoursIdx]);
    
    if (isNaN(gradeVal) || !nameVal || isNaN(hoursVal)) continue;

    let isHomeroomMain = false;
    if (homeroomIdx !== -1 && row[homeroomIdx] !== undefined && row[homeroomIdx] !== "") {
      const val = row[homeroomIdx].trim().toLowerCase();
      if (["是", "true", "1", "yes", "y", "導師主要科目", "導師主科"].includes(val)) {
        isHomeroomMain = true;
      } else if (["否", "false", "0", "no", "n", "科任", "專科"].includes(val)) {
        isHomeroomMain = false;
      }
    }
    
    subjects.push({
      id: `${gradeVal}-${nameVal}`,
      grade: gradeVal,
      subject: nameVal,
      weeklyHours: hoursVal,
      requiresRoom: row[roomIdx] || null,
      isHomeroomMain: isHomeroomMain
    });
  }
  return subjects;
}
