import type { BaselineMode, ParticipationDataQualityState } from "@/lib/replay/baselineModes";

export interface ParticipationModeNoticeProps {
  baselineMode: BaselineMode;
  firstObservedActivity: boolean;
  dataQualityState: ParticipationDataQualityState;
}

export function ParticipationModeNotice({ baselineMode, firstObservedActivity, dataQualityState }: ParticipationModeNoticeProps) {
  return (
    <div data-participation-mode={baselineMode} data-quality-state={dataQualityState}>
      <span>Participation mode: {baselineMode}</span>
      {firstObservedActivity ? (
        <div role="alert">
          <strong>First observed activity</strong>
          <span> No historical prints in this bucket. Displacement confirmation required for NEW IN PLAY.</span>
        </div>
      ) : null}
    </div>
  );
}
