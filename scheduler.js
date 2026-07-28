/**
 * scheduler.js - Heuristic Backtracking Course Scheduling Engine
 */

import { SPECIAL_ROOMS } from './data.js';

/**
 * Main function to start the scheduling process.
 * Runs Heuristic Backtracking CSP solver.
 */
export function runScheduler(teachers, classes, assignments, params = {}, logCallback = console.log) {
  const maxBacktracks = params.maxBacktracks || 50000;
  const preferMorningCore = params.preferMorningCore !== false;
  const preferConsecutiveSpecial = params.preferConsecutiveSpecial !== false;

  logCallback("===============================");
  logCallback(`[Engine] 啟動自動排課引擎...`);
  logCallback(`[Engine] 總班級數: ${classes.length}，總教師數: ${teachers.length}`);
  logCallback(`[Engine] 待排課節數: ${assignments.reduce((sum, a) => sum + a.weeklyHours, 0)} 節`);
  logCallback(`[Engine] 最大回溯次數限制: ${maxBacktracks}`);
  
  // 1. Convert weekly CourseAssignments into a list of individual Lesson tokens
  const lessons = [];
  assignments.forEach(assign => {
    for (let i = 0; i < assign.weeklyHours; i++) {
      lessons.push({
        id: `${assign.classId}-${assign.subject}-${assign.teacherId}-${i}`,
        classId: assign.classId,
        subject: assign.subject,
        teacherId: assign.teacherId,
        requiresRoom: assign.requiresRoom || null,
        assignmentId: assign.id,
        lessonIndex: i, // 0-indexed index of the lesson in this assignment
        weeklyHours: assign.weeklyHours
      });
    }
  });

  // 2. Pre-calculate teacher and class maps for fast lookup
  const teacherMap = new Map();
  teachers.forEach(t => teacherMap.set(t.id, t));
  
  const classMap = new Map();
  classes.forEach(c => classMap.set(c.id, c));

  // 3. Initialize scheduling matrices
  // Structure: classSchedule[classId][day][period] -> Lesson
  const classSchedule = {};
  classes.forEach(c => {
    classSchedule[c.id] = {};
    for (let day = 1; day <= 5; day++) {
      classSchedule[c.id][day] = {};
      for (let period = 1; period <= 7; period++) {
        classSchedule[c.id][day][period] = null;
      }
    }
  });

  // Structure: teacherSchedule[teacherId][day][period] -> classId
  const teacherSchedule = {};
  teachers.forEach(t => {
    teacherSchedule[t.id] = {};
    for (let day = 1; day <= 5; day++) {
      teacherSchedule[t.id][day] = {};
      for (let period = 1; period <= 7; period++) {
        teacherSchedule[t.id][day][period] = null;
      }
    }
  });

  // Structure: roomUsage[roomType][day][period] -> count
  const roomUsage = {};
  Object.keys(SPECIAL_ROOMS).forEach(roomType => {
    roomUsage[roomType] = {};
    for (let day = 1; day <= 5; day++) {
      roomUsage[roomType][day] = {};
      for (let period = 1; period <= 7; period++) {
        roomUsage[roomType][day][period] = 0;
      }
    }
  });

  // 4. Sort variables (lessons) based on heuristics (MRV & constraint weight)
  // We want to schedule the hardest lessons first to avoid backtracking late.
  lessons.forEach(lesson => {
    const t = teacherMap.get(lesson.teacherId);
    const c = classMap.get(lesson.classId);
    let difficulty = 0;

    // A: Special room requirements (high risk of conflict)
    if (lesson.requiresRoom) {
      difficulty += 150;
      // Rooms with lower capacity limits are harder
      const limit = SPECIAL_ROOMS[lesson.requiresRoom]?.limit || 1;
      difficulty += (5 - limit) * 20;
    }

    // B: Classes with fewer total available slots (Low grades have 23, Mid has 29, High has 32)
    if (c.grade <= 2) {
      difficulty += 80; // Low grade
    } else if (c.grade <= 4) {
      difficulty += 30; // Mid grade
    }

    // C: Teachers with high load relative to their role or busy slots
    if (t) {
      difficulty += t.busySlots.length * 15;
      
      // If teacher is very busy (homeroom 16h, subject 20h)
      if (t.role === 'subject') difficulty += 40;
      if (t.role === 'homeroom') difficulty += 25;
    }

    // D: Double period potential - if subject is natural science, art, computer, etc.
    if (["自然", "美勞", "電腦", "音樂"].includes(lesson.subject)) {
      difficulty += 10;
    }

    lesson.difficulty = difficulty;
  });

  // Sort descending by difficulty
  lessons.sort((a, b) => b.difficulty - a.difficulty);

  logCallback(`[Engine] 排序完成。最難排的前 5 門課：`);
  lessons.slice(0, 5).forEach((l, i) => {
    logCallback(`  ${i+1}. 班級 ${l.classId} - 科目 ${l.subject} - 教師 ${teacherMap.get(l.teacherId)?.name} (難度得分: ${l.difficulty.toFixed(0)})`);
  });

  // 5. Backtracking solver core variables
  let backtrackCount = 0;
  let startTime = performance.now();

  /**
   * Helper to check if a class slot is active based on grade level (Hard constraint)
   */
  function isSlotAllowedForClass(classId, day, period) {
    const cls = classMap.get(classId);
    if (!cls) return false;

    // Low Grade (1-2): Mon, Wed, Thu, Fri are half days (periods 1-4). Only Tue has periods 5-7.
    if (cls.grade <= 2) {
      if (period >= 5 && day !== 2) return false;
    }
    // Mid Grade (3-4): Wed, Fri are half days (periods 1-4). Mon, Tue, Thu are full days.
    if (cls.grade >= 3 && cls.grade <= 4) {
      if (period >= 5 && (day === 3 || day === 5)) return false;
    }
    // High Grade (5-6): Wed is half day (periods 1-4). Mon, Tue, Thu, Fri are full days.
    if (cls.grade >= 5) {
      if (period >= 5 && day === 3) return false;
    }

    return true;
  }

  /**
   * Check if assigning a lesson to (day, period) satisfies all hard constraints.
   */
  function isValid(lesson, day, period) {
    const { classId, teacherId, requiresRoom } = lesson;

    // Constraint 1: Class slot active?
    if (!isSlotAllowedForClass(classId, day, period)) return false;

    // Constraint 2: Class already has a class in this slot?
    if (classSchedule[classId][day][period] !== null) return false;

    // Constraint 3: Teacher already busy in this slot? (School meeting / personal)
    const t = teacherMap.get(teacherId);
    if (t && t.busySlots.includes(`${day}-${period}`)) return false;

    // Constraint 4: Teacher already teaching another class in this slot?
    if (teacherSchedule[teacherId][day][period] !== null) return false;

    // Constraint 5: Special room limit exceeded?
    if (requiresRoom) {
      const currentUsage = roomUsage[requiresRoom][day][period];
      const maxLimit = SPECIAL_ROOMS[requiresRoom]?.limit || 1;
      if (currentUsage >= maxLimit) return false;
    }

    return true;
  }

  /**
   * Sort candidate slots for a lesson based on soft constraint heuristics
   */
  function getSortedSlotsForLesson(lesson) {
    const candidates = [];
    const t = teacherMap.get(lesson.teacherId);

    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        if (isSlotAllowedForClass(lesson.classId, day, period)) {
          // Check if teacher is busy
          if (t && t.busySlots.includes(`${day}-${period}`)) continue;
          
          candidates.push({ day, period, score: 0 });
        }
      }
    }

    // Heuristics Scoring
    candidates.forEach(cand => {
      let score = 0;
      const { day, period } = cand;

      // H1: Prefer morning slots (periods 1-3) for core subjects (Math, Chinese, English)
      if (preferMorningCore && ["國語", "數學", "英語"].includes(lesson.subject)) {
        if (period <= 3) {
          score += 50; // Higher score for morning
        } else if (period === 4) {
          score += 10; // Neutral
        } else {
          score -= 30; // Penalize afternoon
        }
      }

      // H2: Prefer afternoon slots (periods 5-7) for physical education, art, health
      if (["體育", "美勞", "綜合", "健康"].includes(lesson.subject)) {
        if (period >= 5) {
          score += 40;
        } else if (period === 4) {
          score += 20;
        } else {
          score -= 10;
        }
      }

      // H3: Spreading: Avoid scheduling the same subject multiple times on the same day.
      // (Unless we want consecutive double periods)
      let subjectCountOnDay = 0;
      let consecutivePossible = false;

      for (let p = 1; p <= 7; p++) {
        const scheduled = classSchedule[lesson.classId][day][p];
        if (scheduled && scheduled.subject === lesson.subject) {
          subjectCountOnDay++;
          // Check if it's consecutive to candidate period
          if (Math.abs(p - period) === 1) {
            consecutivePossible = true;
          }
        }
      }

      const isConsecutiveSubject = ["美勞", "自然", "電腦", "音樂"].includes(lesson.subject);

      if (subjectCountOnDay > 0) {
        if (preferConsecutiveSpecial && isConsecutiveSubject && consecutivePossible) {
          score += 60; // Highly encourage consecutive special lessons (double periods)
        } else {
          score -= 80; // Strongly penalize splitting the same subject on the same day
        }
      }

      // H4: Spreading teacher load: Prefer scheduling lessons spread across days
      let teacherLoadOnDay = 0;
      for (let p = 1; p <= 7; p++) {
        if (teacherSchedule[lesson.teacherId][day][p] !== null) {
          teacherLoadOnDay++;
        }
      }
      // If teacher already teaches 4 periods on this day, prefer other days
      if (teacherLoadOnDay >= 4) {
        score -= 20;
      }

      cand.score = score;
    });

    // Sort by score descending (highest score first)
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Backtracking DFS solver
   */
  function solve(lessonIndex) {
    backtrackCount++;
    
    if (backtrackCount > maxBacktracks) {
      throw new Error(`ExceededMaxBacktracks`);
    }

    // Success condition: all lessons scheduled
    if (lessonIndex === lessons.length) {
      return true;
    }

    const lesson = lessons[lessonIndex];
    const candidateSlots = getSortedSlotsForLesson(lesson);

    for (let i = 0; i < candidateSlots.length; i++) {
      const { day, period } = candidateSlots[i];

      if (isValid(lesson, day, period)) {
        // Apply assignment
        classSchedule[lesson.classId][day][period] = lesson;
        teacherSchedule[lesson.teacherId][day][period] = lesson.classId;
        if (lesson.requiresRoom) {
          roomUsage[lesson.requiresRoom][day][period]++;
        }

        // Recurse to next lesson
        try {
          if (solve(lessonIndex + 1)) {
            return true;
          }
        } catch (err) {
          if (err.message === 'ExceededMaxBacktracks') throw err;
        }

        // Backtrack
        classSchedule[lesson.classId][day][period] = null;
        teacherSchedule[lesson.teacherId][day][period] = null;
        if (lesson.requiresRoom) {
          roomUsage[lesson.requiresRoom][day][period]--;
        }
      }
    }

    return false; // Backtrack trigger
  }

  // 6. Run the solver
  try {
    const success = solve(0);
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(3);

    if (success) {
      logCallback(`[Engine] 🎉 恭喜！排課成功！`);
      logCallback(`[Engine] 耗時: ${duration} 秒`);
      logCallback(`[Engine] 遞迴回溯次數: ${backtrackCount}`);
      
      // Format output schedule
      // We convert classSchedule to output format: { classId: { "day-period": { subject, teacherId, requiresRoom } } }
      const finalSchedule = {};
      classes.forEach(c => {
        finalSchedule[c.id] = {};
        for (let day = 1; day <= 5; day++) {
          for (let period = 1; period <= 7; period++) {
            const lesson = classSchedule[c.id][day][period];
            if (lesson) {
              finalSchedule[c.id][`${day}-${period}`] = {
                subject: lesson.subject,
                teacherId: lesson.teacherId,
                requiresRoom: lesson.requiresRoom
              };
            }
          }
        }
      });

      return finalSchedule;
    } else {
      logCallback(`[Engine] ❌ 無解。在最大限制次數內找不到符合所有硬性約束的排課方案。`);
      logCallback(`[Engine] 遞迴回溯次數: ${backtrackCount}`);
      return null;
    }
  } catch (err) {
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(3);
    
    if (err.message === 'ExceededMaxBacktracks') {
      logCallback(`[Engine] ❌ 超時/超出回溯上限！回溯次數已達 ${backtrackCount} 次。`);
      logCallback(`[Engine] 耗時: ${duration} 秒。`);
      logCallback(`[Engine] 提示：可能存在以下衝突點：`);
      logCallback(`  1. 某些科任/導師的授課總節數超出其可用授課時段。`);
      logCallback(`  2. 專科教室 (例如電腦教室) 設定了太多配課，在時段限制內排不下。`);
      logCallback(`  3. 教師自訂不可排課時段 (忙碌) 太多，限制了排課空間。`);
      logCallback(`[Engine] 建議：請點擊「線上互動配課」檢查教師負荷，或在排課參數中增加最大回溯上限，或調整不可排課時段。`);
    } else {
      logCallback(`[Engine] ❌ 發生非預期錯誤：${err.message}`);
      console.error(err);
    }
    return null;
  }
}

/**
 * Validates a single manual swap/move in the schedule.
 * Returns { valid: boolean, reason: string | null }
 */
export function validateManualMove(schedule, teachers, classId, fromDay, fromPeriod, toDay, toPeriod, lesson, logCallback = console.log) {
  // 1. Check class level constraints (afternoon limits)
  // Determine grade
  const gradeStr = classId.substring(0, 1);
  const grade = parseInt(gradeStr);
  
  if (isNaN(grade)) return { valid: false, reason: "無效的班級名稱" };

  // Lower Grade Afternoon Limit
  if (grade <= 2 && toPeriod >= 5 && toDay !== 2) {
    return { valid: false, reason: "低年級僅週二下午能排課" };
  }
  // Mid Grade Afternoon Limit
  if (grade >= 3 && grade <= 4 && toPeriod >= 5 && (toDay === 3 || toDay === 5)) {
    return { valid: false, reason: "中年級週三、五下午不能排課" };
  }
  // High Grade Afternoon Limit
  if (grade >= 5 && toPeriod >= 5 && toDay === 3) {
    return { valid: false, reason: "高年級週三下午不能排課" };
  }

  // 2. Check teacher busy slot constraint
  const teacher = teachers.find(t => t.id === lesson.teacherId);
  if (teacher && teacher.busySlots.includes(`${toDay}-${toPeriod}`)) {
    return { valid: false, reason: `教師 ${teacher.name} 在該時段設為忙碌/會議時間` };
  }

  // 3. Check teacher schedule duplicate constraint
  // Check if this teacher is teaching another class in the target (toDay, toPeriod)
  for (const cId in schedule) {
    if (cId === classId) continue; // Skip current class
    const targetCell = schedule[cId][`${toDay}-${toPeriod}`];
    if (targetCell && targetCell.teacherId === lesson.teacherId) {
      return { 
        valid: false, 
        reason: `教師 ${teacher ? teacher.name : lesson.teacherId} 在該時段已經在 ${cId} 班授課` 
      };
    }
  }

  // 4. Check Special Room constraints
  if (lesson.requiresRoom) {
    const limit = SPECIAL_ROOMS[lesson.requiresRoom]?.limit || 1;
    let roomUsageCount = 0;
    
    for (const cId in schedule) {
      if (cId === classId) continue;
      const targetCell = schedule[cId][`${toDay}-${toPeriod}`];
      if (targetCell && targetCell.requiresRoom === lesson.requiresRoom) {
        roomUsageCount++;
      }
    }
    
    if (roomUsageCount >= limit) {
      return { 
        valid: false, 
        reason: `專科教室「${SPECIAL_ROOMS[lesson.requiresRoom]?.name}」在該時段的使用班級已達上限 (${limit} 班)` 
      };
    }
  }

  return { valid: true, reason: null };
}
