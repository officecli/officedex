import { Circle } from "lucide-react";
import type { ComponentProps } from "react";

function ShimoIcon({
  "data-icon-name": iconName,
  ...props
}: ComponentProps<typeof Circle> & { "data-icon-name"?: string }) {
  return <Circle aria-hidden="true" data-shimo-icon={iconName} {...props} />;
}

function icon(name: string) {
  return function OfficeDexPresentationIcon(props: ComponentProps<typeof Circle>) {
    return <ShimoIcon data-icon-name={name} size={16} strokeWidth={1.8} {...props} />;
  };
}

export const CopyIcon = icon("copy");
export const AddIcon = icon("add");
export const BackgroundColorIcon = icon("background-color");
export const BarChart24Icon = icon("bar-chart");
export const BorderColorIcon = icon("border-color");
export const BrushIcon = icon("brush");
export const CheckboxIcon = icon("checkbox");
export const ClearIcon = icon("clear");
export const Column24Icon = icon("column");
export const CutIcon = icon("cut");
export const DeleteIcon = icon("delete");
export const FindIcon = icon("find");
export const FitWidthIcon = icon("fit-width");
export const FormatBrushIcon = icon("format-brush");
export const Group24Icon = icon("group");
export const ImageIcon = icon("image");
export const InsertDownIcon = icon("insert-down");
export const InsertLeftIcon = icon("insert-left");
export const InsertRightIcon = icon("insert-right");
export const InsertUpIcon = icon("insert-up");
export const LinkIcon = icon("link");
export const ListIcon = icon("list");
export const MoreIcon = icon("more");
export const PasteIcon = icon("paste");
export const PlaybackIcon = icon("playback");
export const RotateIcon = icon("rotate");
export const TextBoxFormat24Icon = icon("text-box");
export const VideoIcon = icon("video");
export const FitHeightIcon = icon("fit-height");
export const FullScreen24Icon = icon("fullscreen");
export const GridIcon = icon("grid");
export const HideIcon = icon("hide");
export const Note24Icon = icon("note");
export const PlayIcon = icon("play");
export const RedoIcon = icon("redo");
export const ScreenshotWindowIcon = icon("screenshot");
export const SheetView24Icon = icon("sheet-view");
export const TimeIcon = icon("time");
export const UndoIcon = icon("undo");

