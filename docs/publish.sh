set -e

VERSION=$1
TAG=${2:-latest}

echo "Version : $VERSION"
echo "Tag : $TAG"

# pnpm run clean
# pnpm install
pnpm run build
pnpm -r --filter ./packages exec -- npm version $VERSION
git commit -am "Version bump $VERSION"
pnpm -r publish --filter ./packages --access public
git push
