import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 大场景任务（scene_type 任务）的补量目标按场景细分。
 * 一个 scene_type 任务可对多个场景分别设置目标时长；大类总目标 = 各场景目标之和。
 */
@Entity({ name: "scene_task_targets" })
@Index("uq_scene_task_targets", ["taskId", "sceneId"], { unique: true })
export class SceneTaskTargetEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** 关联大场景任务（collection_tasks.id，task_type='scene_type'） */
  @Column({ name: "task_id", type: "varchar", length: 64 })
  taskId!: string;

  /** 关联场景（scene.id） */
  @Column({ name: "scene_id", type: "varchar", length: 64 })
  sceneId!: string;

  /** 该场景的补量目标时长（秒） */
  @Column({ name: "target_duration_seconds", type: "bigint" })
  targetDurationSeconds!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
