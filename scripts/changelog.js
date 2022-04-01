'use strict'

const { execSync } = require('child_process')
const semver = require('semver')
const fs = require('fs')
const config = require('@npmcli/template-oss')
const { resolve, relative } = require('path')

const usage = () => `
  node ${relative(process.cwd(), __filename)} [--read] [--write] [tag]

  Generates changelog entries in our format starting from the most recent tag.

  By default this script will print the release notes to stdout.

  [tag]
  A tag to generate release notes for. Helpful for testing this script against
  old releases. Leave this empty to look for the most recent tag.

  [--write|-w]
  When set it will update the changelog with the new release.
  If a release with the same version already exists it will replace it, otherwise
  it will prepend it to the file directly after the top level changelog title.

  [--read|-r]
  When set it will read the release notes for the tag from the CHANGELOG.md,
  instead of fetching it. This is useful after release notes have been manually
  edited and need to be pasted somewhere else.
`

const exec = (...args) => execSync(...args).toString().trim()

const changelogTypes = new Map(
  config.changelogTypes.filter(c => !c.hidden).map((c) => [c.type, c.section]))

const logger = (init) => {
  const i = 2
  let indent = 0
  const res = [init]
  return {
    toString () {
      return res.join('\n').trim()
    },
    group (v) {
      this.log(v)
      indent += i
    },
    groupEnd () {
      indent -= i
    },
    log (v) {
      if (!v) {
        res.push('')
      } else {
        res.push(`${' '.repeat(indent)}${v}`)
      }
    },
  }
}

const RELEASE = {
  get h1 () {
    return '# Changelog' + this.sep
  },
  sep: '\n\n',
  heading: '## ',
  // versions in titles must be prefixed with a v
  versionRe: semver.src[11].replace('v?', 'v'),
  version (v) {
    return v.startsWith('v') ? v : `v${v}`
  },
  date (d) {
    return `(${d || exec('date +%Y-%m-%d')})`
  },
  title (v, d) {
    return `${this.heading}${this.version(v)} ${this.date(d)}`
  },
}

const findRelease = (contents, version) => {
  const escRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const titleSrc = (v) => [
    '^',
    RELEASE.heading,
    v ? escRegExp(v) : RELEASE.versionRe,
    ' ',
    escRegExp(RELEASE.date()).replace(/\d/g, '\\d'),
    '$',
  ].join('')

  const releaseSrc = [
    '(',
    titleSrc(RELEASE.version(version)),
    '[\\s\\S]*?',
    RELEASE.sep,
    ')',
    titleSrc(),
  ].join('')

  const release = contents.match(new RegExp(releaseSrc, 'm')) || []
  return (release[1] || '').trim()
}

const assertArgs = (args) => {
  const current = exec(`git rev-parse --abbrev-ref HEAD`)
  const unpushed = exec(`git log HEAD..origin/${args.branch}`).length > 0

  if (!args.read && current !== args.branch || unpushed) {
    throw new Error(`Unpushed commits or not on the right branch:\n${current}\n${unpushed}`)
  }

  if (args.help) {
    console.log(usage())
    process.exit(0)
  }

  return args
}

const parseArgs = (argv) => {
  const result = {
    file: resolve(__dirname, '..', 'CHANGELOG.md'),
    branch: 'latest',
    releaseNotes: false,
    write: false,
    read: false,
    help: false,
    tag: null,
  }

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (a) => a[1].toUpperCase())
      result[key] = true
      continue
    } else if (arg.startsWith('-')) {
      const short = arg.slice(1)
      const key = short === 'w' ? 'write' : short === 'r' ? 'read' : null
      result[key] = true
      continue
    }
    result.tag = arg.startsWith('v') ? arg : 'v' + arg
  }

  // previous tag to requested tag OR most recent tag and everything after
  const getTag = (t = '') => exec(`git describe --tags --abbrev=0 --match="v*" ${t}`)
  // v8.6.0 -> v8.5.5,v8.6.0 || '' -> [v8.6.0,'']
  // the first scenario is mostly for testing to generate release notes from prior releases
  const tag = result.tag ? [getTag(`${result.tag}~1`), result.tag] : [getTag(), '']

  return assertArgs({ ...result, tag })
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))

  if (args.read) {
    const version = args.tag[1] || args.tag[0]
    const contents = fs.readFileSync(args.file, 'utf-8')
    return console.log(findRelease(contents, version))
  }

  await write(args)
}

const write = async (args) => {
  const range = args.tag.join('...')

  const log = exec(`git log --reverse --pretty='format:%h' ${range}`)
    .split('\n')
    .filter(Boolean)
    .map((sha) => `_${sha}: object (expression: "${sha}") { ...commitCredit }`)

  if (!log.length) {
    throw new Error(`No commits found for ${JSON.stringify(range)}`)
  }

  const query = `
    fragment commitCredit on GitObject {
      ... on Commit {
        message
        url
        authors (first:10) {
          nodes {
            user {
              login
              url
            }
            email
            name
          }
        }
        associatedPullRequests (first:10) {
          nodes {
            number
            url
            merged
          }
        }
      }
    }

    query {
      repository (owner:"npm", name:"cli") {
        ${log}
      }
    }
  `

  const body = JSON.parse(exec(`gh api graphql -f query='${query}'`))

  // only commits with data
  const allCommits = Object.entries(body.data.repository)
    .filter(([_, d]) => d)
    .map(([h, d]) => [h.slice(1), d]) // remove leading _

  // collect commits by valid changelog type
  const commits = [...changelogTypes.values()].reduce((acc, c) => {
    acc[c] = []
    return acc
  }, {})

  for (const [hash, data] of allCommits) {
    const message = data.message.replace(/^\s+/gm, '') // remove leading spaces
      .replace(/(\r?\n)+/gm, '\n') // replace multiple newlines with one
      .replace(/([^\s]+@\d+\.\d+\.\d+.*)/gm, '`$1`') // wrap package@version in backticks

    // get changelog type of commit or bail if there is not a valid one
    const type = changelogTypes.get(message.split(/[\s:(]/)[0])
    if (!type) {
      continue
    }

    const lines = message.split('\n')
    // the title is the first line of the commit, 'let' because we change it later
    let title = lines.shift()
    // the body is the rest of the commit with some normalization
    const body = lines.join('\n') // re-join our normalized commit into a string
      .split(/\n?\*/gm) // split on lines starting with a literal *
      .filter((line) => line.trim().length > 0) // remove blank lines
      .map((line) => {
        const clean = line.replace(/\n/gm, ' ') // replace new lines for this bullet with spaces
        return clean.startsWith('*') ? clean : `* ${clean}` // make sure the line starts with *
      })
      .join('\n') // re-join with new lines

    const prs = data.associatedPullRequests.nodes.filter((pull) => pull.merged)
    for (const pr of prs) {
      title = title.replace(new RegExp(`\\s*\\(#${pr.number}\\)`, 'g'), '')
    }

    commits[type].push({
      hash,
      url: data.url,
      title,
      type,
      body,
      prs,
      credit: data.authors.nodes.map((author) => {
        if (author.user && author.user.login) {
          return {
            name: `@${author.user.login}`,
            url: author.user.url,
          }
        }
        // if the commit used an email that's not associated with a github account
        // then the user field will be empty, so we fall back to using the committer's
        // name and email as specified by git
        return {
          name: author.name,
          url: `mailto:${author.email}`,
        }
      }),
    })
  }

  if (!Object.values(commits).flat().length) {
    throw new Error('No relevant commits')
  }

  // this doesnt work with majors but we dont do those very often
  const semverBump = commits.Features.length ? 'minor' : 'patch'
  const { version } = semver.parse(args.tag[0]).inc(semverBump)

  const output = logger(RELEASE.title(version) + '\n')

  for (const key of Object.keys(commits)) {
    if (commits[key].length > 0) {
      output.group(`### ${key}\n`)

      for (const commit of commits[key]) {
        let groupCommit = `* [\`${commit.hash}\`](${commit.url})`
        for (const pr of commit.prs) {
          groupCommit += ` [#${pr.number}](${pr.url})`
        }
        groupCommit += ` ${commit.title}`
        if (key !== 'Dependencies') {
          for (const user of commit.credit) {
            if (args.releaseNotes) {
              groupCommit += ` (${user.name})`
            } else {
              groupCommit += ` ([${user.name}](${user.url}))`
            }
          }
        }

        output.group(groupCommit)
        if (commit.body && commit.body.length) {
          output.log(commit.body)
        }
        output.groupEnd()
      }

      output.groupEnd()
    }
  }

  if (!args.write) {
    return console.log(output.toString())
  }

  let contents = fs.readFileSync(args.file, 'utf-8')
  const existingRelease = findRelease(contents, version)

  if (existingRelease) {
    contents = contents.replace(existingRelease, output.toString())
  } else {
    contents = contents.replace(RELEASE.h1, RELEASE.h1 + output.toString() + RELEASE.sep)
  }

  fs.writeFileSync(args.file, contents, 'utf-8')
}

main()
