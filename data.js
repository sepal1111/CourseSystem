/**
 * data.js - Data models, default configurations, CSV parser, and State persistence.
 */

// Define the 15 classes in school
export const DEFAULT_CLASSES = [
  { id: "101", name: "101 班", grade: 1 },
  { id: "102", name: "102 班", grade: 1 },
  { id: "201", name: "201 班", grade: 2 },
  { id: "202", name: "202 班", grade: 2 },
  { id: "301", name: "301 班", grade: 3 },
  { id: "302", name: "302 班", grade: 3 },
  { id: "401", name: "401 班", grade: 4 },
  { id: "402", name: "402 班", grade: 4 },
  { id: "403", name: "403 班", grade: 4 },
  { id: "501", name: "501 班", grade: 5 },
  { id: "502", name: "502 班", grade: 5 },
  { id: "503", name: "503 班", grade: 5 },
  { id: "601", name: "601 班", grade: 6 },
  { id: "602", name: "602 班", grade: 6 },
  { id: "603", name: "603 班", grade: 6 }
];

// Special Room limits: e.g. computer lab limit is 1 class, Gym is 2 classes at the same time
export const DEFAULT_ROOMS = {
  "電腦": { name: "電腦教室", limit: 1 },
  "體育": { name: "體育館", limit: 2 },
  "音樂": { name: "音樂教室", limit: 1 },
  "美勞": { name: "美勞教室", limit: 1 }
};
export const SPECIAL_ROOMS = DEFAULT_ROOMS;

// Default subjects per grade level (台湾國小課程大綱基礎)
export const DEFAULT_SUBJECTS = [
  // Low Grades (1, 2)
  { id: "1-國語", grade: 1, subject: "國語", weeklyHours: 6, requiresRoom: null },
  { id: "1-數學", grade: 1, subject: "數學", weeklyHours: 3, requiresRoom: null },
  { id: "1-生活", grade: 1, subject: "生活", weeklyHours: 6, requiresRoom: null },
  { id: "1-綜合", grade: 1, subject: "綜合", weeklyHours: 2, requiresRoom: null },
  { id: "1-健康", grade: 1, subject: "健康", weeklyHours: 1, requiresRoom: null },
  { id: "1-體育", grade: 1, subject: "體育", weeklyHours: 2, requiresRoom: "體育" },
  { id: "1-閱讀", grade: 1, subject: "閱讀", weeklyHours: 1, requiresRoom: null },
  { id: "1-彈性", grade: 1, subject: "彈性", weeklyHours: 2, requiresRoom: null },

  { id: "2-國語", grade: 2, subject: "國語", weeklyHours: 6, requiresRoom: null },
  { id: "2-數學", grade: 2, subject: "數學", weeklyHours: 3, requiresRoom: null },
  { id: "2-生活", grade: 2, subject: "生活", weeklyHours: 6, requiresRoom: null },
  { id: "2-綜合", grade: 2, subject: "綜合", weeklyHours: 2, requiresRoom: null },
  { id: "2-健康", grade: 2, subject: "健康", weeklyHours: 1, requiresRoom: null },
  { id: "2-體育", grade: 2, subject: "體育", weeklyHours: 2, requiresRoom: "體育" },
  { id: "2-閱讀", grade: 2, subject: "閱讀", weeklyHours: 1, requiresRoom: null },
  { id: "2-彈性", grade: 2, subject: "彈性", weeklyHours: 2, requiresRoom: null },

  // Mid Grades (3, 4)
  { id: "3-國語", grade: 3, subject: "國語", weeklyHours: 5, requiresRoom: null },
  { id: "3-數學", grade: 3, subject: "數學", weeklyHours: 4, requiresRoom: null },
  { id: "3-社會", grade: 3, subject: "社會", weeklyHours: 3, requiresRoom: null },
  { id: "3-自然", grade: 3, subject: "自然", weeklyHours: 3, requiresRoom: "自然" },
  { id: "3-音樂", grade: 3, subject: "音樂", weeklyHours: 2, requiresRoom: "音樂" },
  { id: "3-美勞", grade: 3, subject: "美勞", weeklyHours: 2, requiresRoom: "美勞" },
  { id: "3-綜合", grade: 3, subject: "綜合", weeklyHours: 2, requiresRoom: null },
  { id: "3-健康", grade: 3, subject: "健康", weeklyHours: 1, requiresRoom: null },
  { id: "3-體育", grade: 3, subject: "體育", weeklyHours: 2, requiresRoom: "體育" },
  { id: "3-電腦", grade: 3, subject: "電腦", weeklyHours: 1, requiresRoom: "電腦" },
  { id: "3-英語", grade: 3, subject: "英語", weeklyHours: 2, requiresRoom: null },
  { id: "3-彈性", grade: 3, subject: "彈性", weeklyHours: 2, requiresRoom: null },

  { id: "4-國語", grade: 4, subject: "國語", weeklyHours: 5, requiresRoom: null },
  { id: "4-數學", grade: 4, subject: "數學", weeklyHours: 4, requiresRoom: null },
  { id: "4-社會", grade: 4, subject: "社會", weeklyHours: 3, requiresRoom: null },
  { id: "4-自然", grade: 4, subject: "自然", weeklyHours: 3, requiresRoom: "自然" },
  { id: "4-音樂", grade: 4, subject: "音樂", weeklyHours: 2, requiresRoom: "音樂" },
  { id: "4-美勞", grade: 4, subject: "美勞", weeklyHours: 2, requiresRoom: "美勞" },
  { id: "4-綜合", grade: 4, subject: "綜合", weeklyHours: 2, requiresRoom: null },
  { id: "4-健康", grade: 4, subject: "健康", weeklyHours: 1, requiresRoom: null },
  { id: "4-體育", grade: 4, subject: "體育", weeklyHours: 2, requiresRoom: "體育" },
  { id: "4-電腦", grade: 4, subject: "電腦", weeklyHours: 1, requiresRoom: "電腦" },
  { id: "4-英語", grade: 4, subject: "英語", weeklyHours: 2, requiresRoom: null },
  { id: "4-彈性", grade: 4, subject: "彈性", weeklyHours: 2, requiresRoom: null },

  // High Grades (5, 6)
  { id: "5-國語", grade: 5, subject: "國語", weeklyHours: 5, requiresRoom: null },
  { id: "5-數學", grade: 5, subject: "數學", weeklyHours: 4, requiresRoom: null },
  { id: "5-社會", grade: 5, subject: "社會", weeklyHours: 3, requiresRoom: null },
  { id: "5-自然", grade: 5, subject: "自然", weeklyHours: 3, requiresRoom: "自然" },
  { id: "5-音樂", grade: 5, subject: "音樂", weeklyHours: 2, requiresRoom: "音樂" },
  { id: "5-美勞", grade: 5, subject: "美勞", weeklyHours: 2, requiresRoom: "美勞" },
  { id: "5-綜合", grade: 5, subject: "綜合", weeklyHours: 2, requiresRoom: null },
  { id: "5-健康", grade: 5, subject: "健康", weeklyHours: 1, requiresRoom: null },
  { id: "5-體育", grade: 5, subject: "體育", weeklyHours: 2, requiresRoom: "體育" },
  { id: "5-電腦", grade: 5, subject: "電腦", weeklyHours: 2, requiresRoom: "電腦" },
  { id: "5-英語", grade: 5, subject: "英語", weeklyHours: 3, requiresRoom: null },
  { id: "5-彈性", grade: 5, subject: "彈性", weeklyHours: 3, requiresRoom: null },

  { id: "6-國語", grade: 6, subject: "國語", weeklyHours: 5, requiresRoom: null },
  { id: "6-數學", grade: 6, subject: "數學", weeklyHours: 4, requiresRoom: null },
  { id: "6-社會", grade: 6, subject: "社會", weeklyHours: 3, requiresRoom: null },
  { id: "6-自然", grade: 6, subject: "自然", weeklyHours: 3, requiresRoom: "自然" },
  { id: "6-音樂", grade: 6, subject: "音樂", weeklyHours: 2, requiresRoom: "音樂" },
  { id: "6-美勞", grade: 6, subject: "美勞", weeklyHours: 2, requiresRoom: "美勞" },
  { id: "6-綜合", grade: 6, subject: "綜合", weeklyHours: 2, requiresRoom: null },
  { id: "6-健康", grade: 6, subject: "健康", weeklyHours: 1, requiresRoom: null },
  { id: "6-體育", grade: 6, subject: "體育", weeklyHours: 2, requiresRoom: "體育" },
  { id: "6-電腦", grade: 6, subject: "電腦", weeklyHours: 2, requiresRoom: "電腦" },
  { id: "6-英語", grade: 6, subject: "英語", weeklyHours: 3, requiresRoom: null },
  { id: "6-彈性", grade: 6, subject: "彈性", weeklyHours: 3, requiresRoom: null }
];

// Default Teachers configuration matching requirements
export const DEFAULT_TEACHERS = [
  // 4 主任 (director, 3 hrs base)
  { id: "T001", name: "陳主任", role: "director", baseHours: 3, targetClassId: null, specialties: ["社會", "閱讀"], busySlots: ["1-3", "2-3", "2-4"] }, // 避開週一/週二開會
  { id: "T002", name: "林主任", role: "director", baseHours: 3, targetClassId: null, specialties: ["數學", "彈性"], busySlots: ["1-3", "2-3", "2-4"] },
  { id: "T003", name: "黃主任", role: "director", baseHours: 3, targetClassId: null, specialties: ["國語", "綜合"], busySlots: ["1-3", "2-3", "2-4"] },
  { id: "T004", name: "郭主任", role: "director", baseHours: 3, targetClassId: null, specialties: ["健康", "彈性"], busySlots: ["1-3", "2-3", "2-4"] },

  // 7 組長 (leader, 9 hrs base)
  { id: "T005", name: "王組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["英語", "彈性"], busySlots: ["1-4", "4-3", "4-4"] },
  { id: "T006", name: "李組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["數學", "彈性"], busySlots: ["1-4", "4-3", "4-4"] },
  { id: "T007", name: "張組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["國語", "社會"], busySlots: ["1-4", "4-3", "4-4"] },
  { id: "T008", name: "趙組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["音樂", "生活"], busySlots: ["1-4", "4-3", "4-4"] },
  { id: "T009", name: "劉組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["自然", "綜合"], busySlots: ["1-4", "4-3", "4-4"] },
  { id: "T010", name: "謝組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["健康", "體育"], busySlots: ["1-4", "4-3", "4-4"] },
  { id: "T011", name: "蔡組長", role: "leader", baseHours: 9, targetClassId: null, specialties: ["電腦", "彈性"], busySlots: ["1-4", "4-3", "4-4"] },

  // 15 導師 (homeroom, 16 hrs base, each assigned to a class)
  { id: "T012", name: "鄭老師", role: "homeroom", baseHours: 16, targetClassId: "101", specialties: ["國語", "數學", "生活", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T013", name: "周老師", role: "homeroom", baseHours: 16, targetClassId: "102", specialties: ["國語", "數學", "生活", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T014", name: "吳老師", role: "homeroom", baseHours: 16, targetClassId: "201", specialties: ["國語", "數學", "生活", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T015", name: "徐老師", role: "homeroom", baseHours: 16, targetClassId: "202", specialties: ["國語", "數學", "生活", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T016", name: "孫老師", role: "homeroom", baseHours: 16, targetClassId: "301", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T017", name: "胡老師", role: "homeroom", baseHours: 16, targetClassId: "302", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T018", name: "朱老師", role: "homeroom", baseHours: 16, targetClassId: "401", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T019", name: "高老師", role: "homeroom", baseHours: 16, targetClassId: "402", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T020", name: "梁老師", role: "homeroom", baseHours: 16, targetClassId: "403", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T021", name: "蕭老師", role: "homeroom", baseHours: 16, targetClassId: "501", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T022", name: "馮老師", role: "homeroom", baseHours: 16, targetClassId: "502", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T023", name: "沈老師", role: "homeroom", baseHours: 16, targetClassId: "503", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T024", name: "楊老師", role: "homeroom", baseHours: 16, targetClassId: "601", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T025", name: "董老師", role: "homeroom", baseHours: 16, targetClassId: "602", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },
  { id: "T026", name: "潘老師", role: "homeroom", baseHours: 16, targetClassId: "603", specialties: ["國語", "數學", "社會", "綜合", "健康", "閱讀", "彈性"], busySlots: ["3-5"] },

  // 4 科任教師 (subject, 20 hrs base, dedicated specialists)
  { id: "T027", name: "戴體育", role: "subject", baseHours: 20, targetClassId: null, specialties: ["體育", "健康"], busySlots: [] },
  { id: "T028", name: "江自然", role: "subject", baseHours: 20, targetClassId: null, specialties: ["自然"], busySlots: [] },
  { id: "T029", name: "何美勞", role: "subject", baseHours: 20, targetClassId: null, specialties: ["美勞", "生活"], busySlots: [] },
  { id: "T030", name: "施英文", role: "subject", baseHours: 20, targetClassId: null, specialties: ["英語"], busySlots: [] },

  // 鐘點教師 (hourly, 0 base, dynamically added as needed)
  { id: "T031", name: "鐘體育", role: "hourly", baseHours: 0, targetClassId: null, specialties: ["體育"], busySlots: [] },
  { id: "T032", name: "鐘電腦", role: "hourly", baseHours: 0, targetClassId: null, specialties: ["電腦"], busySlots: [] },
  { id: "T033", name: "鐘音樂", role: "hourly", baseHours: 0, targetClassId: null, specialties: ["音樂"], busySlots: [] },
  { id: "T034", name: "鐘自然", role: "hourly", baseHours: 0, targetClassId: null, specialties: ["自然"], busySlots: [] }
];

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
    const idCol = headers.findIndex(h => h.includes("編號") || h.includes("ID") || h.includes("代碼"));
    const nameCol = headers.findIndex(h => h.includes("姓名") || h.includes("名字") || h.includes("教師"));
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

  const totalAssigned = assignments.reduce((sum, assign) => sum + assign.weeklyHours, 0);
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
  
  let gradeIdx = 0, nameIdx = 1, hoursIdx = 2, roomIdx = 3;
  let startIndex = 1;
  
  if (hasHeader) {
    const gradeCol = headers.findIndex(h => h.includes("年級") || h.includes("年") || h.includes("grade"));
    const nameCol = headers.findIndex(h => h.includes("科目") || h.includes("名稱") || h.includes("subject"));
    const hoursCol = headers.findIndex(h => h.includes("節數") || h.includes("時數") || h.includes("hours"));
    const roomCol = headers.findIndex(h => h.includes("教室") || h.includes("room") || h.includes("特殊"));
    
    if (gradeCol !== -1) gradeIdx = gradeCol;
    if (nameCol !== -1) nameIdx = nameCol;
    if (hoursCol !== -1) hoursIdx = hoursCol;
    if (roomCol !== -1) roomIdx = roomCol;
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
    
    subjects.push({
      id: `${gradeVal}-${nameVal}`,
      grade: gradeVal,
      subject: nameVal,
      weeklyHours: hoursVal,
      requiresRoom: row[roomIdx] || null
    });
  }
  return subjects;
}
