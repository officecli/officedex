#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/opt/ffmpeg-full/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW_ROOT="$ROOT/raw/browser"
GRAPHICS="$ROOT/graphics/rendered"
MASTER_GUIDES="$ROOT/captions/master-guides-en.srt"
X_GUIDES="$ROOT/captions/x-guides-en.srt"
EXPORTS="$ROOT/exports"
MASTER="$EXPORTS/officedex-ppt-launch-master-1080p.mp4"
CLEAN="$EXPORTS/officedex-ppt-launch-clean-1080p.mp4"
X_CUT="$EXPORTS/officedex-ppt-launch-x-30s.mp4"
VERTICAL="$EXPORTS/officedex-ppt-launch-vertical-20s.mp4"
TIMELINE_SECONDS=85
OPENING_SECONDS=6
CTA_SECONDS=5
PRODUCT_SECONDS=$((TIMELINE_SECONDS - OPENING_SECONDS - CTA_SECONDS))

mkdir -p "$EXPORTS"
"$ROOT/scripts/render-graphics.sh"

if [[ -n "${OFFICEDEX_PROMO_SOURCE:-}" ]]; then
  SOURCE="$OFFICEDEX_PROMO_SOURCE"
else
  SOURCE="$(find "$RAW_ROOT" -type f -name 'officedex-ppt-launch-full-browser.webm' -print0 | xargs -0 ls -t | head -1)"
fi

test -s "$SOURCE"
source_duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$SOURCE")"
slow_factor="$(awk -v target="$PRODUCT_SECONDS" -v source="$source_duration" 'BEGIN { print target/source }')"

common_video="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#FCFAF2,fps=30,format=yuv420p"

ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t "$OPENING_SECONDS" -i "$GRAPHICS/opening.png" \
  -i "$SOURCE" \
  -loop 1 -t "$CTA_SECONDS" -i "$GRAPHICS/cta.png" \
  -filter_complex \
  "[0:v]$common_video,trim=duration=${OPENING_SECONDS},setpts=PTS-STARTPTS[v0]; \
   [1:v]$common_video,setpts=${slow_factor}*PTS,trim=duration=${PRODUCT_SECONDS},setpts=PTS-STARTPTS[v1]; \
   [2:v]$common_video,trim=duration=${CTA_SECONDS},setpts=PTS-STARTPTS[v2]; \
   [v0][v1][v2]concat=n=3:v=1:a=0[base]; \
   [base]subtitles=filename='$MASTER_GUIDES':force_style='FontName=Arial,FontSize=9,PrimaryColour=&H001A1005,OutlineColour=&H00F2FAFC,BorderStyle=3,Outline=5,Shadow=0,MarginL=34,MarginV=28,Alignment=7,Bold=1'[video]" \
  -map "[video]" -an \
  -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.1 \
  -movflags +faststart -t "$TIMELINE_SECONDS" "$MASTER"

ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t "$OPENING_SECONDS" -i "$GRAPHICS/opening.png" \
  -i "$SOURCE" \
  -loop 1 -t "$CTA_SECONDS" -i "$GRAPHICS/cta.png" \
  -filter_complex \
  "[0:v]$common_video,trim=duration=${OPENING_SECONDS},setpts=PTS-STARTPTS[v0]; \
   [1:v]$common_video,setpts=${slow_factor}*PTS,trim=duration=${PRODUCT_SECONDS},setpts=PTS-STARTPTS[v1]; \
   [2:v]$common_video,trim=duration=${CTA_SECONDS},setpts=PTS-STARTPTS[v2]; \
   [v0][v1][v2]concat=n=3:v=1:a=0[video]" \
  -map "[video]" -an \
  -c:v libx264 -preset medium -crf 18 -profile:v high -level 4.1 \
  -movflags +faststart -t "$TIMELINE_SECONDS" "$CLEAN"

ffmpeg -hide_banner -loglevel error -y -i "$CLEAN" \
  -filter_complex \
  "[0:v]trim=start=0:end=4,setpts=PTS-STARTPTS[v0]; \
   [0:v]trim=start=7:end=11,setpts=PTS-STARTPTS[v1]; \
   [0:v]trim=start=24:end=29,setpts=PTS-STARTPTS[v2]; \
   [0:v]trim=start=49:end=54,setpts=PTS-STARTPTS[v3]; \
   [0:v]trim=start=64:end=69,setpts=PTS-STARTPTS[v4]; \
   [0:v]trim=start=73:end=77,setpts=PTS-STARTPTS[v5]; \
   [0:v]trim=start=82:end=85,setpts=PTS-STARTPTS[v6]; \
   [v0][v1][v2][v3][v4][v5][v6]concat=n=7:v=1:a=0[base]; \
   [base]subtitles=filename='$X_GUIDES':force_style='FontName=Arial,FontSize=10,PrimaryColour=&H001A1005,OutlineColour=&H00F2FAFC,BorderStyle=3,Outline=5,Shadow=0,MarginL=34,MarginV=28,Alignment=7,Bold=1'[video]" \
  -map "[video]" -an -c:v libx264 -preset medium -crf 19 -movflags +faststart "$X_CUT"

ffmpeg -hide_banner -loglevel error -y -i "$CLEAN" \
  -filter_complex \
  "[0:v]trim=start=55:end=62,setpts=PTS-STARTPTS[edit_prompt]; \
   [0:v]trim=start=64:end=69,setpts=PTS-STARTPTS[edit_confirm]; \
   [0:v]trim=start=72:end=77,setpts=PTS-STARTPTS[edit_result]; \
   [0:v]trim=start=82:end=85,setpts=PTS-STARTPTS[cta]; \
   [edit_prompt][edit_confirm][edit_result][cta]concat=n=4:v=1:a=0,scale=1080:608:force_original_aspect_ratio=decrease, \
   pad=1080:1920:0:656:#FCFAF2, \
   drawtext=font='Arial':text='From prompt to editable PPTX':fontcolor=#05101A:fontsize=58:x=(w-text_w)/2:y=210, \
   drawtext=font='Arial':text='Plan. Confirm. Preview. Edit.':fontcolor=#03849B:fontsize=38:x=(w-text_w)/2:y=300, \
   drawtext=font='Arial':text='Download OfficeDex now':fontcolor=#05101A:fontsize=52:x=(w-text_w)/2:y=1530[video]" \
  -map "[video]" -an -c:v libx264 -preset medium -crf 19 -movflags +faststart "$VERTICAL"

echo "source=$SOURCE"
echo "source_duration=$source_duration"
echo "slow_factor=$slow_factor"
echo "master=$MASTER"
echo "clean=$CLEAN"
echo "x_cut=$X_CUT"
echo "vertical=$VERTICAL"
