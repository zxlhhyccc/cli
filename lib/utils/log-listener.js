const { inspect, format } = require('util')

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

module.exports = class LogListener {
  constructor () {
    this[_boundLogHandler] = this[_logHandler].bind(this)
    this[_buffer] = []
  }

  setConfig (config) {
    const color = config.get('color')
    const timing = config.get('timing')
    const loglevel = config.get('loglevel')
    const heading = config.get('heading')
    const unicode = config.get('unicode')

    // this logic is duplicated in the config 'color' flattener
    this.color = color === 'always' ? true
      : color === false ? false
      : process.stderr.isTTY

    this.level = timing && loglevel === 'notice' ? 'timing'
      : loglevel

    this.unicode = !!unicode

    this.heading = heading || 'npm'
  }

  pause () {
    this[_paused] = true
  }

  resume() {
    this[_paused] = false
    this[_buffer].forEach((m) => {
      this[_write](...m)
    })
    this[_buffer] = []
  }

  [_write] (level, prefix, ...args) {
    const msg = format(...args).trim()
    console.error('--NEW--', level, prefix, msg)
  }

  [_logHandler] (level, ...args) {
    if (level === 'pause') {
      this.pause()
      return
    }

    if (level === 'resume') {
      this.resume()
      return
    }

    if (levelMap.get(level) < levelMap.get(this.level))
      return

    if (this[_paused]) {
      this[_buffer].push([level, ...args])
      return
    }

    this[_write](level, ...args)    
  }

  init () {
    process.on('log', this[_boundLogHandler])
  }

  reset () {
    process.off('log', this[_boundLogHandler])
  }
}