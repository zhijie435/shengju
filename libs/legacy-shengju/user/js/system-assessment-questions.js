/**
 * 系统测试包题目数据：专业抗压能力、性格测试、智力测试
 * 各约 50 题，结构 { id, text, options: [{ value, text }] }
 * 抗压题可选 dimension；智力题可选 correct 表示正确答案。
 */
(function (global) {
  'use strict';

  // 专业抗压能力：维度 emotion=情绪调节, workload=工作负荷, recovery=挫折恢复, time=时间压力, social=人际压力
  // 选项 value 1-5 表示程度（1=非常不符合，5=非常符合），正向题高分好，反向题在计分时反转
  var STRESS_QUESTIONS = [
    { id: 1, dimension: 'emotion', text: '当工作出现突发问题时，我能较快地平静下来并理性处理。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 2, dimension: 'workload', text: '我能够同时处理多项任务而不感到过度疲惫。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 3, dimension: 'recovery', text: '遭遇失败或批评后，我能在较短时间内调整心态继续努力。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 4, dimension: 'time', text: '在截止日期临近时，我仍能保持效率而不慌乱。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 5, dimension: 'social', text: '与难相处的同事或客户沟通时，我能控制情绪并专业应对。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 6, dimension: 'emotion', text: '我经常因为小事就感到焦虑或烦躁。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 7, dimension: 'workload', text: '工作量突然增加时，我能够合理规划并按时完成。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 8, dimension: 'recovery', text: '遇到挫折时，我容易长时间陷入消极情绪。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 9, dimension: 'time', text: '我善于将大任务分解并按计划推进。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 10, dimension: 'social', text: '在冲突或分歧中，我能够冷静表达自己的观点。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 11, dimension: 'emotion', text: '我能识别自己的情绪波动并主动调节。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 12, dimension: 'workload', text: '持续高强度工作一段时间后，我仍能保持专注。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 13, dimension: 'recovery', text: '从失败中我能总结教训并改进下一次表现。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 14, dimension: 'time', text: '我经常因拖延而在最后时刻赶工。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 15, dimension: 'social', text: '面对他人否定或质疑时，我能保持自信并理性回应。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 16, dimension: 'emotion', text: '压力大时，我会通过运动、休息或爱好来放松。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 17, dimension: 'workload', text: '当任务超出能力范围时，我会主动寻求支持或沟通。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 18, dimension: 'recovery', text: '被领导或客户批评后，我会反思改进而非一味沮丧。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 19, dimension: 'time', text: '我能区分事情的轻重缓急并优先处理重要事项。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 20, dimension: 'social', text: '在团队合作中遇到分歧时，我倾向于回避冲突。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 21, dimension: 'emotion', text: '我经常在睡前反复想工作上的事导致难以入睡。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 22, dimension: 'workload', text: '在多项紧急任务同时出现时，我能有条理地逐一处理。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 23, dimension: 'recovery', text: '项目失败或目标未达成时，我能较快设定新的计划。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 24, dimension: 'time', text: '我习惯为重要工作预留缓冲时间以应对意外。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 25, dimension: 'social', text: '面对不合理的要求或指责，我能够坚定而礼貌地表达边界。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 26, dimension: 'emotion', text: '我能接受自己的不足并在压力下仍保持一定自信。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 27, dimension: 'workload', text: '长时间加班或连续出差会明显影响我的状态。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 28, dimension: 'recovery', text: '我会把过去的失败当作成长机会而非心理负担。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 29, dimension: 'time', text: '我经常感到时间不够用且无法兼顾所有事项。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 30, dimension: 'social', text: '在需要说服或拒绝他人时，我能够清晰表达而不伤和气。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 31, dimension: 'emotion', text: '遇到突发变故时，我的第一反应是冷静分析而非情绪化。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 32, dimension: 'workload', text: '我能够在不影响质量的前提下适当拒绝额外任务。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 33, dimension: 'recovery', text: '经历重大挫折后，我能在几周内恢复到正常的工作状态。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 34, dimension: 'time', text: '我会定期回顾时间使用情况并优化安排。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 35, dimension: 'social', text: '在公开场合被质疑或批评时，我容易紧张或激动。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 36, dimension: 'emotion', text: '我有一套固定的方式（如深呼吸、短暂休息）来缓解紧张。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 37, dimension: 'workload', text: '面对模糊或不断变化的需求，我仍能稳步推进工作。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 38, dimension: 'recovery', text: '我会主动从他人或书籍中学习应对挫折的方法。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 39, dimension: 'time', text: '我能准确估计完成任务所需时间并据此承诺。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 40, dimension: 'social', text: '与上级或权威人物沟通时，我能够自然表达想法。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 41, dimension: 'emotion', text: '工作与生活发生冲突时，我能做出取舍而不长期内疚。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 42, dimension: 'workload', text: '在资源或信息不足的情况下，我仍能尽力完成关键目标。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 43, dimension: 'recovery', text: '我会设定小目标来逐步重建信心而非一次追求完美。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 44, dimension: 'time', text: '我经常因临时插进来的事情打乱原计划。', options: [
      { value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }
    ]},
    { id: 45, dimension: 'social', text: '在需要协作的项目中，我能处理好不同意见并推动共识。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 46, dimension: 'emotion', text: '面对不确定的结果，我能够接受风险并专注当下能控的部分。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 47, dimension: 'workload', text: '我会在任务间隙安排短暂休息以保持状态。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 48, dimension: 'recovery', text: '遭遇不公平对待时，我会寻求合理途径解决而非长期抱怨。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 49, dimension: 'time', text: '我能平衡好短期紧急事项与长期重要目标。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]},
    { id: 50, dimension: 'social', text: '在高压或冲突情境下，我仍能倾听对方并寻求共赢方案。', options: [
      { value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }
    ]}
  ];

  // 性格测试：MBTI 四维度 E-I, S-N, T-F, J-P，每题选项 value 为维度字母
  var PERSONALITY_QUESTIONS = [
    { id: 1, text: '在社交场合中，你通常更喜欢：', options: [{ value: 'E', text: 'A. 主动与他人交流，认识新朋友' }, { value: 'I', text: 'B. 与熟悉的人交流，保持安静' }]},
    { id: 2, text: '你更倾向于：', options: [{ value: 'S', text: 'A. 关注具体的事实和细节' }, { value: 'N', text: 'B. 关注抽象的概念和可能性' }]},
    { id: 3, text: '在做决策时，你更依赖：', options: [{ value: 'T', text: 'A. 逻辑和客观分析' }, { value: 'F', text: 'B. 个人价值观和情感考虑' }]},
    { id: 4, text: '你更喜欢：', options: [{ value: 'J', text: 'A. 有计划、有组织的生活方式' }, { value: 'P', text: 'B. 灵活、即兴的生活方式' }]},
    { id: 5, text: '当你遇到问题时，你通常会：', options: [{ value: 'S', text: 'A. 回顾过去的经验寻找解决方案' }, { value: 'N', text: 'B. 思考新的可能性和创新方法' }]},
    { id: 6, text: '在团队中，你更擅长：', options: [{ value: 'J', text: 'A. 组织和协调团队工作' }, { value: 'P', text: 'B. 适应变化并灵活应对' }]},
    { id: 7, text: '你更喜欢的工作环境是：', options: [{ value: 'E', text: 'A. 充满活力和互动的环境' }, { value: 'I', text: 'B. 安静和专注的环境' }]},
    { id: 8, text: '在做决定时，你更看重：', options: [{ value: 'T', text: 'A. 公平和客观的标准' }, { value: 'F', text: 'B. 和谐和人际关系' }]},
    { id: 9, text: '周末你更愿意：', options: [{ value: 'E', text: 'A. 参加聚会或户外活动' }, { value: 'I', text: 'B. 在家读书或独处休息' }]},
    { id: 10, text: '学习新东西时，你更喜欢：', options: [{ value: 'S', text: 'A. 按步骤和实例学习' }, { value: 'N', text: 'B. 先理解整体概念再细化' }]},
    { id: 11, text: '当朋友向你诉苦时，你更可能：', options: [{ value: 'T', text: 'A. 分析问题并给出建议' }, { value: 'F', text: 'B. 先表达理解和安慰' }]},
    { id: 12, text: '旅行时你倾向于：', options: [{ value: 'J', text: 'A. 提前做好行程和预订' }, { value: 'P', text: 'B. 随性而行，临时决定' }]},
    { id: 13, text: '在会议上你通常：', options: [{ value: 'E', text: 'A. 积极发言、表达想法' }, { value: 'I', text: 'B. 先倾听，想清楚再说' }]},
    { id: 14, text: '你更相信：', options: [{ value: 'S', text: 'A. 实践出真知' }, { value: 'N', text: 'B. 直觉和灵感' }]},
    { id: 15, text: '评价他人时你更注重：', options: [{ value: 'T', text: 'A. 能力和结果' }, { value: 'F', text: 'B. 动机和感受' }]},
    { id: 16, text: '你的书桌或工作区通常：', options: [{ value: 'J', text: 'A. 整洁有序' }, { value: 'P', text: 'B. 随用随放，稍显凌乱' }]},
    { id: 17, text: '结识新朋友时你更常：', options: [{ value: 'E', text: 'A. 主动打招呼并展开话题' }, { value: 'I', text: 'B. 等别人先开口或被动回应' }]},
    { id: 18, text: '你更擅长：', options: [{ value: 'S', text: 'A. 记住具体数据和细节' }, { value: 'N', text: 'B. 把握整体模式和趋势' }]},
    { id: 19, text: '当规则与人情冲突时，你更可能：', options: [{ value: 'T', text: 'A. 坚持规则和原则' }, { value: 'F', text: 'B. 考虑特殊情况与人情' }]},
    { id: 20, text: '你更喜欢的工作节奏：', options: [{ value: 'J', text: 'A. 按计划推进，有明确节点' }, { value: 'P', text: 'B. 保留弹性，根据进展调整' }]},
    { id: 21, text: '长时间独处后你通常：', options: [{ value: 'E', text: 'A. 渴望与人交流' }, { value: 'I', text: 'B. 感到充实，无需立刻社交' }]},
    { id: 22, text: '描述一件事时你更倾向于：', options: [{ value: 'S', text: 'A. 具体、按时间或步骤' }, { value: 'N', text: 'B. 概括、比喻或联想' }]},
    { id: 23, text: '批评别人时你更注重：', options: [{ value: 'T', text: 'A. 对事不对人，讲清道理' }, { value: 'F', text: 'B. 注意方式，避免伤害对方' }]},
    { id: 24, text: '截止日期对你来说：', options: [{ value: 'J', text: 'A. 必须严格遵守' }, { value: 'P', text: 'B. 重要但可酌情调整' }]},
    { id: 25, text: '在陌生环境中你通常：', options: [{ value: 'E', text: 'A. 很快能与周围的人搭上话' }, { value: 'I', text: 'B. 先观察再慢慢融入' }]},
    { id: 26, text: '你更信任：', options: [{ value: 'S', text: 'A. 已被验证的经验和数据' }, { value: 'N', text: 'B. 新的理论和可能性' }]},
    { id: 27, text: '团队做决定时你更关注：', options: [{ value: 'T', text: 'A. 哪种方案更合理有效' }, { value: 'F', text: 'B. 大家是否都能接受' }]},
    { id: 28, text: '你的日程安排通常：', options: [{ value: 'J', text: 'A. 比较固定，少有变动' }, { value: 'P', text: 'B. 经常随情况改变' }]},
    { id: 29, text: '电话或视频会议相比邮件你：', options: [{ value: 'E', text: 'A. 更喜欢，沟通更直接' }, { value: 'I', text: 'B. 更喜欢邮件，可深思熟虑' }]},
    { id: 30, text: '你更擅长：', options: [{ value: 'S', text: 'A. 执行既定方案' }, { value: 'N', text: 'B. 提出新想法和方案' }]},
    { id: 31, text: '当别人情绪激动时你更可能：', options: [{ value: 'T', text: 'A. 先等对方冷静再谈' }, { value: 'F', text: 'B. 先表达关心再谈事情' }]},
    { id: 32, text: '你更认同：', options: [{ value: 'J', text: 'A. 凡事预则立' }, { value: 'P', text: 'B. 船到桥头自然直' }]},
    { id: 33, text: '聚会结束后你通常：', options: [{ value: 'E', text: 'A. 仍有余兴，不觉得累' }, { value: 'I', text: 'B. 需要独处恢复精力' }]},
    { id: 34, text: '你更关注：', options: [{ value: 'S', text: 'A. 当前正在发生的事' }, { value: 'N', text: 'B. 未来的可能和意义' }]},
    { id: 35, text: '你更在意自己：', options: [{ value: 'T', text: 'A. 是否公正、有逻辑' }, { value: 'F', text: 'B. 是否体贴、有人情味' }]},
    { id: 36, text: '生活节奏你更喜欢：', options: [{ value: 'J', text: 'A. 有规律、可预期' }, { value: 'P', text: 'B. 有变化、有惊喜' }]},
    { id: 37, text: '在小组讨论中你更常：', options: [{ value: 'E', text: 'A. 边想边说，通过说理清思路' }, { value: 'I', text: 'B. 想好再说，避免说错' }]},
    { id: 38, text: '你更擅长：', options: [{ value: 'S', text: 'A. 手工或操作类任务' }, { value: 'N', text: 'B. 构思或策略类任务' }]},
    { id: 39, text: '你更看重领导：', options: [{ value: 'T', text: 'A. 能力强、决策果断' }, { value: 'F', text: 'B. 体贴下属、有人情味' }]},
    { id: 40, text: '你更倾向于：', options: [{ value: 'J', text: 'A. 早做决定，然后执行' }, { value: 'P', text: 'B. 保留选项，最后一刻再定' }]},
    { id: 41, text: '你更愿意被形容为：', options: [{ value: 'E', text: 'A. 开朗、善于交际' }, { value: 'I', text: 'B. 沉稳、善于思考' }]},
    { id: 42, text: '学习时你更喜欢：', options: [{ value: 'S', text: 'A. 具体案例和练习' }, { value: 'N', text: 'B. 理论和框架' }]},
    { id: 43, text: '你更认同：', options: [{ value: 'T', text: 'A. 真理比和谐更重要' }, { value: 'F', text: 'B. 和谐比真理更重要' }]},
    { id: 44, text: '你更常：', options: [{ value: 'J', text: 'A. 提前到达约定地点' }, { value: 'P', text: 'B. 踩点或略晚到' }]},
    { id: 45, text: '在人群中你更常感到：', options: [{ value: 'E', text: 'A. 精力充沛' }, { value: 'I', text: 'B. 消耗精力' }]},
    { id: 46, text: '你更相信：', options: [{ value: 'S', text: 'A. 眼见为实' }, { value: 'N', text: 'B. 透过现象看本质' }]},
    { id: 47, text: '你更在意：', options: [{ value: 'T', text: 'A. 说得对不对' }, { value: 'F', text: 'B. 说得是否得体' }]},
    { id: 48, text: '你更习惯：', options: [{ value: 'J', text: 'A. 先工作后娱乐' }, { value: 'P', text: 'B. 边做边玩、穿插进行' }]},
    { id: 49, text: '你更愿意：', options: [{ value: 'E', text: 'A. 拓宽人脉、多认识人' }, { value: 'I', text: 'B. 深化少数知己的关系' }]},
    { id: 50, text: '面对新任务你更常：', options: [{ value: 'S', text: 'A. 先看有没有现成做法' }, { value: 'N', text: 'B. 先想有没有更好做法' }]}
  ];

  // 智力测试：逻辑、数字、语言，每题有 correct 正确答案（选项 value 为 A/B/C/D）
  var INTELLIGENCE_QUESTIONS = [
    { id: 1, dimension: 'logical', text: '如果所有的 A 都是 B，所有的 B 都是 C，那么所有的 A 一定是 C。这句话：', options: [{ value: 'A', text: 'A. 正确' }, { value: 'B', text: 'B. 错误' }, { value: 'C', text: 'C. 无法判断' }], correct: 'A' },
    { id: 2, dimension: 'number', text: '2, 4, 8, 16, 下一个数是几？', options: [{ value: 'A', text: 'A. 24' }, { value: 'B', text: 'B. 32' }, { value: 'C', text: 'C. 18' }, { value: 'D', text: 'D. 20' }], correct: 'B' },
    { id: 3, dimension: 'verbal', text: '“勤奋”与“懒惰”的关系，类似于“节约”与：', options: [{ value: 'A', text: 'A. 浪费' }, { value: 'B', text: 'B. 吝啬' }, { value: 'C', text: 'C. 节俭' }, { value: 'D', text: 'D. 奢侈' }], correct: 'A' },
    { id: 4, dimension: 'logical', text: '甲比乙高，乙比丙高，则：', options: [{ value: 'A', text: 'A. 甲最高' }, { value: 'B', text: 'B. 丙最高' }, { value: 'C', text: 'C. 无法确定' }], correct: 'A' },
    { id: 5, dimension: 'number', text: '3 + 6 × 2 - 4 ÷ 2 = ?', options: [{ value: 'A', text: 'A. 10' }, { value: 'B', text: 'B. 13' }, { value: 'C', text: 'C. 8' }, { value: 'D', text: 'D. 11' }], correct: 'B' },
    { id: 6, dimension: 'verbal', text: '“医生”与“病人”的关系，类似于“教师”与：', options: [{ value: 'A', text: 'A. 学校' }, { value: 'B', text: 'B. 学生' }, { value: 'C', text: 'C. 课本' }, { value: 'D', text: 'D. 教室' }], correct: 'B' },
    { id: 7, dimension: 'logical', text: '有些猫是黑色的，小白是一只猫。小白是黑色的吗？', options: [{ value: 'A', text: 'A. 是' }, { value: 'B', text: 'B. 否' }, { value: 'C', text: 'C. 无法确定' }], correct: 'C' },
    { id: 8, dimension: 'number', text: '1, 1, 2, 3, 5, 8, 下一个数是？', options: [{ value: 'A', text: 'A. 11' }, { value: 'B', text: 'B. 12' }, { value: 'C', text: 'C. 13' }, { value: 'D', text: 'D. 14' }], correct: 'C' },
    { id: 9, dimension: 'verbal', text: '与“犹豫”意思最相反的是：', options: [{ value: 'A', text: 'A. 果断' }, { value: 'B', text: 'B. 迟疑' }, { value: 'C', text: 'C. 思考' }, { value: 'D', text: 'D. 缓慢' }], correct: 'A' },
    { id: 10, dimension: 'logical', text: 'A 在 B 左边，B 在 C 左边，则 A 在 C 的：', options: [{ value: 'A', text: 'A. 左边' }, { value: 'B', text: 'B. 右边' }, { value: 'C', text: 'C. 无法确定' }], correct: 'A' },
    { id: 11, dimension: 'number', text: '一个数加上它的 50% 等于 45，这个数是：', options: [{ value: 'A', text: 'A. 30' }, { value: 'B', text: 'B. 25' }, { value: 'C', text: 'C. 35' }, { value: 'D', text: 'D. 20' }], correct: 'A' },
    { id: 12, dimension: 'verbal', text: '“笔”用于“写字”，那么“刀”用于：', options: [{ value: 'A', text: 'A. 切割' }, { value: 'B', text: 'B. 锋利' }, { value: 'C', text: 'C. 厨房' }, { value: 'D', text: 'D. 工具' }], correct: 'A' },
    { id: 13, dimension: 'logical', text: '若“下雨则地湿”，现在地湿了，能推出下雨了吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }, { value: 'C', text: 'C. 不一定' }], correct: 'B' },
    { id: 14, dimension: 'number', text: '12 的 25% 是 6 的百分之几？', options: [{ value: 'A', text: 'A. 25%' }, { value: 'B', text: 'B. 50%' }, { value: 'C', text: 'C. 75%' }, { value: 'D', text: 'D. 100%' }], correct: 'B' },
    { id: 15, dimension: 'verbal', text: '“炎热”与“寒冷”的关系，类似于“光明”与：', options: [{ value: 'A', text: 'A. 黑暗' }, { value: 'B', text: 'B. 明亮' }, { value: 'C', text: 'C. 温暖' }, { value: 'D', text: 'D. 太阳' }], correct: 'A' },
    { id: 16, dimension: 'logical', text: '所有鸟都会飞，企鹅是鸟。企鹅会飞吗？', options: [{ value: 'A', text: 'A. 会' }, { value: 'B', text: 'B. 不会' }, { value: 'C', text: 'C. 前提矛盾，无法推理' }], correct: 'C' },
    { id: 17, dimension: 'number', text: '2, 6, 12, 20, 30, 下一个数是？', options: [{ value: 'A', text: 'A. 40' }, { value: 'B', text: 'B. 42' }, { value: 'C', text: 'C. 44' }, { value: 'D', text: 'D. 36' }], correct: 'B' },
    { id: 18, dimension: 'verbal', text: '“成功”与“失败”的关系，类似于“健康”与：', options: [{ value: 'A', text: 'A. 疾病' }, { value: 'B', text: 'B. 运动' }, { value: 'C', text: 'C. 医院' }, { value: 'D', text: 'D. 医生' }], correct: 'A' },
    { id: 19, dimension: 'logical', text: '只有 A 才 B，现在发生了 B，能推出 A 吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }, { value: 'C', text: 'C. 不一定' }], correct: 'A' },
    { id: 20, dimension: 'number', text: '一个班级 60 人，男生占 40%，女生多少人？', options: [{ value: 'A', text: 'A. 24' }, { value: 'B', text: 'B. 36' }, { value: 'C', text: 'C. 30' }, { value: 'D', text: 'D. 20' }], correct: 'B' },
    { id: 21, dimension: 'verbal', text: '与“虚伪”意思最接近的是：', options: [{ value: 'A', text: 'A. 真诚' }, { value: 'B', text: 'B. 做作' }, { value: 'C', text: 'C. 直接' }, { value: 'D', text: 'D. 简单' }], correct: 'B' },
    { id: 22, dimension: 'logical', text: '如果 P 则 Q；非 Q。能推出非 P 吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }], correct: 'A' },
    { id: 23, dimension: 'number', text: '5, 10, 20, 40, 下一个数是？', options: [{ value: 'A', text: 'A. 60' }, { value: 'B', text: 'B. 70' }, { value: 'C', text: 'C. 80' }, { value: 'D', text: 'D. 50' }], correct: 'C' },
    { id: 24, dimension: 'verbal', text: '“书籍”与“知识”的关系，类似于“食物”与：', options: [{ value: 'A', text: 'A. 营养' }, { value: 'B', text: 'B. 饥饿' }, { value: 'C', text: 'C. 餐厅' }, { value: 'D', text: 'D. 厨师' }], correct: 'A' },
    { id: 25, dimension: 'logical', text: '三个人中一人说真话两人说假话。甲说：乙在说谎。乙说：丙在说谎。丙说：甲在说谎。谁在说真话？', options: [{ value: 'A', text: 'A. 甲' }, { value: 'B', text: 'B. 乙' }, { value: 'C', text: 'C. 丙' }, { value: 'D', text: 'D. 无法确定' }], correct: 'B' },
    { id: 26, dimension: 'number', text: '100 - 8×7 + 6 = ?', options: [{ value: 'A', text: 'A. 50' }, { value: 'B', text: 'B. 54' }, { value: 'C', text: 'C. 58' }, { value: 'D', text: 'D. 62' }], correct: 'A' },
    { id: 27, dimension: 'verbal', text: '“开始”与“结束”的关系，类似于“出生”与：', options: [{ value: 'A', text: 'A. 死亡' }, { value: 'B', text: 'B. 成长' }, { value: 'C', text: 'C. 生命' }, { value: 'D', text: 'D. 年龄' }], correct: 'A' },
    { id: 28, dimension: 'logical', text: '有些 A 是 B，有些 B 是 C。能推出有些 A 是 C 吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }, { value: 'C', text: 'C. 不一定' }], correct: 'B' },
    { id: 29, dimension: 'number', text: '一个数乘以 4 再加 10 等于 50，这个数是：', options: [{ value: 'A', text: 'A. 10' }, { value: 'B', text: 'B. 12' }, { value: 'C', text: 'C. 15' }, { value: 'D', text: 'D. 8' }], correct: 'A' },
    { id: 30, dimension: 'verbal', text: '与“扩大”意思最相反的是：', options: [{ value: 'A', text: 'A. 缩小' }, { value: 'B', text: 'B. 增加' }, { value: 'C', text: 'C. 扩展' }, { value: 'D', text: 'D. 放大' }], correct: 'A' },
    { id: 31, dimension: 'logical', text: '红、黄、蓝三人，一人穿红，一人穿黄，一人穿蓝。红说：我穿红。黄说：红穿蓝。蓝说：我穿黄。只有一人说真话。谁穿红？', options: [{ value: 'A', text: 'A. 红' }, { value: 'B', text: 'B. 黄' }, { value: 'C', text: 'C. 蓝' }, { value: 'D', text: 'D. 无法确定' }], correct: 'C' },
    { id: 32, dimension: 'number', text: '1, 4, 9, 16, 25, 下一个数是？', options: [{ value: 'A', text: 'A. 30' }, { value: 'B', text: 'B. 32' }, { value: 'C', text: 'C. 36' }, { value: 'D', text: 'D. 49' }], correct: 'C' },
    { id: 33, dimension: 'verbal', text: '“老师”与“学生”的关系，类似于“医生”与：', options: [{ value: 'A', text: 'A. 病人' }, { value: 'B', text: 'B. 医院' }, { value: 'C', text: 'C. 护士' }, { value: 'D', text: 'D. 手术' }], correct: 'A' },
    { id: 34, dimension: 'logical', text: '所有 M 都是 P，有些 S 是 M。能推出有些 S 是 P 吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }], correct: 'A' },
    { id: 35, dimension: 'number', text: '一件商品打 8 折后 80 元，原价多少？', options: [{ value: 'A', text: 'A. 96' }, { value: 'B', text: 'B. 100' }, { value: 'C', text: 'C. 104' }, { value: 'D', text: 'D. 64' }], correct: 'B' },
    { id: 36, dimension: 'verbal', text: '“快速”与“缓慢”的关系，类似于“简单”与：', options: [{ value: 'A', text: 'A. 复杂' }, { value: 'B', text: 'B. 容易' }, { value: 'C', text: 'C. 困难' }, { value: 'D', text: 'D. 轻松' }], correct: 'A' },
    { id: 37, dimension: 'logical', text: '若 A 或 B 必有一真，且 A 为假，则：', options: [{ value: 'A', text: 'A. B 必真' }, { value: 'B', text: 'B. B 必假' }, { value: 'C', text: 'C. B 可能真可能假' }], correct: 'A' },
    { id: 38, dimension: 'number', text: '3, 6, 9, 12, 15, 下一个数是？', options: [{ value: 'A', text: 'A. 17' }, { value: 'B', text: 'B. 18' }, { value: 'C', text: 'C. 19' }, { value: 'D', text: 'D. 20' }], correct: 'B' },
    { id: 39, dimension: 'verbal', text: '与“表扬”意思最相反的是：', options: [{ value: 'A', text: 'A. 批评' }, { value: 'B', text: 'B. 赞美' }, { value: 'C', text: 'C. 鼓励' }, { value: 'D', text: 'D. 奖励' }], correct: 'A' },
    { id: 40, dimension: 'logical', text: '甲、乙、丙中有一人偷了东西。甲说：我没偷。乙说：丙偷的。丙说：甲偷的。若只有一人说真话，谁偷了？', options: [{ value: 'A', text: 'A. 甲' }, { value: 'B', text: 'B. 乙' }, { value: 'C', text: 'C. 丙' }, { value: 'D', text: 'D. 无法确定' }], correct: 'A' },
    { id: 41, dimension: 'number', text: '20 是 80 的百分之几？', options: [{ value: 'A', text: 'A. 20%' }, { value: 'B', text: 'B. 25%' }, { value: 'C', text: 'C. 40%' }, { value: 'D', text: 'D. 15%' }], correct: 'B' },
    { id: 42, dimension: 'verbal', text: '“法律”与“秩序”的关系，类似于“教育”与：', options: [{ value: 'A', text: 'A. 知识' }, { value: 'B', text: 'B. 学校' }, { value: 'C', text: 'C. 老师' }, { value: 'D', text: 'D. 学生' }], correct: 'A' },
    { id: 43, dimension: 'logical', text: '没有 A 是 B，有些 C 是 A。能推出有些 C 不是 B 吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }], correct: 'A' },
    { id: 44, dimension: 'number', text: '7 × 8 - 12 ÷ 3 = ?', options: [{ value: 'A', text: 'A. 52' }, { value: 'B', text: 'B. 54' }, { value: 'C', text: 'C. 56' }, { value: 'D', text: 'D. 58' }], correct: 'A' },
    { id: 45, dimension: 'verbal', text: '“同意”与“反对”的关系，类似于“接受”与：', options: [{ value: 'A', text: 'A. 拒绝' }, { value: 'B', text: 'B. 答应' }, { value: 'C', text: 'C. 同意' }, { value: 'D', text: 'D. 采纳' }], correct: 'A' },
    { id: 46, dimension: 'logical', text: '若“只有努力才能成功”为真，小张成功了，能推出小张努力了吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }, { value: 'C', text: 'C. 不一定' }], correct: 'A' },
    { id: 47, dimension: 'number', text: '1, 3, 6, 10, 15, 下一个数是？', options: [{ value: 'A', text: 'A. 18' }, { value: 'B', text: 'B. 20' }, { value: 'C', text: 'C. 21' }, { value: 'D', text: 'D. 22' }], correct: 'C' },
    { id: 48, dimension: 'verbal', text: '与“公开”意思最相反的是：', options: [{ value: 'A', text: 'A. 秘密' }, { value: 'B', text: 'B. 透明' }, { value: 'C', text: 'C. 公布' }, { value: 'D', text: 'D. 开放' }], correct: 'A' },
    { id: 49, dimension: 'logical', text: '所有 P 都是 Q，没有 Q 是 R。能推出没有 P 是 R 吗？', options: [{ value: 'A', text: 'A. 能' }, { value: 'B', text: 'B. 不能' }], correct: 'A' },
    { id: 50, dimension: 'number', text: '一个数减去 15 等于 35，这个数是：', options: [{ value: 'A', text: 'A. 40' }, { value: 'B', text: 'B. 45' }, { value: 'C', text: 'C. 50' }, { value: 'D', text: 'D. 55' }], correct: 'C' }
  ];

  // 职业能力测试：维度 communication=沟通协作, teamwork=团队合作, leadership=领导力, execution=执行与落实, learning=学习与适应
  // 选项 value 1-5，正向题高分好，反向题计分时反转
  var ABILITY_QUESTIONS = [
    { id: 1, dimension: 'communication', text: '我能够清晰、有条理地向他人传达工作要求和目标。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 2, dimension: 'teamwork', text: '在团队中我能够主动配合他人，共同完成目标。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 3, dimension: 'leadership', text: '在需要时我能够带领小组推进任务并做出决策。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 4, dimension: 'execution', text: '我能够将计划转化为具体行动并坚持完成。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 5, dimension: 'learning', text: '面对新知识或新技能，我能够快速学习并应用到工作中。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 6, dimension: 'communication', text: '在会议或讨论中，我经常难以表达清楚自己的观点。', options: [{ value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }] },
    { id: 7, dimension: 'teamwork', text: '当团队出现分歧时，我能够帮助协调并推动共识。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 8, dimension: 'leadership', text: '我善于发现他人的优势并分配适合的任务。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 9, dimension: 'execution', text: '我经常能够提前或按时完成分配给我的任务。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 10, dimension: 'learning', text: '我会主动寻找学习机会以提升工作能力。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 11, dimension: 'communication', text: '我能够耐心倾听他人意见并给予有效反馈。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 12, dimension: 'teamwork', text: '在跨部门合作中，我能够主动沟通、推进进展。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 13, dimension: 'leadership', text: '在资源有限的情况下，我能够合理分配并达成目标。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 14, dimension: 'execution', text: '我容易在任务中途分心或拖延。', options: [{ value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }] },
    { id: 15, dimension: 'learning', text: '遇到不懂的问题时，我会主动查阅资料或请教他人。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 16, dimension: 'communication', text: '我能够根据对象调整表达方式，使对方容易理解。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 17, dimension: 'teamwork', text: '在团队项目中，我能够承担自己的责任并支持队友。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 18, dimension: 'leadership', text: '我能够设定清晰的目标并激励他人一起努力。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 19, dimension: 'execution', text: '我注重细节，能够减少工作中的疏漏。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 20, dimension: 'learning', text: '我能够从失败或反馈中总结教训并改进。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 21, dimension: 'communication', text: '在书面沟通（邮件、报告）中，我能够做到条理清晰。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 22, dimension: 'teamwork', text: '我很少在团队中主动分享信息或资源。', options: [{ value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }] },
    { id: 23, dimension: 'leadership', text: '在紧急情况下，我能够快速做出决策并承担责任。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 24, dimension: 'execution', text: '我能够同时推进多项任务并保证质量。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 25, dimension: 'learning', text: '面对新工具或新流程，我能够较快上手。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 26, dimension: 'communication', text: '在冲突或分歧中，我能够促成双方达成一致。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 27, dimension: 'teamwork', text: '我能够尊重不同背景的同事并与之有效合作。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 28, dimension: 'leadership', text: '我能够给予他人建设性的反馈以帮助其成长。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 29, dimension: 'execution', text: '我会定期检查进度并及时调整计划。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 30, dimension: 'learning', text: '我经常关注行业或岗位相关的新趋势。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 31, dimension: 'communication', text: '向上级汇报时，我能够突出重点、结论明确。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 32, dimension: 'teamwork', text: '在团队目标与个人想法冲突时，我能够以大局为重。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 33, dimension: 'leadership', text: '我倾向于避免承担带领他人的责任。', options: [{ value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }] },
    { id: 34, dimension: 'execution', text: '对于重复性工作，我能够保持稳定输出。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 35, dimension: 'learning', text: '我能够将所学应用到新的工作场景中。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 36, dimension: 'communication', text: '在陌生场合发言或汇报时，我容易紧张或表达不清。', options: [{ value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }] },
    { id: 37, dimension: 'teamwork', text: '我能够主动补位，在队友遇到困难时提供支持。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 38, dimension: 'leadership', text: '我能够为团队营造积极、有序的工作氛围。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 39, dimension: 'execution', text: '我能够识别任务优先级并合理安排时间。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 40, dimension: 'learning', text: '我很少主动学习与当前工作无关但可能对未来有用的技能。', options: [{ value: 5, text: '非常不符合' }, { value: 4, text: '不太符合' }, { value: 3, text: '一般' }, { value: 2, text: '比较符合' }, { value: 1, text: '非常符合' }] },
    { id: 41, dimension: 'communication', text: '我能够用数据或案例支撑自己的观点。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 42, dimension: 'teamwork', text: '在头脑风暴或讨论中，我能够贡献想法并倾听他人。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 43, dimension: 'leadership', text: '在项目遇到阻力时，我能够推动解决并鼓舞士气。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 44, dimension: 'execution', text: '我能够按照规范或标准完成工作，减少返工。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 45, dimension: 'learning', text: '面对变化（如岗位调整、新项目），我能够积极适应。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 46, dimension: 'communication', text: '在跨文化或跨年龄沟通中，我能够保持尊重与有效。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 47, dimension: 'teamwork', text: '我能够清晰界定自己在团队中的角色并履行。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 48, dimension: 'leadership', text: '我能够平衡短期结果与长期发展做出决策。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 49, dimension: 'execution', text: '我能够在资源或信息不完整时仍推进关键节点。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] },
    { id: 50, dimension: 'learning', text: '我能够通过复盘或总结形成可复用的经验。', options: [{ value: 1, text: '非常不符合' }, { value: 2, text: '不太符合' }, { value: 3, text: '一般' }, { value: 4, text: '比较符合' }, { value: 5, text: '非常符合' }] }
  ];

  // 兴趣测试：霍兰德类型 R=实际型 I=研究型 A=艺术型 S=社会型 E=企业型 C=常规型，每题选项 value 为对应字母
  var INTEREST_QUESTIONS = [
    { id: 1, text: '你更愿意花时间在：', options: [{ value: 'R', text: 'A. 动手修理、制作或操作设备' }, { value: 'S', text: 'B. 帮助他人解决问题或提供支持' }] },
    { id: 2, text: '工作中你更喜欢：', options: [{ value: 'I', text: 'A. 独自钻研、分析与实验' }, { value: 'E', text: 'B. 与人打交道、说服或带领他人' }] },
    { id: 3, text: '你更享受：', options: [{ value: 'A', text: 'A. 创作、设计或表达创意' }, { value: 'C', text: 'B. 整理数据、核对与流程化工作' }] },
    { id: 4, text: '周末你更可能：', options: [{ value: 'R', text: 'A. 动手做手工、园艺或运动' }, { value: 'I', text: 'B. 阅读、研究感兴趣的话题' }] },
    { id: 5, text: '你更擅长：', options: [{ value: 'S', text: 'A. 倾听他人、调解矛盾' }, { value: 'E', text: 'B. 制定目标、推动执行与谈判' }] },
    { id: 6, text: '学习时你更喜欢：', options: [{ value: 'A', text: 'A. 通过实践、创作或表演' }, { value: 'C', text: 'B. 通过笔记、清单与系统化步骤' }] },
    { id: 7, text: '你更愿意从事：', options: [{ value: 'R', text: 'A. 机械、技术或户外相关的工作' }, { value: 'S', text: 'B. 教育、护理或服务类工作' }] },
    { id: 8, text: '面对问题你更常：', options: [{ value: 'I', text: 'A. 先分析原因与规律再行动' }, { value: 'E', text: 'B. 先推动行动再边做边调整' }] },
    { id: 9, text: '你更看重工作带来的：', options: [{ value: 'A', text: 'A. 创造性与自我表达' }, { value: 'C', text: 'B. 稳定、清晰与可预期' }] },
    { id: 10, text: '你更喜欢的环境是：', options: [{ value: 'R', text: 'A. 车间、实验室或户外' }, { value: 'S', text: 'B. 学校、医院或社区' }] },
    { id: 11, text: '你更愿意：', options: [{ value: 'I', text: 'A. 深入研究一个专业领域' }, { value: 'E', text: 'B. 负责一个项目或团队' }] },
    { id: 12, text: '你更享受：', options: [{ value: 'A', text: 'A. 写作、绘画、音乐或设计' }, { value: 'C', text: 'B. 整理文件、做表格或归档' }] },
    { id: 13, text: '别人常说你：', options: [{ value: 'R', text: 'A. 动手能力强、踏实' }, { value: 'S', text: 'B. 有耐心、善于沟通' }] },
    { id: 14, text: '你更感兴趣的是：', options: [{ value: 'I', text: 'A. 科学、数学或逻辑推理' }, { value: 'E', text: 'B. 商业、销售或管理' }] },
    { id: 15, text: '你更愿意：', options: [{ value: 'A', text: 'A. 做出与众不同的作品' }, { value: 'C', text: 'B. 保证流程正确、无差错' }] },
    { id: 16, text: '休闲时你更喜欢：', options: [{ value: 'R', text: 'A. 动手做东西、运动或驾驶' }, { value: 'I', text: 'B. 看书、纪录片或解谜' }] },
    { id: 17, text: '在团队中你更常：', options: [{ value: 'S', text: 'A. 关心成员感受、促进协作' }, { value: 'E', text: 'B. 提出目标、分配任务并推进' }] },
    { id: 18, text: '你更擅长：', options: [{ value: 'A', text: 'A. 想象与创意构思' }, { value: 'C', text: 'B. 细节核对与时间管理' }] },
    { id: 19, text: '你更愿意从事：', options: [{ value: 'R', text: 'A. 工程师、技工或农业相关' }, { value: 'A', text: 'B. 设计师、编剧或艺术相关' }] },
    { id: 20, text: '面对新事物你更常：', options: [{ value: 'I', text: 'A. 先搞清原理再动手' }, { value: 'E', text: 'B. 先尝试再总结' }] },
    { id: 21, text: '你更看重：', options: [{ value: 'S', text: 'A. 对他人有正面影响' }, { value: 'C', text: 'B. 秩序、规范与效率' }] },
    { id: 22, text: '你更喜欢：', options: [{ value: 'R', text: 'A. 使用工具、机器或身体活动' }, { value: 'I', text: 'B. 使用理论、数据或实验' }] },
    { id: 23, text: '你更愿意：', options: [{ value: 'A', text: 'A. 表达独特观点或审美' }, { value: 'S', text: 'B. 支持他人成长或解决问题' }] },
    { id: 24, text: '工作中你更在意：', options: [{ value: 'E', text: 'A. 结果、业绩与影响力' }, { value: 'C', text: 'B. 准确、合规与可追溯' }] },
    { id: 25, text: '你更享受：', options: [{ value: 'R', text: 'A. 亲手完成一件具体作品' }, { value: 'I', text: 'B. 弄懂一个复杂问题' }] },
    { id: 26, text: '别人更常找你：', options: [{ value: 'S', text: 'A. 倾诉或寻求建议' }, { value: 'E', text: 'B. 拍板或牵头做事' }] },
    { id: 27, text: '你更愿意花时间在：', options: [{ value: 'A', text: 'A. 创作、排练或打磨作品' }, { value: 'C', text: 'B. 整理、分类与优化流程' }] },
    { id: 28, text: '你更感兴趣的是：', options: [{ value: 'R', text: 'A. 机械、电子或建筑' }, { value: 'S', text: 'B. 心理、教育或医疗' }] },
    { id: 29, text: '你更擅长：', options: [{ value: 'I', text: 'A. 逻辑推理与系统思考' }, { value: 'E', text: 'B. 说服他人与资源整合' }] },
    { id: 30, text: '你更看重工作：', options: [{ value: 'A', text: 'A. 是否有创意空间' }, { value: 'C', text: 'B. 是否清晰稳定' }] },
    { id: 31, text: '休闲时你更喜欢：', options: [{ value: 'R', text: 'A. 户外、运动或动手 DIY' }, { value: 'A', text: 'B. 看电影、展览或创作' }] },
    { id: 32, text: '你更愿意：', options: [{ value: 'I', text: 'A. 在专业上做到顶尖' }, { value: 'S', text: 'B. 帮助更多人改善生活' }] },
    { id: 33, text: '你更常：', options: [{ value: 'E', text: 'A. 主动争取机会与资源' }, { value: 'C', text: 'B. 按计划与规则办事' }] },
    { id: 34, text: '你更喜欢：', options: [{ value: 'R', text: 'A. 具体、可触摸的成果' }, { value: 'I', text: 'B. 抽象、可论证的结论' }] },
    { id: 35, text: '工作中你更享受：', options: [{ value: 'S', text: 'A. 与人建立信任与关系' }, { value: 'A', text: 'B. 产出有创意的方案' }] },
    { id: 36, text: '你更愿意从事：', options: [{ value: 'I', text: 'A. 研发、分析或学术' }, { value: 'E', text: 'B. 销售、创业或管理' }] },
    { id: 37, text: '你更擅长：', options: [{ value: 'A', text: 'A. 审美与创意表达' }, { value: 'C', text: 'B. 数字与文档处理' }] },
    { id: 38, text: '你更喜欢：', options: [{ value: 'R', text: 'A. 独立或小团队动手做事' }, { value: 'S', text: 'B. 在人群中服务或沟通' }] },
    { id: 39, text: '面对目标你更常：', options: [{ value: 'E', text: 'A. 设定挑战并说服他人一起冲' }, { value: 'I', text: 'B. 先想清楚再稳步推进' }] },
    { id: 40, text: '你更看重：', options: [{ value: 'A', text: 'A. 独特性与美感' }, { value: 'C', text: 'B. 准确性与条理' }] },
    { id: 41, text: '你更愿意：', options: [{ value: 'R', text: 'A. 修理、安装或操作设备' }, { value: 'I', text: 'B. 做实验、建模型或写代码' }] },
    { id: 42, text: '别人更常认为你：', options: [{ value: 'S', text: 'A. 温暖、有同理心' }, { value: 'E', text: 'B. 有魄力、有目标感' }] },
    { id: 43, text: '你更享受：', options: [{ value: 'A', text: 'A. 打破常规、尝试新形式' }, { value: 'C', text: 'B. 维持秩序、避免出错' }] },
    { id: 44, text: '你更愿意从事：', options: [{ value: 'R', text: 'A. 技术工人、驾驶员或运动员' }, { value: 'C', text: 'B. 会计、文员或行政' }] },
    { id: 45, text: '你更感兴趣的是：', options: [{ value: 'I', text: 'A. 为什么与怎么办（原理与方法）' }, { value: 'E', text: 'B. 谁与如何合作（人与资源）' }] },
    { id: 46, text: '你更看重工作：', options: [{ value: 'S', text: 'A. 能否帮助到人' }, { value: 'A', text: 'B. 能否表达自我' }] },
    { id: 47, text: '你更常：', options: [{ value: 'C', text: 'A. 提前规划、按清单执行' }, { value: 'E', text: 'B. 灵活应变、争取机会' }] },
    { id: 48, text: '你更喜欢：', options: [{ value: 'R', text: 'A. 体力与动手结合的工作' }, { value: 'I', text: 'B. 脑力与深度思考的工作' }] },
    { id: 49, text: '你更愿意：', options: [{ value: 'S', text: 'A. 做培训、咨询或辅导' }, { value: 'A', text: 'B. 做策划、编剧或设计' }] },
    { id: 50, text: '你更认同：', options: [{ value: 'E', text: 'A. 敢闯敢试才能成事' }, { value: 'C', text: 'B. 稳扎稳打才能长久' }] }
  ];

  global.STRESS_QUESTIONS = STRESS_QUESTIONS;
  global.PERSONALITY_QUESTIONS = PERSONALITY_QUESTIONS;
  global.INTELLIGENCE_QUESTIONS = INTELLIGENCE_QUESTIONS;
  global.ABILITY_QUESTIONS = ABILITY_QUESTIONS;
  global.INTEREST_QUESTIONS = INTEREST_QUESTIONS;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
