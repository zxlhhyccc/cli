const { inspect, format } = require('util')
const { explain } = require('./explain-eresolve.js')

const levels = [
  'silly',
  'verbose',
  'info',
  'timing',
  'http',
  'notice',
  'warn',
  'error',
  'silent',
]

const levelMap = new Map(levels.reduce((set, level, index) => {
  set.push([level, index], [index, level])
  return set
}, []))

const _logHandler = Symbol('logHandler')
const _boundLogHandler = Symbol('boundLogHandler')
const _buffer = Symbol('buffer')
const _write = Symbol('write')
const _paused = Symbol('paused')
const _pause = Symbol('pause')
const _resume = Symbol('resume')

module.exports = class Display {
  constructor () {
    this[_boundLogHandler] = this[_logHandler].bind(this)
    this[_buffer] = []
    this[_paused] = true
    process.on('log', this[_boundLogHandler])
  }

  reset () {
    process.off('log', this[_boundLogHandler])
  }

  setConfig (options) {
    const {
      color,
      timing,
      loglevel,
      heading,
      unicode
    } = options

    this.color = color
    this.heading = heading
    this.unicode = unicode
    this.level = timing && loglevel === 'notice' ? 'timing'
      : loglevel
  }

  [_pause] () {
    this[_paused] = true
  }

  [_resume] () {
    this[_paused] = false
    this[_buffer].forEach((m) => {
      this[_write](...m)
    })
    this[_buffer] = []
  }

  [_write] (level, prefix, ...args) {
    const msg = format(...args).trim()
    // TODO: colors
    console.error(this.heading, level, prefix, msg)
  }

  [_logHandler] (level, ...args) {
    if (level === 'pause') {
      this[_pause]()
      return
    }

    if (level === 'resume') {
      this[_resume]()
      return
    }

    if (levelMap.get(level) < levelMap.get(this.level))
      return

    if (this[_paused]) {
      this[_buffer].push([level, ...args])
      return
    }

    // Also (and this is a really inexcusable kludge), we patch the
    // log.warn() method so that when we see a peerDep override
    // explanation from Arborist, we can replace the object with a
    // highly abbreviated explanation of what's being overridden.
    if (level === 'warn' && args[0] === 'ERESOLVE' && args[1] && typeof args[1] === 'object') {
      this[_write](level, args[0], args[1])
      this[_write](level, '', explain(args[1], this.color, 2))
      return 
    }

    this[_write](level, ...args)    
  }

  log (...args) {
    this[_write](...args)
  }

  output (...args) {
    // this.log.clearProgress() // TODO: proggy
    console.log(...args)
    // this.log.showProgress() // TODO: proggy
  }

  outputError (...args) {
    console.error(...args)
  }
}
