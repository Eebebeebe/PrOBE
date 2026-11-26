#!/usr/bin/env bash
# Builds the basisu texture compressor for Linux, which the exporter uses to
# turn the game's PNG sprites into .basis files.
#
# The repo ships basisu only for macOS (./basisu) and Windows (./basisu.exe).
# The version must match the transcoder the editor decodes with,
# packages/editor/src/basis/transcoder.1.16.4.*, so this builds tag 1.16.4.
#
# Output: packages/exporter/target/basisu (target/ is gitignored).
# Needs git, cmake and a C++ compiler. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"

TAG=1.16.4
SRC=target/basis_universal-$TAG
OUT=target/basisu

if [[ ! -d "$SRC" ]]; then
    git clone --depth 1 --branch "$TAG" https://github.com/BinomialLLC/basis_universal.git "$SRC"
fi
# 1.16.4 declares cmake_minimum_required < 3.5, which CMake 4 refuses without this.
cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$SRC/build" --parallel "${JOBS:-4}"
cp "$SRC/bin/basisu" "$OUT" 2>/dev/null || cp "$SRC/build/basisu" "$OUT"
"$OUT" -version
