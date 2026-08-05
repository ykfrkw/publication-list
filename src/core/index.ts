/**
 * Public surface of the framework-free core.
 *
 * `sources/*` is deliberately NOT re-exported. The embed bundle imports the
 * pipeline, and the pipeline imports the sources it needs; barrelling the
 * source modules here would give any consumer a single import that drags all
 * five upstream clients into the bundle and quietly defeats tree-shaking.
 */

export * from './types'
export * from './ids'
export * from './config'
export * from './dedupe'
export * from './categorize'
export * from './format'
export * from './render'
export * from './pipeline'
export * from './cache'
