#!/bin/sh
# 打包扩展 zip：只挑运行时需要的文件，输出 dist/nest-tabs-<版本号>.zip
# （manifest 声明的资源 + panel/lib 运行时 + icons，剔除测试与预览页专用文件）
set -e
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
out="dist/nest-tabs-$version.zip"
mkdir -p dist
rm -f "$out"

# shellcheck disable=SC2046
zip -q "$out" manifest.json background.js sidepanel.html sidepanel.css sidepanel.js \
  $(find panel lib icons -type f ! -name "*.test.js" ! -name "preview*" ! -name ".DS_Store")

echo "$out ($(unzip -l "$out" | tail -1 | awk '{print $2}') files)"
