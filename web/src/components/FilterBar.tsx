import { Search } from "lucide-react";

export function FilterBar({
  value,
  onChange,
  status,
  onStatusChange,
  taskId,
  onTaskChange,
  taskSources = [],
  placeholder = "搜索文件名、编号或场景",
  dateRange,
  onDateRangeChange,
  scene,
  onSceneChange,
  sceneOptions = [],
  sort,
  onSortChange,
}: {
  value: string;
  onChange(value: string): void;
  status: string;
  onStatusChange(value: string): void;
  taskId?: string;
  onTaskChange?(value: string): void;
  taskSources?: Array<{ taskId: string; title: string; sceneName: string }>;
  placeholder?: string;
  /** 提交时间范围（all / today / 7d / 30d） */
  dateRange?: string;
  onDateRangeChange?(value: string): void;
  /** 场景筛选 */
  scene?: string;
  onSceneChange?(value: string): void;
  sceneOptions?: string[];
  /** 排序（createdAt-desc / createdAt-asc / finalScore-desc / finalScore-asc） */
  sort?: string;
  onSortChange?(value: string): void;
}) {
  return (
    <div className="filter-bar">
      <label className="search-field"><Search size={16} /><input aria-label="搜索" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>
      {taskId !== undefined && onTaskChange && (
        <select
          className="task-source-filter"
          aria-label="任务来源筛选"
          value={taskId}
          onChange={(event) => onTaskChange(event.target.value)}
        >
          <option value="all">全部任务来源</option>
          {taskSources.map((source) => (
            <option key={source.taskId} value={source.taskId}>
              {source.title} · {source.sceneName}
            </option>
          ))}
          <option value="__none__">未关联任务</option>
        </select>
      )}
      {dateRange !== undefined && onDateRangeChange && (
        <select aria-label="提交时间筛选" value={dateRange} onChange={(event) => onDateRangeChange(event.target.value)}>
          <option value="all">全部提交时间</option>
          <option value="today">今天</option>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </select>
      )}
      {scene !== undefined && onSceneChange && (
        <select aria-label="场景筛选" value={scene} onChange={(event) => onSceneChange(event.target.value)}>
          <option value="all">全部场景</option>
          {sceneOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      )}
      <select aria-label="状态筛选" value={status} onChange={(event) => onStatusChange(event.target.value)}>
        <option value="all">全部状态</option>
        <option value="completed">处理完成</option>
        <option value="processing">处理中</option>
        <option value="passed">质量通过</option>
        <option value="failed">质量未通过</option>
        <option value="unsettled">待结算</option>
      </select>
      {sort !== undefined && onSortChange && (
        <select aria-label="排序方式" value={sort} onChange={(event) => onSortChange(event.target.value)}>
          <option value="createdAt-desc">提交时间 · 降序</option>
          <option value="createdAt-asc">提交时间 · 升序</option>
          <option value="finalScore-desc">质量评分 · 降序</option>
          <option value="finalScore-asc">质量评分 · 升序</option>
        </select>
      )}
    </div>
  );
}
