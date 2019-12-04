Whenever <version number> is mentioned, it is preceeded by a "v": e.g. "v0.1.2"

1. npm run clean
2. npm install
3. npm run bootstrap
4. npm run build
5. npm run package-version (choose a prerelease for testing)
6. git commit -am "Version \<insert version here\>"
7. npm run package-publish (package-publish-dev for testing)
8. npm run package-postpublish
9. git commit -am "Version bump package locks \<insert version here\>"
10. git tag -a "\<version number here\>" -m "\<Package information message\>"
