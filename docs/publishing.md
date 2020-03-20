1. pnpm run clean
2. pnpm install
3. pnpm -r run build
4. pnpm recursive --filter ./packages exec -- npm version <version>
5. git commit -am "Version bump <version>"
6. pnpm recursive --filter ./packages exec -- npm publish --access public