/**
 * 考生管理「按批次从企业导入考生」：必须从人才网 3001 拉取待导入批次，否则会显示「暂无待导入的批次数据」。
 * 使用方式：在打开「按批次从企业导入」弹窗时调用 getExamImportBatches(enterpriseId)，用返回的列表渲染批次下拉框。
 * 入参 enterpriseId 可从 URL 参数 enterprise_id 或登录态获取。
 */
(function () {
  function getEnterpriseId() {
    try {
      var p = new URLSearchParams(window.location.search || '');
      var id = p.get('enterprise_id') || p.get('enterpriseId');
      if (id) return String(id).trim();
    } catch (e) {}
    try {
      var stored = localStorage.getItem('enterprise_id') || localStorage.getItem('enterpriseId');
      if (stored) return String(stored).trim();
    } catch (e) {}
    return null;
  }

  async function getExamImportBatches(enterpriseId) {
    enterpriseId = enterpriseId != null ? String(enterpriseId).trim() : getEnterpriseId();
    if (window.auth && typeof window.auth.fetchImportBatches === 'function') {
      return window.auth.fetchImportBatches(enterpriseId);
    }
    var base = (window.auth && typeof window.auth.getTalentApiBase === 'function')
      ? window.auth.getTalentApiBase()
      : (window.location.origin || 'http://127.0.0.1:3001');
    var url = base + '/api/v1/exam-imports/batches';
    if (enterpriseId) url += '?sourceCompanyId=' + encodeURIComponent(enterpriseId) + '&enterpriseId=' + encodeURIComponent(enterpriseId);
    try {
      var res = await fetch(url, { method: 'GET', cache: 'no-cache' });
      var json = await res.json().catch(function () { return {}; });
      if (json && json.success && Array.isArray(json.data)) return json.data;
      // 兜底：与笔试后端标准路径一致（需携带与页面相同的登录态，如 Cookie 或 Authorization）
      var url2 = base + '/api/exam-imports/batches' + (enterpriseId ? '?sourceCompanyId=' + encodeURIComponent(enterpriseId) + '&enterpriseId=' + encodeURIComponent(enterpriseId) : '');
      var res2 = await fetch(url2, { method: 'GET', cache: 'no-cache' });
      var json2 = await res2.json().catch(function () { return {}; });
      return (json2 && json2.success && Array.isArray(json2.data)) ? json2.data : [];
    } catch (e) {
      console.warn('拉取待导入批次失败:', e && e.message);
      return [];
    }
  }

  window.getExamImportBatches = getExamImportBatches;
  window.getEnterpriseIdForExamImport = getEnterpriseId;
})();
