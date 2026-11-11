#!/usr/bin/env bash
set -euo pipefail

tag=$1
source_sha=$2
prerelease=$3
assets_dir=$4
repository=sy1544/iscc-bml-sml

release=$(gh release view "$tag" -R "$repository" --json isDraft,targetCommitish,assets,body 2>/dev/null || true)
refs=$(git ls-remote "https://github.com/$repository.git" "refs/tags/$tag" "refs/tags/$tag^{}")
tag_sha=$(awk 'END {print $1}' <<< "$refs")
if [[ -n "$tag_sha" && "$tag_sha" != "$source_sha" ]]; then
  echo "Release tag $tag already points to a different commit" >&2
  exit 1
fi
if [[ -n "$release" && -z "$tag_sha" ]] &&
   [[ "$(jq -r .targetCommitish <<< "$release")" != "$source_sha" ]]; then
  echo "Existing release $tag targets a different commit" >&2
  exit 1
fi

for arch in arm64 x64; do
  test -s "$assets_dir/ISCC-macos-$arch-notarized.zip"
done

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
notarized_heading='### Notarized macOS downloads'
write_notarized_notes() {
  cat <<EOF
$notarized_heading

- Apple Silicon: **ISCC-macos-arm64-notarized.zip**
- Intel: **ISCC-macos-x64-notarized.zip**

Both apps use Developer ID signing and Apple notarization. MT5 starts disabled and requires a configured receiver.

- [Setup instructions](https://github.com/$repository/blob/main/.github/iscc-macos/README.md)
- [Upstream BML/SML release](https://github.com/Ivan25rus/iscc-bml-sml/releases/tag/$tag)
EOF
}

if [[ -z "$release" ]]; then
  options=(--draft)
  if [[ "$prerelease" == true ]]; then options+=(--prerelease); fi
  write_notarized_notes > "$notes"
  gh release create "$tag" -R "$repository" --target "$source_sha" \
    --title "ISCC $tag for macOS" --notes-file "$notes" "${options[@]}"
  release=$(gh release view "$tag" -R "$repository" --json isDraft,targetCommitish,assets,body)
fi

for arch in arm64 x64; do
  name="ISCC-macos-$arch-notarized.zip"
  if ! jq -e --arg name "$name" '.assets | any(.name == $name and .state == "uploaded")' <<< "$release" >/dev/null; then
    gh release upload "$tag" -R "$repository" "$assets_dir/$name"
  fi
done

body=$(jq -r '.body // ""' <<< "$release")
if [[ "$body" != *"$notarized_heading"* ]]; then
  { write_notarized_notes; printf '\n%s\n' "$body"; } > "$notes"
  gh release edit "$tag" -R "$repository" --notes-file "$notes"
fi
if [[ "$(jq -r .isDraft <<< "$release")" == true ]]; then
  gh release edit "$tag" -R "$repository" --draft=false
fi
