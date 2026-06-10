/**
 * 公告报名表字段定义（与政企端配置表、考生端报名表 data-rf 一致）
 */
(function (global) {
    var DEFAULT_FIELDS = [
        { key: 'fillDate', label: '填表日期', showOnCandidate: true, required: false },
        { key: 'appliedJob', label: '报考岗位', showOnCandidate: true, required: true },
        { key: 'name', label: '姓名', showOnCandidate: true, required: true },
        { key: 'gender', label: '性别', showOnCandidate: true, required: false },
        { key: 'ethnicity', label: '民族', showOnCandidate: true, required: false },
        { key: 'birthDate', label: '出生年月', showOnCandidate: true, required: false },
        { key: 'politicalStatus', label: '政治面貌', showOnCandidate: true, required: false },
        { key: 'health', label: '健康状况', showOnCandidate: true, required: false },
        { key: 'hukou', label: '户籍所在地', showOnCandidate: true, required: false },
        { key: 'idNumber', label: '身份证号', showOnCandidate: true, required: true },
        { key: 'education', label: '学历', showOnCandidate: true, required: false },
        { key: 'major', label: '专业', showOnCandidate: true, required: false },
        { key: 'degree', label: '学位', showOnCandidate: true, required: false },
        { key: 'graduationSchool', label: '毕业院校及时间', showOnCandidate: true, required: false },
        { key: 'landline', label: '固定电话', showOnCandidate: true, required: false },
        { key: 'specialties', label: '何种特长', showOnCandidate: true, required: false },
        { key: 'mobile', label: '手机号码', showOnCandidate: true, required: true },
        { key: 'englishLevel', label: '英语等级', showOnCandidate: true, required: false },
        { key: 'mailAddress', label: '通信地址', showOnCandidate: true, required: false },
        { key: 'meetsJobExperience', label: '是否符合岗位工作经验', showOnCandidate: true, required: false },
        { key: 'techQualification', label: '专业技术资格', showOnCandidate: true, required: false },
        { key: 'vocationalQualification', label: '职(执)业资格', showOnCandidate: true, required: false },
        { key: 'birthPlace', label: '出生地', showOnCandidate: true, required: false },
        { key: 'workStart', label: '参加工作时间', showOnCandidate: true, required: false },
        { key: 'partyJoin', label: '入党时间', showOnCandidate: true, required: false },
        { key: 'workUnit', label: '工作单位', showOnCandidate: true, required: false },
        { key: 'currentPosition', label: '现任岗位及等级', showOnCandidate: true, required: false },
        { key: 'applyUnit', label: '报考单位', showOnCandidate: true, required: false },
        { key: 'positionCode', label: '岗位代码', showOnCandidate: true, required: false },
        { key: 'email', label: '电子邮箱', showOnCandidate: true, required: false },
        { key: 'resumeDetail', label: '简历（工作学习经历详述）', showOnCandidate: true, required: false },
        { key: 'eduExpText', label: '学习经历（按行填写）', showOnCandidate: false, required: false },
        { key: 'workExpText', label: '工作经历（按行填写）', showOnCandidate: false, required: false },
        { key: 'universityAwards', label: '大学期间奖惩和处分', showOnCandidate: true, required: false },
        { key: 'familySection', label: '家庭成员及主要社会关系', showOnCandidate: true, required: false },
        { key: 'candidatePhoto', label: '寸照（报名表用）', showOnCandidate: true, required: false },
        { key: 'resumeAttachment', label: '随本次申请附加简历', showOnCandidate: true, required: false },
        { key: 'attachmentsSection', label: '附件上传（寸照/身份证等）', showOnCandidate: true, required: false },
        { key: 'signatureSection', label: '本人承诺与签字', showOnCandidate: true, required: true }
    ];

    function cloneField(f) {
        return { key: f.key, label: f.label, showOnCandidate: !!f.showOnCandidate, required: !!f.required };
    }

    /**
     * 合并公告 extraJson.registrationFormSchema 与默认项
     */
    function normalizeFromExtra(extra) {
        var ex = extra && typeof extra === 'object' ? extra : {};
        var saved = ex.registrationFormSchema && ex.registrationFormSchema.fields;
        var map = {};
        if (Array.isArray(saved)) {
            saved.forEach(function (s) {
                if (s && s.key) map[s.key] = s;
            });
        }
        return DEFAULT_FIELDS.map(function (d) {
            var o = map[d.key];
            if (o) {
                return {
                    key: d.key,
                    label: d.label,
                    showOnCandidate: o.showOnCandidate !== false,
                    required: !!o.required
                };
            }
            return cloneField(d);
        });
    }

    function toPayloadFields(list) {
        return (list || []).map(function (f) {
            return {
                key: f.key,
                label: f.label,
                showOnCandidate: !!f.showOnCandidate,
                required: !!f.required
            };
        });
    }

    global.RegistrationFormSchema = {
        DEFAULT_FIELDS: DEFAULT_FIELDS,
        normalizeFromExtra: normalizeFromExtra,
        toPayloadFields: toPayloadFields
    };
})(window);
