/** 考生 token 存 sessionStorage；兼容历史写入的 localStorage */
export function getExamStudentToken() {
  try {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('exam_student_token') || localStorage.getItem('exam_student_token');
  } catch (e) {
    return null;
  }
}
