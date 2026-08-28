import { StageIntentBar, type StageIntentBarProps } from "./StageIntentBar";

export interface LiveSteeringBarProps extends Omit<StageIntentBarProps, "onSubmit"> {
  readonly onSteer: (instruction: string) => void | Promise<void>;
}

/** Commands are applied at the next safe page boundary during live generation. */
export function LiveSteeringBar({ onSteer, ...props }: LiveSteeringBarProps) {
  return <StageIntentBar {...props} onSubmit={onSteer} placeholder={props.placeholder ?? "Tell OfficeDex what to change from the next slide"} />;
}
