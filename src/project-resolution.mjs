import ts from 'typescript';
import path from 'node:path/posix';
import {readFileSync} from 'node:fs';
import nativePath from 'node:path';

// Resolve against the indexed project only. Configs are data, and their
// package/config lookups cannot reach the scanner's own dependencies.
export function createProjectResolver(root, files, sources) {
  const virtual = file => file.startsWith('/project/') ? file.slice(9) : null;
  const dirs = new Set(['/project']);
  for (const file of files) {
    for (let dir = path.dirname('/project/' + file); !dirs.has(dir); dir = path.dirname(dir)) dirs.add(dir);
  }
  const host = {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => '/project',
    fileExists: file => files.has(virtual(file)),
    directoryExists: dir => dirs.has(dir),
    readDirectory: () => [],
    readFile(file) {
      const relative = virtual(file);
      if (!files.has(relative) || !relative.endsWith('.json')) return undefined;
      return readFileSync(nativePath.join(root, relative), 'utf8');
    },
  };
  const configs = new Map();
  const scopes = new Map();
  const fallback = {allowJs:true, moduleResolution:ts.ModuleResolutionKind.Bundler};
  function optionsFor(from) {
    let dir = path.dirname(from);
    const visited = [];
    let options;
    while (!scopes.has(dir)) {
      visited.push(dir);
      const config = ['tsconfig.json','jsconfig.json'].map(name=>path.join(dir,name)).find(name=>files.has(name));
      if (config) {
        const errors = [];
        const parsed = ts.getParsedCommandLineOfConfigFile('/project/' + config, {}, {
          ...host,onUnRecoverableConfigFileDiagnostic:error=>errors.push(error),
        });
        options = {...fallback, ...parsed?.options};
        if (options.paths) {
          options.paths = Object.fromEntries(Object.entries(options.paths).filter(([,mappings])=>
            Array.isArray(mappings) && mappings.every(mapping=>typeof mapping==='string')));
        }
        configs.set(config, [...errors,...(parsed?.errors ?? [])].filter(error=>error.code!==18003)
          .map(error=>ts.flattenDiagnosticMessageText(error.messageText,' ')));
        break;
      }
      if (dir === '.') break;
      dir = path.dirname(dir);
    }
    options ??= scopes.get(dir) ?? fallback;
    for (const scope of visited) scopes.set(scope,options);
    return options;
  }
  const cache = ts.createModuleResolutionCache('/project', file=>file, fallback);
  const resolutions = new Map();
  function resolve(from, specifier) {
    const key = JSON.stringify([from,specifier]);
    if (resolutions.has(key)) return resolutions.get(key);
    const options = optionsFor(from);
    const match = ts.resolveModuleName(specifier, '/project/' + from, options, host, cache).resolvedModule;
    const local = match ? virtual(match.resolvedFileName) : null;
    const relative = specifier.startsWith('.') ? path.join(path.dirname(from),specifier) : null;
    const aliasMatches = [];
    for (const [pattern,mappings] of Object.entries(options.paths ?? {})) {
      const star = pattern.indexOf('*');
      const prefix = star < 0 ? pattern : pattern.slice(0,star);
      const suffix = star < 0 ? '' : pattern.slice(star+1);
      if (star < 0 ? specifier !== pattern : !specifier.startsWith(prefix) || !specifier.endsWith(suffix) ||
        specifier.length < prefix.length + suffix.length) continue;
      const matched = specifier.slice(prefix.length,specifier.length-suffix.length);
      const aliasRoot = options.baseUrl ?? options.pathsBasePath ?? '/project';
      for (const mapping of mappings) aliasMatches.push(virtual(path.resolve(aliasRoot,mapping.replace('*',matched))));
    }
    const target = sources.has(local) ? local : null;
    const result = {
      target,local:Boolean(local || relative || aliasMatches.length),
      asset:Boolean(local || files.has(relative) || aliasMatches.some(file=>files.has(file))),
      verbatim:options.verbatimModuleSyntax===true,
    };
    resolutions.set(key,result);
    return result;
  }
  return {resolve, configs};
}
