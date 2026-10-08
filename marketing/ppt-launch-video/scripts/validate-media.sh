#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/opt/ffmpeg-full/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="$ROOT/exports/officedex-ppt-launch-master-1080p.mp4"
CLEAN="$ROOT/exports/officedex-ppt-launch-clean-1080p.mp4"
X_CUT="$ROOT/exports/officedex-ppt-launch-x-30s.mp4"
VERTICAL="$ROOT/exports/officedex-ppt-launch-vertical-20s.mp4"
MASTER_GUIDES="$ROOT/captions/master-guides-en.srt"
X_GUIDES="$ROOT/captions/x-guides-en.srt"

test -s "$MASTER_GUIDES"
test -s "$X_GUIDES"
test "$(rg -c '^00:' "$MASTER_GUIDES")" = "6"
test "$(rg -c '^00:' "$X_GUIDES")" = "3"
rg -q '^Start with one prompt$' "$MASTER_GUIDES"
rg -q '^Apply a precise AI edit$' "$MASTER_GUIDES"
rg -q '^One prompt$' "$X_GUIDES"
rg -q '^Edit with AI$' "$X_GUIDES"
test ! -e "$ROOT/captions/master-burn-en.srt"

check_media() {
  local file="$1"
  local min_duration="$2"
  local max_duration="$3"
  local want_width="$4"
  local want_height="$5"
  test -s "$file"
  local duration width height audio_streams
  duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file")"
  width="$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$file")"
  height="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$file")"
  audio_streams="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$file")"
  awk -v value="$duration" -v min="$min_duration" -v max="$max_duration" 'BEGIN { exit !(value >= min && value <= max) }'
  test "$width" = "$want_width"
  test "$height" = "$want_height"
  test -z "$audio_streams"
  echo "${file:t}: duration=${duration}s dimensions=${width}x${height} audio_streams=0"
}

check_media "$MASTER" 75 90 1920 1080
check_media "$CLEAN" 75 90 1920 1080
check_media "$X_CUT" 28 32 1920 1080
check_media "$VERTICAL" 19 21 1080 1920

check_edit_result_frame() {
  local file="$1"
  local actual_time="$2"
  local reference_filter="$3"
  local min_ssim="$4"
  local label="$5"
  local output metric
  output="$(ffmpeg -hide_banner \
    -ss "$actual_time" -i "$file" \
    -ss 74 -i "$CLEAN" \
    -filter_complex "[0:v]setpts=PTS-STARTPTS[actual];[1:v]${reference_filter},setpts=PTS-STARTPTS[reference];[actual][reference]ssim" \
    -frames:v 1 -f null - 2>&1)"
  metric="$(printf '%s\n' "$output" | sed -n 's/.* All:\([0-9.]*\).*/\1/p' | tail -1)"
  test -n "$metric"
  if ! awk -v value="$metric" -v min="$min_ssim" 'BEGIN { exit !(value >= min) }'; then
    echo "$label does not visibly contain the applied vertical-roadmap result: SSIM=$metric, want >= $min_ssim" >&2
    return 1
  fi
  echo "$label edit-result frame: SSIM=$metric"
}

check_edit_result_frame "$X_CUT" 24 "null" 0.99 "X cut"
check_edit_result_frame "$VERTICAL" 14 "scale=1080:608:force_original_aspect_ratio=decrease,pad=1080:1920:0:656:#FCFAF2,drawtext=font='Arial':text='From prompt to editable PPTX':fontcolor=#05101A:fontsize=58:x=(w-text_w)/2:y=210,drawtext=font='Arial':text='Plan. Confirm. Preview. Edit.':fontcolor=#03849B:fontsize=38:x=(w-text_w)/2:y=300,drawtext=font='Arial':text='Download OfficeDex now':fontcolor=#05101A:fontsize=52:x=(w-text_w)/2:y=1530" 0.99 "Vertical cut"

ffmpeg -v error -i "$MASTER" -f null -
ffmpeg -v error -i "$CLEAN" -f null -
ffmpeg -v error -i "$X_CUT" -f null -
ffmpeg -v error -i "$VERTICAL" -f null -

echo "media validation passed"
