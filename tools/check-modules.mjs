/**
 * Check every module against what REDCap requires of it.
 *
 *   node tools/check-modules.mjs
 *
 * These are the faults that do not announce themselves. A module whose class
 * name does not match its namespace installs, appears in the module list, is
 * enabled on a project, and then does nothing -- with no error in any log,
 * because REDCap simply never found a class to instantiate. A version in
 * config.json that disagrees with the directory name produces an installation
 * that reports a version its own manifest contradicts.
 *
 * Written as a script rather than as shell in the CI workflow because the
 * namespace separator is a backslash, and a backslash surviving YAML, then a
 * shell, then a -p expression intact is not something to rely on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(root, 'modules');

let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '\n        ' + detail : ''}`);
}

const modules = fs.readdirSync(modulesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

if (modules.length === 0) {
  console.error('No modules found in modules/');
  process.exit(1);
}

for (const name of modules) {
  const dir = path.join(modulesDir, name);
  console.log('\n' + name);

  const configPath = path.join(dir, 'config.json');
  if (!fs.existsSync(configPath)) {
    check('config.json exists', false, `${name} has no config.json`);
    continue;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    check('config.json parses', true);
  } catch (error) {
    check('config.json parses', false, error.message);
    continue;
  }

  for (const key of ['name', 'namespace', 'description', 'version', 'framework-version']) {
    check(`config.json has ${key}`, Boolean(config[key]));
  }

  check('the version is X.Y.Z', /^\d+\.\d+\.\d+$/.test(String(config.version || '')),
    `version is "${config.version}"`);

  // REDCap looks for a file named after the last segment of the namespace,
  // holding a class of that name that extends AbstractExternalModule.
  const className = String(config.namespace || '').split('\\').pop();
  const classFile = path.join(dir, className + '.php');

  check(`${className}.php exists`, fs.existsSync(classFile),
    `namespace "${config.namespace}" needs ${className}.php beside config.json`);

  if (fs.existsSync(classFile)) {
    const php = fs.readFileSync(classFile, 'utf8');
    check(`it declares class ${className}`,
      new RegExp(`class\\s+${className}\\b`).test(php));
    check('it extends AbstractExternalModule',
      /extends\s+AbstractExternalModule\b/.test(php));

    const declared = /namespace\s+([^;]+);/.exec(php);
    check('the PHP namespace matches config.json',
      declared !== null && declared[1].trim() === String(config.namespace).trim(),
      `config.json says "${config.namespace}", the file says "${declared ? declared[1].trim() : 'nothing'}"`);
  }

  // The documentation key is how REDCap's module list offers a README. A key
  // pointing at a file that is not there is a dead link on every installation.
  if (config.documentation) {
    check(`documentation "${config.documentation}" exists`,
      fs.existsSync(path.join(dir, config.documentation)));
  }

  if (fs.existsSync(path.join(dir, 'sdk'))) {
    check('the vendored SDK records its provenance',
      fs.existsSync(path.join(dir, 'sdk', 'SDK-VERSION.json')),
      'sdk/ with no SDK-VERSION.json cannot be traced to an upstream copy');
  }

  console.log(`        ${config.name} ${config.version}, framework ${config['framework-version']}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall modules OK');
process.exit(failures ? 1 : 0);
