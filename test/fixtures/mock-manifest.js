
// Will tag the last entry in versions as latest
// Versions can be an array of versions or an array of package.json
function mockManifest ({ name = 'test-package', versions = ['1.0.0'] }) {
  versions = versions.map(v => {
    if (!v.version) {
      return { version: v }
    }
    return v
  })
  const latest = versions.slice(-1)[0]
  const manifest = {
    _id: `${name}@${latest.version}`,
    _rev: '00-testdeadbeef',
    name,
    description: 'test package mock manifest',
    dependencies: {},
    versions: {},
    time: {},
    'dist-tags': { latest: latest.version },
    ...latest,
  }
  for (const v of versions) {
    manifest.versions[v.version] = {
      _id: `${name}@{v.version}`,
      name,
      description: 'test package mock manifest',
      dependencies: {},
      dist: {
        tarball: `https://registry.npmjs.org/${name}/-/${name}-${v.version}.tgz`,
      },
      ...v,
    }
    manifest.time[v.version] = new Date()
  }

  return manifest
}
module.exports = mockManifest
