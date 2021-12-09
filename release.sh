#!/bin/bash -eu
{ set +x; } 2>/dev/null
SOURCE=$0
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

cd $DIR
cp flattened/CHANGELOG.md .
ver=$(grep \"version\": flattened/package.json|sed -E 's,\s*\"version\": \"(.*)\"\s*,\1,')
sed -i -E "s,(\s*\"version\": \")(.*)(\"\s*),\1$ver\3," package.json