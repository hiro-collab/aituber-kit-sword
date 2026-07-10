/**
 * @jest-environment node
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const projectRoot = path.resolve(__dirname, '../../..')
const generatorPath = path.join(
  projectRoot,
  'scripts',
  'generate-asset-manifest.js'
)
const fixturePrefix = path.join(projectRoot, '.generate-asset-manifest-')

let fixturePath = ''

function runGit(args: string[]) {
  execFileSync('git', args, { cwd: fixturePath, stdio: 'pipe' })
}

function runGenerator() {
  execFileSync(process.execPath, ['scripts/generate-asset-manifest.js'], {
    cwd: fixturePath,
    stdio: 'pipe',
  })
}

function readManifest() {
  return JSON.parse(
    fs.readFileSync(
      path.join(fixturePath, 'src', 'constants', 'assetManifest.json'),
      'utf-8'
    )
  )
}

describe('generate-asset-manifest', () => {
  beforeEach(() => {
    fixturePath = fs.mkdtempSync(fixturePrefix)
    fs.mkdirSync(path.join(fixturePath, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(fixturePath, 'src', 'constants'), { recursive: true })
    fs.copyFileSync(
      generatorPath,
      path.join(fixturePath, 'scripts', 'generate-asset-manifest.js')
    )

    runGit(['init', '--quiet'])
    runGit(['config', 'user.email', 'generator-test@example.invalid'])
    runGit(['config', 'user.name', 'Generator Test'])
  })

  afterEach(() => {
    if (fixturePath) fs.rmSync(fixturePath, { recursive: true, force: true })
    expect(fs.existsSync(fixturePath)).toBe(false)
  })

  it('embeds slide text only when the exact optional file is tracked', () => {
    const folderName = 'tracked-slide'
    const slideDir = path.join(fixturePath, 'public', 'slides', folderName)
    const untrackedSupplementMarker = 'SYNTHETIC_PRIVATE_SUPPLEMENT_MARKER'
    const untrackedThemeMarker = 'synthetic-private-theme-marker'
    const trackedSupplement = 'Tracked supplement content.'
    const trackedTheme = `/* @theme fixture */
section { --${untrackedThemeMarker}: preserved; }`

    fs.mkdirSync(slideDir, { recursive: true })
    fs.writeFileSync(path.join(slideDir, 'slides.md'), '# Fixture slide\n')
    fs.writeFileSync(path.join(slideDir, 'scripts.json'), '{}\n')
    fs.writeFileSync(
      path.join(slideDir, 'supplement.txt'),
      untrackedSupplementMarker
    )
    fs.writeFileSync(
      path.join(slideDir, 'theme.css'),
      `/* @theme fixture */
section { --${untrackedThemeMarker}: untracked; }`
    )
    runGit([
      'add',
      `public/slides/${folderName}/slides.md`,
      `public/slides/${folderName}/scripts.json`,
    ])

    runGenerator()

    const untrackedManifest = readManifest()
    expect(untrackedManifest.slides.folders).toEqual([folderName])
    expect(untrackedManifest.slides.supplements[folderName]).toBe('')
    expect(untrackedManifest.slides.rendered[folderName].html).not.toBe('')
    expect(untrackedManifest.slides.rendered[folderName].css).not.toContain(
      untrackedThemeMarker
    )
    expect(JSON.stringify(untrackedManifest)).not.toContain(
      untrackedSupplementMarker
    )
    expect(JSON.stringify(untrackedManifest)).not.toContain(
      untrackedThemeMarker
    )

    fs.writeFileSync(path.join(slideDir, 'supplement.txt'), trackedSupplement)
    fs.writeFileSync(path.join(slideDir, 'theme.css'), trackedTheme)
    runGit([
      'add',
      `public/slides/${folderName}/supplement.txt`,
      `public/slides/${folderName}/theme.css`,
    ])

    runGenerator()

    const trackedManifest = readManifest()
    expect(trackedManifest.slides.supplements[folderName]).toBe(
      trackedSupplement
    )
    expect(trackedManifest.slides.rendered[folderName].css).toContain(
      untrackedThemeMarker
    )
  })
})
