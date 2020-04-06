1. pnpm run clean
2. pnpm install
3. pmpm run build
4. pnpm -r --filter ./packages exec -- npm version <version>
5. git commit -am "Version bump <version>"
6. pnpm -r publish --filter ./packages --access public