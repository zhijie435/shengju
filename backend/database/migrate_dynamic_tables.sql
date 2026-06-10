/*
 Navicat Premium Data Transfer

 Source Server         : AI试题编辑
 Source Server Type    : MySQL
 Source Server Version : 80044
 Source Host           : localhost:3306
 Source Schema         : question_recognition

 Target Server Type    : MySQL
 Target Server Version : 80044
 File Encoding         : 65001

 Date: 04/01/2026 20:35:21
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for question_bank_tables
-- ----------------------------
DROP TABLE IF EXISTS `question_bank_tables`;
CREATE TABLE `question_bank_tables`  (
  `id` int(0) NOT NULL AUTO_INCREMENT,
  `table_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '表名（格式：question_bank_类别_科目）',
  `category` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '类别',
  `subject` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '科目',
  `question_count` int(0) NULL DEFAULT 0 COMMENT '题目数量',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `table_name`(`table_name`) USING BTREE,
  INDEX `idx_category_subject`(`category`, `subject`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '题库表管理表' ROW_FORMAT = Dynamic;

SET FOREIGN_KEY_CHECKS = 1;








