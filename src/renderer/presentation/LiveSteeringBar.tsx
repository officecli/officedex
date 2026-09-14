import { useT } from "../i18n";
import { StageIntentBar, type StageIntentBarProps } from "./StageIntentBar";

export interface LiveSteeringBarProps extends Omit<StageIntentBarProps, "onSubmit"> {
  readonly onSteer: (instruction: string) => void | Promise<void>;
}

/**
 * Steering text for a deck. While the run is live the host absorbs it at the
 * next safe page boundary; once the run is over the same text starts a
 * follow-up modification, so the caller supplies the wording that matches.
 */
export function LiveSteeringBar({ onSteer, ...props }: LiveSteeringBarProps) {
  const t = useT();
  return <StageIntentBar {...props} onSubmit={onSteer} placeholder={props.placeholder ?? t("ui.copy.Describethenextchange")} />;
}
