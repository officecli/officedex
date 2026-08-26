import {
  ArrowUp, AudioLines, Bell, Bot, ChartBar, ChartLine, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleStop, CircleX,
  Check, Cloud, Code2, Copy, Download, Ellipsis, Eye, EyeOff, FileCheck2, FileImage, FileText, FolderOpen, FolderPlus,
  File, Github, Globe2, Grid3x3, History, House, Image as ImageGlyph, Info, LayoutGrid, Link, List, LoaderCircle, Lock, LogOut, MessageCircle,
  MessageSquare, Monitor, MonitorPlay, Palette, Paperclip, Pencil, PlayCircle, Plus, Presentation, RefreshCw, Rocket, Send, Settings,
  ShieldCheck, SlidersHorizontal, SquareDashed, Star, Table2, Trash2, TriangleAlert, Unlock, Unplug, User, X, Zap,
  type LucideIcon, type LucideProps,
} from "lucide-react";

export interface ProjectIconProps extends LucideProps { readonly spin?: boolean }

function projectIcon(Icon: LucideIcon) {
  return function ProjectIcon({ spin, className, ...props }: ProjectIconProps) {
    return <Icon {...props} className={[spin ? "ui-icon--spin" : "", className].filter(Boolean).join(" ")} />;
  };
}

export const AppstoreOutlined = projectIcon(LayoutGrid);
export const ArrowUpOutlined = projectIcon(ArrowUp);
export const AudioOutlined = projectIcon(AudioLines);
export const BarChartOutlined = projectIcon(ChartBar);
export const BgColorsOutlined = projectIcon(Palette);
export const CheckOutlined = projectIcon(Check);
export const CheckCircleFilled = projectIcon(CircleCheck);
export const CheckCircleOutlined = projectIcon(CircleCheck);
export const ClockCircleOutlined = projectIcon(History);
export const CloseCircleFilled = projectIcon(CircleX);
export const CloseCircleOutlined = projectIcon(CircleX);
export const CloseOutlined = projectIcon(X);
export const CloudOutlined = projectIcon(Cloud);
export const CodeOutlined = projectIcon(Code2);
export const CommentOutlined = projectIcon(MessageCircle);
export const ControlOutlined = projectIcon(SlidersHorizontal);
export const CopyOutlined = projectIcon(Copy);
export const DeleteOutlined = projectIcon(Trash2);
export const DesktopOutlined = projectIcon(Monitor);
export const DisconnectOutlined = projectIcon(Unplug);
export const DownOutlined = projectIcon(ChevronDown);
export const DownloadOutlined = projectIcon(Download);
export const EditOutlined = projectIcon(Pencil);
export const ExclamationCircleFilled = projectIcon(CircleAlert);
export const EyeInvisibleOutlined = projectIcon(EyeOff);
export const EyeOutlined = projectIcon(Eye);
export const FileDoneOutlined = projectIcon(FileCheck2);
export const FileImageOutlined = projectIcon(FileImage);
export const FileOutlined = projectIcon(File);
export const FileTextOutlined = projectIcon(FileText);
export const FolderAddOutlined = projectIcon(FolderPlus);
export const FolderUnsetOutlined = projectIcon(SquareDashed);
export const FolderOpenOutlined = projectIcon(FolderOpen);
export const FundProjectionScreenOutlined = projectIcon(Presentation);
export const GithubOutlined = projectIcon(Github);
export const GlobalOutlined = projectIcon(Globe2);
export const GridOutlined = projectIcon(Grid3x3);
export const HistoryOutlined = projectIcon(History);
export const HomeOutlined = projectIcon(House);
export const InfoCircleOutlined = projectIcon(Info);
export const LeftOutlined = projectIcon(ChevronLeft);
export const LineChartOutlined = projectIcon(ChartLine);
export const LinkOutlined = projectIcon(Link);
export const Loading3QuartersOutlined = projectIcon(LoaderCircle);
export const LoadingOutlined = projectIcon(LoaderCircle);
export const LockOutlined = projectIcon(Lock);
export const LogoutOutlined = projectIcon(LogOut);
export const MessageOutlined = projectIcon(MessageSquare);
export const MonitorPlayOutlined = projectIcon(MonitorPlay);
export const MoreOutlined = projectIcon(Ellipsis);
export const NotificationOutlined = projectIcon(Bell);
export const PaperClipOutlined = projectIcon(Paperclip);
export const PictureOutlined = projectIcon(ImageGlyph);
export const PlayCircleOutlined = projectIcon(PlayCircle);
export const PlusOutlined = projectIcon(Plus);
export const RightOutlined = projectIcon(ChevronRight);
export const RobotOutlined = projectIcon(Bot);
export const RocketOutlined = projectIcon(Rocket);
export const SafetyCertificateOutlined = projectIcon(ShieldCheck);
export const SendOutlined = projectIcon(Send);
export const SettingOutlined = projectIcon(Settings);
export const StarOutlined = projectIcon(Star);
export const StopOutlined = projectIcon(CircleStop);
export const SyncOutlined = projectIcon(RefreshCw);
export const TableOutlined = projectIcon(Table2);
export const ThunderboltOutlined = projectIcon(Zap);
export const UnlockOutlined = projectIcon(Unlock);
export const UnorderedListOutlined = projectIcon(List);
export const UserOutlined = projectIcon(User);
export const WarningFilled = projectIcon(TriangleAlert);

export const CopyIcon = CopyOutlined;
