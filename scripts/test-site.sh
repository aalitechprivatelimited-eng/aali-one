#!/usr/bin/env bash
# Puts the code of this folder on the TEST SITE (https://aali-one-test.vercel.app). The live site is not touched:
# the code is copied to ../aali-one-testsite, which is linked to the separate Vercel project "aali-one-test", whose
# DATABASE_URL points at the aali_test database and whose TEST_SITE=1 shows the yellow TEST SITE strip.
# Fresh copy of the live data as well:  node scripts/test-copy.mjs   (live is only read)
set -euo pipefail
cd "$(dirname "$0")/.."
dest=../aali-one-testsite
[ -f "$dest/.vercel/project.json" ] && grep -q '"aali-one-test"' "$dest/.vercel/project.json" || { echo "$dest is not linked to aali-one-test – stopping."; exit 1; }
keep=$(mktemp -d); cp -r "$dest/.vercel" "$keep/"
find "$dest" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
tar --exclude=./node_modules --exclude=./.vercel --exclude='./.env*' --exclude='./.devdb*' --exclude=./dist --exclude=./.review --exclude=./.omc \
    --exclude=./.git --exclude=./e2e --exclude=./test --exclude=./.claude --exclude=./.agents --exclude=./skills-lock.json --exclude='./*LOGINS*.md' -cf - . | (cd "$dest" && tar xf -)
cp -r "$keep/.vercel" "$dest/" && rm -rf "$keep"
cd "$dest" && npx vercel deploy --prod --yes
