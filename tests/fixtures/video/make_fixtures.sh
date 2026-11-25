#!/bin/sh
# Real VP9 / AV1 streams for the CompressedVideo tests, from several encoders
# with different keyframe spacing. IVF holds exactly what a CompressedVideo
# message carries: one VP9 frame (or superframe) or one AV1 temporal unit.
# keyframes.json is ffprobe's own keyframe flag per packet, the ground truth.
set -eu
cd "$(dirname "$0")"
SRC="-f lavfi -i testsrc2=size=96x64:rate=10 -frames:v 24 -an"

ffmpeg -y -v error $SRC -c:v libvpx-vp9 -g 8 -b:v 100k -pix_fmt yuv420p vp9_libvpx.ivf
ffmpeg -y -v error $SRC -c:v libvpx-vp9 -g 12 -b:v 100k -pix_fmt yuv420p10le -profile:v 2 vp9_10bit.ivf
ffmpeg -y -v error $SRC -c:v libaom-av1 -g 8 -b:v 100k -cpu-used 8 -pix_fmt yuv420p av1_libaom.ivf
ffmpeg -y -v error $SRC -c:v libsvtav1 -g 10 -preset 12 -pix_fmt yuv420p av1_svt.ivf

printf '{\n' > keyframes.json
first=1
for f in vp9_libvpx vp9_10bit av1_libaom av1_svt; do
  keys=$(ffprobe -v error -select_streams v -show_entries packet=flags -of csv=p=0 "$f.ivf" \
    | awk '{ printf "%s%s", (NR > 1 ? "," : ""), (index($0, "K") ? 1 : 0) }')
  [ $first -eq 1 ] || printf ',\n' >> keyframes.json
  printf '  "%s": [%s]' "$f" "$keys" >> keyframes.json
  first=0
done
printf '\n}\n' >> keyframes.json
