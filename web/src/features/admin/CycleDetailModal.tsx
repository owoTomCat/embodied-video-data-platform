"use client";

import { useRef, useState, type RefObject } from "react";

import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import type {
  BackendPointCycle,
  BackendPointCycleItem,
} from "../../points/contracts";
import { CycleItemAdjustModal } from "./CycleItemAdjustModal";

export function CycleDetailModal({
  open,
  cycle,
  onAdjusted,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  cycle: BackendPointCycle;
  onAdjusted(cycle: BackendPointCycle): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [adjustItem, setAdjustItem] = useState<BackendPointCycleItem>();
  const adjustTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Modal
        open={open}
        title={`周期明细 · ${cycle.businessDate}`}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      >
        <div className="modal-intro">
          <p>
            共 {cycle.submissionCount} 条视频 · 有效 {cycle.effectiveMinutes} 分钟 · 合计{" "}
            <strong>{cycle.totalPoints.toFixed(2)} 分</strong>
          </p>
          <p className="form-help">可对单个视频条目人工调整最终评分，积分按当前规则自动重算并全程留痕。</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>视频</th><th>数采</th><th>团队</th><th>评分</th><th>比例</th><th>有效时长</th><th>积分</th><th>状态</th><th /></tr>
            </thead>
            <tbody>
              {(cycle.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.fileName}</strong></td>
                  <td>{item.ownerName}</td>
                  <td>{item.teamName}</td>
                  <td>{item.finalScore.toFixed(1)}</td>
                  <td>{item.settlementRatio.toFixed(2)}</td>
                  <td>{item.effectiveMinutes} 分钟</td>
                  <td><strong>{item.points.toFixed(2)}</strong></td>
                  <td>
                    {item.adjusted ? (
                      <StatusBadge label="已调整" tone="warning" />
                    ) : (
                      <StatusBadge label="原值" tone="neutral" />
                    )}
                  </td>
                  <td>
                    <button
                      ref={adjustItem?.id === item.id ? adjustTriggerRef : undefined}
                      className="table-action"
                      onClick={() => setAdjustItem(item)}
                    >
                      调整
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
      {adjustItem && (
        <CycleItemAdjustModal
          open
          cycleId={cycle.id}
          item={adjustItem}
          onAdjusted={(nextCycle) => {
            onAdjusted(nextCycle);
            setAdjustItem(undefined);
          }}
          onClose={() => setAdjustItem(undefined)}
          returnFocusRef={adjustTriggerRef}
        />
      )}
    </>
  );
}
