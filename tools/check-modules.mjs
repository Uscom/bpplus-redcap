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

/** Every .php file in a module. sdk/ is skipped: it is vendored, not ours. */
function phpFilesIn(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'sdk' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...phpFilesIn(full));
    else if (entry.name.endsWith('.php')) found.push(full);
  }
  return found;
}

/**
 * Class names a namespaced file uses unqualified and never imported.
 *
 * PHP resolves an unqualified class name inside a namespace against that
 * namespace only. There is no fall-back to the global namespace, the way there
 * is for functions. So REDCap::storeFile() in a namespaced module names a class
 * that does not exist, and catch (Throwable $e) catches nothing.
 *
 * Neither says so. The absent class raises an Error the moment it is reached,
 * the External Modules framework absorbs it, and the page finishes normally
 * with the work undone. php -l sees nothing wrong: it is valid PHP naming
 * something that is not there, which is a run-time fact.
 *
 * Comments and string literals are blanked first, so prose about REDCap:: and
 * an error message quoting a method name are not mistaken for code.
 */
function unqualifiedClassRefs(src) {
  if (!/^\s*namespace\s+\S+\s*;/m.test(src)) return [];   // global file: nothing to resolve

  const known = new Set();
  for (const m of src.matchAll(/^\s*use\s+(?:function\s+|const\s+)?([^;]+);/gm)) {
    for (const clause of m[1].split(',')) {
      const [name, alias] = clause.trim().split(/\s+as\s+/i);
      known.add((alias || name).trim().split('\\').pop());
    }
  }
  for (const m of src.matchAll(/\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/g)) {
    known.add(m[1]);
  }

  const code = stripPhpText(src);
  const allowed = new Set(['self', 'static', 'parent', 'class']);
  const seen = new Map();

  const record = (name, index) => {
    if (allowed.has(name) || known.has(name) || seen.has(name)) return;
    seen.set(name, { name, line: code.slice(0, index).split('\n').length });
  };

  // Foo::bar() -- but not $foo::, not ->foo::, and not an already-qualified
  // \Foo:: or Some\Foo::, where the backslash has done the job.
  for (const m of code.matchAll(/(^|[^\\$\w>])([A-Za-z_]\w*)\s*::/g)) {
    record(m[2], m.index + m[1].length);
  }
  for (const m of code.matchAll(/(^|[^\\$\w>])new\s+([A-Za-z_]\w*)/g)) {
    record(m[2], m.index + m[1].length);
  }
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) {
    for (const type of m[1].split('|')) {
      const name = type.trim().split(/\s/)[0];
      if (/^[A-Za-z_]\w*$/.test(name)) record(name, m.index);
    }
  }

  return [...seen.values()].sort((a, b) => a.line - b.line);
}

/**
 * The same PHP with comments, string literals and heredocs blanked out.
 *
 * Newlines are kept so a reported line number still points at the source.
 */
function stripPhpText(src) {
  const blank = text => text.replace(/[^\n]/g, ' ');
  let out = '';
  let i = 0;

  while (i < src.length) {
    const rest = src.slice(i, i + 3);

    if (rest.startsWith('//') || src[i] === '#') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith('<<<')) {
      const open = /^<<<[ \t]*(['"]?)([A-Za-z_]\w*)\1\r?\n/.exec(src.slice(i));
      if (open) {
        const after = src.slice(i + open[0].length);
        const found = new RegExp('^\\s*' + open[2] + '\\b', 'm').exec(after);
        const stop = i + open[0].length +
          (found ? found.index + found[0].length : after.length);
        out += blank(src.slice(i, stop));
        i = stop;
        continue;
      }
    }
    if (src[i] === "'" || src[i] === '"') {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, src.length);
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }

    out += src[i];
    i++;
  }

  return out;
}

/**
 * Prove the analyser above still works, before trusting it about a module.
 *
 * It is the only thing standing between a namespaced module and a class that
 * is not there, and a check that has quietly stopped checking looks exactly
 * like a module with nothing wrong with it. Run on every invocation rather
 * than behind a flag, because the flag is what would not get run.
 */
function selfTest() {
  const sample = [
    '<?php',
    'namespace Uscom\\Sample;',
    'use ExternalModules\\AbstractExternalModule;',
    'use Exception;',
    '// Prose naming REDCap::storeFile() is not a call to it.',
    'class Sample extends AbstractExternalModule {',
    '    public function fine() {',
    '        $a = \\REDCap::getData(1);',
    '        $b = self::class;',
    '        $c = $this->thing()::NAME;',
    '        $d = new Exception("REDCap::storeFile did not store the file.");',
    '        try { $a = 1; } catch (Exception $x) { }',
    '        return [$a, $b, $c, $d];',
    '    }',
    '    public function faulty() {',
    '        $e = REDCap::storeFile("x", 1, "y");',
    '        $f = new DateTimeImmutable("now");',
    '        try { $e = 1; } catch (Throwable $x) { }',
    '        return [$e, $f];',
    '    }',
    '}',
  ].join('\n');

  const found = unqualifiedClassRefs(sample).map(u => u.name).sort();
  const want = ['DateTimeImmutable', 'REDCap', 'Throwable'];

  check('the unqualified-class check still catches a known fault',
    found.length === want.length && want.every((name, i) => found[i] === name),
    `expected ${want.join(', ')}; it found ${found.join(', ') || 'nothing'}`);
}

selfTest();

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

  // Every class a namespaced file names has to be imported or written global.
  // See unqualifiedClassRefs() for what goes wrong when one is not, and for
  // why neither PHP nor REDCap will mention it.
  for (const file of phpFilesIn(dir)) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const loose = unqualifiedClassRefs(fs.readFileSync(file, 'utf8'));
    check(`${rel} qualifies every class it names`, loose.length === 0,
      loose.map(u => `line ${u.line}: ${u.name} resolves inside the module namespace. `
        + `Write \\${u.name}, or import it with "use ${u.name};".`).join('\n        '));
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
