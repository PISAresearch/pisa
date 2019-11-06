1. npm run clean
1. npm install
1. npm run bootstrap
1. npm run build
1. npm run package-version (choose a prerelease for testing)
1. git commit -m "Version \<insert version here\>"
1. npm run package-publish (package-publish-dev for testing)
1. npm run package-postpublish
1. git commit -m "Version bump package locks \<insert version here\>"
1. git tag -a "\<version number here (starting with v)\>" -m "\<Package information message\>"