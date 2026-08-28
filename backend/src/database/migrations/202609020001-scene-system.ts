import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 场景体系：场景分类表 + 场景库。
 *
 * 场景分类表（scene_classification）保存系统所有可能的场景：
 *   一级编码 + 一级场景 + 二级场景 + 场景描述。
 * 一级场景 = 计费场景大类（家庭 F01 / 办公室 O01 / 工厂 W01 / 通用 G01），
 * 二级场景是一级下的细分内容（每个一级至少 3 个二级）。
 *
 * 场景库（scene_library）管理实际采集场景（一个外包人员一个场景，如「采集员A家」）：
 *   场景名称 + 场景类别（一级）+ 包含的子场景（二级列表）+ 描述。
 */
export class SceneSystem2026090200001 implements MigrationInterface {
  name = "SceneSystem2026090200001";
  timestamp = 2_026_090_200_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scene_classification" (
        "id" varchar(64) PRIMARY KEY,
        "level1_code" varchar(16) NOT NULL,
        "level1_name" varchar(40) NOT NULL,
        "level2_name" varchar(80) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_scene_classification_code"
          CHECK ("level1_code" IN ('F01', 'O01', 'W01', 'G01'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_scene_classification_level2"
        ON "scene_classification" ("level1_code", "level2_name")
    `);

    await queryRunner.query(`
      CREATE TABLE "scene_library" (
        "id" varchar(64) PRIMARY KEY,
        "name" varchar(120) NOT NULL,
        "category_key" varchar(64) NOT NULL,
        "sub_scene_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "description" text NOT NULL DEFAULT '',
        "enabled" boolean NOT NULL DEFAULT true,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_scene_library_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_scene_library_category"
          CHECK ("category_key" IN ('family', 'office', 'factory', 'generic')),
        CONSTRAINT "chk_scene_library_sub_scenes_array"
          CHECK (jsonb_typeof("sub_scene_ids") = 'array')
      )
    `);

    // 任务 → 场景库关联：任务创建从场景库选场景时记录
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        ADD COLUMN "scene_library_id" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_collection_tasks_scene_library"
        ON "collection_tasks" ("scene_library_id")
    `);

    // 分类表种子：每个一级场景至少 3 个二级场景
    await queryRunner.query(`
      INSERT INTO "scene_classification"
        ("id", "level1_code", "level1_name", "level2_name", "description") VALUES
        ('SC-001', 'F01', '家庭', '厨房',
         '备餐切配、炒菜烹饪、煲汤蒸煮、清洗碗筷、使用厨房小家电等家庭厨房操作。'),
        ('SC-002', 'F01', '家庭', '客厅',
         '沙发茶几整理、桌面擦拭、地面清洁、收纳归位、窗帘拉合、家电操作等客厅操作。'),
        ('SC-003', 'F01', '家庭', '卧室',
         '铺床叠被、更换床品、衣物折叠收纳、衣柜整理、卧室清洁等操作。'),
        ('SC-004', 'F01', '家庭', '卫生间',
         '洗漱台整理、浴室清洁、卫浴用品收纳、洗衣晾晒等卫生间操作。'),
        ('SC-005', 'F01', '家庭', '阳台晾晒区',
         '晾晒衣物、阳台收纳整理、绿植打理、清洁等阳台区域操作。'),
        ('SC-006', 'O01', '办公室', '工位',
         '工位桌面整理、文具与耗材收纳、办公设备操作等工位区域操作。'),
        ('SC-007', 'O01', '办公室', '会议室',
         '会议桌椅布置、白板整理、设备调试、会议物料准备等操作。'),
        ('SC-008', 'O01', '办公室', '库房',
         '物品出入库、货架整理、库存清点、打包分拣等库房操作。'),
        ('SC-009', 'W01', '工厂', '车间工坊',
         '车间环境中的装配、加工、工具使用、设备点检等产线操作。'),
        ('SC-010', 'W01', '工厂', '装配区',
         '零配件装配、紧固、组装、工装夹具使用等装配工序操作。'),
        ('SC-011', 'W01', '工厂', '检测区',
         '产品外观检测、尺寸测量、功能测试、分拣判级等检测工序操作。'),
        ('SC-012', 'G01', '通用', '桌面台面操作',
         '整理、组装、包装、备餐等以桌面/台面为主要作业面的通用操作。'),
        ('SC-013', 'G01', '通用', '走动搬运操作',
         '取物、搬运、归位、上下架等伴随移动与重物转运的通用操作。'),
        ('SC-014', 'G01', '通用', '设备工具操作',
         '使用电器、工具、仪器等设备完成的通用操作任务。')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_tasks" DROP COLUMN IF EXISTS "scene_library_id"
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "scene_library"');
    await queryRunner.query('DROP TABLE IF EXISTS "scene_classification"');
  }
}
